// 스태핑 마스터 집계 — 모든 소스를 라이브로 읽어 MasterData 하나로 만든다.
//
// 소스 (전부 read-only):
//  - ktc-support Supabase `candidates`      → 파이프라인 퍼널·채널 귀속 (라이브)
//  - salarymap Supabase `ktc_applications`  → 지원 건 (시트 원본 재적재본)
//  - salarymap Supabase `jobs`/`job_applications` → FYI(KTC 공고) 지원자
//  - salarymap Supabase `user_profiles`     → FYI 인재풀 (이력서 등록/공개)
//  - Master 시트 `JD EXECUTION`/`INTERVIEW` → 공고 원장·면접
//  - KTC Ops 시트 `Employee`/`매출현황`      → 입사·재직·매출·이익
//  - 비용 시트 (통합 비교표/invoice/캠페인별/LINKEDIN) → 채널별 지출 (KRW)
//
// 집계 규칙은 salarymap pages/api/admin/ktc-jd-funnel.js 를 이식하되, 스크리닝
// 합격 판정을 현행 ktc-support 상태값(ready_to_forward/sent_to_company/…)까지
// 포함하도록 보정했다 (원본은 구 ai_interview 계열만 집계).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Channel, CompanyPerf, FunnelStage, JdRow, MasterData, MonthPoint } from './types'
import { mockData } from './mock'

const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID || '1mR1_-a3LmjxAbbox3tTKBu6WYwDbfBYKmPB6TP9EnKI'
const COST_SHEET_ID = process.env.COST_SHEET_ID || '1PEWHeAtx5nfxODQr_Db1soh-scl3Qg5Uw-fnjRziF8A'
const KTC_OPS_SHEET_ID = process.env.KTC_OPS_SHEET_ID || '1opr9KoR7KRZ31CJDNGM63xbA2rPZjPuNaG6eeLPTXjM'

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
const CLOSED_RE = /clos|done|drop|hold|중단|마감|완료|보류|종료/i

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

// VN(UTC+7) 기준 YYYY-MM
const toVNMonth = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 7)

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

type ChanAcc = {
  key: string; people: number; applications: number; docPass: number
  interviews: number; hires: number
  jobsPosted: number | null; spendFees: number | null; spendAds: number | null
}

export function hasLiveEnv() {
  return Boolean(
    process.env.KTC_SUPABASE_URL && process.env.KTC_SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SALARYMAP_SUPABASE_URL && process.env.SALARYMAP_SUPABASE_SERVICE_ROLE_KEY,
  )
}

async function buildLive(): Promise<MasterData> {
  const warnings: string[] = []
  const ktc = createClient(process.env.KTC_SUPABASE_URL!, process.env.KTC_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const fyi = createClient(process.env.SALARYMAP_SUPABASE_URL!, process.env.SALARYMAP_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Google Sheets 클라이언트 (없으면 시트 기반 지표는 비움) ──
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

  // ── 병렬 로드 ─────────────────────────────────────────────
  const [candidates, applications, resumeCount, publicCount, jdSheet, ivSheet, empSheet, revSheet] = await Promise.all([
    grab('파이프라인(candidates)', () => fetchAll<any>(ktc, 'candidates', 'sheet_source, email, applied_job, applied_date, pipeline_status'), []),
    grab('지원 건(ktc_applications)', () => fetchAll<any>(fyi, 'ktc_applications', 'sheet_source, job_code, applied_at'), []),
    grab('인재풀(이력서)', async () => {
      const { count, error } = await fyi.from('user_profiles').select('id', { count: 'exact', head: true }).not('resume_url', 'is', null)
      if (error) throw new Error(error.message)
      return count || 0
    }, 0),
    grab('인재풀(공개)', async () => {
      const { count, error } = await fyi.from('user_profiles').select('id', { count: 'exact', head: true }).not('resume_url', 'is', null).eq('is_resume_public', true)
      if (error) throw new Error(error.message)
      return count || 0
    }, 0),
    grab('공고 원장(JD EXECUTION)', async () => sheets
      ? (await sheets.spreadsheets.values.get({ spreadsheetId: MASTER_SHEET_ID, range: "'JD EXECUTION'!A1:N" })).data.values || []
      : [], []),
    grab('면접(INTERVIEW)', async () => sheets
      ? (await sheets.spreadsheets.values.get({ spreadsheetId: MASTER_SHEET_ID, range: "'INTERVIEW'!A1:N" })).data.values || []
      : [], []),
    grab('입사(Employee)', async () => sheets
      ? (await sheets.spreadsheets.values.get({ spreadsheetId: KTC_OPS_SHEET_ID, range: "'Employee'!A1:T" })).data.values || []
      : [], []),
    grab('매출현황', async () => sheets
      ? (await sheets.spreadsheets.values.get({ spreadsheetId: KTC_OPS_SHEET_ID, range: "'매출현황'!A1:N" })).data.values || []
      : [], []),
  ])

  // ── FYI(KTC 공고) 지원자 — salarymap 라이브 ────────────────
  const fyiApps = await grab('FYI 지원', async () => {
    const jobs = await fetchAll<any>(fyi, 'jobs', 'id', q => q.eq('source', 'ktc'))
    const ids = jobs.map(j => j.id)
    let apps: any[] = []
    for (let i = 0; i < ids.length; i += 50) {
      apps = apps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email, created_at', q => q.in('job_id', ids.slice(i, i + 50))))
    }
    return apps.filter(a => a.applicant_email && !String(a.applicant_email).toLowerCase().endsWith('@likelion.net'))
  }, [])
  const fyiEmails = new Set(fyiApps.map(a => String(a.applicant_email).toLowerCase()))

  // ── 채널·공고별 파이프라인 집계 (candidates 라이브) ─────────
  const chan: Record<string, ChanAcc> = {}
  const bump = (key: string, field: 'people' | 'applications' | 'docPass' | 'interviews' | 'hires') => {
    const c = chan[key] || (chan[key] = { key, people: 0, applications: 0, docPass: 0, interviews: 0, hires: 0, jobsPosted: null, spendFees: null, spendAds: null })
    c[field]++
  }

  const perJd: Record<string, { people: number; docPass: number; delivered: number; offer: number; hires: number; interviews: number; apps: number }> = {}
  const jd = (code: string) => perJd[code] || (perJd[code] = { people: 0, docPass: 0, delivered: 0, offer: 0, hires: 0, interviews: 0, apps: 0 })

  const chanByEmail: Record<string, string> = {}
  const statusCount: Record<string, number> = {}
  let screenPass = 0, delivered = 0, interviewPipe = 0, offerReached = 0, finalPassed = 0

  for (const c of candidates) {
    const e = String(c.email || '').toLowerCase()
    const ch = c.sheet_source || '(미상)'
    const code = extractJobCode(c.applied_job)
    const st = c.pipeline_status || 'new'
    statusCount[st] = (statusCount[st] || 0) + 1
    bump(ch, 'people')
    if (SCREEN_PASS.has(st)) { bump(ch, 'docPass'); screenPass++ }
    if (DELIVERED.has(st)) delivered++
    if (INTERVIEW_REACHED.has(st)) interviewPipe++
    if (OFFER_REACHED.has(st)) offerReached++
    if (st === 'final_passed') finalPassed++
    if (e && !chanByEmail[e]) chanByEmail[e] = ch
    if (st === 'final_passed') bump(ch, 'hires')
    if (code) {
      const j = jd(code)
      j.people++
      if (SCREEN_PASS.has(st)) j.docPass++
      if (DELIVERED.has(st)) j.delivered++
      if (OFFER_REACHED.has(st)) j.offer++
      if (st === 'final_passed') j.hires++
    }
  }

  // FYI 채널 지원자는 salarymap 라이브가 정답 (파이프라인 유입분보다 넓다)
  if (fyiEmails.size) {
    const c = chan.FYI || (chan.FYI = { key: 'FYI', people: 0, applications: 0, docPass: 0, interviews: 0, hires: 0, jobsPosted: null, spendFees: null, spendAds: null })
    c.people = Math.max(c.people, fyiEmails.size)
  }
  const channelForEmail = (e: string) => chanByEmail[e] || (fyiEmails.has(e) ? 'FYI' : null)

  // ── 지원 건 (ktc_applications + FYI 라이브) ────────────────
  const monthly: Record<string, number> = {}
  let applicationsTotal = 0
  for (const a of applications) {
    const ch = a.sheet_source || '(미상)'
    bump(ch, 'applications')
    applicationsTotal++
    if (a.job_code) jd(a.job_code).apps++
    if (a.applied_at) monthly[toVNMonth(a.applied_at)] = (monthly[toVNMonth(a.applied_at)] || 0) + 1
  }
  for (const a of fyiApps) {
    bump('FYI', 'applications')
    applicationsTotal++
    if (a.created_at) monthly[toVNMonth(a.created_at)] = (monthly[toVNMonth(a.created_at)] || 0) + 1
  }

  // ── 면접 (Master INTERVIEW 탭 — 사람 단위 1회, 공고코드 추출) ──
  let interviewPeople = 0
  {
    const seenPerson = new Set<string>()
    const seenPersonCode = new Set<string>()
    for (const r of ivSheet.slice(2)) {
      const email = String(r[2] || '').trim().toLowerCase()
      const name = String(r[1] || '').trim()
      if (!name) continue
      const personKey = email || name
      if (!seenPerson.has(personKey)) {
        seenPerson.add(personKey)
        interviewPeople++
        const ch = channelForEmail(email)
        if (ch) bump(ch, 'interviews') // 파이프라인 미귀속 인원은 채널 표에서 제외
      }
      const codes = [...new Set(String(r[13] || '').match(CODE_RE) || [])]
      for (const code of codes) {
        const key = `${personKey}|${code}`
        if (seenPersonCode.has(key)) continue
        seenPersonCode.add(key)
        jd(code).interviews++
      }
    }
  }

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
        if (!name || !email.includes('@')) continue
        hires.push({ company: String(r[ci.company] || '').trim(), email, name, status: String(r[ci.status] || '').trim(), hired_at: null, left_at: null, revenue: 0, profit: 0 })
      }
    } else if (empSheet.length) {
      warnings.push('Employee 탭 헤더를 찾지 못함')
    }
    // 매출현황: 이름 매칭으로 입사일·매출·이익 병합
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
  // 파이프라인 미귀속 입사(Ops 시트에만 있는 별도 경로 입사)는 이 대시보드의 모든
  // 집계에서 제외한다 — 입사·재직·매출이 전부 "채널 파이프라인 경유" 기준으로 일관되게.
  const attributedHires = hires.filter(h => channelForEmail(h.email))
  const excludedHires = hires.length - attributedHires.length

  // ── 채널별 지출 (비용 시트) — 실패해도 나머지는 정상 ────────
  if (sheets) await grab('비용 시트', async () => {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: COST_SHEET_ID })
    const tabs = (meta.data.sheets || []).map((s: any) => s.properties.title)
    const findTab = (kw: string) => tabs.find((t: string) => t.toLowerCase().includes(kw.toLowerCase()))
    const cmpTab = findTab('통합 비교표'), metaTab = findTab('캠페인별'), invTab = findTab('invoice')
    if (!cmpTab || !metaTab || !invTab) throw new Error(`탭 탐지 실패 (비교표:${cmpTab} 캠페인:${metaTab} 인보이스:${invTab})`)
    const [cmpRes, metaRes, invRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: COST_SHEET_ID, range: `'${cmpTab}'!A1:M15` }),
      sheets.spreadsheets.values.get({ spreadsheetId: COST_SHEET_ID, range: `'${metaTab}'!A1:H60` }),
      sheets.spreadsheets.values.get({ spreadsheetId: COST_SHEET_ID, range: `'${invTab}'!A1:S30` }),
    ])
    const cmpRows = cmpRes.data.values || []
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
    // VND→KRW 환율 (라이브 → 인보이스 유도 → 상수)
    let vndToKrw: number | null = null
    try {
      const fx = await fetch('https://open.er-api.com/v6/latest/VND', { signal: AbortSignal.timeout(4000) }).then(r => r.json())
      if (fx?.rates?.KRW > 0) vndToKrw = fx.rates.KRW
    } catch { /* 폴백 */ }
    const invRows = invRes.data.values || []
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
    const liTab = tabs.find((t: string) => t.toUpperCase().includes('LINKEDIN'))
    if (liTab) {
      const liRes = await sheets.spreadsheets.values.get({ spreadsheetId: COST_SHEET_ID, range: `'${liTab}'!A1:N120` })
      const liRows = liRes.data.values || []
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
          const cost = parseKrw(r[costCol])
          if (cost != null) { ktcVnd += cost; liCodes.add(code) }
        }
        if (ktcVnd > 0) {
          spendByChannel.LinkedIn = ktcVnd * vndToKrw
          if (postedByChannel.LinkedIn == null) postedByChannel.LinkedIn = liCodes.size
        }
      }
    }
    // Meta 광고비 분해: KTC* = 랜딩, FYI_*KTC* = FYI 경유
    let ktcMeta = 0, fyiKtcMeta = 0
    const metaRows = metaRes.data.values || []
    const mIdx = metaRows.findIndex((r: any[]) => r.some(c => String(c || '').trim() === 'Campaign') && r.some(c => String(c || '').startsWith('Spend')))
    if (mIdx >= 0) {
      const MH = metaRows[mIdx]
      const mNameCol = MH.findIndex((c: any) => String(c || '').trim() === 'Campaign')
      const mSpendCol = MH.findIndex((c: any) => String(c || '').startsWith('Spend'))
      for (const r of metaRows.slice(mIdx + 1)) {
        const name = String(r[mNameCol] || '').trim()
        const spend = parseKrw(r[mSpendCol])
        if (spend == null) continue
        if (/^ktc/i.test(name)) ktcMeta += spend
        else if (/^fyi/i.test(name) && /ktc/i.test(name)) fyiKtcMeta += spend
      }
    }
    for (const c of Object.values(chan)) {
      const fees = spendByChannel[c.key]
      const ads = c.key === 'landing-page' ? (ktcMeta || null) : c.key === 'FYI' ? (fyiKtcMeta || null) : null
      if (fees != null || ads != null) {
        c.spendFees = fees ?? 0
        c.spendAds = ads ?? 0
      }
      if (postedByChannel[c.key] != null) c.jobsPosted = postedByChannel[c.key]
    }
    return null
  }, null)

  // ── 채널 목록 완성 (전 지표 0인 채널은 제외) ────────────────
  const channels: Channel[] = Object.values(chan)
    .filter(c => c.people + c.applications + c.docPass + c.interviews + c.hires > 0)
    .map(c => {
      const spendKrw = c.spendFees != null || c.spendAds != null ? (c.spendFees ?? 0) + (c.spendAds ?? 0) : null
      return {
        key: c.key, people: c.people, applications: c.applications, docPass: c.docPass,
        interviews: c.interviews, hires: c.hires, jobsPosted: c.jobsPosted,
        spendFees: c.spendFees, spendAds: c.spendAds, spendKrw,
        cpaKrw: spendKrw != null && c.people > 0 ? spendKrw / c.people : null,
        costPerHireKrw: spendKrw != null && c.hires > 0 ? spendKrw / c.hires : null,
      }
    })
    .sort((a, b) => {
      if (a.key === '_unattributed') return 1
      if (b.key === '_unattributed') return -1
      return b.people - a.people
    })

  // ── 공고 원장 → JdRow ─────────────────────────────────────
  const jds: JdRow[] = jdSheet.slice(3)
    .filter((r: any[]) => String(r[0] || '').trim())
    .map((r: any[]) => {
      const code = String(r[0]).trim()
      const agg = perJd[code] || { people: 0, docPass: 0, delivered: 0, offer: 0, hires: 0, interviews: 0, apps: 0 }
      const status = String(r[11] || '').trim()
      return {
        code,
        company: String(r[1] || '').trim(),
        title: String(r[2] || '').trim(),
        headcount: parseInt(r[8]) || null,
        status,
        open: !CLOSED_RE.test(status),
        apps: agg.apps, people: agg.people, docPass: agg.docPass,
        delivered: agg.delivered, interviews: agg.interviews, offer: agg.offer, hires: agg.hires,
      }
    })
    .sort((a: JdRow, b: JdRow) => Number(b.open) - Number(a.open) || b.people - a.people)

  const openJds = jds.filter(j => j.open)
  const headcountTotal = openJds.reduce((s, j) => s + (j.headcount || 0), 0)
  const hiresInOpen = openJds.reduce((s, j) => s + j.hires, 0)

  // ── 성과 ──────────────────────────────────────────────────
  const totalSpendKrw = channels.some(c => c.spendKrw != null)
    ? channels.reduce((s, c) => s + (c.spendKrw || 0), 0)
    : null
  const working = attributedHires.filter(h => /^ing$/i.test(h.status)).length
  const nowMonth = toVNMonth(new Date().toISOString())
  const hiresThisMonth = attributedHires.filter(h => h.hired_at && toVNMonth(h.hired_at) === nowMonth).length

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
    { key: 'interview', label: '면접', count: Math.max(interviewPeople, interviewPipe), note: 'Master INTERVIEW 탭 기준' },
    { key: 'offer', label: '오퍼·계약', count: Math.max(offerReached, finalPassed) },
    { key: 'hired', label: '입사', count: finalPassed },
  ]

  // 월별 추이: 파싱 오류로 생긴 미래 월 제거 후, 빈 월을 0 으로 채워 연속 12개월 축을 만든다
  const nowMonthVN = toVNMonth(new Date().toISOString())
  const validMonths = Object.keys(monthly).filter(m => m <= nowMonthVN).sort()
  const monthlyArr: MonthPoint[] = []
  if (validMonths.length) {
    const addMonths = (m: string, delta: number) => {
      const [y, mo] = m.split('-').map(Number)
      const t = y * 12 + (mo - 1) + delta
      return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
    }
    const start = validMonths[0] > addMonths(nowMonthVN, -11) ? validMonths[0] : addMonths(nowMonthVN, -11)
    for (let m = start; m <= nowMonthVN; m = addMonths(m, 1)) {
      monthlyArr.push({ month: m, count: monthly[m] || 0 })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'live',
    warnings,
    headline: {
      hiresTotal: finalPassed,
      hiresThisMonth,
      working,
      left: attributedHires.filter(h => !/^ing$/i.test(h.status) && h.status).length,
      revenueUsd: attributedHires.reduce((s, h) => s + h.revenue, 0),
      profitUsd: attributedHires.reduce((s, h) => s + h.profit, 0),
      totalSpendKrw,
      costPerHireKrw: totalSpendKrw != null && finalPassed > 0 ? totalSpendKrw / finalPassed : null,
    },
    supply: {
      talentPoolResume: resumeCount,
      talentPoolPublic: publicCount,
      candidatesTotal: funnel[0].count,
      applicationsTotal,
      channels,
      monthly: monthlyArr,
    },
    matching: {
      funnel,
      inProgress: {
        screeningQueue: statusCount.new || 0,
        readyToForward: statusCount.ready_to_forward || 0,
        sentToCompany: statusCount.sent_to_company || 0,
        interviewing: statusCount.interviewing || 0,
        offer: statusCount.offer || 0,
      },
      jds,
      openJds: openJds.length,
      headcountTotal,
      fillRateOpen: headcountTotal > 0 ? hiresInOpen / headcountTotal : null,
    },
    outcome: {
      companies: Object.values(byCompany).sort((a, b) => b.hires - a.hires),
      excludedHires,
    },
  }
}

// ── 인메모리 캐시 (30분) — ?fresh=1 로 강제 갱신 ─────────────
let cache: { data: MasterData; at: number } | null = null
const TTL = 30 * 60 * 1000

export async function getMasterData(fresh = false): Promise<MasterData> {
  if (!hasLiveEnv()) return mockData()
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.data
  const data = await buildLive()
  cache = { data, at: Date.now() }
  return data
}
