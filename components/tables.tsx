import type { Channel, CompanyPerf, JdHealth, JdRow } from '@/lib/types'
import { CHANNEL_KIND_LABELS, channelKind, channelLabel, fmtInt, fmtKrw, fmtUsd } from '@/lib/fmt'
import { EmptyState } from './viz'
import { SrcTip } from './src-tip'

// ── 채널 판정 어휘 — "뭐가 성과 좋고 나쁜지"의 즉답. 공고 판정(JdHealth)과 같은 점 어휘를 쓴다.
//  성과   입사를 만들었고 비용도 정상 범위 (무비용 포함)
//  고비용 입사는 있지만 채용당 비용이 전체 평균의 3배 이상
//  점검   돈을 쓰는데 입사가 아직 0명 — 집행 지속 여부 판단 필요
//  관망   지출 없는 채널에서 입사 0명 — 잃는 것은 없음
// 비용 시트에는 시간 축이 없어 기간 보기에서는 판정하지 않는다 (비용 열과 동일 원칙).
type ChannelHealth = 'good' | 'pricey' | 'burn' | 'idle'
const CH_ORDER: ChannelHealth[] = ['good', 'pricey', 'burn', 'idle']
export const CHANNEL_HEALTH_META: Record<ChannelHealth, { label: string; dot: string; desc: string }> = {
  good: { label: '성과', dot: 'good', desc: '입사를 만들어낸 채널 — 채용당 비용도 전체 평균의 3배 미만 (무비용 채널 포함)' },
  pricey: { label: '고비용', dot: 'stall', desc: '입사는 있지만 채용당 비용이 전체 평균의 3배 이상 — 단가 협상 또는 집행 축소 검토' },
  burn: { label: '점검', dot: 'low', desc: '지출은 있는데 입사가 아직 0명 — 집행을 계속할지 점검 필요' },
  idle: { label: '관망', dot: 'early', desc: '지출 없는 채널, 입사 아직 0명 — 비용 부담 없이 지원자만 유입되는 중' },
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
function channelNote(c: Channel, h: ChannelHealth, avg: number | null): string {
  if (h === 'good') return c.costPerHireKrw != null ? `입사 ${fmtInt(c.hires)}명 · 채용당 ${fmtKrw(c.costPerHireKrw)}` : `입사 ${fmtInt(c.hires)}명 · 지출 없음`
  if (h === 'pricey')
    return `채용당 ${fmtKrw(c.costPerHireKrw)} — 전체 평균 ${fmtKrw(avg)}의 ${fmtInt(Math.round((c.costPerHireKrw || 0) / (avg || 1)))}배, 집행 단가 재검토 필요`
  if (h === 'burn') return `지출 ${fmtKrw(c.spendKrw)}을 썼는데 입사 아직 0명 — 집행을 계속할지 점검 필요`
  return `비용 없이 지원자 ${fmtInt(c.people)}명 유입 — 입사는 아직 0명 (잃는 것 없음)`
}

// 유료/자사/무료 분류가 있는 채널 = 지금 운영하는 채널. 분류 없는 경로(구 시트·구글폼·채널 미상 등)는
// 본표에 남기되 맨 아래 '과거' 칩 + 흐린 이름으로 구분하고 판정에서 제외한다 (접힘 격리는 퇴짜).
const isActiveChannel = (c: Channel) => channelKind(c.key) != null

// FYI 는 제일 자주 보는 채널이라 판정순 정렬 대신 맨 위 고정 (2026-07-29 회의).
// 8월 1일 기준 두 시대 행 — 8월~(KTC 공고만 남긴 새 집계)이 위, ~7월(혼합 집계)이 그 아래.
const FYI_PIN = ['FYI-aug', 'FYI-jul', 'FYI'] // 'FYI' 는 시대 분리 전 데이터(데모 등) 호환
const fyiPin = (key: string) => { const i = FYI_PIN.indexOf(key); return i < 0 ? FYI_PIN.length : i }
const FYI_ERA_NOTE: Record<string, string> = {
  'FYI-aug': '8월 1일부터의 FYI 지원 — KTC 공고만 남긴 새 집계 (가짜 공고 정리 후 0에서 새로 시작)',
  'FYI-jul': '7월까지의 FYI 지원 — KTC 외 공고가 섞여 있던 시기의 혼합 집계 · 비용 시트에 시간 축이 없어 FYI 지출은 당분간 이 행에 누적',
}

// 섹션 헤드용 판정 요약 칩 — 기준 설명 툴팁 겸 범례 (기간 보기에서는 비용이 없어 렌더하지 않음)
export function ChannelHealthSummary({ channels }: { channels: Channel[] }) {
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
            {CHANNEL_HEALTH_META[h].label} <b>{fmtInt(n)}</b>
            <span className="tip" role="tooltip">{CHANNEL_HEALTH_META[h].desc}</span>
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
const CH_THEAD = (
  <tr>
    <th>채널<SrcTip k="ch.channel" left /></th>
    <th>지원자<SrcTip k="ch.people" /></th>
    <th>스크리닝 합격<SrcTip k="pipe.docPass" /></th>
    <th>면접<SrcTip k="pipe.interviews" /></th>
    <th>입사<SrcTip k="pipe.hires" /></th>
    <th>지출<SrcTip k="ch.spend" /></th>
    <th>지원자당 비용<SrcTip k="ch.cpa" /></th>
    <th>채용당 비용<SrcTip k="ch.cph" /></th>
  </tr>
)

export function ChannelTable({ channels }: { channels: Channel[] }) {
  if (!channels.length) return <EmptyState message="이 기간에 유입된 지원 데이터가 없습니다." />
  const sum = (list: Channel[], f: (c: Channel) => number) => list.reduce((s, c) => s + f(c), 0)
  // 합계는 전 채널 (과거·기타·무료 포함) — 인재풀 타일의 지원자 수와 일치해야 한다
  const totalSpend = channels.some(c => c.spendKrw != null) ? sum(channels, c => c.spendKrw || 0) : null
  const totalPeople = sum(channels, c => c.people)
  const totalHires = sum(channels, c => c.hires)
  const avg = avgCostPerHire(channels)
  const judged = channels.some(c => c.spendKrw != null) // 기간 보기(비용 없음)에서는 판정 점 생략

  // 0은 흐리게 — 성과가 난 칸만 또렷이 남는다
  const num = (n: number) => (n === 0 ? <span className="dim">0</span> : fmtInt(n))

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
  const foldSub = (list: Channel[]) => `지원자 ${fmtInt(sum(list, c => c.people))}명 · 입사 ${fmtInt(sum(list, c => c.hires))}명`

  const row = (c: Channel) => {
    const legacy = !isActiveChannel(c)
    const kind = channelKind(c.key)
    const h = !legacy && judged ? channelHealth(c, avg) : null
    // 성과는 툴팁 없음 (숫자 열이 이미 설명) — 문제 채널(고비용·점검·관망)만 호버로 판정 이유 노출 (공고 표와 동일)
    const note = h && h !== 'good' ? channelNote(c, h, avg) : null
    return (
      <tr key={c.key}>
        <td className={note ? 'jdcell' : undefined}>
          {h && (
            <i
              className={`jdot ${CHANNEL_HEALTH_META[h].dot}`}
              title={note ? undefined : `${CHANNEL_HEALTH_META[h].label} — ${channelNote(c, h, avg)}`}
            />
          )}
          <span className={legacy ? 'tname dim' : 'tname'} title={legacy ? '지금은 쓰지 않는 유입 경로 — 판정 제외' : FYI_ERA_NOTE[c.key]}>
            {channelLabel(c.key)}
          </span>
          {kind && <span className={`ck ${kind}`}>{CHANNEL_KIND_LABELS[kind]}</span>}
          {legacy && <span className="ck past">과거</span>}
          {note && h && (
            <span className="tip" role="tooltip">
              <b>{CHANNEL_HEALTH_META[h].label}</b> — {note}
            </span>
          )}
        </td>
        <td title={c.applications ? `지원 ${fmtInt(c.applications)}건` : undefined}>{num(c.people)}</td>
        <td>{num(c.docPass)}</td>
        <td>{num(c.interviews)}</td>
        <td title={c.hires > 0 ? `지원자 ${fmtInt(c.people)}명 중 입사 ${fmtInt(c.hires)}명` : undefined}>{num(c.hires)}</td>
        <td>{c.spendKrw != null ? fmtKrw(c.spendKrw) : <span className="dim">–</span>}</td>
        <td>{c.cpaKrw != null ? fmtKrw(c.cpaKrw) : <span className="dim">–</span>}</td>
        <td>{c.costPerHireKrw != null ? fmtKrw(c.costPerHireKrw) : <span className="dim">–</span>}</td>
      </tr>
    )
  }

  return (
    <>
      <div className="tbl-scroll">
        <table className="chfix">
          {CH_COLGROUP}
          <thead>{CH_THEAD}</thead>
          <tbody>{shown.map(row)}</tbody>
          <tfoot>
            <tr>
              <td>합계 <span className="tsub">(무료·과거 포함)</span></td>
              <td>{fmtInt(totalPeople)}</td>
              <td>{fmtInt(sum(channels, c => c.docPass))}</td>
              <td>{fmtInt(sum(channels, c => c.interviews))}</td>
              <td>{fmtInt(totalHires)}</td>
              <td>{totalSpend != null ? fmtKrw(totalSpend) : '–'}</td>
              <td>{totalSpend != null && totalPeople > 0 ? fmtKrw(totalSpend / totalPeople) : '–'}</td>
              <td>{totalSpend != null && totalHires > 0 ? fmtKrw(totalSpend / totalHires) : '–'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {free.length > 0 && (
        <details className="fold">
          <summary>무료 채널 {fmtInt(free.length)}개 보기 <span className="tsub">· {foldSub(free)}</span></summary>
          <div className="tbl-scroll">
            <table className="chfix">
              {CH_COLGROUP}
              <thead>{CH_THEAD}</thead>
              <tbody>{free.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
      {etc.length > 0 && (
        <details className="fold">
          <summary>과거 유입 경로 {fmtInt(etc.length)}개 보기 <span className="tsub">· {foldSub(etc)}</span></summary>
          <div className="tbl-scroll">
            <table className="chfix">
              {CH_COLGROUP}
              <thead>{CH_THEAD}</thead>
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
  done: { label: '충원 완료', desc: 'TO 자리를 다 채운 공고 (KTC Ops TO_Table 매칭 기준 — 이탈하면 다시 빈자리) — 모집 마감·공고 내리기 대상' },
  good: { label: '순항', desc: '면접·오퍼 진행 중 / 기업 검토 중(입사 이력이 있거나 모집 6주 미만인 공고)' },
  stall: { label: '정체', desc: '멈춘 공고 — 모집 6주가 지나도록 기업 반응(면접 전환)이 한 번도 없거나, 기업 단계에 아무도 없이 내부에만 쌓여 있음' },
  low: { label: '지원 부족', desc: 'TO 1명당 지원 30건 미만 — 입사가 성사된 공고들의 실측 하위 수준 (TO당 최소 17 ~ 중앙값 58건)' },
  early: { label: '모집 초기', desc: '모집 시작 1주 미만 — 아직 판정하지 않음 (유예)' },
}
export const HEALTH_ORDER: JdView[] = ['done', 'good', 'stall', 'low', 'early']

// 섹션 헤드용 판정 요약 — "뭐가 잘되고 뭐가 안되는지"의 즉답 한 줄
export function JdHealthSummary({ jds }: { jds: JdRow[] }) {
  return (
    <span className="hsum">
      {HEALTH_ORDER.map(h => {
        const n = jds.filter(j => jdView(j) === h).length
        return (
          <span key={h} className={n > 0 ? 'hs' : 'hs zero'}>
            <i className={`jdot ${h}`} />
            {HEALTH_META[h].label} <b>{fmtInt(n)}</b>
            <span className="tip" role="tooltip">{HEALTH_META[h].desc}</span>
          </span>
        )
      })}
    </span>
  )
}

// JdTable 은 컬럼 정렬(클라이언트 상호작용)이 필요해 components/jd-table.tsx 로 분리됨

export function CompanyTable({ companies }: { companies: CompanyPerf[] }) {
  if (!companies.length) return <EmptyState message="아직 파이프라인 경유 입사 실적이 없습니다." />
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>기업<SrcTip k="co.company" left /></th>
            <th>입사<SrcTip k="co.hires" /></th>
            <th>재직 중<SrcTip k="co.working" /></th>
            <th>총 매출<SrcTip k="co.revenue" /></th>
            <th>이익<SrcTip k="co.profit" /></th>
          </tr>
        </thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.company}>
              <td className="tname">{c.company}</td>
              <td>{fmtInt(c.hires)}</td>
              <td>
                {fmtInt(c.working)}
                {c.working < c.hires && <span className="tsub"> (이탈 {fmtInt(c.hires - c.working)})</span>}
              </td>
              <td>{c.revenueUsd > 0 ? fmtUsd(c.revenueUsd) : <span className="dim">{fmtUsd(c.revenueUsd)}</span>}</td>
              <td className={c.profitUsd < 0 ? 'neg' : undefined}>{fmtUsd(c.profitUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
