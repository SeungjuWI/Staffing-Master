// 지표 출처 사전 — "이 숫자는 어느 시트 어느 탭 어느 열에서 오나"의 단일 원장.
// 화면 곳곳의 ⓘ 배지(SrcTip)가 이걸 읽어 말풍선으로 보여주고, 각 줄은 원본으로 바로 가는
// 링크가 된다. 참조 원본이 많아(시트 4개 + DB 2곳) 값의 출처를 화면에서 확인하고 바로
// 열어볼 수 있게 한 것 (2026-07-30 대표 요청).
// 집계 로직(lib/aggregate.ts)을 바꾸면 여기 설명도 함께 고칠 것 — 어긋나면 없느니만 못하다.
//
// sys · loc · note 값은 i18n 사전 키다 (원문은 lib/i18n/ko.ts 의 src.* 항목) —
// SrcTip 이 렌더 시점에 로케일에 맞춰 t() 로 풀어 보여준다.

export type SrcKind = 'sheet' | 'db' | 'calc'

// 스프레드시트 4종 — 실제 문서 ID·탭 gid 는 서버(aggregate)가 읽어 MasterData.sheetLinks 로 넘긴다.
// (ID 를 클라이언트에 하드코딩하면 환경변수로 다른 문서를 가리킬 때 링크가 엉뚱한 곳으로 간다)
export type SheetKey = 'master' | 'ops' | 'cost' | 'cand'

export type SrcLine = {
  k: SrcKind
  sys: string          // 원본 이름 (굵게) — i18n 키
  loc?: string         // 어느 열·어떤 값인지 — i18n 키
  sheet?: SheetKey     // 시트 원본 — 탭 링크로 연결
  tab?: string         // 탭 이름. 정확히 없으면 부분 일치로 찾는다 (비용 시트는 탭명이 자주 바뀜)
  url?: string         // 시트가 아닌 원본의 직접 링크
}
export type SrcDef = { lines: SrcLine[]; note?: string }

// 파이프라인 백오피스 — 지원자 상태(pipeline_status)를 실제로 보고 바꾸는 화면
const KTC_SUPPORT = 'https://ktc-support.vercel.app'

// 말풍선 한 줄 → 열어볼 링크. 탭 이름이 정확히 없으면 부분 일치(비용 시트 탭명 변동 대응),
// 그래도 없으면 스프레드시트 첫 화면으로 보낸다. 링크 정보가 없으면 null (평문 표시).
export function srcHref(links: Record<string, string> | undefined, line: SrcLine): string | null {
  if (line.url) return line.url
  // links 가 없을 수 있다: 데모 모드, 시트 조회 실패, 그리고 캐시 키가 겹친 옛 스냅숏(sheetLinks 없음).
  // 그런 경우엔 링크 없이 평문으로 보여주는 게 맞다 — 여기서 터지면 화면 전체가 죽는다.
  if (!links || !line.sheet) return null
  const pre = `${line.sheet}|`
  if (line.tab) {
    const exact = links[pre + line.tab]
    if (exact) return exact
    const kw = line.tab.toLowerCase()
    const hit = Object.keys(links).find(
      key => key.startsWith(pre) && key.length > pre.length && key.slice(pre.length).toLowerCase().includes(kw),
    )
    if (hit) return links[hit]
  }
  return links[pre] || null
}

const SRC_DEFS = {
  // ── 공고 표 (한국 매칭) ─────────────────────────────────
  'jd.jd': {
    lines: [{ k: 'sheet', sys: 'src.sys.masterJd', loc: 'src.jd.jd.loc', sheet: 'master', tab: 'JD EXECUTION' }],
    note: 'src.jd.jd.note',
  },
  'jd.received': {
    lines: [
      { k: 'sheet', sys: 'src.sys.masterJd', loc: 'src.jd.received.loc', sheet: 'master', tab: 'JD EXECUTION' },
      { k: 'calc', sys: 'src.jd.received.calc', loc: 'src.jd.received.calcLoc' },
    ],
  },
  'jd.status': {
    lines: [{ k: 'sheet', sys: 'src.sys.masterJd', loc: 'src.jd.status.loc', sheet: 'master', tab: 'JD EXECUTION' }],
  },
  'jd.to': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsMatching', loc: 'src.jd.to.loc', sheet: 'ops', tab: 'Matching Status' }],
    note: 'src.jd.to.note',
  },
  'jd.apps': {
    lines: [
      { k: 'sheet', sys: 'src.sys.candTabs', loc: 'src.jd.apps.loc', sheet: 'cand' },
      { k: 'db', sys: 'src.sys.dbApps', loc: 'src.jd.apps.loc2' },
    ],
    note: 'src.jd.apps.note',
  },
  'jd.filled': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsMatching', loc: 'src.jd.filled.loc', sheet: 'ops', tab: 'Matching Status' }],
    note: 'src.jd.filled.note',
  },
  'jd.fill': {
    lines: [
      { k: 'calc', sys: 'src.jd.fill.calc', loc: 'src.jd.fill.loc' },
      { k: 'sheet', sys: 'src.sys.opsMatching', sheet: 'ops', tab: 'Matching Status' },
    ],
  },

  // ── 파이프라인 단계 (공고 표·채널 표·퍼널 공용) ────────────
  'pipe.docPass': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.pipe.docPass.loc', url: KTC_SUPPORT }],
  },
  'pipe.delivered': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.pipe.delivered.loc', url: KTC_SUPPORT }],
  },
  'pipe.interviews': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.pipe.interviews.loc', url: KTC_SUPPORT }],
    note: 'src.pipe.interviews.note',
  },
  'pipe.offer': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.pipe.offer.loc', url: KTC_SUPPORT }],
  },
  'pipe.hires': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.pipe.hires.loc', url: KTC_SUPPORT }],
  },
  'now.stages': {
    lines: [{ k: 'db', sys: 'src.sys.dbCand', loc: 'src.now.loc', url: KTC_SUPPORT }],
    note: 'src.now.note',
  },

  // ── 채널 표 (인재·채널) ─────────────────────────────────
  'ch.channel': {
    lines: [
      { k: 'sheet', sys: 'src.sys.candSheet', loc: 'src.ch.channel.loc', sheet: 'cand' },
      { k: 'db', sys: 'src.sys.dbSalarymap', loc: 'src.ch.channel.loc2' },
    ],
    note: 'src.ch.channel.note',
  },
  'ch.people': {
    lines: [
      { k: 'db', sys: 'src.sys.dbCand', loc: 'src.ch.people.loc', url: KTC_SUPPORT },
      { k: 'db', sys: 'src.sys.dbApps', loc: 'src.ch.people.loc2' },
    ],
  },
  'ch.spend': {
    lines: [
      { k: 'sheet', sys: 'src.sys.costInvoice', loc: 'src.ch.spend.loc1', sheet: 'cost', tab: 'invoice' },
      { k: 'sheet', sys: 'src.sys.costCompare', loc: 'src.ch.spend.loc2', sheet: 'cost', tab: '통합 비교표' },
      { k: 'sheet', sys: 'src.sys.costLinkedin', loc: 'src.ch.spend.loc3', sheet: 'cost', tab: 'LINKEDIN' },
      { k: 'sheet', sys: 'src.sys.costMetaCamp', loc: 'src.ch.spend.loc4', sheet: 'cost', tab: '캠페인별' },
      { k: 'sheet', sys: 'src.sys.costMetaSummary', loc: 'src.ch.spend.loc5', sheet: 'cost', tab: 'campaign-summary' },
      { k: 'sheet', sys: 'src.sys.costMetaRaw', loc: 'src.ch.spend.loc6', sheet: 'cost', tab: 'raw-data' },
    ],
    note: 'src.ch.spend.note',
  },
  'ch.cpa': {
    lines: [{ k: 'calc', sys: 'src.sys.calcCpa', loc: 'src.calc.rowDivide' }],
  },
  'ch.cph': {
    lines: [{ k: 'calc', sys: 'src.sys.calcCph', loc: 'src.calc.rowDivide' }],
  },

  // ── 인재풀 타일 (인재·채널) ──────────────────────────────
  'tp.resume': {
    lines: [{ k: 'db', sys: 'src.sys.dbProfiles', loc: 'src.tp.resume.loc', url: 'https://salary-fyi.com' }],
  },
  'tp.public': {
    lines: [{ k: 'db', sys: 'src.sys.dbProfiles', loc: 'src.tp.public.loc', url: 'https://salary-fyi.com' }],
  },
  'tp.people': {
    lines: [
      { k: 'db', sys: 'src.sys.dbCand', loc: 'src.tp.people.loc', url: KTC_SUPPORT },
      { k: 'db', sys: 'src.sys.dbApps', loc: 'src.tp.people.loc2' },
    ],
    note: 'src.tp.people.note',
  },
  'tp.apps': {
    lines: [
      { k: 'sheet', sys: 'src.sys.candTabs', loc: 'src.tp.apps.loc', sheet: 'cand' },
      { k: 'db', sys: 'src.sys.dbApps', loc: 'src.tp.apps.loc2' },
    ],
  },
  'chart.apps': {
    lines: [
      { k: 'sheet', sys: 'src.sys.candTabs2', loc: 'src.chart.apps.loc', sheet: 'cand' },
      { k: 'db', sys: 'src.sys.dbApps', loc: 'src.chart.apps.loc2' },
    ],
    note: 'src.chart.apps.note',
  },

  // ── 기업별 성과 (한국 매칭) ──────────────────────────────
  'co.company': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsEmployee', loc: 'src.co.company.loc', sheet: 'ops', tab: 'Employee' }],
  },
  'co.hires': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsEmployee', loc: 'src.co.hires.loc', sheet: 'ops', tab: 'Employee' }],
    note: 'src.co.hires.note',
  },
  'co.working': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsEmployee', loc: 'src.co.working.loc', sheet: 'ops', tab: 'Employee' }],
  },
  'co.revenue': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsRevenue', loc: 'src.co.revenue.loc', sheet: 'ops', tab: '매출현황' }],
  },
  'co.profit': {
    lines: [{ k: 'sheet', sys: 'src.sys.opsRevenue', loc: 'src.co.profit.loc', sheet: 'ops', tab: '매출현황' }],
  },

  // ── 베트남 매칭 (FYI 자체 공고) ──────────────────────────
  'vn.jobs': {
    lines: [{ k: 'db', sys: 'src.sys.dbJobs', loc: 'src.vn.jobs.loc', url: 'https://salary-fyi.com' }],
  },
  'vn.companies': {
    lines: [{ k: 'db', sys: 'src.sys.dbJobs', loc: 'src.vn.companies.loc', url: 'https://salary-fyi.com' }],
  },
  'vn.apps': {
    lines: [{ k: 'db', sys: 'src.sys.dbApps', loc: 'src.vn.apps.loc', url: 'https://salary-fyi.com' }],
  },
  'vn.applicants': {
    lines: [{ k: 'db', sys: 'src.sys.dbApps', loc: 'src.vn.applicants.loc', url: 'https://salary-fyi.com' }],
  },
  'vn.viewed': {
    lines: [{ k: 'db', sys: 'src.sys.dbApps', loc: 'src.vn.viewed.loc', url: 'https://salary-fyi.com' }],
  },
} satisfies Record<string, SrcDef>

// satisfies 로 키 목록을 뽑고(오타 방지), 값은 SrcDef 로 다시 넓혀 준다 —
// 리터럴 유니온 그대로면 note 가 없는 항목 때문에 s.note 접근이 막힌다.
export type SrcKey = keyof typeof SRC_DEFS
export const SRC: Record<SrcKey, SrcDef> = SRC_DEFS
