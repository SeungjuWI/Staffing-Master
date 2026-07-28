// 정합성 점검 — 소스끼리 어긋나는 곳을 상시 자동으로 찾아낸다 (2026-07-28 대표 지시).
//
// 배경: 공고별 '입사'가 이탈자를 계속 세거나(파이프라인 final_passed), TO 가 원장과 다르거나,
// 폐지된 단계를 면접으로 세는 문제가 한 번에 하나씩 터져 나왔다. 그때마다 수동 대조하지 않도록
// 대조 자체를 화면에 붙인다. 시트를 고치면 다음 새로고침에 항목이 스스로 사라진다.
//
// 원칙: 여기서는 "판단"하지 않는다. 어느 소스가 뭐라고 하는지 나란히 보여주고, 조치 대상만 특정한다.

import type { AuditGroup, AuditItem, JdRow } from './types'

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '')
const numOf = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}
const CODE_RE = /\b[A-Z]{2,4}\d{3,5}\b/g

/** 헤더 이름으로 열 위치를 찾는다 — 이 시트들은 컬럼이 자주 이동해 인덱스 하드코딩이 금지다 */
const colFinder = (header: any[]) => (re: RegExp, fallback = -1) => {
  const i = (header || []).findIndex(h => re.test(String(h ?? '').replace(/\n/g, ' ').trim()))
  return i >= 0 ? i : fallback
}

export type AuditInput = {
  jdSheet: any[][]
  toSheet: any[][]
  empSheet: any[][]
  revSheet: any[][]
  opsDash: any[][]
  jdDaily: any[][]
  candidates: any[]
  fyiJobs: { title: string; company: string; sourceId: string; status: string }[]
  jds: JdRow[]
  funnel: { key: string; count: number }[]
  revenueUsd: number
  closedRe: RegExp
}

export function buildAudit(input: AuditInput): AuditGroup[] {
  const { jdSheet, toSheet, empSheet, revSheet, opsDash, jdDaily, candidates, fyiJobs, jds, funnel, revenueUsd, closedRe } = input

  // ── 소스 파싱 ────────────────────────────────────────────────
  const jdHi = jdSheet.findIndex(r => (r || []).some(c => /job id/i.test(String(c ?? ''))))
  const jdCol = colFinder(jdSheet[jdHi] || [])
  const JC = { code: jdCol(/job id/i, 0), comp: jdCol(/company/i, 1), hc: jdCol(/headcount/i, 6), st: jdCol(/job status/i, 9) }
  const jdRows = jdSheet.slice(jdHi + 1).filter(r => String((r || [])[JC.code] ?? '').trim())
  const jdByCode = new Map(jdRows.map(r => [String(r[JC.code]).trim().toUpperCase(), r]))

  const toHi = toSheet.findIndex(r => (r || []).some(c => /vn\s*code/i.test(String(c ?? ''))))
  const toCol = colFinder(toSheet[toHi] || [])
  const TC = {
    code: toCol(/vn\s*code/i, 2), comp: toCol(/company/i, 4), state: toCol(/현재\s*상태/, 5),
    match: toCol(/^매칭$/, 11), left: toCol(/이탈일/, 12), fnb: toCol(/funnel\s*기준/i, 14), cat: toCol(/category/i, 16),
  }
  const toRows = toHi < 0 ? [] : toSheet.slice(toHi + 1).filter(r => String((r || [])[TC.code] ?? '').trim())

  const empHi = empSheet.findIndex(r => (r || []).includes('Name') && r.some((c: any) => /e-?mail/i.test(c || '')))
  const empCol = colFinder(empSheet[empHi] || [])
  const EC = { st: empCol(/^Status$/i, 1), comp: empCol(/^Company$/i, 3), name: empCol(/^Name$/i, 8), rev: empCol(/^TOTAL\s*Revenue$/i, 20) }
  const empRows = empHi < 0 ? [] : empSheet.slice(empHi + 1).filter(r => {
    const n = String((r || [])[EC.name] ?? '').trim()
    return n.length >= 2 && !/^\d+$/.test(n)
  })

  const revHi = revSheet.findIndex(r => (r || []).some(c => /기업명/.test(String(c ?? ''))))
  const revCol = colFinder(revSheet[revHi] || [])
  const RC = { name: revCol(/^이름/, 2), rev: revCol(/^총 ?매출액/, 6) }
  const revRows = revHi < 0 ? [] : revSheet.slice(revHi + 1).filter(r => String((r || [])[RC.name] ?? '').trim())

  // TO 원장 집계
  const toByCode: Record<string, { to: number; m: number; d: number; p: number; comp: string }> = {}
  for (const r of toRows) {
    const c = String(r[TC.code]).trim().toUpperCase()
    const b = toByCode[c] || (toByCode[c] = { to: 0, m: 0, d: 0, p: 0, comp: String(r[TC.comp] ?? '').trim() })
    const st = String(r[TC.state] ?? '').trim()
    b.to++
    if (st === '매칭') b.m++
    else if (st === '이탈') b.d++
    else if (st === '진행중') b.p++
  }

  const items: AuditItem[] = []
  const add = (i: AuditItem) => { if (i.count > 0) items.push(i) }

  // ── A. 팀 KPI(Ops Dashboard) 대조 ────────────────────────────
  // Dashboard 탭은 라벨행 바로 아래가 값행이다. 라벨행은 'Conversion Rate' 로 특정한다 —
  // 'Matches' 만 찾으면 그 위의 병합 그룹 헤더(Company/Candidate/Matches)에 먼저 걸린다.
  const dashLabelRow = opsDash.findIndex(r => (r || []).some(c => /conversion\s*rate/i.test(String(c ?? '').replace(/\n/g, ' '))))
  const dashVal = (re: RegExp): number | null => {
    if (dashLabelRow < 0) return null
    const i = (opsDash[dashLabelRow] || []).findIndex(c => re.test(String(c ?? '').replace(/\n/g, ' ').trim()))
    if (i < 0) return null
    const v = (opsDash[dashLabelRow + 1] || [])[i]
    return v == null || String(v).trim() === '' ? null : numOf(v)
  }
  const dashRevenue = (() => {
    const row = opsDash.findIndex(r => (r || []).some(c => /^\s*\(USD\)/i.test(String(c ?? ''))))
    if (row < 0) return null
    const r = opsDash[row] || []
    for (let i = r.length - 1; i >= 0; i--) if (numOf(r[i]) > 0) return numOf(r[i])
    return null
  })()

  const toTotal = toRows.length
  const toMatched = Object.values(toByCode).reduce((s, b) => s + b.m, 0)
  const empRev = empRows.reduce((s, r) => s + numOf(r[EC.rev]), 0)
  const revSum = revRows.reduce((s, r) => s + numOf(r[RC.rev]), 0)
  const fp = candidates.filter(c => (c.pipeline_status || '') === 'final_passed').length

  const dashTo = dashVal(/total\s+to/i)
  const dashMatches = dashVal(/matches/i)
  const dashPosition = dashVal(/^position$/i)
  const dashCv = dashVal(/^cv$/i)
  const dashRecommended = dashVal(/recommended/i)
  const dashInterview = dashVal(/^interview$/i)
  const dashAiIv = dashVal(/ai\s*interview/i)
  const fv = (k: string) => funnel.find(f => f.key === k)?.count ?? 0

  if (dashRevenue != null && Math.round(dashRevenue) !== Math.round(revenueUsd)) {
    add({
      id: 'A1', title: '매출이 소스마다 다릅니다', severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard (USD 행) · Employee U열 · 매출현황 G열',
      rows: [
        { label: 'Ops Dashboard (계약 총액)', value: `$${Math.round(dashRevenue).toLocaleString()}` },
        { label: 'Employee U열 TOTAL Revenue 합', value: `$${Math.round(empRev).toLocaleString()}` },
        { label: '매출현황 G열 합 (실현)', value: `$${Math.round(revSum).toLocaleString()}` },
        { label: '이 대시보드 (실현·귀속분)', value: `$${Math.round(revenueUsd).toLocaleString()}` },
      ],
      note: 'Employee U열 = 계약 기간 총액, 매출현황 G열 = 실현 매출로 확인됨 (배수가 Employee V열 계약 개월수와 일치). 성격이 다른 숫자.',
    })
  }
  if (dashMatches != null && dashMatches !== toMatched) {
    add({
      id: 'A2', title: "'채용 성사'가 소스마다 다릅니다", severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard Matches · TO_Table_수정 F열 · Employee · ktc-support',
      rows: [
        { label: 'Ops Dashboard Matches (KPI)', value: `${dashMatches}` },
        { label: "TO_Table 현재 상태 = '매칭'", value: `${toMatched}` },
        { label: 'Employee 시트 인원', value: `${empRows.length}` },
        { label: '파이프라인 final_passed', value: `${fp}` },
      ],
    })
  }
  if (dashTo != null && dashTo !== toTotal) {
    add({
      id: 'A3', title: 'TO 총량이 다릅니다', severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard TOTAL TO · TO_Table_수정 행 수',
      rows: [
        { label: 'Ops Dashboard TOTAL TO', value: `${dashTo}` },
        { label: 'TO_Table 자리 수', value: `${toTotal}` },
      ],
    })
  }
  if (dashPosition != null && dashPosition !== jdRows.length) {
    add({
      id: 'A4', title: '공고 수가 다릅니다', severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard Position · JD EXECUTION A열',
      rows: [
        { label: 'Ops Dashboard Position', value: `${dashPosition}` },
        { label: 'JD EXECUTION 공고', value: `${jdRows.length}` },
        { label: 'TO_Table 고유 공고코드', value: `${Object.keys(toByCode).length}` },
      ],
    })
  }
  const funnelDiffs = [
    ['CV / 지원자', dashCv, fv('people')],
    ['Recommended / 기업 전달', dashRecommended, fv('delivered')],
    ['Interview / 면접', dashInterview, fv('interview')],
  ].filter(([, a, b]) => a != null && a !== b) as [string, number, number][]
  if (funnelDiffs.length) {
    add({
      id: 'A5', title: '퍼널 단계 수치가 팀 KPI와 다릅니다', severity: 'high', count: funnelDiffs.length,
      path: '2026 KTC Ops. › Dashboard 4행 라벨 / 5행 값',
      rows: funnelDiffs.map(([label, a, b]) => ({ label, value: `Ops ${a.toLocaleString()} · 대시보드 ${b.toLocaleString()}` })),
    })
  }
  if (dashAiIv != null && dashAiIv > 0) {
    add({
      id: 'A6', title: '폐지된 AI 인터뷰 단계가 팀 KPI에 남아 있습니다', severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard AI Interview',
      rows: [
        { label: 'Ops Dashboard AI Interview', value: dashAiIv.toLocaleString() },
        { label: 'ktc-support ai_interview_* 잔존', value: `${candidates.filter(c => /^ai_interview/.test(c.pipeline_status || '')).length}` },
      ],
    })
  }
  // JD DAILY 하단의 "N CV chưa gán được mã JD" 경고행 — 공고 코드가 안 붙은 지원
  const dailyWarn = jdDaily.flat().map(c => String(c ?? '')).find(s => /chưa gán được mã JD/i.test(s))
  if (dailyWarn) {
    const n = numOf((dailyWarn.match(/([\d,]+)\s*CV/i) || [])[1])
    if (n > 0) {
      add({
        id: 'A7', title: 'JD 코드가 안 붙은 지원이 있습니다', severity: 'high', count: n,
        path: 'V2_KTC2026_MASTER_ADJUSTED › 📊 JD DAILY 하단 경고행',
        rows: [{ label: '코드 미귀속 CV', value: `${n.toLocaleString()}건` }],
        note: dailyWarn.replace(/\s+/g, ' ').trim().slice(0, 160),
      })
    }
  }

  // ── B. TO_Table 내부 모순 ────────────────────────────────────
  const label = (r: any[]) => `${String(r[TC.code] ?? '').trim()} ${String(r[TC.comp] ?? '').trim()}`.trim()
  const b1 = toRows.filter(r => String(r[TC.state]).trim() === '매칭' && !String(r[TC.match] ?? '').trim())
  add({
    id: 'B1', title: "현재 상태 = '매칭' 인데 매칭일이 비어 있음", severity: 'mid', count: b1.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × L열', codes: b1.map(label),
  })
  const b2 = toRows.filter(r => String(r[TC.state]).trim() === '이탈' && !String(r[TC.left] ?? '').trim())
  add({
    id: 'B2', title: "현재 상태 = '이탈' 인데 이탈일이 비어 있음", severity: 'mid', count: b2.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × M열', codes: b2.map(label),
    note: '이탈 시점 통계를 낼 수 없습니다.',
  })
  const b3 = toRows.filter(r => !String(r[TC.state] ?? '').trim())
  add({
    id: 'B3', title: '현재 상태가 비어 있음 — 진행중·이탈 어느 쪽으로도 안 셉니다', severity: 'mid', count: b3.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열', codes: b3.map(label),
  })
  const b4 = toRows.filter(r => String(r[TC.state]).trim() === '매칭' && String(r[TC.fnb] ?? '').trim() !== '매칭')
  add({
    id: 'B4', title: "O열(Funnel 기준)이 F열(현재 상태)과 어긋남", severity: 'mid', count: b4.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × O열',
    note: '대시보드는 F열만 읽습니다. O열이 갱신이 밀린 열인지 확인이 필요합니다.',
  })

  // ── C. TO_Table ↔ JD EXECUTION ───────────────────────────────
  const c1 = Object.entries(toByCode).filter(([c, b]) => jdByCode.has(c) && (parseInt(jdByCode.get(c)![JC.hc]) || 0) !== b.to)
  add({
    id: 'C1', title: 'TO 자리 수 ≠ JD 원장 Headcount', severity: 'mid', count: c1.length,
    path: 'TO_Table 행 수 × JD EXECUTION G열',
    rows: c1.map(([c, b]) => ({
      label: `${c} ${b.comp}`,
      value: `TO_Table ${b.to} · Headcount ${String(jdByCode.get(c)![JC.hc] ?? '').trim() || '빈칸'}`,
    })),
    note: '대시보드는 TO_Table 을 우선합니다.',
  })
  const c2 = [...jdByCode.entries()]
    .filter(([c, r]) => !closedRe.test(String(r[JC.st] ?? '').trim()) && !toByCode[c])
    .map(([c, r]) => `${c} ${String(r[JC.comp] ?? '').trim()}`)
  add({
    id: 'C2', title: '진행 중 공고인데 TO_Table 에 자리가 없음', severity: 'mid', count: c2.length,
    path: 'JD EXECUTION J열 진행 중 × TO_Table C열', codes: c2,
    note: 'TO 를 JD 원장 Headcount 로 폴백해 세고 있습니다.',
  })
  const c3 = Object.entries(toByCode).filter(([c]) => !jdByCode.has(c)).map(([c, b]) => `${c} ${b.comp} (매칭 ${b.m})`)
  add({
    id: 'C3', title: 'TO_Table 에만 있고 JD 원장에 없는 공고코드', severity: 'mid', count: c3.length,
    path: 'TO_Table C열 × JD EXECUTION A열', codes: c3,
    note: '어느 공고에도 안 붙어 대시보드 집계에서 빠집니다.',
  })

  // ── D. 매칭 ↔ 입사자 원장 ────────────────────────────────────
  const empByComp: Record<string, any[]> = {}
  for (const r of empRows) (empByComp[norm(r[EC.comp])] || (empByComp[norm(r[EC.comp])] = [])).push(r)
  const fpByCode: Record<string, string[]> = {}
  for (const c of candidates.filter(x => (x.pipeline_status || '') === 'final_passed')) {
    const m = String(c.applied_job || '').match(CODE_RE)
    const key = m ? m[0].toUpperCase() : '(코드없음)'
    ;(fpByCode[key] || (fpByCode[key] = [])).push(String(c.full_name || ''))
  }
  const d1 = Object.entries(toByCode)
    .filter(([, b]) => b.m > 0)
    .filter(([c, b]) => (empByComp[norm(b.comp)] || []).length !== b.m || (fpByCode[c] || []).length !== b.m)
  add({
    id: 'D1', title: '매칭 자리 수와 입사자 원장이 공고 단위로 안 맞음', severity: 'mid', count: d1.length,
    path: "TO_Table F열 '매칭' × Employee D열 × ktc-support final_passed",
    rows: d1.map(([c, b]) => ({
      label: `${c} ${b.comp}`,
      value: `매칭 ${b.m} · Employee ${(empByComp[norm(b.comp)] || []).length} · 파이프라인 ${(fpByCode[c] || []).length}`,
    })),
    note: '파이프라인은 상태 갱신이 밀리면 0으로 나옵니다.',
  })
  const toComps = new Set(Object.values(toByCode).filter(b => b.m > 0).map(b => norm(b.comp)))
  const d2 = Object.entries(empByComp)
    .filter(([k]) => !toComps.has(k))
    .map(([, rows]) => `${String(rows[0][EC.comp] ?? '').trim()} (${rows.length}명)`)
  add({
    id: 'D2', title: 'Employee 에 있는데 TO_Table 에 매칭 자리가 없는 회사', severity: 'mid', count: d2.length,
    path: 'Employee D열 × TO_Table E열', codes: d2,
    note: 'KTC 매칭 실적인지, 자사 채용·별도 경로인지 확인이 필요합니다. 지금은 공고별 집계에서 빠져 있습니다.',
  })
  add({
    id: 'D3', title: '입사 확정인데 지원 공고 코드가 없음', severity: 'mid', count: (fpByCode['(코드없음)'] || []).length,
    path: 'ktc-support › candidates.applied_job', codes: fpByCode['(코드없음)'] || [],
  })

  // ── E. 공고 게시 상태 ────────────────────────────────────────
  const codeOfFyi = (j: { sourceId: string }) => (String(j.sourceId || '').match(CODE_RE) || [])[0]?.toUpperCase() || null
  const liveJobs = fyiJobs.filter(j => j.status === 'live')
  const e1 = liveJobs
    .map(j => ({ j, c: codeOfFyi(j) }))
    .filter(({ c }) => c && jdByCode.has(c) && closedRe.test(String(jdByCode.get(c)![JC.st] ?? '').trim()))
    .map(({ j, c }) => `${c} ${j.company} [${String(jdByCode.get(c!)![JC.st]).trim()}]`)
  add({
    id: 'E1', title: 'FYI 에 게시 중인데 원장은 마감 — 지원이 계속 들어옵니다', severity: 'mid', count: e1.length,
    path: 'salarymap jobs.status = live × JD EXECUTION J열', codes: e1,
    note: 'FYI 에서 공고를 내려야 합니다.',
  })
  const e2 = liveJobs.filter(j => !codeOfFyi(j)).map(j => `${j.company} — ${j.title}`)
  add({
    id: 'E2', title: 'FYI 에 게시 중인데 공고 코드가 없음', severity: 'mid', count: e2.length,
    path: 'salarymap jobs.source_id 비어 있음', codes: e2,
    note: '지원자가 어느 공고 실적인지 안 붙습니다.',
  })
  const fyiCodes = new Set(fyiJobs.map(codeOfFyi).filter(Boolean) as string[])
  const e3 = [...jdByCode.entries()]
    .filter(([c, r]) => !closedRe.test(String(r[JC.st] ?? '').trim()) && !fyiCodes.has(c))
    .map(([c, r]) => `${c} ${String(r[JC.comp] ?? '').trim()}`)
  add({
    id: 'E3', title: '원장은 진행 중인데 FYI 에 공고가 없음', severity: 'low', count: e3.length,
    path: 'JD EXECUTION J열 진행 중 × salarymap jobs', codes: e3,
  })
  const e4 = Object.entries(toByCode)
    .filter(([c, b]) => b.p > 0 && jdByCode.has(c) && closedRe.test(String(jdByCode.get(c)![JC.st] ?? '').trim()))
    .map(([c, b]) => `${c} ${b.comp} 진행중 ${b.p}자리 [${String(jdByCode.get(c)![JC.st]).trim()}]`)
  add({
    id: 'E4', title: "공고는 마감인데 TO 자리는 '진행중'", severity: 'low', count: e4.length,
    path: 'TO_Table F열 × JD EXECUTION J열', codes: e4,
  })
  const e5 = jds
    .filter(j => j.open && j.headcount != null && j.hiresAll >= j.headcount)
    .map(j => `${j.code} ${j.company} [${j.status || '진행 중'}]`)
  add({
    id: 'E5', title: '충원이 끝났는데 공고가 안 닫혔습니다', severity: 'low', count: e5.length,
    path: 'JD EXECUTION J열', codes: e5,
    note: "'Closed - Filled' 로 바꾸면 진행 중 목록에서 빠집니다.",
  })

  const GROUPS: { key: AuditGroup['key']; title: string; hint: string; ids: string[] }[] = [
    { key: 'kpi', title: '팀 KPI와 숫자가 다름', hint: 'KTC Ops › Dashboard 탭과 이 대시보드가 같은 항목을 다르게 셉니다.', ids: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] },
    { key: 'to', title: 'TO_Table 내부 모순', hint: 'TO·충원의 정본이라 여기 빈칸·모순이 화면에 그대로 반영됩니다.', ids: ['B1', 'B2', 'B3', 'B4'] },
    { key: 'ledger', title: '원장끼리 안 맞음', hint: 'TO_Table 과 JD EXECUTION 의 공고·TO 대조입니다.', ids: ['C1', 'C2', 'C3'] },
    { key: 'hire', title: '매칭 ↔ 입사자', hint: '매칭 자리와 실제 입사자 원장의 대조입니다.', ids: ['D1', 'D2', 'D3'] },
    { key: 'posting', title: '공고 게시 상태', hint: '지원이 계속 들어오거나, 받아야 할 공고가 안 열려 있는 경우입니다.', ids: ['E1', 'E2', 'E3', 'E4', 'E5'] },
  ]

  return GROUPS.map(g => ({
    key: g.key,
    title: g.title,
    hint: g.hint,
    items: g.ids.map(id => items.find(i => i.id === id)).filter(Boolean) as AuditItem[],
  })).filter(g => g.items.length > 0)
}
