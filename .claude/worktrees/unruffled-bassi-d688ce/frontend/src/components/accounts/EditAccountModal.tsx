import { useEffect, useState } from 'react'
import { Edit2, Instagram, Music2 } from 'lucide-react'
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

interface Account {
  id: string
  username: string
  platform: string
  email?: string
  brandTag?: string
  status: string
  notes?: string
  warmingDay?: number
}

interface EditAccountModalProps {
  account: Account | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function EditAccountModal({ account, open, onClose, onSuccess }: EditAccountModalProps) {
  const [form, setForm] = useState({
    username: '',
    platform: 'Instagram',
    email: '',
    brandTag: '',
    status: 'active',
    notes: '',
    warmingDay: 0,
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (account) {
      setForm({
        username:   account.username ?? '',
        platform:   account.platform ?? 'Instagram',
        email:      account.email ?? '',
        brandTag:   account.brandTag ?? '',
        status:     account.status ?? 'active',
        notes:      account.notes ?? '',
        warmingDay: account.warmingDay ?? 0,
      })
    }
  }, [account])

  function set(field: keyof typeof form, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!account) return
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
      })
      toast.success('Account updated', `@${form.username} saved.`)
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-purple-400" />
            Edit Account — @{account?.username}
          </DialogTitle>
        </DialogHeader>

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
            <Button type="submit" variant="purple" disabled={loading}>{loading ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
