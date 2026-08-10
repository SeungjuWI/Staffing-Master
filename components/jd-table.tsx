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
import type { I18n } from '@/lib/i18n'
import { rich } from '@/lib/i18n-rich'
import { EmptyState, Meter } from './viz'
import { SrcTip } from './src-tip'
import { useI18n } from './i18n-provider'
import type { SrcKey } from '@/lib/sources'
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

function siteBreakdown(i: I18n, channels: JdRow['channels']): DonutPart[] {
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
    if (slug) named.push({ label: site === 'ITviec' ? 'ITviec' : i.channelLabel(site), apps, slug })
    else {
      etc += apps
      etcParts.push(`${i.channelLabel(site)} ${i.t('n.apps', { n: i.fmtInt(apps) })}`)
    }
  }
  if (etc > 0) named.push({ label: i.t('common.etc'), apps: etc, slug: 'etc', note: etcParts.join(' · ') })
  return named
}

function Donut({ i, parts, total }: { i: I18n; parts: DonutPart[]; total: number }) {
  const R = 44
  const C = 2 * Math.PI * R
  const gap = parts.length > 1 ? 2 : 0
  let acc = 0
  return (
    <svg className="dnt" viewBox="0 0 120 120" role="img" aria-label={i.t('donut.aria')}>
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
            <title>{`${p.label} ${i.t('n.apps', { n: i.fmtInt(p.apps) })} (${Math.round(frac * 100)}%)${p.note ? ` — ${p.note}` : ''}`}</title>
          </circle>
        )
      })}
      <text className="dnt-num" x="60" y="58" textAnchor="middle">{i.fmtInt(total)}</text>
      <text className="dnt-cap" x="60" y="74" textAnchor="middle">{i.t('donut.cap')}</text>
    </svg>
  )
}

// 충원 완료 사유 — TO 대비 몇 명 채웠는지 (초과 채용이면 초과분도 말해준다)
function doneReason(i: I18n, j: JdRow): string {
  const to = j.headcount ?? 0
  const over = j.hiresAll - to
  return `${i.t('jd.done.base', { to: i.fmtInt(to), n: i.fmtInt(j.hiresAll) })}${
    over > 0 ? i.t('jd.done.over', { n: i.fmtInt(over) }) : ''
  }${j.dropped > 0 ? i.t('jd.done.drop', { n: i.fmtInt(j.dropped) }) : ''}`
}

// 순항 사유 한 줄 (문제 공고 사유는 healthNote 재사용)
function goodReason(i: I18n, j: JdRow): string {
  if (j.curInterview + j.curOffer > 0) return i.t('jd.good.interview')
  if (j.hiresAll > 0) return i.t('jd.good.hasHire')
  if (j.responded) return i.t('jd.good.responded')
  return i.t('jd.good.waiting')
}

function JdDetail({ i, j, open, colSpan }: { i: I18n; j: JdRow; open: boolean; colSpan: number }) {
  const view = jdView(j)
  const parts = siteBreakdown(i, j.channels)
  const total = parts.reduce((s, p) => s + p.apps, 0)
  const lastDays =
    j.lastAppDate != null
      ? Math.max(0, Math.floor((Date.now() - new Date(`${j.lastAppDate}T00:00:00+07:00`).getTime()) / 86400000))
      : null
  const stages = [
    [i.t('stage.new'), j.curNew], [i.t('stage.passed'), j.curPassed], [i.t('stage.ready'), j.curReady],
    [i.t('st.company'), j.curCompany], [i.t('st.interview'), j.curInterview], [i.t('st.offer'), j.curOffer],
  ].filter(([, n]) => (n as number) > 0)
  return (
    <tr className="jdx">
      <td colSpan={colSpan}>
        <div className="jdx-wrap">
          {total > 0 ? <Donut i={i} parts={parts} total={total} /> : <div className="jdx-empty">{i.t('jdx.empty')}</div>}
          {total > 0 && (
            <div className="jdx-legend">
              {parts.map(p => (
                <span className={`lg ch-${p.slug}`} key={p.slug + p.label} title={p.note}>
                  <i />
                  {p.label}
                  <b>{i.fmtInt(p.apps)}</b>
                  <span className="pct">{Math.round((p.apps / total) * 100)}%</span>
                </span>
              ))}
            </div>
          )}
          <dl className="jdx-facts">
            <dt>{i.t('jdx.start')}</dt>
            <dd>{j.startDate ? <>{i.fmtDay(j.startDate)}{j.days != null && <> · <b>D+{i.fmtInt(j.days)}</b></>}</> : i.t('jdx.noStart')}</dd>
            <dt>{i.t('jdx.lastApp')}</dt>
            <dd>{lastDays == null ? '–' : lastDays === 0 ? <b>{i.t('jdx.today')}</b> : <><b>{i.t('jdx.daysAgo', { n: i.fmtInt(lastDays) })}</b> ({i.fmtDay(j.lastAppDate!)})</>}</dd>
            <dt>{i.t('jdx.stages')}</dt>
            <dd>{stages.length ? stages.map(([l, n]) => `${l} ${i.fmtInt(n as number)}`).join(' · ') : i.t('jdx.noStages')}</dd>
            <dt>{i.t('jdx.cum')}</dt>
            <dd>{rich(i.t('jdx.cumVal', { a: i.fmtInt(j.docPass), b: i.fmtInt(j.delivered), c: i.fmtInt(j.interviews), d: i.fmtInt(j.hiresAll) }))}</dd>
            <dt>{i.t('jdx.fill')}</dt>
            <dd>
              {j.headcount != null ? (
                <>
                  {rich(i.t('jdx.fillVal', { to: i.fmtInt(j.headcount), n: i.fmtInt(j.hiresAll) }))}
                  {j.dropped > 0 && <span className="dim">{i.t('jdx.fillDrop', { n: i.fmtInt(j.dropped) })}</span>}
                </>
              ) : (
                i.t('jdx.noTo')
              )}
            </dd>
            <dt>{i.t('jdx.health')}</dt>
            <dd>
              {open && view ? (
                <>
                  <i className={`jdot ${view}`} /> <b>{i.t(HEALTH_META[view].label)}</b> —{' '}
                  {view === 'done' ? doneReason(i, j) : view === 'good' ? goodReason(i, j) : healthNote(i, j)}
                </>
              ) : (
                <>{i.t('jdx.closed')}{j.status ? ` (${j.status})` : ''}</>
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
function healthNote(i: I18n, j: JdRow): string {
  if (j.health === 'stall') {
    return j.curCompany > 0
      ? i.t('jd.note.stallCompany', { n: i.fmtInt(j.curCompany), d: j.days != null ? `D+${i.fmtInt(j.days)}` : i.t('jd.note.after6w') })
      : i.t('jd.note.stallInternal', { a: i.fmtInt(j.curPassed), b: i.fmtInt(j.curReady) })
  }
  if (j.health === 'low')
    return j.appsAll === 0
      ? i.t('jd.note.lowZero')
      : i.t('jd.note.low', { n: i.fmtInt(Math.round(j.appsAll / (j.headcount || 1))) })
  if (j.health === 'early') return i.t('jd.note.early', { n: i.fmtInt(j.days ?? 0) })
  return ''
}

type SortKey = 'company' | 'received' | 'to' | 'apps' | 'docPass' | 'delivered' | 'interviews' | 'hires' | 'fill'
type Sort = { key: SortKey; dir: 1 | -1 }

// 주차 구분선 (2026-07-29 회의: "주마다 구분선 — D+7, D+14") — 모집 시작순 정렬일 때만 그린다.
// 6주(D+42)부터는 정체 판정 경계 너머라 한 묶음으로 접는다.
const weekBucket = (days: number | null) => (days == null ? null : Math.min(Math.floor(days / 7), 6))
const weekLabel = (i: I18n, b: number | null): [string, string] =>
  b == null ? [i.t('week.unknown'), '']
  : b === 0 ? [i.t('week.first'), i.t('week.firstRange')]
  : b === 6 ? [i.t('week.over6'), 'D+42~']
  : [i.t('week.nth', { n: i.fmtInt(b + 1) }), `D+${b * 7}~${b * 7 + 6}`]

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
  i, label, k, sort, onSort, src, srcLeft,
}: {
  i: I18n
  label: string
  k: SortKey
  sort: Sort
  onSort: (k: SortKey) => void
  src?: SrcKey       // 지정 시 라벨 옆 데이터 출처 배지 (ⓘ)
  srcLeft?: boolean
}) {
  const on = sort.key === k
  return (
    <th
      className={on ? 'sortable on' : 'sortable'}
      onClick={() => onSort(k)}
      title={i.t('th.sortTitle')}
      aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {/* 배지 클릭은 SrcTip 이 자체적으로 전파를 끊는다 — 출처를 보려던 클릭에 표가 뒤섞이지 않게 */}
      {src && <SrcTip k={src} left={srcLeft} />}
      <span className="sarr" aria-hidden>{on ? (sort.dir === -1 ? '▼' : '▲') : ''}</span>
    </th>
  )
}

export function JdTable({ jds, mode = 'open' }: { jds: JdRow[]; mode?: 'open' | 'closed' }) {
  const i = useI18n()
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
          ? String(va).localeCompare(String(vb), i.locale) * dir
          : (va - (vb as number)) * dir
      return d !== 0 ? d : tie(a, b)
    })
  }, [jds, sort, open, i.locale])
  const filtering = open && only && selected.size > 0
  const shown = filtering ? rows.filter(j => selected.has(j.code)) : rows
  // 다른 열로 정렬하면 주차가 섞여 구분선이 무의미해진다 — 모집 시작순(기본 정렬 포함)일 때만
  const weekSep = open && sort.key === 'received'

  if (!jds.length) return <EmptyState message={i.t('empty.jds')} />

  return (
    <>
      {open && (selected.size > 0 || only) && (
        <div className="seltools" role="toolbar" aria-label={i.t('sel.aria')}>
          <span>{rich(i.t('sel.count', { n: i.fmtInt(selected.size) }))}</span>
          <button
            type="button"
            className={only ? 'selbtn on' : 'selbtn'}
            disabled={!selected.size}
            onClick={() => saveSel(new Set(selected), !only)}
          >
            {only ? i.t('sel.onlyOn') : i.t('sel.only')}
          </button>
          <button type="button" className="selbtn" onClick={() => saveSel(new Set(), false)}>
            {i.t('sel.clear')}
          </button>
        </div>
      )}
      {filtering && shown.length === 0 ? (
        <EmptyState message={i.t('sel.emptyFiltered')} />
      ) : (
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                {open && <th className="selcell" aria-label={i.t('sel.colAria')} />}
                <SortTh i={i} label={i.t('th.jd')} k="company" sort={sort} onSort={onSort} src="jd.jd" srcLeft />
                <SortTh i={i} label={i.t('th.received')} k="received" sort={sort} onSort={onSort} src="jd.received" srcLeft />
                {!open && <th>{i.t('th.status')}<SrcTip k="jd.status" /></th>}
                <SortTh i={i} label={i.t('th.to')} k="to" sort={sort} onSort={onSort} src="jd.to" />
                <SortTh i={i} label={i.t('th.apps')} k="apps" sort={sort} onSort={onSort} src="jd.apps" />
                <SortTh i={i} label={i.t('th.pass')} k="docPass" sort={sort} onSort={onSort} src="pipe.docPass" />
                <SortTh i={i} label={i.t('th.delivered')} k="delivered" sort={sort} onSort={onSort} src="pipe.delivered" />
                <SortTh i={i} label={i.t('th.interviews')} k="interviews" sort={sort} onSort={onSort} src="pipe.interviews" />
                <SortTh i={i} label={i.t('th.hires')} k="hires" sort={sort} onSort={onSort} src="jd.filled" />
                <SortTh i={i} label={i.t('th.fill')} k="fill" sort={sort} onSort={onSort} src="jd.fill" />
              </tr>
            </thead>
            <tbody>
              {shown.map((j, idx) => {
                const full = `${j.company} ${j.code}${j.title ? ` · ${j.title}` : ''}`
                const view = jdView(j)
                // 완료·순항은 툴팁 없음 (숫자 열이 이미 설명) — 문제/유예 공고만 호버로 판정 이유 노출
                const note = open && view && view !== 'good' && view !== 'done' ? healthNote(i, j) : null
                const expanded = xCode === j.code
                const wb = weekBucket(j.days)
                const [wkName, wkRange] = weekSep && (idx === 0 || weekBucket(shown[idx - 1].days) !== wb) ? weekLabel(i, wb) : ['', '']
                return (
                  <Fragment key={j.code}>
                  {wkName && (
                    <tr className="wkrow">
                      <td colSpan={10}>
                        {wkName}
                        {wkRange && <span className="dim"> · {wkRange}</span>}
                      </td>
                    </tr>
                  )}
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
                          aria-label={i.t('sel.rowAria', { co: j.company, code: j.code })}
                        />
                      </td>
                    )}
                    <td className="jdcell">
                      <div className="cell-trunc" title={note ? undefined : `${full}${!open && j.status ? ` · ${j.status}` : ''}`}>
                        <span className="xchev" aria-hidden>▸</span>
                        {open && view && (
                          <i className={`jdot ${view}`} title={`${i.t(HEALTH_META[view].label)} — ${i.t(HEALTH_META[view].desc)}`} />
                        )}
                        <span className="tname">{j.company}</span>{' '}
                        <span className="tsub">{j.code}{j.title ? ` · ${j.title}` : ''}</span>
                      </div>
                      {note && j.health && (
                        <span className="tip" role="tooltip">
                          <span className="tipline">{full}</span>
                          <b>{i.t(HEALTH_META[j.health].label)}</b> — {note}
                        </span>
                      )}
                    </td>
                    <td title={j.startDate ? i.t('title.received') : undefined}>
                      {j.startDate ? (
                        <>
                          {i.fmtDay(j.startDate)}
                          {open && j.days != null && <span className="tsub"> · D+{i.fmtInt(j.days)}</span>}
                        </>
                      ) : (
                        <span className="dim">–</span>
                      )}
                    </td>
                    {!open && (
                      <td>
                        <span className="tag closed" title={j.status || undefined}>{i.t('tag.closed')}</span>
                      </td>
                    )}
                    <td>{j.headcount != null ? i.fmtInt(j.headcount) : <span className="dim">–</span>}</td>
                    {/* 주 숫자 = 시트(CANDIDATE DATA) 지원 건 + FYI 직접 지원(시트에 없음 — 제목 매칭 귀속).
                        FYI 몫이 있으면 툴팁에 분해해 운영이 시트와 대조할 때 헷갈리지 않게 한다 */}
                    <td
                      title={`${
                        j.appsFyi > 0
                          ? i.t('title.appsSplit', { n: i.fmtInt(j.apps), a: i.fmtInt(j.apps - j.appsFyi), b: i.fmtInt(j.appsFyi) })
                          : i.t('title.appsSheet', { n: i.fmtInt(j.apps) })
                      }${i.t('title.appsTail', { c: i.fmtInt(j.people), d: i.fmtInt(j.offer) })}`}
                    >
                      {i.fmtInt(j.apps)}
                    </td>
                    <td>{i.fmtInt(j.docPass)}</td>
                    <td>{i.fmtInt(j.delivered)}</td>
                    <td>{i.fmtInt(j.interviews)}</td>
                    <td title={i.t('title.hiresAll')}>{i.fmtInt(j.hiresAll)}</td>
                    <td
                      title={
                        j.headcount
                          ? `${i.t('title.fill', {
                              n: i.fmtInt(j.hiresAll),
                              to: i.fmtInt(j.headcount),
                              p: Math.round((j.hiresAll / j.headcount) * 100),
                            })}${j.dropped > 0 ? i.t('title.fillDrop', { n: i.fmtInt(j.dropped) }) : ''}${i.t('title.fillTail')}`
                          : undefined
                      }
                    >
                      {/* 완료 표시는 판정(진행 중 전용)과 별개 — 마감 표에서도 TO를 채웠는지는 같은 의미다 */}
                      <Meter
                        i={i}
                        ratio={j.headcount ? j.hiresAll / j.headcount : null}
                        done={j.headcount != null && j.hiresAll >= j.headcount}
                      />
                    </td>
                  </tr>
                  {expanded && <JdDetail i={i} j={j} open={open} colSpan={10} />}
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
