import api from '@/lib/api'

export interface TrendWorkspace { id: string; name: string }
export interface TrendBrand { key: string; name: string; workspace_id: string }
export interface DiscoveryConfig { minImpressions: number; minIncrease: number; minGrowthPct: number }
export const defaultDiscoveryConfig: DiscoveryConfig = { minImpressions: 3, minIncrease: 3, minGrowthPct: 25 }
export interface BrandWatch { brandKey: string; brandName: string; topics: string[]; exclude: string[]; discovery?: DiscoveryConfig; updatedAt: string }
export interface TrendNews { title: string; url: string; source: string }
export interface TrendEvidence { [key: string]: unknown }
export interface TrendCandidate {
  id: string; brandKey: string; topic: string; classification: 'rising_trend' | 'trend_observation' | 'gsc_opportunity' | 'content_idea'; reason: string
  relevance: { matchedTerms: string[]; field: string }
  momentum: { previous: number | null; current: number | null; delta: number | null; previousAt: string | null; currentAt: string | null; measured: boolean; caveat: string }
  signal?: {
    source: 'gsc' | 'rss' | 'watchlist'
    status: 'increasing' | 'declining' | 'stable' | 'newly_observed' | 'opportunity' | 'unknown'
    confidence: 'low_volume' | 'observed' | 'insufficient'
    basis: string
    comparisonValid: boolean
    invalidReason?: string
    current: TrendMetric | null
    previous: TrendMetric | null
    deltas: { impressions: number | null; clicks: number | null; ctrPp: number | null; positionImprovement: number | null }
    growthPct: number | null
    periods: { current: { startDate: string; endDate: string }; previous: { startDate: string; endDate: string } | null } | null
    history: TrendHistoryPoint[]; historyComparisons: number
  }
  evidence: TrendEvidence[]
}
export interface TrendMetric { clicks: number; impressions: number; ctr: number | null; position: number }
export interface TrendHistoryPoint {
  snapshotId: string; capturedAt: string; syncedAt: string; startDate: string; endDate: string
  impressions: number; clicks: number; ctr: number | null; position: number
}
export interface TrendRecommendation {
  id: string; candidateId: string; brandKey: string; topic: string; classification: TrendCandidate['classification']; format: 'article' | 'reel' | 'social_post'; title: string; content: string; reason: string; evidence: TrendEvidence[]
}
export interface FeedSnapshot {
  id: string; fetchedAt: string; sourceUrl: string; status: 'ok' | 'unavailable'; httpStatus: number | null; error: string | null
  items: Array<{ topic: string; publishedAt: string | null; trafficText: string; trafficLowerBound: number | null; sourceUrl: string; news: TrendNews[] }>
}
export interface TrendRadar {
  brandKey: string; watchlist: BrandWatch
  source: { latest: FeedSnapshot | null; lastGood: FeedSnapshot | null; cooldownUntil: string | null }
  candidates: TrendCandidate[]; recommendations: TrendRecommendation[]; gscStatus: string; limitations: string[]
  historyStatus?: { count: number; lastCapturedAt: string | null; note: string }
}
export interface TrendDraft { id: string; title: string; content: string; workspaceId: string; createdAt?: string; updatedAt?: string }
export interface TrendDraftSummary { id: string; title: string | null; excerpt: string; format: TrendRecommendation['format']; topic: string | null; classification: TrendCandidate['classification'] | null; brandKey: string | null; createdAt: string; updatedAt: string }
export interface TrendBrandsResponse { workspaces: TrendWorkspace[]; brands: TrendBrand[]; watchlists: BrandWatch[] }

export const trendsApi = {
  brands: (workspaceId?: string, signal?: AbortSignal) => api.get<TrendBrandsResponse>('/trends/brands', { params: workspaceId ? { workspace_id: workspaceId } : undefined, signal }),
  radar: (workspaceId: string, brandKey: string, signal?: AbortSignal) => api.get<TrendRadar>('/trends/radar', { params: { workspace_id: workspaceId, brand_key: brandKey }, signal }),
  saveWatchlist: (workspaceId: string, brandKey: string, topics: string[], exclude: string[], discovery: DiscoveryConfig, signal?: AbortSignal) =>
    api.put<BrandWatch>('/trends/watchlist', { workspace_id: workspaceId, brand_key: brandKey, topics, exclude, discovery }, { signal }),
  captureHistory: (workspaceId: string, brandKey: string, signal?: AbortSignal) =>
    api.post<{ captured: number; historyCount: number; status: string }>('/trends/capture', { workspace_id: workspaceId, brand_key: brandKey }, { signal }),
  refresh: (workspaceId: string) => api.post<{ cached: boolean; snapshot: FeedSnapshot; cooldownUntil: string }>('/trends/refresh', { workspace_id: workspaceId }),
  createDraft: (workspaceId: string, brandKey: string, recommendationId: string) =>
    api.post<{ draft: TrendDraft; composeUrl: string }>('/trends/drafts', { workspace_id: workspaceId, brand_key: brandKey, recommendation_id: recommendationId }),
  draft: (id: string, workspaceId: string) => api.get<{ draft: TrendDraft }>(`/trends/drafts/${encodeURIComponent(id)}`, { params: { workspace_id: workspaceId } }),
  drafts: (workspaceId: string, signal?: AbortSignal) => api.get<{ drafts: TrendDraftSummary[] }>('/trends/drafts', { params: { workspace_id: workspaceId }, signal }),
  /** Saves the editable body only; the server keeps the provenance block intact. */
  updateDraft: (id: string, workspaceId: string, body: { title?: string; body: string }) =>
    api.patch<{ draft: TrendDraft }>(`/trends/drafts/${encodeURIComponent(id)}`, { workspace_id: workspaceId, ...body }),
}
