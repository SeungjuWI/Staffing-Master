import { getMasterData } from '@/lib/aggregate'
import { fmtDateTime, fmtInt, fmtKrw, fmtPct, fmtUsd } from '@/lib/fmt'
import { Funnel, MonthlyBars, StatTile, Meter } from '@/components/viz'
import { ChannelTable, CompanyTable, JdTable } from '@/components/tables'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>
}) {
  const sp = await searchParams
  const data = await getMasterData(sp.fresh === '1')
  const { headline: h, supply, matching, outcome } = data
  const p = matching.inProgress

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            Staffing Master<small>글로벌신사업본부</small>
          </div>
          <nav className="nav">
            <a href="#overview">개요</a>
            <a href="#matching">매칭</a>
            <a href="#supply">인재</a>
            <a href="#jds">공고</a>
            <a href="#outcome">성과</a>
            <a href="#glossary">용어</a>
          </nav>
          <div className="meta">
            <span>{fmtDateTime(data.generatedAt)} 기준</span>
            <a className="refresh" href="/?fresh=1">
              새로고침
            </a>
          </div>
        </div>
      </header>

      <div className="wrap">
        {data.mode === 'mock' && (
          <div className="banner">
            ⚠ <b>데모 데이터</b> — 환경변수(.env.local)가 설정되지 않아 예시 수치를 표시하고 있습니다.
            .env.example 을 참고해 값을 채우면 실데이터로 전환됩니다.
          </div>
        )}
        {data.warnings.map(w => (
          <div className="banner" key={w}>
            ⚠ 일부 데이터 제외 — {w}
          </div>
        ))}

        {/* ── 개요 ─────────────────────────────────────── */}
        <section className="section" id="overview">
          <div className="section-head">
            <h2>개요</h2>
            <span className="sub">베트남 인재를 모아 한국 기업에 매칭한 최종 성과</span>
          </div>
          <div className="tiles">
            <StatTile
              hero
              label="입사 (누적)"
              value={fmtInt(h.hiresTotal)}
              unit="명"
              sub={
                <>
                  이번 달 <span className="up">+{h.hiresThisMonth}명</span>
                </>
              }
            />
            <StatTile label="재직 중" value={fmtInt(h.working)} unit="명" sub={`이탈 ${h.left}명`} />
            <StatTile label="총 매출" value={fmtUsd(h.revenueUsd)} sub={`이익 ${fmtUsd(h.profitUsd)}`} />
            <StatTile
              label="채용 1명당 마케팅 비용"
              value={h.costPerHireKrw != null ? fmtKrw(h.costPerHireKrw) : '–'}
              sub={`총 지출 ${fmtKrw(h.totalSpendKrw)}`}
            />
            <StatTile
              label="인재풀 (FYI 이력서 등록)"
              value={fmtInt(supply.talentPoolResume)}
              unit="명"
              sub={`이력서 공개 ${fmtInt(supply.talentPoolPublic)}명`}
            />
            <StatTile
              label="오픈 공고"
              value={fmtInt(matching.openJds)}
              unit="건"
              sub={
                <>
                  채용 목표 {fmtInt(matching.headcountTotal)}명 · 충원율 {fmtPct(matching.fillRateOpen, 0)}
                </>
              }
            />
          </div>
        </section>

        {/* ── 매칭 퍼널 ─────────────────────────────────── */}
        <section className="section" id="matching">
          <div className="section-head">
            <h2>매칭 퍼널</h2>
            <span className="sub">지원부터 입사까지 누적 도달 인원 — 매칭 스쿼드</span>
          </div>
          <div className="card">
            <Funnel stages={matching.funnel} />
          </div>
          <div className="section-head" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>지금 진행 중</h2>
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

        {/* ── 인재 (공급) ───────────────────────────────── */}
        <section className="section" id="supply">
          <div className="section-head">
            <h2>인재 유입 채널</h2>
            <span className="sub">
              채널별 모집 성과와 비용 효율 — 인재 스쿼드 · 지원자 {fmtInt(supply.candidatesTotal)}명 · 지원{' '}
              {fmtInt(supply.applicationsTotal)}건
            </span>
          </div>
          <div className="card">
            <ChannelTable channels={supply.channels} />
          </div>
          <div className="section-head" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>월별 지원 건 추이</h2>
            <span className="sub">전 채널 합산, 지원월 기준</span>
          </div>
          <div className="card">
            <MonthlyBars points={supply.monthly} />
          </div>
        </section>

        {/* ── 공고 현황 ─────────────────────────────────── */}
        <section className="section" id="jds">
          <div className="section-head">
            <h2>공고 현황</h2>
            <span className="sub">공고별 파이프라인과 충원율 (진행 중 공고 우선)</span>
          </div>
          <div className="card">
            <JdTable jds={matching.jds} />
          </div>
        </section>

        {/* ── 성과 ─────────────────────────────────────── */}
        <section className="section" id="outcome">
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

        {/* ── 용어 사전 ─────────────────────────────────── */}
        <section className="section" id="glossary">
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
                <dd>파이프라인을 거쳐 최종 입사한 인원 — 이 사업의 North Star (별도 경로 입사 제외)</dd>
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
                <dt>지원자당 비용</dt>
                <dd>채널 지출 ÷ 지원자 수 (CPA)</dd>
              </div>
              <div>
                <dt>채용당 비용</dt>
                <dd>채널 지출 ÷ 입사 수</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="foot">
          출처: ktc-support(파이프라인 라이브) · salarymap(FYI·지원 건) · Master 시트(공고·면접) · KTC Ops
          시트(입사·매출) · 비용 시트(지출) — 30분 캐시, 새로고침으로 즉시 갱신
        </div>
      </div>
    </>
  )
}
