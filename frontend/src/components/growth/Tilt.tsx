import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A surface that leans toward the pointer, like a slab tilted under gallery light.
 * Mouse/pen only (touch scrolls normally); off under reduced motion. Max ±5°.
 */
export default function Tilt({ children, className, max = 5 }: { children: ReactNode; className?: string; max?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function move(e: React.PointerEvent) {
    if (reduced || e.pointerType === 'touch' || !el.current) return
    const r = el.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    el.current.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateZ(0)`
  }
  function leave() { if (el.current) el.current.style.transform = '' }
  return (
    <div ref={el} onPointerMove={move} onPointerLeave={leave}
      className={cn('transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform [transform-style:preserve-3d]', className)}>
      {children}
    </div>
  )
}
