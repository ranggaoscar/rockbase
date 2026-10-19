import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Film, MessageSquareText, PenLine, Plus, RotateCw, Search, Sparkles, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Sheet from '@/components/growth/Sheet'
import { EffectTag, GradeTag, Notice, PageHeader, SectionTitle, Void, ago, type Grade } from '@/components/growth/grammar'
import { isLocalMode } from '@/components/layout/nav'
import { useWorkContext } from '@/lib/brandRegistry'
import { draftHref, formatLabel, loadLibrary, newNoteId, scopeDrafts, originLabel, saveStudioNote, type DraftFormat, type LibraryDraft, type LibraryLoad } from '@/lib/drafts'
import { cn } from '@/lib/utils'

const formatIcon: Record<DraftFormat, typeof FileText> = { article: FileText, social_post: MessageSquareText, reel: Film, caption: MessageSquareText }
const classGrade: Record<string, Grade> = { gsc_opportunity: 'measured', rising_trend: 'observed', trend_observation: 'observed', content_idea: 'idea' }
type Filter = 'all' | 'article' | 'social'

export default function Studio() {
  const ctx = useWorkContext()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [load, setLoad] = useState<LibraryLoad | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [nonce, setNonce] = useState(0)
  const creating = params.get('new') === '1'

  useEffect(() => {
    if (ctx.registry.status === 'loading') return
    const ctl = new AbortController()
    setLoad(null)
    loadLibrary(ctx.workspaceId, isLocalMode, ctl.signal).then((data) => { if (!ctl.signal.aborted) setLoad(data) })
    return () => ctl.abort()
  }, [ctx.workspaceId, ctx.registry.status, nonce])

  const drafts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scopeDrafts(load?.drafts ?? [], ctx.brandKey).filter((d) =>
      (filter === 'all' || (filter === 'article' ? d.format === 'article' : d.format !== 'article'))
      && (!q || `${d.title} ${d.excerpt} ${d.topic ?? ''}`.toLowerCase().includes(q)),
    )
  }, [load, filter, query, ctx.brandKey])

  const articles = drafts.filter((d) => d.format === 'article')
  const social = drafts.filter((d) => d.format !== 'article')
  const browserCount = scopeDrafts(load?.drafts ?? [], ctx.brandKey).filter((d) => d.store === 'browser').length

  function createNote(format: DraftFormat) {
    const id = newNoteId(); const at = new Date().toISOString()
    saveStudioNote({ id, title: '', body: '', format, createdAt: at, updatedAt: at, brandKey: ctx.brandKey || null })
    navigate(`/studio/n/${id}`)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Create"
        title={<>Studio <span className="text-muted-foreground">·</span> {ctx.label}</>}
        lede="Every brief, article draft and caption in one place. Research travels with the draft; you decide where it goes next."
        actions={<>
          <Button variant="outline" asChild><Link to="/ai-writer"><Sparkles />Caption assistant</Link></Button>
          <Button onClick={() => setParams({ new: '1' })}><Plus />New draft</Button>
        </>}
      />

      {load?.rockbase === 'error' && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCw className="h-3.5 w-3.5" />Retry</Button>}>RockBase drafts could not be loaded: {load.rockbaseError} Drafts saved in this browser are still shown below.</Notice>}
      {load?.rockbase === 'mode' && <Notice>Radar drafts are stored by Local Mode only. In Server Mode, Studio shows drafts saved in this browser.</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Filter by format">
          {([['all', 'All'], ['article', 'Articles & briefs'], ['social', 'Social']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={cn('rounded-full border px-3 py-1.5 text-xs', filter === key ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
        <div className="ml-auto w-full sm:w-64"><Input aria-label="Search drafts" placeholder="Search drafts…" value={query} onChange={(e) => setQuery(e.target.value)} leftIcon={<Search />} /></div>
      </div>

      {!load ? <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-secondary/40" />)}</div>
        : scopeDrafts(load.drafts, ctx.brandKey).length === 0 ? <EmptyStudio onNew={() => setParams({ new: '1' })} />
        : drafts.length === 0 ? <Void reason="No drafts match this filter." />
        : (
          <div className="grid gap-10 lg:grid-cols-2">
            {(filter !== 'social') && <Shelf title="Articles & briefs" hint="Exported, not published — RockBase has no CMS connection." drafts={articles} workspaceId={ctx.workspaceId} />}
            {(filter !== 'article') && <Shelf title="Social" hint="Continues to Compose. Nothing posts until you start a post there." drafts={social} workspaceId={ctx.workspaceId} />}
          </div>
        )}

      {browserCount > 0 && <p className="text-xs text-muted-foreground"><span className="text-ochre">{browserCount} draft{browserCount > 1 ? 's are' : ' is'} stored in this browser only</span> — they won't appear on another computer or survive clearing site data. Export anything you need to keep.</p>}

      <Sheet open={creating} onClose={() => setParams({})} title="New draft" subtitle="Starts blank. You can attach it to research later by creating briefs from Radar.">
        <div className="space-y-3">
          {([['article', 'Article brief', 'Outline, angle and notes for a blog post or landing page. Export as Markdown.'], ['social_post', 'Social post', 'Caption and notes. Continue in Compose when you are ready.'], ['reel', 'Reel script', 'Hook, beats and on-screen text.']] as const).map(([format, title, body]) => {
            const Icon = formatIcon[format]
            return (
              <button key={format} onClick={() => createNote(format)} className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-[hsl(var(--line-strong))] hover:bg-secondary/40">
                <Icon className="mt-0.5 h-4 w-4 text-patina" /><span><span className="block font-medium">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{body}</span></span>
              </button>
            )
          })}
          <div className="pt-2"><EffectTag effect="browser">Blank drafts are saved in this browser only</EffectTag></div>
          <p className="text-xs text-muted-foreground">Drafts created from Radar are stored in RockBase with their evidence. A shared store for blank drafts is planned; until then RockBase says exactly where each draft lives.</p>
        </div>
      </Sheet>
    </div>
  )
}

function Shelf({ title, hint, drafts, workspaceId }: { title: string; hint: string; drafts: LibraryDraft[]; workspaceId: string }) {
  return (
    <section className="min-w-0 space-y-3">
      <SectionTitle aside={<span className="font-data">{drafts.length}</span>}>{title}</SectionTitle>
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      {drafts.length === 0 ? <Void compact reason="Nothing here yet." /> : (
        <ul className="panel divide-y divide-border overflow-hidden">
          {drafts.map((d) => {
            const Icon = formatIcon[d.format]
            return (
              <li key={d.key}>
                <Link to={draftHref(d, workspaceId)} className="row-hover flex items-start gap-3 px-4 py-3.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    {d.excerpt && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{d.excerpt}</span>}
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{formatLabel[d.format]}</span>
                      {d.classification ? <GradeTag grade={classGrade[d.classification] ?? 'idea'}>{originLabel[d.origin]}{d.topic ? ` · ${d.topic}` : ''}</GradeTag> : <span>{originLabel[d.origin]}</span>}
                      <span className={d.store === 'browser' ? 'text-ochre' : ''}>{d.store === 'browser' ? 'This browser' : 'RockBase'}</span>
                      {!d.brandKey && <span>No brand</span>}
                      {d.updatedAt && <span>{ago(d.updatedAt)}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function EmptyStudio({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
      <div className="bg-card p-5"><PenLine className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Write from scratch</p><p className="mt-1 text-sm text-muted-foreground">No research or AI required.</p><Button size="sm" className="mt-4" onClick={onNew}>New draft</Button></div>
      <div className="bg-card p-5"><Search className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Start from evidence</p><p className="mt-1 text-sm text-muted-foreground">Create a brief from a Radar topic; the evidence stays attached.</p><Button size="sm" variant="outline" className="mt-4" asChild><Link to="/trends">Open Radar</Link></Button></div>
      <div className="bg-card p-5"><SendHorizontal className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Post something now</p><p className="mt-1 text-sm text-muted-foreground">Quick post goes straight to Compose.</p><Button size="sm" variant="outline" className="mt-4" asChild><Link to="/compose">Quick post</Link></Button></div>
    </div>
  )
}
