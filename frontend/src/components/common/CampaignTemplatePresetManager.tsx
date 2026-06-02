import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import {
  CampaignTemplatePreset,
  CampaignTemplatePresetInput,
  createCampaignTemplatePreset,
  readCampaignTemplatePresets,
  renameCampaignTemplatePreset,
  writeCampaignTemplatePresets,
} from '@/lib/campaignTemplatePresets'
import { cn } from '@/lib/utils'

interface CampaignTemplatePresetManagerProps {
  currentTemplate: CampaignTemplatePresetInput
  onApply: (preset: CampaignTemplatePreset) => void
  mode?: 'campaign' | 'compose'
  compact?: boolean
}

export function CampaignTemplatePresetManager({
  currentTemplate,
  onApply,
  mode = 'campaign',
  compact = false,
}: CampaignTemplatePresetManagerProps) {
  const [presets, setPresets] = useState<CampaignTemplatePreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [saveName, setSaveName] = useState(currentTemplate.name)
  const [saveDescription, setSaveDescription] = useState(currentTemplate.description || '')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  useEffect(() => {
    setPresets(readCampaignTemplatePresets())
  }, [])

  useEffect(() => {
    if (!saveName.trim() && currentTemplate.name.trim()) setSaveName(currentTemplate.name.trim())
  }, [currentTemplate.name, saveName])

  const selectedPreset = useMemo(
    () => presets.find(preset => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId],
  )

  function persist(next: CampaignTemplatePreset[]) {
    const ordered = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    setPresets(ordered)
    writeCampaignTemplatePresets(ordered)
  }

  function saveCurrentTemplate() {
    const trimmedName = saveName.trim()
    if (!trimmedName) {
      toast.error('Nama Template wajib diisi')
      return
    }
    if (!currentTemplate.targetValue.trim() && currentTemplate.groupIds.length === 0 && currentTemplate.accountIds.length === 0) {
      toast.error('Fill a target or select accounts/groups before saving a template')
      return
    }

    const preset = createCampaignTemplatePreset({
      ...currentTemplate,
      name: trimmedName,
      description: saveDescription,
    })
    persist([preset, ...presets])
    setSelectedPresetId(preset.id)
    setSaveName('')
    setSaveDescription('')
    toast.success('Campaign recipe saved')
  }

  function applyPreset() {
    if (!selectedPreset) {
      toast.error('Choose a recipe to apply')
      return
    }
    onApply(selectedPreset)
    toast.success(`Recipe applied: ${selectedPreset.name}`)
  }

  function startRename(preset: CampaignTemplatePreset) {
    setEditingId(preset.id)
    setEditName(preset.name)
    setEditDescription(preset.description)
  }

  function saveRename() {
    if (!editingId) return
    const trimmedName = editName.trim()
    if (!trimmedName) {
      toast.error('Nama Template wajib diisi')
      return
    }
    persist(presets.map(preset =>
      preset.id === editingId
        ? renameCampaignTemplatePreset(preset, trimmedName, editDescription)
        : preset,
    ))
    setEditingId(null)
    setEditName('')
    setEditDescription('')
    toast.success('Recipe renamed')
  }

  function deletePreset(id: string) {
    const preset = presets.find(item => item.id === id)
    if (!preset) return
    if (!window.confirm(`Delete recipe "${preset.name}"?`)) return

    persist(presets.filter(item => item.id !== id))
    if (selectedPresetId === id) setSelectedPresetId('')
    if (editingId === id) setEditingId(null)
    toast.success('Recipe deleted')
  }

  return (
    <div className={cn('rounded-lg border border-border/60 bg-secondary/20 p-2.5', compact ? 'space-y-2' : 'space-y-3')}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Template Campaign</p>
          <p className="text-[10px] text-muted-foreground">
            {mode === 'compose' ? 'Caption helper only. Manual apply required.' : 'Gunakan template agar campaign tidak perlu dibuat dari awal.'}
          </p>
        </div>
        <Badge variant="outline" className="text-[9px]">{presets.length}</Badge>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            value={selectedPresetId}
            onChange={event => setSelectedPresetId(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-orange-500/50"
          >
            <option value="">Pilih template campaign...</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name} ({preset.actionType}, {preset.targetType})
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
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startRename(selectedPreset)} title="Rename recipe">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" onClick={() => deletePreset(selectedPreset.id)} title="Delete recipe">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.actionType}</Badge>
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.targetType}</Badge>
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.groupIds.length} groups</Badge>
                  <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.accountIds.length} accounts</Badge>
                  {selectedPreset.defaultHashtags.length > 0 && (
                    <Badge variant="outline" className="h-5 text-[9px]">{selectedPreset.defaultHashtags.length} hashtags</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {mode === 'campaign' && (
        <div className="space-y-2 border-t border-border/50 pt-2">
          <Label className="text-[10px] font-bold uppercase text-muted-foreground">Simpan Template Campaign</Label>
          <Input
            value={saveName}
            onChange={event => setSaveName(event.target.value)}
            placeholder="Nama Template"
            className="h-8 text-xs"
          />
          <Textarea
            value={saveDescription}
            onChange={event => setSaveDescription(event.target.value)}
            placeholder="Deskripsi singkat template"
            className="min-h-16 text-xs"
          />
          <Button size="sm" variant="outline" className="h-8 w-full text-[10px]" onClick={saveCurrentTemplate}>
            <Save className="mr-1 h-3.5 w-3.5" /> Simpan Sebagai Template
          </Button>
        </div>
      )}
    </div>
  )
}
