import { useEffect, useRef } from 'react'
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  EyeOff,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Terminal,
  XCircle,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PostingEvent, PostingStage } from '@/hooks/usePostingConsole'

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
  onClear: () => void
  onRefresh: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

const stageStyles: Record<string, string> = {
  success: 'border-green-500/30 bg-green-500/10 text-green-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  info: 'border-blue-500/20 bg-blue-500/5 text-blue-300',
}

const stageIcons: Record<PostingStage, typeof Terminal> = {
  campaign_received: Activity,
  account_selected: Activity,
  account_lock_acquired: Activity,
  browser_launching: Loader2,
  browser_ready: CheckCircle2,
  instagram_opened: Info,
  media_selected: Info,
  upload_started: Loader2,
  upload_completed: CheckCircle2,
  upload_rejected: XCircle,
  next_clicked: ChevronDown,
  cover_next_clicked: ChevronDown,
  caption_inserted: CheckCircle2,
  share_clicked: ChevronUp,
  verification_started: Loader2,
  verification_poll: Activity,
  published: CheckCircle2,
  retry_scheduled: AlertTriangle,
  failed: XCircle,
  cleanup_completed: CheckCircle2,
}

function StageIcon({ stage, level }: { stage: PostingStage; level: string }) {
  const Icon = stageIcons[stage] || Activity
  const animate = stage === 'browser_launching' || stage === 'upload_started' || stage === 'verification_started' || stage === 'verification_poll'
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
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ts
  }
}

function formatTimestampFull(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    })
  } catch {
    return ts
  }
}

function ProgressBar({ progress }: { progress?: number }) {
  if (progress === undefined || progress === null || progress === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-purple-500 transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
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
  onClear,
  onRefresh,
}: LiveExecutionConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, autoScroll])

  return (
    <Card className="border-purple-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-purple-400" />
            Live Execution Console
          </span>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                connected ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-green-400 animate-pulse' : 'bg-red-400')} />
              {connected ? 'LIVE' : 'OFFLINE'}
            </div>
            <Badge variant="outline" className="text-[10px] tabular-nums text-muted-foreground">
              {events.length} events
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="relative flex-1 min-w-[120px] max-w-[200px]">
            <Input
              placeholder="Campaign ID"
              value={filterCampaign}
              onChange={(e) => onFilterCampaignChange(e.target.value)}
              className="h-7 text-[11px] pl-2"
            />
          </div>
          <div className="relative flex-1 min-w-[120px] max-w-[200px]">
            <Input
              placeholder="Username"
              value={filterUsername}
              onChange={(e) => onFilterUsernameChange(e.target.value)}
              className="h-7 text-[11px] pl-2"
            />
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('h-7 px-2 text-[11px]', autoScroll ? 'text-purple-400' : 'text-muted-foreground')}
                    onClick={onToggleAutoScroll}
                  >
                    {autoScroll ? <ArrowDown className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {autoScroll ? 'Auto' : 'Paused'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {autoScroll ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onRefresh}>
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-red-400" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>

        {/* Event list */}
        <div
          ref={scrollRef}
          className="max-h-[500px] min-h-[200px] overflow-y-auto rounded-lg border border-border bg-[#0a0a0f] font-mono text-[11px] leading-relaxed"
        >
          {events.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Terminal className="h-6 w-6 opacity-30" />
              <p className="text-xs">No execution events yet</p>
              <p className="text-[10px] opacity-60">Events will appear here when the posting queue processes jobs</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {events.map((event, idx) => (
                <div
                  key={`${event.stage}-${event.accountId}-${event.timestamp}-${idx}`}
                  className={cn(
                    'flex items-start gap-2 border-b border-border/20 px-3 py-1.5 transition-colors hover:bg-white/[0.02]',
                    event.level === 'error' && 'bg-red-500/5',
                    event.level === 'success' && 'bg-green-500/5',
                  )}
                >
                  {/* Timestamp */}
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60 w-[68px] text-right" title={formatTimestampFull(event.timestamp)}>
                    {formatTimestamp(event.timestamp)}
                  </span>

                  {/* Icon */}
                  <StageIcon stage={event.stage} level={event.level} />

                  {/* Username */}
                  <span className="shrink-0 max-w-[120px] truncate font-semibold text-purple-300/80">
                    @{event.username}
                  </span>

                  {/* Stage badge */}
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-[9px] font-normal px-1.5 py-0 border-0',
                      stageStyles[event.level] || 'text-muted-foreground',
                    )}
                  >
                    {event.stage}
                  </Badge>

                  {/* Message */}
                  <span
                    className={cn(
                      'flex-1 min-w-0 truncate',
                      event.level === 'error' ? 'text-red-300' : event.level === 'warning' ? 'text-yellow-300' : 'text-gray-300',
                    )}
                  >
                    {event.message}
                  </span>

                  {/* Attempt badge */}
                  {event.attempt && event.attempt > 1 && (
                    <Badge variant="outline" className="shrink-0 text-[9px] border-yellow-500/20 text-yellow-400/70">
                      attempt {event.attempt}
                    </Badge>
                  )}

                  {/* Progress */}
                  <ProgressBar progress={event.progress} />

                  {/* Screenshot link */}
                  {event.screenshotPath && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={`/uploads/${event.screenshotPath.split('/').pop()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[10px] text-blue-400/60 hover:text-blue-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px]">
                          View diagnostic screenshot
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
