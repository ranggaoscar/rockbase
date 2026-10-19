import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Command, Lock, LogOut, MoreHorizontal, Search, X } from 'lucide-react'
import BrandMark from './BrandMark'
import ContextSwitcher from './ContextSwitcher'
import CommandPalette from './CommandPalette'
import { allPlaces, isLocalMode, leafActive, placeFor, places, setupPlace, type NavPlace } from './nav'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

function ModeChip({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground', className)}
      title={isLocalMode ? 'Local Mode: data stays on this machine; GSC and Radar are available.' : 'Server Mode: GSC and Radar are disabled by design.'}>
      <span className={cn('h-1.5 w-1.5 rounded-full', isLocalMode ? 'bg-patina' : 'bg-signal')} />
      {isLocalMode ? 'Local mode' : 'Server mode'}
    </span>
  )
}

function RailPlace({ place, pathname }: { place: NavPlace; pathname: string }) {
  const active = placeFor(pathname)?.id === place.id
  const locked = place.availability === 'local' && !isLocalMode
  const Icon = place.icon
  return (
    <div>
      <NavLink
        to={place.path}
        aria-current={active ? 'page' : undefined}
        className={cn('group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
          active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground')}
      >
        {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-patina" aria-hidden />}
        <Icon className={cn('h-4 w-4 shrink-0', active && 'text-patina')} />
        <span className="flex-1 truncate font-medium">{place.label}</span>
        {locked ? <Lock className="h-3 w-3 text-muted-foreground" aria-label="Local Mode only" />
          : <span aria-hidden className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">{place.verb}</span>}
      </NavLink>
      {active && place.children && (
        <div className="mb-1 ml-[1.15rem] mt-0.5 border-l border-border pl-3">
          {place.children.map((child) => {
            const on = child.path === place.path ? pathname === child.path : leafActive(child.path, pathname)
            const childLocked = child.availability === 'local' && !isLocalMode
            return (
              <NavLink key={child.path} to={child.path}
                className={cn('flex items-center gap-2 rounded px-2 py-1.5 text-[13px] transition-colors', on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                <span className={cn('h-1 w-1 rounded-full', on ? 'bg-patina' : 'bg-transparent')} />
                <span className="truncate">{child.label}</span>
                {childLocked && <Lock className="ml-auto h-3 w-3" />}
                {child.hint && !childLocked && <span className="ml-auto text-[10px] text-muted-foreground/70">{child.hint}</span>}
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Identity() {
  const { user, logout } = useAppStore()
  const navigate = useNavigate()
  if (isLocalMode) return <div className="flex items-center justify-between gap-2 px-1"><span className="truncate text-xs text-muted-foreground">Local operator</span><ModeChip /></div>
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{user?.name ?? 'Signed in'}</p><p className="truncate text-[11px] text-muted-foreground">{user?.role ?? ''} · Server mode</p></div>
      <button className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Sign out" onClick={() => { logout(); navigate('/login') }}><LogOut className="h-3.5 w-3.5" /></button>
    </div>
  )
}

/* Mobile ──────────────────────────────────────────────────────────────── */
const mobileTabs = ['today', 'radar', 'studio', 'publish']

function MobileSectionTabs({ pathname }: { pathname: string }) {
  const place = placeFor(pathname)
  if (!place?.children) return null
  return (
    <nav aria-label={`${place.label} sections`} className="scrollbar-none -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:hidden">
      {place.children.map((child) => {
        const on = child.path === place.path ? pathname === child.path : leafActive(child.path, pathname)
        return <NavLink key={child.path} to={child.path} className={cn('shrink-0 border-b-2 px-2.5 py-2.5 text-sm', on ? 'border-patina text-foreground' : 'border-transparent text-muted-foreground')}>{child.label}</NavLink>
      })}
    </nav>
  )
}

function MoreSheet({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 lg:hidden" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="All places" className="pb-safe absolute inset-x-0 bottom-0 max-h-[82vh] animate-sheet-up overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-6 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="mb-4 flex items-center justify-between"><p className="font-display text-lg font-semibold">Everything</p><button onClick={onClose} aria-label="Close" className="rounded p-2 text-muted-foreground"><X className="h-4 w-4" /></button></div>
        <div className="space-y-5">
          {allPlaces.map((place) => {
            const Icon = place.icon
            const locked = place.availability === 'local' && !isLocalMode
            return (
              <div key={place.id}>
                <NavLink to={place.path} onClick={onClose} className={cn('flex items-center gap-3 rounded-lg px-1 py-1.5', placeFor(pathname)?.id === place.id ? 'text-foreground' : 'text-foreground/85')}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card"><Icon className="h-4 w-4 text-patina" /></span>
                  <span className="min-w-0 flex-1"><span className="block font-medium">{place.label}</span><span className="block truncate text-xs text-muted-foreground">{place.hint}</span></span>
                  {locked && <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" />Local only</span>}
                </NavLink>
                {place.children && place.children.length > 1 && (
                  <div className="ml-12 mt-1 flex flex-wrap gap-1.5">
                    {place.children.filter((c) => c.path !== place.path).map((child) => (
                      <NavLink key={child.path} to={child.path} onClick={onClose} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{child.label}</NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-6 border-t border-border pt-4"><Identity /></div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const [palette, setPalette] = useState(false)
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false); window.scrollTo({ top: 0 }) }, [pathname])
  const activePlace = placeFor(pathname)

  return (
    <div className="min-h-screen">
      {/* Desktop rail */}
      <aside className="sidebar-w fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-[hsl(150_7%_6%)] lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <BrandMark className="h-7 w-7" />
          <div className="min-w-0 leading-none"><p className="font-display text-[15px] font-semibold tracking-tight">RockBase</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Growth OS</p></div>
        </div>
        <div className="px-3 pb-3"><ContextSwitcher /></div>
        <button onClick={() => setPalette(true)} className="mx-3 mb-3 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <Search className="h-3.5 w-3.5" /><span className="flex-1 text-left">Jump to…</span><kbd className="inline-flex items-center gap-0.5 rounded border border-border px-1 text-[10px]"><Command className="h-2.5 w-2.5" />K</kbd>
        </button>
        <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {places.map((place) => <RailPlace key={place.id} place={place} pathname={pathname} />)}
          <div className="my-3 h-px bg-border" />
          <RailPlace place={setupPlace} pathname={pathname} />
        </nav>
        <div className="border-t border-border px-3 py-3"><Identity /></div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
        <BrandMark className="h-7 w-7" />
        <div className="min-w-0 flex-1"><ContextSwitcher variant="chip" /></div>
        <button onClick={() => setPalette(true)} aria-label="Search pages" className="rounded-md p-2 text-muted-foreground hover:text-foreground"><Search className="h-4 w-4" /></button>
      </header>

      <main className="min-w-0 lg:pl-[var(--rail-w)]">
        <div className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
          <MobileSectionTabs pathname={pathname} />
          <div key={activePlace?.id ?? pathname} className="animate-page-in"><Outlet /></div>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur lg:hidden">
        {mobileTabs.map((id) => {
          const place = places.find((p) => p.id === id)!
          const Icon = place.icon
          const on = activePlace?.id === id
          return (
            <NavLink key={id} to={place.path} className={cn('flex flex-col items-center gap-1 py-2.5 text-[11px]', on ? 'text-foreground' : 'text-muted-foreground')}>
              <Icon className={cn('h-5 w-5', on && 'text-patina')} />{place.label}
            </NavLink>
          )
        })}
        <button onClick={() => setMore(true)} className={cn('flex flex-col items-center gap-1 py-2.5 text-[11px]', activePlace && !mobileTabs.includes(activePlace.id) ? 'text-foreground' : 'text-muted-foreground')}>
          <MoreHorizontal className={cn('h-5 w-5', activePlace && !mobileTabs.includes(activePlace.id) && 'text-patina')} />More
        </button>
      </nav>

      <MoreSheet open={more} onClose={() => setMore(false)} pathname={pathname} />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  )
}
