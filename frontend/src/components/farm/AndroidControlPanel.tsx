import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Home, Instagram, Keyboard, Loader2,
  MousePointerClick, Power, RefreshCw, Send, Smartphone, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

export interface AndroidControlDevice {
  id: string
  name: string
  status?: string
  avdName?: string
}

interface AndroidControlPanelProps {
  device: AndroidControlDevice
  onClose: () => void
}

type ControlPayload =
  | { action: 'tap'; x: number; y: number }
  | { action: 'swipe'; x: number; y: number; x2: number; y2: number; durationMs: number }
  | { action: 'back' }
  | { action: 'home' }
  | { action: 'wake' }
  | { action: 'open-instagram' }
  | { action: 'text'; text: string }

interface NativePoint { cx: number; cy: number; nx: number; ny: number; nw: number; nh: number }

// Tap vs swipe is decided in *display* pixels (stable regardless of screenshot resolution);
// the payload always carries native device pixels so the backend can feed them to `adb input`.
const SWIPE_DISPLAY_THRESHOLD_PX = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Screenshot/control errors come back as JSON, but a blob responseType turns the body into a Blob. */
async function describeError(error: any, fallback: string): Promise<string> {
  const data = error?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error) return String(parsed.error)
      } catch { /* not JSON — fall through to raw text */ }
      return text.trim() || fallback
    } catch {
      return fallback
    }
  }
  return data?.error || data?.details || error?.message || fallback
}

function describeAction(payload: ControlPayload): string {
  if (payload.action === 'tap') return `tap → ${payload.x}, ${payload.y}`
  if (payload.action === 'swipe') return `swipe → ${payload.x}, ${payload.y} ⇒ ${payload.x2}, ${payload.y2} (${payload.durationMs}ms)`
  if (payload.action === 'text') return 'text sent to focused field'
  return payload.action
}

/**
 * Screenshot-driven operator control for one Android device.
 * Screenshots are fetched as an authenticated blob (never a raw <img src>) and taps are
 * converted from rendered CSS pixels to native device pixels via naturalWidth/naturalHeight.
 */
export default function AndroidControlPanel({ device, onClose }: AndroidControlPanelProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [loadingShot, setLoadingShot] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [text, setText] = useState('')

  const imgRef = useRef<HTMLImageElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragRef = useRef<{ cx: number; cy: number; nx: number; ny: number; at: number } | null>(null)
  const mountedRef = useRef(false)

  const releaseImage = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const refreshScreenshot = useCallback(async () => {
    setLoadingShot(true)
    try {
      const { data } = await api.get(`/android/devices/${device.id}/screenshot`, { responseType: 'blob' })
      if (!mountedRef.current) return
      const url = URL.createObjectURL(data)
      releaseImage()
      objectUrlRef.current = url
      setImageUrl(url)
    } catch (err: any) {
      if (!mountedRef.current) return
      releaseImage()
      setImageUrl(null)
      setImageSize(null)
      dragRef.current = null
      setError(await describeError(err, 'Screenshot failed — device may not be ready'))
    } finally {
      setLoadingShot(false)
    }
  }, [device.id, releaseImage])

  // Load the first frame on open; revoke the object URL on close.
  useEffect(() => {
    mountedRef.current = true
    void refreshScreenshot()
    return () => {
      mountedRef.current = false
      releaseImage()
    }
  }, [refreshScreenshot, releaseImage])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sendControl = useCallback(async (payload: ControlPayload) => {
    if (sending || loadingShot) return
    setSending(true)
    try {
      await api.post(`/android/devices/${device.id}/control`, payload)
      setFeedback(describeAction(payload))
      // Keep controls locked until the fresh frame arrives so the next tap can never
      // land on a stale screenshot of the pre-action state.
      await new Promise((resolve) => window.setTimeout(resolve, 400))
      if (mountedRef.current) await refreshScreenshot()
    } catch (err: any) {
      // A busy/leased device is rejected server-side; surface it and wait for the operator.
      setError(await describeError(err, `Action "${payload.action}" was rejected by the device`))
    } finally {
      setSending(false)
    }
  }, [device.id, loadingShot, refreshScreenshot, sending])

  function pointFromEvent(e: { clientX: number; clientY: number }): NativePoint | null {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh || !rect.width || !rect.height) return null

    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) return null

    return {
      cx,
      cy,
      nw,
      nh,
      // Native device pixels: scale the CSS offset by the intrinsic screenshot size.
      nx: clamp(Math.round((cx / rect.width) * nw), 0, nw - 1),
      ny: clamp(Math.round((cy / rect.height) * nh), 0, nh - 1),
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (sending || loadingShot) return
    const point = pointFromEvent(e)
    if (!point) return
    dragRef.current = { cx: point.cx, cy: point.cy, nx: point.nx, ny: point.ny, at: Date.now() }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer capture is best-effort */ }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    const start = dragRef.current
    dragRef.current = null
    if (!start || sending || loadingShot) return
    const end = pointFromEvent(e)
    if (!end) return

    const distance = Math.hypot(end.cx - start.cx, end.cy - start.cy)
    if (distance < SWIPE_DISPLAY_THRESHOLD_PX) {
      void sendControl({ action: 'tap', x: end.nx, y: end.ny })
    } else {
      void sendControl({
        action: 'swipe',
        x: start.nx,
        y: start.ny,
        x2: end.nx,
        y2: end.ny,
        durationMs: clamp(Date.now() - start.at, 100, 2000),
      })
    }
  }

  function handleSendText(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    void sendControl({ action: 'text', text: value })
    setText('')
  }

  const busy = sending || loadingShot

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#080808]">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Smartphone className="h-4 w-4 text-purple-400" />
          <div>
            <p className="text-sm font-semibold text-foreground">{device.name}</p>
            <p className="text-[11px] text-muted-foreground">
              Android device control{device.avdName ? ` · ${device.avdName}` : ''}
              {device.status ? ` · ${device.status}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshScreenshot()}>
            {loadingShot
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing…</>
              : <><RefreshCw className="h-3.5 w-3.5" /> Refresh</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close device control">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Device errors: sticky until the operator dismisses them ── */}
      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-red-300">Device action failed</p>
            <p className="text-xs text-red-300/90">{error}</p>
            <p className="mt-0.5 text-[10px] text-red-300/70">
              Nothing retried automatically — check the device (ready / not busy), then retry or dismiss.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      {/* ── Screenshot surface ───────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#060606]">
        {imageUrl ? (
          <>
            <img
              ref={imgRef}
              src={imageUrl}
              alt={`${device.name} live screen`}
              className={cn(
                'max-h-full max-w-full touch-none select-none object-contain',
                sending ? 'cursor-wait opacity-70' : 'cursor-crosshair',
              )}
              draggable={false}
              onLoad={(e) => setImageSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => { dragRef.current = null }}
            />
            {sending && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex items-center gap-2 rounded-full bg-purple-600/90 px-3 py-1.5 text-xs font-medium text-white">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending action…
                </div>
              </div>
            )}
            {feedback && !sending && (
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-purple-600/90 px-3 py-1 text-xs font-medium text-white">
                {feedback}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 text-center text-muted-foreground">
            {loadingShot ? <Loader2 className="h-8 w-8 animate-spin" /> : <Smartphone className="h-8 w-8 opacity-40" />}
            <p className="text-sm">{loadingShot ? 'Fetching screenshot…' : 'No screenshot yet.'}</p>
            {!loadingShot && (
              <Button size="sm" variant="outline" onClick={() => void refreshScreenshot()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Action bar ───────────────────────────────────────────── */}
      <div className="shrink-0 space-y-3 border-t border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="h-3.5 w-3.5" /> Tap the screen · drag to swipe
          </span>
          {imageSize && (
            <span className="text-[10px] text-muted-foreground/70">
              native {imageSize.w}×{imageSize.h}px
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void sendControl({ action: 'back' })}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void sendControl({ action: 'home' })}>
              <Home className="h-3.5 w-3.5" /> Home
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void sendControl({ action: 'wake' })}>
              <Power className="h-3.5 w-3.5" /> Wake
            </Button>
            <Button size="sm" variant="purple" disabled={busy} onClick={() => void sendControl({ action: 'open-instagram' })}>
              <Instagram className="h-3.5 w-3.5" /> Open Instagram
            </Button>
          </div>
        </div>

        <form onSubmit={handleSendText} className="flex flex-wrap items-center gap-2">
          <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Text to type on device"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type text into the focused field on the device…"
            className="h-9 min-w-[220px] flex-1 bg-secondary/50 text-sm"
            maxLength={250}
            disabled={busy}
          />
          <Button type="submit" size="sm" variant="purple" disabled={busy || !text.trim()}>
            <Send className="h-3.5 w-3.5" /> Send text
          </Button>
        </form>

        <p className="text-[10px] text-muted-foreground">
          Never type account passwords, emails or recovery codes here — sign-in on the device stays manual. Controls
          only work on a READY, unleased device; a busy device rejects the action until it is free. Text goes through
          adb input: letters, numbers, space and @ . _ - only, max 250 characters.
        </p>
      </div>
    </div>
  )
}
