'use client'

// 로그인 제출 즉시 "확인 중…" 표시 — 서버 검증+첫 로드 동안 멈춘 것처럼 보이지 않게

import { useState } from 'react'
import { useI18n } from './i18n-provider'

export function LoginForm() {
  const i = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <form method="post" action="/api/login" onSubmit={() => setBusy(true)}>
      <input type="password" name="password" placeholder={i.t('login.pw')} autoFocus required readOnly={busy} />
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? (
          <>
            <span className="spin" aria-hidden /> {i.t('login.checking')}
          </>
        ) : (
          i.t('login.enter')
        )}
      </button>
    </form>
  )
}
