import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, Copy, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import { accountsApi } from '@/lib/api'

interface Account {
  id: string;
  username: string;
  platform: string;
  sessionHealth?: string | null;
}

interface LoginHelperModalProps {
  account: Account | null;
  open: boolean;
  onClose: () => void;
}

export default function LoginHelperModal({ account, open, onClose }: LoginHelperModalProps) {
  const [credentials, setCredentials] = useState<{ username?: string; email?: string; password?: string }>({})
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (open && account) {
      const currentAccount = account;
      async function fetchCredentials() {
        setLoading(true);
        try {
          const { data } = await accountsApi.getCredentials(currentAccount.id);
          setCredentials(data);
        } catch (error) {
          toast.error('Failed to load credentials.');
        } finally {
          setLoading(false);
        }
      }
      fetchCredentials();
    } else {
      setCredentials({});
    }
  }, [account, open]);

  const copyToClipboard = (text: string | undefined, label: string) => {
    if (text) {
      navigator.clipboard.writeText(text)
      toast.success(`${label} copied to clipboard!`)
    } else {
      toast.error(`No ${label} to copy.`)
    }
  }

  if (!account) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manual Login Helper for @{account.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-300">
            <p className="font-bold">Login tetap manual</p>
            <p className="text-xs mt-1">
              ROCK BASE hanya membantu copy credential, tidak mengisi atau submit otomatis.
            </p>
          </div>

          {account.sessionHealth === 'HEALTHY' && (
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-300">
              <p className="font-bold">Session sudah sehat, tidak perlu login ulang.</p>
            </div>
          )}

          {account.platform === 'TikTok' && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-300">
              <p className="font-bold">TikTok disimpan sebagai akun data. Automation TikTok belum aktif.</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-24">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Username</label>
                <div className="flex gap-2">
                  <Input readOnly value={credentials.username || ''} className="bg-secondary/50" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(credentials.username, 'Username')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <div className="flex gap-2">
                  <Input readOnly value={credentials.email || 'n/a'} className="bg-secondary/50" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(credentials.email, 'Email')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <div className="flex gap-2">
                  <Input readOnly type={showPassword ? 'text' : 'password'} value={credentials.password || ''} className="bg-secondary/50" />
                  <Button variant="outline" size="icon" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(credentials.password, 'Password')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
