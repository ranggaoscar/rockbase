import { AlertTriangle, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { CampaignLearningMemory as CampaignLearningMemoryModel } from '@/lib/automation'

interface CampaignLearningMemoryProps {
  learningMemory: CampaignLearningMemoryModel
}

export function CampaignLearningMemory({ learningMemory }: CampaignLearningMemoryProps) {
  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-3">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold">
            <ListChecks className="h-3.5 w-3.5 text-violet-300" /> Campaign Learning Memory
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Simulated learning feedback from campaign behavior.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {learningMemory.badges.map(badge => (
            <Badge key={badge} variant="outline" className="h-5 border-violet-500/25 bg-violet-500/10 text-[9px] text-violet-200">
              {badge}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-violet-200">Learning Insight</p>
          <p className="text-[10px] text-muted-foreground">{learningMemory.learningInsight}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-cyan-200">Optimization Suggestion</p>
          <p className="text-[10px] text-muted-foreground">{learningMemory.optimizationSuggestion}</p>
        </div>
        <div className="rounded-md border border-yellow-500/20 bg-yellow-500/[0.04] p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-yellow-200">
            <AlertTriangle className="h-3 w-3" /> Pattern Warning
          </p>
          <p className="text-[10px] text-muted-foreground">{learningMemory.patternWarning}</p>
        </div>
        <div className="rounded-md border border-green-500/20 bg-green-500/[0.04] p-2">
          <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-green-200">Recommended Improvement</p>
          <p className="text-[10px] text-muted-foreground">{learningMemory.recommendedImprovement}</p>
        </div>
      </div>
      <div className="mt-2 rounded-md border border-border/60 bg-background/45 p-2">
        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">Historical Comparison</p>
        <p className="text-[10px] text-muted-foreground">{learningMemory.historicalComparison}</p>
      </div>
    </div>
  )
}
