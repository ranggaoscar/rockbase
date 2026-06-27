import { useCallback, useEffect, useState } from 'react'
import {
  Globe, Plus, Upload, RefreshCw, Trash2,
  Zap, CheckCircle2, AlertCircle, Clock, MoreHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/use-toast'
import { cn, timeAgo } from '@/lib/utils'
import api from '@/lib/api'
import AddProxyModal from '@/components/proxies/AddProxyModal'
import BulkImportModal from '@/components/proxies/BulkImportModal'

interface Proxy {
  id: string
  host: string
  port: number
  username?: string
  password?: string
  isActive: boolean
  status: 'working' | 'slow' | 'dead'
  location?: string
  lastChecked?: string
}

interface TestResult { id: string; status: string; latency: number | null }

const statusConfig = {
  working: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Working' },
  slow:    { icon: Clock,         color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Slow' },
  dead:    { icon: AlertCircle,   color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'Dead' },
}

export default function ProxyManager() {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [loading, setLoading] = useState(true)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [testingAll, setTestingAll] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [testResults, setTestResults] = useState<Map<string, TestResult>>(new Map())

  const fetchProxies = useCallback(async () => {
    try {
      const { data } = await api.get<{ proxies: Proxy[] }>('/proxies')
      setProxies(data.proxies)
    } catch { toast.error('Failed to load proxies') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchProxies() }, [fetchProxies])

  async function testProxy(id: string) {
    setTestingIds((s) => new Set(s).add(id))
    try {
      const { data } = await api.post<TestResult>(`/proxies/${id}/test`)
      setTestResults((m) => new Map(m).set(id, data))
      setProxies((prev) => prev.map((p) => p.id === id ? { ...p, status: data.status as any, lastChecked: new Date().toISOString() } : p))
      const msg = data.status === 'dead' ? 'Proxy is dead' : `${data.status} — ${data.latency}ms`
      if (data.status === 'working') toast.success('Proxy OK', msg)
      else if (data.status === 'slow') toast.warning('Proxy slow', msg)
      else toast.error('Proxy dead', msg)
    } catch { toast.error('Test failed') }
    finally { setTestingIds((s) => { const n = new Set(s); n.delete(id); return n }) }
  }

  async function testAll() {
    setTestingAll(true)
    try {
      const { data } = await api.post<{ results: TestResult[] }>('/proxies/test-all')
      const map = new Map<string, TestResult>()
      data.results.forEach((r) => map.set(r.id, r))
      setTestResults(map)
      const working = data.results.filter((r) => r.status === 'working').length
      const dead = data.results.filter((r) => r.status === 'dead').length
      toast.success('Test complete', `${working} working · ${dead} dead`)
      fetchProxies()
    } catch { toast.error('Test all failed') }
    finally { setTestingAll(false) }
  }

  async function deleteProxy(id: string, host: string) {
    if (!confirm(`Delete proxy ${host}?`)) return
    try {
      await api.delete(`/proxies/${id}`)
      toast.success('Proxy deleted')
      fetchProxies()
    } catch { toast.error('Delete failed') }
  }

  const working = proxies.filter((p) => p.status === 'working').length
  const slow = proxies.filter((p) => p.status === 'slow').length
  const dead = proxies.filter((p) => p.status === 'dead').length

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 text-cyan-400" />
            Proxy Manager
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-400" />{working} working</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{slow} slow</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />{dead} dead</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowBulk(true)}>
            <Upload className="h-3.5 w-3.5" /> Bulk Import
          </Button>
          <Button size="sm" variant="outline" onClick={testAll} disabled={testingAll || proxies.length === 0}>
            {testingAll
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Testing…</>
              : <><Zap className="h-3.5 w-3.5 text-yellow-400" /> Test All</>
            }
          </Button>
          <Button size="sm" variant="purple" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Proxy
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <div className="h-6 w-6 rounded-full border-2 border-border border-t-cyan-400 animate-spin mr-3" />
            Loading proxies…
          </div>
        ) : proxies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Globe className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No proxies configured.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowBulk(true)}>
                <Upload className="h-3.5 w-3.5" /> Bulk Import
              </Button>
              <Button size="sm" variant="purple" onClick={() => setShowAdd(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Proxy
              </Button>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Last Checked</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {proxies.map((proxy) => {
                const cfg = statusConfig[proxy.status] ?? statusConfig.dead
                const StatusIcon = cfg.icon
                const result = testResults.get(proxy.id)
                const isTesting = testingIds.has(proxy.id)

                return (
                  <TableRow key={proxy.id}>
                    {/* Host */}
                    <TableCell className="font-mono text-xs font-medium">{proxy.host}</TableCell>

                    {/* Port */}
                    <TableCell className="font-mono text-xs text-muted-foreground">{proxy.port}</TableCell>

                    {/* Auth */}
                    <TableCell className="text-xs text-muted-foreground">
                      {proxy.username
                        ? <span className="text-foreground/70">{proxy.username} / ••••</span>
                        : <span className="text-muted-foreground/40">No auth</span>
                      }
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <div className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', cfg.bg, cfg.color)}>
                        {isTesting
                          ? <RefreshCw className="h-3 w-3 animate-spin" />
                          : <StatusIcon className="h-3 w-3" />
                        }
                        {isTesting ? 'Testing…' : cfg.label}
                      </div>
                    </TableCell>

                    {/* Latency */}
                    <TableCell className="text-xs">
                      {result?.latency != null
                        ? <span className={result.latency < 100 ? 'text-green-400' : result.latency < 200 ? 'text-yellow-400' : 'text-red-400'}>
                            {result.latency}ms
                          </span>
                        : <span className="text-muted-foreground/40">—</span>
                      }
                    </TableCell>

                    {/* Location */}
                    <TableCell className="text-xs text-muted-foreground">
                      {proxy.location ?? <span className="text-muted-foreground/40">—</span>}
                    </TableCell>

                    {/* Last checked */}
                    <TableCell className="text-xs text-muted-foreground">
                      {proxy.lastChecked ? timeAgo(proxy.lastChecked) : '—'}
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
                          <DropdownMenuItem onClick={() => testProxy(proxy.id)} disabled={isTesting}>
                            <Zap className="h-3.5 w-3.5 text-yellow-400" />
                            {isTesting ? 'Testing…' : 'Test Proxy'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-400 focus:text-red-400 focus:bg-red-500/10"
                            onClick={() => deleteProxy(proxy.id, proxy.host)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <AddProxyModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={fetchProxies} />
      <BulkImportModal open={showBulk} onClose={() => setShowBulk(false)} onSuccess={fetchProxies} />
    </div>
  )
}
