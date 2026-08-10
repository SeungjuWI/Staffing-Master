// i18n 코어 — 사전(ko/en/vi) + 로케일 바운드 포맷터 번들.
// 서버 컴포넌트는 getI18n(locale) 을 만들어 prop 으로 내려주고,
// 클라이언트 컴포넌트는 components/i18n-provider 의 useI18n() 으로 같은 번들을 받는다.
// (모듈 전역 locale 은 서버에서 요청 간 누수 위험이 있어 금지 — 항상 번들을 명시적으로 전달)

import { ko, type MsgKey } from './i18n/ko'
import { en } from './i18n/en'
import { vi } from './i18n/vi'
import { ACTION_LABEL, ACTION_PREV_LABEL } from './fmt'

export type Locale = 'ko' | 'en' | 'vi'
export const LANG_COOKIE = 'lang'
export const LOCALES: { value: Locale; label: string; full: string }[] = [
  { value: 'ko', label: 'KO', full: '한국어' },
  { value: 'en', label: 'EN', full: 'English' },
  { value: 'vi', label: 'VI', full: 'Tiếng Việt' },
]

export const pickLocale = (v: string | null | undefined): Locale =>
  v === 'en' || v === 'vi' ? v : 'ko'

const DICTS: Record<Locale, Record<string, string>> = { ko, en, vi }
const NUM_LOCALE: Record<Locale, string> = { ko: 'ko-KR', en: 'en-US', vi: 'vi-VN' }

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// VN(UTC+7) 기준 올해 — 서버(UTC)·보는 사람 브라우저가 어디든 연도 판정은 베트남 기준
const vnYear = () => new Date(Date.now() + 7 * 3600000).getUTCFullYear()

// 채널 키 → 사전 키 (번역이 필요한 채널만 — 나머지는 브랜드명 그대로)
const CHANNEL_MSG: Record<string, MsgKey> = {
  'it-viec-manual': 'ch.itviecManual',
  'landing-page': 'ch.landing',
  FYI: 'ch.fyi',
  'FYI-pre': 'ch.fyiPre',
  'FYI-post': 'ch.fyiPost',
  'legacy-sheet': 'ch.legacySheet',
  'Form Responses 1': 'ch.gform',
  _unattributed: 'ch.unattributed',
  '(미상)': 'ch.unknown',
}
// 번역 불필요 브랜드 표기 정규화 (원 fmt.ts CHANNEL_LABELS 의 잔여분)
const CHANNEL_BRANDS: Record<string, string> = {
  'ITviec-api': 'ITviec',
  'top-dev': 'TopDev',
  'top-cv': 'TopCV',
  'jobs-go': 'JobsGO',
  glint: 'Glints',
}

export type I18n = ReturnType<typeof getI18n>

export function getI18n(locale: Locale) {
  const dict = DICTS[locale]
  const nl = NUM_LOCALE[locale]

  // 사전에 없는 키는 ko 폴백 → 그래도 없으면 키 원문 그대로 (캐시된 옛 스냅숏의 평문 note 등 통과용)
  const t = (key: MsgKey | (string & {}), params?: Record<string, string | number>): string => {
    let s = dict[key] ?? (ko as Record<string, string>)[key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
  const has = (key: string) => key in dict || key in ko

  const fmtInt = (n: number) => n.toLocaleString(nl)

  // KRW: ko 는 만원/억원, en·vi 는 ₩K/₩M 압축 (10만원 미만은 원 단위 그대로 — CPA 비교용)
  const fmtKrw = (n: number | null | undefined): string => {
    if (n == null || !Number.isFinite(n)) return '–'
    const abs = Math.abs(n)
    if (locale === 'ko') {
      if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}억원`
      if (abs >= 1e5) return `${Math.round(n / 1e4).toLocaleString(nl)}만원`
      return `${Math.round(n).toLocaleString(nl)}원`
    }
    if (abs >= 1e8) return `₩${(n / 1e6).toLocaleString(nl, { maximumFractionDigits: 0 })}M`
    if (abs >= 1e6) return `₩${(n / 1e6).toLocaleString(nl, { maximumFractionDigits: 1 })}M`
    if (abs >= 1e5) return `₩${Math.round(n / 1e3).toLocaleString(nl)}K`
    return `₩${Math.round(n).toLocaleString(nl)}`
  }

  const fmtUsd = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) ? '–' : `$${Math.round(n).toLocaleString(nl)}`

  // '2026-07' → ko '7월' / en 'Jul' / vi 'T7'
  const fmtMonth = (m: string): string => {
    const mo = parseInt(m.split('-')[1])
    if (locale === 'ko') return `${mo}월`
    if (locale === 'en') return EN_MONTHS[mo - 1]
    return `T${mo}`
  }
  const fmtMonthFull = (m: string): string => {
    const [y, moS] = m.split('-')
    const mo = parseInt(moS)
    if (locale === 'ko') return `${y}년 ${mo}월`
    if (locale === 'en') return `${EN_MONTHS[mo - 1]} ${y}`
    return `Tháng ${mo}/${y}`
  }

  // 'YYYY-MM-DD' → ko '5월 4일' (올해 아니면 '25년 11월 12일') / en 'May 4' / vi '4/5'
  const fmtDay = (d: string, nowYear = vnYear()): string => {
    const [y, mo, day] = d.split('-').map(Number)
    if (locale === 'ko') return y === nowYear ? `${mo}월 ${day}일` : `${String(y).slice(2)}년 ${mo}월 ${day}일`
    if (locale === 'en') return y === nowYear ? `${EN_MONTHS[mo - 1]} ${day}` : `${EN_MONTHS[mo - 1]} ${day}, '${String(y).slice(2)}`
    return y === nowYear ? `${day}/${mo}` : `${day}/${mo}/${String(y).slice(2)}`
  }

  // 'YYYY-MM-DD' → 수집 시작 시점 표기 (ko '2026년 3월' / en 'Mar 2026' / vi 'tháng 3/2026')
  const fmtSinceMonth = (d: string): string => {
    const [y, mo] = d.split('-').map(Number)
    if (locale === 'ko') return `${y}년 ${mo}월`
    if (locale === 'en') return `${EN_MONTHS[mo - 1]} ${y}`
    return `tháng ${mo}/${y}`
  }

  // 절대 시각은 베트남 시간(ICT) 고정 + 라벨 — 대시보드·ATS 와 같은 기준 (스태핑 표준)
  const fmtDateTime = (iso: string): string => {
    const d = new Date(iso)
    return `${d.toLocaleString(nl, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })} (ICT)`
  }

  // 채널 키 → 화면 표기 (내부 코드값은 노출 금지 — 매핑에 없는 external-* 류는 일반명으로)
  const channelLabel = (key: string): string => {
    const msg = CHANNEL_MSG[key]
    if (msg) return t(msg, { d: key === 'FYI-pre' ? ACTION_PREV_LABEL : ACTION_LABEL })
    if (/^external-/i.test(key)) return t('ch.external')
    return CHANNEL_BRANDS[key] || key
  }

  return { locale, t, has, fmtInt, fmtKrw, fmtUsd, fmtMonth, fmtMonthFull, fmtDay, fmtSinceMonth, fmtDateTime, channelLabel }
}
