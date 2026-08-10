'use client'

// 일별 채널별 지원 건 선 그래프 (대표 요청 2026-07-29: "각 날마다 어떤 플랫폼에 얼마나 지원했는지")
// 채널 색은 도넛과 같은 --ch-* 고정 매핑. 시리즈(범례·검증) 순서는 랜딩→FYI→LinkedIn→JobsGO→
// ITviec→TopDev 고정 — 이 순서로 validate_palette 라이트·다크 전 항목 통과(인접 CVD 11.8/13.0).
// blue↔violet, green↔pink 같은 색약 취약 쌍이 이웃하지 않게 잡은 순서라 임의로 바꾸지 말 것.
// 매핑 밖 소규모 채널은 '기타'(회색)로 접는다. 호버 십자선+통합 툴팁, 접힘 표가 보조 경로.
// 범례가 곧 선택 컨트롤 (대표 요청 2026-07-30: "한 플랫폼만 볼 수 있게") — 채널 하나를 고르면
// 그 채널만 남고 y축도 그 채널 기준으로 다시 잡힌다(작은 채널이 바닥에 깔려 안 보이던 문제).
// 채널 색은 항상 --ch-* 고정이라 선택으로 시리즈가 줄어도 색이 재배치되지 않는다.

import { useMemo, useRef, useState } from 'react'
import type { DayPoint } from '@/lib/types'
import type { I18n } from '@/lib/i18n'
import { rich } from '@/lib/i18n-rich'
import { EmptyState } from './viz'
import { useI18n } from './i18n-provider'

// key: 데이터 채널 키, slug: 색 클래스 — 라벨은 i.channelLabel 로 렌더 시점에 결정
const NAMED: { key: string; slug: string; brand?: string }[] = [
  { key: 'landing-page', slug: 'landing' },
  { key: 'FYI', slug: 'fyi', brand: 'FYI' }, // 차트는 짧은 브랜드명 (표의 'FYI (자체 플랫폼)' 대신)
  { key: 'LinkedIn', slug: 'linkedin' },
  { key: 'jobs-go', slug: 'jobsgo' },
  { key: 'ITviec-api', slug: 'itviec' },
  { key: 'top-dev', slug: 'topdev' },
]

type Series = { slug: string; label: string; values: number[]; total: number; note?: string }

function buildSeries(i: I18n, points: DayPoint[]): Series[] {
  const named = new Set(NAMED.map(s => s.key))
  const out: Series[] = []
  for (const s of NAMED) {
    const values = points.map(p => p.byChannel[s.key] || 0)
    const total = values.reduce((a, b) => a + b, 0)
    if (total > 0) out.push({ slug: s.slug, label: s.brand || i.channelLabel(s.key), values, total })
  }
  const etcKeys = new Set<string>()
  const etcValues = points.map(p => {
    let n = 0
    for (const [k, v] of Object.entries(p.byChannel)) if (!named.has(k)) { n += v; if (v > 0) etcKeys.add(k) }
    return n
  })
  const etcTotal = etcValues.reduce((a, b) => a + b, 0)
  if (etcTotal > 0) {
    out.push({ slug: 'etc', label: i.t('common.etc'), values: etcValues, total: etcTotal, note: [...etcKeys].map(k => i.channelLabel(k)).join(' · ') })
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
  const i = useI18n()
  const [idx, setIdx] = useState<number | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const series = useMemo(() => buildSeries(i, points), [points, i])
  const n = points.length
  if (n < 2 || !series.length) return <EmptyState message={i.t('empty.daily')} />

  // 고른 채널이 데이터에서 사라지면(기간·필터 변경) 조용히 전체로 되돌린다
  const sel = pick && series.some(s => s.slug === pick) ? pick : null
  const shown = sel ? series.filter(s => s.slug === sel) : series
  // one = 지금 선 하나만 그려지는 상태 (면 채우기·합계 열 생략 판단), picked = 사용자가 고른 것
  // — 데이터에 채널이 하나뿐일 때 "고른 것처럼" 말하지 않도록 둘을 구분한다
  const one = shown.length === 1 ? shown[0] : null
  const picked = sel ? one : null

  const maxVal = Math.max(1, ...shown.flatMap(s => s.values))
  const ticks = yTicks(maxVal)
  const yTop = ticks[ticks.length - 1]
  const x = (idx2: number) => ML + (idx2 * (W - ML - MR)) / (n - 1)
  const y = (v: number) => MT + (1 - v / yTop) * (H - MT - MB)
  // 보이는 채널만 합산 — 한 채널만 볼 때는 요약·툴팁·표가 모두 그 채널 숫자로 맞춰진다
  const totals = points.map((p, idx2) => shown.reduce((a, s) => a + s.values[idx2], 0))

  // 호버 없이도 결론이 읽히는 한 줄 (오늘은 진행 중이라 어제·7일 합 중심)
  const last7 = totals.slice(-8, -1).reduce((a, b) => a + b, 0)
  const prev7 = totals.slice(-15, -8).reduce((a, b) => a + b, 0)
  const delta = prev7 > 0 ? last7 / prev7 - 1 : null

  const move = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vx = ((clientX - r.left) / r.width) * W
    const at = Math.round(((vx - ML) / (W - ML - MR)) * (n - 1))
    setIdx(Math.min(n - 1, Math.max(0, at)))
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
    shown
      .map(s => ({ s, v: s.values[idx] }))
      .sort((a, b) => b.v - a.v || shown.indexOf(a.s) - shown.indexOf(b.s))
  const tipLeft = idx != null && idx > n * 0.6

  return (
    <div>
      <div className="trend-summary">
        {picked && <>{rich(i.t('daily.pickOnly', { ch: picked.label }))} · </>}
        {rich(i.t('daily.summary', { n: i.fmtInt(totals[n - 1]), m: i.fmtInt(totals[n - 2] || 0), k: i.fmtInt(last7) }))}
        {delta != null && (
          <> ({i.t('daily.wow')} <span className={delta >= 0 ? 'up' : undefined}>{delta >= 0 ? '+' : ''}{(delta * 100).toFixed(0)}%</span>)</>
        )}
        {picked && <span className="dim"> · {i.t('daily.yAxis')}</span>}
      </div>

      {/* 범례 = 채널 선택 (누르면 그 채널만, 다시 누르면 전체) */}
      <div className="dlc-legend" role="group" aria-label={i.t('daily.legendAria')}>
        <button type="button" className="dlc-pick" aria-pressed={sel == null} onClick={() => setPick(null)}>
          {i.t('daily.all')} <b>{i.fmtInt(series.reduce((a, s) => a + s.total, 0))}</b>
        </button>
        {series.map(s => (
          <button
            key={s.slug}
            type="button"
            className={`dlc-pick ch-${s.slug}`}
            aria-pressed={sel === s.slug}
            title={s.note ? i.t('daily.etcTitle', { list: s.note }) : undefined}
            onClick={() => setPick(v => (v === s.slug ? null : s.slug))}
          >
            <i className={`dlc-key ch-${s.slug}`} />
            {s.label} <b>{i.fmtInt(s.total)}</b>
          </button>
        ))}
      </div>

      <div className="dlc">
        <svg
          ref={svgRef}
          className="dlc-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={one ? i.t('daily.ariaOne', { ch: one.label }) : i.t('daily.aria')}
          tabIndex={0}
          onPointerMove={e => move(e.clientX)}
          onPointerLeave={() => setIdx(null)}
          onKeyDown={onKey}
        >
          {ticks.map(t => (
            <g key={t}>
              <line className="dlc-grid" x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} />
              <text className="dlc-tick" x={ML - 6} y={y(t) + 3.5}>{i.fmtInt(t)}</text>
            </g>
          ))}
          {points.map((p, idx2) =>
            idx2 % 5 === 0 || idx2 === n - 1 ? (
              <text key={p.date} className="dlc-xlab" x={x(idx2)} y={H - 6}>
                {parseInt(p.date.slice(5, 7))}/{parseInt(p.date.slice(8, 10))}
              </text>
            ) : null,
          )}
          {/* 한 채널만 볼 때는 선 아래를 옅게 채워 단일 시리즈로 읽히게 한다 */}
          {one && (
            <path
              className={`dlc-fill ch-${one.slug}`}
              d={`${one.values.map((v, idx2) => `${idx2 ? 'L' : 'M'}${x(idx2).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`}
            />
          )}
          {shown.map(s => (
            <path
              key={s.slug}
              className={`dlc-line ch-${s.slug}`}
              d={s.values.map((v, idx2) => `${idx2 ? 'L' : 'M'}${x(idx2).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}
            />
          ))}
          {idx != null && (
            <g>
              <line className="dlc-cross" x1={x(idx)} x2={x(idx)} y1={MT} y2={H - MB} />
              {shown.map(s => (
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
            <div className="dlc-tip-date">
              {i.fmtDay(points[idx].date)}
              {!one && <> · {i.t('daily.tipTotal', { n: i.fmtInt(totals[idx]) })}</>}
            </div>
            {tipRows.map(({ s, v }) => (
              <div key={s.slug} className={v === 0 ? 'dlc-tip-row dim' : 'dlc-tip-row'}>
                <i className={`dlc-key ch-${s.slug}`} />
                <b>{i.fmtInt(v)}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="fold">
        <summary>
          {i.t('daily.tableFold')} <span className="tsub">· {i.t('daily.tableFoldSub', { ch: one ? one.label : i.t('daily.byChannel') })}</span>
        </summary>
        <div className="tbl-scroll">
          <table className="dlc-table">
            <thead>
              <tr>
                <th>{i.t('th.date')}</th>
                {shown.map(s => <th key={s.slug}>{s.label}</th>)}
                {!one && <th>{i.t('th.total')}</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p, idx2) => (
                <tr key={p.date}>
                  <td>{i.fmtDay(p.date)}</td>
                  {shown.map(s => (
                    <td key={s.slug}>{s.values[idx2] === 0 ? <span className="dim">0</span> : i.fmtInt(s.values[idx2])}</td>
                  ))}
                  {!one && <td>{i.fmtInt(totals[idx2])}</td>}
                </tr>
              )).reverse()}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
