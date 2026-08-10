'use client'

// 언어 전환 (KO/EN/VI) — 쿠키에 저장 후 router.refresh() 소프트 리프레시.
// 전체 리로드 없이 서버 컴포넌트만 새 로케일로 다시 받아 단어가 제자리에서 바뀐다
// (스크롤·선택·펼침 등 클라이언트 상태 유지, 데이터는 30분 캐시라 즉시).
// refresh 는 트랜지션이라 새 화면이 준비될 때까지 기존 화면이 유지된다 — 스켈레톤 깜빡임 없음.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LANG_COOKIE, LOCALES, type Locale } from '@/lib/i18n'
import { useI18n } from './i18n-provider'

export function LangSwitch() {
  const i = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // 낙관적 활성 표시 — 누르는 즉시 버튼이 바뀌고, refresh 완료 후엔 i.locale 과 일치한다
  const [picked, setPicked] = useState<Locale | null>(null)
  const active = picked ?? i.locale

  const set = (l: Locale) => {
    if (l === active) return
    setPicked(l)
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    startTransition(() => router.refresh())
  }

  return (
    <span className="langs" role="group" aria-label={i.t('a11y.langPick')} aria-busy={pending}>
      {LOCALES.map(l => (
        <button
          key={l.value}
          type="button"
          className={l.value === active ? 'lang on' : 'lang'}
          title={l.full}
          aria-pressed={l.value === active}
          disabled={pending}
          onClick={() => set(l.value)}
        >
          {l.label}
        </button>
      ))}
    </span>
  )
}
