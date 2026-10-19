import { trendsApi, type TrendDraftSummary } from '@/components/trends/api'

/**
 * Studio library — one view over drafts that live in different places.
 *
 * Persistence is NOT unified yet, and the UI says so:
 *   rockbase  Prisma Draft rows created from Radar (workspace-scoped, Local Mode)
 *   browser   AI Writer captions, Studio notes and legacy Content Planner seeds
 *             kept in this browser's localStorage only
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

export function browserDrafts(): LibraryDraft[] {
  const notes = studioNotes().map<LibraryDraft>((n) => ({ key: `studio:${n.id}`, id: n.id, store: 'browser', origin: 'studio', format: n.format, title: n.title || 'Untitled', excerpt: excerpt(n.body), updatedAt: n.updatedAt, brandKey: n.brandKey ?? null }))
  const writer = readJson<AiWriterDraft>(AI_WRITER_KEY).filter((d) => d && typeof d.caption === 'string').map<LibraryDraft>((d) => ({
    key: `ai:${d.id}`, id: d.id, store: 'browser', origin: 'ai-writer', format: 'caption', title: d.topic || 'Untitled caption', excerpt: excerpt(d.caption), updatedAt: d.createdAt, platform: d.platform ?? null,
  }))
  const planner = readJson<Record<string, unknown>>(PLANNER_KEY).filter((d) => d?.source === 'content-planner' && typeof d.captionSeed === 'string').map<LibraryDraft>((d, i) => ({
    key: `planner:${i}`, id: String(i), store: 'browser', origin: 'content-planner', format: 'caption', title: String(d.materialTopic || d.angle || 'Planner seed'), excerpt: excerpt(String(d.captionSeed)), updatedAt: '', platform: null,
  }))
  return [...notes, ...writer, ...planner]
}

export function trendToLibrary(d: TrendDraftSummary): LibraryDraft {
  return { key: `radar:${d.id}`, id: d.id, store: 'rockbase', origin: 'radar', format: d.format, title: d.title || 'Untitled brief', excerpt: d.excerpt, updatedAt: d.updatedAt, topic: d.topic, classification: d.classification, brandKey: d.brandKey }
}

/** Brand isolation: with a brand in scope, show its drafts plus drafts that have no brand. */
export function scopeDrafts(list: LibraryDraft[], brandKey: string) {
  return brandKey ? list.filter((d) => !d.brandKey || d.brandKey === brandKey) : list
}

export type LibraryLoad = { drafts: LibraryDraft[]; rockbase: 'ok' | 'error' | 'mode' | 'empty'; rockbaseError?: string }

/** Loads every draft for a workspace. RockBase drafts fail independently of browser drafts. */
export async function loadLibrary(workspaceId: string, localMode: boolean, signal?: AbortSignal): Promise<LibraryLoad> {
  const local = browserDrafts()
  if (!localMode) return { drafts: sortDrafts(local), rockbase: 'mode' }
  if (!workspaceId) return { drafts: sortDrafts(local), rockbase: 'empty' }
  try {
    const { data } = await trendsApi.drafts(workspaceId, signal)
    return { drafts: sortDrafts([...data.drafts.map(trendToLibrary), ...local]), rockbase: 'ok' }
  } catch (error) {
    const e = error as { response?: { data?: { error?: string } }; message?: string }
    return { drafts: sortDrafts(local), rockbase: 'error', rockbaseError: e.response?.data?.error || e.message || 'Could not load RockBase drafts.' }
  }
}

export function draftHref(d: LibraryDraft, workspaceId: string) {
  if (d.origin === 'radar') return `/studio/d/${encodeURIComponent(d.id)}?workspace_id=${encodeURIComponent(workspaceId)}`
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
