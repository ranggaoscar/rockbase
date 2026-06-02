import { Copy, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AutomationSchemaTab, UniversalAutomationSchema } from '@/lib/automation'

interface SchemaPreviewProps {
  schema: UniversalAutomationSchema
  activeTab: AutomationSchemaTab
  onTabChange: (tab: AutomationSchemaTab) => void
  onCopy: () => void
}

export function SchemaPreview({ schema, activeTab, onTabChange, onCopy }: SchemaPreviewProps) {
  return (
    <div className="mt-3 rounded-md border border-purple-500/20 bg-purple-500/[0.04] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-purple-200">
            <ListChecks className="h-3.5 w-3.5" /> Universal Automation Schema Preview
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Future protocol schema untuk n8n, ComfyUI, AI Writer, dan agent automation.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[9px] text-cyan-200">n8n-ready</Badge>
          <Badge variant="outline" className="h-5 border-green-500/30 bg-green-500/10 text-[9px] text-green-200">ComfyUI-ready</Badge>
          <Badge variant="outline" className="h-5 border-purple-500/30 bg-purple-500/10 text-[9px] text-purple-200">AI Writer-ready</Badge>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[9px]" onClick={onCopy}>
            <Copy className="mr-1 h-3 w-3" /> Copy Payload
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {(['core', 'production', 'ai', 'distribution', 'pipeline'] as AutomationSchemaTab[]).map(tab => (
          <Button
            key={tab}
            size="sm"
            variant={activeTab === tab ? 'default' : 'outline'}
            className="h-7 px-2 text-[9px] uppercase"
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(schema[activeTab]).map(([key, value]) => (
          <div key={key} className="rounded-md border border-border/50 bg-background/45 p-2">
            <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">{key}</p>
            <p className="mt-1 break-words text-[10px] text-foreground">
              {Array.isArray(value) ? value.join(', ') : String(value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border/50 bg-background/35 p-2">
        <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-muted-foreground">Compact JSON Section</p>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-secondary/30 p-2 text-[10px] text-muted-foreground">
          {JSON.stringify(schema[activeTab], null, 2)}
        </pre>
      </div>
    </div>
  )
}
