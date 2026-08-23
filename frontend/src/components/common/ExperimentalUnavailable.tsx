import { FlaskConical } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function ExperimentalUnavailable({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Advanced / Experimental</p>
      <h1 className="text-2xl font-bold">{feature} is not part of the operator workflow</h1>
      <Card className="border-amber-500/20 bg-amber-500/[0.04]">
        <CardContent className="flex gap-3 p-5 text-sm text-muted-foreground">
          <FlaskConical className="h-5 w-5 shrink-0 text-amber-400" />
          <p>
            This area is retained for future evaluation. It does not provide a verified, production-ready workflow in this alpha. Use Accounts, Sessions, Campaigns, Queue, and Activity for normal campaign operations.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
