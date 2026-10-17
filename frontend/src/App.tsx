import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { useAppStore } from '@/store/useAppStore'
import Layout from '@/components/layout/Layout'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import ExperimentalUnavailable from '@/components/common/ExperimentalUnavailable'

// Pages
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import SeoIntelligence from '@/pages/SeoIntelligence'
import FarmView from '@/pages/FarmView'
import Accounts from '@/pages/Accounts'
import Compose from '@/pages/Compose'
import TrendRadar from '@/pages/TrendRadar'

import AIWriter from '@/pages/AIWriter'
import WarmingManager from '@/pages/WarmingManager'
import ProxyManager from '@/pages/ProxyManager'

import Settings from '@/pages/Settings'
import Engagement from '@/pages/Engagement'
import Campaigns from '@/pages/Campaigns'

import ActivityTimeline from '@/pages/ActivityTimeline'
import Queue from '@/pages/Queue'
import OperationalValidation from '@/pages/OperationalValidation'


function ProtectedRoute() {
  if (import.meta.env.VITE_ROCKBASE_MODE === 'local') return <Outlet />
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const token = useAppStore((s) => s.token) || localStorage.getItem('sc_token')
  if (!isAuthenticated || !token) return <Navigate to="/login" replace />
  return <Outlet />
}

function PublicRoute() {
  if (import.meta.env.VITE_ROCKBASE_MODE === 'local') return <Navigate to="/" replace />
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
            <Route path="seo" element={<ErrorBoundary><SeoIntelligence /></ErrorBoundary>} />
            <Route path="trends" element={<ErrorBoundary><TrendRadar /></ErrorBoundary>} />
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
            <Route path="campaign-engine" element={<ExperimentalUnavailable feature="Campaign Engine" />} />
            <Route path="content-planner" element={<ExperimentalUnavailable feature="Content Planner" />} />
            <Route path="activity" element={
              <ErrorBoundary>
                <ActivityTimeline />
              </ErrorBoundary>
            } />
            <Route path="queue" element={
              <ErrorBoundary>
                <Queue />
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
            <Route path="scheduler" element={<ExperimentalUnavailable feature="Scheduler" />} />
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
            <Route path="analytics" element={<ExperimentalUnavailable feature="Analytics" />} />
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
