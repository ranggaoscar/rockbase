import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import {
  AccountLoadoutPreset,
  createAccountLoadoutPreset,
  readAccountLoadoutPresets,
  renameAccountLoadoutPreset,
  writeAccountLoadoutPresets,
} from '@/lib/accountLoadoutPresets'
import { cn } from '@/lib/utils'

interface AccountLoadoutPresetManagerProps {
  selectedAccountIds: string[]
  selectedGroupIds: string[]
  onApply: (preset: AccountLoadoutPreset) => void
  defaultName?: string
  compact?: boolean
}

export function AccountLoadoutPresetManager({
  selectedAccountIds,
  selectedGroupIds,
  onApply,
  defaultName = '',
  compact = false,
}: AccountLoadoutPresetManagerProps) {
  const [presets, setPresets] = useState<AccountLoadoutPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  useEffect(() => {
    setPresets(readAccountLoadoutPresets())
  }, [])

  useEffect(() => {
    if (!name.trim() && defaultName.trim()) setName(defaultName.trim())
  }, [defaultName, name])

  const selectedPreset = useMemo(
    () => presets.find(preset => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId],
  )
  const hasSelection = selectedAccountIds.length > 0 || selectedGroupIds.length > 0

  function persist(next: AccountLoadoutPreset[]) {
    const ordered = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    setPresets(ordered)
    writeAccountLoadoutPresets(ordered)
  }

  function saveCurrentSelection() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Preset name is required')
      return
    }
    if (!hasSelection) {
      toast.error('Select at least one account or group before saving a preset')
      return
    }

    const preset = createAccountLoadoutPreset({
      name: trimmedName,
      description,
      groupIds: selectedGroupIds,
      accountIds: selectedAccountIds,
    })
    persist([preset, ...presets])
    setSelectedPresetId(preset.id)
    setName('')
    setDescription('')
    toast.success('Account loadout preset saved')
  }

  function applyPreset() {
    if (!selectedPreset) {
      toast.error('Choose a preset to apply')
      return
    }
    onApply(selectedPreset)
    toast.success(`Preset applied: ${selectedPreset.name}`)
  }

  function startRename(preset: AccountLoadoutPreset) {
    setEditingId(preset.id)
    setEditName(preset.name)
    setEditDescription(preset.description)
  }

  function saveRename() {
    if (!editingId) return
    const trimmedName = editName.trim()
    if (!trimmedName) {
      toast.error('Preset name is required')
      return
    }
    persist(presets.map(preset =>
      preset.id === editingId
        ? renameAccountLoadoutPreset(preset, trimmedName, editDescription)
        : preset,
    ))
    setEditingId(null)
    setEditName('')
    setEditDescription('')
    toast.success('Preset renamed')
  }

  function deletePreset(id: string) {
    const preset = presets.find(item => item.id === id)
    if (!preset) return
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return

    persist(presets.filter(item => item.id !== id))
    if (selectedPresetId === id) setSelectedPresetId('')
    if (editingId === id) setEditingId(null)
    toast.success('Preset deleted')
  }

  return (
    <div className={cn('rounded-lg border border-border/60 bg-secondary/20 p-2.5', compact ? 'space-y-2' : 'space-y-3')}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Loadout Presets</p>
          <p className="text-[10px] text-muted-foreground">Selection helper only. No posting or scheduling.</p>
        </div>
        <Badge variant="outline" className="text-[9px]">{presets.length}</Badge>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            value={selectedPresetId}
            onChange={event => setSelectedPresetId(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-purple-500/50"
          >
            <option value="">Choose preset...</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name} ({preset.groupIds.length} groups, {preset.accountIds.length} accounts)
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" className="h-8 px-2 text-[10px]" onClick={applyPreset} disabled={!selectedPreset}>
            <Check className="mr-1 h-3.5 w-3.5" /> Apply
          </Button>
        </div>

        {selectedPreset && (
          <div className="rounded-md border border-border/50 bg-background/60 p-2">
            {editingId === selectedPreset.id ? (
              <div className="space-y-2">
                <Input value={editName} onChange={event => setEditName(event.target.value)} className="h-8 text-xs" />
                <Textarea value={editDescription} onChange={event => setEditDescription(event.target.value)} className="min-h-16 text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 px-2 text-[10px]" onClick={saveRename}>
                    <Save className="mr-1 h-3 w-3" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{selectedPreset.name}</p>
                    {selectedPreset.description && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{selectedPreset.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startRename(selectedPreset)} title="Rename preset">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => deletePreset(selectedPreset.id)} title="Delete preset">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.groupIds.length} groups</Badge>
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.accountIds.length} accounts</Badge>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border/50 pt-2">
        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Save Current Selection</Label>
        <Input
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Preset name"
          className="h-8 text-xs"
        />
        <Textarea
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="Optional description"
          className="min-h-16 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8 w-full text-[10px]" onClick={saveCurrentSelection} disabled={!hasSelection}>
          <Save className="mr-1 h-3.5 w-3.5" /> Save as Preset
        </Button>
      </div>
    </div>
  )
}
