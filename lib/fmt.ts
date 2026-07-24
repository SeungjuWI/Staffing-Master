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

// 'YYYY-MM-DD' → '5월 4일' (올해가 아니면 '25년 11월 12일')
export function fmtDay(d: string, nowYear = new Date().getFullYear()): string {
  const [y, mo, day] = d.split('-').map(Number)
  return y === nowYear ? `${mo}월 ${day}일` : `${String(y).slice(2)}년 ${mo}월 ${day}일`
}

// 'YYYY-MM-DD' → '2026년 3월' (수집 시작 시점 표기)
export function fmtSinceMonth(d: string): string {
  const [y, mo] = d.split('-').map(Number)
  return `${y}년 ${mo}월`
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
// 내부 코드값은 화면에 노출 금지 — 매핑에 없는 external-* 류는 일반명으로 감춘다
export const channelLabel = (key: string) => CHANNEL_LABELS[key] || (/^external-/i.test(key) ? '외부 유입' : key)

// 채널 성격 — 유료(게재비·광고 집행) / 자사(우리 플랫폼) / 무료(무료 게재)
const CHANNEL_KIND: Record<string, 'paid' | 'own' | 'free'> = {
  'ITviec-api': 'paid',
  'top-dev': 'paid',
  LinkedIn: 'paid',
  FYI: 'own',
  'landing-page': 'own',
  'jobs-go': 'free',
  'top-cv': 'free',
  glint: 'free',
  YBOX: 'free',
  Vieclam24h: 'free',
}
export const CHANNEL_KIND_LABELS = { paid: '유료', own: '자사', free: '무료' } as const
export const channelKind = (key: string): 'paid' | 'own' | 'free' | null => CHANNEL_KIND[key] ?? null
