// 데이터 정합성 체크 — 대시보드 집계(getMasterData)와 별개 경로로 소스를 직접
// 재집계해 항목별로 대조한다. GET /api/verify (미들웨어 비밀번호 보호 하에 있음)

import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getMasterData, hasLiveEnv } from '@/lib/aggregate'

export const dynamic = 'force-dynamic'

const CLOSED_RE = /clos|cancel|done|drop|hold|중단|마감|완료|보류|종료|취소|드롭/i
const SCREEN_SET = ['passed', 'ready_to_forward', 'sent_to_company', 'interviewing', 'offer', 'final_passed', 'ai_interview_sent', 'ai_interview_done', 'ai_interview_passed']
const DELIVERED_SET = ['sent_to_company', 'interviewing', 'offer', 'final_passed']

async function cnt(sb: SupabaseClient, table: string, tweak?: (q: any) => any) {
  let q: any = sb.from(table).select('id', { count: 'exact', head: true })
  if (tweak) q = tweak(q)
  const { count, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)
  return count || 0
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

export async function GET() {
  if (!hasLiveEnv()) return NextResponse.json({ error: 'env 미설정 (데모 모드)' }, { status: 400 })

  const d = await getMasterData(true, 'all') // 대시보드 측 (fresh)

  const ktc = createClient(process.env.KTC_SUPABASE_URL!, process.env.KTC_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const fyi = createClient(process.env.SALARYMAP_SUPABASE_URL!, process.env.SALARYMAP_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 독립 재집계: ktc-support 파이프라인 (서버측 exact count) ──
  const candTotal = await cnt(ktc, 'candidates')
  const st: Record<string, number> = {}
  for (const s of ['new', 'passed', 'ready_to_forward', 'sent_to_company', 'interviewing', 'offer', 'final_passed', 'rejected', 'screening_failed', 'ai_interview_sent', 'ai_interview_done', 'ai_interview_passed']) {
    st[s] = await cnt(ktc, 'candidates', q => q.eq('pipeline_status', s))
  }
  const screenReached = SCREEN_SET.reduce((s, k) => s + (st[k] || 0), 0)
  const deliveredReached = DELIVERED_SET.reduce((s, k) => s + (st[k] || 0), 0)
  const pipeFyiPeople = await cnt(ktc, 'candidates', q => q.eq('sheet_source', 'FYI'))

  // ── 독립 재집계: salarymap ──
  // ktc_applications(재적재본)는 2026-07-27 부로 지원 건의 원천이 아님 — 시트 직접이 원천.
  // 재적재본 수치는 편차 관찰용 진단으로만 남긴다 (landing 중복성 행 +249, 신규 탭 미반영 등).
  const appsKtc = await cnt(fyi, 'ktc_applications')
  const resume = await cnt(fyi, 'user_profiles', q => q.not('resume_url', 'is', null))
  const resumePublic = await cnt(fyi, 'user_profiles', q => q.not('resume_url', 'is', null).eq('is_resume_public', true))

  const ktcJobs = await fetchAll<any>(fyi, 'jobs', 'id, title, company, source_id, is_active', q => q.eq('source', 'ktc'))
  let fyiApps: any[] = []
  for (let i = 0; i < ktcJobs.length; i += 50) {
    fyiApps = fyiApps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email, job_id', q => q.in('job_id', ktcJobs.slice(i, i + 50).map(j => j.id))))
  }
  fyiApps = fyiApps.filter(a => a.applicant_email && !String(a.applicant_email).toLowerCase().endsWith('@likelion.net'))
  const fyiUniq = new Set(fyiApps.map(a => String(a.applicant_email).toLowerCase())).size
  const expectedCandidates = candTotal - pipeFyiPeople + Math.max(pipeFyiPeople, fyiUniq)
  const expectedApps = appsKtc + fyiApps.length

  const vnJobs = await fetchAll<any>(fyi, 'jobs', 'id, company, is_active', q => q.eq('source', 'company_self'))
  let vnApps: any[] = []
  for (let i = 0; i < vnJobs.length; i += 50) {
    vnApps = vnApps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email, viewed_at', q => q.in('job_id', vnJobs.slice(i, i + 50).map(j => j.id))))
  }
  vnApps = vnApps.filter(a => !String(a.applicant_email || '').toLowerCase().endsWith('@likelion.net'))

  // 파이프라인 이메일·소스 (채널 귀속 + 시트 탭별 유입 대조에 공용)
  const candRows = await fetchAll<any>(ktc, 'candidates', 'email, sheet_source')
  const candEmails = new Set(candRows.map(c => String(c.email || '').toLowerCase()).filter(Boolean))
  const candBySource: Record<string, number> = {}
  for (const c of candRows) candBySource[c.sheet_source || '(null)'] = (candBySource[c.sheet_source || '(null)'] || 0) + 1

  // ── 독립 재집계: 시트 (JD·면접·입사·매출) ──
  let sheet: any = null
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const { google } = await import('googleapis')
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    sheet = google.sheets({ version: 'v4', auth })
  }
  const MASTER = process.env.MASTER_SHEET_ID || '1mR1_-a3LmjxAbbox3tTKBu6WYwDbfBYKmPB6TP9EnKI'
  const OPS = process.env.KTC_OPS_SHEET_ID || '1opr9KoR7KRZ31CJDNGM63xbA2rPZjPuNaG6eeLPTXjM'

  let jdTotal = 0, jdOpen = 0, headcountOpen = 0, ivPeople = 0, ivNoCodeRows = 0
  let empTotal = 0, empIng = 0, empAttributed = 0, revSum = 0, profitSum = 0
  let finalPassedNotInEmp = 0
  // 공고별 지원 크로스소스 대조 재료 (2026-07-28 FPT403 맹점 재발 방지 —
  // FYI 직접 지원이 공고별 표시에서 통째로 빠졌는데 총계 검사만으론 안 잡혔음)
  const normT = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const alnT = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const simpT = (s: unknown) => normT(String(s || '').replace(/\([^)]*\)/g, ' ').split(' - ')[0])
  const jdTitleToCode: Record<string, string | null> = {}
  const jdIndex: { code: string; comp: string; title: string }[] = []
  const jdOpenCodes = new Set<string>()
  const sheetAppsByCode: Record<string, number> = {}
  let sheetAppsNoCode = 0
  // 상세 명단 (운영 조치용)
  const fpNotInEmpList: any[] = []
  const revenueStatus: any[] = []
  const revRowsUnmatched: string[] = []
  if (sheet) {
    const [mRes, oRes] = await Promise.all([
      sheet.spreadsheets.values.batchGet({ spreadsheetId: MASTER, ranges: ["'JD EXECUTION'!A1:N", "'INTERVIEW'!A1:N"] }),
      sheet.spreadsheets.values.batchGet({ spreadsheetId: OPS, ranges: ["'Employee'!A1:T", "'매출현황'!A1:N"] }),
    ])
    const [jdRows, ivRows] = mRes.data.valueRanges.map((v: any) => v.values || [])
    const [empRows, revRows] = oRes.data.valueRanges.map((v: any) => v.values || [])

    // 열 위치는 헤더 이름으로 (aggregate.ts 와 동일 — 컬럼 이동에도 안 깨지게). 못 찾으면 실측 인덱스 폴백.
    const jdHdrIdx = jdRows.findIndex((r: any[]) => r.some((c: any) => /job\s*id/i.test(String(c || ''))))
    const jdHdr: any[] = jdHdrIdx >= 0 ? jdRows[jdHdrIdx] : []
    const jdc = (re: RegExp, fb: number) => {
      const i = jdHdr.findIndex((c: any) => re.test(String(c || '').replace(/\n/g, ' ').trim()))
      return i >= 0 ? i : fb
    }
    const JCcode = jdc(/job\s*id/i, 0), JCcount = jdc(/headcount/i, 6), JCstatus = jdc(/job\s*status/i, 9), JCtitle = jdc(/job\s*title/i, 2), JCcomp = jdc(/company/i, 1)
    for (const r of jdRows.slice(jdHdrIdx >= 0 ? jdHdrIdx + 1 : 3)) {
      const code = String(r[JCcode] || '').trim()
      if (!code) continue
      jdTotal++
      // FYI 공고 → 코드 매칭용 (aggregate 의 fyiCodeForJob 과 동일 규칙)
      const t = normT(r[JCtitle])
      if (t) jdTitleToCode[t] = jdTitleToCode[t] === undefined ? code : null
      jdIndex.push({ code, comp: alnT(r[JCcomp]), title: simpT(r[JCtitle]) })
      if (!CLOSED_RE.test(String(r[JCstatus] || '').trim())) {
        jdOpen++
        jdOpenCodes.add(code)
        headcountOpen += parseInt(r[JCcount]) || 0
      }
    }
    const seen = new Set<string>()
    for (const r of ivRows.slice(2)) {
      const name = String(r[1] || '').trim()
      if (!name) continue
      if (!/[A-Z]{2,6}\d{3,4}/.test(String(r[13] || ''))) ivNoCodeRows++ // 공고코드 없는 면접 행 = 공고별 면접 누락 풀
      const key = String(r[2] || '').trim().toLowerCase() || name
      if (!seen.has(key)) { seen.add(key); ivPeople++ }
    }
    // 채널 귀속: candidates 이메일(위에서 공용 셋) + FYI + 이름 폴백용 final_passed 이름 셋
    // (지원 이메일 ≠ 온보딩 이메일 실사례가 있어 이메일 단독 매칭은 누락 발생)
    const fyiEmails = new Set(fyiApps.map(a => String(a.applicant_email).toLowerCase()))
    const fp = await fetchAll<any>(ktc, 'candidates', 'full_name, email, applied_company, applied_job, sheet_source', q => q.eq('pipeline_status', 'final_passed'))
    const norm = (s: any) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const fpNamesNorm = new Set(fp.map(c => norm(c.full_name)).filter(Boolean))
    const hIdx = empRows.findIndex((r: any[]) => r.includes('Name') && r.some((c: any) => /e-?mail/i.test(c || '')))
    const empEmails = new Set<string>()
    const empNamesNorm = new Set<string>()
    if (hIdx >= 0) {
      const H = empRows[hIdx]
      const col = (re: RegExp) => H.findIndex((c: any) => re.test(String(c || '').replace(/\n/g, ' ').trim()))
      const ci = { status: col(/^Status$/i), name: col(/^Name$/i), email: col(/^e-?mail$/i), company: col(/^Company$/i) }
      const byNameRev: Record<string, { rev: number; profit: number }> = {}
      const rIdx = revRows.findIndex((r: any[]) => r.some((c: any) => /기업명/.test(c || '')) && r.some((c: any) => /이름/.test(c || '')))
      if (rIdx >= 0) {
        const RH = revRows[rIdx]
        const rc = (re: RegExp) => RH.findIndex((c: any) => re.test(String(c || '').trim()))
        const rci = { name: rc(/^이름/), revenue: rc(/^총 ?매출액/), profit: rc(/^이익/) }
        for (const r of revRows.slice(rIdx + 1)) {
          const nm = String(r[rci.name] || '').toLowerCase().replace(/\s+/g, ' ').trim()
          if (!nm) continue
          const num = (x: any) => { const n = parseFloat(String(x || '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0 }
          byNameRev[nm] = { rev: num(r[rci.revenue]), profit: num(r[rci.profit]) }
        }
      }
      for (const r of empRows.slice(hIdx + 1)) {
        const email = String(r[ci.email] || '').trim().toLowerCase()
        const name = String(r[ci.name] || '').trim()
        if (name.length < 2 || /^\d+$/.test(name)) continue // 이메일 없는 행 포함, 카운트/집계 행만 스킵
        empTotal++
        if (email.includes('@')) empEmails.add(email)
        empNamesNorm.add(name.toLowerCase().replace(/\s+/g, ' ').trim())
        const attributed = candEmails.has(email) || fyiEmails.has(email) || fpNamesNorm.has(norm(name))
        if (attributed) {
          empAttributed++
          if (/^ing$/i.test(String(r[ci.status] || '').trim())) empIng++
          const m = byNameRev[name.toLowerCase().replace(/\s+/g, ' ').trim()]
          if (m) { revSum += m.rev; profitSum += m.profit }
          revenueStatus.push({
            name, email, company: String(r[ci.company] || '').trim(),
            매출현황: !m ? '행 없음' : m.rev > 0 ? `기입됨 ($${m.rev})` : '행은 있으나 총 매출액 공란/0',
          })
        }
      }
      // 매출현황에 있는데 Employee 이름과 매칭 안 되는 행 (오탈자 후보)
      for (const nm of Object.keys(byNameRev)) {
        if (!empNamesNorm.has(nm)) revRowsUnmatched.push(nm)
      }
    }
    // final_passed 인데 Employee 에 없는 인원 (이메일·이름 어느 쪽으로도 매칭 안 될 때만)
    for (const c of fp) {
      const emailHit = empEmails.has(String(c.email || '').toLowerCase())
      const nameHit = empNamesNorm.has(norm(c.full_name))
      if (!emailHit && !nameHit) {
        finalPassedNotInEmp++
        fpNotInEmpList.push({ name: c.full_name, email: c.email, company: c.applied_company, job: c.applied_job, channel: c.sheet_source })
      }
    }
  }

  // ── 독립 재집계: 지원 건 = CANDIDATE DATA 시트 직접 (2026-07-27 부터 대시보드와 같은 원천) ──
  // 탭별로 지원 건을 세면서 파이프라인 유입 여부(이메일 대조)도 함께 본다 —
  // 신규 탭이 ktc-support 동기화에 안 붙은 채 지원만 쌓이는 상황을 자동 감지하기 위함.
  const CANDIDATE = process.env.CANDIDATE_DATA_SHEET_ID || '13pvv1vQ8PklkIjOfuILD5sbKZJu0CRkiaXRXxUTOp88'
  const APP_SKIP = new Set(['log', 'FYI', 'Form Responses 1']) // aggregate 와 동일 스킵 규칙
  let sheetAppsTotal: number | null = null
  const tabStats: any[] = []
  if (sheet) {
    try {
      const cMeta = await sheet.spreadsheets.get({ spreadsheetId: CANDIDATE })
      const tabs: string[] = (cMeta.data.sheets || [])
        .map((s: any) => s.properties?.title || '')
        .filter((t: string) => t && !APP_SKIP.has(t))
      const cRes = await sheet.spreadsheets.values.batchGet({ spreadsheetId: CANDIDATE, ranges: tabs.map(t => `'${t}'!A1:Z`) })
      const values: any[][][] = (cRes.data.valueRanges || []).map((v: any) => v.values || [])
      let total = 0
      tabs.forEach((t, i) => {
        const rows = values[i]
        // 헤더행 = Email 류 열이 있는 첫 행. 이메일 열이 아예 없는 탭(예: Vieclam24h)은
        // 첫 행을 헤더로 보고 이름 열만으로 센다 (aggregate 의 parseAppSheet 와 같은 폴백 방향).
        let hIdx = rows.findIndex((r: any[]) => r.some((c: any) => /e-?mail/i.test(String(c || '').trim())))
        if (hIdx < 0) hIdx = 0
        const H: string[] = (rows[hIdx] || []).map((c: any) => String(c || '').replace(/\n/g, ' ').trim())
        const eCol = H.findIndex(h => /e-?mail/i.test(h))
        const nCol = H.findIndex(h => /name|họ|tên/i.test(h))
        const cCol = H.findIndex(h => /job\s*id/i.test(h))
        const jCol = H.findIndex(h => /applied\s*job|job\s*title|^job$|vị trí/i.test(h))
        const codeOf = (s: string) => (s.trim().match(/^([A-Z]{2,6}\d{3,4})/) || [])[1] || null
        let apps = 0
        const emails = new Set<string>()
        for (const r of rows.slice(hIdx + 1)) {
          const name = nCol >= 0 ? String(r[nCol] || '').trim() : ''
          const email = eCol >= 0 ? String(r[eCol] || '').trim().toLowerCase() : ''
          if (!name && !email) continue
          apps++
          if (email) emails.add(email)
          // 공고별 대조용: aggregate 의 parseAppSheet 와 같은 규칙(코드열 → 직무 텍스트 앞머리)
          const code = codeOf(cCol >= 0 ? String(r[cCol] || '') : '') || codeOf(jCol >= 0 ? String(r[jCol] || '') : '')
          if (code) sheetAppsByCode[code] = (sheetAppsByCode[code] || 0) + 1
          else sheetAppsNoCode++
        }
        total += apps
        const inPipe = [...emails].filter(e => candEmails.has(e)).length
        tabStats.push({
          탭: t, 지원건: apps, 고유이메일: emails.size,
          파이프라인유입: inPipe, 파이프라인미유입: emails.size - inPipe,
          candidates소스인원: candBySource[t] || 0,
        })
      })
      sheetAppsTotal = total
    } catch {
      sheetAppsTotal = null // 시트 실패 시 재적재본 기준으로 폴백 (대시보드 폴백과 동일 방향)
    }
  }
  // FYI 라이브 지원도 같은 대조에 포함 — 시트 탭이 아니라 탭별 재집계 대상은 아니지만,
  // FYI 지원자가 파이프라인에 안 들어오는 갭(2026-07-28 실사례: 19명, 6~7월 집중)을 상시 감시한다
  {
    const uniqFyi = [...new Set(fyiApps.map(a => String(a.applicant_email).toLowerCase()))]
    const inPipe = uniqFyi.filter(e => candEmails.has(e)).length
    tabStats.push({
      탭: 'FYI(라이브)', 지원건: fyiApps.length, 고유이메일: uniqFyi.length,
      파이프라인유입: inPipe, 파이프라인미유입: uniqFyi.length - inPipe,
      candidates소스인원: candBySource.FYI || 0,
    })
  }
  // 시트 탭에 지원이 쌓이는데 파이프라인에 이메일이 안 들어온 탭 = 스크리닝 누락 위험
  const tabsMissingPipeline = tabStats.filter(t => t.파이프라인미유입 > 0)

  // ── 공고별 지원 크로스소스 대조 (모집 중 공고 전수) ────────────────
  // 대시보드 공고별 '지원' = 시트 탭 코드 귀속 + FYI 라이브 제목 매칭. 여기서 같은 재료를
  // 독립 재집계해 공고 단위로 비교한다 — 총계만 보다가 FPT403(FYI 지원 15건이 0으로 표시)을
  // 놓친 부류의 맹점을 기계적으로 잡기 위함. 라이브 시트라 공고당 ±2건은 허용.
  const fyiJobById: Record<string, { title: string; company: string; sourceId: string; active: boolean }> = {}
  for (const j of ktcJobs) fyiJobById[j.id] = { title: String(j.title || ''), company: String(j.company || ''), sourceId: String(j.source_id || ''), active: !!j.is_active }
  // aggregate 의 fyiCodeForJob 과 동일: ① source_id 앞머리 코드 ② 제목 유니크(회사 가드) ③ 회사+제목 유사
  const fyiCode = (job: { title: string; company: string; sourceId: string }): string | null => {
    const jc = alnT(job.company)
    const compMatch = (c: string) => c === jc || (c.length >= 4 && jc.length >= 4 && (c.includes(jc) || jc.includes(c)))
    const fromId = (job.sourceId.match(/^([A-Z]{2,6}\d{3,4})/) || [])[1]
    if (fromId) return fromId
    const exact = jdTitleToCode[normT(job.title)]
    if (exact) {
      const owner = jdIndex.find(x => x.code === exact)
      if (!jc || !owner?.comp || compMatch(owner.comp)) return exact
    }
    const jt = simpT(job.title)
    const cands = jdIndex.filter(x => x.comp && jc && compMatch(x.comp))
    const strong = cands.filter(x => x.title === jt || (jt && (x.title.includes(jt) || jt.includes(x.title))))
    const p3 = (s: string) => s.split(' ').slice(0, 3).join(' ')
    const weak = cands.filter(x => p3(x.title) === p3(jt))
    const hit = strong.length ? strong : weak
    return new Set(hit.map(x => x.code)).size === 1 && hit.length ? hit[0].code : null
  }
  const fyiAppsByCode: Record<string, number> = {}
  const fyiUnattrByTitle: Record<string, { count: number; active: boolean }> = {}
  for (const a of fyiApps) {
    const job = fyiJobById[a.job_id]
    const code = job ? fyiCode(job) : null
    if (code) fyiAppsByCode[code] = (fyiAppsByCode[code] || 0) + 1
    else if (job) {
      const u = fyiUnattrByTitle[job.title] || (fyiUnattrByTitle[job.title] = { count: 0, active: job.active })
      u.count++
    }
  }
  const jdAppsMismatch: any[] = []
  for (const j of d.matching.jds) {
    if (!j.open) continue
    const expected = (sheetAppsByCode[j.code] || 0) + (fyiAppsByCode[j.code] || 0)
    if (Math.abs(j.apps - expected) > 2) {
      jdAppsMismatch.push({ 공고: j.code, 대시보드: j.apps, 시트재집계: sheetAppsByCode[j.code] || 0, FYI재집계: fyiAppsByCode[j.code] || 0 })
    }
  }
  // 어디에도 귀속 안 된 지원 풀 — 여기 쌓이는 것들이 다음 맹점 후보다 (모집 중 공고면 특히)
  const fyiUnattrList = Object.entries(fyiUnattrByTitle)
    .map(([title, v]) => ({ 공고제목: title, 지원건: v.count, 모집중: v.active }))
    .sort((a, b) => Number(b.모집중) - Number(a.모집중) || b.지원건 - a.지원건)
    .slice(0, 12)
  const fyiUnattrActive = fyiUnattrList.filter(x => x.모집중).reduce((s, x) => s + x.지원건, 0)

  // 구 상태값 잔존 인원 명단
  const legacyList = (await fetchAll<any>(ktc, 'candidates', 'full_name, email, sheet_source, applied_job, applied_company', q => q.eq('pipeline_status', 'ai_interview_passed')))
    .map(c => ({ name: c.full_name, email: c.email, channel: c.sheet_source, job: c.applied_job, company: c.applied_company }))

  // ── 대조표 ──
  const f = Object.fromEntries(d.matching.funnel.map(s => [s.key, s.count]))
  const chanSumPeople = d.supply.channels.reduce((s, c) => s + c.people, 0)
  const chanSumHires = d.supply.channels.reduce((s, c) => s + c.hires, 0)
  const monthlySum = d.supply.monthly.reduce((s, m) => s + m.count, 0)

  const checks = [
    { name: '지원자 (퍼널 1단계)', dashboard: f.people, source: expectedCandidates, note: `candidates ${candTotal} + FYI 추가분` },
    { name: '지원자 = 채널 표 합계', dashboard: f.people, source: chanSumPeople, note: '내부 일관성' },
    { name: '스크리닝 합격 도달', dashboard: f.screened, source: screenReached, note: 'status exact count 합' },
    { name: '기업 전달 도달', dashboard: f.delivered, source: deliveredReached, note: '' },
    { name: '면접 (사람 단위)', dashboard: f.interview, source: ivPeople, note: 'INTERVIEW 탭 재집계' },
    { name: '오퍼·계약 도달', dashboard: f.offer, source: (st.offer || 0) + (st.final_passed || 0), note: '' },
    { name: '입사 (final_passed)', dashboard: f.hired, source: st.final_passed || 0, note: '' },
    { name: '입사 = 채널 표 입사 합', dashboard: f.hired, source: chanSumHires, note: '내부 일관성' },
    {
      name: '지원 건',
      dashboard: d.supply.applicationsTotal,
      source: sheetAppsTotal != null ? sheetAppsTotal + fyiApps.length : expectedApps,
      tol: 2, // 라이브 시트라 두 읽기 사이에 지원이 새로 붙을 수 있음
      note: sheetAppsTotal != null
        ? `CANDIDATE DATA 시트 ${sheetAppsTotal} + FYI 라이브 ${fyiApps.length} · 재적재본(ktc_applications ${appsKtc})은 진단 참조`
        : `시트 읽기 실패 — 재적재본 폴백 ktc_applications ${appsKtc} + FYI ${fyiApps.length}`,
    },
    { name: '월별 합계 ≤ 지원 건', dashboard: monthlySum, source: sheetAppsTotal != null ? sheetAppsTotal + fyiApps.length : expectedApps, note: '날짜 파싱 커버리지 (최근 12개월 창)' },
    { name: '인재풀 이력서', dashboard: d.supply.talentPoolResume, source: resume, note: '' },
    { name: '인재풀 공개', dashboard: d.supply.talentPoolPublic, source: resumePublic, note: '' },
    { name: '진행중: 스크리닝 대기', dashboard: d.matching.inProgress.screeningQueue, source: st.new || 0, note: '' },
    { name: '진행중: 합격 후 대기', dashboard: d.matching.inProgress.screenPassed, source: st.passed || 0, note: '' },
    { name: '진행중: 발송 대기', dashboard: d.matching.inProgress.readyToForward, source: st.ready_to_forward || 0, note: '' },
    { name: '진행중: 기업 검토', dashboard: d.matching.inProgress.sentToCompany, source: st.sent_to_company || 0, note: '' },
    { name: '진행중: 면접', dashboard: d.matching.inProgress.interviewing, source: st.interviewing || 0, note: '' },
    { name: '공고별 지원 대조 불일치 (모집 중, ±2 허용)', dashboard: jdAppsMismatch.length, source: 0, note: '시트 코드 귀속 + FYI 제목 매칭 독립 재집계와 공고 단위 비교' },
    { name: 'FYI 지원 공고미귀속 (모집 중 공고)', dashboard: fyiUnattrActive, source: 0, note: '모집 중인 FYI 공고인데 원장 제목과 매칭 실패 — 공고별 표시 누락 위험 (상세 details)' },
    { name: '공고 수 (전체)', dashboard: d.matching.jds.length, source: jdTotal, note: 'JD EXECUTION 재집계' },
    { name: '오픈 공고', dashboard: d.matching.openJds, source: jdOpen, note: '' },
    { name: '오픈 공고 TO 합', dashboard: d.matching.headcountTotal, source: headcountOpen, note: '' },
    { name: '재직 중 (귀속)', dashboard: d.headline.working, source: empIng, note: 'Employee Ing ∩ 파이프라인' },
    { name: '입사자 시트 귀속 인원', dashboard: d.headline.working + d.headline.left, source: empAttributed, note: `Employee 전체 ${empTotal}명 중 귀속` },
    { name: '파이프라인 외 입사 (제외분)', dashboard: d.outcome.excludedHires, source: empTotal - empAttributed, note: '' },
    { name: '총 매출 USD (귀속)', dashboard: Math.round(d.headline.revenueUsd), source: Math.round(revSum), note: '매출현황 이름 매칭' },
    { name: '총 이익 USD (귀속)', dashboard: Math.round(d.headline.profitUsd), source: Math.round(profitSum), note: '' },
    { name: 'VN 공고 (누적)', dashboard: d.vietnam.jobsTotal, source: vnJobs.length, note: '' },
    { name: 'VN 활성 공고', dashboard: d.vietnam.jobsActive, source: vnJobs.filter(j => j.is_active).length, note: '' },
    { name: 'VN 기업 수', dashboard: d.vietnam.companies, source: new Set(vnJobs.map(j => String(j.company || '').trim().toLowerCase()).filter(Boolean)).size, note: '' },
    { name: 'VN 지원 건', dashboard: d.vietnam.applications, source: vnApps.length, note: '' },
    { name: 'VN 기업 열람', dashboard: d.vietnam.viewed, source: vnApps.filter(a => a.viewed_at).length, note: '' },
  ].map((c: any) => ({
    ...c,
    ok:
      c.tol != null ? Math.abs(c.dashboard - c.source) <= c.tol
      : c.name.startsWith('월별') ? c.dashboard <= c.source
      : c.dashboard === c.source,
  }))

  // 퍼널 단조 감소 (단계별 역전 없음)
  const order = ['people', 'screened', 'delivered', 'interview', 'offer', 'hired']
  const monotonic = order.every((k, i) => i === 0 || (f[k] ?? 0) <= (f[order[i - 1]] ?? 0))

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    pass: checks.every(c => c.ok) && monotonic,
    monotonicFunnel: monotonic,
    diagnostics: {
      candidatesTotal: candTotal,
      statusCounts: st,
      pipeFyiPeople,
      fyiUniqApplicants: fyiUniq,
      finalPassedNotInEmployeeSheet: finalPassedNotInEmp,
      employeeTotal: empTotal,
      // 재적재본 편차 (원천 아님·관찰용): landing 중복성 행, 신규 탭 미반영이 여기서 드러난다
      지원건_시트직접: sheetAppsTotal,
      지원건_재적재본: appsKtc,
    },
    details: {
      입사했는데_Employee탭_미기입: fpNotInEmpList,
      구상태값_ai_interview_passed_잔존: legacyList,
      귀속입사자_매출현황_기입상태: revenueStatus,
      매출현황에만_있고_Employee와_이름불일치: revRowsUnmatched,
      // 탭별 지원 건 + 파이프라인 유입 대조 — 미유입>0 이면 최근 지원 대기(동기화 지연) 또는 동기화 대상 누락
      시트탭별_지원건_파이프라인유입: tabStats,
      파이프라인_미유입_있는_탭: tabsMissingPipeline.map(t => t.탭),
      // 공고별 크로스소스 대조 (FPT403 재발 방지) — 불일치·미귀속 풀이 다음 맹점 후보
      공고별_지원_불일치: jdAppsMismatch,
      FYI_공고별_귀속_상위: Object.entries(fyiAppsByCode).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => ({ 공고: c, FYI지원: n })),
      FYI_공고미귀속_지원: fyiUnattrList,
      시트_코드미귀속_지원건: sheetAppsNoCode,
      면접_공고코드_없는_행: ivNoCodeRows,
    },
    checks,
  })
}
