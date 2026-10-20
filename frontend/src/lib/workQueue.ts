import type { Grade } from '@/components/growth/grammar'
import type { IssueGroup } from '@/components/seo/api'
import type { GscReport } from '@/components/seo/gscApi'
import type { TrendRadar } from '@/components/trends/api'
import type { StudioDraftSummary } from '@/lib/drafts'
import type { CompetitorReport } from '@/lib/competitors'

/** Pure, deterministic daily work queue. No network, AI, writes or completion state. */
export interface WorkScope { workspaceId: string; brandKey: string; brandName: string; websiteId?: string; scanId?: string }
export interface WorkItem {
  id: string; scope: WorkScope
  kind: 'fix' | 'search' | 'radar' | 'studio' | 'operations' | 'competitor'
  category: string; grade: Grade; title: string; why: string; evidence: string[]
  observedAt: string | null; freshness: 'current' | 'stale' | 'unknown'; source: string
  topic?: string; dedupeKey: string
  factors: { severity: number; confidence: number; freshness: number; impact: number; urgency: number }
  weight: number; primary: { label: string; to: string }; alsoIn?: string
}
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const key = (scope: WorkScope, value: string) => JSON.stringify([scope.workspaceId, scope.brandKey, value])
export function freshness(at: string | null | undefined, maxDays: number, now: number): WorkItem['freshness'] {
  const time = at ? Date.parse(at) : NaN
  if (!Number.isFinite(time) || time > now + 300000) return 'unknown'
  return now - time > maxDays * 86400000 ? 'stale' : 'current'
}
export function destination(scope: WorkScope, path: string): string {
  const [route, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('workspace_id', scope.workspaceId); params.set('brand_key', scope.brandKey); params.set('from', 'today')
  if (scope.websiteId && route === '/seo') params.set('site', scope.websiteId)
  if (scope.scanId && route === '/seo') params.set('scan', scope.scanId)
  return `${route}?${params}`
}
function item(scope: WorkScope, data: Omit<WorkItem, 'scope' | 'weight'>): WorkItem {
  return { ...data, scope, weight: Object.values(data.factors).reduce((a, b) => a + b, 0), primary: { ...data.primary, to: destination(scope, data.primary.to) } }
}
const freshPoints = (state: WorkItem['freshness']) => state === 'current' ? 15 : state === 'stale' ? -20 : -30

export function fixItems(groups: IssueGroup[], scope: WorkScope, at: string | null, now: number): WorkItem[] {
  const state = freshness(at, 30, now)
  return groups.filter(g => g.affected_count > 0 && ['issue', 'warning'].includes(g.issue_type)).map(g => item(scope, {
    id: key(scope, `fix:${scope.websiteId}:${g.code}`), kind: 'fix', dedupeKey: key(scope, `fix:${scope.websiteId}:${g.code}`),
    category: g.confidence === 'observed' ? 'Verified crawl finding' : 'SEO review candidate', grade: g.confidence === 'observed' ? 'measured' : 'observed',
    title: state === 'current' ? g.title : `Re-check cached finding: ${g.title}`,
    why: `${g.priority_reason || g.recommendation}${state !== 'current' ? ' The crawl is stale or undated; verify before making a change.' : ''}`,
    evidence: [`${g.affected_count} / ${g.eligible_count ?? '?'} crawled pages affected`, g.affected_urls[0] || g.code],
    source: 'SEO action queue', observedAt: at, freshness: state,
    factors: { severity: g.priority === 'high' ? 30 : g.priority === 'medium' ? 20 : 10, confidence: g.confidence === 'observed' ? 20 : 8, freshness: freshPoints(state), impact: Math.min(15, g.affected_count), urgency: g.priority === 'high' ? 15 : 4 },
    primary: { label: state === 'current' ? 'Review fix steps' : 'Verify crawl evidence', to: `/seo?tab=fixes&focus=${encodeURIComponent(g.code)}` },
  }))
}
export function searchItems(report: GscReport, scope: WorkScope, now: number): WorkItem[] {
  if (report.mapping.workspaceId !== scope.workspaceId || String(report.mapping.websiteId) !== scope.websiteId || (report.mapping.brandKey && report.mapping.brandKey !== scope.brandKey)) return []
  // Cache age and period end both matter: a recently downloaded old report is not fresh evidence.
  const date = report.freshness?.lastReturnedDate || report.periods.current.endDate
  const state = freshness(report.syncedAt, 7, now) === 'current' ? freshness(date, 10, now) : freshness(report.syncedAt, 7, now)
  const base = { source: 'Cached Search Console', observedAt: report.syncedAt, freshness: state }
  const rows = report.keywordOpportunities.filter(r => Number.isFinite(r.position) && Number.isFinite(r.impressions) && r.impressions > 0).map(r => item(scope, {
    ...base, id: key(scope, `gsc:${norm(r.query)}`), dedupeKey: key(scope, `topic:${norm(r.query)}`), kind: 'search', category: 'Measured search opportunity', grade: 'measured', topic: r.query,
    title: state === 'current' ? `Review search opportunity: ${r.query}` : `Verify older search evidence: ${r.query}`,
    why: `${r.reason} ${r.confidence === 'low_volume' ? 'Low volume: not a growth claim.' : ''} ${state !== 'current' ? 'Refresh is an explicit operator action in Search, not automatic.' : ''}`.trim(),
    evidence: [`Position ${r.position.toFixed(1)} · ${r.impressions} impressions · ${r.clicks} clicks`, `${report.periods.current.startDate} – ${report.periods.current.endDate}`],
    factors: { severity: 15, confidence: r.confidence === 'low_volume' ? 5 : 20, freshness: freshPoints(state), impact: r.impressions >= 100 ? 15 : 6, urgency: 5 },
    primary: { label: 'Inspect Search evidence', to: `/seo?tab=search&q=${encodeURIComponent(r.query)}` },
  }))
  const current = report.totals.current, previous = report.totals.previous
  const periodDays = (p: {startDate: string; endDate: string}) => (Date.parse(p.endDate) - Date.parse(p.startDate)) / 86400000 + 1
  const days = periodDays(report.periods.current)
  const comparable = Number.isFinite(days) && days > 0 && days === periodDays(report.periods.previous) && Date.parse(report.periods.previous.endDate) < Date.parse(report.periods.current.startDate)
  if (comparable && current && previous && Number.isFinite(current.clicks) && previous.clicks >= 10 && current.clicks < previous.clicks) rows.push(item(scope, {
    ...base, id: key(scope, `gsc-change:${scope.websiteId}`), dedupeKey: key(scope, `gsc-change:${scope.websiteId}`), kind: 'search', category: 'Measured GSC change', grade: 'measured',
    title: state === 'current' ? 'Investigate lower search clicks' : 'Verify older search-click comparison',
    why: 'Clicks are lower in the cached equal-length periods. This does not identify a cause or measure conversions.',
    evidence: [`${current.clicks} clicks vs ${previous.clicks} previously (${current.clicks - previous.clicks})`, `${report.periods.current.startDate} – ${report.periods.current.endDate}; prior ${report.periods.previous.startDate} – ${report.periods.previous.endDate}`],
    factors: { severity: 22, confidence: 20, freshness: freshPoints(state), impact: Math.min(15, Math.round((previous.clicks-current.clicks) / previous.clicks * 15)), urgency: 10 },
    primary: { label: 'Inspect comparison', to: '/seo?tab=search' },
  }))
  return rows
}
export function radarItems(radar: TrendRadar, scope: WorkScope, now: number): WorkItem[] {
  if (radar.brandKey !== scope.brandKey) return []
  return radar.candidates.filter(c => c.brandKey === scope.brandKey).map(c => {
    const gsc = c.classification === 'gsc_opportunity', idea = c.classification === 'content_idea'
    const ev = c.evidence.find(e => e.type === (gsc ? 'google_search_console_cached' : 'google_trends_rss'))
    const at = gsc ? typeof ev?.syncedAt === 'string' ? ev.syncedAt : null : idea ? radar.watchlist.updatedAt : typeof ev?.fetchedAt === 'string' ? ev.fetchedAt : radar.source.lastGood?.fetchedAt ?? null
    let state = freshness(at, gsc ? 7 : idea ? 30 : 2, now)
    if (gsc && state === 'current') {
      const periods = ev?.periods as GscReport['periods'] | undefined
      state = freshness(periods?.current?.endDate, 10, now)
    }
    return item(scope, {
      id: key(scope, `radar:${c.id}`), dedupeKey: key(scope, `topic:${norm(c.topic)}`), topic: c.topic, kind: 'radar',
      category: gsc ? 'Cached GSC observation' : idea ? 'Editorial idea' : 'Public trend observation', grade: gsc ? 'measured' : idea ? 'idea' : 'observed',
      title: `${state !== 'current' ? 'Re-check' : 'Review'} ${idea ? 'idea' : 'evidence'}: ${c.topic}`,
      why: `${c.reason} ${c.momentum.caveat || ''} ${idea ? 'Watchlist idea only; no measured audience demand.' : 'Not a forecast of brand reach or conversion.'}`.trim(),
      evidence: [c.signal?.basis || c.relevance.matchedTerms.join(', ') || 'Brand watchlist', `Classification: ${c.classification}`],
      observedAt: at, freshness: state, source: gsc ? 'Radar / cached GSC' : idea ? 'Radar / watchlist' : 'Radar / cached public feed',
      factors: { severity: idea ? 2 : 10, confidence: idea ? 2 : gsc && c.signal?.confidence !== 'low_volume' ? 18 : 8, freshness: freshPoints(state), impact: idea ? 3 : 8, urgency: idea ? 0 : 8 },
      primary: { label: 'Review Radar evidence', to: `/trends?focus=${encodeURIComponent(c.id)}` },
    })
  })
}
export function studioItems(drafts: StudioDraftSummary[], scope: WorkScope, now: number): WorkItem[] {
  return drafts.filter(d => d.workspaceId === scope.workspaceId && (d.brandKey || '') === scope.brandKey && d.status !== 'archived').map(d => {
    const linked = d.distribution.posts.length
    const state = freshness(d.updatedAt, 30, now)
    const waiting = freshness(d.statusChangedAt || d.updatedAt, 3, now) === 'stale'
    return item(scope, {
      id: key(scope, `draft:${d.id}`), dedupeKey: key(scope, `draft:${d.id}`), kind: 'studio',
      category: d.status === 'ready' ? 'Ready editorial draft' : d.status === 'in_review' ? 'Editorial review' : 'Editorial work in progress', grade: 'idea',
      title: `${linked ? 'Review distribution for' : d.status === 'ready' ? 'Prepare distribution for' : d.status === 'in_review' ? 'Review' : 'Continue'}: ${d.title || 'Untitled draft'}`,
      why: linked ? `${linked} verified Post reference(s) already attached. Inspect these before submitting anything again; links are not content equality or performance evidence.` : d.status === 'ready' ? 'Ready is an editorial status, not published. Inspect the brief, then explicitly export or continue in Compose.' : 'Resume the existing draft; review and save are explicit actions, not completed marketing outcomes.',
      evidence: [`Status: ${d.status} · ${d.format}`, `${linked} distribution references · ${d.distribution.handoffs.length} navigation handoffs (not publications)`],
      observedAt: d.updatedAt, freshness: state, source: 'Server-side Studio store',
      factors: { severity: d.status === 'ready' ? 18 : d.status === 'in_review' ? 16 : 4, confidence: 15, freshness: freshPoints(state), impact: d.status === 'ready' ? 12 : 6, urgency: waiting && d.status === 'in_review' ? 12 : 4 },
      primary: { label: linked ? 'Inspect draft & references' : d.status === 'ready' ? 'Review ready draft' : 'Continue in Studio', to: `/studio/s/${encodeURIComponent(d.id)}` },
    })
  })
}
export function competitorItems(report: CompetitorReport, scope: WorkScope, now: number): WorkItem[] {
  if (report.competitor.workspace_id !== scope.workspaceId || report.competitor.brand_key !== scope.brandKey) return []
  return report.findings.filter(f => ['verified_change','newly_observed','coverage_gap'].includes(f.category) && f.brand_key === scope.brandKey && String(f.competitor_id) === String(report.competitor.id)).map(f => {
    const state = freshness(f.observed_at, 30, now)
    return item(scope, {
      id: key(scope, `competitor:${f.id}`), dedupeKey: key(scope, `competitor:${f.id}`), kind: 'competitor',
      category: f.category === 'verified_change' ? 'Verified competitor website change' : f.category === 'coverage_gap' ? 'Observed coverage gap hypothesis' : 'Newly observed competitor page',
      grade: f.category === 'verified_change' ? 'measured' : 'observed', title: `${state === 'current' ? 'Review' : 'Re-verify'} ${report.competitor.name}: ${f.title}`,
      why: `${f.reason} ${state !== 'current' ? 'Older or undated snapshot: re-verify before preparing a brief.' : 'Public crawl evidence only; no private rankings, traffic or demand claim.'}`,
      evidence: [...f.source_urls.slice(0,2), `Observed ${f.observed_at || 'unknown'} · scan ${f.scan_id}${f.previous_scan_id ? ` vs ${f.previous_scan_id}` : ''}`],
      observedAt: f.observed_at, freshness: state, source: 'Competitor / existing SEO snapshots',
      factors: {severity:f.category === 'verified_change' ? 14 : 8, confidence:f.category === 'verified_change' ? 20 : 8, freshness:freshPoints(state),impact:10,urgency:5},
      primary:{label:'Review competitor evidence',to:`/seo?tab=competitors&competitor=${report.competitor.id}&competitor_scan=${f.scan_id}&finding=${encodeURIComponent(f.id)}`},
    })
  })
}

export interface GrowthBlockers {
  checkedAt: string; truncated?: { accounts: boolean; posts: boolean }
  accounts: Array<{id: string; workspaceId: string; brandKey: string | null; status: string; sessionHealth: string; checkedAt: string | null}>
  posts: Array<{id: string; workspaceId: string; status: string; updatedAt: string; accountIds: string[]}>
}
export function operationItems(data: GrowthBlockers, scope: WorkScope, knownBrands: string[], now: number): WorkItem[] {
  return data.accounts.filter(a => a.workspaceId === scope.workspaceId && (knownBrands.includes(a.brandKey || '') ? a.brandKey : '') === scope.brandKey).map(a => {
    const state = freshness(a.checkedAt, 2, now)
    return item(scope, { id: key(scope, `account:${a.id}`), dedupeKey: key(scope, `account:${a.id}`), kind: 'operations', category: 'Blocked social operation', grade: 'observed',
      title: 'Review social session blocker', why: 'Stored account/session state needs operator attention. Verify the session before retrying a post; Today does not recover or post automatically.',
      evidence: [`Account ${a.id} · status ${a.status} · health ${a.sessionHealth}`, `Database read at ${data.checkedAt}; session check ${a.checkedAt || 'unknown'}`],
      observedAt: a.checkedAt, freshness: state, source: 'Workspace social operations',
      factors: { severity: 30, confidence: 15, freshness: freshPoints(state), impact: 15, urgency: 20 }, primary: { label: 'Inspect publishing setup', to: '/publish' },
    })
  }).concat(scope.brandKey ? [] : data.posts.filter(p => p.workspaceId === scope.workspaceId).map(p => item(scope, {
    id: key(scope, `post:${p.id}`), dedupeKey: key(scope, `post:${p.id}`), kind: 'operations', category: 'Blocked distribution / unassigned brand', grade: 'observed',
    title: `Inspect post state: ${p.status}`, why: 'This workspace Post has no verified brand association. Inspect existing activity before retrying; do not infer a publication failure or success from missing evidence.',
    evidence: [`Post ${p.id} · ${p.status}`, 'Post brand is unassigned; not attributed through a draft reference'], observedAt: p.updatedAt, freshness: freshness(p.updatedAt, 7, now), source: 'Workspace Post store',
    factors: { severity: 25, confidence: 15, freshness: freshPoints(freshness(p.updatedAt, 7, now)), impact: 10, urgency: 15 }, primary: { label: 'Inspect publishing queue', to: '/queue' },
  })))
}
/** Never mutates input. Same-topic dedupe is brand/workspace-local. Source and brand caps are strict.
 * At most two per source and (when multiple brands are eligible) three per brand; fewer than five
 * is honest when evidence/diversity is insufficient. Stable id breaks all ties. */
export function rankWorkItems(items: WorkItem[], limit = 5): WorkItem[] {
  if (limit <= 0) return []
  const sorted = [...items].filter(i => Number.isFinite(i.weight)).sort((a,b) => b.weight-a.weight || a.id.localeCompare(b.id))
  const unique = new Map<string, WorkItem>()
  for (const i of sorted) {
    const twin = unique.get(i.dedupeKey)
    if (twin) { unique.set(i.dedupeKey, { ...twin, alsoIn: `Also observed in ${i.source}` }); continue }
    unique.set(i.dedupeKey, { ...i })
  }
  const brands = new Set([...unique.values()].map(i => key(i.scope, 'brand')))
  const brandCounts = new Map<string, number>(), sources = new Map<string, number>(), result: WorkItem[] = []
  for (const i of unique.values()) {
    const brand = key(i.scope, 'brand')
    if ((sources.get(i.kind) || 0) >= 2 || (brands.size > 1 && (brandCounts.get(brand) || 0) >= 3)) continue
    sources.set(i.kind, (sources.get(i.kind) || 0)+1); brandCounts.set(brand,(brandCounts.get(brand) || 0)+1)
    result.push(i)
    if (result.length >= Math.min(5, limit)) break
  }
  return result
}
