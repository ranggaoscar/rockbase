import type { Grade, Effect } from '@/components/growth/grammar'
import type { IssueGroup } from '@/components/seo/api'
import type { GscOpportunity } from '@/components/seo/gscApi'
import type { TrendCandidate, TrendRecommendation } from '@/components/trends/api'

/**
 * "Next up" — turns real findings into a short, explained work queue.
 * No hidden score: every item carries the sentence that explains why it is
 * here, and its evidence grade. Ordering is a transparent rule, below.
 */
export interface WorkItem {
  id: string
  kind: 'fix' | 'search' | 'radar'
  grade: Grade
  title: string
  why: string
  source: string
  weight: number
  topic?: string
  primary: { label: string; to?: string; effect?: Effect; recommendation?: TrendRecommendation }
  secondary?: { label: string; to: string }
  alsoIn?: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function fixItems(groups: IssueGroup[], websiteId: string, scanLabel: string): WorkItem[] {
  return groups.filter((g) => g.issue_type === 'issue' || g.issue_type === 'warning' || g.priority === 'high').map((g) => ({
    id: `fix:${g.code}`,
    kind: 'fix' as const,
    grade: g.confidence === 'observed' ? 'measured' as const : 'observed' as const,
    title: g.title,
    why: `${g.affected_count} of ${g.eligible_count ?? '?'} crawled pages · ${g.priority_reason || g.recommendation}`,
    source: `Site crawl · ${scanLabel}`,
    weight: (g.priority === 'high' ? 90 : g.priority === 'medium' ? 58 : 28) + Math.min(g.affected_count, 10) * 0.5 - (g.confidence === 'observed' ? 0 : 8),
    primary: { label: 'Open fix steps', to: `/seo?site=${encodeURIComponent(websiteId)}&tab=fixes&focus=${encodeURIComponent(g.code)}` },
  }))
}

export function searchItems(rows: GscOpportunity[], websiteId: string, periodLabel: string, radarAvailable: boolean): WorkItem[] {
  return rows.map((row) => ({
    id: `gsc:${row.query}`,
    kind: 'search' as const,
    grade: 'measured' as const,
    title: `“${row.query}” is close to page one`,
    why: `Position ${row.position.toFixed(1)} · ${row.impressions.toLocaleString()} impressions · ${row.confidence === 'low_volume' ? 'low volume — treat as a hint' : row.reason}`,
    source: `Search Console · ${periodLabel}`,
    topic: row.query,
    weight: (row.confidence === 'low_volume' ? 44 : 78) + Math.max(0, 20 - row.position) * 0.4,
    primary: radarAvailable
      ? { label: 'Find a brief in Radar', to: `/trends?q=${encodeURIComponent(row.query)}` }
      : { label: 'Open in Search', to: `/seo?site=${encodeURIComponent(websiteId)}&tab=search` },
  }))
}

const radarWeight: Record<TrendCandidate['classification'], number> = { gsc_opportunity: 74, rising_trend: 64, trend_observation: 38, content_idea: 18 }
const radarGrade: Record<TrendCandidate['classification'], Grade> = { gsc_opportunity: 'measured', rising_trend: 'observed', trend_observation: 'observed', content_idea: 'idea' }

export function radarItems(candidates: TrendCandidate[], recommendations: TrendRecommendation[]): WorkItem[] {
  return candidates.map((c) => {
    const rec = recommendations.find((r) => r.candidateId === c.id)
    return {
      id: `radar:${c.id}`,
      kind: 'radar' as const,
      grade: radarGrade[c.classification],
      title: rec ? rec.title : c.topic,
      why: c.momentum.measured ? `${c.reason} ${c.momentum.caveat}`.trim() : c.reason,
      source: c.classification === 'gsc_opportunity' ? 'Radar · cached Search Console' : c.classification === 'content_idea' ? 'Radar · watchlist only' : 'Radar · public Trending Now feed',
      topic: c.topic,
      weight: radarWeight[c.classification] + (c.momentum.measured ? 4 : 0),
      primary: rec ? { label: 'Start brief', effect: 'local' as Effect, recommendation: rec } : { label: 'Review evidence', to: `/trends?focus=${encodeURIComponent(c.id)}` },
      secondary: rec ? { label: 'Evidence', to: `/trends?focus=${encodeURIComponent(c.id)}` } : undefined,
    }
  })
}

/**
 * Merge, de-duplicate and order the queue.
 * Rule: a Radar item that carries a ready brief replaces a bare Search Console
 * row for the same topic (it keeps the GSC evidence in its provenance). Then
 * sort by weight, but never let one source take more than three slots, so a
 * site with 40 crawl warnings still surfaces content opportunities.
 */
export function rankWorkItems(items: WorkItem[], limit = 7): WorkItem[] {
  const radarTopics = new Map(items.filter((i) => i.kind === 'radar' && i.topic).map((i) => [norm(i.topic!), i]))
  const merged = items.filter((i) => {
    if (i.kind !== 'search' || !i.topic) return true
    const twin = radarTopics.get(norm(i.topic))
    if (twin) { twin.alsoIn = 'Also a Search Console opportunity'; return false }
    return true
  })
  const sorted = merged.sort((a, b) => b.weight - a.weight)
  const perKind: Record<string, number> = {}
  const picked: WorkItem[] = []
  for (const item of sorted) {
    if ((perKind[item.kind] ?? 0) >= 3) continue
    perKind[item.kind] = (perKind[item.kind] ?? 0) + 1
    picked.push(item)
    if (picked.length >= limit) break
  }
  return picked
}
