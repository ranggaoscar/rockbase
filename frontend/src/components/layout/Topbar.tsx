import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronRight, LogOut, User } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const routeLabels: Record<string, string> = {
  '/':          'Dashboard',
  '/farm':      'Farm View',
  '/accounts':  'Accounts',
  '/engagement': 'Engagement',
  '/campaigns': 'Campaigns',
  '/campaign-engine': 'Campaign Engine',
  '/activity':  'Activity',
  '/validation': 'Validation',
  '/compose':   'Compose & Post',
  '/scheduler': 'Scheduler',
  '/ai-writer': 'AI Writer',
  '/warming':   'Warming Manager',
  '/proxies':   'Proxy Manager',
  '/analytics': 'Analytics',
  '/settings':  'Settings',
}

export default function Topbar() {
  const { user, logout, sidebarCollapsed } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()

  const pageLabel = routeLabels[location.pathname] ?? 'ROCK BASE'

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : 'SC'

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 flex h-14 items-center border-b border-border bg-card px-4 transition-all duration-200',
        sidebarCollapsed ? 'left-16' : 'left-60'
      )}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">ROCK BASE</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{pageLabel}</span>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-purple-500" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-medium text-foreground leading-tight">{user?.name ?? 'Admin'}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{user?.role ?? 'Admin'}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <User className="h-3.5 w-3.5" />
              Profile & Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-red-400 focus:text-red-400 focus:bg-red-500/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
