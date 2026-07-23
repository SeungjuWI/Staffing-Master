// 숫자 표기 — 대표님이 읽는 화면이므로 한국식 단위(만원/억원)로 압축한다.

export const fmtInt = (n: number) => n.toLocaleString('ko-KR')

export const fmtPct = (r: number | null | undefined, digits = 1) =>
  r == null || !Number.isFinite(r) ? '–' : `${(r * 100).toFixed(digits)}%`

// KRW: 1.2억원 / 1,420만원 / 12,621원 (10만원 미만은 원 단위 그대로 — CPA 비교용)
export function fmtKrw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–'
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}억원`
  if (abs >= 1e5) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원`
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

export const fmtUsd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '–' : `$${Math.round(n).toLocaleString('en-US')}`

// '2026-07' → '7월 (26)'
export function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  return `${parseInt(mo)}월`
}
export function fmtMonthFull(m: string): string {
  const [y, mo] = m.split('-')
  return `${y}년 ${parseInt(mo)}월`
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
}

// 채널 키 → 화면 표기
const CHANNEL_LABELS: Record<string, string> = {
  'ITviec-api': 'ITviec',
  'top-dev': 'TopDev',
  'top-cv': 'TopCV',
  'jobs-go': 'JobsGO',
  glint: 'Glints',
  'landing-page': '랜딩페이지',
  FYI: 'FYI (자체 플랫폼)',
  LinkedIn: 'LinkedIn',
  YBOX: 'YBOX',
  Vieclam24h: 'Vieclam24h',
  'legacy-sheet': '구 시트',
  'Form Responses 1': '구글폼',
  _unattributed: '미귀속 (파이프라인 외)',
  '(미상)': '채널 미상',
}
export const channelLabel = (key: string) => CHANNEL_LABELS[key] || key
