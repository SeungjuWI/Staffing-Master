import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // CI/검증용 빌드가 dev 서버의 .next 를 덮어쓰지 않도록 분리 가능하게
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // 검증 빌드는 tsconfig.ci.json 사용 — 기본 tsconfig 는 dist 4종의 생성 타입을 모두
  // include 해서, dev 서버(.next)가 낡은 라우트 타입을 들고 있으면 격리 빌드까지 깨진다
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG || 'tsconfig.json' },
}

export default nextConfig
