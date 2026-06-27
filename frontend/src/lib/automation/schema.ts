import type {
  AutomationCampaign,
  AutomationDeliveryDiagnostics,
  AutomationDestinationPipeline,
  AutomationRequestPayload,
  AutomationRequestType,
  AutomationSimulationStatus,
  AccountMatchmaking,
  CampaignLearningMemory,
  ContentScore,
  ContentFactoryRequest,
  GeneratedContentItem,
  PayloadValidationIssue,
  PayloadValidationSeverity,
  UniversalAutomationSchema,
  LocalWebhookResult,
} from './types'

export const DEFAULT_LOCAL_WEBHOOK_ENDPOINT = 'http://localhost:5678/webhook/rockbase-simulation'

export const AUTOMATION_REQUEST_SPECS: Record<AutomationRequestType, {
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

export const AUTOMATION_REQUEST_TYPES = Object.keys(AUTOMATION_REQUEST_SPECS) as AutomationRequestType[]

const OBJECTIVE_LABELS: Record<string, string> = {
  'Product Push': 'Jual Produk',
  Awareness: 'Bangun Awareness',
  'Hashtag Push': 'Dorong Hashtag',
  Education: 'Edukasi Audience',
  'Showroom Push': 'Dorong Showroom',
  'Engagement Swarm': 'Distribusi Engagement',
  Warming: 'Warming Account',
  Experimental: 'Eksperimen Campaign',
}

function inferCampaignObjective(campaign: AutomationCampaign) {
  const text = `${campaign.targetValue || ''} ${campaign.name || ''}`.toLowerCase()
  if (/\b(marble|marmer|granite|granit|onyx|statuario|monaco|calacatta|promo)\b/.test(text)) return 'Product Push'
  if (/\b(showroom|bali|jakarta)\b/.test(text)) return 'Showroom Push'
  if (/\b(edukasi|tips|inspiration)\b/.test(text)) return 'Education'
  if (campaign.type === 'follow') return 'Warming'
  return 'Engagement Swarm'
}

function mediaSummary(campaign: AutomationCampaign) {
  const media = campaign.planningSummary?.mediaLibrary || []
  return {
    total: media.length,
    references: media.filter(item => item.type === 'reference').length,
    images: media.filter(item => item.type === 'image').length,
    videos: media.filter(item => item.type === 'video').length,
  }
}

function approvalReadiness(campaign: AutomationCampaign) {
  const aiPlan = campaign.planningSummary?.aiPlan
  const variations = aiPlan?.contentVariations || []
  const approvals = campaign.planningSummary?.variationApprovals || {}

  if (!aiPlan) return { status: 'MISSING_AI' as const }
  if (variations.length === 0) return { status: 'READY' as const }

  const needsApproval = variations.some((variation, index) => {
    const key = `${variation.title}-${index}`
    const status = approvals[key]?.status || 'DRAFT'
    return status !== 'APPROVED' && status !== 'USED'
  })

  return { status: needsApproval ? 'NEEDS_APPROVAL' as const : 'READY' as const }
}

function campaignReadiness(campaign: AutomationCampaign) {
  const media = mediaSummary(campaign)
  const approvals = approvalReadiness(campaign)
  const schedulerStatus = campaign.schedulerStatus || 'PENDING'
  const healthyAccounts = campaign.planningSummary?.healthyCount ?? campaign.accountIds.length
  const skippedAccounts = campaign.planningSummary?.skippedCount ?? 0
  const hasMedia = media.total > 0
  const hasAI = Boolean(campaign.planningSummary?.aiPlan)

  return {
    media,
    approvals,
    schedulerStatus,
    healthyAccounts,
    skippedAccounts,
    hasMedia,
    hasAI,
    isHealthy: healthyAccounts > 0,
    isReady: schedulerStatus === 'READY' && hasMedia && hasAI && approvals.status === 'READY' && healthyAccounts > 0,
    missingMedia: !hasMedia,
    missingAI: !hasAI,
    needsApproval: approvals.status === 'NEEDS_APPROVAL',
    failed: schedulerStatus === 'FAILED' || campaign.status === 'stopped' || campaign.failedActions > 0,
  }
}

export function buildComposeIntelligence(campaign: AutomationCampaign) {
  const readiness = campaignReadiness(campaign)
  const topic = campaign.targetValue || campaign.name
  const objective = inferCampaignObjective(campaign)
  const lowerContext = `${campaign.name} ${campaign.targetValue}`.toLowerCase()
  const destination = buildBrandRoles(campaign)[0]?.brand || 'brand utama'
  const contentPriority = [
    lowerContext.includes('kitchen') || lowerContext.includes('dapur') ? 'kitchen application' : 'interior inspiration',
    lowerContext.includes('grey') || lowerContext.includes('marble') || lowerContext.includes('stone') ? 'texture close-up' : 'product detail',
    objective === 'Showroom Push' ? 'showroom walkthrough' : 'cinematic reels',
    'before-after',
  ]
  const swarmStrategy = [
    'Akun Interior',
    lowerContext.includes('villa') || lowerContext.includes('bali') ? 'Akun Villa Bali' : 'Akun Rumah Mewah',
    'Akun Arsitektur',
    objective === 'Education' ? 'Akun Kontraktor' : 'Akun Studio Design',
    'Akun Kontraktor',
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
    insight: `${topic} cocok untuk ${OBJECTIVE_LABELS[objective].toLowerCase()} dengan angle visual yang mudah discan operator.`,
    contentPriority: Array.from(new Set(contentPriority)).slice(0, 5),
    swarmStrategy: Array.from(new Set(swarmStrategy)).slice(0, 5),
    conversionDirection: `Traffic direkomendasikan ke ${destination}.`,
    postingWindows: ['11:00 - 13:00', '18:00 - 21:00'],
    riskNotes: riskNotes.length > 0 ? riskNotes : ['Campaign sudah siap secara operasional; tetap review Compose sebelum distribusi manual.'],
  }
}

export function buildBrandRoles(campaign: AutomationCampaign) {
  const objective = inferCampaignObjective(campaign)
  const text = `${campaign.name || ''} ${campaign.targetValue || ''}`.toLowerCase()
  const roles = [
    { brand: 'Brescia Stone', role: 'Arahkan ke brand premium', suggestedFocus: 'Monaco Grey / premium marble / architecture', suggestedCTA: 'WhatsApp Brescia Stone' },
    { brand: 'Brescia Bali', role: 'Villa & tropical luxury', suggestedFocus: 'Grey Levanto / Bali resort style', suggestedCTA: 'WhatsApp Brescia Bali' },
    { brand: 'Magrade', role: 'Promo & ready stock conversion', suggestedFocus: 'Affordable marble / promo stock', suggestedCTA: 'WhatsApp Magrade' },
    { brand: 'Nu Stone Republic', role: 'Trend & inspiration content', suggestedFocus: 'Interior inspiration / aesthetic content', suggestedCTA: 'Instagram engagement or WhatsApp' },
    { brand: 'Global Stone', role: 'Project & contractor support', suggestedFocus: 'Bulk/project materials', suggestedCTA: 'Project sales WhatsApp' },
  ]
  const priority: Record<string, number> = {}

  if (/\b(bali|villa|resort|tropical)\b/.test(text)) priority['Brescia Bali'] = 0
  if (/\b(promo|ready stock|stock|affordable)\b/.test(text)) priority.Magrade = 0
  if (/\b(project|contractor|bulk|arsitek|architecture)\b/.test(text)) priority['Global Stone'] = 0
  if (/\b(inspiration|aesthetic|interior|tips|edukasi)\b/.test(text) || objective === 'Education') priority['Nu Stone Republic'] = 0
  if (/\b(monaco|calacatta|statuario|premium|luxury|marble|marmer)\b/.test(text) || objective === 'Product Push') priority['Brescia Stone'] = 0

  return roles
    .map((role, index) => ({ ...role, objective, priority: priority[role.brand] ?? index + 1 }))
    .sort((a, b) => a.priority - b.priority)
}

export function buildContentFactoryRequests(campaign: AutomationCampaign): ContentFactoryRequest[] {
  const intelligence = buildComposeIntelligence(campaign)
  const brandRoles = buildBrandRoles(campaign)
  const lowerContext = `${campaign.name} ${campaign.targetValue} ${intelligence.contentPriority.join(' ')}`.toLowerCase()
  const materialStyle = lowerContext.includes('marble') || lowerContext.includes('stone')
    ? 'elegant marble showcase'
    : lowerContext.includes('interior') || lowerContext.includes('kitchen') || lowerContext.includes('dapur')
      ? 'bright interior'
      : 'clean minimal'
  const conversionTarget = brandRoles[0]?.brand || 'brand utama'
  const hasExistingMedia = (campaign.planningSummary?.mediaLibrary?.length || 0) > 0
  const objective = inferCampaignObjective(campaign)

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
      visualStyle: goal.toLowerCase().includes('hero') || goal.toLowerCase().includes('reels') ? 'luxury cinematic' : materialStyle,
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
    objective === 'Showroom Push' ? 'Showroom walkthrough' : 'Hero reels',
    objective === 'Education' ? 'Product close-up' : 'Interior inspiration',
    intelligence.contentPriority.includes('before-after') ? 'Before-after' : 'Product close-up',
  ]

  return Array.from(new Set(objectiveGoals)).slice(0, 3).map(priorityToRequest)
}

export function buildCampaignPrediction(campaign: AutomationCampaign) {
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
  const conversionPotential = strengthScore >= 78 && distributionReadiness >= 80 ? 'Strong' : strengthScore >= 55 ? 'Medium' : 'Weak'

  return {
    strengthScore,
    estimatedReach: healthyAccounts > 0 ? `${estimatedReachMin.toLocaleString()} - ${estimatedReachMax.toLocaleString()}` : 'Rendah',
    conversionPotential,
    riskLevel,
    distributionReadiness,
    contentDiversity,
    postingStability,
    recommendation: readiness.hasMedia && readiness.hasAI
      ? 'Campaign memiliki fondasi kuat; prioritaskan review Compose dan distribusi konten dengan score tertinggi.'
      : 'Campaign memiliki potensi distribusi kuat jika media utama dan AI preview selesai dipersiapkan.',
  }
}

export function buildGeneratedContentWorkspace(campaign: AutomationCampaign): GeneratedContentItem[] {
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
    { title: 'Hero Reel', status: statusByIndex(0), source: sourceByGoal('Hero reels', 'ComfyUI'), format: 'Reels 9:16', estimatedSize: '1080x1920' },
    { title: 'Interior Carousel', status: statusByIndex(1), source: sourceByGoal('Interior inspiration', 'Manual Design'), format: 'Carousel 4:5', estimatedSize: '1080x1350' },
    { title: 'Product Close-up', status: statusByIndex(2), source: sourceByGoal('Product close-up', 'AI Enhancement'), format: 'Carousel 4:5', estimatedSize: '1080x1350' },
    { title: 'Before-After', status: statusByIndex(3), source: sourceByGoal('Before-after', 'Manual Design'), format: 'Carousel 4:5', estimatedSize: '1080x1350' },
    { title: 'Story Variant', status: statusByIndex(4), source: 'ComfyUI', format: 'Story', estimatedSize: '1080x1920' },
  ]
}

export function buildContentScore(contentItem: GeneratedContentItem, campaign: AutomationCampaign): ContentScore {
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
  return {
    qualityScore,
    aiConfidence: qualityScore >= 78 ? 'Strong' : qualityScore >= 55 ? 'Medium' : 'Weak',
    distributionPriority: qualityScore >= 80 ? 'HIGH' : qualityScore >= 60 ? 'MEDIUM' : 'LOW',
    readiness: contentItem.status === 'READY' ? 'Ready to Compose' : contentItem.status === 'WAITING' ? 'Waiting Assets' : 'Needs Review',
  }
}

export function buildAccountMatchmaking(contentItem: GeneratedContentItem, campaign: AutomationCampaign): AccountMatchmaking {
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

export function buildCampaignLearningMemory(campaign: AutomationCampaign): CampaignLearningMemory {
  const readiness = campaignReadiness(campaign)
  const prediction = buildCampaignPrediction(campaign)
  const generatedContent = buildGeneratedContentWorkspace(campaign)
  const scoredContent = generatedContent.map(item => ({ item, score: buildContentScore(item, campaign) }))
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

export function buildAutomationRequestPayload(
  campaign: AutomationCampaign,
  requestType: AutomationRequestType,
  status: AutomationSimulationStatus = 'queued',
): AutomationRequestPayload {
  const spec = AUTOMATION_REQUEST_SPECS[requestType]
  const objective = inferCampaignObjective(campaign)
  const brandRoles = buildBrandRoles(campaign)

  return {
    requestId: `sim-${campaign.id.slice(0, 6)}-${Date.now().toString(36)}`,
    queuedTime: new Date().toISOString(),
    automationStatus: status,
    destinationPipeline: spec.destinationPipeline,
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    materialTopic: campaign.targetValue || campaign.name,
    objective: OBJECTIVE_LABELS[objective],
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

export function buildUniversalAutomationSchema(
  campaign: AutomationCampaign,
  payload?: AutomationRequestPayload,
): UniversalAutomationSchema {
  const fallbackPayload = payload || buildAutomationRequestPayload(campaign, 'Generate Hero Reel')
  const aiPlan = campaign.planningSummary?.aiPlan
  const intelligence = buildComposeIntelligence(campaign)
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

export function isAllowedLocalWebhookEndpoint(value: string) {
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

export function buildPayloadChecksum(value: unknown) {
  const input = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `sim-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function validateUniversalAutomationSchema(schema: UniversalAutomationSchema): PayloadValidationIssue[] {
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

export function buildAutomationDeliveryDiagnostics(
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
  const endpointValidation = isAllowedLocalWebhookEndpoint(endpoint) ? 'local-only safe' : endpoint.trim() ? 'blocked' : 'invalid'
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
