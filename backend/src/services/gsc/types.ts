export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface MetricRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPeriod {
  startDate: string;
  endDate: string;
}

export interface GscCoverage {
  dates: { rowCount: number; truncated: boolean; complete: false; rowLimit: number; maxPages: number };
  pagePerformance: { rowCount: number; truncated: boolean; complete: false; rowLimit: number; maxPages: number };
  keywordOpportunities: { rowCount: number; truncated: boolean; complete: false; rowLimit: number; maxPages: number };
}

export interface GscReport {
  mapping: any;
  periods: { current: GscPeriod; previous: GscPeriod };
  totals: { current: MetricRow | null; previous: MetricRow | null };
  dates: MetricRow[];
  freshness: { timeZone: string; dataState: string; lastReturnedDate: string | null; searchType: string };
  pagePerformance: Array<MetricRow & { page: string; previous: MetricRow | null; clickDelta: number | null }>;
  keywordOpportunities: Array<MetricRow & { query: string; reason: string; confidence: 'established' | 'low_volume'; previous: MetricRow | null }>;
  queryPerformance: Array<MetricRow & { query: string; previous: MetricRow | null }>;
  ctrOpportunities: Array<MetricRow & { page: string; reason: string }>;
  coverage: GscCoverage;
  syncedAt: string;
  limitations: string[];
}

export type GoogleRequest = (path: string, body?: unknown) => Promise<any>;
