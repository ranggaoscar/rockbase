import { useState } from 'react'
import {
  Sparkles, Instagram, Music2, RefreshCw, Copy, Check,
  Bookmark, BookmarkCheck, Trash2, Hash, Zap, ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────
interface Draft { id: string; caption: string; platform: string; tone: string; topic: string; createdAt: string }

// ── Constants ──────────────────────────────────────────────────────────────
const TONES = [
  { value: 'professional', label: 'Professional', desc: 'Formal & authoritative', emoji: '👔' },
  { value: 'casual',       label: 'Casual',       desc: 'Friendly & relatable',   emoji: '😊' },
  { value: 'viral',        label: 'Viral',         desc: 'Hook-driven & trendy',   emoji: '🔥' },
  { value: 'promotional',  label: 'Promotional',   desc: 'Offer-focused & urgent', emoji: '🎉' },
]

const NICHES = [
  'Marmer & Granit Indonesia',
  'Batu Alam Natural',
  'Interior Design Premium',
  'Lantai Marmer Impor',
  'Granit Tiles Indonesia',
]

const HASHTAG_SETS: Record<string, string[]> = {
  Instagram: ['#marmer','#granit','#batualam','#marmerindonesia','#granitindonesia','#interiordesign','#homedecor','#rumahminimalis','#desainrumah','#marmerputih','#granitlantai','#batualamnatural','#interiorinspiration','#luxuryhome','#homestyle','#renovasirumah','#arsitektur','#designinterior','#rumahidaman','#homedesign','#marmerimport','#granitpremium','#batumalam','#homesweethome','#interiorjakarta','#furnituredesign','#minimalisthome','#modernhome','#premiumstone','#marmerlokal'],
  TikTok: ['#marmer','#granit','#batualam','#fyp','#viral','#fypindonesia','#tiktokindo','#rumahminimalis','#homedesign','#interiordesign','#homedecor','#marmerputih','#granitlantai','#batualamnatural','#marmerindonesia','#renovasirumah','#desainrumah','#rumahidaman','#homeinspo','#luxuryhome','#trendingid','#kontenindonesia','#homevibe','#aesthetic','#homestyle','#bangunanrumah','#arsitektur','#materialrumah','#granitpremium','#premiumstone'],
}

// ── Helpers ────────────────────────────────────────────────────────────────
function shortId() { return Math.random().toString(36).slice(2, 9) }

export default function AIWriter() {
  // Form
  const [topic, setTopic]         = useState('')
  const [platform, setPlatform]   = useState<'Instagram' | 'TikTok'>('Instagram')
  const [tone, setTone]           = useState('casual')
  const [niche, setNiche]         = useState(NICHES[0])
  const [batchMode, setBatchMode] = useState(false)
  const [batchCount, setBatchCount] = useState(7)

  // Results
  const [captions, setCaptions]   = useState<string[]>([])
  const [hashtags, setHashtags]   = useState<string[]>([])
  const [generating, setGenerating] = useState(false)

  // Drafts (localStorage)
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try { return JSON.parse(localStorage.getItem('sc_drafts') || '[]') }
    catch { return [] }
  })
  const [showDrafts, setShowDrafts] = useState(false)

  // Copy tracking
  const [copied, setCopied] = useState<string | null>(null)

  function saveDrafts(next: Draft[]) {
    setDrafts(next)
    localStorage.setItem('sc_drafts', JSON.stringify(next))
  }

  function saveToDraft(caption: string) {
    const draft: Draft = {
      id: shortId(),
      caption,
      platform,
      tone,
      topic,
      createdAt: new Date().toISOString(),
    }
    saveDrafts([draft, ...drafts].slice(0, 50))
    toast.success('Saved to draft library')
  }

  function deleteDraft(id: string) {
    saveDrafts(drafts.filter(d => d.id !== id))
  }

  async function copyText(text: string, id: string) {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
    toast.success('Copied to clipboard')
  }

  async function generate() {
    if (!topic.trim()) { toast.error('Enter a topic first'); return }
    setGenerating(true)
    setCaptions([])
    try {
      if (batchMode) {
        const { data } = await api.post<{ captions: string[]; hashtags: string[] }>('/ai/generate-batch', {
          topic, platform, tone, count: batchCount, niche,
        })
        setCaptions(data.captions || [])
        setHashtags(data.hashtags || HASHTAG_SETS[platform])
      } else {
        const { data } = await api.post<{ captions: Record<string, string>; hashtags: Record<string, string[]> }>('/ai/generate-captions', {
          topic, platforms: [platform], language: 'Indonesian',
        })
        const cap = data.captions?.[platform]
        setCaptions(cap ? [cap] : [])
        setHashtags(data.hashtags?.[platform] || HASHTAG_SETS[platform])
      }
      toast.success('Captions generated!')
    } catch {
      toast.error('Generation failed. Using fallback mode.')
    } finally {
      setGenerating(false)
    }
  }

  const hashtagText = hashtags.join(' ')

  return (
    <div className="grid gap-4 lg:grid-cols-3">

      {/* ── Left: Controls ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" /> AI Writer
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Powered by Gemini · Optimized for Marmer & Granit niche.
          </p>
        </div>

        {/* Topic */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Topic / Produk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Marmer Carrara untuk meja dapur, Granit 60×60 motif kayu, Batu alam untuk dinding eksterior..."
              rows={3}
              className="resize-none text-sm"
            />
          </CardContent>
        </Card>

        {/* Platform */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Platform</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {(['Instagram', 'TikTok'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium border transition-colors',
                    platform === p
                      ? p === 'Instagram' ? 'bg-pink-500/10 border-pink-500/30 text-pink-300' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p === 'Instagram'
                    ? <Instagram className="h-4 w-4" />
                    : <Music2 className="h-4 w-4" />
                  }
                  {p}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tone */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tone</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {TONES.map(t => (
              <button
                key={t.value}
                onClick={() => setTone(t.value)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors border',
                  tone === t.value
                    ? 'bg-purple-600/10 border-purple-600/30 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
                )}
              >
                <span className="text-base">{t.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                </div>
                {tone === t.value && <div className="h-2 w-2 rounded-full bg-purple-500 shrink-0" />}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Niche */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Niche Preset</CardTitle></CardHeader>
          <CardContent>
            <div className="relative">
              <select
                value={niche}
                onChange={e => setNiche(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </CardContent>
        </Card>

        {/* Batch mode */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Batch Mode</p>
                <p className="text-xs text-muted-foreground">Generate multiple captions at once</p>
              </div>
              <button
                onClick={() => setBatchMode(!batchMode)}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors relative',
                  batchMode ? 'bg-purple-600' : 'bg-secondary'
                )}
              >
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', batchMode ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </div>

            {batchMode && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Count: {batchCount} captions</label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={batchCount}
                  onChange={e => setBatchCount(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span><span>20</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          variant="purple"
          size="lg"
          className="w-full"
          onClick={generate}
          disabled={generating || !topic.trim()}
        >
          {generating
            ? <><RefreshCw className="h-4 w-4 animate-spin" /> Generating…</>
            : <><Zap className="h-4 w-4" /> {batchMode ? `Generate ${batchCount} Captions` : 'Generate Caption'}</>
          }
        </Button>
      </div>

      {/* ── Right: Results ──────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">

        {/* Draft library toggle */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {showDrafts ? 'Draft Library' : 'Generated Captions'}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs gap-1.5"
            onClick={() => setShowDrafts(!showDrafts)}
          >
            <Bookmark className="h-3.5 w-3.5" />
            {showDrafts ? 'Back to Results' : `Drafts (${drafts.length})`}
          </Button>
        </div>

        {/* ── Draft Library ──────────────────────────────────────── */}
        {showDrafts ? (
          <div className="space-y-3">
            {drafts.length === 0 ? (
              <Card><CardContent className="flex flex-col items-center py-16 gap-3">
                <BookmarkCheck className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No drafts saved yet.</p>
              </CardContent></Card>
            ) : drafts.map(draft => (
              <Card key={draft.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant={draft.platform === 'Instagram' ? 'default' : 'secondary'} className="text-[10px]">
                        {draft.platform === 'Instagram' ? '📸' : '🎵'} {draft.platform}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{draft.tone}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(draft.createdAt).toLocaleDateString('id-ID')}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => copyText(draft.caption, `d-${draft.id}`)}>
                        {copied === `d-${draft.id}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => deleteDraft(draft.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{draft.caption}</p>
                  {draft.topic && <p className="text-xs text-muted-foreground">Topic: {draft.topic}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Empty state */}
            {captions.length === 0 && !generating && (
              <Card>
                <CardContent className="flex flex-col items-center py-20 gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-purple-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">AI Caption Generator</p>
                    <p className="text-sm text-muted-foreground mt-1">Enter a topic and click Generate</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground max-w-xs">
                    {[
                      'Marmer Carrara impor',
                      'Granit anti-slip kamar mandi',
                      'Batu alam dinding eksterior',
                      'Promo akhir tahun marmer',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => setTopic(s)}
                        className="rounded-lg border border-border px-2 py-1.5 hover:border-purple-500/50 hover:text-foreground transition-colors text-left"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Generating skeleton */}
            {generating && (
              <div className="space-y-3">
                {Array.from({ length: batchMode ? Math.min(batchCount, 3) : 1 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-20 rounded bg-secondary animate-pulse" />
                        <div className="h-5 w-16 rounded bg-secondary animate-pulse" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-3 rounded bg-secondary animate-pulse" />
                        <div className="h-3 w-4/5 rounded bg-secondary animate-pulse" />
                        <div className="h-3 w-3/5 rounded bg-secondary animate-pulse" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
                  <RefreshCw className="h-4 w-4 animate-spin text-purple-400" />
                  Generating with Gemini AI…
                </div>
              </div>
            )}

            {/* Caption results */}
            {!generating && captions.length > 0 && (
              <div className="space-y-3">
                {captions.map((cap, i) => (
                  <Card key={i} className="hover:border-purple-500/20 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {platform === 'Instagram' ? '📸' : '🎵'} {platform}
                          </Badge>
                          {batchMode && (
                            <span className="text-xs text-muted-foreground">#{i + 1}</span>
                          )}
                          <Badge variant="secondary" className="text-[10px] capitalize">{tone}</Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Save to drafts"
                            onClick={() => saveToDraft(cap)}>
                            <Bookmark className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy"
                            onClick={() => copyText(cap, `cap-${i}`)}>
                            {copied === `cap-${i}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{cap}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{cap.length} chars</span>
                        <span>·</span>
                        <span>{cap.split(/\s+/).filter(w => w.startsWith('#')).length} hashtags inline</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Hashtag bank */}
            {hashtags.length > 0 && !generating && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Hash className="h-4 w-4 text-purple-400" /> Hashtag Bank
                      <Badge variant="secondary" className="text-[10px]">{hashtags.length} tags</Badge>
                    </CardTitle>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                      onClick={() => copyText(hashtagText, 'hashtags')}>
                      {copied === 'hashtags' ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                      Copy All
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {hashtags.map((tag, i) => (
                      <button
                        key={i}
                        onClick={() => copyText(tag, `tag-${i}`)}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium transition-colors border',
                          copied === `tag-${i}`
                            ? 'bg-green-500/10 border-green-500/30 text-green-400'
                            : 'bg-secondary border-transparent text-purple-400 hover:border-purple-500/30 hover:bg-purple-500/10'
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{hashtagText.length} chars total · Click any tag to copy</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
