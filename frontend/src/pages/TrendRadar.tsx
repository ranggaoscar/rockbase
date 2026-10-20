import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Database, ExternalLink, Lock, PenLine, RefreshCw, Save, Search, SlidersHorizontal, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import Sheet from '@/components/growth/Sheet'
import { EffectTag, GradeTag, Mark, Notice, PageHeader, SectionTitle, Void, ago, type Grade } from '@/components/growth/grammar'
import { EvidenceList, GscSignal, dateLabel, safeSourceUrl } from '@/components/trends/Evidence'
import { defaultDiscoveryConfig, trendsApi, type BrandWatch, type DiscoveryConfig, type TrendBrand, type TrendCandidate, type TrendRadar as TrendRadarData, type TrendRecommendation, type TrendWorkspace } from '@/components/trends/api'
import { isLocalMode } from '@/components/layout/nav'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'
import { useWorkContext } from '@/lib/brandRegistry'

type Classification = TrendCandidate['classification']
const classificationLabels: Record<Classification, string> = {
  rising_trend: 'Observed source increase', trend_observation: 'Trending Now observation', gsc_opportunity: 'Search Console opportunity', content_idea: 'Editorial idea · no trend evidence',
}
const shortLabels: Record<Classification, string> = { gsc_opportunity: 'Search Console', rising_trend: 'Rising in feed', trend_observation: 'Seen in feed', content_idea: 'Idea' }
const grades: Record<Classification, Grade> = { gsc_opportunity: 'measured', rising_trend: 'observed', trend_observation: 'observed', content_idea: 'idea' }
const classificationKeys: Classification[] = ['gsc_opportunity', 'rising_trend', 'trend_observation', 'content_idea']
const formatLabels: Record<TrendRecommendation['format'], string> = { article: 'Article brief', reel: 'Reel', social_post: 'Social post' }
const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)
const errorText = (error: unknown) => {
  const e = error as { response?: { data?: { error?: string } }; message?: string }
  const raw = e.response?.data?.error || e.message || 'Request failed. Try again.'
  if (raw === 'TREND_LOCAL_ONLY') return 'Radar is available in Local Mode only.'
  if (raw === 'TREND_LOCAL_OWNER_REQUIRED') return 'Radar requires the local owner session.'
  return raw
}

export default function TrendRadar() {
  if (!isLocalMode) return <ModeUnavailable />
  return <RadarWorkspace />
}

function ModeUnavailable() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader eyebrow="Discover" title="Radar runs on your machine" lede="Radar reads your private, cached Search Console history and a public trend feed. To keep that evidence local, it is only available in Local Mode. Nothing is hidden or broken — this server simply doesn't run it." />
      <div className="panel space-y-3 p-5 text-sm">
        <p className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-muted-foreground" />Available in Local Mode</p>
        <p className="text-muted-foreground">Start RockBase with <code className="font-data rounded bg-secondary px-1">ROCKBASE_MODE=local</code> on the computer that owns the data. Site &amp; Search and Studio work here as usual.</p>
        <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" asChild><Link to="/seo">Open Site &amp; Search</Link></Button><Button variant="outline" size="sm" asChild><Link to="/studio">Open Studio</Link></Button></div>
      </div>
    </div>
  )
}

function RadarWorkspace() {
  const linkedContext = useWorkContext() // Resolve authorized Today deep-link context before loading brand evidence.
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const context = useAppStore((s) => s.context)
  const setContext = useAppStore((s) => s.setContext)
  const [workspaces, setWorkspaces] = useState<TrendWorkspace[]>([])
  const [brands, setBrands] = useState<TrendBrand[]>([])
  const [watchlists, setWatchlists] = useState<BrandWatch[]>([])
  const [registryLoaded, setRegistryLoaded] = useState(false)
  const [radar, setRadar] = useState<TrendRadarData | null>(null)
  const [topicsText, setTopicsText] = useState('')
  const [excludeText, setExcludeText] = useState('')
  const [discovery, setDiscovery] = useState<DiscoveryConfig>(defaultDiscoveryConfig)
  const [format, setFormat] = useState<'all' | TrendRecommendation['format']>('all')
  const [classification, setClassification] = useState<'all' | Classification>('all')
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [selectedId, setSelectedId] = useState(params.get('focus') ?? '')
  const [mobileDetail, setMobileDetail] = useState(Boolean(params.get('focus')))
  const [clock, setClock] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [draftingId, setDraftingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tuneOpen, setTuneOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const activeScope = useRef('')
  const saveController = useRef<AbortController | null>(null)
  const captureController = useRef<AbortController | null>(null)

  // Scope comes from the global brand context when it is valid for Radar's registry.
  const workspaceId = linkedContext.scopeError ? '' : workspaces.some((w) => w.id === context.workspaceId) ? context.workspaceId : workspaces[0]?.id || ''
  const scopedBrands = brands.filter((b) => b.workspace_id === workspaceId)
  const brandKey = scopedBrands.some((b) => b.key === context.brandKey) ? context.brandKey : ''
  const brandName = scopedBrands.find((b) => b.key === brandKey)?.name ?? ''
  const scope = `${workspaceId}\u0000${brandKey}`
  activeScope.current = scope

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => { window.clearInterval(timer); saveController.current?.abort(); captureController.current?.abort() }
  }, [])

  // Reset scoped work whenever the brand context changes.
  useEffect(() => {
    saveController.current?.abort(); saveController.current = null
    captureController.current?.abort(); captureController.current = null
    setSaving(false); setCapturing(false); setRefreshing(false); setDraftingId(''); setError(''); setNotice('')
  }, [scope])

  const loadBrands = useCallback(async (signal?: AbortSignal) => {
    if (linkedContext.scopeError) { setError('Invalid Today workspace or brand. Choose an authorized context.'); return }
    const { data } = await trendsApi.brands(context.workspaceId || undefined, signal)
    if (signal?.aborted) return
    setWorkspaces(data.workspaces || []); setBrands(data.brands || []); setWatchlists(data.watchlists || []); setRegistryLoaded(true)
  }, [context.workspaceId, linkedContext.scopeError])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    loadBrands(controller.signal).catch((e) => { if (!controller.signal.aborted) { setError(errorText(e)); setRegistryLoaded(true) } })
    return () => controller.abort()
  }, [loadBrands])

  const selectedWatch = useMemo(() => watchlists.find((w) => w.brandKey === brandKey) || radar?.watchlist, [watchlists, brandKey, radar])
  useEffect(() => {
    setTopicsText((selectedWatch?.topics || []).join('\n'))
    setExcludeText((selectedWatch?.exclude || []).join('\n'))
    setDiscovery({ ...defaultDiscoveryConfig, ...(selectedWatch?.discovery || {}) })
  }, [selectedWatch])

  useEffect(() => {
    if (!workspaceId || !brandKey) { setRadar(null); return }
    const controller = new AbortController()
    setLoading(true); setError(''); setRadar(null)
    trendsApi.radar(workspaceId, brandKey, controller.signal).then(({ data }) => { if (!controller.signal.aborted) setRadar(data) })
      .catch((e) => { if (!controller.signal.aborted) setError(errorText(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [workspaceId, brandKey])

  const counts = useMemo(() => Object.fromEntries(classificationKeys.map((key) => [key, radar?.candidates.filter((c) => c.classification === key).length || 0])) as Record<Classification, number>, [radar])
  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => (radar?.candidates || []).filter((c) =>
    (classification === 'all' || c.classification === classification)
    && (!needle || c.topic.toLowerCase().includes(needle) || c.relevance.matchedTerms.some((t) => t.toLowerCase().includes(needle)))
    && (format === 'all' || radar!.recommendations.some((r) => r.candidateId === c.id && r.format === format)),
  ), [radar, classification, needle, format])
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0]
  const selectedRecs = (radar?.recommendations || []).filter((r) => r.candidateId === selected?.id && (format === 'all' || r.format === format))
  const hasRssEvidence = Boolean(radar?.candidates.some((c) => c.evidence.some((item) => item.type === 'google_trends_rss')))
  const cooldownActive = Boolean(radar?.source.cooldownUntil && Date.parse(radar.source.cooldownUntil) > clock)
  const cooldownLeft = radar?.source.cooldownUntil ? Math.max(0, Math.ceil((Date.parse(radar.source.cooldownUntil) - clock) / 60000)) : 0

  function select(id: string) {
    setSelectedId(id); setMobileDetail(true)
    const next = new URLSearchParams(params); next.set('focus', id); setParams(next, { replace: true })
  }

  async function refresh() {
    if (!workspaceId || refreshing) return
    const requestScope = scope
    setRefreshing(true); setError(''); setNotice('')
    try {
      const { data } = await trendsApi.refresh(workspaceId)
      if (activeScope.current !== requestScope) return
      setNotice(data.cached ? 'Refresh cooldown is active; showing the latest saved snapshot.' : 'Refresh complete. The feed snapshot was saved.')
      if (brandKey) {
        const { data: next } = await trendsApi.radar(workspaceId, brandKey)
        if (activeScope.current !== requestScope) return
        setRadar(next)
      }
    } catch (e) { if (activeScope.current === requestScope) setError(errorText(e)) }
    finally { if (activeScope.current === requestScope) setRefreshing(false) }
  }

  async function saveWatchlist() {
    if (!workspaceId || !brandKey) return
    const topics = splitLines(topicsText), exclude = splitLines(excludeText)
    if (topics.length > 30 || exclude.length > 30 || [...topics, ...exclude].some((term) => term.length > 100)) { setError('Each list supports up to 30 non-empty lines; each phrase must be 100 characters or fewer.'); return }
    if (![discovery.minImpressions, discovery.minIncrease, discovery.minGrowthPct].every((value) => Number.isFinite(value) && value >= 1 && value <= 1000)) { setError('Discovery thresholds must be between 1 and 1,000.'); return }
    saveController.current?.abort()
    const controller = new AbortController(); saveController.current = controller
    setSaving(true); setError(''); setNotice('')
    const requestScope = scope
    try {
      const { data } = await trendsApi.saveWatchlist(workspaceId, brandKey, topics, exclude, discovery, controller.signal)
      if (controller.signal.aborted || activeScope.current !== requestScope) return
      setWatchlists((current) => [...current.filter((w) => w.brandKey !== data.brandKey), data])
      setNotice('Watchlist saved.'); setTuneOpen(false)
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
    setDraftingId(recommendation.id); setError('')
    try {
      const { data } = await trendsApi.createDraft(workspaceId, brandKey, recommendation.id)
      if (activeScope.current !== requestScope) return
      // Articles open in Studio's brief editor; social formats continue to Compose.
      navigate(recommendation.format === 'article' ? `/studio/d/${encodeURIComponent(data.draft.id)}?workspace_id=${encodeURIComponent(workspaceId)}&new=1` : data.composeUrl)
    } catch (e) { if (activeScope.current === requestScope) { setError(errorText(e)); setDraftingId('') } }
  }

  const feedAt = radar?.source.lastGood?.fetchedAt

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Discover"
        title={brandName ? <>Radar <span className="text-muted-foreground">·</span> {brandName}</> : 'Radar'}
        lede="Topics worth writing about, with the evidence behind each one. Measured, observed and imagined are labelled separately — nothing refreshes or publishes on its own."
        meta={brandKey ? <>
          <button onClick={() => setSourcesOpen(true)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Database className="h-3.5 w-3.5" />Feed {feedAt ? ago(feedAt) : 'never fetched'}{radar?.source.latest?.status === 'unavailable' && <span className="text-oxide">· last refresh failed</span>}</button>
          <button onClick={() => setTuneOpen(true)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><SlidersHorizontal className="h-3.5 w-3.5" />Watching {selectedWatch?.topics.length ?? 0} topic{selectedWatch?.topics.length === 1 ? '' : 's'}</button>
        </> : undefined}
        actions={brandKey ? <div className="flex flex-col items-start gap-1 md:items-end">
          <Button variant="outline" onClick={refresh} disabled={!workspaceId || refreshing || cooldownActive} aria-label="Refresh trend feed"><RefreshCw className={cn(refreshing && 'animate-spin')} />{refreshing ? 'Refreshing…' : cooldownActive ? `Cooldown · ${cooldownLeft}m` : 'Refresh feed'}</Button>
          <EffectTag effect="network">Reads the public Trending Now feed</EffectTag>
        </div> : undefined}
      />

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {registryLoaded && !workspaces.length && !error && <Void reason="No workspaces are available in the registry." />}
      {workspaceId && !brandKey && registryLoaded && (
        <section className="panel space-y-4 p-5">
          <div><p className="font-medium">Radar works one brand at a time.</p><p className="mt-1 text-sm text-muted-foreground">Topics, exclusions and evidence are kept per brand so one brand's signals never leak into another's.</p></div>
          {scopedBrands.length ? <div className="flex flex-wrap gap-2">{scopedBrands.map((b) => <Button key={b.key} variant="outline" size="sm" onClick={() => setContext({ workspaceId, brandKey: b.key })}>{b.name}</Button>)}</div> : <Void reason="No registered brands are available for this workspace. Add a website with a brand in Site & Search." />}
        </section>
      )}

      {brandKey && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="scrollbar-none -mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by evidence">
              {(['all', ...classificationKeys] as const).map((key) => {
                const on = classification === key
                const n = key === 'all' ? radar?.candidates.length ?? 0 : counts[key]
                return (
                  <button key={key} role="tab" aria-selected={on} onClick={() => setClassification(key)}
                    className={cn('inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors', on ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                    {key !== 'all' && <Mark grade={grades[key]} />}{key === 'all' ? 'All' : shortLabels[key]}<span className="font-data text-[11px] opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="min-w-0 flex-1 sm:w-56"><Input aria-label="Search topics" placeholder="Search topics…" value={query} onChange={(e) => setQuery(e.target.value)} leftIcon={<Search />} /></div>
              <select aria-label="Filter recommendations by format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
                <option value="all">All formats</option><option value="article">Article</option><option value="reel">Reel</option><option value="social_post">Social post</option>
              </select>
            </div>
          </div>

          {radar && !hasRssEvidence && <p className="text-xs text-muted-foreground">No relevant Trending Now items for this watchlist in the saved feed. Search Console opportunities and ideas below are separate classifications, not trends.</p>}

          {loading ? <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">{[0, 1].map((i) => <div key={i} className="h-72 animate-pulse rounded-lg bg-secondary/40" />)}</div>
            : radar && visible.length === 0 ? (
              <div className="panel-quiet px-5 py-8 text-sm text-muted-foreground">
                {radar.candidates.length ? 'No topics match these filters.' : <>No candidates for this watchlist and the saved evidence. This is <em>not</em> evidence that the niche is quiet — it only means none of the watched topics appeared in saved sources. <button className="text-foreground underline" onClick={() => setTuneOpen(true)}>Adjust topics</button>.</>}
              </div>
            ) : radar && selected && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <ol className="panel h-fit divide-y divide-border overflow-hidden lg:sticky lg:top-6" aria-label="Topics">
                  {visible.map((c) => {
                    const on = c.id === selected.id
                    const recCount = radar.recommendations.filter((r) => r.candidateId === c.id).length
                    return (
                      <li key={c.id}>
                        <button onClick={() => select(c.id)} aria-current={on ? 'true' : undefined}
                          className={cn('relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors', on ? 'bg-secondary/70' : 'hover:bg-secondary/40')}>
                          {on && <span className="absolute inset-y-0 left-0 w-[3px] bg-patina" aria-hidden />}
                          <Mark grade={grades[c.classification]} className="mt-1" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{c.topic}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">{shortLabels[c.classification]}{c.momentum.measured && c.momentum.delta != null ? ` · ${c.momentum.delta >= 0 ? '+' : ''}${c.momentum.delta.toLocaleString()}` : ''}{recCount ? ` · ${recCount} brief${recCount > 1 ? 's' : ''}` : ''}</span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground lg:hidden" />
                        </button>
                      </li>
                    )
                  })}
                </ol>

                <div className={cn('min-w-0', mobileDetail ? 'fixed inset-0 z-[60] overflow-y-auto bg-background px-4 pb-24 pt-4 lg:static lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0' : 'hidden lg:block')}>
                  <button onClick={() => setMobileDetail(false)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground lg:hidden"><ArrowLeft className="h-4 w-4" />All topics</button>
                  <TopicDetail candidate={selected} recommendations={selectedRecs} draftingId={draftingId} onCreate={createDraft} />
                </div>
              </div>
            )}
        </>
      )}

      <Sheet open={tuneOpen} onClose={() => setTuneOpen(false)} title="Tune Radar" subtitle={`${brandName} · workspace-scoped · one phrase per line, max 30 each`}
        footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Last saved {dateLabel(selectedWatch?.updatedAt)}</span><div className="flex items-center gap-3"><EffectTag effect="local" /><Button onClick={saveWatchlist} disabled={saving || !brandKey} aria-label="Save watchlist and discovery thresholds"><Save />{saving ? 'Saving…' : 'Save watchlist'}</Button></div></div>}>
        <div className="space-y-5">
          <div className="space-y-2"><Label htmlFor="watch-topics">Topics to watch</Label><Textarea id="watch-topics" aria-label="Topics to watch" rows={7} maxLength={3100} value={topicsText} onChange={(e) => setTopicsText(e.target.value)} placeholder={'pour over\ncold brew'} /></div>
          <div className="space-y-2"><Label htmlFor="watch-excludes">Exclude phrases</Label><Textarea id="watch-excludes" aria-label="Exclude phrases" rows={4} maxLength={3100} value={excludeText} onChange={(e) => setExcludeText(e.target.value)} placeholder={'jobs\nvacancy'} /></div>
          <fieldset className="space-y-3 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">Search Console discovery thresholds</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {([['minImpressions', 'Min. current impressions'], ['minIncrease', 'Min. impression increase'], ['minGrowthPct', 'Min. growth %']] as const).map(([key, label]) => (
                <div key={key} className="space-y-1"><Label htmlFor={`discovery-${key}`} className="text-xs">{label}</Label><input id={`discovery-${key}`} aria-label={label} type="number" min="1" max="1000" step="1" value={discovery[key]} onChange={(e) => setDiscovery((current) => ({ ...current, [key]: e.target.value === '' ? 0 : Number(e.target.value) }))} className="font-data h-9 w-full rounded-md border border-input bg-background px-3 text-sm" /></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Transparent operator filters — not statistical significance or a trend score. Legacy watchlists use defaults: 3 impressions, 3 increase, 25% growth.</p>
          </fieldset>
        </div>
      </Sheet>

      <Sheet open={sourcesOpen} onClose={() => setSourcesOpen(false)} title="Sources & history" subtitle="What Radar read, when, and its limits">
        <div className="space-y-6 text-sm">
          <section className="space-y-2">
            <SectionTitle>Trending Now feed</SectionTitle>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Latest snapshot</dt><dd>{radar?.source.latest ? `${dateLabel(radar.source.latest.fetchedAt)} · ${radar.source.latest.status}` : loading ? 'Loading…' : 'No saved snapshot'}</dd>
              {radar?.source.latest?.httpStatus != null && <><dt className="text-muted-foreground">HTTP</dt><dd className="font-data">{radar.source.latest.httpStatus}</dd></>}
              <dt className="text-muted-foreground">Last good</dt><dd>{radar?.source.lastGood ? dateLabel(radar.source.lastGood.fetchedAt) : 'No successful snapshot yet'}</dd>
              <dt className="text-muted-foreground">Cooldown</dt><dd>{radar?.source.cooldownUntil ? `${dateLabel(radar.source.cooldownUntil)}${cooldownActive ? ' · active' : ''}` : 'None'}</dd>
              <dt className="text-muted-foreground">Source</dt><dd className="min-w-0">{radar?.source.latest?.sourceUrl && safeSourceUrl(radar.source.latest.sourceUrl) ? <a className="inline-flex max-w-full items-center gap-1 break-all underline" target="_blank" rel="noreferrer" href={safeSourceUrl(radar.source.latest.sourceUrl)!}>{radar.source.latest.sourceUrl}<ExternalLink className="h-3 w-3 shrink-0" /></a> : 'No source URL available.'}</dd>
            </dl>
            {radar?.source.latest?.error && <Notice tone="error">Latest refresh unavailable: {radar.source.latest.error}</Notice>}
          </section>
          <section className="space-y-2">
            <SectionTitle>Search Console</SectionTitle>
            <p className="text-[13px]">{radar?.gscStatus || (loading ? 'Loading…' : 'Status unavailable')}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={captureHistory} disabled={capturing || loading || !workspaceId || !brandKey} aria-label="Capture cached GSC history without syncing Google">{capturing ? 'Capturing…' : 'Capture cached history'}</Button>
              <EffectTag effect="local">Copies cached data · no Google request</EffectTag>
            </div>
            <p className="text-xs text-muted-foreground">History: {radar?.historyStatus ? `${radar.historyStatus.count} snapshot(s) · last captured ${dateLabel(radar.historyStatus.lastCapturedAt)} · ${radar.historyStatus.note}` : loading ? 'Loading…' : 'No history status available'}</p>
          </section>
          <section className="space-y-2">
            <SectionTitle>Limitations</SectionTitle>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{(radar?.limitations || []).map((l, i) => <li key={i} className="break-words">{l}</li>)}</ul>
          </section>
        </div>
      </Sheet>
    </div>
  )
}

function TopicDetail({ candidate, recommendations, draftingId, onCreate }: { candidate: TrendCandidate; recommendations: TrendRecommendation[]; draftingId: string; onCreate: (r: TrendRecommendation) => void }) {
  const signal = candidate.signal
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <GradeTag grade={grades[candidate.classification]}>{classificationLabels[candidate.classification]}</GradeTag>
        <h2 className="font-display text-2xl font-semibold leading-tight md:text-3xl">{candidate.topic}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{candidate.reason}</p>
        <p className="text-[11px] text-muted-foreground">Matched {candidate.relevance.matchedTerms.join(', ') || 'none'} · in {candidate.relevance.field}</p>
      </header>

      <section className="space-y-3" aria-label="Why this might matter">
        <SectionTitle>Why it might matter</SectionTitle>
        {candidate.momentum.measured ? (
          <div className="rounded-md border border-patina/25 bg-patina/[0.05] px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-patina"><TrendingUp className="h-4 w-4" />{signal?.source === 'gsc' ? 'Measured Search Console impression change' : 'Measured bucket movement'}</p>
            <p className="font-data mt-1.5 text-lg">{candidate.momentum.previous?.toLocaleString() ?? '—'} → {candidate.momentum.current?.toLocaleString() ?? '—'} <span className="text-sm text-muted-foreground">({candidate.momentum.delta != null && candidate.momentum.delta >= 0 ? '+' : ''}{candidate.momentum.delta?.toLocaleString() ?? '—'})</span></p>
            <p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(candidate.momentum.previousAt)} → {dateLabel(candidate.momentum.currentAt)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{candidate.momentum.caveat || 'Approximate bucket movement, not exact search growth.'}</p>
          </div>
        ) : <Void reason="No measured momentum. A first sighting or editorial relevance is not growth evidence." />}

      </section>

      <section className="space-y-3" aria-label="Briefs">
        <SectionTitle aside={<EffectTag effect="local">Creates a draft · never posts</EffectTag>}>Turn into content</SectionTitle>
        {recommendations.length === 0 ? <Void reason="No briefs for this topic with the current format filter." /> : (
          <ul className="space-y-3">
            {recommendations.map((r) => (
              <li key={r.id} className="panel overflow-hidden">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{formatLabels[r.format]}{r.format === 'article' ? ' · opens in Studio' : ' · opens in Compose'}</p>
                    <p className="mt-1 font-medium">{r.title}</p>
                  </div>
                  <Button className="shrink-0" onClick={() => onCreate(r)} disabled={Boolean(draftingId)} aria-label={`Create draft: ${r.title}`}><PenLine />{draftingId === r.id ? 'Creating…' : 'Create draft'}</Button>
                </div>
                <details className="border-t border-border">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">Preview brief</summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 pb-4 font-sans text-sm text-foreground/90">{r.content}</pre>
                  <p className="px-4 pb-3 text-[11px] text-muted-foreground">Preview only. Creating a draft saves it in RockBase with its evidence attached; nothing is published.</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-label="Evidence detail">
        <SectionTitle>Evidence detail</SectionTitle>
        {signal && (
          <div className="space-y-3 rounded-md border border-border p-4">
            <p className="text-xs"><span className="font-medium text-foreground">Observed source: {signal.source.toUpperCase()}</span><span className="text-muted-foreground"> · {signal.status.replace(/_/g, ' ')} · confidence {signal.confidence.replace(/_/g, ' ')}</span></p>
            <p className="text-xs text-muted-foreground">{signal.basis}{!signal.comparisonValid && signal.invalidReason ? ` · Comparison unavailable: ${signal.invalidReason}` : ''}</p>
            {signal.source === 'gsc' && <GscSignal signal={signal} />}
            {signal.history.length > 0 && (
              <details>
                <summary aria-label={`Show GSC history timeline for ${candidate.topic}`} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">History timeline ({signal.history.length} observation{signal.history.length > 1 ? 's' : ''})</summary>
                <ol className="mt-2 space-y-2">{signal.history.map((point) => <li key={`${point.snapshotId}-${point.startDate}`} className="break-words border-l border-border pl-3 text-xs"><p>{point.startDate} – {point.endDate} · captured {dateLabel(point.capturedAt)} · synced {dateLabel(point.syncedAt)}</p><p className="font-data text-muted-foreground">{point.impressions} impr · {point.clicks} clicks · CTR {point.ctr == null ? 'n/a' : `${(point.ctr * 100).toFixed(2)}%`} · pos {point.position.toFixed(2)}</p></li>)}</ol>
              </details>
            )}
          </div>
        )}
        <EvidenceList evidence={candidate.evidence} />
      </section>
    </article>
  )
}
