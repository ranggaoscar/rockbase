import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice, SectionTitle } from '@/components/growth/grammar'
import { publicEvidenceUrl, type CompetitorPage, type CompetitorReport } from '@/lib/competitors'
import { filterSnapshotPages, linkDelta, observationTime, successfulPage, type PageFilter } from '@/lib/competitorPresentation'

function EvidenceLink({url}: {url: string}) {
  const href = publicEvidenceUrl(url)
  return href ? <a className="block break-all text-patina underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">{url} ↗</a> : <span className="break-all">{url}</span>
}
function UrlList({urls, label}: {urls: string[]; label: string}) {
  const [query,setQuery] = useState('')
  const filtered = urls.filter(u=>u.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="mt-3 space-y-2"><Input aria-label={`Search ${label}`} placeholder="Filter URLs…" className="h-8 text-xs" value={query} onChange={e=>setQuery(e.target.value)}/><p className="text-muted-foreground">{filtered.length} of {urls.length} URLs</p><ul className="max-h-64 space-y-2 overflow-y-auto overscroll-contain rounded border border-border p-3">{filtered.map(u=><li key={u}><EvidenceLink url={u}/></li>)}{!filtered.length&&<li className="text-muted-foreground">No matching URLs.</li>}</ul></div>
}
export function HistoricalLinkDiff({before,after}: {before: unknown; after: unknown}) {
  const delta=linkDelta(before,after)
  if (!delta) return <p className="mt-2 text-muted-foreground">Comparable link arrays unavailable in this historical snapshot. No counts inferred.</p>
  return <div className="mt-2 space-y-2" data-link-diff><p className="flex flex-wrap gap-x-4 gap-y-1 font-medium"><span className="text-patina">+{delta.added.length} added</span><span className="text-ochre">−{delta.removed.length} removed</span><span className="text-muted-foreground">{delta.unchanged.length} unchanged</span></p><p className="text-muted-foreground">Observed outgoing links changed; a removed link is not a deleted page.</p>{([['Added',delta.added],['Removed',delta.removed],['Unchanged',delta.unchanged]] as const).map(([label,urls])=><details key={label}><summary className="cursor-pointer py-1">{label} links ({urls.length})</summary><UrlList urls={urls} label={`${label.toLowerCase()} links`}/></details>)}</div>
}
function PageDetail({page}: {page: CompetitorPage}) {
  const ok=successfulPage(page)
  const text=(v: string | null | undefined)=>v===undefined||v===null?'Not recorded':v||'Not present in fetched HTML'
  return <div className="mt-4 space-y-4 border-t border-border pt-4 text-xs">
    <dl className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]"><dt className="text-muted-foreground">Final URL</dt><dd>{page.final_url?<EvidenceLink url={page.final_url}/>: 'Not recorded'}</dd><dt className="text-muted-foreground">HTTP / outcome</dt><dd>{page.status_code ?? 'Not fetched'} · {ok?'Successful HTML':'Unavailable / not successful HTML'}{page.error&&<p className="mt-1 break-words text-ochre">{page.error}</p>}</dd><dt className="text-muted-foreground">Title</dt><dd className="break-words">{ok?text(page.title):'Not evaluated on unavailable page'}</dd><dt className="text-muted-foreground">Description</dt><dd className="break-words">{ok?text(page.description):'Not evaluated on unavailable page'}</dd><dt className="text-muted-foreground">Canonical</dt><dd>{ok?(page.canonical?<EvidenceLink url={page.canonical}/>:text(page.canonical)):'Not evaluated'}</dd><dt className="text-muted-foreground">Indexability</dt><dd>{!ok?'Not evaluated':page.indexable===true?'Indexable by crawl heuristic':page.indexable===false?'Non-indexable by crawl heuristic':'Unknown'}<p className="mt-1 text-muted-foreground">Not Google indexing status. Canonical and directives are observations.</p></dd><dt className="text-muted-foreground">Robots directives</dt><dd className="break-words">{ok?`Meta: ${text(page.meta_robots)} · Header: ${text(page.x_robots_tag)}`:'Not evaluated'}</dd></dl>
    {ok&&<><section><h4 className="font-medium">Headings</h4>{Array.isArray(page.headings)?<ol className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded border border-border p-3">{page.headings.map((h,i)=><li key={i} className="flex gap-3"><span className="shrink-0 text-patina">H{h.level}</span><span className="break-words min-w-0">{h.text||'(empty heading)'}</span></li>)}{!page.headings.length&&<li>No headings in the recorded HTML.</li>}</ol>:<div className="mt-2"><p className="text-ochre">Full heading structure was not recorded in this older snapshot.</p>{Array.isArray(page.h1)&&<p className="mt-2 break-words">Recorded H1: {page.h1.join(' · ')||'None'}</p>}</div>}</section><details><summary className="cursor-pointer py-1">Internal links ({Array.isArray(page.internal_links)?page.internal_links.length:'unknown'})</summary>{Array.isArray(page.internal_links)?<UrlList urls={page.internal_links} label="page internal links"/>:<p>Links were not recorded.</p>}</details></>}
  </div>
}
export default function CompetitorSnapshot({report}: {report: CompetitorReport}) {
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<PageFilter>('all')
  const pages=report.pages || [], scan=report.scan
  const visible=useMemo(()=>filterSnapshotPages(pages,query,filter),[pages,query,filter])
  if(!scan)return null
  if(['queued','running'].includes(scan.status)) return <Notice>Snapshot is still {scan.status}. Wait for stored observations; no baseline or change is inferred from in-flight work.</Notice>
  const success=pages.filter(successfulPage), knownHeadings=success.filter(p=>Array.isArray(p.headings))
  const observed=scan.finished_at || scan.started_at, discovered=scan.summary?.discovered_count
  const baseline=!report.previous_scan, incomplete=scan.status!=='completed'||!!scan.summary?.limit_reached||pages.some(p=>!successfulPage(p))||typeof discovered==='number'&&discovered>pages.length
  const missingTitle=success.filter(p=>p.title==='').length, missingDescription=success.filter(p=>p.description==='').length, missingH1=success.filter(p=>Array.isArray(p.h1)&&!p.h1.length).length
  const titles=new Map<string,number>();success.forEach(p=>{if(p.title?.trim())titles.set(p.title.trim().toLocaleLowerCase(),(titles.get(p.title.trim().toLocaleLowerCase())||0)+1)})
  const duplicates=success.filter(p=>p.title&&titles.get(p.title.trim().toLocaleLowerCase())!>1).length
  const targets=new Set(success.flatMap(p=>p.internal_links || []))
  const paths=new Set(success.map(p=>{try{return new URL(p.url).pathname}catch{return p.url}}))
  const unknownMetadata=success.filter(p=>p.title==null||p.description==null||p.h1==null).length
  const unknownLinks=success.filter(p=>!Array.isArray(p.internal_links)).length
  const structure = new Map<string,number>()
  success.forEach(p=>{try{const path=new URL(p.url).pathname.split('/').filter(Boolean);const group=path.length?`/${path[0]}/`:'Homepage';structure.set(group,(structure.get(group)||0)+1)}catch{/* invalid legacy URL stays in page list */}})
  return <section className="space-y-4" aria-labelledby="snapshot-inspector">
    <SectionTitle id="snapshot-inspector">Snapshot page inspector</SectionTitle>
    <div className="panel space-y-4 p-4 sm:p-5"><div><p className="font-medium">{baseline?'Baseline observations':'Snapshot observations'} · scan #{scan.id}</p><p className="mt-1 text-xs text-muted-foreground">Observed {observationTime(observed)} · stored limit {scan.max_urls} URLs · {scan.status}</p><details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Exact observation timestamp</summary><p className="mt-1 break-all">{observed}</p></details></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">{[[success.length,'Successful HTML'],[pages.length-success.length,'Unavailable / other'],[discovered ?? 'Unknown','Discovered URLs'],[targets.size,'Observed link targets']].map(([n,label])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-data text-xl">{n}</dd></div>)}</dl>
      <p className="text-xs leading-relaxed text-muted-foreground">{paths.size} distinct fetched URL paths; language/query variants stay separate. {knownHeadings.length} of {success.length} successful pages have full heading records. {typeof discovered==='number'?`${Math.max(0,discovered-pages.length)} discovered URLs were not observed in this stored sample.`:'Discovery totals are not recorded in this older snapshot.'} Link targets are not all fetched or verified.</p>
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Observed site structure">{[...structure].map(([path,count])=><span key={path} className="rounded border border-border px-2 py-1"><span className="break-all">{path}</span> · {count} observed URLs</span>)}</div>
      {incomplete&&<Notice tone="warn">Bounded or incomplete coverage. Unavailable and unvisited URLs are not confirmed deleted. Metadata observations apply only to successful recorded HTML.</Notice>}
      {baseline&&<p className="text-sm leading-relaxed">This is a baseline, not a verified website change. Inspect the observed structure below. It does not create Today priorities or a competitor-derived Studio brief.</p>}
      <div className="border-l-2 border-patina/30 pl-3 text-xs leading-relaxed"><p className="font-medium">Metadata observations · not growth claims</p><p className="mt-1">Among known fields: {missingTitle} missing titles · {missingDescription} missing descriptions · {missingH1} pages without H1 · {duplicates} pages sharing a non-empty title.</p><p className="mt-1 text-muted-foreground">{unknownMetadata} successful pages have unknown metadata fields; {unknownLinks} have unknown link records. Unknown is not clean or zero. Review page evidence before deciding on original content; these counts are not content-gap hypotheses.</p></div>
      {Number(report.coverage.owned_baseline_pages||0)===0&&<p className="text-xs text-muted-foreground">No fresh successful owned-site baseline is available for this brand. No automatic content-gap claim can be made.</p>}
      {scan.summary?.sampling&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Sampling policy & coverage</summary><dl className="mt-2 space-y-2">{Object.entries(scan.summary.sampling).map(([k,v])=><div key={k}><dt className="font-medium">{k.replace(/_/g,' ')}</dt><dd className="break-words">{typeof v==='object'?JSON.stringify(v):String(v)}</dd></div>)}</dl></details>}
    </div>
    {!report.pages?<Notice>Page projection is unavailable from this worker version. No page data is inferred.</Notice>:<>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]"><div className="space-y-1"><Label htmlFor="snapshot-search">Search observed pages</Label><Input id="snapshot-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="URL, title, description or heading…"/></div><div className="space-y-1"><Label htmlFor="snapshot-filter">Page filter</Label><select id="snapshot-filter" value={filter} onChange={e=>setFilter(e.target.value as PageFilter)} className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"><option value="all">All recorded pages</option><option value="successful">Successful HTML</option><option value="unavailable">Unavailable / other</option><option value="metadata">Metadata observations</option><option value="nonindexable">Non-indexable heuristic</option></select></div></div>
      <p aria-live="polite" className="text-xs text-muted-foreground">{visible.length} of {pages.length} recorded pages</p>
      <div className="panel divide-y divide-border">{visible.map(page=><details key={page.url} className="min-w-0 p-4" data-inspector-page><summary className="cursor-pointer text-sm"><span className="mr-2 text-xs text-muted-foreground">{page.status_code ?? 'Not fetched'} · {successfulPage(page)?'HTML':'unavailable'}</span><span className="break-all">{page.url}</span><span className="mt-1 block break-words pl-4 text-xs text-muted-foreground">{successfulPage(page)?page.title||'Title absent / unknown':'Restricted, failed or non-HTML; not a deletion'}</span></summary><PageDetail page={page}/></details>)}{!visible.length&&<p className="p-5 text-sm text-muted-foreground">No recorded pages match this filter.</p>}</div>
    </>}
  </section>
}
