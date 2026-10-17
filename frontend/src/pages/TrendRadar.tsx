import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Save, Sparkles, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { defaultDiscoveryConfig, trendsApi, type BrandWatch, type DiscoveryConfig, type TrendBrand, type TrendCandidate, type TrendRadar as TrendRadarData, type TrendRecommendation, type TrendWorkspace } from '@/components/trends/api'

const classificationLabels: Record<TrendCandidate['classification'], string> = {
  rising_trend: 'Observed source increase', trend_observation: 'Trending Now observation', gsc_opportunity: 'GSC opportunity', content_idea: 'Editorial idea · no trend evidence',
}
const classificationStyles: Record<TrendCandidate['classification'], string> = {
  rising_trend: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', trend_observation: 'border-blue-500/30 bg-blue-500/10 text-blue-300', gsc_opportunity: 'border-amber-500/30 bg-amber-500/10 text-amber-300', content_idea: 'border-border bg-secondary text-muted-foreground',
}
const classificationKeys: TrendCandidate['classification'][] = ['rising_trend', 'trend_observation', 'gsc_opportunity', 'content_idea']
const classifications: Array<'all' | TrendCandidate['classification']> = ['all', ...classificationKeys]
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not available'
const safeSourceUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null } catch { return null }
}
const splitLines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean)
const errorText = (error: unknown) => {
  const e = error as { response?: { data?: { error?: string } }; message?: string }
  return e.response?.data?.error || e.message || 'Request failed. Try again.'
}

export default function TrendRadar() {
  const [workspaces, setWorkspaces] = useState<TrendWorkspace[]>([])
  const [brands, setBrands] = useState<TrendBrand[]>([])
  const [watchlists, setWatchlists] = useState<BrandWatch[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [brandKey, setBrandKey] = useState('')
  const [radar, setRadar] = useState<TrendRadarData | null>(null)
  const [topicsText, setTopicsText] = useState('')
  const [excludeText, setExcludeText] = useState('')
  const [discovery, setDiscovery] = useState<DiscoveryConfig>(defaultDiscoveryConfig)
  const [format, setFormat] = useState<'all' | 'article' | 'reel' | 'social_post'>('all')
  const [classification, setClassification] = useState<'all' | TrendCandidate['classification']>('all')
  const [clock, setClock] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [draftingId, setDraftingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const activeScope = useRef('')
  const saveController = useRef<AbortController | null>(null)
  const captureController = useRef<AbortController | null>(null)
  const scope = `${workspaceId}\\u0000${brandKey}`
  activeScope.current = scope

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => {
      window.clearInterval(timer)
      saveController.current?.abort()
      captureController.current?.abort()
    }
  }, [])

  const loadBrands = useCallback(async (signal?: AbortSignal) => {
    const { data } = await trendsApi.brands(workspaceId || undefined, signal)
    if (signal?.aborted) return
    setWorkspaces(data.workspaces || [])
    setBrands(data.brands || [])
    setWatchlists(data.watchlists || [])
    const actualWorkspace = workspaceId && data.workspaces.some(w => w.id === workspaceId) ? workspaceId : data.workspaces[0]?.id || ''
    if (actualWorkspace !== workspaceId) setWorkspaceId(actualWorkspace)
    const scopedBrands = data.brands.filter(b => b.workspace_id === actualWorkspace)
    setBrandKey(current => scopedBrands.some(b => b.key === current) ? current : scopedBrands[0]?.key || '')
  }, [workspaceId])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    loadBrands(controller.signal).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
    return () => controller.abort()
  }, [loadBrands])

  function resetScopedActions() {
    saveController.current?.abort(); saveController.current = null
    captureController.current?.abort(); captureController.current = null
    setSaving(false)
    setCapturing(false)
    setRefreshing(false)
    setDraftingId('')
    setError('')
    setNotice('')
  }

  function changeWorkspace(id: string) {
    activeScope.current = `${id}\\u0000`
    resetScopedActions()
    setWorkspaceId(id)
    setBrandKey('')
  }

  function changeBrand(key: string) {
    activeScope.current = `${workspaceId}\\u0000${key}`
    resetScopedActions()
    setBrandKey(key)
  }

  const selectedWatch = useMemo(() => watchlists.find(w => w.brandKey === brandKey) || radar?.watchlist, [watchlists, brandKey, radar])
  useEffect(() => {
    setTopicsText((selectedWatch?.topics || []).join('\n'))
    setExcludeText((selectedWatch?.exclude || []).join('\n'))
    setDiscovery({ ...defaultDiscoveryConfig, ...(selectedWatch?.discovery || {}) })
  }, [selectedWatch])

  useEffect(() => {
    if (!workspaceId || !brandKey) { setRadar(null); return }
    const controller = new AbortController()
    setLoading(true); setError(''); setRadar(null)
    trendsApi.radar(workspaceId, brandKey, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setRadar(data)
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [workspaceId, brandKey])

  const scopedBrands = brands.filter(b => b.workspace_id === workspaceId)
  const recommendations = useMemo(() => (radar?.recommendations || []).filter(item => format === 'all' || item.format === format), [radar, format])
  const visibleCandidates = useMemo(() => (radar?.candidates || []).filter(item => classification === 'all' || item.classification === classification), [radar, classification])
  const visibleRecommendations = useMemo(() => recommendations.filter(item => classification === 'all' || item.classification === classification), [recommendations, classification])
  const classificationCounts = useMemo(() => Object.fromEntries(classifications.slice(1).map(key => [key, radar?.candidates.filter(item => item.classification === key).length || 0])) as Record<TrendCandidate['classification'], number>, [radar])
  const hasRssEvidence = Boolean(radar?.candidates.some(candidate => candidate.evidence.some(item => item.type === 'google_trends_rss')))
  const cooldownActive = Boolean(radar?.source.cooldownUntil && Date.parse(radar.source.cooldownUntil) > clock)

  async function refresh() {
    if (!workspaceId || refreshing) return
    const requestScope = scope
    setRefreshing(true); setError(''); setNotice('')
    try {
      const { data } = await trendsApi.refresh(workspaceId)
      if (activeScope.current !== requestScope) return
      setNotice(data.cached ? 'Refresh cooldown is active; showing the latest saved snapshot.' : 'Refresh complete. The feed snapshot was saved.')
      const { data: next } = await trendsApi.radar(workspaceId, brandKey)
      if (activeScope.current !== requestScope) return
      setRadar(next)
    } catch (e) { if (activeScope.current === requestScope) setError(errorText(e)) }
    finally { if (activeScope.current === requestScope) setRefreshing(false) }
  }

  async function saveWatchlist() {
    if (!workspaceId || !brandKey) return
    const topics = splitLines(topicsText), exclude = splitLines(excludeText)
    if (topics.length > 30 || exclude.length > 30 || [...topics, ...exclude].some(term => term.length > 100)) {
      setError('Each list supports up to 30 non-empty lines; each phrase must be 100 characters or fewer.'); return
    }
    if (![discovery.minImpressions, discovery.minIncrease, discovery.minGrowthPct].every(value => Number.isFinite(value) && value >= 1 && value <= 1000)) {
      setError('Discovery thresholds must be between 1 and 1,000.'); return
    }
    saveController.current?.abort()
    const controller = new AbortController(); saveController.current = controller
    setSaving(true); setError(''); setNotice('')
    const requestScope = scope
    try {
      const { data } = await trendsApi.saveWatchlist(workspaceId, brandKey, topics, exclude, discovery, controller.signal)
      if (controller.signal.aborted || activeScope.current !== requestScope) return
      setWatchlists(current => [...current.filter(w => w.brandKey !== data.brandKey), data])
      setNotice('Watchlist saved.')
      const { data: next } = await trendsApi.radar(workspaceId, brandKey, controller.signal)
      if (controller.signal.aborted || activeScope.current !== requestScope) return
      setRadar(next)
    } catch (e) { if (!controller.signal.aborted && activeScope.current === requestScope) setError(errorText(e)) }
    finally { if (saveController.current === controller) saveController.current = null; if (activeScope.current === requestScope && !controller.signal.aborted) setSaving(false) }
  }

  async function captureHistory() {
    if (!workspaceId || !brandKey || capturing) return
    captureController.current?.abort()
    const controller = new AbortController(); captureController.current = controller
    const requestScope = scope
    setCapturing(true); setError(''); setNotice('')
    try {
      const { data } = await trendsApi.captureHistory(workspaceId, brandKey, controller.signal)
      if (controller.signal.aborted || activeScope.current !== requestScope) return
      setNotice(`${data.status} · ${data.captured} snapshot(s) captured; ${data.historyCount} in history. No Google sync was started.`)
      const { data: next } = await trendsApi.radar(workspaceId, brandKey, controller.signal)
      if (!controller.signal.aborted && activeScope.current === requestScope) setRadar(next)
    } catch (e) { if (!controller.signal.aborted && activeScope.current === requestScope) setError(errorText(e)) }
    finally { if (captureController.current === controller) captureController.current = null; if (activeScope.current === requestScope && !controller.signal.aborted) setCapturing(false) }
  }

  async function createDraft(recommendation: TrendRecommendation) {
    if (draftingId) return
    const requestScope = scope
    const requestWorkspace = workspaceId, requestBrand = brandKey
    setDraftingId(recommendation.id); setError('')
    try {
      const { data } = await trendsApi.createDraft(requestWorkspace, requestBrand, recommendation.id)
      if (activeScope.current !== requestScope) return
      window.location.assign(data.composeUrl)
    } catch (e) { if (activeScope.current === requestScope) { setError(errorText(e)); setDraftingId('') } }
  }

  const evidenceLinks = (evidence: unknown[]) => evidence.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as Record<string, unknown>
    const url = safeSourceUrl(item.url ?? item.sourceUrl ?? item.source_url)
    const title = typeof item.title === 'string' ? item.title : typeof item.source === 'string' ? item.source : `Evidence ${index + 1}`
    const news = Array.isArray(item.news) ? item.news : []
    const gscFields = ['query', 'property', 'websiteName', 'periods', 'clicks', 'impressions', 'ctr', 'position', 'confidence', 'syncedAt', 'freshness', 'coverage', 'reason']
    const evidenceValue = (key: string) => {
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
    return <li key={`${title}-${index}`} className="min-w-0 break-words text-xs text-muted-foreground"><div>{url ? <a className="inline-flex max-w-full items-center gap-1 break-all text-purple-300 underline" href={url} target="_blank" rel="noreferrer">{title}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <span>{title}</span>}{typeof item.publishedAt === 'string' && ` · ${dateLabel(item.publishedAt)}`}</div>
      {item.type === 'google_search_console_cached' && <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">{gscFields.filter(key => item[key] !== undefined).map(key => <div key={key} className="min-w-0 break-words"><dt className="inline font-medium text-foreground/80">{key}: </dt><dd className="inline">{evidenceValue(key)}</dd></div>)}</dl>}
      {(item.type === 'google_trends_rss' || item.type === 'google_trends_rss_comparison') && <p className="mt-1">Traffic: {String(item.trafficText || 'Not reported')} · parsed lower bound: {String(item.trafficLowerBound ?? 'Not available')}{item.fetchedAt ? ` · synced ${dateLabel(String(item.fetchedAt))}` : ''}</p>}
      {news.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{news.map((raw, newsIndex) => { const n = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}; const newsUrl = safeSourceUrl(n.url); return <li key={newsIndex} className="break-words">{newsUrl ? <a className="text-purple-300 underline" target="_blank" rel="noreferrer" href={newsUrl}>{String(n.title || n.source || `News ${newsIndex + 1}`)}<ExternalLink className="ml-1 inline h-3 w-3" /></a> : String(n.title || n.source || `News ${newsIndex + 1}`)}{n.source ? ` · ${String(n.source)}` : null}</li> })}</ul>}
      <details className="mt-1"><summary className="cursor-pointer text-purple-300">Evidence details</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2">{JSON.stringify(item, null, 2)}</pre></details>
    </li>
  }).filter(Boolean)

  return <div className="min-w-0 space-y-5 overflow-y-auto p-4 pb-8 md:p-6">
    <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-purple-300">Research · evidence-led</p><h1 className="mt-1 text-2xl font-bold text-foreground">Trend Radar</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Public trend observations and editorial ideas are labeled separately. No automatic refresh or publishing.</p></div>
      <Button onClick={refresh} disabled={!workspaceId || refreshing || cooldownActive} aria-label="Refresh trend feed" className="shrink-0"><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing…' : cooldownActive ? 'Refresh on cooldown' : 'Refresh feed'}</Button>
    </header>

    {error && <div role="alert" className="break-words rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
    {notice && <div role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</div>}

    <Card><CardContent className="grid min-w-0 gap-4 p-4 md:grid-cols-2">
      <div className="min-w-0 space-y-2"><Label htmlFor="trend-workspace">Workspace</Label><Select value={workspaceId} onValueChange={changeWorkspace}><SelectTrigger id="trend-workspace" aria-label="Select workspace"><SelectValue placeholder="Select workspace" /></SelectTrigger><SelectContent>{workspaces.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="min-w-0 space-y-2"><Label htmlFor="trend-brand">Brand</Label><Select value={brandKey} onValueChange={changeBrand} disabled={!scopedBrands.length}><SelectTrigger id="trend-brand" aria-label="Select brand"><SelectValue placeholder="Select brand" /></SelectTrigger><SelectContent>{scopedBrands.map(b => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}</SelectContent></Select></div>
    </CardContent></Card>

    {!workspaces.length && !loading && !error && <Card><CardContent className="p-5 text-sm text-muted-foreground">No workspaces are available in the registry.</CardContent></Card>}
    {!scopedBrands.length && workspaceId && !error && <Card><CardContent className="p-5 text-sm text-muted-foreground">No registered brands are available for this workspace.</CardContent></Card>}

    {brandKey && <Card><CardHeader className="pb-3"><CardTitle className="text-base">Brand watchlist</CardTitle><p className="text-sm text-muted-foreground">Topics and excluded phrases are workspace-scoped. One phrase per line, maximum 30 in each list.</p></CardHeader><CardContent className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2"><Label htmlFor="watch-topics">Topics to watch</Label><Textarea id="watch-topics" aria-label="Topics to watch" rows={6} maxLength={3100} value={topicsText} onChange={e => setTopicsText(e.target.value)} placeholder={'marmer\narsitektur'} /></div>
      <div className="min-w-0 space-y-2"><Label htmlFor="watch-excludes">Exclude phrases</Label><Textarea id="watch-excludes" aria-label="Exclude phrases" rows={6} maxLength={3100} value={excludeText} onChange={e => setExcludeText(e.target.value)} placeholder={'jobs\nlowongan'} /></div>
      <fieldset className="grid min-w-0 gap-3 rounded-md border border-border p-3 sm:grid-cols-3 lg:col-span-2"><legend className="px-1 text-sm font-medium">GSC discovery thresholds</legend>{([['minImpressions', 'Minimum current impressions'], ['minIncrease', 'Minimum impression increase'], ['minGrowthPct', 'Minimum growth percent']] as const).map(([key, label]) => <div key={key} className="min-w-0 space-y-1"><Label htmlFor={`discovery-${key}`}>{label}</Label><input id={`discovery-${key}`} aria-label={label} type="number" min="1" max="1000" step="1" value={discovery[key]} onChange={e => setDiscovery(current => ({ ...current, [key]: e.target.value === '' ? 0 : Number(e.target.value) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" /></div>)}<p className="text-xs text-muted-foreground sm:col-span-3">Transparent operator filters, not statistical significance or a trend score. Legacy watchlists use defaults: 3 impressions, 3 increase, 25% growth.</p></fieldset>
      <div className="flex flex-wrap items-center gap-3 lg:col-span-2"><Button variant="outline" onClick={saveWatchlist} disabled={saving || !brandKey} aria-label="Save watchlist and discovery thresholds"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save watchlist'}</Button><span className="text-xs text-muted-foreground">Last saved: {dateLabel(selectedWatch?.updatedAt)}</span></div>
    </CardContent></Card>}

    {brandKey && <Card><CardHeader className="pb-3"><CardTitle className="text-base">Feed status & evidence</CardTitle></CardHeader><CardContent className="grid min-w-0 gap-4 text-sm md:grid-cols-2">
      <div className="flex flex-wrap items-center gap-3 md:col-span-2"><Button variant="outline" onClick={captureHistory} disabled={capturing || loading || !workspaceId || !brandKey} aria-label="Capture cached GSC history without syncing Google">{capturing ? 'Capturing…' : 'Capture cached GSC history'}</Button><span className="text-xs text-muted-foreground">History: {radar?.historyStatus ? `${radar.historyStatus.count} snapshot(s) · last captured ${dateLabel(radar.historyStatus.lastCapturedAt)} · ${radar.historyStatus.note}` : loading ? 'Loading…' : 'No history status available'}</span></div>
      <div className="min-w-0 space-y-2"><p><span className="text-muted-foreground">Latest snapshot:</span> {radar?.source.latest ? `${dateLabel(radar.source.latest.fetchedAt)} · ${radar.source.latest.status}` : loading ? 'Loading…' : 'No saved snapshot'}</p>{radar?.source.latest?.httpStatus !== null && radar?.source.latest?.httpStatus !== undefined && <p><span className="text-muted-foreground">HTTP:</span> {radar.source.latest.httpStatus}</p>}{radar?.source.latest?.error && <p className="break-words text-red-300">Latest refresh unavailable: {radar.source.latest.error}</p>}<p><span className="text-muted-foreground">Last good:</span> {radar?.source.lastGood ? dateLabel(radar.source.lastGood.fetchedAt) : 'No successful snapshot yet'}</p><p><span className="text-muted-foreground">Refresh cooldown:</span> {radar?.source.cooldownUntil ? `${dateLabel(radar.source.cooldownUntil)}${cooldownActive ? ' · active' : ''}` : 'None'}</p><p><span className="text-muted-foreground">GSC:</span> {radar?.gscStatus || (loading ? 'Loading…' : 'Status unavailable')}</p></div>
      <div className="min-w-0"><p className="mb-1 text-muted-foreground">Source</p>{radar?.source.latest?.sourceUrl && safeSourceUrl(radar.source.latest.sourceUrl) ? <a className="inline-flex max-w-full items-center gap-1 break-all text-purple-300 underline" target="_blank" rel="noreferrer" href={safeSourceUrl(radar.source.latest.sourceUrl)!}>{radar.source.latest.sourceUrl}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <p className="text-muted-foreground">No source URL available.</p>}<ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{(radar?.limitations || []).map((limitation, i) => <li className="break-words" key={i}>{limitation}</li>)}</ul></div>
    </CardContent></Card>}

    {brandKey && <section className="min-w-0 space-y-3"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold">Evidence & classifications</h2><p className="text-sm text-muted-foreground">Momentum appears only when the source reports comparable measured values.</p><p className="mt-1 text-xs text-muted-foreground">Candidates by classification: {classificationKeys.map(key => `${classificationLabels[key]} ${classificationCounts[key]}`).join(' · ')}</p></div><div className="grid w-full min-w-0 gap-3 sm:w-auto sm:grid-cols-2"><div className="min-w-0"><Label htmlFor="trend-classification" className="mb-1 block">Classification</Label><Select value={classification} onValueChange={v => setClassification(v as typeof classification)}><SelectTrigger id="trend-classification" aria-label="Filter by classification"><SelectValue /></SelectTrigger><SelectContent>{classifications.map(key => <SelectItem key={key} value={key}>{key === 'all' ? 'All classifications' : classificationLabels[key]}</SelectItem>)}</SelectContent></Select></div><div className="w-full min-w-0 sm:w-52"><Label htmlFor="trend-format" className="mb-1 block">Recommendation format</Label><Select value={format} onValueChange={v => setFormat(v as typeof format)}><SelectTrigger id="trend-format" aria-label="Filter recommendations by format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All formats</SelectItem><SelectItem value="article">Article</SelectItem><SelectItem value="reel">Reel</SelectItem><SelectItem value="social_post">Social post</SelectItem></SelectContent></Select></div></div></div>
      {!hasRssEvidence && radar && <Card><CardContent className="p-4 text-sm text-muted-foreground">No relevant RSS trend items for this watchlist in the saved feed. GSC opportunities and editorial ideas below are separate classifications, not RSS trends.</CardContent></Card>}
      {loading && <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading current evidence…</CardContent></Card>}
      {!loading && radar && visibleCandidates.length === 0 && <Card><CardContent className="p-5 text-sm text-muted-foreground">{radar.candidates.length ? 'No candidates match this classification filter.' : 'No candidates for this watchlist and saved evidence. This is not presented as evidence of a rising niche.'}</CardContent></Card>}
      {!loading && radar?.candidates.filter(candidate => classification === 'all' || candidate.classification === classification).map(candidate => <Card key={candidate.id} className="min-w-0"><CardContent className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="min-w-0 space-y-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="break-words text-base font-semibold">{candidate.topic}</h3><Badge variant="outline" className={classificationStyles[candidate.classification]}>{classificationLabels[candidate.classification]}</Badge></div><p className="break-words text-sm text-muted-foreground">{candidate.reason}</p>{candidate.signal && <div className="rounded-md border border-border bg-background/50 p-3 text-sm"><p className="font-medium">Observed source: {candidate.signal.source.toUpperCase()} · {candidate.signal.status.replace(/_/g, ' ')} · {candidate.signal.confidence.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-muted-foreground">{candidate.signal.basis}{!candidate.signal.comparisonValid && candidate.signal.invalidReason ? ` · Comparison unavailable: ${candidate.signal.invalidReason}` : ''}</p>{candidate.signal.source === 'gsc' && <><p className="mt-2 text-xs">{candidate.signal.periods ? `Current period ${candidate.signal.periods.current.startDate}–${candidate.signal.periods.current.endDate}${candidate.signal.periods.previous ? ` vs ${candidate.signal.periods.previous.startDate}–${candidate.signal.periods.previous.endDate}` : ' · no previous period'}` : 'GSC reporting periods unavailable'}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><p>Impressions: {candidate.signal.current?.impressions ?? '—'} {candidate.signal.previous ? `← ${candidate.signal.previous.impressions}` : ''} (Δ {candidate.signal.deltas.impressions ?? '—'})</p><p>Clicks: {candidate.signal.current?.clicks ?? '—'} {candidate.signal.previous ? `← ${candidate.signal.previous.clicks}` : ''} (Δ {candidate.signal.deltas.clicks ?? '—'})</p><p>CTR: {candidate.signal.current?.ctr == null ? 'Unavailable' : `${(candidate.signal.current.ctr * 100).toFixed(2)}%`} {candidate.signal.previous ? `← ${candidate.signal.previous.ctr == null ? 'Unavailable' : `${(candidate.signal.previous.ctr * 100).toFixed(2)}%`}` : ''} (Δ {candidate.signal.deltas.ctrPp === null ? 'Unavailable' : `${candidate.signal.deltas.ctrPp.toFixed(2)} pp`})</p><p>Position: {candidate.signal.current?.position.toFixed(2) ?? '—'} {candidate.signal.previous ? `← ${candidate.signal.previous.position.toFixed(2)}` : ''} (improvement {candidate.signal.deltas.positionImprovement?.toFixed(2) ?? '—'})</p><p>Impression growth: {candidate.signal.growthPct === null ? '— (baseline zero or unavailable)' : `${candidate.signal.growthPct.toFixed(1)}%`}</p><p>History comparisons: {candidate.signal.historyComparisons}</p></div></>}{candidate.signal.history.length > 0 && <details className="mt-2"><summary aria-label={`Show GSC history timeline for ${candidate.topic}`} className="cursor-pointer text-xs text-purple-300">History timeline ({candidate.signal.history.length} observations)</summary><ol className="mt-2 space-y-2">{candidate.signal.history.map(point => <li key={`${point.snapshotId}-${point.startDate}`} className="break-words border-l border-border pl-2 text-xs"><p>{point.startDate}–{point.endDate} · {dateLabel(point.capturedAt)} · synced {dateLabel(point.syncedAt)}</p><p>{point.impressions} impressions · {point.clicks} clicks · CTR {point.ctr == null ? 'Unavailable' : `${(point.ctr * 100).toFixed(2)}%`} · position {point.position.toFixed(2)}</p></li>)}</ol></details>}</div>}<p className="text-xs text-muted-foreground">Matched: {candidate.relevance.matchedTerms.join(', ') || 'none'} · Field: {candidate.relevance.field}</p>{candidate.momentum.measured ? <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm"><div className="flex items-center gap-2 font-medium text-emerald-300"><TrendingUp className="h-4 w-4" />{candidate.signal?.source === 'gsc' ? 'Measured GSC impression change' : 'Measured bucket movement' }</div><p className="mt-1">{candidate.momentum.previous ?? '—'} → {candidate.momentum.current ?? '—'} (delta {candidate.momentum.delta ?? '—'})</p><p className="text-xs text-muted-foreground">{dateLabel(candidate.momentum.previousAt)} → {dateLabel(candidate.momentum.currentAt)}</p><p className="mt-1 text-xs text-muted-foreground">{candidate.momentum.caveat || 'Approximate bucket movement, not exact search growth.'}</p></div> : <p className="text-xs text-muted-foreground">No measured momentum. First seen or editorial relevance alone is not growth evidence.</p>}</div><div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate evidence</p><ul className="space-y-1">{evidenceLinks(candidate.evidence)}</ul></div></CardContent></Card>)}
      {!loading && radar && visibleRecommendations.length === 0 && <Card><CardContent className="p-5 text-sm text-muted-foreground">{radar.recommendations.length ? 'No recommendations match the selected format/classification filters.' : 'No briefs are available yet. An editorial idea is not an external trend signal.'}</CardContent></Card>}
      {!loading && visibleRecommendations.map(recommendation => <Card key={recommendation.id} className="min-w-0"><CardContent className="space-y-3 p-4"><div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline" className={classificationStyles[recommendation.classification]}>{classificationLabels[recommendation.classification]}</Badge><Badge variant="secondary">{recommendation.format === 'social_post' ? 'Social post' : recommendation.format}</Badge></div><h3 className="break-words font-semibold">{recommendation.title}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{recommendation.topic} · {recommendation.reason}</p></div><Button className="shrink-0" onClick={() => createDraft(recommendation)} disabled={Boolean(draftingId)} aria-label={`Create draft: ${recommendation.title}`}><Sparkles className="mr-2 h-4 w-4" />{draftingId === recommendation.id ? 'Creating…' : 'Create draft'}</Button></div><details className="min-w-0"><summary className="cursor-pointer text-sm text-purple-300">Preview brief</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-sm">{recommendation.content}</pre><p className="mt-2 text-xs text-muted-foreground">Brief preview only; this does not create or publish an article.</p></details><ul className="space-y-1">{evidenceLinks(recommendation.evidence)}</ul></CardContent></Card>)}
    </section>}
    {draftingId && <p className="text-xs text-muted-foreground">Creating the idempotent draft…</p>}
    <p className="text-xs text-muted-foreground">Drafts remain drafts. Accounts, media, scheduling, queueing and publishing are not selected or triggered. <Link className="text-purple-300 underline" to="/compose">Open Compose</Link></p>
  </div>
}
