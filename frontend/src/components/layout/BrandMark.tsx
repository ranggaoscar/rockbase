import { cn } from '@/lib/utils'

/** Stacked strata: layered rock, layered evidence. */
export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="hsl(150 6% 11%)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="hsl(148 6% 22%)" />
      <path d="M7 10.5h13.5" stroke="hsl(var(--patina))" strokeWidth="3" strokeLinecap="round" />
      <path d="M7 16h18" stroke="hsl(var(--signal))" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <path d="M7 21.5h9" stroke="hsl(var(--chalk))" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <circle cx="21.5" cy="21.5" r="1.9" fill="hsl(var(--ember))" />
    </svg>
  )
}
