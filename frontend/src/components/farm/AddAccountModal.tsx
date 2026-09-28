import { useEffect, useState } from 'react'
import { Plus, Instagram, Music2, Smartphone, Globe } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import api from '@/lib/api'

interface AddAccountModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

/** Minimal shape of GET /api/android/devices, used to bind an account to a home device. */
interface AndroidDeviceOption {
  id: string
  name: string
  status: string
  enabled?: boolean
}

type ExecutionEngine = 'chromium' | 'android'

const initialForm = {
  username: '',
  password: '',
  platform: 'Instagram',
  email: '',
  proxy: '',
  brandTag: '',
  notes: '',
}

export default function AddAccountModal({ open, onClose, onSuccess }: AddAccountModalProps) {
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(false)
  // Engine binding — offered for Instagram only, the backend rejects Android on other platforms.
  const [engine, setEngine] = useState<ExecutionEngine>('chromium')
  const [homeDeviceId, setHomeDeviceId] = useState('')
  const [devices, setDevices] = useState<AndroidDeviceOption[]>([])
  const [devicesNote, setDevicesNote] = useState('')

  const enabledDevices = devices.filter((device) => device.enabled !== false)
  const isAndroid = form.platform === 'Instagram' && engine === 'android'

  // Load registerable devices when the dialog opens; a 501 (server mode) simply leaves the list empty.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.get<{ devices: AndroidDeviceOption[] }>('/android/devices')
      .then(({ data }) => {
        if (cancelled) return
        setDevices(data.devices ?? [])
        setDevicesNote('')
      })
      .catch((err: any) => {
        if (cancelled) return
        setDevices([])
        setDevicesNote(err?.response?.data?.error || 'Android devices are unavailable in this mode')
      })
    return () => { cancelled = true }
  }, [open])

  function set(field: keyof typeof initialForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function setPlatform(value: string) {
    set('platform', value)
    // Android accounts are Instagram-only — fall back to Chromium for every other platform.
    if (value !== 'Instagram') {
      setEngine('chromium')
      setHomeDeviceId('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.platform) {
      toast({ title: 'Username and platform are required', variant: 'destructive' })
      return
    }
    if (isAndroid && !homeDeviceId) {
      toast({ title: 'Home device required', description: 'Pick the Android device that owns this account.', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        username: form.username.replace('@', ''),
        platform: form.platform,
        brandTag: form.brandTag || undefined,
        notes: form.notes || undefined,
      }

      if (isAndroid) {
        // Android accounts sign in manually on the device: no password, email or proxy is sent.
        payload.executionEngine = 'android'
        payload.homeDeviceId = homeDeviceId
      } else {
        payload.password = form.password || undefined
        payload.email = form.email || undefined
        payload.proxy = form.proxy || undefined
      }

      await api.post('/accounts', payload)
      toast.success('Account added', `@${form.username} added to the farm${isAndroid ? ' (Android engine)' : ''}.`)
      setForm(initialForm)
      setEngine('chromium')
      setHomeDeviceId('')
      onSuccess()
      onClose()
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to create account'
      toast.error('Error', msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-purple-400" />
            Add New Account
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Platform */}
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={form.platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Instagram">
                  <div className="flex items-center gap-2">
                    <Instagram className="h-3.5 w-3.5 text-pink-400" />
                    Instagram
                  </div>
                </SelectItem>
                <SelectItem value="TikTok">
                  <div className="flex items-center gap-2">
                    <Music2 className="h-3.5 w-3.5 text-cyan-400" />
                    TikTok
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Execution engine — Instagram only */}
          {form.platform === 'Instagram' && (
            <div className="space-y-1.5">
              <Label htmlFor="acc-engine">Execution Engine</Label>
              <Select
                value={engine}
                onValueChange={(v) => {
                  const next = v as ExecutionEngine
                  setEngine(next)
                  if (next !== 'android') setHomeDeviceId('')
                }}
              >
                <SelectTrigger id="acc-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-blue-400" />
                      Chromium (browser)
                    </div>
                  </SelectItem>
                  <SelectItem value="android" disabled={enabledDevices.length === 0}>
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-3.5 w-3.5 text-purple-400" />
                      Android (local device)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {engine === 'android' && enabledDevices.length === 0 && (
                <p className="text-[11px] text-yellow-400">
                  No enabled Android device registered{devicesNote ? ` — ${devicesNote}` : ''}. Register one in Android Farm first.
                </p>
              )}
            </div>
          )}

          {/* Home device — Android engine only */}
          {isAndroid && (
            <div className="space-y-1.5">
              <Label htmlFor="acc-home-device">Home Device</Label>
              <Select value={homeDeviceId} onValueChange={setHomeDeviceId}>
                <SelectTrigger id="acc-home-device">
                  <SelectValue placeholder="Select Android device" />
                </SelectTrigger>
                <SelectContent>
                  {enabledDevices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} · {device.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                This account runs only on the selected device. Work is rejected while the device is busy or leased.
              </p>
            </div>
          )}

          {/* Username / Password row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-username">Username</Label>
              <Input
                id="acc-username"
                placeholder="@username"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                required
              />
            </div>
            {!isAndroid && (
              <div className="space-y-1.5">
                <Label htmlFor="acc-password">Password</Label>
                <Input
                  id="acc-password"
                  type="password"
                  placeholder="Account password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Android onboarding note: the sign-in stays manual on the device. */}
          {isAndroid && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-[11px] text-blue-300">
              <p className="font-bold">Android onboarding</p>
              <p className="mt-1">
                Login stays manual on the device: open the account, then use Control Device to sign in yourself.
                RockBase stores no password here, does not move browser cookies onto Android, and never logs in
                automatically.
              </p>
            </div>
          )}

          {/* Email — browser engine only */}
          {!isAndroid && (
            <div className="space-y-1.5">
              <Label htmlFor="acc-email">Email used to register</Label>
              <Input
                id="acc-email"
                type="email"
                placeholder="account@email.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
          )}

          {/* Proxy — browser engine only */}
          {!isAndroid && (
            <div className="space-y-1.5">
              <Label htmlFor="acc-proxy">
                Proxy{' '}
                <span className="text-muted-foreground font-normal">
                  (host:port:user:pass)
                </span>
              </Label>
              <Input
                id="acc-proxy"
                placeholder="123.45.67.89:8000:user:pass"
                value={form.proxy}
                onChange={(e) => set('proxy', e.target.value)}
              />
            </div>
          )}

          {/* Brand Tag */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-brand">Brand Tag</Label>
            <Input
              id="acc-brand"
              placeholder="brand_marmer, brand_granit…"
              value={form.brandTag}
              onChange={(e) => set('brandTag', e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-notes">Notes</Label>
            <Textarea
              id="acc-notes"
              placeholder="Optional notes about this account…"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="purple" disabled={loading}>
              {loading ? 'Adding…' : 'Add Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
