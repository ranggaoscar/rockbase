import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Tv2,
  Users,
  SendHorizontal,
  CalendarDays,
  Sparkles,
  Leaf,
  Globe,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const navItems = [
  { label: 'Dashboard',        path: '/',          icon: LayoutDashboard },
  { label: 'Farm View',        path: '/farm',       icon: Tv2 },
  { label: 'Accounts',         path: '/accounts',   icon: Users },
  { label: 'Compose & Post',   path: '/compose',    icon: SendHorizontal },
  { label: 'Scheduler',        path: '/scheduler',  icon: CalendarDays },
  { label: 'AI Writer',        path: '/ai-writer',  icon: Sparkles },
  { label: 'Warming Manager',  path: '/warming',    icon: Leaf },
  { label: 'Proxy Manager',    path: '/proxies',    icon: Globe },
  { label: 'Analytics',        path: '/analytics',  icon: BarChart3 },
  { label: 'Settings',         path: '/settings',   icon: Settings },
]

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const location = useLocation()

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className={cn(
          'flex h-14 items-center border-b border-border px-3 shrink-0',
          sidebarCollapsed ? 'justify-center' : 'gap-3'
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">SocialCommand</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Farm Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(({ label, path, icon: Icon }) => {
            const isActive =
              path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(path)

            const linkEl = (
              <NavLink
                to={path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-purple-600/15 text-purple-400'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  sidebarCollapsed && 'justify-center px-2'
                )}
              >
                <Icon
                  className={cn(
                    'shrink-0 transition-colors',
                    sidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4',
                    isActive ? 'text-purple-400' : ''
                  )}
                />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
                {!sidebarCollapsed && isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                )}
              </NavLink>
            )

            if (sidebarCollapsed) {
              return (
                <Tooltip key={path}>
                  <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {label}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return <div key={path}>{linkEl}</div>
          })}
        </nav>

        {/* Collapse toggle */}
        <div className="shrink-0 border-t border-border p-2">
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors',
              sidebarCollapsed && 'justify-center'
            )}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
