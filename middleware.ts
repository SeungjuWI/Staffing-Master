import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, authHash } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASSWORD
  if (!pass) return NextResponse.next() // 미설정 = 잠금 없음 (로컬 개발)

  const { pathname } = req.nextUrl
  // /api/health 는 크론 호출용 — 쿠키 대신 자체 CRON_SECRET 검증
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/api/health')) {
    return NextResponse.next()
  }
  if (req.cookies.get(AUTH_COOKIE)?.value === (await authHash(pass))) {
    return NextResponse.next()
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
