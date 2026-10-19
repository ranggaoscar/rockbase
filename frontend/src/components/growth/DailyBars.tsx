import { useMemo, useState } from 'react'

/**
 * One measure per chart (never a dual axis). Thin bars anchored to the
 * baseline, recessive grid, per-bar hover tooltip, and real values only —
 * a missing day is drawn as a gap, never as zero.
 */
export interface DailyPoint { date: string; value: number | null }

export default function DailyBars({ points, color, label, format = (n) => n.toLocaleString(), height = 120 }: { points: DailyPoint[]; color: string; label: string; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = useMemo(() => Math.max(1, ...points.map((p) => p.value ?? 0)), [points])
  const niceMax = useMemo(() => { const pow = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / pow) * pow }, [max])
  const w = 100 / Math.max(points.length, 1)
  const h = height
  const active = hover == null ? null : points[hover]

  return (
    <figure className="relative" aria-label={`${label}, daily`}>
      <div className="relative" style={{ height: h }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-hidden>
          {[0.5, 1].map((t) => <line key={t} x1="0" x2="100" y1={h - t * h} y2={h - t * h} stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray={t === 1 ? '0' : '2 3'} />)}
          <line x1="0" x2="100" y1={h} y2={h} stroke="hsl(var(--line-strong))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => {
            if (p.value == null) return null
            const bh = Math.max(1, (p.value / niceMax) * (h - 2))
            const gap = Math.min(0.6, w * 0.28)
            return <rect key={p.date} x={i * w + gap / 2} y={h - bh} width={Math.max(0.2, w - gap)} height={bh} rx="0.6" fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />
          })}
        </svg>
        <div className="absolute inset-0 flex">
          {points.map((p, i) => <button key={p.date} type="button" aria-label={`${p.date}: ${p.value == null ? 'no data' : format(p.value)} ${label}`} className="h-full flex-1 focus:outline-none focus-visible:bg-secondary/40" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />)}
        </div>
        {active && hover != null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-xl" style={{ left: `${(hover + 0.5) * w}%` }}>
            <p className="text-muted-foreground">{new Date(`${active.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <p className="font-data text-foreground">{active.value == null ? 'No data' : format(active.value)} <span className="text-muted-foreground">{label}</span></p>
          </div>
        )}
        <span className="font-data absolute -top-0.5 right-0 -translate-y-full text-[10px] text-muted-foreground">{format(niceMax)}</span>
      </div>
      <figcaption className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0] ? new Date(`${points[0].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
        <span>{points.at(-1) ? new Date(`${points.at(-1)!.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
      </figcaption>
    </figure>
  )
}
