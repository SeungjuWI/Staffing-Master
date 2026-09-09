// 지원 미달·발송 지연 알림 — Vercel Cron 이 매일 09:00 KST(= 베트남 07:00)에 호출.
// 하루 1회 stateless 다이제스트. 팀 확정 퍼널 어휘(지원 10건 문턱)에 맞춰 공고를 단계별로 분류:
//   📤 발송 지연  — 지원이 문턱(10건)을 넘었는데 기업 발송 기록이 없음 (공이 매칭 스쿼드에 있음)
//   🆕/🔴 지원 미달 — D+3 이상인데 지원 < TO×10 이고 문턱(10건)도 미달 (공이 인재/소싱 스쿼드에 있음)
//   📮 발송 완료  — 지원은 미달이어도 이미 발송된 공고는 독촉 무의미 → 하단 한 줄로만 표기
// ("발송 지연"은 2026-09-09 ktc-support slack-nudges 에서 이관 — 거기 candidates DB 는 V코드 공고
//  귀속이 누락돼 지원 문턱을 판정할 수 없고, 문턱 없이 게재만 보면 신규 공고까지 70건대 무더기가 됐다.)
// 발송 신호 2계통(둘 중 하나면 발송으로 본다):
//   ① delivered>0 — ktc-ops CRM2 발송 → ktc-support 웹훅 → 후보 sent_to_company (이름 매칭 실패 시 누락 가능)
//   ② cvSharedAt — ktc-support funnel_events(cv_shared) 공고 단위 발송 원장 (관리화면 수동 기록 포함)
// ①만 있고 발송 후보가 전원 rejected 로 바뀌면 delivered 가 0 으로 돌아와 알림에 자동 복귀한다.
// 필요 env: SLACK_ALERT_WEBHOOK_URL (없으면 SLACK_WEBHOOK_URL 폴백), CRON_SECRET (호출 보호, 권장)
// ?dry=1 이면 발송 없이 판정 결과·메시지만 JSON 으로 반환 (검증용)

import { NextRequest, NextResponse } from 'next/server'
import { getMasterData, hasLiveEnv } from '@/lib/aggregate'
import type { JdRow } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APPS_PER_TO = Number(process.env.ALERT_APPS_PER_TO) || 10
const FROM_DAY = Number(process.env.ALERT_FROM_DAY) || 3
const SHIP_MIN_APPS = Number(process.env.ALERT_SHIP_MIN_APPS) || 10 // 발송 가능 문턱 — 팀 퍼널 '지원 10건 이상'
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

  const flagged: Flagged[] = []   // 지원 미달 (문턱 미만 + 미발송) — 소싱 독촉
  const shipDelay: Flagged[] = [] // 지원 문턱(10건+) 도달 + 미발송 — 발송 독촉
  const noDate: JdRow[] = [] // 모집 시작일 미상 — Date Received 공란 + 지원 0건이라 폴백도 없음
  const forwarded: JdRow[] = [] // 지원은 미달이지만 기업 발송이 이미 나간 공고 — 본문 제외, 하단 표기
  const isForwarded = (j: JdRow) => j.delivered > 0 || j.cvSharedAt != null
  for (const j of active) {
    const to = j.headcount ?? 1
    const target = to * APPS_PER_TO
    const f: Flagged = {
      code: j.code, company: j.company, title: j.title,
      days: j.days ?? 0, apps: j.appsAll, target, to,
      toMissing: j.headcount == null,
      low: j.health === 'low',
    }
    if (j.days == null) {
      // 시작일 미상 = 지원 0건(첫 지원일 폴백도 없음) — 발송·문턱 판정 무의미
      if (j.appsAll < target) (isForwarded(j) ? forwarded : noDate).push(j)
      continue
    }
    if (j.days < FROM_DAY) continue
    if (isForwarded(j)) {
      // 발송 후에도 지원이 목표 미달이면 참고용 각주에만 (목표 달성 건은 표기 자체가 불필요)
      if (j.appsAll < target) forwarded.push(j)
      continue
    }
    // 문턱(10건+)을 넘겼으면 공은 발송(매칭 스쿼드) — 목표(TO×10) 달성 여부와 무관하게 발송 독촉.
    // target = TO×10 ≥ 10 이므로 목표 달성·미발송 공고도 반드시 여기로 들어온다.
    if (j.appsAll >= SHIP_MIN_APPS) {
      shipDelay.push(f)
      continue
    }
    if (j.appsAll >= target) continue // 방어 (SHIP_MIN ≤ target 이라 실제로는 도달 불가)
    flagged.push(f)
  }

  // 오래된(D+N 큰) 순 — 오래 미달일수록 시급 (피드백). 같은 날짜면 달성률 낮은 순
  const urgent = (a: Flagged, b: Flagged) => b.days - a.days || a.apps / a.target - b.apps / b.target
  const fresh = flagged.filter(f => f.days === FROM_DAY).sort(urgent)
  const ongoing = flagged.filter(f => f.days > FROM_DAY).sort(urgent)
  shipDelay.sort((a, b) => b.days - a.days || b.apps - a.apps) // 오래된 순, 같은 날짜면 쌓인 지원 많은 순

  const total = shipDelay.length + fresh.length + ongoing.length + noDate.length
  const divider = { type: 'divider' }

  // Block Kit 본문 블록만 사용 — 색 사이드바(attachments)는 내용이 길면 슬랙이 "간략히 보기"로 접어버려서 뺐음
  // <!here> = 슬랙 @here 멘션 문법 (문자 그대로 "@here" 로 쓰면 안 울림). 미달 0건인 날은 발송 자체를 안 하므로 헛울림 없음
  // ?nohere=1 이면 @here 생략 (테스트 발송용 — 채널 사람들 호출 안 함)
  const noHere = req.nextUrl.searchParams.get('nohere') === '1'
  // 한·베 병기 (보는 사람이 한국+베트남 팀) · '건' 카운터 및 기준 설명 줄 제거 (피드백)
  const header = `🚨 지원 미달 · 발송 지연 · Thiếu / chưa gửi ứng viên (${total})`
  const payload = {
    text: header, // 푸시 알림 미리보기용 폴백
    blocks: [
      ...(noHere ? [] : [{ type: 'section', text: { type: 'mrkdwn', text: '<!here>' } }]),
      { type: 'header', text: { type: 'plain_text', text: header } },
      // 발송 지연이 맨 위 — 후보가 이미 모여 있어 오늘 바로 처리 가능한 액션이라 우선순위가 가장 높다
      ...(shipDelay.length ? [divider, ...groupBlocks(`📤 *발송 지연 — 지원 ${SHIP_MIN_APPS}건+ 모임, 기업 발송 전 · Đủ ứng viên, chưa gửi cho công ty (${shipDelay.length})*`, shipDelay)] : []),
      ...(fresh.length ? [divider, ...groupBlocks(`🆕 *오늘 D+${FROM_DAY} 도달 · Mới đạt D+${FROM_DAY} hôm nay (${fresh.length})*`, fresh)] : []),
      ...(ongoing.length ? [divider, ...groupBlocks(`🔴 *계속 미달 · Vẫn thiếu ứng viên (${ongoing.length})*`, ongoing)] : []),
      ...(noDate.length
        ? [divider, {
            type: 'section',
            text: { type: 'mrkdwn', text: `❓ *모집 시작일 미상 · Chưa rõ ngày bắt đầu (${noDate.length})* — 원장 Date Received 기입 필요 / Cần điền Date Received\n${noDate.map(j => `*${j.code}* ${j.company} · 지원 ${j.appsAll}`).join('\n')}` },
          }]
        : []),
      // 지원 미달이어도 기업 발송이 나간 공고는 소싱 독촉이 무의미 → 카운트에서 빼고 한 줄만 남김
      ...(forwarded.length
        ? [divider, {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `📮 기업 발송 완료로 제외 · Đã gửi cho công ty nên bỏ qua (${forwarded.length}) — ${forwarded.map(j => `${j.code} ${j.company}`).join(' · ').slice(0, 2800)}` }],
          }]
        : []),
      divider,
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Dashboard' }, url: DASH_URL }] },
    ],
  }

  const summary = { ok: true, total, shipDelay: shipDelay.length, fresh: fresh.length, ongoing: ongoing.length, noDate: noDate.length, forwarded: forwarded.length }

  if (dry) return NextResponse.json({ ...summary, payload, shipDelayJds: shipDelay, flagged, noDate: noDate.map(j => j.code), forwardedJds: forwarded.map(j => ({ code: j.code, company: j.company, delivered: j.delivered, cvSharedAt: j.cvSharedAt, apps: j.appsAll })) })

  if (total === 0) return NextResponse.json({ ...summary, sent: false }) // 지연·미달 0건인 날은 발송 안 함

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
