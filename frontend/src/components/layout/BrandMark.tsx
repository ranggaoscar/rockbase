import { useId } from 'react'
import { cn } from '@/lib/utils'

/** Three polished slabs in isometric view: the Growth Monolith in miniature. */
export default function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const slab = (y: number, tone: string, w = 1) => (
    <g transform={`translate(0 ${y})`}>
      <path d={`M16 ${6} L${16 + 10 * w} ${11} L16 ${16} L${16 - 10 * w} ${11} Z`} fill={`url(#${id}-top-${tone})`} />
      <path d={`M${16 - 10 * w} 11 L16 16 L16 19 L${16 - 10 * w} 14 Z`} fill={`hsl(var(--${tone}) / 0.55)`} />
      <path d={`M${16 + 10 * w} 11 L16 16 L16 19 L${16 + 10 * w} 14 Z`} fill={`hsl(var(--${tone}) / 0.3)`} />
    </g>
  )
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8 shrink-0', className)} aria-hidden>
      <defs>
        {['signal', 'patina', 'chalk'].map((tone) => (
          <linearGradient key={tone} id={`${id}-top-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(var(--${tone}))`} />
            <stop offset="1" stopColor={`hsl(var(--${tone}) / 0.55)`} />
          </linearGradient>
        ))}
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(222 14% 19%)" /><stop offset="1" stopColor="hsl(224 14% 11%)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-bg)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="hsl(0 0% 100% / 0.09)" />
      {slab(8, 'chalk', 0.82)}
      {slab(3.5, 'patina', 0.92)}
      {slab(-1, 'signal')}
    </svg>
  )
}
