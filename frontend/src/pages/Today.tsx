import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GradeTag, Notice, SectionTitle, SourcePill, ago, type SourceStatus } from '@/components/growth/grammar'
import { useWorkContext } from '@/lib/brandRegistry'
import { isLocalMode } from '@/components/layout/nav'
import type { IssueGroup, Scan, Website } from '@/components/seo/api'
import { gscApi } from '@/components/seo/gscApi'
import { trendsApi } from '@/components/trends/api'
import api from '@/lib/api'
import { studioApi, type StudioDraftSummary } from '@/lib/drafts'
import { competitorItems, destination, fixItems, freshness, operationItems, radarItems, rankWorkItems, searchItems, studioItems, type GrowthBlockers, type WorkItem, type WorkScope } from '@/lib/workQueue'
import { competitorApi } from '@/lib/competitors'
import { useAppStore } from '@/store/useAppStore'
import type { StoneLayer } from '@/components/growth/StoneMonolith'

const StoneMonolith = lazy(() => import('@/components/growth/StoneMonolith'))
interface SourceRead { name: string; status: SourceStatus; detail: string }
interface Snapshot { key: string; items: WorkItem[]; sources: SourceRead[]; drafts: StudioDraftSummary[]; checkedAt: number }

export default function Today() {
  const ctx = useWorkContext()
  const navigate = useNavigate()
  const setContext = useAppStore(s => s.setContext)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [nonce, setNonce] = useState(0)
  const [activeStage, setActiveStage] = useState<number | null>(null)
  const scopeKey = JSON.stringify([ctx.workspaceId, ctx.brandKey, nonce])
  const ready = ctx.registry.status === 'ready' && !!ctx.workspaceId
  // Old results must not paint under a new workspace/brand, even before effect cleanup.
  const current = snapshot?.key === scopeKey ? snapshot : null
  const queue = useMemo(() => rankWorkItems(current?.items || [], 5), [current])
  const brandsKey = JSON.stringify(ctx.workspace?.brands || [])

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController(), signal = controller.signal
    const workspaceId = ctx.workspaceId, brands = ctx.workspace!.brands
    const scopes: WorkScope[] = (ctx.brandKey ? brands.filter(b => b.key === ctx.brandKey) : brands).map(b => ({ workspaceId, brandKey: b.key, brandName: b.name }))
    if (!ctx.brandKey) scopes.push({ workspaceId, brandKey: '', brandName: 'Unassigned · workspace' })
    const now = Date.now(), items: WorkItem[] = [], sources: SourceRead[] = []
    let drafts: StudioDraftSummary[] = []
    const query = { workspace_id: workspaceId }
    const read = async (name: string, fn: () => Promise<void>) => {
      try { await fn() } catch { sources.push({ name, status: 'error', detail: 'Unavailable — not zero. No finding inferred.' }) }
    }
    void Promise.all([
      read('SEO / GSC', async () => {
        const { data: raw } = await api.get<Website[]>('/seo/websites', { params: query, signal })
        const sites = raw.map(s => ({ ...s, id: String(s.id) })).filter(s => (!s.workspace_id || s.workspace_id === workspaceId) && (!ctx.brandKey || s.brand_key === ctx.brandKey))
        if (!sites.length) sources.push({ name: 'SEO', status: 'empty', detail: 'No website in scope; no problems inferred.' })
        for (const website of sites) {
          if (signal.aborted) return
          const scope = scopes.find(s => s.brandKey === (website.brand_key || ''))
          if (!scope) continue
          const siteScope = { ...scope, websiteId: website.id }
          await read(`${scope.brandName} / crawl`, async () => {
            const { data: scans } = await api.get<Scan[]>(`/seo/websites/${encodeURIComponent(website.id)}/scans`, { params: query, signal })
            const scan = [...scans].filter(s => s.status === 'completed').sort((a,b) => (b.finished_at || '').localeCompare(a.finished_at || ''))[0]
            if (!scan) { sources.push({ name: `${scope.brandName} / crawl`, status: 'empty', detail: 'No completed crawl. Nothing started automatically.' }); return }
            const { data } = await api.get<{groups: IssueGroup[]}>(`/seo/scans/${encodeURIComponent(scan.id)}/issue-groups`, { params: query, signal })
            const found = fixItems(data.groups, { ...siteScope, scanId: String(scan.id) }, scan.finished_at || scan.started_at || null, now)
            items.push(...found)
            sources.push({ name: `${scope.brandName} / crawl`, status: freshness(scan.finished_at || scan.started_at, 30, now) !== 'current' ? 'stale' : 'ok', detail: `${found.length} cached findings · ${scan.finished_at || 'date unknown'}` })
          })
          if (isLocalMode) await read(`${scope.brandName} / GSC`, async () => {
            const { data: report } = await gscApi.report(workspaceId, website.id, 28)
            if (signal.aborted) return
            const found = report ? searchItems(report, siteScope, now) : []
            items.push(...found)
            sources.push({ name: `${scope.brandName} / GSC`, status: !report ? 'empty' : found.some(i => i.freshness !== 'current') ? 'stale' : 'ok', detail: report ? `Cached report · ${report.syncedAt}. No Google sync.` : 'No cached report; no search-growth claim.' })
          })
        }
      }),
      read('Radar', async () => {
        if (!isLocalMode) { sources.push({ name: 'Radar / GSC', status: 'mode', detail: 'Private cached signals are Local Mode only.' }); return }
        for (const scope of scopes.filter(s => s.brandKey)) {
          if (signal.aborted) return
          await read(`${scope.brandName} / Radar`, async () => {
            const { data } = await trendsApi.radar(workspaceId, scope.brandKey, signal)
            const found = radarItems(data, scope, now)
            items.push(...found)
            sources.push({ name: `${scope.brandName} / Radar`, status: !found.length ? 'empty' : found.some(i => i.freshness !== 'current') ? 'stale' : 'ok', detail: `${found.length} cached candidates; ideas are not measured demand.` })
          })
        }
      }),
      read('Studio', async () => {
        const { data } = await studioApi.list(workspaceId, signal)
        drafts = data.drafts.filter(d => d.workspaceId === workspaceId && d.status !== 'archived' && (!ctx.brandKey || d.brandKey === ctx.brandKey))
        for (const scope of scopes) items.push(...studioItems(drafts, scope, now))
        sources.push({ name: 'Studio', status: 'ok', detail: 'Server-side statuses & distribution references. Latest 200 drafts; browser-only notes excluded.' })
      }),
      read('Competitors', async () => {
        const {data: competitors} = await competitorApi.list(workspaceId, ctx.brandKey, signal)
        for (const competitor of competitors) {
          if (signal.aborted) return
          const scope = scopes.find(s => s.brandKey === competitor.brand_key)
          if (!scope || competitor.workspace_id !== workspaceId) continue
          await read(`${scope.brandName} / competitor`, async () => {
            const {data} = await competitorApi.findings(workspaceId, competitor.id, undefined, signal)
            const found = competitorItems(data, scope, now); items.push(...found)
            sources.push({name:`${scope.brandName} / ${competitor.name}`,status:!data.scan?'empty':found.some(i=>i.freshness!=='current')?'stale':'ok',detail:`${found.length} actionable snapshot findings; no crawl started.`})
          })
        }
        if (!competitors.length) sources.push({name:'Competitors',status:'empty',detail:'No registered competitor in scope. No external request or claim.'})
      }),
      read('Social blockers', async () => {
        const { data } = await api.get<GrowthBlockers>('/activity/growth-blockers', { params: query, signal })
        for (const scope of scopes) items.push(...operationItems(data, scope, brands.map(b => b.key), now))
        sources.push({ name: 'Social blockers', status: 'ok', detail: `Workspace database state only; no Redis/session probe.${data.truncated?.accounts || data.truncated?.posts ? ' Bounded results: more rows may exist.' : ''}` })
      }),
    ]).then(() => { if (!signal.aborted) setSnapshot({ key: scopeKey, items, sources, drafts, checkedAt: now }) })
    return () => controller.abort()
  }, [ready, scopeKey, brandsKey])

  function follow(item: WorkItem) { setContext({ workspaceId: item.scope.workspaceId, brandKey: item.scope.brandKey, websiteId: item.scope.websiteId || '' }) }
  const loading = !current && ready
  const layers: StoneLayer[] = [
    { key: 'discover', label: 'Discover', tone: '--signal', value: current ? current.items.filter(i => i.kind === 'radar').length : null, detail: 'Cached candidates, not audience growth' },
    { key: 'analyze', label: 'Analyze', tone: '--patina', value: current ? current.items.filter(i => ['fix','search'].includes(i.kind)).length : null, detail: 'Crawl/search candidates, not completed fixes' },
    { key: 'create', label: 'Create', tone: '--chalk', value: current?.drafts.length ?? null, detail: 'Drafts, not publications' },
    { key: 'publish', label: 'Publish', tone: '--ember', value: current ? current.items.filter(i => i.kind === 'operations').length : null, detail: 'Blockers, not publishing volume' },
    { key: 'measure', label: 'Measure', tone: '--ochre', value: null, detail: 'No combined growth score' },
  ]
  return <div className="space-y-7">
    <section className="panel sheen grid gap-4 overflow-hidden rounded-[28px] px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 self-center"><p className="eyebrow">Today · {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="font-display mt-3 max-w-[20ch] text-4xl font-semibold leading-[1.05] sm:text-5xl">Your next five moves</h1>
        <p className="mt-3 text-sm text-muted-foreground">{ctx.label} · {ctx.brandKey ? 'One brand' : 'Authorized brands in this workspace'}</p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Evidence first. Review what blocks work, inspect measured opportunities, and move existing drafts forward. Nothing here runs a sync, crawl, AI call or publication.</p>
        <a href="#priorities" className="mt-4 inline-flex items-center gap-2 text-sm text-patina">{loading ? 'Reading existing evidence…' : `${queue.length} priorities backed by available evidence`}<ArrowRight className="h-4 w-4" /></a>
      </div>
      <div className="hidden lg:block"><Suspense fallback={<div className="h-52" />}><StoneMonolith className="h-52" layers={layers} active={activeStage} onActive={setActiveStage} onSelect={i => navigate(destination({ workspaceId: ctx.workspaceId, brandKey: ctx.brandKey, brandName: ctx.label }, ['/trends','/seo','/studio','/publish','/results'][i]))} /></Suspense></div>
    </section>
    {ctx.registry.status === 'error' && <Notice tone="error">Brand registry unavailable. No workspace data ranked.<Button size="sm" variant="outline" onClick={ctx.registry.retry}>Retry registry</Button></Notice>}
    <section aria-labelledby="priorities" className="space-y-4">
      <SectionTitle id="priorities" aside={<button onClick={() => setNonce(n => n+1)} className="inline-flex items-center gap-1" aria-label="Re-read cached sources"><RotateCw className="h-3.5 w-3.5" />Re-read cached data</button>}>Top priorities</SectionTitle>
      <details className="text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer">How priorities are chosen · deterministic, no AI</summary><p className="mt-2">Severity (0–30) + evidence confidence (0–20) + freshness (−30–15) + actionable impact (0–15) + urgency (0–20). Maximum two per source and, across brands, three per brand. Fewer than five is honest when evidence is insufficient. Opening a page does not complete work.</p></details>
      {loading || ctx.registry.status === 'loading' ? <div className="panel p-6 text-sm text-muted-foreground" aria-busy><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Reading authorized cached sources…</div> : !queue.length ? <div className="panel-quiet p-6"><p className="font-medium">No supported priorities in the available data.</p><p className="mt-1 text-sm text-muted-foreground">Not an “all clear” or a growth result. Check source coverage below or continue in Studio.</p><Link to="/studio" className="mt-3 inline-block text-sm text-patina underline">Open Studio</Link></div> :
        <ol className="panel divide-y divide-border overflow-hidden rounded-2xl">{queue.map((item, index) => <li key={item.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 p-4 sm:p-5" data-priority-id={item.id}>
          <span className="font-data mt-1 text-xs text-muted-foreground">{String(index+1).padStart(2,'0')}</span><div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-patina">{item.scope.brandName}</span><GradeTag grade={item.grade} /><span className="text-muted-foreground">{item.category}</span></div>
            <h2 className="mt-2 text-base font-medium leading-snug [overflow-wrap:anywhere]">{item.title}</h2><p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{item.why}</p>
            <div className="mt-3 border-l-2 border-patina/30 pl-3 text-xs leading-relaxed text-muted-foreground"><p className="font-medium text-foreground">Supporting evidence</p>{item.evidence.map((line,i) => <p key={i} className="[overflow-wrap:anywhere]">{line}</p>)}{item.alsoIn && <p>{item.alsoIn}</p>}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">{item.source} · <strong className={item.freshness === 'current' ? 'text-patina' : 'text-ochre'}>{item.freshness}</strong> · {item.observedAt ? <time dateTime={item.observedAt}>{ago(item.observedAt)}</time> : 'date unknown'}</p><Button asChild size="sm" variant="outline"><Link to={item.primary.to} onClick={() => follow(item)}>{item.primary.label}<ArrowRight /></Link></Button></div>
            <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Why this priority? · {item.weight} points</summary><p className="mt-2">Severity {item.factors.severity} + confidence {item.factors.confidence} + freshness {item.factors.freshness} + actionable impact {item.factors.impact} + urgency {item.factors.urgency}. Stable ID breaks ties; diversity caps apply.</p><p className="mt-1">Evidence timestamp: {item.observedAt || 'unknown'}. Work ordering, not predicted growth.</p></details>
          </div></li>)}</ol>}
    </section>
    <div className="grid gap-7 lg:grid-cols-2"><section className="space-y-3" aria-labelledby="coverage"><SectionTitle id="coverage">Source coverage</SectionTitle><div className="panel space-y-3 p-4">{current?.sources.map((s,i) => <div key={i} className="space-y-1"><SourcePill name={s.name} status={s.status} /><p className="text-xs leading-relaxed text-muted-foreground">{s.detail}</p></div>)}{!current && <p className="text-sm text-muted-foreground">No completed source read yet.</p>}</div><p className="text-xs text-muted-foreground">{current ? `Read ${new Date(current.checkedAt).toLocaleTimeString()}. ` : ''}Missing or stale data is not zero. Queue state and editorial readiness do not measure reach, engagement or conversion.</p></section>
      <section className="space-y-3" aria-labelledby="continue"><SectionTitle id="continue" aside={<Link to="/studio">Studio →</Link>}>Continue existing work</SectionTitle>{!current?.drafts.length ? <p className="text-sm text-muted-foreground">No active server-side drafts loaded in this scope.</p> : <ul className="panel divide-y divide-border">{current.drafts.slice(0,4).map(d => {
        const scope = { workspaceId: ctx.workspaceId, brandKey: d.brandKey || '', brandName: ctx.workspace?.brands.find(b=>b.key===d.brandKey)?.name || 'Unassigned' }
        return <li key={d.id}><Link className="row-hover flex items-start gap-3 p-3" to={destination(scope, `/studio/s/${encodeURIComponent(d.id)}`)} onClick={() => setContext({ workspaceId: scope.workspaceId, brandKey: scope.brandKey })}><FileText className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block truncate text-sm">{d.title || 'Untitled'}</span><span className="text-xs text-muted-foreground">{scope.brandName} · {d.status} · {d.distribution.posts.length} distribution references</span></span></Link></li>
      })}</ul>}</section></div>
  </div>
}
