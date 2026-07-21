import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, Eye, Filter, Flame, HeartPulse, Layers, Radio, RefreshCw, SendHorizontal, Timer, Trash2, Users, XCircle } from 'lucide-react'
import { activityApi, systemApi } from '@/lib/api'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import LiveExecutionConsole from '@/components/activity/LiveExecutionConsole'
import { usePostingConsole } from '@/hooks/usePostingConsole'

interface ActivityLog {
  id: string
  type: string
  entityType: string
  entityId: string
  accountId?: string | null
  groupId?: string | null
  campaignId?: string | null
  action: string
  status: string
  message: string
  metadata?: Record<string, unknown> | null
  context?: {
    accountUsername?: string | null
    groupName?: string | null
    campaignName?: string | null
    source?: string | null
  }
  createdAt: string
}

interface ActivityResponse {
  activity: ActivityLog[]
  pagination: {
    hasMore: boolean
    nextCursor?: string | null
  }
}

interface QueueSummary {
  queued: number
  active: number
  delayed: number
  completedToday: number
  failedToday: number
  unavailable?: boolean
}

const statusStyle: Record<string, string> = {
  success: 'border-green-500/25 bg-green-500/10 text-green-400',
  queued: 'border-blue-500/25 bg-blue-500/10 text-blue-400',
  skipped: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-400',
  warning: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-400',
  failed: 'border-red-500/25 bg-red-500/10 text-red-400',
}

const severityStyle: Record<string, string> = {
  info: 'border-blue-500/25 bg-blue-500/10 text-blue-400',
  warning: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-400',
  error: 'border-red-500/25 bg-red-500/10 text-red-400',
}

const quickFilters = [
  { key: 'posting', label: 'Posting', icon: SendHorizontal },
  { key: 'warming', label: 'Warming', icon: Flame },
  { key: 'campaigns', label: 'Campaigns', icon: Layers },
  { key: 'session_health', label: 'Session Health', icon: HeartPulse },
  { key: 'groups', label: 'Groups', icon: Users },
  { key: 'ai_planning', label: 'AI Planning', icon: Bot },
]

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-green-400" />
  if (status === 'queued') return <Clock className="h-4 w-4 text-blue-400" />
  if (status === 'skipped' || status === 'warning') return <AlertTriangle className="h-4 w-4 text-yellow-400" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-400" />
  return <Activity className="h-4 w-4 text-muted-foreground" />
}

function cleanFilter(value: string) {
  return value === 'all' ? undefined : value
}

function severityFor(status: string) {
  if (status === 'failed' || status === 'error') return 'error'
  if (status === 'warning' || status === 'skipped') return 'warning'
  return 'info'
}

function isQueueRunning(summary: QueueSummary | null) {
  if (!summary || summary.unavailable) return false
  return (summary.queued + summary.active + summary.delayed) > 0
}

function formatElapsed(startedAt: Date | null) {
  if (!startedAt) return 'Idle'
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  const remainingSeconds = seconds % 60
  if (hours > 0) return `${hours}h ${remainingMinutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

function inferAccountState(item?: ActivityLog | null) {
  if (!item) return 'No posting event observed'
  const text = `${item.action} ${item.status} ${item.message} ${JSON.stringify(item.metadata || {})}`.toLowerCase()
  if (text.includes('failed_verify') || text.includes('verification') || text.includes('verify')) return 'verifying publish'
  if (text.includes('publish_success') || text.includes('job_success') || item.status === 'success') return 'completed'
  if (text.includes('publish_failure') || text.includes('job_failure') || item.status === 'failed') return 'failed'
  if (text.includes('skipped')) return 'skipped'
  if (text.includes('upload')) return 'uploading media'
  if (text.includes('caption')) return 'writing caption'
  if (text.includes('share')) return 'clicking share'
  if (text.includes('cookie')) return 'saving cookies'
  if (item.type === 'queue') return 'queue processing'
  return 'preparing upload'
}

export default function ActivityTimeline() {
  const [searchParams] = useSearchParams()
  const initialCampaignId = searchParams.get('campaignId') || ''
  const [items, setItems] = useState<ActivityLog[]>([])
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [accountId, setAccountId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [campaignId, setCampaignId] = useState(initialCampaignId)
  const [category, setCategory] = useState(initialCampaignId ? 'campaigns' : 'all')
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null)
  const [runtimeItems, setRuntimeItems] = useState<ActivityLog[]>([])
  const [runtimeStartedAt, setRuntimeStartedAt] = useState<Date | null>(null)
  const [runtimeTick, setRuntimeTick] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const postingConsole = usePostingConsole()

  // Load recent execution events from REST on mount (for page refresh)
  useEffect(() => {
    activityApi.executionEvents({ limit: 50 }).then(({ data }: any) => {
      if (data?.events?.length) {
        postingConsole.clear()
        // Events come most-recent-first, reverse to chronological order
        const reversed = [...data.events].reverse()
        postingConsole.loadFromRest(reversed)
      }
    }).catch(() => {})
  }, [postingConsole.loadFromRest])

  const params = useMemo(() => ({
    type: cleanFilter(type),
    category: cleanFilter(category),
    status: cleanFilter(status),
    accountId: accountId.trim() || undefined,
    groupId: groupId.trim() || undefined,
    campaignId: campaignId.trim() || undefined,
    limit: 25,
  }), [accountId, campaignId, category, groupId, status, type])

  async function loadActivity(nextCursor?: string | null) {
    setLoading(true)
    try {
      const { data } = await activityApi.list({ ...params, cursor: nextCursor || undefined }) as { data: ActivityResponse }
      setItems((prev) => nextCursor ? [...prev, ...(data.activity || [])] : data.activity || [])
      setCursor(data.pagination.nextCursor || null)
      setHasMore(Boolean(data.pagination.hasMore))
    } finally {
      setLoading(false)
    }
  }

  async function loadQueueSummary() {
    const { data } = await activityApi.queueSummary() as { data: { queue: QueueSummary } }
    setQueueSummary(data.queue)
  }

  async function loadRuntimeData() {
    const [{ data: queueData }, { data: activityData }] = await Promise.all([
      activityApi.queueSummary() as Promise<{ data: { queue: QueueSummary } }>,
      activityApi.list({ category: 'posting', limit: 12 }) as Promise<{ data: ActivityResponse }>,
    ])
    setQueueSummary(queueData.queue)
    setRuntimeItems(activityData.activity || [])
  }

  useEffect(() => {
    loadActivity(null)
  }, [params])

  useEffect(() => {
    loadQueueSummary().catch(() => setQueueSummary(null))
  }, [])

  useEffect(() => {
    loadRuntimeData().catch(() => {})
    const interval = window.setInterval(() => {
      loadRuntimeData().catch(() => {})
      setRuntimeTick(value => value + 1)
    }, isQueueRunning(queueSummary) ? 5000 : 15000)
    return () => window.clearInterval(interval)
  }, [queueSummary?.queued, queueSummary?.active, queueSummary?.delayed])

  useEffect(() => {
    if (isQueueRunning(queueSummary)) {
      setRuntimeStartedAt(prev => prev || new Date())
      return
    }
    setRuntimeStartedAt(null)
  }, [queueSummary?.queued, queueSummary?.active, queueSummary?.delayed, queueSummary?.unavailable])

  useEffect(() => {
    if (!isQueueRunning(queueSummary)) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = 'Posting queue is still active. Runtime monitoring will stop if you leave this page.'
      return event.returnValue
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [queueSummary?.queued, queueSummary?.active, queueSummary?.delayed, queueSummary?.unavailable])

  useEffect(() => {
    const nextCampaignId = searchParams.get('campaignId') || ''
    if (!nextCampaignId) return
    setCampaignId(nextCampaignId)
    setCategory('campaigns')
  }, [searchParams])

  const queueRunning = isQueueRunning(queueSummary)
  const remainingJobs = (queueSummary?.queued || 0) + (queueSummary?.active || 0) + (queueSummary?.delayed || 0)
  const completedJobs = queueSummary?.completedToday || 0
  const failedJobs = queueSummary?.failedToday || 0
  const runtimeTotal = Math.max(remainingJobs + completedJobs + failedJobs, 1)
  const runtimeProgress = Math.round(((completedJobs + failedJobs) / runtimeTotal) * 100)
  const latestPostingEvent = runtimeItems.find(item => item.accountId) || runtimeItems[0] || null
  const latestSuccess = runtimeItems.find(item => item.status === 'success' || item.action.includes('success'))
  const latestFailure = runtimeItems.find(item => item.status === 'failed' || item.action.includes('failure'))
  const latestVerification = runtimeItems.find(item =>
    item.action.toLowerCase().includes('verify') ||
    item.message.toLowerCase().includes('verification') ||
    JSON.stringify(item.metadata || {}).toLowerCase().includes('failed_verify')
  )
  const latestCleanup = runtimeItems.find(item => {
    const text = `${item.action} ${item.message}`.toLowerCase()
    return text.includes('cleanup') || text.includes('cookie') || text.includes('context')
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Activity Timeline</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Operational audit events across posting, queues, sessions, groups, campaigns, and AI actions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={async () => {
            try {
              toast.loading('Resetting queue...', { id: 'reset' })
              await systemApi.resetQueue()
              toast.success('Queue reset and synced successfully.', { id: 'reset' })
              loadActivity(null)
              loadQueueSummary().catch(() => {})
              loadRuntimeData().catch(() => {})
            } catch (err: any) {
              toast.error(err.response?.data?.message || err.message, { id: 'reset' })
            }
          }}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Reset Queue
          </Button>
          <Button variant="outline" size="sm" onClick={() => { loadActivity(null); loadQueueSummary().catch(() => {}); loadRuntimeData().catch(() => {}) }} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <LiveExecutionConsole
        events={postingConsole.events}
        connected={postingConsole.connected}
        autoScroll={postingConsole.autoScroll}
        onToggleAutoScroll={() => postingConsole.setAutoScroll(!postingConsole.autoScroll)}
        filterCampaign={postingConsole.filterCampaign}
        onFilterCampaignChange={postingConsole.setFilterCampaign}
        filterUsername={postingConsole.filterUsername}
        onFilterUsernameChange={postingConsole.setFilterUsername}
        onClear={() => postingConsole.clear()}
        onRefresh={() => {
          postingConsole.clear()
          activityApi.executionEvents({ limit: 50 }).then(({ data }: any) => {
            if (data?.events?.length) {
              postingConsole.loadFromRest([...data.events].reverse())
            }
          }).catch(() => {})
        }}
      />

      <Card className={cn('border-blue-500/20', queueRunning && 'border-green-500/30 bg-green-500/[0.03]')}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Radio className={cn('h-4 w-4', queueRunning ? 'text-green-400' : 'text-muted-foreground')} />
              Live Runtime Monitor
            </span>
            <Badge variant="outline" className={cn('text-[10px]', queueRunning ? 'border-green-500/30 text-green-300' : 'text-muted-foreground')}>
              {queueRunning ? 'RUNNING' : 'IDLE'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {queueRunning && (
            <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-xs font-bold text-yellow-300">
              Queue is active. Leaving or reloading this page will stop live monitoring only; it will not stop the backend queue.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {[
              ['Active Account', latestPostingEvent?.context?.accountUsername ? `@${latestPostingEvent.context.accountUsername}` : latestPostingEvent?.accountId || 'N/A'],
              ['Progress', `${runtimeProgress}%`],
              ['Completed', completedJobs],
              ['Failed', failedJobs],
              ['Delayed', queueSummary?.delayed ?? 0],
              ['Remaining', remainingJobs],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-secondary/25 p-3">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className="mt-1 truncate text-sm font-black">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/25 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                <Activity className="h-3.5 w-3.5" /> Current Account State
              </p>
              <p className="mt-2 text-sm font-bold capitalize">{inferAccountState(latestPostingEvent)}</p>
              {latestPostingEvent && (
                <p className="mt-1 text-[11px] text-muted-foreground">{latestPostingEvent.message}</p>
              )}
            </div>
            <div className="rounded-lg border border-border bg-secondary/25 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                <Eye className="h-3.5 w-3.5" /> Playwright Runtime
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Contexts</p>
                  <p className="font-black">N/A</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pages</p>
                  <p className="font-black">N/A</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">No read-only browser metrics endpoint is currently exposed.</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/25 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                <Timer className="h-3.5 w-3.5" /> Elapsed Runtime
              </p>
              <p className="mt-2 text-lg font-black">{formatElapsed(runtimeStartedAt)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Observed from this monitor session. Tick {runtimeTick}</p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            {[
              ['Latest Success', latestSuccess],
              ['Latest Failure', latestFailure],
              ['Latest Verification', latestVerification],
              ['Latest Cleanup', latestCleanup],
            ].map(([label, item]) => (
              <div key={label as string} className="rounded-lg border border-border bg-secondary/25 p-3">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label as string}</p>
                {item ? (
                  <>
                    <p className="mt-1 truncate text-xs font-bold">{(item as ActivityLog).action}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{(item as ActivityLog).message}</p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No event observed.</p>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold">Runtime Feed</p>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => loadRuntimeData().catch(() => {})}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh Runtime
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {runtimeItems.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No runtime events observed.</p>
              ) : runtimeItems.map(item => (
                <div key={item.id} className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('text-[10px]', statusStyle[item.status] || 'text-muted-foreground')}>{item.status}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{item.type}</Badge>
                    <span className="text-[11px] font-bold">{item.action}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-400" />
            Queue Visibility
            {queueSummary?.unavailable && <Badge variant="outline" className="text-[10px] text-yellow-400">Unavailable</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['Queued', queueSummary?.queued ?? 0],
            ['Active', queueSummary?.active ?? 0],
            ['Delayed', queueSummary?.delayed ?? 0],
            ['Completed Today', queueSummary?.completedToday ?? 0],
            ['Failed Today', queueSummary?.failedToday ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-secondary/25 p-3">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-black">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-purple-400" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={category === 'all' ? 'purple' : 'outline'} onClick={() => setCategory('all')} className="h-8 text-xs">
              All
            </Button>
            {quickFilters.map(({ key, label, icon: Icon }) => (
              <Button key={key} size="sm" variant={category === key ? 'purple' : 'outline'} onClick={() => setCategory(key)} className="h-8 text-xs">
                <Icon className="h-3.5 w-3.5" /> {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="posting">Posting</SelectItem>
              <SelectItem value="queue">Queue</SelectItem>
              <SelectItem value="session">Session</SelectItem>
              <SelectItem value="group">Group</SelectItem>
              <SelectItem value="campaign">Campaign</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="Account ID" />
          <Input value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder="Group ID" />
          <Input value={campaignId} onChange={(event) => setCampaignId(event.target.value)} placeholder="Campaign ID" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-400" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {loading ? 'Loading activity...' : 'No activity found.'}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-lg border border-border bg-secondary/25 p-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background">
                    <StatusIcon status={item.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn('text-[10px]', severityStyle[severityFor(item.status)])}>
                        {severityFor(item.status)}
                      </Badge>
                      <Badge variant="outline" className={cn('text-[10px]', statusStyle[item.status] || 'border-border text-muted-foreground')}>
                        {item.status}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{item.type}</Badge>
                      {item.context?.source && <Badge variant="outline" className="text-[10px]">source: {item.context.source}</Badge>}
                      <span className="truncate text-xs text-muted-foreground">{item.action}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">{item.message}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{timeAgo(item.createdAt)}</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                      <span>{item.entityType}: {item.entityId}</span>
                      {item.accountId && <span>account: {item.context?.accountUsername ? `@${item.context.accountUsername}` : item.accountId}</span>}
                      {item.groupId && <span>group: {item.context?.groupName || item.groupId}</span>}
                      {item.campaignId && <span>campaign: {item.context?.campaignName || item.campaignId}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => loadActivity(cursor)} disabled={loading}>
                {loading ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
