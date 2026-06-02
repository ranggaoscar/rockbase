import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sc_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Global response error handler
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      useAppStore.getState().logout()
      if (window.location.pathname !== '/login') {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

export default api

// ── Auth ────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: AppUser }>('/auth/login', { email, password }),
  me: () => api.get<{ user: AppUser }>('/auth/me'),
  register: (data: { email: string; password: string; name?: string; role?: string }) =>
    api.post<{ token: string; user: AppUser }>('/auth/register', data),
}

// ── Accounts ─────────────────────────────────────────────────
export const accountsApi = {
  list: () => api.get('/accounts'),
  stats: () => api.get('/accounts/stats'),
  sessionHealthSummary: () => api.get('/accounts/session-health-summary'),
  checkSession: (id: string) => api.post(`/accounts/${id}/check-session`),
  checkSessionBulk: (accountIds: string[]) => api.post('/accounts/check-session-bulk', { accountIds }),
  get: (id: string) => api.get(`/accounts/${id}`),
  getCredentials: (id: string) => api.get(`/accounts/${id}/credentials`),
  create: (data: Record<string, unknown>) => api.post('/accounts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/accounts/${id}`, data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
  startSession: (id: string) => api.post(`/accounts/${id}/start-session`),
  stopSession: (id: string) => api.post(`/accounts/${id}/stop-session`),
}

export const accountGroupsApi = {
  list: () => api.get('/account-groups'),
  resolvePreview: (data: { accountIds?: string[]; groupIds?: string[] }) =>
    api.post('/account-groups/resolve-preview', data),
  create: (data: { name: string; description?: string; color?: string }) => api.post('/account-groups', data),
  update: (id: string, data: { name?: string; description?: string; color?: string; isArchived?: boolean }) =>
    api.patch(`/account-groups/${id}`, data),
  accounts: (id: string, includeAvailable = false) =>
    api.get(`/account-groups/${id}/accounts`, { params: { includeAvailable } }),
  replaceAccounts: (id: string, accountIds: string[]) =>
    api.put(`/account-groups/${id}/accounts`, { accountIds }),
}


// ── AI ────────────────────────────────────────────────────────
export const aiApi = {
  generateCaptions: (topic: string, platforms: string[], language?: string) =>
    api.post('/ai/generate-captions', { topic, platforms, language }),
  bestTime: (niche: string, platform: string) =>
    api.post('/ai/best-time', { niche, platform }),
  generateAssignmentCaption: (niche: string, platform: string, imageBase64?: string) =>
    api.post<{ caption: string }>('/ai/generate-assignment-caption', { niche, platform, imageBase64 }),
  generateVisionCaptionPlan: (data: Record<string, unknown>) =>
    api.post('/ai/vision-caption-plan', data),
}

// ── Engagement ────────────────────────────────────────────────
export const engagementApi = {
  likePost: (postUrl: string, accountIds: string[]) =>
    api.post('/engagement/like', { postUrl, accountIds }),
  followUser: (username: string, accountIds: string[]) =>
    api.post('/engagement/follow', { username, accountIds }),
  comment: (postUrl: string, accountIds: string[]) =>
    api.post('/engagement/comment', { postUrl, accountIds }),
  followAndLike: (username: string, accountIds: string[]) =>
    api.post('/engagement/follow-and-like', { username, accountIds }),
  engageByHashtag: (hashtag: string, accountIds: string[], actions?: any) =>
    api.post('/engagement/hashtag', { hashtag, accountIds, actions }),
  getPoolStatus: () => api.get('/engagement/pool'),
  getStatus: () => api.get('/engagement/status'),
  getLogs: (accountId?: string) =>
    api.get('/engagement/logs', { params: { accountId } }),
  stop: () => api.post('/engagement/stop'),
}

// ── Campaigns ─────────────────────────────────────────────────
export const campaignsApi = {
  create: (data: Record<string, unknown>) => api.post('/campaigns', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/campaigns/${id}`, data),
  list: (params?: { includeArchived?: boolean }) => api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  composeDraft: (id: string) => api.get(`/campaigns/${id}/compose-draft`),
  variationAssignments: (id: string) => api.get(`/campaigns/${id}/variation-assignments`),
  generatePlan: (id: string) => api.post(`/campaigns/${id}/generate-plan`),
  schedule: (id: string, scheduledAt: string) => api.post(`/campaigns/${id}/schedule`, { scheduledAt }),
  cancelSchedule: (id: string) => api.post(`/campaigns/${id}/cancel-schedule`),
  retryScheduler: (id: string) => api.post(`/campaigns/${id}/retry-scheduler`),
  media: (id: string) => api.get(`/campaigns/${id}/media`),
  uploadMedia: (id: string, formData: FormData) =>
    api.post(`/campaigns/${id}/media`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  removeMedia: (id: string, mediaId: string) => api.delete(`/campaigns/${id}/media/${mediaId}`),
  updateVariationMedia: (
    id: string,
    data: { variationKey: string; primaryMediaId?: string; secondaryMediaId?: string },
  ) => api.patch(`/campaigns/${id}/variation-media`, data),
  updateVariationApproval: (
    id: string,
    data: { variationKey: string; status?: string; reviewerNote?: string },
  ) => api.patch(`/campaigns/${id}/variation-approval`, data),
  start: (id: string) => api.post(`/campaigns/${id}/start`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
  resume: (id: string) => api.post(`/campaigns/${id}/resume`),
  stop: (id: string) => api.post(`/campaigns/${id}/stop`),
  getActions: (id: string) => api.get(`/campaigns/${id}/actions`),
  archive: (id: string) => api.patch(`/campaigns/${id}/archive`),
  restore: (id: string) => api.patch(`/campaigns/${id}/restore`),
}

export const campaignEngineApi = {
  plan: (data: Record<string, unknown>) => api.post('/campaign-engine/plan', data),
}

// ── Posts (extended) ──────────────────────────────────────────
export const postsApi = {
  create: (data: Record<string, unknown>) => api.post('/posts', data),
  list: (workspaceId: string) => api.get(`/posts/status/${workspaceId}`),
  bulkMulti: (formData: FormData) =>
    api.post('/posts/bulk-multi', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
}

export const activityApi = {
  list: (params: {
    type?: string
    category?: string
    status?: string
    accountId?: string
    groupId?: string
    campaignId?: string
    cursor?: string
    limit?: number
  }) => api.get('/activity', { params }),
  queueSummary: () => api.get('/activity/queue-summary'),
}

// ── Types ─────────────────────────────────────────────────────
export interface AppUser {
  id: string
  email: string
  name: string
  role: string
}
