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

// ── 공고 직군·연차 (JD EXECUTION 원장 파생값) ───────────────
// 시트에 IT/non-IT 구분 열이 없어 Job Title 키워드로 판정한다 (2026-09-07 전수 165건 검증).
// IT = 개발·데이터·클라우드·QA 등 소프트웨어 기술 직군 — 디자인·PM·데이터 라벨링은 non-IT 로 본다.
// 짧은 토큰은 \b 필수 ('Community'가 unity 에 걸리는 오탐 실사례). pre-sales engineer 는 영업 직군.
const JD_IT_RE =
  /developer|engineer|engineering|full[\s-]?stack|front[\s-]?end|back[\s-]?end|dev\s?ops|software|firmware|embedded|game tester|app qa|qa engineer|cloud|data analy|phân tích dữ liệu|kỹ sư|\bunity\b|python|\bphp\b|\brpa\b|tech lead|machine learning|\bllm\b|lập trình|web publisher/i
const JD_NONIT_RE = /pre[\s-]?sales/i
export type JdSector = 'it' | 'nonit'
export const jdSector = (title: string): JdSector =>
  !JD_NONIT_RE.test(title) && JD_IT_RE.test(title) ? 'it' : 'nonit'

// 요구 연차(YOE Required) 원문 → 표준 토큰. 시트가 자유 텍스트라 표기가 흔들린다
// ('1 - 3'·'4–5'·'Intern / Fresher'·'K y/c kinh nghiệm' …) — UI 는 토큰만 보고 로케일별로 표기한다.
// 토큰: 'intern' | 'fresher' | 'intern-fresher' | 'any'(경력 무관) | 'manager'
//     | 'N'(딱 N년) | 'N+' | 'N-M' | 'raw:<원문>'(해석 불가 — 원문 그대로 노출) | null(빈칸)
export function normalizeYoe(raw: string): string | null {
  const v = raw.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  if (!v) return null
  const low = v.toLowerCase()
  const intern = /intern|thực tập/.test(low)
  const fresher = /fresher|entry/.test(low)
  if (intern && fresher) return 'intern-fresher'
  if (intern) return 'intern'
  if (fresher) return 'fresher'
  if (/all level|k y\/c|không yêu cầu/.test(low)) return 'any'
  if (/manager/.test(low)) return 'manager'
  let m = v.match(/^(\d+) ?\+$/)
  if (m) return `${m[1]}+`
  m = v.match(/^(\d+) ?- ?(\d+)$/)
  if (m) return `${m[1]}-${m[2]}`
  m = v.match(/^(\d+)$/)
  if (m) return m[1]
  return `raw:${v}`
}

// 연차 정렬값 — 인턴 < 신입 < 무관 < 연차 낮은순 < 매니저 < 해석 불가 < 미기재
export function yoeRank(yoe: string | null): number {
  if (yoe == null) return 900
  if (yoe === 'intern') return 0
  if (yoe === 'intern-fresher') return 1
  if (yoe === 'fresher') return 2
  if (yoe === 'any') return 3
  const m = yoe.match(/^(\d+)(?:\+| ?- ?(\d+))?$/)
  if (m) return 10 + Number(m[1]) + (m[2] ? Number(m[2]) / 100 : yoe.endsWith('+') ? 0.5 : 0)
  return yoe === 'manager' ? 800 : 850
}

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
