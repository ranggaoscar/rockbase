import { useMemo, useState } from 'react'
import { CalendarDays, FileText, Hash, Loader2, Target } from 'lucide-react'
import { campaignEngineApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'

type ClusterPlan = {
  clusterNumber: number
  clusterName: string
  accountRange: string
  targetAudience: string
  primaryMaterial: string
  contentAngle: string
  suggestedFormat: string
  captionDrafts: string[]
  hashtagSet: string[]
  visualBrief: string
  postingSchedule: {
    window: string
    postsPerWeek: number
    recommendedDays: string[]
  }
}

type CampaignPlan = {
  campaignSummary: {
    campaignName: string
    materialCategory: string
    mainColor: string
    goal: string
    period: {
      start: string
      end: string
    }
    accountCount: number
    clusterCount: number
    brandTone: string
  }
  clusters: ClusterPlan[]
  safetyNotes: string[]
  nextActionRecommendation: string
}

const initialBrief = {
  campaignName: 'Promo Marmer Abu Mei',
  materialCategory: 'Marble',
  mainColor: 'Abu',
  materials: 'Monaco Grey, Grey Levanto, Armani Grey',
  goal: 'WhatsApp leads',
  targetAudience: 'homeowner, contractor, interior designer',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  accountCount: '200',
  clusterCount: '20',
  cta: 'Chat WhatsApp untuk cek stok dan harga promo',
  brandTone: 'professional, helpful, premium, not spammy',
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function CampaignEngine() {
  const [brief, setBrief] = useState(initialBrief)
  const [plan, setPlan] = useState<CampaignPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const canGenerate = useMemo(() => {
    return Boolean(
      brief.campaignName.trim() &&
      brief.materialCategory.trim() &&
      brief.mainColor.trim() &&
      splitList(brief.materials).length &&
      brief.goal.trim() &&
      splitList(brief.targetAudience).length &&
      brief.periodStart &&
      brief.periodEnd &&
      Number(brief.accountCount) > 0 &&
      Number(brief.clusterCount) > 0 &&
      brief.cta.trim() &&
      brief.brandTone.trim()
    )
  }, [brief])

  function patch<K extends keyof typeof brief>(key: K, value: typeof brief[K]) {
    setBrief((prev) => ({ ...prev, [key]: value }))
  }

  async function generatePlan() {
    if (!canGenerate) return
    setLoading(true)
    try {
      const payload = {
        campaignName: brief.campaignName,
        materialCategory: brief.materialCategory,
        mainColor: brief.mainColor,
        materials: splitList(brief.materials),
        goal: brief.goal,
        targetAudience: splitList(brief.targetAudience),
        periodStart: brief.periodStart,
        periodEnd: brief.periodEnd,
        accountCount: Number(brief.accountCount),
        clusterCount: Number(brief.clusterCount),
        cta: brief.cta,
        brandTone: brief.brandTone,
      }
      const { data } = await campaignEngineApi.plan(payload)
      setPlan(data.plan)
      toast({ title: 'Plan generated', description: 'Campaign Engine created a planning-only content matrix.' })
    } catch (err: any) {
      toast({
        title: 'Plan generation failed',
        description: err.response?.data?.error ?? err.message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-purple-400" />
          <h1 className="text-2xl font-bold text-foreground">Campaign Engine</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate a planning-only content matrix for account clusters. No posting or engagement actions are available in this phase.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Brief</CardTitle>
          <CardDescription>Turn one natural stone marketing brief into cluster-level content guidance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="campaignName">Campaign name</Label>
            <Input id="campaignName" value={brief.campaignName} onChange={(e) => patch('campaignName', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal">Goal</Label>
            <Input id="goal" value={brief.goal} onChange={(e) => patch('goal', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="materialCategory">Material category</Label>
            <Input id="materialCategory" value={brief.materialCategory} onChange={(e) => patch('materialCategory', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mainColor">Main color</Label>
            <Input id="mainColor" value={brief.mainColor} onChange={(e) => patch('mainColor', e.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="materials">Materials</Label>
            <Input id="materials" value={brief.materials} onChange={(e) => patch('materials', e.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="targetAudience">Target audience</Label>
            <Input id="targetAudience" value={brief.targetAudience} onChange={(e) => patch('targetAudience', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="periodStart">Period start</Label>
            <Input id="periodStart" type="date" value={brief.periodStart} onChange={(e) => patch('periodStart', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="periodEnd">Period end</Label>
            <Input id="periodEnd" type="date" value={brief.periodEnd} onChange={(e) => patch('periodEnd', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountCount">Account count</Label>
            <Input id="accountCount" type="number" min="1" value={brief.accountCount} onChange={(e) => patch('accountCount', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clusterCount">Cluster count</Label>
            <Input id="clusterCount" type="number" min="1" value={brief.clusterCount} onChange={(e) => patch('clusterCount', e.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="cta">CTA</Label>
            <Textarea id="cta" value={brief.cta} onChange={(e) => patch('cta', e.target.value)} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="brandTone">Brand tone</Label>
            <Textarea id="brandTone" value={brief.brandTone} onChange={(e) => patch('brandTone', e.target.value)} />
          </div>
          <div className="lg:col-span-2">
            <Button onClick={generatePlan} disabled={!canGenerate || loading} className="bg-purple-600 hover:bg-purple-700">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Generate Plan
            </Button>
          </div>
        </CardContent>
      </Card>

      {plan && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{plan.campaignSummary.campaignName}</CardTitle>
              <CardDescription>
                {plan.campaignSummary.materialCategory} / {plan.campaignSummary.mainColor} / {plan.campaignSummary.goal}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Accounts</p>
                <p className="text-lg font-semibold">{plan.campaignSummary.accountCount}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Clusters</p>
                <p className="text-lg font-semibold">{plan.campaignSummary.clusterCount}</p>
              </div>
              <div className="rounded-lg border border-border p-3 md:col-span-2">
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="text-sm font-medium">{plan.campaignSummary.period.start} to {plan.campaignSummary.period.end}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {plan.clusters.map((cluster) => (
              <Card key={cluster.clusterNumber}>
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-base">{cluster.clusterName}</CardTitle>
                      <CardDescription>{cluster.accountRange} / {cluster.targetAudience}</CardDescription>
                    </div>
                    <Badge variant="secondary">{cluster.primaryMaterial}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Angle</p>
                    <p className="text-sm">{cluster.contentAngle}</p>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Format</p>
                    <p className="text-sm">{cluster.suggestedFormat}</p>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Visual brief</p>
                    <p className="text-sm text-muted-foreground">{cluster.visualBrief}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Caption drafts</p>
                    {cluster.captionDrafts.map((caption, index) => (
                      <p key={index} className="rounded-md bg-secondary p-2 text-xs leading-relaxed">{caption}</p>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
                        <Hash className="h-3 w-3" /> Hashtags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.hashtagSet.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
                        <CalendarDays className="h-3 w-3" /> Schedule
                      </p>
                      <p className="text-sm">{cluster.postingSchedule.postsPerWeek} posts/week</p>
                      <p className="text-xs text-muted-foreground">{cluster.postingSchedule.recommendedDays.join(', ')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Safety Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plan.safetyNotes.map((note) => (
                <p key={note} className="text-sm text-muted-foreground">{note}</p>
              ))}
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-sm">
                {plan.nextActionRecommendation}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
