import { useState } from 'react'
import { Upload, AlertCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import api from '@/lib/api'

interface BulkImportModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const EXAMPLE = `103.108.177.12:8080:user1:pass1
45.77.142.98:3128:user2:pass2
202.149.54.111:8000:user3:pass3`

export default function BulkImportModal({ open, onClose, onSuccess }: BulkImportModalProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  const lineCount = text.trim().split('\n').filter(l => l.trim() && l.includes(':')).length

  async function handleImport() {
    if (!text.trim()) return
    setLoading(true)
    try {
      const { data } = await api.post<{ count: number }>('/proxies/bulk', { lines: text })
      toast.success(`Imported ${data.count} proxies`)
      setText('')
      onSuccess()
      onClose()
    } catch (err: any) {
      toast.error('Import failed', err?.response?.data?.error ?? 'Please check the format')
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-cyan-400" /> Bulk Import Proxies
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-secondary/50 border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Format: <code className="text-foreground">host:port:username:password</code> (one per line)
            </p>
            <pre className="text-[11px] text-foreground/60">{EXAMPLE}</pre>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste proxies here, one per line…"
            rows={8}
            className="font-mono text-xs"
          />
          {text && lineCount === 0 && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" /> No valid proxy lines detected
            </div>
          )}
          {lineCount > 0 && (
            <p className="text-xs text-muted-foreground">{lineCount} valid proxies ready to import</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="purple" disabled={lineCount === 0 || loading} onClick={handleImport}>
            {loading ? 'Importing…' : `Import ${lineCount} Proxies`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
