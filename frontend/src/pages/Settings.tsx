import { useCallback, useEffect, useState } from 'react'
import {
  Settings as SettingsIcon, Key, Clock, Bell, Database, Shield,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Eye, EyeOff,
  Download, Upload, Save, Zap, Trash2, Server,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────
interface HealthCheck {
  name: string; status: 'ok' | 'warn' | 'error'; message: string; latency?: number
}
interface HealthResult {
  overall: 'ok' | 'warn' | 'error'; checks: HealthCheck[]; timestamp: string
}
interface AppSettings {
  geminiApiKey: string
  geminiKeySet: boolean
  postingDelayMin: number
  postingDelayMax: number
  warmingDelayMin: number
  warmingDelayMax: number
  warmingDuration: number
  notifyOnPostSuccess: boolean
  notifyOnPostFail: boolean
  notifyOnWarmingComplete: boolean
  timezone: string
  defaultHashtagPlatform: string
}

// ── Section wrapper ────────────────────────────────────────────────────────
function Section({ icon: Icon, title, children, iconColor = 'text-purple-400' }: {
  icon: React.ElementType; title: string; children: React.ReactNode; iconColor?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className={cn('h-4 w-4', iconColor)} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn('w-10 h-5 rounded-full transition-colors relative shrink-0', checked ? 'bg-purple-600' : 'bg-border')}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

// ── Range slider ───────────────────────────────────────────────────────────
function RangeRow({ label, value, min, max, step = 100, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <Label className="text-muted-foreground">{label}</Label>
        <span className="font-medium">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-secondary accent-purple-500 cursor-pointer" />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  )
}

// ── Health status icon ─────────────────────────────────────────────────────
function HealthIcon({ status }: { status: 'ok' | 'warn' | 'error' }) {
  if (status === 'ok')   return <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
  return <XCircle className="h-4 w-4 text-red-400 shrink-0" />
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Settings() {
  const [settings, setSettings]   = useState<AppSettings | null>(null)
  const [health, setHealth]       = useState<HealthResult | null>(null)
  const [saving, setSaving]       = useState(false)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [showKey, setShowKey]     = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [dirty, setDirty]         = useState(false)

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await api.get<{ settings: AppSettings }>('/settings')
      setSettings(data.settings)
    } catch { toast.error('Failed to load settings') }
  }, [])

  const runHealthCheck = useCallback(async () => {
    setLoadingHealth(true)
    try {
      const { data } = await api.get<HealthResult>('/settings/health')
      setHealth(data)
    } catch { toast.error('Health check failed') }
    finally { setLoadingHealth(false) }
  }, [])

  useEffect(() => { fetchSettings(); runHealthCheck() }, [fetchSettings, runHealthCheck])

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    setDirty(true)
  }

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    try {
      const payload: any = { ...settings }
      if (geminiKey.trim()) payload.geminiApiKey = geminiKey.trim()
      delete payload.geminiKeySet
      await api.patch('/settings', payload)
      toast.success('Settings saved')
      setDirty(false)
      setGeminiKey('')
      fetchSettings()
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  // ── Backup: export all localStorage data as JSON ──────────────────────
  function exportBackup() {
    const backup: Record<string, any> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      try { backup[key] = JSON.parse(localStorage.getItem(key)!) }
      catch { backup[key] = localStorage.getItem(key) }
    }
    backup._exportedAt = new Date().toISOString()
    backup._version = '1.0'
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rockbase-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Backup exported')
  }

  // ── Restore: import JSON backup ────────────────────────────────────────
  function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        let count = 0
        for (const [key, value] of Object.entries(data)) {
          if (key.startsWith('_')) continue
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
          count++
        }
        toast.success(`Restored ${count} items from backup`)
        fetchSettings()
      } catch {
        toast.error('Invalid backup file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Clear all data ─────────────────────────────────────────────────────
  function clearAllData() {
    if (!confirm('Clear all local data (drafts, auth token, preferences)? This cannot be undone.')) return
    localStorage.clear()
    toast.success('Local data cleared')
    setTimeout(() => window.location.reload(), 1000)
  }

  const s = settings
  const overallColor = health?.overall === 'ok' ? 'text-green-400' : health?.overall === 'warn' ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-purple-400" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gemini API key, posting delays, notifications, system health, and data backup.
          </p>
        </div>
        {dirty && (
          <Button variant="purple" onClick={saveSettings} disabled={saving}>
            {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save Changes</>}
          </Button>
        )}
      </div>

      {/* ── Gemini API Key ─────────────────────────────────────────────── */}
      <Section icon={Key} title="Gemini AI API Key" iconColor="text-blue-400">
        <div className="space-y-2">
          {s?.geminiKeySet ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <span className="text-green-400">API key is configured</span>
              <Badge variant="secondary" className="text-[10px]">Active</Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              No API key — AI Writer using fallback captions
            </div>
          )}

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={geminiKey}
              onChange={e => { setGeminiKey(e.target.value); setDirty(true) }}
              placeholder={s?.geminiKeySet ? 'Enter new key to replace…' : 'AIza…'}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
            />
            <button onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your key at <span className="text-purple-400">aistudio.google.com</span> · Stored server-side for this session.
          </p>
        </div>
      </Section>

      {/* ── Posting Delays ─────────────────────────────────────────────── */}
      <Section icon={Clock} title="Posting Delays" iconColor="text-cyan-400">
        <p className="text-xs text-muted-foreground -mt-2">Randomized delay between each account post to simulate human behavior.</p>
        {s && (
          <div className="space-y-4">
            <RangeRow label="Minimum delay (between posts)" value={s.postingDelayMin} min={500} max={5000} step={100} unit="ms"
              onChange={v => patch('postingDelayMin', Math.min(v, s.postingDelayMax - 100))} />
            <RangeRow label="Maximum delay (between posts)" value={s.postingDelayMax} min={500} max={10000} step={100} unit="ms"
              onChange={v => patch('postingDelayMax', Math.max(v, s.postingDelayMin + 100))} />
            <div className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              Each post will wait <span className="text-foreground font-medium">{(s.postingDelayMin / 1000).toFixed(1)}s – {(s.postingDelayMax / 1000).toFixed(1)}s</span> before posting to the next account.
            </div>
          </div>
        )}
      </Section>

      {/* ── Warming Preferences ────────────────────────────────────────── */}
      <Section icon={Zap} title="Warming Preferences" iconColor="text-green-400">
        {s && (
          <div className="space-y-4">
            <RangeRow label="Action delay minimum (warming)" value={s.warmingDelayMin} min={1000} max={10000} step={500} unit="ms"
              onChange={v => patch('warmingDelayMin', Math.min(v, s.warmingDelayMax - 500))} />
            <RangeRow label="Action delay maximum (warming)" value={s.warmingDelayMax} min={2000} max={30000} step={500} unit="ms"
              onChange={v => patch('warmingDelayMax', Math.max(v, s.warmingDelayMin + 500))} />
            <RangeRow label="Warming period duration" value={s.warmingDuration} min={7} max={30} step={1} unit=" days"
              onChange={v => patch('warmingDuration', v)} />
            <div className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              Warming actions will use {(s.warmingDelayMin / 1000).toFixed(1)}s–{(s.warmingDelayMax / 1000).toFixed(1)}s delays over {s.warmingDuration} days.
            </div>
          </div>
        )}
      </Section>

      {/* ── Notifications ──────────────────────────────────────────────── */}
      <Section icon={Bell} title="Notifications" iconColor="text-yellow-400">
        {s && (
          <div className="space-y-3">
            {[
              { key: 'notifyOnPostSuccess' as const, label: 'Post success', desc: 'Show toast when a post is published successfully' },
              { key: 'notifyOnPostFail'    as const, label: 'Post failure',  desc: 'Show toast when a post fails to publish' },
              { key: 'notifyOnWarmingComplete' as const, label: 'Warming complete', desc: 'Show toast when an account finishes the warming period' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Toggle checked={s[key] as boolean} onChange={v => patch(key, v as any)} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── System Health ──────────────────────────────────────────────── */}
      <Section icon={Server} title="System Health" iconColor="text-purple-400">
        <div className="space-y-3">
          {/* Overall + refresh */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {health ? (
                <>
                  <HealthIcon status={health.overall} />
                  <span className={cn('text-sm font-medium', overallColor)}>
                    {health.overall === 'ok' ? 'All systems operational' : health.overall === 'warn' ? 'Some warnings' : 'Issues detected'}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Run health check below</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={runHealthCheck} disabled={loadingHealth}>
              {loadingHealth
                ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                : <><RefreshCw className="h-3.5 w-3.5" /> Check Now</>
              }
            </Button>
          </div>

          {/* Check list */}
          {health && (
            <div className="space-y-2">
              {health.checks.map(check => (
                <div key={check.name} className={cn(
                  'flex items-start gap-3 rounded-lg px-3 py-2.5 border',
                  check.status === 'ok'    && 'bg-green-500/5 border-green-500/15',
                  check.status === 'warn'  && 'bg-yellow-500/5 border-yellow-500/15',
                  check.status === 'error' && 'bg-red-500/5 border-red-500/15',
                )}>
                  <HealthIcon status={check.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{check.name}</span>
                      {check.latency !== undefined && (
                        <span className="text-xs text-muted-foreground">{check.latency}ms</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
                  </div>
                  <Badge
                    className={cn('text-[10px] shrink-0',
                      check.status === 'ok'    && 'bg-green-500/20 text-green-400',
                      check.status === 'warn'  && 'bg-yellow-500/20 text-yellow-400',
                      check.status === 'error' && 'bg-red-500/20 text-red-400',
                    )}
                  >
                    {check.status.toUpperCase()}
                  </Badge>
                </div>
              ))}
              <p className="text-xs text-muted-foreground text-right">
                Last checked: {health.timestamp ? new Date(health.timestamp).toLocaleTimeString('id-ID') : '—'}
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* ── Backup & Restore ───────────────────────────────────────────── */}
      <Section icon={Database} title="Backup & Restore" iconColor="text-orange-400">
        <p className="text-xs text-muted-foreground -mt-2">
          Export your local data (drafts, preferences, auth token) as a JSON file for safekeeping.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button variant="outline" onClick={exportBackup} className="w-full">
            <Download className="h-4 w-4" /> Export Backup
          </Button>

          <label className="cursor-pointer">
            <input type="file" accept=".json" className="hidden" onChange={importBackup} />
            <span className={cn(
              'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium w-full',
              'hover:bg-secondary transition-colors cursor-pointer',
            )}>
              <Upload className="h-4 w-4" /> Import Backup
            </span>
          </label>

          <Button
            variant="ghost"
            className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={clearAllData}
          >
            <Trash2 className="h-4 w-4" /> Clear All Data
          </Button>
        </div>

        <div className="rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground/70">What gets backed up:</p>
          <ul className="space-y-0.5 ml-3 list-disc">
            <li>AI Writer draft library</li>
            <li>Auth session token</li>
            <li>Theme & display preferences</li>
          </ul>
          <p className="mt-2">Account data, posts, and schedules are stored on the server.</p>
        </div>
      </Section>

      {/* ── About ──────────────────────────────────────────────────────── */}
      <Section icon={Shield} title="About ROCK BASE" iconColor="text-muted-foreground">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[
            { label: 'Version',   value: '1.0.0' },
            { label: 'Frontend',  value: 'React 19 + Vite' },
            { label: 'Backend',   value: 'Node.js + Express' },
            { label: 'AI Engine', value: 'Google Gemini 1.5' },
          ].map(item => (
            <div key={item.label} className="rounded-lg border border-border px-3 py-2.5">
              <p className="text-muted-foreground">{item.label}</p>
              <p className="font-medium mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Built for managing multiple Instagram & TikTok accounts for Marmer, Granit & Batu Alam brands.
        </p>
      </Section>

      {/* Save button at bottom (for accessibility) */}
      {dirty && (
        <div className="flex justify-end pb-4">
          <Button variant="purple" size="lg" onClick={saveSettings} disabled={saving}>
            {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save All Changes</>}
          </Button>
        </div>
      )}
    </div>
  )
}
