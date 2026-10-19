import { Link } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/growth/grammar'

const alternatives: Record<string, { body: string; to: string; cta: string }> = {
  Scheduler: { body: 'Campaigns can prepare a Compose draft at a chosen time (Schedule Draft). That prepares — it does not post. Posting still needs Start Bulk Post.', to: '/campaigns', cta: 'Open Campaigns' },
  'Content Planner': { body: 'Plan and keep drafts in Studio, or start from evidence in Radar.', to: '/studio', cta: 'Open Studio' },
  'Campaign Engine': { body: 'Campaigns covers preparation, approval, preflight and paced posting.', to: '/campaigns', cta: 'Open Campaigns' },
}

export default function ExperimentalUnavailable({ feature }: { feature: string }) {
  const alt = alternatives[feature]
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader eyebrow="Retained for evaluation" title={`${feature} isn't part of the verified workflow`} lede="This area is kept for future evaluation. It doesn't provide a verified, production-ready workflow in this release, so it is switched off rather than shown half-working." />
      <div className="panel flex gap-3 p-5 text-sm">
        <FlaskConical className="h-5 w-5 shrink-0 text-ochre" />
        <div className="space-y-3"><p className="text-muted-foreground">{alt?.body ?? 'Use the places in the navigation for normal work.'}</p>{alt && <Button size="sm" variant="outline" asChild><Link to={alt.to}>{alt.cta}</Link></Button>}</div>
      </div>
    </div>
  )
}
