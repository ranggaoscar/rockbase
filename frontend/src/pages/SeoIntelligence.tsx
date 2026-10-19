import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, ChevronRight, ExternalLink, Globe2, Loader2, Play, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { seoApi, setSeoWorkspace, type Brand, type Comparison, type Issue, type IssueGroups, type LinkGraph, type PageRecord, type Scan, type Website } from '@/components/seo/api'
import GscIntelligence from '@/components/seo/GscIntelligence'
import SeoGraph from '@/components/seo/SeoGraph'
import SeoActions from '@/components/seo/SeoActions'
import { EffectTag, GradeTag, Notice, PageHeader, SectionTitle, Void, ago } from '@/components/growth/grammar'
import { pickSite, useWorkContext } from '@/lib/brandRegistry'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

const active = (status?: string) => status === 'queued' || status === 'running'
const dateLabel = (date?: string | null, compact = false) => date ? compact ? new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(date).toLocaleString() : '—'
const priorityVariant = (priority: string) => priority === 'high' ? 'error' : priority === 'medium' ? 'warning' : 'outline'
const asCount = (record: Record<string, number> | undefined, key: string) => record?.[key] ?? 0

type Tab = 'fixes' | 'search' | 'urls' | 'issues' | 'links' | 'history'
const tabs: Array<[Tab, string]> = [['fixes', 'Fixes'], ['search', 'Search performance'], ['urls', 'Pages'], ['issues', 'All issues'], ['links', 'Links'], ['history', 'Crawl history']]

export default function SeoIntelligence() {
  const ctx = useWorkContext()
  const setContext = useAppStore((s) => s.setContext)
  const [params, setParams] = useSearchParams()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loadError, setLoadError] = useState('')
  const [websites, setWebsites] = useState<Website[]>([])
  const [scans, setScans] = useState<Scan[]>([])
  const [scansLoaded, setScansLoaded] = useState(false)
  const [scanId, setScanId] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [pages, setPages] = useState<PageRecord[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [graph, setGraph] = useState<LinkGraph | null>(null)
  const [issueGroups, setIssueGroups] = useState<IssueGroups | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedPage, setSelectedPage] = useState<PageRecord | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [showAdd, setShowAdd] = useState(params.get('add') === '1')
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [brandKey, setBrandKey] = useState('none')
  const [maxUrls, setMaxUrls] = useState('100')
  const [mode, setMode] = useState<Scan['mode']>('auto')
  const pollRef = useRef<number | undefined>(undefined)

  const workspaceId = ctx.workspaceId
  const tab = (tabs.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'fixes') as Tab
  const focusCode = params.get('focus') ?? ''
  const scoped = useMemo(() => ctx.brandKey ? websites.filter((s) => s.brand_key === ctx.brandKey) : websites, [websites, ctx.brandKey])
  const selectedWebsite = pickSite(websites, ctx.brandKey, params.get('site') || ctx.websiteId)
  const websiteId = selectedWebsite?.id ?? ''

  const setTab = (next: Tab) => { const p = new URLSearchParams(params); p.set('tab', next); p.delete('focus'); setParams(p, { replace: true }) }
  const chooseSite = (id: string) => { setContext({ websiteId: id }); const p = new URLSearchParams(params); p.delete('site'); setParams(p, { replace: true }) }

  const loadWebsites = useCallback(async () => {
    const [siteResponse, brandResponse] = await Promise.all([seoApi.websites(), seoApi.brands()])
    setWebsites(siteResponse.data); setBrands(brandResponse.data)
    return siteResponse.data
  }, [])
  const loadScans = useCallback(async (forWebsite: string, preferredScan?: string) => {
    if (!forWebsite) { setScans([]); setScanId(''); setScan(null); return }
    const response = await seoApi.scans(forWebsite)
    setScans(response.data)
    setScanId(preferredScan && response.data.some((item) => item.id === preferredScan) ? preferredScan : response.data[0]?.id ?? '')
  }, [])

  // Workspace follows the brand context. Changing it clears everything scoped to the old one.
  useEffect(() => {
    if (ctx.registry.status === 'loading') return
    let cancelled = false
    setSeoWorkspace(workspaceId)
    setLoading(true); setLoadError('')
    setScanId(''); setScan(null); setPages([]); setIssues([]); setGraph(null); setIssueGroups(null); setSelectedPage(null); setSelectedIssue(null)
    loadWebsites().catch(() => { if (!cancelled) { setLoadError('SEO worker unavailable. Check the backend and run modules/seo/SETUP_SEO.bat if this is the first installation.'); toast.error('SEO workspace could not be loaded') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, ctx.registry.status, loadWebsites])

  useEffect(() => {
    let cancelled = false
    setScansLoaded(false)
    if (!websiteId) { setScans([]); setScanId(''); return }
    seoApi.scans(websiteId).then(({ data }) => { if (!cancelled) { setScans(data); setScanId((old) => data.some((item) => item.id === old) ? old : data[0]?.id ?? ''); setScansLoaded(true) } })
      .catch(() => { if (!cancelled) toast.error('Scan history could not be loaded') })
    return () => { cancelled = true }
  }, [websiteId])

  useEffect(() => {
    setSelectedPage(null); setSelectedIssue(null)
    if (!scanId) { setScan(null); setPages([]); setIssues([]); setComparison(null); setGraph(null); setIssueGroups(null); setEvidenceLoading(false); return }
    let cancelled = false
    const requestWorkspace = workspaceId
    setGraph(null); setIssueGroups(null); setEvidenceLoading(true)
    Promise.all([seoApi.scan(scanId), seoApi.pages(scanId, { q: query || undefined, status: statusFilter === 'all' ? undefined : statusFilter }), seoApi.issues(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority }), seoApi.compare(scanId)])
      .then(([a, b, c, d]) => { if (!cancelled && requestWorkspace === workspaceId) { setScan(a.data); setPages(b.data); setIssues(c.data); setComparison(d.data) } })
      .catch(() => { if (!cancelled) toast.error('Scan details could not be loaded') })
    Promise.all([seoApi.graph(scanId), seoApi.issueGroups(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority })])
      .then(([g, groups]) => { if (!cancelled && requestWorkspace === workspaceId) { setGraph(g.data); setIssueGroups(groups.data) } })
      .catch(() => { if (!cancelled && requestWorkspace === workspaceId) { setGraph(null); setIssueGroups(null) } })
      .finally(() => { if (!cancelled && requestWorkspace === workspaceId) setEvidenceLoading(false) })
    return () => { cancelled = true }
  }, [scanId, query, priority, statusFilter, workspaceId])

  useEffect(() => {
    window.clearInterval(pollRef.current)
    if (!scanId || !active(scan?.status)) return
    let cancelled = false
    pollRef.current = window.setInterval(async () => {
      try {
        const { data } = await seoApi.scan(scanId); if (cancelled) return
        const [p, i] = await Promise.all([seoApi.pages(scanId, { q: query || undefined, status: statusFilter === 'all' ? undefined : statusFilter }), seoApi.issues(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority })])
        if (cancelled) return
        setPages(p.data); setIssues(i.data)
        if (!active(data.status)) {
          const [g, groups, comparisonResponse] = await Promise.all([seoApi.graph(scanId), seoApi.issueGroups(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority }), seoApi.compare(scanId)])
          if (cancelled) return
          setGraph(g.data); setIssueGroups(groups.data); setComparison(comparisonResponse.data); setEvidenceLoading(false); setScan(data)
          await loadScans(websiteId, scanId); if (cancelled) return
          toast.success(data.status === 'completed' ? 'Scan completed' : `Scan ${data.status}`)
        } else setScan(data)
      } catch { /* retain last known scan state; next poll retries */ }
    }, 2500)
    return () => { cancelled = true; window.clearInterval(pollRef.current) }
  }, [scanId, scan?.status, websiteId, loadScans, query, priority, statusFilter])

  const startScan = async () => {
    if (!websiteId) return
    const limit = Math.max(1, Math.min(100, Number(maxUrls) || 100))
    setBusy(true)
    try { const { data } = await seoApi.startScan(websiteId, { max_urls: limit, mode }); setScans((old) => [data, ...old.filter((item) => item.id !== data.id)]); setScanId(data.id); toast.success('Scan queued') }
    catch (error: any) { toast.error(error?.response?.status === 409 ? 'A scan is already active' : error?.response?.data?.detail || 'Could not start scan') }
    finally { setBusy(false) }
  }
  const addWebsite = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true)
    try {
      const body: { name: string; base_url: string; brand_key?: string } = { name: siteName.trim(), base_url: siteUrl.trim() }
      if (brandKey !== 'none') body.brand_key = brandKey
      const { data } = await seoApi.addWebsite(body); await loadWebsites()
      if (data.brand_key && data.brand_key !== ctx.brandKey) setContext({ workspaceId, brandKey: data.brand_key, websiteId: data.id })
      else if (!data.brand_key && ctx.brandKey) setContext({ workspaceId, brandKey: '', websiteId: data.id })
      else setContext({ websiteId: data.id })
      closeAdd(); setSiteName(''); setSiteUrl(''); setBrandKey('none'); toast.success('Website added')
    } catch (error: any) { toast.error(error?.response?.data?.detail || 'Could not add website') }
    finally { setBusy(false) }
  }
  const closeAdd = () => { setShowAdd(false); if (params.get('add')) { const p = new URLSearchParams(params); p.delete('add'); setParams(p, { replace: true }) } }
  const download = async (kind: 'issues' | 'pages' | 'links' | 'issue-groups' | 'actions', format: 'csv' | 'json', filters?: { category: string; confidence: string; issue_type: string }) => {
    if (!scanId) return
    try {
      const { data, headers } = await seoApi.export(scanId, { kind, format, q: query || undefined, priority: (kind === 'issues' || kind === 'actions' || kind === 'issue-groups') && priority !== 'all' ? priority : undefined, status: kind === 'pages' && statusFilter !== 'all' ? statusFilter : undefined, category: filters?.category !== 'all' ? filters?.category : undefined, confidence: filters?.confidence !== 'all' ? filters?.confidence : undefined, issue_type: filters?.issue_type !== 'all' ? filters?.issue_type : undefined })
      const contentType = headers['content-type']
      const blob = new Blob([data], { type: typeof contentType === 'string' ? contentType : format === 'csv' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `seo-${kind}-${scanId}.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch { toast.error('Export failed') }
  }

  useEffect(() => { if (params.get('add') === '1') setShowAdd(true) }, [params])

  const indexable = scan?.summary?.indexable_count ?? pages.filter((page) => page.indexable).length
  const completion = scan ? Math.min(100, Math.round((scan.pages_count / Math.max(scan.max_urls, 1)) * 100)) : 0
  const issueCounts = useMemo(() => ({ high: asCount(scan?.summary?.priority_counts, 'high'), medium: asCount(scan?.summary?.priority_counts, 'medium'), low: asCount(scan?.summary?.priority_counts, 'low') }), [scan])
  const delta = (name: keyof Pick<Comparison, 'added_urls' | 'removed_urls' | 'changed_urls'>) => comparison?.[name]?.length ?? 0
  const crawled = Object.entries(scan?.summary?.status_counts || {}).filter(([status]) => status !== 'not_fetched').reduce((total, [, count]) => total + count, 0)
  const brandLabel = (site: Website) => brands.find((b) => b.key && b.key === site.brand_key)?.name || site.brand_key || 'No brand'
  const host = selectedWebsite ? (() => { try { return new URL(selectedWebsite.base_url).host } catch { return selectedWebsite.base_url } })() : ''
  const crawlKnown = scansLoaded && (!scanId || Boolean(scan))
  const workspaceBrands = brands.filter((brand) => brand.key && brand.workspace_id === workspaceId)

  const scanControl = (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Scan settings" disabled={!websiteId}><Settings2 /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 space-y-3 p-3">
            <div className="space-y-1.5"><Label htmlFor="seo-mode" className="text-xs">Crawl mode</Label><select id="seo-mode" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as Scan['mode'])}><option value="auto">Auto · recommended</option><option value="http">HTTP</option><option value="browser">Browser</option></select></div>
            <div className="space-y-1.5"><Label htmlFor="seo-max-urls" className="text-xs">URL limit (max 100)</Label><Input id="seo-max-urls" type="number" min={1} max={100} value={maxUrls} onChange={(e) => setMaxUrls(e.target.value)} /></div>
            <p className="text-[11px] text-muted-foreground">Crawling respects robots.txt and origin limits.</p>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button disabled={!websiteId || busy || active(scan?.status) || !crawlKnown} onClick={startScan} aria-label="Start SEO scan">{active(scan?.status) ? <Loader2 className="animate-spin" /> : <Play />}{busy ? 'Starting…' : active(scan?.status) ? 'Scan running' : !crawlKnown ? 'Scan' : scan ? 'Rescan' : 'Start first scan'}</Button>
      </div>
      <EffectTag effect="crawl">Crawls up to {Math.max(1, Math.min(100, Number(maxUrls) || 100))} pages · {mode}</EffectTag>
    </div>
  )

  return (
    <div className="space-y-8">
      {loadError && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => window.location.reload()}>Retry</Button>}>{loadError}</Notice>}

      <PageHeader
        eyebrow="Analyze · Site & Search"
        title={selectedWebsite ? selectedWebsite.name : 'Site & Search'}
        lede={selectedWebsite ? undefined : 'Technical health from RockBase\'s own crawl, and search performance from Google — for the website in scope.'}
        meta={selectedWebsite && <>
          <a href={selectedWebsite.base_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{host}<ExternalLink className="h-3 w-3" /></a>
          <span className="text-xs text-muted-foreground">Brand: <span className="text-foreground">{brandLabel(selectedWebsite)}</span></span>
          <span className="text-xs text-muted-foreground">{!crawlKnown ? 'Checking crawl history…' : scan ? scan.status === 'completed' ? `Crawled ${ago(scan.finished_at)} · ${scan.pages_count} URLs · ${scan.mode}` : `Scan ${scan.status}` : 'Not crawled yet'}</span>
          {scoped.length > 1 && <label className="text-xs text-muted-foreground">Site <select aria-label="Website" className="ml-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground" value={websiteId} onChange={(e) => chooseSite(e.target.value)}>{scoped.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" />Add website</button>
        </>}
        actions={selectedWebsite ? scanControl : undefined}
      />

      {!loading && !loadError && websites.length === 0 ? (
        <div className="panel grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div><Globe2 className="h-5 w-5 text-patina" /><p className="font-display mt-3 text-xl font-semibold">Add a website to see what's worth fixing</p><p className="mt-1 max-w-xl text-sm text-muted-foreground">RockBase crawls up to 100 pages, groups problems into fix steps and compares each crawl with the last. No sample audit data is ever shown.</p></div>
          <Button onClick={() => setShowAdd(true)}><Plus />Add website</Button>
        </div>
      ) : !loading && !selectedWebsite && websites.length > 0 ? (
        <div className="panel space-y-3 p-6">
          <p className="font-medium">No website is registered for {ctx.brand?.name ?? 'this brand'}.</p>
          <p className="text-sm text-muted-foreground">Sites are kept per brand so one brand's results never appear under another's name.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setBrandKey(ctx.brandKey || 'none'); setShowAdd(true) }}><Plus />Add a website for {ctx.brand?.name ?? 'this brand'}</Button><Button size="sm" variant="outline" onClick={() => setContext({ brandKey: '' })}>Show whole workspace</Button></div>
        </div>
      ) : selectedWebsite && (
        <>
          {active(scan?.status) && scan && (
            <div className="panel border-patina/30 p-4">
              <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin text-patina" />Scan {scan.status === 'queued' ? 'queued' : 'in progress'}</span><span className="font-data text-xs text-muted-foreground">{scan.pages_count} / {scan.max_urls} URLs</span></div>
              <Progress value={completion} className="mt-3" />
              <p className="mt-2 text-xs text-muted-foreground">Live status refreshes automatically. Crawling observes robots and origin limits.</p>
            </div>
          )}

          {scan && (
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border grid-cols-2 lg:grid-cols-4">
              <Metric label="URLs crawled" value={crawled} note={`${scan.pages_count} records · ${scan.summary?.discovered_count ?? '—'} discovered`} />
              <Metric label="Issues" value={scan.issues_count} note={`${issueCounts.high} high · ${issueCounts.medium} medium · ${issueCounts.low} low`} tone={issueCounts.high ? 'text-oxide' : undefined} />
              <Metric label="Indexable potential" value={indexable} note="Eligibility only — not Google index evidence" />
              <Metric label="Since last crawl" value={comparison?.previous_scan_id ? `${comparison.resolved_issues.length}↓ ${comparison.new_issues.length}↑` : '—'} note={comparison?.previous_scan_id ? 'issues resolved / new' : 'No baseline yet'} />
            </div>
          )}
          {scan?.error && <Notice tone="error"><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{scan.error}</span></Notice>}
          {!!scan?.summary?.warnings?.length && <Notice tone="warn"><p className="font-medium">Coverage notes</p><ul className="mt-1 list-inside list-disc text-xs">{scan.summary.warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul></Notice>}

          <nav aria-label="Site & Search sections" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
            {tabs.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} className={cn('shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors', tab === key ? 'border-patina text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {label}{key === 'fixes' && issueGroups ? <span className="font-data ml-1.5 text-[11px] opacity-60">{issueGroups.groups.length}</span> : key === 'urls' ? <span className="font-data ml-1.5 text-[11px] opacity-60">{pages.length}</span> : key === 'issues' ? <span className="font-data ml-1.5 text-[11px] opacity-60">{issues.length}</span> : null}
              </button>
            ))}
          </nav>

          {tab === 'search' ? <GscIntelligence website={selectedWebsite} workspaceId={workspaceId || selectedWebsite.workspace_id || ''} />
            : !crawlKnown ? <div className="h-48 animate-pulse rounded-lg bg-secondary/40" aria-busy />
            : !scan ? (
              <div className="panel-quiet flex flex-col items-start gap-3 px-6 py-8">
                <p className="font-medium">No crawl results yet for {selectedWebsite.name}.</p>
                <p className="text-sm text-muted-foreground">Start a scan to see real fix steps for this site. Search performance is available in its own tab without a crawl.</p>
                {scanControl}
              </div>
            ) : (
              <>
                {(tab === 'urls' || tab === 'issues' || tab === 'fixes') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[220px] flex-1"><Input aria-label="Search URLs and issues" placeholder="Search URL, title, issue…" value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search />} /></div>
                    {tab === 'urls' && <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Filter URLs by HTTP status" className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="2xx">2xx success</SelectItem><SelectItem value="3xx">3xx redirect</SelectItem><SelectItem value="4xx">4xx client error</SelectItem><SelectItem value="5xx">5xx server error</SelectItem></SelectContent></Select>}
                    <Select value={priority} onValueChange={setPriority}><SelectTrigger aria-label="Filter issues by priority" className="w-40"><SelectValue placeholder="All priorities" /></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
                    {(tab === 'urls' || tab === 'issues') && <><Button size="sm" variant="outline" onClick={() => download(tab === 'urls' ? 'pages' : 'issues', 'csv')}><ArrowDownToLine />CSV</Button><Button size="sm" variant="outline" onClick={() => download(tab === 'urls' ? 'pages' : 'issues', 'json')}><ArrowDownToLine />JSON</Button></>}
                  </div>
                )}

                {tab === 'fixes' && <div className="min-w-0"><SeoActions key={`${workspaceId}:${scanId}:${focusCode}`} focusCode={focusCode} groups={issueGroups?.groups ?? null} loading={evidenceLoading} note={issueGroups?.note} coverage={issueGroups?.coverage} onExport={(kind, format, filters) => download(kind, format, filters)} onSelectUrl={(url) => { const page = pages.find((item) => item.url === url || item.final_url === url); if (page) setSelectedPage(page); else { const issue = issues.find((item) => item.url === url); if (issue) setSelectedIssue(issue) } }} /><p className="mt-4 text-xs text-muted-foreground">Fixed something? Make the change on your site, then <button className="underline" onClick={startScan} disabled={busy || active(scan?.status)}>rescan</button> — the next crawl shows what was resolved.</p></div>}

                {tab === 'links' && <div key={`${workspaceId}:${scanId}`} className="min-w-0"><SeoGraph graph={graph} loading={evidenceLoading} query={query} onExport={(format) => download('links', format)} onSelectUrl={(url) => { const page = pages.find((item) => item.url === url || item.final_url === url); if (page) setSelectedPage(page) }} /></div>}

                {tab === 'urls' && (
                  <div className="panel overflow-x-auto">
                    <table className="w-full min-w-[780px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">URL</th><th className="px-4 py-3 font-medium">HTTP</th><th className="px-4 py-3 font-medium">Title</th><th className="px-4 py-3 font-medium">Indexability</th><th className="px-4 py-3 font-medium">Mode</th><th className="px-4 py-3" /></tr></thead>
                      <tbody>{pages.map((page) => <tr key={page.id} className="row-hover border-b border-border/70 last:border-0"><td className="max-w-[300px] truncate px-4 py-3" title={page.url}>{page.url}</td><td className="px-4 py-3"><Badge variant={page.status_code && page.status_code < 400 ? 'success' : 'error'}>{page.status_code ?? 'ERR'}</Badge>{(page.first_status_code != null || page.final_status_code != null) && <span className="font-data ml-1 text-xs text-muted-foreground">{page.first_status_code ?? 'Unknown'} → {page.final_status_code ?? page.status_code ?? 'Unknown'}</span>}</td><td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">{page.title || 'No title'}</td><td className="px-4 py-3">{page.indexable ? <span className="text-patina">Eligible</span> : <span className="text-ochre">Restricted</span>}</td><td className="px-4 py-3 text-muted-foreground">{page.render_mode || '—'}</td><td className="px-4 py-3"><Button size="icon" variant="ghost" aria-label={`View details for ${page.url}`} onClick={() => setSelectedPage(page)}><ChevronRight /></Button></td></tr>)}</tbody>
                    </table>
                    {pages.length === 0 && <Empty text="No URLs match these filters." />}
                  </div>
                )}

                {tab === 'issues' && (
                  <ul className="panel divide-y divide-border overflow-hidden">
                    {issues.map((issue) => <li key={issue.id}><button className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setSelectedIssue(issue)}><Badge variant={priorityVariant(issue.priority)}>{issue.priority}</Badge><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{issue.title}</span><span className="block truncate text-xs text-muted-foreground">{issue.url}</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button></li>)}
                    {issues.length === 0 && <Empty text="No issues match this filter." />}
                  </ul>
                )}

                {tab === 'history' && (
                  <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
                    <section className="space-y-3">
                      <SectionTitle aside={<GradeTag grade="measured">Own crawl</GradeTag>}>Compared with the previous crawl</SectionTitle>
                      {comparison?.previous_scan_id ? <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4"><Metric label="Added URLs" value={delta('added_urls')} /><Metric label="Not observed" value={delta('removed_urls')} /><Metric label="Changed URLs" value={delta('changed_urls')} /><Metric label="New / resolved" value={`${comparison.new_issues.length} / ${comparison.resolved_issues.length}`} /></div>
                        : <Void reason={comparison?.note || 'This is the first crawl. A comparison appears after the next one completes.'} />}
                      <div className="space-y-1.5 pt-2">
                        <Label htmlFor="seo-history">Viewing crawl</Label>
                        <Select value={scanId} onValueChange={setScanId}><SelectTrigger id="seo-history" className="max-w-sm" title={dateLabel(scan?.started_at)}><SelectValue placeholder="No scans" /></SelectTrigger><SelectContent>{scans.map((item) => <SelectItem key={item.id} value={item.id}>{dateLabel(item.started_at, true)} · {item.status} · {item.issues_count} issues</SelectItem>)}</SelectContent></Select>
                        <Button size="sm" variant="ghost" onClick={() => { loadWebsites().then(() => loadScans(websiteId, scanId)).catch(() => toast.error('Refresh failed')) }}><RefreshCw />Reload history</Button>
                      </div>
                    </section>
                    <section className="space-y-3">
                      <SectionTitle>Crawl coverage</SectionTitle>
                      <dl className="panel grid grid-cols-2 gap-y-4 p-4 text-sm">
                        <SmallStat label="Robots.txt" value={scan.summary?.robots_status ? `HTTP ${scan.summary.robots_status}` : scan.summary?.robots_url ? 'Not confirmed' : '—'} />
                        <SmallStat label="Sitemaps found" value={scan.summary?.sitemap_urls?.length ?? '—'} />
                        <SmallStat label="Sitemap URLs" value={scan.summary?.sitemap_discovered ?? '—'} />
                        <SmallStat label="Skipped by robots" value={scan.summary?.skipped_robots ?? '—'} />
                      </dl>
                    </section>
                  </div>
                )}
              </>
            )}
        </>
      )}

      {showAdd && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdd() }}><section role="dialog" aria-modal="true" aria-labelledby="add-site-title" className="w-full max-w-lg animate-sheet-up rounded-t-2xl border border-border bg-popover p-5 shadow-2xl sm:rounded-xl"><div className="flex items-start justify-between"><div><h2 id="add-site-title" className="font-display text-lg font-semibold">Add website</h2><p className="mt-1 text-sm text-muted-foreground">The backend resolves workspace identity from the optional brand.</p></div><Button size="icon" variant="ghost" aria-label="Close add website" onClick={closeAdd}><X /></Button></div><form className="mt-5 space-y-4" onSubmit={addWebsite}><div className="space-y-2"><Label htmlFor="site-name">Website name</Label><Input id="site-name" required value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Company website" /></div><div className="space-y-2"><Label htmlFor="site-url">Website URL</Label><Input id="site-url" type="url" required value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" /></div><div className="space-y-2"><Label htmlFor="site-brand">Brand</Label><Select value={brandKey} onValueChange={setBrandKey}><SelectTrigger id="site-brand"><SelectValue placeholder="Optional brand" /></SelectTrigger><SelectContent><SelectItem value="none">No brand — backend resolves workspace</SelectItem>{workspaceBrands.map((brand) => <SelectItem key={`${brand.workspace_id}-${brand.key}`} value={brand.key}>{brand.name} · {brand.source}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Brand identity comes from your RockBase workspace; no account IDs are hardcoded.</p></div><div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={closeAdd}>Cancel</Button><Button type="submit" disabled={busy || !siteName.trim() || !siteUrl.trim()}>{busy ? 'Adding…' : 'Add website'}</Button></div></form></section></div>}
      {selectedPage && <DetailPanel title="URL inspection" subtitle={selectedPage.url} onClose={() => setSelectedPage(null)}><dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['Final URL', selectedPage.final_url], ['HTTP status', selectedPage.first_status_code != null || selectedPage.final_status_code != null ? `${selectedPage.first_status_code ?? 'Unknown'} → ${selectedPage.final_status_code ?? selectedPage.status_code ?? 'Unknown'}` : selectedPage.status_code], ['Depth', selectedPage.depth == null ? null : String(selectedPage.depth)], ['Inbound links', selectedPage.inlinks == null ? null : `${selectedPage.unique_inlinks ?? '—'} unique / ${selectedPage.inlinks} occurrences`], ['Outbound links', selectedPage.outlinks == null ? null : `${selectedPage.unique_outlinks ?? '—'} unique / ${selectedPage.outlinks} occurrences`], ['Title', selectedPage.title], ['Description', selectedPage.description], ['H1', selectedPage.h1?.join(' · ')], ['Canonical', selectedPage.canonical], ['Meta robots', selectedPage.meta_robots], ['X-Robots-Tag', selectedPage.x_robots_tag], ['Content type', selectedPage.content_type], ['Render mode', selectedPage.render_mode], ['Elapsed', selectedPage.elapsed_ms != null ? `${selectedPage.elapsed_ms} ms` : null], ['Indexability', selectedPage.indexable ? 'Potentially indexable' : 'Not indexable']].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value ?? '—'}</dd></div>)}</dl>{selectedPage.error && <p className="mt-4 rounded bg-oxide/10 p-3 text-sm text-oxide">{selectedPage.error}</p>}{!!selectedPage.internal_links?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Internal links ({selectedPage.internal_links.length})</h3><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">{selectedPage.internal_links.map((url) => <li key={url} className="break-all">{url}</li>)}</ul></div>}{!!selectedPage.redirect_chain?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Redirect chain</h3><ol className="mt-2 space-y-1 text-xs text-muted-foreground">{selectedPage.redirect_chain.map((hop, i) => <li key={`${hop.url}-${i}`}>{hop.status} · {hop.url} → {hop.location || '—'}</li>)}</ol></div>}</DetailPanel>}
      {selectedIssue && <DetailPanel title={selectedIssue.title} subtitle={`${selectedIssue.code} · ${selectedIssue.url}`} onClose={() => setSelectedIssue(null)}><Badge variant={priorityVariant(selectedIssue.priority)}>{selectedIssue.priority} priority</Badge><div className="mt-5"><h3 className="text-sm font-semibold">Recommended action</h3><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selectedIssue.recommendation}</p></div>{selectedIssue.details && Object.keys(selectedIssue.details).length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold">Details</h3><pre className="font-data mt-2 max-h-64 overflow-auto rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">{JSON.stringify(selectedIssue.details, null, 2)}</pre></div>}</DetailPanel>}
    </div>
  )
}

function Metric({ label, value, note, tone }: { label: string; value: number | string; note?: string; tone?: string }) {
  return <div className="bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn('font-data mt-1.5 text-2xl capitalize', tone)}>{value}</p>{note && <p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p>}</div>
}
function SmallStat({ label, value }: { label: string; value: string | number }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-data mt-1">{value}</dd></div> }
function Empty({ text }: { text: string }) { return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div> }
function DetailPanel({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/60" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-labelledby="seo-detail-title" className="flex h-full w-full max-w-xl animate-slide-in-right flex-col border-l border-border bg-popover shadow-2xl"><header className="flex items-start justify-between gap-3 border-b border-border p-5"><div className="min-w-0"><h2 id="seo-detail-title" className="font-display font-semibold">{title}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{subtitle}</p></div><Button variant="ghost" size="icon" aria-label="Close detail panel" onClick={onClose}><X /></Button></header><div className="flex-1 overflow-y-auto p-5">{children}</div></section></div>
}
