import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, PlayCircle, RotateCw, SendHorizontal, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice, PageHeader, Void, ago } from '@/components/growth/grammar'
import { activityApi } from '@/lib/api'
import { timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useWorkContext } from '@/lib/brandRegistry'

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
  { key: 'needs_attention', label: 'Needs attention' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'completed', label: 'Completed' },
]

const appearance: Record<Exclude<QueueStatus, 'all'>, { label: string; icon: typeof Clock3; className: string }> = {
  queued: { label: 'Queued', icon: Clock3, className: 'text-signal' },
  running: { label: 'Running', icon: PlayCircle, className: 'text-patina' },
  delayed: { label: 'Delayed', icon: Clock3, className: 'text-ochre' },
  needs_attention: { label: 'Needs attention', icon: AlertTriangle, className: 'text-oxide' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'text-patina' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-oxide' },
}

/**
 * Publishing queue. A failed request is shown as "status unavailable", never
 * as an empty queue — an operator who sees "nothing queued" might resubmit.
 */
export default function Queue() {
  const ctx = useWorkContext()
  const activeWorkspace = useRef(ctx.workspaceId)
  activeWorkspace.current = ctx.workspaceId
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [observedAt, setObservedAt] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const filter = (filters.some((f) => f.key === params.get('status')) ? params.get('status') : 'all') as QueueStatus

  const load = useCallback(async () => {
    if (!ctx.workspaceId || ctx.registry.status !== 'ready') return
    const requested = ctx.workspaceId
    setRefreshing(true)
    try {
      const { data } = await activityApi.publishingQueue(ctx.workspaceId)
      if (activeWorkspace.current !== requested) return
      setRows(data.rows || []); setState('ok'); setObservedAt(new Date().toISOString())
    } catch {
      if (activeWorkspace.current !== requested) return
      // Keep the last good rows visible but mark them as possibly outdated.
      setState('error')
    } finally { if (activeWorkspace.current === requested) setRefreshing(false) }
  }, [ctx.workspaceId, ctx.registry.status])

  useEffect(() => { setRows([]); setState('loading'); if (ctx.registry.status === 'ready' && ctx.workspaceId) load() }, [load, ctx.registry.status, ctx.workspaceId])

  const visibleRows = useMemo(() => filter === 'all' ? rows : rows.filter((row) => row.status === filter), [filter, rows])
  const countFor = (key: QueueStatus) => key === 'all' ? rows.length : rows.filter((row) => row.status === key).length
  const setFilter = (key: QueueStatus) => { const p = new URLSearchParams(params); if (key === 'all') p.delete('status'); else p.set('status', key); setParams(p, { replace: true }) }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribute · Queue"
        title="Publishing queue"
        lede="Campaign actions and quick posts, with their current status. Completed means the platform accepted the post — it is not reach or engagement."
        meta={observedAt && <span className="text-xs text-muted-foreground">Observed {ago(observedAt)}{state === 'error' && <span className="text-oxide"> · latest refresh failed</span>}</span>}
        actions={<>
          <Button variant="outline" onClick={load} disabled={refreshing}><RotateCw className={cn(refreshing && 'animate-spin')} />Refresh</Button>
          <Button asChild><Link to="/campaigns"><SendHorizontal />New campaign</Link></Button>
        </>}
      />

      {state === 'error' && (
        <Notice tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>
          Queue status is unavailable right now. {rows.length ? 'The rows below are from the last successful read and may be out of date.' : 'This does not mean nothing is queued — check again before resubmitting anything.'}
        </Notice>
      )}

      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {filters.map((item) => (
          <button key={item.key} onClick={() => setFilter(item.key)} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs', filter === item.key ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
            {item.label} <span className="font-data ml-1 opacity-70">{state === 'loading' ? '…' : state === 'error' && rows.length === 0 ? '—' : countFor(item.key)}</span>
          </button>
        ))}
      </div>

      {state === 'loading' ? <div className="flex justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading queue…</div>
        : state === 'error' && rows.length === 0 ? <Void reason="Queue status could not be read. Not shown as empty." />
        : rows.length === 0 ? (
          <div className="panel-quiet py-12 text-center">
            <SendHorizontal className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 font-medium">No publishing work has been queued</p>
            <p className="mt-1 text-sm text-muted-foreground">Confirmed by the backend {ago(observedAt)}. Create a campaign or quick post to start.</p>
            <div className="mt-4 flex justify-center gap-2"><Button variant="outline" size="sm" asChild><Link to="/compose">Quick post</Link></Button><Button variant="outline" size="sm" asChild><Link to="/campaigns">Create campaign</Link></Button></div>
          </div>
        ) : visibleRows.length === 0 ? <Void reason={`No items with status “${filters.find((f) => f.key === filter)?.label}”.`} />
        : (
          <>
            {/* Desktop table */}
            <div className={cn('panel hidden overflow-x-auto md:block', state === 'error' && 'opacity-70')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Account</th><th className="px-4 py-3 font-medium">Campaign / post</th><th className="px-4 py-3 font-medium">Platform</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Scheduled</th><th className="px-4 py-3 font-medium">Last update</th><th className="px-4 py-3 font-medium">Result</th></tr></thead>
                <tbody>{visibleRows.map((row) => {
                  const item = appearance[row.status]; const Icon = item.icon
                  return (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3"><button className="font-medium hover:text-patina" onClick={() => navigate(row.status === 'needs_attention' ? '/farm' : '/accounts')}>@{row.account}</button></td>
                      <td className="px-4 py-3">{row.campaign}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.platform}</td>
                      <td className="px-4 py-3"><span className={cn('inline-flex items-center gap-1.5 text-xs', item.className)}><Icon className="h-3.5 w-3.5" />{item.label}</span></td>
                      <td className="px-4 py-3 text-muted-foreground">{row.scheduledAt ? timeAgo(row.scheduledAt) : 'Next available'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.updatedAt ? timeAgo(row.updatedAt) : 'Not available'}</td>
                      <td className="max-w-64 truncate px-4 py-3 text-muted-foreground" title={row.result || undefined}>{row.result || (row.status === 'needs_attention' ? 'Open Sessions to recover this account.' : '—')}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
            {/* Mobile list */}
            <ul className={cn('panel divide-y divide-border md:hidden', state === 'error' && 'opacity-70')}>
              {visibleRows.map((row) => {
                const item = appearance[row.status]; const Icon = item.icon
                return (
                  <li key={row.id} className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3"><button className="truncate font-medium" onClick={() => navigate(row.status === 'needs_attention' ? '/farm' : '/accounts')}>@{row.account}</button><span className={cn('inline-flex shrink-0 items-center gap-1 text-xs', item.className)}><Icon className="h-3.5 w-3.5" />{item.label}</span></div>
                    <p className="mt-1 text-xs text-muted-foreground">{row.campaign} · {row.platform} · {row.updatedAt ? timeAgo(row.updatedAt) : 'no update time'}</p>
                    {(row.result || row.status === 'needs_attention') && <p className="mt-1.5 text-xs text-foreground/80">{row.result || 'Open Sessions to recover this account.'}</p>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
    </div>
  )
}
