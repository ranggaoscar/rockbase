import { useEffect, useState } from 'react'
import { X, Calendar, Clock, Instagram, Music2, RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

interface Account { id: string; username: string; platform: string; status: string; brandTag?: string }

interface ScheduledPost {
  id: string
  content: string
  accountIds: string[]
  scheduledAt: string
  timezone: string
  recurrence: string
  recurrenceInterval: number
  recurrenceEndDate?: string
  status: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editPost?: ScheduledPost | null
}

const RECURRENCE_OPTIONS = [
  { value: 'none',    label: 'No repeat' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'custom',  label: 'Every N days' },
]

export default function CreateScheduleModal({ open, onClose, onSuccess, editPost }: Props) {
  const [accounts, setAccounts]         = useState<Account[]>([])
  const [content, setContent]           = useState('')
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [dateStr, setDateStr]           = useState('')   // YYYY-MM-DD
  const [timeStr, setTimeStr]           = useState('09:00')
  const [timezone]                      = useState('Asia/Jakarta')
  const [recurrence, setRecurrence]     = useState('none')
  const [recurrenceInterval, setRecurrenceInterval] = useState(2)
  const [recurrenceEndDate, setRecurrenceEndDate]   = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'Instagram' | 'TikTok'>('all')
  const [submitting, setSubmitting]     = useState(false)

  useEffect(() => {
    if (!open) return
    api.get<{ accounts: Account[] }>('/accounts')
      .then(({ data }) => setAccounts(data.accounts.filter(a => a.status === 'active')))
      .catch(() => toast.error('Failed to load accounts'))

    if (editPost) {
      setContent(editPost.content)
      setSelectedIds(new Set(editPost.accountIds))
      const d = new Date(editPost.scheduledAt)
      // Format for WIB display (+7)
      setDateStr(editPost.scheduledAt.slice(0, 10))
      setTimeStr(editPost.scheduledAt.slice(11, 16))
      setRecurrence(editPost.recurrence)
      setRecurrenceInterval(editPost.recurrenceInterval || 2)
      setRecurrenceEndDate(editPost.recurrenceEndDate?.slice(0, 10) ?? '')
    } else {
      // Default: tomorrow at 09:00 WIB
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      setDateStr(tomorrow.toISOString().slice(0, 10))
      setTimeStr('09:00')
      setContent('')
      setSelectedIds(new Set())
      setRecurrence('none')
      setRecurrenceInterval(2)
      setRecurrenceEndDate('')
    }
  }, [open, editPost])

  function toggleAccount(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const filtered = accounts.filter(a => platformFilter === 'all' || a.platform === platformFilter)

  async function handleSubmit() {
    if (!content.trim()) { toast.error('Caption is required'); return }
    if (selectedIds.size === 0) { toast.error('Select at least one account'); return }
    if (!dateStr || !timeStr) { toast.error('Date and time are required'); return }

    // Combine date + time → ISO string
    const scheduledAt = new Date(`${dateStr}T${timeStr}:00+07:00`).toISOString()

    setSubmitting(true)
    try {
      if (editPost) {
        await api.patch(`/scheduler/${editPost.id}`, {
          content, accountIds: [...selectedIds], scheduledAt, timezone,
          recurrence, recurrenceInterval,
          recurrenceEndDate: recurrenceEndDate || null,
        })
        toast.success('Schedule updated')
      } else {
        await api.post('/scheduler', {
          content, accountIds: [...selectedIds], scheduledAt, timezone,
          recurrence, recurrenceInterval,
          recurrenceEndDate: recurrenceEndDate || null,
        })
        toast.success('Schedule created')
      }
      onSuccess()
      onClose()
    } catch {
      toast.error('Failed to save schedule')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-400" />
            <h2 className="font-semibold">{editPost ? 'Edit Schedule' : 'Create Schedule'}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* Caption */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caption</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your caption…"
              rows={5}
              className="resize-none text-sm"
            />
            <div className="text-xs text-muted-foreground text-right">{content.length} / 2200</div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Date
              </Label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Time (WIB)
              </Label>
              <input
                type="time"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Recurrence */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Repeat
            </Label>
            <div className="flex gap-2">
              {RECURRENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRecurrence(opt.value)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors border',
                    recurrence === opt.value
                      ? 'bg-purple-600 border-purple-600 text-white'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {recurrence === 'custom' && (
              <div className="flex items-center gap-2 text-sm pt-1">
                <span className="text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(Number(e.target.value))}
                  className="w-16 rounded-lg border border-border bg-secondary px-2 py-1 text-sm text-center"
                />
                <span className="text-muted-foreground">days</span>
              </div>
            )}

            {recurrence !== 'none' && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs text-muted-foreground">End date (optional)</Label>
                <input
                  type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            )}
          </div>

          {/* Account selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Post to Accounts</Label>
              <span className="text-xs text-purple-400">{selectedIds.size} selected</span>
            </div>
            {/* Platform filter */}
            <div className="flex gap-1">
              {(['all', 'Instagram', 'TikTok'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    platformFilter === p ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p === 'all' ? 'All' : p === 'Instagram' ? '📸 IG' : '🎵 TK'}
                </button>
              ))}
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg border border-border p-2">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">No active accounts</p>
              ) : filtered.map((acc) => (
                <div
                  key={acc.id}
                  onClick={() => toggleAccount(acc.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
                    selectedIds.has(acc.id) ? 'bg-purple-600/10 border border-purple-600/20' : 'hover:bg-secondary'
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(acc.id)}
                    onCheckedChange={() => toggleAccount(acc.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  {acc.platform === 'Instagram'
                    ? <Instagram className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                    : <Music2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  }
                  <span className="text-xs font-medium">@{acc.username}</span>
                  {acc.brandTag && (
                    <Badge variant="secondary" className="text-[10px] h-4 ml-auto">{acc.brandTag.replace('brand_', '')}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="purple" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</>
              : <><Plus className="h-4 w-4" /> {editPost ? 'Save Changes' : 'Schedule Post'}</>
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
