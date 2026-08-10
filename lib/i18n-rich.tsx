// 사전 문자열 안의 단순 마크업(<b>·<code>·<i>·<em>)을 React 노드로 — 중첩 없는 1단계만 지원.
// 번역문에서 강조 위치가 언어마다 달라지므로 JSX 분해 대신 문자열에 태그를 남겨 두고 여기서 푼다.

import { Fragment, createElement, type ReactNode } from 'react'

const TAG_RE = /<(b|code|i|em)>([\s\S]*?)<\/\1>/g

export function rich(s: string): ReactNode {
  if (!s.includes('<')) return s
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(createElement(m[1], { key: m.index }, m[2]))
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return createElement(Fragment, null, ...out)
}
