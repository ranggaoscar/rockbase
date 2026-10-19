import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, RotateCw, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import DailyBars from '@/components/growth/DailyBars'
import { EffectTag, GradeTag, Mark, Notice, PageHeader, SectionTitle, SourcePill, Void, ago, ageDays, fmt, type SourceStatus } from '@/components/growth/grammar'
import { isLocalMode } from '@/components/layout/nav'
import { pickSite, useWorkContext } from '@/lib/brandRegistry'
import { seoApi, setSeoWorkspace, type Comparison, type Scan, type Website } from '@/components/seo/api'
import { gscApi, type GscReport } from '@/components/seo/gscApi'
import { activityApi } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

type QueueRow = { status: string; platform: string }

/**
 * Results — only what is actually measured, each with its source and period.
 * Execution status and growth outcomes are never on the same scale.
 */
export default function Results() {
  const ctx = useWorkContext()
  const setContext = useAppStore((s) => s.setContext)
  const ready = ctx.registry.status === 'ready' && Boolean(ctx.workspaceId)
  const [sites, setSites] = useState<Website[] | null>(null)
  const [siteError, setSiteError] = useState('')
  const [scans, setScans] = useState<Scan[] | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [days, setDays] = useState<7 | 28>(28)
  const [gsc, setGsc] = useState<{ status: SourceStatus; report: GscReport | null; detail: string }>({ status: 'loading', report: null, detail: '' })
  const [queue, setQueue] = useState<{ status: 'loading' | 'ok' | 'error'; rows: QueueRow[] }>({ status: 'loading', rows: [] })
  const [showTable, setShowTable] = useState(false)
  const [nonce, setNonce] = useState(0)

  const website = sites ? pickSite(sites, ctx.brandKey, ctx.websiteId) : undefined

  useEffect(() => {
    if (!ready) return
    let alive = true
    setSites(null); setSiteError('')
    setSeoWorkspace(ctx.workspaceId)
    seoApi.websites().then(({ data }) => { if (alive) setSites(data) }).catch(() => { if (alive) { setSites([]); setSiteError('Site registry unavailable — the SEO worker may be offline.') } })
    activityApi.publishingQueue().then(({ data }) => { if (alive) setQueue({ status: 'ok', rows: data.rows || [] }) }).catch(() => { if (alive) setQueue({ status: 'error', rows: [] }) })
    return () => { alive = false }
  }, [ready, ctx.workspaceId, nonce])

  useEffect(() => {
    if (!website) { setScans(null); setComparison(null); return }
    let alive = true
    setScans(null); setComparison(null)
    seoApi.scans(website.id).then(async ({ data }) => {
      if (!alive) return
      setScans(data)
      const latest = data.find((s) => s.status === 'completed')
      if (latest) { const { data: c } = await seoApi.compare(latest.id).catch(() => ({ data: null })); if (alive) setComparison(c) }
    }).catch(() => { if (alive) setScans([]) })
    return () => { alive = false }
  }, [website?.id, nonce])

  useEffect(() => {
    if (!isLocalMode) { setGsc({ status: 'mode', report: null, detail: 'Search Console runs in Local Mode only.' }); return }
    if (!website) { setGsc({ status: sites ? 'setup' : 'loading', report: null, detail: 'Needs a website' }); return }
    let alive = true
    setGsc({ status: 'loading', report: null, detail: '' })
    gscApi.status().then(async ({ data: status }) => {
      if (!alive) return
      if (!status.enabled) return setGsc({ status: 'setup', report: null, detail: status.setupRequired || 'Not enabled on this install.' })
      if (!status.connected) return setGsc({ status: 'disconnected', report: null, detail: 'Search Console is not connected.' })
      const { data } = await gscApi.report(ctx.workspaceId, website.id, days)
      if (!alive) return
      if (!data) return setGsc({ status: 'empty', report: null, detail: `No synced ${days}-day report for this website yet.` })
      setGsc({ status: ageDays(data.syncedAt) > 7 ? 'stale' : 'ok', report: data, detail: `Synced ${ago(data.syncedAt)}` })
    }).catch((e) => { if (alive) setGsc({ status: 'error', report: null, detail: (e as { message?: string }).message || 'Search Console data unavailable.' }) })
    return () => { alive = false }
  }, [website?.id, days, ctx.workspaceId, sites, nonce])

  const report = gsc.report
  const daily = useMemo(() => (report?.dates ?? []).map((r) => ({ date: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })), [report])
  const completedScans = (scans ?? []).filter((s) => s.status === 'completed').slice(0, 8).reverse()
  const counts = queue.rows.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
  const scopedSites = (sites ?? []).filter((s) => !ctx.brandKey || s.brand_key === ctx.brandKey)

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Measure"
        title={<>Results <span className="text-muted-foreground">·</span> {ctx.label}</>}
        lede="What can actually be measured today, each number with its source, period and freshness. Things RockBase does not measure are shown as not measured — never estimated, never zero."
        actions={<Button variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCw />Re-read</Button>}
        meta={<>
          {scopedSites.length > 1 ? <label className="text-xs text-muted-foreground">Website <select aria-label="Website" className="ml-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground" value={website?.id ?? ''} onChange={(e) => setContext({ websiteId: e.target.value })}>{scopedSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            : <span className="text-xs text-muted-foreground">Website: <span className="text-foreground">{website ? new URL(website.base_url).host : sites ? 'none for this brand' : '…'}</span></span>}
        </>}
      />
      {siteError && <Notice tone="error">{siteError}</Notice>}

      {/* Search */}
      <section aria-labelledby="r-search" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5"><SectionTitle id="r-search">Organic search</SectionTitle><SourcePill status={gsc.status} name="Google Search Console" detail={gsc.detail} /></div>
          {report && <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="Period">{([7, 28] as const).map((d) => <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={cn('rounded px-2.5 py-1', days === d ? 'bg-secondary text-foreground' : 'text-muted-foreground')}>{d} days</button>)}</div>}
        </div>
        {report ? (
          <>
            <p className="text-xs text-muted-foreground">{fmt.date(report.periods.current.startDate)} – {fmt.date(report.periods.current.endDate)} compared with {fmt.date(report.periods.previous.startDate)} – {fmt.date(report.periods.previous.endDate)} · {report.mapping.property} · data state “{report.freshness?.dataState ?? 'final'}” ({report.freshness?.timeZone ?? 'America/Los_Angeles'})</p>
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['Clicks', report.totals.current?.clicks, report.totals.previous?.clicks, fmt.n, (c: number, p: number) => `${c - p >= 0 ? '+' : ''}${fmt.n(c - p)}`],
                ['Impressions', report.totals.current?.impressions, report.totals.previous?.impressions, fmt.n, (c: number, p: number) => `${c - p >= 0 ? '+' : ''}${fmt.n(c - p)}`],
                ['CTR', report.totals.current?.ctr, report.totals.previous?.ctr, fmt.pct, (c: number, p: number) => `${c - p >= 0 ? '+' : ''}${((c - p) * 100).toFixed(2)} pp`],
                ['Avg. position', report.totals.current?.position, report.totals.previous?.position, fmt.pos, (c: number, p: number) => `${p - c >= 0 ? '↑' : '↓'} ${Math.abs(c - p).toFixed(1)}`],
              ] as const).map(([label, c, p, f, d]) => (
                <div key={label} className="bg-card p-4">
                  <GradeTag grade="measured">{label}</GradeTag>
                  <p className="font-data mt-2 text-3xl text-foreground">{f(c)}</p>
                  <p className="font-data mt-1 text-[11px] text-muted-foreground">{c != null && p != null ? `${d(c, p)} vs ${f(p)}` : 'No previous period'}</p>
                </div>
              ))}
            </div>
            {daily.length > 0 && (
              <div className="panel p-5">
                <div className="mb-5 flex items-center justify-between gap-3"><p className="text-sm font-medium">Per day</p><button onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Table2 className="h-3.5 w-3.5" />{showTable ? 'Show charts' : 'Show table'}</button></div>
                {showTable ? (
                  <div className="max-h-80 overflow-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Clicks</th><th className="py-2 pr-3 font-medium">Impressions</th><th className="py-2 pr-3 font-medium">CTR</th><th className="py-2 font-medium">Position</th></tr></thead><tbody className="font-data">{daily.map((r) => <tr key={r.date} className="border-t border-border/70"><td className="py-1.5 pr-3">{fmt.date(r.date)}</td><td className="py-1.5 pr-3">{fmt.n(r.clicks)}</td><td className="py-1.5 pr-3">{fmt.n(r.impressions)}</td><td className="py-1.5 pr-3">{fmt.pct(r.ctr)}</td><td className="py-1.5">{fmt.pos(r.position)}</td></tr>)}</tbody></table></div>
                ) : (
                  <div className="grid gap-8 md:grid-cols-2">
                    <div><p className="mb-6 text-xs text-muted-foreground">Clicks</p><DailyBars points={daily.map((r) => ({ date: r.date, value: r.clicks }))} color="var(--chart-1)" label="clicks" /></div>
                    <div><p className="mb-6 text-xs text-muted-foreground">Impressions</p><DailyBars points={daily.map((r) => ({ date: r.date, value: r.impressions }))} color="var(--chart-2)" label="impressions" /></div>
                  </div>
                )}
              </div>
            )}
            {gsc.status === 'stale' && <Notice tone="warn" action={<Button size="sm" variant="outline" asChild><Link to={`/seo?tab=search&site=${website?.id ?? ''}`}>Sync in Site &amp; Search</Link></Button>}>This report is {Math.round(ageDays(report.syncedAt))} days old. Syncing requests fresh data from Google.</Notice>}
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{report.limitations.map((l, i) => <li key={i}>{l}</li>)}<li>Period-over-period changes are not attributed to any specific action or post.</li></ul>
          </>
        ) : gsc.status === 'loading' ? <div className="h-32 animate-pulse rounded-lg bg-secondary/40" /> : (
          <div className="space-y-3">
            <Void reason={gsc.detail || 'Search performance is not available.'} />
            {isLocalMode && gsc.status === 'disconnected' && <Button size="sm" variant="outline" asChild><Link to="/setup/google">Connect Search Console<ArrowRight /></Link></Button>}
            {gsc.status === 'empty' && <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" asChild><Link to={`/seo?tab=search&site=${website?.id ?? ''}`}>Sync in Site &amp; Search</Link></Button><EffectTag effect="google" /></div>}
          </div>
        )}
      </section>

      {/* Site health */}
      <section aria-labelledby="r-site" className="space-y-4">
        <div className="space-y-1.5"><SectionTitle id="r-site">Site health over time</SectionTitle><p className="text-xs text-muted-foreground">From RockBase's own crawls of {website ? new URL(website.base_url).host : 'your site'} — first-party observation, comparable only between crawls with similar limits.</p></div>
        {!website ? <Void reason={sites ? 'No website for this brand yet.' : 'Loading…'} /> : scans === null ? <div className="h-24 animate-pulse rounded-lg bg-secondary/40" /> : completedScans.length === 0 ? <Void reason="No completed crawl yet." /> : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="panel p-5">
              <p className="mb-4 text-xs text-muted-foreground">Issues found per crawl (lower is better)</p>
              <ol className="flex items-end gap-3" style={{ height: 140 }}>
                {completedScans.map((s) => {
                  const max = Math.max(...completedScans.map((x) => x.issues_count), 1)
                  return (
                    <li key={s.id} className="group flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${fmt.dateTime(s.finished_at)} · ${s.issues_count} issues · ${s.pages_count} URLs`}>
                      <span className="font-data text-[11px] text-muted-foreground group-hover:text-foreground">{s.issues_count}</span>
                      <span className="w-full max-w-10 rounded-t-[3px]" style={{ height: `${Math.max(3, (s.issues_count / max) * 100)}%`, background: 'var(--chart-1)' }} />
                      <span className="text-[10px] text-muted-foreground">{fmt.date(s.finished_at)}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
            <dl className="panel grid grid-cols-2 gap-4 p-5 text-sm">
              <div><dt className="text-xs text-muted-foreground">Resolved</dt><dd className="font-data mt-1 text-2xl text-patina">{comparison?.previous_scan_id ? comparison.resolved_issues.length : '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">New</dt><dd className="font-data mt-1 text-2xl">{comparison?.previous_scan_id ? comparison.new_issues.length : '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">URLs added</dt><dd className="font-data mt-1 text-lg">{comparison?.previous_scan_id ? comparison.added_urls.length : '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Not observed</dt><dd className="font-data mt-1 text-lg">{comparison?.previous_scan_id ? comparison.removed_urls.length : '—'}</dd></div>
              <p className="col-span-2 text-[11px] text-muted-foreground">{comparison?.previous_scan_id ? 'Latest crawl vs the one before it.' : comparison?.note || 'A comparison appears after a second crawl.'}</p>
            </dl>
          </div>
        )}
      </section>

      {/* Publishing */}
      <section aria-labelledby="r-pub" className="space-y-4">
        <div className="space-y-1.5"><SectionTitle id="r-pub">Publishing execution</SectionTitle><p className="text-xs text-muted-foreground">Whether posts went out — from RockBase's own queue. This is status, not performance.</p></div>
        {queue.status === 'loading' ? <div className="h-20 animate-pulse rounded-lg bg-secondary/40" /> : queue.status === 'error' ? <Void reason="Queue status could not be read. That is not the same as zero posts." /> : queue.rows.length === 0 ? <Void reason="No posts have been queued." /> : (
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border grid-cols-2 sm:grid-cols-4">
            {([['completed', 'Completed', 'text-patina'], ['queued', 'Queued', 'text-foreground'], ['failed', 'Failed', 'text-oxide'], ['needs_attention', 'Waiting on account', 'text-ochre']] as const).map(([key, label, tone]) => (
              <Link key={key} to="/queue" className="bg-card p-4 hover:bg-secondary/40"><p className="text-xs text-muted-foreground">{label}</p><p className={cn('font-data mt-2 text-2xl', tone)}>{counts[key] ?? 0}</p></Link>
            ))}
          </div>
        )}
      </section>

      {/* Not measured */}
      <section aria-labelledby="r-social" className="space-y-4">
        <SectionTitle id="r-social">Not measured yet</SectionTitle>
        <div className="void grid gap-4 rounded-lg border border-dashed border-border p-5 md:grid-cols-3">
          {['Social reach & impressions', 'Engagement (likes, comments, saves)', 'Revenue & conversions'].map((t) => (
            <div key={t} className="flex items-start gap-2.5"><Mark grade="unavailable" className="mt-1" /><div><p className="text-sm font-medium">{t}</p><p className="mt-0.5 text-xs text-muted-foreground">No connected data source. Not estimated.</p></div></div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">An earlier analytics screen generated these numbers synthetically, so it stays switched off. They'll appear here only once a real source is connected and labelled.</p>
      </section>
    </div>
  )
}
