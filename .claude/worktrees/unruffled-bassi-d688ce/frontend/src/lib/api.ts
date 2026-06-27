import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
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
    if (error.response?.status === 401) {
      localStorage.removeItem('sc_token')
      localStorage.removeItem('sc_user')
      window.location.href = '/login'
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
  get: (id: string) => api.get(`/accounts/${id}`),
  create: (data: Record<string, unknown>) => api.post('/accounts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/accounts/${id}`, data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
  startSession: (id: string) => api.post(`/accounts/${id}/start-session`),
  stopSession: (id: string) => api.post(`/accounts/${id}/stop-session`),
}

// ── Posts ─────────────────────────────────────────────────────
export const postsApi = {
  create: (data: Record<string, unknown>) => api.post('/posts', data),
  list: (workspaceId: string) => api.get(`/posts/status/${workspaceId}`),
}

// ── AI ────────────────────────────────────────────────────────
export const aiApi = {
  generateCaptions: (topic: string, platforms: string[], language?: string) =>
    api.post('/ai/generate-captions', { topic, platforms, language }),
  bestTime: (niche: string, platform: string) =>
    api.post('/ai/best-time', { niche, platform }),
}

// ── Types ─────────────────────────────────────────────────────
export interface AppUser {
  id: string
  email: string
  name: string
  role: string
}
