// 지표 출처 사전 — "이 숫자는 어느 시트 어느 탭 어느 열에서 오나"의 단일 원장.
// 화면 곳곳의 ⓘ 배지(SrcTip)가 이걸 읽어 말풍선으로 보여주고, 각 줄은 원본으로 바로 가는
// 링크가 된다. 참조 원본이 많아(시트 4개 + DB 2곳) 값의 출처를 화면에서 확인하고 바로
// 열어볼 수 있게 한 것 (2026-07-30 대표 요청).
// 집계 로직(lib/aggregate.ts)을 바꾸면 여기 설명도 함께 고칠 것 — 어긋나면 없느니만 못하다.

export type SrcKind = 'sheet' | 'db' | 'calc'
export const SRC_KIND_LABELS: Record<SrcKind, string> = { sheet: '시트', db: 'DB', calc: '계산' }

// 스프레드시트 4종 — 실제 문서 ID·탭 gid 는 서버(aggregate)가 읽어 MasterData.sheetLinks 로 넘긴다.
// (ID 를 클라이언트에 하드코딩하면 환경변수로 다른 문서를 가리킬 때 링크가 엉뚱한 곳으로 간다)
export type SheetKey = 'master' | 'ops' | 'cost' | 'cand'

export type SrcLine = {
  k: SrcKind
  sys: string          // 원본 이름 (굵게)
  loc?: string         // 어느 열·어떤 값인지
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
    lines: [{ k: 'sheet', sys: 'Master 시트 › JD EXECUTION 탭', loc: '— Job ID · Company · Job Title 열', sheet: 'master', tab: 'JD EXECUTION' }],
    note: '판정 점(완료·순항·정체·부족·초기)은 원본 값이 아니라 아래 지원·단계 숫자로 계산한 파생값',
  },
  'jd.received': {
    lines: [
      { k: 'sheet', sys: 'Master 시트 › JD EXECUTION 탭', loc: '— Date Received 열', sheet: 'master', tab: 'JD EXECUTION' },
      { k: 'calc', sys: '미기재 공고는 최초 지원일로 대체', loc: '· D+N = 오늘까지 경과일' },
    ],
  },
  'jd.status': {
    lines: [{ k: 'sheet', sys: 'Master 시트 › JD EXECUTION 탭', loc: '— Job Status 열 원문 (마감 여부는 이 문구로 판별)', sheet: 'master', tab: 'JD EXECUTION' }],
  },
  'jd.to': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › Matching Status 탭', loc: "— 공고코드(VN Code) 행의 'Total TO' 열", sheet: 'ops', tab: 'Matching Status' }],
    note: 'Matching Status 에 없는 공고만 JD EXECUTION 의 Headcount 열로 폴백',
  },
  'jd.apps': {
    lines: [
      { k: 'sheet', sys: 'CANDIDATE DATA 시트 › 채널별 탭 전체', loc: '— 이메일·이름이 기입된 행 수', sheet: 'cand' },
      { k: 'db', sys: 'salarymap DB › job_applications', loc: '— FYI 직접 지원 (시트 탭에 없는 몫)' },
    ],
    note: '공고 귀속은 각 탭 Job ID·제목 열의 공고코드 (없으면 제목·이메일 매칭 폴백) — 숫자에 마우스를 올리면 시트/FYI 분해 표시',
  },
  'jd.filled': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › Matching Status 탭', loc: "— 'Matches' 열 (매칭 성사된 자리 수)", sheet: 'ops', tab: 'Matching Status' }],
    note: '이탈하면 다시 빈자리로 계산 — 파이프라인 입사(final_passed) 누적과 다를 수 있다',
  },
  'jd.fill': {
    lines: [
      { k: 'calc', sys: 'Matches ÷ Total TO', loc: '— 둘 다 KTC Ops Matching Status 의 같은 행에서' },
      { k: 'sheet', sys: 'KTC Ops 시트 › Matching Status 탭', sheet: 'ops', tab: 'Matching Status' },
    ],
  },

  // ── 파이프라인 단계 (공고 표·채널 표·퍼널 공용) ────────────
  'pipe.docPass': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: "— pipeline_status 열이 '스크리닝 합격' 이상 (passed ~ final_passed 누적 도달)", url: KTC_SUPPORT }],
  },
  'pipe.delivered': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: '— pipeline_status 열이 기업 전달 이상 (sent_to_company ~ final_passed)', url: KTC_SUPPORT }],
  },
  'pipe.interviews': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: '— pipeline_status 열이 면접 이상 (interviewing · offer · final_passed)', url: KTC_SUPPORT }],
    note: '상태 이력이 없어 면접 후 탈락자는 미포함 (현재 상태만 남음)',
  },
  'pipe.offer': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: '— pipeline_status 열이 offer 또는 final_passed', url: KTC_SUPPORT }],
  },
  'pipe.hires': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: '— pipeline_status 열이 final_passed 인 인원', url: KTC_SUPPORT }],
  },
  'now.stages': {
    lines: [{ k: 'db', sys: 'ktc-support DB › candidates', loc: '— pipeline_status 열의 현재 상태별 인원 (도달 누적 아님)', url: KTC_SUPPORT }],
    note: "화면 라벨 ↔ 상태값: 스크리닝 대기=new · 합격 후 대기=passed · 발송 대기=ready_to_forward · 기업 검토 중=sent_to_company · 면접 진행 중=interviewing · 오퍼·계약 중=offer — 아랫줄 '모집 중'은 공고코드 귀속으로 진행 중 공고 몫만 센 것",
  },

  // ── 채널 표 (인재·채널) ─────────────────────────────────
  'ch.channel': {
    lines: [
      { k: 'sheet', sys: 'CANDIDATE DATA 시트', loc: '— 탭 이름이 곧 채널 (한 탭 = 한 채널)', sheet: 'cand' },
      { k: 'db', sys: 'salarymap DB', loc: '— FYI 행은 플랫폼 직접 지원 기록' },
    ],
    note: 'ITviec 수기 탭(it-viec-manual)은 같은 사이트라 ITviec 행에 합산',
  },
  'ch.people': {
    lines: [
      { k: 'db', sys: 'ktc-support DB › candidates', loc: '— 고유 인재 수 (email 기준 1명 1회, 최초 유입 탭 sheet_source 로 귀속)', url: KTC_SUPPORT },
      { k: 'db', sys: 'salarymap DB › job_applications', loc: '— FYI 행은 KTC 공고 지원자의 고유 이메일 수' },
    ],
  },
  'ch.spend': {
    lines: [
      { k: 'sheet', sys: '비용 시트 › invoice 탭', loc: '— 채널별 합계(VND)를 KRW 환산 (VAT 제외)', sheet: 'cost', tab: 'invoice' },
      { k: 'sheet', sys: '비용 시트 › 통합 비교표 탭', loc: '— invoice 에 없는 채널의 지출 열', sheet: 'cost', tab: '통합 비교표' },
      { k: 'sheet', sys: '비용 시트 › LINKEDIN 탭', loc: '— KTC 공고코드 슬롯 비용만 합산', sheet: 'cost', tab: 'LINKEDIN' },
      { k: 'sheet', sys: '비용 시트 › 캠페인별 Meta 광고 탭', loc: '— Spend 열 (랜딩 = KTC 채용 캠페인, FYI = FYI_* 캠페인)', sheet: 'cost', tab: '캠페인별' },
      { k: 'sheet', sys: '비용 시트 › meta-campaign-summary 탭', loc: "— 캠페인의 채용 목적 여부('Recruiting for KTC') 원장", sheet: 'cost', tab: 'campaign-summary' },
    ],
    note: '비용 시트에 시간 축이 없어 항상 누적 — 기간 보기에서는 비움',
  },
  'ch.cpa': {
    lines: [{ k: 'calc', sys: '지출 ÷ 지원자', loc: '— 그 행의 두 열 그대로 나눈 값' }],
  },
  'ch.cph': {
    lines: [{ k: 'calc', sys: '지출 ÷ 입사', loc: '— 그 행의 두 열 그대로 나눈 값' }],
  },

  // ── 인재풀 타일 (인재·채널) ──────────────────────────────
  'tp.resume': {
    lines: [{ k: 'db', sys: 'salarymap DB › user_profiles', loc: '— resume_url 이 등록된 인재 수', url: 'https://salary-fyi.com' }],
  },
  'tp.public': {
    lines: [{ k: 'db', sys: 'salarymap DB › user_profiles', loc: '— resume_url 등록 + is_resume_public = true', url: 'https://salary-fyi.com' }],
  },
  'tp.people': {
    lines: [
      { k: 'db', sys: 'ktc-support DB › candidates', loc: '— 고유 인재 수 (email 기준)', url: KTC_SUPPORT },
      { k: 'db', sys: 'salarymap DB › job_applications', loc: '— FYI 직접 지원자' },
    ],
    note: "채널 표 '지원자' 열의 전 채널 합과 같은 숫자",
  },
  'tp.apps': {
    lines: [
      { k: 'sheet', sys: 'CANDIDATE DATA 시트 › 채널별 탭 전체', loc: '— 이메일·이름이 기입된 행 수 (1행 = 지원 1건)', sheet: 'cand' },
      { k: 'db', sys: 'salarymap DB › job_applications', loc: '— FYI 직접 지원 건' },
    ],
  },
  'chart.apps': {
    lines: [
      { k: 'sheet', sys: 'CANDIDATE DATA 시트 › 채널별 탭', loc: '— 지원일 열 (탭별: Ngày nộp · Applied date · Thời gian · Ngày tiếp nhận · Submitted time)', sheet: 'cand' },
      { k: 'db', sys: 'salarymap DB › job_applications', loc: '— FYI 는 created_at' },
    ],
    note: '날짜는 베트남 시간(UTC+7) 기준으로 집계',
  },

  // ── 기업별 성과 (한국 매칭) ──────────────────────────────
  'co.company': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › Employee 탭', loc: '— Company 열', sheet: 'ops', tab: 'Employee' }],
  },
  'co.hires': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › Employee 탭', loc: '— 입사자 행 수 (Name · E-mail 열)', sheet: 'ops', tab: 'Employee' }],
    note: '파이프라인 귀속(이메일·이름 매칭) 확인된 인원만 — 별도 경로 입사는 집계 제외 (제외 인원은 표 위에 표기)',
  },
  'co.working': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › Employee 탭', loc: "— Status 열이 'Ing' 인 인원 (그 외 = 이탈)", sheet: 'ops', tab: 'Employee' }],
  },
  'co.revenue': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › 매출현황 탭', loc: "— '총 매출액' 열 (Employee 탭과 이름 매칭으로 합산)", sheet: 'ops', tab: '매출현황' }],
  },
  'co.profit': {
    lines: [{ k: 'sheet', sys: 'KTC Ops 시트 › 매출현황 탭', loc: "— '이익' 열 (Employee 탭과 이름 매칭으로 합산)", sheet: 'ops', tab: '매출현황' }],
  },

  // ── 베트남 매칭 (FYI 자체 공고) ──────────────────────────
  'vn.jobs': {
    lines: [{ k: 'db', sys: 'salarymap DB › jobs', loc: '— source = company_self (기업 직접 등록) · 활성은 is_active = true', url: 'https://salary-fyi.com' }],
  },
  'vn.companies': {
    lines: [{ k: 'db', sys: 'salarymap DB › jobs', loc: '— 자체 공고의 company 고유 수', url: 'https://salary-fyi.com' }],
  },
  'vn.apps': {
    lines: [{ k: 'db', sys: 'salarymap DB › job_applications', loc: '— 자체 공고 지원 건 (@likelion.net 테스트 지원 제외)', url: 'https://salary-fyi.com' }],
  },
  'vn.applicants': {
    lines: [{ k: 'db', sys: 'salarymap DB › job_applications', loc: '— 자체 공고 지원자의 고유 이메일 수', url: 'https://salary-fyi.com' }],
  },
  'vn.viewed': {
    lines: [{ k: 'db', sys: 'salarymap DB › job_applications', loc: '— viewed_at (기업이 지원서를 연 시각)이 기록된 건', url: 'https://salary-fyi.com' }],
  },
} satisfies Record<string, SrcDef>

// satisfies 로 키 목록을 뽑고(오타 방지), 값은 SrcDef 로 다시 넓혀 준다 —
// 리터럴 유니온 그대로면 note 가 없는 항목 때문에 s.note 접근이 막힌다.
export type SrcKey = keyof typeof SRC_DEFS
export const SRC: Record<SrcKey, SrcDef> = SRC_DEFS
