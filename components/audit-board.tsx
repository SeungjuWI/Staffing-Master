// 점검 탭 — 소스끼리 어긋나는 곳을 상시 자동 대조 (대표 지시 2026-07-28).
//
// 읽기 전용이다. 상태·담당자 기록은 없고, 시트를 고치면 다음 새로고침에 항목이 스스로 사라진다.
// 항목 번호(A1·B2…)는 팀과 대화할 때 쓰는 고정 식별자라 계산 결과가 바뀌어도 유지된다.

import type { AuditGroup, AuditItem } from '@/lib/types'
import { fmtInt } from '@/lib/fmt'
import { EmptyState } from './viz'

const SEV_LABEL: Record<AuditItem['severity'], string> = { high: '숫자 불일치', mid: '원장 정리', low: '운영 확인' }

function Item({ it }: { it: AuditItem }) {
  return (
    <div className={`aud ${it.severity}`}>
      <div className="aud-head">
        <span className="aud-id">{it.id}</span>
        <span className="aud-ttl">{it.title}</span>
        <span className="aud-cnt">{fmtInt(it.count)}건</span>
      </div>
      <div className="aud-path">{it.path}</div>
      {it.rows && it.rows.length > 0 && (
        <dl className="aud-rows">
          {it.rows.map(r => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {it.codes && it.codes.length > 0 && (
        <div className="aud-codes">
          {it.codes.slice(0, 40).map((c, i) => (
            <span key={`${c}-${i}`}>{c}</span>
          ))}
          {it.codes.length > 40 && <span className="more">외 {fmtInt(it.codes.length - 40)}건</span>}
        </div>
      )}
      {it.note && <p className="aud-note">{it.note}</p>}
    </div>
  )
}

export function AuditBoard({ groups }: { groups: AuditGroup[] }) {
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const bySev = (s: AuditItem['severity']) => groups.reduce((n, g) => n + g.items.filter(i => i.severity === s).length, 0)

  if (!total) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>정합성 점검</h2>
        </div>
        <div className="card">
          <EmptyState message="어긋나는 항목이 없습니다 — 모든 소스가 일치합니다." />
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="section">
        <div className="section-head wrapline">
          <h2>정합성 점검</h2>
          <span className="sub">
            시트·DB를 서로 대조해 어긋나는 곳 {fmtInt(total)}건 · 시트를 고치면 새로고침 한 번에 사라집니다
          </span>
          <span className="hsum">
            <span className={bySev('high') ? 'hs' : 'hs zero'}>
              <i className="adot high" />숫자 불일치 <b>{fmtInt(bySev('high'))}</b>
            </span>
            <span className={bySev('mid') ? 'hs' : 'hs zero'}>
              <i className="adot mid" />원장 정리 <b>{fmtInt(bySev('mid'))}</b>
            </span>
            <span className={bySev('low') ? 'hs' : 'hs zero'}>
              <i className="adot low" />운영 확인 <b>{fmtInt(bySev('low'))}</b>
            </span>
          </span>
        </div>
      </section>

      {groups.map(g => (
        <section className="section" key={g.key}>
          <div className="section-head wrapline">
            <h3>{g.title}</h3>
            <span className="sub">{g.hint}</span>
          </div>
          <div className="card audlist">
            {g.items.map(it => (
              <Item key={it.id} it={it} />
            ))}
          </div>
        </section>
      ))}

      <section className="section">
        <div className="card audfoot">
          <p>
            항목 번호(A1·B2…)는 고정입니다 — 팀과 이야기할 때 번호로 부르면 됩니다. 각 항목의 경로는
            <b> 파일 › 탭 › 열</b> 순서입니다.
          </p>
          <p className="dim">
            판정하지 않고 어느 소스가 뭐라고 하는지만 나란히 보여줍니다. 기준이 정해지면 그 소스를 정본으로 삼아
            집계를 맞춥니다.
          </p>
        </div>
      </section>
    </>
  )
}
