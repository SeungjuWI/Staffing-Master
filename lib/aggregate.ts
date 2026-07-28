// 스태핑 마스터 집계 — 모든 소스를 라이브로 읽어 MasterData 하나로 만든다.
//
// 구조: fetchRaw()가 원본을 한 번에 읽어 30분 캐시하고(기간·탭과 무관),
// computeFromRaw()가 캐시된 원본에서 기간별 집계를 즉석 계산한다.
// → 구글 시트 분당 읽기 쿼터를 아끼기 위해 시트는 batchGet 으로 묶고,
//   기간 필터를 바꿔도 시트를 다시 읽지 않는다.
//
// 소스 (전부 read-only):
//  - ktc-support Supabase `candidates`      → 파이프라인 퍼널·채널 귀속 (라이브)
//  - salarymap Supabase `ktc_applications`  → 지원 건 (시트 원본 재적재본)
//  - salarymap Supabase `jobs`/`job_applications` → FYI(KTC 공고) 지원자 + 베트남 매칭
//  - salarymap Supabase `user_profiles`     → FYI 인재풀 (이력서 등록/공개)
//  - Master 시트 `JD EXECUTION` → 공고 원장 (INTERVIEW 탭은 폐지된 자체 인터뷰 기록이라 미사용)
//  - KTC Ops 시트 `Employee`/`매출현황`      → 입사·재직·매출·이익
//  - 비용 시트 (통합 비교표/invoice/캠페인별/LINKEDIN) → 채널별 지출 (KRW)
//
// 집계 규칙은 salarymap pages/api/admin/ktc-jd-funnel.js 이식 + 현행 상태값 보정.

import { unstable_cache } from 'next/cache'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Channel, CompanyPerf, FunnelStage, JdRow, MasterData, MonthPoint, VietnamBlock } from './types'
import { mockData } from './mock'

const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID || '1mR1_-a3LmjxAbbox3tTKBu6WYwDbfBYKmPB6TP9EnKI'
const COST_SHEET_ID = process.env.COST_SHEET_ID || '1PEWHeAtx5nfxODQr_Db1soh-scl3Qg5Uw-fnjRziF8A'
const KTC_OPS_SHEET_ID = process.env.KTC_OPS_SHEET_ID || '1opr9KoR7KRZ31CJDNGM63xbA2rPZjPuNaG6eeLPTXjM'
// 지원자 원본 시트 (채널별 탭) — 지원 건은 여기가 진실의 원천
const CANDIDATE_SHEET_ID = process.env.CANDIDATE_DATA_SHEET_ID || '13pvv1vQ8PklkIjOfuILD5sbKZJu0CRkiaXRXxUTOp88'

const CODE_RE = /[A-Z]{2,6}\d{3,4}/g

// 스크리닝 합격 "도달" (현행 + 구 상태값)
const SCREEN_PASS = new Set([
  'passed', 'ready_to_forward', 'sent_to_company', 'interviewing', 'offer', 'final_passed',
  'ai_interview_sent', 'ai_interview_done', 'ai_interview_passed',
])
const DELIVERED = new Set(['sent_to_company', 'interviewing', 'offer', 'final_passed'])
const INTERVIEW_REACHED = new Set(['interviewing', 'offer', 'final_passed'])
const OFFER_REACHED = new Set(['offer', 'final_passed'])

// JD EXECUTION status 가 이 패턴이면 마감으로 본다 (표기가 자유 텍스트)
const CLOSED_RE = /clos|cancel|done|drop|hold|중단|마감|완료|보류|종료|취소|드롭/i

const COST_CHANNEL_MAP: Record<string, string> = {
  topdev: 'top-dev', itviec: 'ITviec-api', ybox: 'YBOX',
  glints: 'glint', linkedin: 'LinkedIn', jobsgo: 'jobs-go', topcv: 'top-cv',
}
const costChannelKey = (s: unknown) =>
  COST_CHANNEL_MAP[String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')]

const parseKrw = (s: unknown) => {
  const n = parseFloat(String(s || '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const toDate = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : null)
const normName = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

function extractJobCode(appliedJob: unknown) {
  const m = String(appliedJob || '').trim().match(/^([A-Z]{2,6}\d{3,4})/)
  return m ? m[1] : null
}

// JD 시트 Date Received(모집 시작일) — dd/mm/yyyy 와 m/d/yyyy 가 섞여 있어(실측: "22/04/2026" 과
// "7/13/2026" 공존) 양쪽 해석을 만들고, 미래 날짜를 버린 뒤 최초 지원일에 가까운 쪽을 고른다.
// 그래도 동률이면 월/일 해석 (최근 행들의 관행).
function parseReceived(raw: unknown, firstAppIso: string | null, nowMs: number): string | null {
  const s = String(raw || '').trim()
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (!m) return null
  const a = +m[1], b = +m[2], y = +m[3]
  const mk = (d: number, mo: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
  const ts = (d: string) => new Date(`${d}T00:00:00+07:00`).getTime()
  const cands = [...new Set([mk(a, b), mk(b, a)].filter((d): d is string => d != null))]
  const past = cands.filter(d => ts(d) <= nowMs + 3 * 86400000)
  const pool = past.length ? past : cands
  if (!pool.length) return null
  if (pool.length === 1) return pool[0]
  if (firstAppIso) {
    const fa = new Date(firstAppIso).getTime()
    pool.sort((d1, d2) => Math.abs(ts(d1) - fa) - Math.abs(ts(d2) - fa))
    return pool[0]
  }
  return mk(b, a) || pool[0]
}

// TO 1명당 지원 30건 = "정상선" — 입사가 성사된 공고 18건의 TO당 지원 건이
// 최소 17 ~ 중앙값 58이고 하위 사분위가 ~33건 (2026-07-28 재실측). 이보다 낮으면 지원 부족.
// (판정 재료는 화면 '지원' 열과 같은 시트 기준 지원 건 — 지원자 수 기준이던 것을 07-28 통일)
const APPS_PER_TO_FLOOR = 30
const EARLY_DAYS = 7 // 모집 시작 1주 미만은 판정 유예 (모집 초기) — 2주는 길다는 대표 피드백으로 07-28 단축
// 기업 검토 체류만 있고 입사 이력이 전무한 공고의 "무반응 정체" 경계 — 전수조사에서
// 무반응 공고의 모집 주차가 2~4주와 8~12주로 갈라져(중간 공백) 6주를 경계로 삼음 (2026-07-28)
const NO_RESPONSE_DAYS = 42

// VN(UTC+7) 기준 YYYY-MM
const toVNMonth = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 7)

// 월별 카운트 맵 → 연속 월 축 (파싱 오류로 생긴 미래 월 제거, 빈 월 0 채움, 최대 12개월)
function toMonthSeries(byMonth: Record<string, number>, nowMonth: string): MonthPoint[] {
  const valid = Object.keys(byMonth).filter(m => m <= nowMonth).sort()
  if (!valid.length) return []
  const addMonths = (m: string, delta: number) => {
    const [y, mo] = m.split('-').map(Number)
    const t = y * 12 + (mo - 1) + delta
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
  }
  const first = valid[0] > addMonths(nowMonth, -11) ? valid[0] : addMonths(nowMonth, -11)
  const out: MonthPoint[] = []
  for (let m = first; m <= nowMonth; m = addMonths(m, 1)) out.push({ month: m, count: byMonth[m] || 0 })
  return out
}

// 탭별 날짜 포맷 파싱 (ktcCandidatesSync 이식) — 미국식 m/d 는 LinkedIn·구글폼 계열만
const MONTH_FIRST_TABS = new Set(['LinkedIn', 'Form Responses 1', 'legacy-sheet'])
function parseAppliedAt(raw: unknown, sheetSource: string): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  let y = 0, mo = 0, d = 0, h = 0, mi = 0
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/))) {
    y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0)
  } else if ((m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})? (\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) {
    h = +m[1]; mi = +m[2]; d = +m[3]; mo = +m[4]; y = +m[5]
  } else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/))) {
    const a = +m[1], b = +m[2]
    y = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0)
    let dayFirst = !MONTH_FIRST_TABS.has(sheetSource)
    if (a > 12) dayFirst = true
    else if (b > 12) dayFirst = false
    ;[d, mo] = dayFirst ? [a, b] : [b, a]
  } else return null
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+07:00`
}

// ── CANDIDATE DATA 시트 파싱 (지원 건) ──────────────────────
// 탭별 헤더 힌트 (2026-07-27 실측) — 명시 힌트가 없거나 헤더가 바뀌면 정규식 폴백으로 해석.
// FYI 탭은 salarymap DB 라이브가 정답이라 제외, Form Responses 1 은 기존 집계 관행대로 제외.
const APP_SKIP_TABS = new Set(['log', 'FYI', 'Form Responses 1'])
const APP_COL_HINTS: Record<string, { email?: string; name?: string; job?: string; code?: string; date?: string }> = {
  'landing-page': { email: 'Email', name: 'Họ & Tên', job: 'Applied Job', code: 'Job ID', date: 'Ngày nộp' },
  'ITviec-api': { email: 'Email', name: 'Họ & Tên', job: 'Job Title', code: 'Job ID', date: 'Ngày nộp' },
  'top-dev': { email: 'Candidate Email', name: 'Candidate Fullname', job: 'Job title', date: 'Applied date' },
  'jobs-go': { email: 'Email', name: 'Họ tên', job: 'Applied Job', date: 'Thời gian' },
  'top-cv': { email: 'Email', name: 'Họ Tên', date: 'Ngày tiếp nhận' },
  'it-viec-manual': { email: 'Email', name: 'Name', job: 'Job', date: 'Submitted time' },
}
const APP_COL_FALLBACK_RE = {
  email: /^e-?mail$/i,
  name: /name|họ|tên/i,
  job: /applied\s*job|job\s*title|^job$|vị trí/i,
  code: /job\s*id/i,
  date: /ngày nộp|applied\s*date|date submitted|thời gian|submitted|ngày/i,
} as const

function parseAppSheet(tab: string, rows: any[][]): any[] {
  if (!rows.length) return []
  const hint = APP_COL_HINTS[tab] || {}
  const H = rows[0].map((c: any) => String(c || '').replace(/\n/g, ' ').trim())
  const col = (key: keyof typeof APP_COL_FALLBACK_RE) => {
    if (hint[key]) {
      const i = H.indexOf(hint[key]!)
      if (i >= 0) return i
    }
    return H.findIndex(h => APP_COL_FALLBACK_RE[key].test(h))
  }
  const ci = { email: col('email'), name: col('name'), job: col('job'), code: col('code'), date: col('date') }
  const out: any[] = []
  for (const r of rows.slice(1)) {
    const name = ci.name >= 0 ? String(r[ci.name] || '').trim() : ''
    const email = ci.email >= 0 ? String(r[ci.email] || '').trim() : ''
    if (!name && !email) continue // 빈 행·집계 행
    const jobText = ci.job >= 0 ? String(r[ci.job] || '').trim() : ''
    const codeRaw = ci.code >= 0 ? String(r[ci.code] || '').trim() : ''
    out.push({
      sheet_source: tab,
      email: email || null,
      applied_job: jobText || null,
      job_code: extractJobCode(codeRaw) || extractJobCode(jobText),
      applied_at: ci.date >= 0 ? parseAppliedAt(r[ci.date], tab) : null,
    })
  }
  return out
}

async function fetchAll<T>(sb: SupabaseClient, table: string, select: string, tweak?: (q: any) => any): Promise<T[]> {
  let all: T[] = []
  for (let offset = 0; ; offset += 1000) {
    let q: any = sb.from(table).select(select).range(offset, offset + 999)
    if (tweak) q = tweak(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
  }
  return all
}

export function hasLiveEnv() {
  return Boolean(
    process.env.KTC_SUPABASE_URL && process.env.KTC_SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SALARYMAP_SUPABASE_URL && process.env.SALARYMAP_SUPABASE_SERVICE_ROLE_KEY,
  )
}

export type Period = 'all' | 'month' | '30d'

type CostData = {
  spendByChannel: Record<string, number>
  postedByChannel: Record<string, number>
  ktcMeta: number
  fyiKtcMeta: number
}

type Raw = {
  warnings: string[]
  candidates: any[]
  applications: any[]
  resumeCount: number
  publicCount: number
  jdSheet: any[][]
  empSheet: any[][]
  revSheet: any[][]
  toSheet: any[][]
  fyiApps: any[]
  fyiJobById: Record<string, { title: string; company: string; sourceId: string }> // FYI 공고 id → 제목·회사·공고코드(source_id)
  vnJobs: any[]
  vnApps: any[]
  cost: CostData | null
  fetchedAt: number
}

// ── 원본 로드 (기간·탭 무관, 30분 캐시) ─────────────────────
async function fetchRaw(): Promise<Raw> {
  const warnings: string[] = []
  const ktc = createClient(process.env.KTC_SUPABASE_URL!, process.env.KTC_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const fyi = createClient(process.env.SALARYMAP_SUPABASE_URL!, process.env.SALARYMAP_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let sheets: any = null
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const { google } = await import('googleapis')
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    sheets = google.sheets({ version: 'v4', auth })
  } else {
    warnings.push('GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY 미설정 — 공고·면접·입사·비용 지표 제외')
  }

  const grab = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch (e: any) { warnings.push(`${label}: ${e.message}`); return fallback }
  }
  // 한 스프레드시트의 여러 범위를 요청 1개로 (분당 읽기 쿼터 절약)
  const batchGet = async (spreadsheetId: string, ranges: string[]): Promise<any[][][]> => {
    if (!sheets) return ranges.map(() => [])
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
    return (res.data.valueRanges || []).map((v: any) => v.values || [])
  }

  // 모든 원본 로드는 서로 독립적 → promise 를 먼저 전부 띄우고(아래) 한 번에 await 한다.
  // (기존엔 FYI 지원·베트남·비용이 순차 await 라 콜드 fetch 시간이 합산됐다 → 이제 임계경로 = 가장 느린 1개)
  const pCandidates = grab('파이프라인(candidates)', () => fetchAll<any>(ktc, 'candidates', 'full_name, sheet_source, email, applied_job, applied_date, pipeline_status'), [])
  // 지원 건 = CANDIDATE DATA 시트 직접 (원본). 기존엔 salarymap ktc_applications(재적재본)를
  // 읽었는데, 동기화 크론이 죽자 5일치 지원이 조용히 빠졌다(2026-07-27, GB3001 시트 9 vs DB 6).
  // 시트가 진실의 원천이므로 직접 읽고, 크레덴셜 없거나 시트 읽기 실패 시에만 재적재본 폴백.
  const pApplications = grab('지원 건(CANDIDATE DATA 시트)', async () => {
    if (sheets) {
      try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: CANDIDATE_SHEET_ID })
        const tabs: string[] = (meta.data.sheets || [])
          .map((s: any) => s.properties?.title || '')
          .filter((t: string) => t && !APP_SKIP_TABS.has(t))
        const values = await batchGet(CANDIDATE_SHEET_ID, tabs.map(t => `'${t}'!A1:Z`))
        return tabs.flatMap((t, i) => parseAppSheet(t, values[i] || []))
      } catch (e: any) {
        warnings.push(`CANDIDATE DATA 시트 읽기 실패(${e.message}) — 지원 건은 재적재본(DB)으로 폴백`)
      }
    }
    return fetchAll<any>(fyi, 'ktc_applications', 'sheet_source, job_code, applied_at, email')
  }, [])
  const pResume = grab('인재풀(이력서)', async () => {
    const { count, error } = await fyi.from('user_profiles').select('id', { count: 'exact', head: true }).not('resume_url', 'is', null)
    if (error) throw new Error(error.message)
    return count || 0
  }, 0)
  const pPublic = grab('인재풀(공개)', async () => {
    const { count, error } = await fyi.from('user_profiles').select('id', { count: 'exact', head: true }).not('resume_url', 'is', null).eq('is_resume_public', true)
    if (error) throw new Error(error.message)
    return count || 0
  }, 0)
  // INTERVIEW 탭은 더 이상 읽지 않는다 — 폐지된 자체 폰 인터뷰 기록이라 면접 집계에서 제외 (2026-07-28)
  const pMaster = grab('Master 시트(공고)', () => batchGet(MASTER_SHEET_ID, ["'JD EXECUTION'!A1:N"]), [[]])
  // TO_Table_수정 = TO 단위 원장 (TO 1개당 1행, 현재 상태 매칭/진행중/이탈). 운영이 관리하는 정본이라
  // TO·충원은 이걸 따른다 — JD EXECUTION 의 Headcount 열은 갱신이 밀려 11건이 어긋나 있었다 (2026-07-28)
  const pOps = grab('KTC Ops 시트(입사·매출·TO)', () => batchGet(KTC_OPS_SHEET_ID, ["'Employee'!A1:T", "'매출현황'!A1:N", "'TO_Table_수정'!A1:R"]), [[], [], []])

  // FYI(KTC 공고) 지원자 — salarymap 라이브. 공고 제목도 함께 가져와 공고별 귀속에 쓴다
  // (FYI 직접 지원은 시트 탭에 없어서, 제목 매칭 없이는 공고별 '지원'에서 통째로 빠진다 —
  //  실사례: FPT403이 FYI 지원 16건을 받고도 대시보드에 0건으로 떠서 대표가 오판할 뻔함, 2026-07-28)
  const pFyiApps = grab('FYI 지원', async () => {
    const jobs = await fetchAll<any>(fyi, 'jobs', 'id, title, company, source_id', q => q.eq('source', 'ktc'))
    const byId: Record<string, { title: string; company: string; sourceId: string }> = {}
    for (const j of jobs) byId[j.id] = { title: String(j.title || ''), company: String(j.company || ''), sourceId: String(j.source_id || '') }
    const ids = jobs.map(j => j.id)
    let apps: any[] = []
    for (let i = 0; i < ids.length; i += 50) {
      apps = apps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email, created_at, job_id', q => q.in('job_id', ids.slice(i, i + 50))))
    }
    return {
      fyiApps: apps.filter(a => a.applicant_email && !String(a.applicant_email).toLowerCase().endsWith('@likelion.net')),
      fyiJobById: byId,
    }
  }, { fyiApps: [] as any[], fyiJobById: {} as Record<string, { title: string; company: string; sourceId: string }> })

  // 베트남 매칭 트랙 (FYI 자체 공고 — ktc-support 미경유)
  const pVn = grab('베트남 매칭(FYI 자체 공고)', async () => {
    const jobs = await fetchAll<any>(fyi, 'jobs', 'id, company, is_active', q => q.eq('source', 'company_self'))
    const ids = jobs.map(j => j.id)
    let apps: any[] = []
    for (let i = 0; i < ids.length; i += 50) {
      apps = apps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email, viewed_at, created_at', q => q.in('job_id', ids.slice(i, i + 50))))
    }
    apps = apps.filter(a => !String(a.applicant_email || '').toLowerCase().endsWith('@likelion.net'))
    return { vnJobs: jobs, vnApps: apps }
  }, { vnJobs: [], vnApps: [] })

  // 채널별 지출 (비용 시트) — 실패해도 나머지는 정상
  const pCost: Promise<CostData | null> = sheets ? grab<CostData | null>('비용 시트', async () => {
    // 환율은 외부 API(open.er-api.com) — 시트 읽기와 겹쳐 미리 띄워 임계경로에서 뺀다
    const fxPromise = fetch('https://open.er-api.com/v6/latest/VND', { signal: AbortSignal.timeout(4000) })
      .then(r => r.json()).then((j: any) => (j?.rates?.KRW > 0 ? (j.rates.KRW as number) : null)).catch(() => null)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: COST_SHEET_ID })
    const tabs = (meta.data.sheets || []).map((s: any) => s.properties.title)
    const findTab = (kw: string) => tabs.find((t: string) => t.toLowerCase().includes(kw.toLowerCase()))
    const cmpTab = findTab('통합 비교표'), metaTab = findTab('캠페인별'), invTab = findTab('invoice')
    if (!cmpTab || !metaTab || !invTab) throw new Error(`탭 탐지 실패 (비교표:${cmpTab} 캠페인:${metaTab} 인보이스:${invTab})`)
    const liTab = tabs.find((t: string) => t.toUpperCase().includes('LINKEDIN'))
    const sumTab = findTab('campaign-summary') // 12. meta-campaign-summary — 캠페인 분류 원장
    const ranges = [`'${cmpTab}'!A1:M15`, `'${metaTab}'!A1:H60`, `'${invTab}'!A1:S30`]
    const liIdx = liTab ? ranges.push(`'${liTab}'!A1:N120`) - 1 : -1
    const sumIdx = sumTab ? ranges.push(`'${sumTab}'!A1:M60`) - 1 : -1
    const got = await batchGet(COST_SHEET_ID, ranges)
    const [cmpRows, metaRows, invRows] = got
    const liRows = liIdx >= 0 ? got[liIdx] : []
    const sumRows = sumIdx >= 0 ? got[sumIdx] : []

    const hIdx = cmpRows.findIndex((r: any[]) => r.some(c => String(c || '').trim() === '채널') && r.some(c => String(c || '').startsWith('지출')))
    const spendByChannel: Record<string, number> = {}
    const postedByChannel: Record<string, number> = {}
    if (hIdx >= 0) {
      const H = cmpRows[hIdx]
      const chanCol = H.findIndex((c: any) => String(c || '').trim() === '채널')
      let spendCol = H.findIndex((c: any) => String(c || '').startsWith('지출'))
      const subCostCol = (cmpRows[hIdx + 1] || []).findIndex((c: any) => String(c || '').includes('비용'))
      if (subCostCol >= 0) spendCol = subCostCol
      const postedCol = H.findIndex((c: any) => String(c || '').includes('공고수'))
      for (const r of cmpRows.slice(hIdx + 1)) {
        const key = costChannelKey(r[chanCol])
        if (!key) continue
        const spend = parseKrw(r[spendCol])
        if (spend != null) spendByChannel[key] = spend
        if (postedCol >= 0) {
          const posted = parseInt(String(r[postedCol] || '').replace(/[^0-9]/g, ''))
          if (Number.isFinite(posted)) postedByChannel[key] = posted
        }
      }
    }
    // VND→KRW 환율 (라이브 → 인보이스 유도 → 상수) — 위에서 미리 띄운 fxPromise 수확
    let vndToKrw: number | null = await fxPromise
    const invH = invRows.findIndex((r: any[]) => r.some(c => String(c || '').startsWith('합계')))
    const invoiceVnd: Record<string, number> = {}
    if (invH >= 0) {
      const IH = invRows[invH]
      const krwCol = IH.findIndex((c: any) => String(c || '').includes('KRW'))
      const sumCol = IH.findIndex((c: any) => String(c || '').startsWith('합계'))
      const platCol = sumCol - 2
      for (const r of invRows.slice(invH + 1)) {
        if (!String(r[platCol] || '').trim()) break
        const key = costChannelKey(r[platCol])
        const vnd = parseKrw(r[sumCol])
        const m = String(r[krwCol] || '').match(/([\d,.]+)\s*만원/)
        if (vnd && vnd > 0 && m && vndToKrw == null) vndToKrw = (parseFloat(m[1].replace(/,/g, '')) * 10000) / vnd
        if (key && vnd && vnd > 0) invoiceVnd[key] = vnd
      }
    }
    if (vndToKrw == null) vndToKrw = 0.054
    const INVOICE_VAT: Record<string, number> = { 'ITviec-api': 1.08, 'top-dev': 1.08, LinkedIn: 1.1 }
    for (const [key, vnd] of Object.entries(invoiceVnd)) {
      spendByChannel[key] = (vnd / (INVOICE_VAT[key] || 1.1)) * vndToKrw
    }
    // LinkedIn: KTC 공고코드 슬롯만 (자사 채용 슬롯 제외)
    if (liRows && liRows.length) {
      const liH = liRows.findIndex((r: any[]) => r.includes('Job code') && r.some(c => String(c || '').startsWith('Cost')))
      if (liH >= 0) {
        const LH = liRows[liH]
        const costCol = LH.findIndex((c: any) => String(c || '').startsWith('Cost'))
        const codeCol = LH.indexOf('Job code')
        let ktcVnd = 0
        const liCodes = new Set<string>()
        for (const r of liRows.slice(liH + 1)) {
          const code = (String(r[codeCol] || '').trim().match(/^[A-Z]{2,6}\d{3,4}/) || [])[0]
          if (!code) continue
          const c = parseKrw(r[costCol])
          if (c != null) { ktcVnd += c; liCodes.add(code) }
        }
        if (ktcVnd > 0) {
          spendByChannel.LinkedIn = ktcVnd * vndToKrw
          if (postedByChannel.LinkedIn == null) postedByChannel.LinkedIn = liCodes.size
        }
      }
    }
    // Meta 광고비 분해 — 채용 마케팅비 포함 여부의 진실 원천은 12. meta-campaign-summary 탭의
    // 'Recruiting for KTC'(yes/no) 열 (2026-07-28 Alice 확인: 행사 캠페인 Mentoring·Hackathon·July-Event
    // 는 KTC 지원자 모집 목적 = 포함, Launch-App 앱 설치는 제외). 원장에 아직 없는 신규 캠페인은
    // 이름 규칙(KTC* 또는 FYI_*KTC*)으로 폴백. 채널 배분은 이름 접두: FYI_* = FYI 경유, 그 외 = 랜딩.
    // 캠페인명이 탭마다 달라(…_MT-lead_·_bud:aso 접미 유무) "앞 두 세그먼트 + 최장 숫자열" 키로 맞춘다.
    const campaignKey = (s: string) => {
      const segs = s.split('_').map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''))
      const digits = (s.match(/\d+/g) || []).sort((a, b) => b.length - a.length)[0] || ''
      return `${(segs[0] || '') + (segs[1] || '')}|${digits}`
    }
    const ktcRecruitByKey: Record<string, boolean> = {}
    const sIdx = sumRows.findIndex((r: any[]) => r.some(c => String(c || '').trim() === 'Campaign') && r.some(c => /^recruiting/i.test(String(c || '').trim())))
    if (sIdx >= 0) {
      const SH = sumRows[sIdx]
      const sNameCol = SH.findIndex((c: any) => String(c || '').trim() === 'Campaign')
      const sFlagCol = SH.findIndex((c: any) => /^recruiting/i.test(String(c || '').trim()))
      for (const r of sumRows.slice(sIdx + 1)) {
        const name = String(r[sNameCol] || '').trim()
        const flag = String(r[sFlagCol] || '').trim().toLowerCase()
        if (!name || name === 'TOTAL' || (flag !== 'yes' && flag !== 'no')) continue
        ktcRecruitByKey[campaignKey(name)] = flag === 'yes'
      }
    }
    let ktcMeta = 0, fyiKtcMeta = 0
    const mIdx = metaRows.findIndex((r: any[]) => r.some(c => String(c || '').trim() === 'Campaign') && r.some(c => String(c || '').startsWith('Spend')))
    if (mIdx >= 0) {
      const MH = metaRows[mIdx]
      const mNameCol = MH.findIndex((c: any) => String(c || '').trim() === 'Campaign')
      const mSpendCol = MH.findIndex((c: any) => String(c || '').startsWith('Spend'))
      for (const r of metaRows.slice(mIdx + 1)) {
        const name = String(r[mNameCol] || '').trim()
        const spend = parseKrw(r[mSpendCol])
        if (!name || spend == null) continue
        const ledger = ktcRecruitByKey[campaignKey(name)]
        const isRecruit = ledger != null ? ledger : /^ktc/i.test(name) || (/^fyi/i.test(name) && /ktc/i.test(name))
        if (!isRecruit) continue
        if (/^fyi/i.test(name)) fyiKtcMeta += spend
        else ktcMeta += spend
      }
    }
    return { spendByChannel, postedByChannel, ktcMeta, fyiKtcMeta }
  }, null) : Promise.resolve<CostData | null>(null)

  // 위에서 띄운 promise 를 전부 한 번에 대기 (콜드 fetch = 가장 느린 1개 시간)
  const [candidates, applications, resumeCount, publicCount, master, ops, fyiWrap, vn, cost] =
    await Promise.all([pCandidates, pApplications, pResume, pPublic, pMaster, pOps, pFyiApps, pVn, pCost])
  const [jdSheet] = master
  const [empSheet, revSheet, toSheet] = ops
  const { fyiApps, fyiJobById } = fyiWrap
  const { vnJobs, vnApps } = vn

  // 파이프라인 동기화 지연 감지 — 시트(지원 원본)에는 있는데 candidates 가 못 따라오면
  // 스크리닝~입사 단계 숫자가 조용히 옛것이 된다. 날짜 파싱 오류로 생긴 미래 값은 배제(+1일 여유).
  const nowIso = new Date(Date.now() + 86400000).toISOString()
  const maxIso = (vals: (string | null)[]) => vals.reduce<string>((m, v) => (v && v <= nowIso && v > m ? v : m), '')
  const candMax = maxIso(candidates.map((c: any) => parseAppliedAt(c.applied_date, c.sheet_source)))
  const appMax = maxIso(applications.map((a: any) => a.applied_at))
  if (candMax && appMax) {
    const lagDays = (new Date(appMax).getTime() - new Date(candMax).getTime()) / 86400000
    if (lagDays > 3) {
      warnings.push(
        `파이프라인 동기화가 지원 시트보다 ${Math.floor(lagDays)}일 뒤처져 있습니다 (시트 최신 지원 ${appMax.slice(0, 10)} vs 파이프라인 ${candMax.slice(0, 10)}) — 스크리닝~입사 단계 숫자에 최신 지원이 아직 없음, ktc-support 동기화 점검 필요`,
      )
    }
  }

  return { warnings, candidates, applications, resumeCount, publicCount, jdSheet, empSheet, revSheet, toSheet, fyiApps, fyiJobById, vnJobs, vnApps, cost, fetchedAt: Date.now() }
}

type ChanAcc = {
  key: string; people: number; applications: number; docPass: number
  interviews: number; hires: number
  jobsPosted: number | null; spendFees: number | null; spendAds: number | null
}

// ── 기간별 집계 (캐시된 원본에서 동기 계산 — 시트 재요청 없음) ──
function computeFromRaw(raw: Raw, period: Period, fetchedAt: number): MasterData {
  const { candidates, applications, fyiApps, jdSheet, empSheet, revSheet, toSheet } = raw

  // 기간 필터 — "지원일 코호트": 해당 기간에 지원한 인재의 현재 도달 단계.
  // 스톡 지표(입사 누적·재직·매출·인재풀·오픈 공고)와 비용(시간 축 없음)은 항상 누적.
  const start: number | null =
    period === 'month' ? new Date(`${toVNMonth(new Date().toISOString())}-01T00:00:00+07:00`).getTime()
    : period === '30d' ? Date.now() - 30 * 86400000
    : null
  const inPeriod = (iso: string | null) => start == null || (iso != null && new Date(iso).getTime() >= start)

  const fyiEmails = new Set(fyiApps.map(a => String(a.applicant_email).toLowerCase()))

  // 베트남 매칭 (지원 지표만 기간 적용, 공고·기업은 스톡)
  const vnInP = raw.vnApps.filter(a => inPeriod(a.created_at))
  const vietnam: VietnamBlock = {
    jobsTotal: raw.vnJobs.length,
    jobsActive: raw.vnJobs.filter(j => j.is_active).length,
    companies: new Set(raw.vnJobs.map(j => String(j.company || '').trim().toLowerCase()).filter(Boolean)).size,
    applications: vnInP.length,
    applicants: new Set(vnInP.map(a => String(a.applicant_email || '').toLowerCase()).filter(Boolean)).size,
    viewed: vnInP.filter(a => a.viewed_at).length,
  }

  // ── 공고 원장 헤더 해석 (공고 귀속 맵에 먼저 필요해서 여기서) ──
  // 열 위치는 헤더 이름으로 찾는다 — 시트에 열이 추가/삭제돼도 안 깨지게(Employee 파싱과 동일 방식).
  // 과거 인덱스 하드코딩(상태=11·인원=8) 탓에 컬럼이 밀리자 마감 공고가 계속 "진행 중"으로 남던 버그가 있었음.
  // 헤더/열을 못 찾으면 실측 인덱스로 폴백. 헤더행은 "Job ID" 가 있는 행으로 탐지.
  const jdHeaderIdx = jdSheet.findIndex((r: any[]) => r.some((c: any) => /job\s*id/i.test(String(c || ''))))
  const jdH: any[] = jdHeaderIdx >= 0 ? jdSheet[jdHeaderIdx] : []
  const jdCol = (re: RegExp, fallback: number) => {
    const i = jdH.findIndex((c: any) => re.test(String(c || '').replace(/\n/g, ' ').trim()))
    return i >= 0 ? i : fallback
  }
  const JC = {
    code: jdCol(/job\s*id/i, 0),
    company: jdCol(/company/i, 1),
    title: jdCol(/job\s*title/i, 2),
    headcount: jdCol(/headcount/i, 6),
    received: jdCol(/date\s*received/i, 7),
    status: jdCol(/job\s*status/i, 9),
  }
  const jdDataRows = jdHeaderIdx >= 0 ? jdSheet.slice(jdHeaderIdx + 1) : jdSheet.slice(3)

  // ── 공고 귀속 리졸버 ──────────────────────────────────────
  // 랜딩페이지 지원은 applied_job 에 코드 없이 제목만 남는 실사례(GB3001 전원)가 있어,
  // 앞머리 코드 추출만으로는 683건(13%)이 공고 미귀속 → 공고별 지원 수가 0 으로 깨진다 (2026-07-27 발견).
  // 폴백 순서: ① 앞머리 코드 ② 문자열 어딘가의 코드("• [MT702] …" 류 — 시트에 있는 공고만 인정)
  // ③ JD 시트 제목 정확 일치 (유니크 제목만 — "Full-stack Developer" 처럼 중복 제목은 매칭 금지)
  // ④ 지원 건(ktc_applications)의 이메일 → 단일 공고 코드
  const sheetCodes = new Set<string>()
  const titleToCode: Record<string, string | null> = {}
  for (const r of jdDataRows) {
    const code = String(r[JC.code] || '').trim()
    if (!code) continue
    sheetCodes.add(code)
    const t = normName(r[JC.title])
    if (t) titleToCode[t] = titleToCode[t] === undefined ? code : null
  }
  const emailToCodes: Record<string, Set<string>> = {}
  for (const a of applications) {
    const e = String(a.email || '').toLowerCase().trim()
    if (!e || !a.job_code) continue
    ;(emailToCodes[e] = emailToCodes[e] || new Set()).add(a.job_code)
  }
  const codeForCandidate = (c: any): string | null => {
    const direct = extractJobCode(c.applied_job)
    if (direct) return direct
    const anywhere = (String(c.applied_job || '').match(CODE_RE) || []).find(k => sheetCodes.has(k))
    if (anywhere) return anywhere
    const byTitle = titleToCode[normName(c.applied_job)]
    if (byTitle) return byTitle
    const ec = emailToCodes[String(c.email || '').toLowerCase().trim()]
    if (ec && ec.size === 1) {
      const k: string = ec.values().next().value!
      if (sheetCodes.has(k)) return k
    }
    return null
  }

  // ── 전체 패스 (기간 무관): 진행 중 스냅샷·귀속 맵·누적 입사 ──
  // 공고 판정용 누적치도 여기서 — 기간 보기에서도 판정은 스톡(현재 상태·누적 지원자) 기준.
  const chanByEmailAll: Record<string, string> = {}
  const statusCount: Record<string, number> = {}
  const perJdAll: Record<string, { people: number; apps: number; cur: Record<string, number>; firstApp: string | null; lastApp: string | null }> = {}
  const jdAll = (code: string) => perJdAll[code] || (perJdAll[code] = { people: 0, apps: 0, cur: {}, firstApp: null, lastApp: null })
  // 최근 지원일 판정용 상한 — 날짜 파싱 오류로 생긴 미래 값 배제 (+1일 여유)
  const lastAppCap = new Date(fetchedAt + 86400000).toISOString()
  let finalPassedAll = 0
  for (const c of candidates) {
    const e = String(c.email || '').toLowerCase()
    const st = c.pipeline_status || 'new'
    statusCount[st] = (statusCount[st] || 0) + 1
    if (st === 'final_passed') finalPassedAll++
    if (e && !chanByEmailAll[e]) chanByEmailAll[e] = c.sheet_source || '(미상)'
    const code = codeForCandidate(c)
    if (code) {
      const j = jdAll(code)
      j.people++
      j.cur[st] = (j.cur[st] || 0) + 1
      const at = parseAppliedAt(c.applied_date, c.sheet_source)
      if (at && (!j.firstApp || at < j.firstApp)) j.firstApp = at
    }
  }
  const channelForEmailAll = (e: string) => chanByEmailAll[e] || (fyiEmails.has(e) ? 'FYI' : null)

  // ── 코호트 패스 (기간 적용): 퍼널·채널·공고별 ────────────────
  const periodCandidates = start == null
    ? candidates
    : candidates.filter(c => inPeriod(parseAppliedAt(c.applied_date, c.sheet_source)))
  const cohortEmails = new Set(periodCandidates.map(c => String(c.email || '').toLowerCase()).filter(Boolean))
  const fyiEmailsPeriod = start == null
    ? fyiEmails
    : new Set(fyiApps.filter(a => inPeriod(a.created_at)).map(a => String(a.applicant_email).toLowerCase()))

  const chan: Record<string, ChanAcc> = {}
  const bump = (key: string, field: 'people' | 'applications' | 'docPass' | 'interviews' | 'hires') => {
    const c = chan[key] || (chan[key] = { key, people: 0, applications: 0, docPass: 0, interviews: 0, hires: 0, jobsPosted: null, spendFees: null, spendAds: null })
    c[field]++
  }
  const perJd: Record<string, { people: number; docPass: number; delivered: number; offer: number; hires: number; interviews: number; apps: number; appsFyi: number; chan: Record<string, number> }> = {}
  const jd = (code: string) => perJd[code] || (perJd[code] = { people: 0, docPass: 0, delivered: 0, offer: 0, hires: 0, interviews: 0, apps: 0, appsFyi: 0, chan: {} })
  let screenPass = 0, delivered = 0, interviewPipe = 0, offerReached = 0, finalPassed = 0

  for (const c of periodCandidates) {
    const ch = c.sheet_source || '(미상)'
    const code = codeForCandidate(c)
    const st = c.pipeline_status || 'new'
    bump(ch, 'people')
    if (SCREEN_PASS.has(st)) { bump(ch, 'docPass'); screenPass++ }
    if (DELIVERED.has(st)) delivered++
    if (INTERVIEW_REACHED.has(st)) { interviewPipe++; bump(ch, 'interviews') }
    if (OFFER_REACHED.has(st)) offerReached++
    if (st === 'final_passed') { finalPassed++; bump(ch, 'hires') }
    if (code) {
      const j = jd(code)
      j.people++
      if (SCREEN_PASS.has(st)) j.docPass++
      if (DELIVERED.has(st)) j.delivered++
      if (INTERVIEW_REACHED.has(st)) j.interviews++
      if (OFFER_REACHED.has(st)) j.offer++
      if (st === 'final_passed') j.hires++
    }
  }

  // FYI 채널 지원자는 salarymap 라이브가 정답 (파이프라인 유입분보다 넓다)
  if (fyiEmailsPeriod.size) {
    const c = chan.FYI || (chan.FYI = { key: 'FYI', people: 0, applications: 0, docPass: 0, interviews: 0, hires: 0, jobsPosted: null, spendFees: null, spendAds: null })
    c.people = Math.max(c.people, fyiEmailsPeriod.size)
  }

  // ── 지원 건 (ktc_applications + FYI 라이브) ────────────────
  // 월별 추이는 기간 필터와 무관하게 전체 시계열 유지
  const monthly: Record<string, number> = {}
  let applicationsTotal = 0
  for (const a of applications) {
    if (a.applied_at) monthly[toVNMonth(a.applied_at)] = (monthly[toVNMonth(a.applied_at)] || 0) + 1
    if (a.job_code) {
      const j = jdAll(a.job_code)
      j.apps++ // 스톡 지원 건 — 지원 부족 판정 재료 (기간 필터 무관)
      if (a.applied_at && (!j.firstApp || a.applied_at < j.firstApp)) j.firstApp = a.applied_at
      if (a.applied_at && a.applied_at <= lastAppCap && (!j.lastApp || a.applied_at > j.lastApp)) j.lastApp = a.applied_at
    }
    if (!inPeriod(a.applied_at)) continue
    bump(a.sheet_source || '(미상)', 'applications')
    applicationsTotal++
    if (a.job_code) {
      const j = jd(a.job_code)
      j.apps++
      const ch = a.sheet_source || '(미상)'
      j.chan[ch] = (j.chan[ch] || 0) + 1
    }
  }
  // FYI 직접 지원의 공고 귀속 — 시트 탭엔 없는 지원이라 귀속 없이는 공고별 '지원'에서 통째로 빠진다.
  // ① jobs.source_id 의 앞머리 공고코드 (salarymap ktc-sync 크론이 원장과 매칭해 기록,
  //    재게시 중복은 "OQ901#2" 형태 — 2026-07-28 백필 완료, 이게 정본 경로)
  // ② 아직 코드가 없는 신규 공고 폴백: 제목 유니크 정확 일치(회사 어긋나면 기각 — 원장에 없는
  //    회사의 동명 공고가 남의 코드에 붙던 실사례 방지) → 회사 매칭 후 제목 유사
  //    (괄호·" - " 접미 제거 정확/포함 → 앞 3단어). FYI 표기가 원장의 변형인 실사례가 많다
  //    (FPT Software Korea vs Fptsoftware, "TikTok Ads Marketing Specialist" vs "... Manager").
  const aln = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const simp = (s: unknown) => normName(String(s || '').replace(/\([^)]*\)/g, ' ').split(' - ')[0])
  const jdIndex: { code: string; comp: string; title: string }[] = []
  for (const r of jdDataRows) {
    const code = String(r[JC.code] || '').trim()
    if (!code) continue
    jdIndex.push({ code, comp: aln(r[JC.company]), title: simp(r[JC.title]) })
  }
  const fyiCodeCache: Record<string, string | null> = {}
  const fyiCodeForJob = (jobId: string): string | null => {
    if (jobId in fyiCodeCache) return fyiCodeCache[jobId]
    const job = raw.fyiJobById[jobId]
    let code: string | null = null
    if (job) {
      const jc = aln(job.company)
      const compMatch = (c: string) =>
        c === jc || (c.length >= 4 && jc.length >= 4 && (c.includes(jc) || jc.includes(c)))
      code = (job.sourceId.match(/^([A-Z]{2,6}\d{3,4})/) || [])[1] || null
      if (!code) {
        const exact = titleToCode[normName(job.title)]
        if (exact) {
          const owner = jdIndex.find(x => x.code === exact)
          if (!jc || !owner?.comp || compMatch(owner.comp)) code = exact
        }
      }
      if (!code) {
        const jt = simp(job.title)
        const cands = jdIndex.filter(x => x.comp && jc && compMatch(x.comp))
        const strong = cands.filter(x => x.title === jt || (jt && (x.title.includes(jt) || jt.includes(x.title))))
        const p3 = (s: string) => s.split(' ').slice(0, 3).join(' ')
        const weak = cands.filter(x => p3(x.title) === p3(jt))
        const hit = strong.length ? strong : weak
        if (new Set(hit.map(x => x.code)).size === 1 && hit.length) code = hit[0].code
      }
    }
    fyiCodeCache[jobId] = code
    return code
  }
  for (const a of fyiApps) {
    if (a.created_at) monthly[toVNMonth(a.created_at)] = (monthly[toVNMonth(a.created_at)] || 0) + 1
    const code = fyiCodeForJob(a.job_id)
    if (code) {
      const j = jdAll(code)
      j.apps++
      if (a.created_at && (!j.firstApp || a.created_at < j.firstApp)) j.firstApp = a.created_at
      if (a.created_at && a.created_at <= lastAppCap && (!j.lastApp || a.created_at > j.lastApp)) j.lastApp = a.created_at
    }
    if (!inPeriod(a.created_at)) continue
    bump('FYI', 'applications')
    applicationsTotal++
    if (code) {
      const j = jd(code)
      j.apps++
      j.appsFyi++
      j.chan.FYI = (j.chan.FYI || 0) + 1
    }
  }

  // ── 면접 = 기업 면접 (파이프라인 interviewing 이상) ────────────
  // 2026-07-28 교체: 이전에는 Master 시트 INTERVIEW 탭 행 수를 면접으로 셌으나, 그 탭은
  // "스크리닝 합격자 대상 자체 폰 인터뷰"(→ AI 인터뷰 → 둘 다 폐지) 시절의 기록이라
  // 기업 면접이 아니다. 실제로 전달(38)보다 면접(85)이 많은 역전이 공고 단위에서 발생했다.
  // 한계: 파이프라인에 상태 이력이 없어 면접 후 탈락자는 rejected 로 묻힌다 (화면에 각주).
  // ── 입사·재직·매출 (Ops Employee + 매출현황) ────────────────
  type Hire = {
    company: string; email: string; name: string; status: string
    hired_at: string | null; left_at: string | null; revenue: number; profit: number
  }
  const hires: Hire[] = []
  {
    const hIdx = empSheet.findIndex((r: any[]) => r.includes('Name') && r.some((c: any) => /e-?mail/i.test(c || '')))
    if (hIdx >= 0) {
      const H = empSheet[hIdx]
      const col = (re: RegExp) => H.findIndex((c: any) => re.test(String(c || '').replace(/\n/g, ' ').trim()))
      const ci = { status: col(/^Status$/i), company: col(/^Company$/i), name: col(/^Name$/i), email: col(/^e-?mail$/i) }
      for (const r of empSheet.slice(hIdx + 1)) {
        const email = String(r[ci.email] || '').trim().toLowerCase()
        const name = String(r[ci.name] || '').trim()
        // 이메일 없는 행도 포함 (이름 폴백으로 귀속) — 단 카운트/집계용 행은 스킵
        if (name.length < 2 || /^\d+$/.test(name)) continue
        hires.push({ company: String(r[ci.company] || '').trim(), email, name, status: String(r[ci.status] || '').trim(), hired_at: null, left_at: null, revenue: 0, profit: 0 })
      }
    }
    const rIdx = revSheet.findIndex((r: any[]) => r.some((c: any) => /기업명/.test(c || '')) && r.some((c: any) => /이름/.test(c || '')))
    if (rIdx >= 0) {
      const RH = revSheet[rIdx]
      const rc = (re: RegExp) => RH.findIndex((c: any) => re.test(String(c || '').trim()))
      const rci = { name: rc(/^이름/), hired: rc(/^입사일/), left: rc(/^이탈 ?일/), revenue: rc(/^총 ?매출액/), profit: rc(/^이익/) }
      const byName = Object.fromEntries(hires.map(h => [normName(h.name), h]))
      for (const r of revSheet.slice(rIdx + 1)) {
        const h = byName[normName(r[rci.name])]
        if (!h) continue
        h.hired_at = toDate(r[rci.hired])
        h.left_at = toDate(r[rci.left])
        h.revenue = parseKrw(r[rci.revenue]) || 0
        h.profit = parseKrw(r[rci.profit]) || 0
      }
    }
  }

  // 파이프라인 미귀속 입사(Ops 시트에만 있는 별도 경로 입사)는 모든 집계에서 제외.
  // 귀속 판정: 이메일 매칭 + 이름 매칭 폴백 — 지원 이메일과 온보딩 이메일이 다른 실사례가 있어
  // (2026-07 Ops 확인) 이메일만으로는 파이프라인 입사자를 미귀속으로 잘못 분류할 수 있다.
  const fpNames = new Set(
    candidates.filter(c => (c.pipeline_status || '') === 'final_passed').map(c => normName(c.full_name)).filter(Boolean),
  )
  const attributedHires = hires.filter(h => channelForEmailAll(h.email) || fpNames.has(normName(h.name)))
  const excludedHires = hires.length - attributedHires.length

  // ── 비용 적용 (누적 전용) ──────────────────────────────────
  if (raw.cost) {
    for (const c of Object.values(chan)) {
      const fees = raw.cost.spendByChannel[c.key]
      const ads = c.key === 'landing-page' ? (raw.cost.ktcMeta || null) : c.key === 'FYI' ? (raw.cost.fyiKtcMeta || null) : null
      if (fees != null || ads != null) {
        c.spendFees = fees ?? 0
        c.spendAds = ads ?? 0
      }
      if (raw.cost.postedByChannel[c.key] != null) c.jobsPosted = raw.cost.postedByChannel[c.key]
    }
  }

  // ── 채널 목록 완성 (전 지표 0인 채널은 제외) ────────────────
  // 비용 시트는 시간 축이 없어 기간 보기에서는 비용 열을 비운다
  const channels: Channel[] = Object.values(chan)
    .filter(c => c.people + c.applications + c.docPass + c.interviews + c.hires > 0)
    .map(c => {
      const fees = start == null ? c.spendFees : null
      const ads = start == null ? c.spendAds : null
      const spendKrw = fees != null || ads != null ? (fees ?? 0) + (ads ?? 0) : null
      return {
        key: c.key, people: c.people, applications: c.applications, docPass: c.docPass,
        interviews: c.interviews, hires: c.hires, jobsPosted: c.jobsPosted,
        spendFees: fees, spendAds: ads, spendKrw,
        cpaKrw: spendKrw != null && c.people > 0 ? spendKrw / c.people : null,
        costPerHireKrw: spendKrw != null && c.hires > 0 ? spendKrw / c.hires : null,
      }
    })
    .sort((a, b) => {
      if (a.key === '_unattributed') return 1
      if (b.key === '_unattributed') return -1
      return b.people - a.people
    })

  // ── TO 원장 (KTC Ops `TO_Table_수정`) — TO 1행 = 채용 자리 1개 ────
  // 대표 확인(2026-07-28): TO·채용 현황의 정본은 이 탭이다. JD EXECUTION 의 Headcount 는
  // 갱신이 밀려 11건 어긋나 있었고, 파이프라인 final_passed 는 이탈해도 그대로 남아
  // 이탈자(LM1001·NX501 등)를 계속 입사로 세고 있었다.
  // 열은 헤더 이름으로 해석 (이 시트들은 컬럼이 자주 이동한다 — 인덱스 하드코딩 금지)
  const toByCode: Record<string, { to: number; filled: number; dropped: number; ongoing: number; responded: boolean }> = {}
  {
    const hIdx = toSheet.findIndex((r: any[]) => (r || []).some((c: any) => /vn\s*code/i.test(String(c || ''))))
    if (hIdx >= 0) {
      const H: any[] = toSheet[hIdx]
      const col = (re: RegExp, fallback: number) => {
        const i = H.findIndex((h: any) => re.test(String(h || '').trim()))
        return i >= 0 ? i : fallback
      }
      const cCode = col(/vn\s*code/i, 2)
      const cState = col(/현재\s*상태/, 5)
      const cIv = col(/인터뷰\s*완료/, 10)
      const cMatch = col(/^매칭$/, 11)
      for (const r of toSheet.slice(hIdx + 1)) {
        const code = String((r || [])[cCode] || '').trim().toUpperCase()
        if (!code) continue
        const b = toByCode[code] || (toByCode[code] = { to: 0, filled: 0, dropped: 0, ongoing: 0, responded: false })
        const state = String(r[cState] || '').trim()
        b.to++
        if (state === '매칭') b.filled++
        else if (state === '이탈') b.dropped++
        else if (state === '진행중') b.ongoing++
        // 기업 반응 이력 = 기업 면접까지 갔거나 매칭된 적 있는 자리 (이탈로 끝났어도 반응은 있었던 것)
        if (String(r[cIv] || '').trim() || String(r[cMatch] || '').trim()) b.responded = true
      }
    } else if (toSheet.length) {
      raw.warnings.push('KTC Ops TO_Table_수정 헤더(VN Code)를 찾지 못해 TO 는 JD 원장 Headcount 로 폴백')
    }
  }

  // ── 공고 원장 → JdRow (헤더 해석은 위 공고 귀속 리졸버 직전에서 완료) ──
  const jds: JdRow[] = jdDataRows
    .filter((r: any[]) => String(r[JC.code] || '').trim())
    .map((r: any[]) => {
      const code = String(r[JC.code]).trim()
      const agg = perJd[code] || { people: 0, docPass: 0, delivered: 0, offer: 0, hires: 0, interviews: 0, apps: 0, appsFyi: 0, chan: {} as Record<string, number> }
      const status = String(r[JC.status] || '').trim()
      const open = !CLOSED_RE.test(status)
      // TO·충원은 TO 원장 우선, 원장에 없는 공고만 JD EXECUTION Headcount 폴백
      const toRow = toByCode[code.toUpperCase()]
      const headcount = toRow ? toRow.to : parseInt(r[JC.headcount]) || null
      const dropped = toRow ? toRow.dropped : 0

      // 판정 재료는 누적/현재 상태 기준 (기간 보기여도 판정은 안 바뀐다)
      const all = perJdAll[code] || { people: 0, apps: 0, cur: {}, firstApp: null }
      const cur = all.cur
      const curCompany = cur.sent_to_company || 0
      const curInterview = cur.interviewing || 0
      const curOffer = cur.offer || 0
      const curNew = cur.new || 0
      const curPassed = cur.passed || 0
      const curReady = cur.ready_to_forward || 0
      const curInternal = curNew + curPassed + curReady
      // 충원 = TO 원장의 '매칭' 자리 수 (이탈은 빈자리로 되돌아간다).
      // 파이프라인 final_passed 는 이탈 후에도 그대로 남아 실제 충원보다 부풀려져 있었다.
      const hiresAll = toRow ? toRow.filled : cur.final_passed || 0
      const startDate = parseReceived(r[JC.received], all.firstApp, fetchedAt) || (all.firstApp ? all.firstApp.slice(0, 10) : null)
      const days = startDate ? Math.max(0, Math.round((fetchedAt - new Date(`${startDate}T00:00:00+07:00`).getTime()) / 86400000)) : null

      // 2026-07-28 개정 (전수조사 근거): 구 규칙은 "검토 체류 1명만 있어도 순항"이라
      // 면접·입사가 한 번도 없는 무반응 공고 12건이 순항으로 위장됐다 (정체 0건 착시).
      // 검토 중은 ① 반응 이력(면접·입사) 있으면 순항 ② 없어도 모집 6주 미만이면 순항(첫 반응 대기)
      // ③ 6주 넘도록 반응 0이면 정체(기업 응답 없음)로 본다.
      let health: JdRow['health'] = null
      if (open) {
        if (headcount != null && hiresAll >= headcount) health = 'good' // 충원 완료
        else if (curOffer + curInterview > 0) health = 'good' // 면접·오퍼 진행 중
        // 반응 이력 = TO 원장에 기업 면접 완료·매칭 기록이 있는 공고 (이탈로 끝났어도 기업은 반응했다)
        else if (curCompany > 0 && (toRow?.responded || hiresAll > 0)) health = 'good'
        else if (curCompany > 0 && days != null && days < NO_RESPONSE_DAYS) health = 'good' // 검토 중 (첫 반응 대기)
        else if (days != null && days < EARLY_DAYS) health = 'early'
        else if (all.apps < APPS_PER_TO_FLOOR * (headcount || 1)) health = 'low'
        else health = 'stall' // curCompany>0 이면 기업 응답 없음, 0이면 내부 처리 정체 — 사유는 UI에서 분기
      }

      return {
        code,
        company: String(r[JC.company] || '').trim(),
        title: String(r[JC.title] || '').trim(),
        headcount,
        status,
        open,
        apps: agg.apps, appsFyi: agg.appsFyi, people: agg.people, docPass: agg.docPass,
        delivered: agg.delivered, interviews: agg.interviews, offer: agg.offer, hires: agg.hires, hiresAll,
        channels: Object.entries(agg.chan).map(([k, n]) => ({ key: k, apps: n })).sort((a, b) => b.apps - a.apps),
        lastAppDate: all.lastApp ? String(all.lastApp).slice(0, 10) : null,
        dropped, responded: !!toRow?.responded,
        startDate, days, peopleAll: all.people, appsAll: all.apps,
        curInternal, curNew, curPassed, curReady, curCompany, curInterview, curOffer, health,
      }
    })
    .sort((a: JdRow, b: JdRow) => {
      if (a.open !== b.open) return Number(b.open) - Number(a.open)
      // 진행 중: 순항 → 정체 → 지원 부족 → 모집 초기, 같은 판정 안에선 진행 깊은 순 → 지원자 많은 순
      const rank = (j: JdRow) => (j.health === 'good' ? 0 : j.health === 'stall' ? 1 : j.health === 'low' ? 2 : j.health === 'early' ? 3 : 4)
      if (a.open && rank(a) !== rank(b)) return rank(a) - rank(b)
      const depth = (j: JdRow) => j.curOffer * 10000 + j.curInterview * 100 + j.curCompany
      if (a.open && depth(a) !== depth(b)) return depth(b) - depth(a)
      return b.people - a.people
    })

  const openJds = jds.filter(j => j.open)
  const headcountTotal = openJds.reduce((s, j) => s + (j.headcount || 0), 0)
  // 충원(채움)은 스톡 — 기간 보기에서 코호트 입사로 세면 "목표 38명 중 0명"처럼 깨져 보인다
  const hiresInOpen = openJds.reduce((s, j) => s + j.hiresAll, 0)

  // ── 성과 ──────────────────────────────────────────────────
  // 총 지출은 헤드라인(누적)용이라 기간 필터와 무관하게 원본 chan 값으로 계산
  const rawChans = Object.values(chan)
  const totalSpendKrw = rawChans.some(c => c.spendFees != null || c.spendAds != null)
    ? rawChans.reduce((s, c) => s + (c.spendFees ?? 0) + (c.spendAds ?? 0), 0)
    : null
  const working = attributedHires.filter(h => /^ing$/i.test(h.status)).length
  const nowMonth = toVNMonth(new Date().toISOString())
  const hiresThisMonth = attributedHires.filter(h => h.hired_at && toVNMonth(h.hired_at) === nowMonth).length
  // 기간 보기의 입사 = 입사일(hired_at, 매출현황 시트) 기준 — 코호트(그 기간 지원자의 입사)와 별개로,
  // "이 기간에 몇 명 입사했나"라는 히어로 질문에 답한다 (2026-07-28, "기간 필터가 안 먹는다" 피드백)
  const hiresInPeriod = start == null ? null : attributedHires.filter(h => h.hired_at && inPeriod(h.hired_at)).length

  const byCompany: Record<string, CompanyPerf> = {}
  for (const h of attributedHires) {
    const key = h.company || '(미상)'
    const c = byCompany[key] || (byCompany[key] = { company: key, hires: 0, working: 0, revenueUsd: 0, profitUsd: 0 })
    c.hires++
    if (/^ing$/i.test(h.status)) c.working++
    c.revenueUsd += h.revenue
    c.profitUsd += h.profit
  }

  // 입사는 어디서든 파이프라인 기준(final_passed) 하나만 쓴다
  const candidatesTotal = Object.values(chan).reduce((s, c) => s + c.people, 0)
  const funnel: FunnelStage[] = [
    { key: 'people', label: '지원자', count: candidatesTotal },
    { key: 'screened', label: '스크리닝 합격', count: screenPass },
    { key: 'delivered', label: '기업 전달', count: delivered },
    { key: 'interview', label: '면접', count: interviewPipe, note: '기업 면접 — 면접 후 탈락자는 상태 이력이 없어 미포함' },
    { key: 'offer', label: '오퍼·계약', count: Math.max(offerReached, finalPassed) },
    { key: 'hired', label: '입사', count: finalPassed },
  ]

  // 월별 지원 추이: 미래 월 제거 + 빈 월 0 채움 (연속 12개월 축)
  const monthlyArr = toMonthSeries(monthly, nowMonth)

  return {
    generatedAt: new Date(fetchedAt).toISOString(),
    mode: 'live',
    warnings: raw.warnings,
    headline: {
      hiresTotal: finalPassedAll,
      hiresInPeriod,
      hiresThisMonth,
      working,
      left: attributedHires.filter(h => !/^ing$/i.test(h.status) && h.status).length,
      revenueUsd: attributedHires.reduce((s, h) => s + h.revenue, 0),
      profitUsd: attributedHires.reduce((s, h) => s + h.profit, 0),
      totalSpendKrw,
      costPerHireKrw: totalSpendKrw != null && finalPassedAll > 0 ? totalSpendKrw / finalPassedAll : null,
    },
    supply: {
      talentPoolResume: raw.resumeCount,
      talentPoolPublic: raw.publicCount,
      candidatesTotal,
      applicationsTotal,
      channels,
      monthly: monthlyArr,
    },
    matching: {
      funnel,
      inProgress: {
        screeningQueue: statusCount.new || 0,
        screenPassed: statusCount.passed || 0,
        readyToForward: statusCount.ready_to_forward || 0,
        sentToCompany: statusCount.sent_to_company || 0,
        interviewing: statusCount.interviewing || 0,
        offer: statusCount.offer || 0,
      },
      jds,
      openJds: openJds.length,
      headcountTotal,
      hiresInOpen,
      fillRateOpen: headcountTotal > 0 ? hiresInOpen / headcountTotal : null,
      jdSince: jds.reduce<string | null>((min, j) => (j.startDate && (!min || j.startDate < min) ? j.startDate : min), null),
    },
    vietnam,
    outcome: {
      companies: Object.values(byCompany).sort((a, b) => b.hires - a.hires),
      excludedHires,
    },
  }
}

// ── 캐시 — Vercel Data Cache 에 저장해 콜드 서버리스 인스턴스끼리 공유한다.
// 기존 인메모리 캐시는 인스턴스마다 비어 있어서, 오래 안 열어본 뒤 접속(scale-to-zero
// 콜드)마다 전 소스를 다시 읽어 수 초씩 걸렸다. Data Cache 는 인스턴스 경계를 넘어
// 유지되고(배포해도 유지됨), 만료 후에도 stale 을 즉시 돌려주고 백그라운드로 갱신(SWR)한다.
// 원본(Raw)이 아니라 집계 결과(MasterData)를 담는다 — 훨씬 작아 Data Cache 항목
// 크기 한도(2MB)에 안전. 기간 3종을 한 번의 fetchRaw 로 계산해 함께 캐시한다.
//
// revalidate = 60초: SWR 라 응답 속도는 그대로 빠르면서, 시트에서 공고를 마감하면
// 일반 접속도 ~1분 안에 반영된다(즉시 보려면 상단 새로고침=?fresh=1 이 캐시 우회 라이브).
// 집계 로직을 바꿀 때는 캐시 키 버전(v2)을 올려 옛 스냅샷을 폐기할 것 — Data Cache 는
// 배포로 자동 비워지지 않으므로, 안 올리면 옛 결과가 revalidate 창만큼 남는다.
const TTL_SECONDS = 60

const getCachedByPeriod = unstable_cache(
  async (): Promise<Record<Period, MasterData>> => {
    const raw = await fetchRaw()
    const at = raw.fetchedAt
    return {
      all: computeFromRaw(raw, 'all', at),
      month: computeFromRaw(raw, 'month', at),
      '30d': computeFromRaw(raw, '30d', at),
    }
  },
  ['staffing-master-data-v14'], // ← 집계 로직 변경 시 버전 올려 옛 캐시 폐기
  { revalidate: TTL_SECONDS, tags: ['staffing-master-data'] },
)

// 새로고침 연타 가드 (인스턴스 로컬, 소프트) — 시트 분당 쿼터 보호
let lastFreshAt = 0

export async function getMasterData(fresh = false, period: Period = 'all'): Promise<MasterData> {
  if (!hasLiveEnv()) return mockData()
  // 새로고침(?fresh=1): 캐시를 건너뛰고 라이브로 재계산. 단 직전 60초 내면 캐시로 응답.
  if (fresh && Date.now() - lastFreshAt >= 60_000) {
    lastFreshAt = Date.now()
    const raw = await fetchRaw()
    return computeFromRaw(raw, period, raw.fetchedAt)
  }
  const byPeriod = await getCachedByPeriod()
  return byPeriod[period]
}
