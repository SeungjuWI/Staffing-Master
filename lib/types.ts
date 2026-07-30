// 마스터 대시보드 데이터 계약 — 모든 지표는 이 형태로 집계되어 UI 로 전달된다.

export type Channel = {
  key: string            // sheet_source (ITviec-api, LinkedIn, FYI, ...)
  people: number         // 지원자 (고유 인재, 최초 유입 채널 귀속)
  applications: number   // 지원 건 (공고 × 인재)
  docPass: number        // 스크리닝 합격 도달
  interviews: number     // 면접 도달 (Master INTERVIEW 탭, 사람 단위)
  hires: number          // 입사 (Ops Employee, 이메일 귀속)
  jobsPosted: number | null   // 게재 공고 수 (비용 시트)
  spendFees: number | null    // 게재비 (KRW)
  spendAds: number | null     // 광고비 (KRW, Meta)
  spendKrw: number | null     // 총 지출 (KRW)
  cpaKrw: number | null       // 지원자당 비용 = 지출 ÷ 지원자
  costPerHireKrw: number | null // 채용당 비용 = 지출 ÷ 입사
}

// 공고 판정 — 진행 중 공고만 (마감은 null). 2026-07-28 전수조사로 개정:
//  good  순항: 충원 완료 / 면접·오퍼 진행 중 / 기업 검토 중인데 반응 이력(면접·입사)이 있거나 모집 6주 미만
//  early 모집 초기: 모집 시작 7일 미만 (판정 유예)
//  low   지원 부족: TO 1명당 지원 30건 미만 (입사가 나온 공고들의 하위 사분위 기준)
//  stall 정체: 기업 응답 없음(검토 체류만 있고 모집 6주+ 면접 전환 0) 또는 내부 처리 정체(기업 단계 0)
//  (구 규칙은 "검토 체류 1명만 있어도 순항"이라 무반응 공고 12건이 순항으로 위장됐었음)
export type JdHealth = 'good' | 'early' | 'low' | 'stall'

export type JdRow = {
  code: string           // 공고코드 (FPT401 등)
  company: string
  title: string
  headcount: number | null // 채용 목표 인원 (TO) — KTC Ops TO_Table 행 수, 없으면 JD EXECUTION Headcount
  status: string         // JD EXECUTION 시트 status 원문
  open: boolean          // 진행 중 여부
  apps: number           // 지원 건 (시트 탭 + FYI 라이브 — FYI 는 공고 제목 유니크 매칭으로 귀속)
  appsFyi: number        // └ 그중 FYI 플랫폼 직접 지원 (시트에 없는 지원 — 툴팁 분해 표기용)
  people: number         // 지원자
  docPass: number        // 스크리닝 합격 도달
  delivered: number      // 기업 전달 도달
  interviews: number     // 면접 (INTERVIEW 탭)
  offer: number          // 오퍼 도달
  hires: number          // 입사 (기간 코호트 — 퍼널·표와 정합)
  hiresAll: number       // 충원 (스톡) — KTC Ops TO_Table 의 '매칭' 자리 수. 이탈하면 다시 빈자리로 돌아간다
  dropped: number        // 이탈한 자리 수 (TO_Table '이탈') — 채웠다가 나갔거나 매칭 전 드롭
  responded: boolean     // 기업 반응 이력 — TO_Table 에 기업 면접 완료·매칭 기록이 있는 공고 (판정 재료)
  startDate: string | null // 모집 시작일 (시트 Date Received, 없으면 최초 지원일) YYYY-MM-DD
  days: number | null    // 모집 시작 후 경과 일수
  peopleAll: number      // 누적 지원자 (스톡 — 기간 필터 무관)
  appsAll: number        // 누적 지원 건 (스톡) — 지원 부족 판정 재료 (화면 '지원' 열과 같은 시트 기준)
  channels: { key: string; apps: number }[] // 채널별 지원 건 (기간 코호트, apps 와 정합) — 행 클릭 상세의 도넛 재료
  lastAppDate: string | null // 최근 지원일 (스톡, YYYY-MM-DD) — 모집 동력 신호
  curInternal: number    // 현재 내부 단계 인원 (스크리닝 대기 + 합격 후 대기 + 발송 대기)
  curNew: number         // └ 스크리닝 대기
  curPassed: number      // └ 합격 후 대기 (발송 준비 전)
  curReady: number       // └ 발송 대기
  curCompany: number     // 현재 기업 검토 중
  curInterview: number   // 현재 면접 진행 중
  curOffer: number       // 현재 오퍼·계약 중
  health: JdHealth | null
}

export type FunnelStage = {
  key: string
  label: string
  count: number
  note?: string
}

export type MonthPoint = { month: string; count: number }

// 일별 채널 추이 한 점 — date 는 VN(UTC+7) 기준 YYYY-MM-DD, byChannel 키는 sheet_source
// (it-viec-manual 은 ITviec-api 로 합산, FYI 직접 지원은 'FYI')
export type DayPoint = { date: string; byChannel: Record<string, number> }

export type CompanyPerf = {
  company: string
  hires: number
  working: number
  revenueUsd: number
  profitUsd: number
}

// 베트남 매칭 트랙 — FYI 플랫폼 안에서 직접 이뤄지는 매칭 (ktc-support 미경유)
export type VietnamBlock = {
  jobsTotal: number      // FYI 자체 공고 (기업 직접 등록, source=company_self)
  jobsActive: number     // 활성 공고
  companies: number      // 공고 등록 기업 수
  applications: number   // 지원 건
  applicants: number     // 지원자 (고유)
  viewed: number         // 기업이 열람한 지원 건
}

export type MasterData = {
  generatedAt: string
  mode: 'live' | 'mock'
  warnings: string[]     // 부분 실패 (비용 시트 등) — UI 에 그대로 노출

  headline: {
    hiresTotal: number          // 입사 누적 (Ops Employee)
    hiresInPeriod: number | null // 기간 보기에서 입사일(hired_at) 기준 그 기간 입사 — 누적 보기는 null
    hiresThisMonth: number      // 이번 달 입사 (VN 기준)
    working: number             // 재직 중 (status=Ing)
    left: number                // 이탈/종료
    revenueUsd: number          // 총 매출 (매출현황 시트)
    profitUsd: number           // 총 이익
    totalSpendKrw: number | null
    costPerHireKrw: number | null // 총 지출 ÷ 채널 귀속 입사
  }

  supply: {
    talentPoolResume: number    // FYI 이력서 등록 인재
    talentPoolPublic: number    // 이력서 공개 (HR 열람 가능)
    candidatesTotal: number     // 지원자 (고유, 전 채널)
    applicationsTotal: number   // 지원 건 (전 채널)
    channels: Channel[]
    monthly: MonthPoint[]       // 월별 지원 건 추이
    daily: DayPoint[]           // 일별 채널별 지원 건 (최근 30일, 기간 필터 무관)
  }

  matching: {
    funnel: FunnelStage[]       // 지원자 → 스크리닝 합격 → 기업 전달 → 면접 → 오퍼 → 입사
    inProgress: {               // 현재 단계 기준 (지금 걸려 있는 인원, 마감 공고 잔류 포함 전체)
      screeningQueue: number    // 스크리닝 대기
      screenPassed: number      // 합격 후 대기 (스크리닝 합격, 발송 준비 전)
      readyToForward: number    // 발송 대기
      sentToCompany: number     // 기업 검토 중
      interviewing: number      // 면접 진행 중
      offer: number             // 오퍼·계약 중
    }
    jds: JdRow[]
    openJds: number
    headcountTotal: number      // 오픈 공고 TO 합
    hiresInOpen: number         // 오픈 공고에서 이미 채운 인원 (스톡 — 기간 보기에서도 누적)
    fillRateOpen: number | null // 오픈 공고 충원율 (스톡)
    jdSince: string | null      // 가장 이른 모집 시작일 — "언제부터 모은 숫자인지" 표기용
  }

  vietnam: VietnamBlock

  outcome: {
    companies: CompanyPerf[]    // 기업별 입사/재직/매출 (파이프라인 경유 입사만)
    excludedHires: number       // 파이프라인 미귀속 입사 — 집계에서 제외된 인원 (투명성 표기용)
  }

  audit: AuditGroup[]           // 정합성 점검 — 소스끼리 어긋나는 곳 (시트를 고치면 자동으로 사라짐)
}

// ── 정합성 점검 (점검 탭) ──────────────────────────────────────
export type AuditItem = {
  id: string                    // A1, B2 … 팀과 대화할 때 쓰는 고정 번호
  title: string
  severity: 'high' | 'mid' | 'low'
  count: number                 // 0 이면 목록에서 빠진다 (= 해결됨)
  path: string                  // 파일 › 탭 › 열 — 어디를 고쳐야 하는지
  rows?: { label: string; value: string }[] // 소스별 값 나란히
  codes?: string[]              // 해당 공고·인원 명단
  note?: string
}

export type AuditGroup = {
  key: 'kpi' | 'to' | 'ledger' | 'hire' | 'posting'
  title: string
  hint: string
  items: AuditItem[]
}
