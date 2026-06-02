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
import { toast } from '@/components/ui/use-toast'

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
  { key: '2', icon: Grid2x2,   label: '2×2' },
  { key: '3', icon: LayoutGrid, label: '3×4' },
  { key: '4', icon: Grid3x3,   label: '4×6' },
]
const MAX_VISIBLE_SCREENSHOTS = 4

const gridColsClass: Record<GridKey, string> = {
  '2': 'grid-cols-2 sm:grid-cols-2',
  '3': 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-3',
  '4': 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  '6': 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function matchesFilter(account: Account, filter: FilterKey, search: string): boolean {
  if (search && !account.username.toLowerCase().includes(search.toLowerCase())) return false;
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
  const [searchQuery, setSearchQuery] = useState('')
  const [gridCols, setGridCols] = useState<GridKey>('2')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [controlAccount, setControlAccount] = useState<ScreenshotData | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [monitoredAccountIds, setMonitoredAccountIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sc_monitored_accounts') || '[]') }
    catch { return [] }
  })
  const [removedStaleCount, setRemovedStaleCount] = useState(0)

  // Persist monitored slots to localStorage
  useEffect(() => {
    localStorage.setItem('sc_monitored_accounts', JSON.stringify(monitoredAccountIds))
  }, [monitoredAccountIds])

  const socketRef = useRef<Socket | null>(null)
  const gridScrollRef = useRef<HTMLDivElement | null>(null)

  // ── Load accounts from REST API ─────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get<{ accounts: Account[] }>('/accounts')
      setAccounts(data.accounts)
      
      setMonitoredAccountIds((prev) => {
        const existingIds = new Set(data.accounts.map(a => a.id))
        const cleaned = prev.filter(id => existingIds.has(id))
        if (cleaned.length < prev.length) {
          setRemovedStaleCount(prev.length - cleaned.length)
        }
        return cleaned
      })
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

  // ── Derived lists ────────────────────────────────────────────────────────
  const filteredForSelection = accounts.filter((a) => matchesFilter(a, filter, searchQuery))
  const monitoredAccounts = monitoredAccountIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is Account => Boolean(a))

  useEffect(() => {
    if (!socketRef.current || !connected) return
    socketRef.current.emit('farm_visible_accounts', { accountIds: monitoredAccountIds })
  }, [connected, monitoredAccountIds.join(',')])

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

          <Button size="sm" variant="outline" onClick={() => { setMonitoredAccountIds([]); setRemovedStaleCount(0); }}>
            Reset Slots
          </Button>

          <Button size="sm" variant="ghost" onClick={fetchAccounts} title="Refresh accounts">
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button size="sm" variant={isSelecting ? "secondary" : "purple"} onClick={() => setIsSelecting(!isSelecting)}>
            {isSelecting ? 'Done Selecting' : 'Select Monitored Accounts'}
          </Button>

          <Button size="sm" variant="outline" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* ── Filter bar (Only in Selection Mode) ──────────────────────────── */}
      {isSelecting && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {FILTERS.map(({ key, label }) => {
            const count = key === 'all'
              ? accounts.filter((a) => matchesFilter(a, 'all', searchQuery)).length
              : accounts.filter((a) => matchesFilter(a, key, searchQuery)).length

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
          <div className="ml-auto w-full sm:w-64">
            <input
              type="text"
              placeholder="Search username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* ── Info Notice ──────────────────────────────────────────────────── */}
      {!isSelecting && (
        <div className="flex flex-col gap-2">
          {removedStaleCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-400">
              <p>Beberapa akun monitoring sudah tidak tersedia dan otomatis dilepas.</p>
              <button onClick={() => setRemovedStaleCount(0)} className="ml-auto underline font-medium">Tutup</button>
            </div>
          )}
          <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-xs text-blue-400">
            <div className="flex-1 space-y-1.5">
              <p className="font-semibold text-sm">Monitoring {monitoredAccounts.length} of {accounts.length} accounts</p>
              <ul className="list-disc list-inside opacity-90 space-y-0.5">
                <li>Farm View does not keep all accounts active.</li>
                <li>Visible cards do not mean browser/session is open.</li>
                <li>Login remains manual.</li>
                <li>Session health should be checked from Accounts or per selected account.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content Area ────────────────────────────────────────────── */}
      <div ref={gridScrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="h-8 w-8 rounded-full border-2 border-border border-t-purple-400 animate-spin" />
              <p className="text-sm">Loading accounts…</p>
            </div>
          </div>
        ) : isSelecting ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredForSelection.map(account => (
              <label key={account.id} className={cn("flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors hover:bg-secondary/50", monitoredAccountIds.includes(account.id) && "border-purple-500 bg-purple-500/5")}>
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-600"
                  checked={monitoredAccountIds.includes(account.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        if (monitoredAccountIds.length >= MAX_VISIBLE_SCREENSHOTS) {
                          toast({ title: `Maksimal ${MAX_VISIBLE_SCREENSHOTS} akun untuk dimonitor.`, variant: 'destructive' })
                          return
                        }
                        setMonitoredAccountIds([...monitoredAccountIds, account.id])
                      } else {
                        setMonitoredAccountIds(monitoredAccountIds.filter(id => id !== account.id))
                      }
                    }}
                />
                <div>
                  <p className="font-semibold text-sm">{account.username}</p>
                  <p className="text-xs text-muted-foreground capitalize">{account.platform} • {account.status}</p>
                </div>
              </label>
            ))}
            {filteredForSelection.length === 0 && (
              <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                No accounts match this filter.
              </div>
            )}
          </div>
        ) : monitoredAccounts.length === 0 ? (
          <div className="flex flex-col h-64 items-center justify-center text-center p-6 border border-dashed rounded-lg border-border">
            <p className="text-muted-foreground mb-4 text-sm">Pilih maksimal 4 akun untuk dimonitor. Akun lain tetap tersimpan di Accounts.</p>
            <Button variant="outline" onClick={() => setIsSelecting(true)}>Select Accounts</Button>
          </div>
        ) : (
          <div className={cn('grid gap-3', gridColsClass[gridCols])}>
            {monitoredAccounts.map((account) => {
              const data = mergeWithScreenshot(account, screenshots)
              return (
                <div key={account.id}>
                  <PhoneFrame
                    data={data}
                    onClick={() => setControlAccount(data)}
                  />
                </div>
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
