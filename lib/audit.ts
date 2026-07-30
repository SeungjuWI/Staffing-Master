// 정합성 점검 — 소스끼리 어긋나는 곳을 상시 자동으로 찾아낸다 (2026-07-28 대표 지시).
//
// 배경: 공고별 '입사'가 이탈자를 계속 세거나(파이프라인 final_passed), TO 가 원장과 다르거나,
// 폐지된 단계를 면접으로 세는 문제가 한 번에 하나씩 터져 나왔다. 그때마다 수동 대조하지 않도록
// 대조 자체를 화면에 붙인다. 시트를 고치면 다음 새로고침에 항목이 스스로 사라진다.
//
// 원칙: 여기서는 "판단"하지 않는다. 어느 소스가 뭐라고 하는지 나란히 보여주고, 조치 대상만 특정한다.

import type { AuditGroup, AuditItem, JdRow } from './types'

const S = (v: unknown) => String(v ?? '').trim()
const norm = (v: unknown) => S(v).toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
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
  /** 파이프라인에 안 붙어 집계에서 빠진 입사자 — 매출 차이의 실제 원인을 지목하는 데 쓴다 */
  unattributedHires: { company: string; name: string; revenue: number }[]
  closedRe: RegExp
}

export function buildAudit(input: AuditInput): AuditGroup[] {
  const { jdSheet, toSheet, empSheet, revSheet, opsDash, jdDaily, candidates, fyiJobs, jds, funnel, revenueUsd, unattributedHires, closedRe } = input

  // ── 소스 파싱 ────────────────────────────────────────────────
  const jdHi = jdSheet.findIndex(r => (r || []).some(c => /job id/i.test(String(c ?? ''))))
  const jdCol = colFinder(jdSheet[jdHi] || [])
  const JC = { code: jdCol(/job id/i, 0), comp: jdCol(/company/i, 1), hc: jdCol(/headcount/i, 6), st: jdCol(/job status/i, 9) }
  const jdRows = jdSheet.slice(jdHi + 1).filter(r => String((r || [])[JC.code] ?? '').trim())
  const jdByCode = new Map(jdRows.map(r => [String(r[JC.code]).trim().toUpperCase(), r]))

  const toHi = toSheet.findIndex(r => (r || []).some(c => /vn\s*code/i.test(String(c ?? ''))))
  const toCol = colFinder(toSheet[toHi] || [])
  const TC = {
    id: toCol(/^to\s*id$/i, 0), ops: toCol(/^code$/i, 1),
    code: toCol(/vn\s*code/i, 2), comp: toCol(/company/i, 4), state: toCol(/현재\s*상태/, 5),
    match: toCol(/^매칭$/, 11), left: toCol(/이탈일/, 12), fnb: toCol(/funnel\s*기준/i, 14), cat: toCol(/category/i, 16),
  }
  // TO 행의 식별자는 TO ID·Code(운영 코드)다. 공고코드(VN Code)는 빈 행이 있어 — 2026-07-30 확인:
  // 120행 중 28행이 비어 있고 그중 '매칭'이 19건 — 공고코드로 행을 걸러내면 TO 총량과 매칭이
  // 통째로 빠진다. 이게 팀 KPI 와 어긋나 보이던 실제 원인이었다 (매칭 28 로 세다가 47 이 정답).
  const toRows = toHi < 0 ? [] : toSheet.slice(toHi + 1).filter(r => S((r || [])[TC.id]) || S((r || [])[TC.ops]))
  const codedRows = toRows.filter(r => S(r[TC.code]))     // 공고코드 있음 → 공고별 대조 가능
  const codelessRows = toRows.filter(r => !S(r[TC.code])) // 공고에 안 붙어 공고별 집계에서 빠지는 자리

  const empHi = empSheet.findIndex(r => (r || []).includes('Name') && r.some((c: any) => /e-?mail/i.test(c || '')))
  const empCol = colFinder(empSheet[empHi] || [])
  // Code 열(C)은 TO_Table 의 Code 열(B)과 같은 네임스페이스다(R8·V5…) — 실측 25/25 전건 일치.
  // 입사자를 TO 자리에 붙이는 정확한 조인 키라서 회사명 대조(동명·표기 흔들림)를 대체한다.
  const EC = {
    cat: empCol(/^Category$/i, 0), st: empCol(/^Status$/i, 1), code: empCol(/^Code$/i, 2),
    comp: empCol(/^Company$/i, 3), name: empCol(/^Name$/i, 8), rev: empCol(/^TOTAL\s*Revenue$/i, 20),
  }
  const empRows = empHi < 0 ? [] : empSheet.slice(empHi + 1).filter(r => {
    const n = String((r || [])[EC.name] ?? '').trim()
    return n.length >= 2 && !/^\d+$/.test(n)
  })

  const revHi = revSheet.findIndex(r => (r || []).some(c => /기업명/.test(String(c ?? ''))))
  const revCol = colFinder(revSheet[revHi] || [])
  const RC = { name: revCol(/^이름/, 2), rev: revCol(/^총 ?매출액/, 6) }
  const revRows = revHi < 0 ? [] : revSheet.slice(revHi + 1).filter(r => String((r || [])[RC.name] ?? '').trim())

  // TO 원장 집계 — 공고코드 단위 (공고별 대조는 코드가 붙은 행만 가능)
  const toByCode: Record<string, { to: number; m: number; d: number; p: number; comp: string }> = {}
  for (const r of codedRows) {
    const c = S(r[TC.code]).toUpperCase()
    const b = toByCode[c] || (toByCode[c] = { to: 0, m: 0, d: 0, p: 0, comp: S(r[TC.comp]) })
    const st = S(r[TC.state])
    b.to++
    if (st === '매칭') b.m++
    else if (st === '이탈') b.d++
    else if (st === '진행중') b.p++
  }
  // 운영 코드(Code 열) 단위 — 공고코드가 없는 자리까지 포함해 입사자 원장과 대조한다
  const toByOps: Record<string, { to: number; m: number; comps: Set<string>; vn: Set<string> }> = {}
  for (const r of toRows) {
    const k = S(r[TC.ops])
    if (!k) continue
    const b = toByOps[k] || (toByOps[k] = { to: 0, m: 0, comps: new Set(), vn: new Set() })
    b.to++
    if (S(r[TC.state]) === '매칭') b.m++
    if (S(r[TC.comp])) b.comps.add(S(r[TC.comp]))
    if (S(r[TC.code])) b.vn.add(S(r[TC.code]).toUpperCase())
  }
  const empByOps: Record<string, any[]> = {}
  for (const r of empRows) (empByOps[S(r[EC.code])] || (empByOps[S(r[EC.code])] = [])).push(r)

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
  const matchedRows = toRows.filter(r => S(r[TC.state]) === '매칭')
  const toMatched = matchedRows.length
  const vnMatched = matchedRows.filter(r => /^vn$/i.test(S(r[TC.cat]))).length
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

  // 실현 매출(매출현황 G열)은 대시보드 매출과 같아야 하는 숫자다 — 차이는 전부 '귀속 실패'분이다.
  // (계약 총액과의 비교는 성격이 다른 숫자라 A8 로 분리했다. 전엔 여기서 같이 비교해 항상 켜져 있었다.)
  const revGapHires = unattributedHires.filter(h => h.revenue > 0)
  if (Math.round(revSum) !== Math.round(revenueUsd)) {
    add({
      id: 'A1', title: '실현 매출이 대시보드에 덜 반영되고 있습니다', severity: 'high', count: revGapHires.length || 1,
      path: '2026 KTC Ops. › 매출현황 G열 × 이 대시보드(귀속분)',
      rows: [
        { label: '매출현황 G열 합 (실현)', value: `$${Math.round(revSum).toLocaleString()}` },
        { label: '이 대시보드 (파이프라인 귀속분)', value: `$${Math.round(revenueUsd).toLocaleString()}` },
        { label: '빠진 금액', value: `$${Math.round(revSum - revenueUsd).toLocaleString()}` },
      ],
      codes: revGapHires.map(h => `${h.company} ${h.name} ($${Math.round(h.revenue).toLocaleString()})`),
      note: '입사자가 파이프라인·공고에 안 붙으면 그 사람의 매출도 같이 빠집니다. 위 인원의 TO 자리에 공고코드를 채우면 해소됩니다.',
    })
  }
  // 계약 총액끼리의 대조 (Ops Dashboard USD 행 ↔ Employee U열) — 지금은 일치해서 조용하다
  if (dashRevenue != null && Math.round(dashRevenue) !== Math.round(empRev)) {
    add({
      id: 'A8', title: '계약 총액이 Ops Dashboard 와 Employee 합계가 다릅니다', severity: 'mid', count: 1,
      path: '2026 KTC Ops. › Dashboard (USD 행) × Employee U열',
      rows: [
        { label: 'Ops Dashboard (계약 총액)', value: `$${Math.round(dashRevenue).toLocaleString()}` },
        { label: 'Employee U열 TOTAL Revenue 합', value: `$${Math.round(empRev).toLocaleString()}` },
      ],
      note: '둘은 같은 계약 총액을 세는 숫자입니다 (실현 매출인 매출현황 G열과는 성격이 다름).',
    })
  }
  const hireSources = [
    ...(dashMatches != null ? [{ label: 'Ops Dashboard Matches (KPI)', value: dashMatches }] : []),
    { label: "TO_Table 현재 상태 = '매칭'", value: toMatched },
    { label: 'Employee 시트 인원', value: empRows.length },
    { label: '파이프라인 final_passed (헤드라인 입사)', value: fp },
  ]
  const hireSpread = Math.max(...hireSources.map(s => s.value)) - Math.min(...hireSources.map(s => s.value))
  if (hireSpread > 0) {
    add({
      id: 'A2', title: "'입사'가 소스마다 다릅니다", severity: 'high', count: 1,
      path: '2026 KTC Ops. › Dashboard Matches · TO_Table_수정 F열 · Employee · ktc-support',
      rows: hireSources.map(s => ({ label: s.label, value: `${s.value}` })),
      note: `헤드라인 '입사'는 파이프라인 기준입니다. TO_Table 매칭 ${toMatched}건 중 ${vnMatched}건이 Category=VN(베트남 자체 매칭)으로 ktc-support 를 경유하지 않아 파이프라인에 안 잡힙니다.`,
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
      note: 'Ops 의 CV 는 공고코드가 붙은 지원만 세는 것으로 보입니다 — 아래 A7 의 코드 미귀속 건수를 빼면 이 대시보드 수치와 거의 같아집니다.',
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
  // 공고코드가 빈 행도 이제 대상이라 라벨은 운영 코드로 폴백한다 (안 그러면 회사명만 남아 못 찾는다)
  const label = (r: any[]) => `${S(r[TC.code]) || S(r[TC.ops])} ${S(r[TC.comp])}`.trim()
  // 한 공고에 여러 자리가 걸리면 같은 라벨이 반복된다 — 자리 수를 ×N 으로 합쳐 목록을 읽을 수 있게
  const tally = (rows: any[][]) => {
    const n: Record<string, number> = {}
    for (const r of rows) n[label(r)] = (n[label(r)] || 0) + 1
    return Object.entries(n).map(([l, c]) => (c > 1 ? `${l} ×${c}` : l))
  }
  const b1 = toRows.filter(r => String(r[TC.state]).trim() === '매칭' && !String(r[TC.match] ?? '').trim())
  add({
    id: 'B1', title: "현재 상태 = '매칭' 인데 매칭일이 비어 있음", severity: 'mid', count: b1.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × L열', codes: tally(b1),
  })
  const b2 = toRows.filter(r => String(r[TC.state]).trim() === '이탈' && !String(r[TC.left] ?? '').trim())
  add({
    id: 'B2', title: "현재 상태 = '이탈' 인데 이탈일이 비어 있음", severity: 'mid', count: b2.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × M열', codes: tally(b2),
    note: '이탈 시점 통계를 낼 수 없습니다.',
  })
  const b3 = toRows.filter(r => !String(r[TC.state] ?? '').trim())
  add({
    id: 'B3', title: '현재 상태가 비어 있음 — 진행중·이탈 어느 쪽으로도 안 셉니다', severity: 'mid', count: b3.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열', codes: tally(b3),
  })
  const b4 = toRows.filter(r => String(r[TC.state]).trim() === '매칭' && String(r[TC.fnb] ?? '').trim() !== '매칭')
  add({
    id: 'B4', title: "O열(Funnel 기준)이 F열(현재 상태)과 어긋남", severity: 'mid', count: b4.length,
    path: '2026 KTC Ops. › TO_Table_수정 › F열 × O열', codes: tally(b4),
    note: '대시보드는 F열만 읽습니다. O열이 갱신이 밀린 열인지 확인이 필요합니다.',
  })
  // 공고코드가 비어 있는 TO 자리 — 공고·원장·FYI 어디에도 못 붙어 공고별 집계에서 통째로 빠진다.
  // 매칭까지 빠지면 입사·매출이 실제보다 작게 보이므로 이 그룹의 최우선 항목이다.
  const b5 = Object.entries(
    codelessRows.reduce<Record<string, { to: number; m: number }>>((acc, r) => {
      const k = `${S(r[TC.ops])} ${S(r[TC.comp])}`.trim() || '(코드·회사 모두 빈칸)'
      const b = acc[k] || (acc[k] = { to: 0, m: 0 })
      b.to++
      if (S(r[TC.state]) === '매칭') b.m++
      return acc
    }, {}),
  )
  const b5Matched = b5.reduce((s, [, v]) => s + v.m, 0)
  add({
    id: 'B5', title: '공고코드(VN Code)가 비어 있는 TO 자리 — 공고별 집계에서 빠집니다', severity: 'high', count: codelessRows.length,
    path: '2026 KTC Ops. › TO_Table_수정 › C열',
    rows: b5.map(([k, v]) => ({ label: k, value: `${v.to}자리${v.m ? ` · 매칭 ${v.m}` : ''}` })),
    note: `이 중 ${b5Matched}건이 '매칭'입니다. 공고코드를 채우면 해당 입사자·매출이 공고별 집계와 기업별 성과에 잡힙니다.`,
  })
  // 코드 자체가 꼬인 자리 — 형식 이상 / 한 코드에 회사 2곳 / 한 운영 코드에 공고코드 2개
  const CODE_OK = /^[A-Za-z]{2,4}\d{3,5}$/
  const compsByVn: Record<string, Set<string>> = {}
  for (const r of codedRows) (compsByVn[S(r[TC.code]).toUpperCase()] || (compsByVn[S(r[TC.code]).toUpperCase()] = new Set())).add(S(r[TC.comp]))
  const b6: { label: string; value: string }[] = []
  for (const [c, comps] of Object.entries(compsByVn)) {
    if (!CODE_OK.test(c)) b6.push({ label: `"${c}" — 공고코드 형식이 아님`, value: [...comps].join(' , ') })
    else if (comps.size > 1) b6.push({ label: `${c} — 회사 ${comps.size}곳이 같은 코드를 씀`, value: [...comps].join(' , ') })
  }
  for (const [k, b] of Object.entries(toByOps)) {
    if (b.vn.size > 1) b6.push({ label: `운영 코드 ${k} — 공고코드 ${b.vn.size}개가 섞임`, value: `${[...b.vn].join(' , ')} (${[...b.comps].join('/')})` })
  }
  add({
    id: 'B6', title: 'TO 자리의 공고코드가 잘못 적혀 있습니다', severity: 'high', count: b6.length,
    path: '2026 KTC Ops. › TO_Table_수정 › B열 × C열', rows: b6,
    note: '서로 다른 회사가 한 코드로 묶이면 그 회사들의 매칭·매출이 한 공고로 합쳐지거나 어느 공고에도 안 붙습니다.',
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
  const fpByCode: Record<string, string[]> = {}
  for (const c of candidates.filter(x => (x.pipeline_status || '') === 'final_passed')) {
    const m = String(c.applied_job || '').match(CODE_RE)
    const key = m ? m[0].toUpperCase() : '(코드없음)'
    ;(fpByCode[key] || (fpByCode[key] = [])).push(String(c.full_name || ''))
  }
  // 조인 키는 운영 코드(TO_Table B열 = Employee C열)다. 전엔 회사명으로 붙여서, 공고 7개를 가진
  // 회사면 7행이 모두 "Employee 9명"으로 떠 실제 어긋난 자리를 못 짚었다 (2026-07-30 수정).
  const d1 = [...new Set([...Object.keys(toByOps), ...Object.keys(empByOps).filter(Boolean)])]
    .sort()
    .map(k => {
      const t = toByOps[k]
      const e = empByOps[k] || []
      const vn = t ? [...t.vn] : []
      return {
        k, e: e.length, m: t ? t.m : 0, vn,
        pipe: vn.length === 1 ? (fpByCode[vn[0]] || []).length : null,
        comp: t ? [...t.comps].join('/') : S(e[0]?.[EC.comp]),
      }
    })
    .filter(x => x.m !== x.e)
  // Employee 쪽 Code 가 비면 조인이 안 돼 0 으로 잡힌다 — 왜 0 인지 행에서 바로 보이게 회사명으로 세어 붙인다
  const blankByComp: Record<string, number> = {}
  for (const r of empByOps[''] || []) blankByComp[norm(r[EC.comp])] = (blankByComp[norm(r[EC.comp])] || 0) + 1
  add({
    id: 'D1', title: '매칭 자리 수와 입사자 원장이 안 맞음', severity: 'mid', count: d1.length,
    path: "TO_Table B열·F열 '매칭' × Employee C열",
    rows: d1.map(x => {
      const blank = x.comp.split('/').reduce((s, c) => s + (blankByComp[norm(c)] || 0), 0)
      return {
        label: `${x.k} ${x.comp} ${x.vn.length ? `[${x.vn.join(',')}]` : '[공고코드 없음]'}`,
        value: `매칭 ${x.m} · Employee ${x.e}${x.pipe != null ? ` · 파이프라인 ${x.pipe}` : ''}`
          + (x.e < x.m && blank > 0 ? ` — 같은 회사에 Code 빈칸 ${blank}명 (D4)` : ''),
      }
    }),
    note: 'Employee 의 Code 열(C)과 TO_Table 의 Code 열(B)로 대조합니다. Code 가 빈 인원은 조인이 안 돼 Employee 0 으로 잡힙니다.',
  })
  const d2 = Object.entries(empByOps)
    .filter(([k]) => k && !toByOps[k])
    .map(([k, rows]) => `${k} ${S(rows[0][EC.comp])} (${rows.length}명)`)
  add({
    id: 'D2', title: 'Employee 의 Code 가 TO_Table 에 없음', severity: 'mid', count: d2.length,
    path: 'Employee C열 × TO_Table B열', codes: d2,
    note: '입사자가 어느 TO 자리인지 특정되지 않습니다.',
  })
  const d4 = (empByOps[''] || []).map(r => `${S(r[EC.comp])} ${S(r[EC.name])}`)
  add({
    id: 'D4', title: 'Employee 에 Code 가 비어 있어 TO 자리와 대조가 안 됩니다', severity: 'mid', count: d4.length,
    path: '2026 KTC Ops. › Employee › C열', codes: d4,
    note: 'TO_Table 의 Code(B열) 값을 채우면 D1 의 매칭·입사자 대조가 맞아떨어집니다.',
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
    { key: 'kpi', title: '팀 KPI와 숫자가 다름', hint: 'KTC Ops › Dashboard 탭과 이 대시보드가 같은 항목을 다르게 셉니다.', ids: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'] },
    { key: 'to', title: 'TO_Table 내부 모순', hint: 'TO·충원의 정본이라 여기 빈칸·모순이 화면에 그대로 반영됩니다.', ids: ['B5', 'B6', 'B1', 'B2', 'B3', 'B4'] },
    { key: 'ledger', title: '원장끼리 안 맞음', hint: 'TO_Table 과 JD EXECUTION 의 공고·TO 대조입니다.', ids: ['C1', 'C2', 'C3'] },
    { key: 'hire', title: '매칭 ↔ 입사자', hint: '매칭 자리와 실제 입사자 원장의 대조입니다.', ids: ['D1', 'D4', 'D2', 'D3'] },
    { key: 'posting', title: '공고 게시 상태', hint: '지원이 계속 들어오거나, 받아야 할 공고가 안 열려 있는 경우입니다.', ids: ['E1', 'E2', 'E3', 'E4', 'E5'] },
  ]

  return GROUPS.map(g => ({
    key: g.key,
    title: g.title,
    hint: g.hint,
    items: g.ids.map(id => items.find(i => i.id === id)).filter(Boolean) as AuditItem[],
  })).filter(g => g.items.length > 0)
}
