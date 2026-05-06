import { useEffect, useRef, useState } from 'react'
import {
  X, ChevronLeft, RotateCcw, ArrowUp, ArrowDown,
  Keyboard, Send, Instagram, Music2, Loader2, ShieldCheck,
} from 'lucide-react'
import { Socket } from 'socket.io-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, statusLabel } from '@/lib/utils'
import type { ScreenshotData } from './PhoneFrame'

interface ControlModalProps {
  account: ScreenshotData
  socket: Socket | null
  onClose: () => void
}

const statusDot: Record<string, string> = {
  active:     'bg-green-400',
  idle:       'bg-yellow-400',
  error:      'bg-red-400',
  warming_up: 'bg-purple-400',
  flagged:    'bg-red-500',
}

export default function ControlModal({ account, socket, onClose }: ControlModalProps) {
  const [currentImage, setCurrentImage] = useState<string | null>(account.image)
  const [typingText, setTypingText] = useState('')
  const [actionFeedback, setActionFeedback] = useState('')
  const [cookieSaved, setCookieSaved] = useState(false)
  const [savingCookies, setSavingCookies] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Enter control mode on mount, exit on unmount
  useEffect(() => {
    if (!socket) return

    socket.emit('control_action', {
      accountId: account.accountId,
      action: 'set_mode',
      params: { active: true },
    })

    // Listen for high-res screenshots for this account
    const handler = (data: ScreenshotData) => {
      if (data.accountId === account.accountId && data.image) {
        setCurrentImage(data.image)
      }
    }
    socket.on('farm_screenshot', handler)

    return () => {
      socket.emit('control_action', {
        accountId: account.accountId,
        action: 'set_mode',
        params: { active: false },
      })
      socket.off('farm_screenshot', handler)
    }
  }, [account.accountId, socket])

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function emit(action: string, params: Record<string, unknown> = {}) {
    if (!socket) return
    socket.emit('control_action', { accountId: account.accountId, action, params })
    setActionFeedback(action.replace(/_/g, ' '))
    setTimeout(() => setActionFeedback(''), 800)
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    emit('click', { x, y })
  }

  async function handleSaveCookies() {
    setSavingCookies(true)
    emit('save_cookies')
    await new Promise((r) => setTimeout(r, 1500))
    setSavingCookies(false)
    setCookieSaved(true)
    setActionFeedback('Session saved!')
    setTimeout(() => setActionFeedback(''), 2000)
  }

  function handleSendText(e: React.FormEvent) {
    e.preventDefault()
    if (!typingText.trim()) return
    emit('type', { text: typingText })
    setTypingText('')
  }

  const PlatformIcon = account.platform === 'Instagram' ? Instagram : Music2
  const platformColor = account.platform === 'Instagram' ? 'text-pink-400' : 'text-cyan-400'

  return (
    /* Full-viewport overlay */
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#080808]">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <PlatformIcon className={cn('h-4 w-4', platformColor)} />
          <div>
            <p className="text-sm font-semibold text-foreground">@{account.username}</p>
            <p className="text-[11px] text-muted-foreground">{account.platform} · Remote Control</p>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot[account.status] ?? 'bg-gray-400')} />
            <span className="text-xs text-muted-foreground">{statusLabel(account.status)}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => emit('go_back')}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => emit('scroll_up')}>
            <ArrowUp className="h-4 w-4" /> Up
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => emit('scroll_down')}>
            <ArrowDown className="h-4 w-4" /> Down
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => emit('reload')}>
            <RotateCcw className="h-4 w-4" /> Reload
          </Button>

          {/* ── Save Session button ── */}
          <Button
            size="sm"
            variant={cookieSaved ? 'outline' : 'purple'}
            className={cn('gap-1.5 ml-2', cookieSaved && 'border-green-500 text-green-400')}
            onClick={handleSaveCookies}
            disabled={savingCookies}
            title="Save session cookies so you stay logged in after closing"
          >
            {savingCookies
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              : cookieSaved
              ? <><ShieldCheck className="h-3.5 w-3.5" /> Saved!</>
              : <><ShieldCheck className="h-3.5 w-3.5" /> Save Session</>
            }
          </Button>

          <Button size="sm" variant="ghost" onClick={onClose} className="ml-2 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Screenshot (clickable) ───────────────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-[#060606]">
        {currentImage ? (
          <>
            <img
              ref={imgRef}
              src={currentImage}
              alt={`@${account.username} live`}
              className="max-h-full max-w-full object-contain cursor-crosshair select-none"
              onClick={handleImageClick}
              draggable={false}
            />
            {/* Click feedback flash */}
            {actionFeedback && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-purple-600/90 px-3 py-1 text-xs font-medium text-white pointer-events-none">
                {actionFeedback}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Waiting for screenshot…</p>
          </div>
        )}
      </div>

      {/* ── Keyboard input bar ───────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <form onSubmit={handleSendText} className="flex gap-2">
          <div className="flex items-center text-muted-foreground mr-1">
            <Keyboard className="h-4 w-4" />
          </div>
          <Input
            value={typingText}
            onChange={(e) => setTypingText(e.target.value)}
            placeholder="Type text to send to the browser…"
            className="flex-1 h-9 text-sm bg-secondary/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendText(e as any)
              }
            }}
          />
          <Button type="submit" size="sm" variant="purple" disabled={!typingText.trim()}>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => emit('key', { key: 'Enter' })}
            title="Press Enter on page"
          >
            ↵ Enter
          </Button>
        </form>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Click anywhere on the screenshot to interact · Esc to close
        </p>
      </div>
    </div>
  )
}
