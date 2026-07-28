// 지원 미달 알림 — Vercel Cron 이 매일 10:30 KST(= 베트남 08:30 출근)에 호출.
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
  toMissing: boolean // TO_Table 미등재 + Headcount 공란 → TO=1 로 간주함
  low: boolean       // 대시보드 '지원 부족' 판정과 일치 (D+7 이후 30건/TO 기준)
}

// 공고 1건 = 3줄 묶음 (코드·회사·경과 / 제목 / 지원 현황) — 한 줄 나열은 난잡하다는 피드백으로 교체
function block(f: Flagged): string {
  const title = f.title.length > 60 ? f.title.slice(0, 59) + '…' : f.title
  const to = f.toMissing ? ' (TO 미등재→1 간주)' : f.to > 1 ? ` (TO ${f.to})` : ''
  const warn = f.low ? '  ⚠ 지원 부족 판정' : ''
  return `*${f.code}* ${f.company} · D+${f.days}\n${title}\n지원 ${f.apps}건 / 목표 ${f.target}건${to}${warn}`
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

  const worst = (a: Flagged, b: Flagged) => a.apps / a.target - b.apps / b.target
  const fresh = flagged.filter(f => f.days === FROM_DAY).sort(worst)
  const ongoing = flagged.filter(f => f.days > FROM_DAY).sort(worst)

  const parts: string[] = []
  // <!here> = 슬랙 @here 멘션 문법 (문자 그대로 "@here" 로 쓰면 안 울림). 미달 0건인 날은 발송 자체를 안 하므로 헛울림 없음
  parts.push(`<!here>\n🚨 *지원 미달 공고 ${flagged.length + noDate.length}건* — 기준: 모집 D+${FROM_DAY} 이상 · TO당 ${APPS_PER_TO}건 미만`)
  if (fresh.length) parts.push(`🆕 *오늘 D+${FROM_DAY} 도달 (${fresh.length}건)*\n\n${fresh.map(block).join('\n\n')}`)
  if (ongoing.length) parts.push(`🔴 *계속 미달 (${ongoing.length}건)*\n\n${ongoing.map(block).join('\n\n')}`)
  if (noDate.length) {
    parts.push(`❓ *모집 시작일 미상 (${noDate.length}건)* — 원장 Date Received 기입 필요\n\n${noDate.map(j => `*${j.code}* ${j.company} · 지원 ${j.appsAll}건`).join('\n')}`)
  }
  parts.push(`대시보드에서 보기 → ${DASH_URL}`)
  const text = parts.join('\n\n')

  const total = fresh.length + ongoing.length + noDate.length
  const summary = { ok: true, total, fresh: fresh.length, ongoing: ongoing.length, noDate: noDate.length }

  if (dry) return NextResponse.json({ ...summary, text, flagged, noDate: noDate.map(j => j.code) })

  if (total === 0) return NextResponse.json({ ...summary, sent: false }) // 미달 0건인 날은 발송 안 함

  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!webhook) return NextResponse.json({ ...summary, sent: false, error: 'SLACK_ALERT_WEBHOOK_URL 미설정' }, { status: 500 })

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) return NextResponse.json({ ...summary, sent: false, error: `슬랙 발송 실패: ${res.status}` }, { status: 502 })
  return NextResponse.json({ ...summary, sent: true })
}
