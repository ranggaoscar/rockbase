import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, Lock, PenLine, RefreshCw, Search, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import DailyBars from '@/components/growth/DailyBars'
import { EffectTag, GradeTag, Notice, SectionTitle, Void, ago, ageDays } from '@/components/growth/grammar'
import type { Website } from '@/components/seo/api'
import { errorMessage, gscApi, type GscMapping, type GscProperty, type GscReport, type GscStatus } from '@/components/seo/gscApi'
import { cn } from '@/lib/utils'

type Tab = 'pages' | 'keywords' | 'ctr'
const localMode = import.meta.env.VITE_ROCKBASE_MODE === 'local'
const fmtNumber = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
const fmtCtr = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(2)}%`
const fmtPosition = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1)
const dateLabel = (s?: string) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const pp = (current?: number | null, previous?: number | null) => current == null || previous == null ? '—' : `${((current - previous) * 100).toFixed(2)} pp`
const errText = (error: unknown, fallback: string) => errorMessage(error, fallback)

/**
 * Google Search Console, in two views:
 *   connection   credentials and consent (Setup → Google)
 *   performance  property mapping, sync and the cached report (Site & Search)
 * Both are Local Mode only; credentials live in the OS vault, never the browser.
 */
export default function GscIntelligence({ website, workspaceId, view = 'performance' }: { website?: Website; workspaceId?: string; view?: 'performance' | 'connection' }) {
  if (!localMode) return <ModeOff />
  return view === 'connection' ? <Connection /> : <Performance website={website} workspaceId={workspaceId ?? ''} />
}

function ModeOff() {
  return (
    <div className="panel flex items-start gap-3 p-5">
      <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div><p className="font-medium">Search Console runs in Local Mode only</p><p className="mt-1 text-sm text-muted-foreground">No credential request or Search Console data is sent from Server Mode. Start RockBase in Local Mode on the computer that owns the Google connection.</p><Badge variant="outline" className="mt-3">Disabled in Server Mode</Badge></div>
    </div>
  )
}

function useGscStatus() {
  const [status, setStatus] = useState<GscStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => { const { data } = await gscApi.status(); setStatus(data); return data }, [])
  useEffect(() => {
    let cancelled = false
    gscApi.status().then(({ data }) => { if (!cancelled) setStatus(data) }).catch((e) => { if (!cancelled) setError(errText(e, 'Search Console status could not be loaded.')) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!status?.pending) return
    let cancelled = false
    const timer = window.setInterval(() => { gscApi.status().then(({ data }) => { if (!cancelled) setStatus(data) }).catch(() => {}) }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [status?.pending])
  return { status, setStatus, loading, error, setError, refresh }
}

/* ── Connection (Setup → Google) ───────────────────────────────────────── */
function Connection() {
  const { status, setStatus, loading, error, setError, refresh } = useGscStatus()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [credentialPath, setCredentialPath] = useState('')
  const [importingService, setImportingService] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const popupRef = useRef<Window | null>(null)

  const saveConfig = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingConfig(true); setError('')
    try { await gscApi.configure({ client_id: clientId.trim(), ...(clientSecret ? { client_secret: clientSecret } : {}) }); setClientSecret(''); await refresh() }
    catch (e) { setError(errText(e, 'Configuration was not saved.')) } finally { setSavingConfig(false) }
  }
  const importService = async (event: React.FormEvent) => {
    event.preventDefault(); setImportingService(true); setError('')
    try { await gscApi.importServiceAccount(credentialPath.trim()); setCredentialPath(''); await refresh() }
    catch (e) { setError(errText(e, 'The service account could not be connected.')) } finally { setImportingService(false) }
  }
  const parseDesktopJson = (text: string) => {
    try {
      const app = JSON.parse(text).installed
      if (!app || typeof app.client_id !== 'string') throw new Error('The JSON must come from a Google Cloud OAuth client of type “Desktop app”.')
      setClientId(app.client_id)
      if (typeof app.client_secret === 'string') setClientSecret(app.client_secret)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid JSON.') }
  }
  const connect = async () => {
    const popup = window.open('about:blank', '_blank')
    popupRef.current = popup
    setConnecting(true); setError('')
    try {
      const { data } = await gscApi.connect()
      if (popup && !popup.closed) { popup.opener = null; popup.location.href = data.authorizationUrl } else window.location.assign(data.authorizationUrl)
      await refresh()
    } catch (e) { popup?.close(); setError(errText(e, 'Could not start the Google connection.')) } finally { setConnecting(false) }
  }
  const disconnect = async () => {
    setError('')
    try { const { data } = await gscApi.disconnect(); setStatus((old) => old ? { ...old, connected: false, pending: false } : old); if (data.warning) setError(data.warning) }
    catch (e) { setError(errText(e, 'Disconnect failed.')) }
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the Search Console connection…</div>
  if (!status) return <Notice tone="error">{error || 'Search Console status unavailable.'}</Notice>
  if (!status.enabled) return <Void reason={status.setupRequired || status.error || 'The local backend has not enabled Google Search Console.'} />

  return (
    <section className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      {status.error && <Notice tone="warn">{status.error}</Notice>}

      <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 text-patina" />
          <div>
            <p className="font-medium">{status.connected ? 'Connected' : status.pending ? 'Waiting for your approval in Google…' : 'Not connected'}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{status.connected ? `${status.provider === 'service_account' ? 'Service account' : 'OAuth Desktop'} · read-only. Tokens are never shown.` : 'Read-only access. Credentials are stored by your operating system, not the browser.'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Storage: {status.storage || 'OS credential vault'} · Local Mode only</p>
          </div>
        </div>
        {status.connected ? <Button variant="outline" onClick={disconnect}><Unplug />Disconnect</Button>
          : status.pending ? <Button variant="outline" onClick={disconnect}>Cancel</Button>
          : <Badge variant="outline">Not connected</Badge>}
      </div>
      {status.connected && status.provider === 'service_account' && <p className="text-xs text-muted-foreground">Disconnecting removes RockBase's copy only; the original service-account credential is not revoked.</p>}
      {status.pending && <p aria-live="polite" className="text-xs text-muted-foreground">Finish the consent screen in the Google window. Status is checked every 2 seconds.</p>}

      {!status.connected && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={importService} className="panel space-y-3 p-5">
            <SectionTitle>Option A · Existing service account</SectionTitle>
            <p className="text-sm text-muted-foreground">Enter the local path of your service-account JSON. The backend reads it once and keeps the minimum credential in the OS vault. The original file is never modified or deleted, including on disconnect. Don't paste private keys into a browser or chat.</p>
            <div className="space-y-1.5"><Label htmlFor="gsc-service-path">Local JSON path</Label><Input id="gsc-service-path" value={credentialPath} autoComplete="off" onChange={(e) => setCredentialPath(e.target.value)} placeholder="Absolute path, outside the repository" /></div>
            <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!credentialPath.trim() || importingService || status.pending}>{importingService ? 'Verifying…' : 'Connect service account'}</Button><EffectTag effect="google">Verifies with Google</EffectTag></div>
          </form>

          <div className="panel space-y-4 p-5">
            <SectionTitle>Option B · Your Google account (OAuth Desktop)</SectionTitle>
            <p className="text-sm text-muted-foreground">Create an OAuth client of type <strong className="text-foreground">Desktop app</strong> in Google Cloud. The client secret goes to the OS vault ({status.storage || 'OS credential vault'}). RockBase never asks for your Google password, refresh token or access token.</p>
            <form onSubmit={saveConfig} className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="gsc-client-id">OAuth Desktop client ID</Label><Input id="gsc-client-id" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" required /></div>
              <div className="space-y-1.5"><Label htmlFor="gsc-client-secret">Client secret (optional)</Label><Input id="gsc-client-secret" type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Stored in the OS vault" /></div>
              <Button type="submit" variant="outline" disabled={savingConfig || !clientId.trim()}>{savingConfig ? 'Saving…' : 'Save configuration'}</Button>
            </form>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm">Paste the Desktop-app JSON instead</summary>
              <p className="mt-2 text-xs text-muted-foreground">Only the OAuth client JSON from Google Cloud Console → Desktop app. It is parsed in this browser; only the client ID and secret are sent to the local vault.</p>
              <textarea aria-label="OAuth Desktop app JSON" className="font-data mt-2 min-h-24 w-full rounded-md border border-border bg-background p-2 text-xs" placeholder="Paste Desktop app JSON here" onChange={(e) => { if (e.target.value.trim()) parseDesktopJson(e.target.value); e.target.value = '' }} />
            </details>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button disabled={!status.configured || connecting || status.pending} onClick={connect}>{connecting ? <><Loader2 className="animate-spin" />Opening Google…</> : <><ExternalLink />Connect Google account</>}</Button>
              <EffectTag effect="google">Opens Google consent</EffectTag>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/* ── Performance (Site & Search) ───────────────────────────────────────── */
function Performance({ website, workspaceId }: { website?: Website; workspaceId: string }) {
  const { status, loading: statusLoading, error: statusError } = useGscStatus()
  const [properties, setProperties] = useState<GscProperty[]>([])
  const [mapping, setMapping] = useState<GscMapping | null>(null)
  const [report, setReport] = useState<GscReport | null>(null)
  const [property, setProperty] = useState('')
  const [days, setDays] = useState<7 | 28>(28)
  const [tab, setTab] = useState<Tab>('keywords')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [contextParams] = useSearchParams()
  const [query, setQuery] = useState(contextParams.get('q') || '')
  const [rowPage, setRowPage] = useState(0)
  const [showAllQueries, setShowAllQueries] = useState(false)
  const scope = `${workspaceId}:${website?.id || ''}`
  const generation = useRef(0)

  useEffect(() => {
    let cancelled = false
    generation.current++
    setSyncing(false); setSavingMapping(false)
    setProperties([]); setMapping(null); setReport(null); setProperty(''); setError('')
    if (!status?.connected || !website || !workspaceId) return
    setLoading(true)
    Promise.all([gscApi.properties(), gscApi.mapping(workspaceId, website.id), gscApi.report(workspaceId, website.id, days)])
      .then(([p, m, r]) => {
        if (cancelled) return
        setProperties(p.data); setMapping(m.data); setProperty(m.data?.property || '')
        setReport(r.data); if (r.data) setDays(Math.round((Date.parse(r.data.periods.current.endDate) - Date.parse(r.data.periods.current.startDate)) / 86400000) + 1 === 7 ? 7 : 28)
      }).catch((e) => { if (!cancelled) setError(errText(e, 'Search Console data could not be loaded. Try again.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status?.connected])

  const chooseProperty = async () => {
    if (!website || !workspaceId || !property) return
    setSavingMapping(true); setError('')
    const version = generation.current
    try {
      const { data } = await gscApi.saveMapping({ workspace_id: workspaceId, website_id: website.id, property })
      if (version !== generation.current) return
      setMapping(data); setReport(null)
      const { data: next } = await gscApi.report(workspaceId, website.id, days)
      if (version !== generation.current) return
      setReport(next)
    } catch (e) { if (version === generation.current) setError(errText(e, 'This property could not be mapped to the website.')) } finally { if (version === generation.current) setSavingMapping(false) }
  }
  const sync = async () => {
    if (!website || !workspaceId || !mapping) return
    setSyncing(true); setError('')
    const version = generation.current
    try {
      const { data } = await gscApi.sync({ workspace_id: workspaceId, website_id: website.id, days, force: false })
      if (version !== generation.current) return
      setReport(data)
    } catch (e) { if (version === generation.current) setError(errText(e, 'Sync failed. Try again.')) } finally { if (version === generation.current) setSyncing(false) }
  }
  const changeDays = async (next: 7 | 28) => {
    generation.current++; setSyncing(false); setDays(next); setReport(null)
    if (!website || !workspaceId || !mapping) return
    const version = generation.current
    try { const { data } = await gscApi.report(workspaceId, website.id, next); if (version === generation.current) setReport(data) } catch (e) { if (version === generation.current) setError(errText(e, 'Report could not be loaded.')) }
  }

  const filteredRows = useMemo(() => {
    if (!report) return []
    const q = query.trim().toLowerCase()
    const rows = tab === 'pages' ? report.pagePerformance : tab === 'keywords' ? showAllQueries ? (report.queryPerformance || []).map((row) => ({ ...row, confidence: undefined, reason: 'Observed query performance; not automatically an opportunity.' })) : report.keywordOpportunities : report.ctrOpportunities
    return q ? rows.filter((row) => (tab === 'keywords' ? ('query' in row ? row.query : '') : ('page' in row ? row.page : '')).toLowerCase().includes(q)) : rows
  }, [report, tab, query, showAllQueries])
  useEffect(() => { setRowPage(0) }, [query, tab, report, showAllQueries])
  const visibleRows = filteredRows.slice(rowPage * 100, (rowPage + 1) * 100)

  if (statusLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the Search Console connection…</div>
  if (statusError || !status) return <Notice tone="error">{statusError || 'Search Console status unavailable.'}</Notice>
  if (!status.enabled) return <Void reason={status.setupRequired || 'The local backend has not enabled Google Search Console.'} />
  if (!status.connected) return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><p className="font-medium">{status.pending ? 'Waiting for Google approval…' : 'Search Console isn\'t connected'}</p><p className="mt-0.5 text-sm text-muted-foreground">Optional. Read-only Google data shows which queries and pages are close to page one.</p></div></div>
      <Button variant="outline" asChild><Link to="/setup/google">{status.pending ? 'View connection' : 'Connect in Setup'}</Link></Button>
    </div>
  )
  if (!website || !workspaceId) return <Void reason="Choose a website to see its Search Console performance." />

  const stale = report && ageDays(report.syncedAt) > 7

  return (
    <section className="space-y-6" aria-label="Search performance">
      {error && <Notice tone="error">{error}</Notice>}

      <div className="panel grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="gsc-property">Search Console property for {website.name}</Label>
          <div className="flex flex-wrap gap-2">
            <select id="gsc-property" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm" value={property} onChange={(e) => setProperty(e.target.value)}>
              <option value="">Choose a property this Google account can access…</option>
              {properties.map((p) => <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl} · {p.permissionLevel}</option>)}
            </select>
            <Button variant="outline" disabled={!property || savingMapping || property === mapping?.property} onClick={chooseProperty}>{savingMapping ? 'Saving…' : 'Map to website'}</Button>
          </div>
          {mapping && <p className="text-xs text-muted-foreground">Mapped: <span className="break-all text-foreground">{mapping.property}</span> → {website.name}. The backend validates the mapping against this website and workspace.</p>}
        </div>
        {mapping && (
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="Period">{([7, 28] as const).map((d) => <button key={d} role="tab" aria-selected={days === d} onClick={() => changeDays(d)} className={cn('rounded px-2.5 py-1', days === d ? 'bg-secondary text-foreground' : 'text-muted-foreground')}>{d}d</button>)}</div>
              <Button variant={stale || !report ? 'ember' : 'outline'} onClick={sync} disabled={syncing}>{syncing ? <><Loader2 className="animate-spin" />Syncing…</> : <><RefreshCw />Sync now</>}</Button>
            </div>
            <EffectTag effect="google" />
          </div>
        )}
      </div>

      {loading ? <div className="h-40 animate-pulse rounded-lg bg-secondary/40" />
        : !mapping ? <Void reason="Map a property to this website. The list shows only properties this Google account can actually access." />
        : !report ? <Void reason={`No saved ${days}-day report yet. Sync once to fetch it — after that, RockBase reads the local copy until you sync again.`} />
        : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{dateLabel(report.periods?.current?.startDate)} – {dateLabel(report.periods?.current?.endDate)} <span className="px-1">vs</span> {dateLabel(report.periods?.previous?.startDate)} – {dateLabel(report.periods?.previous?.endDate)}</span>
              <span className={cn(stale && 'text-ochre')}>Synced {ago(report.syncedAt)}{stale && ' · out of date'}</span>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {([['Clicks', report.totals.current?.clicks, report.totals.previous?.clicks, 'count'], ['Impressions', report.totals.current?.impressions, report.totals.previous?.impressions, 'count'], ['CTR', report.totals.current?.ctr, report.totals.previous?.ctr, 'ctr'], ['Average position', report.totals.current?.position, report.totals.previous?.position, 'position']] as const).map(([label, current, previous, kind]) => (
                <div key={label} className="bg-card p-4">
                  <GradeTag grade="measured">{label}</GradeTag>
                  <p className="font-data mt-2 text-2xl">{kind === 'ctr' ? fmtCtr(current) : kind === 'position' ? fmtPosition(current) : fmtNumber(current)}</p>
                  <p className="font-data mt-1 text-[11px] text-muted-foreground">prev {kind === 'ctr' ? fmtCtr(previous) : kind === 'position' ? fmtPosition(previous) : fmtNumber(previous)} · Δ {kind === 'ctr' ? pp(current, previous) : current == null || previous == null ? '—' : kind === 'position' ? fmtPosition(current - previous) : fmtNumber(current - previous)}</p>
                </div>
              ))}
            </div>
            {!!report.dates?.length && (
              <div className="panel grid gap-8 p-5 md:grid-cols-2">
                <div><p className="mb-6 text-xs text-muted-foreground">Clicks per day</p><DailyBars points={report.dates.map((r) => ({ date: r.keys?.[0] ?? '', value: r.clicks }))} color="var(--chart-1)" label="clicks" height={96} /></div>
                <div><p className="mb-6 text-xs text-muted-foreground">Impressions per day</p><DailyBars points={report.dates.map((r) => ({ date: r.keys?.[0] ?? '', value: r.impressions }))} color="var(--chart-2)" label="impressions" height={96} /></div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
              <nav aria-label="Search Console report sections" className="scrollbar-none flex gap-1 overflow-x-auto">
                {([['keywords', 'Keyword opportunities'], ['ctr', 'CTR opportunities'], ['pages', 'Page performance']] as [Tab, string][]).map(([key, label]) => <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} className={cn('shrink-0 border-b-2 px-3 py-2 text-sm', tab === key ? 'border-patina text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>)}
              </nav>
              <div className="mb-2 w-full sm:w-64"><Input aria-label="Search report rows" placeholder="Filter page or query…" value={query} onChange={(e) => setQuery(e.target.value)} leftIcon={<Search />} /></div>
            </div>
            {tab === 'keywords' && <div className="space-y-2"><p className="text-xs text-muted-foreground">Established: ≥50 impressions, position 4–20. Low-volume: 8–49 impressions, same positions. Not an AI score and not a click forecast. Candidates: {report.keywordOpportunities.length} ({report.keywordOpportunities.filter((row) => row.confidence === 'low_volume').length} low-volume).</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAllQueries} onChange={(e) => setShowAllQueries(e.target.checked)} />Show every returned query ({report.queryPerformance?.length ?? 0}) instead of only candidates</label></div>}

            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground"><tr>
                  {tab === 'keywords' ? <><th className="px-4 py-3 font-medium">Query</th><th className="px-4 py-3 font-medium">Why it's listed</th></> : <><th className="px-4 py-3 font-medium">Page</th>{tab === 'ctr' && <th className="px-4 py-3 font-medium">Why it's listed</th>}</>}
                  <th className="px-4 py-3 font-medium">Clicks</th><th className="px-4 py-3 font-medium">Impr.</th><th className="px-4 py-3 font-medium">CTR</th><th className="px-4 py-3 font-medium">Pos.</th>
                  {tab === 'pages' && <><th className="px-4 py-3 font-medium">Prev. clicks</th><th className="px-4 py-3 font-medium">Δ clicks</th><th className="px-4 py-3 font-medium">Crawl</th></>}
                  {tab === 'keywords' && <th className="px-4 py-3" />}
                </tr></thead>
                <tbody>
                  {visibleRows.map((row, i) => (
                    <tr key={`${row.keys?.join(':') || ''}-${i}`} className="border-b border-border/70 last:border-0">
                      <td className="max-w-[320px] break-all px-4 py-3">{tab === 'keywords' && 'query' in row ? row.query : 'page' in row ? row.page : '—'}</td>
                      {tab === 'keywords' && 'reason' in row && <td className="max-w-[260px] px-4 py-3 text-xs text-muted-foreground">{'confidence' in row && row.confidence ? `${row.confidence === 'low_volume' ? 'Low-volume' : 'Established'} · ` : ''}{row.reason}</td>}
                      {tab === 'ctr' && 'reason' in row && <td className="max-w-[260px] px-4 py-3 text-xs text-muted-foreground">{row.reason}</td>}
                      <td className="font-data px-4 py-3">{fmtNumber(row.clicks)}</td><td className="font-data px-4 py-3">{fmtNumber(row.impressions)}</td><td className="font-data px-4 py-3">{fmtCtr(row.ctr)}</td><td className="font-data px-4 py-3">{fmtPosition(row.position)}</td>
                      {tab === 'pages' && 'previous' in row && <><td className="font-data px-4 py-3">{fmtNumber(row.previous?.clicks)}</td><td className="font-data px-4 py-3">{row.clickDelta == null ? '—' : fmtNumber(row.clickDelta)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{row.crawl?.note ? row.crawl.note : row.crawl ? <span>{row.crawl.status_code ?? '—'} · {row.crawl.indexable == null ? '—' : row.crawl.indexable ? 'Potentially indexable' : 'Restricted'}{row.crawl.issues != null ? ` · ${row.crawl.issues} issues` : ''}</span> : 'Not crawled'}</td></>}
                      {tab === 'keywords' && 'query' in row && <td className="px-4 py-3 text-right"><Link to={`/trends?q=${encodeURIComponent(row.query)}`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"><PenLine className="h-3 w-3" />Brief in Radar</Link></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{query ? 'No rows match.' : 'No detail rows for this period. Empty values are never replaced with sample numbers.'}</div>}
            </div>
            {filteredRows.length > 100 && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Rows {rowPage * 100 + 1}–{Math.min((rowPage + 1) * 100, filteredRows.length)} of {fmtNumber(filteredRows.length)}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={rowPage === 0} onClick={() => setRowPage((n) => n - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={(rowPage + 1) * 100 >= filteredRows.length} onClick={() => setRowPage((n) => n + 1)}>Next</Button></div></div>}

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">Data coverage &amp; limitations</summary>
              <div className="mt-2 space-y-1.5">
                {!!report.limitations?.length && <ul className="list-disc space-y-1 pl-4">{report.limitations.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>}
                <p>Freshness: {report.freshness?.dataState || 'final'} · time zone {report.freshness?.timeZone || 'America/Los_Angeles'} · last returned date {dateLabel(report.freshness?.lastReturnedDate || undefined)}. Not a claim about Google's latest data.</p>
                {report.crawlStatus && <p>Crawler join: {report.crawlStatus}</p>}
                {report.coverage && <p>API rows: {fmtNumber(report.coverage.pagePerformance?.rowCount)} pages · {fmtNumber(report.coverage.keywordOpportunities?.rowCount)} queries. {(report.coverage.pagePerformance?.truncated || report.coverage.keywordOpportunities?.truncated) ? 'Fetch limit reached; lists are truncated.' : 'Pagination finished within app limits — not proof of complete coverage.'}</p>}
                <p>Google may anonymise low-volume queries and returns top rows only; totals need not equal the sum of detail rows.</p>
              </div>
            </details>
            {stale && <p className="flex items-center gap-1.5 text-xs text-ochre"><AlertTriangle className="h-3.5 w-3.5" />This report is {Math.round(ageDays(report.syncedAt))} days old. Sync when you need current numbers.</p>}
            {!stale && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-patina" />Reading the local copy — no request is sent to Google until you press Sync.</p>}
          </>
        )}
    </section>
  )
}
