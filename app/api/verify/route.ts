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
  const appsKtc = await cnt(fyi, 'ktc_applications')
  const resume = await cnt(fyi, 'user_profiles', q => q.not('resume_url', 'is', null))
  const resumePublic = await cnt(fyi, 'user_profiles', q => q.not('resume_url', 'is', null).eq('is_resume_public', true))

  const ktcJobs = await fetchAll<any>(fyi, 'jobs', 'id', q => q.eq('source', 'ktc'))
  let fyiApps: any[] = []
  for (let i = 0; i < ktcJobs.length; i += 50) {
    fyiApps = fyiApps.concat(await fetchAll<any>(fyi, 'job_applications', 'applicant_email', q => q.in('job_id', ktcJobs.slice(i, i + 50).map(j => j.id))))
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

  let jdTotal = 0, jdOpen = 0, headcountOpen = 0, ivPeople = 0
  let empTotal = 0, empIng = 0, empAttributed = 0, revSum = 0, profitSum = 0
  let finalPassedNotInEmp = 0
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

    for (const r of jdRows.slice(3)) {
      if (!String(r[0] || '').trim()) continue
      jdTotal++
      // Job Status=J(9), Headcount=G(6) — aggregate.ts 와 동일한 실측 인덱스
      if (!CLOSED_RE.test(String(r[9] || '').trim())) {
        jdOpen++
        headcountOpen += parseInt(r[6]) || 0
      }
    }
    const seen = new Set<string>()
    for (const r of ivRows.slice(2)) {
      const name = String(r[1] || '').trim()
      if (!name) continue
      const key = String(r[2] || '').trim().toLowerCase() || name
      if (!seen.has(key)) { seen.add(key); ivPeople++ }
    }
    // 채널 귀속용 이메일 셋 (candidates + FYI) + 이름 폴백용 final_passed 이름 셋
    // (지원 이메일 ≠ 온보딩 이메일 실사례가 있어 이메일 단독 매칭은 누락 발생)
    const candEmails = new Set(
      (await fetchAll<any>(ktc, 'candidates', 'email')).map(c => String(c.email || '').toLowerCase()).filter(Boolean),
    )
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
    { name: '지원 건', dashboard: d.supply.applicationsTotal, source: expectedApps, note: `ktc_applications ${appsKtc} + FYI ${fyiApps.length}` },
    { name: '월별 합계 ≤ 지원 건', dashboard: monthlySum, source: expectedApps, note: `날짜 파싱 커버리지 ${expectedApps ? Math.round((monthlySum / expectedApps) * 100) : 0}% (최근 12개월 창)` },
    { name: '인재풀 이력서', dashboard: d.supply.talentPoolResume, source: resume, note: '' },
    { name: '인재풀 공개', dashboard: d.supply.talentPoolPublic, source: resumePublic, note: '' },
    { name: '진행중: 스크리닝 대기', dashboard: d.matching.inProgress.screeningQueue, source: st.new || 0, note: '' },
    { name: '진행중: 발송 대기', dashboard: d.matching.inProgress.readyToForward, source: st.ready_to_forward || 0, note: '' },
    { name: '진행중: 기업 검토', dashboard: d.matching.inProgress.sentToCompany, source: st.sent_to_company || 0, note: '' },
    { name: '진행중: 면접', dashboard: d.matching.inProgress.interviewing, source: st.interviewing || 0, note: '' },
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
  ].map(c => ({ ...c, ok: c.dashboard === c.source || (c.name.startsWith('월별') && c.dashboard <= c.source) }))

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
    },
    details: {
      입사했는데_Employee탭_미기입: fpNotInEmpList,
      구상태값_ai_interview_passed_잔존: legacyList,
      귀속입사자_매출현황_기입상태: revenueStatus,
      매출현황에만_있고_Employee와_이름불일치: revRowsUnmatched,
    },
    checks,
  })
}
