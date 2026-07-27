'use client'

// 공고 표 — 컬럼 헤더 클릭 정렬 (팀 요청 2026-07-27: "수주일 최근이 위로, 오름/내림 토글").
// 클릭 1회 = 내림차순(최근·큰 값 위) → 2회 = 오름차순 → 3회 = 기본(판정 우선) 정렬 복귀.
// 기본 정렬은 aggregate 의 판정 순(순항→정체→부족→초기)을 그대로 쓴다 — 정렬 상태가 없으면 받은 순서.
//
// 공고 선택 (대표 요청 2026-07-27: "공고 몇 개만 선택해서 볼 수 있게"): 진행 중 표에서
// 체크한 공고만 추려 보는 토글. 선택은 localStorage 에 남아 새로고침·탭 이동에도 유지된다.

import { useEffect, useMemo, useState } from 'react'
import type { JdRow } from '@/lib/types'
import { fmtDay, fmtInt } from '@/lib/fmt'
import { EmptyState, Meter } from './viz'
import { HEALTH_META } from './tables'

const SEL_KEY = 'sm-jd-sel-v1'
const SEL_ONLY_KEY = 'sm-jd-sel-only-v1'

// 판정 사유 한 줄 — 문제 공고(정체·부족·초기)의 호버 툴팁 (숫자는 현재 걸려 있는 인원, 누적 아님)
// 정체는 병목 위치를 함께 말한다: 기업 응답 없음(검토 체류만) vs 내부 처리(기업 단계 0)
function healthNote(j: JdRow): string {
  if (j.health === 'stall') {
    const weeks = j.days != null ? Math.max(1, Math.ceil(j.days / 7)) : null
    return j.curCompany > 0
      ? `기업 응답 없음 — 검토 체류 ${fmtInt(j.curCompany)}명, 수주 ${weeks != null ? `${fmtInt(weeks)}주차` : '이후'}인데 면접 전환 0`
      : `내부 처리 정체 — 합격 후 대기 ${fmtInt(j.curPassed)}명 · 발송 대기 ${fmtInt(j.curReady)}명, 기업 단계 0명`
  }
  if (j.health === 'low')
    return j.appsAll === 0
      ? '지원 0건 (기준: TO당 30건)'
      : `TO당 지원 ${fmtInt(Math.round(j.appsAll / (j.headcount || 1)))}건뿐 (기준: TO당 30건)`
  if (j.health === 'early') return `수주 ${fmtInt(j.days ?? 0)}일째 — 1주까지 판정 유예`
  return ''
}

type SortKey = 'company' | 'received' | 'to' | 'apps' | 'docPass' | 'delivered' | 'interviews' | 'hires' | 'fill'
type Sort = { key: SortKey; dir: 1 | -1 } | null

// 정렬 값 추출 — 문자열(회사명·수주일)은 그대로, 숫자는 number. null 은 항상 맨 아래로.
const sortVal = (j: JdRow, key: SortKey): string | number | null => {
  switch (key) {
    case 'company': return j.company || null
    case 'received': return j.startDate
    case 'to': return j.headcount
    case 'apps': return j.apps
    case 'docPass': return j.docPass
    case 'delivered': return j.delivered
    case 'interviews': return j.interviews
    case 'hires': return j.hires
    case 'fill': return j.headcount ? j.hires / j.headcount : null
  }
}

function SortTh({
  label, k, sort, onSort,
}: {
  label: string
  k: SortKey
  sort: Sort
  onSort: (k: SortKey) => void
}) {
  const on = sort?.key === k
  return (
    <th
      className={on ? 'sortable on' : 'sortable'}
      onClick={() => onSort(k)}
      title="클릭해 정렬 (한 번 더 = 역순, 또 한 번 = 기본 정렬)"
      aria-sort={on ? (sort!.dir === -1 ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      <span className="sarr" aria-hidden>{on ? (sort!.dir === -1 ? '▼' : '▲') : ''}</span>
    </th>
  )
}

export function JdTable({ jds, mode = 'open' }: { jds: JdRow[]; mode?: 'open' | 'closed' }) {
  const open = mode === 'open'
  const [sort, setSort] = useState<Sort>(null)
  const onSort = (key: SortKey) => {
    const firstDir: 1 | -1 = key === 'company' ? 1 : -1
    setSort(s => (s?.key !== key ? { key, dir: firstDir } : s.dir === firstDir ? { key, dir: (-firstDir as 1 | -1) } : null))
  }

  // 공고 선택 — 서버 렌더와 어긋나지 않게 저장값은 마운트 후에 복원한다
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [only, setOnly] = useState(false)
  useEffect(() => {
    if (!open) return
    try {
      const saved = JSON.parse(localStorage.getItem(SEL_KEY) || '[]')
      if (Array.isArray(saved) && saved.length) setSelected(new Set(saved.filter((x: unknown) => typeof x === 'string')))
      if (localStorage.getItem(SEL_ONLY_KEY) === '1') setOnly(true)
    } catch {}
  }, [open])
  const saveSel = (next: Set<string>, nextOnly: boolean) => {
    setSelected(next)
    setOnly(nextOnly)
    try {
      localStorage.setItem(SEL_KEY, JSON.stringify([...next]))
      localStorage.setItem(SEL_ONLY_KEY, nextOnly ? '1' : '0')
    } catch {}
  }
  const toggleSel = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    saveSel(next, next.size ? only : false)
  }

  const rows = useMemo(() => {
    if (!sort) return jds
    const { key, dir } = sort
    return [...jds].sort((a, b) => {
      const va = sortVal(a, key)
      const vb = sortVal(b, key)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // null 은 정렬 방향과 무관하게 맨 아래
      if (vb == null) return -1
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'ko') * dir
      return (va - (vb as number)) * dir
    })
  }, [jds, sort])
  const filtering = open && only && selected.size > 0
  const shown = filtering ? rows.filter(j => selected.has(j.code)) : rows

  if (!jds.length) return <EmptyState message="표시할 공고가 없습니다." />

  return (
    <>
      {open && (selected.size > 0 || only) && (
        <div className="seltools" role="toolbar" aria-label="공고 선택 보기">
          <span>
            선택 <b>{fmtInt(selected.size)}</b>건
          </span>
          <button
            type="button"
            className={only ? 'selbtn on' : 'selbtn'}
            disabled={!selected.size}
            onClick={() => saveSel(new Set(selected), !only)}
          >
            {only ? '선택한 공고만 보는 중' : '선택한 공고만 보기'}
          </button>
          <button type="button" className="selbtn" onClick={() => saveSel(new Set(), false)}>
            선택 해제
          </button>
        </div>
      )}
      {filtering && shown.length === 0 ? (
        <EmptyState message="선택한 공고가 진행 중 목록에 없습니다 — 선택을 해제하거나 다시 선택하세요." />
      ) : (
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                {open && <th className="selcell" aria-label="공고 선택" />}
                <SortTh label="공고" k="company" sort={sort} onSort={onSort} />
                <SortTh label="수주" k="received" sort={sort} onSort={onSort} />
                {!open && <th>상태</th>}
                <SortTh label="TO" k="to" sort={sort} onSort={onSort} />
                <SortTh label="지원" k="apps" sort={sort} onSort={onSort} />
                <SortTh label="합격" k="docPass" sort={sort} onSort={onSort} />
                <SortTh label="전달" k="delivered" sort={sort} onSort={onSort} />
                <SortTh label="면접" k="interviews" sort={sort} onSort={onSort} />
                <SortTh label="입사" k="hires" sort={sort} onSort={onSort} />
                <SortTh label="충원율" k="fill" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {shown.map(j => {
                const full = `${j.company} ${j.code}${j.title ? ` · ${j.title}` : ''}`
                // 순항은 툴팁 없음 (숫자 열이 이미 설명) — 문제/유예 공고만 호버로 판정 이유 노출
                const note = open && j.health && j.health !== 'good' ? healthNote(j) : null
                const weeks = j.days != null ? Math.max(1, Math.ceil(j.days / 7)) : null
                return (
                  <tr key={j.code}>
                    {open && (
                      <td className="selcell">
                        <input
                          type="checkbox"
                          checked={selected.has(j.code)}
                          onChange={() => toggleSel(j.code)}
                          aria-label={`${j.company} ${j.code} 선택`}
                        />
                      </td>
                    )}
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
                    {/* 주 숫자 = 시트(CANDIDATE DATA) 지원 건 + FYI 직접 지원(시트에 없음 — 제목 매칭 귀속).
                        FYI 몫이 있으면 툴팁에 분해해 운영이 시트와 대조할 때 헷갈리지 않게 한다 */}
                    <td
                      title={`지원 ${fmtInt(j.apps)}건${
                        j.appsFyi > 0 ? ` — 시트 ${fmtInt(j.apps - j.appsFyi)} + FYI 직접 ${fmtInt(j.appsFyi)}` : ' (시트 기준)'
                      } · 고유 지원자 ${fmtInt(j.people)}명 · 오퍼 도달 ${fmtInt(j.offer)}명`}
                    >
                      {fmtInt(j.apps)}
                    </td>
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
      )}
    </>
  )
}
