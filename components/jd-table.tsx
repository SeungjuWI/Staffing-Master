'use client'

// 공고 표 — 컬럼 헤더 클릭 정렬 (팀 요청 2026-07-27: "모집 시작일 최근이 위로, 오름/내림 토글").
// 클릭 1회 = 내림차순(최근·큰 값 위) → 2회 = 오름차순 → 3회 = 기본 정렬 복귀.
// 기본 정렬 = 모집 시작일 최근순 (대표 요청 2026-07-28) — 같은 날 시작한 공고끼리는
// 판정 순(완료→순항→정체→부족→초기)으로 갈라 봐야 할 것이 위로 오게 한다.
//
// 공고 선택 (대표 요청 2026-07-27: "공고 몇 개만 선택해서 볼 수 있게"): 진행 중 표에서
// 체크한 공고만 추려 보는 토글. 선택은 localStorage 에 남아 새로고침·탭 이동에도 유지된다.

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { JdRow } from '@/lib/types'
import { channelLabel, fmtDay, fmtInt } from '@/lib/fmt'
import { EmptyState, Meter } from './viz'
import { HEALTH_META, HEALTH_ORDER, jdView } from './tables'

const SEL_KEY = 'sm-jd-sel-v1'
const SEL_ONLY_KEY = 'sm-jd-sel-only-v1'

// ── 행 클릭 상세: 채널별 지원 도넛 + 부수 정보 (대표 요청 2026-07-28) ──────────
// 채널 색은 "같은 채널 = 항상 같은 색" 고정 매핑 (validate_palette 라이트/다크 통과,
// 세그먼트 2px 갭 + 범례 + 툴팁이 색약 보조 인코딩). 매핑 밖 소규모 채널은 '기타'로 접는다.
// ITviec 은 api·수동 두 탭이 같은 사이트라 하나로 합쳐 보여준다.
const CH_SITE: Record<string, string> = { 'ITviec-api': 'ITviec', 'it-viec-manual': 'ITviec' }
const CH_SLUG: Record<string, string> = {
  'landing-page': 'landing', ITviec: 'itviec', 'top-dev': 'topdev',
  LinkedIn: 'linkedin', FYI: 'fyi', 'jobs-go': 'jobsgo',
}

type DonutPart = { label: string; apps: number; slug: string; note?: string }

function siteBreakdown(channels: JdRow['channels']): DonutPart[] {
  const bySite: Record<string, number> = {}
  for (const c of channels) {
    const site = CH_SITE[c.key] || c.key
    bySite[site] = (bySite[site] || 0) + c.apps
  }
  const named: DonutPart[] = []
  let etc = 0
  const etcParts: string[] = []
  for (const [site, apps] of Object.entries(bySite).sort((a, b) => b[1] - a[1])) {
    const slug = CH_SLUG[site]
    if (slug) named.push({ label: site === 'ITviec' ? 'ITviec' : channelLabel(site), apps, slug })
    else {
      etc += apps
      etcParts.push(`${channelLabel(site)} ${fmtInt(apps)}건`)
    }
  }
  if (etc > 0) named.push({ label: '기타', apps: etc, slug: 'etc', note: etcParts.join(' · ') })
  return named
}

function Donut({ parts, total }: { parts: DonutPart[]; total: number }) {
  const R = 44
  const C = 2 * Math.PI * R
  const gap = parts.length > 1 ? 2 : 0
  let acc = 0
  return (
    <svg className="dnt" viewBox="0 0 120 120" role="img" aria-label="채널별 지원 분포 도넛">
      <circle className="dnt-track" cx="60" cy="60" r={R} strokeWidth="15" fill="none" />
      {parts.map(p => {
        const frac = total > 0 ? p.apps / total : 0
        const len = Math.max(0.5, frac * C - gap)
        const off = -acc * C
        acc += frac
        return (
          <circle
            key={p.slug + p.label}
            className={`dnt-seg ch-${p.slug}`}
            cx="60" cy="60" r={R} strokeWidth="15" fill="none"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={off}
            transform="rotate(-90 60 60)"
          >
            <title>{`${p.label} ${fmtInt(p.apps)}건 (${Math.round(frac * 100)}%)${p.note ? ` — ${p.note}` : ''}`}</title>
          </circle>
        )
      })}
      <text className="dnt-num" x="60" y="58" textAnchor="middle">{fmtInt(total)}</text>
      <text className="dnt-cap" x="60" y="74" textAnchor="middle">지원 건</text>
    </svg>
  )
}

// 충원 완료 사유 — TO 대비 몇 자리 채웠는지 (초과·이탈도 함께)
function doneReason(j: JdRow): string {
  const to = j.headcount ?? 0
  const over = j.hiresAll - to
  return `TO ${fmtInt(to)}자리 중 ${fmtInt(j.hiresAll)}자리 채움${over > 0 ? ` (초과 ${fmtInt(over)})` : ''}${
    j.dropped > 0 ? ` · 이탈 ${fmtInt(j.dropped)}` : ''
  }`
}

// 충원이 끝났는데도 이 표(진행 중)에 남아 있는 이유 — 두 원장이 다른 말을 하고 있다는 신호.
// 진행/마감은 JD EXECUTION 의 Job Status 로만 가르고, 충원은 TO_Table 매칭으로 센다.
function doneWhyHere(j: JdRow): string {
  return `공고 상태가 아직 '${j.status || '진행 중'}' 이라 진행 중 목록에 남아 있습니다 — 마감 처리 대상`
}

// 순항 사유 한 줄 (문제 공고 사유는 healthNote 재사용)
function goodReason(j: JdRow): string {
  if (j.curInterview + j.curOffer > 0) return '면접·오퍼 진행 중'
  if (j.hiresAll > 0) return '기업 검토 중 — 이미 채운 자리 있음'
  if (j.responded) return '기업 검토 중 — 기업 면접·매칭 이력 있음'
  return '기업 검토 중 — 첫 반응 대기 (모집 6주 미만)'
}

function JdDetail({ j, open, colSpan }: { j: JdRow; open: boolean; colSpan: number }) {
  const view = jdView(j)
  const parts = siteBreakdown(j.channels)
  const total = parts.reduce((s, p) => s + p.apps, 0)
  const lastDays =
    j.lastAppDate != null
      ? Math.max(0, Math.floor((Date.now() - new Date(`${j.lastAppDate}T00:00:00+07:00`).getTime()) / 86400000))
      : null
  const stages = [
    ['스크리닝 대기', j.curNew], ['합격 후 대기', j.curPassed], ['발송 대기', j.curReady],
    ['기업 검토', j.curCompany], ['면접', j.curInterview], ['오퍼', j.curOffer],
  ].filter(([, n]) => (n as number) > 0)
  return (
    <tr className="jdx">
      <td colSpan={colSpan}>
        <div className="jdx-wrap">
          {total > 0 ? <Donut parts={parts} total={total} /> : <div className="jdx-empty">지원 없음</div>}
          {total > 0 && (
            <div className="jdx-legend">
              {parts.map(p => (
                <span className={`lg ch-${p.slug}`} key={p.slug + p.label} title={p.note}>
                  <i />
                  {p.label}
                  <b>{fmtInt(p.apps)}</b>
                  <span className="pct">{Math.round((p.apps / total) * 100)}%</span>
                </span>
              ))}
            </div>
          )}
          <dl className="jdx-facts">
            <dt>모집 시작일</dt>
            <dd>{j.startDate ? <>{fmtDay(j.startDate)}{j.days != null && <> · <b>D+{fmtInt(j.days)}</b></>}</> : '– (원장 미기입)'}</dd>
            <dt>최근 지원</dt>
            <dd>{lastDays == null ? '–' : lastDays === 0 ? <b>오늘</b> : <><b>{fmtInt(lastDays)}일 전</b> ({fmtDay(j.lastAppDate!)})</>}</dd>
            <dt>지금 단계</dt>
            <dd>{stages.length ? stages.map(([l, n]) => `${l} ${fmtInt(n as number)}`).join(' · ') : '진행 중 인원 없음'}</dd>
            <dt>누적 진행</dt>
            <dd>합격 <b>{fmtInt(j.docPass)}</b> · 전달 <b>{fmtInt(j.delivered)}</b> · 면접 <b>{fmtInt(j.interviews)}</b> · 입사 <b>{fmtInt(j.hiresAll)}</b></dd>
            <dt>충원</dt>
            <dd>
              {j.headcount != null ? (
                <>
                  TO {fmtInt(j.headcount)}자리 중 <b>{fmtInt(j.hiresAll)}자리</b> 채움
                  {j.dropped > 0 && <span className="dim"> · 이탈 {fmtInt(j.dropped)}자리</span>}
                </>
              ) : (
                'TO 미기재'
              )}
            </dd>
            <dt>판정</dt>
            <dd>
              {open && view ? (
                <>
                  <i className={`jdot ${view}`} /> <b>{HEALTH_META[view].label}</b> —{' '}
                  {view === 'done' ? doneReason(j) : view === 'good' ? goodReason(j) : healthNote(j)}
                  {view === 'done' && <div className="dim" style={{ marginTop: 3 }}>{doneWhyHere(j)}</div>}
                </>
              ) : (
                <>마감{j.status ? ` (${j.status})` : ''}</>
              )}
            </dd>
          </dl>
        </div>
      </td>
    </tr>
  )
}

// 판정 사유 한 줄 — 문제 공고(정체·부족·초기)의 호버 툴팁 (숫자는 현재 걸려 있는 인원, 누적 아님)
// 정체는 병목 위치를 함께 말한다: 기업 응답 없음(검토 체류만) vs 내부 처리(기업 단계 0)
function healthNote(j: JdRow): string {
  if (j.health === 'stall') {
    return j.curCompany > 0
      ? `기업 응답 없음 — 검토 체류 ${fmtInt(j.curCompany)}명, 모집 ${j.days != null ? `D+${fmtInt(j.days)}` : '6주 이후'}인데 면접 전환 0`
      : `내부 처리 정체 — 합격 후 대기 ${fmtInt(j.curPassed)}명 · 발송 대기 ${fmtInt(j.curReady)}명, 기업 단계 0명`
  }
  if (j.health === 'low')
    return j.appsAll === 0
      ? '지원 0건 (기준: TO당 30건)'
      : `TO당 지원 ${fmtInt(Math.round(j.appsAll / (j.headcount || 1)))}건뿐 (기준: TO당 30건)`
  if (j.health === 'early') return `모집 D+${fmtInt(j.days ?? 0)} — 1주(D+7)까지 판정 유예`
  return ''
}

type SortKey = 'company' | 'received' | 'to' | 'apps' | 'docPass' | 'delivered' | 'interviews' | 'hires' | 'fill'
type Sort = { key: SortKey; dir: 1 | -1 }

// 기본 정렬 — 모집 시작 최근순. 다른 열을 세 번 클릭하면 여기로 돌아온다.
const DEFAULT_SORT: Sort = { key: 'received', dir: -1 }

// 정렬 값 추출 — 문자열(회사명·모집 시작일)은 그대로, 숫자는 number. null 은 항상 맨 아래로.
const sortVal = (j: JdRow, key: SortKey): string | number | null => {
  switch (key) {
    case 'company': return j.company || null
    case 'received': return j.startDate
    case 'to': return j.headcount
    case 'apps': return j.apps
    case 'docPass': return j.docPass
    case 'delivered': return j.delivered
    case 'interviews': return j.interviews
    case 'hires': return j.hiresAll
    case 'fill': return j.headcount ? j.hiresAll / j.headcount : null
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
  const on = sort.key === k
  return (
    <th
      className={on ? 'sortable on' : 'sortable'}
      onClick={() => onSort(k)}
      title="클릭해 정렬 (한 번 더 = 역순, 또 한 번 = 기본 정렬 — 모집 시작 최근순)"
      aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      <span className="sarr" aria-hidden>{on ? (sort.dir === -1 ? '▼' : '▲') : ''}</span>
    </th>
  )
}

export function JdTable({ jds, mode = 'open' }: { jds: JdRow[]; mode?: 'open' | 'closed' }) {
  const open = mode === 'open'
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  // 행 클릭 상세 (아코디언 — 한 번에 하나만)
  const [xCode, setXCode] = useState<string | null>(null)
  const onSort = (key: SortKey) => {
    const firstDir: 1 | -1 = key === 'company' ? 1 : -1
    setSort(s =>
      s.key !== key ? { key, dir: firstDir } : s.dir === firstDir ? { key, dir: (-firstDir as 1 | -1) } : DEFAULT_SORT
    )
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
    const { key, dir } = sort
    // 동점 타이브레이크 = 판정 순(완료→순항→정체→부족→초기). 마감 표는 판정이 없어 받은 순서 유지.
    const rank = (j: JdRow) => HEALTH_ORDER.indexOf(jdView(j) ?? 'early')
    const tie = (a: JdRow, b: JdRow) => (open ? rank(a) - rank(b) : 0)
    return [...jds].sort((a, b) => {
      const va = sortVal(a, key)
      const vb = sortVal(b, key)
      if (va == null && vb == null) return tie(a, b)
      if (va == null) return 1 // null 은 정렬 방향과 무관하게 맨 아래
      if (vb == null) return -1
      const d =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb), 'ko') * dir
          : (va - (vb as number)) * dir
      return d !== 0 ? d : tie(a, b)
    })
  }, [jds, sort, open])
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
                <SortTh label="모집 시작" k="received" sort={sort} onSort={onSort} />
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
                const view = jdView(j)
                // 완료·순항은 툴팁 없음 (숫자 열이 이미 설명) — 문제/유예 공고만 호버로 판정 이유 노출
                // 순항만 툴팁 없음 (숫자 열이 이미 설명). 완료는 "다 채웠는데 왜 여기 있나"를 설명해야 한다.
                const note = !open || !view || view === 'good' ? null : view === 'done' ? doneWhyHere(j) : healthNote(j)
                const expanded = xCode === j.code
                return (
                  <Fragment key={j.code}>
                  <tr
                    className={expanded ? 'jdxrow jdxon' : 'jdxrow'}
                    onClick={() => setXCode(c => (c === j.code ? null : j.code))}
                    aria-expanded={expanded}
                  >
                    {open && (
                      <td className="selcell" onClick={e => e.stopPropagation()}>
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
                        <span className="xchev" aria-hidden>▸</span>
                        {open && view && (
                          <i className={`jdot ${view}`} title={`${HEALTH_META[view].label} — ${HEALTH_META[view].desc}`} />
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
                    <td title={j.startDate ? '모집 시작일 (시트 Date Received, 미기재 시 최초 지원일)' : undefined}>
                      {j.startDate ? (
                        <>
                          {fmtDay(j.startDate)}
                          {open && j.days != null && <span className="tsub"> · D+{fmtInt(j.days)}</span>}
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
                    <td title={'채운 자리 — KTC Ops TO_Table 매칭 기준 (이탈은 제외)'}>{fmtInt(j.hiresAll)}</td>
                    <td
                      title={
                        j.headcount
                          ? `충원 ${fmtInt(j.hiresAll)} / TO ${fmtInt(j.headcount)} · ${Math.round(
                              (j.hiresAll / j.headcount) * 100
                            )}%${j.dropped > 0 ? ` (이탈 ${fmtInt(j.dropped)})` : ''} — KTC Ops TO_Table 기준`
                          : undefined
                      }
                    >
                      {/* 완료 표시는 판정(진행 중 전용)과 별개 — 마감 표에서도 TO를 채웠는지는 같은 의미다 */}
                      <Meter
                        ratio={j.headcount ? j.hiresAll / j.headcount : null}
                        done={j.headcount != null && j.hiresAll >= j.headcount}
                      />
                    </td>
                  </tr>
                  {expanded && <JdDetail j={j} open={open} colSpan={10} />}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
