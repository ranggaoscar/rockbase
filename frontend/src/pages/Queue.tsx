import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, PlayCircle, SendHorizontal, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { activityApi } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

type QueueStatus = 'all' | 'queued' | 'running' | 'delayed' | 'needs_attention' | 'completed' | 'failed'

interface QueueRow {
  id: string
  source: 'campaign' | 'quick_post'
  accountId: string
  account: string
  platform: string
  campaign: string
  status: Exclude<QueueStatus, 'all'>
  scheduledAt?: string | null
  updatedAt?: string | null
  result?: string | null
}

const filters: Array<{ key: QueueStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

const appearance: Record<Exclude<QueueStatus, 'all'>, { label: string; icon: typeof Clock3; className: string }> = {
  queued: { label: 'Queued', icon: Clock3, className: 'text-blue-400' },
  running: { label: 'Running', icon: PlayCircle, className: 'text-purple-400' },
  delayed: { label: 'Delayed', icon: Clock3, className: 'text-amber-400' },
  needs_attention: { label: 'Needs Attention', icon: AlertTriangle, className: 'text-red-400' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'text-green-400' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-red-400' },
}

export default function Queue() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [filter, setFilter] = useState<QueueStatus>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    activityApi.publishingQueue()
      .then(({ data }) => setRows(data.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const visibleRows = useMemo(() => filter === 'all' ? rows : rows.filter((row) => row.status === filter), [filter, rows])
  const countFor = (key: QueueStatus) => key === 'all' ? rows.length : rows.filter((row) => row.status === key).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-400">PUBLISHING QUEUE</p>
          <h1 className="mt-1 text-2xl font-bold">Coordinated publishing status</h1>
          <p className="mt-1 text-sm text-muted-foreground">See campaign actions and quick posts without exposing queue internals.</p>
        </div>
        <Button variant="purple" onClick={() => navigate('/campaigns')}><SendHorizontal className="h-4 w-4" />New campaign</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => <Button key={item.key} size="sm" variant={filter === item.key ? 'purple' : 'outline'} onClick={() => setFilter(item.key)}>{item.label} <span className="ml-1 opacity-70">{countFor(item.key)}</span></Button>)}
      </div>

      <Card>
        <CardHeader><CardTitle>Publishing work</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading queue…</div> : visibleRows.length === 0 ? <div className="py-14 text-center"><SendHorizontal className="mx-auto h-9 w-9 text-muted-foreground/40" /><p className="mt-3 font-medium">No publishing work is queued</p><p className="mt-1 text-sm text-muted-foreground">Create a campaign or quick post to start.</p><Button className="mt-4" variant="outline" onClick={() => navigate('/campaigns')}>Create campaign</Button></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Account</th><th className="px-3 py-3">Campaign / post</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Scheduled</th><th className="px-3 py-3">Last update</th><th className="px-3 py-3">Result</th></tr></thead><tbody>{visibleRows.map((row) => { const item = appearance[row.status]; const Icon = item.icon; return <tr key={row.id} className="border-b border-border/60"><td className="px-3 py-3"><button className="font-medium hover:text-purple-400" onClick={() => row.status === 'needs_attention' ? navigate('/farm') : navigate('/accounts')}>@{row.account}</button></td><td className="px-3 py-3">{row.campaign}</td><td className="px-3 py-3 text-muted-foreground">{row.platform}</td><td className="px-3 py-3"><Badge variant="outline" className={item.className}><Icon className="mr-1 h-3 w-3" />{item.label}</Badge></td><td className="px-3 py-3 text-muted-foreground">{row.scheduledAt ? timeAgo(row.scheduledAt) : 'Next available'}</td><td className="px-3 py-3 text-muted-foreground">{row.updatedAt ? timeAgo(row.updatedAt) : 'Not available'}</td><td className="max-w-64 truncate px-3 py-3 text-muted-foreground">{row.result || (row.status === 'needs_attention' ? 'Open Session Control to recover this account.' : '—')}</td></tr> })}</tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  )
}
