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

export type JdRow = {
  code: string           // 공고코드 (FPT401 등)
  company: string
  title: string
  headcount: number | null // 채용 목표 인원 (TO)
  status: string         // JD EXECUTION 시트 status 원문
  open: boolean          // 진행 중 여부
  apps: number           // 지원 건
  people: number         // 지원자
  docPass: number        // 스크리닝 합격 도달
  delivered: number      // 기업 전달 도달
  interviews: number     // 면접 (INTERVIEW 탭)
  offer: number          // 오퍼 도달
  hires: number          // 입사
}

export type FunnelStage = {
  key: string
  label: string
  count: number
  note?: string
}

export type MonthPoint = { month: string; count: number }

export type CompanyPerf = {
  company: string
  hires: number
  working: number
  revenueUsd: number
  profitUsd: number
}

export type MasterData = {
  generatedAt: string
  mode: 'live' | 'mock'
  warnings: string[]     // 부분 실패 (비용 시트 등) — UI 에 그대로 노출

  headline: {
    hiresTotal: number          // 입사 누적 (Ops Employee)
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
  }

  matching: {
    funnel: FunnelStage[]       // 지원자 → 스크리닝 합격 → 기업 전달 → 면접 → 오퍼 → 입사
    inProgress: {               // 현재 단계 기준 (지금 걸려 있는 인원)
      screeningQueue: number    // 스크리닝 대기
      readyToForward: number    // 발송 대기
      sentToCompany: number     // 기업 검토 중
      interviewing: number      // 면접 진행 중
      offer: number             // 오퍼·계약 중
    }
    jds: JdRow[]
    openJds: number
    headcountTotal: number      // 오픈 공고 TO 합
    fillRateOpen: number | null // 오픈 공고 충원율
  }

  outcome: {
    companies: CompanyPerf[]    // 기업별 입사/재직/매출 (파이프라인 경유 입사만)
    excludedHires: number       // 파이프라인 미귀속 입사 — 집계에서 제외된 인원 (투명성 표기용)
  }
}
