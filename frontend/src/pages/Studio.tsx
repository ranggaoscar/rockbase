import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Film, HardDriveUpload, Loader2, MessageSquareText, PenLine, Plus, RotateCw, Search, Sparkles, SendHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Sheet from '@/components/growth/Sheet'
import { EffectTag, GradeTag, Notice, PageHeader, SectionTitle, Void, ago, type Grade } from '@/components/growth/grammar'
import { isLocalMode } from '@/components/layout/nav'
import { useWorkContext } from '@/lib/brandRegistry'
import { draftHref, errorMessage, formatLabel, loadLibrary, movedOriginals, moveNotesToRockBase, newNoteId, removeMovedOriginals, scopeDrafts, originLabel, saveStudioNote, studioApi, unmovedNotes, type DraftFormat, type LibraryDraft, type LibraryLoad, type StudioFormat } from '@/lib/drafts'
import { cn } from '@/lib/utils'
import Tilt from '@/components/growth/Tilt'

const FORMATS = [
  { format: 'article', title: 'Article brief', body: 'Outline, angle and notes for a blog post or landing page. Exports as Markdown.', tone: '--chalk' },
  { format: 'social_post', title: 'Social post', body: 'Caption and notes. Continue in Compose when it is ready.', tone: '--patina' },
  { format: 'reel', title: 'Reel script', body: 'Hook, beats and on-screen text.', tone: '--signal' },
] as const satisfies ReadonlyArray<{ format: StudioFormat; title: string; body: string; tone: string }>

/** A small polished slab in the format's stone colour. */
function Slab({ tone, className }: { tone: string; className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={cn('h-10 w-16', className)} aria-hidden>
      <path d="M32 4 L60 16 L32 28 L4 16 Z" fill={`hsl(var(${tone}) / 0.85)`} />
      <path d="M4 16 L32 28 L32 34 L4 22 Z" fill={`hsl(var(${tone}) / 0.45)`} />
      <path d="M60 16 L32 28 L32 34 L60 22 Z" fill={`hsl(var(${tone}) / 0.25)`} />
      <path d="M14 14 C22 18 28 11 38 16 S50 19 54 15" fill="none" stroke="hsl(0 0% 100% / 0.55)" strokeWidth="0.8" />
      <path d="M32 4 L60 16" stroke="hsl(0 0% 100% / 0.5)" strokeWidth="0.6" />
    </svg>
  )
}

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
  const [busy, setBusy] = useState<StudioFormat | null>(null)
  const [createError, setCreateError] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveResult, setMoveResult] = useState<{ moved: number; failed: Array<{ title: string; error: string }> } | null>(null)
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
  // Browser notes from before the server store, in this brand scope; re-read whenever the library reloads.
  const unmoved = useMemo(() => load ? unmovedNotes().filter((n) => !ctx.brandKey || !n.brandKey || n.brandKey === ctx.brandKey) : [], [load, ctx.brandKey])
  const backups = useMemo(() => load ? movedOriginals().length : 0, [load])

  async function createDraft(format: StudioFormat) {
    if (!ctx.workspaceId) { setCreateError('No workspace is available, so RockBase has nowhere to store this draft.'); return }
    setBusy(format); setCreateError('')
    try {
      const { data } = await studioApi.create({ workspaceId: ctx.workspaceId, format, brandKey: ctx.brandKey || null, source: { kind: 'blank' } })
      navigate(`/studio/s/${encodeURIComponent(data.draft.id)}?workspace_id=${encodeURIComponent(ctx.workspaceId)}&new=1`)
    } catch (e) { setCreateError(errorMessage(e, 'The draft could not be created.')) }
    finally { setBusy(null) }
  }
  /** Explicit fallback when the RockBase store is unreachable; labeled browser-only everywhere. */
  function createBrowserNote(format: DraftFormat) {
    const id = newNoteId(); const at = new Date().toISOString()
    saveStudioNote({ id, title: '', body: '', format, createdAt: at, updatedAt: at, brandKey: ctx.brandKey || null })
    navigate(`/studio/n/${id}`)
  }
  async function moveToRockBase() {
    setMoving(true); setMoveResult(null)
    const result = await moveNotesToRockBase(ctx.workspaceId, unmoved)
    setMoveResult({ moved: result.moved, failed: result.failed.map((f) => ({ title: f.note.title || 'Untitled', error: f.error })) })
    setMoving(false); setNonce((n) => n + 1)
  }
  function removeBackups() {
    if (!window.confirm(`Remove ${backups} browser cop${backups > 1 ? 'ies' : 'y'} of drafts already moved to RockBase? The RockBase drafts are not affected.`)) return
    removeMovedOriginals(); setMoveResult(null); setNonce((n) => n + 1)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Create for ${ctx.label}`}
        title="Studio"
        lede="Every brief, article draft and caption in one place. Research travels with the draft; you decide where it goes next."
        actions={<Button variant="outline" asChild><Link to="/ai-writer"><Sparkles />Caption assistant</Link></Button>}
      />

      <section aria-label="Start a new draft" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {FORMATS.map((f) => (
            <Tilt key={f.format}>
              <button onClick={() => createDraft(f.format)} disabled={busy !== null}
                className="panel sheen sheen-edge group flex h-full w-full flex-col items-start rounded-2xl p-5 text-left transition-[border-color] duration-300 hover:border-[hsl(var(--line-strong))] disabled:opacity-60">
                <span className="flex w-full items-start justify-between">
                  <Slab tone={f.tone} className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] group-hover:-translate-y-1 group-hover:scale-105" />
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/50 text-muted-foreground transition-colors group-hover:border-patina/40 group-hover:text-patina">
                    {busy === f.format ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </span>
                </span>
                <span className="font-display mt-5 text-lg font-semibold">{f.title}</span>
                <span className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.body}</span>
              </button>
            </Tilt>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <EffectTag effect="local">Saves in RockBase · {ctx.workspace?.name ?? 'workspace'}{ctx.brand ? ` · ${ctx.brand.name}` : ' · no brand'}</EffectTag>
          <span className="text-[11px] text-muted-foreground">Opens from any browser that can reach this workspace. Nothing is posted.</span>
        </div>
        {createError && !creating && (
          <Notice tone="error">
            Not created: {createError}{' '}
            <button className="underline underline-offset-2" onClick={() => createBrowserNote('article')}>Start a browser-only draft instead</button>
          </Notice>
        )}
      </section>

      {load?.rockbase === 'error' && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCw className="h-3.5 w-3.5" />Retry</Button>}>Some RockBase drafts could not be loaded — {load.rockbaseError} Everything that did load is shown below.</Notice>}
      {load?.radar === 'mode' && <Notice>Radar briefs are created in Local Mode only. Studio drafts are stored in RockBase in both modes.</Notice>}
      {load?.rockbase === 'ok' && unmoved.length > 0 && (
        <Notice tone="warn" action={<Button size="sm" variant="outline" disabled={moving} onClick={moveToRockBase}>{moving ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <HardDriveUpload className="h-3.5 w-3.5" />}Move to RockBase</Button>}>
          {unmoved.length} Studio draft{unmoved.length > 1 ? 's are' : ' is'} saved in this browser only. Move {unmoved.length > 1 ? 'them' : 'it'} to RockBase ({ctx.workspace?.name ?? 'this workspace'}) to open {unmoved.length > 1 ? 'them' : 'it'} from any browser. The browser copies stay until you remove them.
        </Notice>
      )}
      {moveResult && moveResult.failed.length > 0 && <Notice tone="error">{moveResult.failed.length} not moved and still in this browser: {moveResult.failed.map((f) => `${f.title} (${f.error})`).join('; ')}</Notice>}
      {backups > 0 && (
        <Notice tone={moveResult?.moved ? 'ok' : 'info'} action={<Button size="sm" variant="outline" onClick={removeBackups}><Trash2 className="h-3.5 w-3.5" />Remove browser copies</Button>}>
          {moveResult?.moved ? `Moved ${moveResult.moved} draft${moveResult.moved > 1 ? 's' : ''} to RockBase. ` : ''}{backups} browser cop{backups > 1 ? 'ies are' : 'y is'} kept as a backup of drafts already in RockBase.
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Filter by format">
          {([['all', 'All'], ['article', 'Articles & briefs'], ['social', 'Social']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={cn('rounded-full border px-3.5 py-1.5 text-xs transition-colors', filter === key ? 'border-patina/40 bg-patina/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>{label}</button>
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
          {FORMATS.map((f) => (
            <button key={f.format} disabled={busy !== null} onClick={() => createDraft(f.format)} className="sheen flex w-full items-center gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:border-[hsl(var(--line-strong))] hover:bg-secondary/40 disabled:opacity-60">
              {busy === f.format ? <Loader2 className="h-10 w-16 animate-spin p-2.5 text-patina" /> : <Slab tone={f.tone} />}
              <span><span className="block font-medium">{f.title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{f.body}</span></span>
            </button>
          ))}
          {createError && (
            <Notice tone="error">
              Not created: {createError}{' '}
              <button className="underline underline-offset-2" onClick={() => createBrowserNote('article')}>Start a browser-only draft instead</button>
            </Notice>
          )}
          <div className="pt-2"><EffectTag effect="local">Saves in RockBase · {ctx.workspace?.name ?? 'workspace'}{ctx.brand ? ` · ${ctx.brand.name}` : ' · no brand'}</EffectTag></div>
          <p className="text-xs text-muted-foreground">Blank drafts are stored in RockBase, so they open from any browser that can reach this workspace. Drafts created from Radar are stored in RockBase with their evidence. Nothing is posted or published.</p>
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
        <ul className="panel divide-y divide-border overflow-hidden rounded-2xl">
          {drafts.map((d) => {
            const Icon = formatIcon[d.format]
            return (
              <li key={d.key}>
                <Link to={draftHref(d, workspaceId)} className="row-hover sheen group flex items-start gap-3.5 px-4 py-4">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background/50 transition-colors group-hover:border-[hsl(var(--line-strong))]', d.store === 'browser' && 'border-dashed')}>
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    {d.excerpt && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{d.excerpt}</span>}
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{formatLabel[d.format]}</span>
                      {d.classification ? <GradeTag grade={classGrade[d.classification] ?? 'idea'}>{originLabel[d.origin]}{d.topic ? ` · ${d.topic}` : ''}</GradeTag> : <span>{originLabel[d.origin]}</span>}
                      <span className={cn('inline-flex items-center gap-1', d.store === 'browser' ? 'text-ochre' : 'text-patina/90')}><span className={cn('h-1.5 w-1.5 rounded-full', d.store === 'browser' ? 'bg-ochre' : 'bg-patina')} />{d.store === 'browser' ? 'This browser' : 'RockBase'}</span>
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
    <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
      <div className="bg-card p-5"><PenLine className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Write from scratch</p><p className="mt-1 text-sm text-muted-foreground">No research or AI required.</p><Button size="sm" className="mt-4" onClick={onNew}>New draft</Button></div>
      <div className="bg-card p-5"><Search className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Start from evidence</p><p className="mt-1 text-sm text-muted-foreground">Create a brief from a Radar topic; the evidence stays attached.</p><Button size="sm" variant="outline" className="mt-4" asChild><Link to="/trends">Open Radar</Link></Button></div>
      <div className="bg-card p-5"><SendHorizontal className="h-4 w-4 text-patina" /><p className="mt-3 font-medium">Post something now</p><p className="mt-1 text-sm text-muted-foreground">Quick post goes straight to Compose.</p><Button size="sm" variant="outline" className="mt-4" asChild><Link to="/compose">Quick post</Link></Button></div>
    </div>
  )
}
