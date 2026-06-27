import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Target, Plus, Play, RefreshCw,
  ChevronRight, Users, SendHorizontal, Sparkles,
  CalendarClock, Activity, AlertTriangle, CheckCircle2,
  Clock, ListChecks, XCircle, Image, Video, FileText,
  Upload, Trash2, Copy, ExternalLink, CalendarRange, BarChart3, Archive,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import api, { accountGroupsApi, activityApi, campaignsApi } from '@/lib/api'
import { AccountLoadoutPresetManager } from '@/components/common/AccountLoadoutPresetManager'
import type { AccountLoadoutPreset } from '@/lib/accountLoadoutPresets'
import { CampaignTemplatePresetManager } from '@/components/common/CampaignTemplatePresetManager'
import type { CampaignTemplatePreset } from '@/lib/campaignTemplatePresets'
import {
  DEFAULT_LOCAL_WEBHOOK_ENDPOINT as defaultLocalWebhookEndpoint,
  buildAutomationDeliveryDiagnostics as buildAutomationDeliveryDiagnosticsFromModule,
  buildAutomationRequestPayload as buildAutomationRequestPayloadFromModule,
  buildUniversalAutomationSchema as buildUniversalAutomationSchemaFromModule,
  isAllowedLocalWebhookEndpoint as isAllowedLocalWebhookEndpointFromModule,
} from '@/lib/automation'
import type {
  AutomationCampaign,
  AutomationRequestPayload as ModuleAutomationRequestPayload,
  UniversalAutomationSchema as ModuleUniversalAutomationSchema,
} from '@/lib/automation'
import { AutomationRequestCenter } from '@/components/campaigns/AutomationRequestCenter'
import { CampaignPredictionPanel } from '@/components/campaigns/CampaignPredictionPanel'
import { CampaignLearningMemory as CampaignLearningMemoryPanel } from '@/components/campaigns/CampaignLearningMemory'

interface Account { id: string; username: string; platform: string; status: string }
interface AccountGroup { id: string; name: string; color?: string | null; memberCount: number }
interface ResolvePreview {
  totalResolved: number
  healthyCount: number
  skippedCount: number
  skippedAccounts: { accountId: string; username: string; health: string; reason: string }[]
}
interface CampaignPlanningSummary {
  selectedGroups?: { id: string; name: string; color?: string | null; memberCount: number }[]
  resolvedAccountIds?: string[]
  healthyAccountIds?: string[]
  skippedAccounts?: { accountId: string; username: string; health: string; reason: string }[]
  totalResolved?: number
  healthyCount?: number
  skippedCount?: number
  actionCount?: number
  estimatedPostingSpreadMinutes?: { min: number; max: number; average: number }
  estimatedQueueDurationMinutes?: number
  aiPlan?: CampaignAiPlan
  mediaLibrary?: CampaignMediaItem[]
  variationApprovals?: Record<string, VariationApproval>
  variationMediaReferences?: Record<string, VariationMediaReference>
}
interface CampaignAiPlan {
  strategySummary: string
  contentAngle: string
  suggestedCta: string
  suggestedHashtags: string[]
  postingTone: string
  contentVariations?: CampaignContentVariation[]
  captionSeed?: string
  generatedAt: string
  source: 'ai' | 'fallback'
  fallbackReason?: string
}
interface CampaignContentVariation {
  title: string
  targetGroupIntent: string
  visualDirection: string
  captionAngle: string
  cta: string
  suggestedHashtags: string[]
  formatRecommendation: 'single image' | 'carousel' | 'reels'
  priorityScore: number
}
interface CampaignMediaItem {
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
interface VariationMediaReference {
  primaryMediaId?: string
  secondaryMediaId?: string
}
type VariationApprovalStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'USED'
type CalendarFilter = 'ALL' | 'PENDING' | 'READY' | 'FAILED' | 'TODAY' | 'THIS_WEEK'
type PreparationFilter = 'ALL' | 'MISSING_MEDIA' | 'MISSING_AI' | 'NEEDS_APPROVAL' | 'READY' | 'FAILED'
interface VariationApproval {
  status: VariationApprovalStatus
  reviewerNote?: string
  reviewedAt?: string
}
interface Campaign {
  id: string; name: string; type: string; targetType: string; targetValue: string
  accountIds: string[]; status: string; totalActions: number; completedActions: number
  failedActions: number; createdAt: string; completedAt?: string; groupIds?: string[]
  scheduledAt?: string | null; schedulerStatus?: 'PENDING' | 'READY' | 'EXECUTED' | 'FAILED' | 'CANCELLED'
  lastExecutionAt?: string | null
  planningSummary?: CampaignPlanningSummary | null
}

interface QueueSummary {
  queued: number
  active: number
  delayed: number
  completedToday: number
  failedToday: number
  unavailable?: boolean
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  running: 'bg-green-500/20 text-green-400 border-green-500/30',
  paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  stopped: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const SCHEDULER_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  READY: 'bg-green-500/20 text-green-300 border-green-500/30',
  EXECUTED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  FAILED: 'bg-red-500/20 text-red-300 border-red-500/30',
  CANCELLED: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
}

const APPROVAL_STATUS_STYLES: Record<VariationApprovalStatus, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  NEEDS_REVIEW: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  APPROVED: 'bg-green-500/15 text-green-300 border-green-500/30',
  REJECTED: 'bg-red-500/15 text-red-300 border-red-500/30',
  USED: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
}

const TYPE_LABELS: Record<string, string> = {
  follow: '👤 Follow', like: '❤️ Like', comment: '💬 Comment',
  mixed: '🔄 Mixed', follow_and_like: '👤❤️ Follow+Like',
}

const CAMPAIGN_OBJECTIVES = [
  'Product Push',
  'Awareness',
  'Hashtag Push',
  'Education',
  'Showroom Push',
  'Engagement Swarm',
  'Warming',
  'Experimental',
] as const

type CampaignObjective = typeof CAMPAIGN_OBJECTIVES[number]

const CAMPAIGN_OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  'Product Push': 'Jual Produk',
  Awareness: 'Bangun Awareness',
  'Hashtag Push': 'Dorong Hashtag',
  Education: 'Edukasi Audience',
  'Showroom Push': 'Dorong Showroom',
  'Engagement Swarm': 'Distribusi Engagement',
  Warming: 'Warming Account',
  Experimental: 'Eksperimen Campaign',
}

const OBJECTIVE_TO_ACTION_TYPE: Record<CampaignObjective, string> = {
  'Product Push': 'mixed',
  Awareness: 'mixed',
  'Hashtag Push': 'mixed',
  Education: 'mixed',
  'Showroom Push': 'mixed',
  'Engagement Swarm': 'mixed',
  Warming: 'follow',
  Experimental: 'mixed',
}

const AUDIENCE_SOURCES = [
  'Material / Topic',
  'Hashtag',
  'Username',
  'Post URL',
  'Competitor',
  'Location',
  'Manual Notes',
] as const

type AudienceSource = typeof AUDIENCE_SOURCES[number]

const AUDIENCE_SOURCE_LABELS: Record<AudienceSource, string> = {
  'Material / Topic': 'Material / Topik',
  Hashtag: 'Hashtag',
  Username: 'Username',
  'Post URL': 'Link Postingan',
  Competitor: 'Kompetitor',
  Location: 'Lokasi',
  'Manual Notes': 'Catatan Manual',
}

const AUDIENCE_SOURCE_TO_TARGET_TYPE: Record<AudienceSource, string> = {
  'Material / Topic': 'hashtag',
  Hashtag: 'hashtag',
  Username: 'username',
  'Post URL': 'post_url',
  Competitor: 'hashtag',
  Location: 'hashtag',
  'Manual Notes': 'hashtag',
}

function objectiveFromActionType(actionType: string): CampaignObjective {
  if (actionType === 'follow') return 'Warming'
  if (actionType === 'comment') return 'Education'
  if (actionType === 'like' || actionType === 'follow_and_like') return 'Awareness'
  return 'Engagement Swarm'
}

function audienceSourceFromTargetType(nextTargetType: string): AudienceSource {
  if (nextTargetType === 'username') return 'Username'
  if (nextTargetType === 'post_url') return 'Post URL'
  return 'Hashtag'
}

function inferCampaignObjective(campaign: Campaign): CampaignObjective {
  const text = `${campaign.targetValue || ''} ${campaign.name || ''}`.toLowerCase()
  if (/\b(marble|marmer|granite|granit|onyx|statuario|monaco|calacatta|promo)\b/.test(text)) return 'Product Push'
  if (/\b(showroom|bali|jakarta)\b/.test(text)) return 'Showroom Push'
  if (/\b(edukasi|tips|inspiration)\b/.test(text)) return 'Education'
  if (campaign.type === 'follow') return 'Warming'
  return 'Engagement Swarm'
}

function inferAudienceSource(campaign: Campaign): AudienceSource {
  const targetValue = (campaign.targetValue || '').trim()
  const lowerTargetValue = targetValue.toLowerCase()
  if (lowerTargetValue.includes('instagram.com/p/')) return 'Post URL'
  if (targetValue.startsWith('#')) return 'Hashtag'
  if (targetValue.startsWith('@')) return 'Username'
  if (targetValue) return 'Material / Topic'
  return 'Material / Topic'
}

function formatDuration(minutes?: number) {
  const value = Math.max(0, Math.round(minutes || 0))
  if (value < 60) return `${value}m`
  const hours = Math.floor(value / 60)
  const mins = value % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function endOfWeek(date: Date) {
  const day = date.getDay()
  const daysUntilSunday = 6 - day
  return endOfDay(addDays(date, daysUntilSunday))
}

function isBetween(date: Date, start: Date, end: Date) {
  return date >= start && date <= end
}

function approvalSummary(campaign: Campaign) {
  const variations = campaign.planningSummary?.aiPlan?.contentVariations || []
  const approvals = campaign.planningSummary?.variationApprovals || {}
  return variations.reduce<Record<VariationApprovalStatus, number>>((summary, variation, index) => {
    const key = `${variation.title}-${index}`
    const status = approvals[key]?.status || 'DRAFT'
    summary[status] = (summary[status] || 0) + 1
    return summary
  }, { DRAFT: 0, NEEDS_REVIEW: 0, APPROVED: 0, REJECTED: 0, USED: 0 })
}

function approvalReadiness(campaign: Campaign) {
  const aiPlan = campaign.planningSummary?.aiPlan
  const variations = aiPlan?.contentVariations || []
  const approvals = campaign.planningSummary?.variationApprovals || {}

  if (!aiPlan) {
    return {
      status: 'MISSING_AI' as const,
      approvedCount: 0,
      totalCount: 0,
      reason: 'AI preview missing',
      needsApprovalCount: 0,
      rejectedCount: 0,
    }
  }

  if (variations.length === 0) {
    return {
      status: 'READY' as const,
      approvedCount: 0,
      totalCount: 0,
      reason: 'No content variations to review',
      needsApprovalCount: 0,
      rejectedCount: 0,
    }
  }

  let approvedCount = 0
  let needsApprovalCount = 0
  let rejectedCount = 0

  variations.forEach((variation, index) => {
    const key = `${variation.title}-${index}`
    const status = approvals[key]?.status || 'DRAFT'
    if (status === 'APPROVED' || status === 'USED') approvedCount += 1
    else if (status === 'REJECTED') rejectedCount += 1
    else needsApprovalCount += 1
  })

  if (rejectedCount > 0) {
    return {
      status: 'NEEDS_APPROVAL' as const,
      approvedCount,
      totalCount: variations.length,
      reason: `${rejectedCount} rejected variation${rejectedCount === 1 ? '' : 's'}`,
      needsApprovalCount,
      rejectedCount,
    }
  }

  if (needsApprovalCount > 0) {
    return {
      status: 'NEEDS_APPROVAL' as const,
      approvedCount,
      totalCount: variations.length,
      reason: `${needsApprovalCount} variation${needsApprovalCount === 1 ? '' : 's'} still need approval`,
      needsApprovalCount,
      rejectedCount,
    }
  }

  return {
    status: 'READY' as const,
    approvedCount,
    totalCount: variations.length,
    reason: 'All variations approved or used',
    needsApprovalCount,
    rejectedCount,
  }
}

function campaignReadiness(campaign: Campaign) {
  const media = mediaSummary(campaign)
  const approvals = approvalReadiness(campaign)
  const schedulerStatus = campaign.schedulerStatus || 'PENDING'
  const healthyAccounts = campaign.planningSummary?.healthyCount ?? campaign.accountIds.length
  const skippedAccounts = campaign.planningSummary?.skippedCount ?? 0
  const hasMedia = media.total > 0
  const hasAI = Boolean(campaign.planningSummary?.aiPlan)
  const isSchedulerReady = schedulerStatus === 'READY'
  const isHealthy = healthyAccounts > 0
  const isReady = isSchedulerReady && hasMedia && hasAI && approvals.status === 'READY' && isHealthy

  return {
    media,
    approvals,
    schedulerStatus,
    healthyAccounts,
    skippedAccounts,
    hasMedia,
    hasAI,
    isHealthy,
    isReady,
    missingMedia: !hasMedia,
    missingAI: !hasAI,
    needsApproval: approvals.status === 'NEEDS_APPROVAL',
    failed: schedulerStatus === 'FAILED' || campaign.status === 'stopped' || campaign.failedActions > 0,
  }
}

function buildNextAction(campaign: Campaign) {
  const readiness = campaignReadiness(campaign)

  if (!readiness.isHealthy) {
    return {
      key: 'activity' as const,
      title: 'Akun Tidak Siap',
      description: 'Tidak ada akun sehat untuk campaign ini.',
      primaryLabel: 'Lihat Aktivitas',
    }
  }

  if (readiness.missingMedia) {
    return {
      key: 'media' as const,
      title: 'Upload Konten',
      description: 'Campaign membutuhkan media utama sebelum distribusi dimulai.',
      primaryLabel: 'Upload Konten',
    }
  }

  if (readiness.missingAI) {
    return {
      key: 'ai' as const,
      title: 'Generate Preview AI',
      description: 'Buat caption dan variasi AI untuk campaign ini.',
      primaryLabel: 'Generate Preview AI',
    }
  }

  if (readiness.needsApproval || readiness.approvals.status !== 'READY') {
    return {
      key: 'detail' as const,
      title: 'Review & Approval',
      description: 'Review hasil AI sebelum campaign didistribusikan.',
      primaryLabel: 'Lihat Detail',
    }
  }

  if (readiness.isReady) {
    return {
      key: 'compose' as const,
      title: 'Mulai Distribusi',
      description: 'Campaign siap dibuka di Compose untuk distribusi manual.',
      primaryLabel: 'Buka Compose',
    }
  }

  return {
    key: 'detail' as const,
    title: readiness.schedulerStatus === 'FAILED' ? 'Review Scheduler' : 'Menunggu Scheduler',
    description: readiness.schedulerStatus === 'FAILED'
      ? 'Scheduler gagal, cek aktivitas sebelum melanjutkan.'
      : 'Konten, AI, dan approval siap; cek jadwal sebelum distribusi.',
    primaryLabel: 'Lihat Detail',
  }
}

type CampaignLifecycleStage = {
  label: string
  status: 'done' | 'active' | 'upcoming'
}

function buildCampaignLifecycle(campaign: Campaign): CampaignLifecycleStage[] {
  const readiness = campaignReadiness(campaign)
  const approvalDone = readiness.approvals.status === 'READY'
  const composeOpenedOrScheduled = Boolean(campaign.scheduledAt)
    || ['READY', 'EXECUTED'].includes(readiness.schedulerStatus)
    || campaign.completedActions > 0
  const isDistributing = campaign.status === 'running' || campaign.status === 'paused'
  const isMonitoring = campaign.status === 'running'
  const distributionDone = campaign.status === 'completed' || readiness.schedulerStatus === 'EXECUTED'

  return [
    {
      label: 'Konten',
      status: readiness.hasMedia ? 'done' : 'active',
    },
    {
      label: 'AI Preview',
      status: readiness.hasAI ? 'done' : readiness.hasMedia ? 'active' : 'upcoming',
    },
    {
      label: 'Approval',
      status: approvalDone ? 'done' : readiness.hasAI ? 'active' : 'upcoming',
    },
    {
      label: 'Compose',
      status: composeOpenedOrScheduled || isDistributing || distributionDone
        ? 'done'
        : approvalDone
          ? 'active'
          : 'upcoming',
    },
    {
      label: 'Distribusi',
      status: distributionDone
        ? 'done'
        : composeOpenedOrScheduled || isDistributing
          ? 'active'
          : 'upcoming',
    },
    {
      label: 'Monitoring',
      status: distributionDone
        ? 'done'
        : isMonitoring
          ? 'active'
          : 'upcoming',
    },
  ]
}

function buildCampaignIntelligence(campaign: Campaign) {
  const readiness = campaignReadiness(campaign)
  const brief = buildSwarmBrief(campaign)
  const brandRoles = buildBrandRoles(campaign)
  const topic = brief.topic || campaign.targetValue || campaign.name
  const lowerContext = `${campaign.name} ${campaign.targetValue} ${brief.contentAngles.join(' ')}`.toLowerCase()
  const objectiveLabel = CAMPAIGN_OBJECTIVE_LABELS[brief.objective]
  const audienceLabel = AUDIENCE_SOURCE_LABELS[brief.audienceSource]
  const destination = brandRoles[0]?.brand || 'brand utama'

  const contentPriority = [
    lowerContext.includes('kitchen') || lowerContext.includes('dapur') ? 'kitchen application' : 'interior inspiration',
    lowerContext.includes('grey') || lowerContext.includes('marble') || lowerContext.includes('stone') ? 'texture close-up' : 'product detail',
    brief.objective === 'Showroom Push' ? 'showroom walkthrough' : 'cinematic reels',
    'before-after',
  ]

  const swarmStrategy = [
    'Akun Interior',
    lowerContext.includes('villa') || lowerContext.includes('bali') ? 'Akun Villa Bali' : 'Akun Rumah Mewah',
    'Akun Arsitektur',
    brief.objective === 'Education' ? 'Akun Kontraktor' : 'Akun Studio Design',
    audienceLabel === 'Kompetitor' ? 'Audience Kompetitor' : 'Akun Kontraktor',
  ]

  const riskNotes = [
    readiness.missingMedia ? 'Campaign masih belum memiliki media utama.' : '',
    readiness.missingAI ? 'Belum ada AI preview.' : '',
    readiness.needsApproval ? 'AI preview masih perlu review dan approval.' : '',
    readiness.healthyAccounts <= 3 ? 'Jumlah akun sehat masih rendah.' : '',
    readiness.skippedAccounts > 0 ? `${readiness.skippedAccounts} akun dilewati karena kondisi health.` : '',
    readiness.schedulerStatus === 'FAILED' ? 'Scheduler gagal, cek aktivitas sebelum distribusi.' : '',
  ].filter(Boolean)

  return {
    insight: `${topic} cocok untuk ${objectiveLabel.toLowerCase()} dengan konteks ${audienceLabel.toLowerCase()} dan angle visual yang mudah discan operator.`,
    contentPriority: Array.from(new Set(contentPriority)).slice(0, 5),
    swarmStrategy: Array.from(new Set(swarmStrategy)).slice(0, 5),
    conversionDirection: `Traffic direkomendasikan ke ${destination}.`,
    postingWindows: ['11:00 - 13:00', '18:00 - 21:00'],
    riskNotes: riskNotes.length > 0 ? riskNotes : ['Campaign sudah siap secara operasional; tetap review Compose sebelum distribusi manual.'],
  }
}

type ContentFactoryRequest = {
  goal: string
  format: string
  visualStyle: string
  source: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  estimatedBatch: string
}

type AutomationPipelineStage = {
  name: string
  status: 'ready' | 'waiting' | 'simulated' | 'manual'
  description: string
}

type AutomationRequestStatus = 'Waiting' | 'Queued' | 'Preparing' | 'Ready'
type AutomationRequestState = {
  status: AutomationRequestStatus
  activity: string[]
}

type AutomationRequestType =
  | 'Generate Hero Reel'
  | 'Generate Carousel'
  | 'Generate Before-After'
  | 'Generate Story Pack'
  | 'Generate AI Caption Batch'

type AutomationSimulationStatus = 'queued' | 'preparing' | 'waiting render' | 'completed'

type AutomationDestinationPipeline = 'n8n' | 'ComfyUI' | 'AI Writer'

type AutomationRequestPayload = {
  requestId: string
  queuedTime: string
  automationStatus: AutomationSimulationStatus
  destinationPipeline: AutomationDestinationPipeline[]
  campaign: {
    id: string
    name: string
    status: string
  }
  materialTopic: string
  objective: string
  contentType: AutomationRequestType
  targetFormat: string
  visualStyle: string
  destinationBrand: string
  estimatedBatch: string
  simulationOnly: true
}

type AutomationRequestLogEntry = {
  requestId: string
  requestType: AutomationRequestType
  status: AutomationSimulationStatus
  queuedTime: string
  updatedAt: string
  destinationPipeline: AutomationDestinationPipeline[]
  summary: string
}

type UniversalAutomationSchema = {
  core: {
    requestId: string
    campaignId: string
    campaignName: string
    objective: string
    materialTopic: string
    destinationBrand: string
    orchestrationVersion: string
  }
  production: {
    contentType: AutomationRequestType
    format: string
    resolution: string
    aspectRatio: string
    visualStyle: string
    visualMood: string
    renderComplexity: 'low' | 'medium' | 'high'
  }
  ai: {
    captionSeed: string
    hookSeed: string
    CTA: string
    hashtagSet: string[]
    variationCount: number
    promptDirection: string
  }
  distribution: {
    accountTypeTargets: string[]
    estimatedBatch: string
    postingWindow: string[]
    distributionPriority: 'HIGH' | 'MEDIUM' | 'LOW'
    targetPlatforms: string[]
  }
  pipeline: {
    destinationPipeline: AutomationDestinationPipeline[]
    automationStage: string
    orchestrationStatus: AutomationSimulationStatus
  }
}

type AutomationSchemaTab = keyof UniversalAutomationSchema

type LocalWebhookResultStatus = 'idle' | 'sending' | 'success' | 'offline' | 'timeout' | 'invalid' | 'blocked'

type LocalWebhookResult = {
  status: LocalWebhookResultStatus
  httpStatus?: number
  responseTimeMs?: number
  responsePayload?: unknown
  error?: string
  endpoint?: string
  sentAt?: string
}

type LocalWebhookHistoryEntry = LocalWebhookResult & {
  id: string
  requestId: string
  campaignName: string
}

type PayloadValidationSeverity = 'valid' | 'warning' | 'failed'

type PayloadValidationIssue = {
  severity: Exclude<PayloadValidationSeverity, 'valid'>
  message: string
}

type AutomationDeliveryDiagnostics = {
  schemaVersion: string
  payloadSizeBytes: number
  sendTimestamp: string
  responseTimestamp: string
  latencyMs?: number
  endpointValidation: 'local-only safe' | 'blocked' | 'invalid'
  responseValidity: 'valid' | 'warning' | 'failed' | 'pending'
  deliveryStatus: 'idle' | 'sending' | 'delivered' | 'warning' | 'failed' | 'blocked'
  checksum: string
  validationStatus: PayloadValidationSeverity
  validationIssues: PayloadValidationIssue[]
  compatibility: {
    n8n: boolean
    comfyUI: boolean
    aiWriter: boolean
    futureAgent: boolean
  }
}

type GeneratedContentItem = {
  title: string
  status: 'WAITING' | 'PROCESSING' | 'READY' | 'FAILED'
  source: 'ComfyUI' | 'Manual Design' | 'AI Enhancement'
  format: 'Reels 9:16' | 'Carousel 4:5' | 'Story'
  estimatedSize: '1080x1920' | '1080x1350'
}

type ContentScore = {
  qualityScore: number
  aiConfidence: 'Strong' | 'Medium' | 'Weak'
  distributionPriority: 'HIGH' | 'MEDIUM' | 'LOW'
  readiness: 'Ready to Compose' | 'Needs Review' | 'Waiting Assets'
}

type AccountMatchmaking = {
  recommendedAccountTypes: string[]
  distributionSize: string
  engagementFit: 'Strong' | 'Medium' | 'Weak'
  postingStyle: string
}

type CampaignPrediction = {
  strengthScore: number
  estimatedReach: string
  conversionPotential: 'Strong' | 'Medium' | 'Weak'
  riskLevel: 'Low' | 'Medium' | 'High'
  distributionReadiness: number
  contentDiversity: number
  postingStability: number
  recommendation: string
}

type CampaignLearningMemory = {
  learningInsight: string
  optimizationSuggestion: string
  patternWarning: string
  recommendedImprovement: string
  historicalComparison: string
  badges: string[]
}

function buildAutomationRequestState(state?: Partial<AutomationRequestState>): AutomationRequestState {
  return {
    status: state?.status || 'Waiting',
    activity: state?.activity || [],
  }
}

const AUTOMATION_STATUS_STYLES: Record<AutomationSimulationStatus, string> = {
  queued: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  preparing: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  'waiting render': 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  completed: 'border-green-500/30 bg-green-500/10 text-green-300',
}

const AUTOMATION_REQUEST_SPECS: Record<AutomationRequestType, {
  targetFormat: string
  visualStyle: string
  estimatedBatch: string
  destinationPipeline: AutomationDestinationPipeline[]
}> = {
  'Generate Hero Reel': {
    targetFormat: 'Reels 9:16 / 1080x1920',
    visualStyle: 'luxury cinematic opener',
    estimatedBatch: '3 hero reel variants',
    destinationPipeline: ['n8n', 'ComfyUI', 'AI Writer'],
  },
  'Generate Carousel': {
    targetFormat: 'Carousel 4:5 / 1080x1350',
    visualStyle: 'editorial product sequence',
    estimatedBatch: '5 carousel slides',
    destinationPipeline: ['n8n', 'ComfyUI', 'AI Writer'],
  },
  'Generate Before-After': {
    targetFormat: 'Before-after carousel / 4:5',
    visualStyle: 'project transformation storyboard',
    estimatedBatch: '2 before-after concepts',
    destinationPipeline: ['n8n', 'ComfyUI', 'AI Writer'],
  },
  'Generate Story Pack': {
    targetFormat: 'Stories 9:16 / 1080x1920',
    visualStyle: 'fast conversion story frames',
    estimatedBatch: '4 story frames',
    destinationPipeline: ['n8n', 'ComfyUI', 'AI Writer'],
  },
  'Generate AI Caption Batch': {
    targetFormat: 'Caption batch / multi-account',
    visualStyle: 'caption only, tone-matched',
    estimatedBatch: '12 caption variations',
    destinationPipeline: ['n8n', 'AI Writer'],
  },
}

const AUTOMATION_REQUEST_TYPES = Object.keys(AUTOMATION_REQUEST_SPECS) as AutomationRequestType[]
const DEFAULT_LOCAL_WEBHOOK_ENDPOINT = 'http://localhost:5678/webhook/rockbase-simulation'

function buildAutomationRequestPayload(
  campaign: Campaign,
  requestType: AutomationRequestType,
  status: AutomationSimulationStatus = 'queued',
): AutomationRequestPayload {
  const brief = buildSwarmBrief(campaign)
  const brandRoles = buildBrandRoles(campaign)
  const spec = AUTOMATION_REQUEST_SPECS[requestType]

  return {
    requestId: `sim-${campaign.id.slice(0, 6)}-${Date.now().toString(36)}`,
    queuedTime: new Date().toISOString(),
    automationStatus: status,
    destinationPipeline: spec.destinationPipeline,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
    },
    materialTopic: brief.topic || campaign.targetValue || campaign.name,
    objective: CAMPAIGN_OBJECTIVE_LABELS[brief.objective],
    contentType: requestType,
    targetFormat: spec.targetFormat,
    visualStyle: spec.visualStyle,
    destinationBrand: brandRoles[0]?.brand || 'Brescia Stone',
    estimatedBatch: spec.estimatedBatch,
    simulationOnly: true,
  }
}

function parseAutomationFormat(targetFormat: string) {
  const resolutionMatch = targetFormat.match(/\d{3,4}x\d{3,4}/)
  const aspectRatioMatch = targetFormat.match(/\b\d+:\d+\b/)
  return {
    format: targetFormat.split('/')[0]?.trim() || targetFormat,
    resolution: resolutionMatch?.[0] || (targetFormat.includes('caption') ? 'text-only' : '1080x1350'),
    aspectRatio: aspectRatioMatch?.[0] || (targetFormat.includes('9:16') ? '9:16' : targetFormat.includes('4:5') ? '4:5' : 'n/a'),
  }
}

function buildUniversalAutomationSchema(
  campaign: Campaign,
  payload?: AutomationRequestPayload,
): UniversalAutomationSchema {
  const fallbackPayload = payload || buildAutomationRequestPayload(campaign, 'Generate Hero Reel')
  const aiPlan = campaign.planningSummary?.aiPlan
  const intelligence = buildCampaignIntelligence(campaign)
  const prediction = buildCampaignPrediction(campaign)
  const parsedFormat = parseAutomationFormat(fallbackPayload.targetFormat)
  const hasRender = fallbackPayload.destinationPipeline.includes('ComfyUI')
  const variationCount = aiPlan?.contentVariations?.length || (fallbackPayload.contentType === 'Generate AI Caption Batch' ? 12 : 3)
  const renderComplexity: UniversalAutomationSchema['production']['renderComplexity'] = !hasRender
    ? 'low'
    : fallbackPayload.contentType === 'Generate Hero Reel' || fallbackPayload.contentType === 'Generate Before-After'
      ? 'high'
      : 'medium'
  const visualMood = intelligence.contentPriority.includes('before-after')
    ? 'transformational proof'
    : fallbackPayload.visualStyle.includes('cinematic')
      ? 'premium cinematic'
      : 'clean conversion-focused'

  return {
    core: {
      requestId: fallbackPayload.requestId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      objective: fallbackPayload.objective,
      materialTopic: fallbackPayload.materialTopic,
      destinationBrand: fallbackPayload.destinationBrand,
      orchestrationVersion: 'rockbase.orchestration.v1.simulation',
    },
    production: {
      contentType: fallbackPayload.contentType,
      format: parsedFormat.format,
      resolution: parsedFormat.resolution,
      aspectRatio: parsedFormat.aspectRatio,
      visualStyle: fallbackPayload.visualStyle,
      visualMood,
      renderComplexity,
    },
    ai: {
      captionSeed: aiPlan?.captionSeed || aiPlan?.strategySummary || fallbackPayload.materialTopic,
      hookSeed: aiPlan?.contentAngle || `Lead with ${fallbackPayload.materialTopic}`,
      CTA: aiPlan?.suggestedCta || `Arahkan audience ke ${fallbackPayload.destinationBrand}`,
      hashtagSet: aiPlan?.suggestedHashtags || [],
      variationCount,
      promptDirection: aiPlan?.contentAngle || `Create ${fallbackPayload.contentType} for ${fallbackPayload.materialTopic} in ${fallbackPayload.visualStyle} style.`,
    },
    distribution: {
      accountTypeTargets: intelligence.swarmStrategy,
      estimatedBatch: fallbackPayload.estimatedBatch,
      postingWindow: intelligence.postingWindows,
      distributionPriority: prediction.strengthScore >= 76 ? 'HIGH' : prediction.strengthScore >= 52 ? 'MEDIUM' : 'LOW',
      targetPlatforms: ['Instagram'],
    },
    pipeline: {
      destinationPipeline: fallbackPayload.destinationPipeline,
      automationStage: hasRender ? 'orchestration-render-copy' : 'orchestration-copy-only',
      orchestrationStatus: fallbackPayload.automationStatus,
    },
  }
}

function nextAutomationStatus(status: AutomationSimulationStatus): AutomationSimulationStatus {
  if (status === 'queued') return 'preparing'
  if (status === 'preparing') return 'waiting render'
  if (status === 'waiting render') return 'completed'
  return 'queued'
}

function isAllowedLocalWebhookEndpoint(value: string) {
  try {
    const url = new URL(value)
    const hn = url.hostname
    const isLocal = Boolean(
      ['localhost', '127.0.0.1', '[::1]'].includes(hn) ||
      hn.startsWith('192.168.') ||
      hn.startsWith('10.') ||
      hn.startsWith('172.') ||
      hn.match(/^100\.(6[4-9]|[7-9]\d|1\d\d|12[0-7])\./) // Tailscale 100.64.0.0/10
    )
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLocal && url.pathname.length > 1
  } catch {
    return false
  }
}

function buildPayloadChecksum(value: unknown) {
  const input = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `sim-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function validateUniversalAutomationSchema(schema: UniversalAutomationSchema): PayloadValidationIssue[] {
  const issues: PayloadValidationIssue[] = []

  if (!schema.core || !schema.core.requestId || !schema.core.campaignId || !schema.core.orchestrationVersion) {
    issues.push({ severity: 'failed', message: 'Missing core section or required core fields.' })
  }

  if (!schema.production || !schema.production.contentType || !schema.production.format || !schema.production.resolution) {
    issues.push({ severity: 'failed', message: 'Missing production section or required production fields.' })
  }

  if (!schema.pipeline?.destinationPipeline?.length || !schema.pipeline.destinationPipeline.includes('n8n')) {
    issues.push({ severity: 'failed', message: 'Invalid pipeline: destinationPipeline must include n8n.' })
  }

  if (!schema.ai?.captionSeed || !schema.ai?.hookSeed || !schema.ai?.CTA || !schema.ai?.promptDirection) {
    issues.push({ severity: 'warning', message: 'One or more AI fields are empty.' })
  }

  const supportedFormats = ['reels', 'carousel', 'story', 'caption', 'before-after']
  const formatText = `${schema.production?.format || ''} ${schema.production?.aspectRatio || ''} ${schema.production?.resolution || ''}`.toLowerCase()
  if (!supportedFormats.some(format => formatText.includes(format)) && schema.production?.resolution !== 'text-only') {
    issues.push({ severity: 'warning', message: 'Unsupported or unfamiliar production format.' })
  }

  return issues
}

function buildAutomationDeliveryDiagnostics(
  schema: UniversalAutomationSchema,
  result: LocalWebhookResult,
  endpoint: string,
): AutomationDeliveryDiagnostics {
  const validationIssues = validateUniversalAutomationSchema(schema)
  const validationStatus: PayloadValidationSeverity = validationIssues.some(issue => issue.severity === 'failed')
    ? 'failed'
    : validationIssues.some(issue => issue.severity === 'warning')
      ? 'warning'
      : 'valid'
  const endpointValidation = isAllowedLocalWebhookEndpoint(endpoint)
    ? 'local-only safe'
    : endpoint.trim()
      ? 'blocked'
      : 'invalid'
  const responseValidity: AutomationDeliveryDiagnostics['responseValidity'] = result.status === 'idle' || result.status === 'sending'
    ? 'pending'
    : result.status === 'success'
      ? 'valid'
      : result.status === 'invalid'
        ? 'warning'
        : 'failed'
  const deliveryStatus: AutomationDeliveryDiagnostics['deliveryStatus'] = result.status === 'idle'
    ? 'idle'
    : result.status === 'sending'
      ? 'sending'
      : result.status === 'success'
        ? 'delivered'
        : result.status === 'blocked'
          ? 'blocked'
          : result.status === 'invalid'
            ? 'warning'
            : 'failed'

  return {
    schemaVersion: schema.core.orchestrationVersion,
    payloadSizeBytes: new Blob([JSON.stringify(schema)]).size,
    sendTimestamp: result.sentAt || '-',
    responseTimestamp: result.status === 'idle' || result.status === 'sending' ? '-' : new Date().toISOString(),
    latencyMs: result.responseTimeMs,
    endpointValidation,
    responseValidity,
    deliveryStatus,
    checksum: buildPayloadChecksum(schema),
    validationStatus,
    validationIssues,
    compatibility: {
      n8n: schema.pipeline.destinationPipeline.includes('n8n') && endpointValidation === 'local-only safe',
      comfyUI: schema.pipeline.destinationPipeline.includes('ComfyUI') && schema.production.resolution !== 'text-only',
      aiWriter: schema.pipeline.destinationPipeline.includes('AI Writer') && Boolean(schema.ai.promptDirection),
      futureAgent: Boolean(schema.core.orchestrationVersion && schema.pipeline.automationStage && schema.distribution.targetPlatforms.length),
    },
  }
}

async function readWebhookResponse(response: Response) {
  const text = await response.text()
  if (!text.trim()) return { ok: true }

  try {
    return JSON.parse(text)
  } catch {
    return {
      raw: text,
      parseWarning: 'Response was not valid JSON.',
    }
  }
}

function buildGeneratedContentWorkspace(campaign: Campaign): GeneratedContentItem[] {
  const readiness = campaignReadiness(campaign)
  const requests = buildContentFactoryRequests(campaign)
  const isAutomationReady = readiness.hasMedia && readiness.hasAI
  const statusByIndex = (index: number): GeneratedContentItem['status'] => {
    if (readiness.schedulerStatus === 'FAILED' && index === 4) return 'FAILED'
    if (isAutomationReady && index < 2) return 'READY'
    if (readiness.hasMedia && index === 2) return 'PROCESSING'
    return 'WAITING'
  }
  const sourceByGoal = (goal: string, fallback: GeneratedContentItem['source']): GeneratedContentItem['source'] => {
    const source = requests.find(request => request.goal === goal)?.source
    if (source === 'ComfyUI' || source === 'Manual Design' || source === 'AI Enhancement') return source
    return fallback
  }

  return [
    {
      title: 'Hero Reel',
      status: statusByIndex(0),
      source: sourceByGoal('Hero reels', 'ComfyUI'),
      format: 'Reels 9:16',
      estimatedSize: '1080x1920',
    },
    {
      title: 'Interior Carousel',
      status: statusByIndex(1),
      source: sourceByGoal('Interior inspiration', 'Manual Design'),
      format: 'Carousel 4:5',
      estimatedSize: '1080x1350',
    },
    {
      title: 'Product Close-up',
      status: statusByIndex(2),
      source: sourceByGoal('Product close-up', 'AI Enhancement'),
      format: 'Carousel 4:5',
      estimatedSize: '1080x1350',
    },
    {
      title: 'Before-After',
      status: statusByIndex(3),
      source: sourceByGoal('Before-after', 'Manual Design'),
      format: 'Carousel 4:5',
      estimatedSize: '1080x1350',
    },
    {
      title: 'Story Variant',
      status: statusByIndex(4),
      source: 'ComfyUI',
      format: 'Story',
      estimatedSize: '1080x1920',
    },
  ]
}

function buildCampaignPrediction(campaign: Campaign): CampaignPrediction {
  const readiness = campaignReadiness(campaign)
  const variations = campaign.planningSummary?.aiPlan?.contentVariations?.length || 0
  const healthyAccounts = readiness.healthyAccounts || 0
  const mediaBoost = readiness.hasMedia ? 16 : 0
  const aiBoost = readiness.hasAI ? 16 : 0
  const approvalBoost = readiness.approvals.status === 'READY' ? 12 : 0
  const accountBoost = Math.min(28, healthyAccounts * 3)
  const skippedPenalty = Math.min(18, readiness.skippedAccounts * 2)
  const failedPenalty = readiness.failed ? 18 : 0
  const strengthScore = Math.max(8, Math.min(100, 28 + mediaBoost + aiBoost + approvalBoost + accountBoost - skippedPenalty - failedPenalty))
  const estimatedReachMin = Math.max(healthyAccounts * 120, healthyAccounts > 0 ? 300 : 0)
  const estimatedReachMax = Math.max(estimatedReachMin + healthyAccounts * 260, healthyAccounts > 0 ? 900 : 250)
  const distributionReadiness = Math.max(0, Math.min(100, (readiness.hasMedia ? 30 : 0) + (readiness.hasAI ? 30 : 0) + (readiness.approvals.status === 'READY' ? 25 : 0) + (readiness.isHealthy ? 15 : 0)))
  const contentDiversity = Math.max(12, Math.min(100, readiness.media.total * 12 + variations * 18 + (readiness.hasAI ? 14 : 0)))
  const postingStability = Math.max(10, Math.min(100, 42 + Math.min(healthyAccounts * 5, 35) - skippedPenalty - failedPenalty))
  const riskLevel = !readiness.hasMedia || !readiness.hasAI || readiness.failed || healthyAccounts <= 2
    ? 'High'
    : readiness.skippedAccounts > 0 || readiness.approvals.status !== 'READY'
      ? 'Medium'
      : 'Low'
  const conversionPotential = strengthScore >= 78 && distributionReadiness >= 80
    ? 'Strong'
    : strengthScore >= 55
      ? 'Medium'
      : 'Weak'
  const recommendation = readiness.hasMedia && readiness.hasAI
    ? 'Campaign memiliki fondasi kuat; prioritaskan review Compose dan distribusi konten dengan score tertinggi.'
    : 'Campaign memiliki potensi distribusi kuat jika media utama dan AI preview selesai dipersiapkan.'

  return {
    strengthScore,
    estimatedReach: healthyAccounts > 0 ? `${estimatedReachMin.toLocaleString()} - ${estimatedReachMax.toLocaleString()}` : 'Rendah',
    conversionPotential,
    riskLevel,
    distributionReadiness,
    contentDiversity,
    postingStability,
    recommendation,
  }
}

function buildCampaignLearningMemory(campaign: Campaign): CampaignLearningMemory {
  const readiness = campaignReadiness(campaign)
  const prediction = buildCampaignPrediction(campaign)
  const generatedContent = buildGeneratedContentWorkspace(campaign)
  const scoredContent = generatedContent.map(item => ({
    item,
    score: buildContentScore(item, campaign),
  }))
  const readyContentCount = generatedContent.filter(item => item.status === 'READY').length
  const heroScore = scoredContent.find(entry => entry.item.title === 'Hero Reel')?.score.qualityScore || 0
  const diversityLow = prediction.contentDiversity < 55
  const accountLow = readiness.healthyAccounts <= 3

  return {
    learningInsight: readyContentCount > 1
      ? `${readyContentCount} konten sudah siap; campaign punya modal distribusi awal yang lebih kuat.`
      : heroScore >= 70
        ? 'Hero Reel terlihat sebagai kandidat konten pembuka paling kuat untuk campaign ini.'
        : 'Campaign masih perlu sinyal konten utama sebelum pola performa bisa dibaca lebih baik.',
    optimizationSuggestion: !readiness.hasAI
      ? 'Generate Preview AI agar sistem bisa membaca angle caption dan variasi konten.'
      : diversityLow
        ? 'Tambah variasi format seperti carousel, reels, dan story agar distribusi tidak monoton.'
        : 'Pertahankan variasi konten saat ini dan prioritaskan konten dengan score tertinggi.',
    patternWarning: accountLow
      ? 'Jumlah akun sehat rendah; distribusi bisa terlalu sempit dan kurang stabil.'
      : readiness.skippedAccounts > 0
        ? 'Ada akun dilewati; cek pola health sebelum memperbesar distribusi.'
        : 'Tidak ada warning besar dari simulasi behavior campaign.',
    recommendedImprovement: !readiness.hasMedia
      ? 'Upload media utama terlebih dahulu untuk membuka workspace produksi dan scoring.'
      : !readiness.hasAI
        ? 'Siapkan AI preview untuk memperkuat keputusan konten dan matching akun.'
        : 'Gunakan Hero Reel atau konten dengan score tertinggi sebagai distribusi pertama.',
    historicalComparison: prediction.strengthScore >= 75
      ? 'Simulasi menunjukkan campaign ini berada di atas baseline campaign serupa.'
      : prediction.strengthScore >= 50
        ? 'Simulasi menunjukkan campaign ini berada di level menengah dibanding campaign serupa.'
        : 'Simulasi menunjukkan campaign ini masih di bawah baseline readiness campaign serupa.',
    badges: [
      heroScore >= 70 ? 'Hero Reel strong' : 'Hero Reel needs input',
      diversityLow ? 'Diversity rendah' : 'Diversity cukup',
      accountLow ? 'Akun sehat terbatas' : 'Akun sehat stabil',
    ],
  }
}

function buildAccountMatchmaking(contentItem: GeneratedContentItem, campaign: Campaign): AccountMatchmaking {
  const readiness = campaignReadiness(campaign)
  const healthyCount = Math.max(0, readiness.healthyAccounts || campaign.accountIds.length || 0)
  const size = (ratio: number) => `${Math.max(1, Math.min(healthyCount || 1, Math.ceil((healthyCount || 1) * ratio)))} akun`

  if (contentItem.title === 'Hero Reel') {
    return {
      recommendedAccountTypes: ['Akun Interior', 'Akun Rumah Mewah', 'Akun Reels Aktif'],
      distributionSize: size(0.55),
      engagementFit: contentItem.status === 'READY' ? 'Strong' : 'Medium',
      postingStyle: 'Awali dengan hook visual kuat dan caption pendek.',
    }
  }

  if (contentItem.title === 'Before-After') {
    return {
      recommendedAccountTypes: ['Akun Kontraktor', 'Akun Project', 'Akun Arsitektur'],
      distributionSize: size(0.4),
      engagementFit: contentItem.status === 'WAITING' ? 'Weak' : 'Medium',
      postingStyle: 'Gunakan narasi transformasi sebelum dan sesudah.',
    }
  }

  if (contentItem.title === 'Story Variant') {
    return {
      recommendedAccountTypes: ['Akun Engagement', 'Akun Repost', 'Akun Story Aktif'],
      distributionSize: size(0.3),
      engagementFit: contentItem.status === 'FAILED' ? 'Weak' : 'Medium',
      postingStyle: 'Pakai copy singkat dengan arah klik atau balasan.',
    }
  }

  if (contentItem.title === 'Product Close-up') {
    return {
      recommendedAccountTypes: ['Akun Material', 'Akun Showroom', 'Akun Kontraktor'],
      distributionSize: size(0.45),
      engagementFit: contentItem.status === 'PROCESSING' ? 'Medium' : 'Strong',
      postingStyle: 'Tekankan detail tekstur, warna, dan aplikasi material.',
    }
  }

  return {
    recommendedAccountTypes: ['Akun Interior', 'Akun Studio Design', 'Akun Rumah Mewah'],
    distributionSize: size(0.45),
    engagementFit: contentItem.status === 'READY' ? 'Strong' : 'Medium',
    postingStyle: 'Gunakan angle inspirasi ruangan dan simpan CTA ringan.',
  }
}

function buildContentScore(contentItem: GeneratedContentItem, campaign: Campaign): ContentScore {
  const readiness = campaignReadiness(campaign)
  let score = 58

  if (contentItem.title === 'Hero Reel') score += 18
  if (contentItem.title === 'Interior Carousel') score += 10
  if (contentItem.source === 'ComfyUI') score += 8
  if (contentItem.source === 'AI Enhancement') score += 10
  if (contentItem.format === 'Reels 9:16') score += 6
  if (readiness.hasAI) score += 6
  if (readiness.hasMedia) score += 4
  if (contentItem.status === 'PROCESSING') score -= 12
  if (contentItem.status === 'WAITING') score -= 24
  if (contentItem.status === 'FAILED') score = 22

  const qualityScore = Math.max(0, Math.min(100, score))
  const aiConfidence = qualityScore >= 78 ? 'Strong' : qualityScore >= 55 ? 'Medium' : 'Weak'
  const distributionPriority = qualityScore >= 80 ? 'HIGH' : qualityScore >= 60 ? 'MEDIUM' : 'LOW'
  const readinessLabel = contentItem.status === 'READY'
    ? 'Ready to Compose'
    : contentItem.status === 'WAITING'
      ? 'Waiting Assets'
      : 'Needs Review'

  return {
    qualityScore,
    aiConfidence,
    distributionPriority,
    readiness: readinessLabel,
  }
}

function buildContentFactoryRequests(campaign: Campaign): ContentFactoryRequest[] {
  const brief = buildSwarmBrief(campaign)
  const intelligence = buildCampaignIntelligence(campaign)
  const brandRoles = buildBrandRoles(campaign)
  const lowerContext = `${campaign.name} ${campaign.targetValue} ${brief.contentAngles.join(' ')}`.toLowerCase()
  const materialStyle = lowerContext.includes('marble') || lowerContext.includes('stone')
    ? 'elegant marble showcase'
    : lowerContext.includes('interior') || lowerContext.includes('kitchen') || lowerContext.includes('dapur')
      ? 'bright interior'
      : 'clean minimal'
  const conversionTarget = brandRoles[0]?.brand || 'brand utama'
  const hasExistingMedia = (campaign.planningSummary?.mediaLibrary?.length || 0) > 0

  const priorityToRequest = (goal: string, index: number): ContentFactoryRequest => {
    const format = goal.toLowerCase().includes('reels')
      ? 'Reels 9:16'
      : goal.toLowerCase().includes('before')
        ? 'Carousel 4:5'
        : goal.toLowerCase().includes('showroom')
          ? 'Story'
          : 'Feed Image'
    const source = index === 0
      ? hasExistingMedia ? 'AI Enhancement' : 'ComfyUI'
      : index === 1
        ? 'Manual Design'
        : hasExistingMedia ? 'Existing Media Library' : 'ComfyUI'

    return {
      goal,
      format,
      visualStyle: goal.toLowerCase().includes('hero') || goal.toLowerCase().includes('reels')
        ? 'luxury cinematic'
        : materialStyle,
      source,
      priority: index === 0 ? 'HIGH' : index === 1 ? 'MEDIUM' : 'LOW',
      estimatedBatch: index === 0
        ? goal.toLowerCase().includes('reels') ? '5 reels' : '1 hero content'
        : index === 1
          ? '3 visual'
          : `2 visual untuk ${conversionTarget}`,
    }
  }

  const objectiveGoals = [
    brief.objective === 'Showroom Push' ? 'Showroom walkthrough' : 'Hero reels',
    brief.objective === 'Education' ? 'Product close-up' : 'Interior inspiration',
    intelligence.contentPriority.includes('before-after') ? 'Before-after' : 'Product close-up',
  ]

  return Array.from(new Set(objectiveGoals))
    .slice(0, 3)
    .map(priorityToRequest)
}

function buildAutomationPipeline(campaign: Campaign): AutomationPipelineStage[] {
  const readiness = campaignReadiness(campaign)
  const requests = buildContentFactoryRequests(campaign)
  const hasComfyRequest = requests.some(request => request.source === 'ComfyUI')
  const hasEnhancementRequest = requests.some(request => request.source === 'AI Enhancement')
  const hasMedia = readiness.media.total > 0
  const hasCaptionPlan = readiness.hasAI

  return [
    {
      name: 'Campaign Planning',
      status: 'ready',
      description: 'Objective, target, dan arah distribusi sudah terbaca dari campaign.',
    },
    {
      name: 'Content Request',
      status: requests.length > 0 ? 'ready' : 'waiting',
      description: requests.length > 0 ? `${requests.length} request produksi siap direncanakan.` : 'Belum ada request produksi konten.',
    },
    {
      name: 'Automation Queue',
      status: 'simulated',
      description: 'Slot automation future untuk n8n; belum mengirim job otomatis.',
    },
    {
      name: 'Visual Production',
      status: hasComfyRequest ? 'simulated' : 'manual',
      description: hasComfyRequest ? 'Simulasi produksi visual via ComfyUI.' : 'Produksi visual masih diarahkan manual.',
    },
    {
      name: 'AI Enhancement',
      status: hasEnhancementRequest ? 'simulated' : 'waiting',
      description: hasEnhancementRequest ? 'Media existing bisa ditingkatkan di pipeline AI.' : 'Menunggu media untuk enhancement.',
    },
    {
      name: 'Media Library',
      status: hasMedia ? 'ready' : 'waiting',
      description: hasMedia ? `${readiness.media.total} asset tersedia.` : 'Belum ada asset campaign.',
    },
    {
      name: 'AI Caption',
      status: hasCaptionPlan ? 'ready' : 'waiting',
      description: hasCaptionPlan ? 'AI preview dan variasi caption tersedia.' : 'Menunggu Generate Preview AI.',
    },
    {
      name: 'Compose',
      status: readiness.approvals.status === 'READY' ? 'manual' : 'waiting',
      description: readiness.approvals.status === 'READY' ? 'Siap dibuka manual di Compose.' : 'Menunggu review dan approval.',
    },
    {
      name: 'Distribution',
      status: readiness.isReady ? 'manual' : 'waiting',
      description: readiness.isReady ? 'Distribusi manual siap dimulai.' : 'Menunggu readiness lengkap.',
    },
    {
      name: 'Monitoring',
      status: campaign.status === 'running' ? 'ready' : 'waiting',
      description: campaign.status === 'running' ? 'Campaign berjalan dan perlu dipantau.' : 'Monitoring aktif setelah distribusi berjalan.',
    },
  ]
}

function mediaSummary(campaign: Campaign) {
  const media = campaign.planningSummary?.mediaLibrary || []
  return {
    total: media.length,
    references: media.filter(item => item.type === 'reference').length,
    images: media.filter(item => item.type === 'image').length,
    videos: media.filter(item => item.type === 'video').length,
  }
}

function buildSwarmBrief(campaign: Campaign) {
  const readiness = campaignReadiness(campaign)
  const aiPlan = campaign.planningSummary?.aiPlan
  const aiVariationAngles = (aiPlan?.contentVariations || [])
    .map(variation => variation.captionAngle || variation.visualDirection || variation.title)
    .filter(Boolean)
    .slice(0, 3)
  const fallbackAngles = [
    'Material close-up / texture detail',
    'Interior application inspiration',
    'Education / buying consideration',
  ]
  const contentAngles = aiVariationAngles.length > 0
    ? Array.from(new Set([aiPlan?.contentAngle, ...aiVariationAngles].filter(Boolean))).slice(0, 3)
    : fallbackAngles
  const swarmActions = [
    'Sebarkan variasi konten',
    'Dorong hashtag serupa',
    'Distribusikan melalui grup akun sehat',
  ]
  const nextStep = readiness.missingMedia
    ? 'Upload Konten'
    : readiness.missingAI
      ? 'Generate Preview AI'
      : readiness.needsApproval
        ? 'Butuh Approval'
        : readiness.isReady
          ? 'Buka Compose'
          : 'Review readiness blockers'

  return {
    title: 'Ringkasan Distribusi',
    topic: campaign.targetValue || campaign.name,
    objective: inferCampaignObjective(campaign),
    audienceSource: inferAudienceSource(campaign),
    contentAngles,
    swarmActions,
    nextStep,
  }
}

function buildCampaignWaves(campaign: Campaign) {
  const readiness = campaignReadiness(campaign)
  const brief = buildSwarmBrief(campaign)
  const firstRecommendedAction = readiness.missingMedia
    ? 'Upload Konten'
    : readiness.missingAI
      ? 'Generate Preview AI'
      : readiness.isReady
        ? 'Buka Compose'
        : 'Review readiness blockers'

  return [
    {
      title: 'Topic Seeding',
      purpose: 'Introduce material/topic with safest healthy accounts.',
      contentFocus: ['hero visual', 'room inspiration', 'simple caption seed'],
      recommendedAction: firstRecommendedAction,
    },
    {
      title: 'Sebar Variasi',
      purpose: 'Distribute visual and caption variations across account groups.',
      contentFocus: ['material close-up', 'texture detail', 'interior application'],
      recommendedAction: 'Generate Preview AI dan gunakan caption di Compose',
    },
    {
      title: 'Hashtag Reinforcement',
      purpose: 'Keep topic visible through hashtag and audience-source support.',
      contentFocus: ['short captions', 'hashtag pack', 'audience angle'],
      recommendedAction: 'Schedule later or prepare next Compose batch',
    },
  ].map((wave, index) => ({
    ...wave,
    label: `Wave ${index + 1}`,
    topic: brief.topic,
    objective: brief.objective,
    audienceSource: brief.audienceSource,
    healthyAccounts: readiness.healthyAccounts,
  }))
}

function buildBrandRoles(campaign: Campaign) {
  const objective = inferCampaignObjective(campaign)
  const text = `${campaign.name || ''} ${campaign.targetValue || ''}`.toLowerCase()
  // UI copy treats these as conversion destinations, not swarm account identities.
  const roles = [
    {
      brand: 'Brescia Stone',
      role: 'Arahkan ke brand premium',
      suggestedFocus: 'Monaco Grey / premium marble / architecture',
      suggestedCTA: 'WhatsApp Brescia Stone',
    },
    {
      brand: 'Brescia Bali',
      role: 'Villa & tropical luxury',
      suggestedFocus: 'Grey Levanto / Bali resort style',
      suggestedCTA: 'WhatsApp Brescia Bali',
    },
    {
      brand: 'Magrade',
      role: 'Promo & ready stock conversion',
      suggestedFocus: 'Affordable marble / promo stock',
      suggestedCTA: 'WhatsApp Magrade',
    },
    {
      brand: 'Nu Stone Republic',
      role: 'Trend & inspiration content',
      suggestedFocus: 'Interior inspiration / aesthetic content',
      suggestedCTA: 'Instagram engagement or WhatsApp',
    },
    {
      brand: 'Global Stone',
      role: 'Project & contractor support',
      suggestedFocus: 'Bulk/project materials',
      suggestedCTA: 'Project sales WhatsApp',
    },
  ]
  const priority: Record<string, number> = {}

  if (/\b(bali|villa|resort|tropical)\b/.test(text)) priority['Brescia Bali'] = 0
  if (/\b(promo|ready stock|stock|affordable)\b/.test(text)) priority.Magrade = 0
  if (/\b(project|contractor|bulk|arsitek|architecture)\b/.test(text)) priority['Global Stone'] = 0
  if (/\b(inspiration|aesthetic|interior|tips|edukasi)\b/.test(text) || objective === 'Education') priority['Nu Stone Republic'] = 0
  if (/\b(monaco|calacatta|statuario|premium|luxury|marble|marmer)\b/.test(text) || objective === 'Product Push') priority['Brescia Stone'] = 0

  return roles
    .map((role, index) => ({
      ...role,
      objective,
      priority: priority[role.brand] ?? index + 1,
    }))
    .sort((a, b) => a.priority - b.priority)
}

function scheduledDate(campaign: Campaign) {
  if (!campaign.scheduledAt) return null
  const date = new Date(campaign.scheduledAt)
  return Number.isNaN(date.getTime()) ? null : date
}

function safePercent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function compactStatusLabel(status?: string | null) {
  if (!status) return 'Belum Ada'
  const labels: Record<string, string> = {
    MISSING: 'Belum Ada',
    PENDING: 'Menunggu',
    READY: 'SIAP',
    FAILED: 'GAGAL',
    CANCELLED: 'Dibatalkan',
    EXECUTED: 'Selesai',
    pending: 'Menunggu',
    running: 'Berjalan',
    paused: 'Ditahan',
    completed: 'Selesai',
    mock_ready: 'Preview siap dicek',
    'readyForPosting false': 'Belum siap diposting',
    pending_review: 'Menunggu review',
    NEEDS_REVIEW: 'Menunggu review',
    approved: 'Disetujui',
    APPROVED: 'Disetujui',
    rejected: 'Ditolak',
    REJECTED: 'Ditolak',
    needs_revision: 'Perlu revisi',
    routed: 'Dikirim ke automation',
    failed: 'Gagal, perlu dicek',
    DRAFT: 'Draft',
    USED: 'Digunakan',
    ALL: 'Semua',
    stopped: 'GAGAL',
  }
  return labels[status] || status.replace('_', ' ')
}

export default function Campaigns() {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [generatingPlanIds, setGeneratingPlanIds] = useState<Set<string>>(new Set())
  const [preparingComposeIds, setPreparingComposeIds] = useState<Set<string>>(new Set())
  const [scheduleCampaign, setScheduleCampaign] = useState<Campaign | null>(null)
  const [scheduleAtLocal, setScheduleAtLocal] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null)
  const [retryingSchedulerIds, setRetryingSchedulerIds] = useState<Set<string>>(new Set())
  const [campaignMedia, setCampaignMedia] = useState<CampaignMediaItem[]>([])
  const [variationMediaRefs, setVariationMediaRefs] = useState<Record<string, VariationMediaReference>>({})
  const [selectedMediaFile, setSelectedMediaFile] = useState<File | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'reference'>('image')
  const [mediaNote, setMediaNote] = useState('')
  const [mediaUploading, setMediaUploading] = useState(false)
  const [mediaSavingKeys, setMediaSavingKeys] = useState<Set<string>>(new Set())
  const [variationApprovals, setVariationApprovals] = useState<Record<string, VariationApproval>>({})
  const [approvalFilter, setApprovalFilter] = useState<'ALL' | VariationApprovalStatus>('ALL')
  const [approvalSavingKeys, setApprovalSavingKeys] = useState<Set<string>>(new Set())
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('ALL')
  const [preparationFilter, setPreparationFilter] = useState<PreparationFilter>('ALL')
  const [automationRequestStates, setAutomationRequestStates] = useState<Record<string, AutomationRequestState>>({})
  const [automationPayloads, setAutomationPayloads] = useState<Record<string, AutomationRequestPayload>>({})
  const [automationRequestLogs, setAutomationRequestLogs] = useState<Record<string, AutomationRequestLogEntry[]>>({})
  const [automationSchemaTab, setAutomationSchemaTab] = useState<AutomationSchemaTab>('core')
  const [localWebhookEndpoint, setLocalWebhookEndpoint] = useState(defaultLocalWebhookEndpoint)
  const [localWebhookResults, setLocalWebhookResults] = useState<Record<string, LocalWebhookResult>>({})
  const [localWebhookHistory, setLocalWebhookHistory] = useState<LocalWebhookHistoryEntry[]>([])
  const [campaignMode, setCampaignMode] = useState<'simple' | 'advanced' | 'debug'>('simple')
  const [showArchived, setShowArchived] = useState(false)

  // Create form
  const [name, setName] = useState('')
  const [campaignObjective, setCampaignObjective] = useState<CampaignObjective>('Product Push')
  const [audienceSource, setAudienceSource] = useState<AudienceSource>('Material / Topic')
  const [type, setType] = useState(OBJECTIVE_TO_ACTION_TYPE['Product Push'])
  const [targetType, setTargetType] = useState(AUDIENCE_SOURCE_TO_TARGET_TYPE['Material / Topic'])
  const [targetValue, setTargetValue] = useState('')
  const [defaultCaptionSeed, setDefaultCaptionSeed] = useState('')
  const [defaultHashtags, setDefaultHashtags] = useState('')
  const [suggestedTone, setSuggestedTone] = useState('')
  const [suggestedCTA, setSuggestedCTA] = useState('')
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set())
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [groupsLoadError, setGroupsLoadError] = useState<string | null>(null)
  const [accountsLoadError, setAccountsLoadError] = useState<string | null>(null)
  const [selGroups, setSelGroups] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<ResolvePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    loadCampaigns()
    loadQueueSummary()
    api.get<{ accounts: Account[] }>('/accounts')
      .then(({ data }) => {
        setAccounts(data.accounts.filter(a => a.status !== 'error'))
        setAccountsLoadError(null)
      })
      .catch((error) => {
        console.error('Failed to load campaign accounts', error)
        setAccountsLoadError('Failed to load accounts. Please refresh or sign in again.')
      })
  }, [])

  useEffect(() => {
    if (!showCreate || groupsLoaded) return
    accountGroupsApi.list()
      .then(({ data }) => {
        setGroups(data.groups || [])
        setGroupsLoaded(true)
        setGroupsLoadError(null)
      })
      .catch((error) => {
        console.error('Failed to load account groups', error)
        setGroupsLoaded(true)
        setGroupsLoadError('Failed to load account groups. Please refresh or sign in again.')
        toast.error('Failed to load account groups')
      })
  }, [showCreate, groupsLoaded])

  useEffect(() => {
    if (!showCreate) return
    const accountIds = Array.from(selAccounts)
    const groupIds = Array.from(selGroups)
    if (accountIds.length === 0 && groupIds.length === 0) {
      setPreview(null)
      return
    }

    const timeout = window.setTimeout(() => {
      setPreviewLoading(true)
      accountGroupsApi.resolvePreview({ accountIds, groupIds })
        .then(({ data }) => setPreview(data))
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false))
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [showCreate, selAccounts, selGroups])

  // Auto-refresh operationally active campaign views.
  useEffect(() => {
    const hasActive = campaigns.some(c => c.status === 'running' || c.schedulerStatus === 'PENDING')
    if (!hasActive) return
    const i = setInterval(() => {
      loadCampaigns()
      loadQueueSummary()
    }, 10000)
    return () => clearInterval(i)
  }, [campaigns])

  async function loadCampaigns() {
    try {
      const { data } = await campaignsApi.list({ includeArchived: showArchived })
      setCampaigns(data.campaigns || [])
    } catch { /* silent */ }
  }

  useEffect(() => {
    loadCampaigns()
  }, [showArchived])

  async function handleArchive(id: string, name: string) {
    if (!window.confirm(`Arsipkan campaign "${name}"? Campaign akan disembunyikan dari daftar utama, tapi data tidak dihapus.`)) return
    try {
      await campaignsApi.archive(id)
      toast.success('Campaign archived')
      loadCampaigns()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to archive campaign')
    }
  }

  async function loadQueueSummary() {
    try {
      const { data } = await activityApi.queueSummary() as { data: { queue: QueueSummary } }
      setQueueSummary(data.queue)
    } catch {
      setQueueSummary(null)
    }
  }

  async function handleCreate() {
    if (!name.trim() || !targetValue.trim() || (selAccounts.size === 0 && selGroups.size === 0)) {
      toast.error('Fill all fields and select accounts or groups'); return
    }
    if (preview && preview.healthyCount === 0) {
      toast.error('No healthy accounts resolved for this campaign'); return
    }
    setLoading(true)
    try {
      const mappedType = OBJECTIVE_TO_ACTION_TYPE[campaignObjective]
      const mappedTargetType = AUDIENCE_SOURCE_TO_TARGET_TYPE[audienceSource]
      await campaignsApi.create({
        name,
        type: mappedType,
        targetType: mappedTargetType,
        targetValue,
        accountIds: Array.from(selAccounts),
        groupIds: Array.from(selGroups),
      })
      toast.success('Campaign created!')
      setShowCreate(false)
      setName('')
      setCampaignObjective('Product Push')
      setAudienceSource('Material / Topic')
      setType(OBJECTIVE_TO_ACTION_TYPE['Product Push'])
      setTargetType(AUDIENCE_SOURCE_TO_TARGET_TYPE['Material / Topic'])
      setTargetValue('')
      setDefaultCaptionSeed('')
      setDefaultHashtags('')
      setSuggestedTone('')
      setSuggestedCTA('')
      setSelAccounts(new Set())
      setSelGroups(new Set())
      setPreview(null)
      loadCampaigns()
    } catch { toast.error('Failed to create campaign') }
    finally { setLoading(false) }
  }

  function applyLoadoutPreset(preset: AccountLoadoutPreset) {
    setSelAccounts(new Set(preset.accountIds))
    setSelGroups(new Set(preset.groupIds))
  }

  function applyCampaignTemplate(preset: CampaignTemplatePreset) {
    setName(preset.name)
    setCampaignObjective(objectiveFromActionType(preset.actionType))
    setAudienceSource(audienceSourceFromTargetType(preset.targetType))
    setType(preset.actionType)
    setTargetType(preset.targetType)
    setTargetValue(preset.targetValue)
    setDefaultCaptionSeed(preset.defaultCaptionSeed)
    setDefaultHashtags(preset.defaultHashtags.join(' '))
    setSuggestedTone(preset.suggestedTone)
    setSuggestedCTA(preset.suggestedCTA)
    setSelAccounts(new Set(preset.accountIds))
    setSelGroups(new Set(preset.groupIds))
  }

  async function loadDetail(id: string) {
    setDetailId(id)
    try {
      const { data } = await campaignsApi.get(id)
      setDetailData(data)
      setVariationApprovals(data.planningSummary?.variationApprovals || {})
      loadCampaignMedia(id)
    } catch { toast.error('Failed to load details') }
  }

  async function loadCampaignMedia(id: string) {
    try {
      const { data } = await campaignsApi.media(id)
      setCampaignMedia(data.media || [])
      setVariationMediaRefs(data.variationMediaReferences || {})
    } catch {
      setCampaignMedia([])
      setVariationMediaRefs({})
    }
  }

  async function uploadCampaignMedia() {
    if (!detailId || !selectedMediaFile) {
      toast.error('Choose a media file first')
      return
    }

    const formData = new FormData()
    formData.append('media', selectedMediaFile)
    formData.append('type', mediaType)
    formData.append('note', mediaNote)

    setMediaUploading(true)
    try {
      const { data } = await campaignsApi.uploadMedia(detailId, formData)
      setCampaignMedia(data.media || [])
      setSelectedMediaFile(null)
      setMediaNote('')
      toast.success('Campaign media added')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload campaign media')
    } finally {
      setMediaUploading(false)
    }
  }

  async function removeCampaignMedia(mediaId: string) {
    if (!detailId) return
    try {
      const { data } = await campaignsApi.removeMedia(detailId, mediaId)
      setCampaignMedia(data.media || [])
      setVariationMediaRefs(data.variationMediaReferences || {})
      toast.success('Media reference removed')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove media reference')
    }
  }

  async function saveVariationMediaReference(variationKey: string, next: VariationMediaReference) {
    if (!detailId) return
    setVariationMediaRefs(prev => ({ ...prev, [variationKey]: next }))
    setMediaSavingKeys(prev => new Set(prev).add(variationKey))
    try {
      const { data } = await campaignsApi.updateVariationMedia(detailId, {
        variationKey,
        primaryMediaId: next.primaryMediaId || '',
        secondaryMediaId: next.secondaryMediaId || '',
      })
      setVariationMediaRefs(data.variationMediaReferences || {})
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save media reference')
    } finally {
      setMediaSavingKeys(prev => {
        const nextSet = new Set(prev)
        nextSet.delete(variationKey)
        return nextSet
      })
    }
  }

  async function saveVariationApproval(
    variationKey: string,
    next: Partial<VariationApproval> & { status?: VariationApprovalStatus },
  ) {
    if (!detailId) return
    const current = variationApprovals[variationKey] || { status: 'DRAFT' as VariationApprovalStatus, reviewerNote: '' }
    const optimistic = {
      ...current,
      ...next,
      status: next.status || current.status || 'DRAFT',
    }
    setVariationApprovals(prev => ({ ...prev, [variationKey]: optimistic }))
    setApprovalSavingKeys(prev => new Set(prev).add(variationKey))
    try {
      const { data } = await campaignsApi.updateVariationApproval(detailId, {
        variationKey,
        ...(next.status ? { status: next.status } : {}),
        ...(next.reviewerNote !== undefined ? { reviewerNote: next.reviewerNote } : {}),
      })
      setVariationApprovals(data.variationApprovals || {})
      setDetailData((prev: any) => prev ? {
        ...prev,
        planningSummary: {
          ...(prev.planningSummary || {}),
          variationApprovals: data.variationApprovals || {},
        },
      } : prev)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save approval status')
    } finally {
      setApprovalSavingKeys(prev => {
        const nextSet = new Set(prev)
        nextSet.delete(variationKey)
        return nextSet
      })
    }
  }

  async function copyMediaPath(path: string) {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('Media path copied')
    } catch {
      toast.error('Failed to copy media path')
    }
  }

  async function copyAutomationSchema(schema: UniversalAutomationSchema) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2))
      toast.success('Universal automation schema copied')
    } catch {
      toast.error('Failed to copy automation schema')
    }
  }

  async function sendLocalWebhookPayload(campaign: Campaign, schema: UniversalAutomationSchema) {
    const endpoint = localWebhookEndpoint.trim()
    const startedAt = performance.now()
    const sentAt = new Date().toISOString()

    if (!isAllowedLocalWebhookEndpointFromModule(endpoint)) {
      const result: LocalWebhookResult = {
        status: 'blocked',
        endpoint,
        sentAt,
        error: 'Only local HTTP webhook endpoints are allowed.',
      }
      setLocalWebhookResults(prev => ({ ...prev, [campaign.id]: result }))
      setLocalWebhookHistory(prev => [{
        ...result,
        id: `blocked-${Date.now().toString(36)}`,
        requestId: schema.core.requestId,
        campaignName: campaign.name,
      }, ...prev].slice(0, 8))
      toast.error('Webhook endpoint blocked', 'Use http://localhost or http://127.0.0.1 only.')
      return
    }

    setLocalWebhookResults(prev => ({
      ...prev,
      [campaign.id]: {
        status: 'sending',
        endpoint,
        sentAt,
      },
    }))

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rockbase-Simulation': 'true',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjY2VlNTAzYy00NGFhLTQyODItYTE3ZS0wOWY5NjA0NWJiZTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNjMzZWNiMzEtNGYwZi00OWMyLWE3ZTYtYjNhOWM3YjU4YzNjIiwiaWF0IjoxNzgwODA3ODk2fQ.amgpYh2fYudLwpsjhFTGqYrh_an2fXPqv7CQrecQIgs',
        },
        body: JSON.stringify(schema),
        signal: controller.signal,
      })
      const responsePayload = await readWebhookResponse(response)
      const responseTimeMs = Math.round(performance.now() - startedAt)
      const result: LocalWebhookResult = {
        status: response.ok ? 'success' : 'invalid',
        httpStatus: response.status,
        responseTimeMs,
        responsePayload,
        endpoint,
        sentAt,
        ...(response.ok ? {} : { error: `Webhook returned HTTP ${response.status}` }),
      }

      setLocalWebhookResults(prev => ({ ...prev, [campaign.id]: result }))
      setLocalWebhookHistory(prev => [{
        ...result,
        id: `webhook-${Date.now().toString(36)}`,
        requestId: schema.core.requestId,
        campaignName: campaign.name,
      }, ...prev].slice(0, 8))
      if (response.ok) toast.success('Payload sent to local webhook')
      else toast.error('Webhook returned an error status')
    } catch (error: any) {
      const responseTimeMs = Math.round(performance.now() - startedAt)
      const status: LocalWebhookResultStatus = error?.name === 'AbortError' ? 'timeout' : 'offline'
      const result: LocalWebhookResult = {
        status,
        responseTimeMs,
        endpoint,
        sentAt,
        error: status === 'timeout' ? 'Local webhook timed out after 8 seconds.' : 'Local webhook is offline or unreachable.',
      }

      setLocalWebhookResults(prev => ({ ...prev, [campaign.id]: result }))
      setLocalWebhookHistory(prev => [{
        ...result,
        id: `webhook-${Date.now().toString(36)}`,
        requestId: schema.core.requestId,
        campaignName: campaign.name,
      }, ...prev].slice(0, 8))
      toast.error(status === 'timeout' ? 'Webhook timeout' : 'Webhook offline', result.error)
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function openInCompose(id: string) {
    if (preparingComposeIds.has(id)) return
    setPreparingComposeIds(prev => new Set(prev).add(id))
    navigate(`/compose?campaignId=${encodeURIComponent(id)}`)
  }

  function prepareVariations(id: string) {
    if (preparingComposeIds.has(id)) return
    const campaign = campaigns.find(c => c.id === id)
    const variations = campaign?.planningSummary?.aiPlan?.contentVariations || []
    const approvals = (campaign?.planningSummary as any)?.variationApprovals || {}
    const unapproved = variations.filter((variation, index) => {
      const key = `${variation.title}-${index}`
      return approvals[key]?.status !== 'APPROVED' && approvals[key]?.status !== 'USED'
    }).length
    if (unapproved > 0) {
      toast.warning('Some variations are not approved yet', `${unapproved} variation(s) still need approval review.`)
    }
    setPreparingComposeIds(prev => new Set(prev).add(id))
    navigate(`/compose?campaignId=${encodeURIComponent(id)}&variationAssignments=1`)
  }

  async function generateAiPlan(id: string) {
    setGeneratingPlanIds(prev => new Set(prev).add(id))
    try {
      const { data } = await campaignsApi.generatePlan(id)
      setCampaigns(prev => prev.map(c => c.id === id ? {
        ...c,
        planningSummary: data.planningSummary,
      } : c))
      if (detailId === id) {
        setDetailData((prev: any) => prev ? { ...prev, planningSummary: data.planningSummary } : prev)
      }
      toast.success(data.aiPlan?.source === 'fallback' ? 'Fallback AI plan prepared' : 'AI plan generated')
    } catch {
      toast.error('Failed to generate AI plan')
    } finally {
      setGeneratingPlanIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function openSchedule(campaign: Campaign) {
    setScheduleCampaign(campaign)
    setScheduleAtLocal(toDatetimeLocal(campaign.scheduledAt))
  }

  async function saveSchedule() {
    if (!scheduleCampaign || !scheduleAtLocal) {
      toast.error('Choose a schedule time')
      return
    }

    const scheduledAt = new Date(scheduleAtLocal)
    if (Number.isNaN(scheduledAt.getTime())) {
      toast.error('Invalid schedule time')
      return
    }

    setScheduling(true)
    try {
      await campaignsApi.schedule(scheduleCampaign.id, scheduledAt.toISOString())
      toast.success('Campaign scheduled for draft preparation')
      setScheduleCampaign(null)
      setScheduleAtLocal('')
      loadCampaigns()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to schedule campaign')
    } finally {
      setScheduling(false)
    }
  }

  async function cancelSchedule(id: string) {
    try {
      await campaignsApi.cancelSchedule(id)
      toast.success('Schedule cancelled')
      loadCampaigns()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel schedule')
    }
  }

  async function retryScheduler(id: string) {
    setRetryingSchedulerIds(prev => new Set(prev).add(id))
    try {
      await campaignsApi.retryScheduler(id)
      toast.success('Scheduler retry prepared')
      loadCampaigns()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to retry scheduler')
    } finally {
      setRetryingSchedulerIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function openActivity(id: string) {
    navigate(`/activity?category=campaigns&campaignId=${encodeURIComponent(id)}`)
  }

  function openCampaignMedia(id: string) {
    loadDetail(id)
  }

  function simulateAutomationBridge(
    campaignId: string,
    status: AutomationRequestStatus,
    activity: string,
    message: string,
  ) {
    setAutomationRequestStates(prev => {
      const current = buildAutomationRequestState(prev[campaignId])
      return {
        ...prev,
        [campaignId]: {
          status,
          activity: [activity, ...current.activity].slice(0, 5),
        },
      }
    })
    toast.success(message)
  }

  function createAutomationRequest(campaign: Campaign, requestType: AutomationRequestType) {
    const payload = buildAutomationRequestPayloadFromModule(campaign as AutomationCampaign, requestType) as AutomationRequestPayload
    const logEntry: AutomationRequestLogEntry = {
      requestId: payload.requestId,
      requestType,
      status: payload.automationStatus,
      queuedTime: payload.queuedTime,
      updatedAt: payload.queuedTime,
      destinationPipeline: payload.destinationPipeline,
      summary: `${requestType} queued for ${payload.destinationBrand}`,
    }

    setAutomationPayloads(prev => ({
      ...prev,
      [campaign.id]: payload,
    }))
    setAutomationRequestLogs(prev => ({
      ...prev,
      [campaign.id]: [logEntry, ...(prev[campaign.id] || [])].slice(0, 8),
    }))
    toast.success('Automation request generated locally', 'Simulation only. No webhook or external service called.')
  }

  function advanceAutomationRequest(campaignId: string) {
    const current = automationPayloads[campaignId]
    if (!current) {
      toast.error('Generate an automation request first')
      return
    }

    const nextStatus = nextAutomationStatus(current.automationStatus)
    const updatedAt = new Date().toISOString()
    const nextPayload: AutomationRequestPayload = {
      ...current,
      automationStatus: nextStatus,
    }
    const logEntry: AutomationRequestLogEntry = {
      requestId: current.requestId,
      requestType: current.contentType,
      status: nextStatus,
      queuedTime: current.queuedTime,
      updatedAt,
      destinationPipeline: current.destinationPipeline,
      summary: `${current.contentType} moved to ${nextStatus}`,
    }

    setAutomationPayloads(prev => ({
      ...prev,
      [campaignId]: nextPayload,
    }))
    setAutomationRequestLogs(prev => ({
      ...prev,
      [campaignId]: [logEntry, ...(prev[campaignId] || [])].slice(0, 8),
    }))
    toast.success(`Automation status: ${nextStatus}`, 'Simulation only.')
  }

  const allSel = accounts.length > 0 && accounts.every(a => selAccounts.has(a.id))
  const allGroupSel = groups.length > 0 && groups.every(g => selGroups.has(g.id))
  const summary = {
    pending: campaigns.filter(c => c.schedulerStatus === 'PENDING' || (!c.schedulerStatus && c.status === 'pending')).length,
    ready: campaigns.filter(c => c.schedulerStatus === 'READY').length,
    executing: campaigns.filter(c => c.status === 'running' || c.status === 'paused').length,
    failed: campaigns.filter(c => c.schedulerStatus === 'FAILED' || c.status === 'stopped' || c.failedActions > 0).length,
    completed: campaigns.filter(c => c.status === 'completed').length,
  }
  const summaryCards: { label: string; value: number; Icon: typeof Clock; color: string }[] = [
    { label: 'Campaign Menunggu', value: summary.pending, Icon: Clock, color: 'text-slate-300' },
    { label: 'Campaign SIAP', value: summary.ready, Icon: CheckCircle2, color: 'text-green-300' },
    { label: 'Executing Campaigns', value: summary.executing, Icon: Play, color: 'text-blue-300' },
    { label: 'Campaign Gagal', value: summary.failed, Icon: XCircle, color: 'text-red-300' },
    { label: 'Completed Campaigns', value: summary.completed, Icon: ListChecks, color: 'text-purple-300' },
  ]
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const tomorrowStart = startOfDay(addDays(now, 1))
  const tomorrowEnd = endOfDay(addDays(now, 1))
  const weekEnd = endOfWeek(now)
  const scheduledCampaigns = campaigns
    .map(campaign => ({ campaign, date: scheduledDate(campaign) }))
    .filter((entry): entry is { campaign: Campaign; date: Date } => Boolean(entry.date))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const filteredScheduledCampaigns = scheduledCampaigns.filter(({ campaign, date }) => {
    const schedulerStatus = campaign.schedulerStatus || 'PENDING'
    if (calendarFilter === 'PENDING') return schedulerStatus === 'PENDING'
    if (calendarFilter === 'READY') return schedulerStatus === 'READY'
    if (calendarFilter === 'FAILED') return schedulerStatus === 'FAILED'
    if (calendarFilter === 'TODAY') return isBetween(date, todayStart, todayEnd)
    if (calendarFilter === 'THIS_WEEK') return isBetween(date, todayStart, weekEnd)
    return true
  })
  const calendarBuckets = [
    {
      label: 'Today',
      items: filteredScheduledCampaigns.filter(({ date }) => isBetween(date, todayStart, todayEnd)),
    },
    {
      label: 'Tomorrow',
      items: filteredScheduledCampaigns.filter(({ date }) => isBetween(date, tomorrowStart, tomorrowEnd)),
    },
    {
      label: 'This Week',
      items: filteredScheduledCampaigns.filter(({ date }) => date > tomorrowEnd && isBetween(date, todayStart, weekEnd)),
    },
    {
      label: 'Upcoming',
      items: filteredScheduledCampaigns.filter(({ date }) => date > weekEnd),
    },
  ]
  const analytics = (() => {
    const approvalTotals: Record<VariationApprovalStatus, number> = {
      DRAFT: 0,
      NEEDS_REVIEW: 0,
      APPROVED: 0,
      REJECTED: 0,
      USED: 0,
    }
    const schedulerTotals = ['PENDING', 'READY', 'FAILED', 'CANCELLED', 'EXECUTED'].reduce<Record<string, number>>((acc, status) => {
      acc[status] = 0
      return acc
    }, {})
    let totalVariations = 0
    let totalMediaAssets = 0
    let campaignsWithMedia = 0
    let healthyAccountTotal = 0
    let resolvedAccountTotal = 0
    let successfulPostsToday = 0
    let failedPostsToday = 0

    campaigns.forEach(campaign => {
      const schedulerStatus = campaign.schedulerStatus || 'PENDING'
      schedulerTotals[schedulerStatus] = (schedulerTotals[schedulerStatus] || 0) + 1

      const approvals = approvalSummary(campaign)
      Object.keys(approvals).forEach(status => {
        approvalTotals[status as VariationApprovalStatus] += approvals[status as VariationApprovalStatus]
      })
      totalVariations += campaign.planningSummary?.aiPlan?.contentVariations?.length || 0

      const mediaCount = campaign.planningSummary?.mediaLibrary?.length || 0
      totalMediaAssets += mediaCount
      if (mediaCount > 0) campaignsWithMedia += 1

      healthyAccountTotal += campaign.planningSummary?.healthyCount ?? campaign.accountIds.length
      resolvedAccountTotal += campaign.planningSummary?.totalResolved ?? campaign.accountIds.length

      const activityDate = campaign.lastExecutionAt || campaign.completedAt
      if (activityDate) {
        const date = new Date(activityDate)
        if (!Number.isNaN(date.getTime()) && isBetween(date, todayStart, todayEnd)) {
          successfulPostsToday += campaign.completedActions
          failedPostsToday += campaign.failedActions
        }
      }
    })

    const schedulerSuccessBase = (schedulerTotals.READY || 0) + (schedulerTotals.EXECUTED || 0) + (schedulerTotals.FAILED || 0)
    const topByVariations = [...campaigns].sort((a, b) => (b.planningSummary?.aiPlan?.contentVariations?.length || 0) - (a.planningSummary?.aiPlan?.contentVariations?.length || 0))[0] || null
    const topByMedia = [...campaigns].sort((a, b) => (b.planningSummary?.mediaLibrary?.length || 0) - (a.planningSummary?.mediaLibrary?.length || 0))[0] || null
    const latestReady = [...campaigns]
      .filter(campaign => campaign.schedulerStatus === 'READY')
      .sort((a, b) => new Date(b.scheduledAt || b.createdAt).getTime() - new Date(a.scheduledAt || a.createdAt).getTime())[0] || null
    const latestFailed = [...campaigns]
      .filter(campaign => campaign.schedulerStatus === 'FAILED' || campaign.status === 'stopped' || campaign.failedActions > 0)
      .sort((a, b) => new Date(b.lastExecutionAt || b.completedAt || b.createdAt).getTime() - new Date(a.lastExecutionAt || a.completedAt || a.createdAt).getTime())[0] || null

    return {
      totalCampaigns: campaigns.length,
      scheduledCampaigns: campaigns.filter(campaign => Boolean(campaign.scheduledAt)).length,
      readyCampaigns: schedulerTotals.READY || 0,
      completedCampaigns: campaigns.filter(campaign => campaign.status === 'completed' || campaign.schedulerStatus === 'EXECUTED').length,
      failedCampaigns: summary.failed,
      totalVariations,
      approvedVariations: approvalTotals.APPROVED + approvalTotals.USED,
      rejectedVariations: approvalTotals.REJECTED,
      totalMediaAssets,
      campaignsWithMedia,
      campaignsWithoutMedia: Math.max(0, campaigns.length - campaignsWithMedia),
      approvalRate: safePercent(approvalTotals.APPROVED + approvalTotals.USED, totalVariations),
      schedulerSuccessRate: safePercent((schedulerTotals.READY || 0) + (schedulerTotals.EXECUTED || 0), schedulerSuccessBase),
      healthyAccountRatio: safePercent(healthyAccountTotal, resolvedAccountTotal),
      readinessRatio: safePercent(schedulerTotals.READY || 0, campaigns.length),
      successfulPostsToday,
      failedPostsToday,
      schedulerTotals,
      approvalTotals,
      topByVariations,
      topByMedia,
      latestReady,
      latestFailed,
    }
  })()
  const schedulerChart = ['PENDING', 'READY', 'FAILED', 'CANCELLED', 'EXECUTED'].map(status => ({
    label: status,
    value: analytics.schedulerTotals[status] || 0,
    className: SCHEDULER_STATUS_STYLES[status],
  }))
  const approvalChart = (['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'USED'] as VariationApprovalStatus[]).map(status => ({
    label: status.replace('_', ' '),
    value: analytics.approvalTotals[status] || 0,
    className: APPROVAL_STATUS_STYLES[status],
  }))
  const maxSchedulerChart = Math.max(1, ...schedulerChart.map(item => item.value))
  const maxApprovalChart = Math.max(1, ...approvalChart.map(item => item.value))
  const preparationRows = campaigns
    .map(campaign => {
      const readiness = campaignReadiness(campaign)
      return {
        campaign,
        readiness,
      }
    })
    .sort((a, b) => {
      if (a.readiness.isReady !== b.readiness.isReady) return Number(b.readiness.isReady) - Number(a.readiness.isReady)
      const aSchedule = a.campaign.scheduledAt ? new Date(a.campaign.scheduledAt).getTime() : Number.POSITIVE_INFINITY
      const bSchedule = b.campaign.scheduledAt ? new Date(b.campaign.scheduledAt).getTime() : Number.POSITIVE_INFINITY
      return aSchedule - bSchedule
    })
  const preparationSummary = {
    totalCampaigns: campaigns.length,
    readyCampaigns: preparationRows.filter(row => row.readiness.isReady).length,
    blockedCampaigns: preparationRows.filter(row => !row.readiness.isReady).length,
    campaignsMissingMedia: preparationRows.filter(row => row.readiness.missingMedia).length,
    campaignsMissingAI: preparationRows.filter(row => row.readiness.missingAI).length,
  }
  const filteredPreparationRows = preparationRows.filter(({ campaign, readiness }) => {
    if (preparationFilter === 'MISSING_MEDIA') return readiness.missingMedia
    if (preparationFilter === 'MISSING_AI') return readiness.missingAI
    if (preparationFilter === 'NEEDS_APPROVAL') return readiness.needsApproval
    if (preparationFilter === 'READY') return readiness.isReady
    if (preparationFilter === 'FAILED') return readiness.failed
    return Boolean(campaign)
  })

  return (
    <div className="space-y-4">
      <div className="mb-2 flex items-center border-b border-border/50">
        {(['simple', 'advanced', 'debug'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setCampaignMode(mode)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2",
              campaignMode === mode 
                ? "border-cyan-500 text-cyan-400" 
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {mode === 'simple' ? 'Simple Operator' : mode === 'advanced' ? 'Advanced Automation' : 'Developer Debug'}
          </button>
        ))}
      </div>

      {campaignMode === 'simple' && (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200 flex items-center">
            <AlertTriangle className="mr-2 h-5 w-5 shrink-0" />
            <p><strong>Panduan Operator:</strong> Mulai dari campaign yang statusnya Perlu Konten atau Perlu AI Plan. Ikuti tombol aksi utama di setiap campaign. Konten tetap perlu review sebelum dikirim ke Compose. Tidak ada auto-posting dari halaman ini.</p>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPreparationRows.length === 0 ? (
              <div className="col-span-full rounded-md border border-dashed border-border bg-background/40 p-6 text-center">
                <ListChecks className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium">Tidak ada campaign yang perlu dikerjakan.</p>
              </div>
            ) : filteredPreparationRows.map(({ campaign, readiness }) => {
               const nextAction = buildNextAction(campaign)
               let simpleStatus = 'Draft'
               let statusColor = 'text-slate-400 border-slate-500/30 bg-slate-500/10'
               
               if (readiness.failed || campaign.schedulerStatus === 'FAILED') {
                 simpleStatus = 'Gagal'
                 statusColor = 'text-red-400 border-red-500/30 bg-red-500/10'
               } else if (readiness.isReady) {
                 simpleStatus = 'Siap ke Compose'
                 statusColor = 'text-green-400 border-green-500/30 bg-green-500/10'
               } else if (readiness.missingMedia) {
                 simpleStatus = 'Perlu Konten'
                 statusColor = 'text-blue-400 border-blue-500/30 bg-blue-500/10'
               } else if (readiness.missingAI) {
                 simpleStatus = 'Perlu AI Plan'
                 statusColor = 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
               } else if (readiness.needsApproval) {
                 simpleStatus = 'Perlu Review'
                 statusColor = 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
               }

               return (
                 <Card key={campaign.id} className="border-border/50 bg-card hover:border-orange-500/50 transition-colors">
                   <CardContent className="p-4 space-y-4">
                     <div>
                       <div className="flex items-start justify-between">
                         <h3 className="font-bold text-foreground line-clamp-2 pr-2">{campaign.name}</h3>
                         <Badge variant="outline" className={cn("shrink-0 text-[10px]", statusColor)}>
                           {simpleStatus}
                         </Badge>
                       </div>
                       <p className="text-xs text-muted-foreground mt-1 capitalize">{campaign.type.replace('_', ' ')} &bull; {campaign.targetValue}</p>
                     </div>

                     <div className="pt-2">
                       {nextAction.key === 'media' && (
                         <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openCampaignMedia(campaign.id)}>
                           <Upload className="mr-2 h-4 w-4" /> Upload Konten
                         </Button>
                       )}
                       {nextAction.key === 'ai' && (
                         <Button className="w-full bg-cyan-600 hover:bg-cyan-700 text-white" onClick={() => generateAiPlan(campaign.id)} disabled={generatingPlanIds.has(campaign.id)}>
                           {generatingPlanIds.has(campaign.id) ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                           Generate AI Plan
                         </Button>
                       )}
                       {nextAction.key === 'detail' && (
                         <Button className="w-full bg-yellow-600 hover:bg-yellow-700 text-white" onClick={() => loadDetail(campaign.id)}>
                           <ListChecks className="mr-2 h-4 w-4" /> Review Konten
                         </Button>
                       )}
                       {nextAction.key === 'compose' && (
                         <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" onClick={() => openInCompose(campaign.id)} disabled={preparingComposeIds.has(campaign.id)}>
                           <SendHorizontal className="mr-2 h-4 w-4" /> Buka Compose
                         </Button>
                       )}
                       {nextAction.key === 'activity' && (
                         <Button className="w-full bg-slate-600 hover:bg-slate-700 text-white" onClick={() => openActivity(campaign.id)}>
                           <Activity className="mr-2 h-4 w-4" /> Lihat Masalah Akun
                         </Button>
                       )}
                     </div>

                     <div className="flex items-center justify-between pt-2 border-t border-border/50">
                       <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => loadDetail(campaign.id)}>
                         Detail
                       </Button>
                       <div className="flex items-center gap-1">
                         {readiness.schedulerStatus === 'FAILED' && (
                           <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-orange-400" onClick={() => retryScheduler(campaign.id)} disabled={retryingSchedulerIds.has(campaign.id)}>
                             <RefreshCw className={cn("mr-1 h-3 w-3", retryingSchedulerIds.has(campaign.id) && "animate-spin")} /> Retry
                           </Button>
                         )}
                         <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => handleArchive(campaign.id, campaign.name)}>
                           <Archive className="mr-1 h-3 w-3" /> Archive
                         </Button>
                       </div>
                     </div>
                   </CardContent>
                 </Card>
               )
            })}
          </div>
        </div>
      )}

      {campaignMode === 'advanced' && (
        <div className="space-y-4">
          <Card className="border-purple-500/20 bg-purple-500/[0.02]">
            <CardHeader>
              <CardTitle className="text-purple-400">Advanced Automation Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {['Universal Automation Schema', 'n8n Bridge', 'Payload Preview', 'Delivery Inspector', 'Response Viewer', 'Mock Asset Result', 'Routing status', 'Automation Request History'].map(item => (
                  <div key={item} className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    <p className="text-purple-300 mb-2">[Placeholder]</p>
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {campaignMode === 'debug' && (
        <div className="space-y-4">
          <Card className="border-red-500/20 bg-red-500/[0.02]">
            <CardHeader>
              <CardTitle className="text-red-400">Developer Debug View</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {['raw JSON', 'requestId', 'renderSpec', 'blockedActions', 'lifecycle status', 'error logs', 'retry details'].map(item => (
                  <div key={item} className="rounded-md border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                    <p className="text-red-300 mb-2">[Placeholder]</p>
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className={cn("flex items-center justify-between", campaignMode === 'debug' && "hidden")}>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Target className="h-5 w-5 text-orange-400" /> Campaign Manager</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Rencanakan distribusi konten dan topik campaign.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox checked={showArchived} onCheckedChange={(checked) => setShowArchived(checked as boolean)} className="border-slate-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500" />
            Tampilkan Arsip
          </label>
          <Button onClick={() => setShowCreate(true)} className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Buat Campaign Baru
          </Button>
        </div>
      </div>

      <div className={cn("grid gap-3", campaignMode === 'simple' ? "md:grid-cols-4" : "md:grid-cols-5", campaignMode === 'debug' && "hidden")}>
        {summaryCards.filter(card => {
          if (campaignMode !== 'simple') return true
          return ['Total Campaign', 'Perlu Dikerjakan', 'Siap ke Compose', 'Campaign Gagal'].includes(card.label)
        }).map(({ label, value, Icon, color }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className={cn('mt-1 text-2xl font-black', color)}>{value}</p>
              </div>
              <Icon className={cn('h-5 w-5', color)} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={cn("border-cyan-500/20 bg-cyan-500/[0.02]", campaignMode !== 'advanced' && "hidden")}>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-cyan-400" />
                Campaign Preparation Board
                <Badge variant="outline" className="h-5 text-[10px] text-cyan-300">Readiness overview</Badge>
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cek kesiapan konten, AI, akun sehat, dan distribusi sebelum posting manual.
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ['ALL', 'All'],
                ['MISSING_MEDIA', 'Konten Belum Upload'],
                ['MISSING_AI', 'AI Belum Dibuat'],
                ['NEEDS_APPROVAL', 'Butuh Approval'],
                ['READY', 'SIAP'],
                ['FAILED', 'GAGAL'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={preparationFilter === value ? 'default' : 'outline'}
                  className="h-7 px-2 text-[10px]"
                  onClick={() => setPreparationFilter(value as PreparationFilter)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-5">
            {[
              ['Total Campaigns', preparationSummary.totalCampaigns, 'text-slate-200'],
              ['Campaign SIAP', preparationSummary.readyCampaigns, 'text-green-300'],
              ['Campaign BELUM SIAP', preparationSummary.blockedCampaigns, 'text-red-300'],
              ['Konten Belum Upload', preparationSummary.campaignsMissingMedia, 'text-yellow-300'],
              ['AI Belum Dibuat', preparationSummary.campaignsMissingAI, 'text-cyan-300'],
            ].map(([label, value, color]) => (
              <div key={label as string} className="rounded-md border border-border bg-background/60 p-3">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label as string}</p>
                <p className={cn('mt-1 text-2xl font-black', color)}>{value as number}</p>
              </div>
            ))}
          </div>

          {filteredPreparationRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background/40 p-6 text-center">
              <ListChecks className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No campaigns match this filter.</p>
              <p className="text-xs text-muted-foreground">Change the filter or refresh campaigns.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-background/50">
              <table className="w-full min-w-[1180px] text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Campaign</th>
                    <th className="px-3 py-3">Kesiapan</th>
                    <th className="px-3 py-3">Media & AI</th>
                    <th className="px-3 py-3">Akun Sehat</th>
                    <th className="px-3 py-3">Langkah Berikutnya</th>
                    <th className="px-4 py-3 text-right">Aksi Cepat</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreparationRows.map(({ campaign, readiness }) => {
                    const mediaStatus = readiness.hasMedia ? 'READY' : 'MISSING'
                    const aiStatus = readiness.hasAI ? 'READY' : 'MISSING'
                    const approvalStatus = readiness.approvals.status
                    const swarmBrief = buildSwarmBrief(campaign)
                    const nextAction = buildNextAction(campaign)
                    const lifecycle = buildCampaignLifecycle(campaign)
                    const primaryActionClass = 'border border-cyan-500/30 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 hover:text-cyan-100'
                    return (
                      <tr
                        key={campaign.id}
                        className={cn(
                          'border-b border-border/70 transition-colors hover:bg-secondary/30',
                          readiness.isReady && 'bg-green-500/[0.06] hover:bg-green-500/[0.09]',
                          readiness.failed && 'bg-red-500/[0.05] hover:bg-red-500/[0.08]',
                        )}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => loadDetail(campaign.id)}
                                className="max-w-[260px] truncate text-left font-bold text-foreground underline-offset-2 hover:text-cyan-300 hover:underline"
                                title="Lihat detail campaign"
                              >
                                {campaign.name}
                              </button>
                              <Badge variant="outline" className={cn('text-[9px]', STATUS_STYLES[campaign.status])}>{compactStatusLabel(campaign.status)}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">Target: <span className="text-foreground">{campaign.targetValue}</span></p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                              <span><span className="text-foreground">{CAMPAIGN_OBJECTIVE_LABELS[swarmBrief.objective]}</span> via {AUDIENCE_SOURCE_LABELS[swarmBrief.audienceSource]}</span>
                              <span className="text-border">|</span>
                              <span>Fokus: <span className="text-foreground">{swarmBrief.topic}</span></span>
                              <span className="text-border">|</span>
                              <span className="font-medium text-orange-300">3 tahap campaign</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1" title="Posisi campaign saat ini">
                              {lifecycle.map(stage => (
                                <span
                                  key={stage.label}
                                  className={cn(
                                    'rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none',
                                    stage.status === 'done' && 'border-green-500/25 bg-green-500/10 text-green-300',
                                    stage.status === 'active' && 'border-cyan-500/35 bg-cyan-500/15 text-cyan-200',
                                    stage.status === 'upcoming' && 'border-border bg-secondary/35 text-muted-foreground',
                                  )}
                                >
                                  {stage.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          {readiness.isReady ? (
                            <Badge variant="outline" className="border-green-500/30 bg-green-500/15 text-[10px] text-green-300">
                              SIAP
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-red-500/30 bg-red-500/15 text-[10px] text-red-300">
                              BELUM SIAP
                            </Badge>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant="outline" className={cn('h-5 text-[9px]', SCHEDULER_STATUS_STYLES[readiness.schedulerStatus])}>
                              Scheduler: {compactStatusLabel(readiness.schedulerStatus)}
                            </Badge>
                            <Badge variant="outline" className={cn(
                              'h-5 text-[9px]',
                              approvalStatus === 'READY'
                                ? 'border-green-500/30 bg-green-500/15 text-green-300'
                                : approvalStatus === 'NEEDS_APPROVAL'
                                  ? 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300'
                                  : 'border-slate-500/30 bg-slate-500/15 text-slate-300',
                            )}>
                              Approval: {compactStatusLabel(approvalStatus)}
                            </Badge>
                          </div>
                          <p className="mt-1 max-w-[260px] text-[10px] text-muted-foreground">
                            {readiness.isReady ? 'Semua cek utama siap.' : [
                              readiness.missingMedia ? 'Media belum ada.' : '',
                              readiness.missingAI ? 'AI belum dibuat.' : '',
                              readiness.needsApproval ? readiness.approvals.reason : '',
                              readiness.schedulerStatus === 'FAILED' ? 'Scheduler gagal.' : '',
                            ].filter(Boolean).join(' ')}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className={cn(
                              'h-5 text-[9px]',
                              readiness.hasMedia ? 'border-green-500/30 bg-green-500/15 text-green-300' : 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
                            )}>
                              Media: {compactStatusLabel(mediaStatus)}
                            </Badge>
                            <Badge variant="outline" className={cn(
                              'h-5 text-[9px]',
                              readiness.hasAI ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300' : 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
                            )}>
                              AI: {compactStatusLabel(aiStatus)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {readiness.media.total} asset / {readiness.media.references} ref | {campaign.planningSummary?.aiPlan?.contentVariations?.length || 0} variasi
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-bold text-green-300">{readiness.healthyAccounts}</p>
                          <p className="text-[10px] text-muted-foreground">{readiness.skippedAccounts} dilewati</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="max-w-[230px] rounded-md border border-border/60 bg-background/45 p-2">
                            <p className="text-[10px] font-black uppercase tracking-wide text-cyan-300">Langkah Berikutnya</p>
                            <p className="mt-1 text-xs font-bold text-foreground">{nextAction.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{nextAction.description}</p>
                            <Badge variant="outline" className="mt-2 h-5 border-cyan-500/25 bg-cyan-500/10 text-[9px] text-cyan-200">
                              Klik: {nextAction.primaryLabel}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[10px] text-slate-300', nextAction.key === 'detail' && primaryActionClass)} onClick={() => loadDetail(campaign.id)} title="Lihat Detail">
                              <ListChecks className="mr-1 h-3.5 w-3.5" /> Lihat Detail
                            </Button>
                            <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[10px] text-purple-400', nextAction.key === 'compose' && primaryActionClass)} onClick={() => openInCompose(campaign.id)} disabled={preparingComposeIds.has(campaign.id)} title="Buka Compose">
                              <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Buka Compose
                            </Button>
                            <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[10px] text-cyan-400', nextAction.key === 'ai' && primaryActionClass)} onClick={() => generateAiPlan(campaign.id)} disabled={generatingPlanIds.has(campaign.id)} title="Generate Preview AI">
                              <Sparkles className="mr-1 h-3.5 w-3.5" /> Generate Preview AI
                            </Button>
                            <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[10px] text-blue-400', nextAction.key === 'media' && primaryActionClass)} onClick={() => openCampaignMedia(campaign.id)} title="Upload Konten">
                              <Upload className="mr-1 h-3.5 w-3.5" /> Upload Konten
                            </Button>
                            <Button size="sm" variant="ghost" className={cn('h-7 px-2 text-[10px] text-blue-400', nextAction.key === 'activity' && primaryActionClass)} onClick={() => openActivity(campaign.id)} title="Lihat Aktivitas">
                              <Activity className="mr-1 h-3.5 w-3.5" /> Lihat Aktivitas
                            </Button>
                            {readiness.schedulerStatus === 'FAILED' && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-orange-400" onClick={() => retryScheduler(campaign.id)} disabled={retryingSchedulerIds.has(campaign.id)} title="Retry Scheduler">
                                {retryingSchedulerIds.has(campaign.id) ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
                                Retry Scheduler
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => handleArchive(campaign.id, campaign.name)} title="Arsipkan Campaign">
                              <Archive className="mr-1 h-3.5 w-3.5" /> Arsipkan
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={cn(campaignMode !== 'simple' && "hidden")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            Campaign Analytics Snapshot
            <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">Read-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-6">
            {[
              ['Total Campaigns', analytics.totalCampaigns],
              ['Terjadwal', analytics.scheduledCampaigns],
              ['READY', analytics.readyCampaigns],
              ['Completed', analytics.completedCampaigns],
              ['Failed', analytics.failedCampaigns],
              ['Content Variations', analytics.totalVariations],
              ['Approved Variations', analytics.approvedVariations],
              ['Rejected Variations', analytics.rejectedVariations],
              ['Media Assets', analytics.totalMediaAssets],
              ['With Media', analytics.campaignsWithMedia],
              ['Without Media', analytics.campaignsWithoutMedia],
              ['Queue Failed Today', queueSummary?.failedToday ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-secondary/20 p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-black">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            {[
              ['Approval Rate', analytics.approvalRate, 'Approved or used variations'],
              ['Scheduler Success', analytics.schedulerSuccessRate, 'READY or executed vs failed'],
              ['Akun Sehat', analytics.healthyAccountRatio, 'Cakupan akun sehat'],
              ['Readiness Ratio', analytics.readinessRatio, 'READY campaigns vs total'],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-md border border-border bg-background/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-bold">{label}</p>
                  <span className="text-sm font-black">{value}%</span>
                </div>
                <Progress value={Number(value)} className="h-1.5" />
                <p className="mt-2 text-[10px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Posting Summary</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-secondary/25 p-2">
                  <p className="text-muted-foreground">Successful Posts Today</p>
                  <p className="text-lg font-black text-green-300">{analytics.successfulPostsToday}</p>
                </div>
                <div className="rounded-md bg-secondary/25 p-2">
                  <p className="text-muted-foreground">Failed Posts Today</p>
                  <p className="text-lg font-black text-red-300">{analytics.failedPostsToday}</p>
                </div>
                <div className="rounded-md bg-secondary/25 p-2">
                  <p className="text-muted-foreground">Queue Completed Today</p>
                  <p className="text-lg font-black">{queueSummary?.completedToday ?? 0}</p>
                </div>
                <div className="rounded-md bg-secondary/25 p-2">
                  <p className="text-muted-foreground">Queue Failed Today</p>
                  <p className="text-lg font-black">{queueSummary?.failedToday ?? 0}</p>
                </div>
              </div>
              {queueSummary?.unavailable && (
                <p className="mt-2 text-[10px] text-yellow-300">Queue summary unavailable. Showing safe fallback values.</p>
              )}
            </div>

            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Top Campaign Snapshot</p>
              {[
                ['Most Variations', analytics.topByVariations, analytics.topByVariations?.planningSummary?.aiPlan?.contentVariations?.length || 0],
                ['Most Media', analytics.topByMedia, analytics.topByMedia?.planningSummary?.mediaLibrary?.length || 0],
                ['Latest READY', analytics.latestReady, analytics.latestReady?.scheduledAt ? formatSchedule(analytics.latestReady.scheduledAt) : '-'],
                ['Latest FAILED', analytics.latestFailed, analytics.latestFailed?.lastExecutionAt ? formatSchedule(analytics.latestFailed.lastExecutionAt) : '-'],
              ].map(([label, campaign, value]) => (
                <div key={label as string} className="mb-2 flex items-center justify-between gap-2 rounded-md bg-secondary/25 p-2 text-xs last:mb-0">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">{label as string}</p>
                    <p className="truncate font-bold">{campaign ? (campaign as Campaign).name : 'No data'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">{String(value)}</span>
                    {campaign && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => loadDetail((campaign as Campaign).id)} title="Open campaign detail">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-border bg-background/60 p-3">
                <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Campaigns by Scheduler Status</p>
                <div className="space-y-2">
                  {schedulerChart.map(item => (
                    <div key={item.label} className="grid grid-cols-[88px_1fr_32px] items-center gap-2 text-[11px]">
                      <Badge variant="outline" className={cn('h-5 justify-center text-[9px]', item.className)}>{item.label}</Badge>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${safePercent(item.value, maxSchedulerChart)}%` }} />
                      </div>
                      <span className="text-right font-bold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/60 p-3">
                <p className="mb-2 text-xs font-black uppercase text-muted-foreground">Variations by Approval Status</p>
                <div className="space-y-2">
                  {approvalChart.map(item => (
                    <div key={item.label} className="grid grid-cols-[88px_1fr_32px] items-center gap-2 text-[11px]">
                      <Badge variant="outline" className={cn('h-5 justify-center text-[9px]', item.className)}>{item.label}</Badge>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-green-400" style={{ width: `${safePercent(item.value, maxApprovalChart)}%` }} />
                      </div>
                      <span className="text-right font-bold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Queue Snapshot
            {queueSummary?.unavailable && <Badge variant="outline" className="text-[10px] text-yellow-400">Unavailable</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['Queued Jobs', queueSummary?.queued ?? 0],
            ['Active Jobs', queueSummary?.active ?? 0],
            ['Delayed Jobs', queueSummary?.delayed ?? 0],
            ['Completed Today', queueSummary?.completedToday ?? 0],
            ['Failed Today', queueSummary?.failedToday ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-secondary/25 p-2">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-black">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-green-400" />
              Campaign Calendar View
            </CardTitle>
            <div className="flex flex-wrap gap-1">
              {[
                ['ALL', 'All'],
                ['PENDING', 'Pending'],
                ['READY', 'Ready'],
                ['FAILED', 'Failed'],
                ['TODAY', 'Today'],
                ['THIS_WEEK', 'This Week'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={calendarFilter === value ? 'default' : 'outline'}
                  className="h-7 px-2 text-[10px]"
                  onClick={() => setCalendarFilter(value as CalendarFilter)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {scheduledCampaigns.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              <CalendarClock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">No scheduled campaigns yet.</p>
              <p className="text-xs text-muted-foreground">Campaigns with scheduledAt will appear here.</p>
            </div>
          ) : (
            calendarBuckets.map(bucket => (
              <div key={bucket.label} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">{bucket.label}</p>
                  <Badge variant="outline" className="h-5 text-[10px]">{bucket.items.length}</Badge>
                </div>
                {bucket.items.length === 0 ? (
                  <div className="rounded-md border border-border/60 bg-secondary/15 px-3 py-2 text-xs text-muted-foreground">
                    No campaigns in this window.
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {bucket.items.map(({ campaign, date }) => {
                      const schedulerStatus = campaign.schedulerStatus || 'PENDING'
                      const groupsCount = campaign.planningSummary?.selectedGroups?.length ?? campaign.groupIds?.length ?? 0
                      const healthyAccounts = campaign.planningSummary?.healthyCount ?? campaign.accountIds.length
                      const approvals = approvalSummary(campaign)
                      const media = mediaSummary(campaign)
                      return (
                        <div
                          key={campaign.id}
                          className={cn(
                            'rounded-md border border-border bg-background/60 p-3 transition-colors hover:border-orange-500/30',
                            schedulerStatus === 'READY' && 'border-green-500/30 bg-green-500/[0.06]'
                          )}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black">{campaign.name}</p>
                              <p className="text-[11px] text-muted-foreground">{date.toLocaleString('id-ID')}</p>
                            </div>
                            <Badge variant="outline" className={cn('shrink-0 text-[10px]', SCHEDULER_STATUS_STYLES[schedulerStatus])}>
                              {schedulerStatus}
                            </Badge>
                          </div>

                          {schedulerStatus === 'READY' && (
                            <div className="mb-2 inline-flex items-center gap-1 rounded-md border border-green-500/25 bg-green-500/10 px-2 py-1 text-[10px] font-bold text-green-300">
                              <CheckCircle2 className="h-3 w-3" /> SIAP untuk Posting Manual
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded-md bg-secondary/25 p-2">
                              <p className="text-muted-foreground">Targets</p>
                              <p className="font-bold">{groupsCount} groups / {healthyAccounts} accounts</p>
                            </div>
                            <div className="rounded-md bg-secondary/25 p-2">
                              <p className="text-muted-foreground">Media</p>
                              <p className="font-bold">{media.total} total / {media.references} refs</p>
                              <p className="text-[10px] text-muted-foreground">{media.images} image / {media.videos} video</p>
                            </div>
                          </div>

                          <div className="mt-2 rounded-md bg-secondary/25 p-2 text-[11px]">
                            <p className="mb-1 text-muted-foreground">Approval Summary</p>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="h-5 text-[10px] text-green-300">{approvals.APPROVED} approved</Badge>
                              <Badge variant="outline" className="h-5 text-[10px] text-yellow-300">{approvals.NEEDS_REVIEW} review</Badge>
                              <Badge variant="outline" className="h-5 text-[10px] text-red-300">{approvals.REJECTED} rejected</Badge>
                              <Badge variant="outline" className="h-5 text-[10px] text-slate-300">{approvals.DRAFT} draft</Badge>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => loadDetail(campaign.id)}>
                              <ChevronRight className="mr-1 h-3.5 w-3.5" /> Details
                            </Button>
                            {schedulerStatus === 'READY' && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-purple-400" onClick={() => openInCompose(campaign.id)} disabled={preparingComposeIds.has(campaign.id)}>
                                <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Compose
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className={cn(campaignMode !== 'simple' && "hidden")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-amber-400" />
            Campaign Execution Table
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {campaigns.length === 0 ? (
            <div className="py-12 text-center">
              <Target className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No campaigns yet. Create your first campaign.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-xs">
                <thead className="border-b border-border bg-secondary/30 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Campaign</th>
                    <th className="px-3 py-3">Scheduler</th>
                    <th className="px-3 py-3">Terjadwal</th>
                    <th className="px-3 py-3">Akun Sehat</th>
                    <th className="px-3 py-3">Dilewati</th>
                    <th className="px-3 py-3">Last Execution</th>
                    <th className="px-3 py-3">Progress</th>
                    <th className="px-4 py-3 text-right">Aksi Cepat</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => {
                    const progress = c.totalActions > 0 ? Math.round(((c.completedActions + c.failedActions) / c.totalActions) * 100) : 0
                    const schedulerStatus = c.schedulerStatus || 'PENDING'
                    const healthyAccounts = c.planningSummary?.healthyCount ?? c.accountIds.length
                    const skippedAccounts = c.planningSummary?.skippedCount ?? 0
                    return (
                      <tr key={c.id} className={cn(
                        'border-b border-border/70 transition-colors hover:bg-secondary/25',
                        schedulerStatus === 'READY' && 'bg-green-500/[0.06] hover:bg-green-500/[0.09]'
                      )}>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="max-w-[220px] truncate font-bold">{c.name}</p>
                              <Badge variant="outline" className={cn('text-[9px]', STATUS_STYLES[c.status])}>{c.status.toUpperCase()}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">Target: <span className="text-foreground">{c.targetValue}</span></p>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="h-5 text-[10px]">{TYPE_LABELS[c.type] || c.type}</Badge>
                              {c.planningSummary?.selectedGroups?.slice(0, 2).map(group => (
                                <Badge key={group.id} variant="outline" className="h-5 text-[10px]">
                                  <Users className="mr-1 h-3 w-3" />{group.name}
                                </Badge>
                              ))}
                            </div>
                            {schedulerStatus === 'READY' && (
                              <div className="inline-flex items-center gap-1 rounded-md border border-green-500/25 bg-green-500/10 px-2 py-1 text-[10px] font-bold text-green-300">
                                <CheckCircle2 className="h-3 w-3" /> SIAP untuk Posting Manual
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <Badge variant="outline" className={cn('text-[10px]', SCHEDULER_STATUS_STYLES[schedulerStatus])}>
                            {schedulerStatus}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 align-top text-muted-foreground">{formatSchedule(c.scheduledAt) || '-'}</td>
                        <td className="px-3 py-3 align-top font-bold text-green-300">{healthyAccounts}</td>
                        <td className="px-3 py-3 align-top font-bold text-yellow-300">{skippedAccounts}</td>
                        <td className="px-3 py-3 align-top text-muted-foreground">{formatSchedule(c.lastExecutionAt || c.completedAt) || '-'}</td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex min-w-[150px] items-center gap-2">
                            <Progress value={progress} className="h-1.5 flex-1" />
                            <span className="w-9 text-right text-[11px] text-muted-foreground">{progress}%</span>
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            <span className="text-green-400">{c.completedActions}</span> done / <span className="text-red-400">{c.failedActions}</span> failed / {c.totalActions} total
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-purple-400" onClick={() => openInCompose(c.id)} disabled={preparingComposeIds.has(c.id)} title="Buka Compose">
                              <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Buka Compose
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-blue-400" onClick={() => openActivity(c.id)} title="Lihat Aktivitas">
                              <Activity className="mr-1 h-3.5 w-3.5" /> Lihat Aktivitas
                            </Button>
                            {schedulerStatus === 'FAILED' && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-orange-400" onClick={() => retryScheduler(c.id)} disabled={retryingSchedulerIds.has(c.id)} title="Retry Scheduler">
                                {retryingSchedulerIds.has(c.id) ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
                                Retry Scheduler
                              </Button>
                            )}
                            {schedulerStatus === 'PENDING' && c.scheduledAt && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-yellow-400" onClick={() => cancelSchedule(c.id)} title="Cancel Schedule">
                                Cancel Schedule
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => loadDetail(c.id)} title="Details"><ChevronRight className="h-3.5 w-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="hidden">
      {/* Campaign List */}
      {campaigns.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Target className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No campaigns yet. Create your first campaign!</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => {
            const progress = c.totalActions > 0 ? Math.round(((c.completedActions + c.failedActions) / c.totalActions) * 100) : 0
            return (
              <Card key={c.id} className="hover:border-orange-500/30 transition-colors">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold truncate">{c.name}</h3>
                        <Badge variant="outline" className={cn('text-[9px] h-4', STATUS_STYLES[c.status])}>{c.status.toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4">{TYPE_LABELS[c.type] || c.type}</Badge>
                        <Badge variant="outline" className={cn('text-[9px] h-4', SCHEDULER_STATUS_STYLES[c.schedulerStatus || 'PENDING'])}>
                          {(c.schedulerStatus || 'PENDING').toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Target: <span className="text-foreground font-medium">{c.targetValue}</span></span>
                        <span>{c.accountIds.length} accounts</span>
                        {c.planningSummary?.healthyCount !== undefined && <span>{c.planningSummary.healthyCount} healthy</span>}
                        {c.planningSummary?.skippedCount !== undefined && c.planningSummary.skippedCount > 0 && <span>{c.planningSummary.skippedCount} skipped</span>}
                        {c.scheduledAt && <span>Terjadwal: <span className="text-foreground">{formatSchedule(c.scheduledAt)}</span></span>}
                        <span>{new Date(c.createdAt).toLocaleDateString('id-ID')}</span>
                      </div>
                      {c.schedulerStatus === 'READY' && (
                        <div className="mt-2 rounded-md border border-green-500/20 bg-green-500/[0.06] px-2 py-1.5 text-xs text-green-300">
                          READY for manual Compose review. Scheduler has not posted anything.
                        </div>
                      )}
                      {c.planningSummary?.selectedGroups?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.planningSummary.selectedGroups.map(group => (
                            <Badge key={group.id} variant="outline" className="h-5 text-[10px]">
                              <Users className="mr-1 h-3 w-3" />{group.name}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {c.planningSummary?.aiPlan && (
                        <div className="mt-2 rounded-md border border-purple-500/20 bg-purple-500/[0.03] p-2">
                          <div className="mb-1 flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                            <p className="text-[11px] font-bold text-purple-300">AI Planning</p>
                            <Badge variant="outline" className="h-4 text-[9px]">{c.planningSummary.aiPlan.source}</Badge>
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{c.planningSummary.aiPlan.strategySummary}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Progress value={progress} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{progress}%</span>
                        <span className="text-xs"><span className="text-green-400">{c.completedActions}✓</span> / <span className="text-red-400">{c.failedActions}✗</span> / {c.totalActions}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-blue-400" onClick={() => openSchedule(c)} disabled={['READY', 'EXECUTED'].includes(c.schedulerStatus || '') || ['running', 'paused'].includes(c.status)} title="Schedule draft preparation">
                        <CalendarClock className="mr-1 h-3.5 w-3.5" /> Schedule
                      </Button>
                      {c.schedulerStatus === 'PENDING' && c.scheduledAt && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-yellow-400" onClick={() => cancelSchedule(c.id)} title="Cancel schedule">
                          Cancel
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-purple-400" onClick={() => openInCompose(c.id)} disabled={preparingComposeIds.has(c.id)} title="Prepare Post">
                        <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Prepare Post
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-purple-400" onClick={() => prepareVariations(c.id)} disabled={preparingComposeIds.has(c.id) || !c.planningSummary?.aiPlan?.contentVariations?.length} title="Prepare Variations">
                        <Sparkles className="mr-1 h-3.5 w-3.5" /> Prepare Variations
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-purple-400" onClick={() => generateAiPlan(c.id)} disabled={generatingPlanIds.has(c.id)} title={c.planningSummary?.aiPlan ? 'Regenerate AI Plan' : 'Generate AI Plan'}>
                        {generatingPlanIds.has(c.id) ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                        {c.planningSummary?.aiPlan ? 'Regenerate' : 'AI Plan'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => loadDetail(c.id)} title="Details"><ChevronRight className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-orange-400" /> Buat Campaign Baru</DialogTitle>
            <DialogDescription>Buat campaign distribusi konten untuk grup akun dan brand utama.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="rounded-lg border border-orange-500/20 bg-orange-500/[0.04] px-3 py-2 text-xs text-muted-foreground">
              Tentukan material, tujuan campaign, dan arah distribusi konten. Posting tetap manual melalui Compose.
            </p>
            <div>
              <Label className="text-xs font-bold">Nama Campaign</Label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Campaign Monaco Grey Mei" className="w-full mt-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold">Tujuan Campaign</Label>
                <select
                  value={campaignObjective}
                  onChange={e => {
                    const nextObjective = e.target.value as CampaignObjective
                    setCampaignObjective(nextObjective)
                    setType(OBJECTIVE_TO_ACTION_TYPE[nextObjective])
                  }}
                  className="w-full mt-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm"
                >
                  {CAMPAIGN_OBJECTIVES.map(objective => (
                    <option key={objective} value={objective}>{CAMPAIGN_OBJECTIVE_LABELS[objective]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-bold">Sumber Audience</Label>
                <select
                  value={audienceSource}
                  onChange={e => {
                    const nextSource = e.target.value as AudienceSource
                    setAudienceSource(nextSource)
                    setTargetType(AUDIENCE_SOURCE_TO_TARGET_TYPE[nextSource])
                  }}
                  className="w-full mt-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm"
                >
                  {AUDIENCE_SOURCES.map(source => (
                    <option key={source} value={source}>{AUDIENCE_SOURCE_LABELS[source]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs font-bold">Fokus Material / Topik</Label>
              <input
                value={targetValue}
                onChange={e => setTargetValue(e.target.value)}
                placeholder={audienceSource === 'Username' ? '@username' : audienceSource === 'Post URL' ? 'https://instagram.com/p/...' : 'Contoh: Monaco Grey, Promo 666, Grey Levanto Bali'}
                className="w-full mt-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <CampaignTemplatePresetManager
              currentTemplate={{
                name,
                description: '',
                actionType: type,
                targetType,
                targetValue,
                defaultCaptionSeed,
                defaultHashtags,
                suggestedTone,
                suggestedCTA,
                groupIds: Array.from(selGroups),
                accountIds: Array.from(selAccounts),
              }}
              onApply={applyCampaignTemplate}
              compact
            />
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <div className="mb-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Template Assist Fields</p>
                <p className="text-[10px] text-muted-foreground">Saved to templates only. Create Campaign does not auto-post or schedule.</p>
              </div>
              <div className="space-y-2">
                <textarea
                  value={defaultCaptionSeed}
                  onChange={event => setDefaultCaptionSeed(event.target.value)}
                  placeholder="Default caption seed for Compose..."
                  className="min-h-20 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs outline-none focus:border-orange-500/50"
                />
                <input
                  value={defaultHashtags}
                  onChange={event => setDefaultHashtags(event.target.value)}
                  placeholder="#marmer #interior #jakarta"
                  className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs outline-none focus:border-orange-500/50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={suggestedTone}
                    onChange={event => setSuggestedTone(event.target.value)}
                    placeholder="Suggested tone"
                    className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs outline-none focus:border-orange-500/50"
                  />
                  <input
                    value={suggestedCTA}
                    onChange={event => setSuggestedCTA(event.target.value)}
                    placeholder="Suggested CTA"
                    className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs outline-none focus:border-orange-500/50"
                  />
                </div>
              </div>
            </div>
            <AccountLoadoutPresetManager
              selectedAccountIds={Array.from(selAccounts)}
              selectedGroupIds={Array.from(selGroups)}
              onApply={applyLoadoutPreset}
              defaultName={name}
              compact
            />
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-bold">Account Groups ({selGroups.size})</Label>
                {groups.length > 0 && (
                  <button onClick={() => { if (allGroupSel) setSelGroups(new Set()); else setSelGroups(new Set(groups.map(g => g.id))) }} className="text-[10px] text-orange-400 hover:text-orange-300">
                    {allGroupSel ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto rounded-lg border border-border p-2">
                {!groupsLoaded ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">Loading groups...</p>
                ) : groupsLoadError ? (
                  <p className="py-2 text-center text-xs text-red-400">{groupsLoadError}</p>
                ) : groups.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">No account groups yet.</p>
                ) : groups.map(group => (
                  <div key={group.id} onClick={() => { const n = new Set(selGroups); n.has(group.id) ? n.delete(group.id) : n.add(group.id); setSelGroups(n) }} className={cn('flex items-center justify-between rounded px-2 py-1.5 cursor-pointer text-xs transition-colors', selGroups.has(group.id) ? 'bg-orange-600/10' : 'hover:bg-secondary')}>
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox checked={selGroups.has(group.id)} onClick={e => e.stopPropagation()} />
                      <span className="truncate font-medium">{group.name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{group.memberCount}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-bold">Accounts ({selAccounts.size})</Label>
                <button onClick={() => { if (allSel) setSelAccounts(new Set()); else setSelAccounts(new Set(accounts.map(a => a.id))) }} className="text-[10px] text-orange-400 hover:text-orange-300">
                  {allSel ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-border p-2">
                {accountsLoadError ? (
                  <p className="py-2 text-center text-xs text-red-400">{accountsLoadError}</p>
                ) : accounts.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">No active accounts available.</p>
                ) : accounts.map(acc => (
                  <div key={acc.id} onClick={() => { const n = new Set(selAccounts); n.has(acc.id) ? n.delete(acc.id) : n.add(acc.id); setSelAccounts(n) }} className={cn('flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-xs transition-colors', selAccounts.has(acc.id) ? 'bg-orange-600/10' : 'hover:bg-secondary')}>
                    <Checkbox checked={selAccounts.has(acc.id)} onClick={e => e.stopPropagation()} />
                    <span className="font-medium">@{acc.username}</span>
                  </div>
                ))}
              </div>
            </div>
            {(preview || previewLoading) && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-bold">Execution Preview</p>
                  {previewLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-background/50 p-2"><p className="text-[10px] text-muted-foreground">Resolved</p><p className="text-sm font-bold">{preview?.totalResolved ?? '-'}</p></div>
                  <div className="rounded-md bg-green-500/10 p-2"><p className="text-[10px] text-green-400">Akun Sehat</p><p className="text-sm font-bold text-green-400">{preview?.healthyCount ?? '-'}</p></div>
                  <div className="rounded-md bg-yellow-500/10 p-2"><p className="text-[10px] text-yellow-400">Dilewati</p><p className="text-sm font-bold text-yellow-400">{preview?.skippedCount ?? '-'}</p></div>
                </div>
                {preview && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Posting spread: {formatDuration(Math.max(0, (preview.healthyCount * (type === 'mixed' ? 3 : 1) - 1) * 15))} to {formatDuration(Math.max(0, (preview.healthyCount * (type === 'mixed' ? 3 : 1) - 1) * 45))}</span>
                    <span>Queue duration: {formatDuration(Math.max(0, (preview.healthyCount * (type === 'mixed' ? 3 : 1) - 1) * 30))}</span>
                  </div>
                )}
              </div>
            )}
            <Button onClick={handleCreate} disabled={loading} className="w-full bg-gradient-to-r from-orange-600 to-amber-600">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create Campaign
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Campaign Dialog */}
      <Dialog open={!!scheduleCampaign} onOpenChange={(open) => { if (!open) { setScheduleCampaign(null); setScheduleAtLocal('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-blue-400" /> Schedule Draft
            </DialogTitle>
            <DialogDescription>
              Scheduler will only prepare a Compose draft. Posting still requires manual Start Bulk Post.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-sm font-bold">{scheduleCampaign?.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {scheduleCampaign?.planningSummary?.healthyCount ?? scheduleCampaign?.accountIds.length ?? 0} healthy account(s) planned.
              </p>
            </div>
            <div>
              <Label className="text-xs font-bold">Waktu Terjadwal</Label>
              <input
                type="datetime-local"
                value={scheduleAtLocal}
                onChange={e => setScheduleAtLocal(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-blue-500/50 focus:outline-none"
              />
            </div>
            <Button onClick={saveSchedule} disabled={scheduling} className="w-full">
              {scheduling ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1 h-4 w-4" />}
              Save Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={() => { setDetailId(null); setDetailData(null); setCampaignMedia([]); setVariationMediaRefs({}); setVariationApprovals({}); setSelectedMediaFile(null); setMediaNote(''); setApprovalFilter('ALL') }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Campaign Details</DialogTitle>
            <DialogDescription>{detailData?.name || 'Loading...'}</DialogDescription>
          </DialogHeader>
          {detailData && (
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded-lg bg-secondary/50"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold">{detailData.totalActions}</p></div>
                <div className="p-2 rounded-lg bg-green-500/10"><p className="text-xs text-green-400">Selesai</p><p className="text-lg font-bold text-green-400">{detailData.completedActions}</p></div>
                <div className="p-2 rounded-lg bg-red-500/10"><p className="text-xs text-red-400">Gagal</p><p className="text-lg font-bold text-red-400">{detailData.failedActions}</p></div>
                <div className="p-2 rounded-lg bg-yellow-500/10"><p className="text-xs text-yellow-400">Dilewati</p><p className="text-lg font-bold text-yellow-400">{detailData.skippedActions}</p></div>
              </div>
              <Progress value={detailData.progressPercent} className="h-2" />
              <p className="text-xs text-center text-muted-foreground">{detailData.progressPercent}% selesai</p>
              {(() => {
                const swarmBrief = buildSwarmBrief(detailData as Campaign)
                const waves = buildCampaignWaves(detailData as Campaign)
                const brandRoles = buildBrandRoles(detailData as Campaign)
                const intelligence = buildCampaignIntelligence(detailData as Campaign)
                const prediction = buildCampaignPrediction(detailData as Campaign)
                const learningMemory = buildCampaignLearningMemory(detailData as Campaign)
                const factoryRequests = buildContentFactoryRequests(detailData as Campaign)
                const automationPipeline = buildAutomationPipeline(detailData as Campaign)
                const automationRequestState = buildAutomationRequestState(automationRequestStates[detailData.id])
                const automationPayload = automationPayloads[detailData.id]
                const universalAutomationSchema = buildUniversalAutomationSchemaFromModule(
                  detailData as AutomationCampaign,
                  automationPayload as ModuleAutomationRequestPayload | undefined,
                ) as UniversalAutomationSchema
                const automationLogs = automationRequestLogs[detailData.id] || []
                const localWebhookResult = localWebhookResults[detailData.id] || { status: 'idle' as LocalWebhookResultStatus }
                const deliveryDiagnostics = buildAutomationDeliveryDiagnosticsFromModule(
                  universalAutomationSchema as ModuleUniversalAutomationSchema,
                  localWebhookResult,
                  localWebhookEndpoint,
                )
                const generatedContent = buildGeneratedContentWorkspace(detailData as Campaign)
                const scoredGeneratedContent = generatedContent.map(item => ({
                  item,
                  score: buildContentScore(item, detailData as Campaign),
                  match: buildAccountMatchmaking(item, detailData as Campaign),
                }))
                const topRecommendedContent = [...scoredGeneratedContent]
                  .sort((a, b) => b.score.qualityScore - a.score.qualityScore)[0]
                return (
                  <>
                    <CampaignPredictionPanel prediction={prediction} />
                    <CampaignLearningMemoryPanel learningMemory={learningMemory} />
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Sparkles className="h-3.5 w-3.5 text-purple-300" /> Campaign Intelligence Panel
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Rekomendasi praktis untuk membantu operator memilih konten, tipe akun, dan arah konversi.</p>
                        </div>
                        <Badge variant="outline" className="w-fit border-purple-500/30 bg-purple-500/10 text-[10px] text-purple-200">Recommendation</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-purple-200">
                            <Sparkles className="h-3 w-3" /> Insight
                          </p>
                          <p className="text-[11px] text-muted-foreground">{intelligence.insight}</p>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-cyan-200">
                            <Image className="h-3 w-3" /> Content Priority
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {intelligence.contentPriority.map(item => (
                              <Badge key={item} variant="outline" className="h-5 text-[9px]">{item}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-200">
                            <Users className="h-3 w-3" /> Rekomendasi Tipe Akun
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {intelligence.swarmStrategy.map(item => (
                              <Badge key={item} variant="outline" className="h-5 text-[9px]">{item}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-green-200">
                            <Target className="h-3 w-3" /> Conversion Direction
                          </p>
                          <p className="text-[11px] text-muted-foreground">{intelligence.conversionDirection}</p>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-blue-200">
                            <Clock className="h-3 w-3" /> Posting Window
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {intelligence.postingWindows.map(window => (
                              <Badge key={window} variant="outline" className="h-5 text-[9px]">{window}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-background/45 p-2">
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-orange-200">
                            <AlertTriangle className="h-3 w-3" /> Risk Notes
                          </p>
                          <div className="space-y-1">
                            {intelligence.riskNotes.map(note => (
                              <p key={note} className="text-[10px] text-muted-foreground">{note}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <AutomationRequestCenter
                      automationPayload={automationPayload}
                      automationLogs={automationLogs}
                      universalAutomationSchema={universalAutomationSchema}
                      automationSchemaTab={automationSchemaTab}
                      localWebhookEndpoint={localWebhookEndpoint}
                      defaultLocalWebhookEndpoint={defaultLocalWebhookEndpoint}
                      localWebhookResult={localWebhookResult}
                      localWebhookHistory={localWebhookHistory}
                      deliveryDiagnostics={deliveryDiagnostics}
                      onCreateAutomationRequest={(requestType) => createAutomationRequest(detailData as Campaign, requestType)}
                      onAdvanceAutomationRequest={() => advanceAutomationRequest(detailData.id)}
                      onSchemaTabChange={setAutomationSchemaTab}
                      onCopyAutomationSchema={() => copyAutomationSchema(universalAutomationSchema)}
                      onLocalWebhookEndpointChange={setLocalWebhookEndpoint}
                      onSendLocalWebhookPayload={() => sendLocalWebhookPayload(detailData as Campaign, universalAutomationSchema)}
                      isAllowedLocalWebhookEndpoint={isAllowedLocalWebhookEndpointFromModule}
                      formatSchedule={formatSchedule}
                    />
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Image className="h-3.5 w-3.5 text-blue-300" /> Content Factory Requests
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Rencana kebutuhan produksi konten untuk campaign ini.</p>
                        </div>
                        <Badge variant="outline" className="w-fit border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-200">Planning</Badge>
                      </div>
                      <div className="mb-3 flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10px] text-blue-200"
                          onClick={() => simulateAutomationBridge(detailData.id, 'Queued', 'Queue simulated', 'Automation batch queued (simulation only).')}
                        >
                          <CalendarClock className="mr-1 h-3.5 w-3.5" /> Queue Automation
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10px] text-cyan-200"
                          onClick={() => simulateAutomationBridge(detailData.id, 'Preparing', 'Batch prepared', 'Automation batch prepared (simulation only).')}
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Generate Batch
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10px] text-purple-200"
                          onClick={() => simulateAutomationBridge(detailData.id, 'Ready', 'AI assets prepared', 'AI assets prepared (simulation only).')}
                        >
                          <Sparkles className="mr-1 h-3.5 w-3.5" /> Prepare AI Assets
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10px] text-green-200"
                          onClick={() => simulateAutomationBridge(detailData.id, 'Ready', 'Visual pipeline staged', 'Visual pipeline staged (simulation only).')}
                        >
                          <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Send to Visual Pipeline
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        {factoryRequests.map(request => (
                          <div key={`${request.goal}-${request.format}`} className="rounded-md border border-border/60 bg-background/45 p-2">
                            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-xs font-bold text-foreground">{request.goal}</p>
                                <p className="text-[10px] text-muted-foreground">{request.format} | {request.estimatedBatch}</p>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'w-fit text-[9px]',
                                  request.priority === 'HIGH' && 'border-red-500/30 bg-red-500/10 text-red-300',
                                  request.priority === 'MEDIUM' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                                  request.priority === 'LOW' && 'border-slate-500/30 bg-slate-500/10 text-slate-300',
                                )}
                              >
                                {request.priority}
                              </Badge>
                            </div>
                            <div className="grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-2">
                              <p>Visual Style: <span className="text-foreground">{request.visualStyle}</span></p>
                              <p>Production Source: <span className="text-foreground">{request.source}</span></p>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                'mt-2 h-5 text-[9px]',
                                automationRequestState.status === 'Waiting' && 'border-border text-muted-foreground',
                                automationRequestState.status === 'Queued' && 'border-blue-500/30 bg-blue-500/10 text-blue-200',
                                automationRequestState.status === 'Preparing' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                                automationRequestState.status === 'Ready' && 'border-green-500/30 bg-green-500/10 text-green-300',
                              )}
                            >
                              {automationRequestState.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2">
                        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-blue-200">Automation Activity</p>
                        {automationRequestState.activity.length > 0 ? (
                          <div className="space-y-1">
                            {automationRequestState.activity.map((item, index) => (
                              <p key={`${item}-${index}`} className="text-[10px] text-muted-foreground">{item}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">Belum ada simulasi automation.</p>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Simulation mode. Automation engine belum terhubung.
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Activity className="h-3.5 w-3.5 text-cyan-300" /> Automation Pipeline
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Visualisasi alur automation campaign untuk future AI workflow.</p>
                        </div>
                        <Badge variant="outline" className="w-fit border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200">Future-ready</Badge>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {automationPipeline.map((stage, index) => (
                          <div key={stage.name} className="flex min-w-[135px] items-stretch gap-2">
                            <div
                              className={cn(
                                'w-full rounded-md border p-2',
                                stage.status === 'ready' && 'border-green-500/25 bg-green-500/10',
                                stage.status === 'simulated' && 'border-cyan-500/30 bg-cyan-500/10',
                                stage.status === 'manual' && 'border-yellow-500/30 bg-yellow-500/10',
                                stage.status === 'waiting' && 'border-border bg-secondary/30',
                              )}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-[10px] font-bold text-foreground">{stage.name}</p>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'h-4 shrink-0 text-[8px]',
                                    stage.status === 'ready' && 'border-green-500/30 text-green-300',
                                    stage.status === 'simulated' && 'border-cyan-500/30 text-cyan-200',
                                    stage.status === 'manual' && 'border-yellow-500/30 text-yellow-300',
                                    stage.status === 'waiting' && 'border-border text-muted-foreground',
                                  )}
                                >
                                  {stage.status}
                                </Badge>
                              </div>
                              <p className="line-clamp-3 text-[9px] text-muted-foreground">{stage.description}</p>
                            </div>
                            {index < automationPipeline.length - 1 && (
                              <ChevronRight className="mt-8 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Visualization only. Automation engine belum aktif.
                      </p>
                    </div>
                    <div className="rounded-lg border border-green-500/20 bg-green-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Image className="h-3.5 w-3.5 text-green-300" /> Generated Content Workspace
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Simulasi hasil produksi konten dari automation pipeline.</p>
                        </div>
                        <Badge variant="outline" className="w-fit border-green-500/30 bg-green-500/10 text-[10px] text-green-200">Simulation</Badge>
                      </div>
                      {topRecommendedContent && (
                        <div className="mb-3 rounded-md border border-green-500/20 bg-green-500/[0.05] p-2">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wide text-green-300">Top Recommended Content</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {topRecommendedContent.item.title} direkomendasikan untuk prioritas distribusi pertama.
                              </p>
                            </div>
                            <Badge variant="outline" className="w-fit border-green-500/30 bg-green-500/10 text-[10px] text-green-300">
                              Score {topRecommendedContent.score.qualityScore}
                            </Badge>
                          </div>
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {scoredGeneratedContent.map(({ item, score, match }) => (
                          <div key={item.title} className="rounded-md border border-border/60 bg-background/45 p-2">
                            <div className="mb-2 flex items-start gap-2">
                              <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500/25 via-purple-500/20 to-green-500/20">
                                {item.format === 'Reels 9:16' || item.format === 'Story' ? (
                                  <Video className="h-5 w-5 text-cyan-200" />
                                ) : (
                                  <Image className="h-5 w-5 text-green-200" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-bold text-foreground">{item.title}</p>
                                    <p className="text-[10px] text-muted-foreground">{item.format} | {item.estimatedSize}</p>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'shrink-0 text-[9px]',
                                      item.status === 'READY' && 'border-green-500/30 bg-green-500/10 text-green-300',
                                      item.status === 'PROCESSING' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                                      item.status === 'WAITING' && 'border-border bg-secondary/30 text-muted-foreground',
                                      item.status === 'FAILED' && 'border-red-500/30 bg-red-500/10 text-red-300',
                                    )}
                                  >
                                    {item.status}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-[10px] text-muted-foreground">Source: <span className="text-foreground">{item.source}</span></p>
                              </div>
                            </div>
                            <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-[10px] font-black uppercase tracking-wide text-amber-200">Recommended Distribution</p>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'h-5 text-[9px]',
                                    match.engagementFit === 'Strong' && 'border-green-500/30 bg-green-500/10 text-green-300',
                                    match.engagementFit === 'Medium' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                                    match.engagementFit === 'Weak' && 'border-red-500/30 bg-red-500/10 text-red-300',
                                  )}
                                >
                                  Fit: {match.engagementFit}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {match.recommendedAccountTypes.map(type => (
                                  <Badge key={type} variant="outline" className="h-5 text-[9px]">{type}</Badge>
                                ))}
                              </div>
                              <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
                                <p>Jumlah: <span className="text-foreground">{match.distributionSize}</span></p>
                                <p>Style: <span className="text-foreground">{match.postingStyle}</span></p>
                              </div>
                            </div>
                            <div className="mb-2 rounded-md border border-border/50 bg-background/35 p-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-[10px] font-bold text-muted-foreground">Quality Score</p>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'h-5 text-[9px]',
                                    score.qualityScore >= 80 && 'border-green-500/30 bg-green-500/10 text-green-300',
                                    score.qualityScore >= 55 && score.qualityScore < 80 && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                                    score.qualityScore < 55 && 'border-red-500/30 bg-red-500/10 text-red-300',
                                  )}
                                >
                                  {score.qualityScore}/100
                                </Badge>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    score.qualityScore >= 80 && 'bg-green-400',
                                    score.qualityScore >= 55 && score.qualityScore < 80 && 'bg-yellow-400',
                                    score.qualityScore < 55 && 'bg-red-400',
                                  )}
                                  style={{ width: `${score.qualityScore}%` }}
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                <Badge variant="outline" className="h-5 text-[9px]">AI: {score.aiConfidence}</Badge>
                                <Badge variant="outline" className="h-5 text-[9px]">Priority: {score.distributionPriority}</Badge>
                                <Badge variant="outline" className="h-5 text-[9px]">{score.readiness}</Badge>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[9px] text-cyan-300" onClick={() => toast.success(`${item.title} preview opened (simulation only).`)}>
                                <ExternalLink className="mr-1 h-3 w-3" /> Preview
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[9px] text-purple-300" onClick={() => toast.success(`${item.title} staged for Compose (simulation only).`)}>
                                <SendHorizontal className="mr-1 h-3 w-3" /> Send to Compose
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[9px] text-slate-300" onClick={() => toast.success(`${item.title} archived (simulation only).`)}>
                                <Trash2 className="mr-1 h-3 w-3" /> Archive
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {topRecommendedContent && (
                        <div className="mt-3 rounded-md border border-cyan-500/20 bg-cyan-500/[0.04] p-2">
                          <p className="text-[10px] font-black uppercase tracking-wide text-cyan-300">AI Distribution Recommendation</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {topRecommendedContent.item.title} cocok untuk distribusi awal ke {topRecommendedContent.match.recommendedAccountTypes.slice(0, 2).join(' dan ')}.
                          </p>
                        </div>
                      )}
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Simulation mode. Belum ada render asli dari automation engine.
                      </p>
                    </div>
                    <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.03] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Sparkles className="h-3.5 w-3.5 text-orange-400" /> Ringkasan Distribusi
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{swarmBrief.title}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{swarmBrief.nextStep}</Badge>
                      </div>
                      <div className="grid gap-2 text-xs sm:grid-cols-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Topik</p>
                          <p className="mt-0.5 line-clamp-2 text-foreground">{swarmBrief.topic}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Tujuan Campaign</p>
                          <p className="mt-0.5 text-foreground">{CAMPAIGN_OBJECTIVE_LABELS[swarmBrief.objective]}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Sumber Audience</p>
                          <p className="mt-0.5 text-foreground">{AUDIENCE_SOURCE_LABELS[swarmBrief.audienceSource]}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Sudut Konten</p>
                          <div className="space-y-1">
                            {swarmBrief.contentAngles.map(angle => (
                              <p key={angle} className="rounded-md bg-background/45 px-2 py-1 text-muted-foreground">{angle}</p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Strategi Distribusi</p>
                          <div className="space-y-1">
                            {swarmBrief.swarmActions.map(action => (
                              <p key={action} className="rounded-md bg-background/45 px-2 py-1 text-muted-foreground">{action}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <ListChecks className="h-3.5 w-3.5 text-cyan-400" /> Tahap Distribusi Campaign
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Wave planner manual. Tidak memicu posting otomatis.</p>
                        </div>
                        <Badge variant="outline" className="w-fit text-[10px]">{waves.length} tahap campaign</Badge>
                      </div>
                      <div className="space-y-2">
                        {waves.map(wave => (
                          <div key={wave.label} className="rounded-md border border-border/60 bg-background/45 p-2">
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wide text-cyan-300">{wave.label}</p>
                                <p className="text-xs font-bold text-foreground">{wave.title}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0 text-[9px]">{CAMPAIGN_OBJECTIVE_LABELS[wave.objective]}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{wave.purpose}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {wave.contentFocus.map(focus => (
                                <Badge key={focus} variant="outline" className="h-5 text-[9px]">{focus}</Badge>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px] text-muted-foreground">
                              Rekomendasi Aksi: <span className="text-foreground">{wave.recommendedAction}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-bold">
                            <Users className="h-3.5 w-3.5 text-amber-400" /> Campaign Conversion Routing
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Detail konversi untuk arah perhatian campaign.</p>
                        </div>
                        <Badge variant="outline" className="w-fit text-[10px]">{brandRoles.length} brands</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {brandRoles.map(role => (
                          <div key={role.brand} className="rounded-md border border-border/60 bg-background/45 p-2">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-foreground">{role.brand}</p>
                                <p className="text-[10px] text-amber-300">Peran Konversi: {role.role}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0 text-[9px]">{CAMPAIGN_OBJECTIVE_LABELS[role.objective]}</Badge>
                            </div>
                            <div className="space-y-1 text-[10px] text-muted-foreground">
                              <p>Fokus Campaign: <span className="text-foreground">{role.suggestedFocus}</span></p>
                              <p>Tujuan Konversi: <span className="text-foreground">{role.suggestedCTA}</span></p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">Tujuan ini hanya saran. Grup akun distribusi tetap terpisah dari akun brand resmi.</p>
                    </div>
                  </>
                )
              })()}
              {detailData.planningSummary && (
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="mb-2 text-xs font-bold">Execution Summary</p>
                  {detailData.planningSummary.selectedGroups?.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {detailData.planningSummary.selectedGroups.map((group: any) => (
                        <Badge key={group.id} variant="outline" className="h-5 text-[10px]">
                          <Users className="mr-1 h-3 w-3" />{group.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Resolved: <span className="text-foreground">{detailData.planningSummary.totalResolved}</span></span>
                    <span>Akun Sehat: <span className="text-green-400">{detailData.planningSummary.healthyCount}</span></span>
                    <span>Dilewati: <span className="text-yellow-400">{detailData.planningSummary.skippedCount}</span></span>
                    <span>Actions: <span className="text-foreground">{detailData.planningSummary.actionCount}</span></span>
                    <span>Spread: <span className="text-foreground">{formatDuration(detailData.planningSummary.estimatedPostingSpreadMinutes?.min)} to {formatDuration(detailData.planningSummary.estimatedPostingSpreadMinutes?.max)}</span></span>
                    <span>Queue: <span className="text-foreground">{formatDuration(detailData.planningSummary.estimatedQueueDurationMinutes)}</span></span>
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.03] p-3">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-xs font-bold">
                    <Image className="h-3.5 w-3.5 text-blue-400" /> Campaign Media Library
                  </p>
                  <Badge variant="outline" className="w-fit text-[10px]">{campaignMedia.length} asset{campaignMedia.length === 1 ? '' : 's'}</Badge>
                </div>
                <div className="grid gap-2 rounded-md border border-border/60 bg-background/50 p-2 sm:grid-cols-[1fr_120px]">
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/*,video/*,.pdf,.txt"
                      onChange={(event) => setSelectedMediaFile(event.target.files?.[0] || null)}
                      className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs"
                    />
                    <input
                      value={mediaNote}
                      onChange={event => setMediaNote(event.target.value)}
                      placeholder="Short note or asset purpose..."
                      className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs outline-none focus:border-blue-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <select
                      value={mediaType}
                      onChange={event => setMediaType(event.target.value as 'image' | 'video' | 'reference')}
                      className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="reference">Reference</option>
                    </select>
                    <Button size="sm" className="h-8 w-full text-xs" onClick={uploadCampaignMedia} disabled={mediaUploading || !selectedMediaFile}>
                      {mediaUploading ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                      Add Media
                    </Button>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {campaignMedia.length === 0 ? (
                    <p className="rounded-md border border-border/60 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
                      No campaign media yet. Add reference assets here without sending anything to posting.
                    </p>
                  ) : campaignMedia.map(item => {
                    const Icon = item.type === 'video' ? Video : item.type === 'image' ? Image : FileText
                    const isImage = item.mimeType?.startsWith('image/')
                    return (
                      <div key={item.id} className="flex gap-3 rounded-md border border-border/60 bg-background/50 p-2">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
                          {isImage ? (
                            <img src={item.url} alt={item.originalName} className="h-full w-full object-cover" />
                          ) : (
                            <Icon className="h-5 w-5 text-blue-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-xs font-bold">{item.originalName || item.filename}</p>
                            <Badge variant="outline" className="h-5 text-[10px]">{item.type}</Badge>
                          </div>
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">{item.path}</p>
                          {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">{formatSchedule(item.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => window.open(item.url, '_blank')} title="Preview">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copyMediaPath(item.path)} title="Copy path">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => removeCampaignMedia(item.id)} title="Remove reference">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs font-bold">
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" /> AI Planning
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    onClick={() => generateAiPlan(detailData.id)}
                    disabled={generatingPlanIds.has(detailData.id)}
                  >
                    {generatingPlanIds.has(detailData.id) ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                    {detailData.planningSummary?.aiPlan ? 'Regenerate' : 'Generate AI Plan'}
                  </Button>
                </div>
                {detailData.planningSummary?.aiPlan ? (
                  <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground">{detailData.planningSummary.aiPlan.strategySummary}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">Content Angle</p>
                        <p>{detailData.planningSummary.aiPlan.contentAngle}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">CTA</p>
                        <p>{detailData.planningSummary.aiPlan.suggestedCta}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">Tone</p>
                        <p>{detailData.planningSummary.aiPlan.postingTone}</p>
                      </div>
                      {detailData.planningSummary.aiPlan.captionSeed && (
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Caption Seed</p>
                          <p>{detailData.planningSummary.aiPlan.captionSeed}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {detailData.planningSummary.aiPlan.suggestedHashtags?.map((tag: string) => (
                        <Badge key={tag} variant="outline" className="h-5 text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                    {(detailData.planningSummary.aiPlan.contentVariations?.length || 0) > 0 && (
                      <div className="space-y-2 border-t border-border/50 pt-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Content Approval Board</p>
                          <div className="flex flex-wrap gap-1">
                            {(['ALL', 'DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'USED'] as const).map(status => (
                              <Button
                                key={status}
                                size="sm"
                                variant={approvalFilter === status ? 'purple' : 'outline'}
                                className="h-6 px-2 text-[9px]"
                                onClick={() => setApprovalFilter(status)}
                              >
                                {compactStatusLabel(status)}
                              </Button>
                            ))}
                          </div>
                        </div>
                        {detailData.planningSummary.aiPlan.contentVariations
                          .map((variation: CampaignContentVariation, index: number) => ({ variation, index }))
                          .filter(({ variation, index }: { variation: CampaignContentVariation; index: number }) => {
                            const key = `${variation.title}-${index}`
                            const status = variationApprovals[key]?.status || 'DRAFT'
                            return approvalFilter === 'ALL' || status === approvalFilter
                          })
                          .map(({ variation, index }: { variation: CampaignContentVariation; index: number }) => {
                          const variationKey = `${variation.title}-${index}`;
                          const refs = variationMediaRefs[variationKey] || {};
                          const approval = variationApprovals[variationKey] || { status: 'DRAFT' as VariationApprovalStatus, reviewerNote: '' };
                          const primaryMedia = campaignMedia.find(item => item.id === refs.primaryMediaId);
                          const secondaryMedia = campaignMedia.find(item => item.id === refs.secondaryMediaId);
                          return (
                          <div key={variationKey} className="rounded-md border border-border/60 bg-background/50 p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <p className="font-bold">{variation.title}</p>
                              <Badge variant="outline" className="h-5 text-[10px]">{variation.formatRecommendation}</Badge>
                              <Badge variant="outline" className="h-5 text-[10px]">Priority {variation.priorityScore}</Badge>
                              <Badge variant="outline" className={cn('h-5 text-[10px]', APPROVAL_STATUS_STYLES[approval.status])}>{compactStatusLabel(approval.status)}</Badge>
                              {mediaSavingKeys.has(variationKey) && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                              {approvalSavingKeys.has(variationKey) && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Target Intent</p>
                                <p>{variation.targetGroupIntent}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Visual Direction</p>
                                <p>{variation.visualDirection}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">Caption Angle</p>
                                <p>{variation.captionAngle}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground">CTA</p>
                                <p>{variation.cta}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {variation.suggestedHashtags?.map((tag: string) => (
                                <Badge key={tag} variant="outline" className="h-5 text-[10px]">{tag}</Badge>
                              ))}
                            </div>
                            {(primaryMedia || secondaryMedia) && (
                              <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                {primaryMedia && <Badge variant="outline" className="h-5 text-[10px]">Primary: {primaryMedia.originalName || primaryMedia.filename}</Badge>}
                                {secondaryMedia && <Badge variant="outline" className="h-5 text-[10px]">Secondary: {secondaryMedia.originalName || secondaryMedia.filename}</Badge>}
                              </div>
                            )}
                            <div className="mt-2 grid gap-2 border-t border-border/50 pt-2 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Primary Reference Media</p>
                                <select
                                  value={refs.primaryMediaId || ''}
                                  onChange={event => saveVariationMediaReference(variationKey, { ...refs, primaryMediaId: event.target.value })}
                                  className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs"
                                  disabled={campaignMedia.length === 0}
                                >
                                  <option value="">None</option>
                                  {campaignMedia.map(item => (
                                    <option key={item.id} value={item.id}>{item.originalName || item.filename}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Secondary Reference</p>
                                <select
                                  value={refs.secondaryMediaId || ''}
                                  onChange={event => saveVariationMediaReference(variationKey, { ...refs, secondaryMediaId: event.target.value })}
                                  className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs"
                                  disabled={campaignMedia.length === 0}
                                >
                                  <option value="">None</option>
                                  {campaignMedia.map(item => (
                                    <option key={item.id} value={item.id}>{item.originalName || item.filename}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
                              <div className="flex flex-wrap gap-1">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => saveVariationApproval(variationKey, { status: 'NEEDS_REVIEW' })}>
                                  Mark Needs Review
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] text-green-400" onClick={() => saveVariationApproval(variationKey, { status: 'APPROVED' })}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] text-red-400" onClick={() => saveVariationApproval(variationKey, { status: 'REJECTED' })}>
                                  Reject
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] text-blue-400" onClick={() => saveVariationApproval(variationKey, { status: 'USED' })}>
                                  Mark Used
                                </Button>
                              </div>
                              <textarea
                                value={approval.reviewerNote || ''}
                                onChange={event => setVariationApprovals(prev => ({
                                  ...prev,
                                  [variationKey]: { ...approval, reviewerNote: event.target.value },
                                }))}
                                onBlur={event => saveVariationApproval(variationKey, { reviewerNote: event.target.value })}
                                placeholder="Reviewer note..."
                                className="min-h-14 w-full resize-y rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs outline-none focus:border-purple-500/50"
                              />
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )}
                    {detailData.planningSummary.aiPlan.source === 'fallback' && (
                      <p className="text-[10px] text-yellow-400">Fallback used: {detailData.planningSummary.aiPlan.fallbackReason || 'AI provider unavailable'}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Generate planning-only guidance before preparing post copy.</p>
                )}
              </div>
              {detailData.accountBreakdown?.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2">Per Account</p>
                  <div className="space-y-1">
                    {detailData.accountBreakdown.map((ab: any) => {
                      const acc = accounts.find(a => a.id === ab.accountId)
                      return (
                        <div key={ab.accountId} className="flex items-center justify-between text-xs rounded px-3 py-2 bg-secondary/30">
                          <span className="font-medium">@{acc?.username || '...'}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-green-400">{ab.completed}✓</span>
                            <span className="text-red-400">{ab.failed}✗</span>
                            <span className="text-muted-foreground">{ab.pending} pending</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function toDatetimeLocal(value?: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 10 * 60 * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function formatSchedule(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
