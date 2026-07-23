// 접근 제어 — DASHBOARD_PASSWORD 하나로 잠그는 단순 게이트.
// 쿠키에는 비밀번호가 아니라 해시를 저장한다. (edge/node 양쪽에서 동작하는 Web Crypto)

export const AUTH_COOKIE = 'sm_auth'

export async function authHash(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${password}::staffing-master`))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
