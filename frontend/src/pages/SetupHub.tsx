import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, Globe2, Heart, KeyRound, Leaf, Lock, MonitorSmartphone, Network, Settings, Sparkles, Users } from 'lucide-react'
import GscIntelligence from '@/components/seo/GscIntelligence'
import { PageHeader, SectionTitle, SourcePill, type SourceStatus } from '@/components/growth/grammar'
import { isLocalMode } from '@/components/layout/nav'
import { gscApi } from '@/components/seo/gscApi'
import { activityApi } from '@/lib/api'

/** Setup — the plumbing. Supports the work; never a prerequisite for SEO or content. */
export default function SetupHub() {
  const [gsc, setGsc] = useState<{ s: SourceStatus; d: string }>({ s: isLocalMode ? 'loading' : 'mode', d: isLocalMode ? '' : 'Local Mode only' })
  const [social, setSocial] = useState<{ s: SourceStatus; d: string }>({ s: 'loading', d: '' })

  useEffect(() => {
    if (isLocalMode) gscApi.status().then(({ data }) => setGsc(data.connected ? { s: 'ok', d: `Connected · ${data.provider === 'service_account' ? 'service account' : 'OAuth'}` } : data.pending ? { s: 'setup', d: 'Waiting for approval' } : { s: 'disconnected', d: data.enabled ? 'Optional' : 'Not enabled' })).catch(() => setGsc({ s: 'error', d: 'Status unavailable' }))
    activityApi.operationsSummary().then(({ data }) => setSocial(data.accounts.total ? { s: data.accounts.attention ? 'stale' : 'ok', d: `${data.accounts.total} accounts · ${data.accounts.attention} need recovery` } : { s: 'empty', d: 'Optional · none connected' })).catch(() => setSocial({ s: 'error', d: 'Status unavailable' }))
  }, [])

  const connections = [
    { to: '/setup/google', icon: KeyRound, title: 'Google Search Console', body: 'Read-only search performance for your sites.', status: <SourcePill status={gsc.s} name="" detail={gsc.d} />, locked: !isLocalMode },
    { to: '/accounts', icon: Users, title: 'Social accounts', body: 'Accounts you own, used for posting.', status: <SourcePill status={social.s} name="" detail={social.d} /> },
    { to: '/seo?add=1', icon: Globe2, title: 'Websites', body: 'Sites RockBase can crawl. Added in Site & Search.', status: null },
    { to: '/ai-writer', icon: Sparkles, title: 'AI provider (optional)', body: 'Used only when you ask for AI help. Requests may cost money.', status: null },
  ]
  const operations = [
    { to: '/farm', icon: MonitorSmartphone, title: 'Sessions', body: 'Verify and recover account sessions.' },
    { to: '/proxies', icon: Network, title: 'Proxies', body: 'Network routes for accounts.' },
    { to: '/warming', icon: Leaf, title: 'Warming', body: 'Gradual activity for new accounts.' },
    { to: '/engagement', icon: Heart, title: 'Engagement', body: 'Likes, follows and comments.' },
    { to: '/validation', icon: ClipboardCheck, title: 'Ops tools', body: 'Operational validation utilities.' },
    { to: '/settings', icon: Settings, title: 'Settings', body: 'Installation preferences.' },
  ]

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Connect" title="Setup" lede="Connections and operations that support the work. None of them is required to analyse a site or write content." />
      <section className="space-y-3">
        <SectionTitle>Connections</SectionTitle>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
          {connections.map((c) => {
            const Icon = c.icon
            return (
              <Link key={c.to} to={c.to} className="group flex items-start gap-4 bg-card p-5 transition-colors hover:bg-secondary/40">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-patina" />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium">{c.title}{c.locked && <Lock className="h-3 w-3 text-muted-foreground" />}</span><span className="mt-0.5 block text-sm text-muted-foreground">{c.body}</span>{c.status && <span className="mt-2 block">{c.status}</span>}</span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )
          })}
        </div>
      </section>
      <section className="space-y-3">
        <SectionTitle>Social operations</SectionTitle>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {operations.map((o) => {
            const Icon = o.icon
            return <Link key={o.to} to={o.to} className="flex items-start gap-3 bg-card p-4 transition-colors hover:bg-secondary/40"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span><span className="block text-sm font-medium">{o.title}</span><span className="block text-xs text-muted-foreground">{o.body}</span></span></Link>
          })}
        </div>
      </section>
    </div>
  )
}

export function GoogleSetup() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Setup · Connection" title="Google Search Console" lede="Read-only access to search performance. Credentials are stored by your operating system, reports are cached on this machine, and Google is contacted only when you connect or press Sync." />
      <GscIntelligence view="connection" />
    </div>
  )
}
