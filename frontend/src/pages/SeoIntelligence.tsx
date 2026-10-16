import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronRight, Clock3, ExternalLink, FileSearch, Globe2, Loader2, Plus, RefreshCw, Search, ShieldAlert, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { seoApi, setSeoWorkspace, type Brand, type Comparison, type Issue, type PageRecord, type Scan, type Website } from '@/components/seo/api'

const active = (status?: string) => status === 'queued' || status === 'running'
const dateLabel = (date?: string | null, compact = false) => date ? compact ? new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(date).toLocaleString() : '—'
const priorityVariant = (priority: string) => priority === 'high' ? 'error' : priority === 'medium' ? 'warning' : 'outline'
const statusVariant = (status: string) => status === 'completed' ? 'success' : status === 'failed' || status === 'interrupted' ? 'error' : 'warning'
const asCount = (record: Record<string, number> | undefined, key: string) => record?.[key] ?? 0

type Tab = 'overview' | 'urls' | 'issues'
export default function SeoIntelligence() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loadError, setLoadError] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [websites, setWebsites] = useState<Website[]>([])
  const [websiteId, setWebsiteId] = useState('')
  const [scans, setScans] = useState<Scan[]>([])
  const [scanId, setScanId] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [pages, setPages] = useState<PageRecord[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedPage, setSelectedPage] = useState<PageRecord | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [brandKey, setBrandKey] = useState('none')
  const [maxUrls, setMaxUrls] = useState('100')
  const [mode, setMode] = useState<Scan['mode']>('auto')
  const pollRef = useRef<number | undefined>(undefined)
  const selectedWebsite = websites.find((site) => site.id === websiteId)

  const loadWebsites = useCallback(async (prefer?: string) => {
    const [siteResponse, brandResponse] = await Promise.all([seoApi.websites(), seoApi.brands()])
    const sites = siteResponse.data
    setWebsites(sites); setBrands(brandResponse.data)
    const next = prefer && sites.some((site) => site.id === prefer) ? prefer : websiteId && sites.some((site) => site.id === websiteId) ? websiteId : sites[0]?.id ?? ''
    setWebsiteId(next)
  }, [websiteId])
  const loadScans = useCallback(async (forWebsite: string, preferredScan?: string) => {
    if (!forWebsite) { setScans([]); setScanId(''); setScan(null); return }
    const response = await seoApi.scans(forWebsite)
    setScans(response.data)
    const next = preferredScan && response.data.some((item) => item.id === preferredScan) ? preferredScan : response.data[0]?.id ?? ''
    setScanId(next)
  }, [])


  useEffect(() => {
    let cancelled = false
    setSeoWorkspace('')
    Promise.all([seoApi.websites(), seoApi.brands()]).then(([siteResponse, brandResponse]) => {
      if (cancelled) return
      setWebsites(siteResponse.data); setBrands(brandResponse.data); setWebsiteId(siteResponse.data[0]?.id ?? '')
    }).catch(() => { if (!cancelled) { setLoadError('SEO worker unavailable. Check the backend and run modules/seo/SETUP_SEO.bat if this is the first installation.'); toast.error('SEO workspace could not be loaded') } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    if (!websiteId) { setScans([]); setScanId(''); return }
    seoApi.scans(websiteId).then(({ data }) => {
      if (!cancelled) { setScans(data); setScanId((old) => data.some((item) => item.id === old) ? old : data[0]?.id ?? '') }
    }).catch(() => { if (!cancelled) toast.error('Scan history could not be loaded') })
    return () => { cancelled = true }
  }, [websiteId])
  useEffect(() => {
    if (!scanId) { setScan(null); setPages([]); setIssues([]); setComparison(null); return }
    let cancelled = false
    Promise.all([seoApi.scan(scanId), seoApi.pages(scanId, { q: query || undefined, status: statusFilter === 'all' ? undefined : statusFilter }), seoApi.issues(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority }), seoApi.compare(scanId)])
      .then(([a, b, c, d]) => { if (!cancelled) { setScan(a.data); setPages(b.data); setIssues(c.data); setComparison(d.data) } })
      .catch(() => { if (!cancelled) toast.error('Scan details could not be loaded') })
    return () => { cancelled = true }
  }, [scanId, query, priority, statusFilter])
  useEffect(() => {
    window.clearInterval(pollRef.current)
    if (!scanId || !active(scan?.status)) return
    pollRef.current = window.setInterval(async () => {
      try {
        const { data } = await seoApi.scan(scanId); setScan(data)
        const [p, i] = await Promise.all([seoApi.pages(scanId, { q: query || undefined, status: statusFilter === 'all' ? undefined : statusFilter }), seoApi.issues(scanId, { q: query || undefined, priority: priority === 'all' ? undefined : priority })])
        setPages(p.data); setIssues(i.data)
        if (!active(data.status)) { await loadScans(websiteId, scanId); const { data: c } = await seoApi.compare(scanId); setComparison(c); toast.success(data.status === 'completed' ? 'Scan completed' : `Scan ${data.status}`) }
      } catch { /* retain last known scan state; next poll retries */ }
    }, 2500)
    return () => window.clearInterval(pollRef.current)
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
      const { data } = await seoApi.addWebsite(body); await loadWebsites(data.id); setShowAdd(false); setSiteName(''); setSiteUrl(''); setBrandKey('none'); toast.success('Website added')
    } catch (error: any) { toast.error(error?.response?.data?.detail || 'Could not add website') }
    finally { setBusy(false) }
  }
  const download = async (kind: 'issues' | 'pages', format: 'csv' | 'json') => {
    if (!scanId) return
    try {
      const { data, headers } = await seoApi.export(scanId, { kind, format, q: query || undefined, priority: kind === 'issues' && priority !== 'all' ? priority : undefined, status: kind === 'pages' && statusFilter !== 'all' ? statusFilter : undefined })
      const contentType = headers['content-type']
      const blob = new Blob([data], { type: typeof contentType === 'string' ? contentType : format === 'csv' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `seo-${kind}-${scanId}.${format}`; link.click(); URL.revokeObjectURL(url)
    } catch { toast.error('Export failed') }
  }
  const filteredIssues = issues
  const filteredPages = pages
  const indexable = scan?.summary?.indexable_count ?? pages.filter((page) => page.indexable).length
  const completion = scan ? Math.min(100, Math.round((scan.pages_count / Math.max(scan.max_urls, 1)) * 100)) : 0
  const issueCounts = useMemo(() => ({ high: asCount(scan?.summary?.priority_counts, 'high'), medium: asCount(scan?.summary?.priority_counts, 'medium'), low: asCount(scan?.summary?.priority_counts, 'low') }), [scan])
  const delta = (name: keyof Pick<Comparison, 'added_urls' | 'removed_urls' | 'changed_urls'>) => comparison?.[name]?.length ?? 0

  return <div className="space-y-6">
    {loadError && <div role="alert" className="rounded-lg border border-red-500/30 p-4 text-sm text-red-300">{loadError}<Button variant="outline" className="ml-3" onClick={() => window.location.reload()}>Retry</Button></div>}
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-purple-400">ROCKBASE · ORGANIC GROWTH</p><h1 className="mt-1 text-2xl font-bold text-foreground">SEO Intelligence</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Technical crawl visibility, actionable issues, and scan history in your growth workspace.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4"/>Add website</Button><Button variant="purple" disabled={!websiteId || busy || active(scan?.status)} onClick={startScan} aria-label="Start SEO scan"><Activity className="h-4 w-4"/>{busy ? 'Starting…' : active(scan?.status) ? 'Scan running' : 'Start scan'}</Button></div>
    </header>

    <Card><CardContent className="grid gap-4 p-4 md:grid-cols-3 xl:grid-cols-[minmax(150px,1fr)_minmax(200px,1.5fr)_minmax(150px,1fr)_115px_215px_auto] md:items-end">
      <div className="space-y-2"><Label htmlFor="seo-workspace">Workspace</Label><select id="seo-workspace" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={workspaceId || brands.find((b) => b.source === 'Workspace')?.workspace_id || ''} onChange={async (event) => { const id = event.target.value; setWorkspaceId(id); setSeoWorkspace(id); setWebsiteId(''); setScanId(''); setScan(null); setPages([]); setIssues([]); setBrandKey('none'); try { await loadWebsites() } catch { toast.error('Workspace could not be loaded') } }}>{brands.filter((b) => b.source === 'Workspace').map((b) => <option key={b.workspace_id} value={b.workspace_id}>{b.name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="seo-website">Website</Label><Select value={websiteId} onValueChange={setWebsiteId}><SelectTrigger id="seo-website" aria-label="Website"><SelectValue placeholder="Select website"/></SelectTrigger><SelectContent>{websites.map((site) => { const brand = brands.find((item) => item.key && item.key === site.brand_key); return <SelectItem key={site.id} value={site.id}>{site.name} · {brand?.name || site.brand_key || site.workspace_id || site.base_url}</SelectItem> })}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="seo-mode">Crawl mode</Label><Select value={mode} onValueChange={(value) => setMode(value as Scan['mode'])}><SelectTrigger id="seo-mode"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="auto">Auto · recommended</SelectItem><SelectItem value="http">HTTP</SelectItem><SelectItem value="browser">Browser</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="seo-max-urls">URL limit (max 100)</Label><Input id="seo-max-urls" type="number" min={1} max={100} value={maxUrls} onChange={(event) => setMaxUrls(event.target.value)}/></div>
      <div className="space-y-2"><Label htmlFor="seo-history">Scan history</Label><Select value={scanId} onValueChange={setScanId}><SelectTrigger id="seo-history" title={dateLabel(scan?.started_at)}><SelectValue placeholder="No scans"/></SelectTrigger><SelectContent>{scans.map((item) => <SelectItem key={item.id} value={item.id}>{dateLabel(item.started_at, true)} · {item.status}</SelectItem>)}</SelectContent></Select></div>
      <Button aria-label="Refresh SEO data" variant="outline" disabled={loading} onClick={() => { loadWebsites(websiteId).then(() => loadScans(websiteId, scanId)).catch(() => toast.error('Refresh failed')) }}><RefreshCw className="h-4 w-4"/>Refresh</Button>
    </CardContent></Card>

    {!loading && websites.length === 0 ? <Card><CardContent className="py-14 text-center"><Globe2 className="mx-auto h-9 w-9 text-muted-foreground"/><h2 className="mt-4 font-semibold">No websites connected</h2><p className="mt-1 text-sm text-muted-foreground">Add a website to begin a real technical SEO scan. No sample audit data is shown.</p><Button className="mt-4" variant="purple" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4"/>Add website</Button></CardContent></Card> : <>
      {selectedWebsite && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/50 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><Globe2 className="h-4 w-4 shrink-0 text-purple-400"/><div className="min-w-0"><p className="truncate text-sm font-medium">{selectedWebsite.name} <span className="font-normal text-muted-foreground">· {selectedWebsite.base_url}</span></p><p className="text-xs text-muted-foreground">Brand: {brands.find((b) => b.key && b.key === selectedWebsite.brand_key)?.name || selectedWebsite.brand_key || 'Unassigned'} <span className="px-1">·</span> Workspace: {selectedWebsite.workspace_id || 'Resolved by backend'}</p></div></div>{selectedWebsite.base_url && <a href={selectedWebsite.base_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Visit site <ExternalLink className="h-3 w-3"/></a>}</div>}
      {active(scan?.status) && <Card className="border-purple-500/30"><CardContent className="p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-purple-400"/><span className="text-sm font-medium">Scan {scan.status === 'queued' ? 'queued' : 'in progress'}</span></div><span className="text-xs text-muted-foreground">{scan.pages_count} / {scan.max_urls} URL records</span></div><Progress value={completion} className="mt-3"/><p className="mt-2 text-xs text-muted-foreground">Live status refreshes automatically. Crawling observes robots and origin limits.</p></CardContent></Card>}
      {!scan ? <Card><CardContent className="py-12 text-center"><FileSearch className="mx-auto h-8 w-8 text-muted-foreground"/><p className="mt-3 font-medium">No scan results yet</p><p className="mt-1 text-sm text-muted-foreground">Start a scan to populate the overview with this website’s actual crawl results.</p></CardContent></Card> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={CheckCircle2} label="URLs crawled" value={Object.entries(scan.summary?.status_counts || {}).filter(([status]) => status !== 'not_fetched').reduce((total, [, count]) => total + count, 0)} note={`${scan.pages_count} URL records · ${scan.summary?.discovered_count ?? '—'} discovered`} /><Metric icon={ShieldAlert} label="Issues found" value={scan.issues_count} note={`${issueCounts.high} high · ${issueCounts.medium} medium · ${issueCounts.low} low`} /><Metric icon={Sparkles} label="Indexable potential" value={indexable} note="Eligibility only · not Google index evidence"/><Metric icon={Clock3} label="Scan status" value={scan.status} note={`${scan.mode} mode · ${dateLabel(scan.finished_at || scan.started_at)}`} /></div>
        {scan.error && <div role="alert" className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0"/>{scan.error}</div>}
        {!!scan.summary?.warnings?.length && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200"><p className="font-medium">Coverage notes</p><ul className="mt-1 list-inside list-disc text-xs">{scan.summary.warnings.map((warning, i) => <li key={`${i}-${warning}`}>{warning}</li>)}</ul></div>}
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-purple-400"/>Scan comparison</CardTitle><Badge variant={scan.status === 'completed' ? 'success' : statusVariant(scan.status)}>{comparison?.previous_scan_id ? 'Compared with previous scan' : 'No baseline'}</Badge></CardHeader><CardContent>{comparison?.previous_scan_id ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Delta label="Added URLs" value={delta('added_urls')}/><Delta label="Not observed" value={delta('removed_urls')}/><Delta label="Changed URLs" value={delta('changed_urls')}/><Delta label="New / resolved issues" value={`${comparison.new_issues.length} / ${comparison.resolved_issues.length}`}/></div> : <div className="rounded-md bg-secondary/50 p-4 text-sm text-muted-foreground">{comparison?.note || 'This is the first scan snapshot. A comparison will be available after another scan completes.'}</div>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4 text-purple-400"/>Crawl coverage</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-y-3 text-sm"><SmallStat label="Robots.txt" value={scan.summary?.robots_status ? `HTTP ${scan.summary.robots_status}` : scan.summary?.robots_url ? 'Not confirmed' : '—'}/><SmallStat label="Sitemaps found" value={scan.summary?.sitemap_urls?.length ?? '—'}/><SmallStat label="Sitemap URLs" value={scan.summary?.sitemap_discovered ?? '—'}/><SmallStat label="Skipped by robots" value={scan.summary?.skipped_robots ?? '—'}/></CardContent></Card>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border"><nav aria-label="SEO scan sections" className="flex gap-1">{(['overview','urls','issues'] as Tab[]).map((item) => <button key={item} className={`border-b-2 px-3 py-2 text-sm capitalize ${tab === item ? 'border-purple-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setTab(item)} aria-current={tab === item ? 'page' : undefined}>{item === 'urls' ? `URLs (${pages.length})` : item === 'issues' ? `Issues (${issues.length})` : 'Overview'}</button>)}</nav><div className="flex flex-wrap gap-2 pb-2"><Button size="sm" variant="outline" onClick={() => download(tab === 'urls' ? 'pages' : 'issues', 'csv')} disabled={!scanId}><ArrowDownToLine className="h-3.5 w-3.5"/>CSV</Button><Button size="sm" variant="outline" onClick={() => download(tab === 'urls' ? 'pages' : 'issues', 'json')} disabled={!scanId}><ArrowDownToLine className="h-3.5 w-3.5"/>JSON</Button></div></div>
        <div className="flex flex-wrap items-center gap-2"><div className="min-w-[220px] flex-1"><Input aria-label="Search URLs and issues" placeholder="Search URL, title, issue…" value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search/>}/></div>{tab === 'urls' && <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Filter URLs by HTTP status" className="w-44"><SelectValue placeholder="All statuses"/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="2xx">2xx success</SelectItem><SelectItem value="3xx">3xx redirect</SelectItem><SelectItem value="4xx">4xx client error</SelectItem><SelectItem value="5xx">5xx server error</SelectItem></SelectContent></Select>}<Select value={priority} onValueChange={setPriority}><SelectTrigger aria-label="Filter issues by priority" className="w-40"><SelectValue placeholder="All priorities"/></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div>
        {tab === 'urls' ? <Card><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[780px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">URL</th><th className="px-4 py-3 font-medium">HTTP</th><th className="px-4 py-3 font-medium">Title</th><th className="px-4 py-3 font-medium">Indexability</th><th className="px-4 py-3 font-medium">Mode</th><th className="px-4 py-3"/></tr></thead><tbody>{filteredPages.map((page) => <tr key={page.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/30"><td className="max-w-[300px] truncate px-4 py-3" title={page.url}>{page.url}</td><td className="px-4 py-3"><Badge variant={page.status_code && page.status_code < 400 ? 'success' : 'error'}>{page.status_code ?? 'ERR'}</Badge></td><td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">{page.title || 'No title'}</td><td className="px-4 py-3">{page.indexable ? <span className="text-green-400">Eligible</span> : <span className="text-amber-400">Restricted</span>}</td><td className="px-4 py-3 text-muted-foreground">{page.render_mode || '—'}</td><td className="px-4 py-3"><Button size="icon" variant="ghost" aria-label={`View details for ${page.url}`} onClick={() => setSelectedPage(page)}><ChevronRight className="h-4 w-4"/></Button></td></tr>)}</tbody></table>{filteredPages.length === 0 && <Empty text="No URLs match these filters."/>}</CardContent></Card> : tab === 'issues' ? <Card><CardContent className="space-y-2 p-3">{filteredIssues.map((issue) => <button key={issue.id} className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedIssue(issue)}><Badge variant={priorityVariant(issue.priority)}>{issue.priority}</Badge><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{issue.title}</span><span className="block truncate text-xs text-muted-foreground">{issue.url}</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground"/></button>)}{filteredIssues.length === 0 && <Empty text="No issues match this filter."/>}</CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Priority breakdown</CardTitle></CardHeader><CardContent className="space-y-4">{(['high','medium','low'] as const).map((level) => { const value = issueCounts[level]; const pct = scan.issues_count ? Math.round(value / scan.issues_count * 100) : 0; return <div key={level}><div className="mb-1 flex justify-between text-sm"><span className="capitalize">{level}</span><span className="text-muted-foreground">{value}</span></div><Progress value={pct} className={level === 'high' ? '[&>div]:bg-red-500' : level === 'medium' ? '[&>div]:bg-amber-500' : '[&>div]:bg-slate-400'}/></div> })}<Button variant="outline" className="mt-2" onClick={() => setTab('issues')}>Review issues <ChevronRight className="h-4 w-4"/></Button></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Latest issues</CardTitle></CardHeader><CardContent className="space-y-2">{issues.slice(0,5).map((issue) => <button key={issue.id} onClick={() => setSelectedIssue(issue)} className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-secondary/50"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.priority === 'high' ? 'text-red-400' : issue.priority === 'medium' ? 'text-amber-400' : 'text-muted-foreground'}`}/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{issue.title}</span><span className="text-xs text-muted-foreground">{issue.code} · {issue.priority}</span></span></button>)}{issues.length === 0 && <Empty text="No issues were reported by this scan."/>}</CardContent></Card></div>}
      </>}
    </>}

    {showAdd && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdd(false) }}><section role="dialog" aria-modal="true" aria-labelledby="add-site-title" className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="add-site-title" className="text-lg font-semibold">Add website</h2><p className="mt-1 text-sm text-muted-foreground">The backend resolves workspace identity from the optional brand.</p></div><Button size="icon" variant="ghost" aria-label="Close add website" onClick={() => setShowAdd(false)}><X className="h-4 w-4"/></Button></div><form className="mt-5 space-y-4" onSubmit={addWebsite}><div className="space-y-2"><Label htmlFor="site-name">Website name</Label><Input id="site-name" required value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Company website"/></div><div className="space-y-2"><Label htmlFor="site-url">Website URL</Label><Input id="site-url" type="url" required value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com"/></div><div className="space-y-2"><Label htmlFor="site-brand">Brand / workspace</Label><Select value={brandKey} onValueChange={setBrandKey}><SelectTrigger id="site-brand"><SelectValue placeholder="Optional brand"/></SelectTrigger><SelectContent><SelectItem value="none">No brand — backend resolves workspace</SelectItem>{brands.filter((brand) => brand.key && brand.workspace_id === (workspaceId || brands.find((b) => b.source === 'Workspace')?.workspace_id)).map((brand) => <SelectItem key={`${brand.workspace_id}-${brand.key}`} value={brand.key}>{brand.name} · {brand.source}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Brand identity comes from connected RockBase workspaces; no account IDs are hardcoded.</p></div><div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button><Button type="submit" variant="purple" disabled={busy || !siteName.trim() || !siteUrl.trim()}>{busy ? 'Adding…' : 'Add website'}</Button></div></form></section></div>}
    {selectedPage && <DetailPanel title="URL inspection" subtitle={selectedPage.url} onClose={() => setSelectedPage(null)}><dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['Final URL',selectedPage.final_url],['HTTP status',selectedPage.status_code],['Title',selectedPage.title],['Description',selectedPage.description],['H1',selectedPage.h1?.join(' · ')],['Canonical',selectedPage.canonical],['Meta robots',selectedPage.meta_robots],['X-Robots-Tag',selectedPage.x_robots_tag],['Content type',selectedPage.content_type],['Render mode',selectedPage.render_mode],['Elapsed',selectedPage.elapsed_ms != null ? `${selectedPage.elapsed_ms} ms` : null],['Indexability',selectedPage.indexable ? 'Potentially indexable' : 'Not indexable']].map(([label,value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value || '—'}</dd></div>)}</dl>{selectedPage.error && <p className="mt-4 rounded bg-red-500/10 p-3 text-sm text-red-300">{selectedPage.error}</p>}{!!selectedPage.internal_links?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Internal links ({selectedPage.internal_links.length})</h3><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">{selectedPage.internal_links.map((url) => <li key={url} className="break-all">{url}</li>)}</ul></div>}{!!selectedPage.redirect_chain?.length && <div className="mt-5"><h3 className="text-sm font-semibold">Redirect chain</h3><ol className="mt-2 space-y-1 text-xs text-muted-foreground">{selectedPage.redirect_chain.map((hop,i) => <li key={`${hop.url}-${i}`}>{hop.status} · {hop.url} → {hop.location || '—'}</li>)}</ol></div>}</DetailPanel>}
    {selectedIssue && <DetailPanel title={selectedIssue.title} subtitle={`${selectedIssue.code} · ${selectedIssue.url}`} onClose={() => setSelectedIssue(null)}><Badge variant={priorityVariant(selectedIssue.priority)}>{selectedIssue.priority} priority</Badge><div className="mt-5"><h3 className="text-sm font-semibold">Recommended action</h3><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selectedIssue.recommendation}</p></div>{selectedIssue.details && Object.keys(selectedIssue.details).length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold">Details</h3><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">{JSON.stringify(selectedIssue.details,null,2)}</pre></div>}</DetailPanel>}
  </div>
}
function Metric({ icon: Icon, label, value, note }: { icon: typeof Activity; label: string; value: number | string; note: string }) { return <Card><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="h-4 w-4 text-purple-400"/></div><p className="mt-2 text-2xl font-semibold capitalize">{value}</p><p className="mt-1 truncate text-xs text-muted-foreground">{note}</p></CardContent></Card> }
function Delta({ label, value }: { label: string; value: number | string }) { return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div> }
function SmallStat({label,value}:{label:string;value:string|number}) {return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>}
function Empty({text}:{text:string}) {return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>}
function DetailPanel({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:React.ReactNode}) {return <div className="fixed inset-0 z-[60] flex justify-end bg-black/60" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-modal="true" aria-labelledby="seo-detail-title" className="flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl"><header className="flex items-start justify-between gap-3 border-b border-border p-5"><div className="min-w-0"><h2 id="seo-detail-title" className="font-semibold">{title}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{subtitle}</p></div><Button variant="ghost" size="icon" aria-label="Close detail panel" onClick={onClose}><X className="h-4 w-4"/></Button></header><div className="flex-1 overflow-y-auto p-5">{children}</div></section></div>}
