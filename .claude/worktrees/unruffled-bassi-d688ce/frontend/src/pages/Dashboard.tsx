import { useNavigate } from 'react-router-dom'
import {
  Users,
  MonitorPlay,
  SendHorizontal,
  CalendarDays,
  Plus,
  Tv2,
  Activity,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Leaf,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store/useAppStore'
import { cn, timeAgo, statusColor, statusLabel } from '@/lib/utils'

// ── Mock data (replaced with real API calls in Step 3+) ──────────────
const SUMMARY_CARDS = [
  {
    label: 'Total Accounts',
    value: '30',
    sub: '15 Instagram · 15 TikTok',
    icon: Users,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    label: 'Active Sessions',
    value: '18',
    sub: '12 active · 6 warming up',
    icon: MonitorPlay,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
  },
  {
    label: 'Posts Today',
    value: '24',
    sub: '20 success · 4 failed',
    icon: SendHorizontal,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    label: 'Scheduled Posts',
    value: '7',
    sub: 'Next: 18:00 WIB',
    icon: CalendarDays,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
  },
]

const ACCOUNT_HEALTH = [
  { username: 'marmer_jakarta_1', platform: 'Instagram', status: 'active' },
  { username: 'granit_indo_1',    platform: 'TikTok',    status: 'active' },
  { username: 'marmer_premium',   platform: 'Instagram', status: 'warming_up' },
  { username: 'batu_alam_id',     platform: 'TikTok',    status: 'warming_up' },
  { username: 'granit_tiles_ig',  platform: 'Instagram', status: 'idle' },
  { username: 'marmer_mewah',     platform: 'Instagram', status: 'error' },
]

const RECENT_ACTIVITY = [
  { id: 1, text: 'Posted to @marmer_jakarta_1 on Instagram', status: 'success', time: new Date(Date.now() - 120000) },
  { id: 2, text: 'Warming task Day 7 completed for @marmer_premium', status: 'success', time: new Date(Date.now() - 300000) },
  { id: 3, text: 'Post failed for @marmer_mewah — account flagged', status: 'error', time: new Date(Date.now() - 600000) },
  { id: 4, text: 'Scheduled 7 posts for tomorrow 09:00 WIB', status: 'info', time: new Date(Date.now() - 900000) },
  { id: 5, text: 'Proxy rotated for @granit_indo_1', status: 'info', time: new Date(Date.now() - 1800000) },
  { id: 6, text: 'AI generated 7 captions for brand_marmer', status: 'success', time: new Date(Date.now() - 3600000) },
]

const statusDotClass: Record<string, string> = {
  active:     'bg-green-400',
  warming_up: 'bg-purple-400 animate-pulse',
  idle:       'bg-yellow-400',
  error:      'bg-red-400',
  flagged:    'bg-red-500',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAppStore((s) => s.user)

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Welcome back, {user?.name ?? 'Admin'} 👋
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Here's your farm overview for today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/accounts')}>
            <Plus className="h-3.5 w-3.5" />
            Add Account
          </Button>
          <Button size="sm" variant="purple" onClick={() => navigate('/farm')}>
            <Tv2 className="h-3.5 w-3.5" />
            Open Farm
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <Card key={card.label} className="relative overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                <div className={cn('rounded-lg p-2', card.bg)}>
                  <card.icon className={cn('h-4 w-4', card.color)} />
                </div>
              </div>
              <p className="text-3xl font-bold text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Recent activity */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-purple-400" />
              Recent Activity
            </CardTitle>
            <span className="text-xs text-muted-foreground">Last 10 events</span>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {RECENT_ACTIVITY.map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="mt-0.5 shrink-0">
                  {item.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                  {item.status === 'error' && <XCircle className="h-4 w-4 text-red-400" />}
                  {item.status === 'info' && <Clock className="h-4 w-4 text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{item.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(item.time)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Account health */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              Account Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ACCOUNT_HEALTH.map((acc) => (
              <div
                key={acc.username}
                className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass[acc.status] ?? 'bg-gray-500')} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">@{acc.username}</p>
                    <p className="text-[10px] text-muted-foreground">{acc.platform}</p>
                  </div>
                </div>
                <Badge
                  variant={
                    acc.status === 'active' ? 'success' :
                    acc.status === 'warming_up' ? 'purple' :
                    acc.status === 'idle' ? 'warning' : 'error'
                  }
                  className="text-[10px] shrink-0"
                >
                  {statusLabel(acc.status)}
                </Badge>
              </div>
            ))}

            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-muted-foreground"
              onClick={() => navigate('/accounts')}
            >
              View all accounts →
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'New Post',          icon: SendHorizontal, path: '/compose',    variant: 'purple' as const },
              { label: 'View Farm',         icon: Tv2,            path: '/farm',       variant: 'outline' as const },
              { label: 'Schedule Content',  icon: CalendarDays,   path: '/scheduler',  variant: 'outline' as const },
              { label: 'AI Generate',       icon: Activity,       path: '/ai-writer',  variant: 'outline' as const },
              { label: 'Warming Manager',   icon: Leaf,           path: '/warming',    variant: 'outline' as const },
            ].map(({ label, icon: Icon, path, variant }) => (
              <Button key={path} size="sm" variant={variant} onClick={() => navigate(path)}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
