import { ExternalLink } from 'lucide-react'
import type { TrendCandidate } from '@/components/trends/api'
import { fmt } from '@/components/growth/grammar'

export const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not available'
export const safeSourceUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null } catch { return null }
}

const gscFields = ['query', 'property', 'websiteName', 'periods', 'clicks', 'impressions', 'ctr', 'position', 'confidence', 'syncedAt', 'freshness', 'coverage', 'reason']
function evidenceValue(item: Record<string, unknown>, key: string) {
  const value = item[key]
  if (key === 'position' && typeof value === 'number') return value.toFixed(2)
  if (key === 'ctr' && typeof value === 'number') return `${(value * 100).toFixed(2)}%`
  if (key === 'syncedAt' && typeof value === 'string') return dateLabel(value)
  if (key === 'periods' && value && typeof value === 'object') {
    const periods = value as { current?: { startDate?: string; endDate?: string }; previous?: { startDate?: string; endDate?: string } }
    return `Current: ${periods.current?.startDate ?? 'Unknown'} – ${periods.current?.endDate ?? 'Unknown'}; previous: ${periods.previous ? `${periods.previous.startDate ?? 'Unknown'} – ${periods.previous.endDate ?? 'Unknown'}` : 'Unavailable'}`
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'Not available')
}

/** Every evidence entry, with its source link, metrics and the raw record. */
export function EvidenceList({ evidence }: { evidence: unknown[] }) {
  const rows = evidence.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as Record<string, unknown>
    const url = safeSourceUrl(item.url ?? item.sourceUrl ?? item.source_url)
    const title = typeof item.title === 'string' ? item.title : typeof item.source === 'string' ? item.source : `Evidence ${index + 1}`
    const news = Array.isArray(item.news) ? item.news : []
    const kind = item.type === 'google_search_console_cached' ? 'Search Console (cached)' : String(item.type || '').startsWith('google_trends_rss') ? 'Trending Now RSS' : 'Source'
    return (
      <li key={`${title}-${index}`} className="min-w-0 break-words rounded-md border border-border px-3 py-2.5 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-[0.1em]">{kind}</p>
        <div className="mt-1">{url ? <a className="inline-flex max-w-full items-center gap-1 break-all text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground" href={url} target="_blank" rel="noreferrer">{title}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <span className="text-foreground">{title}</span>}{typeof item.publishedAt === 'string' && ` · ${dateLabel(item.publishedAt)}`}</div>
        {item.type === 'google_search_console_cached' && <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">{gscFields.filter((key) => item[key] !== undefined).map((key) => <div key={key} className="min-w-0 break-words"><dt className="inline text-foreground/70">{key}: </dt><dd className="inline font-data">{evidenceValue(item, key)}</dd></div>)}</dl>}
        {(item.type === 'google_trends_rss' || item.type === 'google_trends_rss_comparison') && <p className="mt-1.5">Traffic bucket: <span className="font-data text-foreground/90">{String(item.trafficText || 'Not reported')}</span> · parsed lower bound: {String(item.trafficLowerBound ?? 'Not available')}{item.fetchedAt ? ` · synced ${dateLabel(String(item.fetchedAt))}` : ''}</p>}
        {news.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{news.map((raw, i) => { const n = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}; const newsUrl = safeSourceUrl(n.url); return <li key={i} className="break-words">{newsUrl ? <a className="underline" target="_blank" rel="noreferrer" href={newsUrl}>{String(n.title || n.source || `News ${i + 1}`)}<ExternalLink className="ml-1 inline h-3 w-3" /></a> : String(n.title || n.source || `News ${i + 1}`)}{n.source ? ` · ${String(n.source)}` : null}</li> })}</ul>}
        <details className="mt-1.5"><summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Raw record</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-data text-[11px]">{JSON.stringify(item, null, 2)}</pre></details>
      </li>
    )
  }).filter(Boolean)
  if (!rows.length) return <p className="text-xs text-muted-foreground">No external evidence attached. This is editorial relevance only.</p>
  return <ul className="space-y-2">{rows}</ul>
}

/** GSC comparison as a compact instrument: current ← previous, delta. */
export function GscSignal({ signal }: { signal: NonNullable<TrendCandidate['signal']> }) {
  const cells: Array<[string, string, string, string]> = [
    ['Impressions', fmt.n(signal.current?.impressions), signal.previous ? fmt.n(signal.previous.impressions) : '—', signal.deltas.impressions == null ? '—' : `${signal.deltas.impressions >= 0 ? '+' : ''}${fmt.n(signal.deltas.impressions)}`],
    ['Clicks', fmt.n(signal.current?.clicks), signal.previous ? fmt.n(signal.previous.clicks) : '—', signal.deltas.clicks == null ? '—' : `${signal.deltas.clicks >= 0 ? '+' : ''}${fmt.n(signal.deltas.clicks)}`],
    ['CTR', signal.current?.ctr == null ? 'n/a' : fmt.pct(signal.current.ctr), signal.previous ? signal.previous.ctr == null ? 'n/a' : fmt.pct(signal.previous.ctr) : '—', signal.deltas.ctrPp == null ? '—' : `${signal.deltas.ctrPp >= 0 ? '+' : ''}${signal.deltas.ctrPp.toFixed(2)} pp`],
    ['Position', signal.current ? signal.current.position.toFixed(1) : '—', signal.previous ? signal.previous.position.toFixed(1) : '—', signal.deltas.positionImprovement == null ? '—' : `${signal.deltas.positionImprovement >= 0 ? '↑' : '↓'} ${Math.abs(signal.deltas.positionImprovement).toFixed(1)}`],
  ]
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{signal.periods ? `${signal.periods.current.startDate} – ${signal.periods.current.endDate}${signal.periods.previous ? `  vs  ${signal.periods.previous.startDate} – ${signal.periods.previous.endDate}` : ' · no previous period'}` : 'Reporting periods unavailable'}</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        {cells.map(([label, cur, prev, delta]) => (
          <div key={label} className="bg-card px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
            <p className="font-data mt-1 text-lg leading-none text-foreground">{cur}</p>
            <p className="font-data mt-1.5 text-[11px] text-muted-foreground">{prev} → <span className="text-foreground/80">{delta}</span></p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Impression growth: {signal.growthPct === null ? 'not computable (baseline zero or unavailable)' : `${signal.growthPct.toFixed(1)}%`} · history comparisons: {signal.historyComparisons}</p>
    </div>
  )
}
