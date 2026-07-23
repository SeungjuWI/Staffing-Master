import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Staffing Master — 스태핑 마스터 대시보드',
  description: '멋쟁이사자처럼 글로벌신사업본부 스태핑 비즈니스 경영 대시보드',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
