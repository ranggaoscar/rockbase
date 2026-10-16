import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Tv2,
  Users,
  SendHorizontal,
  Sparkles,
  Leaf,
  Globe,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Heart,
  Target,
  Activity,
  ClipboardCheck,
  ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type NavItem = { label: string; path: string; icon: LucideIcon }

const primaryNavItems: NavItem[] = [
  { label: 'Overview', path: '/', icon: LayoutDashboard },
  { label: 'SEO Intelligence', path: '/seo', icon: Globe },
  { label: 'Accounts', path: '/accounts', icon: Users },
  { label: 'Farm View / Sessions', path: '/farm', icon: Tv2 },
  { label: 'Campaigns', path: '/campaigns', icon: Target },
  { label: 'Queue', path: '/queue', icon: ListChecks },
  { label: 'Activity', path: '/activity', icon: Activity },
]

const advancedNavItems: NavItem[] = [
  { label: 'Compose & Post', path: '/compose', icon: SendHorizontal },
  { label: 'Engagement', path: '/engagement', icon: Heart },
  { label: 'Warming', path: '/warming', icon: Leaf },
  { label: 'Proxies', path: '/proxies', icon: Globe },
  { label: 'Operational tools', path: '/validation', icon: ClipboardCheck },
  { label: 'Settings', path: '/settings', icon: Settings },
  { label: 'AI Writer', path: '/ai-writer', icon: Sparkles },
]

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const location = useLocation()

  const renderItem = ({ label, path, icon: Icon }: NavItem) => {
    const [pathname, search = ''] = path.split('?')
    const isActive = pathname === '/'
      ? location.pathname === '/'
      : location.pathname === pathname && (search === '' || location.search.includes(search))

    const linkEl = (
      <NavLink
        to={path}
        className={cn(
          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-purple-600/15 text-purple-400'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          sidebarCollapsed && 'justify-center px-2',
        )}
      >
        <Icon
          className={cn(
            'shrink-0 transition-colors',
            sidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4',
            isActive ? 'text-purple-400' : '',
          )}
        />
        {!sidebarCollapsed && <span className="truncate">{label}</span>}
        {!sidebarCollapsed && isActive && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
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
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn(
          'flex h-14 shrink-0 items-center border-b border-border px-3',
          sidebarCollapsed ? 'justify-center' : 'gap-3',
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-foreground">ROCK BASE</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Digital Growth OS</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {primaryNavItems.map(renderItem)}
          {!sidebarCollapsed && (
            <p className="px-2.5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Advanced
            </p>
          )}
          {advancedNavItems.map(renderItem)}
        </nav>

        <div className="shrink-0 border-t border-border p-2">
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
              sidebarCollapsed && 'justify-center',
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
