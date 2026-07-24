import type { Channel, CompanyPerf, JdHealth, JdRow } from '@/lib/types'
import { CHANNEL_KIND_LABELS, channelKind, channelLabel, fmtDay, fmtInt, fmtKrw, fmtUsd } from '@/lib/fmt'
import { EmptyState, Meter } from './viz'

export function ChannelTable({ channels }: { channels: Channel[] }) {
  if (!channels.length) return <EmptyState message="이 기간에 유입된 지원 데이터가 없습니다." />
  const sum = (f: (c: Channel) => number) => channels.reduce((s, c) => s + f(c), 0)
  const totalSpend = channels.some(c => c.spendKrw != null) ? sum(c => c.spendKrw || 0) : null
  const totalPeople = sum(c => c.people)
  const totalHires = sum(c => c.hires)
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
          {channels.map(c => {
            const kind = channelKind(c.key)
            return (
            <tr key={c.key}>
              <td>
                <span className="tname">{channelLabel(c.key)}</span>
                {kind && <span className={`ck ${kind}`}>{CHANNEL_KIND_LABELS[kind]}</span>}
              </td>
              <td title={c.applications ? `지원 ${fmtInt(c.applications)}건` : undefined}>{fmtInt(c.people)}</td>
              <td>{fmtInt(c.docPass)}</td>
              <td>{fmtInt(c.interviews)}</td>
              <td>{fmtInt(c.hires)}</td>
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
            <td>{fmtInt(sum(c => c.docPass))}</td>
            <td>{fmtInt(sum(c => c.interviews))}</td>
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
