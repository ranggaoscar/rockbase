import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck,
  Copy,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Circle,
  RefreshCw,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { accountGroupsApi, accountsApi, activityApi, campaignsApi, engagementApi } from '@/lib/api'

type ValidationStatus = 'passed' | 'failed' | 'pending'
type ReadinessStatus = 'READY' | 'WARNING' | 'BLOCKED' | 'LOADING'

interface ChecklistItem {
  id: string
  section: string
  expected: string
  risk?: string
}

interface ChecklistState {
  status: ValidationStatus
  note: string
}

interface ReadinessData {
  totalAccounts: number
  healthyAccounts: number
  needsRelogin: number
  checkpoint: number
  unhealthyAccounts: number
  totalGroups: number
  pendingCampaigns: number
  readyCampaigns: number
  failedCampaigns: number
  queueQueued: number
  queueActive: number
  queueDelayed: number
  queueFailedToday: number
  activeContexts: number | null
  activePages: number | null
}

const STORAGE_KEY = 'rockbase_validation_checklist_v1'

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'accounts-session-health',
    section: 'Accounts + Session Health',
    expected: 'Accounts load correctly, health badges are visible, and manual session checks update status without posting.',
    risk: 'Do not start Farm View sessions for more accounts than the PC can safely handle.',
  },
  {
    id: 'groups',
    section: 'Groups',
    expected: 'Account groups list, membership counts, and selected group previews resolve healthy/skipped accounts correctly.',
  },
  {
    id: 'campaign-ai-plan',
    section: 'Campaign AI Plan',
    expected: 'AI plan can be generated or fallback plan appears, with strategy, caption seed, hashtags, and variations visible.',
    risk: 'AI fallback is acceptable for validation if the provider key is unavailable.',
  },
  {
    id: 'campaign-scheduler',
    section: 'Campaign Scheduler',
    expected: 'Scheduling a campaign only changes scheduler status to PENDING, then READY when due.',
    risk: 'Scheduler must not enqueue posts or launch browser automation.',
  },
  {
    id: 'campaign-execution-dashboard',
    section: 'Campaign Execution Dashboard',
    expected: 'Summary cards, queue snapshot, READY row highlight, healthy/skipped counts, and quick actions are visible.',
  },
  {
    id: 'compose-draft',
    section: 'Compose Draft',
    expected: 'Open Compose loads campaign context and suggested caption/accounts without starting posting.',
    risk: 'Do not click Start Bulk Post until ready for the explicit manual posting test.',
  },
  {
    id: 'prepare-variations',
    section: 'Prepare Variations',
    expected: 'Variation assignment flow opens with AI variations mapped to accounts and remains editable before posting.',
  },
  {
    id: 'manual-posting-test',
    section: 'Manual Posting Test',
    expected: 'A small controlled post can be started manually and reports pending/published/failed states clearly.',
    risk: 'Use one safe account and one safe asset first. This is the only checklist step that should intentionally post.',
  },
  {
    id: 'warming-test',
    section: 'Warming Test',
    expected: 'Warming page loads, status is readable, and any run action is started only manually.',
    risk: 'Avoid parallel warming on many accounts during validation.',
  },
  {
    id: 'activity-timeline',
    section: 'Activity Timeline',
    expected: 'Activity filters work, campaign quick links prefill campaign context, and events are readable.',
  },
  {
    id: 'queue-summary',
    section: 'Queue Summary',
    expected: 'Queued, active, delayed, completed today, and failed today counts render or show unavailable safely.',
    risk: 'Queue visibility should be read-only and must not start workers.',
  },
  {
    id: 'ram-context-cleanup',
    section: 'RAM / Context Cleanup',
    expected: 'After manual sessions, browser contexts can be closed and RAM usage stabilizes before the next test batch.',
    risk: 'If RAM climbs, stop manual flows before continuing validation.',
  },
]

function initialState(): Record<string, ChecklistState> {
  return Object.fromEntries(
    CHECKLIST.map((item) => [item.id, { status: 'pending' as ValidationStatus, note: '' }]),
  )
}

function loadState(): Record<string, ChecklistState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    const parsed = JSON.parse(raw) as Record<string, ChecklistState>
    return {
      ...initialState(),
      ...parsed,
    }
  } catch {
    return initialState()
  }
}

function recommendedNextAction(failed: number, pending: number) {
  if (failed > 0) return 'Fix failed validation items before broad manual posting.'
  if (pending > 0) return 'Continue the remaining checklist items in order.'
  return 'Manual validation passed; proceed with cautious operational use.'
}

function emptyReadiness(): ReadinessData {
  return {
    totalAccounts: 0,
    healthyAccounts: 0,
    needsRelogin: 0,
    checkpoint: 0,
    unhealthyAccounts: 0,
    totalGroups: 0,
    pendingCampaigns: 0,
    readyCampaigns: 0,
    failedCampaigns: 0,
    queueQueued: 0,
    queueActive: 0,
    queueDelayed: 0,
    queueFailedToday: 0,
    activeContexts: null,
    activePages: null,
  }
}

function computeReadiness(data: ReadinessData): { status: ReadinessStatus; action: string; tone: string } {
  if (data.totalAccounts === 0 || data.healthyAccounts === 0) {
    return {
      status: 'BLOCKED',
      action: 'Check accounts/session health before posting.',
      tone: 'border-red-500/30 bg-red-500/10 text-red-300',
    }
  }

  if (
    data.failedCampaigns > 0 ||
    data.queueFailedToday > 0 ||
    data.unhealthyAccounts > data.healthyAccounts ||
    data.queueActive > Math.max(data.healthyAccounts, 1)
  ) {
    return {
      status: 'WARNING',
      action: 'Check Activity or Session Health before continuing.',
      tone: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    }
  }

  return {
    status: 'READY',
    action: 'Continue manual test/campaign with normal caution.',
    tone: 'border-green-500/30 bg-green-500/10 text-green-300',
  }
}

export default function OperationalValidation() {
  const [state, setState] = useState<Record<string, ChecklistState>>(() => loadState())
  const [readiness, setReadiness] = useState<ReadinessData>(() => emptyReadiness())
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [readinessError, setReadinessError] = useState('')

  const counts = useMemo(() => {
    const values = CHECKLIST.map((item) => state[item.id]?.status || 'pending')
    return {
      passed: values.filter((value) => value === 'passed').length,
      failed: values.filter((value) => value === 'failed').length,
      pending: values.filter((value) => value === 'pending').length,
    }
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    loadReadiness()
  }, [])

  async function loadReadiness() {
    setReadinessLoading(true)
    setReadinessError('')
    try {
      const [accountsResult, healthResult, groupsResult, campaignsResult, queueResult, poolResult] = await Promise.allSettled([
        accountsApi.list(),
        accountsApi.sessionHealthSummary(),
        accountGroupsApi.list(),
        campaignsApi.list(),
        activityApi.queueSummary(),
        engagementApi.getPoolStatus(),
      ])

      const accountsData = accountsResult.status === 'fulfilled' ? accountsResult.value.data : { accounts: [] }
      const healthData = healthResult.status === 'fulfilled' ? healthResult.value.data : {}
      const groupsData = groupsResult.status === 'fulfilled' ? groupsResult.value.data : { groups: [] }
      const campaignsData = campaignsResult.status === 'fulfilled' ? campaignsResult.value.data : { campaigns: [] }
      const queueData = queueResult.status === 'fulfilled' ? queueResult.value.data?.queue : {}
      const poolData = poolResult.status === 'fulfilled' ? poolResult.value.data : null

      const totalAccounts = Number(healthData.total ?? accountsData.accounts?.length ?? 0)
      const healthyAccounts = Number(healthData.HEALTHY ?? 0)
      const needsRelogin = Number(healthData.NEEDS_RELOGIN ?? healthData.EXPIRED ?? 0)
      const checkpoint = Number(healthData.CHECKPOINT ?? 0)
      const unhealthyAccounts = Math.max(0, totalAccounts - healthyAccounts)
      const campaigns = Array.isArray(campaignsData.campaigns) ? campaignsData.campaigns : []

      setReadiness({
        totalAccounts,
        healthyAccounts,
        needsRelogin,
        checkpoint,
        unhealthyAccounts,
        totalGroups: Array.isArray(groupsData.groups) ? groupsData.groups.length : 0,
        pendingCampaigns: campaigns.filter((campaign: any) => (campaign.schedulerStatus || 'PENDING') === 'PENDING').length,
        readyCampaigns: campaigns.filter((campaign: any) => campaign.schedulerStatus === 'READY').length,
        failedCampaigns: campaigns.filter((campaign: any) => campaign.schedulerStatus === 'FAILED' || campaign.status === 'stopped' || Number(campaign.failedActions || 0) > 0).length,
        queueQueued: Number(queueData.queued ?? 0),
        queueActive: Number(queueData.active ?? 0),
        queueDelayed: Number(queueData.delayed ?? 0),
        queueFailedToday: Number(queueData.failedToday ?? 0),
        activeContexts: typeof poolData?.activeCount === 'number' ? poolData.activeCount : null,
        activePages: null,
      })
    } catch (err: any) {
      setReadinessError(err.message || 'Failed to load readiness data')
    } finally {
      setReadinessLoading(false)
    }
  }

  function setStatus(id: string, status: ValidationStatus) {
    setState((prev) => ({
      ...prev,
      [id]: {
        status: prev[id]?.status === status ? 'pending' : status,
        note: prev[id]?.note || '',
      },
    }))
  }

  function setNote(id: string, note: string) {
    setState((prev) => ({
      ...prev,
      [id]: {
        status: prev[id]?.status || 'pending',
        note,
      },
    }))
  }

  function resetChecklist() {
    setState(initialState())
    toast.success('Checklist reset')
  }

  function buildReport() {
    const lines = [
      'ROCK BASE Operational Validation Report',
      `Date: ${new Date().toLocaleString('id-ID')}`,
      `Passed: ${counts.passed}`,
      `Failed: ${counts.failed}`,
      `Pending: ${counts.pending}`,
      '',
      'Items:',
      ...CHECKLIST.map((item) => {
        const itemState = state[item.id] || { status: 'pending', note: '' }
        const note = itemState.note.trim() ? ` | Note: ${itemState.note.trim()}` : ''
        return `- [${itemState.status.toUpperCase()}] ${item.section}${note}`
      }),
      '',
      `Recommended next action: ${recommendedNextAction(counts.failed, counts.pending)}`,
    ]
    return lines.join('\n')
  }

  async function copyReport() {
    const report = buildReport()
    try {
      await navigator.clipboard.writeText(report)
      toast.success('Validation report copied')
    } catch {
      toast.error('Failed to copy report')
    }
  }

  const readinessComputed = readinessLoading
    ? { status: 'LOADING' as ReadinessStatus, action: 'Loading readiness data...', tone: 'border-border bg-secondary/30 text-muted-foreground' }
    : computeReadiness(readiness)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ClipboardCheck className="h-5 w-5 text-green-400" />
            Operational Validation Checklist
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manual test tracker for ROCK BASE v1. This page stores local notes only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={copyReport}>
            <Copy className="h-3.5 w-3.5" />
            Copy Report
          </Button>
          <Button variant="outline" size="sm" onClick={resetChecklist}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Checklist
          </Button>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Server className="h-4 w-4 text-blue-400" />
              System Readiness Panel
            </span>
            <Button variant="outline" size="sm" onClick={loadReadiness} disabled={readinessLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', readinessLoading && 'animate-spin')} />
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('px-3 py-1 text-xs font-black', readinessComputed.tone)}>
                {readinessComputed.status}
              </Badge>
              {readinessError && <Badge variant="outline" className="text-[10px] text-red-400">Partial data unavailable</Badge>}
            </div>
            <p className="text-sm font-medium text-foreground">{readinessComputed.action}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {[
              ['Total Accounts', readiness.totalAccounts],
              ['Healthy Accounts', readiness.healthyAccounts],
              ['Unhealthy', readiness.unhealthyAccounts],
              ['Needs Relogin', readiness.needsRelogin],
              ['Checkpoint', readiness.checkpoint],
              ['Total Groups', readiness.totalGroups],
              ['Pending Campaigns', readiness.pendingCampaigns],
              ['READY Campaigns', readiness.readyCampaigns],
              ['Failed Campaigns', readiness.failedCampaigns],
              ['Queue Queued', readiness.queueQueued],
              ['Queue Active', readiness.queueActive],
              ['Queue Delayed', readiness.queueDelayed],
              ['Queue Failed Today', readiness.queueFailedToday],
              ['Active Contexts', readiness.activeContexts ?? 'N/A'],
              ['Active Pages', readiness.activePages ?? 'N/A'],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-border bg-secondary/25 p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-black">{value}</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Read-only snapshot. Active pages are shown as N/A because no existing read-only endpoint exposes page count.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Passed</p>
              <p className="mt-1 text-2xl font-black text-green-400">{counts.passed}</p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Failed</p>
              <p className="mt-1 text-2xl font-black text-red-400">{counts.failed}</p>
            </div>
            <XCircle className="h-5 w-5 text-red-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Pending</p>
              <p className="mt-1 text-2xl font-black text-yellow-400">{counts.pending}</p>
            </div>
            <Circle className="h-5 w-5 text-yellow-400" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Validation Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {CHECKLIST.map((item, index) => {
            const itemState = state[item.id] || { status: 'pending', note: '' }
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-lg border p-3',
                  itemState.status === 'passed' && 'border-green-500/25 bg-green-500/[0.04]',
                  itemState.status === 'failed' && 'border-red-500/25 bg-red-500/[0.04]',
                  itemState.status === 'pending' && 'border-border bg-secondary/20',
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="h-5 text-[10px]">Step {index + 1}</Badge>
                      <h2 className="text-sm font-bold">{item.section}</h2>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 text-[10px]',
                          itemState.status === 'passed' && 'border-green-500/25 text-green-400',
                          itemState.status === 'failed' && 'border-red-500/25 text-red-400',
                          itemState.status === 'pending' && 'border-yellow-500/25 text-yellow-400',
                        )}
                      >
                        {itemState.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Expected: <span className="text-foreground">{item.expected}</span>
                    </p>
                    {item.risk && (
                      <div className="mt-2 flex gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-300">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{item.risk}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-green-400">
                      <Checkbox
                        checked={itemState.status === 'passed'}
                        onCheckedChange={() => setStatus(item.id, 'passed')}
                      />
                      Passed
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-red-400">
                      <Checkbox
                        checked={itemState.status === 'failed'}
                        onCheckedChange={() => setStatus(item.id, 'failed')}
                      />
                      Failed
                    </label>
                  </div>
                </div>

                <textarea
                  value={itemState.note}
                  onChange={(event) => setNote(item.id, event.target.value)}
                  placeholder="Short note for this step..."
                  className="mt-3 min-h-16 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-purple-500/50"
                />
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
