import { Instagram, Music2, Wifi, WifiOff, AlertCircle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface ScreenshotData {
  accountId: string
  username: string
  platform: string
  status: string
  warmingDay: number
  image: string | null
}

interface PhoneFrameProps {
  data: ScreenshotData
  onClick: () => void
}

const statusConfig: Record<string, { dot: string; label: string; ring: string }> = {
  active:     { dot: 'bg-green-400',  label: 'Active',      ring: 'ring-green-500/20' },
  idle:       { dot: 'bg-yellow-400', label: 'Idle',        ring: 'ring-yellow-500/20' },
  error:      { dot: 'bg-red-400',    label: 'Error',       ring: 'ring-red-500/20' },
  flagged:    { dot: 'bg-red-500',    label: 'Flagged',     ring: 'ring-red-500/20' },
  warming_up: { dot: 'bg-purple-400 animate-pulse', label: 'Warming', ring: 'ring-purple-500/20' },
  logged_out: { dot: 'bg-gray-500',   label: 'Logged Out',  ring: '' },
}

function PlatformIcon({ platform, size = 12 }: { platform: string; size?: number }) {
  if (platform === 'Instagram') {
    return <Instagram style={{ width: size, height: size }} className="text-pink-400" />
  }
  return <Music2 style={{ width: size, height: size }} className="text-cyan-400" />
}

export default function PhoneFrame({ data, onClick }: PhoneFrameProps) {
  const { username, platform, status, warmingDay, image } = data
  const cfg = statusConfig[status] ?? statusConfig.idle
  const warmingPct = Math.round((warmingDay / 14) * 100)
  const isWarming = status === 'warming_up'
  const isError = status === 'error'

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card',
        'transition-all duration-200 hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/10',
        'hover:-translate-y-0.5 active:translate-y-0',
        cfg.ring && `ring-1 ${cfg.ring}`
      )}
    >
      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <PlatformIcon platform={platform} size={11} />
          <span className="truncate text-[11px] font-medium text-foreground">
            @{username}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
          <span className="text-[10px] text-muted-foreground">{cfg.label}</span>
        </div>
      </div>

      {/* ── Screenshot area ─────────────────────────────────────── */}
      <div className="relative aspect-video w-full overflow-hidden bg-[#080808]">
        {image ? (
          <img
            src={image}
            alt={`@${username}`}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            {isError ? (
              <>
                <AlertCircle className="h-6 w-6 text-red-400" />
                <span className="text-[10px] text-red-400">Session Error</span>
              </>
            ) : (
              <>
                <WifiOff className="h-5 w-5 text-muted-foreground/40" />
                <span className="text-[10px] text-muted-foreground/40">No signal</span>
              </>
            )}
          </div>
        )}

        {/* Error overlay */}
        {isError && image && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-950/60">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
        )}

        {/* Hover overlay — click to control */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <div className="rounded-full bg-purple-600/90 px-3 py-1.5 text-[11px] font-semibold text-white shadow">
            Click to Control
          </div>
        </div>
      </div>

      {/* ── Warming progress bar ─────────────────────────────────── */}
      {isWarming && (
        <div className="px-2.5 py-2 border-t border-border/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-medium text-purple-400">Warming Up</span>
            <span className="text-[9px] text-muted-foreground">Day {warmingDay}/14</span>
          </div>
          <Progress value={warmingPct} className="h-1" />
        </div>
      )}
    </div>
  )
}
