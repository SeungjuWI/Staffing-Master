'use client'

// 일별 채널별 지원 건 선 그래프 (대표 요청 2026-07-29: "각 날마다 어떤 플랫폼에 얼마나 지원했는지")
// 채널 색은 도넛과 같은 --ch-* 고정 매핑. 시리즈(범례·검증) 순서는 랜딩→FYI→LinkedIn→JobsGO→
// ITviec→TopDev 고정 — 이 순서로 validate_palette 라이트·다크 전 항목 통과(인접 CVD 11.8/13.0).
// blue↔violet, green↔pink 같은 색약 취약 쌍이 이웃하지 않게 잡은 순서라 임의로 바꾸지 말 것.
// 매핑 밖 소규모 채널은 '기타'(회색)로 접는다. 호버 십자선+통합 툴팁, 접힘 표가 보조 경로.

import { useMemo, useRef, useState } from 'react'
import type { DayPoint } from '@/lib/types'
import { channelLabel, fmtDay, fmtInt } from '@/lib/fmt'
import { EmptyState } from './viz'

const NAMED: { key: string; slug: string; label: string }[] = [
  { key: 'landing-page', slug: 'landing', label: '랜딩페이지' },
  { key: 'FYI', slug: 'fyi', label: 'FYI' },
  { key: 'LinkedIn', slug: 'linkedin', label: 'LinkedIn' },
  { key: 'jobs-go', slug: 'jobsgo', label: 'JobsGO' },
  { key: 'ITviec-api', slug: 'itviec', label: 'ITviec' },
  { key: 'top-dev', slug: 'topdev', label: 'TopDev' },
]

type Series = { slug: string; label: string; values: number[]; total: number; note?: string }

function buildSeries(points: DayPoint[]): Series[] {
  const named = new Set(NAMED.map(s => s.key))
  const out: Series[] = []
  for (const s of NAMED) {
    const values = points.map(p => p.byChannel[s.key] || 0)
    const total = values.reduce((a, b) => a + b, 0)
    if (total > 0) out.push({ slug: s.slug, label: s.label, values, total })
  }
  const etcKeys = new Set<string>()
  const etcValues = points.map(p => {
    let n = 0
    for (const [k, v] of Object.entries(p.byChannel)) if (!named.has(k)) { n += v; if (v > 0) etcKeys.add(k) }
    return n
  })
  const etcTotal = etcValues.reduce((a, b) => a + b, 0)
  if (etcTotal > 0) {
    out.push({ slug: 'etc', label: '기타', values: etcValues, total: etcTotal, note: [...etcKeys].map(channelLabel).join(' · ') })
  }
  return out
}

// y축 눈금 — 깔끔한 수 (1/2/5×10^k)로 3~4개
function yTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => max / s <= 4) || 2000
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

const W = 860, H = 248, ML = 34, MR = 12, MT = 8, MB = 20

export function DailyChannelLines({ points }: { points: DayPoint[] }) {
  const [idx, setIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const series = useMemo(() => buildSeries(points), [points])
  const n = points.length
  if (n < 2 || !series.length) return <EmptyState message="최근 30일 지원 데이터가 없습니다." />

  const maxVal = Math.max(1, ...series.flatMap(s => s.values))
  const ticks = yTicks(maxVal)
  const yTop = ticks[ticks.length - 1]
  const x = (i: number) => ML + (i * (W - ML - MR)) / (n - 1)
  const y = (v: number) => MT + (1 - v / yTop) * (H - MT - MB)
  const totals = points.map(p => Object.values(p.byChannel).reduce((a, b) => a + b, 0))

  // 호버 없이도 결론이 읽히는 한 줄 (오늘은 진행 중이라 어제·7일 합 중심)
  const last7 = totals.slice(-8, -1).reduce((a, b) => a + b, 0)
  const prev7 = totals.slice(-15, -8).reduce((a, b) => a + b, 0)
  const delta = prev7 > 0 ? last7 / prev7 - 1 : null

  const move = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vx = ((clientX - r.left) / r.width) * W
    const i = Math.round(((vx - ML) / (W - ML - MR)) * (n - 1))
    setIdx(Math.min(n - 1, Math.max(0, i)))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const d = e.key === 'ArrowLeft' ? -1 : 1
      setIdx(v => Math.min(n - 1, Math.max(0, (v ?? n - 1) + d)))
    } else if (e.key === 'Escape') setIdx(null)
  }

  // 툴팁 행: 그날 값 내림차순 (0은 흐리게 뒤로), 값이 먼저·이름이 보조
  const tipRows = idx == null ? [] :
    series
      .map(s => ({ s, v: s.values[idx] }))
      .sort((a, b) => b.v - a.v || series.indexOf(a.s) - series.indexOf(b.s))
  const tipLeft = idx != null && idx > n * 0.6

  return (
    <div>
      <div className="trend-summary">
        오늘 <b>{fmtInt(totals[n - 1])}건</b> 진행 중 · 어제 {fmtInt(totals[n - 2] || 0)}건 · 최근 7일 {fmtInt(last7)}건
        {delta != null && (
          <> (직전 7일 대비 <span className={delta >= 0 ? 'up' : undefined}>{delta >= 0 ? '+' : ''}{(delta * 100).toFixed(0)}%</span>)</>
        )}
      </div>

      <div className="dlc">
        <svg
          ref={svgRef}
          className="dlc-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="일별 채널별 지원 건 선 그래프 — 값은 아래 표 보기에서도 확인 가능"
          tabIndex={0}
          onPointerMove={e => move(e.clientX)}
          onPointerLeave={() => setIdx(null)}
          onKeyDown={onKey}
        >
          {ticks.map(t => (
            <g key={t}>
              <line className="dlc-grid" x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} />
              <text className="dlc-tick" x={ML - 6} y={y(t) + 3.5}>{fmtInt(t)}</text>
            </g>
          ))}
          {points.map((p, i) =>
            i % 5 === 0 || i === n - 1 ? (
              <text key={p.date} className="dlc-xlab" x={x(i)} y={H - 6}>
                {parseInt(p.date.slice(5, 7))}/{parseInt(p.date.slice(8, 10))}
              </text>
            ) : null,
          )}
          {series.map(s => (
            <path
              key={s.slug}
              className={`dlc-line ch-${s.slug}`}
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}
            />
          ))}
          {idx != null && (
            <g>
              <line className="dlc-cross" x1={x(idx)} x2={x(idx)} y1={MT} y2={H - MB} />
              {series.map(s => (
                <circle key={s.slug} className={`dlc-dot ch-${s.slug}`} cx={x(idx)} cy={y(s.values[idx])} r={4} />
              ))}
            </g>
          )}
        </svg>

        {idx != null && (
          <div
            className="dlc-tip"
            style={tipLeft ? { right: `${100 - (x(idx) / W) * 100}%`, marginRight: 10 } : { left: `${(x(idx) / W) * 100}%`, marginLeft: 10 }}
          >
            <div className="dlc-tip-date">{fmtDay(points[idx].date)} · 합계 {fmtInt(totals[idx])}건</div>
            {tipRows.map(({ s, v }) => (
              <div key={s.slug} className={v === 0 ? 'dlc-tip-row dim' : 'dlc-tip-row'}>
                <i className={`dlc-key ch-${s.slug}`} />
                <b>{fmtInt(v)}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dlc-legend">
        {series.map(s => (
          <span key={s.slug} title={s.note ? `기타 = ${s.note}` : undefined}>
            <i className={`dlc-key ch-${s.slug}`} />
            {s.label} <b>{fmtInt(s.total)}</b>
          </span>
        ))}
      </div>

      <details className="fold">
        <summary>표로 보기 <span className="tsub">· 일별 채널별 지원 건 (최근 30일)</span></summary>
        <div className="tbl-scroll">
          <table className="dlc-table">
            <thead>
              <tr>
                <th>날짜</th>
                {series.map(s => <th key={s.slug}>{s.label}</th>)}
                <th>합계</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.date}>
                  <td>{fmtDay(p.date)}</td>
                  {series.map(s => (
                    <td key={s.slug}>{s.values[i] === 0 ? <span className="dim">0</span> : fmtInt(s.values[i])}</td>
                  ))}
                  <td>{fmtInt(totals[i])}</td>
                </tr>
              )).reverse()}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
