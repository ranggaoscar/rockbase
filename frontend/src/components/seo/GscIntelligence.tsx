import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCw, Search, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { Website } from '@/components/seo/api'
import { errorMessage, gscApi, type GscMapping, type GscProperty, type GscReport, type GscStatus, type MetricRow } from '@/components/seo/gscApi'

type Tab = 'pages' | 'keywords' | 'ctr'
const localMode = import.meta.env.VITE_ROCKBASE_MODE === 'local'
const fmtNumber = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
const fmtCtr = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(2)}%`
const fmtPosition = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1)
const dateLabel = (s?: string) => s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const pp = (current?: number | null, previous?: number | null) => current == null || previous == null ? '—' : `${((current - previous) * 100).toFixed(2)} pp`
const errText = (error: unknown, fallback: string) => errorMessage(error, fallback)

export default function GscIntelligence({ website, workspaceId }: { website: Website | undefined; workspaceId: string }) {
  const [status, setStatus] = useState<GscStatus | null>(null)
  const [properties, setProperties] = useState<GscProperty[]>([])
  const [mapping, setMapping] = useState<GscMapping | null>(null)
  const [report, setReport] = useState<GscReport | null>(null)
  const [property, setProperty] = useState('')
  const [days, setDays] = useState<7 | 28>(28)
  const [tab, setTab] = useState<Tab>('pages')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [credentialPath, setCredentialPath] = useState('')
  const [importingService, setImportingService] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [query, setQuery] = useState('')
  const [rowPage, setRowPage] = useState(0)
  const [showAllQueries, setShowAllQueries] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const scope = `${workspaceId}:${website?.id || ''}`
  const generation = useRef(0)

  const refreshStatus = useCallback(async () => {
    const { data } = await gscApi.status()
    setStatus(data)
    return data
  }, [])

  useEffect(() => {
    let cancelled = false
    generation.current++
    setSyncing(false); setSavingMapping(false)
    setStatus(null); setProperties([]); setMapping(null); setReport(null); setProperty(''); setError(''); setLoading(true)
    if (!localMode) { setLoading(false); return }
    gscApi.status().then(({ data }) => { if (!cancelled) setStatus(data) }).catch((e) => { if (!cancelled) setError(errText(e, 'Status Google Search Console tidak dapat dimuat.')) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; generation.current++ }
  }, [scope])

  useEffect(() => {
    if (!status?.pending || !localMode) return
    let cancelled = false
    const timer = window.setInterval(() => { gscApi.status().then(({ data }) => { if (!cancelled) setStatus(data) }).catch(() => {}) }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [status?.pending])

  useEffect(() => {
    let cancelled = false
    setProperties([]); setMapping(null); setReport(null); setProperty(''); setError('')
    if (!localMode || !status?.connected || !website || !workspaceId) return
    Promise.all([gscApi.properties(), gscApi.mapping(workspaceId, website.id), gscApi.report(workspaceId, website.id, days)])
      .then(([p, m, r]) => {
        if (cancelled) return
        setProperties(p.data)
        setMapping(m.data)
        setProperty(m.data?.property || '')
        setReport(r.data); if (r.data) setDays(Math.round((Date.parse(r.data.periods.current.endDate) - Date.parse(r.data.periods.current.startDate)) / 86400000) + 1 === 7 ? 7 : 28)
      }).catch((e) => { if (!cancelled) setError(errText(e, 'Data Search Console tidak dapat dimuat. Coba lagi.')) })
    return () => { cancelled = true }
  }, [scope, status?.connected])

  const saveConfig = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingConfig(true); setError('')
    try {
      await gscApi.configure({ client_id: clientId.trim(), ...(clientSecret ? { client_secret: clientSecret } : {}) })
      setClientSecret(''); await refreshStatus()
    } catch (e) { setError(errText(e, 'Konfigurasi tidak tersimpan.')) } finally { setSavingConfig(false) }
  }
  const importService = async (event: React.FormEvent) => {
    event.preventDefault(); setImportingService(true); setError('')
    try {
      await gscApi.importServiceAccount(credentialPath.trim())
      setCredentialPath(''); await refreshStatus()
    } catch (e) { setError(errText(e, 'Service Account tidak dapat dihubungkan.')) }
    finally { setImportingService(false) }
  }
  const parseDesktopJson = (text: string) => {
    try {
      const parsed = JSON.parse(text)
      const app = parsed.installed
      if (!app || typeof app.client_id !== 'string') throw new Error('Format JSON harus berasal dari OAuth client Desktop app Google Cloud.')
      setClientId(app.client_id)
      if (typeof app.client_secret === 'string') setClientSecret(app.client_secret)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'JSON tidak valid.') }
  }
  const connect = async () => {
    const popup = window.open('about:blank', '_blank')
    popupRef.current = popup
    setConnecting(true); setError('')
    try {
      const { data } = await gscApi.connect()
      if (popup && !popup.closed) { popup.opener = null; popup.location.href = data.authorizationUrl }
      else window.location.assign(data.authorizationUrl)
      await refreshStatus()
    } catch (e) { popup?.close(); setError(errText(e, 'Tidak dapat memulai koneksi Google.')) } finally { setConnecting(false) }
  }
  const disconnect = async () => {
    generation.current++
    setSyncing(false)
    setError('')
    try {
      const { data } = await gscApi.disconnect()
      setStatus((old) => old ? { ...old, connected: false, pending: false } : old)
      setProperties([]); setMapping(null); setReport(null); setProperty('')
      if (data.warning) setError(data.warning)
    } catch (e) { setError(errText(e, 'Disconnect gagal.')) }
  }
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
    } catch (e) { if (version === generation.current) setError(errText(e, 'Property tidak dapat dipetakan ke website ini.')) } finally { if (version === generation.current) setSavingMapping(false) }
  }
  const sync = async () => {
    if (!website || !workspaceId || !mapping) return
    setSyncing(true); setError('')
    const version = generation.current
    try {
      const { data } = await gscApi.sync({ workspace_id: workspaceId, website_id: website.id, days, force: false })
      if (version !== generation.current) return
      setReport(data)
    } catch (e) { if (version === generation.current) setError(errText(e, 'Sinkronisasi gagal. Coba lagi.')) } finally { if (version === generation.current) setSyncing(false) }
  }
  const reload = async () => {
    setError(''); setLoading(true)
    const version = generation.current
    try {
      const s = await refreshStatus()
      if (s.connected && website && workspaceId) {
        const [p, m, r] = await Promise.all([gscApi.properties(), gscApi.mapping(workspaceId, website.id), gscApi.report(workspaceId, website.id, days)])
        if (version !== generation.current) return
        setProperties(p.data); setMapping(m.data); setProperty(m.data?.property || ''); setReport(r.data)
      }
    } catch (e) { if (version === generation.current) setError(errText(e, 'Refresh gagal.')) } finally { if (version === generation.current) setLoading(false) }
  }

  const filteredRows = useMemo(() => {
    if (!report) return []
    const q = query.trim().toLowerCase()
    const rows = tab === 'pages' ? report.pagePerformance : tab === 'keywords' ? showAllQueries ? (report.queryPerformance || []).map((row) => ({ ...row, confidence: undefined, reason: 'Observed query performance; not automatically an opportunity.' })) : report.keywordOpportunities : report.ctrOpportunities
    return q ? rows.filter((row) => (tab === 'keywords' ? ('query' in row ? row.query : '') : ('page' in row ? row.page : '')).toLowerCase().includes(q)) : rows
  }, [report, tab, query, showAllQueries])

  useEffect(() => { setRowPage(0) }, [query, tab, report, showAllQueries])
  const visibleRows = filteredRows.slice(rowPage * 100, (rowPage + 1) * 100)

  if (!localMode) return <Card><CardContent className="p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground"/><div><h2 className="font-semibold">Google Search Console</h2><p className="mt-1 text-sm text-muted-foreground">Koneksi GSC hanya tersedia di Local Mode. Tidak ada permintaan kredensial atau data GSC yang dikirim dari mode ini.</p><Badge variant="outline" className="mt-3">Disabled in server mode</Badge></div></div></CardContent></Card>

  return <section className="space-y-4" aria-labelledby="gsc-title">
    {status?.error && <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-200">{status.error}</p>}
    {status?.pending && <Button variant="outline" onClick={disconnect}>Batalkan koneksi Google</Button>}
    {status?.connected && <p className="text-xs text-muted-foreground">Provider aktif: <strong>{status.provider === 'service_account' ? 'Service Account · readonly' : 'OAuth Desktop · readonly'}</strong>. {status.provider === 'service_account' && 'Disconnect hanya menghapus koneksi RockBase; credential asli tidak dicabut.'}</p>}
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-purple-400">SEARCH PERFORMANCE</p><h2 id="gsc-title" className="mt-1 text-xl font-bold">Google Search Console</h2><p className="mt-1 text-sm text-muted-foreground">Performa organik dan peluang halaman untuk website terpilih.</p></div><Button variant="outline" onClick={reload} disabled={loading} aria-label="Refresh Google Search Console"><RefreshCw className="h-4 w-4"/>Refresh</Button></header>
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><span>{error}</span><button className="ml-auto underline" onClick={reload}>Retry</button></div>}
    {loading ? <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Memeriksa koneksi GSC…</CardContent></Card> : !status?.enabled ? <Card><CardContent className="p-5"><h3 className="font-semibold">Integrasi GSC belum tersedia</h3><p className="mt-1 text-sm text-muted-foreground">{status?.setupRequired || status?.error || 'Backend local belum mengaktifkan Google Search Console.'}</p></CardContent></Card> : <>
      <Card><CardHeader className="pb-3"><CardTitle className="flex items-center justify-between text-base"><span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-purple-400"/>Koneksi & persetujuan</span>{status.connected ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3"/>Connected</Badge> : status.pending ? <Badge variant="warning"><Loader2 className="mr-1 h-3 w-3 animate-spin"/>Menunggu persetujuan</Badge> : <Badge variant="outline">Belum terhubung</Badge>}</CardTitle></CardHeader><CardContent className="space-y-4">
        {!status.connected && <><form onSubmit={importService} className="space-y-3 rounded-lg border border-border p-3"><div><h3 className="text-sm font-semibold">Gunakan Service Account existing</h3><p className="mt-1 text-xs text-muted-foreground">Masukkan path lokal JSON milik instalasi lo. Backend membaca file sekali dan menyimpan credential minimum ke Windows Credential Manager. File asli tidak diubah atau dihapus, termasuk saat Disconnect. Jangan paste JSON private key di browser atau chat.</p></div><div className="flex flex-wrap items-end gap-2"><div className="min-w-[220px] flex-1 space-y-1.5"><Label htmlFor="gsc-service-path">Path JSON Service Account lokal</Label><Input id="gsc-service-path" value={credentialPath} autoComplete="off" onChange={(e) => setCredentialPath(e.target.value)} placeholder="Path absolut ke file JSON di luar repository"/></div><Button type="submit" variant="purple" disabled={!credentialPath.trim() || importingService || status.pending}>{importingService ? 'Memverifikasi…' : 'Hubungkan Service Account'}</Button></div></form><p className="text-xs font-medium text-muted-foreground">Atau gunakan OAuth Desktop dengan akun Google masing-masing:</p><p className="text-sm text-muted-foreground">Masukkan OAuth client dari Google Cloud <strong>Desktop app</strong>. Client secret disimpan oleh OS vault ({status.storage || 'OS credential vault'}), bukan browser storage. Tidak ada password akun Google, refresh token, atau access token yang diminta atau ditampilkan.</p>
          <form onSubmit={saveConfig} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"><div className="space-y-1.5"><Label htmlFor="gsc-client-id">OAuth Desktop client ID</Label><Input id="gsc-client-id" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" required/></div><div className="space-y-1.5"><Label htmlFor="gsc-client-secret">Client secret (opsional)</Label><Input id="gsc-client-secret" type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Disimpan di OS vault"/></div><Button type="submit" variant="outline" disabled={savingConfig || !clientId.trim()}>{savingConfig ? 'Menyimpan…' : 'Simpan konfigurasi'}</Button></form>
          <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Paste OAuth JSON lokal (opsional)</summary><p className="mt-2 text-xs text-muted-foreground">Hanya JSON OAuth client dari Google Cloud Console → Desktop app. Jangan paste password, refresh token, atau data akun. Parsing dilakukan di browser lokal; hanya client ID/secret dikirim untuk disimpan di OS vault.</p><textarea aria-label="OAuth Desktop app JSON" className="mt-2 min-h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" placeholder="Paste JSON Desktop app di sini" onChange={(e) => { if (e.target.value.trim()) parseDesktopJson(e.target.value); e.target.value = '' }}/></details>
          <Button variant="purple" disabled={!status.configured || connecting || status.pending} onClick={connect}>{connecting ? <><Loader2 className="h-4 w-4 animate-spin"/>Membuka Google…</> : <><ExternalLink className="h-4 w-4"/>Hubungkan akun Google</>}</Button>
          {status.pending && <p aria-live="polite" className="text-xs text-muted-foreground">Selesaikan persetujuan di jendela Google yang terbuka. Status diperiksa otomatis tiap 2 detik.</p>}
        </>}
        {status.connected && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Google Search Console terhubung. Provider {status.provider === 'service_account' ? 'Service Account' : 'OAuth Desktop'}; token tidak ditampilkan.</p><Button variant="outline" onClick={disconnect}><Unplug className="h-4 w-4"/>Putuskan koneksi</Button></div>}
        <p className="text-xs text-muted-foreground">Akses dibatasi ke Local Mode. {status.storage ? `Penyimpanan: ${status.storage}.` : ''}</p>
      </CardContent></Card>

      {status.connected && <>
        {!website || !workspaceId ? <Card><CardContent className="p-5 text-sm text-muted-foreground">Pilih website dan workspace untuk mengatur pemetaan GSC.</CardContent></Card> : <>
          <Card><CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end"><div><Label>Target website</Label><p className="mt-1 truncate text-sm font-medium">{website.name} · {website.base_url}</p><p className="text-xs text-muted-foreground">Workspace: {workspaceId} · Brand: {website.brand_key || 'Unassigned'}</p></div><div className="space-y-1.5"><Label htmlFor="gsc-property">Search Console property</Label><select id="gsc-property" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={property} onChange={(e) => setProperty(e.target.value)}><option value="">Pilih property yang diizinkan…</option>{properties.map((p) => <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl} · {p.permissionLevel}</option>)}</select></div><Button variant="outline" disabled={!property || savingMapping || property === mapping?.property} onClick={chooseProperty}>{savingMapping ? 'Menyimpan…' : 'Peta ke website'}</Button>
            {mapping && <p className="md:col-span-3 text-xs text-muted-foreground">Property aktif: <span className="break-all text-foreground">{mapping.property}</span> dipetakan ke {website.name} · {website.brand_key || 'tanpa brand'}.</p>}
          </CardContent></Card>
          {!mapping ? <Card><CardContent className="py-8 text-center"><p className="font-medium">Pilih property untuk website ini</p><p className="mt-1 text-sm text-muted-foreground">Daftar di atas berasal dari property yang benar-benar dapat diakses akun Google ini. Pemetaan divalidasi backend terhadap website/workspace.</p></CardContent></Card> : <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 p-3"><p className="min-w-0 text-sm">Laporan: <span className="break-all font-medium">{mapping.property}</span></p><div className="flex items-center gap-2"><Label htmlFor="gsc-period" className="text-xs">Periode</Label><select id="gsc-period" className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={days} onChange={(e) => { generation.current++; setSyncing(false); setDays(Number(e.target.value) as 7 | 28); setReport(null) }}><option value={7}>7 hari</option><option value={28}>28 hari</option></select><Button variant="purple" onClick={sync} disabled={syncing}>{syncing ? <><Loader2 className="h-4 w-4 animate-spin"/>Sinkronisasi…</> : <><RefreshCw className="h-4 w-4"/>Sinkronkan sekarang</>}</Button></div></div>
            {!report ? <Card><CardContent className="py-9 text-center"><p className="font-medium">Belum ada laporan tersimpan</p><p className="mt-1 text-sm text-muted-foreground">Jalankan sinkronisasi manual untuk mengambil data periode yang dipilih.</p></CardContent></Card> : <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Periode sekarang {dateLabel(report.periods?.current?.startDate)} – {dateLabel(report.periods?.current?.endDate)} <span className="px-1">vs</span> sebelumnya {dateLabel(report.periods?.previous?.startDate)} – {dateLabel(report.periods?.previous?.endDate)}</span><span>Sinkron terakhir: {report.syncedAt ? new Date(report.syncedAt).toLocaleString() : '—'}</span></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([['Clicks', report.totals.current?.clicks, report.totals.previous?.clicks, 'count'],['Impressions', report.totals.current?.impressions, report.totals.previous?.impressions, 'count'],['CTR', report.totals.current?.ctr, report.totals.previous?.ctr, 'ctr'],['Average position', report.totals.current?.position, report.totals.previous?.position, 'position']] as const).map(([label, current, previous, kind]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{kind === 'ctr' ? fmtCtr(current) : kind === 'position' ? fmtPosition(current) : fmtNumber(current)}</p><p className="mt-1 text-xs text-muted-foreground">Sebelumnya: {kind === 'ctr' ? fmtCtr(previous) : kind === 'position' ? fmtPosition(previous) : fmtNumber(previous)} · perubahan {kind === 'ctr' ? pp(current, previous) : current == null || previous == null ? '—' : kind === 'position' ? fmtPosition(current - previous) : fmtNumber(current - previous)}</p></CardContent></Card>)}</div>
              {!!report.dates?.length && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Clicks & impressions per hari</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Tanggal</th><th className="py-2 pr-3">Clicks</th><th className="py-2 pr-3">Impressions</th><th className="py-2 pr-3">CTR</th><th className="py-2">Position</th></tr></thead><tbody>{report.dates.map((row, i) => <tr key={`${row.keys?.join(':') || i}`} className="border-t border-border/70"><td className="py-2 pr-3">{row.keys?.[0] ? dateLabel(row.keys[0]) : '—'}</td><td className="py-2 pr-3">{fmtNumber(row.clicks)}</td><td className="py-2 pr-3">{fmtNumber(row.impressions)}</td><td className="py-2 pr-3">{fmtCtr(row.ctr)}</td><td className="py-2">{fmtPosition(row.position)}</td></tr>)}</tbody></table></CardContent></Card>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border"><nav aria-label="Google Search Console report sections" className="flex gap-1">{([['pages','Page Performance'],['keywords','Keyword Opportunities'],['ctr','CTR Opportunities']] as [Tab,string][]).map(([key,label]) => <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} className={`border-b-2 px-3 py-2 text-sm ${tab === key ? 'border-purple-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</nav><Input aria-label="Search report rows" className="mb-2 w-full sm:w-64" placeholder="Cari page atau query…" value={query} onChange={(e) => setQuery(e.target.value)} leftIcon={<Search/>}/></div>
              {tab === 'keywords' && <div className="space-y-2"><p className="text-xs text-muted-foreground">Established: ≥50 impressions, posisi 4–20. Low-volume: 8–49 impressions, posisi yang sama. Bukan skor AI dan bukan prediksi klik. Kandidat: {report.keywordOpportunities.length} ({report.keywordOpportunities.filter((row) => row.confidence === 'low_volume').length} low-volume).</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAllQueries} onChange={(e) => setShowAllQueries(e.target.checked)}/>Tampilkan semua query yang dikembalikan ({report.queryPerformance?.length ?? 0}); kandidat peluang: {report.keywordOpportunities.length}</label></div>}
              <Card><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[930px] text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr>{tab === 'keywords' ? <><th className="px-4 py-3">Query</th><th className="px-4 py-3">Opportunity</th></> : <><th className="px-4 py-3">{tab === 'pages' ? 'Page' : 'Page'}</th>{tab === 'ctr' && <th className="px-4 py-3">Opportunity</th>}</>}<th className="px-4 py-3">Clicks</th><th className="px-4 py-3">Impressions</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">Position</th>{tab === 'pages' && <><th className="px-4 py-3">Previous clicks</th><th className="px-4 py-3">Δ clicks</th><th className="px-4 py-3">Crawl</th></>}</tr></thead><tbody>{visibleRows.map((row, i) => { const key = `${row.keys?.join(':') || ''}-${i}`; return <tr key={key} className="border-b border-border/70 last:border-0"><td className="max-w-[320px] break-all px-4 py-3">{tab === 'keywords' && 'query' in row ? row.query : 'page' in row ? row.page : '—'}</td>{tab === 'keywords' && 'reason' in row && <td className="max-w-[260px] px-4 py-3 text-muted-foreground">{'confidence' in row && row.confidence ? `${row.confidence === 'low_volume' ? 'Low-volume' : 'Established'} · ` : ''}{row.reason}</td>}{tab === 'ctr' && 'reason' in row && <td className="max-w-[260px] px-4 py-3 text-muted-foreground">{row.reason}</td>}<td className="px-4 py-3">{fmtNumber(row.clicks)}</td><td className="px-4 py-3">{fmtNumber(row.impressions)}</td><td className="px-4 py-3">{fmtCtr(row.ctr)}</td><td className="px-4 py-3">{fmtPosition(row.position)}</td>{tab === 'pages' && 'previous' in row && <><td className="px-4 py-3">{fmtNumber(row.previous?.clicks)}</td><td className="px-4 py-3">{row.clickDelta == null ? '—' : fmtNumber(row.clickDelta)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{row.crawl?.note ? row.crawl.note : row.crawl ? <span>{row.crawl.status_code ?? '—'} · {row.crawl.indexable == null ? '—' : row.crawl.indexable ? 'Potentially indexable' : 'Restricted'}{row.crawl.issues != null ? ` · ${row.crawl.issues} issues` : ''}</span> : 'Not crawled'}</td></>}</tr> })}</tbody></table>{filteredRows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{query ? 'Tidak ada baris yang cocok.' : 'Tidak ada baris detail tersedia untuk periode ini. Nilai kosong tidak diganti angka contoh.'}</div>}</CardContent></Card>
              {filteredRows.length > 100 && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Baris {rowPage * 100 + 1}–{Math.min((rowPage + 1) * 100, filteredRows.length)} dari {fmtNumber(filteredRows.length)}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={rowPage === 0} onClick={() => setRowPage((n) => n - 1)}>Sebelumnya</Button><Button variant="outline" size="sm" disabled={(rowPage + 1) * 100 >= filteredRows.length} onClick={() => setRowPage((n) => n + 1)}>Berikutnya</Button></div></div>}
              {!!report.limitations?.length && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><h3 className="text-sm font-medium text-amber-200">Catatan cakupan data</h3><ul className="mt-1 list-inside list-disc space-y-1 text-xs text-muted-foreground">{report.limitations.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul></div>}
              <p className="text-xs text-muted-foreground">Freshness: {report.freshness?.dataState || 'final'} · zona waktu {report.freshness?.timeZone || 'America/Los_Angeles'} · tanggal terakhir yang dikembalikan: {dateLabel(report.freshness?.lastReturnedDate || undefined)}. Bukan klaim data terbaru Google.</p>
              {report.crawlStatus && <p className="text-xs text-muted-foreground">Crawler: {report.crawlStatus}</p>}
              {report.coverage && <p className="text-xs text-muted-foreground">Baris API: {fmtNumber(report.coverage.pagePerformance?.rowCount)} halaman · {fmtNumber(report.coverage.keywordOpportunities?.rowCount)} query. {(report.coverage.pagePerformance?.truncated || report.coverage.keywordOpportunities?.truncated) ? 'Batas pengambilan tercapai; daftar terpotong.' : 'Pagination selesai dalam batas aplikasi, bukan bukti cakupan lengkap.'}</p>}
              <p className="text-xs text-muted-foreground">Google dapat menganonimkan query ber-volume rendah dan hanya mengembalikan baris teratas; total laporan tidak harus sama dengan jumlah baris detail. Data ini tidak mencakup semua query pengguna.</p>
            </>}
          </>}
        </>}
      </>}
    </>}
  </section>
}
