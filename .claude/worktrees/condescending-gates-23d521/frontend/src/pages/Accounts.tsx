import { useCallback, useEffect, useState } from 'react'
import {
  Search, Upload, Plus, Trash2, Play, Square,
  Instagram, Music2, MoreHorizontal, Edit2, ChevronDown,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import { cn, timeAgo, statusLabel } from '@/lib/utils'
import api from '@/lib/api'
import AddAccountModal from '@/components/farm/AddAccountModal'
import EditAccountModal from '@/components/accounts/EditAccountModal'
import ImportCSVModal from '@/components/accounts/ImportCSVModal'

// ── Types ──────────────────────────────────────────────────────────────────
interface Account {
  id: string
  username: string
  platform: string
  email?: string
  status: string
  brandTag?: string
  warmingDay?: number
  proxyId?: string
  lastActive?: string
  notes?: string
  createdAt?: string
}

const statusBadgeVariant: Record<string, 'success' | 'purple' | 'warning' | 'error' | 'outline'> = {
  active:     'success',
  warming_up: 'purple',
  idle:       'warning',
  error:      'error',
  flagged:    'error',
  logged_out: 'outline',
}

const statusDot: Record<string, string> = {
  active:     'bg-green-400',
  warming_up: 'bg-purple-400 animate-pulse',
  idle:       'bg-yellow-400',
  error:      'bg-red-400',
  flagged:    'bg-red-500',
  logged_out: 'bg-gray-500',
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editTarget, setEditTarget] = useState<Account | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get<{ accounts: Account[] }>('/accounts')
      setAccounts(data.accounts)
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  // ── Derived lists ────────────────────────────────────────────────────────
  const brands = [...new Set(accounts.map((a) => a.brandTag).filter(Boolean))] as string[]

  const filtered = accounts.filter((a) => {
    const matchSearch = !search || a.username.toLowerCase().includes(search.toLowerCase()) ||
      (a.email ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPlatform = platformFilter === 'all' || a.platform.toLowerCase() === platformFilter
    const matchStatus   = statusFilter === 'all' || a.status === statusFilter
    const matchBrand    = brandFilter === 'all' || a.brandTag === brandFilter
    return matchSearch && matchPlatform && matchStatus && matchBrand
  })

  // ── Selection helpers ────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((a) => a.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Row actions ──────────────────────────────────────────────────────────
  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete @${username}? This cannot be undone.`)) return
    try {
      await api.delete(`/accounts/${id}`)
      toast.success('Account deleted')
      fetchAccounts()
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    } catch {
      toast.error('Delete failed')
    }
  }

  async function toggleSession(account: Account) {
    const action = account.status === 'active' ? 'stop-session' : 'start-session'
    try {
      await api.post(`/accounts/${account.id}/${action}`)
      toast.success(action === 'start-session' ? 'Session started' : 'Session stopped')
      fetchAccounts()
    } catch {
      toast.error('Session action failed')
    }
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────
  async function bulkAction(action: 'start-session' | 'stop-session' | 'delete') {
    if (selected.size === 0) return
    setBulkLoading(true)
    if (action === 'delete' && !confirm(`Delete ${selected.size} accounts? This cannot be undone.`)) {
      setBulkLoading(false)
      return
    }
    let ok = 0, fail = 0
    for (const id of selected) {
      try {
        if (action === 'delete') await api.delete(`/accounts/${id}`)
        else await api.post(`/accounts/${id}/${action}`)
        ok++
      } catch { fail++ }
    }
    toast.success(`${ok} accounts updated${fail > 0 ? ` (${fail} failed)` : ''}`)
    setSelected(new Set())
    fetchAccounts()
    setBulkLoading(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-400" />
            Account Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {accounts.length} accounts · {accounts.filter(a => a.status === 'active').length} active ·{' '}
            {accounts.filter(a => a.status === 'warming_up').length} warming up
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </Button>
          <Button size="sm" variant="purple" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Account
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search username or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="warming_up">Warming Up</SelectItem>
            <SelectItem value="idle">Idle</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
          </SelectContent>
        </Select>
        {brands.length > 0 && (
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue placeholder="Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {filtered.length} of {accounts.length}
        </span>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 rounded-lg bg-purple-600/10 border border-purple-600/20 px-4 py-2.5">
          <span className="text-sm font-medium text-purple-400">
            {selected.size} selected
          </span>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={bulkLoading} onClick={() => bulkAction('start-session')}>
              <Play className="h-3.5 w-3.5 text-green-400" /> Start Sessions
            </Button>
            <Button size="sm" variant="outline" disabled={bulkLoading} onClick={() => bulkAction('stop-session')}>
              <Square className="h-3.5 w-3.5 text-yellow-400" /> Stop Sessions
            </Button>
            <Button size="sm" variant="outline" disabled={bulkLoading}
              className="text-red-400 hover:text-red-400 hover:bg-red-500/10"
              onClick={() => bulkAction('delete')}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <div className="h-6 w-6 rounded-full border-2 border-border border-t-purple-400 animate-spin mr-3" />
            Loading accounts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Users className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No accounts found.</p>
            <Button size="sm" variant="purple" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Account
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Warming</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((account) => (
                <TableRow
                  key={account.id}
                  data-state={selected.has(account.id) ? 'selected' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(account.id)}
                      onCheckedChange={() => toggleOne(account.id)}
                    />
                  </TableCell>

                  {/* Username */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusDot[account.status] ?? 'bg-gray-500')} />
                      <span className="font-medium">@{account.username}</span>
                    </div>
                  </TableCell>

                  {/* Platform */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {account.platform === 'Instagram'
                        ? <Instagram className="h-3.5 w-3.5 text-pink-400" />
                        : <Music2 className="h-3.5 w-3.5 text-cyan-400" />
                      }
                      <span className="text-muted-foreground">{account.platform}</span>
                    </div>
                  </TableCell>

                  {/* Email */}
                  <TableCell className="text-muted-foreground text-xs">
                    {account.email ?? <span className="text-muted-foreground/40">—</span>}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge variant={statusBadgeVariant[account.status] ?? 'outline'} className="text-[11px]">
                      {statusLabel(account.status)}
                    </Badge>
                  </TableCell>

                  {/* Brand tag */}
                  <TableCell className="text-xs text-muted-foreground">
                    {account.brandTag
                      ? <span className="rounded-md bg-purple-500/10 text-purple-400 px-1.5 py-0.5">{account.brandTag}</span>
                      : <span className="text-muted-foreground/40">—</span>
                    }
                  </TableCell>

                  {/* Warming */}
                  <TableCell className="text-xs">
                    {account.status === 'warming_up'
                      ? <span className="text-purple-400">Day {account.warmingDay ?? 0}/14</span>
                      : account.warmingDay === 14
                        ? <span className="text-green-400">Complete</span>
                        : <span className="text-muted-foreground/40">—</span>
                    }
                  </TableCell>

                  {/* Last active */}
                  <TableCell className="text-xs text-muted-foreground">
                    {account.lastActive ? timeAgo(account.lastActive) : '—'}
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditTarget(account)}>
                          <Edit2 className="h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleSession(account)}>
                          {account.status === 'active'
                            ? <><Square className="h-3.5 w-3.5" /> Stop Session</>
                            : <><Play className="h-3.5 w-3.5" /> Start Session</>
                          }
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-400 focus:text-red-400 focus:bg-red-500/10"
                          onClick={() => handleDelete(account.id, account.username)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Modals */}
      <AddAccountModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={fetchAccounts} />
      <EditAccountModal account={editTarget} open={!!editTarget} onClose={() => setEditTarget(null)} onSuccess={fetchAccounts} />
      <ImportCSVModal open={showImport} onClose={() => setShowImport(false)} onSuccess={fetchAccounts} />
    </div>
  )
}
