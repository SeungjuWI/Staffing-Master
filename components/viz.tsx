import type { FunnelStage, MonthPoint } from '@/lib/types'
import { fmtPct } from '@/lib/fmt'
import type { I18n } from '@/lib/i18n'
import { rich } from '@/lib/i18n-rich'
import type { SrcKey } from '@/lib/sources'
import { CountUp, type CountKind } from './count-up'
import { SrcTip } from './src-tip'

// 이 파일의 컴포넌트는 서버(page)·클라이언트(jd-table 등) 양쪽에서 쓰인다 —
// 훅(useI18n) 대신 i18n 번들을 prop 으로 받는다 (라벨·unit·sub 는 호출부가 번역해 넘긴다).

export function StatTile({
  label, value, num, kind, unit, sub, hero, src,
}: {
  label: string
  value?: string          // num 미지정 시 그대로 표시 ('–' 등)
  num?: number            // 지정 시 카운트업 모션
  kind?: CountKind
  unit?: string
  sub?: React.ReactNode
  hero?: boolean
  src?: SrcKey            // 지정 시 라벨 옆 출처 배지
}) {
  return (
    <div className={hero ? 'tile hero' : 'tile'}>
      <div className="label">
        {label}
        {src && <SrcTip k={src} left />}
      </div>
      <div className="value">
        {num != null ? <CountUp n={num} kind={kind || 'int'} /> : value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  )
}

const FUNNEL_COLORS = ['var(--f1)', 'var(--f2)', 'var(--f3)', 'var(--f4)', 'var(--f5)', 'var(--f6)']

// 퍼널 단계 → 출처 사전 키 (stage.key 는 aggregate 의 funnel 정의와 짝)
const FUNNEL_SRC: Record<string, SrcKey> = {
  people: 'tp.people',
  screened: 'pipe.docPass',
  delivered: 'pipe.delivered',
  interview: 'pipe.interviews',
  offer: 'pipe.offer',
  hired: 'pipe.hires',
}

// 라벨·note 는 데이터(30분 캐시)에 구워진 값 대신 stage key 로 렌더 시점에 번역 —
// 사전에 없는 key(옛 스냅숏의 평문 등)는 t 가 원문 그대로 돌려준다.
const stageLabel = (i: I18n, s: FunnelStage) => (i.has(`funnel.${s.key}`) ? i.t(`funnel.${s.key}`) : s.label)

export function Funnel({ i, stages, extra }: { i: I18n; stages: FunnelStage[]; extra?: string }) {
  const max = Math.max(1, ...stages.map(s => s.count))
  const first = stages[0]?.count || 0
  const last = stages[stages.length - 1]?.count || 0
  const notes = stages.filter(s => s.note)
  return (
    <div>
      <div className="funnel">
        {stages.map((s, idx) => {
          const prev = idx > 0 ? stages[idx - 1].count : null
          const conv = prev ? s.count / prev : null
          return (
            <div className="frow" key={s.key}>
              <div className="flabel">
                {stageLabel(i, s)}
                {FUNNEL_SRC[s.key] && <SrcTip k={FUNNEL_SRC[s.key]} left />}
              </div>
              <div className="fbar-area">
                <div
                  className="fbar"
                  style={{
                    // 숫자 라벨 자리를 미리 빼고 막대 폭을 계산 — 라벨이 카드 밖으로 안 나가게
                    width: `calc((100% - var(--fbar-reserve, 150px)) * ${(s.count / max).toFixed(4)})`,
                    background: FUNNEL_COLORS[idx] || FUNNEL_COLORS[5],
                    animationDelay: `${idx * 90}ms`,
                  }}
                />
                <span className="fmeta" style={{ animationDelay: `${250 + idx * 90}ms` }}>
                  <span className="fval">{i.fmtInt(s.count)}</span>
                  {conv != null && <span className="fconv">↳ {fmtPct(conv)}</span>}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="funnel-note">
        {i.t('funnel.convLine')} <b>{first > 0 ? fmtPct(last / first, 2) : '–'}</b>
        {notes.length > 0 && <> · {notes.map(n => `${stageLabel(i, n)}: ${i.t(n.note!)}`).join(' · ')}</>}
        {extra && <> · {extra}</>}
      </div>
    </div>
  )
}

// 데이터가 비었을 때 헤더만 남는 표/빈 차트 대신 이유를 말해주는 빈 상태
export function EmptyState({ message }: { message: string }) {
  return <div className="empty">{message}</div>
}

export function MonthlyBars({ i, points }: { i: I18n; points: MonthPoint[] }) {
  if (!points.length) return <EmptyState message={i.t('monthly.empty')} />
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
        {rich(i.t('monthly.summary', { n: i.fmtInt(cur.count), m: i.fmtInt(prev.count) }))}
        {delta != null && (
          <>
            {' '}({i.t('monthly.mom')}{' '}
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
        {points.map((p, idx) => (
          <div className="col" key={p.month}>
            {(idx === maxIdx || idx === lastIdx) && (
              <span className="cap" style={{ animationDelay: `${350 + idx * 45}ms` }}>
                {i.fmtInt(p.count)}
              </span>
            )}
            <div
              className="colbar"
              style={{ height: `${Math.max(2, (p.count / max) * 100)}%`, animationDelay: `${idx * 45}ms` }}
            />
            <span className="tip">{i.fmtMonthFull(p.month)} · {i.t('n.apps', { n: i.fmtInt(p.count) })}</span>
          </div>
        ))}
      </div>
      <div className="xlabels">
        {points.map(p => (
          <span key={p.month}>{i.fmtMonth(p.month)}</span>
        ))}
      </div>
    </div>
  )
}

// done = TO 를 다 채운 공고 — % 대신 "완료"로 못박고, 초과 채용일 때만 실제 %를 흐리게 병기
export function Meter({ i, ratio, done = false }: { i: I18n; ratio: number | null; done?: boolean }) {
  if (ratio == null) return <span className="dim">–</span>
  const pct = Math.min(1, Math.max(0, ratio))
  return (
    <span className="meter">
      <span className="track">
        <span className={done ? 'fill done' : 'fill'} style={{ width: `${pct * 100}%` }} />
      </span>
      {done ? (
        <span className="pct done">
          {i.t('meter.done')}{ratio > 1 && <em>{Math.round(ratio * 100)}%</em>}
        </span>
      ) : (
        <span className="pct">{Math.round(ratio * 100)}%</span>
      )}
    </span>
  )
}
