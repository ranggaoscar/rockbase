export interface CampaignTemplatePreset {
  id: string
  name: string
  description: string
  actionType: string
  targetType: string
  targetValue: string
  defaultCaptionSeed: string
  defaultHashtags: string[]
  suggestedTone: string
  suggestedCTA: string
  groupIds: string[]
  accountIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CampaignTemplatePresetInput {
  name: string
  description?: string
  actionType: string
  targetType: string
  targetValue: string
  defaultCaptionSeed?: string
  defaultHashtags?: string[] | string
  suggestedTone?: string
  suggestedCTA?: string
  groupIds: string[]
  accountIds: string[]
}

const STORAGE_KEY = 'rockbase_campaign_template_presets_v1'

function unique(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

export function parseHashtags(value: string[] | string | undefined) {
  if (Array.isArray(value)) return unique(value)
  if (!value) return []
  return unique(value.split(/[\s,]+/).map(tag => tag.trim()))
}

function sanitizePreset(value: unknown): CampaignTemplatePreset | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CampaignTemplatePreset>
  if (!raw.id || !raw.name) return null

  const now = new Date().toISOString()
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: raw.description ? String(raw.description) : '',
    actionType: raw.actionType ? String(raw.actionType) : 'follow',
    targetType: raw.targetType ? String(raw.targetType) : 'username',
    targetValue: raw.targetValue ? String(raw.targetValue) : '',
    defaultCaptionSeed: raw.defaultCaptionSeed ? String(raw.defaultCaptionSeed) : '',
    defaultHashtags: parseHashtags(raw.defaultHashtags),
    suggestedTone: raw.suggestedTone ? String(raw.suggestedTone) : '',
    suggestedCTA: raw.suggestedCTA ? String(raw.suggestedCTA) : '',
    groupIds: Array.isArray(raw.groupIds) ? unique(raw.groupIds.map(String)) : [],
    accountIds: Array.isArray(raw.accountIds) ? unique(raw.accountIds.map(String)) : [],
    createdAt: raw.createdAt ? String(raw.createdAt) : now,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : now,
  }
}

export function readCampaignTemplatePresets(): CampaignTemplatePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizePreset)
      .filter((preset): preset is CampaignTemplatePreset => Boolean(preset))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function writeCampaignTemplatePresets(presets: CampaignTemplatePreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function createCampaignTemplatePreset(data: CampaignTemplatePresetInput): CampaignTemplatePreset {
  const now = new Date().toISOString()
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `campaign-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    name: data.name.trim(),
    description: data.description?.trim() || '',
    actionType: data.actionType,
    targetType: data.targetType,
    targetValue: data.targetValue.trim(),
    defaultCaptionSeed: data.defaultCaptionSeed?.trim() || '',
    defaultHashtags: parseHashtags(data.defaultHashtags),
    suggestedTone: data.suggestedTone?.trim() || '',
    suggestedCTA: data.suggestedCTA?.trim() || '',
    groupIds: unique(data.groupIds),
    accountIds: unique(data.accountIds),
    createdAt: now,
    updatedAt: now,
  }
}

export function renameCampaignTemplatePreset(
  preset: CampaignTemplatePreset,
  name: string,
  description: string,
): CampaignTemplatePreset {
  return {
    ...preset,
    name: name.trim(),
    description: description.trim(),
    updatedAt: new Date().toISOString(),
  }
}

export function buildTemplateCaption(preset: CampaignTemplatePreset) {
  const hashtags = preset.defaultHashtags.join(' ').trim()
  return [preset.defaultCaptionSeed.trim(), hashtags].filter(Boolean).join('\n\n')
}
