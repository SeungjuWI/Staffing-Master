import { Suspense, cache } from 'react'
import { getMasterData, type Period } from '@/lib/aggregate'
import { fmtDateTime, fmtInt, fmtKrw, fmtPct, fmtSinceMonth, fmtUsd } from '@/lib/fmt'
import { Funnel, MonthlyBars, StatTile } from '@/components/viz'
import { ChannelHealthSummary, ChannelTable, CompanyTable, JdHealthSummary, JdTable } from '@/components/tables'
import { CountUp } from '@/components/count-up'
import { RefreshButton } from '@/components/refresh-button'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'korea', label: '한국 매칭' },
  { key: 'vietnam', label: '베트남 매칭' },
  { key: 'talent', label: '인재·채널' },
  { key: 'glossary', label: '용어' },
] as const
type TabKey = (typeof TABS)[number]['key']

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: '누적' },
  { key: 'month', label: '이번 달' },
  { key: '30d', label: '최근 30일' },
]

// 헤더의 "기준 시각"과 본문, 두 Suspense 경계가 데이터를 각각 부르지 않도록 요청 내 1회로 메모.
const loadData = cache((fresh: boolean, period: Period) => getMasterData(fresh, period))

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string; tab?: string; period?: string }>
}) {
  const sp = await searchParams
  const tab: TabKey = (TABS.some(t => t.key === sp.tab) ? sp.tab : 'overview') as TabKey
  const period: Period = (PERIODS.some(p => p.key === sp.period) ? sp.period : 'all') as Period
  const fresh = sp.fresh === '1'
  const q = (t: string) => `/?tab=${t}&period=${period}`

  // 껍데기(헤더·탭·기간·새로고침)는 데이터를 기다리지 않고 즉시 렌더 → 첫 페인트가 빠르다.
  // 데이터가 필요한 "기준 시각"과 본문만 Suspense 로 감싸 스트리밍한다.
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <span className="logo" aria-hidden />
            Staffing Master<small>글로벌신사업본부</small>
          </div>
          <nav className="nav">
            {TABS.map(t => (
              <a key={t.key} className={t.key === tab ? 'on' : ''} href={q(t.key)} data-label={t.label}>
                {t.label}
              </a>
            ))}
          </nav>
          <div className="pills" aria-label="기간 선택">
            {PERIODS.map(p => (
              <a
                key={p.key}
                className={p.key === period ? 'on' : ''}
                href={`/?tab=${tab}&period=${p.key}`}
                data-label={p.label}
              >
                {p.label}
              </a>
            ))}
          </div>
          <div className="meta">
            <Suspense fallback={<span className="dim">불러오는 중…</span>}>
              <GeneratedAt fresh={fresh} period={period} />
            </Suspense>
            <RefreshButton href={`/?tab=${tab}&period=${period}&fresh=1`} />
          </div>
        </div>
      </header>

      <div className="wrap">
        <Suspense fallback={<DashboardSkeleton />}>
          <Dashboard tab={tab} period={period} filtered={period !== 'all'} fresh={fresh} />
        </Suspense>
      </div>
    </>
  )
}

// 헤더 우측 "기준 시각" — 데이터 준비되면 채워진다.
async function GeneratedAt({ fresh, period }: { fresh: boolean; period: Period }) {
  const data = await loadData(fresh, period)
  return <span>{fmtDateTime(data.generatedAt)} 기준</span>
}

// 데이터 로딩 중 본문 자리를 지키는 스켈레톤 (레이아웃 점프 방지)
function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="대시보드 불러오는 중">
      <section className="section">
        <div className="card skel-card">
          <div className="skel-bar" style={{ width: '38%', height: 30 }} />
          <div className="skel-bar" style={{ width: '68%' }} />
          <div className="skel-bar" style={{ width: '54%' }} />
        </div>
      </section>
      <section className="section">
        <div className="card skel-card">
          <div className="skel-bar" style={{ width: '30%' }} />
          <div className="skel-bar" style={{ width: '92%' }} />
          <div className="skel-bar" style={{ width: '86%' }} />
          <div className="skel-bar" style={{ width: '80%' }} />
        </div>
      </section>
    </div>
  )
}

async function Dashboard({
  tab,
  period,
  filtered,
  fresh,
}: {
  tab: TabKey
  period: Period
  filtered: boolean
  fresh: boolean
}) {
  const data = await loadData(fresh, period)
  const { headline: h, supply, matching, vietnam: v, outcome } = data
  const p = matching.inProgress
  const openJds = matching.jds.filter(j => j.open)
  const closedJds = matching.jds.filter(j => !j.open)

  return (
    <>
      {data.mode === 'mock' && (
        <div className="banner">
          <b>데모 데이터</b> — 환경변수(.env.local)가 설정되지 않아 예시 수치를 표시하고 있습니다.
        </div>
      )}
      {data.warnings.map(w => (
        <div className="banner" key={w}>
          <b>일부 데이터 제외</b> — {w}
        </div>
      ))}
      {filtered && (
        <div className="periodnote">
          <b>{PERIODS.find(p => p.key === period)!.label}</b> 보기 — 지원일 코호트 기준 (이 기간에 지원한 인재의 현재
          도달 단계) · 입사 누적·재직·매출·인재풀·비용 지표는 누적 유지
        </div>
      )}

      {/* ══ 개요 ══════════════════════════════════════ */}
      {tab === 'overview' && (
        <>
          <section className="section">
            <div className="hero-card">
              <div className="hero-main">
                <div className="hero-label">입사 (누적)</div>
                <div className="hero-row">
                  <span className="hero-num">
                    <CountUp n={h.hiresTotal} />
                  </span>
                  <span className="hero-unit">명</span>
                  {h.hiresThisMonth > 0 && <span className="chip">이번 달 +{h.hiresThisMonth}</span>}
                </div>
              </div>
              <div className="hero-side">
                <div className="kv">
                  <div className="k">재직 중</div>
                  <div className="v">
                    {fmtInt(h.working)}명 <span className="dim">/ 이탈 {h.left}명</span>
                  </div>
                </div>
                <div className="kv">
                  <div className="k">총 매출</div>
                  <div className="v">
                    {fmtUsd(h.revenueUsd)} <span className="dim">이익 {fmtUsd(h.profitUsd)}</span>
                  </div>
                </div>
                <div className="kv">
                  <div className="k">채용 1명당 마케팅 비용</div>
                  <div className="v">
                    {h.costPerHireKrw != null ? fmtKrw(h.costPerHireKrw) : '–'}{' '}
                    <span className="dim">지출 {fmtKrw(h.totalSpendKrw)}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 트랙 × 스쿼드 매트릭스 — 칠판 구조 그대로 */}
          <section className="section">
            <div className="section-head">
              <h2>트랙 × 스쿼드</h2>
              <span className="sub">한국기업·베트남 로컬 두 트랙을 유입/인재/매칭 스쿼드 기준으로</span>
            </div>
            <div className="matrix-scroll">
              <div className="matrix">
                <div className="mhead" />
                <div className="mhead">
                  유입<span>기업 확보</span>
                </div>
                <div className="mhead">
                  인재<span>지원 모집</span>
                </div>
                <div className="mhead">
                  매칭<span>채용 성사</span>
                </div>

                <div className="mrow">
                  한국기업<span>KTC 경유</span>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(matching.jds.length)}
                    <small>건 공고 수주</small>
                  </div>
                  <div className="sub">
                    모집 중 {fmtInt(matching.openJds)}건 · 예정 {fmtInt(matching.headcountTotal)}명 중 {fmtInt(matching.hiresInOpen)}명 채움
                  </div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(supply.candidatesTotal)}
                    <small>명 지원</small>
                  </div>
                  <div className="sub">스크리닝 합격 {fmtInt(matching.funnel[1]?.count ?? 0)}명</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(h.hiresTotal)}
                    <small>명 입사</small>
                  </div>
                  <div className="sub">검토 중 {fmtInt(p.sentToCompany)} · 면접 {fmtInt(p.interviewing)} · 재직 {fmtInt(h.working)}</div>
                </div>

                <div className="mrow">
                  베트남 로컬<span>FYI 직접</span>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(v.companies)}
                    <small>개 기업</small>
                  </div>
                  <div className="sub">공고 {fmtInt(v.jobsTotal)}건 (모집 중 {fmtInt(v.jobsActive)}건)</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(v.applicants)}
                    <small>명 지원</small>
                  </div>
                  <div className="sub">지원 {fmtInt(v.applications)}건 · 이력서 보유 {fmtInt(supply.talentPoolResume)}명</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {fmtInt(v.viewed)}
                    <small>건 기업 열람</small>
                  </div>
                  <div className="sub">
                    {v.applications > 0 ? `열람율 ${fmtPct(v.viewed / v.applications, 0)}` : '–'} · 채용 단계 연동 예정
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>지원부터 입사까지 (한국기업)</h2>
              <span className="sub">
                {filtered ? '이 기간에 지원한 인재가 지금 어디까지 갔는지' : '누적 도달 인원'}
              </span>
            </div>
            <div className="card">
              <Funnel stages={matching.funnel} />
            </div>
          </section>
        </>
      )}

      {/* ══ 한국 매칭 ══════════════════════════════════ */}
      {tab === 'korea' && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>지금 진행 중</h2>
              <span className="sub">현재 각 단계에 걸려 있는 인원</span>
            </div>
            <div className="strip">
              <div className="cell">
                <div className="label">스크리닝 대기</div>
                <div className="value">{fmtInt(p.screeningQueue)}</div>
              </div>
              <div className="cell">
                <div className="label">발송 대기</div>
                <div className="value">{fmtInt(p.readyToForward)}</div>
              </div>
              <div className="cell">
                <div className="label">기업 검토 중</div>
                <div className="value">{fmtInt(p.sentToCompany)}</div>
              </div>
              <div className="cell">
                <div className="label">면접 진행 중</div>
                <div className="value">{fmtInt(p.interviewing)}</div>
              </div>
              <div className="cell">
                <div className="label">오퍼·계약 중</div>
                <div className="value">{fmtInt(p.offer)}</div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head wrapline">
              <h2>진행 중 공고</h2>
              <span className="sub">
                {fmtInt(openJds.length)}건 · 목표 {fmtInt(matching.headcountTotal)}명 중 {fmtInt(matching.hiresInOpen)}명 채움
                {matching.jdSince && <> · {fmtSinceMonth(matching.jdSince)}부터 누적 {fmtInt(matching.jds.length)}건 수주</>}
              </span>
              <JdHealthSummary jds={openJds} />
            </div>
            <div className="card">
              <JdTable jds={openJds} />
              {closedJds.length > 0 && (
                <details className="fold">
                  <summary>마감 공고 {fmtInt(closedJds.length)}건 보기</summary>
                  <JdTable jds={closedJds} mode="closed" />
                </details>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>기업별 성과</h2>
              <span className="sub">
                입사·재직·매출 — 파이프라인 경유 입사만 집계
                {outcome.excludedHires > 0 && ` (별도 경로 입사 ${outcome.excludedHires}명 제외)`}
              </span>
            </div>
            <div className="card">
              <CompanyTable companies={outcome.companies} />
            </div>
          </section>
        </>
      )}

      {/* ══ 베트남 매칭 ════════════════════════════════ */}
      {tab === 'vietnam' && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>베트남 매칭 (FYI 자체)</h2>
              <span className="sub">베트남 기업 ↔ 베트남 인재 — FYI 플랫폼 안에서 직접 매칭 (ktc-support 미경유)</span>
            </div>
            <div className="tiles">
              <StatTile label="활성 공고" num={v.jobsActive} unit="건" sub={`누적 등록 ${fmtInt(v.jobsTotal)}건`} />
              <StatTile label="등록 기업" num={v.companies} unit="곳" />
              <StatTile label="지원 건" num={v.applications} unit="건" />
              <StatTile label="지원자" num={v.applicants} unit="명" />
              <StatTile
                label="기업 열람"
                num={v.viewed}
                unit="건"
                sub={v.applications > 0 ? `열람율 ${fmtPct(v.viewed / v.applications, 0)}` : undefined}
              />
            </div>
          </section>
          <section className="section">
            <div className="card">
              {v.jobsTotal === 0 ? (
                <p className="dim">
                  아직 기업이 직접 등록한 자체 공고가 없습니다. 베트남 기업 공고가 FYI 에 올라오면 이 탭에 자동으로
                  집계됩니다.
                </p>
              ) : (
                <p className="dim">
                  현재 추적 단계: 공고 등록 → 지원 → 기업 열람. 스크리닝·면접·채용 확정 단계는 FYI 지원 상태값이
                  운영에 도입되는 대로 한국 매칭과 같은 퍼널 어휘(스크리닝 합격 → 기업 전달 → 면접 → 오퍼 → 입사)로
                  이 탭에 추가됩니다.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* ══ 인재·채널 ══════════════════════════════════ */}
      {tab === 'talent' && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>인재풀 (FYI)</h2>
              <span className="sub">salary-fyi.com 에 쌓인 매칭 가능 인재</span>
            </div>
            <div className="tiles">
              <StatTile label="이력서 등록" num={supply.talentPoolResume} unit="명" />
              <StatTile label="이력서 공개 (HR 열람 가능)" num={supply.talentPoolPublic} unit="명" />
              <StatTile label="지원자 (전 채널 누적)" num={supply.candidatesTotal} unit="명" />
              <StatTile label="지원 건 (전 채널 누적)" num={supply.applicationsTotal} unit="건" />
            </div>
          </section>

          <section className="section">
            <div className="section-head wrapline">
              <h2>유입 채널별 성과·비용</h2>
              <span className="sub">
                성과순 · <span className="ck paid">유료</span> 게재비·광고 집행{' '}
                <span className="ck own">자사</span> 우리 플랫폼 <span className="ck free">무료</span> 무료 게재
              </span>
              <ChannelHealthSummary channels={supply.channels} />
            </div>
            <div className="card">
              <ChannelTable channels={supply.channels} />
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>월별 지원 건 추이</h2>
              <span className="sub">전 채널 합산, 지원월 기준</span>
            </div>
            <div className="card">
              <MonthlyBars points={supply.monthly} />
            </div>
          </section>
        </>
      )}

      {/* ══ 용어 ══════════════════════════════════════ */}
      {tab === 'glossary' && (
        <section className="section">
          <div className="section-head">
            <h2>용어 사전</h2>
            <span className="sub">이 대시보드의 모든 숫자는 아래 정의를 따릅니다</span>
          </div>
          <div className="card">
            <dl className="glossary">
              <div>
                <dt>인재풀</dt>
                <dd>FYI(salary-fyi.com)에 이력서를 등록한 인재 수</dd>
              </div>
              <div>
                <dt>지원자</dt>
                <dd>고유 인재 1명 (여러 공고에 지원해도 1명, 최초 유입 채널로 귀속)</dd>
              </div>
              <div>
                <dt>지원 건</dt>
                <dd>공고 1건에 대한 지원 1건 (한 사람이 공고 2개 지원 = 2건)</dd>
              </div>
              <div>
                <dt>스크리닝 합격</dt>
                <dd>AI CV 스크리닝 통과 (이후 단계 도달자 포함 누적)</dd>
              </div>
              <div>
                <dt>기업 전달</dt>
                <dd>이력서가 기업에 전달된 인원 (누적)</dd>
              </div>
              <div>
                <dt>면접</dt>
                <dd>기업 면접에 도달한 인원 (사람 단위 1회)</dd>
              </div>
              <div>
                <dt>오퍼·계약</dt>
                <dd>오퍼 또는 계약 단계 도달 인원</dd>
              </div>
              <div>
                <dt>입사</dt>
                <dd>파이프라인을 거쳐 최종 입사한 인원 (별도 경로 입사 제외)</dd>
              </div>
              <div>
                <dt>재직 중</dt>
                <dd>파이프라인 경유 입사자 중 현재 재직 유지 인원</dd>
              </div>
              <div>
                <dt>TO / 충원율</dt>
                <dd>공고별 채용 목표 인원 / 입사 ÷ TO</dd>
              </div>
              <div>
                <dt>수주일</dt>
                <dd>기업에서 공고를 받은 날 (Master 시트 Date Received, 미기재 시 그 공고의 최초 지원일)</dd>
              </div>
              <div>
                <dt>공고 판정</dt>
                <dd>
                  순항 = 충원 완료 또는 기업 검토·면접·오퍼 진행 인원 있음 · 정체 = 지원은 충분한데 기업 단계 진행 0 ·
                  지원 부족 = TO 1명당 지원 30명 미만 · 모집 초기 = 수주 2주 미만 (판정 유예)
                </dd>
              </div>
              <div>
                <dt>TO당 지원 30명</dt>
                <dd>지원 부족의 기준선 — 입사가 성사된 공고들의 TO당 지원자 실측 (최소 9 ~ 중앙값 61명)의 하위 사분위 수준</dd>
              </div>
              <div>
                <dt>진행 인원</dt>
                <dd>지금 그 단계에 걸려 있는 인원 (현재 상태 기준, 도달 누적 아님)</dd>
              </div>
              <div>
                <dt>지원자당 비용</dt>
                <dd>채널 지출 ÷ 지원자 수 (CPA)</dd>
              </div>
              <div>
                <dt>채용당 비용</dt>
                <dd>채널 지출 ÷ 입사 수</dd>
              </div>
              <div>
                <dt>채널 판정</dt>
                <dd>
                  성과 = 입사 발생, 채용당 비용 정상 · 고비용 = 입사는 있지만 채용당 비용이 전체 평균의 3배 이상 ·
                  점검 = 지출 있는데 입사 0 · 관망 = 지출·입사 모두 0 — 비용 데이터가 없는 기간 보기에서는 표시 안 함
                </dd>
              </div>
              <div>
                <dt>과거 유입 경로</dt>
                <dd>지금은 쓰지 않는 유입 경로 (구 시트·구글폼·채널 미상 등) — 채널 표 맨 아래 '과거' 칩으로 구분, 판정 제외</dd>
              </div>
              <div>
                <dt>베트남 매칭</dt>
                <dd>베트남 기업이 FYI 에 직접 올린 공고로 이뤄지는 매칭 (한국 매칭 파이프라인과 별도 트랙)</dd>
              </div>
              <div>
                <dt>기업 열람</dt>
                <dd>베트남 매칭에서 기업이 지원서를 열어 본 건수</dd>
              </div>
            </dl>
          </div>
          <div className="foot">
            출처: ktc-support(파이프라인 라이브) · salarymap/FYI(인재풀·지원 건·베트남 매칭) · Master 시트(공고·면접) ·
            KTC Ops 시트(입사·매출) · 비용 시트(지출) — 30분 캐시, 새로고침으로 즉시 갱신
          </div>
        </section>
      )}
    </>
  )
}
