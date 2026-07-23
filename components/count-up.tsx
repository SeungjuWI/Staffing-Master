'use client'

// 숫자 카운트업 — 히어로/타일 수치가 로드 시 차오르는 모션.
// prefers-reduced-motion 이면 즉시 최종값 표시.

import { useEffect, useState } from 'react'
import { fmtInt, fmtKrw, fmtUsd } from '@/lib/fmt'

const FMT = { int: fmtInt, krw: fmtKrw, usd: fmtUsd } as const
export type CountKind = keyof typeof FMT

export function CountUp({ n, kind = 'int', duration = 900 }: { n: number; kind?: CountKind; duration?: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(n)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(n * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n, duration])
  return <>{FMT[kind](Math.round(v))}</>
}
