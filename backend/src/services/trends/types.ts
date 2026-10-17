import type { GscReport } from '../gsc/types';

export interface BrandWatch { brandKey: string; brandName: string; topics: string[]; exclude: string[]; updatedAt: string }
export interface TrendNews { title: string; url: string; source: string }
export interface TrendItem { topic: string; publishedAt: string | null; trafficText: string; trafficLowerBound: number | null; sourceUrl: string; news: TrendNews[] }
export interface FeedSnapshot { id: string; fetchedAt: string; sourceUrl: string; status: 'ok' | 'unavailable'; httpStatus: number | null; error: string | null; items: TrendItem[] }
export interface GscInput { websiteId: string; websiteName: string; brandKey: string; report: GscReport }
export type CandidateClassification = 'rising_trend' | 'trend_observation' | 'gsc_opportunity' | 'content_idea';
export interface Candidate { id: string; brandKey: string; topic: string; classification: CandidateClassification; reason: string; relevance: { matchedTerms: string[]; field: string }; momentum: { previous: number | null; current: number | null; delta: number | null; previousAt: string | null; currentAt: string | null; measured: boolean; caveat: string }; evidence: object[] }
export interface Recommendation { id: string; candidateId: string; brandKey: string; topic: string; classification: CandidateClassification; format: 'article' | 'reel' | 'social_post'; title: string; content: string; reason: string; evidence: object[] }
export interface Radar { brandKey: string; watchlist: BrandWatch; source: { latest: FeedSnapshot | null; lastGood: FeedSnapshot | null; cooldownUntil: string | null }; candidates: Candidate[]; recommendations: Recommendation[]; gscStatus: string; limitations: string[] }
