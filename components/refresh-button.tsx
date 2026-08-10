'use client'

// 새로고침은 서버가 전 소스를 라이브로 다시 읽어 2~3초 걸린다 —
// 누르는 즉시 "갱신 중…" 상태를 보여줘 연타·불안을 막는다.

import { useState } from 'react'
import { useI18n } from './i18n-provider'

export function RefreshButton({ href }: { href: string }) {
  const i = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <a className={busy ? 'refresh busy' : 'refresh'} href={href} onClick={() => setBusy(true)} aria-busy={busy}>
      {busy ? <><span className="spin" aria-hidden /> {i.t('btn.refreshing')}</> : i.t('btn.refresh')}
    </a>
  )
}
