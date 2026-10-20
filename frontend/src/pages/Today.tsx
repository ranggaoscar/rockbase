import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check, FileText, Globe2, KeyRound, Loader2, PenLine, Plus, Radar, RotateCw, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  EffectTag, GradeLegend, GradeTag, Mark, Notice, SectionTitle, SourceDot, SourcePill, Void, ago, ageDays, fmt, sourceLabel, type SourceStatus,
} from '@/components/growth/grammar'
import { pickSite, useWorkContext } from '@/lib/brandRegistry'
import { isLocalMode } from '@/components/layout/nav'
import { seoApi, setSeoWorkspace, type Comparison, type IssueGroup, type Scan, type Website } from '@/components/seo/api'
import { gscApi, type GscReport, type GscStatus } from '@/components/seo/gscApi'
import { trendsApi, type TrendRadar } from '@/components/trends/api'
import { activityApi } from '@/lib/api'
import { draftHref, formatLabel, loadLibrary, originLabel, scopeDrafts, type LibraryLoad } from '@/lib/drafts'
import { fixItems, radarItems, rankWorkItems, searchItems, type WorkItem } from '@/lib/workQueue'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'
import type { StoneLayer } from '@/components/growth/StoneMonolith'

// WebGL lives in its own chunk so the rest of Today paints first.
const StoneMonolith = lazy(() => import('@/components/growth/StoneMonolith'))

type Load<T> = { status: SourceStatus; data?: T; detail?: string }

interface OpsSummary { accounts: { total: number; ready: number; attention: number; disconnected: number }; campaigns: { active: number; draft: number }; publishingQueue: { queued: number; running: number; delayed: number } }
interface QueueRow { status: string }

const STALE_GSC_DAYS = 7
const errorText = (e: unknown, fallback: string) => {
  const x = e as { response?: { data?: { error?: string; message?: string } }; message?: string }
  return x.response?.data?.error || x.response?.data?.message || x.message || fallback
}


/* ── Data ──────────────────────────────────────────────────────────────── */
function useToday(workspaceId: string, brandKey: string, websiteId: string, ready: boolean) {
  const [site, setSite] = useState<Load<{ website?: Website; scan?: Scan; groups: IssueGroup[]; comparison?: Comparison; sites: Website[] }>>({ status: 'loading' })
  const [gsc, setGsc] = useState<Load<{ status: GscStatus; report: GscReport | null }>>({ status: 'loading' })
  const [radar, setRadar] = useState<Load<TrendRadar>>({ status: 'loading' })
  const [library, setLibrary] = useState<Load<LibraryLoad>>({ status: 'loading' })
  const [ops, setOps] = useState<Load<{ summary: OpsSummary; rows: QueueRow[] | null }>>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!ready) return
    const ctl = new AbortController()
    const alive = () => !ctl.signal.aborted
    setSite({ status: 'loading' }); setGsc({ status: 'loading' }); setRadar({ status: 'loading' }); setLibrary({ status: 'loading' }); setOps({ status: 'loading' })

    // Site crawl → then GSC (needs the website).
    setSeoWorkspace(workspaceId)
    seoApi.websites().then(async ({ data: sites }) => {
      if (!alive()) return
      const website = pickSite(sites, brandKey, websiteId)
      if (!website) { setSite({ status: 'setup', data: { groups: [], sites }, detail: sites.length ? 'No website for this brand' : 'No website added' }); setGsc({ status: isLocalMode ? 'setup' : 'mode', detail: 'Needs a website first' }); return }
      const { data: scans } = await seoApi.scans(website.id)
      const scan = scans.find((s) => s.status === 'completed') ?? scans[0]
      let groups: IssueGroup[] = []; let comparison: Comparison | undefined
      if (scan?.status === 'completed') {
        const [g, c] = await Promise.all([seoApi.issueGroups(scan.id, {}).catch(() => null), seoApi.compare(scan.id).catch(() => null)])
        groups = g?.data.groups ?? []; comparison = c?.data
      }
      if (!alive()) return
      setSite({ status: !scan ? 'empty' : scan.status === 'failed' ? 'error' : ageDays(scan.finished_at || scan.started_at) > 30 ? 'stale' : 'ok', data: { website, scan, groups, comparison, sites }, detail: !scan ? 'No crawl yet' : scan.status === 'completed' ? `Crawled ${ago(scan.finished_at)}` : `Scan ${scan.status}` })

      if (!isLocalMode) { setGsc({ status: 'mode', detail: 'Local Mode only' }); return }
      const { data: status } = await gscApi.status()
      if (!alive()) return
      if (!status.enabled) { setGsc({ status: 'setup', data: { status, report: null }, detail: 'Not enabled on this install' }); return }
      if (!status.connected) { setGsc({ status: 'disconnected', data: { status, report: null }, detail: status.configured ? 'Ready to connect' : 'Optional · not connected' }); return }
      const { data: report } = await gscApi.report(workspaceId, website.id, 28)
      if (!alive()) return
      if (!report) { setGsc({ status: 'empty', data: { status, report }, detail: 'Connected · no synced report' }); return }
      const age = ageDays(report.syncedAt)
      setGsc({ status: age > STALE_GSC_DAYS ? 'stale' : 'ok', data: { status, report }, detail: `Synced ${ago(report.syncedAt)}` })
    }).catch((e) => {
      if (!alive()) return
      setSite({ status: 'error', detail: errorText(e, 'SEO worker unavailable') })
      setGsc((g) => g.status === 'loading' ? { status: 'error', detail: 'Depends on site registry' } : g)
    })

    // Radar (needs a brand, Local Mode).
    if (!isLocalMode) setRadar({ status: 'mode', detail: 'Local Mode only' })
    else if (!brandKey) setRadar({ status: 'setup', detail: 'Pick a brand to see topics' })
    else trendsApi.radar(workspaceId, brandKey, ctl.signal).then(({ data }) => {
      if (!alive()) return
      const fetched = data.source.lastGood?.fetchedAt
      setRadar({ status: !data.candidates.length ? 'empty' : ageDays(fetched) > 2 ? 'stale' : 'ok', data, detail: fetched ? `Feed ${ago(fetched)}` : 'No feed snapshot yet' })
    }).catch((e) => { if (alive()) setRadar({ status: 'error', detail: errorText(e, 'Radar unavailable') }) })

    loadLibrary(workspaceId, isLocalMode, ctl.signal).then((raw) => { const scoped = scopeDrafts(raw.drafts, brandKey).filter((d) => d.status !== 'archived'); const data = { ...raw, drafts: scoped }; if (alive()) setLibrary({ status: data.rockbase === 'error' ? 'error' : data.drafts.length ? 'ok' : 'empty', data, detail: data.rockbaseError }) })

    Promise.all([activityApi.operationsSummary(), activityApi.publishingQueue().then((r) => r.data.rows as QueueRow[]).catch(() => null)])
      .then(([{ data }, rows]) => { if (alive()) setOps({ status: data.accounts.total ? 'ok' : 'empty', data: { summary: data, rows }, detail: data.accounts.total ? `${data.accounts.total} accounts` : 'Optional · no accounts' }) })
      .catch((e) => { if (alive()) setOps({ status: 'error', detail: errorText(e, 'Publishing status unavailable') }) })

    return () => ctl.abort()
  }, [workspaceId, brandKey, websiteId, ready, nonce])

  return { site, gsc, radar, library, ops, reload: () => setNonce((n) => n + 1) }
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function Today() {
  const ctx = useWorkContext()
  const setContext = useAppStore((s) => s.setContext)
  const navigate = useNavigate()
  const ready = ctx.registry.status === 'ready' && Boolean(ctx.workspaceId)
  const { site, gsc, radar, library, ops, reload } = useToday(ctx.workspaceId, ctx.brandKey, ctx.websiteId, ready)
  const [startingBrief, setStartingBrief] = useState('')
  const [briefError, setBriefError] = useState('')

  const queue = useMemo(() => {
    const items: WorkItem[] = []
    const scan = site.data?.scan
    if (site.data?.website && scan?.status === 'completed') items.push(...fixItems(site.data.groups, site.data.website.id, `crawled ${ago(scan.finished_at)}`))
    const report = gsc.data?.report
    if (report && site.data?.website) items.push(...searchItems(report.keywordOpportunities, site.data.website.id, `${fmt.date(report.periods.current.startDate)}–${fmt.date(report.periods.current.endDate)}`, isLocalMode))
    if (radar.data) items.push(...radarItems(radar.data.candidates, radar.data.recommendations))
    return rankWorkItems(items)
  }, [site.data, gsc.data, radar.data])

  const blockers = useMemo(() => {
    const list: Array<{ id: string; title: string; detail: string; to: string; tone: 'warn' | 'error' }> = []
    const s = ops.data?.summary
    if (s?.accounts.attention) list.push({ id: 'accounts', title: `${s.accounts.attention} social account${s.accounts.attention > 1 ? 's' : ''} need session recovery`, detail: 'Posting to these accounts is paused until a session is verified.', to: '/farm', tone: 'error' })
    const rows = ops.data?.rows
    const failed = rows?.filter((r) => r.status === 'failed').length ?? 0
    const attention = rows?.filter((r) => r.status === 'needs_attention').length ?? 0
    if (failed || attention) list.push({ id: 'queue', title: `${failed + attention} publishing item${failed + attention > 1 ? 's' : ''} need review`, detail: `${failed} failed · ${attention} waiting on an account`, to: '/queue', tone: 'warn' })
    if (ops.data && rows === null) list.push({ id: 'queue-unknown', title: 'Queue status could not be read', detail: 'This is not the same as an empty queue. Check again before resubmitting anything.', to: '/queue', tone: 'warn' })
    if (gsc.status === 'stale') list.push({ id: 'gsc', title: 'Search Console data is out of date', detail: `${gsc.detail}. Sync it from Site & Search when you're ready — it requests data from Google.`, to: `/seo?tab=search${site.data?.website ? `&site=${site.data.website.id}` : ''}`, tone: 'warn' })
    if (site.data?.scan?.status === 'failed') list.push({ id: 'scan', title: 'The last crawl failed', detail: site.data.scan.error || 'Open Site & Search to see why and rescan.', to: '/seo', tone: 'error' })
    return list
  }, [ops.data, gsc, site.data])

  async function startBrief(item: WorkItem) {
    const rec = item.primary.recommendation
    if (!rec || startingBrief) return
    setStartingBrief(item.id); setBriefError('')
    try {
      const { data } = await trendsApi.createDraft(ctx.workspaceId, ctx.brandKey, rec.id)
      navigate(rec.format === 'article' ? `/studio/d/${encodeURIComponent(data.draft.id)}?workspace_id=${encodeURIComponent(ctx.workspaceId)}&new=1` : data.composeUrl)
    } catch (e) { setBriefError(errorText(e, 'Could not create the draft.')); setStartingBrief('') }
  }

  const [activeStage, setActiveStage] = useState<number | null>(null)
  const firstRun = site.status === 'setup' && site.data?.sites.length === 0 && library.data?.drafts.length === 0
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const counts = { fix: queue.filter((q) => q.kind === 'fix').length, search: queue.filter((q) => q.kind === 'search').length, radar: queue.filter((q) => q.kind === 'radar').length }
  const anyLoading = [site, gsc, radar, library, ops].some((s) => s.status === 'loading')

  // One slab per stage. Thickness = live volume; null = no source (ghosted, never zero).
  const unknown = (st: SourceStatus) => ['loading', 'error', 'mode', 'setup', 'disconnected'].includes(st)
  const pending = ops.data?.summary.publishingQueue
  const clicks = gsc.data?.report?.totals.current?.clicks
  const stages: Array<StoneLayer & { to: string }> = [
    { key: 'discover', label: 'Discover', tone: '--signal', to: '/trends', value: unknown(radar.status) ? null : radar.data?.candidates.length ?? 0,
      detail: unknown(radar.status) ? radar.detail || sourceLabel(radar.status) : `${radar.data?.candidates.length ?? 0} topics on Radar` },
    { key: 'analyze', label: 'Analyze', tone: '--patina', to: '/seo', value: unknown(site.status) ? null : counts.fix + counts.search,
      detail: unknown(site.status) ? site.detail || sourceLabel(site.status) : `${counts.fix} fixes · ${counts.search} search openings` },
    { key: 'create', label: 'Create', tone: '--chalk', to: '/studio', value: library.status === 'loading' ? null : library.data?.drafts.length ?? 0,
      detail: library.status === 'loading' ? 'Checking' : `${library.data?.drafts.length ?? 0} drafts in Studio` },
    { key: 'publish', label: 'Publish', tone: '--ember', to: '/publish', value: unknown(ops.status) || !pending ? null : pending.queued + pending.running + pending.delayed,
      detail: unknown(ops.status) || !pending ? ops.detail || sourceLabel(ops.status) : `${pending.queued + pending.running + pending.delayed} posts in the queue` },
    { key: 'measure', label: 'Measure', tone: '--ochre', to: '/results', value: clicks ?? null,
      detail: clicks != null ? `${fmt.n(clicks)} search clicks, last 28 days` : gsc.detail || 'Not measured yet' },
  ]
  const top = queue[0]

  const needsYou = (
    <section aria-labelledby="needs-you" className="space-y-3">
              <SectionTitle id="needs-you">Needs you</SectionTitle>
              {blockers.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">{anyLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Checking…</> : <><Check className="h-4 w-4 text-patina" />Nothing blocked in connected sources.</>}</div>
              ) : blockers.map((b) => (
                <Link key={b.id} to={b.to} className={cn('block rounded-md border px-3.5 py-3 transition-colors hover:bg-secondary/40', b.tone === 'error' ? 'border-oxide/30' : 'border-ochre/30')}>
                  <p className={cn('text-sm font-medium', b.tone === 'error' ? 'text-oxide' : 'text-ochre')}>{b.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{b.detail}</p>
                </Link>
              ))}
            </section>
  )


  if (ctx.registry.status === 'error') {
    return <div className="space-y-6"><Greeting date={today} title="RockBase can't reach the brand registry" /><Notice tone="error" action={<Button size="sm" variant="outline" onClick={ctx.registry.retry}><RotateCw className="h-3.5 w-3.5" />Retry</Button>}>{ctx.registry.message} The SEO worker provides the workspace list; check that it is running.</Notice><p className="text-sm text-muted-foreground">Still available without it: <Link to="/studio" className="text-foreground underline">Studio</Link>, <Link to="/publish" className="text-foreground underline">Publish</Link> and <Link to="/queue" className="text-foreground underline">the queue</Link>.</p></div>
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="today-title" className="panel sheen relative overflow-hidden rounded-[28px] px-5 pb-6 pt-7 sm:px-8 lg:grid lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_minmax(340px,500px)] lg:items-center lg:gap-6 lg:px-10 lg:py-10">
        {/* The gallery light falls on the monolith side. */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-40 h-[520px] w-[620px] rounded-full bg-[radial-gradient(closest-side,hsl(var(--signal)/0.12),transparent)]" />
        <div className="relative min-w-0">
          <p className="eyebrow animate-rise">{today}</p>
          <h1 id="today-title" className="font-display mt-3 max-w-[15ch] animate-rise text-[2.4rem] font-semibold leading-[0.98] [animation-delay:60ms] sm:text-[3.25rem] lg:text-[3.6rem]">
            {firstRun ? <>Give {ctx.label} its first insight</> : anyLoading ? <>Reading {ctx.label}</> : queue.length ? <>{queue.length} move{queue.length > 1 ? 's' : ''} worth making for {ctx.label}</> : <>{ctx.label} is all caught up</>}
          </h1>
          {!firstRun && !anyLoading && queue.length > 0 && (
            <p className="mt-4 max-w-md animate-rise text-[15px] leading-relaxed text-muted-foreground [animation-delay:120ms]">
              {[counts.fix && `${counts.fix} site fix${counts.fix > 1 ? 'es' : ''}`, counts.search && `${counts.search} search opening${counts.search > 1 ? 's' : ''}`, counts.radar && `${counts.radar} Radar topic${counts.radar > 1 ? 's' : ''}`].filter(Boolean).join(', ')}{blockers.length ? `, and ${blockers.length} thing${blockers.length > 1 ? 's' : ''} waiting on you.` : '.'}
            </p>
          )}

          {top ? (
            <div className="sheen-edge mt-7 max-w-lg animate-rise rounded-2xl border border-border bg-background/45 p-4 [animation-delay:180ms]">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><GradeTag grade={top.grade} /><span>Top move · {top.source}</span></div>
              <p className="mt-2 font-medium leading-snug">{top.title}</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                {top.primary.recommendation ? (
                  <Button size="sm" disabled={Boolean(startingBrief)} onClick={() => startBrief(top)}>{startingBrief === top.id ? <Loader2 className="animate-spin" /> : <PenLine />}{top.primary.label}</Button>
                ) : <Button size="sm" asChild><Link to={top.primary.to!}>{top.primary.label}<ArrowRight /></Link></Button>}
                {top.primary.effect ? <EffectTag effect={top.primary.effect}>Creates a draft, no posting</EffectTag> : <a href="#next-up" className="text-xs text-muted-foreground hover:text-foreground">See all {queue.length}</a>}
              </div>
            </div>
          ) : !anyLoading && (
            <div className="mt-7 flex animate-rise flex-wrap gap-3 [animation-delay:180ms]">
              <Button asChild><Link to="/studio?new=1"><Plus />New draft</Link></Button>
              {isLocalMode && <Button variant="outline" asChild><Link to="/trends"><Radar />Open Radar</Link></Button>}
            </div>
          )}
        </div>

        <div className="relative mt-6 lg:mt-0">
          <Suspense fallback={<div className="h-[300px] sm:h-[380px] lg:h-[420px]" />}>
            <StoneMonolith className="h-[300px] sm:h-[380px] lg:h-[420px]" layers={stages} active={activeStage} onActive={setActiveStage} onSelect={(i) => navigate(stages[i].to)} />
          </Suspense>
          <ul aria-label="Growth stages" className="relative mt-1 grid grid-cols-5 gap-1 sm:gap-1.5">
            {stages.map((st, i) => (
              <li key={st.key}>
                <Link to={st.to} onMouseEnter={() => setActiveStage(i)} onMouseLeave={() => setActiveStage(null)} onFocus={() => setActiveStage(i)} onBlur={() => setActiveStage(null)}
                  aria-label={`${st.label}: ${st.detail}`} title={st.detail}
                  className={cn('block rounded-xl border px-1.5 py-2 text-center transition-[background-color,border-color] duration-200 sm:px-2', activeStage === i ? 'border-[hsl(var(--line-strong))] bg-secondary/70' : 'border-transparent hover:bg-secondary/40')}>
                  <span className="mx-auto block h-1 w-5 rounded-full" style={{ background: `hsl(var(${st.tone}) / ${st.value == null ? 0.25 : 1})` }} />
                  <span className="font-data mt-1.5 block text-[15px] font-semibold text-foreground">{st.value == null ? '—' : fmt.n(st.value)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{st.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/80">Drag to turn. Select a layer to open it. Dimmed layers have no data source yet.</p>
        </div>
      </section>

      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="eyebrow">Sources</span>
        <SourcePill status={site.status} name="Site crawl" detail={site.detail} />
        <SourcePill status={gsc.status} name="Search Console" detail={gsc.detail} />
        <SourcePill status={radar.status} name="Radar" detail={radar.detail} />
        <SourcePill status={ops.status} name="Publishing" detail={ops.detail} />
        <button onClick={reload} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Reload sources"><RotateCw className="h-3 w-3" />Re-read</button>
      </div>

      {firstRun ? <FirstRun brandName={ctx.label} /> : (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="next-up" className="min-w-0 space-y-4">
            {blockers.length > 0 && <div className="mb-8 xl:hidden">{needsYou}</div>}
            <SectionTitle id="next-up" aside={<GradeLegend className="hidden md:flex" />}>Next up</SectionTitle>
            {briefError && <Notice tone="error">{briefError}</Notice>}
            {queue.length === 0 ? (
              anyLoading ? <SkeletonRows /> : <div className="panel-quiet px-5 py-8 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No open findings from the sources that are connected.</p>
                <p className="mt-1">That only covers what's listed above as current. {site.status !== 'ok' && 'Run a crawl, '} {isLocalMode && gsc.status !== 'ok' && 'connect Search Console, '}or add Radar topics to widen what RockBase can see.</p>
              </div>
            ) : (
              <ol className="panel divide-y divide-border overflow-hidden rounded-2xl">
                {queue.map((item, index) => (
                  <li key={item.id} className="row-hover sheen group grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:px-5">
                    <span className="font-data pt-0.5 text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><GradeTag grade={item.grade} /><span className="text-[11px] text-muted-foreground">{item.source}</span>{item.alsoIn && <span className="text-[11px] text-patina/80">{item.alsoIn}</span>}</div>
                      <p className="mt-1.5 font-medium leading-snug text-foreground">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{item.why}</p>
                    </div>
                    <div className="col-start-2 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:flex-col sm:items-end sm:justify-center">
                      {item.primary.recommendation ? (
                        <Button size="sm" variant="outline" disabled={Boolean(startingBrief)} onClick={() => startBrief(item)}>
                          {startingBrief === item.id ? <Loader2 className="animate-spin" /> : <PenLine />}{item.primary.label}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" asChild><Link to={item.primary.to!}>{item.primary.label}<ArrowRight /></Link></Button>
                      )}
                      {item.primary.effect ? <EffectTag effect={item.primary.effect}>Creates a draft · no posting</EffectTag> : item.secondary ? <Link to={item.secondary.to} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">{item.secondary.label}</Link> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <MeasureStrip site={site} gsc={gsc} ops={ops} />
          </section>

          <aside className="min-w-0 space-y-8">
            <div className="hidden xl:block">{needsYou}</div>

            <section aria-labelledby="continue" className="space-y-3">
              <SectionTitle id="continue" aside={<Link to="/studio" className="hover:text-foreground">Studio <ArrowUpRight className="inline h-3 w-3" /></Link>}>Continue</SectionTitle>
              {library.status === 'loading' ? <SkeletonRows rows={2} /> : !library.data?.drafts.length ? (
                <div className="text-sm text-muted-foreground"><p>No drafts yet.</p><Link to="/studio?new=1" className="mt-2 inline-flex items-center gap-1 text-patina hover:underline"><Plus className="h-3.5 w-3.5" />Start a blank draft</Link></div>
              ) : (
                <ul className="space-y-1">
                  {library.data.drafts.slice(0, 4).map((d) => (
                    <li key={d.key}>
                      <Link to={draftHref(d, ctx.workspaceId)} className="row-hover -mx-2 flex items-start gap-3 rounded-md px-2 py-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{d.title}</span><span className="block truncate text-[11px] text-muted-foreground">{formatLabel[d.format]} · {originLabel[d.origin]} · {d.store === 'browser' ? <span className="text-ochre">this browser</span> : 'RockBase'}{d.updatedAt && ` · ${ago(d.updatedAt)}`}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {library.status === 'error' && <p className="text-[11px] text-oxide">RockBase drafts unavailable: {library.detail}</p>}
            </section>

            <section aria-labelledby="scope" className="space-y-3">
              <SectionTitle id="scope">In scope</SectionTitle>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Brand</dt><dd className="truncate text-right">{ctx.brand?.name ?? 'Whole workspace'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Workspace</dt><dd className="truncate text-right">{ctx.workspace?.name ?? '—'}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Website</dt><dd className="min-w-0 text-right">
                  {(site.data?.sites.filter((s) => !ctx.brandKey || s.brand_key === ctx.brandKey).length ?? 0) > 1 ? (
                    <select aria-label="Website in scope" className="max-w-[12rem] truncate rounded border border-border bg-background px-1.5 py-0.5 text-sm" value={site.data?.website?.id ?? ''} onChange={(e) => setContext({ websiteId: e.target.value })}>
                      {site.data!.sites.filter((s) => !ctx.brandKey || s.brand_key === ctx.brandKey).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : <span className="truncate">{site.data?.website ? new URL(site.data.website.base_url).host : '—'}</span>}
                </dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Search period</dt><dd className="text-right">{gsc.data?.report ? `${fmt.date(gsc.data.report.periods.current.startDate)} – ${fmt.date(gsc.data.report.periods.current.endDate)}` : '—'}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

function Greeting({ date, title, summary }: { date: string; title: React.ReactNode; summary?: string }) {
  return (
    <header className="max-w-3xl">
      <p className="eyebrow">{date}</p>
      <h1 className="font-display mt-2 text-[2rem] font-semibold leading-[1.05] tracking-tight md:text-[2.75rem]">{title}</h1>
      {summary && <p className="mt-3 text-sm text-muted-foreground">{summary}</p>}
    </header>
  )
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-2" aria-busy>{Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-md bg-secondary/40" />)}</div>
}

/* What's measured right now — never mixes execution status with outcomes. */
function MeasureStrip({ site, gsc, ops }: { site: Load<{ scan?: Scan; comparison?: Comparison }>; gsc: Load<{ report: GscReport | null }>; ops: Load<{ summary: OpsSummary; rows: QueueRow[] | null }> }) {
  const report = gsc.data?.report
  const cur = report?.totals.current, prev = report?.totals.previous
  const scan = site.data?.scan, cmp = site.data?.comparison
  const rows = ops.data?.rows
  return (
    <section aria-labelledby="measured" className="space-y-3 pt-6">
      <SectionTitle id="measured" aside={<Link to="/results" className="hover:text-foreground">All results <ArrowUpRight className="inline h-3 w-3" /></Link>}>Measured so far</SectionTitle>
      <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><Mark grade={cur ? 'measured' : 'unavailable'} /><span className="text-xs text-muted-foreground">Search clicks</span></div>
          {cur ? <>
            <p className="font-data mt-2 text-2xl text-foreground">{fmt.n(cur.clicks)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{prev ? `${cur.clicks - prev.clicks >= 0 ? '+' : ''}${fmt.n(cur.clicks - prev.clicks)} vs previous period` : 'No previous period'} · {fmt.date(report!.periods.current.startDate)}–{fmt.date(report!.periods.current.endDate)}</p>
          </> : <p className="mt-2 text-xs text-muted-foreground">{gsc.status === 'mode' ? 'Search Console runs in Local Mode only.' : gsc.status === 'loading' ? 'Checking…' : gsc.detail || 'Not available'}</p>}
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><Mark grade={scan?.status === 'completed' ? 'measured' : 'unavailable'} /><span className="text-xs text-muted-foreground">Site issues</span></div>
          {scan?.status === 'completed' ? <>
            <p className="font-data mt-2 text-2xl text-foreground">{fmt.n(scan.issues_count)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{cmp?.previous_scan_id ? `${cmp.resolved_issues.length} resolved · ${cmp.new_issues.length} new since last crawl` : 'First crawl — no baseline yet'}</p>
          </> : <p className="mt-2 text-xs text-muted-foreground">{site.status === 'loading' ? 'Checking…' : 'No completed crawl'}</p>}
        </div>
        <div className="bg-card p-4">
          <div className="flex items-center gap-2"><Mark grade={rows ? 'measured' : 'unavailable'} /><span className="text-xs text-muted-foreground">Posts executed</span></div>
          {rows && rows.length ? <>
            <p className="font-data mt-2 text-2xl text-foreground">{rows.filter((r) => r.status === 'completed').length}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Execution status only — not reach or engagement</p>
          </> : <p className="mt-2 text-xs text-muted-foreground">{ops.status === 'loading' ? 'Checking…' : rows === null ? 'Queue status unavailable — not zero' : 'No publishing activity'}</p>}
        </div>
      </div>
      <Void compact reason="Social reach, engagement and revenue are not measured by RockBase yet. They are never estimated." />
    </section>
  )
}

/* First run: SEO/content value without any social setup. */
function FirstRun({ brandName }: { brandName: string }) {
  const steps = [
    { icon: Globe2, title: 'Add your website', body: 'RockBase crawls up to 100 pages and turns problems into fix steps. Nothing is changed on your site.', to: '/seo?add=1', cta: 'Add website', effect: 'crawl' as const },
    { icon: KeyRound, title: 'Connect Search Console', body: 'Optional. Read-only Google data shows which queries are close to page one. Stays on this machine.', to: '/setup/google', cta: isLocalMode ? 'Connect' : 'Local Mode only', effect: 'google' as const, disabled: !isLocalMode },
    { icon: Radar, title: 'Tell Radar what you care about', body: 'List a few topics. Radar labels what is measured, merely observed, or just an idea.', to: '/trends', cta: isLocalMode ? 'Set topics' : 'Local Mode only', effect: 'network' as const, disabled: !isLocalMode },
    { icon: PenLine, title: 'Or just start writing', body: 'No data needed. Draft an article brief or a caption and keep it in Studio.', to: '/studio?new=1', cta: 'New draft', effect: 'local' as const },
  ]
  return (
    <section className="space-y-6">
      <div className="strata w-40" />
      <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
        {steps.map((s, i) => {
          const Icon = s.icon
          return (
            <li key={s.title} className="flex flex-col gap-3 bg-card p-5">
              <div className="flex items-center gap-3"><span className="font-data text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><Icon className="h-4 w-4 text-patina" /><p className="font-medium">{s.title}</p></div>
              <p className="text-sm text-muted-foreground">{s.body}</p>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                {s.disabled ? <Button size="sm" variant="outline" disabled>{s.cta}</Button> : <Button size="sm" variant={i === 0 ? 'default' : 'outline'} asChild><Link to={s.to}>{s.cta}<ArrowRight /></Link></Button>}
                <EffectTag effect={s.effect} />
              </div>
            </li>
          )
        })}
      </ol>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><SendHorizontal className="h-3.5 w-3.5" />Social publishing is optional for {brandName}. Connect accounts in <Link to="/setup" className="underline">Setup</Link> only when you need them.<SourceDot status="empty" /></p>
    </section>
  )
}
