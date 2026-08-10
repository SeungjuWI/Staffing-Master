import { cookies } from 'next/headers'
import { LoginForm } from '@/components/login-form'
import { LangSwitch } from '@/components/lang-switch'
import { LANG_COOKIE, getI18n, pickLocale } from '@/lib/i18n'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sp = await searchParams
  const i = getI18n(pickLocale((await cookies()).get(LANG_COOKIE)?.value))
  return (
    <div className="login-box card">
      <h1>Staffing Master</h1>
      <p>{i.t('login.sub')}</p>
      {sp.error && <div className="login-err">{i.t('login.err')}</div>}
      <LoginForm />
      <div className="login-lang">
        <LangSwitch />
      </div>
    </div>
  )
}
