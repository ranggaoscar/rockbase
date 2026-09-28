import { useEffect, useState } from 'react'
import { Edit2, Instagram, Music2, Smartphone, Globe } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import api from '@/lib/api'

type Engine = 'chromium' | 'android'
type BadgeVariant = 'success' | 'warning' | 'error' | 'outline' | 'purple' | 'info'

interface Account {
  id: string
  username: string
  platform: string
  email?: string
  brandTag?: string
  status: string
  notes?: string
  warmingDay?: number
  // Phase 2 engine routing — optional so the modal still works against a Phase 1 payload.
  executionEngine?: string | null
  homeDeviceId?: string | null
  accountHealth?: string | null
  androidHealth?: string | null
  accountHealthReason?: string | null
  androidHealthReason?: string | null
  sessionHealth?: string | null
  sessionHealthReason?: string | null
}

interface HomeDevice { id: string; name: string; avdName: string; status: string; enabled?: boolean }

interface EditForm {
  username: string
  platform: string
  email: string
  brandTag: string
  status: string
  notes: string
  warmingDay: number
  executionEngine: Engine
  homeDeviceId: string
}

const sessionVariant: Record<string, BadgeVariant> = {
  HEALTHY: 'success',
  NEEDS_RELOGIN: 'warning',
  CHECKPOINT: 'error',
  EXPIRED: 'error',
  PAUSED: 'outline',
  UNKNOWN: 'outline',
}

interface EditAccountModalProps {
  account: Account | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function EditAccountModal({ account, open, onClose, onSuccess }: EditAccountModalProps) {
  const [form, setForm] = useState<EditForm>({
    username: '',
    platform: 'Instagram',
    email: '',
    brandTag: '',
    status: 'active',
    notes: '',
    warmingDay: 0,
    executionEngine: 'chromium',
    homeDeviceId: '',
  })
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<HomeDevice[]>([])
  const [devicesError, setDevicesError] = useState('')
  const [devicesLoaded, setDevicesLoaded] = useState(false)

  useEffect(() => {
    if (!account) return
    setForm({
      username:   account.username ?? '',
      platform:   account.platform ?? 'Instagram',
      email:      account.email ?? '',
      brandTag:   account.brandTag ?? '',
      status:     account.status ?? 'active',
      notes:      account.notes ?? '',
      warmingDay: account.warmingDay ?? 0,
      executionEngine: account.executionEngine === 'android' ? 'android' : 'chromium',
      homeDeviceId: account.homeDeviceId ?? '',
    })
    // Reset the picker so every account fetches a fresh Android device list.
    setDevices([])
    setDevicesError('')
    setDevicesLoaded(false)
  }, [account])

  // Devices load lazily and only for Android: server-mode backends answer 501 and the picker just reports it.
  useEffect(() => {
    if (!open || form.executionEngine !== 'android' || devicesLoaded) return
    let cancelled = false
    api.get<{ devices: HomeDevice[] }>('/android/devices')
      .then(({ data }) => { if (!cancelled) { setDevices(data.devices ?? []); setDevicesError('') } })
      .catch((err: any) => { if (!cancelled) setDevicesError(err?.response?.data?.error ?? 'Unable to load Android devices') })
      .finally(() => { if (!cancelled) setDevicesLoaded(true) })
    return () => { cancelled = true }
  }, [open, form.executionEngine, devicesLoaded])

  function set<K extends keyof EditForm>(field: K, value: EditForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const savedEngine: Engine = account?.executionEngine === 'android' ? 'android' : 'chromium'
  const androidHealth = account?.accountHealth ?? account?.androidHealth ?? null
  const androidHealthReason = account?.accountHealthReason ?? account?.androidHealthReason ?? undefined
  const engineChanged = Boolean(account) && form.executionEngine !== savedEngine
  const platformBlocksAndroid = form.executionEngine === 'android' && form.platform !== 'Instagram'
  const homeDeviceMissing = form.executionEngine === 'android' && !form.homeDeviceId
  const deviceChoices: HomeDevice[] = form.homeDeviceId && !devices.some((device) => device.id === form.homeDeviceId)
    ? [{ id: form.homeDeviceId, name: 'Assigned home device (not in current list)', avdName: '', status: 'UNKNOWN' }, ...devices]
    : devices

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!account) return
    if (platformBlocksAndroid) {
      toast.error('Android requires Instagram', 'Android execution is Instagram-only on Windows Local Mode.')
      return
    }
    if (homeDeviceMissing) {
      toast.error('Home device required', 'Pick a registered Android device for this account.')
      return
    }
    setLoading(true)
    try {
      await api.patch(`/accounts/${account.id}`, {
        username:   form.username,
        platform:   form.platform,
        email:      form.email || undefined,
        brandTag:   form.brandTag || undefined,
        status:     form.status,
        notes:      form.notes || undefined,
        warmingDay: form.warmingDay,
        executionEngine: form.executionEngine,
        homeDeviceId: form.executionEngine === 'android' ? form.homeDeviceId : null,
      })
      toast.success('Account updated', `@${form.username} saved${engineChanged ? ` · engine ${form.executionEngine}` : ''}.`)
      onSuccess()
      onClose()
    } catch (err: any) {
      toast.error('Update failed', err?.response?.data?.error ?? 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-purple-400" />
            Edit Account — @{account?.username}
          </DialogTitle>
        </DialogHeader>

        {account && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={savedEngine === 'android' ? 'purple' : 'outline'} className="gap-1">
              {savedEngine === 'android' ? <Smartphone className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {savedEngine === 'android' ? 'Android engine' : 'Chromium engine'}
            </Badge>
            <Badge
              variant={sessionVariant[account.sessionHealth ?? 'UNKNOWN'] ?? 'outline'}
              title={account.sessionHealthReason ?? undefined}
            >
              Session: {account.sessionHealth ?? 'UNKNOWN'}
            </Badge>
            {savedEngine === 'android' && (
              <Badge variant={account.homeDeviceId ? 'secondary' : 'warning'}>
                Home: {account.homeDeviceId
                  ? (devices.find((device) => device.id === account.homeDeviceId)?.name ?? 'assigned device')
                  : 'missing'}
              </Badge>
            )}
            {androidHealth && <Badge variant="info" title={androidHealthReason}>Android: {androidHealth}</Badge>}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Platform + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={(v) => set('platform', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Instagram">
                    <div className="flex items-center gap-2"><Instagram className="h-3.5 w-3.5 text-pink-400" />Instagram</div>
                  </SelectItem>
                  <SelectItem value="TikTok">
                    <div className="flex items-center gap-2"><Music2 className="h-3.5 w-3.5 text-cyan-400" />TikTok</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="warming_up">Warming Up</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Execution engine + home device */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1.5">
              <Label>Execution Engine</Label>
              <Select value={form.executionEngine} onValueChange={(v) => set('executionEngine', v as Engine)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">
                    <div className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-blue-400" />Chromium (browser session)</div>
                  </SelectItem>
                  <SelectItem value="android" disabled={form.platform !== 'Instagram'}>
                    <div className="flex items-center gap-2"><Smartphone className="h-3.5 w-3.5 text-green-400" />Android device{form.platform !== 'Instagram' ? ' (Instagram only)' : ''}</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.executionEngine === 'android' && (
              <div className="space-y-1.5">
                <Label>Home Device</Label>
                {devicesError ? (
                  <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">{devicesError}</p>
                ) : (
                  <Select value={form.homeDeviceId} onValueChange={(v) => set('homeDeviceId', v)} disabled={!devicesLoaded && deviceChoices.length === 0}>
                    <SelectTrigger><SelectValue placeholder={devicesLoaded ? 'Select a registered device' : 'Loading devices…'} /></SelectTrigger>
                    <SelectContent>
                      {deviceChoices.map((device) => (
                        <SelectItem key={device.id} value={device.id} disabled={device.enabled === false}>
                          {device.name}{device.avdName ? ` · ${device.avdName}` : ''} ({device.status}){device.enabled === false ? ' · disabled' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">Android accounts are pinned to one registered home device. Register devices in Android Farm first.</p>
              </div>
            )}

            {platformBlocksAndroid && (
              <p className="rounded border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-400">
                Android execution requires the Instagram platform on Windows Local Mode.
              </p>
            )}

            {engineChanged && (
              <p className="rounded border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-400">
                Engine will change from {savedEngine} to {form.executionEngine} when you save.
              </p>
            )}

            <div className="space-y-1 rounded border border-blue-500/20 bg-blue-500/10 p-2 text-[11px] text-blue-300">
              <p className="font-semibold">Session preservation</p>
              <p>Switching engine keeps the stored browser cookies — the Chromium session is preserved and reusable if you switch back. Nothing is deleted here.</p>
              <p>Android login stays manual: sign in on the device yourself. Cookies are not transferred to Android and Instagram login is never automated.</p>
            </div>
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="@username" required />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="account@email.com" />
          </div>

          {/* Brand Tag + Warming Day */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Brand Tag</Label>
              <Input value={form.brandTag} onChange={(e) => set('brandTag', e.target.value)} placeholder="brand_marmer" />
            </div>
            <div className="space-y-1.5">
              <Label>Warming Day (0-14)</Label>
              <Input
                type="number" min={0} max={14}
                value={form.warmingDay}
                onChange={(e) => set('warmingDay', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Optional notes…" />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="purple" disabled={loading || platformBlocksAndroid || homeDeviceMissing}>{loading ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
