'use client'

// 로그인 제출 즉시 "확인 중…" 표시 — 서버 검증+첫 로드 동안 멈춘 것처럼 보이지 않게

import { useState } from 'react'

export function LoginForm() {
  const [busy, setBusy] = useState(false)
  return (
    <form method="post" action="/api/login" onSubmit={() => setBusy(true)}>
      <input type="password" name="password" placeholder="비밀번호" autoFocus required readOnly={busy} />
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? (
          <>
            <span className="spin" aria-hidden /> 확인 중…
          </>
        ) : (
          '들어가기'
        )}
      </button>
    </form>
  )
}
