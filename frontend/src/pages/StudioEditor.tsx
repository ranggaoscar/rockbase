import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Archive, ArchiveRestore, Check, Copy, Download, ExternalLink, Loader2, Save, SendHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EffectTag, GradeTag, Notice, SectionTitle, StatusTag, Void, ago, type Grade } from '@/components/growth/grammar'
import { EvidenceList } from '@/components/trends/Evidence'
import { trendsApi } from '@/components/trends/api'
import { aiWriterDraft, deleteStudioNote, downloadMarkdown, formatLabel, isSocial, movedNotes, saveStudioNote, splitProvenance, statusHint, studioApi, studioNotes, type DraftFormat, type MovedMarker, type StudioDraft, type StudioHandoff, type StudioPostRef, type StudioStatus } from '@/lib/drafts'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

/** radar + studio are stored in RockBase; note + caption live in this browser only. */
type Kind = 'radar' | 'studio' | 'note' | 'caption'
interface Doc {
  title: string; body: string; format: DraftFormat; updatedAt?: string; brandKey?: string | null
  provenance: Record<string, unknown> | null; workspaceId?: string; createdAt?: string; source?: StudioDraft['source']
  /** Review state. Only Studio drafts keep one; Radar briefs and browser notes do not. */
  status?: StudioStatus; statusChangedAt?: string | null
  distribution?: { handoffs: StudioHandoff[]; posts: StudioPostRef[] }
}

const classGrade: Record<string, Grade> = { gsc_opportunity: 'measured', rising_trend: 'observed', trend_observation: 'observed', content_idea: 'idea' }
const classLabel: Record<string, string> = { gsc_opportunity: 'Search Console opportunity', rising_trend: 'Observed source increase', trend_observation: 'Trending Now observation', content_idea: 'Editorial idea · no trend evidence' }
const PLACEHOLDERS = /\b(working title|todo|tbd|lorem ipsum|\[insert)/i

/** The moves the server accepts, so the editor never offers a dead end. */
const NEXT_STATUS: Record<StudioStatus, Array<{ to: StudioStatus; label: string }>> = {
  draft: [{ to: 'in_review', label: 'Send to review' }, { to: 'ready', label: 'Mark ready' }, { to: 'archived', label: 'Archive' }],
  in_review: [{ to: 'draft', label: 'Back to draft' }, { to: 'ready', label: 'Mark ready' }, { to: 'archived', label: 'Archive' }],
  ready: [{ to: 'in_review', label: 'Send back to review' }, { to: 'draft', label: 'Back to draft' }, { to: 'archived', label: 'Archive' }],
  archived: [{ to: 'draft', label: 'Restore draft' }],
}

function errorText(e: unknown, fallback: string) {
  const x = e as { response?: { data?: { error?: string } }; message?: string }
  return x.response?.data?.error || x.message || fallback
}

export default function StudioEditor({ kind }: { kind: Kind }) {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const workspaceId = params.get('workspace_id') ?? ''
  const [doc, setDoc] = useState<Doc | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState(false)
  const [justCreated] = useState(params.get('new') === '1')
  const [movedTo, setMovedTo] = useState<MovedMarker | null>(null)
  const [handingOff, setHandingOff] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const stored = kind === 'radar' || kind === 'studio'
  const status = doc?.status ?? 'draft'
  const archived = kind === 'studio' && status === 'archived'

  useEffect(() => {
    setDoc(null); setLoadError(''); setMovedTo(null)
    const fromStudio = (d: StudioDraft): Doc => ({
      title: d.title, body: d.body, format: d.format, provenance: null, source: d.source, brandKey: d.brandKey,
      updatedAt: d.updatedAt, createdAt: d.createdAt, workspaceId: d.workspaceId,
      status: d.status, statusChangedAt: d.statusChangedAt, distribution: d.distribution,
    })
    if (kind === 'studio') {
      if (!workspaceId) { setLoadError('This link is missing its workspace.'); return }
      studioApi.get(id, workspaceId).then(({ data }) => setDoc(fromStudio(data.draft))).catch((e) => setLoadError(errorText(e, 'Draft could not be loaded.')))
    } else if (kind === 'radar') {
      if (!workspaceId) { setLoadError('This link is missing its workspace.'); return }
      trendsApi.draft(id, workspaceId).then(({ data }) => {
        const { body, provenance } = splitProvenance(data.draft.content)
        const format = (typeof provenance?.format === 'string' ? provenance.format : 'article') as DraftFormat
        setDoc({ title: data.draft.title || '', body, format, provenance, updatedAt: data.draft.updatedAt, createdAt: data.draft.createdAt, workspaceId: data.draft.workspaceId })
      }).catch((e) => setLoadError(errorText(e, 'Draft could not be loaded.')))
    } else if (kind === 'note') {
      const note = studioNotes().find((n) => n.id === id)
      const marker = movedNotes()[id] ?? null
      setMovedTo(marker)
      if (!note) setLoadError(marker ? 'This browser copy was removed after the draft moved to RockBase. Open the RockBase copy from Studio.' : 'This draft is not in this browser. Browser drafts do not sync between computers.')
      else setDoc({ title: note.title, body: note.body, format: note.format, provenance: null, updatedAt: note.updatedAt, createdAt: note.createdAt, brandKey: note.brandKey ?? null })
    } else {
      const caption = aiWriterDraft(id)
      if (!caption) setLoadError('This caption is not in this browser.')
      else setDoc({ title: caption.topic || 'Caption', body: caption.caption, format: 'caption', provenance: { source: 'Caption assistant', platform: caption.platform, tone: caption.tone }, updatedAt: caption.createdAt })
    }
  }, [kind, id, workspaceId])

  useEffect(() => { if (doc) { setTitle(doc.title); setBody(doc.body) } }, [doc])

  const dirty = Boolean(doc) && kind !== 'caption' && (title !== doc!.title || body !== doc!.body)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  /** One server write; the response is the source of truth for title, body and review state. */
  const persist = useCallback(async (patch: { title?: string; body?: string; status?: StudioStatus }) => {
    const { data } = await studioApi.update(id, workspaceId, patch)
    setDoc((d) => d && {
      ...d, title: data.draft.title, body: data.draft.body, updatedAt: data.draft.updatedAt,
      status: data.draft.status, statusChangedAt: data.draft.statusChangedAt, distribution: data.draft.distribution,
    })
    setTitle(data.draft.title)
    setBody(data.draft.body)
    return data.draft
  }, [id, workspaceId])

  const save = useCallback(async () => {
    if (!doc || !dirty || saving || archived) return
    setSaving(true); setSaveError('')
    try {
      if (kind === 'radar') {
        const { data } = await trendsApi.updateDraft(id, workspaceId, { body, ...(title.trim() ? { title: title.trim() } : {}) })
        const next = splitProvenance(data.draft.content)
        setDoc((d) => d && { ...d, title: data.draft.title || '', body: next.body, updatedAt: data.draft.updatedAt })
        setTitle(data.draft.title || ''); setBody(next.body)
      } else if (kind === 'studio') {
        await persist({ body, title: title.trim() })
      } else {
        const at = new Date().toISOString()
        saveStudioNote({ id, title, body, format: doc.format, createdAt: doc.createdAt || at, updatedAt: at, brandKey: doc.brandKey ?? null })
        setDoc((d) => d && { ...d, title, body, updatedAt: at })
      }
    } catch (e) { setSaveError(errorText(e, 'Not saved. Your text is still here — try again.')) }
    finally { setSaving(false) }
  }, [doc, dirty, saving, archived, kind, id, workspaceId, body, title, persist])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight, 420)}px` } }, [body, doc])

  /**
   * A review move carries the text with it: unsaved edits go in the same request, so
   * changing status can never silently discard what was typed.
   */
  async function moveStatus(next: StudioStatus) {
    if (!doc || saving) return
    setSaving(true); setSaveError('')
    try { await persist({ ...(dirty ? { title: title.trim(), body } : {}), status: next }) }
    catch (e) { setSaveError(errorText(e, 'The status was not changed.')) }
    finally { setSaving(false) }
  }

  /** Records the Compose handoff in RockBase, then opens Compose with this draft. Nothing posts here. */
  async function continueInCompose() {
    if (!doc || handingOff) return
    setHandingOff(true); setSaveError('')
    try {
      if (dirty) await persist({ title: title.trim(), body })
      await studioApi.handoff(id, workspaceId)
      navigate(`/compose?studioDraftId=${encodeURIComponent(id)}&workspace_id=${encodeURIComponent(workspaceId)}`)
    } catch (e) { setSaveError(errorText(e, 'Compose could not be opened. Nothing was posted.')) }
    finally { setHandingOff(false) }
  }

  const words = useMemo(() => body.trim() ? body.trim().split(/\s+/).length : 0, [body])
  const markdown = `# ${title || 'Untitled'}\n\n${body}`
  const checks = [
    { ok: Boolean(title.trim()), label: 'Has a title' },
    { ok: !PLACEHOLDERS.test(`${title}\n${body}`), label: 'No template placeholders left' },
    { ok: doc?.format === 'article' ? words >= 150 : words >= 5, label: doc?.format === 'article' ? 'At least 150 words' : 'Not empty' },
    { ok: !dirty, label: 'All changes saved' },
    ...(kind === 'studio' ? [{ ok: status === 'ready', label: 'Marked ready for distribution' }] : []),
  ]

  async function copy() {
    try { await navigator.clipboard.writeText(isSocial(doc!.format) ? body : markdown); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setSaveError('Clipboard is unavailable in this browser. Select the text and copy it manually.') }
  }
  /** Copies a browser-only caption into the RockBase Studio store as an editable social post. */
  async function duplicateAsDraft() {
    const { workspaceId: ws, brandKey } = useAppStore.getState().context
    if (!ws) { setSaveError('No workspace is selected, so RockBase has nowhere to store the copy.'); return }
    try {
      const { data } = await studioApi.create({ workspaceId: ws, format: 'social_post', brandKey: brandKey || null, title, body, source: { kind: 'caption_copy' } })
      navigate(`/studio/s/${encodeURIComponent(data.draft.id)}?workspace_id=${encodeURIComponent(ws)}&new=1`)
    } catch (e) { setSaveError(errorText(e, 'The copy could not be created. The caption is unchanged.')) }
  }

  if (loadError) return <div className="max-w-2xl space-y-4"><BackLink /><Notice tone="error">{loadError}</Notice></div>
  if (!doc) return <div className="space-y-4"><BackLink /><div className="h-96 animate-pulse rounded-lg bg-secondary/40" /></div>

  const p = doc.provenance
  const classification = typeof p?.classification === 'string' ? p.classification : null
  const evidence = Array.isArray(p?.evidence) ? p!.evidence as unknown[] : []
  const composeHandoff = doc.distribution?.handoffs.find((h) => h.channel === 'compose')
  const postRefs = doc.distribution?.posts ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          {kind === 'studio' && <StatusTag status={status} />}
          <span className={cn('text-xs', saveError ? 'text-oxide' : dirty ? 'text-ochre' : 'text-muted-foreground')} aria-live="polite">
            {saving ? 'Saving…' : saveError ? 'Not saved' : dirty ? 'Unsaved changes' : doc.updatedAt ? `Saved ${ago(doc.updatedAt)}` : 'Saved'}
          </span>
          {kind !== 'caption' && !archived && <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save</Button>}
        </div>
      </div>

      {justCreated && kind === 'radar' && <Notice tone="ok">Draft created from Radar and saved in RockBase. Its evidence is attached on the right and can't be edited away.</Notice>}
      {justCreated && kind === 'studio' && <Notice tone="ok">Draft created and saved in RockBase. It opens from any browser that can reach this workspace.</Notice>}
      {kind === 'note' && movedTo && <Notice action={<Button size="sm" variant="outline" asChild><Link to={`/studio/s/${encodeURIComponent(movedTo.id)}?workspace_id=${encodeURIComponent(movedTo.workspaceId)}`}>Open RockBase copy</Link></Button>}>This browser copy was moved to RockBase {ago(movedTo.movedAt)}. Edits here stay in this browser and are not sent to the RockBase copy.</Notice>}
      {archived && (
        <Notice tone="warn" action={<Button size="sm" variant="outline" disabled={saving} onClick={() => moveStatus('draft')}>{saving ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}Restore draft</Button>}>
          Archived {doc.statusChangedAt ? ago(doc.statusChangedAt) : 'earlier'}. Archived drafts are read-only so a closed draft can't be edited by accident. Nothing was deleted.
        </Notice>
      )}
      {saveError && <Notice tone="error">{saveError}</Notice>}

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <article className="min-w-0">
          <p className="eyebrow">{formatLabel[doc.format]} · {stored ? 'RockBase' : <span className="text-ochre">this browser only</span>}</p>
          {kind === 'caption' ? <h1 className="font-display mt-3 text-3xl font-semibold">{title}</h1> : (
            <textarea aria-label="Title" rows={1} value={title} readOnly={archived} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} placeholder="Untitled"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              className="font-display mt-3 block w-full resize-none bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-muted-foreground/50 md:text-4xl" />
          )}
          <div className="mt-6 border-t border-border pt-6">
            <textarea ref={area} aria-label="Draft body" value={body} readOnly={kind === 'caption' || archived} onChange={(e) => setBody(e.target.value)}
              placeholder={doc.format === 'article' ? 'Angle, outline, sources…' : 'Write the caption…'}
              className="w-full max-w-[72ch] resize-none bg-transparent text-[15px] leading-7 text-foreground/95 outline-none placeholder:text-muted-foreground/50" />
          </div>
          <p className="font-data mt-4 text-[11px] text-muted-foreground">{words} words · {body.length} characters{kind !== 'caption' && !archived && ' · Ctrl+S saves'}</p>
        </article>

        <aside className="min-w-0 space-y-8 xl:sticky xl:top-8 xl:h-fit">
          {kind === 'studio' && (
            <section className="space-y-3">
              <SectionTitle aside={<span className="text-[11px] text-muted-foreground">{saving ? 'Saving…' : 'Saved as you move'}</span>}>Review</SectionTitle>
              <p className="-mt-1 text-xs text-muted-foreground">{statusHint[status]} A status change saves the text above in the same request.</p>
              <div className="flex flex-wrap gap-2">
                {NEXT_STATUS[status].map((action) => (
                  <Button key={action.to} size="sm" variant={action.to === 'archived' ? 'ghost' : action.to === 'ready' ? 'default' : 'outline'}
                    disabled={saving} onClick={() => moveStatus(action.to)}>
                    {action.to === 'archived' ? <Archive /> : action.to === 'draft' && status === 'archived' ? <ArchiveRestore /> : null}
                    {action.label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <SectionTitle>Next step</SectionTitle>
            {doc.format === 'article' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy Markdown'}</Button>
                  <Button size="sm" variant="outline" onClick={() => downloadMarkdown(`${title || 'draft'}.md`, markdown)}><Download />Download .md</Button>
                </div>
                <p className="text-xs text-muted-foreground">RockBase doesn't publish articles — there is no CMS connection. Export the brief and publish it in your site's editor, then rescan in Site &amp; Search.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {kind === 'radar' ? (
                  <Button size="sm" asChild><Link to={`/compose?draftId=${encodeURIComponent(id)}&workspace_id=${encodeURIComponent(workspaceId)}`}><SendHorizontal />Continue in Compose</Link></Button>
                ) : kind === 'studio' ? (
                  <div className="space-y-2">
                    <Button size="sm" variant={status === 'ready' ? 'default' : 'outline'} disabled={handingOff || archived} onClick={continueInCompose}>
                      {handingOff ? <Loader2 className="animate-spin" /> : <SendHorizontal />}Continue in Compose
                    </Button>
                    <EffectTag effect="local">Opens Compose with this draft · nothing posts until you start a post there</EffectTag>
                    {composeHandoff && <p className="text-[11px] text-muted-foreground">Opened in Compose {ago(composeHandoff.at)}{composeHandoff.count > 1 ? ` · ${composeHandoff.count}×` : ''}. Recorded in RockBase; not a publication.</p>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy text'}</Button>
                    <Button size="sm" asChild><Link to="/compose"><SendHorizontal />Open Compose</Link></Button>
                  </div>
                )}
                {kind !== 'studio' && <EffectTag effect="local">Opens Compose · nothing posts until you start a post</EffectTag>}
                {kind === 'caption' && <button onClick={duplicateAsDraft} className="block text-xs text-patina underline-offset-2 hover:underline">Copy into RockBase as an editable draft</button>}
              </div>
            )}
          </section>

          {kind !== 'caption' && (
            <section className="space-y-3">
              <SectionTitle>Before you export</SectionTitle>
              <ul className="space-y-1.5 text-sm">{checks.map((c) => <li key={c.label} className={cn('flex items-center gap-2', c.ok ? 'text-foreground/90' : 'text-muted-foreground')}><span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', c.ok ? 'border-patina bg-patina/15 text-patina' : 'border-border')}>{c.ok && <Check className="h-2.5 w-2.5" />}</span>{c.label}</li>)}</ul>
              <p className="text-[11px] text-muted-foreground">A checklist, not a quality score.</p>
            </section>
          )}

          {kind === 'studio' && (
            <section className="space-y-3">
              <SectionTitle aside={postRefs.length > 0 ? <Link to="/queue" className="text-muted-foreground hover:text-foreground">Queue</Link> : undefined}>Distribution</SectionTitle>
              {postRefs.length === 0 ? (
                <Void reason="No post is linked to this draft yet. Links appear only after Compose has queued a post, so nothing is claimed in advance." />
              ) : (
                <div className="space-y-2">
                  <ul className="space-y-1.5 text-[13px]">
                    {postRefs.map((ref) => (
                      <li key={ref.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <span title={ref.id} className="font-data text-[11px] text-muted-foreground">{ref.id.slice(0, 8)}…</span>
                        <span className="text-xs">{ref.status}</span>
                        <span className="text-[11px] text-muted-foreground">{ago(ref.at)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">Queue or publish state as recorded when the post was linked. This is not engagement, reach or conversion.</p>
                  <Link to="/activity" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">See the activity log<ExternalLink className="h-3 w-3" /></Link>
                </div>
              )}
            </section>
          )}

          <section className="space-y-3">
            <SectionTitle>Where this came from</SectionTitle>
            {kind === 'radar' && p ? (
              <div className="space-y-3 text-sm">
                {classification && <GradeTag grade={classGrade[classification] ?? 'idea'}>{classLabel[classification] ?? classification}</GradeTag>}
                <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-muted-foreground">Source</dt><dd>{String(p.source ?? 'Radar')}</dd>
                  {typeof p.topic === 'string' && <><dt className="text-muted-foreground">Topic</dt><dd>{p.topic}</dd></>}
                  {typeof p.brandKey === 'string' && <><dt className="text-muted-foreground">Brand</dt><dd>{p.brandKey}</dd></>}
                  {typeof p.reason === 'string' && <><dt className="text-muted-foreground">Reason</dt><dd className="text-muted-foreground">{p.reason}</dd></>}
                  {doc.createdAt && <><dt className="text-muted-foreground">Created</dt><dd>{new Date(doc.createdAt).toLocaleString()}</dd></>}
                </dl>
                <EvidenceList evidence={evidence} />
                {typeof p.topic === 'string' && <Link to={`/trends?q=${encodeURIComponent(p.topic)}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">See current evidence in Radar<ExternalLink className="h-3 w-3" /></Link>}
                <p className="text-[11px] text-muted-foreground">Provenance is kept by RockBase and is never added to exported or posted text.</p>
              </div>
            ) : kind === 'caption' ? <p className="text-sm text-muted-foreground">Generated with the Caption assistant{p?.platform ? ` for ${String(p.platform)}` : ''}. Stored in this browser.</p>
              : kind === 'studio' ? (
                <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-muted-foreground">Store</dt><dd>RockBase · this workspace</dd>
                  <dt className="text-muted-foreground">Source</dt><dd>{doc.source?.label ?? 'Written in RockBase Studio'}</dd>
                  {doc.source?.kind === 'competitor_finding' && <><dt className="text-muted-foreground">Evidence</dt><dd className="min-w-0 space-y-2"><p>{doc.source.evidence?.category} · observed {doc.source.evidence?.observedAt || 'unknown'}</p>{doc.source.evidence?.sourceUrls.map(url => <a key={url} href={/^https?:\/\//i.test(url)?url:undefined} target="_blank" rel="noreferrer" className="block break-all text-patina underline">{url}</a>)}<Link className="inline-block text-patina underline" to={`/seo?tab=competitors&competitor=${doc.source.competitorId}&competitor_scan=${doc.source.scanId}&finding=${doc.source.findingId}&workspace_id=${encodeURIComponent(doc.workspaceId || '')}&brand_key=${encodeURIComponent(doc.brandKey || '')}&from=today`}>Review original observation</Link><p className="text-xs text-muted-foreground">Evidence is a reference, not original copy or proof of audience demand. Write original expertise.</p></dd></>}
                  {doc.source?.browserCreatedAt && <><dt className="text-muted-foreground">Written</dt><dd>{new Date(doc.source.browserCreatedAt).toLocaleString()} (in a browser)</dd></>}
                  {doc.source?.movedAt && <><dt className="text-muted-foreground">Moved</dt><dd>{new Date(doc.source.movedAt).toLocaleString()}</dd></>}
                  <dt className="text-muted-foreground">Brand</dt><dd>{doc.brandKey ?? 'No brand'}</dd>
                  {doc.statusChangedAt && <><dt className="text-muted-foreground">Status since</dt><dd>{new Date(doc.statusChangedAt).toLocaleString()}</dd></>}
                </dl>
              )
              : <Void reason="Written from scratch — no research attached." />}
          </section>

          {kind === 'note' && (
            <button onClick={() => { if (window.confirm('Delete this browser draft? This cannot be undone.')) { deleteStudioNote(id); navigate('/studio') } }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-oxide"><Trash2 className="h-3.5 w-3.5" />Delete draft</button>
          )}
        </aside>
      </div>

      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
          <div className="w-full max-w-sm animate-sheet-up rounded-xl border border-border bg-popover p-5">
            <p id="unsaved-title" className="font-display text-lg font-semibold">Leave without saving?</p>
            <p className="mt-1 text-sm text-muted-foreground">Your edits to this draft haven't been saved.</p>
            <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => blocker.reset?.()}>Keep editing</Button><Button variant="destructive" onClick={() => blocker.proceed?.()}>Discard changes</Button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function BackLink() {
  return <Link to="/studio" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Studio</Link>
}
