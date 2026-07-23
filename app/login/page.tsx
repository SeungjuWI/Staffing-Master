import { LoginForm } from '@/components/login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sp = await searchParams
  return (
    <div className="login-box card">
      <h1>Staffing Master</h1>
      <p>글로벌신사업본부 스태핑 대시보드 — 비밀번호를 입력하세요.</p>
      {sp.error && <div className="login-err">비밀번호가 올바르지 않습니다.</div>}
      <LoginForm />
    </div>
  )
}
