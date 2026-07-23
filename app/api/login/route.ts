import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, authHash } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const pw = String(form.get('password') || '')
  const expected = process.env.DASHBOARD_PASSWORD
  const url = req.nextUrl.clone()

  if (expected && pw === expected) {
    url.pathname = '/'
    url.search = ''
    const res = NextResponse.redirect(url, 303)
    res.cookies.set(AUTH_COOKIE, await authHash(expected), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  }
  url.pathname = '/login'
  url.search = '?error=1'
  return NextResponse.redirect(url, 303)
}
