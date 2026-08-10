import type { Channel, CompanyPerf, JdHealth, JdRow } from '@/lib/types'
import { channelKind } from '@/lib/fmt'
import type { I18n } from '@/lib/i18n'
import { EmptyState } from './viz'
import { SrcTip } from './src-tip'

// 이 파일은 서버(page)에서 렌더되지만 HEALTH_META 등 상수는 클라이언트(jd-table)도 가져다 쓴다 —
// 라벨·설명은 i18n 키로 두고 각 사용처가 자기 번들(t)로 푼다.

// ── 채널 판정 어휘 — "뭐가 성과 좋고 나쁜지"의 즉답. 공고 판정(JdHealth)과 같은 점 어휘를 쓴다.
//  성과   입사를 만들었고 비용도 정상 범위 (무비용 포함)
//  고비용 입사는 있지만 채용당 비용이 전체 평균의 3배 이상
//  점검   돈을 쓰는데 입사가 아직 0명 — 집행 지속 여부 판단 필요
//  관망   지출 없는 채널에서 입사 0명 — 잃는 것은 없음
// 비용 시트에는 시간 축이 없어 기간 보기에서는 판정하지 않는다 (비용 열과 동일 원칙).
type ChannelHealth = 'good' | 'pricey' | 'burn' | 'idle'
const CH_ORDER: ChannelHealth[] = ['good', 'pricey', 'burn', 'idle']
export const CHANNEL_HEALTH_META: Record<ChannelHealth, { label: string; dot: string; desc: string }> = {
  good: { label: 'chHealth.good', dot: 'good', desc: 'chHealth.good.desc' },
  pricey: { label: 'chHealth.pricey', dot: 'stall', desc: 'chHealth.pricey.desc' },
  burn: { label: 'chHealth.burn', dot: 'low', desc: 'chHealth.burn.desc' },
  idle: { label: 'chHealth.idle', dot: 'early', desc: 'chHealth.idle.desc' },
}

// 전체 평균 채용당 비용 = 총지출 ÷ 총입사 (헤드라인과 같은 전 채널 기준)
function avgCostPerHire(channels: Channel[]): number | null {
  const spend = channels.some(c => c.spendKrw != null) ? channels.reduce((s, c) => s + (c.spendKrw || 0), 0) : null
  const hires = channels.reduce((s, c) => s + c.hires, 0)
  return spend != null && hires > 0 ? spend / hires : null
}

function channelHealth(c: Channel, avg: number | null): ChannelHealth {
  if (c.hires > 0)
    return avg != null && c.costPerHireKrw != null && c.costPerHireKrw >= avg * 3 ? 'pricey' : 'good'
  return (c.spendKrw ?? 0) > 0 ? 'burn' : 'idle'
}

// 판정 이유 한 줄 — 호버 툴팁 (해당 채널의 실제 숫자로)
function channelNote(i: I18n, c: Channel, h: ChannelHealth, avg: number | null): string {
  if (h === 'good')
    return c.costPerHireKrw != null
      ? i.t('chNote.good', { n: i.fmtInt(c.hires), v: i.fmtKrw(c.costPerHireKrw) })
      : i.t('chNote.goodNoSpend', { n: i.fmtInt(c.hires) })
  if (h === 'pricey')
    return i.t('chNote.pricey', {
      v: i.fmtKrw(c.costPerHireKrw),
      a: i.fmtKrw(avg),
      x: i.fmtInt(Math.round((c.costPerHireKrw || 0) / (avg || 1))),
    })
  if (h === 'burn') return i.t('chNote.burn', { v: i.fmtKrw(c.spendKrw) })
  return i.t('chNote.idle', { n: i.fmtInt(c.people) })
}

// 유료/자사/무료 분류가 있는 채널 = 지금 운영하는 채널. 분류 없는 경로(구 시트·구글폼·채널 미상 등)는
// 본표에 남기되 맨 아래 '과거' 칩 + 흐린 이름으로 구분하고 판정에서 제외한다 (접힘 격리는 퇴짜).
const isActiveChannel = (c: Channel) => channelKind(c.key) != null

// FYI 는 제일 자주 보는 채널이라 판정순 정렬 대신 맨 위 고정 (2026-07-29 회의).
// 액션 분리선(7/28) 기준 두 시대 행 — 액션 후(KTC 공고만 남긴 새 집계)가 위, 액션 전(혼합 집계)이 그 아래.
const FYI_PIN = ['FYI-post', 'FYI-pre', 'FYI'] // 'FYI' 는 시대 분리 전 데이터(데모 등) 호환
const fyiPin = (key: string) => { const i = FYI_PIN.indexOf(key); return i < 0 ? FYI_PIN.length : i }
const FYI_ERA_NOTE: Record<string, string> = {
  'FYI-post': 'fyiEra.post',
  'FYI-pre': 'fyiEra.pre',
}

// 섹션 헤드용 판정 요약 칩 — 기준 설명 툴팁 겸 범례 (기간 보기에서는 비용이 없어 렌더하지 않음)
export function ChannelHealthSummary({ i, channels }: { i: I18n; channels: Channel[] }) {
  const active = channels.filter(isActiveChannel)
  if (!active.some(c => c.spendKrw != null)) return null
  const avg = avgCostPerHire(channels)
  return (
    <span className="hsum">
      {CH_ORDER.map(h => {
        const n = active.filter(c => channelHealth(c, avg) === h).length
        return (
          <span key={h} className={n > 0 ? 'hs' : 'hs zero'}>
            <i className={`jdot ${CHANNEL_HEALTH_META[h].dot}`} />
            {i.t(CHANNEL_HEALTH_META[h].label)} <b>{i.fmtInt(n)}</b>
            <span className="tip" role="tooltip">{i.t(CHANNEL_HEALTH_META[h].desc)}</span>
          </span>
        )
      })}
    </span>
  )
}

const CH_COLGROUP = (
  <colgroup>
    <col style={{ width: '26%' }} />
    <col style={{ width: '10%' }} />
    <col style={{ width: '14%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '8%' }} />
    <col style={{ width: '12%' }} />
    <col style={{ width: '11%' }} />
    <col style={{ width: '11%' }} />
  </colgroup>
)
const chThead = (i: I18n) => (
  <tr>
    <th>{i.t('th.channel')}<SrcTip k="ch.channel" left /></th>
    <th>{i.t('th.people')}<SrcTip k="ch.people" /></th>
    <th>{i.t('th.docPass')}<SrcTip k="pipe.docPass" /></th>
    <th>{i.t('th.interviews')}<SrcTip k="pipe.interviews" /></th>
    <th>{i.t('th.hires')}<SrcTip k="pipe.hires" /></th>
    <th>{i.t('th.spend')}<SrcTip k="ch.spend" /></th>
    <th>{i.t('th.cpa')}<SrcTip k="ch.cpa" /></th>
    <th>{i.t('th.cph')}<SrcTip k="ch.cph" /></th>
  </tr>
)

export function ChannelTable({ i, channels, spendAsOf }: { i: I18n; channels: Channel[]; spendAsOf?: string | null }) {
  if (!channels.length) return <EmptyState message={i.t('empty.channels')} />
  const sum = (list: Channel[], f: (c: Channel) => number) => list.reduce((s, c) => s + f(c), 0)
  // 합계는 전 채널 (과거·기타·무료 포함) — 인재풀 타일의 지원자 수와 일치해야 한다
  const totalSpend = channels.some(c => c.spendKrw != null) ? sum(channels, c => c.spendKrw || 0) : null
  const totalPeople = sum(channels, c => c.people)
  const totalHires = sum(channels, c => c.hires)
  const avg = avgCostPerHire(channels)
  const judged = channels.some(c => c.spendKrw != null) // 기간 보기(비용 없음)에서는 판정 점 생략

  // 0은 흐리게 — 성과가 난 칸만 또렷이 남는다
  const num = (n: number) => (n === 0 ? <span className="dim">0</span> : i.fmtInt(n))

  const active = channels
    .filter(isActiveChannel)
    .sort((a, b) => {
      const pin = fyiPin(a.key) - fyiPin(b.key) // FYI 두 시대 행 맨 위 고정
      if (pin !== 0) return pin
      if (judged) {
        const d = CH_ORDER.indexOf(channelHealth(a, avg)) - CH_ORDER.indexOf(channelHealth(b, avg))
        if (d !== 0) return d
      }
      return b.hires - a.hires || b.people - a.people
    })
  // 유료·자사만 펼쳐 두고, 무료·과거는 접는다. FYI 상단 고정은 위 active 정렬(fyiPin)이 이미 처리.
  const shown = active.filter(c => channelKind(c.key) !== 'free')
  const free = active.filter(c => channelKind(c.key) === 'free')
  const etc = channels.filter(c => !isActiveChannel(c)).sort((a, b) => b.people - a.people)
  const foldSub = (list: Channel[]) =>
    i.t('fold.sub', { n: i.fmtInt(sum(list, c => c.people)), m: i.fmtInt(sum(list, c => c.hires)) })

  const row = (c: Channel) => {
    const legacy = !isActiveChannel(c)
    const kind = channelKind(c.key)
    const h = !legacy && judged ? channelHealth(c, avg) : null
    // 성과는 툴팁 없음 (숫자 열이 이미 설명) — 문제 채널(고비용·점검·관망)만 호버로 판정 이유 노출 (공고 표와 동일)
    const note = h && h !== 'good' ? channelNote(i, c, h, avg) : null
    return (
      <tr key={c.key}>
        <td className={note ? 'jdcell' : undefined}>
          {h && (
            <i
              className={`jdot ${CHANNEL_HEALTH_META[h].dot}`}
              title={note ? undefined : `${i.t(CHANNEL_HEALTH_META[h].label)} — ${channelNote(i, c, h, avg)}`}
            />
          )}
          <span
            className={legacy ? 'tname dim' : 'tname'}
            title={legacy ? i.t('ch.legacyTitle') : FYI_ERA_NOTE[c.key] && i.t(FYI_ERA_NOTE[c.key])}
          >
            {i.channelLabel(c.key)}
          </span>
          {kind && <span className={`ck ${kind}`}>{i.t(`kind.${kind}`)}</span>}
          {legacy && <span className="ck past">{i.t('kind.past')}</span>}
          {note && h && (
            <span className="tip" role="tooltip">
              <b>{i.t(CHANNEL_HEALTH_META[h].label)}</b> — {note}
            </span>
          )}
        </td>
        <td title={c.applications ? i.t('n.apps', { n: i.fmtInt(c.applications) }) : undefined}>{num(c.people)}</td>
        <td>{num(c.docPass)}</td>
        <td>{num(c.interviews)}</td>
        <td title={c.hires > 0 ? i.t('title.hiresOf', { n: i.fmtInt(c.people), m: i.fmtInt(c.hires) }) : undefined}>{num(c.hires)}</td>
        <td>{c.spendKrw != null ? i.fmtKrw(c.spendKrw) : <span className="dim">–</span>}</td>
        <td>{c.cpaKrw != null ? i.fmtKrw(c.cpaKrw) : <span className="dim">–</span>}</td>
        <td>{c.costPerHireKrw != null ? i.fmtKrw(c.costPerHireKrw) : <span className="dim">–</span>}</td>
      </tr>
    )
  }

  return (
    <>
      <div className="tbl-scroll">
        <table className="chfix">
          {CH_COLGROUP}
          <thead>{chThead(i)}</thead>
          <tbody>{shown.map(row)}</tbody>
          <tfoot>
            <tr>
              <td>{i.t('total.label')} <span className="tsub">{i.t('total.sub')}</span></td>
              <td>{i.fmtInt(totalPeople)}</td>
              <td>{i.fmtInt(sum(channels, c => c.docPass))}</td>
              <td>{i.fmtInt(sum(channels, c => c.interviews))}</td>
              <td>{i.fmtInt(totalHires)}</td>
              {/* 지출 0 은 "안 썼다"일 수도, "광고 원장이 아직 그 날짜까지 안 왔다"일 수도 있다 →
                  단가(CPA·채용당)는 지출이 실제로 잡힐 때만 낸다 (0원으로 단정하지 않는다) */}
              <td title={spendAsOf ? i.t('title.spendAsOf', { d: i.fmtDay(spendAsOf) }) : undefined}>
                {totalSpend != null ? i.fmtKrw(totalSpend) : '–'}
              </td>
              <td>{totalSpend ? (totalPeople > 0 ? i.fmtKrw(totalSpend / totalPeople) : '–') : '–'}</td>
              <td>{totalSpend ? (totalHires > 0 ? i.fmtKrw(totalSpend / totalHires) : '–') : '–'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {free.length > 0 && (
        <details className="fold">
          <summary>{i.t('fold.free', { n: i.fmtInt(free.length) })} <span className="tsub">· {foldSub(free)}</span></summary>
          <div className="tbl-scroll">
            <table className="chfix">
              {CH_COLGROUP}
              <thead>{chThead(i)}</thead>
              <tbody>{free.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
      {etc.length > 0 && (
        <details className="fold">
          <summary>{i.t('fold.legacy', { n: i.fmtInt(etc.length) })} <span className="tsub">· {foldSub(etc)}</span></summary>
          <div className="tbl-scroll">
            <table className="chfix">
              {CH_COLGROUP}
              <thead>{chThead(i)}</thead>
              <tbody>{etc.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  )
}

// ── 공고 판정 어휘 — aggregate 의 JdHealth 규칙과 짝 (용어 탭에 정의 문서화) ──
// desc 는 호버 툴팁으로 노출 — 기준을 화면에서 바로 확인할 수 있게
//
// 'done'(충원 완료)는 aggregate 판정이 아니라 화면 파생 상태 — 규칙상 good 에 포함되지만
// "TO 다 채워 더 볼 것 없는 공고"와 "아직 채우는 중"은 대표가 봐야 할 성격이 달라 따로 세운다.
// 집계 무변경 = 캐시 키 그대로. (2026-07-28 대표 요청 "충원율 100% 넘으면 완료라고 표시")
export type JdView = JdHealth | 'done'
export const jdView = (j: JdRow): JdView | null =>
  j.health == null ? null : j.headcount != null && j.hiresAll >= j.headcount ? 'done' : j.health

export const HEALTH_META: Record<JdView, { label: string; desc: string }> = {
  done: { label: 'health.done', desc: 'health.done.desc' },
  good: { label: 'health.good', desc: 'health.good.desc' },
  stall: { label: 'health.stall', desc: 'health.stall.desc' },
  low: { label: 'health.low', desc: 'health.low.desc' },
  early: { label: 'health.early', desc: 'health.early.desc' },
}
export const HEALTH_ORDER: JdView[] = ['done', 'good', 'stall', 'low', 'early']

// 섹션 헤드용 판정 요약 — "뭐가 잘되고 뭐가 안되는지"의 즉답 한 줄
export function JdHealthSummary({ i, jds }: { i: I18n; jds: JdRow[] }) {
  return (
    <span className="hsum">
      {HEALTH_ORDER.map(h => {
        const n = jds.filter(j => jdView(j) === h).length
        return (
          <span key={h} className={n > 0 ? 'hs' : 'hs zero'}>
            <i className={`jdot ${h}`} />
            {i.t(HEALTH_META[h].label)} <b>{i.fmtInt(n)}</b>
            <span className="tip" role="tooltip">{i.t(HEALTH_META[h].desc)}</span>
          </span>
        )
      })}
    </span>
  )
}

// JdTable 은 컬럼 정렬(클라이언트 상호작용)이 필요해 components/jd-table.tsx 로 분리됨

export function CompanyTable({ i, companies }: { i: I18n; companies: CompanyPerf[] }) {
  if (!companies.length) return <EmptyState message={i.t('empty.companies')} />
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>{i.t('th.company')}<SrcTip k="co.company" left /></th>
            <th>{i.t('th.hires')}<SrcTip k="co.hires" /></th>
            <th>{i.t('th.working')}<SrcTip k="co.working" /></th>
            <th>{i.t('th.revenue')}<SrcTip k="co.revenue" /></th>
            <th>{i.t('th.profit')}<SrcTip k="co.profit" /></th>
          </tr>
        </thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.company}>
              <td className="tname">{c.company}</td>
              <td>{i.fmtInt(c.hires)}</td>
              <td>
                {i.fmtInt(c.working)}
                {c.working < c.hires && <span className="tsub"> {i.t('td.left', { n: i.fmtInt(c.hires - c.working) })}</span>}
              </td>
              <td>{c.revenueUsd > 0 ? i.fmtUsd(c.revenueUsd) : <span className="dim">{i.fmtUsd(c.revenueUsd)}</span>}</td>
              <td className={c.profitUsd < 0 ? 'neg' : undefined}>{i.fmtUsd(c.profitUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
