import type { CompetitorPage } from './competitors'

/** Stored observations only; no inferred Google indexing or deleted-page state. */
export function successfulPage(page: CompetitorPage): boolean {
  if (typeof page.successful_html === 'boolean') return page.successful_html
  return typeof page.status_code === 'number' && page.status_code >= 200 && page.status_code < 300 && !page.error && /html/i.test(page.content_type || '') && !/captcha|just a moment|access denied|verify you are human|checking your browser/i.test(page.title || '')
}
export type PageFilter = 'all' | 'successful' | 'unavailable' | 'metadata' | 'nonindexable'
export function filterSnapshotPages(pages: CompetitorPage[], search: string, filter: PageFilter) {
  const query = search.trim().toLocaleLowerCase()
  return pages.filter(p => {
    const ok = successfulPage(p)
    if (filter === 'successful' && !ok || filter === 'unavailable' && ok) return false
    if (filter === 'metadata' && (!ok || ![p.title === '', p.description === '', Array.isArray(p.h1) && p.h1.length !== 1].some(Boolean))) return false
    if (filter === 'nonindexable' && (!ok || p.indexable !== false)) return false
    return !query || [p.url,p.title,p.description,p.canonical,...(p.h1 || []),...(p.headings || []).map(h=>h.text)].some(v => (v || '').toLocaleLowerCase().includes(query))
  })
}
export function linkDelta(before: unknown, after: unknown) {
  if (!Array.isArray(before) || !Array.isArray(after) || [...before,...after].some(v=>typeof v!=='string')) return null
  const a = new Set<string>(before), b = new Set<string>(after)
  return {added:[...b].filter(u=>!a.has(u)).sort(),removed:[...a].filter(u=>!b.has(u)).sort(),unchanged:[...a].filter(u=>b.has(u)).sort()}
}
export function observationTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Observation time unknown'
  return new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})
}
