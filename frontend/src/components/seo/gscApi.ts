import api from '@/lib/api'

export interface GscStatus {
  enabled: boolean
  configured: boolean
  connected: boolean
  pending: boolean
  error?: string
  storage: 'Windows Credential Manager' | string
  setupRequired?: string
  provider?: 'oauth_desktop' | 'service_account'
}
export interface GscProperty { siteUrl: string; permissionLevel: string }
export interface GscMapping { workspaceId: string; websiteId: string; property: string; brandKey?: string | null }
export interface MetricRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
export interface GscPageRow extends MetricRow {
  page: string; previous: MetricRow | null; clickDelta: number | null
  crawl?: { status_code?: number; title?: string; indexable?: boolean; issues?: number; note?: string }
}
export interface GscOpportunity extends MetricRow { query: string; reason: string; confidence?: 'established' | 'low_volume' }
export interface GscCtrOpportunity extends MetricRow { page: string; reason: string }
export interface GscReport {
  mapping: GscMapping
  periods: { current: { startDate: string; endDate: string }; previous: { startDate: string; endDate: string } }
  totals: { current: MetricRow | null; previous: MetricRow | null }
  dates: MetricRow[]
  freshness?: { timeZone: string; dataState: string; lastReturnedDate: string | null; searchType: string }
  crawlStatus?: string
  pagePerformance: GscPageRow[]
  keywordOpportunities: GscOpportunity[]
  queryPerformance?: Array<MetricRow & { query: string; previous: MetricRow | null }>
  ctrOpportunities: GscCtrOpportunity[]
  coverage: any
  syncedAt: string
  limitations: string[]
}

const root = '/gsc'
export const gscApi = {
  status: () => api.get<GscStatus>(`${root}/status`),
  configure: (body: { client_id: string; client_secret?: string }) => api.post(`${root}/config`, body),
  importServiceAccount: (credentialPath: string) => api.post<{ provider: string; connected: boolean; propertyCount: number }>(`${root}/service-account`, { credential_path: credentialPath }),
  connect: () => api.post<{ authorizationUrl: string; expiresAt: string }>(`${root}/connect`),
  disconnect: () => api.post<{ disconnected: boolean; revoked: boolean; warning?: string }>(`${root}/disconnect`),
  properties: () => api.get<GscProperty[]>(`${root}/properties`),
  mapping: (workspaceId: string, websiteId: string) => api.get<GscMapping | null>(`${root}/mapping`, { params: { workspace_id: workspaceId, website_id: websiteId } }),
  saveMapping: (body: { workspace_id: string; website_id: string; property: string }) => api.post<GscMapping>(`${root}/mapping`, body),
  sync: (body: { workspace_id: string; website_id: string; days: 7 | 28; force: false }) => api.post<GscReport>(`${root}/sync`, body),
  report: (workspaceId: string, websiteId: string, days?: 7 | 28) => api.get<GscReport | null>(`${root}/report`, { params: { workspace_id: workspaceId, website_id: websiteId, ...(days ? { days } : {}) } }),
}

export function errorMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: { message?: unknown; detail?: unknown; error?: unknown } }; message?: string }
  const detail = e?.response?.data?.message ?? e?.response?.data?.detail ?? e?.response?.data?.error
  return typeof detail === 'string' ? detail : e?.message || fallback
}
