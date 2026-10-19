import { useEffect, useMemo, useState } from 'react'
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
}

/**
 * Resolves the persisted context against the live registry. A stale choice
 * (deleted brand, switched installation) falls back to the first workspace
 * instead of silently showing another brand's data under the old name.
 */
export function useWorkContext(): ResolvedContext & { registry: RegistryState & { retry: () => void } } {
  const registry = useBrandRegistry()
  const context = useAppStore((s) => s.context)
  const setContext = useAppStore((s) => s.setContext)

  const resolved = useMemo<ResolvedContext>(() => {
    if (registry.status !== 'ready') return { ...context, label: 'Loading brand…' }
    const workspace = registry.workspaces.find((w) => w.id === context.workspaceId) ?? registry.workspaces[0]
    const brand = workspace?.brands.find((b) => b.key === context.brandKey)
    return {
      workspaceId: workspace?.id ?? '',
      brandKey: brand?.key ?? '',
      websiteId: context.websiteId,
      workspace,
      brand,
      label: brand?.name ?? workspace?.name ?? 'No workspace',
    }
  }, [registry, context])

  useEffect(() => {
    if (registry.status !== 'ready') return
    if (resolved.workspaceId !== context.workspaceId || resolved.brandKey !== context.brandKey) {
      setContext({ workspaceId: resolved.workspaceId, brandKey: resolved.brandKey })
    }
  }, [registry.status, resolved.workspaceId, resolved.brandKey, context.workspaceId, context.brandKey, setContext])

  return { ...resolved, registry }
}

/** The website a page should show for the current brand, honouring an explicit choice. */
export function pickSite<T extends { id: string; brand_key?: string | null }>(sites: T[], brandKey: string, preferred: string): T | undefined {
  const scoped = brandKey ? sites.filter((s) => s.brand_key === brandKey) : sites
  return scoped.find((s) => s.id === preferred) ?? scoped[0]
}
