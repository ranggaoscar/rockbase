import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export type PostingStage =
  | 'campaign_received'
  | 'account_selected'
  | 'account_lock_acquired'
  | 'account_lock_released'
  | 'daily_budget_checked'
  | 'browser_launching'
  | 'browser_ready'
  | 'instagram_opening'
  | 'instagram_opened'
  | 'media_resolving'
  | 'media_selected'
  | 'upload_started'
  | 'upload_processing'
  | 'upload_completed'
  | 'upload_rejected'
  | 'next_clicked'
  | 'cover_next_clicked'
  | 'caption_inserted'
  | 'share_clicked'
  | 'verification_started'
  | 'verification_poll'
  | 'published'
  | 'pending_verify'
  | 'retry_scheduled'
  | 'failed'
  | 'cleanup_started'
  | 'cleanup_completed'

export type EventLevel = 'info' | 'success' | 'warning' | 'error'

export interface PostingEvent {
  id?: string
  timestamp: string
  campaignId?: string
  postId?: string
  accountId: string
  username: string
  stage: PostingStage
  level: EventLevel
  message: string
  attempt?: number
  progress?: number
  durationMs?: number
  metadata?: Record<string, unknown>
  screenshotPath?: string
  postedAt?: string
  error?: string
}

export type LevelFilter = 'all' | EventLevel

const MAX_EVENTS = 500

export function usePostingConsole() {
  const [events, setEvents] = useState<PostingEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState('')
  const [filterUsername, setFilterUsername] = useState('')
  const [filterLevel, setFilterLevel] = useState<LevelFilter>('all')
  const [search, setSearch] = useState('')
  const [newEventCount, setNewEventCount] = useState(0)
  const socketRef = useRef<Socket | null>(null)
  const hasJoinedRef = useRef(false)
  const lastRenderedCountRef = useRef(0)

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_execution_console')
      hasJoinedRef.current = true
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('posting_execution_event', (event: PostingEvent) => {
      setEvents((prev) => {
        // Dedup by stage+accountId+timestamp (backend may also dedup, but
        // protect against reconnect double-emit on the client side).
        const dedupKey = `${event.stage}-${event.accountId}-${event.timestamp}`
        if (prev.some((e) => `${e.stage}-${e.accountId}-${e.timestamp}` === dedupKey)) {
          return prev
        }
        const next = [...prev, event]
        if (next.length > MAX_EVENTS) {
          return next.slice(next.length - MAX_EVENTS)
        }
        return next
      })
    })

    return () => {
      if (hasJoinedRef.current) {
        socket.emit('leave_execution_console')
      }
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  // Track how many new events arrived while auto-scroll was paused
  useEffect(() => {
    if (autoScroll) {
      setNewEventCount(0)
      lastRenderedCountRef.current = events.length
    } else {
      const delta = events.length - lastRenderedCountRef.current
      if (delta > 0) setNewEventCount(delta)
    }
  }, [events.length, autoScroll])

  /**
   * Load historical events from a REST response — used for page refresh persistence.
   * Expects events in chronological order (oldest first).
   */
  const loadFromRest = useCallback((restEvents: PostingEvent[]) => {
    if (!restEvents.length) return
    setEvents((prev) => {
      const existingKeys = new Set(prev.map((e) => `${e.stage}-${e.accountId}-${e.timestamp}`))
      const newEvents = restEvents.filter((e) => !existingKeys.has(`${e.stage}-${e.accountId}-${e.timestamp}`))
      if (!newEvents.length) return prev
      const merged = [...prev, ...newEvents]
      if (merged.length > MAX_EVENTS) {
        return merged.slice(merged.length - MAX_EVENTS)
      }
      return merged
    })
  }, [])

  const filteredEvents = events.filter((e) => {
    if (filterCampaign && e.campaignId !== filterCampaign) return false
    if (filterUsername && !e.username.toLowerCase().includes(filterUsername.toLowerCase())) return false
    if (filterLevel !== 'all' && e.level !== filterLevel) return false
    if (search) {
      const needle = search.toLowerCase()
      const hay = `${e.message} ${e.stage} ${e.username} ${e.campaignId || ''} ${e.postId || ''}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })

  const latestEvent = events.length > 0 ? events[events.length - 1] : null

  const clear = useCallback(() => {
    setEvents([])
    lastRenderedCountRef.current = 0
    setNewEventCount(0)
  }, [])

  const markLatestSeen = useCallback(() => {
    lastRenderedCountRef.current = events.length
    setNewEventCount(0)
  }, [events.length])

  return {
    events: filteredEvents,
    allEvents: events,
    connected,
    autoScroll,
    setAutoScroll,
    filterCampaign,
    setFilterCampaign,
    filterUsername,
    setFilterUsername,
    filterLevel,
    setFilterLevel,
    search,
    setSearch,
    newEventCount,
    markLatestSeen,
    latestEvent,
    clear,
    loadFromRest,
  }
}
