import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  XCircle,
  AlertTriangle,
  Info,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PostingEvent, PostingStage, LevelFilter } from '@/hooks/usePostingConsole'

// ── Props ──────────────────────────────────────────────────────────────────

interface LiveExecutionConsoleProps {
  events: PostingEvent[]
  connected: boolean
  autoScroll: boolean
  onToggleAutoScroll: () => void
  filterCampaign: string
  onFilterCampaignChange: (v: string) => void
  filterUsername: string
  onFilterUsernameChange: (v: string) => void
  filterLevel: LevelFilter
  onFilterLevelChange: (v: LevelFilter) => void
  search: string
  onSearchChange: (v: string) => void
  newEventCount: number
  onJumpToLatest: () => void
  onClear: () => void
  onRefresh: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

const levelStyles: Record<string, string> = {
  success: 'border-green-500/30 bg-green-500/10 text-green-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  info: 'border-blue-500/20 bg-blue-500/5 text-blue-300',
}

const stageIcons: Partial<Record<PostingStage, typeof Terminal>> = {
  campaign_received: Activity,
  account_selected: Activity,
  account_lock_acquired: Activity,
  account_lock_released: Activity,
  daily_budget_checked: Activity,
  browser_launching: Loader2,
  browser_ready: CheckCircle2,
  instagram_opening: Loader2,
  instagram_opened: Info,
  media_resolving: Loader2,
  media_selected: Info,
  upload_started: Loader2,
  upload_processing: Loader2,
  upload_completed: CheckCircle2,
  upload_rejected: XCircle,
  next_clicked: ChevronDown,
  cover_next_clicked: ChevronDown,
  caption_inserted: CheckCircle2,
  share_clicked: ChevronUp,
  verification_started: Loader2,
  verification_poll: Activity,
  published: CheckCircle2,
  pending_verify: Loader2,
  retry_scheduled: AlertTriangle,
  failed: XCircle,
  cleanup_started: Loader2,
  cleanup_completed: CheckCircle2,
}

const SENSITIVE_KEYS = ['password', 'token', 'cookie', 'authorization', 'bearer', 'apikey', 'api_key', 'secret', 'session', 'jwt']

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '')
  return SENSITIVE_KEYS.includes(lower)
}

function safeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (isSensitiveKey(k)) {
      out[k] = '[REDACTED]'
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = safeMetadata(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

function StageIcon({ stage, level }: { stage: PostingStage; level: string }) {
  const Icon = stageIcons[stage] || Activity
  const animate = ['browser_launching', 'instagram_opening', 'media_resolving', 'upload_started', 'upload_processing', 'verification_started', 'verification_poll', 'pending_verify', 'cleanup_started'].includes(stage)
  return (
    <Icon
      className={cn(
        'h-3.5 w-3.5 shrink-0',
        animate && 'animate-pulse',
        level === 'error' ? 'text-red-400' : level === 'warning' ? 'text-yellow-400' : level === 'success' ? 'text-green-400' : 'text-blue-400',
      )}
    />
  )
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  } catch {
    return ts
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ConsoleRow({ event }: { event: PostingEvent }) {
  const [expanded, setExpanded] = useState(false)
  const safe = safeMetadata(event.metadata)
  const hasDetail = event.campaignId || event.postId || event.accountId || event.attempt || event.progress || event.durationMs || Object.keys(safe).length > 0

  return (
    <div
      className={cn(
        'border-b border-border/20 transition-colors',
        event.level === 'error' && 'bg-red-500/[0.04]',
        event.level === 'success' && 'bg-green-500/[0.04]',
        event.level === 'warning' && 'bg-yellow-500/[0.04]',
      )}
    >
      <div
        className="group flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.02] cursor-pointer"
        onClick={() => hasDetail && setExpanded(v => !v)}
      >
        {hasDetail ? (
          expanded ? <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        ) : <span className="h-3 w-3 shrink-0" />}

        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70 w-[60px]">
          {formatTimestamp(event.timestamp)}
        </span>

        <span
          className={cn(
            'shrink-0 w-[68px] text-[9px] font-bold uppercase tracking-wider',
            event.level === 'error' ? 'text-red-400' : event.level === 'warning' ? 'text-yellow-400' : event.level === 'success' ? 'text-green-400' : 'text-blue-400',
          )}
        >
          {event.level}
        </span>

        <span className="shrink-0 max-w-[110px] truncate font-semibold text-purple-300/80">
          @{event.username || 'unknown'}
        </span>

        <StageIcon stage={event.stage} level={event.level} />

        <Badge
          variant="outline"
          className={cn(
            'shrink-0 text-[9px] font-normal px-1.5 py-0 border',
            levelStyles[event.level] || 'border-border text-muted-foreground',
          )}
        >
          {event.stage}
        </Badge>

        <span
          className={cn(
            'flex-1 min-w-0 truncate',
            event.level === 'error' ? 'text-red-300' : event.level === 'warning' ? 'text-yellow-300' : 'text-gray-200',
          )}
        >
          {event.message}
        </span>

        {event.attempt && event.attempt > 1 && (
          <Badge variant="outline" className="shrink-0 text-[9px] border-yellow-500/30 text-yellow-400/80">
            attempt {event.attempt}
          </Badge>
        )}

        {event.screenshotPath && (
          <a
            href={`/uploads/${event.screenshotPath.split('/').pop()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] text-blue-400/70 hover:text-blue-300"
            onClick={(e) => e.stopPropagation()}
            title="View diagnostic screenshot"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {expanded && hasDetail && (
        <div className="px-8 pb-2 text-[10px] font-mono text-muted-foreground">
          <div className="rounded border border-border/40 bg-black/40 p-2 space-y-0.5">
            {event.campaignId && <div><span className="text-muted-foreground/60">campaignId:</span> <span className="text-purple-300/80">{event.campaignId}</span></div>}
            {event.postId && <div><span className="text-muted-foreground/60">postId:</span> <span className="text-purple-300/80">{event.postId}</span></div>}
            {event.accountId && <div><span className="text-muted-foreground/60">accountId:</span> <span className="text-purple-300/80">{event.accountId}</span></div>}
            {event.username && <div><span className="text-muted-foreground/60">username:</span> <span className="text-purple-300/80">@{event.username}</span></div>}
            {event.attempt !== undefined && <div><span className="text-muted-foreground/60">attempt:</span> <span className="text-yellow-300">{event.attempt}</span></div>}
            {event.progress !== undefined && <div><span className="text-muted-foreground/60">progress:</span> <span className="text-blue-300">{event.progress}%</span></div>}
            {event.durationMs !== undefined && <div><span className="text-muted-foreground/60">durationMs:</span> <span className="text-blue-300">{event.durationMs}</span></div>}
            {Object.keys(safe).length > 0 && (
              <div className="pt-1">
                <div className="text-muted-foreground/60 mb-0.5">metadata:</div>
                <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug text-gray-400">{JSON.stringify(safe, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function LiveExecutionConsole({
  events,
  connected,
  autoScroll,
  onToggleAutoScroll,
  filterCampaign,
  onFilterCampaignChange,
  filterUsername,
  onFilterUsernameChange,
  filterLevel,
  onFilterLevelChange,
  search,
  onSearchChange,
  newEventCount,
  onJumpToLatest,
  onClear,
  onRefresh,
}: LiveExecutionConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive (only if autoScroll is on)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length, autoScroll])

  const status = !connected ? 'DISCONNECTED' : events.length === 0 ? 'IDLE' : 'LIVE'
  const statusColor = !connected
    ? 'bg-red-500/15 text-red-400'
    : events.length === 0
      ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-green-500/15 text-green-400'
  const dotColor = !connected ? 'bg-red-400' : events.length === 0 ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'

  return (
    <Card className="border-purple-500/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-purple-400" />
              Live Execution Console
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Realtime structured backend execution logs</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', statusColor)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', dotColor)} />
              {status}
            </div>
            <Badge variant="outline" className="text-[10px] tabular-nums text-muted-foreground">
              {events.length} events
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Filter / control bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            placeholder="Campaign ID"
            value={filterCampaign}
            onChange={(e) => onFilterCampaignChange(e.target.value)}
            className="h-7 w-[140px] text-[11px]"
          />
          <Input
            placeholder="Username"
            value={filterUsername}
            onChange={(e) => onFilterUsernameChange(e.target.value)}
            className="h-7 w-[140px] text-[11px]"
          />
          <Select value={filterLevel} onValueChange={(v) => onFilterLevelChange(v as LevelFilter)}>
            <SelectTrigger className="h-7 w-[110px] text-[11px]">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all levels</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="success">success</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Search message / stage…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 w-[180px] text-[11px]"
          />
          <div className="ml-auto flex items-center gap-1">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('h-7 px-2 text-[11px]', autoScroll ? 'text-green-400' : 'text-yellow-400')}
                    onClick={onToggleAutoScroll}
                  >
                    {autoScroll ? <><Pause className="h-3 w-3 mr-1" /> Pause</> : <><Play className="h-3 w-3 mr-1" /> Resume</>}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {autoScroll ? 'Auto-scroll is ON — newest events stay in view' : 'Auto-scroll is OFF — only frontend is paused, backend keeps running'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onRefresh}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">Reload events from backend</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-red-400" onClick={onClear}>
                    <Trash2 className="h-3 w-3 mr-1" /> Clear View
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">Clear local view only. Backend, queue, audit log &amp; DB are untouched.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* New event pill — only when paused and new events arrived */}
        {!autoScroll && newEventCount > 0 && (
          <button
            type="button"
            onClick={onJumpToLatest}
            className="sticky top-0 z-10 mx-auto flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/15 px-3 py-1 text-[11px] font-bold text-purple-200 shadow hover:bg-purple-500/25"
          >
            <ArrowDown className="h-3 w-3" />
            {newEventCount} new {newEventCount === 1 ? 'event' : 'events'}
            <span className="text-[10px] font-normal text-purple-300/70">— click to jump</span>
          </button>
        )}

        {/* Terminal body */}
        <div
          ref={scrollRef}
          data-testid="live-execution-console-body"
          className="min-h-[360px] max-h-[500px] overflow-y-auto rounded-lg border border-purple-500/20 bg-[#0a0a0f] font-mono text-[11px] leading-relaxed shadow-inner"
        >
          {events.length === 0 ? (
            <div className="flex h-[360px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <Terminal className="h-7 w-7 opacity-40 text-purple-400" />
              <p className="text-xs font-semibold text-purple-300/80">Menunggu eksekusi posting berikutnya...</p>
              <p className="text-[10px] opacity-60 text-center max-w-[320px]">
                Backend execution events will stream here when the posting queue processes a job.
                Console stays open even with no events.
              </p>
              <p className="mt-2 text-[10px] opacity-50">
                Status: <span className={cn('font-bold', !connected ? 'text-red-400' : 'text-green-400')}>{status}</span>
              </p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {events.map((event, idx) => (
                <ConsoleRow key={`${event.stage}-${event.accountId}-${event.timestamp}-${idx}`} event={event} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
