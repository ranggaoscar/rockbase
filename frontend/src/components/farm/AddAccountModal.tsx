import { useState } from 'react'
import { Plus, Instagram, Music2 } from 'lucide-react'
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

  function set(field: keyof typeof initialForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.platform) {
      toast({ title: 'Username and platform are required', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      await api.post('/accounts', {
        username: form.username.replace('@', ''),
        password: form.password || undefined,
        platform: form.platform,
        email: form.email || undefined,
        proxy: form.proxy || undefined,
        brandTag: form.brandTag || undefined,
        notes: form.notes || undefined,
      })
      toast.success('Account added', `@${form.username} added to the farm.`)
      setForm(initialForm)
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
            <Select value={form.platform} onValueChange={(v) => set('platform', v)}>
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
          </div>

          {/* Email */}
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

          {/* Proxy */}
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
