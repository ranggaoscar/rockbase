import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppUser } from '@/lib/api'

interface AppState {
  // Auth
  user: AppUser | null
  token: string | null
  isAuthenticated: boolean

  // UI
  sidebarCollapsed: boolean

  // Actions
  setAuth: (user: AppUser, token: string) => void
  logout: () => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      sidebarCollapsed: false,

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
    }),
    {
      name: 'sc-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
