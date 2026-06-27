import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import {
  Plus, LayoutGrid, Grid2x2, Grid3x3,
  Wifi, WifiOff, RefreshCw, Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import PhoneFrame, { type ScreenshotData } from '@/components/farm/PhoneFrame'
import ControlModal from '@/components/farm/ControlModal'
import AddAccountModal from '@/components/farm/AddAccountModal'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────
type FilterKey = 'all' | 'instagram' | 'tiktok' | 'active' | 'warming_up' | 'idle' | 'error'
type GridKey = '2' | '3' | '4' | '6'

interface Account {
  id: string
  username: string
  platform: string
  status: string
  warmingDay: number
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'instagram',  label: 'Instagram' },
  { key: 'tiktok',     label: 'TikTok' },
  { key: 'active',     label: 'Active' },
  { key: 'warming_up', label: 'Warming Up' },
  { key: 'idle',       label: 'Idle' },
  { key: 'error',      label: 'Error' },
]

const GRID_OPTIONS: { key: GridKey; icon: typeof LayoutGrid; label: string }[] = [
  { key: '2', icon: Grid2x2,   label: '2×3' },
  { key: '3', icon: LayoutGrid, label: '3×4' },
  { key: '4', icon: Grid3x3,   label: '4×6' },
]

const gridColsClass: Record<GridKey, string> = {
  '2': 'grid-cols-2 sm:grid-cols-2',
  '3': 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-3',
  '4': 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  '6': 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function matchesFilter(account: Account, filter: FilterKey): boolean {
  switch (filter) {
    case 'all': return true
    case 'instagram': return account.platform.toLowerCase() === 'instagram'
    case 'tiktok': return account.platform.toLowerCase() === 'tiktok'
    default: return account.status === filter
  }
}

function mergeWithScreenshot(account: Account, screenshots: Map<string, ScreenshotData>): ScreenshotData {
  const shot = screenshots.get(account.id)
  return {
    accountId: account.id,
    username: account.username,
    platform: account.platform,
    status: shot?.status ?? account.status,
    warmingDay: shot?.warmingDay ?? account.warmingDay ?? 0,
    image: shot?.image ?? null,
  }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function FarmView() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [screenshots, setScreenshots] = useState<Map<string, ScreenshotData>>(new Map())
  const [filter, setFilter] = useState<FilterKey>('all')
  const [gridCols, setGridCols] = useState<GridKey>('3')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [controlAccount, setControlAccount] = useState<ScreenshotData | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  const socketRef = useRef<Socket | null>(null)

  // ── Load accounts from REST API ─────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get<{ accounts: Account[] }>('/accounts')
      setAccounts(data.accounts)
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Socket.io connection ────────────────────────────────────────────────
  useEffect(() => {
    fetchAccounts()

    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_farm')
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('farm_screenshot', (data: ScreenshotData) => {
      setScreenshots((prev) => {
        const next = new Map(prev)
        next.set(data.accountId, data)
        return next
      })
    })

    return () => {
      socket.emit('leave_farm')
      socket.disconnect()
    }
  }, [fetchAccounts])

  // ── Derived filtered list ───────────────────────────────────────────────
  const filtered = accounts.filter((a) => matchesFilter(a, filter))

  // ── Status bar counts ───────────────────────────────────────────────────
  const counts = {
    active: accounts.filter((a) => a.status === 'active').length,
    warming: accounts.filter((a) => a.status === 'warming_up').length,
    idle: accounts.filter((a) => a.status === 'idle').length,
    error: accounts.filter((a) => a.status === 'error').length,
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-3.5rem-3rem)]">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Title + connection status */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Farm View</h1>
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            connected
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          )}>
            {connected
              ? <><Wifi className="h-3 w-3" /> Live</>
              : <><WifiOff className="h-3 w-3" /> Offline</>
            }
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />{counts.active} active
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 ml-1" />{counts.warming} warming
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 ml-1" />{counts.idle} idle
          {counts.error > 0 && <><span className="h-1.5 w-1.5 rounded-full bg-red-400 ml-1" />{counts.error} error</>}
        </div>

        {/* Right: grid toggle + add button */}
        <div className="ml-auto flex items-center gap-2">
          {/* Grid size toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {GRID_OPTIONS.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setGridCols(key)}
                title={`${label} grid`}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors',
                  gridCols === key
                    ? 'bg-purple-600 text-white'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <Button size="sm" variant="ghost" onClick={fetchAccounts} title="Refresh accounts">
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button size="sm" variant="purple" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {FILTERS.map(({ key, label }) => {
          const count = key === 'all'
            ? accounts.length
            : accounts.filter((a) => matchesFilter(a, key)).length

          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === key
                  ? 'bg-purple-600 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                filter === key ? 'bg-white/20 text-white' : 'bg-background text-muted-foreground'
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="h-8 w-8 rounded-full border-2 border-border border-t-purple-400 animate-spin" />
              <p className="text-sm">Loading accounts…</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">No accounts match this filter.</p>
              {accounts.length === 0 && (
                <Button
                  size="sm"
                  variant="purple"
                  className="mt-3"
                  onClick={() => setShowAddModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add your first account
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className={cn('grid gap-3', gridColsClass[gridCols])}>
            {filtered.map((account) => {
              const data = mergeWithScreenshot(account, screenshots)
              return (
                <PhoneFrame
                  key={account.id}
                  data={data}
                  onClick={() => setControlAccount(data)}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* ── Control Modal ─────────────────────────────────────────────────── */}
      {controlAccount && (
        <ControlModal
          account={controlAccount}
          socket={socketRef.current}
          onClose={() => setControlAccount(null)}
        />
      )}

      {/* ── Add Account Modal ─────────────────────────────────────────────── */}
      <AddAccountModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={fetchAccounts}
      />
    </div>
  )
}
