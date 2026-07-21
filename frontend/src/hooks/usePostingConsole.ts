import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export type PostingStage =
  | 'campaign_received'
  | 'account_selected'
  | 'account_lock_acquired'
  | 'browser_launching'
  | 'browser_ready'
  | 'instagram_opened'
  | 'media_selected'
  | 'upload_started'
  | 'upload_completed'
  | 'upload_rejected'
  | 'next_clicked'
  | 'cover_next_clicked'
  | 'caption_inserted'
  | 'share_clicked'
  | 'verification_started'
  | 'verification_poll'
  | 'published'
  | 'retry_scheduled'
  | 'failed'
  | 'cleanup_completed'

export type EventLevel = 'info' | 'success' | 'warning' | 'error'

export interface PostingEvent {
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
  metadata?: Record<string, unknown>
  screenshotPath?: string
  postedAt?: string
  error?: string
}

const MAX_EVENTS = 500

export function usePostingConsole() {
  const [events, setEvents] = useState<PostingEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState('')
  const [filterUsername, setFilterUsername] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const hasJoinedRef = useRef(false)

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
        // Dedup by stage+accountId+timestamp
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
    }
  }, [])

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
    return true
  })

  const latestEvent = events.length > 0 ? events[events.length - 1] : null

  const stageLevel = (_stage: PostingStage): 'info' | 'success' | 'warning' | 'error' => {
    if (['published', 'upload_completed', 'caption_inserted'].includes(_stage)) return 'success'
    if (['failed', 'upload_rejected'].includes(_stage)) return 'error'
    if (['retry_scheduled'].includes(_stage)) return 'warning'
    return 'info'
  }

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
    latestEvent,
    stageLevel,
    clear: () => setEvents([]),
    loadFromRest,
  }
}
