import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock3, FileText, ListChecks, MonitorSmartphone, Play, RotateCw, SendHorizontal, Target, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EffectTag, Notice, PageHeader, SectionTitle, Void, ago } from '@/components/growth/grammar'
import { activityApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface OperationsSummary {
  accounts: { total: number; ready: number; unverified: number; attention: number; disconnected: number }
  campaigns: { active: number; draft: number }
  publishingQueue: { queued: number; running: number; delayed: number }
  recentActivity: Array<{ id: string; action: string; status: string; message: string; createdAt: string; accountUsername?: string | null; campaignName?: string | null }>
}

const tone = (status: string, action: string) => {
  const v = `${status} ${action}`.toLowerCase()
  if (v.includes('fail') || v.includes('error')) return { Icon: XCircle, c: 'text-oxide' }
  if (v.includes('warn') || v.includes('attention') || v.includes('verify') || v.includes('unknown')) return { Icon: AlertTriangle, c: 'text-ochre' }
  if (v.includes('queued') || v.includes('created') || v.includes('started')) return { Icon: Clock3, c: 'text-signal' }
  return { Icon: CheckCircle2, c: 'text-patina' }
}

/**
 * Publish — distribution, kept honest about what each control actually does.
 * This page replaces the old social-operations dashboard as the home for it.
 */
export default function PublishHub() {
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [observedAt, setObservedAt] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    setState('loading')
    activityApi.operationsSummary()
      .then(({ data }) => { setSummary(data); setState('ok'); setObservedAt(new Date().toISOString()) })
      .catch(() => setState('error'))
  }, [nonce])

  const noAccounts = state === 'ok' && summary?.accounts.total === 0

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Distribute"
        title="Publish"
        lede="Post to accounts you own, with preflight, pacing and recovery. Every action below says whether it saves, prepares or actually posts."
        actions={<>
          <Button variant="outline" asChild><Link to="/campaigns"><Target />Campaigns</Link></Button>
          <Button asChild><Link to="/compose"><SendHorizontal />Quick post</Link></Button>
        </>}
      />

      {state === 'error' && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCw className="h-3.5 w-3.5" />Retry</Button>}>Publishing status is unavailable. This is not the same as “nothing queued” — check the backend before resubmitting anything.</Notice>}

      {noAccounts ? (
        <section className="panel grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div><p className="font-display text-xl font-semibold">Social publishing is optional.</p><p className="mt-1 max-w-xl text-sm text-muted-foreground">You can use RockBase for site health, search and content without connecting a single account. When you want to post, connect accounts you own in Setup — sessions stay on this machine.</p></div>
          <Button variant="outline" asChild><Link to="/accounts">Connect an account<ArrowRight /></Link></Button>
        </section>
      ) : (
        <section aria-labelledby="pipeline" className="space-y-3">
          <SectionTitle id="pipeline" aside={observedAt && <button onClick={() => setNonce((n) => n + 1)} className="inline-flex items-center gap-1 hover:text-foreground"><RotateCw className="h-3 w-3" />Observed {ago(observedAt)}</button>}>Pipeline right now</SectionTitle>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={MonitorSmartphone} label="Accounts ready" value={summary?.accounts.ready} detail={summary ? `of ${summary.accounts.total} · ${summary.accounts.unverified} unverified` : ''} loading={state === 'loading'} to="/accounts" />
            <Stat icon={AlertTriangle} label="Need recovery" value={summary?.accounts.attention} detail={summary?.accounts.attention ? 'Open Sessions to reconnect' : 'No sessions need you'} loading={state === 'loading'} to="/farm" warn={Boolean(summary?.accounts.attention)} />
            <Stat icon={Target} label="Campaigns running" value={summary?.campaigns.active} detail={summary ? `${summary.campaigns.draft} in preparation` : ''} loading={state === 'loading'} to="/campaigns" />
            <Stat icon={ListChecks} label="In the queue" value={summary ? summary.publishingQueue.queued + summary.publishingQueue.running : undefined} detail={summary ? `${summary.publishingQueue.running} running · ${summary.publishingQueue.delayed} delayed` : ''} loading={state === 'loading'} to="/queue" />
          </div>
        </section>
      )}

      <section aria-labelledby="contract" className="space-y-3">
        <SectionTitle id="contract">What each action does</SectionTitle>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 xl:grid-cols-4">
          <Contract icon={FileText} title="Save draft" body="Keeps text in Studio or Compose. Nothing leaves RockBase." effect={<EffectTag effect="local" />} />
          <Contract icon={CalendarClock} title="Schedule Draft (Campaigns)" body="At the chosen time, RockBase prepares a Compose draft for review. It does not post. There is no separate scheduler that publishes automatically." effect={<EffectTag effect="local">Prepares a draft · does not post</EffectTag>} />
          <Contract icon={Play} title="Start Bulk Post" body="Runs preflight, then posts to the selected accounts through a paced queue. This is the step that publishes." effect={<EffectTag effect="external" />} />
          <Contract icon={Activity} title="Completed" body="The platform accepted the post. It is execution status — not reach, engagement or revenue." effect={<span className="text-[11px] text-muted-foreground">Status, not outcome</span>} />
        </ol>
      </section>

      <section aria-labelledby="recent" className="space-y-3">
        <SectionTitle id="recent" aside={<Link to="/activity" className="hover:text-foreground">Full activity →</Link>}>Recent activity</SectionTitle>
        {state === 'loading' ? <div className="h-24 animate-pulse rounded-lg bg-secondary/40" /> : state === 'error' ? <Void reason="Activity could not be read." /> : !summary?.recentActivity.length ? <Void reason="No publishing activity yet." /> : (
          <ul className="panel divide-y divide-border">
            {summary.recentActivity.map((item) => {
              const { Icon, c } = tone(item.status, item.action)
              return <li key={item.id} className="flex items-center gap-3 px-4 py-3"><Icon className={cn('h-4 w-4 shrink-0', c)} /><div className="min-w-0 flex-1"><p className="truncate text-sm">{item.message}</p><p className="text-[11px] text-muted-foreground">{item.campaignName || item.accountUsername || 'RockBase'} · {ago(item.createdAt)}</p></div></li>
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ icon: Icon, label, value, detail, loading, to, warn }: { icon: typeof Target; label: string; value?: number; detail: string; loading: boolean; to: string; warn?: boolean }) {
  return (
    <Link to={to} className="group bg-card p-4 transition-colors hover:bg-secondary/40">
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span><Icon className={cn('h-3.5 w-3.5', warn && 'text-oxide')} /></div>
      <p className={cn('font-data mt-2 text-3xl', warn ? 'text-oxide' : 'text-foreground')}>{loading ? '…' : value ?? '—'}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{loading ? 'Checking…' : detail}</p>
    </Link>
  )
}

function Contract({ icon: Icon, title, body, effect }: { icon: typeof Target; title: string; body: string; effect: React.ReactNode }) {
  return <li className="flex flex-col gap-2 bg-card p-4"><Icon className="h-4 w-4 text-muted-foreground" /><p className="font-medium">{title}</p><p className="text-[13px] text-muted-foreground">{body}</p><div className="mt-auto pt-1">{effect}</div></li>
}
