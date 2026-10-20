import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ExternalLink, Loader2, Plus, Radar, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice, SectionTitle, ago } from '@/components/growth/grammar'
import { useWorkContext } from '@/lib/brandRegistry'
import { studioApi, errorMessage } from '@/lib/drafts'
import { actionableCompetitorFinding, competitorApi, publicEvidenceUrl, type Competitor, type CompetitorFinding, type CompetitorReport, type CompetitorScan } from '@/lib/competitors'
import { freshness, destination } from '@/lib/workQueue'
import { isLocalMode } from '@/components/layout/nav'
import { useAppStore } from '@/store/useAppStore'
import CompetitorSnapshot, { HistoricalLinkDiff } from '@/components/seo/CompetitorSnapshot'

/** One native work surface under Site & Search (and a focused evidence entry from Radar). */
export default function CompetitorIntelligence() {
  const ctx = useWorkContext(), navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const role = useAppStore(s => s.user?.role)
  const canWrite = isLocalMode || ['Admin','Operator'].includes(role || '')
  const [storedList, setList] = useState<Competitor[]>([]), [storedReport, setReport] = useState<CompetitorReport | null>(null)
  const [reportKey, setReportKey] = useState('')
  const [scans, setScans] = useState<CompetitorScan[]>([])
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(''), [error,setError] = useState(''), [note,setNote] = useState('')
  const [showRegister,setShowRegister] = useState(false), [name,setName] = useState(''), [url,setUrl] = useState(''), [brand,setBrand] = useState(ctx.brandKey)
  const [maxUrls,setMaxUrls] = useState(10), [nonce,setNonce] = useState(0)
  const selectedId = params.get('competitor') || '', selectedScan = params.get('competitor_scan') || ''
  const selectionKey = JSON.stringify([ctx.workspaceId,ctx.brandKey,selectedId,selectedScan])
  const scope = `${ctx.workspaceId}:${ctx.brandKey}`, active = useRef(scope); active.current = scope
  const list = storedList.filter(c => c.workspace_id === ctx.workspaceId && (!ctx.brandKey || c.brand_key === ctx.brandKey))
  const selected = list.find(c => String(c.id) === selectedId)
  const report = reportKey === selectionKey && storedReport && selected && String(storedReport.competitor.id) === String(selected.id) && storedReport.competitor.workspace_id === ctx.workspaceId && storedReport.competitor.brand_key === selected.brand_key && (!selectedScan || String(storedReport.scan?.id) === selectedScan) ? storedReport : null
  const findingFocus = params.get('finding') || ''
  useEffect(() => {setBusy('');setNote('')},[scope])

  useEffect(() => {
    setList([]);setReport(null);setScans([]);setError('');setBrand(ctx.brandKey)
    if (ctx.registry.status !== 'ready' || !ctx.workspaceId) return
    const ctl = new AbortController();setLoading(true)
    competitorApi.list(ctx.workspaceId,ctx.brandKey,ctl.signal).then(({data}) => {
      if (!ctl.signal.aborted) setList(data.filter(c=>c.workspace_id===ctx.workspaceId && (!ctx.brandKey || c.brand_key===ctx.brandKey)))
    }).catch(e=>{if(!ctl.signal.aborted)setError(errorMessage(e,'Competitors unavailable.'))}).finally(()=>{if(!ctl.signal.aborted)setLoading(false)})
    return ()=>ctl.abort()
  },[scope,ctx.registry.status,nonce])
  useEffect(()=>{
    setReport(null);setScans([]);setReportKey('')
    if (!selected) return
    const ctl=new AbortController(); const ws=ctx.workspaceId
    competitorApi.scans(ws,selected.id,ctl.signal).then(async ({data}) => {
      if (ctl.signal.aborted) return
      setScans(data);setReportKey(selectionKey)
      const latest = data[0]
      if (!latest) { setReport({competitor:selected,scan:null,previous_scan:null,findings:[],coverage:{},limits:[]}); return }
      if (!selectedScan && ['queued','running'].includes(latest.status)) { setReport({competitor:selected,scan:latest,previous_scan:null,findings:[],coverage:{},limits:[]}); return }
      const {data: findingReport} = await competitorApi.findings(ws,selected.id,selectedScan||undefined,ctl.signal)
      if (!ctl.signal.aborted) setReport(findingReport)
    })
      .catch(e=>{if(!ctl.signal.aborted)setError(errorMessage(e,'Snapshot evidence unavailable.'))})
    return ()=>ctl.abort()
  },[selected?.id,selectedScan,scope,nonce])
  // Poll only a scan the operator explicitly started; polling reads existing state, never starts work.
  useEffect(()=>{
    if (!report?.scan || !['queued','running'].includes(report.scan.status)) return
    const timer=window.setTimeout(()=>setNonce(n=>n+1),1800); return ()=>clearTimeout(timer)
  },[report,nonce])

  function choose(id: string, scan?: string) {
    const next=new URLSearchParams(params);next.set('competitor',id);next.delete('finding')
    if(scan)next.set('competitor_scan',scan);else next.delete('competitor_scan')
    setParams(next)
  }
  async function register(e: React.FormEvent) {
    e.preventDefault();if(busy)return
    const requestScope=scope;setBusy('register');setError('')
    try {const {data}=await competitorApi.register(ctx.workspaceId,{name:name.trim(),base_url:url.trim(),brand_key:ctx.brandKey||brand});if(active.current!==requestScope)return;setShowRegister(false);setName('');setUrl('');setNonce(n=>n+1);choose(String(data.id));setNote('Competitor relationship registered. No crawl has started.')}catch(e){if(active.current===requestScope)setError(errorMessage(e,'Registration failed.'))}finally{if(active.current===requestScope)setBusy('')}
  }
  async function startScan() {
    if(!selected||busy)return
    const requestScope=scope;setBusy('scan');setError('');setNote('')
    try{await competitorApi.scan(ctx.workspaceId,selected.id,maxUrls);if(active.current!==requestScope)return;choose(String(selected.id));setNonce(n=>n+1);setNote('Bounded HTTP scan requested explicitly. It respects robots and access restrictions. Wait for the observed result; no change is inferred from an error.')}catch(e){if(active.current===requestScope)setError(errorMessage(e,'Scan could not start.'))}finally{if(active.current===requestScope)setBusy('')}
  }
  async function brief(f: CompetitorFinding) {
    if(!selected||busy||!canWrite)return
    const requestScope=scope;setBusy(f.id);setError('')
    try{const {data}=await studioApi.create({workspaceId:ctx.workspaceId,brandKey:selected.brand_key,format:'article',source:{kind:'competitor_finding',competitor_id:String(selected.id),scan_id:String(f.scan_id),finding_id:f.id}});if(active.current!==requestScope)return;navigate(destination({workspaceId:ctx.workspaceId,brandKey:selected.brand_key,brandName:selected.name},`/studio/s/${encodeURIComponent(data.draft.id)}`))}catch(e){if(active.current===requestScope)setError(errorMessage(e,'Could not prepare a verified brief.'))}finally{if(active.current===requestScope)setBusy('')}
  }
  if(ctx.registry.status==='error')return <Notice tone="error">{ctx.registry.message}</Notice>
  const current=report?.scan, scanBusy=current && ['queued','running'].includes(current.status)
  const findings=report?.findings || []
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold">Competitor intelligence</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Public website evidence for {ctx.label}. Observe changes, review your own coverage, then write an original brief. No private traffic, rankings or competitor GSC.</p></div><Button variant="outline" size="sm" disabled={!canWrite} onClick={()=>setShowRegister(v=>!v)}><Plus/>Register competitor</Button></div>
    {error&&<Notice tone="error">{error}</Notice>}{note&&<Notice>{note}</Notice>}
    {showRegister&&<form onSubmit={register} className="panel grid gap-4 p-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="competitor-name">Competitor name</Label><Input id="competitor-name" required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></div>
      <div className="space-y-1"><Label htmlFor="competitor-url">Public website URL</Label><Input id="competitor-url" type="url" required maxLength={2048} placeholder="https://competitor.example/" value={url} onChange={e=>setUrl(e.target.value)}/></div>
      <div className="space-y-1"><Label htmlFor="competitor-brand">Competes with our brand</Label><select id="competitor-brand" required className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={ctx.brandKey||brand} disabled={!!ctx.brandKey} onChange={e=>setBrand(e.target.value)}><option value="">Choose an authorized brand</option>{ctx.workspace?.brands.map(b=><option key={b.key} value={b.key}>{b.name}</option>)}</select></div>
      <p className="self-end text-xs leading-relaxed text-muted-foreground">Only public pages you are authorized to access. Registration stores an explicit relationship; it does not fetch the site. No login, CAPTCHA bypass or automatic schedule.</p>
      <Button type="submit" disabled={!!busy||!(ctx.brandKey||brand)}>{busy==='register'?<Loader2 className="animate-spin"/>:<Plus/>}Save relationship</Button>
    </form>}
    <div className="panel flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor="competitor-select">Competitor → our brand</Label><select id="competitor-select" className="h-10 w-full max-w-full rounded-md border border-border bg-background px-2 text-sm" value={selectedId} onChange={e=>choose(e.target.value)}><option value="">{loading?'Loading…':'Choose a competitor'}</option>{list.map(c=><option key={c.id} value={String(c.id)}>{c.name} → {ctx.workspace?.brands.find(b=>b.key===c.brand_key)?.name||c.brand_key}</option>)}</select></div>
      <Button size="sm" variant="outline" onClick={()=>setNonce(n=>n+1)}><RotateCw/>Re-read snapshots</Button>
    </div>
    {!loading&&!list.length&&<p className="text-sm text-muted-foreground">No competitor is registered in this scope. Add a relationship to start; no findings are invented.</p>}
    {selectedId&&!loading&&!selected&&<Notice tone="warn">This competitor is not in the authorized brand scope. No other competitor was selected instead.</Notice>}
    {selected&&<>
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border px-4 py-4">
        <div className="min-w-0"><p className="text-sm font-medium">{selected.name} <span className="text-muted-foreground">→ {ctx.workspace?.brands.find(b=>b.key===selected.brand_key)?.name||selected.brand_key}</span></p>{publicEvidenceUrl(selected.base_url)&&<a className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-patina" href={publicEvidenceUrl(selected.base_url)} target="_blank" rel="noreferrer">{selected.base_url}<ExternalLink className="h-3 w-3 shrink-0"/></a>}<p className="mt-2 text-xs text-muted-foreground">HTTP only · ≤25 pages per scan · five historical scans retained · robots/access rules enforced</p></div>
        <div className="flex flex-wrap items-end gap-2"><div><Label htmlFor="competitor-limit" className="text-xs">Next scan limit</Label><Input id="competitor-limit" type="number" className="mt-1 w-20" min={1} max={25} value={maxUrls} onChange={e=>setMaxUrls(Number(e.target.value))}/></div><Button onClick={startScan} disabled={!canWrite||!!busy||!!scanBusy||maxUrls<1||maxUrls>25}>{scanBusy||busy==='scan'?<Loader2 className="animate-spin"/>:<RotateCw/>}{scanBusy?'Scan running':'Scan public pages'}</Button></div>
      </section>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><label htmlFor="competitor-history">Snapshot history</label><select id="competitor-history" className="max-w-full rounded border border-border bg-background p-2" value={selectedScan} onChange={e=>choose(String(selected.id),e.target.value)}><option value="">Latest available snapshot</option>{scans.map(s=><option key={s.id} value={String(s.id)}>#{s.id} · {s.status} · {s.finished_at||s.started_at}</option>)}</select><span>{current?`#${current.id} · ${current.status} · ${current.pages_count} observed pages`:'No scan yet'}</span></div>
      {current?.error&&<Notice tone="warn">Scan diagnostic: {current.error}. Inaccessible or unobserved pages are not confirmed deleted.</Notice>}
      {report && <CompetitorSnapshot key={`${scope}:${selected.id}:${report.scan?.id}`} report={report} />}
      <SectionTitle>Observed findings <span className="text-muted-foreground">· {findings.length}</span></SectionTitle>
      {!report?<p className="text-sm text-muted-foreground">Reading stored evidence…</p>:!findings.length?<div className="panel-quiet p-5 text-sm text-muted-foreground">{current?'No comparable changes found in this bounded snapshot. This is not proof the entire site is unchanged.':'Registering did not crawl. Start a bounded scan explicitly to establish a baseline.'}</div>:<ol className="panel divide-y divide-border">{findings.map(f=>{
        const age=freshness(f.observed_at,30,Date.now()), actionable=actionableCompetitorFinding(f)
        return <li key={f.id} id={`competitor-finding-${f.id}`} className={`scroll-mt-20 space-y-3 p-4 sm:p-5 ${findingFocus===f.id?'bg-patina/5 ring-1 ring-inset ring-patina/30':''}`}>
          <div className="flex flex-wrap gap-2 text-xs"><span className={f.category==='verified_change'?'text-patina':'text-ochre'}>{f.category.replace(/_/g,' ')}</span><span className="text-muted-foreground">{f.confidence} · {age} · {f.observed_at?ago(f.observed_at):'date unknown'}</span></div><h3 className="font-medium">{f.title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{f.reason}</p>
          {Object.keys(f.changes||{}).length>0&&<dl className="space-y-3">{Object.entries(f.changes).map(([field,change])=><div key={field} className="rounded border border-border p-3 text-xs"><dt className="font-medium">{field.replace(/_/g,' ')}</dt>{field==='internal_links'?<dd><HistoricalLinkDiff before={change.before} after={change.after}/></dd>:<dd className="mt-2 grid gap-2 sm:grid-cols-2"><div className="min-w-0 break-words"><span className="block text-muted-foreground">Before</span><pre className="mt-1 whitespace-pre-wrap break-all font-sans">{JSON.stringify(change.before,null,2)}</pre></div><div className="min-w-0 break-words"><span className="block text-muted-foreground">After</span><pre className="mt-1 whitespace-pre-wrap break-all font-sans">{JSON.stringify(change.after,null,2)}</pre></div></dd>}</div>)}</dl>}
          <div className="space-y-1 border-l-2 border-patina/30 pl-3 text-xs"><p className="break-words text-muted-foreground [overflow-wrap:anywhere]">Observed {f.observed_at||'unknown'}{f.previous_observed_at?` · previous ${f.previous_observed_at}`:''}</p>{f.source_urls.map(u=>publicEvidenceUrl(u)?<a key={u} className="block break-all text-patina underline-offset-2 hover:underline" href={publicEvidenceUrl(u)} target="_blank" rel="noreferrer">{u} ↗</a>:null)}</div>
          <p className="text-sm"><span className="font-medium">Next: </span>{f.next_action}</p>
          {actionable&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!canWrite||!!busy||age!=='current'} onClick={()=>brief(f)}>{busy===f.id?<Loader2 className="animate-spin"/>:<ArrowRight/>}Prepare original Studio brief</Button>{isLocalMode&&<Button size="sm" variant="outline" asChild><Link to={destination({workspaceId:ctx.workspaceId,brandKey:selected.brand_key,brandName:selected.name},`/trends?competitor=${selected.id}&competitor_scan=${f.scan_id}&finding=${encodeURIComponent(f.id)}`)}><Radar/>Review in Radar</Link></Button>}</div>}
          {age!=='current'&&actionable&&<p className="text-xs text-ochre">Evidence must be re-verified before preparing a new brief. Scan only through an explicit action.</p>}
        </li>
      })}</ol>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Coverage & limitations</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify({coverage:report?.coverage,limits:report?.limits},null,2)}</pre><p className="mt-2">Metadata and observed links only. A first observation is not a proven publication date. Missing/403/404/robots-denied pages are not confirmed deleted. A coverage gap is a review hypothesis, not proof of demand or ranking.</p></details>
    </>}
  </div>
}
