import { BarChart3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CampaignPrediction } from '@/lib/automation'

interface CampaignPredictionPanelProps {
  prediction: CampaignPrediction
}

export function CampaignPredictionPanel({ prediction }: CampaignPredictionPanelProps) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold">
            <BarChart3 className="h-3.5 w-3.5 text-emerald-300" /> Campaign Health & Prediction
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Simulasi forecasting dan health analysis campaign.</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'w-fit text-[10px]',
            prediction.riskLevel === 'Low' && 'border-green-500/30 bg-green-500/10 text-green-300',
            prediction.riskLevel === 'Medium' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
            prediction.riskLevel === 'High' && 'border-red-500/30 bg-red-500/10 text-red-300',
          )}
        >
          Risk {prediction.riskLevel}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ['Campaign Strength Score', prediction.strengthScore, 'Score'],
          ['Swarm Readiness', prediction.distributionReadiness, 'Readiness'],
          ['Content Diversity', prediction.contentDiversity, 'Diversity'],
          ['Posting Stability', prediction.postingStability, 'Stability'],
        ].map(([label, value, type]) => {
          const score = value as number
          return (
            <div key={label as string} className="rounded-md border border-border/60 bg-background/45 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold text-muted-foreground">{label as string}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    'h-5 text-[9px]',
                    score >= 75 && 'border-green-500/30 bg-green-500/10 text-green-300',
                    score >= 50 && score < 75 && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                    score < 50 && 'border-red-500/30 bg-red-500/10 text-red-300',
                  )}
                >
                  {score}/100
                </Badge>
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
              <p className="mt-1 text-[9px] text-muted-foreground">{type as string} prediction</p>
            </div>
          )
        })}
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <p className="mb-1 text-[10px] font-bold text-muted-foreground">Estimated Reach</p>
          <p className="text-lg font-black text-foreground">{prediction.estimatedReach}</p>
          <p className="text-[9px] text-muted-foreground">Simulasi estimasi jangkauan akun sehat.</p>
        </div>
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <p className="mb-1 text-[10px] font-bold text-muted-foreground">Conversion Potential</p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="h-5 text-[9px]">Potential: {prediction.conversionPotential}</Badge>
            <Badge variant="outline" className="h-5 text-[9px]">Risk: {prediction.riskLevel}</Badge>
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-emerald-300">Recommendation Summary</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{prediction.recommendation}</p>
      </div>
    </div>
  )
}
