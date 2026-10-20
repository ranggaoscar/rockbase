import api from '@/lib/api'

/** Public crawl evidence only; never competitor traffic, ranking or Search Console. */
export interface Competitor {
  id: string | number; website_id: string | number; workspace_id: string; brand_key: string; name: string; base_url: string
}
export interface CompetitorScan {
  id: string | number; status: string; started_at: string; finished_at?: string | null; max_urls: number; pages_count: number; error?: string
}
export interface CompetitorFinding {
  id: string; category: 'verified_change' | 'newly_observed' | 'coverage_gap' | 'unavailable' | 'baseline' | 'unverified'
  title: string; reason: string; next_action: string; source_urls: string[]
  observed_at: string | null; previous_observed_at?: string | null
  changes: Record<string, {before: unknown; after: unknown}>
  confidence: string; scan_id: string | number; previous_scan_id?: string | number | null
  brand_key: string; competitor_id: string | number
}
export interface CompetitorReport {
  competitor: Competitor; scan: CompetitorScan | null; previous_scan: CompetitorScan | null
  findings: CompetitorFinding[]; coverage: Record<string, unknown>; limits: unknown
}
const root = '/seo/competitors'
const scope = (workspace: string, brand?: string) => ({ workspace_id: workspace, ...(brand ? { brand_key: brand } : {}) })
export const competitorApi = {
  list: (workspace: string, brand?: string, signal?: AbortSignal) => api.get<Competitor[]>(root, {params:scope(workspace,brand),signal}),
  register: (workspace: string, body: {name: string; base_url: string; brand_key: string}) => api.post<Competitor>(root,body,{params:scope(workspace)}),
  scans: (workspace: string, id: string | number, signal?: AbortSignal) => api.get<CompetitorScan[]>(`${root}/${encodeURIComponent(id)}/scans`,{params:scope(workspace),signal}),
  scan: (workspace: string, id: string | number, maxUrls: number) => api.post<CompetitorScan>(`${root}/${encodeURIComponent(id)}/scans`,{max_urls:maxUrls,mode:'http'},{params:scope(workspace)}),
  findings: (workspace: string, id: string | number, scanId?: string, signal?: AbortSignal) => api.get<CompetitorReport>(`${root}/${encodeURIComponent(id)}/findings`,{params:{...scope(workspace),...(scanId?{scan_id:scanId}:{})},signal}),
}
export function publicEvidenceUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
export const actionableCompetitorFinding = (f: CompetitorFinding) => ['verified_change','newly_observed','coverage_gap'].includes(f.category)
