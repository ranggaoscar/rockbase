import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3, TrendingUp, Users, Heart, Eye, Download,
  Instagram, Music2, ChevronDown, RefreshCw, Trophy, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { cn, formatNumber } from '@/lib/utils'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────
interface AccountMetric {
  accountId: string; username: string; platform: string; status: string; brandTag?: string
  followers: number; following: number; posts: number
  avgLikes: number; avgComments: number; avgSaves: number; avgReach: number
  engagementRate: number; weeklyGrowth: number
}
interface GrowthPoint { date: string; followers: number; likes: number; reach: number }
interface TopPost { id: string; username: string; platform: string; caption: string; likes: number; comments: number; saves: number; engagementRate: number; postedAt: string }
interface Overview {
  summary: { totalFollowers: number; totalPosts: number; avgEngagement: number; totalReach: number; weeklyFollowerGain: number }
  bestAccount: AccountMetric | null
  accountMetrics: AccountMetric[]
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-xl">
      <p className="text-muted-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.dataKey}:</span>
          <span className="font-medium text-foreground">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

const PLATFORM_COLORS: Record<string, string> = {
  Instagram: '#ec4899',
  TikTok: '#06b6d4',
}

export default function Analytics() {
  const [overview, setOverview]     = useState<Overview | null>(null)
  const [growth, setGrowth]         = useState<GrowthPoint[]>([])
  const [topPosts, setTopPosts]     = useState<TopPost[]>([])
  const [loading, setLoading]       = useState(true)
  const [growthDays, setGrowthDays] = useState<7 | 30 | 90>(30)
  const [selectedAccId, setSelectedAccId] = useState<string>('all')
  const [metricSort, setMetricSort] = useState<'followers' | 'engagementRate' | 'weeklyGrowth'>('followers')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'Instagram' | 'TikTok'>('all')

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    try {
      const [ovRes, tpRes] = await Promise.all([
        api.get<Overview>('/analytics/overview'),
        api.get<{ posts: TopPost[] }>('/analytics/top-posts'),
      ])
      setOverview(ovRes.data)
      setTopPosts(tpRes.data.posts)
    } catch { toast.error('Failed to load analytics') }
    finally { setLoading(false) }
  }, [])

  const fetchGrowth = useCallback(async () => {
    try {
      const params: any = { days: growthDays }
      if (selectedAccId !== 'all') params.accountId = selectedAccId
      const { data } = await api.get<{ growth: GrowthPoint[] }>('/analytics/growth', { params })
      setGrowth(data.growth)
    } catch { toast.error('Failed to load growth data') }
  }, [growthDays, selectedAccId])

  useEffect(() => { fetchOverview() }, [fetchOverview])
  useEffect(() => { fetchGrowth() }, [fetchGrowth])

  // ── Export CSV ─────────────────────────────────────────────────────────
  function exportCSV() {
    if (!overview) return
    const rows = [
      ['Username','Platform','Status','Followers','Following','Posts','Avg Likes','Avg Comments','Avg Saves','Avg Reach','Engagement Rate %','Weekly Growth'],
      ...overview.accountMetrics.map(m => [
        m.username, m.platform, m.status, m.followers, m.following, m.posts,
        m.avgLikes, m.avgComments, m.avgSaves, m.avgReach, m.engagementRate, m.weeklyGrowth,
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground">
        <div className="h-8 w-8 rounded-full border-2 border-border border-t-purple-400 animate-spin mr-3" />
        Loading analytics…
      </div>
    )
  }

  const summary = overview?.summary
  const metrics = (overview?.accountMetrics ?? [])
    .filter(m => platformFilter === 'all' || m.platform === platformFilter)
    .sort((a, b) => b[metricSort] - a[metricSort])

  // Bar chart data: top 10 by followers
  const barData = [...(overview?.accountMetrics ?? [])]
    .sort((a, b) => b.followers - a.followers)
    .slice(0, 10)
    .map(m => ({ name: m.username.slice(0, 12), followers: m.followers, engagement: m.engagementRate, platform: m.platform }))

  // Reduce growth chart ticks for readability
  const growthReduced = growth.filter((_, i, arr) => {
    if (growthDays === 7)  return true
    if (growthDays === 30) return i % 3 === 0 || i === arr.length - 1
    return i % 7 === 0 || i === arr.length - 1
  })

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-purple-400" /> Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Performance insights across all accounts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchOverview}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: 'Total Followers', value: formatNumber(summary?.totalFollowers ?? 0), icon: Users, color: 'text-blue-400', sub: `+${formatNumber(summary?.weeklyFollowerGain ?? 0)} this week`, up: (summary?.weeklyFollowerGain ?? 0) >= 0 },
          { label: 'Total Reach',     value: formatNumber(summary?.totalReach ?? 0),     icon: Eye,   color: 'text-cyan-400',   sub: 'Combined avg reach', up: true },
          { label: 'Total Posts',     value: formatNumber(summary?.totalPosts ?? 0),      icon: BarChart3, color: 'text-purple-400', sub: 'All time', up: true },
          { label: 'Avg Engagement',  value: `${summary?.avgEngagement ?? 0}%`,           icon: Heart, color: 'text-pink-400',  sub: 'Across all accounts', up: (summary?.avgEngagement ?? 0) > 1 },
          { label: 'Best Account',    value: `@${overview?.bestAccount?.username ?? '—'}`, icon: Trophy, color: 'text-yellow-400', sub: `${overview?.bestAccount?.engagementRate ?? 0}% engagement`, up: true },
        ].map(card => {
          const Icon = card.icon
          return (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <Icon className={cn('h-4 w-4', card.color)} />
                </div>
                <p className={cn('text-xl font-bold truncate', card.color)}>{card.value}</p>
                <p className="flex items-center gap-0.5 text-xs text-muted-foreground mt-1">
                  {card.up
                    ? <ArrowUpRight className="h-3 w-3 text-green-400" />
                    : <ArrowDownRight className="h-3 w-3 text-red-400" />
                  }
                  {card.sub}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ── Growth Chart ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-400" /> Follower Growth
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              {/* Account selector */}
              <div className="relative">
                <select
                  value={selectedAccId}
                  onChange={e => setSelectedAccId(e.target.value)}
                  className="appearance-none rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs pr-7 focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  <option value="all">All Accounts</option>
                  {(overview?.accountMetrics ?? []).map(m => (
                    <option key={m.accountId} value={m.accountId}>@{m.username}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              {/* Days filter */}
              <div className="flex gap-1">
                {([7, 30, 90] as const).map(d => (
                  <button key={d} onClick={() => setGrowthDays(d)}
                    className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      growthDays === d ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={growthReduced} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradFollowers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradReach" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => formatNumber(v)} width={48} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="followers" stroke="#7c3aed" strokeWidth={2} fill="url(#gradFollowers)" dot={false} />
              <Area type="monotone" dataKey="reach"     stroke="#06b6d4" strokeWidth={2} fill="url(#gradReach)"     dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Cross-account Bar Chart ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-400" /> Top 10 Accounts — Followers vs Engagement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} angle={-35} textAnchor="end" />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} tickFormatter={formatNumber} width={48} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${v}%`} width={36} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
              <Bar yAxisId="left"  dataKey="followers"  fill="#7c3aed" radius={[3,3,0,0]} maxBarSize={28} />
              <Bar yAxisId="right" dataKey="engagement" fill="#ec4899" radius={[3,3,0,0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Account Metrics Table ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm">Per-Account Metrics</CardTitle>
            <div className="flex flex-wrap gap-2">
              {/* Platform filter */}
              <div className="flex gap-1">
                {(['all','Instagram','TikTok'] as const).map(p => (
                  <button key={p} onClick={() => setPlatformFilter(p)}
                    className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      platformFilter === p ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                    {p === 'all' ? 'All' : p === 'Instagram' ? '📸 IG' : '🎵 TK'}
                  </button>
                ))}
              </div>
              {/* Sort */}
              <div className="relative">
                <select value={metricSort} onChange={e => setMetricSort(e.target.value as any)}
                  className="appearance-none rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs pr-7 focus:outline-none">
                  <option value="followers">Sort: Followers</option>
                  <option value="engagementRate">Sort: Engagement</option>
                  <option value="weeklyGrowth">Sort: Weekly Growth</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {['Account','Followers','Posts','Avg Likes','Avg Comments','Avg Reach','Engagement','Wkly Growth'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => {
                  const isGrowing = m.weeklyGrowth > 0
                  return (
                    <tr key={m.accountId} className={cn('border-b border-border last:border-0 hover:bg-secondary/20 transition-colors', i === 0 && 'bg-purple-600/5')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {i === 0 && <Trophy className="h-3 w-3 text-yellow-400 shrink-0" />}
                          {m.platform === 'Instagram'
                            ? <Instagram className="h-3 w-3 text-pink-400 shrink-0" />
                            : <Music2 className="h-3 w-3 text-cyan-400 shrink-0" />
                          }
                          <span className="font-medium">@{m.username}</span>
                          {m.brandTag && (
                            <Badge variant="secondary" className="text-[9px] h-3.5 shrink-0">{m.brandTag.replace('brand_','')}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{formatNumber(m.followers)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.posts}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Heart className="h-3 w-3 text-red-400" />
                          {formatNumber(m.avgLikes)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatNumber(m.avgComments)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatNumber(m.avgReach)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('font-semibold', m.engagementRate >= 3 ? 'text-green-400' : m.engagementRate >= 1 ? 'text-yellow-400' : 'text-red-400')}>
                          {m.engagementRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('flex items-center gap-0.5 font-medium', isGrowing ? 'text-green-400' : 'text-red-400')}>
                          {isGrowing ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {isGrowing ? '+' : ''}{formatNumber(m.weeklyGrowth)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Top Posts ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-400" /> Best Performing Posts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {['Account','Caption','Likes','Comments','Saves','Engagement','Posted'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topPosts.slice(0, 10).map((post) => (
                  <tr key={post.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {post.platform === 'Instagram'
                          ? <Instagram className="h-3 w-3 text-pink-400 shrink-0" />
                          : <Music2 className="h-3 w-3 text-cyan-400 shrink-0" />
                        }
                        <span className="font-medium">@{post.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">{post.caption}</td>
                    <td className="px-4 py-3 font-medium text-red-400">{formatNumber(post.likes)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatNumber(post.comments)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatNumber(post.saves)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('font-semibold', post.engagementRate >= 3 ? 'text-green-400' : 'text-yellow-400')}>
                        {post.engagementRate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(post.postedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
