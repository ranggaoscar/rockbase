export interface AccountLoadoutPreset {
  id: string
  name: string
  description: string
  groupIds: string[]
  accountIds: string[]
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'rockbase_account_loadout_presets_v1'

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function sanitizePreset(value: unknown): AccountLoadoutPreset | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<AccountLoadoutPreset>
  if (!raw.id || !raw.name) return null

  const now = new Date().toISOString()
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: raw.description ? String(raw.description) : '',
    groupIds: Array.isArray(raw.groupIds) ? unique(raw.groupIds.map(String)) : [],
    accountIds: Array.isArray(raw.accountIds) ? unique(raw.accountIds.map(String)) : [],
    createdAt: raw.createdAt ? String(raw.createdAt) : now,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : now,
  }
}

export function readAccountLoadoutPresets(): AccountLoadoutPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizePreset)
      .filter((preset): preset is AccountLoadoutPreset => Boolean(preset))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function writeAccountLoadoutPresets(presets: AccountLoadoutPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function createAccountLoadoutPreset(data: {
  name: string
  description?: string
  groupIds: string[]
  accountIds: string[]
}): AccountLoadoutPreset {
  const now = new Date().toISOString()
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    name: data.name.trim(),
    description: data.description?.trim() || '',
    groupIds: unique(data.groupIds),
    accountIds: unique(data.accountIds),
    createdAt: now,
    updatedAt: now,
  }
}

export function renameAccountLoadoutPreset(
  preset: AccountLoadoutPreset,
  name: string,
  description: string,
): AccountLoadoutPreset {
  return {
    ...preset,
    name: name.trim(),
    description: description.trim(),
    updatedAt: new Date().toISOString(),
  }
}
