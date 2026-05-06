import { useCallback, useEffect, useState } from 'react'
import {
  Leaf, Instagram, Music2, ChevronRight, RotateCcw,
  CheckCircle2, Clock, Heart, Eye, MessageCircle, Bookmark, Compass,
  Play, Loader2, Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { cn, timeAgo } from '@/lib/utils'
import api from '@/lib/api'

interface WarmingAccount {
  id: string
  username: string
  platform: string
  status: string
  warmingDay: number
  warmingStartDate?: string
  progress: number
  todayTasks: { action: string; description: string; count: number }[]
  isRunning?: boolean
  cookies?: string | null
}

const taskIcons: Record<string, React.ReactNode> = {
  follow:     <ChevronRight className="h-3.5 w-3.5 text-blue-400" />,
  like:       <Heart className="h-3.5 w-3.5 text-red-400" />,
  watch_reel: <Eye className="h-3.5 w-3.5 text-purple-400" />,
  comment:    <MessageCircle className="h-3.5 w-3.5 text-green-400" />,
  view_story: <Clock className="h-3.5 w-3.5 text-yellow-400" />,
  save_post:  <Bookmark className="h-3.5 w-3.5 text-orange-400" />,
  explore:    <Compass className="h-3.5 w-3.5 text-cyan-400" />,
}

const dayRangeLabel = (day: number) =>
  day <= 3 ? 'Phase 1: Basics' : day <= 7 ? 'Phase 2: Engagement' : 'Phase 3: Full Activity'

export default function WarmingManager() {
  const [accounts, setAccounts] = useState<WarmingAccount[]>([])
  const [loading, setLoading]     = useState(true)
  const [advancing, setAdvancing] = useState<string | null>(null)
  const [running, setRunning]     = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get<{ accounts: WarmingAccount[] }>('/warming')
      setAccounts(data.accounts)
    } catch { toast.error('Failed to load warming accounts') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  // Poll server to refresh running status every 8s while any session is running
  useEffect(() => {
    if (!running) return
    const interval = setInterval(fetchAccounts, 8000)
    return () => clearInterval(interval)
  }, [running, fetchAccounts])

  async function runAutomation(account: WarmingAccount) {
    if (!account.cookies && !account.isRunning) {
      toast.error('No session cookies', 'Login via Farm View → Remote Control → Save Session first')
      return
    }
    setRunning(account.id)
    try {
      await api.post(`/warming/${account.id}/run`)
      toast.success(
        `🤖 Warming started`,
        `@${account.username} Day ${account.warmingDay + 1} session is running in the background`,
      )
      // Refresh after a moment so the isRunning flag updates
      setTimeout(fetchAccounts, 2000)
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to start automation'
      toast.error('Run failed', msg)
    } finally {
      setRunning(null)
    }
  }

  async function runTask(account: WarmingAccount, task: string) {
    setRunning(account.id)
    try {
      await api.post(`/warming/${account.id}/run-task`, { task })
      toast.success(`🤖 Running: ${task.replace('_', ' ')}`, `@${account.username}`)
      setTimeout(fetchAccounts, 2000)
    } catch (err: any) {
      toast.error('Task failed', err.response?.data?.error || err.message)
    } finally {
      setRunning(null)
    }
  }

  async function advanceDay(account: WarmingAccount) {
    setAdvancing(account.id)
    try {
      const { data } = await api.post<{ newDay: number; promoted: boolean }>(`/warming/${account.id}/advance-day`)
      if (data.promoted) {
        toast.success(`@${account.username} promoted!`, 'Warming complete — now Active ✅')
      } else {
        toast.success(`Day ${data.newDay} logged`, `@${account.username} completed today's tasks`)
      }
      fetchAccounts()
    } catch { toast.error('Failed to advance day') }
    finally { setAdvancing(null) }
  }

  async function resetWarming(account: WarmingAccount) {
    if (!confirm(`Reset warming for @${account.username}? This will restart from Day 0.`)) return
    try {
      await api.post(`/warming/${account.id}/reset`)
      toast.success('Warming reset', `@${account.username} restarted from Day 0`)
      fetchAccounts()
    } catch { toast.error('Reset failed') }
  }

  // Summary stats
  const phase1 = accounts.filter(a => a.warmingDay <= 3).length
  const phase2 = accounts.filter(a => a.warmingDay > 3 && a.warmingDay <= 7).length
  const phase3 = accounts.filter(a => a.warmingDay > 7 && a.warmingDay < 14).length
  const complete = accounts.filter(a => a.warmingDay >= 14).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Leaf className="h-5 w-5 text-green-400" /> Warming Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          14-day human-like account warming — all actions use randomized delays (3–15s).
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Phase 1 (Day 1–3)',  value: phase1,    color: 'text-blue-400',   bg: 'bg-blue-500/10' },
          { label: 'Phase 2 (Day 4–7)',  value: phase2,    color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: 'Phase 3 (Day 8–14)', value: phase3,    color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { label: 'Complete',            value: complete,  color: 'text-green-400',  bg: 'bg-green-500/10' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Account grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="h-6 w-6 rounded-full border-2 border-border border-t-green-400 animate-spin mr-3" />
          Loading…
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <Leaf className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No accounts in warming phase.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => {
            const isComplete  = account.warmingDay >= 14
            const PlatformIcon = account.platform === 'Instagram' ? Instagram : Music2
            const isAdvancing  = advancing === account.id
            const isRunning    = account.isRunning || running === account.id

            return (
              <Card key={account.id} className={cn(isComplete && 'border-green-500/30 bg-green-500/5')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PlatformIcon className={cn('h-4 w-4', account.platform === 'Instagram' ? 'text-pink-400' : 'text-cyan-400')} />
                      <span className="font-semibold">@{account.username}</span>
                    </div>
                    {isComplete
                      ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="h-3 w-3" />Complete</Badge>
                      : <Badge variant="purple" className="text-[10px]">Day {account.warmingDay}/14</Badge>
                    }
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{dayRangeLabel(account.warmingDay)}</span>
                      <span>{account.progress}%</span>
                    </div>
                    <Progress value={account.progress} className={cn('h-2', isComplete && '[&>div]:bg-green-500')} />
                  </div>

                  {/* Day timeline dots */}
                  <div className="flex gap-1 mt-2">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex-1 h-1 rounded-full',
                          i < account.warmingDay ? 'bg-purple-500' : 'bg-secondary'
                        )}
                      />
                    ))}
                  </div>
                </CardHeader>

                <CardContent className="pt-0 space-y-3">
                  {/* Today's tasks */}
                  {!isComplete && (
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Today's Tasks (Day {account.warmingDay + 1})
                      </p>
                      <div className="space-y-1.5">
                        {account.todayTasks.map((task) => (
                          <div key={task.action} className="flex items-center gap-2 text-xs">
                            {taskIcons[task.action] ?? <ChevronRight className="h-3.5 w-3.5" />}
                            <span className="text-foreground/80">{task.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2 pt-1">

                    {/* Run full automation */}
                    {!isComplete && account.platform === 'Instagram' && (
                      <Button
                        size="sm"
                        variant={isRunning ? 'outline' : 'purple'}
                        className={cn('w-full gap-2', isRunning && 'border-green-500/50 text-green-400')}
                        disabled={isRunning || isAdvancing}
                        onClick={() => runAutomation(account)}
                      >
                        {isRunning
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running automation…</>
                          : <><Play className="h-3.5 w-3.5" /> Run Full Day {account.warmingDay + 1} Automation</>
                        }
                      </Button>
                    )}

                    {/* Individual task buttons */}
                    {!isComplete && !isRunning && account.platform === 'Instagram' && (
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() => runTask(account, 'follow')}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                        >
                          <ChevronRight className="h-3 w-3" /> Follow 5
                        </button>
                        <button
                          onClick={() => runTask(account, 'like')}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <Heart className="h-3 w-3" /> Like 10
                        </button>
                        <button
                          onClick={() => runTask(account, 'watch_reel')}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
                        >
                          <Eye className="h-3 w-3" /> Watch Reels
                        </button>
                        {account.warmingDay >= 8 && (
                          <button
                            onClick={() => runTask(account, 'explore')}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          >
                            <Compass className="h-3 w-3" /> Explore
                          </button>
                        )}
                      </div>
                    )}

                    {/* Manual advance + reset row */}
                    <div className="flex gap-2">
                      {!isComplete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-1 text-xs gap-1.5 text-muted-foreground"
                          disabled={isAdvancing || isRunning}
                          onClick={() => advanceDay(account)}
                        >
                          <Zap className="h-3 w-3" />
                          {account.warmingDay === 13 ? 'Mark Complete' : `Mark Day ${account.warmingDay + 1} Done`}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => resetWarming(account)}
                        title="Reset warming"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Warming schedule info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-400" />
            Automatic Warming Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            {[
              { phase: 'Day 1–3', color: 'border-blue-500/30 bg-blue-500/5',   tasks: ['Follow 5 accounts/day', 'Like 10 posts/day', 'Watch 20 reels/day'] },
              { phase: 'Day 4–7', color: 'border-yellow-500/30 bg-yellow-500/5', tasks: ['All Phase 1 tasks', '+Comment on 3 posts (AI-generated)'] },
              { phase: 'Day 8–14', color: 'border-purple-500/30 bg-purple-500/5', tasks: ['All Phase 2 tasks', '+View 10 stories', '+Save 5 posts', '+Browse Explore'] },
            ].map((p) => (
              <div key={p.phase} className={cn('rounded-lg border p-3', p.color)}>
                <p className="text-xs font-semibold text-foreground mb-2">{p.phase}</p>
                <ul className="space-y-1">
                  {p.tasks.map((t) => (
                    <li key={t} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0">•</span>{t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            All actions use randomized delays of 3–15 seconds to simulate human behavior. BullMQ runs warming jobs in the background.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
