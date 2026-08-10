import { Suspense, cache } from 'react'
import { cookies } from 'next/headers'
import { getMasterData, type Period } from '@/lib/aggregate'
import { ACTION_LABEL, ACTION_PREV_LABEL, fmtPct } from '@/lib/fmt'
import { LANG_COOKIE, getI18n, pickLocale, type I18n } from '@/lib/i18n'
import { rich } from '@/lib/i18n-rich'
import { Funnel, MonthlyBars, StatTile } from '@/components/viz'
import { SrcLinkProvider, SrcTip } from '@/components/src-tip'
import { ChannelHealthSummary, ChannelTable, CompanyTable, JdHealthSummary } from '@/components/tables'
import { JdTable } from '@/components/jd-table'
import { DailyChannelLines } from '@/components/daily-chart'
import { CountUp } from '@/components/count-up'
import { RefreshButton } from '@/components/refresh-button'
import { LangSwitch } from '@/components/lang-switch'

export const dynamic = 'force-dynamic'

// 개요·베트남 매칭은 아직 미완성이라 내비에서 숨김 (2026-07-29 회의) — 렌더 코드는 남겨두고
// URL(?tab=overview 등)로는 계속 접근 가능. 완성되면 hidden 만 내리면 된다.
const TABS = [
  { key: 'overview', label: 'nav.overview', hidden: true },
  { key: 'korea', label: 'nav.korea', hidden: false },
  { key: 'vietnam', label: 'nav.vietnam', hidden: true },
  { key: 'talent', label: 'nav.talent', hidden: false },
  { key: 'glossary', label: 'nav.glossary', hidden: false },
] as const
type TabKey = (typeof TABS)[number]['key']

// '7/28~' = 액션 분리선 이후 (FYI 정리·KTC 집중 집행 시작일) — 월 경계로는 안 잡히는 창.
// 라벨은 i18n 키, action 은 날짜 리터럴이라 전 로케일 공통.
const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'period.all' },
  { key: 'action', label: `${ACTION_LABEL}~` },
  { key: 'month', label: 'period.month' },
  { key: '30d', label: 'period.30d' },
]
const periodLabel = (i: I18n, key: Period) => {
  const p = PERIODS.find(p => p.key === key)!
  return p.key === 'action' ? p.label : i.t(p.label)
}

// 헤더의 "기준 시각"과 본문, 두 Suspense 경계가 데이터를 각각 부르지 않도록 요청 내 1회로 메모.
const loadData = cache((fresh: boolean, period: Period) => getMasterData(fresh, period))

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string; tab?: string; period?: string }>
}) {
  const sp = await searchParams
  const i = getI18n(pickLocale((await cookies()).get(LANG_COOKIE)?.value))
  const tab: TabKey = (TABS.some(t => t.key === sp.tab) ? sp.tab : 'korea') as TabKey
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
            Staffing Master<small>{i.t('brand.sub')}</small>
          </div>
          <nav className="nav">
            {TABS.filter(t => !t.hidden).map(t => (
              <a key={t.key} className={t.key === tab ? 'on' : ''} href={q(t.key)} data-label={i.t(t.label)}>
                {i.t(t.label)}
              </a>
            ))}
          </nav>
          <div className="pills" aria-label={i.t('a11y.periodPick')}>
            {PERIODS.map(p => (
              <a
                key={p.key}
                className={p.key === period ? 'on' : ''}
                href={`/?tab=${tab}&period=${p.key}`}
                data-label={periodLabel(i, p.key)}
              >
                {periodLabel(i, p.key)}
              </a>
            ))}
          </div>
          <div className="meta">
            <Suspense fallback={<span className="dim">{i.t('common.loading')}</span>}>
              <GeneratedAt i={i} fresh={fresh} period={period} />
            </Suspense>
            <RefreshButton href={`/?tab=${tab}&period=${period}&fresh=1`} />
            <LangSwitch />
          </div>
        </div>
      </header>

      <div className="wrap">
        <Suspense fallback={<DashboardSkeleton i={i} />}>
          <Dashboard i={i} tab={tab} period={period} filtered={period !== 'all'} fresh={fresh} />
        </Suspense>
      </div>
    </>
  )
}

// 헤더 우측 "기준 시각" — 데이터 준비되면 채워진다.
async function GeneratedAt({ i, fresh, period }: { i: I18n; fresh: boolean; period: Period }) {
  const data = await loadData(fresh, period)
  return <span>{i.t('asOf', { t: i.fmtDateTime(data.generatedAt) })}</span>
}

// 데이터 로딩 중 본문 자리를 지키는 스켈레톤 (레이아웃 점프 방지)
function DashboardSkeleton({ i }: { i: I18n }) {
  return (
    <div aria-busy="true" aria-label={i.t('a11y.dashLoading')}>
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
  i,
  tab,
  period,
  filtered,
  fresh,
}: {
  i: I18n
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

  // SrcLinkProvider — 출처 말풍선(ⓘ)이 시트 탭 링크를 찾을 수 있게 트리 전체에 링크 맵 공급
  return (
    <SrcLinkProvider links={data.sheetLinks}>
      {data.mode === 'mock' && (
        <div className="banner">
          <b>{i.t('banner.demoTitle')}</b> — {i.t('banner.demoBody')}
        </div>
      )}
      {data.warnings.map(w => (
        <div className="banner" key={w}>
          <b>{i.t('banner.excluded')}</b> — {w}
        </div>
      ))}
      {filtered && (
        <div className="periodnote">
          {rich(i.t('periodnote.main', { p: periodLabel(i, period) }))}
          {data.spendAsOf && <>{i.t('periodnote.spend', { d: i.fmtDay(data.spendAsOf) })}</>}
        </div>
      )}

      {/* ══ 개요 ══════════════════════════════════════ */}
      {tab === 'overview' && (
        <>
          <section className="section">
            <div className="hero-card">
              <div className="hero-main">
                <div className="hero-label">
                  {filtered ? i.t('hero.labelFiltered', { p: periodLabel(i, period) }) : i.t('hero.labelAll')}
                </div>
                <div className="hero-row">
                  <span className="hero-num">
                    <CountUp n={filtered && h.hiresInPeriod != null ? h.hiresInPeriod : h.hiresTotal} />
                  </span>
                  {i.t('unit.people') && <span className="hero-unit">{i.t('unit.people')}</span>}
                  {filtered ? (
                    <span className="chip">{i.t('chip.cumHires', { n: i.fmtInt(h.hiresTotal) })}</span>
                  ) : (
                    h.hiresThisMonth > 0 && <span className="chip">{i.t('chip.monthHires', { n: h.hiresThisMonth })}</span>
                  )}
                </div>
              </div>
              <div className="hero-side">
                <div
                  className="kv"
                  title={
                    h.working + h.left !== h.hiresTotal
                      ? i.t('title.workingGap', { a: i.fmtInt(h.working + h.left), b: i.fmtInt(h.hiresTotal) })
                      : undefined
                  }
                >
                  <div className="k">{i.t('kv.working')}</div>
                  <div className="v">
                    {i.t('n.people', { n: i.fmtInt(h.working) })} <span className="dim">{i.t('kv.leftDim', { n: i.fmtInt(h.left) })}</span>
                  </div>
                </div>
                <div className="kv">
                  <div className="k">{i.t('kv.revenue')}{filtered && i.t('common.cumSuffix')}</div>
                  <div className="v">
                    {i.fmtUsd(h.revenueUsd)} <span className="dim">{i.t('kv.profitDim', { v: i.fmtUsd(h.profitUsd) })}</span>
                  </div>
                </div>
                <div className="kv">
                  <div className="k">{i.t('kv.cph')}{filtered && i.t('kv.cphPeriodSuffix')}</div>
                  <div className="v">
                    {h.costPerHireKrw != null ? i.fmtKrw(h.costPerHireKrw) : '–'}{' '}
                    <span className="dim">{i.t('kv.spendDim', { v: i.fmtKrw(h.totalSpendKrw) })}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 트랙 × 스쿼드 매트릭스 — 칠판 구조 그대로 */}
          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.matrix')}</h2>
              <span className="sub">{i.t('sec.matrixSub')}</span>
            </div>
            <div className="matrix-scroll">
              <div className="matrix">
                <div className="mhead" />
                <div className="mhead">
                  {i.t('matrix.headCompany')}<span>{i.t('matrix.headCompanySub')}</span>
                </div>
                <div className="mhead">
                  {i.t('matrix.headTalent')}<span>{i.t('matrix.headTalentSub')}</span>
                </div>
                <div className="mhead">
                  {i.t('matrix.headMatch')}<span>{i.t('matrix.headMatchSub')}</span>
                </div>

                <div className="mrow">
                  {i.t('matrix.rowKorea')}<span>{i.t('matrix.rowKoreaSub')}</span>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(matching.jds.length)}
                    <small>{i.t('matrix.u.jdWon')}</small>
                  </div>
                  <div className="sub">
                    {i.t('matrix.openFill', { o: i.fmtInt(matching.openJds), m: i.fmtInt(matching.headcountTotal), k: i.fmtInt(matching.hiresInOpen) })}
                  </div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(supply.candidatesTotal)}
                    <small>{i.t('matrix.u.applied')}</small>
                  </div>
                  <div className="sub">{i.t('matrix.screenPass', { n: i.fmtInt(matching.funnel[1]?.count ?? 0) })}</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(filtered && h.hiresInPeriod != null ? h.hiresInPeriod : h.hiresTotal)}
                    <small>{i.t('matrix.u.hired')}{filtered ? i.t('common.periodSuffix') : ''}</small>
                  </div>
                  <div className="sub">
                    {(() => {
                      // 기업 전달 누적 대비 검토 체류가 절반 이상이면 적체 신호 (공고 '정체' 판정과 같은 어휘)
                      const delivered = matching.funnel[2]?.count ?? 0
                      const stuck = delivered > 0 && p.sentToCompany / delivered >= 0.5
                      return stuck ? (
                        <i
                          className="jdot stall"
                          title={i.t('matrix.stuckTitle', { a: i.fmtInt(delivered), b: i.fmtInt(p.sentToCompany) })}
                        />
                      ) : null
                    })()}
                    {i.t('matrix.nowLine', { a: i.fmtInt(p.sentToCompany), b: i.fmtInt(p.interviewing), c: i.fmtInt(h.working) })}
                  </div>
                </div>

                <div className="mrow">
                  {i.t('matrix.rowVn')}<span>{i.t('matrix.rowVnSub')}</span>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(v.companies)}
                    <small>{i.t('matrix.u.companies')}</small>
                  </div>
                  <div className="sub">{i.t('matrix.vnJobs', { n: i.fmtInt(v.jobsTotal), m: i.fmtInt(v.jobsActive) })}</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(v.applicants)}
                    <small>{i.t('matrix.u.applied')}</small>
                  </div>
                  <div className="sub">{i.t('matrix.vnAppsLine', { n: i.fmtInt(v.applications), m: i.fmtInt(supply.talentPoolResume) })}</div>
                </div>
                <div className="mcell">
                  <div className="num">
                    {i.fmtInt(v.viewed)}
                    <small>{i.t('matrix.u.viewed')}</small>
                  </div>
                  <div className="sub">
                    {i.t('matrix.viewedNote')}
                    {v.applications > 0 && ` ${i.t('matrix.viewedRate', { p: fmtPct(v.viewed / v.applications, 0) })}`}{i.t('matrix.viewedTail')}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.funnel')}</h2>
              <span className="sub">
                {filtered ? i.t('sec.funnelSubFiltered') : i.t('sec.funnelSubAll')}
              </span>
            </div>
            <div className="card">
              <Funnel
                i={i}
                stages={matching.funnel}
                // 오퍼는 통과 즉시 입사로 상태 전환 — 지금 오퍼 진행자가 없으면 두 단계 수치가 같아져 100% 로 보인다
                extra={
                  p.offer === 0 &&
                  matching.funnel.at(-2)?.count === matching.funnel.at(-1)?.count
                    ? i.t('funnel.offerSame')
                    : undefined
                }
              />
            </div>
          </section>
        </>
      )}

      {/* ══ 한국 매칭 ══════════════════════════════════ */}
      {tab === 'korea' && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.now')}</h2>
              <span className="sub">
                {i.t('sec.nowSub')}
                {filtered && i.t('sec.nowSubPeriod')}
                <SrcTip k="now.stages" left />
              </span>
            </div>
            <div className="strip">
              {(() => {
                // 단계별: 전체(마감 잔류 포함) 큰 숫자 + 모집 중 공고 몫 + 최다 공고 툴팁.
                // 마감 공고에 남은 상태값(예: 검토 중 232명)이 커서, 액션 가능한 몫을 분리해 보여준다.
                type J = (typeof openJds)[number]
                const stages: { label: string; total: number; of: (j: J) => number; status: string; hint?: string }[] = [
                  { label: i.t('stage.new'), total: p.screeningQueue, of: j => j.curNew, status: 'new' },
                  { label: i.t('stage.passed'), total: p.screenPassed, of: j => j.curPassed, status: 'passed', hint: i.t('stage.passedHint') },
                  { label: i.t('stage.ready'), total: p.readyToForward, of: j => j.curReady, status: 'ready_to_forward' },
                  { label: i.t('stage.company'), total: p.sentToCompany, of: j => j.curCompany, status: 'sent_to_company' },
                  { label: i.t('stage.interview'), total: p.interviewing, of: j => j.curInterview, status: 'interviewing' },
                  { label: i.t('stage.offer'), total: p.offer, of: j => j.curOffer, status: 'offer' },
                ]
                return stages.map(s => {
                  const inOpen = openJds.reduce((n, j) => n + s.of(j), 0)
                  const top = openJds.reduce<J | null>((b, j) => (s.of(j) > (b ? s.of(b) : 0) ? j : b), null)
                  const rest = Math.max(0, s.total - inOpen)
                  const title = [
                    s.hint,
                    top && s.of(top) > 0 ? i.t('now.topTitle', { co: top.company, code: top.code, n: i.fmtInt(s.of(top)) }) : null,
                    rest > 0 ? i.t('now.restTitle') : null,
                    i.t('now.srcTitle', { s: s.status }),
                  ]
                    .filter(Boolean)
                    .join('\n')
                  return (
                    <div className="cell" key={s.label} title={title || undefined}>
                      <div className="label">{s.label}</div>
                      <div className="value">{i.fmtInt(s.total)}</div>
                      <div className="sub">
                        {i.t('now.inOpen', { n: i.fmtInt(inOpen) })}
                        {rest > 0 && <span className="dim">{i.t('now.rest', { n: i.fmtInt(rest) })}</span>}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </section>

          <section className="section">
            <div className="section-head wrapline">
              <h2>{i.t('sec.jds')}</h2>
              <span className="sub">
                {i.t('jds.fill', { n: i.fmtInt(openJds.length), m: i.fmtInt(matching.headcountTotal), k: i.fmtInt(matching.hiresInOpen) })}
                {matching.jdSince && <>{i.t('jds.since', { m: i.fmtSinceMonth(matching.jdSince), n: i.fmtInt(matching.jds.length) })}</>}
              </span>
              <JdHealthSummary i={i} jds={openJds} />
            </div>
            <div className="card">
              <JdTable jds={openJds} />
              {closedJds.length > 0 && (
                <details className="fold">
                  <summary>{i.t('fold.closed', { n: i.fmtInt(closedJds.length) })}</summary>
                  <JdTable jds={closedJds} mode="closed" />
                </details>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.company')}</h2>
              <span className="sub">
                {i.t('sec.companySub')}
                {outcome.excludedHires > 0 && i.t('sec.companyExcluded', { n: outcome.excludedHires })}
                {filtered && i.t('sec.companyCum')}
              </span>
            </div>
            <div className="card">
              <CompanyTable i={i} companies={outcome.companies} />
            </div>
          </section>
        </>
      )}

      {/* ══ 베트남 매칭 ════════════════════════════════ */}
      {tab === 'vietnam' && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.vn')}</h2>
              <span className="sub">{i.t('sec.vnSub')}</span>
            </div>
            <div className="tiles">
              <StatTile label={i.t('tile.vnActive')} num={v.jobsActive} unit={i.t('unit.jobs')} sub={i.t('tile.vnActiveSub', { n: i.fmtInt(v.jobsTotal) })} src="vn.jobs" />
              <StatTile label={i.t('tile.vnCompanies')} num={v.companies} unit={i.t('unit.companies')} src="vn.companies" />
              <StatTile label={i.t('tile.vnApps')} num={v.applications} unit={i.t('unit.apps')} src="vn.apps" />
              <StatTile label={i.t('tile.vnApplicants')} num={v.applicants} unit={i.t('unit.people')} src="vn.applicants" />
              <StatTile
                label={i.t('tile.vnViewed')}
                num={v.viewed}
                unit={i.t('unit.views')}
                sub={v.applications > 0 ? i.t('tile.vnViewedSub', { p: fmtPct(v.viewed / v.applications, 0) }) : undefined}
                src="vn.viewed"
              />
            </div>
          </section>
          <section className="section">
            <div className="card">
              {v.jobsTotal === 0 ? (
                <p className="dim">{i.t('vn.empty')}</p>
              ) : (
                <p className="dim">{i.t('vn.trackNote')}</p>
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
              <h2>{i.t('sec.talent')}</h2>
              <span className="sub">{i.t('sec.talentSub')}</span>
            </div>
            <div className="tiles">
              <StatTile label={i.t('tile.resume')} num={supply.talentPoolResume} unit={i.t('unit.people')} src="tp.resume" />
              <StatTile label={i.t('tile.public')} num={supply.talentPoolPublic} unit={i.t('unit.people')} src="tp.public" />
              <StatTile label={i.t('tile.people')} num={supply.candidatesTotal} unit={i.t('unit.people')} src="tp.people" />
              <StatTile label={i.t('tile.apps')} num={supply.applicationsTotal} unit={i.t('unit.apps')} src="tp.apps" />
            </div>
          </section>

          <section className="section">
            <div className="section-head wrapline">
              <h2>{i.t('sec.channels')}</h2>
              <span className="sub">
                {i.t('channels.sortNote')} <span className="ck paid">{i.t('kind.paid')}</span> {i.t('kindDesc.paid')}{' '}
                <span className="ck own">{i.t('kind.own')}</span> {i.t('kindDesc.own')} <span className="ck free">{i.t('kind.free')}</span> {i.t('kindDesc.free')}
                {data.spendAsOf && <>{i.t('channels.spendAsOf', { d: i.fmtDay(data.spendAsOf) })}</>}
              </span>
              <ChannelHealthSummary i={i} channels={supply.channels} />
            </div>
            <div className="card">
              <ChannelTable i={i} channels={supply.channels} spendAsOf={data.spendAsOf} />
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.monthly')}</h2>
              <span className="sub">{i.t('sec.monthlySub')}<SrcTip k="chart.apps" left /></span>
            </div>
            <div className="card">
              <MonthlyBars i={i} points={supply.monthly} />
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>{i.t('sec.daily')}</h2>
              <span className="sub">
                {i.t('sec.dailySub')}
                <SrcTip k="chart.apps" left />
              </span>
            </div>
            <div className="card">
              <DailyChannelLines points={supply.daily} />
            </div>
          </section>
        </>
      )}

      {/* ══ 용어 ══════════════════════════════════════ */}
      {tab === 'glossary' && (
        <section className="section">
          <div className="section-head">
            <h2>{i.t('sec.gl')}</h2>
            <span className="sub">
              {i.t('sec.glSub1')}<span className="srci-demo">i</span>{i.t('sec.glSub2')}
            </span>
          </div>
          <div className="card">
            <dl className="glossary">
              {(
                [
                  ['gl.pool', {}],
                  ['gl.applicant', {}],
                  ['gl.application', {}],
                  ['gl.screen', {}],
                  ['gl.delivered', {}],
                  ['gl.interview', {}],
                  ['gl.offer', {}],
                  ['gl.hired', {}],
                  ['gl.working', {}],
                  ['gl.to', {}],
                  ['gl.startDate', {}],
                  ['gl.judge', {}],
                  ['gl.per30', {}],
                  ['gl.periodView', { d: ACTION_LABEL }],
                  ['gl.actionLine', { d: ACTION_LABEL }],
                  ['gl.inProgress', {}],
                  ['gl.passedWait', {}],
                  ['gl.cpa', {}],
                  ['gl.cph', {}],
                  ['gl.chJudge', {}],
                  ['gl.legacy', {}],
                  ['gl.fyiSplit', { a: ACTION_PREV_LABEL, b: ACTION_LABEL }],
                  ['gl.vnMatch', {}],
                  ['gl.viewed', {}],
                ] as [string, Record<string, string>][]
              ).map(([key, params]) => (
                <div key={key}>
                  <dt>{rich(i.t(`${key}.dt`, params))}</dt>
                  <dd>{rich(i.t(`${key}.dd`, params))}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="foot">{i.t('gl.foot')}</div>
        </section>
      )}
    </SrcLinkProvider>
  )
}
