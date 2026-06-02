import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { useAppStore } from '@/store/useAppStore'
import Layout from '@/components/layout/Layout'
import ErrorBoundary from '@/components/common/ErrorBoundary'

// Pages
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import FarmView from '@/pages/FarmView'
import Accounts from '@/pages/Accounts'
import Compose from '@/pages/Compose'
import Scheduler from '@/pages/Scheduler'
import AIWriter from '@/pages/AIWriter'
import WarmingManager from '@/pages/WarmingManager'
import ProxyManager from '@/pages/ProxyManager'
import Analytics from '@/pages/Analytics'
import Settings from '@/pages/Settings'
import Engagement from '@/pages/Engagement'
import Campaigns from '@/pages/Campaigns'
import CampaignEngine from '@/pages/CampaignEngine'
import ActivityTimeline from '@/pages/ActivityTimeline'
import OperationalValidation from '@/pages/OperationalValidation'
import ContentPlanner from '@/pages/ContentPlanner'

function ProtectedRoute() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const token = useAppStore((s) => s.token) || localStorage.getItem('sc_token')
  if (!isAuthenticated || !token) return <Navigate to="/login" replace />
  return <Outlet />
}

function PublicRoute() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const token = useAppStore((s) => s.token) || localStorage.getItem('sc_token')
  if (isAuthenticated && token) return <Navigate to="/" replace />
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
            <Route index element={
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            } />
            <Route path="farm" element={
              <ErrorBoundary>
                <FarmView />
              </ErrorBoundary>
            } />
            <Route path="accounts" element={
              <ErrorBoundary>
                <Accounts />
              </ErrorBoundary>
            } />
            <Route path="engagement" element={
              <ErrorBoundary>
                <Engagement />
              </ErrorBoundary>
            } />
            <Route path="campaigns" element={
              <ErrorBoundary>
                <Campaigns />
              </ErrorBoundary>
            } />
            <Route path="campaign-engine" element={
              <ErrorBoundary>
                <CampaignEngine />
              </ErrorBoundary>
            } />
            <Route path="content-planner" element={
              <ErrorBoundary>
                <ContentPlanner />
              </ErrorBoundary>
            } />
            <Route path="activity" element={
              <ErrorBoundary>
                <ActivityTimeline />
              </ErrorBoundary>
            } />
            <Route path="validation" element={
              <ErrorBoundary>
                <OperationalValidation />
              </ErrorBoundary>
            } />
            <Route path="compose" element={
              <ErrorBoundary>
                <Compose />
              </ErrorBoundary>
            } />
            <Route path="scheduler" element={
              <ErrorBoundary>
                <Scheduler />
              </ErrorBoundary>
            } />
            <Route path="ai-writer" element={
              <ErrorBoundary>
                <AIWriter />
              </ErrorBoundary>
            } />
            <Route path="warming" element={
              <ErrorBoundary>
                <WarmingManager />
              </ErrorBoundary>
            } />
            <Route path="proxies" element={
              <ErrorBoundary>
                <ProxyManager />
              </ErrorBoundary>
            } />
            <Route path="analytics" element={
              <ErrorBoundary>
                <Analytics />
              </ErrorBoundary>
            } />
            <Route path="settings" element={
              <ErrorBoundary>
                <Settings />
              </ErrorBoundary>
            } />
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
    </BrowserRouter>
  )
}
