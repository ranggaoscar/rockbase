import { useState } from 'react'
import { Globe } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import api from '@/lib/api'

interface AddProxyModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const init = { host: '', port: '', username: '', password: '', location: '' }

export default function AddProxyModal({ open, onClose, onSuccess }: AddProxyModalProps) {
  const [form, setForm] = useState(init)
  const [loading, setLoading] = useState(false)

  function set(k: keyof typeof init, v: string) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.host || !form.port) { toast.error('Host and port required'); return }
    setLoading(true)
    try {
      await api.post('/proxies', form)
      toast.success('Proxy added', `${form.host}:${form.port}`)
      setForm(init)
      onSuccess()
      onClose()
    } catch (err: any) {
      toast.error('Failed', err?.response?.data?.error ?? 'Could not add proxy')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-cyan-400" /> Add Proxy
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Host / IP</Label>
              <Input placeholder="123.45.67.89" value={form.host} onChange={(e) => set('host', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Port</Label>
              <Input placeholder="8080" type="number" value={form.port} onChange={(e) => set('port', e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input placeholder="proxyuser" value={form.username} onChange={(e) => set('username', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="proxypass" value={form.password} onChange={(e) => set('password', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input placeholder="ID - Jakarta" value={form.location} onChange={(e) => set('location', e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="purple" disabled={loading}>{loading ? 'Adding…' : 'Add Proxy'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
