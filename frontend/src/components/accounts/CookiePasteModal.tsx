import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/use-toast'
import { Cookie, CheckCircle2, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { accountsApi } from '@/lib/api'

interface Account {
  id: string
  username: string
  platform: string
}

interface CookiePasteModalProps {
  account: Account | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const INSTRUCTIONS = `📖 Cara Export Cookies dari Chrome:

1. Buka Instagram.com / TikTok.com — login ke akun
2. Buka DevTools (F12) → tab Application (atau Storage)
3. Klik Cookies → pilih domain (instagram.com / tiktok.com)
4. Klik kanan salah satu cookie → "Show all" → Ctrl+A → Ctrl+C
   ATAU install extension "EditThisCookie" → klik 🍪 → Export
5. Paste hasilnya di kolom bawah

💡 Format yang didukung:
• JSON array: [{"name":"sessionid","value":"abc123",...}]
• String: sessionid=abc123; csrftoken=xyz789;
• Export dari EditThisCookie`

export default function CookiePasteModal({ account, open, onClose, onSuccess }: CookiePasteModalProps) {
  const [cookiesText, setCookiesText] = useState('')
  const [importing, setImporting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)

  if (!account) return null

  async function handleImport() {
    const text = cookiesText.trim()
    if (!text) {
      toast.error('Please paste your cookies first')
      return
    }

    setImporting(true)
    try {
      // Try parsing as JSON
      let cookiesPayload: any = text
      try {
        const parsed = JSON.parse(text)
        cookiesPayload = parsed
      } catch {
        // Plain string — send as-is
        cookiesPayload = text
      }

      const { data } = await accountsApi.importCookies(account.id, cookiesPayload)

      if (data.success) {
        setSuccess(true)
        toast.success(`✅ Cookies imported for @${account.username}`)
        onSuccess()
      }
    } catch (err: any) {
      toast.error('Failed to import cookies', err?.response?.data?.error || err.message)
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setCookiesText('')
    setSuccess(false)
    setShowInstructions(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5 text-purple-400" />
            Import Cookies — @{account.username}
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-3" />
            <p className="text-lg font-bold text-green-300">Cookies Imported!</p>
            <p className="text-sm text-muted-foreground mt-1">
              @{account.username} is now <strong>ACTIVE</strong> and <strong>HEALTHY</strong>.
              No Playwright needed — ready for warming & posting.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Info banner */}
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-300">
              <p className="font-semibold">✨ No Playwright required!</p>
              <p className="mt-0.5">
                Paste cookies directly from your browser. Account will be marked ACTIVE immediately.
              </p>
            </div>

            {/* Instructions toggle */}
            <button
              type="button"
              onClick={() => setShowInstructions(!showInstructions)}
              className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              {showInstructions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showInstructions ? 'Hide instructions' : 'Show export instructions'}
            </button>

            {showInstructions && (
              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-sans leading-relaxed">
                  {INSTRUCTIONS}
                </pre>
              </div>
            )}

            {/* Cookie textarea */}
            <Textarea
              placeholder={`Paste your cookies here...\n\nExample JSON:\n[{"name":"sessionid","value":"abc123","domain":".instagram.com"},...]`}
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              className="min-h-[180px] font-mono text-xs"
            />

            {/* Tips */}
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-300">
              <p>💡 Cookies disimpan terenkripsi (AES-256). Pastikan cookies masih fresh sebelum import.</p>
            </div>

            {/* Action */}
            <div className="flex justify-end">
              <Button
                variant="purple"
                size="sm"
                disabled={!cookiesText.trim() || importing}
                onClick={handleImport}
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Cookie className="h-3.5 w-3.5 mr-1" />
                )}
                Import Cookies
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {success ? 'Done' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
