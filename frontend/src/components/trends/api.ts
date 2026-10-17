import api from '@/lib/api'

export interface TrendWorkspace { id: string; name: string }
export interface TrendBrand { key: string; name: string; workspace_id: string }
export interface BrandWatch { brandKey: string; brandName: string; topics: string[]; exclude: string[]; updatedAt: string }
export interface TrendNews { title: string; url: string; source: string }
export interface TrendEvidence { [key: string]: unknown }
export interface TrendCandidate {
  id: string; brandKey: string; topic: string; classification: 'rising_trend' | 'trend_observation' | 'gsc_opportunity' | 'content_idea'; reason: string
  relevance: { matchedTerms: string[]; field: string }
  momentum: { previous: number | null; current: number | null; delta: number | null; previousAt: string | null; currentAt: string | null; measured: boolean; caveat: string }
  evidence: TrendEvidence[]
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
}
export interface TrendDraft { id: string; title: string; content: string; workspaceId: string }
export interface TrendBrandsResponse { workspaces: TrendWorkspace[]; brands: TrendBrand[]; watchlists: BrandWatch[] }

export const trendsApi = {
  brands: (workspaceId?: string, signal?: AbortSignal) => api.get<TrendBrandsResponse>('/trends/brands', { params: workspaceId ? { workspace_id: workspaceId } : undefined, signal }),
  radar: (workspaceId: string, brandKey: string, signal?: AbortSignal) => api.get<TrendRadar>('/trends/radar', { params: { workspace_id: workspaceId, brand_key: brandKey }, signal }),
  saveWatchlist: (workspaceId: string, brandKey: string, topics: string[], exclude: string[]) =>
    api.put<BrandWatch>('/trends/watchlist', { workspace_id: workspaceId, brand_key: brandKey, topics, exclude }),
  refresh: (workspaceId: string) => api.post<{ cached: boolean; snapshot: FeedSnapshot; cooldownUntil: string }>('/trends/refresh', { workspace_id: workspaceId }),
  createDraft: (workspaceId: string, brandKey: string, recommendationId: string) =>
    api.post<{ draft: TrendDraft; composeUrl: string }>('/trends/drafts', { workspace_id: workspaceId, brand_key: brandKey, recommendation_id: recommendationId }),
  draft: (id: string, workspaceId: string) => api.get<{ draft: TrendDraft }>(`/trends/drafts/${encodeURIComponent(id)}`, { params: { workspace_id: workspaceId } }),
}
