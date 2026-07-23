'use client'

// 새로고침은 서버가 전 소스를 라이브로 다시 읽어 2~3초 걸린다 —
// 누르는 즉시 "갱신 중…" 상태를 보여줘 연타·불안을 막는다.

import { useState } from 'react'

export function RefreshButton({ href }: { href: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <a className={busy ? 'refresh busy' : 'refresh'} href={href} onClick={() => setBusy(true)} aria-busy={busy}>
      {busy ? <><span className="spin" aria-hidden /> 갱신 중…</> : '새로고침'}
    </a>
  )
}
