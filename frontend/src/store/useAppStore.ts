import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppUser } from '@/lib/api'

/**
 * The brand the operator is working for. This is a UX preference only — it
 * pre-selects scope on every page, while each backend route still enforces its
 * own workspace authorization. An empty brandKey means "whole workspace".
 */
export interface WorkContext {
  workspaceId: string
  brandKey: string
  websiteId: string
}

interface AppState {
  // Auth
  user: AppUser | null
  token: string | null
  isAuthenticated: boolean

  // UI
  sidebarCollapsed: boolean
  context: WorkContext

  // Actions
  setAuth: (user: AppUser, token: string) => void
  logout: () => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setContext: (next: Partial<WorkContext>) => void
}

const emptyContext: WorkContext = { workspaceId: '', brandKey: '', websiteId: '' }

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      sidebarCollapsed: false,
      context: emptyContext,

      setAuth: (user, token) => {
        localStorage.setItem('sc_token', token)
        localStorage.setItem('sc_user', JSON.stringify(user))
        set({ user, token, isAuthenticated: true })
      },

      logout: () => {
        localStorage.removeItem('sc_token')
        localStorage.removeItem('sc_user')
        set({ user: null, token: null, isAuthenticated: false })
      },

      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      setContext: (next) => set((s) => {
        const merged = { ...s.context, ...next }
        // Changing workspace or brand invalidates the website choice so data
        // from one brand can never be shown under another brand's name.
        if ((next.workspaceId !== undefined && next.workspaceId !== s.context.workspaceId) || (next.brandKey !== undefined && next.brandKey !== s.context.brandKey)) {
          if (next.websiteId === undefined) merged.websiteId = ''
        }
        if (next.workspaceId !== undefined && next.workspaceId !== s.context.workspaceId && next.brandKey === undefined) merged.brandKey = ''
        return { context: merged }
      }),
    }),
    {
      name: 'sc-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        sidebarCollapsed: state.sidebarCollapsed,
        context: state.context,
      }),
    }
  )
)
