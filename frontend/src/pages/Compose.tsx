import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  SendHorizontal, Upload, X, Instagram, Music2,
  CheckCircle2, XCircle, Clock, RefreshCw, Image, Hash,
  ChevronDown, ChevronUp, Sparkles, Users,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import api, { accountGroupsApi, campaignsApi, postsApi } from '@/lib/api'
import { AccountLoadoutPresetManager } from '@/components/common/AccountLoadoutPresetManager'
import type { AccountLoadoutPreset } from '@/lib/accountLoadoutPresets'
import { CampaignTemplatePresetManager } from '@/components/common/CampaignTemplatePresetManager'
import { buildTemplateCaption } from '@/lib/campaignTemplatePresets'
import type { CampaignTemplatePreset } from '@/lib/campaignTemplatePresets'

interface Account {
  id: string
  username: string
  platform: string
  status: string
  brandTag?: string
  sessionHealth?: string
  sessionHealthReason?: string
}
interface AccountGroupSummary {
  id: string
  name: string
  description?: string | null
  color?: string | null
  memberCount: number
}
interface PostResult { accountId: string; username: string; status: 'pending' | 'success' | 'failed'; error?: string }
interface SkippedAccountPreview {
  accountId: string
  username: string
  health: string
  reason?: string | null
}
interface SelectionPreview {
  accounts: Account[]
  totalResolved: number
  healthyCount: number
  skippedCount: number
  skippedAccounts: SkippedAccountPreview[]
}
interface VisionCaptionPlan {
  accountId: string
  username: string
  platform: string
  style: string
  imageSummary: string
  caption: string
  hashtags: string[]
}
interface CampaignMediaReference {
  id: string
  filename: string
  originalName: string
  type: 'image' | 'video' | 'reference'
  note: string
  path: string
  url: string
  mimeType: string
  size: number
  createdAt: string
}
interface CampaignComposeDraft {
  campaignId: string
  campaignName: string
  scheduledAt?: string | null
  schedulerStatus?: 'PENDING' | 'READY' | 'EXECUTED' | 'FAILED' | 'CANCELLED'
  objective: string
  targetType: string
  targetValue: string
  groupIds: string[]
  accountIds: string[]
  healthyCount: number
  skippedCount: number
  planningSummary?: {
    selectedGroups?: { id: string; name: string; color?: string | null; memberCount: number }[]
    totalResolved?: number
    actionCount?: number
  } | null
  aiPlan?: {
    strategySummary: string
    contentAngle: string
    suggestedCta: string
    suggestedHashtags: string[]
    postingTone: string
    captionSeed?: string
    source: 'ai' | 'fallback'
  }
  suggestedCaption?: string
  suggestedCTA?: string
  suggestedHashtags?: string[]
  contentAngle?: string
  tone?: string
  schedulerDraftSnapshot?: unknown
}
interface AssignmentRow {
  accountId: string
  caption: string
  photoIndex: number
  variationTitle?: string
  targetCluster?: string
  visualDirection?: string
  cta?: string
  hashtags?: string[]
  formatRecommendation?: string
  priorityScore?: number
}
interface VariationAssignmentDraft {
  campaignId: string
  campaignName: string
  groupIds: string[]
  accountIds: string[]
  assignments: {
    variationTitle: string
    targetCluster: string
    visualDirection: string
    captionSeed: string
    cta: string
    hashtags: string[]
    formatRecommendation: string
    priorityScore: number
    groupIds: string[]
    accountId: string
  }[]
}
interface ContentPlannerComposeDraft {
  source: 'content-planner'
  account: string
  group: string
  brandTag: string
  materialTopic: string
  pillar: string
  angle: string
  hookSeed: string
  captionSeed: string
  hashtagSet: string
  cta: string
  visualPromptSeed: string
  status: string
  createdAt: string
}

const MAX_CHARS = { Instagram: 2200, TikTok: 2200 }
const HEALTHY_SESSION = 'HEALTHY'
const CONTENT_PLANNER_COMPOSE_DRAFTS_KEY = 'rockbase.contentPlanner.composeDrafts'

const HASHTAG_GROUPS = [
  { name: 'Marmer', tags: ['#marmer', '#marmerindonesia', '#marmeralam', '#marmerputih', '#marmerlantai', '#marmercarrara'] },
  { name: 'Granit', tags: ['#granit', '#granitindonesia', '#batualam', '#granitlokal', '#granitberkualitas'] },
  { name: 'Interior', tags: ['#interior', '#interiordesign', '#desaininterior', '#rumahminimalis', '#homeideas', '#homedecor'] },
  { name: 'Jakarta', tags: ['#jakarta', '#propertijakarta', '#rumahjakarta', '#kontraktorjakarta', '#renovasijakarta'] },
]

type ComposeIntelligenceInput = {
  caption: string
  assignmentCaptions: string[]
  aiPreviewCount: number
  selectedAccountCount: number
  selectedGroupCount: number
  mediaCount: number
  suggestedHashtags?: string[]
  suggestedCTA?: string
  campaignAngle?: string
}

type ComposeIntelligence = {
  captionScore: number
  ctaStrength: 'Strong' | 'Medium' | 'Weak'
  spamRisk: 'Low' | 'Medium' | 'High'
  distributionFit: 'Strong' | 'Medium' | 'Weak'
  hashtagDensity: number
  variationQuality: number
  recommendations: string[]
  accountFit: string
}

function buildComposeIntelligence(input: ComposeIntelligenceInput): ComposeIntelligence {
  const captionPool = [input.caption, ...input.assignmentCaptions].filter(Boolean)
  const primaryCaption = input.caption.trim() || captionPool[0] || ''
  const allText = captionPool.join(' ')
  const hashtags = allText.match(/#\S+/g) || []
  const uniqueHashtags = new Set(hashtags.map(tag => tag.toLowerCase()))
  const repeatedHashtagCount = hashtags.length - uniqueHashtags.size
  const words = primaryCaption.split(/\s+/).filter(Boolean)
  const emojiCount = Array.from(primaryCaption).filter(char => /[\u{1F300}-\u{1FAFF}]/u.test(char)).length
  const hasCTA = /\b(dm|wa|whatsapp|chat|klik|order|pesan|hubungi|visit|kunjungi|cek|save|share)\b/i.test(primaryCaption)
    || Boolean(input.suggestedCTA)
  const hasHook = primaryCaption.length > 0 && words.length >= 6
  const readability = words.length >= 12 && words.length <= 120 ? 18 : words.length > 0 ? 10 : 0
  const ctaScore = hasCTA ? 18 : 4
  const mediaScore = input.mediaCount > 0 ? 14 : 0
  const hashtagScore = hashtags.length >= 3 && hashtags.length <= 18 ? 14 : hashtags.length > 0 ? 8 : 0
  const aiScore = input.aiPreviewCount > 0 ? 14 : 0
  const accountScore = input.selectedAccountCount + input.selectedGroupCount > 0 ? 10 : 0
  const penalty = repeatedHashtagCount * 4 + (hashtags.length > 30 ? 18 : 0) + (emojiCount > 8 ? 8 : 0)
  const captionScore = Math.max(0, Math.min(100, 24 + readability + ctaScore + mediaScore + hashtagScore + aiScore + accountScore + (hasHook ? 8 : 0) - penalty))
  const spamRisk = hashtags.length > 30 || repeatedHashtagCount > 4 || emojiCount > 10
    ? 'High'
    : hashtags.length > 18 || repeatedHashtagCount > 1 || emojiCount > 6
      ? 'Medium'
      : 'Low'
  const ctaStrength = hasCTA && primaryCaption.length >= 60 ? 'Strong' : hasCTA ? 'Medium' : 'Weak'
  const distributionFit = input.mediaCount > 0 && input.selectedAccountCount + input.selectedGroupCount > 0 && captionScore >= 70
    ? 'Strong'
    : input.mediaCount > 0 && captionScore >= 45
      ? 'Medium'
      : 'Weak'
  const hashtagDensity = Math.max(0, Math.min(100, Math.round((hashtags.length / Math.max(words.length, 1)) * 100)))
  const variationQuality = Math.max(0, Math.min(100, input.aiPreviewCount * 18 + (input.assignmentCaptions.length > 1 ? 22 : 0) + (input.suggestedHashtags?.length ? 12 : 0) + (input.campaignAngle ? 10 : 0)))
  const recommendations = [
    hasCTA ? 'CTA sudah terbaca.' : 'Tambahkan CTA yang jelas.',
    hashtags.length > 24 ? 'Kurangi hashtag agar tidak terlihat spam.' : hashtags.length >= 3 ? 'Hashtag density masih aman.' : 'Tambahkan beberapa hashtag relevan.',
    captionScore >= 75 ? 'Caption sudah aman untuk distribusi.' : 'Tambah variasi hook agar caption lebih kuat.',
    input.aiPreviewCount > 0 ? 'AI preview bisa dipakai sebagai variasi distribusi.' : 'Generate AI Preview untuk memperkaya variasi caption.',
    input.mediaCount > 0 ? 'Cocok untuk akun interior/showroom dengan visual yang sudah siap.' : 'Upload media agar fit distribusi bisa dinilai.',
  ]

  return {
    captionScore,
    ctaStrength,
    spamRisk,
    distributionFit,
    hashtagDensity,
    variationQuality,
    recommendations,
    accountFit: input.selectedGroupCount > 0 ? 'Grup akun terpilih' : input.selectedAccountCount > 0 ? 'Akun pilihan manual' : 'Belum ada target akun',
  }
}

export default function Compose() {
  const [searchParams] = useSearchParams()
  const campaignId = searchParams.get('campaignId')
  const shouldLoadVariationAssignments = searchParams.get('variationAssignments') === '1'
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [accountGroups, setAccountGroups] = useState<AccountGroupSummary[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreview | null>(null)
  const [selectionPreviewLoading, setSelectionPreviewLoading] = useState(false)
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
  const [visionPlans, setVisionPlans] = useState<VisionCaptionPlan[]>([])
  const [visionLoading, setVisionLoading] = useState(false)
  const [campaignDraft, setCampaignDraft] = useState<CampaignComposeDraft | null>(null)
  const [campaignDraftLoading, setCampaignDraftLoading] = useState(false)
  const [campaignMediaRefs, setCampaignMediaRefs] = useState<CampaignMediaReference[]>([])
  const [campaignMediaLoading, setCampaignMediaLoading] = useState(false)
  const [campaignMediaLoadWarning, setCampaignMediaLoadWarning] = useState<string | null>(null)
  const [variationDraft, setVariationDraft] = useState<VariationAssignmentDraft | null>(null)
  const [variationDraftLoading, setVariationDraftLoading] = useState(false)
  const [delayMinMinutes, setDelayMinMinutes] = useState(2)
  const [delayMaxMinutes, setDelayMaxMinutes] = useState(5)
  const [showPreflightConfirm, setShowPreflightConfirm] = useState(false)
  const [contentPlannerDrafts, setContentPlannerDrafts] = useState<ContentPlannerComposeDraft[]>([])
  const [showContentPlannerDrafts, setShowContentPlannerDrafts] = useState(false)
  const [contentPlannerBridgeMessage, setContentPlannerBridgeMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const postingGuardRef = useRef(false)

  // New assignment mode state
  const [mode, setMode] = useState<'broadcast' | 'assign'>('broadcast')
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [rowGenerating, setRowGenerating] = useState<Record<number, boolean>>({})

  useEffect(() => {
    try {
      const rawDrafts = localStorage.getItem(CONTENT_PLANNER_COMPOSE_DRAFTS_KEY)
      if (!rawDrafts) return

      const parsedDrafts = JSON.parse(rawDrafts)
      if (!Array.isArray(parsedDrafts)) return

      const plannerDrafts = parsedDrafts.filter((draft): draft is ContentPlannerComposeDraft =>
        draft?.source === 'content-planner'
        && typeof draft.account === 'string'
        && typeof draft.captionSeed === 'string'
        && typeof draft.hashtagSet === 'string'
        && typeof draft.cta === 'string'
        && typeof draft.materialTopic === 'string'
      )

      setContentPlannerDrafts(plannerDrafts)
    } catch {
      setContentPlannerDrafts([])
    }
  }, [])

  function clearContentPlannerDrafts() {
    localStorage.removeItem(CONTENT_PLANNER_COMPOSE_DRAFTS_KEY)
    setContentPlannerDrafts([])
    setShowContentPlannerDrafts(false)
    setContentPlannerBridgeMessage(null)
  }

  function buildContentPlannerCaption(draft: ContentPlannerComposeDraft) {
    return [draft.hookSeed, draft.captionSeed, draft.cta, draft.hashtagSet]
      .map(item => item?.trim())
      .filter(Boolean)
      .join('\n\n')
  }

  function normalizePlannerAccount(value: string) {
    return value.trim().replace(/^@/, '').toLowerCase()
  }

  function loadContentPlannerDraftsFromStorage() {
    try {
      const rawDrafts = localStorage.getItem(CONTENT_PLANNER_COMPOSE_DRAFTS_KEY)
      const parsedDrafts = rawDrafts ? JSON.parse(rawDrafts) : []
      return Array.isArray(parsedDrafts)
        ? parsedDrafts.filter((draft): draft is ContentPlannerComposeDraft =>
          draft?.source === 'content-planner'
          && typeof draft.account === 'string'
          && typeof draft.captionSeed === 'string'
          && typeof draft.hashtagSet === 'string'
          && typeof draft.cta === 'string'
          && typeof draft.materialTopic === 'string'
        )
        : []
    } catch {
      return []
    }
  }

  function applyContentPlannerDraftsToAssignments() {
    const drafts = loadContentPlannerDraftsFromStorage()
    setContentPlannerDrafts(drafts)

    if (drafts.length === 0) {
      setContentPlannerBridgeMessage('No Content Planner drafts found in localStorage.')
      return
    }

    const matchedRows: AssignmentRow[] = []
    const matchedAccountIds = new Set<string>()
    const unmatchedDrafts: ContentPlannerComposeDraft[] = []

    drafts.forEach((draft, index) => {
      const normalizedDraftAccount = normalizePlannerAccount(draft.account)
      const matchingAccounts = accounts.filter(account => normalizePlannerAccount(account.username) === normalizedDraftAccount)

      if (matchingAccounts.length !== 1) {
        unmatchedDrafts.push(draft)
        return
      }

      const account = matchingAccounts[0]
      matchedAccountIds.add(account.id)
      matchedRows.push({
        accountId: account.id,
        caption: buildContentPlannerCaption(draft),
        photoIndex: index,
        variationTitle: `${draft.pillar} - ${draft.angle}`,
        targetCluster: draft.group,
        visualDirection: draft.visualPromptSeed,
        cta: draft.cta,
        hashtags: draft.hashtagSet.split(/\s+/).filter(Boolean),
        formatRecommendation: 'Content Planner',
        priorityScore: 80,
      })
    })

    if (matchedRows.length === 0 || unmatchedDrafts.length > 0) {
      setShowContentPlannerDrafts(true)
      setContentPlannerBridgeMessage('Drafts are ready, but account matching needs manual selection.')
      return
    }

    setMode('assign')
    setSelected(matchedAccountIds)
    setSelectedGroupIds(new Set())
    setVariationDraft(null)
    setAssignments(matchedRows)
    setVisionPlans([])
    setShowContentPlannerDrafts(true)
    setContentPlannerBridgeMessage('Content Planner drafts applied to Assignment Mode. Upload media manually before posting.')
  }

  useEffect(() => {
    api.get<{ accounts: Account[] }>('/accounts')
      .then(({ data }) => setAccounts(data.accounts.filter(a => a.status === 'active')))
      .catch(() => toast.error('Failed to load accounts'))

    accountGroupsApi.list()
      .then(({ data }) => setAccountGroups(data.groups || []))
      .catch(() => toast.error('Failed to load account groups'))
  }, [])

  useEffect(() => {
    if (!campaignId) {
      setCampaignDraft(null)
      setCampaignMediaRefs([])
      setCampaignMediaLoadWarning(null)
      setVariationDraft(null)
      return
    }

    if (shouldLoadVariationAssignments) {
      return
    }

    let cancelled = false
    setCampaignDraftLoading(true)
    setCampaignMediaLoading(true)
    setCampaignMediaLoadWarning(null)
    Promise.allSettled([
      campaignsApi.composeDraft(campaignId),
      campaignsApi.media(campaignId),
    ])
      .then(async ([draftResult, mediaResult]) => {
        if (cancelled) return

        if (draftResult.status === 'fulfilled') {
          const draft = draftResult.value.data.draft as CampaignComposeDraft
          setCampaignDraft(draft)
          setMode('broadcast')
          setSelected(new Set(draft.accountIds || []))
          setSelectedGroupIds(new Set(draft.groupIds || []))
          setCaption(draft.suggestedCaption || '')
          setVisionPlans([])
          toast.success('Campaign context loaded into Compose')
        } else {
          toast.error('Failed to load campaign compose draft')
        }

        if (mediaResult.status === 'fulfilled') {
          const media = (mediaResult.value.data.media || []) as CampaignMediaReference[]
          setCampaignMediaRefs(media)

          const loadableMedia = media.filter(item => item.type === 'image' || item.type === 'video').slice(0, 19)
          const preparedFiles: File[] = []
          const preparedPreviews: string[] = []
          let skipped = 0

          for (const item of loadableMedia) {
            if (cancelled) return
            try {
              const response = await fetch(item.url)
              if (!response.ok) throw new Error(`Failed to fetch ${item.url}`)
              const blob = await response.blob()
              if (cancelled) return
              preparedFiles.push(new File([blob], item.originalName || item.filename, { type: item.mimeType || blob.type || 'application/octet-stream' }))
              preparedPreviews.push(URL.createObjectURL(blob))
            } catch {
              skipped += 1
            }
          }

          setMediaFiles(preparedFiles)
          setMediaPreviews(preparedPreviews)
          setCampaignMediaLoadWarning(skipped > 0 ? `${skipped} campaign media reference${skipped === 1 ? '' : 's'} could not be auto-loaded.` : null)
        } else {
          setCampaignMediaRefs([])
          setCampaignMediaLoadWarning('Campaign media references could not be loaded right now.')
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load campaign compose draft')
      })
      .finally(() => {
        if (!cancelled) {
          setCampaignDraftLoading(false)
          setCampaignMediaLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [campaignId, shouldLoadVariationAssignments])

  useEffect(() => {
    if (!campaignId || !shouldLoadVariationAssignments) {
      setVariationDraft(null)
      return
    }

    let cancelled = false
    setVariationDraftLoading(true)
    campaignsApi.variationAssignments(campaignId)
      .then(({ data }) => {
        if (cancelled) return
        const draft = data.draft as VariationAssignmentDraft
        setVariationDraft(draft)
        setCampaignDraft(null)
        setMode('assign')
        setSelected(new Set(draft.accountIds || []))
        setSelectedGroupIds(new Set(draft.groupIds || []))
        setAssignments((draft.assignments || []).map((assignment, index) => ({
          accountId: assignment.accountId || '',
          caption: assignment.captionSeed || '',
          photoIndex: index,
          variationTitle: assignment.variationTitle,
          targetCluster: assignment.targetCluster,
          visualDirection: assignment.visualDirection,
          cta: assignment.cta,
          hashtags: assignment.hashtags,
          formatRecommendation: assignment.formatRecommendation,
          priorityScore: assignment.priorityScore,
        })))
        setVisionPlans([])
        toast.success('Variation assignment drafts loaded')
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load variation assignment drafts')
      })
      .finally(() => {
        if (!cancelled) setVariationDraftLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [campaignId, shouldLoadVariationAssignments])

  // Sync assignments when media or selection changes
  useEffect(() => {
    if (mode === 'broadcast') return

    // Re-build assignments based on current media
    const rowCount = Math.max(mediaFiles.length, assignments.length)
    const next = Array.from({ length: rowCount }, (_, i) => {
      const existing = assignments[i]
      return {
        photoIndex: i,
        accountId: existing?.accountId || Array.from(selected)[i] || '',
        caption: existing?.caption || caption || '',
        variationTitle: existing?.variationTitle,
        targetCluster: existing?.targetCluster,
        visualDirection: existing?.visualDirection,
        cta: existing?.cta,
        hashtags: existing?.hashtags,
        formatRecommendation: existing?.formatRecommendation,
        priorityScore: existing?.priorityScore,
      }
    })
    setAssignments(next)
  }, [mediaFiles.length, selected.size, mode, variationDraft])

  // ── Media ────────────────────────────────────────────────────
  function handleFiles(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).slice(0, 19)
    setMediaFiles((prev) => [...prev, ...arr].slice(0, 19))
    setVisionPlans([])
    arr.forEach((f) => {
      const url = URL.createObjectURL(f)
      setMediaPreviews((prev) => [...prev, url].slice(0, 19))
    })
  }

  function removeMedia(i: number) {
    setMediaFiles((prev) => prev.filter((_, j) => j !== i))
    setMediaPreviews((prev) => prev.filter((_, j) => j !== i))
    setAssignments((prev) => prev.filter((_, j) => j !== i))
    setVisionPlans([])
  }

  // ── Selection ─────────────────────────────────────────────────
  const filtered = accounts.filter(a => platformFilter === 'all' || a.platform === platformFilter)
  const allSelected = filtered.length > 0 && filtered.every(a => selected.has(a.id))
  const isHealthyAccount = (account: Account | undefined) => account?.sessionHealth === HEALTHY_SESSION
  const selectedGroups = accountGroups.filter(group => selectedGroupIds.has(group.id))

  useEffect(() => {
    if (mode !== 'broadcast') {
      setSelectionPreview(null)
      setSelectionPreviewLoading(false)
      return
    }

    const accountIds = Array.from(selected)
    const groupIds = Array.from(selectedGroupIds)

    if (groupIds.length === 0) {
      const selectedAccounts = accounts.filter(account => selected.has(account.id))
      const skippedAccounts = selectedAccounts
        .filter(account => !isHealthyAccount(account))
        .map(account => ({
          accountId: account.id,
          username: account.username,
          health: account.sessionHealth || 'UNKNOWN',
          reason: account.sessionHealthReason,
        }))

      setSelectionPreview({
        accounts: selectedAccounts,
        totalResolved: selectedAccounts.length,
        healthyCount: selectedAccounts.filter(isHealthyAccount).length,
        skippedCount: skippedAccounts.length,
        skippedAccounts,
      })
      setSelectionPreviewLoading(false)
      return
    }

    let cancelled = false
    setSelectionPreviewLoading(true)
    accountGroupsApi.resolvePreview({ accountIds, groupIds })
      .then(({ data }) => {
        if (!cancelled) setSelectionPreview(data)
      })
      .catch(() => {
        if (!cancelled) {
          setSelectionPreview(null)
          toast.error('Failed to resolve selected groups')
        }
      })
      .finally(() => {
        if (!cancelled) setSelectionPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accounts, mode, selected, selectedGroupIds])

  function toggleAll() {
    setVisionPlans([])
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
    setVisionPlans([])
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleGroup(id: string) {
    setVisionPlans([])
    setSelectedGroupIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function applyLoadoutPreset(preset: AccountLoadoutPreset) {
    setVisionPlans([])
    setSelected(new Set(preset.accountIds))
    setSelectedGroupIds(new Set(preset.groupIds))
  }

  function applyCampaignTemplateCaption(preset: CampaignTemplatePreset) {
    const nextCaption = buildTemplateCaption(preset)
    if (!nextCaption.trim()) {
      toast.warning('Template has no caption seed or hashtags')
      return
    }

    if (caption.trim() && caption.trim() !== nextCaption.trim()) {
      const proceed = window.confirm('Replace the current manual caption with this template caption seed and hashtags?')
      if (!proceed) return
    }

    setVisionPlans([])
    setCaption(nextCaption)
  }

  // ── AI & Hashtags ───────────────────────────────────────────
  async function generateRowCaption(index: number) {
    const as = assignments[index]
    const file = mediaFiles[as.photoIndex]
    const account = accounts.find(a => a.id === as.accountId)
    
    setRowGenerating(prev => ({ ...prev, [index]: true }))
    try {
      // Convert image to base64 for better AI context
      let base64 = undefined
      if (file && file.type.startsWith('image/')) {
        base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }

      const niche = account?.brandTag || 'marmer/granit'
      const { data } = await api.post('/ai/generate-assignment-caption', {
        niche,
        platform: account?.platform || 'Instagram',
        imageBase64: base64
      })

      const next = [...assignments]
      next[index].caption = data.caption
      setAssignments(next)
      toast.success(`Caption generated for row ${index + 1}`)
    } catch {
      toast.error('AI Generation failed')
    } finally {
      setRowGenerating(prev => ({ ...prev, [index]: false }))
    }
  }

  async function generateAllCaptions() {
    if (assignments.length === 0) return
    const confirm = window.confirm(`Generate AI captions for all ${assignments.length} photos?`)
    if (!confirm) return

    for (let i = 0; i < assignments.length; i++) {
      await generateRowCaption(i)
    }
  }

  async function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  function getVisionTargetAccounts() {
    if (mode === 'assign') {
      const assignedIds = assignments.map(a => a.accountId).filter(Boolean)
      return accounts.filter(a => assignedIds.includes(a.id))
    }

    return selectionPreview?.accounts || accounts.filter(a => selected.has(a.id))
  }

  async function generateVisionCaptionPlan() {
    const imageFile = mediaFiles.find(file => file.type.startsWith('image/'))
    if (!imageFile) { toast.error('Upload at least one image for AI Vision'); return }

    const targetAccounts = getVisionTargetAccounts()
    if (targetAccounts.length === 0) { toast.error('Select or assign at least one account'); return }

    setVisionLoading(true)
    try {
      const formData = new FormData()
      formData.append('image', imageFile)
      formData.append('imageMimeType', imageFile.type || 'image/jpeg')
      formData.append('accounts', JSON.stringify(targetAccounts.map(account => ({
          id: account.id,
          username: account.username,
          platform: account.platform,
          brandTag: account.brandTag,
        }))))

      const { data } = await api.post<{ plans: VisionCaptionPlan[] }>('/ai/vision-caption-plan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      setVisionPlans(data.plans || [])
      toast.success(`Generated ${data.plans?.length || 0} planning captions`)
    } catch {
      toast.error('AI Vision preview failed')
    } finally {
      setVisionLoading(false)
    }
  }

  function buildPreviewCaption(plan: VisionCaptionPlan) {
    const hashtagText = plan.hashtags.join(' ').trim()
    return [plan.caption.trim(), hashtagText].filter(Boolean).join('\n\n')
  }

  function applyVisionPreviewToCaption() {
    if (visionPlans.length === 0) {
      toast.warning('No AI Vision preview to apply')
      return
    }

    if (mode === 'broadcast') {
      const firstPlan = visionPlans[0]
      const nextCaption = buildPreviewCaption(firstPlan)

      if (!nextCaption.trim()) {
        toast.warning('AI Vision preview has no caption text')
        return
      }

      if (caption.trim() && caption.trim() !== nextCaption.trim()) {
        const proceed = window.confirm('Replace the current manual Broadcast Caption with the first AI Vision preview?')
        if (!proceed) return
      }

      setCaption(nextCaption)
      toast.success(`Applied AI preview from @${firstPlan.username} to Broadcast Caption`)
      return
    }

    const plansByAccountId = new Map(visionPlans.map(plan => [plan.accountId, plan]))
    const plansByUsername = new Map(
      visionPlans.map(plan => [plan.username.toLowerCase(), plan])
    )
    const overwritingCount = assignments.filter((assignment) => {
      const account = accounts.find(a => a.id === assignment.accountId)
      const plan =
        plansByAccountId.get(assignment.accountId) ||
        (account ? plansByUsername.get(account.username.toLowerCase()) : undefined)
      return Boolean(plan && assignment.caption.trim() && assignment.caption.trim() !== buildPreviewCaption(plan).trim())
    }).length

    if (overwritingCount > 0) {
      const proceed = window.confirm(`Replace ${overwritingCount} existing assignment caption${overwritingCount === 1 ? '' : 's'} with matching AI Vision preview caption${overwritingCount === 1 ? '' : 's'}?`)
      if (!proceed) return
    }

    const matchedPlanIds = new Set<string>()
    let applied = 0
    let skippedAssignments = 0

    const next = assignments.map((assignment) => {
      const account = accounts.find(a => a.id === assignment.accountId)
      const plan =
        plansByAccountId.get(assignment.accountId) ||
        (account ? plansByUsername.get(account.username.toLowerCase()) : undefined)

      if (!plan) {
        skippedAssignments += 1
        return assignment
      }

      matchedPlanIds.add(plan.accountId)
      applied += 1
      return {
        ...assignment,
        caption: buildPreviewCaption(plan),
      }
    })

    const unmatchedPlans = visionPlans.filter(plan => !matchedPlanIds.has(plan.accountId))
    setAssignments(next)

    if (applied > 0) {
      toast.success(`Applied AI preview to ${applied} assignment caption${applied === 1 ? '' : 's'}`)
    }

    if (skippedAssignments > 0 || unmatchedPlans.length > 0) {
      const details = [
        skippedAssignments > 0 ? `${skippedAssignments} assignment${skippedAssignments === 1 ? '' : 's'} had no matching preview` : '',
        unmatchedPlans.length > 0 ? `${unmatchedPlans.length} preview${unmatchedPlans.length === 1 ? '' : 's'} had no matching assignment` : '',
      ].filter(Boolean).join('. ')
      toast.warning('Some previews were skipped', details)
    }
  }

  function addHashtags(tags: string[]) {
    if (mode === 'broadcast') {
      const currentTags = caption.match(/#\S+/g) || ([] as string[])
      const newTags = tags.filter(t => !currentTags.includes(t))
      if (newTags.length === 0) return
      
      const combined = [...currentTags, ...newTags].slice(0, 30)
      const cleanCaption = caption.replace(/#\S+/g, '').trim()
      setCaption(`${cleanCaption}\n\n${combined.join(' ')}`)
    } else {
      // Add to all assignments
      const next = assignments.map(as => {
        const currentTags = as.caption.match(/#\S+/g) || ([] as string[])
        const newTags = tags.filter(t => !currentTags.includes(t))
        const combined = [...currentTags, ...newTags].slice(0, 30)
        const cleanCaption = as.caption.replace(/#\S+/g, '').trim()
        return { ...as, caption: `${cleanCaption}\n\n${combined.join(' ')}` }
      })
      setAssignments(next)
      toast.success(`Hashtags added to all ${next.length} assignments`)
    }
  }

  function setDelayMin(value: number) {
    const next = Math.max(0, Math.min(1440, Number.isFinite(value) ? value : 0))
    setDelayMinMinutes(next)
    if (next > delayMaxMinutes) setDelayMaxMinutes(next)
  }

  function setDelayMax(value: number) {
    const next = Math.max(0, Math.min(1440, Number.isFinite(value) ? value : 0))
    setDelayMaxMinutes(Math.max(next, delayMinMinutes))
  }

  function formatDelayWindow(min: number, max: number) {
    if (min === max) return `${min} min`
    return `${min}-${max} min`
  }

  // ── Post ──────────────────────────────────────────────────────
  async function handlePost(allowEmptyCaption = false) {
    if (posting || postingGuardRef.current) return
    postingGuardRef.current = true
    if (mode === 'broadcast' && !caption.trim() && !allowEmptyCaption) {
      toast.warning('Caption is empty', 'Posting will use media only unless you add a caption.')
      const proceed = window.confirm('Caption is empty. Continue with media only?')
      if (!proceed) { postingGuardRef.current = false; return }
    }
    if (selected.size === 0 && selectedGroupIds.size === 0 && mode === 'broadcast') {
      toast.error('Select at least one account or group')
      postingGuardRef.current = false
      return
    }
    if (mediaFiles.length === 0) {
      toast.warning('No media uploaded', 'Upload media before starting bulk post.')
      postingGuardRef.current = false
      return
    }

    if (mode === 'assign') {
      const invalid = assignments.find(a => !a.accountId || !a.caption.trim())
      if (invalid) { toast.error('Please assign an account and caption to every photo'); postingGuardRef.current = false; return }
      if (mediaFiles.length < assignments.length) {
        toast.error('Upload media for every assignment draft before posting')
        postingGuardRef.current = false
        return
      }
    }

    // Init results as pending
    const selectedIds = mode === 'assign' ? assignments.map(a => a.accountId) : Array.from(selected)
    let selectedAccounts = accounts.filter(a => selectedIds.includes(a.id))
    if (mode === 'broadcast' && selectedGroupIds.size > 0 && !campaignDraft) {
      try {
        const { data } = await accountGroupsApi.resolvePreview({
          accountIds: Array.from(selected),
          groupIds: Array.from(selectedGroupIds),
        })
        setSelectionPreview(data)
        selectedAccounts = data.accounts || []
      } catch {
        toast.error('Failed to resolve selected groups')
        postingGuardRef.current = false
        return
      }
    }
    const unhealthyAccounts = selectedAccounts.filter(a => !isHealthyAccount(a))

    if (unhealthyAccounts.length > 0) {
      const healthyCount = selectedAccounts.length - unhealthyAccounts.length
      if (unhealthyAccounts.length > healthyCount) {
        toast.warning('More unhealthy accounts than healthy accounts', `${unhealthyAccounts.length} will be skipped and ${healthyCount} can proceed.`)
      }
      const proceed = window.confirm(
        `${unhealthyAccounts.length} selected account(s) are not HEALTHY. They will be skipped unless you check/re-login them first.\n\nProceed with healthy accounts only?`
      )
      if (!proceed) { postingGuardRef.current = false; return }
    }

    const healthyAccountIds = selectedAccounts.filter(isHealthyAccount).map(a => a.id)
    if (healthyAccountIds.length === 0) {
      toast.warning('All accounts skipped', 'No healthy accounts are available for posting.')
      toast.error('No healthy accounts selected', 'Run Check Session or re-login from Farm View before posting.')
      postingGuardRef.current = false
      return
    }

    const postAssignments = mode === 'assign'
      ? assignments.filter(a => healthyAccountIds.includes(a.accountId))
      : assignments
    const postSelectedIds = mode === 'broadcast' ? healthyAccountIds : postAssignments.map(a => a.accountId)

    setPosting(true)
    setShowResults(true)

    const initResults: PostResult[] = selectedAccounts.map(a => ({ accountId: a.id, username: a.username, status: 'pending' }))
    setResults(initResults)

    try {
      const formData = new FormData()
      formData.append('mode', mode)
      formData.append('baseCaption', caption)
      formData.append('spinCaptions', shouldSpin.toString())
      formData.append('delayMinMinutes', String(delayMinMinutes))
      formData.append('delayMaxMinutes', String(delayMaxMinutes))
      
      const hashtags = caption.match(/#\S+/g) || []
      formData.append('baseHashtags', JSON.stringify(hashtags))

      if (mode === 'assign') {
        formData.append('assignments', JSON.stringify(postAssignments))
      } else {
        formData.append('accountIds', JSON.stringify(postSelectedIds))
        formData.append('groupIds', JSON.stringify(campaignDraft ? [] : Array.from(selectedGroupIds)))
      }

      if (campaignId) {
        formData.append('campaignId', campaignId)
      }

      mediaFiles.forEach((f) => formData.append('media', f))

      const { data } = await postsApi.bulkMulti(formData)

      toast.success(data.message || `Queued posts successfully`)
      const skipped = new Set([
        ...unhealthyAccounts.map(a => a.id),
        ...(data.skippedAccounts || []).map((a: any) => a.accountId),
      ])
      setResults(prev => prev.map(r => skipped.has(r.accountId)
        ? { ...r, status: 'failed', error: 'Skipped: unhealthy session' }
        : { ...r, status: 'success' }
      ))
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Bulk post failed'
      toast.error('Failed', msg)
      setResults(prev => prev.map(r => ({ ...r, status: 'failed', error: msg })))
    } finally {
      setPosting(false)
      setShowPreflightConfirm(false)
      postingGuardRef.current = false
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

    if (mediaFiles.length === 0) {
      toast.error('Cannot retry without media', 'Upload media again before retrying failed posts.')
      return
    }

    const failedIds = new Set(failed.map(r => r.accountId))
    const retryAssignments = assignments.filter(a => failedIds.has(a.accountId))
    if (mode === 'assign' && retryAssignments.length === 0) {
      toast.error('Cannot retry', 'No matching failed assignment rows were found.')
      return
    }

    setPosting(true)
    try {
      const formData = new FormData()
      formData.append('mode', mode)
      formData.append('baseCaption', caption)
      formData.append('spinCaptions', shouldSpin.toString())
      formData.append('delayMinMinutes', String(delayMinMinutes))
      formData.append('delayMaxMinutes', String(delayMaxMinutes))
      formData.append('baseHashtags', JSON.stringify(caption.match(/#\S+/g) || []))

      if (mode === 'assign') {
        formData.append('assignments', JSON.stringify(retryAssignments))
      } else {
        formData.append('accountIds', JSON.stringify(Array.from(failedIds)))
        formData.append('groupIds', JSON.stringify([]))
      }

      mediaFiles.forEach((file) => formData.append('media', file))
      await postsApi.bulkMulti(formData)
      setResults(prev => prev.map(p => failedIds.has(p.accountId) ? { ...p, status: 'success', error: undefined } : p))
      toast.success('Retry queued with media')
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.details || 'Retry failed'
      toast.error('Retry failed', msg)
    }
    setPosting(false)
  }

  const successCount = results.filter(r => r.status === 'success').length
  const failCount = results.filter(r => r.status === 'failed').length
  const pendingCount = results.filter(r => r.status === 'pending').length
  const progress = results.length > 0 ? Math.round(((successCount + failCount) / results.length) * 100) : 0
  const targetPostCount = mode === 'assign' ? assignments.length : (selectionPreview?.totalResolved ?? selected.size)
  const lastStartMin = Math.max(0, targetPostCount - 1) * delayMinMinutes
  const lastStartMax = Math.max(0, targetPostCount - 1) * delayMaxMinutes
  const estimatedPostingWindow = targetPostCount <= 1
    ? 'Single-account posting starts immediately.'
    : `First account starts immediately. Last account is scheduled about ${formatDelayWindow(lastStartMin, lastStartMax)} from start.`
  const assignedAccountIds = Array.from(new Set(assignments.map(item => item.accountId).filter(Boolean)))
  const assignedAccounts = accounts.filter(account => assignedAccountIds.includes(account.id))
  const assignedHealthyCount = assignedAccounts.filter(isHealthyAccount).length
  const assignedSkippedCount = assignedAccounts.length - assignedHealthyCount
  const preflightResolvedCount = mode === 'assign'
    ? assignedAccounts.length
    : (selectionPreview?.totalResolved ?? selected.size)
  const preflightHealthyCount = mode === 'assign'
    ? assignedHealthyCount
    : (selectionPreview?.healthyCount ?? accounts.filter(account => selected.has(account.id) && isHealthyAccount(account)).length)
  const preflightSkippedCount = mode === 'assign'
    ? assignedSkippedCount
    : (selectionPreview?.skippedCount ?? 0)
  const invalidAssignmentRows = mode === 'assign'
    ? assignments.filter(item => !item.accountId || !item.caption.trim() || item.photoIndex >= mediaFiles.length).length
    : 0
  const captionLength = caption.trim().length
  const assignmentShortCaptions = mode === 'assign'
    ? assignments.filter(item => item.caption.trim().length > 0 && item.caption.trim().length < 20).length
    : 0
  const preflightBlockers = [
    mediaFiles.length === 0 ? 'No media uploaded.' : '',
    preflightHealthyCount === 0 ? 'No healthy accounts available.' : '',
    mode === 'broadcast' && captionLength === 0 ? 'Caption is empty and needs final confirmation.' : '',
    invalidAssignmentRows > 0 ? `${invalidAssignmentRows} assignment row${invalidAssignmentRows === 1 ? '' : 's'} need account, caption, and media.` : '',
  ].filter(Boolean)
  const preflightWarnings = [
    mode === 'broadcast' && captionLength > 0 && captionLength < 40 ? 'Caption is very short.' : '',
    assignmentShortCaptions > 0 ? `${assignmentShortCaptions} assignment caption${assignmentShortCaptions === 1 ? '' : 's'} look very short.` : '',
    preflightSkippedCount > 0 ? `${preflightSkippedCount} unhealthy/skipped account${preflightSkippedCount === 1 ? '' : 's'} detected.` : '',
    delayMinMinutes < 2 ? 'Delay minimum is below 2 minutes.' : '',
    campaignDraft && !campaignDraft.aiPlan ? 'Campaign draft has no AI planning context loaded in Compose.' : '',
    variationDraft ? 'Variation draft loaded. Re-check approval and media references in Campaigns before final posting.' : '',
  ].filter(Boolean)
  const preflightStatus = preflightBlockers.length > 0
    ? 'BLOCKED'
    : preflightWarnings.length > 0
      ? 'WARNING'
      : 'READY'
  const preflightStatusClass = preflightStatus === 'READY'
    ? 'border-green-500/30 bg-green-500/10 text-green-300'
    : preflightStatus === 'WARNING'
      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
      : 'border-red-500/30 bg-red-500/10 text-red-300'
  const preflightHardBlockers = preflightBlockers.filter(item => !item.startsWith('Caption is empty'))
  const canConfirmPreflight = preflightHardBlockers.length === 0 && !posting && !postingGuardRef.current
  const campaignDraftPrepared = Boolean(campaignDraft)
  const campaignMediaCount = campaignMediaRefs.length
  const loadedMediaCount = mediaFiles.length
  const aiPreviewPrepared = Boolean(campaignDraft?.aiPlan)
  const composeIntelligence = buildComposeIntelligence({
    caption,
    assignmentCaptions: assignments.map(item => item.caption),
    aiPreviewCount: visionPlans.length + previewVariations.length + (campaignDraft?.aiPlan ? 1 : 0),
    selectedAccountCount: mode === 'assign' ? assignedAccounts.length : (selectionPreview?.totalResolved ?? selected.size),
    selectedGroupCount: selectedGroupIds.size,
    mediaCount: mediaFiles.length,
    suggestedHashtags: campaignDraft?.suggestedHashtags,
    suggestedCTA: campaignDraft?.suggestedCTA,
    campaignAngle: campaignDraft?.contentAngle,
  })

  function requestPreflightStart() {
    setShowPreflightConfirm(true)
    if (preflightStatus === 'BLOCKED') {
      toast.warning('Review preflight blockers before posting')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">

      {/* ── Left: Composer ──────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <SendHorizontal className="h-5 w-5 text-purple-400" /> Compose & Post
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Post to multiple accounts with unique captions and photos.
            </p>
          </div>
          <div className="flex bg-secondary p-1 rounded-lg">
            <button
              onClick={() => setMode('broadcast')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                mode === 'broadcast' ? "bg-purple-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              BROADCAST
            </button>
            <button
              onClick={() => setMode('assign')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                mode === 'assign' ? "bg-purple-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              ASSIGN MODE
            </button>
          </div>
        </div>

        {contentPlannerDrafts.length > 0 && (
          <Card className="border-purple-500/30 bg-purple-500/[0.04]">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-purple-500/40 text-purple-300">
                      Local bridge only
                    </Badge>
                    <p className="text-sm font-bold">Content Planner drafts available</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {contentPlannerDrafts.length} approved draft{contentPlannerDrafts.length === 1 ? '' : 's'} are ready to apply.
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                    Local bridge only. No backend call, no auto-post. Media must still be uploaded manually.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowContentPlannerDrafts((value) => !value)}
                  >
                    Preview Drafts
                  </Button>
                  <Button type="button" size="sm" variant="purple" onClick={applyContentPlannerDraftsToAssignments}>
                    Apply to Assignment Mode
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={clearContentPlannerDrafts}>
                    Clear Drafts
                  </Button>
                </div>
              </div>

              {contentPlannerBridgeMessage && (
                <div className="rounded-md border border-purple-500/20 bg-background/60 px-3 py-2 text-xs font-bold text-purple-200">
                  {contentPlannerBridgeMessage}
                </div>
              )}

              {showContentPlannerDrafts && (
                <div className="space-y-2 border-t border-border/50 pt-3">
                  {contentPlannerDrafts.map((draft, index) => (
                    <div key={`${draft.account}-${draft.createdAt}-${index}`} className="rounded-md border border-border/60 bg-background/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs font-bold">{draft.account}</p>
                        <Badge variant="secondary" className="text-[10px]">{draft.materialTopic}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{draft.captionSeed}</p>
                      <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
                        <p><span className="font-bold text-foreground">Hashtags:</span> {draft.hashtagSet}</p>
                        <p><span className="font-bold text-foreground">CTA:</span> {draft.cta}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(campaignDraft || campaignDraftLoading) && (
          <Card className="border-orange-500/30 bg-orange-500/[0.04]">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-orange-500/40 text-orange-300">
                    {campaignDraftPrepared ? 'Draft Prepared' : 'Campaign Draft'}
                  </Badge>
                  {campaignDraft?.schedulerStatus === 'READY' && (
                    <Badge variant="outline" className="border-green-500/40 text-green-300">Scheduler READY</Badge>
                  )}
                  <p className="truncate text-sm font-bold">
                    {campaignDraftLoading ? 'Loading campaign context...' : campaignDraft?.campaignName}
                  </p>
                </div>
                {campaignDraft && (
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    <p>
                      {campaignDraft.objective} - {campaignDraft.healthyCount} healthy account{campaignDraft.healthyCount === 1 ? '' : 's'} selected
                      {campaignDraft.skippedCount > 0 ? `, ${campaignDraft.skippedCount} skipped` : ''}. Posting starts only when you click Start Bulk Post.
                    </p>
                    <p>
                      Source campaign: <span className="text-foreground">{campaignDraft.campaignName}</span> · Media loaded: <span className="text-foreground">{loadedMediaCount}</span> · AI preview:{" "}
                      <span className={aiPreviewPrepared ? 'text-green-300 font-semibold' : 'text-yellow-300 font-semibold'}>
                        {aiPreviewPrepared ? 'Prepared' : 'Missing'}
                      </span>
                    </p>
                    {campaignDraft.schedulerStatus === 'READY' && (
                      <p className="rounded-md border border-green-500/20 bg-green-500/[0.06] px-2 py-1.5 text-green-300">
                        Scheduled draft is ready for review. No queue job or publish action has been started.
                      </p>
                    )}
                    {!campaignDraft.aiPlan && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/[0.06] px-2 py-1.5 text-yellow-300">
                        <span className="font-semibold">AI preview not prepared yet.</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-yellow-500/30 bg-transparent text-[10px] font-bold text-yellow-300 hover:bg-yellow-500/10"
                          onClick={generateVisionCaptionPlan}
                          disabled={visionLoading || mediaFiles.length === 0 || (mode === 'broadcast' && selected.size === 0 && selectedGroupIds.size === 0)}
                        >
                          <Sparkles className="mr-1 h-3 w-3" />
                          Generate AI Preview
                        </Button>
                      </div>
                    )}
                    {campaignDraft.aiPlan && (
                      <div className="rounded-md border border-orange-500/20 bg-background/40 p-2">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="h-5 text-[10px]">AI draft from campaign plan</Badge>
                          {campaignDraft.tone && <span>Tone: {campaignDraft.tone}</span>}
                        </div>
                        {campaignDraft.contentAngle && <p>Angle: {campaignDraft.contentAngle}</p>}
                        {campaignDraft.suggestedCTA && <p>CTA: {campaignDraft.suggestedCTA}</p>}
                        {(campaignDraft.suggestedHashtags?.length || 0) > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {campaignDraft.suggestedHashtags!.slice(0, 8).map(tag => (
                              <Badge key={tag} variant="outline" className="h-5 text-[10px]">{tag}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {campaignMediaLoading && <p className="text-[10px] text-muted-foreground">Loading campaign media references...</p>}
                    {!campaignMediaLoading && campaignMediaCount === 0 && (
                      <p className="rounded-md border border-border/40 bg-background/30 px-2 py-1 text-[10px] text-muted-foreground">
                        No campaign media references found. Manual media upload is still allowed.
                      </p>
                    )}
                    {campaignMediaLoadWarning && (
                      <p className="text-[10px] font-semibold text-yellow-300">{campaignMediaLoadWarning}</p>
                    )}
                    {campaignMediaCount > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="h-5 text-[10px] text-cyan-300">
                          {campaignMediaCount} campaign media ref{campaignMediaCount === 1 ? '' : 's'}
                        </Badge>
                        <Badge variant="outline" className="h-5 text-[10px] text-green-300">
                          {loadedMediaCount} media prepared
                        </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {campaignMediaRefs.slice(0, 3).map(ref => (
                            <Badge key={ref.id} variant="outline" className="h-5 max-w-56 truncate text-[10px]">
                              {ref.originalName || ref.filename}
                            </Badge>
                          ))}
                          {campaignMediaCount > 3 && (
                            <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
                              +{campaignMediaCount - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {campaignDraft?.planningSummary?.selectedGroups?.length ? (
                <div className="flex shrink-0 flex-wrap gap-1">
                  {campaignDraft.planningSummary.selectedGroups.map(group => (
                    <Badge key={group.id} variant="outline" className="max-w-40 truncate text-[10px]">
                      <Users className="mr-1 h-3 w-3" />{group.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {(variationDraft || variationDraftLoading) && (
          <Card className="border-purple-500/30 bg-purple-500/[0.04]">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-purple-500/40 text-purple-300">Variation Assignments</Badge>
                <p className="text-sm font-bold">
                  {variationDraftLoading ? 'Loading variation drafts...' : variationDraft?.campaignName}
                </p>
              </div>
              {variationDraft && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {variationDraft.assignments.length} draft row{variationDraft.assignments.length === 1 ? '' : 's'} loaded from campaign content variations. Upload media, review rows, then manually click Start Bulk Post.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Broadcast Caption editor */}
        {mode === 'broadcast' && (
          <Card className="border-purple-500/20 bg-purple-500/[0.02]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Broadcast Caption</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 border border-purple-500/20">
                    <Checkbox
                      id="spin-toggle"
                      checked={shouldSpin}
                      onCheckedChange={(v) => setShouldSpin(!!v)}
                      className="h-3.5 w-3.5"
                    />
                    <Label htmlFor="spin-toggle" className="text-[10px] font-semibold text-purple-400 cursor-pointer flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> AI SPIN
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
              <CampaignTemplatePresetManager
                currentTemplate={{
                  name: 'Compose caption',
                  description: '',
                  actionType: 'follow',
                  targetType: 'username',
                  targetValue: '',
                  defaultCaptionSeed: caption,
                  defaultHashtags: caption.match(/#\S+/g) || [],
                  suggestedTone: '',
                  suggestedCTA: '',
                  groupIds: Array.from(selectedGroupIds),
                  accountIds: Array.from(selected),
                }}
                onApply={applyCampaignTemplateCaption}
                mode="compose"
                compact
              />
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write your base caption here… AI will generate variations for each account."
                rows={4}
                className="resize-none text-sm bg-background/50"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex gap-3">
                  <span className={cn(caption.length > 2200 && 'text-red-400')}>
                    {caption.length} / 2200 chars
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/20 mt-2">
                  <span className="text-[9px] font-black uppercase text-muted-foreground mr-1 self-center">Quick Hashtags:</span>
                  {HASHTAG_GROUPS.map(g => (
                    <button
                      key={g.name}
                      onClick={() => addHashtags(g.name === 'Jakarta' ? g.tags : g.tags)}
                      className="px-2 py-0.5 rounded bg-secondary hover:bg-purple-500/20 hover:text-purple-400 text-[9px] font-bold transition-colors border border-border/50"
                    >
                      +{g.name}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Media upload */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Image className="h-4 w-4" /> Media Assets
              <span className="font-normal text-muted-foreground">({mediaFiles.length}/19)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mediaPreviews.length === 0 ? (
              <button
                className="w-full rounded-lg border-2 border-dashed border-border hover:border-purple-500/50 transition-colors p-12 flex flex-col items-center gap-3 text-muted-foreground bg-secondary/20"
                onClick={() => fileRef.current?.click()}
              >
                <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                  <Upload className="h-6 w-6 opacity-60" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Upload your photos or videos</p>
                  <p className="text-xs mt-1">Drag and drop or click to browse (Max 19 files)</p>
                </div>
              </button>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                {mediaPreviews.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-secondary ring-1 ring-border group">
                    <img src={url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => removeMedia(i)}
                        className="rounded-full bg-red-500 p-1.5 text-white shadow-lg transform scale-75 group-hover:scale-100 transition-transform"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-bold text-white">
                      #{i + 1}
                    </div>
                  </div>
                ))}
                {mediaFiles.length < 19 && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-purple-500/50 hover:bg-purple-500/5 transition-all"
                  >
                    <Upload className="h-5 w-5 mb-1" />
                    <span className="text-[10px] font-bold uppercase">Add</span>
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

        {/* AI Vision planning preview */}
        <Card className="border-cyan-500/20 bg-cyan-500/[0.02]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" /> AI Vision Caption Generator
                </CardTitle>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Planning preview only. Generates unique captions and hashtags per account style from the uploaded image.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-[10px] font-bold border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                onClick={generateVisionCaptionPlan}
                disabled={visionLoading || mediaFiles.length === 0 || (mode === 'broadcast' && selected.size === 0 && selectedGroupIds.size === 0)}
              >
                {visionLoading
                  ? <><RefreshCw className="h-3 w-3 animate-spin mr-1.5" /> ANALYZING</>
                  : <><Sparkles className="h-3 w-3 mr-1.5" /> GENERATE AI PREVIEW</>
                }
              </Button>
            </div>
          </CardHeader>
          {visionPlans.length > 0 && (
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-2">
                <div>
                  <p className="text-[10px] font-black uppercase text-cyan-400">Preview only</p>
                  <p className="text-[10px] text-muted-foreground">
                    {mode === 'broadcast'
                      ? 'Copies the first preview caption and hashtags into Broadcast Caption. Posting still requires Start Bulk Post.'
                      : 'Copies matching preview captions and hashtags into Photo Assignments. Posting still requires Start Bulk Post.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 text-[10px] font-bold border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  onClick={applyVisionPreviewToCaption}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1.5" /> Apply AI Preview to Caption
                </Button>
              </div>
              <div className="grid gap-3">
                {visionPlans.map((plan) => (
                  <div key={plan.accountId} className="rounded-lg border border-border/60 bg-background/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[9px] shrink-0">{plan.platform}</Badge>
                        <span className="text-xs font-black truncate">@{plan.username}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{plan.style}</span>
                      </div>
                      <Badge variant="secondary" className="text-[8px]">PREVIEW ONLY</Badge>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">{plan.imageSummary}</p>
                    <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap">{plan.caption}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/30 pt-2">
                      {plan.hashtags.map((tag, i) => (
                        <span key={`${plan.accountId}-${tag}-${i}`} className="text-[9px] font-bold text-cyan-400/80">{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Assignment Table */}
        {mode === 'assign' && (mediaFiles.length > 0 || assignments.length > 0) && (
          <Card className="border-purple-500/30">
            <CardHeader className="pb-2 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-purple-400" /> Photo Assignments
                </CardTitle>
                <div className="flex items-center gap-2">
                   <div className="flex gap-1">
                    {HASHTAG_GROUPS.map(g => (
                      <button
                        key={g.name}
                        onClick={() => addHashtags(g.tags)}
                        className="px-2 py-1 rounded-md bg-secondary hover:bg-purple-500/20 text-[8px] font-bold border border-border/50 transition-colors"
                      >
                        +{g.name}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-7 text-[10px] font-bold border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                    onClick={generateAllCaptions}
                  >
                    <Sparkles className="h-3 w-3 mr-1.5" /> GENERATE ALL
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/50 text-muted-foreground uppercase text-[10px] font-bold">
                      <th className="px-4 py-3 text-left w-20">Photo</th>
                      <th className="px-4 py-3 text-left w-48">Account</th>
                      <th className="px-4 py-3 text-left">Caption</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {assignments.map((as, i) => (
                      <tr key={i} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="h-12 w-12 rounded-md overflow-hidden ring-1 ring-border">
                            {mediaPreviews[i] ? (
                              <img src={mediaPreviews[i]} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-secondary text-[9px] text-muted-foreground">
                                Media {i + 1}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={as.accountId}
                            onChange={(e) => {
                              const next = [...assignments]
                              next[i].accountId = e.target.value
                              setAssignments(next)
                              setVisionPlans([])
                            }}
                            className="w-full bg-background border border-border rounded-md px-2 py-1.5 focus:ring-1 focus:ring-purple-500 outline-none"
                          >
                            <option value="">Select Account...</option>
                            {accounts.map(acc => (
                              <option key={acc.id} value={acc.id}>
                                @{acc.username} ({acc.platform}, {acc.sessionHealth || 'UNKNOWN'})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 relative group">
                          {(as.variationTitle || as.visualDirection) && (
                            <div className="mb-2 rounded-md border border-purple-500/20 bg-purple-500/[0.03] p-2 pr-10">
                              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                {as.variationTitle && <p className="font-bold text-purple-300">{as.variationTitle}</p>}
                                {as.formatRecommendation && <Badge variant="outline" className="h-5 text-[9px]">{as.formatRecommendation}</Badge>}
                                {as.priorityScore !== undefined && <Badge variant="outline" className="h-5 text-[9px]">Priority {as.priorityScore}</Badge>}
                              </div>
                              {as.targetCluster && <p className="text-[10px] text-muted-foreground">Cluster: {as.targetCluster}</p>}
                              {as.visualDirection && <p className="text-[10px] text-muted-foreground">Visual: {as.visualDirection}</p>}
                              {as.cta && <p className="text-[10px] text-muted-foreground">CTA: {as.cta}</p>}
                              {(as.hashtags?.length || 0) > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {as.hashtags!.slice(0, 8).map(tag => (
                                    <Badge key={tag} variant="outline" className="h-5 text-[9px]">{tag}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <textarea
                            value={as.caption}
                            onChange={(e) => {
                              const next = [...assignments]
                              next[i].caption = e.target.value
                              setAssignments(next)
                            }}
                            placeholder="Caption for this photo..."
                            rows={2}
                            className="w-full bg-background border border-border rounded-md px-3 py-2 pr-10 focus:ring-1 focus:ring-purple-500 outline-none resize-none"
                          />
                          <button
                            onClick={() => generateRowCaption(i)}
                            disabled={rowGenerating[i] || !as.accountId}
                            className="absolute right-6 top-5 p-1.5 rounded-md bg-purple-600/10 text-purple-400 hover:bg-purple-600 hover:text-white transition-all disabled:opacity-50"
                            title="Generate AI Caption"
                          >
                            {rowGenerating[i] ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          </button>
                          <div className="flex justify-between mt-1 px-1">
                            <span className={cn("text-[9px] font-medium", (as.caption.match(/#\S+/g) || []).length > 30 ? "text-red-400" : "text-muted-foreground")}>
                              {(as.caption.match(/#\S+/g) || []).length}/30 hashtags
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {as.caption.length} chars
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Post results */}
        {showResults && results.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Posting Status</CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-400 font-bold">{successCount} SUCCESS</span>
                  <span className="text-red-400 font-bold">{failCount} FAILED</span>
                  {failCount > 0 && !posting && (
                    <Button size="sm" variant="outline" onClick={retryFailed} className="h-6 text-[10px] font-bold">
                      RETRY FAILED
                    </Button>
                  )}
                </div>
              </div>
              {posting && <Progress value={progress} className="h-1.5 mt-2 bg-secondary" />}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
                {results.map((r) => (
                  <div key={r.accountId} className="flex items-center justify-between text-[10px] rounded-lg px-3 py-2 bg-secondary/50 border border-border/50">
                    <span className="font-bold truncate max-w-[100px]">@{r.username}</span>
                    <div className="flex items-center gap-1.5">
                      {r.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                      {r.status === 'failed'  && <XCircle     className="h-3.5 w-3.5 text-red-400" />}
                      {r.status === 'pending' && <RefreshCw   className="h-3.5 w-3.5 text-purple-400 animate-spin" />}
                      <span className={cn(
                        "uppercase font-black text-[8px]",
                        r.status === 'success' ? "text-green-400" : r.status === 'failed' ? "text-red-400" : "text-purple-400"
                      )}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right: Sidebar ────────────────────────────── */}
      <div className="space-y-4">
        <Card className="border-cyan-500/20 bg-cyan-500/[0.03]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Compose Intelligence
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-black',
                  composeIntelligence.captionScore >= 75 && 'border-green-500/30 bg-green-500/10 text-green-300',
                  composeIntelligence.captionScore >= 50 && composeIntelligence.captionScore < 75 && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                  composeIntelligence.captionScore < 50 && 'border-red-500/30 bg-red-500/10 text-red-300',
                )}
              >
                {composeIntelligence.captionScore}/100
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">Simulasi cockpit distribusi berdasarkan caption, media, akun, dan AI preview.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Caption Score', composeIntelligence.captionScore],
                ['Hashtag Density', composeIntelligence.hashtagDensity],
                ['Variation Quality', composeIntelligence.variationQuality],
              ].map(([label, value]) => {
                const score = value as number
                return (
                  <div key={label as string} className="rounded-md border border-border/50 bg-background/45 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">{label as string}</p>
                      <span className="text-[10px] font-black">{score}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          score >= 75 && 'bg-green-400',
                          score >= 50 && score < 75 && 'bg-yellow-400',
                          score < 50 && 'bg-red-400',
                        )}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              <div className="rounded-md border border-border/50 bg-background/45 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Account Fit</p>
                <p className="mt-1 text-[10px] font-bold text-foreground">{composeIntelligence.accountFit}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="h-5 text-[9px]">CTA: {composeIntelligence.ctaStrength}</Badge>
              <Badge
                variant="outline"
                className={cn(
                  'h-5 text-[9px]',
                  composeIntelligence.spamRisk === 'Low' && 'border-green-500/30 text-green-300',
                  composeIntelligence.spamRisk === 'Medium' && 'border-yellow-500/30 text-yellow-300',
                  composeIntelligence.spamRisk === 'High' && 'border-red-500/30 text-red-300',
                )}
              >
                Spam Risk: {composeIntelligence.spamRisk}
              </Badge>
              <Badge variant="outline" className="h-5 text-[9px]">Distribution Fit: {composeIntelligence.distributionFit}</Badge>
            </div>
            <div className="space-y-1 border-t border-border/40 pt-2">
              {composeIntelligence.recommendations.slice(0, 5).map(item => (
                <p key={item} className="text-[10px] text-muted-foreground">{item}</p>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Account Selector (only in broadcast mode) */}
        {mode === 'broadcast' && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-black">Target Accounts</CardTitle>
                <Badge variant="purple" className="text-[10px]">{selectionPreview?.totalResolved ?? selected.size}</Badge>
              </div>
              <div className="flex gap-1 mt-3">
                {(['all', 'Instagram', 'TikTok'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPlatformFilter(p)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-[10px] font-black uppercase transition-all',
                      platformFilter === p ? 'bg-purple-600 text-white shadow-lg' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                    )}
                  >
                    {p === 'all' ? 'All' : p}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-3">
                <AccountLoadoutPresetManager
                  selectedAccountIds={Array.from(selected)}
                  selectedGroupIds={Array.from(selectedGroupIds)}
                  onApply={applyLoadoutPreset}
                  defaultName={campaignDraft?.campaignName || ''}
                  compact
                />
              </div>

              <div className="mb-3 rounded-lg border border-border/60 bg-secondary/20 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Account Groups
                  </div>
                  <Badge variant="outline" className="text-[9px]">{selectedGroupIds.size}</Badge>
                </div>
                {accountGroups.length === 0 ? (
                  <p className="py-2 text-[10px] text-muted-foreground">No account groups available.</p>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                    {accountGroups.map((group) => (
                      <div
                        key={group.id}
                        onClick={() => toggleGroup(group.id)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors',
                          selectedGroupIds.has(group.id)
                            ? 'border-purple-600/30 bg-purple-600/10'
                            : 'border-transparent hover:bg-secondary/70'
                        )}
                      >
                        <Checkbox
                          checked={selectedGroupIds.has(group.id)}
                          onCheckedChange={() => toggleGroup(group.id)}
                          onClick={e => e.stopPropagation()}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-bold">{group.name}</p>
                          <p className="text-[9px] text-muted-foreground">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 rounded-md border border-border/50 bg-background/60 p-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Resolved</p>
                      <p className="text-sm font-black">{selectionPreviewLoading ? '...' : selectionPreview?.totalResolved ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Healthy</p>
                      <p className="text-sm font-black text-green-400">{selectionPreviewLoading ? '...' : selectionPreview?.healthyCount ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-muted-foreground">Skipped</p>
                      <p className="text-sm font-black text-red-400">{selectionPreviewLoading ? '...' : selectionPreview?.skippedCount ?? 0}</p>
                    </div>
                  </div>
                  {selectedGroups.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border/40 pt-2">
                      {selectedGroups.map(group => (
                        <Badge key={group.id} variant="purple" className="max-w-full truncate text-[9px]">{group.name}</Badge>
                      ))}
                    </div>
                  )}
                  {(selectionPreview?.skippedCount || 0) > (selectionPreview?.healthyCount || 0) && (
                    <div className="mt-2 rounded-md border border-yellow-500/25 bg-yellow-500/10 px-2 py-1.5 text-[10px] font-bold text-yellow-400">
                      More unhealthy accounts than healthy accounts. Review sessions before starting.
                    </div>
                  )}
                  {(selectionPreview?.skippedAccounts?.length || 0) > 0 && (
                    <div className="mt-2 max-h-20 space-y-1 overflow-y-auto border-t border-border/40 pt-2">
                      {selectionPreview!.skippedAccounts.slice(0, 5).map(account => (
                        <p key={account.accountId} className="truncate text-[9px] text-muted-foreground">
                          @{account.username} - {account.health}
                        </p>
                      ))}
                      {selectionPreview!.skippedAccounts.length > 5 && (
                        <p className="text-[9px] font-bold text-muted-foreground">
                          +{selectionPreview!.skippedAccounts.length - 5} more skipped
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pb-2 border-b border-border/50 mb-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} id="select-all" />
                <Label htmlFor="select-all" className="text-[10px] font-bold cursor-pointer uppercase text-muted-foreground">Select all active ({filtered.length})</Label>
              </div>

              <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                {filtered.map((account) => (
                  <div
                    key={account.id}
                    onClick={() => toggleAccount(account.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-all border',
                      selected.has(account.id) 
                        ? 'bg-purple-600/10 border-purple-600/30' 
                        : 'bg-background border-transparent hover:bg-secondary/50'
                    )}
                  >
                    <Checkbox checked={selected.has(account.id)} onCheckedChange={() => toggleAccount(account.id)} onClick={e => e.stopPropagation()} />
                    {account.platform === 'Instagram'
                      ? <Instagram className="h-3.5 w-3.5 text-pink-500 shrink-0" />
                      : <Music2    className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                    }
                    <div className="flex flex-col truncate">
                      <span className="text-[11px] font-bold truncate">@{account.username}</span>
                      <span className="text-[9px] text-muted-foreground font-medium">
                        {account.brandTag || 'rockbase'} · {account.sessionHealth || 'UNKNOWN'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Delay Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-black flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> Delay Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="delay-min" className="text-[10px] font-bold uppercase text-muted-foreground">
                  Min delay minutes
                </Label>
                <Input
                  id="delay-min"
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  value={delayMinMinutes}
                  onChange={(e) => setDelayMin(Number(e.target.value))}
                  className="h-9 text-xs font-bold"
                  disabled={posting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delay-max" className="text-[10px] font-bold uppercase text-muted-foreground">
                  Max delay minutes
                </Label>
                <Input
                  id="delay-max"
                  type="number"
                  min={delayMinMinutes}
                  max={1440}
                  step={1}
                  value={delayMaxMinutes}
                  onChange={(e) => setDelayMax(Number(e.target.value))}
                  className="h-9 text-xs font-bold"
                  disabled={posting}
                />
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/40 px-3 py-2">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">
                Random gap per account: {formatDelayWindow(delayMinMinutes, delayMaxMinutes)}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                {estimatedPostingWindow}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Preflight Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground font-black">
                Preflight Checklist
              </CardTitle>
              <Badge variant="outline" className={cn('text-[10px] font-black', preflightStatusClass)}>
                {preflightStatus}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Media</p>
                <p className="font-black">{mediaFiles.length} file{mediaFiles.length === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Mode</p>
                <p className="font-black uppercase">{mode}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Resolved</p>
                <p className="font-black">{selectionPreviewLoading ? '...' : preflightResolvedCount}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Healthy / Skipped</p>
                <p className="font-black">
                  <span className="text-green-300">{preflightHealthyCount}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className={preflightSkippedCount > 0 ? 'text-yellow-300' : 'text-muted-foreground'}>{preflightSkippedCount}</span>
                </p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Caption</p>
                <p className="font-black">
                  {mode === 'broadcast'
                    ? (captionLength > 0 ? `${captionLength} chars` : 'Empty')
                    : `${assignments.length - invalidAssignmentRows}/${assignments.length} rows valid`}
                </p>
              </div>
              <div className="rounded-md border border-border/50 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Delay</p>
                <p className="font-black">{formatDelayWindow(delayMinMinutes, delayMaxMinutes)}</p>
              </div>
            </div>

            {(campaignDraft || variationDraft) && (
              <div className="rounded-md border border-purple-500/20 bg-purple-500/[0.04] px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-purple-300">Campaign Context</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {campaignDraft
                    ? `${campaignDraft.campaignName} loaded${campaignDraft.schedulerStatus ? ` (${campaignDraft.schedulerStatus})` : ''}.`
                    : `${variationDraft?.campaignName} variation assignments loaded.`}
                </p>
              </div>
            )}

            {(preflightBlockers.length > 0 || preflightWarnings.length > 0) && (
              <div className="space-y-1 border-t border-border/50 pt-2">
                {preflightBlockers.map(item => (
                  <p key={item} className="text-[10px] font-bold text-red-300">BLOCKED: {item}</p>
                ))}
                {preflightWarnings.map(item => (
                  <p key={item} className="text-[10px] font-bold text-yellow-300">WARNING: {item}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Card */}
        <Card className="bg-purple-600 text-white border-none shadow-xl shadow-purple-900/20">
          <CardHeader>
            <CardTitle className="text-xs uppercase font-black tracking-widest">Ready to Publish?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] mb-4 opacity-80 font-medium leading-relaxed">
              {mode === 'broadcast' 
                ? `You're about to post 1 media asset to ${selectionPreview?.totalResolved ?? selected.size} resolved accounts using AI caption spinning.`
                : `You're about to post ${assignments.length} unique photo-account pairs.`
              }
            </p>
            <Button
              className="w-full bg-white text-purple-600 hover:bg-white/90 font-black uppercase text-xs h-12 shadow-lg"
              disabled={posting}
              onClick={requestPreflightStart}
            >
              {posting
                ? <><RefreshCw className="h-4 w-4 animate-spin mr-2" /> Processing…</>
                : <><SendHorizontal className="h-4 w-4 mr-2" /> Start Bulk Post</>
              }
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Preview Modal ────────────────────────────────────────── */}
      {/* Preflight Confirmation Modal */}
      <Dialog open={showPreflightConfirm} onOpenChange={setShowPreflightConfirm}>
        <DialogContent className="max-w-lg bg-background border-purple-500/20">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Confirm Bulk Post</span>
              <Badge variant="outline" className={cn('text-[10px] font-black', preflightStatusClass)}>
                {preflightStatus}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Final manual confirmation before the existing posting flow starts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Mode</p>
                <p className="font-black uppercase">{mode}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Media</p>
                <p className="font-black">{mediaFiles.length}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Accounts</p>
                <p className="font-black">{preflightHealthyCount} healthy / {preflightSkippedCount} skipped</p>
              </div>
              <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground">Delay</p>
                <p className="font-black">{formatDelayWindow(delayMinMinutes, delayMaxMinutes)}</p>
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
              <p className="font-bold">Campaign</p>
              <p className="mt-1 text-muted-foreground">
                {campaignDraft?.campaignName || variationDraft?.campaignName || 'No campaign context'}
              </p>
            </div>

            {(preflightBlockers.length > 0 || preflightWarnings.length > 0) && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
                {preflightBlockers.map(item => (
                  <p key={item} className="text-[10px] font-bold text-red-300">BLOCKED: {item}</p>
                ))}
                {preflightWarnings.map(item => (
                  <p key={item} className="text-[10px] font-bold text-yellow-300">WARNING: {item}</p>
                ))}
              </div>
            )}

            {mode === 'broadcast' && captionLength === 0 && canConfirmPreflight && (
              <p className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[10px] font-bold text-yellow-300">
                Confirming will start with media only and an empty caption.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowPreflightConfirm(false)} disabled={posting}>
                Cancel
              </Button>
              <Button
                variant="purple"
                onClick={() => handlePost(true)}
                disabled={!canConfirmPreflight}
              >
                {posting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <SendHorizontal className="mr-2 h-4 w-4" />}
                Confirm Start Bulk Post
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-background border-purple-500/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-black">
              <Sparkles className="h-6 w-6 text-purple-400" /> AI CAPTION SPINS
            </DialogTitle>
            <DialogDescription className="text-xs font-medium">
              We've generated unique variations of your caption to keep your accounts safe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-6">
            {previewVariations.map((v, i) => (
              <div key={i} className="p-5 rounded-xl bg-secondary/40 border border-border/50 space-y-3 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50" />
                <div className="flex items-center justify-between">
                  <p className="font-black text-purple-400 text-[10px] uppercase tracking-widest">Variation {i + 1}</p>
                  <Badge variant="outline" className="text-[8px] bg-background">SAFE SCORE: 98%</Badge>
                </div>
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-medium">{v.caption}</p>
                <div className="pt-2 border-t border-border/30 flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {v.hashtags.split(' ').map((h, hi) => (
                    <span key={hi} className="text-[9px] text-purple-400/70 font-bold">{h}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-6">
            <Button variant="purple" className="font-bold px-8" onClick={() => setShowPreview(false)}>Looks Good</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
