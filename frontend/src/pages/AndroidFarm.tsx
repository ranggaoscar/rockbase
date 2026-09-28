import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'

interface Device {
  id: string
  name: string
  avdName: string
  adbSerial: string | null
  status: string
  ramMb: number
  cpuCores: number
  _count: { accounts: number }
}
interface Tooling { adb: boolean; emulator: boolean; error?: string; avds: string[]; maxConcurrent: number }

export default function AndroidFarm() {
  const [devices, setDevices] = useState<Device[]>([])
  const [tooling, setTooling] = useState<Tooling | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [avdName, setAvdName] = useState('')
  const reload = useCallback(async () => {
    try {
      const [deviceResponse, toolingResponse] = await Promise.all([
        api.get<{ devices: Device[] }>('/android/devices'), api.get<Tooling>('/android/devices/tooling'),
      ])
      setDevices(deviceResponse.data.devices)
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

  return <div className="space-y-6">
    <div><h1 className="text-xl font-bold">Android Farm</h1>
      <p className="text-sm text-muted-foreground">Persistent local AVDs · max {tooling?.maxConcurrent ?? '—'} running · device control only</p>
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
    <div className="grid gap-4 md:grid-cols-2">{devices.map(device => <div key={device.id} className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{device.name}</h2><span className="rounded bg-secondary px-2 py-1 text-xs font-medium">{device.status}</span></div>
      <p className="text-sm text-muted-foreground">AVD: {device.avdName}<br />ADB: {device.adbSerial || '—'}<br />Accounts: {device._count.accounts}<br />{device.cpuCores} CPU · {device.ramMb} MB</p>
      <div className="flex flex-wrap gap-2">{(['start', 'stop', 'restart', 'health'] as const).map(op => <Button key={op} size="sm" variant="outline" disabled={busy !== null || (op === 'start' && device.status !== 'OFFLINE' && device.status !== 'ERROR')} onClick={() => action(device.id, op)}>{op === 'health' ? 'Health Check' : op[0].toUpperCase() + op.slice(1)}</Button>)}</div>
      {device.status === 'READY' && <a className="text-sm text-purple-400 underline" href={`/api/android/devices/${device.id}/screenshot`} target="_blank" rel="noreferrer">Screenshot</a>}
    </div>)}</div>
  </div>
}
