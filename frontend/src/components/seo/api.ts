import api from '@/lib/api'

export interface Brand { key: string; name: string; workspace_id: string; source: string }
export interface Website { id: string; name: string; base_url: string; workspace_id?: string | null; brand_key?: string | null }
export interface ScanSummary {
  status_counts?: Record<string, number>; priority_counts?: Record<string, number>; indexable_count?: number
  robots_url?: string | null; robots_status?: number | null; sitemap_urls?: Array<{ url: string; status: number }>; sitemap_discovered?: number
  discovered_count?: number; skipped_robots?: number; warnings?: string[]; limit_reached?: boolean
}
export interface Scan {
  id: string; website_id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
  started_at?: string | null; finished_at?: string | null; max_urls: number; mode: 'auto' | 'http' | 'browser'
  pages_count: number; issues_count: number; summary?: ScanSummary | null; error?: string | null
}
export interface PageRecord {
  id: string; scan_id: string; url: string; final_url?: string | null; status_code?: number | null; title?: string | null
  first_status_code?: number | null; final_status_code?: number | null; depth?: number | null
  inlinks?: number; unique_inlinks?: number; followed_inlinks?: number; unique_followed_inlinks?: number
  outlinks?: number; unique_outlinks?: number; path?: string[]; discovery_sources?: string[]
  description?: string | null; h1?: string[]; canonical?: string | null; meta_robots?: string | null; x_robots_tag?: string | null
  indexable: boolean; content_type?: string | null; redirect_chain?: Array<{ url: string; status: number; location?: string | null }>
  internal_links?: string[]; render_mode?: string | null; error?: string | null; elapsed_ms?: number | null
}
export interface Issue {
  id: string; scan_id: string; code: string; priority: 'high' | 'medium' | 'low'; title: string
  recommendation: string; url: string; details?: Record<string, unknown>
}
export interface LinkEdge {
  source_url: string; target_url: string; kind: 'hyperlink' | 'canonical' | 'redirect' | 'sitemap' | string
  anchor?: string | null; rel?: string[]; follow?: boolean; occurrence?: number
  source_status_code?: number | null; target_status_code?: number | null; target_final_status_code?: number | null; status_code?: number | null
  first_status_code?: number | null; final_status_code?: number | null; rule_reason?: string | null
}
export interface GraphNode {
  url: string; observed: boolean; status_code?: number | null; indexable?: boolean | null; depth: number | null
  redirect_hops: number | null; path: string[]; inlinks: number; unique_inlinks: number
  followed_inlinks: number; unique_followed_inlinks: number; outlinks: number; unique_outlinks: number
  discovery_sources: string[]
}
export interface LinkGraph {
  available: boolean; version: number; start_url?: string | null; nodes: GraphNode[]; edges: LinkEdge[]
  histogram: Array<{ depth: number; count: number }>; coverage: Record<string, unknown>; warnings: string[]
}
export interface IssueGroup {
  code: string; category: 'links' | 'metadata' | 'indexability' | 'redirects' | 'access' | string
  issue_type: 'issue' | 'warning' | 'opportunity' | 'insight' | string; priority: 'high' | 'medium' | 'low'
  confidence: 'observed' | 'review' | 'unknown' | string; title: string; recommendation: string; fix_steps: string[]
  priority_reason: string; affected_count: number; eligible_count: number | null; coverage_pct: number | null
  affected_urls: string[]; occurrences: number; issues: Issue[]
}
export interface IssueGroups { groups: IssueGroup[]; coverage: Record<string, unknown>; note?: string | null }
export interface Comparison {
  previous_scan_id: number | null; added_urls: string[]; removed_urls: string[]; changed_urls: Array<{ url: string; fields: Record<string, { before: unknown; after: unknown }> }>
  new_issues: Issue[]; resolved_issues: Issue[]; note?: string | null
}

const root = '/seo'
let activeWorkspace = ''
const scope = () => activeWorkspace ? { workspace_id: activeWorkspace } : {}
export function setSeoWorkspace(id: string) { activeWorkspace = id }
// SQLite IDs are numbers on the wire; Radix Select values must be strings.
function normalizeIds<T>(data: T): T {
  if (Array.isArray(data)) return data.map(normalizeIds) as T
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
      ['id', 'website_id', 'scan_id'].includes(key) && value != null ? String(value) : normalizeIds(value),
    ])) as T
  }
  return data
}
async function normalized<T>(request: Promise<{ data: T }>): Promise<{ data: T }> {
  const response = await request
  return { ...response, data: normalizeIds(response.data) }
}
export const seoApi = {
  brands: () => api.get<Brand[]>(`${root}/brands`),
  websites: () => normalized(api.get<Website[]>(`${root}/websites`, { params: scope() })),
  addWebsite: (body: { name: string; base_url: string; brand_key?: string }) => normalized(api.post<Website>(`${root}/websites`, body, { params: scope() })),
  scans: (websiteId: string) => normalized(api.get<Scan[]>(`${root}/websites/${encodeURIComponent(websiteId)}/scans`, { params: scope() })),
  startScan: (websiteId: string, body: { max_urls: number; mode: Scan['mode'] }) =>
    normalized(api.post<Scan>(`${root}/websites/${encodeURIComponent(websiteId)}/scans`, body, { params: scope() })),
  scan: (scanId: string) => normalized(api.get<Scan>(`${root}/scans/${encodeURIComponent(scanId)}`, { params: scope() })),
  pages: (scanId: string, params: { q?: string; status?: string }) => normalized(api.get<PageRecord[]>(`${root}/scans/${encodeURIComponent(scanId)}/pages`, { params: { ...scope(), ...params } })),
  issues: (scanId: string, params: { q?: string; priority?: string }) => normalized(api.get<Issue[]>(`${root}/scans/${encodeURIComponent(scanId)}/issues`, { params: { ...scope(), ...params } })),
  compare: (scanId: string) => api.get<Comparison>(`${root}/scans/${encodeURIComponent(scanId)}/compare`, { params: scope() }),
  graph: (scanId: string) => normalized(api.get<LinkGraph>(`${root}/scans/${encodeURIComponent(scanId)}/graph`, { params: scope() })),
  issueGroups: (scanId: string, params: { q?: string; priority?: string }) => normalized(api.get<IssueGroups>(`${root}/scans/${encodeURIComponent(scanId)}/issue-groups`, { params: { ...scope(), ...params } })),
  export: (scanId: string, params: { kind: 'issues' | 'pages' | 'links' | 'issue-groups' | 'actions'; format: 'csv' | 'json'; q?: string; priority?: string; status?: string; category?: string; confidence?: string; issue_type?: string }) =>
    api.get<Blob>(`${root}/scans/${encodeURIComponent(scanId)}/export`, { params: { ...scope(), ...params }, responseType: 'blob' }),
}
