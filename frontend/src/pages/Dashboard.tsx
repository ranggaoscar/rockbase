import { useEffect, useState } from 'react'
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
  Target,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store/useAppStore'
import { cn, timeAgo, statusColor, statusLabel } from '@/lib/utils'
import api from '@/lib/api'

interface Account { id: string; username: string; platform: string; status: string }
interface Stats { 
  total: number; 
  active: number; 
  warming_up: number; 
  idle: number;
  error: number;
  instagram: number;
  tiktok: number;
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAppStore((s) => s.user)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [stats, setStats] = useState<Stats>({ 
    total: 0, 
    active: 0, 
    warming_up: 0, 
    idle: 0,
    error: 0,
    instagram: 0,
    tiktok: 0 
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<{ accounts: Account[] }>('/accounts'),
      api.get('/accounts/stats')
    ]).then(([{ data: accData }, { data: statsData }]) => {
      setAccounts(accData.accounts || [])
      setStats(statsData)
    }).catch((err) => {
      console.error('Dashboard fetch error:', err)
    }).finally(() => setLoading(false))
  }, [])

  const SUMMARY_CARDS = [
    {
      label: 'Total Accounts',
      value: stats.total.toString(),
      sub: `${stats.instagram || 0} Instagram · ${stats.tiktok || 0} TikTok`,
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Active Sessions',
      value: stats.active.toString(),
      sub: `${stats.active} active · ${stats.warming_up} warming up`,
      icon: MonitorPlay,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
    },
    {
      label: 'Engagement Activity',
      value: 'Live',
      sub: 'Monitor in Engagement Center',
      icon: SendHorizontal,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      label: 'Scheduled Posts',
      value: '—',
      sub: 'Check Scheduler for details',
      icon: CalendarDays,
      color: 'text-yellow-400',
      bg: 'bg-yellow-500/10',
    },
  ]

  const statusDotClass: Record<string, string> = {
    active:     'bg-green-400',
    warming_up: 'bg-purple-400 animate-pulse',
    idle:       'bg-yellow-400',
    error:      'bg-red-400',
    flagged:    'bg-red-500',
  }

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
              System Status
            </CardTitle>
            <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">Operational</Badge>
          </CardHeader>
          <CardContent className="py-10 text-center">
            <Activity className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">Detailed activity logs are available in Engagement Center.</p>
            <Button variant="link" onClick={() => navigate('/engagement')} className="text-purple-400 mt-2">Go to Engagement Center →</Button>
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
            {accounts.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No accounts found.</div>
            ) : accounts.slice(0, 6).map((acc) => (
              <div
                key={acc.id}
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
              { label: 'Engagement Center', icon: Activity,       path: '/engagement', variant: 'outline' as const },
              { label: 'Campaign Manager',  icon: Target,         path: '/campaigns',  variant: 'outline' as const },
              { label: 'Farm View',         icon: Tv2,            path: '/farm',       variant: 'outline' as const },
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
