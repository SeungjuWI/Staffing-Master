// 로케일 무관 표기·상수만 남긴 파일 — 숫자·날짜·원화 등 로케일 의존 포맷터와 채널 라벨은
// lib/i18n.ts 의 getI18n(locale) 번들로 이동했다 (서버는 prop, 클라이언트는 useI18n 으로 받는다).

// % 표기는 전 로케일 공통 (소수점 '.' 고정 — 대시보드 숫자 비교용)
export const fmtPct = (r: number | null | undefined, digits = 1) =>
  r == null || !Number.isFinite(r) ? '–' : `${(r * 100).toFixed(digits)}%`

// ── 액션 분리선 ─────────────────────────────────────────────
// 2026-07-28 — FYI 가짜 공고 정리와 KTC 집중 집행이 이날부터 시작됐다.
// 원래 8/1(월 경계)로 나눴지만 실제 액션은 7/28 이라 7/28~31 성과가 옛 시대에 섞여 들어갔다
// → 월 경계를 버리고 일자 경계로 교체 (2026-07-30 대표 지시).
// 집계(lib/aggregate.ts)·채널 라벨·기간 필터·비용 배분이 전부 이 상수 하나를 본다.
export const ACTION_DAY = '2026-07-28'
export const prevDay = (d: string) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
// 'YYYY-MM-DD' → '7/28' (라벨용 축약 — 전 로케일 공통)
export const fmtSlashDay = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
export const ACTION_LABEL = fmtSlashDay(ACTION_DAY) // '7/28'
export const ACTION_PREV_LABEL = fmtSlashDay(prevDay(ACTION_DAY)) // '7/27'

// 채널 성격 — 유료(게재비·광고 집행) / 자사(우리 플랫폼) / 무료(무료 게재)
const CHANNEL_KIND: Record<string, 'paid' | 'own' | 'free'> = {
  'ITviec-api': 'paid',
  'it-viec-manual': 'paid',
  'top-dev': 'paid',
  LinkedIn: 'paid',
  FYI: 'own',
  'FYI-pre': 'own',
  'FYI-post': 'own',
  'landing-page': 'own',
  'jobs-go': 'free',
  'top-cv': 'free',
  glint: 'free',
  YBOX: 'free',
  Vieclam24h: 'free',
}
export type ChannelKind = 'paid' | 'own' | 'free'
export const channelKind = (key: string): ChannelKind | null => CHANNEL_KIND[key] ?? null
