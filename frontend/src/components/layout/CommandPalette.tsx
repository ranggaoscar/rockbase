import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Lock, Search } from 'lucide-react'
import { allPlaces, isLocalMode, type NavLeaf } from './nav'
import { useWorkContext } from '@/lib/brandRegistry'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

interface Entry { id: string; label: string; group: string; hint?: string; keywords: string; locked?: boolean; run: () => void; icon?: NavLeaf['icon'] }

/** Ctrl/⌘ K — jump anywhere or switch brand without hunting through menus. */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const ctx = useWorkContext()
  const setContext = useAppStore((s) => s.setContext)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); onOpenChange(!open) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => { if (open) { setQuery(''); setIndex(0); window.setTimeout(() => inputRef.current?.focus(), 10) } }, [open])

  const entries = useMemo<Entry[]>(() => {
    const go = (path: string) => () => { navigate(path); onOpenChange(false) }
    const list: Entry[] = []
    for (const place of allPlaces) {
      list.push({ id: place.path, label: place.label, group: 'Go to', hint: place.hint, icon: place.icon, keywords: `${place.label} ${place.verb} ${place.keywords ?? ''}`, locked: place.availability === 'local' && !isLocalMode, run: go(place.path) })
      for (const child of place.children ?? []) {
        if (child.path === place.path) continue
        list.push({ id: child.path, label: child.label, group: place.label, hint: child.hint, icon: child.icon, keywords: `${child.label} ${place.label} ${child.keywords ?? ''}`, locked: child.availability === 'local' && !isLocalMode, run: go(child.path) })
      }
    }
    if (ctx.registry.status === 'ready') {
      for (const workspace of ctx.registry.workspaces) {
        list.push({ id: `ws:${workspace.id}`, label: `${workspace.name} · whole workspace`, group: 'Work for', keywords: `brand switch ${workspace.name}`, run: () => { setContext({ workspaceId: workspace.id, brandKey: '' }); onOpenChange(false) } })
        for (const brand of workspace.brands) {
          list.push({ id: `b:${workspace.id}:${brand.key}`, label: brand.name, group: 'Work for', hint: workspace.name, keywords: `brand switch ${brand.name} ${brand.key}`, run: () => { setContext({ workspaceId: workspace.id, brandKey: brand.key }); onOpenChange(false) } })
        }
      }
    }
    return list
  }, [ctx.registry, navigate, onOpenChange, setContext])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries.filter((e) => e.group === 'Go to' || e.group === 'Work for')
    return entries.filter((e) => q.split(/\s+/).every((part) => e.keywords.toLowerCase().includes(part) || e.label.toLowerCase().includes(part)))
  }, [entries, query])

  useEffect(() => { setIndex(0) }, [query])
  if (!open) return null

  const groups = results.reduce<Record<string, Entry[]>>((acc, e) => { (acc[e.group] ||= []).push(e); return acc }, {})
  let flat = -1

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-[2px]" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false) }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl animate-sheet-up overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onOpenChange(false)
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
              if (e.key === 'Enter' && results[index]) results[index].run()
            }}
            placeholder="Go to a page or switch brand…"
            aria-label="Search pages and brands"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="py-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group}</p>
              {items.map((entry) => {
                flat++
                const i = flat
                const Icon = entry.icon
                return (
                  <button key={entry.id} onMouseEnter={() => setIndex(i)} onClick={entry.run}
                    className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm', i === index ? 'bg-secondary text-foreground' : 'text-foreground/85')}>
                    {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <span className="mark mark-measured ml-0.5 mr-0.5" />}
                    <span className="min-w-0 flex-1 truncate">{entry.label}{entry.hint && <span className="ml-2 text-xs text-muted-foreground">{entry.hint}</span>}</span>
                    {entry.locked && <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" />Local only</span>}
                    {i === index && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
