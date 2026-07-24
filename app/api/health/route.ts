// 헬스체크 — Vercel Cron이 매일 호출. 데이터 소스를 실제로 읽어보고
// 경고(시트 구조 변경·파싱 실패 등)가 있으면 슬랙으로 알린다.
// 필요 env: SLACK_WEBHOOK_URL (알림 채널), CRON_SECRET (호출 보호, 권장)

import { NextRequest, NextResponse } from 'next/server'
import { getMasterData, hasLiveEnv } from '@/lib/aggregate'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!hasLiveEnv()) return NextResponse.json({ ok: false, warnings: ['환경변수 미설정 (데모 모드)'] }, { status: 500 })

  let warnings: string[] = []
  let ok = true
  try {
    const d = await getMasterData(true, 'all')
    warnings = d.warnings
    ok = warnings.length === 0
  } catch (e: any) {
    ok = false
    warnings = [`데이터 로드 실패: ${e.message}`]
  }

  if (!ok && process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `⚠️ *스태핑 대시보드 헬스체크 경고*\n${warnings.map(w => `• ${w}`).join('\n')}\n원본 시트의 탭 이름/헤더가 바뀌었을 가능성이 큽니다 → https://staffing-master.vercel.app`,
      }),
    }).catch(() => { /* 알림 실패해도 헬스체크 응답은 유지 */ })
  }
  return NextResponse.json({ ok, warnings })
}
