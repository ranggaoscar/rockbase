import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Clock, MonitorPlay, SendHorizontal, Target, Users, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { activityApi } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

interface OperationsSummary {
  accounts: { total: number; ready: number; unverified: number; attention: number; disconnected: number }
  campaigns: { active: number; draft: number }
  publishingQueue: { queued: number; running: number; delayed: number }
  recentActivity: Array<{
    id: string
    action: string
    status: string
    message: string
    createdAt: string
    accountUsername?: string | null
    campaignName?: string | null
  }>
}

const statusVariant = (status: string) => {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'warning' || status === 'skipped') return 'warning'
  return 'outline'
}

const activityPresentation = (status: string, action: string) => {
  const value = `${status} ${action}`.toLowerCase()
  if (value.includes('failed') || value.includes('error')) return { Icon: XCircle, color: 'text-red-400', label: 'ERROR' }
  if (value.includes('warning') || value.includes('attention') || value.includes('verify') || value.includes('unknown')) return { Icon: AlertTriangle, color: 'text-amber-400', label: 'WARNING' }
  if (value.includes('queued') || value.includes('created') || value.includes('started')) return { Icon: Clock, color: 'text-blue-400', label: 'INFO' }
  return { Icon: CheckCircle2, color: 'text-green-400', label: 'SUCCESS' }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    activityApi.operationsSummary()
      .then(({ data }) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [])

  const cards = summary ? [
    { label: 'Accounts', value: summary.accounts.total, detail: `${summary.accounts.ready} ready · ${summary.accounts.unverified} unverified · ${summary.accounts.attention} attention`, icon: Users, color: 'text-blue-400' },
    { label: 'Campaigns', value: summary.campaigns.active, detail: `${summary.campaigns.active} active · ${summary.campaigns.draft} draft`, icon: Target, color: 'text-purple-400' },
    { label: 'Publishing queue', value: summary.publishingQueue.queued, detail: `${summary.publishingQueue.running} running · ${summary.publishingQueue.delayed} delayed`, icon: SendHorizontal, color: 'text-amber-400' },
    { label: 'Needs attention', value: summary.accounts.attention, detail: summary.accounts.attention ? 'Open Sessions to reconnect affected accounts' : 'No accounts currently need operator action', icon: AlertTriangle, color: summary.accounts.attention ? 'text-red-400' : 'text-green-400' },
  ] : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-400">ROCK BASE OVERVIEW</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Campaign operations, in one place</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connect accounts, prepare a campaign, queue execution, and resolve session attention when it appears.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="purple" onClick={() => navigate('/campaigns')}><Target className="h-3.5 w-3.5" />New campaign</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/farm')}><MonitorPlay className="h-3.5 w-3.5" />Open sessions</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/queue')}><Clock className="h-3.5 w-3.5" />View queue</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/accounts')}><Users className="h-3.5 w-3.5" />Accounts</Button>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading operational status…</CardContent></Card>
      ) : !summary ? (
        <Card><CardContent className="py-12 text-center"><p className="font-medium">Operational status is unavailable</p><p className="mt-1 text-sm text-muted-foreground">Check the backend connection, then refresh this page.</p></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ label, value, detail, icon: Icon, color }) => (
              <Card key={label}><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className={`h-4 w-4 ${color}`} /></div><p className="mt-3 text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-purple-400" />Recent activity</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {summary.recentActivity.length === 0 ? <div className="py-8 text-center"><p className="font-medium">No campaign activity yet</p><p className="mt-1 text-sm text-muted-foreground">Create a campaign or quick post when your team is ready to publish.</p></div> : summary.recentActivity.map((item) => {
                  const presentation = activityPresentation(item.status, item.action)
                  const Icon = presentation.Icon
                  return <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"><Icon className={`h-4 w-4 shrink-0 ${presentation.color}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm">{item.message}</p><p className="text-xs text-muted-foreground">{item.campaignName || item.accountUsername || 'RockBase'} · {timeAgo(item.createdAt)}</p></div><Badge variant={statusVariant(item.status) as any} className="text-[10px]">{presentation.label}</Badge></div>
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" />Needs attention</CardTitle></CardHeader>
              <CardContent>{summary.accounts.attention ? <><p className="text-3xl font-bold text-red-400">{summary.accounts.attention}</p><p className="mt-1 text-sm text-muted-foreground">Account sessions need operator recovery before they can safely execute campaign work.</p><Button className="mt-4 w-full" variant="outline" onClick={() => navigate('/farm')}>Open session control</Button></> : <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-green-400" /><p className="mt-3 font-medium">No accounts need operator action</p><p className="mt-1 text-xs text-muted-foreground">Open Sessions to verify a session or resolve a login, checkpoint, or verification request.</p></div>}</CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
