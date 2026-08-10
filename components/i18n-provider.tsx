'use client'

// 클라이언트 컴포넌트용 i18n 컨텍스트 — layout 이 쿠키에서 읽은 로케일을 공급한다.
// SSR 중에도 컨텍스트로 전달되므로 요청 간 누수 없이 안전하다.

import { createContext, useContext, useMemo } from 'react'
import { getI18n, type I18n, type Locale } from '@/lib/i18n'

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const i = useMemo(() => getI18n(locale), [locale])
  return <Ctx.Provider value={i}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const i = useContext(Ctx)
  if (!i) throw new Error('useI18n must be used within I18nProvider')
  return i
}
