import { BarChart3, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AutomationDeliveryDiagnostics } from '@/lib/automation'

interface DeliveryInspectorProps {
  diagnostics: AutomationDeliveryDiagnostics
  isSending: boolean
  onRetry: () => void
  formatSchedule: (value?: string | null) => string | null
}

export function DeliveryInspector({ diagnostics, isSending, onRetry, formatSchedule }: DeliveryInspectorProps) {
  return (
    <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[0.035] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-amber-200">
            <BarChart3 className="h-3.5 w-3.5" /> Automation Delivery Inspector
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Diagnostics lokal untuk validasi payload, state delivery, dan future connector readiness.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge
            variant="outline"
            className={cn(
              'h-5 text-[9px]',
              diagnostics.validationStatus === 'valid' && 'border-green-500/30 bg-green-500/10 text-green-300',
              diagnostics.validationStatus === 'warning' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
              diagnostics.validationStatus === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-300',
            )}
          >
            {diagnostics.validationStatus}
          </Badge>
          <Badge variant="outline" className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[9px] text-cyan-200">
            local-only safe
          </Badge>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[9px]" onClick={onRetry} disabled={isSending}>
            <RefreshCw className={cn('mr-1 h-3 w-3', isSending && 'animate-spin')} /> Retry Simulation
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Schema Version', diagnostics.schemaVersion],
          ['Payload Size', `${diagnostics.payloadSizeBytes} bytes`],
          ['Send Timestamp', diagnostics.sendTimestamp === '-' ? '-' : formatSchedule(diagnostics.sendTimestamp)],
          ['Response Timestamp', diagnostics.responseTimestamp === '-' ? '-' : formatSchedule(diagnostics.responseTimestamp)],
          ['Latency', diagnostics.latencyMs !== undefined ? `${diagnostics.latencyMs}ms` : '-'],
          ['Endpoint Validation', diagnostics.endpointValidation],
          ['Response Validity', diagnostics.responseValidity],
          ['Delivery Status', diagnostics.deliveryStatus],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border/50 bg-background/45 p-2">
            <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 break-words text-[10px] text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-amber-200">Payload Checksum</p>
            <Badge variant="outline" className="h-5 text-[9px]">simulation hash</Badge>
          </div>
          <p className="break-all rounded-md border border-border/50 bg-secondary/20 px-2 py-1.5 font-mono text-[11px] text-foreground">
            {diagnostics.checksum}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge
              variant="outline"
              className={cn(
                'h-5 text-[9px]',
                diagnostics.deliveryStatus === 'delivered' && 'border-green-500/30 bg-green-500/10 text-green-300',
                diagnostics.deliveryStatus === 'warning' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                ['failed', 'blocked'].includes(diagnostics.deliveryStatus) && 'border-red-500/30 bg-red-500/10 text-red-300',
                ['idle', 'sending'].includes(diagnostics.deliveryStatus) && 'border-border text-muted-foreground',
              )}
            >
              delivery: {diagnostics.deliveryStatus}
            </Badge>
            <Badge variant="outline" className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[9px] text-cyan-200">
              endpoint: {diagnostics.endpointValidation}
            </Badge>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-amber-200">Payload Validation</p>
          {diagnostics.validationIssues.length > 0 ? (
            <div className="space-y-2">
              {diagnostics.validationIssues.map(issue => (
                <div key={issue.message} className={cn(
                  'rounded-md border px-2 py-1.5 text-[10px]',
                  issue.severity === 'warning' && 'border-yellow-500/20 bg-yellow-500/[0.04] text-yellow-100',
                  issue.severity === 'failed' && 'border-red-500/20 bg-red-500/[0.04] text-red-100',
                )}>
                  <span className="font-bold uppercase">{issue.severity}</span>: {issue.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-green-500/20 bg-green-500/[0.04] px-2 py-4 text-center text-xs text-green-200">
              Payload schema passed local validation.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border/60 bg-background/45 p-2">
        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-amber-200">Future Compatibility</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['n8n compatible', diagnostics.compatibility.n8n],
            ['ComfyUI compatible', diagnostics.compatibility.comfyUI],
            ['AI Writer compatible', diagnostics.compatibility.aiWriter],
            ['Future Agent compatible', diagnostics.compatibility.futureAgent],
          ].map(([label, isCompatible]) => (
            <div key={label as string} className={cn(
              'rounded-md border px-2 py-2',
              isCompatible ? 'border-green-500/25 bg-green-500/[0.05]' : 'border-yellow-500/25 bg-yellow-500/[0.04]',
            )}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold text-foreground">{label as string}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    'h-5 text-[9px]',
                    isCompatible ? 'border-green-500/30 text-green-300' : 'border-yellow-500/30 text-yellow-300',
                  )}
                >
                  {isCompatible ? 'ready' : 'warning'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Inspector is local simulation only. Diagnostics do not enqueue render jobs, trigger posting, or persist state.
      </p>
    </div>
  )
}
