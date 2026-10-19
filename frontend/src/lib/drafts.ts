import api from '@/lib/api'
import { trendsApi, type TrendDraftSummary } from '@/components/trends/api'

/**
 * Studio library — one view over drafts that live in different places.
 *
 * Persistence is only partly unified, and the UI says so:
 *   rockbase  Prisma Draft rows, workspace-scoped:
 *             - Radar briefs (/api/trends/drafts, Local Mode only, evidence attached)
 *             - Studio drafts (/api/studio/drafts, Local and Server Mode)
 *   browser   Caption assistant drafts, Studio notes written before the server
 *             store existed, and legacy Content Planner seeds — localStorage only
 */
export type DraftStore = 'rockbase' | 'browser'
export type DraftOrigin = 'radar' | 'ai-writer' | 'studio' | 'content-planner'
export type DraftFormat = 'article' | 'social_post' | 'reel' | 'caption'

export interface LibraryDraft {
  key: string
  id: string
  store: DraftStore
  origin: DraftOrigin
  format: DraftFormat
  title: string
  excerpt: string
  updatedAt: string
  topic?: string | null
  classification?: string | null
  platform?: string | null
  /** Brand the draft belongs to; null means not assigned to a brand. */
  brandKey?: string | null
}

export const PROVENANCE_SEPARATOR = '\n\n---\nProvenance (review, not a publication claim):\n'

export function splitProvenance(content: string): { body: string; provenance: Record<string, unknown> | null; raw: string } {
  const index = content.indexOf(PROVENANCE_SEPARATOR)
  if (index < 0) return { body: content, provenance: null, raw: '' }
  const raw = content.slice(index + PROVENANCE_SEPARATOR.length)
  try { return { body: content.slice(0, index), provenance: JSON.parse(raw), raw } } catch { return { body: content.slice(0, index), provenance: null, raw } }
}

export const formatLabel: Record<DraftFormat, string> = { article: 'Article brief', social_post: 'Social post', reel: 'Reel script', caption: 'Caption' }
export const originLabel: Record<DraftOrigin, string> = { radar: 'From Radar', 'ai-writer': 'Caption assistant', studio: 'Studio note', 'content-planner': 'Content Planner (legacy)' }
export const isSocial = (format: DraftFormat) => format !== 'article'

/* Browser-only stores ──────────────────────────────────────────────────── */
const STUDIO_KEY = 'rockbase.studio.drafts'
const AI_WRITER_KEY = 'sc_drafts'
const PLANNER_KEY = 'rockbase.contentPlanner.composeDrafts'

export interface StudioNote { id: string; title: string; body: string; format: DraftFormat; createdAt: string; updatedAt: string; brandKey?: string | null }
interface AiWriterDraft { id: string; caption: string; platform?: string; tone?: string; topic?: string; createdAt: string }

function readJson<T>(key: string): T[] {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] }
}

export function studioNotes(): StudioNote[] { return readJson<StudioNote>(STUDIO_KEY).filter((n) => n && typeof n.id === 'string' && typeof n.body === 'string') }
export function saveStudioNote(note: StudioNote) {
  const rest = studioNotes().filter((n) => n.id !== note.id)
  localStorage.setItem(STUDIO_KEY, JSON.stringify([note, ...rest].slice(0, 200)))
}
export function deleteStudioNote(id: string) { localStorage.setItem(STUDIO_KEY, JSON.stringify(studioNotes().filter((n) => n.id !== id))) }
export function aiWriterDraft(id: string): AiWriterDraft | undefined { return readJson<AiWriterDraft>(AI_WRITER_KEY).find((d) => d?.id === id) }
export function newNoteId() { return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }

/* Server store for Studio drafts ───────────────────────────────────────── */
export type StudioFormat = Exclude<DraftFormat, 'caption'>
export type StudioSource =
  | { kind: 'blank' }
  | { kind: 'caption_copy' }
  | { kind: 'browser_import'; browser_id: string; browser_created_at?: string }
export interface StudioDraft {
  id: string; workspaceId: string; title: string; body: string; format: StudioFormat; brandKey: string | null
  /** Written by the server, never by the client. */
  source: { kind: string; label?: string; browserId?: string; browserCreatedAt?: string; movedAt?: string }
  createdAt: string; updatedAt: string
}
export type StudioDraftSummary = Omit<StudioDraft, 'body'> & { excerpt: string }

export const studioApi = {
  list: (workspaceId: string, signal?: AbortSignal) => api.get<{ drafts: StudioDraftSummary[] }>('/studio/drafts', { params: { workspace_id: workspaceId }, signal }),
  get: (id: string, workspaceId: string) => api.get<{ draft: StudioDraft }>(`/studio/drafts/${encodeURIComponent(id)}`, { params: { workspace_id: workspaceId } }),
  create: (input: { workspaceId: string; format: StudioFormat; brandKey?: string | null; title?: string; body?: string; source: StudioSource }) =>
    api.post<{ draft: StudioDraft }>('/studio/drafts', { workspace_id: input.workspaceId, format: input.format, brand_key: input.brandKey || null, title: input.title, body: input.body, source: input.source }),
  /** Title and body only; the server keeps format, brand and source. */
  update: (id: string, workspaceId: string, body: { title?: string; body: string }) =>
    api.patch<{ draft: StudioDraft }>(`/studio/drafts/${encodeURIComponent(id)}`, { workspace_id: workspaceId, ...body }),
}

/* Moving browser notes to RockBase ──────────────────────────────────────
 * A moved note keeps its browser original until the operator removes it. The
 * marker hides the original from the library (the RockBase copy is listed) and
 * makes the offer one-time; the server move is idempotent per workspace + note.
 */
const MOVED_KEY = 'rockbase.studio.moved'
export interface MovedMarker { id: string; workspaceId: string; movedAt: string }
export function movedNotes(): Record<string, MovedMarker> {
  try { const value = JSON.parse(localStorage.getItem(MOVED_KEY) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
const writeMoved = (value: Record<string, MovedMarker>) => localStorage.setItem(MOVED_KEY, JSON.stringify(value))
/** Browser notes not yet moved to RockBase. */
export const unmovedNotes = () => { const moved = movedNotes(); return studioNotes().filter((n) => !moved[n.id]) }
/** Browser originals of notes already moved, still kept as a backup. */
export const movedOriginals = () => { const moved = movedNotes(); return studioNotes().filter((n) => moved[n.id]) }

export async function moveNotesToRockBase(workspaceId: string, notes: StudioNote[]) {
  const failed: Array<{ note: StudioNote; error: string }> = []
  let moved = 0
  for (const note of notes) {
    try {
      const { data } = await studioApi.create({
        workspaceId, format: note.format === 'caption' ? 'social_post' : note.format, brandKey: note.brandKey ?? null, title: note.title, body: note.body,
        source: { kind: 'browser_import', browser_id: note.id, browser_created_at: note.createdAt },
      })
      writeMoved({ ...movedNotes(), [note.id]: { id: data.draft.id, workspaceId, movedAt: new Date().toISOString() } })
      moved++
    } catch (error) { failed.push({ note, error: errorMessage(error, 'Not moved.') }) }
  }
  return { moved, failed }
}
/** Deletes browser originals of moved notes only; the RockBase copies are untouched. */
export function removeMovedOriginals() {
  for (const note of movedOriginals()) deleteStudioNote(note.id)
}

export function browserDrafts(): LibraryDraft[] {
  const notes = unmovedNotes().map<LibraryDraft>((n) => ({ key: `studio:${n.id}`, id: n.id, store: 'browser', origin: 'studio', format: n.format, title: n.title || 'Untitled', excerpt: excerpt(n.body), updatedAt: n.updatedAt, brandKey: n.brandKey ?? null }))
  const writer = readJson<AiWriterDraft>(AI_WRITER_KEY).filter((d) => d && typeof d.caption === 'string').map<LibraryDraft>((d) => ({
    key: `ai:${d.id}`, id: d.id, store: 'browser', origin: 'ai-writer', format: 'caption', title: d.topic || 'Untitled caption', excerpt: excerpt(d.caption), updatedAt: d.createdAt, platform: d.platform ?? null,
  }))
  const planner = readJson<Record<string, unknown>>(PLANNER_KEY).filter((d) => d?.source === 'content-planner' && typeof d.captionSeed === 'string').map<LibraryDraft>((d, i) => ({
    key: `planner:${i}`, id: String(i), store: 'browser', origin: 'content-planner', format: 'caption', title: String(d.materialTopic || d.angle || 'Planner seed'), excerpt: excerpt(String(d.captionSeed)), updatedAt: '', platform: null,
  }))
  return [...notes, ...writer, ...planner]
}

export function studioToLibrary(d: StudioDraftSummary): LibraryDraft {
  return { key: `rb-studio:${d.id}`, id: d.id, store: 'rockbase', origin: 'studio', format: d.format, title: d.title || 'Untitled', excerpt: d.excerpt, updatedAt: d.updatedAt, brandKey: d.brandKey }
}

export function trendToLibrary(d: TrendDraftSummary): LibraryDraft {
  return { key: `radar:${d.id}`, id: d.id, store: 'rockbase', origin: 'radar', format: d.format, title: d.title || 'Untitled brief', excerpt: d.excerpt, updatedAt: d.updatedAt, topic: d.topic, classification: d.classification, brandKey: d.brandKey }
}

/** Brand isolation: with a brand in scope, show its drafts plus drafts that have no brand. */
export function scopeDrafts(list: LibraryDraft[], brandKey: string) {
  return brandKey ? list.filter((d) => !d.brandKey || d.brandKey === brandKey) : list
}

export type LibraryLoad = {
  drafts: LibraryDraft[]
  /** RockBase-stored drafts: 'error' if the Studio store or (in Local Mode) Radar failed to load. */
  rockbase: 'ok' | 'error' | 'empty'
  rockbaseError?: string
  /** Radar briefs exist only in Local Mode. */
  radar: 'ok' | 'mode' | 'error'
}

/** Loads every draft for a workspace. Each store fails independently of the others. */
export async function loadLibrary(workspaceId: string, localMode: boolean, signal?: AbortSignal): Promise<LibraryLoad> {
  const local = browserDrafts()
  if (!workspaceId) return { drafts: sortDrafts(local), rockbase: 'empty', radar: localMode ? 'ok' : 'mode' }
  const [studio, radar] = await Promise.allSettled([
    studioApi.list(workspaceId, signal),
    localMode ? trendsApi.drafts(workspaceId, signal) : Promise.resolve(null),
  ])
  const errors: string[] = []
  const drafts = [...local]
  if (studio.status === 'fulfilled') drafts.push(...studio.value.data.drafts.map(studioToLibrary))
  else errors.push(`Studio drafts: ${errorMessage(studio.reason, 'could not be loaded.')}`)
  if (radar.status === 'fulfilled') { if (radar.value) drafts.push(...radar.value.data.drafts.map(trendToLibrary)) }
  else errors.push(`Radar briefs: ${errorMessage(radar.reason, 'could not be loaded.')}`)
  return {
    drafts: sortDrafts(drafts), rockbase: errors.length ? 'error' : 'ok', rockbaseError: errors.join(' · ') || undefined,
    radar: !localMode ? 'mode' : radar.status === 'fulfilled' ? 'ok' : 'error',
  }
}

export function errorMessage(error: unknown, fallback: string) {
  const e = error as { response?: { data?: { error?: string } }; message?: string }
  return e.response?.data?.error || e.message || fallback
}

export function draftHref(d: LibraryDraft, workspaceId: string) {
  if (d.origin === 'radar') return `/studio/d/${encodeURIComponent(d.id)}?workspace_id=${encodeURIComponent(workspaceId)}`
  if (d.origin === 'studio' && d.store === 'rockbase') return `/studio/s/${encodeURIComponent(d.id)}?workspace_id=${encodeURIComponent(workspaceId)}`
  if (d.origin === 'studio') return `/studio/n/${encodeURIComponent(d.id)}`
  if (d.origin === 'ai-writer') return `/studio/c/${encodeURIComponent(d.id)}`
  return '/compose'
}

const sortDrafts = (list: LibraryDraft[]) => [...list].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
const excerpt = (text: string) => text.replace(/^#+\s*/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)

/** Saves text as a Markdown file on the operator's machine. No network. */
export function downloadMarkdown(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename.replace(/[^\w.-]+/g, '-').slice(0, 80) || 'draft.md'; a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
