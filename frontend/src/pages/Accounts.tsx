import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, Upload, Plus, Trash2, Play, Square,
  Instagram, Music2, MoreHorizontal, Edit2, ChevronDown,
  Users, ShieldCheck, RefreshCw, KeyRound,
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
import api, { accountGroupsApi, accountsApi } from '@/lib/api'
import AddAccountModal from '@/components/farm/AddAccountModal'
import EditAccountModal from '@/components/accounts/EditAccountModal'
import ImportCSVModal from '@/components/accounts/ImportCSVModal'
import LoginHelperModal from '@/components/accounts/LoginHelperModal'

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
  sessionHealth?: string
  sessionHealthReason?: string
  sessionHealthCheckedAt?: string
}

interface HealthSummary {
  HEALTHY: number
  NEEDS_RELOGIN: number
  CHECKPOINT: number
  EXPIRED: number
  PAUSED: number
  UNKNOWN: number
  total: number
}

interface AccountGroup {
  id: string
  name: string
  description?: string | null
  color?: string | null
  memberCount: number
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

const healthBadgeVariant: Record<string, 'success' | 'warning' | 'error' | 'outline'> = {
  HEALTHY: 'success',
  NEEDS_RELOGIN: 'warning',
  CHECKPOINT: 'error',
  EXPIRED: 'error',
  PAUSED: 'outline',
  UNKNOWN: 'outline',
}

const healthLabel: Record<string, string> = {
  HEALTHY: 'Healthy',
  NEEDS_RELOGIN: 'Needs Relogin',
  CHECKPOINT: 'Checkpoint',
  EXPIRED: 'Expired',
  PAUSED: 'Paused',
  UNKNOWN: 'Unknown',
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [sessionHealthFilter, setSessionHealthFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loginHelperTarget, setLoginHelperTarget] = useState<Account | null>(null)
  const [editTarget, setEditTarget] = useState<Account | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  const [healthSummary, setHealthSummary] = useState<HealthSummary>({
    HEALTHY: 0, NEEDS_RELOGIN: 0, CHECKPOINT: 0, EXPIRED: 0, PAUSED: 0, UNKNOWN: 0, total: 0,
  })
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupMembers, setGroupMembers] = useState<Account[]>([])
  const [availableGroupAccounts, setAvailableGroupAccounts] = useState<Account[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupAccountsLoading, setGroupAccountsLoading] = useState(false)

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await api.get<{ accounts: Account[] }>('/accounts')
      setAccounts(data.accounts)
      accountsApi.sessionHealthSummary().then(({ data }) => setHealthSummary(data)).catch(() => {})
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true)
    try {
      const { data } = await accountGroupsApi.list()
      setGroups(data.groups || [])
    } catch {
      toast.error('Failed to load account groups')
    } finally {
      setGroupsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
    fetchGroups()
  }, [fetchAccounts, fetchGroups])

  // ── Derived lists ────────────────────────────────────────────────────────
  const brands = [...new Set(accounts.map((a) => a.brandTag).filter(Boolean))] as string[]
  const instagramCount = useMemo(() => accounts.filter((a) => a.platform === 'Instagram').length, [accounts])
  const tiktokCount = useMemo(() => accounts.filter((a) => a.platform === 'TikTok').length, [accounts])

  const filtered = accounts.filter((a) => {
    const matchSearch = !search || a.username.toLowerCase().includes(search.toLowerCase()) ||
      (a.email ?? '').toLowerCase().includes(search.toLowerCase())
    const matchPlatform = platformFilter === 'all' || a.platform.toLowerCase() === platformFilter
    const matchStatus   = statusFilter === 'all' || a.status === statusFilter
    const matchBrand    = brandFilter === 'all' || a.brandTag === brandFilter
    const matchSessionHealth = sessionHealthFilter === 'all' || (a.sessionHealth || 'UNKNOWN') === sessionHealthFilter
    return matchSearch && matchPlatform && matchStatus && matchBrand && matchSessionHealth
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

  async function checkSession(account: Account) {
    setChecking(account.id)
    try {
      const { data } = await accountsApi.checkSession(account.id)
      toast.success(`@${account.username}: ${healthLabel[data.result.health] || data.result.health}`, data.result.reason)
      fetchAccounts()
    } catch (err: any) {
      toast.error('Session check failed', err.response?.data?.details || err.message)
    } finally {
      setChecking(null)
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

  async function checkSelectedSessions() {
    if (selected.size === 0) return
    if (selected.size > 3) {
      toast.error('Bulk Check Session max 3 selected accounts.')
      return
    }
    setBulkLoading(true)
    try {
      const { data } = await accountsApi.checkSessionBulk(Array.from(selected))
      setHealthSummary(data.summary)
      toast.success(`Checked ${data.results.length} session${data.results.length === 1 ? '' : 's'}`)
      fetchAccounts()
    } catch (err: any) {
      toast.error('Bulk session check failed', err.response?.data?.details || err.message)
    } finally {
      setBulkLoading(false)
    }
  }

  async function loadGroupAccounts(groupId: string) {
    setGroupAccountsLoading(true)
    try {
      const { data } = await accountGroupsApi.accounts(groupId, true)
      setGroupMembers(data.members || [])
      setAvailableGroupAccounts(data.availableAccounts || [])
    } catch {
      toast.error('Failed to load group members')
    } finally {
      setGroupAccountsLoading(false)
    }
  }

  async function openGroup(groupId: string) {
    if (activeGroupId === groupId) {
      setActiveGroupId(null)
      setGroupMembers([])
      setAvailableGroupAccounts([])
      return
    }

    setActiveGroupId(groupId)
    await loadGroupAccounts(groupId)
  }

  async function createGroup() {
    const name = newGroupName.trim()
    if (!name) return

    try {
      const { data } = await accountGroupsApi.create({ name })
      setNewGroupName('')
      await fetchGroups()
      setActiveGroupId(data.group.id)
      await loadGroupAccounts(data.group.id)
      toast.success('Group created')
    } catch (err: any) {
      toast.error('Create group failed', err.response?.data?.error || err.message)
    }
  }

  async function renameGroup(group: AccountGroup) {
    const name = window.prompt('Rename account group', group.name)?.trim()
    if (!name || name === group.name) return

    try {
      await accountGroupsApi.update(group.id, { name })
      await fetchGroups()
      toast.success('Group renamed')
    } catch (err: any) {
      toast.error('Rename failed', err.response?.data?.error || err.message)
    }
  }

  async function replaceGroupMembers(groupId: string, accountIds: string[]) {
    setGroupAccountsLoading(true)
    try {
      await accountGroupsApi.replaceAccounts(groupId, accountIds)
      await loadGroupAccounts(groupId)
      await fetchGroups()
    } catch (err: any) {
      toast.error('Update members failed', err.response?.data?.error || err.message)
    } finally {
      setGroupAccountsLoading(false)
    }
  }

  async function addAccountToGroup(accountId: string) {
    if (!activeGroupId) return
    const nextIds = [...new Set([...groupMembers.map(account => account.id), accountId])]
    await replaceGroupMembers(activeGroupId, nextIds)
  }

  async function removeAccountFromGroup(accountId: string) {
    if (!activeGroupId) return
    const nextIds = groupMembers.map(account => account.id).filter(id => id !== accountId)
    await replaceGroupMembers(activeGroupId, nextIds)
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

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-300">
        <p className="font-bold">Onboarding Akun</p>
        <p className="text-xs mt-1">
          Login akun dilakukan manual satu per satu. Jangan bulk login. Setelah login, jalankan Check Session untuk memastikan cookies tersimpan.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Total Accounts</p>
            <p className="mt-1 text-2xl font-bold">{accounts.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Instagram</p>
            <p className="mt-1 text-2xl font-bold">{instagramCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">TikTok</p>
            <p className="mt-1 text-2xl font-bold">{tiktokCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">HEALTHY</p>
            <p className={cn('mt-1 text-2xl font-bold', 'text-green-400')}>{healthSummary.HEALTHY}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">UNKNOWN</p>
            <p className="mt-1 text-2xl font-bold">{healthSummary.UNKNOWN}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">NEEDS_RELOGIN</p>
            <p className={cn('mt-1 text-2xl font-bold', 'text-yellow-400')}>{healthSummary.NEEDS_RELOGIN}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">CHECKPOINT</p>
            <p className={cn('mt-1 text-2xl font-bold', 'text-red-400')}>{healthSummary.CHECKPOINT}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">EXPIRED</p>
            <p className={cn('mt-1 text-2xl font-bold', 'text-red-400')}>{healthSummary.EXPIRED}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">Account Groups</h2>
            <p className="text-xs text-muted-foreground">
              Lightweight clusters for account selection. Members load only when a group is opened.
            </p>
          </div>
          <div className="flex min-w-[260px] gap-2">
            <Input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createGroup()
              }}
              placeholder="New group name"
              className="h-9"
            />
            <Button size="sm" variant="outline" onClick={createGroup} disabled={!newGroupName.trim()}>
              <Plus className="h-3.5 w-3.5" /> Create
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[280px_1fr]">
          <div className="rounded-lg border border-border/70">
            {groupsLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading groups
              </div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No groups yet.</div>
            ) : (
              <div className="max-h-72 overflow-y-auto p-2">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className={cn(
                      'mb-1 flex items-center gap-2 rounded-md text-xs transition-colors',
                      activeGroupId === group.id ? 'bg-purple-600/10 text-purple-300' : 'hover:bg-secondary'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openGroup(group.id)}
                      className="min-w-0 flex-1 px-3 py-2 text-left"
                    >
                      <span className="block truncate font-bold">{group.name}</span>
                      <span className="text-[10px] text-muted-foreground">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</span>
                    </button>
                    <button
                      type="button"
                      className="mr-2 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => renameGroup(group)}
                      title="Rename group"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/70 p-3">
            {!activeGroupId ? (
              <div className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">
                Open a group to manage members.
              </div>
            ) : groupAccountsLoading ? (
              <div className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading members
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold">Members</p>
                    <Badge variant="secondary" className="text-[10px]">{groupMembers.length}</Badge>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 p-2">
                    {groupMembers.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">No members assigned.</p>
                    ) : groupMembers.map((account) => (
                      <div key={account.id} className="mb-1 flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary/60">
                        <span className="min-w-0 truncate font-medium">@{account.username}</span>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400" onClick={() => removeAccountFromGroup(account.id)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold">Available Accounts</p>
                    <Badge variant="outline" className="text-[10px]">{availableGroupAccounts.length}</Badge>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 p-2">
                    {availableGroupAccounts.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">All available accounts are members.</p>
                    ) : availableGroupAccounts.map((account) => (
                      <div key={account.id} className="mb-1 flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary/60">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">@{account.username}</span>
                          <span className="text-[10px] text-muted-foreground">{account.status} · {account.sessionHealth || 'UNKNOWN'}</span>
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-purple-400" onClick={() => addAccountToGroup(account.id)}>
                          Add
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
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
        <Select value={sessionHealthFilter} onValueChange={setSessionHealthFilter}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="Session Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Health</SelectItem>
            <SelectItem value="HEALTHY">Healthy</SelectItem>
            <SelectItem value="NEEDS_RELOGIN">Needs Relogin</SelectItem>
            <SelectItem value="CHECKPOINT">Checkpoint</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
            <SelectItem value="UNKNOWN">Unknown</SelectItem>
          </SelectContent>
        </Select>
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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={bulkLoading || selected.size > 3} onClick={checkSelectedSessions}>
                <ShieldCheck className="h-3.5 w-3.5 text-blue-400" /> Check Selected Sessions
              </Button>
              {selected.size > 3 && (
                <p className="text-xs text-yellow-400">Max 3 accounts.</p>
              )}
            </div>
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
                <TableHead>Session Health</TableHead>
                <TableHead>Next Action</TableHead>
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

                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge
                        variant={healthBadgeVariant[account.sessionHealth || 'UNKNOWN'] ?? 'outline'}
                        className="w-fit text-[10px]"
                        title={account.sessionHealthReason || undefined}
                      >
                        {healthLabel[account.sessionHealth || 'UNKNOWN'] || 'Unknown'}
                      </Badge>
                      {account.sessionHealthCheckedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(account.sessionHealthCheckedAt)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  
                  <TableCell>
                    {(() => {
                        if (account.platform === 'TikTok') {
                            return <Badge variant="outline" className="text-[11px]">Stored Only</Badge>
                        }
                        switch (account.sessionHealth) {
                            case 'HEALTHY':
                                return <Badge variant="success" className="text-[11px]">Ready</Badge>
                            case 'NEEDS_RELOGIN':
                                return <Badge variant="warning" className="text-[11px]">Login ulang manual</Badge>
                            case 'CHECKPOINT':
                                return <Badge variant="error" className="text-[11px]">Selesaikan checkpoint manual</Badge>
                            case 'EXPIRED':
                                return <Badge variant="error" className="text-[11px]">Login ulang manual</Badge>
                            case 'UNKNOWN':
                            default:
                                return <Badge variant="outline" className="text-[11px]">Check Session / Login Manual</Badge>
                        }
                    })()}
                </TableCell>

                  {/* Brand tag */}
                  <TableCell className="text-xs text-muted-foreground">
                    {account.brandTag
                      ? <span className="rounded-md bg-purple-500/10 text-purple-400 px-1.5 py-0.5">{account.brandTag}</span>
                      : <span className="rounded-md bg-purple-500/10 text-purple-400 px-1.5 py-0.5">rockbase</span>
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
                        <DropdownMenuItem onClick={() => setLoginHelperTarget(account)}>
                          <KeyRound className="h-3.5 w-3.5" /> Manual Login Helper
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditTarget(account)}>
                          <Edit2 className="h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleSession(account)}>
                          {account.status === 'active'
                            ? <><Square className="h-3.5 w-3.5" /> Stop Session</>
                            : <><Play className="h-3.5 w-3.5" /> Start Session</>
                          }
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => checkSession(account)} disabled={checking === account.id}>
                          <ShieldCheck className={cn('h-3.5 w-3.5', checking === account.id && 'animate-pulse')} /> Check Session
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
      <LoginHelperModal account={loginHelperTarget} open={!!loginHelperTarget} onClose={() => setLoginHelperTarget(null)} />
    </div>
  )
}
