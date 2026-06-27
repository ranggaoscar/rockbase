import { useCallback, useEffect, useState } from 'react'
import {
  Calendar, List, Plus, Upload, ChevronLeft, ChevronRight,
  Trash2, Edit2, RefreshCw, Clock, CheckCircle2, XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import CreateScheduleModal from '@/components/scheduler/CreateScheduleModal'
import BulkScheduleModal from '@/components/scheduler/BulkScheduleModal'

interface ScheduledPost {
  id: string
  content: string
  accountIds: string[]
  scheduledAt: string
  timezone: string
  recurrence: string
  recurrenceInterval: number
  recurrenceEndDate?: string
  status: 'pending' | 'posted' | 'failed'
  mediaUrls: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function toWIB(iso: string) {
  return new Date(new Date(iso).getTime() + 7 * 3600 * 1000)
}

function formatWIBTime(iso: string) {
  const d = toWIB(iso)
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} WIB`
}

const statusConfig = {
  pending: { label: 'Scheduled', color: 'text-blue-400',  bg: 'bg-blue-500/10',  Icon: Clock },
  posted:  { label: 'Posted',    color: 'text-green-400', bg: 'bg-green-500/10', Icon: CheckCircle2 },
  failed:  { label: 'Failed',    color: 'text-red-400',   bg: 'bg-red-500/10',   Icon: XCircle },
}

function recurrenceLabel(r: string, n: number) {
  if (r === 'daily')  return 'Daily'
  if (r === 'weekly') return 'Weekly'
  if (r === 'custom') return `Every ${n}d`
  return null
}

function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function getFirstDay(y: number, m: number)    { return new Date(y, m, 1).getDay() }

// ── Component ──────────────────────────────────────────────────────────────
export default function Scheduler() {
  const [posts, setPosts]           = useState<ScheduledPost[]>([])
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState<'calendar' | 'list'>('calendar')
  const [showCreate, setShowCreate] = useState(false)
  const [showBulk, setShowBulk]     = useState(false)
  const [editPost, setEditPost]     = useState<ScheduledPost | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all'|'pending'|'posted'|'failed'>('all')
  const [deleting, setDeleting]     = useState<string | null>(null)

  const now = new Date()
  const [calYear,  setCalYear]  = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<{ posts: ScheduledPost[] }>('/scheduler')
      setPosts(data.posts)
    } catch { toast.error('Failed to load schedule') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  async function deletePost(id: string) {
    if (!confirm('Delete this scheduled post?')) return
    setDeleting(id)
    try {
      await api.delete(`/scheduler/${id}`)
      toast.success('Deleted')
      fetchPosts()
    } catch { toast.error('Delete failed') }
    finally { setDeleting(null) }
  }

  function openEdit(post: ScheduledPost) { setEditPost(post); setShowCreate(true) }

  const filtered = posts.filter(p => statusFilter === 'all' || p.status === statusFilter)

  // Calendar map: day → posts[]
  const calMap: Record<number, ScheduledPost[]> = {}
  posts.forEach(p => {
    const d = toWIB(p.scheduledAt)
    if (d.getUTCFullYear() === calYear && d.getUTCMonth() === calMonth) {
      const day = d.getUTCDate()
      if (!calMap[day]) calMap[day] = []
      calMap[day].push(p)
    }
  })

  const daysInMonth = getDaysInMonth(calYear, calMonth)
  const firstDay    = getFirstDay(calYear, calMonth)
  const cells       = Math.ceil((firstDay + daysInMonth) / 7) * 7

  const pending = posts.filter(p => p.status === 'pending').length
  const posted  = posts.filter(p => p.status === 'posted').length
  const failed  = posts.filter(p => p.status === 'failed').length

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-400" /> Content Scheduler
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Plan and automate posts. Timezone: WIB (Asia/Jakarta).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowBulk(true)}>
            <Upload className="h-3.5 w-3.5" /> Bulk Import
          </Button>
          <Button size="sm" variant="purple" onClick={() => { setEditPost(null); setShowCreate(true) }}>
            <Plus className="h-3.5 w-3.5" /> New Schedule
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Scheduled', value: pending, color: 'text-blue-400'  },
          { label: 'Posted',    value: posted,  color: 'text-green-400' },
          { label: 'Failed',    value: failed,  color: 'text-red-400'   },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {(['calendar','list'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                view === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v === 'calendar' ? <Calendar className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {view === 'list' && (
          <div className="flex gap-1">
            {(['all','pending','posted','failed'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  statusFilter === s ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'
                )}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Calendar view ──────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{MONTH_NAMES[calMonth]} {calYear}</CardTitle>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={prevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs px-2"
                  onClick={() => { setCalYear(now.getFullYear()); setCalMonth(now.getMonth()) }}>
                  Today
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={nextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
              ))}
            </div>
            {/* Grid */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
              {Array.from({ length: cells }).map((_, i) => {
                const day = i - firstDay + 1
                const valid = day >= 1 && day <= daysInMonth
                const isToday = valid && day === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear()
                const dayPosts = valid ? (calMap[day] ?? []) : []

                return (
                  <div key={i} className={cn(
                    'bg-card min-h-[80px] p-1.5',
                    !valid && 'bg-secondary/20 opacity-40',
                    isToday && 'bg-purple-600/5',
                  )}>
                    {valid && (
                      <>
                        <span className={cn(
                          'text-xs font-medium inline-flex h-5 w-5 items-center justify-center rounded-full',
                          isToday ? 'bg-purple-600 text-white' : 'text-muted-foreground'
                        )}>{day}</span>
                        <div className="space-y-0.5 mt-1">
                          {dayPosts.slice(0, 3).map(p => (
                            <div
                              key={p.id}
                              onClick={() => openEdit(p)}
                              title={p.content.slice(0, 80)}
                              className={cn(
                                'text-[10px] rounded px-1 py-0.5 truncate cursor-pointer hover:opacity-75 transition-opacity leading-tight',
                                p.status === 'pending' && 'bg-blue-500/20 text-blue-300',
                                p.status === 'posted'  && 'bg-green-500/20 text-green-300',
                                p.status === 'failed'  && 'bg-red-500/20 text-red-300',
                              )}
                            >
                              {formatWIBTime(p.scheduledAt)} · {p.content.slice(0, 15)}…
                            </div>
                          ))}
                          {dayPosts.length > 3 && (
                            <div className="text-[10px] text-muted-foreground px-1">+{dayPosts.length - 3} more</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-blue-500/70" />Scheduled</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-green-500/70" />Posted</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded bg-red-500/70" />Failed</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── List view ──────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <div className="h-6 w-6 rounded-full border-2 border-border border-t-purple-400 animate-spin mr-3" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="flex flex-col items-center py-16 gap-3">
              <Calendar className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No scheduled posts found.</p>
              <Button size="sm" variant="purple" onClick={() => { setEditPost(null); setShowCreate(true) }}>
                <Plus className="h-3.5 w-3.5" /> Create Schedule
              </Button>
            </CardContent></Card>
          ) : filtered.map(post => {
            const cfg = statusConfig[post.status]
            const { Icon } = cfg
            const rl = recurrenceLabel(post.recurrence, post.recurrenceInterval)
            const wibDate = toWIB(post.scheduledAt)

            return (
              <Card key={post.id} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Date */}
                    <div className="shrink-0 text-center min-w-[56px]">
                      <div className="text-xl font-bold">{wibDate.getUTCDate()}</div>
                      <div className="text-xs text-muted-foreground">{MONTH_NAMES[wibDate.getUTCMonth()].slice(0,3)} {wibDate.getUTCFullYear()}</div>
                      <div className="text-xs font-medium text-purple-400 mt-0.5">{formatWIBTime(post.scheduledAt)}</div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2 text-foreground/90">{post.content}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <div className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cfg.bg, cfg.color)}>
                          <Icon className="h-3 w-3" /> {cfg.label}
                        </div>
                        <span className="text-xs text-muted-foreground">{post.accountIds.length} account{post.accountIds.length !== 1 ? 's' : ''}</span>
                        {rl && (
                          <div className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-secondary text-muted-foreground">
                            <RefreshCw className="h-2.5 w-2.5" /> {rl}
                          </div>
                        )}
                        {post.mediaUrls?.length > 0 && (
                          <span className="text-xs text-muted-foreground">{post.mediaUrls.length} media</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {post.status === 'pending' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(post)} title="Edit">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => deletePost(post.id)}
                        disabled={deleting === post.id}
                        title="Delete"
                      >
                        {deleting === post.id
                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />
                        }
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <CreateScheduleModal
        open={showCreate}
        onClose={() => { setShowCreate(false); setEditPost(null) }}
        onSuccess={fetchPosts}
        editPost={editPost}
      />
      <BulkScheduleModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onSuccess={fetchPosts}
      />
    </div>
  )
}
