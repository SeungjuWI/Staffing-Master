import type { FunnelStage, MonthPoint } from '@/lib/types'
import { fmtInt, fmtMonth, fmtMonthFull, fmtPct } from '@/lib/fmt'

export function StatTile({
  label, value, unit, sub, hero,
}: { label: string; value: string; unit?: string; sub?: React.ReactNode; hero?: boolean }) {
  return (
    <div className={hero ? 'tile hero' : 'tile'}>
      <div className="label">{label}</div>
      <div className="value">
        {value}
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
                  style={{ width: `${(s.count / max) * 100}%`, background: FUNNEL_COLORS[i] || FUNNEL_COLORS[5] }}
                />
                <span className="fval">{fmtInt(s.count)}</span>
                {conv != null && <span className="fconv">↳ {fmtPct(conv)}</span>}
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

export function MonthlyBars({ points }: { points: MonthPoint[] }) {
  if (!points.length) return <div className="dim">데이터 없음</div>
  const max = Math.max(...points.map(p => p.count))
  const maxIdx = points.findIndex(p => p.count === max)
  const lastIdx = points.length - 1
  return (
    <div>
      <div className="cols">
        {points.map((p, i) => (
          <div className="col" key={p.month}>
            {(i === maxIdx || i === lastIdx) && <span className="cap">{fmtInt(p.count)}</span>}
            <div className="colbar" style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }} />
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
