import { useEffect, useState, useCallback } from 'react'
import {
  Heart, Users, MessageSquare, Hash, Activity,
  Square, CheckCircle2, XCircle, Clock, Shield, Wifi, WifiOff,
  ChevronDown, ChevronUp, History,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api, { engagementApi } from '@/lib/api'

interface Account { id: string; username: string; platform: string; status: string }
interface PoolStatus { active: string[]; queued: string[]; activeCount: number; queuedCount: number; maxConcurrent: number }
interface LogEntry { id: string; accountId: string; actionType: string; target: string; status: string; details?: string; executedAt: string }

export default function Engagement() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pool, setPool] = useState<PoolStatus>({ active: [], queued: [], activeCount: 0, queuedCount: 0, maxConcurrent: 15 })
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [likeUrl, setLikeUrl] = useState('')
  const [followUser, setFollowUser] = useState('')
  const [commentUrl, setCommentUrl] = useState('')
  const [hashtag, setHashtag] = useState('')

  useEffect(() => {
    api.get<{ accounts: Account[] }>('/accounts')
      .then(({ data }) => setAccounts(data.accounts.filter(a => a.status === 'active')))
      .catch(() => toast.error('Failed to load accounts'))
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await engagementApi.getStatus()
      setPool(data.pool); setIsActive(data.isActiveHours); setLogs(data.recentActions || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchStatus(); const i = setInterval(fetchStatus, 5000); return () => clearInterval(i) }, [fetchStatus])

  const allSel = accounts.length > 0 && accounts.every(a => selected.has(a.id))
  const toggleAll = () => { if (allSel) setSelected(new Set()); else setSelected(new Set(accounts.map(a => a.id))) }
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ids = () => Array.from(selected)

  const act = async (fn: () => Promise<any>, msg: string) => {
    if (selected.size === 0) { toast.error('Select accounts first'); return }
    setLoading(true)
    try { await fn(); toast.success(msg) } catch { toast.error('Action failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Heart className="h-5 w-5 text-rose-400" /> Engagement Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Targeted engagement with human-like behavior simulation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={cn('text-xs', isActive ? 'bg-green-600/20 text-green-400 border-green-600/30' : 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30')}>
            {isActive ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
            {isActive ? 'Active Hours (08-22 WIB)' : 'Outside Active Hours'}
          </Badge>
          <Button variant="destructive" size="sm" onClick={() => engagementApi.stop().then(() => { toast.success('Stopped'); fetchStatus() })} className="h-7 text-xs">
            <Square className="h-3 w-3 mr-1" /> Stop All
          </Button>
        </div>
      </div>

      {/* Pool Monitor */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-blue-400" /> Session Pool</CardTitle>
            <span className="text-xs text-muted-foreground">{pool.activeCount}/{pool.maxConcurrent} Active · {pool.queuedCount} Queued</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-1.5 flex-wrap">
            {Array.from({ length: pool.maxConcurrent }).map((_, i) => {
              const aid = pool.active[i]; const acc = accounts.find(a => a.id === aid)
              return (
                <div key={i} className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-[8px] font-bold transition-all',
                  aid ? 'bg-gradient-to-br from-green-500/30 to-emerald-500/20 border border-green-500/40 text-green-300 animate-pulse'
                    : 'bg-secondary/30 border border-border/50 text-muted-foreground'
                )} title={acc ? `@${acc.username}` : `Slot ${i + 1}`}>
                  {aid ? '●' : i + 1}
                </div>
              )
            })}
          </div>
          {pool.queuedCount > 0 && <div className="mt-2 flex items-center gap-2"><Progress value={(pool.activeCount / pool.maxConcurrent) * 100} className="h-1.5" /><span className="text-xs text-muted-foreground">{pool.queuedCount} queued</span></div>}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {/* Like */}
          <Card><CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2"><Heart className="h-4 w-4 text-rose-400" /><span className="text-sm font-semibold">Like a Post</span><Badge variant="outline" className="text-[9px] h-4 ml-auto">50-80/day</Badge></div>
            <div className="flex gap-2">
              <input value={likeUrl} onChange={e => setLikeUrl(e.target.value)} placeholder="https://instagram.com/p/..." className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50" />
              <Button onClick={() => act(() => engagementApi.likePost(likeUrl, ids()).then(() => setLikeUrl('')), `Like queued for ${selected.size} accounts`)} disabled={loading || !likeUrl.trim() || selected.size === 0} className="bg-gradient-to-r from-rose-600 to-pink-600" size="sm"><Heart className="h-3.5 w-3.5 mr-1" />Like</Button>
            </div>
          </CardContent></Card>

          {/* Follow */}
          <Card><CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4 text-blue-400" /><span className="text-sm font-semibold">Follow + Like Posts</span><Badge variant="outline" className="text-[9px] h-4 ml-auto">20-30/day</Badge></div>
            <div className="flex gap-2">
              <input value={followUser} onChange={e => setFollowUser(e.target.value)} placeholder="username (without @)" className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50" />
              <Button onClick={() => act(() => engagementApi.followAndLike(followUser, ids()).then(() => setFollowUser('')), `Follow queued for ${selected.size} accounts`)} disabled={loading || !followUser.trim() || selected.size === 0} className="bg-gradient-to-r from-blue-600 to-indigo-600" size="sm"><Users className="h-3.5 w-3.5 mr-1" />Follow</Button>
            </div>
          </CardContent></Card>

          {/* Comment */}
          <Card><CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2"><MessageSquare className="h-4 w-4 text-purple-400" /><span className="text-sm font-semibold">AI Comment</span><Badge variant="outline" className="text-[9px] h-4 bg-purple-500/10 border-purple-500/20 text-purple-400 ml-auto">🇮🇩/🇬🇧 Marble Niche</Badge></div>
            <div className="flex gap-2">
              <input value={commentUrl} onChange={e => setCommentUrl(e.target.value)} placeholder="https://instagram.com/p/..." className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-purple-500/50" />
              <Button onClick={() => act(() => engagementApi.comment(commentUrl, ids()).then(() => setCommentUrl('')), `Comments queued for ${selected.size} accounts`)} disabled={loading || !commentUrl.trim() || selected.size === 0} className="bg-gradient-to-r from-purple-600 to-violet-600" size="sm"><MessageSquare className="h-3.5 w-3.5 mr-1" />Comment</Button>
            </div>
          </CardContent></Card>

          {/* Hashtag */}
          <Card><CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2"><Hash className="h-4 w-4 text-amber-400" /><span className="text-sm font-semibold">Engage by Hashtag</span><Badge variant="outline" className="text-[9px] h-4 ml-auto">Auto-discover</Badge></div>
            <div className="flex gap-2">
              <input value={hashtag} onChange={e => setHashtag(e.target.value)} placeholder="#marmer, #granit, #interiordesign" className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-500/50" />
              <Button onClick={() => act(() => engagementApi.engageByHashtag(hashtag, ids(), { like: true, comment: true }).then(() => setHashtag('')), `Hashtag engagement queued`)} disabled={loading || !hashtag.trim() || selected.size === 0} className="bg-gradient-to-r from-amber-600 to-orange-600" size="sm"><Hash className="h-3.5 w-3.5 mr-1" />Engage</Button>
            </div>
          </CardContent></Card>

          {/* History */}
          <Card>
            <CardHeader className="pb-2"><button onClick={() => setShowHistory(!showHistory)} className="flex items-center justify-between w-full"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Recent Activity</CardTitle>{showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></CardHeader>
            {showHistory && <CardContent><div className="space-y-1.5 max-h-64 overflow-y-auto">
              {logs.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p> : logs.map(log => {
                const acc = accounts.find(a => a.id === log.accountId)
                return (<div key={log.id} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-secondary/30">
                  <div className="flex items-center gap-2">
                    {log.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                    {log.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-red-400" />}
                    {log.status === 'skipped' && <Clock className="h-3.5 w-3.5 text-yellow-400" />}
                    <span className="font-medium">@{acc?.username || '...'}</span>
                    <Badge variant="outline" className="text-[8px] h-3.5">{log.actionType}</Badge>
                  </div>
                  <span className="text-muted-foreground truncate max-w-[200px]">{log.details || log.target}</span>
                </div>)
              })}
            </div></CardContent>}
          </Card>
        </div>

        {/* Account selector */}
        <Card className="sticky top-20 h-fit">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between"><CardTitle className="text-sm">Select Accounts</CardTitle><span className="text-xs text-rose-400 font-medium">{selected.size} selected</span></div>
            <div className="flex items-center gap-1 mt-2 p-2 rounded-md bg-rose-500/10 border border-rose-500/20"><Shield className="h-3 w-3 text-rose-400 shrink-0" /><span className="text-[9px] text-rose-300">Human-like: warmup → read → engage → exit</span></div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 pb-2 border-b border-border mb-2"><Checkbox checked={allSel} onCheckedChange={toggleAll} id="sel-all-e" /><Label htmlFor="sel-all-e" className="text-xs cursor-pointer">Select all ({accounts.length})</Label></div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {accounts.map(acc => (
                <div key={acc.id} onClick={() => toggle(acc.id)} className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-all', selected.has(acc.id) ? 'bg-rose-600/10 border border-rose-600/20' : 'hover:bg-secondary border border-transparent')}>
                  <Checkbox checked={selected.has(acc.id)} onCheckedChange={() => toggle(acc.id)} onClick={e => e.stopPropagation()} />
                  <span className="text-xs font-medium truncate flex-1">@{acc.username}</span>
                  {pool.active.includes(acc.id) && <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />}
                  {pool.queued.includes(acc.id) && <div className="h-2 w-2 rounded-full bg-yellow-400" />}
                </div>
              ))}
            </div>
            <div className="mt-4 p-2.5 rounded-lg bg-secondary/50 space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Daily Limits</p>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="text-center p-1.5 rounded bg-rose-500/10"><p className="text-[9px] text-rose-400 font-bold">LIKE</p><p className="text-xs font-bold">50-80</p></div>
                <div className="text-center p-1.5 rounded bg-blue-500/10"><p className="text-[9px] text-blue-400 font-bold">FOLLOW</p><p className="text-xs font-bold">20-30</p></div>
                <div className="text-center p-1.5 rounded bg-purple-500/10"><p className="text-[9px] text-purple-400 font-bold">COMMENT</p><p className="text-xs font-bold">10-15</p></div>
              </div>
              <p className="text-[9px] text-muted-foreground text-center mt-1">⏰ 08-22 WIB · 🎲 20% skip · ⏱️ 15-45min stagger</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
