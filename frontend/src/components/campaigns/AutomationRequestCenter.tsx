import { useEffect, useState } from 'react'
import { Activity, RefreshCw, SendHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AUTOMATION_REQUEST_SPECS,
  AUTOMATION_REQUEST_TYPES,
  type AutomationDeliveryDiagnostics,
  type AutomationRequestPayload,
  type AutomationRequestType,
  type AutomationSchemaTab,
  type AutomationSimulationStatus,
  type LocalWebhookHistoryEntry,
  type LocalWebhookResult,
  type UniversalAutomationSchema,
} from '@/lib/automation'
import { SchemaPreview } from './SchemaPreview'
import { DeliveryInspector } from './DeliveryInspector'

type AutomationRequestLogEntry = {
  requestId: string
  requestType: AutomationRequestType
  status: AutomationSimulationStatus
  queuedTime: string
  updatedAt: string
  destinationPipeline: string[]
  summary: string
}

interface AutomationRequestCenterProps {
  automationPayload?: AutomationRequestPayload
  automationLogs: AutomationRequestLogEntry[]
  universalAutomationSchema: UniversalAutomationSchema
  automationSchemaTab: AutomationSchemaTab
  localWebhookEndpoint: string
  defaultLocalWebhookEndpoint: string
  localWebhookResult: LocalWebhookResult
  localWebhookHistory: LocalWebhookHistoryEntry[]
  deliveryDiagnostics: AutomationDeliveryDiagnostics
  onCreateAutomationRequest: (requestType: AutomationRequestType) => void
  onAdvanceAutomationRequest: () => void
  onSchemaTabChange: (tab: AutomationSchemaTab) => void
  onCopyAutomationSchema: () => void
  onLocalWebhookEndpointChange: (value: string) => void
  onSendLocalWebhookPayload: () => void
  isAllowedLocalWebhookEndpoint: (value: string) => boolean
  formatSchedule: (value?: string | null) => string | null
}

type MockAssetItem = {
  assetId: string
  type: string
  format?: string | null
  resolution?: string | null
  aspectRatio?: string | null
  filename?: string | null
  mockUrl?: string | null
  storagePath?: string | null
  readyForPosting?: boolean
}

type MockAssetResult = {
  status?: string
  simulationOnly?: boolean
  source?: string
  renderSpecId?: string
  requestId?: string | null
  assetBatchId?: string
  assets?: MockAssetItem[]
}

type AssetLifecycleState = 'requested' | 'routed' | 'mock_ready' | 'approved' | 'queued' | 'rendered' | 'failed' | 'archived'
type AssetReviewState = 'pending_review' | 'approved' | 'rejected' | 'needs_revision'

const AUTOMATION_STATUS_STYLES: Record<AutomationSimulationStatus, string> = {
  queued: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
  preparing: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  'waiting render': 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  completed: 'border-green-500/30 bg-green-500/10 text-green-300',
}

function isMockAssetResultPayload(value: unknown): value is { mockAssetResult: MockAssetResult } {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return Boolean(payload.mockAssetResult && typeof payload.mockAssetResult === 'object')
}

function getAssetLifecycleState({
  hasRenderSpec,
  mockAssetResult,
}: {
  hasRenderSpec: boolean
  mockAssetResult?: MockAssetResult | null
}): AssetLifecycleState {
  if (!hasRenderSpec) return 'requested'
  if (mockAssetResult?.status === 'mock_ready') return 'mock_ready'
  return 'routed'
}

const ASSET_REVIEW_STYLES: Record<AssetReviewState, string> = {
  pending_review: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  approved: 'border-green-500/30 bg-green-500/10 text-green-200',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-200',
  needs_revision: 'border-purple-500/30 bg-purple-500/10 text-purple-200',
}

export function AutomationRequestCenter({
  automationPayload,
  automationLogs,
  universalAutomationSchema,
  automationSchemaTab,
  localWebhookEndpoint,
  defaultLocalWebhookEndpoint,
  localWebhookResult,
  localWebhookHistory,
  deliveryDiagnostics,
  onCreateAutomationRequest,
  onAdvanceAutomationRequest,
  onSchemaTabChange,
  onCopyAutomationSchema,
  onLocalWebhookEndpointChange,
  onSendLocalWebhookPayload,
  isAllowedLocalWebhookEndpoint,
  formatSchedule,
}: AutomationRequestCenterProps) {
  const isEndpointAllowed = isAllowedLocalWebhookEndpoint(localWebhookEndpoint)
  const isSending = localWebhookResult.status === 'sending'
  const responsePayload = localWebhookResult.responsePayload
  const mockAssetResult = isMockAssetResultPayload(responsePayload)
    ? responsePayload.mockAssetResult
    : null
  const mockAssets = Array.isArray(mockAssetResult?.assets) ? mockAssetResult.assets : []
  const hasRenderSpec = Boolean(mockAssetResult?.renderSpecId)
  const lifecycleState = getAssetLifecycleState({ hasRenderSpec, mockAssetResult })
  const [assetReviewStateMap, setAssetReviewStateMap] = useState<Record<string, AssetReviewState>>({})

  useEffect(() => {
    if (mockAssets.length === 0) return

    setAssetReviewStateMap(prev => {
      let changed = false
      const next = { ...prev }

      mockAssets.forEach(asset => {
        if (!next[asset.assetId]) {
          next[asset.assetId] = 'pending_review'
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [mockAssets])

  const updateReviewState = (assetId: string, state: AssetReviewState) => {
    setAssetReviewStateMap(prev => ({
      ...prev,
      [assetId]: state,
    }))
  }

  const lifecycleSteps: { key: AssetLifecycleState; label: string; active: boolean; done: boolean }[] = [
    { key: 'requested', label: 'requested', active: lifecycleState === 'requested', done: ['routed', 'mock_ready', 'approved', 'queued', 'rendered', 'failed', 'archived'].includes(lifecycleState) },
    { key: 'routed', label: 'routed', active: lifecycleState === 'routed', done: ['mock_ready', 'approved', 'queued', 'rendered', 'failed', 'archived'].includes(lifecycleState) },
    { key: 'mock_ready', label: 'mock_ready', active: lifecycleState === 'mock_ready', done: ['approved', 'queued', 'rendered', 'failed', 'archived'].includes(lifecycleState) },
    { key: 'approved', label: 'approved', active: lifecycleState === 'approved', done: ['queued', 'rendered', 'failed', 'archived'].includes(lifecycleState) },
    { key: 'queued', label: 'queued', active: lifecycleState === 'queued', done: ['rendered', 'failed', 'archived'].includes(lifecycleState) },
    { key: 'rendered', label: 'rendered', active: lifecycleState === 'rendered', done: ['archived'].includes(lifecycleState) },
    { key: 'failed', label: 'failed', active: lifecycleState === 'failed', done: false },
    { key: 'archived', label: 'archived', active: lifecycleState === 'archived', done: false },
  ]

  return (
    <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/[0.04] p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold">
            <Activity className="h-3.5 w-3.5 text-cyan-300" /> Automation Request Center
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Local orchestration payload builder untuk future n8n, ComfyUI, dan AI Writer pipeline.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200">
          Simulation-safe
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {AUTOMATION_REQUEST_TYPES.map(requestType => {
          const spec = AUTOMATION_REQUEST_SPECS[requestType]
          return (
            <button
              key={requestType}
              type="button"
              onClick={() => onCreateAutomationRequest(requestType)}
              className="rounded-md border border-border/70 bg-background/50 p-2 text-left transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/[0.06]"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-xs font-bold text-foreground">{requestType}</p>
                <Badge variant="outline" className="shrink-0 text-[9px]">{spec.estimatedBatch}</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground">{spec.targetFormat}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {spec.destinationPipeline.map(destination => (
                  <Badge key={destination} variant="outline" className="h-5 text-[9px]">{destination}</Badge>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-md border border-border/60 bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-cyan-200">Payload Preview</p>
            {automationPayload && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-[9px]" onClick={onAdvanceAutomationRequest}>
                <RefreshCw className="mr-1 h-3 w-3" /> Advance Status
              </Button>
            )}
          </div>
          {automationPayload ? (
            <div className="space-y-2 text-[10px]">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="h-5 text-[9px]">ID: {automationPayload.requestId}</Badge>
                <Badge variant="outline" className={cn('h-5 text-[9px]', AUTOMATION_STATUS_STYLES[automationPayload.automationStatus])}>
                  {automationPayload.automationStatus}
                </Badge>
                <Badge variant="outline" className="h-5 text-[9px]">
                  Queued: {formatSchedule(automationPayload.queuedTime)}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['campaign', automationPayload.campaign.name],
                  ['material/topic', automationPayload.materialTopic],
                  ['objective', automationPayload.objective],
                  ['content type', automationPayload.contentType],
                  ['target format', automationPayload.targetFormat],
                  ['visual style', automationPayload.visualStyle],
                  ['destination brand', automationPayload.destinationBrand],
                  ['estimated batch', automationPayload.estimatedBatch],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border/50 bg-secondary/20 p-2">
                    <p className="font-black uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.04] p-2">
                <p className="mb-1 font-black uppercase tracking-wide text-cyan-200">Destination Pipeline</p>
                <div className="flex flex-wrap gap-1">
                  {automationPayload.destinationPipeline.map(destination => (
                    <Badge key={destination} variant="outline" className="h-5 text-[9px]">{destination}</Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background/35 px-3 py-5 text-center text-xs text-muted-foreground">
              Klik salah satu request type untuk membuat payload orchestration lokal.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border/60 bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-cyan-200">Automation Request Log</p>
            <Badge variant="outline" className="h-5 text-[9px]">{automationLogs.length} event</Badge>
          </div>
          {automationLogs.length > 0 ? (
            <div className="space-y-2">
              {automationLogs.map(log => (
                <div key={`${log.requestId}-${log.updatedAt}`} className="rounded-md border border-border/50 bg-secondary/20 p-2">
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className={cn('h-5 text-[9px]', AUTOMATION_STATUS_STYLES[log.status])}>{log.status}</Badge>
                    <Badge variant="outline" className="h-5 text-[9px]">{log.requestType}</Badge>
                  </div>
                  <p className="text-[10px] font-medium text-foreground">{log.summary}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {log.requestId} | {formatSchedule(log.updatedAt)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {log.destinationPipeline.map(destination => (
                      <span key={destination} className="rounded border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground">
                        {destination}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background/35 px-3 py-5 text-center text-xs text-muted-foreground">
              Belum ada request simulation log.
            </p>
          )}
        </div>
      </div>

      <SchemaPreview
        schema={universalAutomationSchema}
        activeTab={automationSchemaTab}
        onTabChange={onSchemaTabChange}
        onCopy={onCopyAutomationSchema}
      />

      <div className="mt-3 rounded-md border border-green-500/20 bg-green-500/[0.035] p-3">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-green-200">
              <SendHorizontal className="h-3.5 w-3.5" /> Local Automation Webhook Config
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Safe local bridge untuk test n8n webhook simulation. Endpoint dibatasi ke localhost.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-green-500/30 bg-green-500/10 text-[9px] text-green-200">
            Local mode only
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
          <input
            value={localWebhookEndpoint}
            onChange={event => onLocalWebhookEndpointChange(event.target.value)}
            className={cn(
              'w-full rounded-md border bg-background/60 px-3 py-2 text-xs outline-none focus:border-green-500/50',
              isEndpointAllowed ? 'border-border' : 'border-red-500/40',
            )}
            placeholder={defaultLocalWebhookEndpoint}
          />
          <Button size="sm" className="h-9 text-xs" onClick={onSendLocalWebhookPayload} disabled={isSending}>
            {isSending ? (
              <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="mr-1 h-3.5 w-3.5" />
            )}
            Send Payload
          </Button>
        </div>
        {!isEndpointAllowed && (
          <p className="mt-1 text-[10px] text-red-300">Only http://localhost, http://127.0.0.1, or http://[::1] endpoints are allowed.</p>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-border/60 bg-background/45 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-wide text-green-200">Response Viewer</p>
              <Badge
                variant="outline"
                className={cn(
                  'h-5 text-[9px]',
                  localWebhookResult.status === 'success' && 'border-green-500/30 bg-green-500/10 text-green-300',
                  localWebhookResult.status === 'sending' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                  ['offline', 'timeout', 'invalid', 'blocked'].includes(localWebhookResult.status) && 'border-red-500/30 bg-red-500/10 text-red-300',
                  localWebhookResult.status === 'idle' && 'border-border text-muted-foreground',
                )}
              >
                {localWebhookResult.status}
              </Badge>
            </div>
            <div className="grid gap-2 text-[10px] sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded border border-border/50 bg-secondary/20 p-2">
                <p className="font-black uppercase tracking-wide text-muted-foreground">HTTP Status</p>
                <p className="mt-0.5 text-foreground">{localWebhookResult.httpStatus ?? '-'}</p>
              </div>
              <div className="rounded border border-border/50 bg-secondary/20 p-2">
                <p className="font-black uppercase tracking-wide text-muted-foreground">Response Time</p>
                <p className="mt-0.5 text-foreground">{localWebhookResult.responseTimeMs !== undefined ? `${localWebhookResult.responseTimeMs}ms` : '-'}</p>
              </div>
            </div>
            {localWebhookResult.error && (
              <p className="mt-2 rounded-md border border-red-500/20 bg-red-500/[0.05] px-2 py-1.5 text-[10px] text-red-200">
                {localWebhookResult.error}
              </p>
            )}
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-secondary/30 p-2 text-[10px] text-muted-foreground">
              {localWebhookResult.responsePayload !== undefined
                ? JSON.stringify(localWebhookResult.responsePayload, null, 2)
                : 'No local webhook response yet.'}
            </pre>

            {mockAssetResult && (
              <div className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/[0.04] p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[10px] font-black uppercase tracking-wide text-cyan-200">Mock Asset Preview</p>
                  <Badge variant="outline" className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[9px] text-cyan-200">
                    {mockAssetResult.status || 'unknown'}
                  </Badge>
                  {mockAssetResult.simulationOnly && (
                    <Badge variant="outline" className="h-5 border-green-500/30 bg-green-500/10 text-[9px] text-green-200">
                      simulationOnly
                    </Badge>
                  )}
                </div>

                <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
                  <div className="rounded border border-border/50 bg-background/45 p-2">
                    <p className="font-black uppercase tracking-wide text-muted-foreground">Source</p>
                    <p className="mt-0.5 break-words text-foreground">{mockAssetResult.source ?? '-'}</p>
                  </div>
                  <div className="rounded border border-border/50 bg-background/45 p-2">
                    <p className="font-black uppercase tracking-wide text-muted-foreground">Asset Count</p>
                    <p className="mt-0.5 text-foreground">{mockAssets.length}</p>
                  </div>
                  <div className="rounded border border-border/50 bg-background/45 p-2">
                    <p className="font-black uppercase tracking-wide text-muted-foreground">Asset Batch ID</p>
                    <p className="mt-0.5 break-all font-mono text-[9px] text-foreground">{mockAssetResult.assetBatchId ?? '-'}</p>
                  </div>
                  <div className="rounded border border-border/50 bg-background/45 p-2">
                    <p className="font-black uppercase tracking-wide text-muted-foreground">Render Spec ID</p>
                    <p className="mt-0.5 break-all font-mono text-[9px] text-foreground">{mockAssetResult.renderSpecId ?? '-'}</p>
                  </div>
                </div>

                <div className="mt-2 rounded-md border border-border/50 bg-background/45 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[10px] font-black uppercase tracking-wide text-cyan-200">Asset Lifecycle</p>
                    <Badge variant="outline" className="h-5 border-cyan-500/30 bg-cyan-500/10 text-[9px] text-cyan-200">
                      {lifecycleState}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    {lifecycleSteps.map(step => (
                      <div
                        key={step.key}
                        className={cn(
                          'rounded border px-2 py-1.5 text-[9px] uppercase tracking-wide',
                          step.active
                            ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                            : step.done
                              ? 'border-green-500/20 bg-green-500/[0.04] text-green-200'
                              : 'border-border/50 bg-secondary/20 text-muted-foreground',
                        )}
                      >
                        {step.label}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  {mockAssets.length > 0 ? (
                    mockAssets.map((asset) => {
                      const isCaptionMock = asset.type === 'mock_caption_output'

                      return (
                        <div key={asset.assetId} className="rounded border border-border/50 bg-background/45 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="h-5 text-[9px]">
                              {asset.assetId}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-5 text-[9px]',
                                'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                              )}
                            >
                              currentState: mock_ready
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-5 text-[9px]',
                                isCaptionMock
                                  ? 'border-purple-500/30 bg-purple-500/10 text-purple-200'
                                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                              )}
                            >
                              {isCaptionMock ? 'caption mock' : asset.type}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-5 text-[9px]',
                                asset.readyForPosting
                                  ? 'border-green-500/30 bg-green-500/10 text-green-200'
                                  : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
                              )}
                            >
                              readyForPosting: {asset.readyForPosting ? 'true' : 'false'}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-5 text-[9px]',
                                ASSET_REVIEW_STYLES[assetReviewStateMap[asset.assetId] ?? 'pending_review'],
                              )}
                            >
                              review: {assetReviewStateMap[asset.assetId] ?? 'pending_review'}
                            </Badge>
                          </div>

                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Format</p>
                              <p className="mt-0.5 break-words text-[10px] text-foreground">{asset.format ?? '-'}</p>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Resolution</p>
                              <p className="mt-0.5 break-words text-[10px] text-foreground">
                                {isCaptionMock ? 'text-only' : (asset.resolution ?? '-')}
                              </p>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Aspect Ratio</p>
                              <p className="mt-0.5 break-words text-[10px] text-foreground">
                                {isCaptionMock ? 'n/a' : (asset.aspectRatio ?? '-')}
                              </p>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2 sm:col-span-2 lg:col-span-3">
                              <p className="text-[9px] font-black uppercase tracking-wide text-muted-foreground">Filename</p>
                              <p className="mt-0.5 break-all font-mono text-[9px] text-foreground">{asset.filename ?? '-'}</p>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(['pending_review', 'approved', 'rejected', 'needs_revision'] as AssetReviewState[]).map(state => (
                              <Button
                                key={state}
                                type="button"
                                size="sm"
                                variant="outline"
                                className={cn(
                                  'h-6 px-2 text-[9px]',
                                  (assetReviewStateMap[asset.assetId] ?? 'pending_review') === state && ASSET_REVIEW_STYLES[state],
                                )}
                                onClick={() => updateReviewState(asset.assetId, state)}
                              >
                                {state}
                              </Button>
                            ))}
                          </div>

                          {isCaptionMock && (
                            <p className="mt-2 rounded border border-purple-500/20 bg-purple-500/[0.05] px-2 py-1 text-[9px] text-purple-100">
                              Caption-only mock output. No image/video render is implied.
                            </p>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <p className="rounded-md border border-dashed border-cyan-500/25 bg-background/35 px-3 py-4 text-center text-xs text-muted-foreground">
                      Mock asset result received, but no asset entries were returned.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-border/60 bg-background/45 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-wide text-green-200">Request History</p>
              <Badge variant="outline" className="h-5 text-[9px]">{localWebhookHistory.length} local send</Badge>
            </div>
            {localWebhookHistory.length > 0 ? (
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {localWebhookHistory.map(entry => (
                  <div key={entry.id} className="rounded-md border border-border/50 bg-secondary/20 p-2">
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 text-[9px]',
                          entry.status === 'success' && 'border-green-500/30 bg-green-500/10 text-green-300',
                          entry.status === 'timeout' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                          ['offline', 'invalid', 'blocked'].includes(entry.status) && 'border-red-500/30 bg-red-500/10 text-red-300',
                        )}
                      >
                        {entry.status}
                      </Badge>
                      <Badge variant="outline" className="h-5 text-[9px]">{entry.httpStatus ?? 'no-http'}</Badge>
                      <Badge variant="outline" className="h-5 text-[9px]">{entry.responseTimeMs ?? '-'}ms</Badge>
                    </div>
                    <p className="truncate text-[10px] font-medium text-foreground">{entry.campaignName}</p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{entry.requestId}</p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{entry.endpoint}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border bg-background/35 px-3 py-5 text-center text-xs text-muted-foreground">
                No local webhook requests sent yet.
              </p>
            )}
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">
          Webhook failure does not modify campaign state. This bridge only sends the universal schema payload to a local simulation endpoint.
        </p>
      </div>

      <DeliveryInspector
        diagnostics={deliveryDiagnostics}
        isSending={isSending}
        onRetry={onSendLocalWebhookPayload}
        formatSchedule={formatSchedule}
      />

      <p className="mt-3 text-[10px] text-muted-foreground">
        Simulation only. Tidak ada webhook, external fetch, n8n request, ComfyUI call, atau perubahan Compose payload.
      </p>
    </div>
  )
}
