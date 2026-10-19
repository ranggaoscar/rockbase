import type { ReactNode } from 'react'
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { useAppStore } from '@/store/useAppStore'
import Layout from '@/components/layout/Layout'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import ExperimentalUnavailable from '@/components/common/ExperimentalUnavailable'

// Work places
import Login from '@/pages/Login'
import Today from '@/pages/Today'
import TrendRadar from '@/pages/TrendRadar'
import SeoIntelligence from '@/pages/SeoIntelligence'
import Studio from '@/pages/Studio'
import StudioEditor from '@/pages/StudioEditor'
import PublishHub from '@/pages/PublishHub'
import Results from '@/pages/Results'
import SetupHub, { GoogleSetup } from '@/pages/SetupHub'

// Existing tools, filed under the place they belong to
import FarmView from '@/pages/FarmView'
import Accounts from '@/pages/Accounts'
import Compose from '@/pages/Compose'
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

const guard = (node: ReactNode) => <ErrorBoundary>{node}</ErrorBoundary>

const router = createBrowserRouter(createRoutesFromElements(
  <>
    <Route element={<PublicRoute />}>
      <Route path="/login" element={<Login />} />
    </Route>

    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        {/* Start */}
        <Route index element={guard(<Today />)} />
        {/* Discover · Analyze */}
        <Route path="trends" element={guard(<TrendRadar />)} />
        <Route path="seo" element={guard(<SeoIntelligence />)} />
        {/* Create */}
        <Route path="studio" element={guard(<Studio />)} />
        <Route path="studio/d/:id" element={guard(<StudioEditor kind="radar" />)} />
        <Route path="studio/s/:id" element={guard(<StudioEditor kind="studio" />)} />
        <Route path="studio/n/:id" element={guard(<StudioEditor kind="note" />)} />
        <Route path="studio/c/:id" element={guard(<StudioEditor kind="caption" />)} />
        <Route path="ai-writer" element={guard(<AIWriter />)} />
        {/* Distribute */}
        <Route path="publish" element={guard(<PublishHub />)} />
        <Route path="compose" element={guard(<Compose />)} />
        <Route path="campaigns" element={guard(<Campaigns />)} />
        <Route path="queue" element={guard(<Queue />)} />
        <Route path="activity" element={guard(<ActivityTimeline />)} />
        {/* Measure — the legacy social analytics screen used synthetic data and stays retired. */}
        <Route path="results" element={guard(<Results />)} />
        <Route path="analytics" element={<Navigate to="/results" replace />} />
        {/* Connect */}
        <Route path="setup" element={guard(<SetupHub />)} />
        <Route path="setup/google" element={guard(<GoogleSetup />)} />
        <Route path="accounts" element={guard(<Accounts />)} />
        <Route path="farm" element={guard(<FarmView />)} />
        <Route path="engagement" element={guard(<Engagement />)} />
        <Route path="warming" element={guard(<WarmingManager />)} />
        <Route path="proxies" element={guard(<ProxyManager />)} />
        <Route path="validation" element={guard(<OperationalValidation />)} />
        <Route path="settings" element={guard(<Settings />)} />
        {/* Retained for evaluation; not part of the verified workflow. */}
        <Route path="campaign-engine" element={<ExperimentalUnavailable feature="Campaign Engine" />} />
        <Route path="content-planner" element={<ExperimentalUnavailable feature="Content Planner" />} />
        <Route path="scheduler" element={<ExperimentalUnavailable feature="Scheduler" />} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </>,
))

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  )
}
