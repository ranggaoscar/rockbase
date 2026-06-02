export type VariationApprovalStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'USED'

export interface AutomationCampaignContentVariation {
  title: string
  targetGroupIntent: string
  visualDirection: string
  captionAngle: string
  cta: string
  suggestedHashtags: string[]
  formatRecommendation: 'single image' | 'carousel' | 'reels'
  priorityScore: number
}

export interface AutomationCampaignAiPlan {
  strategySummary: string
  contentAngle: string
  suggestedCta: string
  suggestedHashtags: string[]
  postingTone: string
  contentVariations?: AutomationCampaignContentVariation[]
  captionSeed?: string
  generatedAt?: string
  source?: 'ai' | 'fallback'
  fallbackReason?: string
}

export interface AutomationCampaignMediaItem {
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

export interface AutomationCampaignPlanningSummary {
  healthyCount?: number
  skippedCount?: number
  aiPlan?: AutomationCampaignAiPlan
  mediaLibrary?: AutomationCampaignMediaItem[]
  variationApprovals?: Record<string, { status: VariationApprovalStatus }>
}

export interface AutomationCampaign {
  id: string
  name: string
  type: string
  targetType: string
  targetValue: string
  accountIds: string[]
  status: string
  completedActions: number
  failedActions: number
  schedulerStatus?: 'PENDING' | 'READY' | 'EXECUTED' | 'FAILED' | 'CANCELLED'
  planningSummary?: AutomationCampaignPlanningSummary | null
}

export type AutomationRequestType =
  | 'Generate Hero Reel'
  | 'Generate Carousel'
  | 'Generate Before-After'
  | 'Generate Story Pack'
  | 'Generate AI Caption Batch'

export type AutomationSimulationStatus = 'queued' | 'preparing' | 'waiting render' | 'completed'
export type AutomationDestinationPipeline = 'n8n' | 'ComfyUI' | 'AI Writer'

export type AutomationRequestPayload = {
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

export type UniversalAutomationSchema = {
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

export type AutomationSchemaTab = keyof UniversalAutomationSchema

export type LocalWebhookResultStatus = 'idle' | 'sending' | 'success' | 'offline' | 'timeout' | 'invalid' | 'blocked'

export type LocalWebhookResult = {
  status: LocalWebhookResultStatus
  httpStatus?: number
  responseTimeMs?: number
  responsePayload?: unknown
  error?: string
  endpoint?: string
  sentAt?: string
}

export type LocalWebhookHistoryEntry = LocalWebhookResult & {
  id: string
  requestId: string
  campaignName: string
}

export type PayloadValidationSeverity = 'valid' | 'warning' | 'failed'

export type PayloadValidationIssue = {
  severity: Exclude<PayloadValidationSeverity, 'valid'>
  message: string
}

export type AutomationDeliveryDiagnostics = {
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

export type ContentFactoryRequest = {
  goal: string
  format: string
  visualStyle: string
  source: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  estimatedBatch: string
}

export type GeneratedContentItem = {
  title: string
  status: 'WAITING' | 'PROCESSING' | 'READY' | 'FAILED'
  source: 'ComfyUI' | 'Manual Design' | 'AI Enhancement'
  format: 'Reels 9:16' | 'Carousel 4:5' | 'Story'
  estimatedSize: '1080x1920' | '1080x1350'
}

export type ContentScore = {
  qualityScore: number
  aiConfidence: 'Strong' | 'Medium' | 'Weak'
  distributionPriority: 'HIGH' | 'MEDIUM' | 'LOW'
  readiness: 'Ready to Compose' | 'Needs Review' | 'Waiting Assets'
}

export type AccountMatchmaking = {
  recommendedAccountTypes: string[]
  distributionSize: string
  engagementFit: 'Strong' | 'Medium' | 'Weak'
  postingStyle: string
}

export type CampaignPrediction = {
  strengthScore: number
  estimatedReach: string
  conversionPotential: 'Strong' | 'Medium' | 'Weak'
  riskLevel: 'Low' | 'Medium' | 'High'
  distributionReadiness: number
  contentDiversity: number
  postingStability: number
  recommendation: string
}

export type CampaignLearningMemory = {
  learningInsight: string
  optimizationSuggestion: string
  patternWarning: string
  recommendedImprovement: string
  historicalComparison: string
  badges: string[]
}
