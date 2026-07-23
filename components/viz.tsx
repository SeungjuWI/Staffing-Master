import type { FunnelStage, MonthPoint } from '@/lib/types'
import { fmtInt, fmtMonth, fmtMonthFull, fmtPct } from '@/lib/fmt'
import { CountUp, type CountKind } from './count-up'

export function StatTile({
  label, value, num, kind, unit, sub, hero,
}: {
  label: string
  value?: string          // num 미지정 시 그대로 표시 ('–' 등)
  num?: number            // 지정 시 카운트업 모션
  kind?: CountKind
  unit?: string
  sub?: React.ReactNode
  hero?: boolean
}) {
  return (
    <div className={hero ? 'tile hero' : 'tile'}>
      <div className="label">{label}</div>
      <div className="value">
        {num != null ? <CountUp n={num} kind={kind || 'int'} /> : value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  )
}

const FUNNEL_COLORS = ['var(--f1)', 'var(--f2)', 'var(--f3)', 'var(--f4)', 'var(--f5)', 'var(--f6)']

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map(s => s.count))
  const first = stages[0]?.count || 0
  const last = stages[stages.length - 1]?.count || 0
  const notes = stages.filter(s => s.note)
  return (
    <div>
      <div className="funnel">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].count : null
          const conv = prev ? s.count / prev : null
          return (
            <div className="frow" key={s.key}>
              <div className="flabel">{s.label}</div>
              <div className="fbar-area">
                <div
                  className="fbar"
                  style={{
                    // 숫자 라벨 자리를 미리 빼고 막대 폭을 계산 — 라벨이 카드 밖으로 안 나가게
                    width: `calc((100% - var(--fbar-reserve, 150px)) * ${(s.count / max).toFixed(4)})`,
                    background: FUNNEL_COLORS[i] || FUNNEL_COLORS[5],
                    animationDelay: `${i * 90}ms`,
                  }}
                />
                <span className="fmeta" style={{ animationDelay: `${250 + i * 90}ms` }}>
                  <span className="fval">{fmtInt(s.count)}</span>
                  {conv != null && <span className="fconv">↳ {fmtPct(conv)}</span>}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="funnel-note">
        지원자 → 입사 전환율 <b>{first > 0 ? fmtPct(last / first, 2) : '–'}</b>
        {notes.length > 0 && <> · {notes.map(n => `${n.label}: ${n.note}`).join(' · ')}</>}
      </div>
    </div>
  )
}

// 데이터가 비었을 때 헤더만 남는 표/빈 차트 대신 이유를 말해주는 빈 상태
export function EmptyState({ message }: { message: string }) {
  return <div className="empty">{message}</div>
}

export function MonthlyBars({ points }: { points: MonthPoint[] }) {
  if (!points.length) return <EmptyState message="아직 집계된 지원 데이터가 없습니다." />
  const max = Math.max(...points.map(p => p.count))
  const maxIdx = points.findIndex(p => p.count === max)
  const lastIdx = points.length - 1

  // 호버 없이도 추이의 결론이 읽히도록 한 줄 요약 (이번 달은 진행 중이라 전월끼리 비교)
  let summary: React.ReactNode = null
  if (points.length >= 2) {
    const cur = points[points.length - 1]
    const prev = points[points.length - 2]
    const prev2 = points.length >= 3 ? points[points.length - 3] : null
    const delta = prev2 && prev2.count > 0 ? prev.count / prev2.count - 1 : null
    summary = (
      <>
        이번 달 <b>{fmtInt(cur.count)}건</b> 진행 중 · 지난달 {fmtInt(prev.count)}건
        {delta != null && (
          <>
            {' '}(전월 대비{' '}
            <span className={delta >= 0 ? 'up' : undefined}>
              {delta >= 0 ? '+' : ''}
              {(delta * 100).toFixed(0)}%
            </span>
            )
          </>
        )}
      </>
    )
  }

  return (
    <div>
      {summary && <div className="trend-summary">{summary}</div>}
      <div className="cols">
        {points.map((p, i) => (
          <div className="col" key={p.month}>
            {(i === maxIdx || i === lastIdx) && (
              <span className="cap" style={{ animationDelay: `${350 + i * 45}ms` }}>
                {fmtInt(p.count)}
              </span>
            )}
            <div
              className="colbar"
              style={{ height: `${Math.max(2, (p.count / max) * 100)}%`, animationDelay: `${i * 45}ms` }}
            />
            <span className="tip">{fmtMonthFull(p.month)} · {fmtInt(p.count)}건</span>
          </div>
        ))}
      </div>
      <div className="xlabels">
        {points.map(p => (
          <span key={p.month}>{fmtMonth(p.month)}</span>
        ))}
      </div>
    </div>
  )
}

export function Meter({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="dim">–</span>
  const pct = Math.min(1, Math.max(0, ratio))
  return (
    <span className="meter">
      <span className="track">
        <span className="fill" style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="pct">{Math.round(ratio * 100)}%</span>
    </span>
  )
}
