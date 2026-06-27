import { useEffect, useRef, useState } from 'react'
import {
  SendHorizontal, Upload, X, Instagram, Music2,
  CheckCircle2, XCircle, Clock, RefreshCw, Image, Hash,
  ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn, statusLabel } from '@/lib/utils'
import api from '@/lib/api'

interface Account { id: string; username: string; platform: string; status: string; brandTag?: string }
interface PostResult { accountId: string; username: string; status: 'pending' | 'success' | 'failed'; error?: string }

const MAX_CHARS = { Instagram: 2200, TikTok: 2200 }

export default function Compose() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [caption, setCaption] = useState('')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  const [results, setResults] = useState<PostResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<'all' | 'Instagram' | 'TikTok'>('all')
  const [shouldSpin, setShouldSpin] = useState(true)
  const [previewVariations, setPreviewVariations] = useState<{ caption: string; hashtags: string }[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<{ accounts: Account[] }>('/accounts')
      .then(({ data }) => setAccounts(data.accounts.filter(a => a.status === 'active')))
      .catch(() => toast.error('Failed to load accounts'))
  }, [])

  // ── Media ────────────────────────────────────────────────────
  function handleFiles(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).slice(0, 10)
    setMediaFiles((prev) => [...prev, ...arr].slice(0, 10))
    arr.forEach((f) => {
      const url = URL.createObjectURL(f)
      setMediaPreviews((prev) => [...prev, url].slice(0, 10))
    })
  }

  function removeMedia(i: number) {
    setMediaFiles((prev) => prev.filter((_, j) => j !== i))
    setMediaPreviews((prev) => prev.filter((_, j) => j !== i))
  }

  // ── Selection ─────────────────────────────────────────────────
  const filtered = accounts.filter(a => platformFilter === 'all' || a.platform === platformFilter)
  const allSelected = filtered.length > 0 && filtered.every(a => selected.has(a.id))

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selected)
      filtered.forEach(a => next.delete(a.id))
      setSelected(next)
    } else {
      const next = new Set(selected)
      filtered.forEach(a => next.add(a.id))
      setSelected(next)
    }
  }

  function toggleAccount(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── Post ──────────────────────────────────────────────────────
  async function handlePost() {
    if (!caption.trim()) { toast.error('Caption is required'); return }
    if (selected.size === 0) { toast.error('Select at least one account'); return }
    if (mediaFiles.length === 0) { toast.error('At least one image is required for Instagram'); return }

    setPosting(true)
    setShowResults(true)

    // Init results as pending
    const selectedAccounts = accounts.filter(a => selected.has(a.id))
    const initResults: PostResult[] = selectedAccounts.map(a => ({ accountId: a.id, username: a.username, status: 'pending' }))
    setResults(initResults)

    try {
      const formData = new FormData()
      formData.append('baseCaption', caption)
      formData.append('media', mediaFiles[0]) // Support first image for now
      formData.append('accountIds', JSON.stringify(Array.from(selected)))
      formData.append('spinCaptions', shouldSpin.toString())
      
      // Extract hashtags from caption if any
      const hashtags = caption.match(/#\S+/g) || []
      formData.append('baseHashtags', JSON.stringify(hashtags))

      const { data } = await api.post('/posts/bulk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      toast.success(data.message || `Queued ${selected.size} posts successfully`)
      
      // Mark all as success (meaning queued)
      setResults(prev => prev.map(r => ({ ...r, status: 'success' })))
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Bulk post failed'
      toast.error('Failed', msg)
      setResults(prev => prev.map(r => ({ ...r, status: 'failed', error: msg })))
    } finally {
      setPosting(false)
    }
  }

  async function handlePreview() {
    if (!caption.trim()) { toast.error('Enter a caption first'); return }
    setPreviewLoading(true)
    try {
      const hashtags = caption.match(/#\S+/g) || []
      const { data } = await api.post('/posts/spin-preview', {
        baseCaption: caption,
        baseHashtags: hashtags,
        count: 3
      })
      setPreviewVariations(data.variations)
      setShowPreview(true)
    } catch {
      toast.error('Failed to generate preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function retryFailed() {
    const failed = results.filter(r => r.status === 'failed')
    if (failed.length === 0) return
    setPosting(true)
    for (const r of failed) {
      try {
        await api.post('/posts', { workspaceId: 'default', content: caption, mediaUrls: [], accountIds: [r.accountId] })
        await new Promise(res => setTimeout(res, 600))
        setResults(prev => prev.map(p => p.accountId === r.accountId ? { ...p, status: 'success' } : p))
      } catch { /* keep as failed */ }
    }
    setPosting(false)
    toast.success('Retry complete')
  }

  const successCount = results.filter(r => r.status === 'success').length
  const failCount = results.filter(r => r.status === 'failed').length
  const pendingCount = results.filter(r => r.status === 'pending').length
  const progress = results.length > 0 ? Math.round(((successCount + failCount) / results.length) * 100) : 0

  return (
    <div className="grid gap-4 lg:grid-cols-3">

      {/* ── Left: Composer ──────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SendHorizontal className="h-5 w-5 text-purple-400" /> Compose & Bulk Post
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Post simultaneously to all selected active accounts.
          </p>
        </div>

        {/* Caption editor */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Caption</CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 border border-purple-500/20">
                  <Checkbox
                    id="spin-toggle"
                    checked={shouldSpin}
                    onCheckedChange={(v) => setShouldSpin(!!v)}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor="spin-toggle" className="text-[10px] font-semibold text-purple-400 cursor-pointer flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI SPIN VARIATIONS
                  </Label>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[10px] font-bold"
                  onClick={handlePreview}
                  disabled={previewLoading || !caption.trim()}
                >
                  {previewLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'PREVIEW'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your base caption here… AI will generate slightly different variations for each account to avoid spam detection."
              rows={6}
              className="resize-none text-sm"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex gap-3">
                <span className={cn(caption.length > 2200 && 'text-red-400')}>
                  {caption.length} / 2200 chars
                </span>
                <span>{caption.split(/\s+/).filter(w => w.startsWith('#')).length} hashtags</span>
              </div>
              <button
                className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
                onClick={() => setCaption(caption + '\n\n#marmer #granit #batualam #marmerindonesia #granitindonesia #interiordesign')}
              >
                <Hash className="h-3.5 w-3.5" /> Add niche hashtags
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Media upload */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Image className="h-4 w-4" /> Media
              <span className="font-normal text-muted-foreground">({mediaFiles.length}/10)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mediaPreviews.length === 0 ? (
              <button
                className="w-full rounded-lg border-2 border-dashed border-border hover:border-purple-500/50 transition-colors p-8 flex flex-col items-center gap-2 text-muted-foreground"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-8 w-8 opacity-40" />
                <span className="text-sm">Click to upload images or videos</span>
                <span className="text-xs">JPG, PNG, MP4 · Max 10 files</span>
              </button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {mediaPreviews.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeMedia(i)}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {mediaFiles.length < 10 && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="aspect-square rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-purple-500/50"
                  >
                    <Upload className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </CardContent>
        </Card>

        {/* Post results */}
        {showResults && results.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Post Status</CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-400">{successCount} ✅</span>
                  <span className="text-red-400">{failCount} ❌</span>
                  <span className="text-muted-foreground">{pendingCount} ⏳</span>
                  {failCount > 0 && !posting && (
                    <Button size="sm" variant="outline" onClick={retryFailed} className="h-6 text-xs">
                      <RefreshCw className="h-3 w-3" /> Retry Failed
                    </Button>
                  )}
                </div>
              </div>
              {posting && <Progress value={progress} className="h-1.5 mt-2" />}
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.accountId} className="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-secondary/50">
                    <span className="font-medium">@{r.username}</span>
                    {r.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                    {r.status === 'failed'  && <XCircle     className="h-4 w-4 text-red-400" />}
                    {r.status === 'pending' && <Clock       className="h-4 w-4 text-muted-foreground animate-pulse" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right: Account selector ────────────────────────────── */}
      <div className="space-y-4">
        <Card className="sticky top-20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Select Accounts</CardTitle>
              <span className="text-xs text-purple-400 font-medium">{selected.size} selected</span>
            </div>
            {/* Platform filter */}
            <div className="flex gap-1 mt-2">
              {(['all', 'Instagram', 'TikTok'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    platformFilter === p ? 'bg-purple-600 text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p === 'all' ? 'All' : p === 'Instagram' ? '📸 IG' : '🎵 TK'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Select all */}
            <div className="flex items-center gap-2 pb-2 border-b border-border mb-2">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} id="select-all" />
              <Label htmlFor="select-all" className="text-xs cursor-pointer">Select all ({filtered.length})</Label>
            </div>

            {/* Account list */}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No active accounts</p>
              ) : filtered.map((account) => (
                <div
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
                    selected.has(account.id) ? 'bg-purple-600/10 border border-purple-600/20' : 'hover:bg-secondary'
                  )}
                >
                  <Checkbox checked={selected.has(account.id)} onCheckedChange={() => toggleAccount(account.id)} onClick={e => e.stopPropagation()} />
                  {account.platform === 'Instagram'
                    ? <Instagram className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                    : <Music2    className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  }
                  <span className="text-xs font-medium truncate">@{account.username}</span>
                </div>
              ))}
            </div>

            {/* Post button */}
            <Button
              variant="purple"
              size="lg"
              className="w-full mt-4"
              disabled={posting || selected.size === 0 || !caption.trim()}
              onClick={handlePost}
            >
              {posting
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Posting…</>
                : <><SendHorizontal className="h-4 w-4" /> Post to {selected.size} accounts</>
              }
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Preview Modal ────────────────────────────────────────── */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-400" /> AI Variation Preview
            </DialogTitle>
            <DialogDescription>
              This is how your caption will be spun for different accounts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {previewVariations.map((v, i) => (
              <div key={i} className="p-4 rounded-lg bg-secondary/50 border border-border text-xs space-y-2">
                <p className="font-bold text-purple-400 uppercase tracking-tighter">Variation {i + 1}</p>
                <p className="text-foreground leading-relaxed whitespace-pre-wrap">{v.caption}</p>
                <p className="text-muted-foreground italic mt-2">{v.hashtags}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setShowPreview(false)}>Looks Good</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
