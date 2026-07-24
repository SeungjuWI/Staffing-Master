import type { Channel, CompanyPerf, JdHealth, JdRow } from '@/lib/types'
import { CHANNEL_KIND_LABELS, channelKind, channelLabel, fmtDay, fmtInt, fmtKrw, fmtUsd } from '@/lib/fmt'
import { EmptyState, Meter } from './viz'

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

export function ChannelTable({ channels }: { channels: Channel[] }) {
  if (!channels.length) return <EmptyState message="이 기간에 유입된 지원 데이터가 없습니다." />
  const sum = (list: Channel[], f: (c: Channel) => number) => list.reduce((s, c) => s + f(c), 0)
  // 합계는 전 채널 (과거·기타 포함) — 인재풀 타일의 지원자 수와 일치해야 한다
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
      if (judged) {
        const d = CH_ORDER.indexOf(channelHealth(a, avg)) - CH_ORDER.indexOf(channelHealth(b, avg))
        if (d !== 0) return d
      }
      return b.hires - a.hires || b.people - a.people
    })
  const etc = channels.filter(c => !isActiveChannel(c)).sort((a, b) => b.people - a.people)

  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>채널</th>
            <th>지원자</th>
            <th>스크리닝 합격</th>
            <th>면접</th>
            <th>입사</th>
            <th>지출</th>
            <th>지원자당 비용</th>
            <th>채용당 비용</th>
          </tr>
        </thead>
        <tbody>
          {[...active, ...etc].map(c => {
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
                  <span className={legacy ? 'tname dim' : 'tname'} title={legacy ? '지금은 쓰지 않는 유입 경로 — 판정 제외' : undefined}>
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
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>합계</td>
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
  )
}

// ── 공고 판정 어휘 — aggregate 의 JdHealth 규칙과 짝 (용어 탭에 정의 문서화) ──
// desc 는 호버 툴팁으로 노출 — 기준을 화면에서 바로 확인할 수 있게
export const HEALTH_META: Record<JdHealth, { label: string; desc: string }> = {
  good: { label: '순항', desc: '충원을 완료했거나, 지금 기업 검토·면접·오퍼 단계에 진행 중인 인원이 있는 공고' },
  stall: { label: '정체', desc: '지원은 충분한데(TO당 30명 이상) 지금 기업 단계에 아무도 없는 공고 — 내부 처리 적체' },
  low: { label: '지원 부족', desc: 'TO 1명당 지원 30명 미만 — 입사가 성사된 공고들의 실측 하위 수준 (TO당 최소 9 ~ 중앙값 61명)' },
  early: { label: '모집 초기', desc: '수주 2주 미만 — 아직 판정하지 않음 (유예)' },
}
const HEALTH_ORDER: JdHealth[] = ['good', 'stall', 'low', 'early']

// 판정 사유 한 줄 — 문제 공고(정체·부족·초기)의 호버 툴팁에 쓴다 (숫자는 현재 걸려 있는 인원, 누적 아님)
function healthNote(j: JdRow): string {
  if (j.health === 'stall') return `지원자는 충분한데 지금 기업 단계 진행 0명 · 내부 대기 ${fmtInt(j.curInternal)}명`
  if (j.health === 'low')
    return j.peopleAll === 0
      ? '지원 0명 (기준: TO당 30명)'
      : `TO당 지원 ${fmtInt(Math.round(j.peopleAll / (j.headcount || 1)))}명뿐 (기준: TO당 30명)`
  if (j.health === 'early') return `수주 ${fmtInt(j.days ?? 0)}일째 — 2주까지 판정 유예`
  return ''
}

// 섹션 헤드용 판정 요약 — "뭐가 잘되고 뭐가 안되는지"의 즉답 한 줄
export function JdHealthSummary({ jds }: { jds: JdRow[] }) {
  return (
    <span className="hsum">
      {HEALTH_ORDER.map(h => {
        const n = jds.filter(j => j.health === h).length
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

export function JdTable({ jds, mode = 'open' }: { jds: JdRow[]; mode?: 'open' | 'closed' }) {
  if (!jds.length) return <EmptyState message="표시할 공고가 없습니다." />
  const open = mode === 'open'
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>공고</th>
            <th>수주</th>
            {!open && <th>상태</th>}
            <th>TO</th>
            <th>지원</th>
            <th>합격</th>
            <th>전달</th>
            <th>면접</th>
            <th>입사</th>
            <th>충원율</th>
          </tr>
        </thead>
        <tbody>
          {jds.map(j => {
            const full = `${j.company} ${j.code}${j.title ? ` · ${j.title}` : ''}`
            // 순항은 툴팁 없음 (숫자 열이 이미 설명) — 문제/유예 공고만 호버로 판정 이유 노출
            const note = open && j.health && j.health !== 'good' ? healthNote(j) : null
            const weeks = j.days != null ? Math.max(1, Math.ceil(j.days / 7)) : null
            return (
              <tr key={j.code}>
                <td className="jdcell">
                  <div className="cell-trunc" title={note ? undefined : `${full}${!open && j.status ? ` · ${j.status}` : ''}`}>
                    {open && j.health && (
                      <i className={`jdot ${j.health}`} title={`${HEALTH_META[j.health].label} — ${HEALTH_META[j.health].desc}`} />
                    )}
                    <span className="tname">{j.company}</span>{' '}
                    <span className="tsub">{j.code}{j.title ? ` · ${j.title}` : ''}</span>
                  </div>
                  {note && j.health && (
                    <span className="tip" role="tooltip">
                      <span className="tipline">{full}</span>
                      <b>{HEALTH_META[j.health].label}</b> — {note}
                    </span>
                  )}
                </td>
                <td title={j.startDate ? '수주일 (시트 미기재 시 최초 지원일)' : undefined}>
                  {j.startDate ? (
                    <>
                      {fmtDay(j.startDate)}
                      {open && weeks != null && <span className="tsub"> · {fmtInt(weeks)}주차</span>}
                    </>
                  ) : (
                    <span className="dim">–</span>
                  )}
                </td>
                {!open && (
                  <td>
                    <span className="tag closed" title={j.status || undefined}>마감</span>
                  </td>
                )}
                <td>{j.headcount != null ? fmtInt(j.headcount) : <span className="dim">–</span>}</td>
                <td title={`지원 ${fmtInt(j.apps)}건 · 오퍼 도달 ${fmtInt(j.offer)}명`}>{fmtInt(j.people)}</td>
                <td>{fmtInt(j.docPass)}</td>
                <td>{fmtInt(j.delivered)}</td>
                <td>{fmtInt(j.interviews)}</td>
                <td>{fmtInt(j.hires)}</td>
                <td title={j.headcount ? `입사 ${fmtInt(j.hires)} / TO ${fmtInt(j.headcount)}` : undefined}>
                  <Meter ratio={j.headcount ? j.hires / j.headcount : null} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function CompanyTable({ companies }: { companies: CompanyPerf[] }) {
  if (!companies.length) return <EmptyState message="아직 파이프라인 경유 입사 실적이 없습니다." />
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>기업</th>
            <th>입사</th>
            <th>재직 중</th>
            <th>총 매출</th>
            <th>이익</th>
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
