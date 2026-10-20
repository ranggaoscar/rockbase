import { Check, ChevronsUpDown, Layers, RotateCw } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkContext } from '@/lib/brandRegistry'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'

function Monogram({ name, active }: { name: string; active?: boolean }) {
  const letters = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '·'
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border text-[12px] font-semibold font-display shadow-[inset_0_1px_0_hsl(0_0%_100%/0.1)]',
      active ? 'border-patina/40 bg-[linear-gradient(145deg,hsl(var(--patina)/0.32),hsl(var(--patina)/0.08))] text-patina' : 'border-border bg-[linear-gradient(145deg,hsl(var(--secondary)),hsl(var(--card)))] text-muted-foreground')}>
      {letters}
    </span>
  )
}

/**
 * "Working for …" — the one control that scopes the whole product.
 * Choosing a brand pre-selects scope everywhere; it is not a permission.
 */
export default function ContextSwitcher({ variant = 'rail' }: { variant?: 'rail' | 'chip' }) {
  const ctx = useWorkContext()
  const setContext = useAppStore((s) => s.setContext)
  const [params, setParams] = useSearchParams()
  const choose = (workspaceId: string, brandKey: string) => {
    if (params.get('from') === 'today') {
      const next = new URLSearchParams(params)
      for (const key of ['from', 'workspace_id', 'brand_key', 'site', 'focus', 'q']) next.delete(key)
      setParams(next, { replace: true, flushSync: true })
    }
    setContext({ workspaceId, brandKey })
  }
  const { registry } = ctx
  const shown = registry.status === 'error' ? '?' : registry.status === 'loading' ? '·' : ctx.label

  const trigger = variant === 'rail' ? (
    <button className="sheen group flex w-full items-center gap-2.5 rounded-xl border border-border bg-background/40 px-2.5 py-2 text-left transition-colors hover:border-[hsl(var(--line-strong))] hover:bg-secondary/60" aria-label="Switch brand context">
      <Monogram name={shown} active />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted-foreground">Working for</span>
        <span className="block truncate text-sm font-medium text-foreground">{registry.status === 'error' ? 'Registry offline' : ctx.label}</span>
      </span>
      <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </button>
  ) : (
    <button className="flex min-w-0 max-w-[60vw] items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-left" aria-label="Switch brand context">
      <Monogram name={shown} active />
      <span className="truncate text-sm font-medium">{registry.status === 'error' ? 'Registry offline' : ctx.label}</span>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[min(18rem,calc(100vw-2rem))] p-1.5">
        {registry.status === 'loading' && <p className="px-2 py-3 text-xs text-muted-foreground">Loading brands…</p>}
        {registry.status === 'error' && (
          <div className="space-y-2 px-2 py-2 text-xs text-muted-foreground">
            <p>{registry.message}</p>
            <button className="inline-flex items-center gap-1 text-patina underline" onClick={registry.retry}><RotateCw className="h-3 w-3" />Retry</button>
          </div>
        )}
        {registry.status === 'ready' && registry.workspaces.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No workspaces are registered yet.</p>}
        {registry.status === 'ready' && registry.workspaces.map((workspace, index) => (
          <div key={workspace.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
              <Layers className="h-3 w-3" />{workspace.name}
            </DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => choose(workspace.id, '')}>
              <Monogram name={workspace.name} active={ctx.workspaceId === workspace.id && !ctx.brandKey} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">Whole workspace</span><span className="block text-[11px] text-muted-foreground">All brands and sites</span></span>
              {ctx.workspaceId === workspace.id && !ctx.brandKey && <Check className="h-4 w-4 text-patina" />}
            </DropdownMenuItem>
            {workspace.brands.map((brand) => {
              const selected = ctx.workspaceId === workspace.id && ctx.brandKey === brand.key
              return (
                <DropdownMenuItem key={`${workspace.id}:${brand.key}`} className="gap-2.5 py-2" onSelect={() => choose(workspace.id, brand.key)}>
                  <Monogram name={brand.name} active={selected} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{brand.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{brand.source === 'SocialAccount.brandTag' ? 'From social account tag' : 'Website brand'}</span>
                  </span>
                  {selected && <Check className="h-4 w-4 text-patina" />}
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">Sets the starting scope on every page. Access is still checked by each service.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
