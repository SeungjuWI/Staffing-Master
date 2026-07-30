// 지원 미달 알림 — Vercel Cron 이 매일 09:00 KST(= 베트남 07:00)에 호출.
// 모집 중 공고가 모집 시작 D+3 이상인데 누적 지원이 TO×10건 미만이면 슬랙으로 알린다.
// 하루 1회 stateless 다이제스트: days===3 이 "오늘 신규", 그 뒤로는 해소될 때까지 "계속 미달"에 남는다.
// 필요 env: SLACK_ALERT_WEBHOOK_URL (없으면 SLACK_WEBHOOK_URL 폴백), CRON_SECRET (호출 보호, 권장)
// ?dry=1 이면 발송 없이 판정 결과·메시지만 JSON 으로 반환 (검증용)

import { NextRequest, NextResponse } from 'next/server'
import { getMasterData, hasLiveEnv } from '@/lib/aggregate'
import type { JdRow } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APPS_PER_TO = Number(process.env.ALERT_APPS_PER_TO) || 10
const FROM_DAY = Number(process.env.ALERT_FROM_DAY) || 3
const DASH_URL = 'https://staffing-master.vercel.app/?tab=korea'

type Flagged = {
  code: string
  company: string
  title: string
  days: number
  apps: number
  target: number
  to: number
  toMissing: boolean // Matching Status 미등재 + Headcount 공란 → TO=1 로 간주함
  low: boolean       // 대시보드 '지원 부족' 판정과 일치 (D+7 이후 30건/TO 기준)
}

// 목표 대비 지원 게이지 — 10칸 고정, 숫자 감각을 시각으로 보조
function bar(apps: number, target: number): string {
  const filled = Math.max(0, Math.min(10, Math.round((apps / target) * 10)))
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled)
}

// 공고 1건 = 3줄 묶음 (코드·회사·경과 / 제목 / 게이지·지원 현황) — 한 줄 나열은 난잡하다는 피드백으로 교체
// TO 부가정보는 인라인 코드로 감싸 칩처럼 표시. '지원 부족 판정' 워딩·⚠는 뺐음 (피드백)
function jdBlock(f: Flagged): string {
  const title = f.title.length > 60 ? f.title.slice(0, 59) + '…' : f.title
  const to = f.toMissing ? '  `TO 미등재→1 간주`' : f.to > 1 ? `  \`TO ${f.to}\`` : ''
  return `*${f.code}*  ${f.company} · D+${f.days}\n${title}\n${bar(f.apps, f.target)}  *${f.apps} / ${f.target}*${to}`
}

// 그룹(신규/계속) = 제목 섹션 + 공고 5건씩 묶은 섹션들 (섹션당 3,000자 제한 대비)
function groupBlocks(heading: string, items: Flagged[]) {
  const chunks: Flagged[][] = []
  for (let i = 0; i < items.length; i += 5) chunks.push(items.slice(i, i + 5))
  return [
    { type: 'section', text: { type: 'mrkdwn', text: heading } },
    ...chunks.map(c => ({ type: 'section', text: { type: 'mrkdwn', text: c.map(jdBlock).join('\n\n') } })),
  ]
}

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!hasLiveEnv()) return NextResponse.json({ ok: false, error: '환경변수 미설정 (데모 모드)' }, { status: 500 })

  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const d = await getMasterData(true, 'all')

  // 대상: 모집 중 + 충원 미완료 공고
  const active = d.matching.jds.filter((j: JdRow) => j.open && !(j.headcount != null && j.hiresAll >= j.headcount))

  const flagged: Flagged[] = []
  const noDate: JdRow[] = [] // 모집 시작일 미상 — Date Received 공란 + 지원 0건이라 폴백도 없음
  for (const j of active) {
    const to = j.headcount ?? 1
    const target = to * APPS_PER_TO
    if (j.days == null) {
      if (j.appsAll < target) noDate.push(j)
      continue
    }
    if (j.days < FROM_DAY || j.appsAll >= target) continue
    flagged.push({
      code: j.code, company: j.company, title: j.title,
      days: j.days, apps: j.appsAll, target, to,
      toMissing: j.headcount == null,
      low: j.health === 'low',
    })
  }

  // 오래된(D+N 큰) 순 — 오래 미달일수록 시급 (피드백). 같은 날짜면 달성률 낮은 순
  const urgent = (a: Flagged, b: Flagged) => b.days - a.days || a.apps / a.target - b.apps / b.target
  const fresh = flagged.filter(f => f.days === FROM_DAY).sort(urgent)
  const ongoing = flagged.filter(f => f.days > FROM_DAY).sort(urgent)

  const total = fresh.length + ongoing.length + noDate.length
  const divider = { type: 'divider' }

  // Block Kit 본문 블록만 사용 — 색 사이드바(attachments)는 내용이 길면 슬랙이 "간략히 보기"로 접어버려서 뺐음
  // <!here> = 슬랙 @here 멘션 문법 (문자 그대로 "@here" 로 쓰면 안 울림). 미달 0건인 날은 발송 자체를 안 하므로 헛울림 없음
  // ?nohere=1 이면 @here 생략 (테스트 발송용 — 채널 사람들 호출 안 함)
  const noHere = req.nextUrl.searchParams.get('nohere') === '1'
  // 한·베 병기 (보는 사람이 한국+베트남 팀) · '건' 카운터 및 기준 설명 줄 제거 (피드백)
  const payload = {
    text: `🚨 지원 미달 공고 · Tin thiếu ứng viên (${total})`, // 푸시 알림 미리보기용 폴백
    blocks: [
      ...(noHere ? [] : [{ type: 'section', text: { type: 'mrkdwn', text: '<!here>' } }]),
      { type: 'header', text: { type: 'plain_text', text: `🚨 지원 미달 공고 · Tin thiếu ứng viên (${total})` } },
      ...(fresh.length ? [divider, ...groupBlocks(`🆕 *오늘 D+${FROM_DAY} 도달 · Mới đạt D+${FROM_DAY} hôm nay (${fresh.length})*`, fresh)] : []),
      ...(ongoing.length ? [divider, ...groupBlocks(`🔴 *계속 미달 · Vẫn thiếu ứng viên (${ongoing.length})*`, ongoing)] : []),
      ...(noDate.length
        ? [divider, {
            type: 'section',
            text: { type: 'mrkdwn', text: `❓ *모집 시작일 미상 · Chưa rõ ngày bắt đầu (${noDate.length})* — 원장 Date Received 기입 필요 / Cần điền Date Received\n${noDate.map(j => `*${j.code}* ${j.company} · 지원 ${j.appsAll}`).join('\n')}` },
          }]
        : []),
      divider,
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Dashboard' }, url: DASH_URL }] },
    ],
  }

  const summary = { ok: true, total, fresh: fresh.length, ongoing: ongoing.length, noDate: noDate.length }

  if (dry) return NextResponse.json({ ...summary, payload, flagged, noDate: noDate.map(j => j.code) })

  if (total === 0) return NextResponse.json({ ...summary, sent: false }) // 미달 0건인 날은 발송 안 함

  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!webhook) return NextResponse.json({ ...summary, sent: false, error: 'SLACK_ALERT_WEBHOOK_URL 미설정' }, { status: 500 })

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return NextResponse.json({ ...summary, sent: false, error: `슬랙 발송 실패: ${res.status}` }, { status: 502 })
  return NextResponse.json({ ...summary, sent: true })
}
