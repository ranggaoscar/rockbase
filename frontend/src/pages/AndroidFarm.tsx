import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { timeAgo } from '@/lib/utils'

interface Lease { ownerId: string; jobId: string; expiresAt: string }
interface Device {
  id: string
  name: string
  avdName: string
  adbSerial: string | null
  status: string
  ramMb: number
  cpuCores: number
  enabled?: boolean
  lastBootAt?: string | null
  lastHealthcheckAt?: string | null
  _count: { accounts: number }
  // Phase 2 telemetry. Optional so a Phase 1 backend still renders the card.
  queueCount?: number
  lease?: Lease | null
  lastIdleAt?: string | null
  idleSince?: string | null
  lastBootDurationMs?: number | null
  lastError?: string | null
  lastShutdownReason?: string | null
}
interface Tooling { adb: boolean; emulator: boolean; error?: string; avds: string[]; maxConcurrent: number }
interface DeviceResponse { devices: Device[]; running?: number | null; maxConcurrent?: number }

const statusVariant: Record<string, 'success' | 'info' | 'warning' | 'error' | 'outline'> = {
  READY: 'success',
  BUSY: 'info',
  BOOTING: 'warning',
  ATTENTION: 'warning',
  ERROR: 'error',
  OFFLINE: 'outline',
}

function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function leaseRemaining(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (!Number.isFinite(remaining) || remaining <= 0) return 'expired'
  const seconds = Math.round(remaining / 1000)
  return seconds < 60 ? `${seconds}s left` : `${Math.round(seconds / 60)}m left`
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>{value}</dd>
    </div>
  )
}

export default function AndroidFarm() {
  const [devices, setDevices] = useState<Device[]>([])
  const [running, setRunning] = useState<number | null>(null)
  const [maxConcurrent, setMaxConcurrent] = useState<number | null>(null)
  const [tooling, setTooling] = useState<Tooling | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [avdName, setAvdName] = useState('')
  const reload = useCallback(async () => {
    try {
      const [deviceResponse, toolingResponse] = await Promise.all([
        api.get<DeviceResponse>('/android/devices'), api.get<Tooling>('/android/devices/tooling'),
      ])
      const list = deviceResponse.data.devices ?? []
      setDevices(list)
      setRunning(deviceResponse.data.running ?? null)
      setMaxConcurrent(deviceResponse.data.maxConcurrent ?? toolingResponse.data.maxConcurrent ?? null)
      setTooling(toolingResponse.data)
      setError('')
    } catch (err: any) { setError(err.response?.data?.error || err.message) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  async function action(id: string, operation: string) {
    setBusy(id)
    try {
      await api.post(`/android/devices/${id}/${operation}`)
      await reload()
    } catch (err: any) { setError(err.response?.data?.error || err.message) }
    finally { setBusy(null) }
  }
  async function register() {
    setBusy('register')
    try {
      await api.post('/android/devices', { name, avdName })
      setName(''); setAvdName(''); await reload()
    } catch (err: any) { setError(err.response?.data?.error || err.message) }
    finally { setBusy(null) }
  }

  const runningCount = running ?? '—'
  const limit = maxConcurrent ?? tooling?.maxConcurrent ?? null
  const queued = devices.reduce((total, device) => total + (device.queueCount ?? 0), 0)

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">Android Farm</h1>
        <p className="text-sm text-muted-foreground">Persistent local AVDs · device control only</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded border border-border px-2 py-1">Running <span className="font-mono font-semibold text-foreground">{runningCount}</span> / {limit ?? '—'}</span>
        <span className="rounded border border-border px-2 py-1">Queued jobs <span className="font-mono font-semibold text-foreground">{queued}</span></span>
        <span className="rounded border border-border px-2 py-1">Registered <span className="font-mono font-semibold text-foreground">{devices.length}</span></span>
      </div>
    </div>
    {error && <p role="alert" className="rounded border border-red-500/40 p-3 text-sm text-red-400">{error}</p>}
    {tooling && <p className="text-sm text-muted-foreground">ADB: {tooling.adb ? 'available' : 'missing'} · Emulator: {tooling.emulator ? 'available' : 'missing'}{tooling.error && ` · ${tooling.error}`}</p>}
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
      <label className="text-sm">Device name<input aria-label="Device name" className="mt-1 block rounded border border-border bg-background p-2" value={name} onChange={e => setName(e.target.value)} placeholder="RockDroid-01" /></label>
      <label className="text-sm">Installed AVD<select aria-label="Installed AVD" className="mt-1 block rounded border border-border bg-background p-2" value={avdName} onChange={e => setAvdName(e.target.value)}><option value="">Select AVD</option>{tooling?.avds.map(avd => <option key={avd} value={avd}>{avd}</option>)}</select></label>
      <Button disabled={!name.trim() || !avdName || busy !== null} onClick={register}>Register</Button>
      <Button variant="outline" onClick={reload}>Refresh</Button>
    </div>
    {!devices.length && <p className="text-sm text-muted-foreground">No registered devices. Install an Android Virtual Device in Android Studio first.</p>}
    <div className="grid gap-4 md:grid-cols-2">{devices.map(device => {
      const lease = device.lease ?? null
      const queueCount = device.queueCount ?? 0
      return <div key={device.id} className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{device.name}</h2><Badge variant={statusVariant[device.status] ?? 'outline'}>{device.status}</Badge></div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Metric label="AVD" value={device.avdName} />
        <Metric label="ADB serial" value={device.adbSerial || '—'} />
        <Metric label="Accounts" value={String(device._count.accounts)} />
        <Metric label="Hardware" value={`${device.cpuCores} CPU · ${device.ramMb} MB`} />
        <Metric label="Queue" value={`${queueCount} job${queueCount === 1 ? '' : 's'}`} />
        <Metric label="Lease" value={lease ? `${lease.jobId} · ${lease.ownerId}` : 'none'} />
        <Metric label="Lease expiry" value={lease ? leaseRemaining(lease.expiresAt) : '—'} />
        <Metric label="Last boot" value={device.lastBootAt ? timeAgo(device.lastBootAt) : 'never'} />
        <Metric label="Boot duration" value={formatDuration(device.lastBootDurationMs)} />
        <Metric label="Health check" value={device.lastHealthcheckAt ? timeAgo(device.lastHealthcheckAt) : '—'} />
        <Metric label="Last idle" value={(device.lastIdleAt ?? device.idleSince) ? timeAgo(device.lastIdleAt ?? device.idleSince ?? '') : '—'} />
        <Metric label="Enabled" value={device.enabled === false ? 'no' : 'yes'} />
        <Metric label="Last shutdown" value={device.lastShutdownReason ?? '—'} />
      </dl>
      {device.lastError && <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">Reason: {device.lastError}</p>}
      <div className="flex flex-wrap gap-2">{(['start', 'stop', 'restart', 'health'] as const).map(op => <Button key={op} size="sm" variant="outline" disabled={busy !== null || (op === 'start' && device.status !== 'OFFLINE' && device.status !== 'ERROR')} onClick={() => action(device.id, op)}>{op === 'health' ? 'Health Check' : op[0].toUpperCase() + op.slice(1)}</Button>)}</div>
      {device.status === 'READY' && <a className="text-sm text-purple-400 underline" href={`/api/android/devices/${device.id}/screenshot`} target="_blank" rel="noreferrer">Screenshot</a>}
    </div>
    })}</div>
  </div>
}
