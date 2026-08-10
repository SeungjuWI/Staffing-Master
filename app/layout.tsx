import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { I18nProvider } from '@/components/i18n-provider'
import { LANG_COOKIE, getI18n, pickLocale } from '@/lib/i18n'
import './globals.css'

// 언어 쿠키를 읽어 제목·설명도 로케일에 맞춘다 (쿠키 접근 → 항상 동적 렌더, 페이지는 이미 force-dynamic)
export async function generateMetadata(): Promise<Metadata> {
  const locale = pickLocale((await cookies()).get(LANG_COOKIE)?.value)
  const i = getI18n(locale)
  return { title: i.t('app.title'), description: i.t('app.desc') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = pickLocale((await cookies()).get(LANG_COOKIE)?.value)
  return (
    <html lang={locale}>
      <body>
        {/* Pretendard Variable — 대시보드 표준 UI 폰트, 라틴·베트남어 발음구별기호 포함 (실패 시 system-ui 폴백) */}
        <link
          rel="stylesheet"
          precedence="default"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  )
}
