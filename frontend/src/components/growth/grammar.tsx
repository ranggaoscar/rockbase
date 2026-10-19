import type { ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, CircleSlash, Clock3, Cloud, HardDrive, Loader2, Lock, PlugZap, Sparkles, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ──────────────────────────────────────────────────────────────────────────
 * Evidence grade — "how do we know this?"
 *   measured     solid    first-party measurement with a period (GSC, crawl)
 *   observed     hatched  an external signal was seen (RSS bucket, first-seen)
 *   idea         ring     editorial relevance only; no external evidence
 *   unavailable  slashed  not measured / not connected / not in this mode
 * ────────────────────────────────────────────────────────────────────────── */
export type Grade = 'measured' | 'observed' | 'idea' | 'unavailable'

export const gradeCopy: Record<Grade, { label: string; long: string }> = {
  measured: { label: 'Measured', long: 'First-party measurement with a reporting period' },
  observed: { label: 'Observed', long: 'An external signal was seen; magnitude is approximate' },
  idea: { label: 'Idea', long: 'Editorial relevance only — no trend or performance evidence' },
  unavailable: { label: 'Not measured', long: 'No data source for this yet — never shown as zero' },
}

export function Mark({ grade, className }: { grade: Grade; className?: string }) {
  return <span aria-hidden className={cn('mark', `mark-${grade}`, className)} />
}

export function GradeTag({ grade, children, className }: { grade: Grade; children?: ReactNode; className?: string }) {
  return (
    <span title={gradeCopy[grade].long} className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground', className)}>
      <Mark grade={grade} />
      <span className={cn(grade === 'measured' && 'text-patina', grade === 'observed' && 'text-signal')}>{children ?? gradeCopy[grade].label}</span>
    </span>
  )
}

export function GradeLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {(Object.keys(gradeCopy) as Grade[]).map((grade) => <GradeTag key={grade} grade={grade} />)}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Effect class — "what happens when I press this?"
 * Shown beside any action whose consequence isn't obvious from its label.
 * ────────────────────────────────────────────────────────────────────────── */
export type Effect = 'local' | 'browser' | 'network' | 'google' | 'crawl' | 'ai' | 'external'

const effectCopy: Record<Effect, { label: string; icon: typeof HardDrive; tone: string }> = {
  local: { label: 'Saves in RockBase', icon: HardDrive, tone: 'text-muted-foreground' },
  browser: { label: 'Saves in this browser only', icon: HardDrive, tone: 'text-ochre' },
  network: { label: 'Reads a public feed', icon: Cloud, tone: 'text-signal' },
  google: { label: 'Requests data from Google', icon: Cloud, tone: 'text-ember' },
  crawl: { label: 'Crawls your website', icon: ArrowUpRight, tone: 'text-signal' },
  ai: { label: 'Calls an AI provider · may cost', icon: Sparkles, tone: 'text-ember' },
  external: { label: 'Publishes outside RockBase', icon: Send, tone: 'text-ember' },
}

export function EffectTag({ effect, children, className }: { effect: Effect; children?: ReactNode; className?: string }) {
  const { label, icon: Icon, tone } = effectCopy[effect]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] leading-none', tone, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{children ?? label}</span>
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Source health — loading, empty, error, stale, off-in-this-mode and
 * not-connected are different states and must never look alike.
 * ────────────────────────────────────────────────────────────────────────── */
export type SourceStatus = 'loading' | 'ok' | 'empty' | 'stale' | 'error' | 'mode' | 'disconnected' | 'setup'

const sourceCopy: Record<SourceStatus, { label: string; icon: typeof HardDrive; tone: string; dot: string }> = {
  loading: { label: 'Checking', icon: Loader2, tone: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
  ok: { label: 'Current', icon: Clock3, tone: 'text-patina', dot: 'bg-patina' },
  empty: { label: 'Nothing yet', icon: CircleSlash, tone: 'text-muted-foreground', dot: 'bg-chalk/40' },
  stale: { label: 'Stale', icon: Clock3, tone: 'text-ochre', dot: 'bg-ochre' },
  error: { label: 'Unavailable', icon: AlertTriangle, tone: 'text-oxide', dot: 'bg-oxide' },
  mode: { label: 'Local Mode only', icon: Lock, tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
  disconnected: { label: 'Not connected', icon: PlugZap, tone: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
  setup: { label: 'Needs setup', icon: PlugZap, tone: 'text-ochre', dot: 'bg-ochre' },
}

export function SourcePill({ status, name, detail, className }: { status: SourceStatus; name: string; detail?: string; className?: string }) {
  const { label, icon: Icon, tone } = sourceCopy[status]
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs', className)} title={detail}>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone, status === 'loading' && 'animate-spin')} aria-hidden />
      <span className="font-medium text-foreground/90">{name}</span>
      <span className={cn('truncate', tone)}>{detail ?? label}</span>
    </span>
  )
}

export function SourceDot({ status }: { status: SourceStatus }) {
  return <span aria-hidden className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', sourceCopy[status].dot, status === 'loading' && 'animate-pulse')} />
}

export const sourceLabel = (status: SourceStatus) => sourceCopy[status].label

/** Missing data. Renders as a hatched void with a reason — never as "0". */
export function Void({ reason, className, compact }: { reason: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn('void flex items-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground', compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2.5 text-xs', className)}>
      <Mark grade="unavailable" />
      <span className="min-w-0">{reason}</span>
    </div>
  )
}

/* Page scaffolding ─────────────────────────────────────────────────────── */
export function PageHeader({ eyebrow, title, lede, actions, meta, className }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display mt-1.5 text-[2rem] font-semibold leading-[1.04] text-foreground md:text-[2.75rem]">{title}</h1>
        {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty">{lede}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ children, aside, id, className }: { children: ReactNode; aside?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3', className)}>
      <h2 id={id} className="font-display text-[17px] font-semibold text-foreground">{children}</h2>
      {aside && <div className="shrink-0 text-xs text-muted-foreground">{aside}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children, action, className }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; action?: ReactNode; className?: string }) {
  const tones = {
    info: 'border-border bg-secondary/35 text-muted-foreground',
    warn: 'border-ochre/30 bg-[linear-gradient(90deg,hsl(var(--ochre)/0.09),hsl(var(--ochre)/0.03))] text-ochre',
    error: 'border-oxide/30 bg-[linear-gradient(90deg,hsl(var(--oxide)/0.1),hsl(var(--oxide)/0.03))] text-oxide',
    ok: 'border-patina/30 bg-[linear-gradient(90deg,hsl(var(--patina)/0.09),hsl(var(--patina)/0.03))] text-patina',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03)]', tones[tone], className)}>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  )
}

/** Relative time that degrades honestly when a timestamp is missing or invalid. */
export function ago(value?: string | null): string {
  if (!value) return 'never'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'unknown time'
  const seconds = Math.round((Date.now() - time) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export const ageDays = (value?: string | null) => {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? (Date.now() - time) / 86_400_000 : Infinity
}

export const fmt = {
  n: (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n),
  pct: (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(2)}%`,
  pos: (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1),
  date: (s?: string | null) => s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
  dateTime: (s?: string | null) => s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
}
