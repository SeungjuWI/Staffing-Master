import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // CI/검증용 빌드가 dev 서버의 .next 를 덮어쓰지 않도록 분리 가능하게
  distDir: process.env.NEXT_DIST_DIR || '.next',
}

export default nextConfig
