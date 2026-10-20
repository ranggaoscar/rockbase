import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { seoApi, type Brand } from '@/components/seo/api'
import { useAppStore, type WorkContext } from '@/store/useAppStore'

export interface RegistryWorkspace { id: string; name: string; brands: Brand[] }
export type RegistryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspaces: RegistryWorkspace[] }

// One request per page load; every consumer shares it.
let pending: Promise<Brand[]> | null = null
let cached: Brand[] | null = null
const listeners = new Set<() => void>()

function loadRegistry(force = false) {
  if (force) { pending = null; cached = null }
  if (!pending) {
    pending = seoApi.brands().then(({ data }) => { cached = data; listeners.forEach((fn) => fn()); return data })
    pending.catch(() => { pending = null })
  }
  return pending
}

export function reloadRegistry() { return loadRegistry(true) }

function group(brands: Brand[]): RegistryWorkspace[] {
  const workspaces = brands.filter((b) => b.source === 'Workspace')
  return workspaces.map((w) => ({
    id: w.workspace_id,
    name: w.name,
    brands: brands.filter((b) => b.source !== 'Workspace' && b.key && b.workspace_id === w.workspace_id),
  }))
}

/** Shared brand registry (workspaces → brands) used by the context switcher and pages. */
export function useBrandRegistry(): RegistryState & { retry: () => void } {
  const [state, setState] = useState<RegistryState>(() => cached ? { status: 'ready', workspaces: group(cached) } : { status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    const sync = () => { if (alive && cached) setState({ status: 'ready', workspaces: group(cached) }) }
    listeners.add(sync)
    loadRegistry(attempt > 0).then(sync).catch(() => {
      if (alive) setState({ status: 'error', message: 'Brand registry unavailable. Pages still work with their own selectors.' })
    })
    return () => { alive = false; listeners.delete(sync) }
  }, [attempt])
  return { ...state, retry: () => { setState({ status: 'loading' }); setAttempt((n) => n + 1) } }
}

export interface ResolvedContext extends WorkContext {
  workspace?: RegistryWorkspace
  brand?: Brand
  /** Display name: brand if chosen, otherwise workspace. */
  label: string
  scopeError?: boolean
}

/**
 * Resolves the persisted context against the live registry. A stale choice
 * (deleted brand, switched installation) falls back to the first workspace
 * instead of silently showing another brand's data under the old name.
 */
export function useWorkContext(): ResolvedContext & { registry: RegistryState & { retry: () => void } } {
  const registry = useBrandRegistry()
  const location = useLocation()
  const navigate = useNavigate()
  const context = useAppStore((s) => s.context)
  const setContext = useAppStore((s) => s.setContext)

  const resolved = useMemo<ResolvedContext>(() => {
    if (registry.status !== 'ready') return { ...context, label: 'Loading brand…' }
    // Today links survive reload/new tabs, but only if the live authorized registry agrees.
    const params = new URLSearchParams(location.search)
    const linked = params.get('from') === 'today' ? registry.workspaces.find(w => w.id === params.get('workspace_id')) : undefined
    if (params.get('from') === 'today' && (!linked || !params.has('brand_key') || (params.get('brand_key') !== '' && !linked.brands.some(b => b.key === params.get('brand_key'))))) {
      return { workspaceId: '', brandKey: '', websiteId: '', label: 'Invalid Today context', scopeError: true }
    }
    const workspace = linked ?? registry.workspaces.find((w) => w.id === context.workspaceId) ?? registry.workspaces[0]
    const brand = workspace?.brands.find((b) => b.key === (linked ? params.get('brand_key') : context.brandKey))
    return {
      workspaceId: workspace?.id ?? '',
      brandKey: brand?.key ?? '',
      websiteId: linked ? params.get('site') || '' : context.websiteId,
      workspace,
      brand,
      label: brand?.name ?? workspace?.name ?? 'No workspace',
    }
  }, [registry, context, location.search])

  useEffect(() => {
    if (registry.status !== 'ready') return
    if (resolved.scopeError) return
    if (resolved.workspaceId !== context.workspaceId || resolved.brandKey !== context.brandKey || resolved.websiteId !== context.websiteId) {
      setContext({ workspaceId: resolved.workspaceId, brandKey: resolved.brandKey, websiteId: resolved.websiteId })
    }
  }, [registry.status, resolved.workspaceId, resolved.brandKey, resolved.websiteId, context.workspaceId, context.brandKey, context.websiteId, setContext])

  return { ...resolved, registry: resolved.scopeError ? { status: 'error', message: 'Invalid Today workspace or brand. Return to your saved context; no broader scope was selected.', retry: () => navigate(location.pathname, { replace: true }) } : registry }
}

/** The website a page should show for the current brand, honouring an explicit choice. */
export function pickSite<T extends { id: string; brand_key?: string | null }>(sites: T[], brandKey: string, preferred: string): T | undefined {
  const scoped = brandKey ? sites.filter((s) => s.brand_key === brandKey) : sites
  // A supplied site id must match this authorized brand's fetched site list.
  return preferred ? scoped.find((s) => s.id === preferred) : scoped[0]
}
