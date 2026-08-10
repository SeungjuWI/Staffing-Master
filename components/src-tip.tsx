'use client'

// 데이터 출처 배지(ⓘ) — "이 숫자는 어느 시트 어느 탭 어느 열에서 오나"를 말풍선으로 보여주고,
// 각 줄을 눌러 그 원본(시트 탭·백오피스)으로 바로 갈 수 있게 한다 (2026-07-30 대표 요청).
// 설명 원장은 lib/sources.ts, 시트 링크는 서버가 읽은 탭 gid (MasterData.sheetLinks).
//
// 말풍선을 body 로 포털 + position: fixed 로 띄우는 이유: 표는 .tbl-scroll(overflow:auto) 안에 있고
// 카드·타일은 등장 애니메이션으로 각자 스택 문맥을 만든다 → 말풍선을 그 안에 두면 z-index 를
// 아무리 올려도 짧은 표에서는 잘리고, 이웃 타일 밑으로 깔린다 (실측). 고정 레이어로 빼면
// 조상의 overflow·스택 문맥과 무관하게 항상 맨 위에 뜬다.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SRC, srcHref, type SrcKey } from '@/lib/sources'
import { useI18n } from './i18n-provider'

const LinkCtx = createContext<Record<string, string>>({})

// page.tsx 가 서버에서 읽은 시트 링크를 트리 전체에 공급 — 서버 컴포넌트(표·타일)가 렌더한
// 배지든 클라이언트 컴포넌트(공고 표)가 렌더한 배지든 같은 링크 맵을 쓴다.
export function SrcLinkProvider({
  links,
  children,
}: {
  links: Record<string, string> | undefined
  children: React.ReactNode
}) {
  return <LinkCtx.Provider value={links || {}}>{children}</LinkCtx.Provider>
}

type Pos = { left: number; top?: number; bottom?: number; align: 'l' | 'r' }

const GAP = 8      // 배지와 말풍선 사이 간격
const NEED = 210   // 아래로 펼치는 데 필요한 여유 높이 (부족하면 위로 뒤집는다)

export function SrcTip({ k, left }: { k: SrcKey; left?: boolean }) {
  const i18n = useI18n()
  const links = useContext(LinkCtx)
  const s = SRC[k]
  const ref = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  const open = useCallback(() => {
    if (closeT.current) clearTimeout(closeT.current)
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    // 아래 공간이 부족하고 위가 더 넓으면 위로 뒤집는다 (표 아래쪽 행·화면 하단에서 잘리지 않게)
    const flip = vh - r.bottom < NEED && r.top > vh - r.bottom
    // 폭을 모르고도 안 밀리게 한쪽 변만 고정 — 기본은 오른쪽 정렬(숫자 열은 화면 오른쪽에 몰려 있다).
    // 좁은 화면에서 반대쪽으로 삐져나가지 않게 최대 폭(CSS 와 같은 값)만큼 여유를 두고 가둔다.
    const w = Math.min(340, vw - 24)
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
    setPos({
      left: left ? clamp(r.left - 10, 12, vw - 12 - w) : clamp(r.right + 10, 12 + w, vw - 12),
      top: flip ? undefined : r.bottom + GAP,
      bottom: flip ? vh - r.top + GAP : undefined,
      align: left ? 'l' : 'r',
    })
  }, [left])

  const close = useCallback(() => {
    if (closeT.current) clearTimeout(closeT.current)
    // 배지 → 말풍선으로 마우스가 건너가는 사이에 닫히면 링크를 누를 수 없다
    closeT.current = setTimeout(() => setPos(null), 140)
  }, [])

  // 고정 레이어라 스크롤하면 배지와 어긋난다 → 스크롤·리사이즈에는 즉시 닫는다.
  // 바깥을 누르면 닫기 — 터치에서는 호버가 없어 탭으로 열고 다른 곳을 탭해 닫는다.
  useEffect(() => {
    if (!pos) return
    const hide = () => setPos(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !tipRef.current?.contains(t)) hide()
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [pos])

  useEffect(() => () => { if (closeT.current) clearTimeout(closeT.current) }, [])

  return (
    <span
      ref={ref}
      className="srci"
      tabIndex={0}
      // 부모(정렬 안내 등)의 기본 title 툴팁이 배지 위에서 겹쳐 뜨는 것을 막는다
      title=""
      role="button"
      aria-label={i18n.t('srcTip.aria')}
      aria-expanded={pos != null}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={e => {
        // 공고 표 헤더는 클릭이 정렬 → 전파는 항상 끊는다 (출처를 보려던 클릭에 표가 뒤섞이면 안 된다).
        e.stopPropagation()
        // 말풍선은 body 로 포털됐지만 React 트리에서는 이 배지의 자식이라, 말풍선 안 링크 클릭도
        // 여기를 거쳐 올라온다 → 그때 preventDefault 하면 링크가 안 열린다. 링크는 그대로 통과.
        if (tipRef.current?.contains(e.target as Node)) return
        // 배지 클릭은 항상 열기(토글 아님) — 터치는 탭 직전 mouseover 로 이미 열려 있어서,
        // 토글이면 열자마자 닫힌다. 닫기는 바깥 탭·Esc·스크롤이 맡는다.
        e.preventDefault()
        open()
      }}
    >
      <i aria-hidden>i</i>
      {pos &&
        createPortal(
          <span
            ref={tipRef}
            className={`srctip ${pos.align}`}
            role="tooltip"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
            onMouseEnter={open}
            onMouseLeave={close}
            // 누르고 있는 동안 닫히지 않게 — 버튼을 조금 오래 누르는 평범한 클릭에서도
            // 말풍선이 먼저 사라져 링크의 click 이 아예 안 나는 일을 막는다
            onPointerDown={open}
          >
            <span className="src-t">{i18n.t('srcTip.title')}</span>
            {s.lines.map((l, i) => {
              const href = srcHref(links, l)
              const body = (
                <>
                  <b>{i18n.t(l.sys)}</b>
                  {l.loc && <> {i18n.t(l.loc)}</>}
                </>
              )
              return (
                <span className="src-row" key={i}>
                  <em className={`src-k ${l.k}`}>{i18n.t(`srcKind.${l.k}`)}</em>
                  {href ? (
                    <a className="src-body lk" href={href} target="_blank" rel="noreferrer">
                      {body}
                      <span className="src-go" aria-hidden>↗</span>
                    </a>
                  ) : (
                    <span className="src-body">{body}</span>
                  )}
                </span>
              )
            })}
            {s.note && <span className="src-note">{i18n.t(s.note)}</span>}
          </span>,
          document.body,
        )}
    </span>
  )
}
