import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { useAppStore } from '@/store/useAppStore'
import Layout from '@/components/layout/Layout'

// Pages
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import FarmView from '@/pages/FarmView'
import Accounts from '@/pages/Accounts'
import Compose from '@/pages/Compose'
import Scheduler from '@/pages/Scheduler'
import AiWriter from '@/pages/AiWriter'
import WarmingManager from '@/pages/WarmingManager'
import ProxyManager from '@/pages/ProxyManager'
import Analytics from '@/pages/Analytics'
import Settings from '@/pages/Settings'

function ProtectedRoute() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

function PublicRoute() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/farm" element={<FarmView />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/compose" element={<Compose />} />
            <Route path="/scheduler" element={<Scheduler />} />
            <Route path="/ai-writer" element={<AiWriter />} />
            <Route path="/warming" element={<WarmingManager />} />
            <Route path="/proxies" element={<ProxyManager />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
    </BrowserRouter>
  )
}
