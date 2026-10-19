import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Download, ExternalLink, Loader2, Save, SendHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EffectTag, GradeTag, Notice, SectionTitle, Void, ago, type Grade } from '@/components/growth/grammar'
import { EvidenceList } from '@/components/trends/Evidence'
import { trendsApi } from '@/components/trends/api'
import { aiWriterDraft, deleteStudioNote, downloadMarkdown, formatLabel, isSocial, newNoteId, saveStudioNote, splitProvenance, studioNotes, type DraftFormat } from '@/lib/drafts'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

type Kind = 'radar' | 'note' | 'caption'
interface Doc { title: string; body: string; format: DraftFormat; updatedAt?: string; brandKey?: string | null; provenance: Record<string, unknown> | null; workspaceId?: string; createdAt?: string }

const classGrade: Record<string, Grade> = { gsc_opportunity: 'measured', rising_trend: 'observed', trend_observation: 'observed', content_idea: 'idea' }
const classLabel: Record<string, string> = { gsc_opportunity: 'Search Console opportunity', rising_trend: 'Observed source increase', trend_observation: 'Trending Now observation', content_idea: 'Editorial idea · no trend evidence' }
const PLACEHOLDERS = /\b(working title|todo|tbd|lorem ipsum|\[insert)/i

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
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDoc(null); setLoadError('')
    if (kind === 'radar') {
      if (!workspaceId) { setLoadError('This link is missing its workspace.'); return }
      trendsApi.draft(id, workspaceId).then(({ data }) => {
        const { body, provenance } = splitProvenance(data.draft.content)
        const format = (typeof provenance?.format === 'string' ? provenance.format : 'article') as DraftFormat
        setDoc({ title: data.draft.title || '', body, format, provenance, updatedAt: data.draft.updatedAt, createdAt: data.draft.createdAt, workspaceId: data.draft.workspaceId })
      }).catch((e) => setLoadError(errorText(e, 'Draft could not be loaded.')))
    } else if (kind === 'note') {
      const note = studioNotes().find((n) => n.id === id)
      if (!note) setLoadError('This draft is not in this browser. Browser drafts do not sync between computers.')
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

  const save = useCallback(async () => {
    if (!doc || !dirty || saving) return
    setSaving(true); setSaveError('')
    try {
      if (kind === 'radar') {
        const { data } = await trendsApi.updateDraft(id, workspaceId, { body, ...(title.trim() ? { title: title.trim() } : {}) })
        const next = splitProvenance(data.draft.content)
        setDoc((d) => d && { ...d, title: data.draft.title || '', body: next.body, updatedAt: data.draft.updatedAt })
      } else {
        const at = new Date().toISOString()
        saveStudioNote({ id, title, body, format: doc.format, createdAt: doc.createdAt || at, updatedAt: at, brandKey: doc.brandKey ?? null })
        setDoc((d) => d && { ...d, title, body, updatedAt: at })
      }
    } catch (e) { setSaveError(errorText(e, 'Not saved. Your text is still here — try again.')) }
    finally { setSaving(false) }
  }, [doc, dirty, saving, kind, id, workspaceId, body, title])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight, 420)}px` } }, [body, doc])

  const words = useMemo(() => body.trim() ? body.trim().split(/\s+/).length : 0, [body])
  const markdown = `# ${title || 'Untitled'}\n\n${body}`
  const checks = [
    { ok: Boolean(title.trim()), label: 'Has a title' },
    { ok: !PLACEHOLDERS.test(`${title}\n${body}`), label: 'No template placeholders left' },
    { ok: doc?.format === 'article' ? words >= 150 : words >= 5, label: doc?.format === 'article' ? 'At least 150 words' : 'Not empty' },
    { ok: !dirty, label: 'All changes saved' },
  ]

  async function copy() {
    try { await navigator.clipboard.writeText(isSocial(doc!.format) ? body : markdown); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setSaveError('Clipboard is unavailable in this browser. Select the text and copy it manually.') }
  }
  function duplicateAsNote() {
    const nid = newNoteId(); const at = new Date().toISOString()
    saveStudioNote({ id: nid, title, body, format: 'social_post', createdAt: at, updatedAt: at, brandKey: useAppStore.getState().context.brandKey || null })
    navigate(`/studio/n/${nid}`)
  }

  if (loadError) return <div className="max-w-2xl space-y-4"><BackLink /><Notice tone="error">{loadError}</Notice></div>
  if (!doc) return <div className="space-y-4"><BackLink /><div className="h-96 animate-pulse rounded-lg bg-secondary/40" /></div>

  const p = doc.provenance
  const classification = typeof p?.classification === 'string' ? p.classification : null
  const evidence = Array.isArray(p?.evidence) ? p!.evidence as unknown[] : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn('text-xs', saveError ? 'text-oxide' : dirty ? 'text-ochre' : 'text-muted-foreground')} aria-live="polite">
            {saving ? 'Saving…' : saveError ? 'Not saved' : dirty ? 'Unsaved changes' : doc.updatedAt ? `Saved ${ago(doc.updatedAt)}` : 'Saved'}
          </span>
          {kind !== 'caption' && <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save</Button>}
        </div>
      </div>

      {justCreated && kind === 'radar' && <Notice tone="ok">Draft created from Radar and saved in RockBase. Its evidence is attached on the right and can't be edited away.</Notice>}
      {saveError && <Notice tone="error">{saveError}</Notice>}

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <article className="min-w-0">
          <p className="eyebrow">{formatLabel[doc.format]} · {kind === 'radar' ? 'RockBase' : <span className="text-ochre">this browser only</span>}</p>
          {kind === 'caption' ? <h1 className="font-display mt-3 text-3xl font-semibold">{title}</h1> : (
            <textarea aria-label="Title" rows={1} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} placeholder="Untitled"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              className="font-display mt-3 block w-full resize-none bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-muted-foreground/50 md:text-4xl" />
          )}
          <div className="mt-6 border-t border-border pt-6">
            <textarea ref={area} aria-label="Draft body" value={body} readOnly={kind === 'caption'} onChange={(e) => setBody(e.target.value)}
              placeholder={doc.format === 'article' ? 'Angle, outline, sources…' : 'Write the caption…'}
              className="w-full max-w-[72ch] resize-none bg-transparent text-[15px] leading-7 text-foreground/95 outline-none placeholder:text-muted-foreground/50" />
          </div>
          <p className="font-data mt-4 text-[11px] text-muted-foreground">{words} words · {body.length} characters{kind !== 'caption' && ' · Ctrl+S saves'}</p>
        </article>

        <aside className="min-w-0 space-y-8 xl:sticky xl:top-8 xl:h-fit">
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
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy text'}</Button>
                    <Button size="sm" asChild><Link to="/compose"><SendHorizontal />Open Compose</Link></Button>
                  </div>
                )}
                <EffectTag effect="local">Opens Compose · nothing posts until you start a post</EffectTag>
                {kind === 'caption' && <button onClick={duplicateAsNote} className="block text-xs text-patina underline-offset-2 hover:underline">Duplicate as an editable draft</button>}
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
