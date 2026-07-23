// 데모 데이터 — 환경변수 미설정 시 UI 확인용. 실제 수치가 아니다.
import type { MasterData } from './types'

export function mockData(): MasterData {
  return {
    generatedAt: new Date().toISOString(),
    mode: 'mock',
    warnings: [],
    headline: {
      hiresTotal: 17,
      hiresThisMonth: 3,
      working: 15,
      left: 2,
      revenueUsd: 128400,
      profitUsd: 41200,
      totalSpendKrw: 14200000,
      costPerHireKrw: 835294,
    },
    supply: {
      talentPoolResume: 1834,
      talentPoolPublic: 1102,
      candidatesTotal: 1246,
      applicationsTotal: 1893,
      channels: [
        { key: 'ITviec-api', people: 412, applications: 655, docPass: 118, interviews: 21, hires: 6, jobsPosted: 12, spendFees: 5200000, spendAds: 0, spendKrw: 5200000, cpaKrw: 12621, costPerHireKrw: 866667 },
        { key: 'FYI', people: 288, applications: 402, docPass: 74, interviews: 12, hires: 4, jobsPosted: null, spendFees: 0, spendAds: 1800000, spendKrw: 1800000, cpaKrw: 6250, costPerHireKrw: 450000 },
        { key: 'LinkedIn', people: 231, applications: 344, docPass: 61, interviews: 11, hires: 3, jobsPosted: 8, spendFees: 3600000, spendAds: 0, spendKrw: 3600000, cpaKrw: 15584, costPerHireKrw: 1200000 },
        { key: 'landing-page', people: 154, applications: 260, docPass: 38, interviews: 8, hires: 2, jobsPosted: null, spendFees: 0, spendAds: 2400000, spendKrw: 2400000, cpaKrw: 15584, costPerHireKrw: 1200000 },
        { key: 'top-dev', people: 96, applications: 141, docPass: 22, interviews: 4, hires: 1, jobsPosted: 6, spendFees: 1200000, spendAds: 0, spendKrw: 1200000, cpaKrw: 12500, costPerHireKrw: 1200000 },
        { key: 'jobs-go', people: 41, applications: 55, docPass: 6, interviews: 1, hires: 0, jobsPosted: null, spendFees: null, spendAds: null, spendKrw: null, cpaKrw: null, costPerHireKrw: null },
        { key: 'top-cv', people: 24, applications: 36, docPass: 4, interviews: 1, hires: 1, jobsPosted: null, spendFees: null, spendAds: null, spendKrw: null, cpaKrw: null, costPerHireKrw: null },
      ],
      monthly: [
        { month: '2025-09', count: 84 }, { month: '2025-10', count: 122 }, { month: '2025-11', count: 141 },
        { month: '2025-12', count: 118 }, { month: '2026-01', count: 156 }, { month: '2026-02', count: 173 },
        { month: '2026-03', count: 204 }, { month: '2026-04', count: 188 }, { month: '2026-05', count: 231 },
        { month: '2026-06', count: 259 }, { month: '2026-07', count: 217 },
      ],
    },
    matching: {
      funnel: [
        { key: 'people', label: '지원자', count: 1246 },
        { key: 'screened', label: '스크리닝 합격', count: 323 },
        { key: 'delivered', label: '기업 전달', count: 158 },
        { key: 'interview', label: '면접', count: 58, note: 'Master INTERVIEW 탭 기준' },
        { key: 'offer', label: '오퍼·계약', count: 22 },
        { key: 'hired', label: '입사', count: 17, note: 'Ops Employee 탭 기준' },
      ],
      inProgress: { screeningQueue: 214, readyToForward: 26, sentToCompany: 48, interviewing: 14, offer: 5 },
      jds: [
        { code: 'FPT401', company: 'FPT Korea', title: 'Backend Developer (Java)', headcount: 5, status: 'Ing', open: true, apps: 214, people: 168, docPass: 44, delivered: 21, interviews: 9, offer: 4, hires: 3 },
        { code: 'NX501', company: 'NEXCORE', title: 'Frontend Developer (React)', headcount: 3, status: 'Ing', open: true, apps: 158, people: 121, docPass: 31, delivered: 16, interviews: 7, offer: 3, hires: 2 },
        { code: 'META1303', company: 'MetaSoft', title: 'AI Engineer', headcount: 2, status: 'Ing', open: true, apps: 133, people: 104, docPass: 26, delivered: 12, interviews: 5, offer: 2, hires: 1 },
        { code: 'LM1001', company: 'LimeMedia', title: 'Fullstack Developer', headcount: 2, status: 'Closed', open: false, apps: 176, people: 139, docPass: 35, delivered: 18, interviews: 8, offer: 3, hires: 2 },
        { code: 'KD201', company: 'K-Dynamics', title: 'QA Engineer', headcount: 1, status: 'Closed', open: false, apps: 88, people: 71, docPass: 15, delivered: 8, interviews: 3, offer: 1, hires: 1 },
      ],
      openJds: 3,
      headcountTotal: 10,
      fillRateOpen: 0.6,
    },
    outcome: {
      companies: [
        { company: 'FPT Korea', hires: 5, working: 5, revenueUsd: 46200, profitUsd: 15400 },
        { company: 'NEXCORE', hires: 4, working: 3, revenueUsd: 34100, profitUsd: 10900 },
        { company: 'LimeMedia', hires: 3, working: 3, revenueUsd: 24800, profitUsd: 8100 },
        { company: 'MetaSoft', hires: 3, working: 2, revenueUsd: 15600, profitUsd: 4400 },
        { company: 'K-Dynamics', hires: 2, working: 2, revenueUsd: 7700, profitUsd: 2400 },
      ],
      excludedHires: 0,
    },
  }
}
