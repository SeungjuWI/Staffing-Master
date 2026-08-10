'use client'

// 언어 전환 (KO/EN/VI) — 쿠키에 저장하고 새로고침. URL 은 그대로 두어 탭·기간 상태를 유지한다.

import { LANG_COOKIE, LOCALES, type Locale } from '@/lib/i18n'
import { useI18n } from './i18n-provider'

export function LangSwitch() {
  const i = useI18n()
  const set = (l: Locale) => {
    if (l === i.locale) return
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    location.reload()
  }
  return (
    <span className="langs" role="group" aria-label={i.t('a11y.langPick')}>
      {LOCALES.map(l => (
        <button
          key={l.value}
          type="button"
          className={l.value === i.locale ? 'lang on' : 'lang'}
          title={l.full}
          aria-pressed={l.value === i.locale}
          onClick={() => set(l.value)}
        >
          {l.label}
        </button>
      ))}
    </span>
  )
}
