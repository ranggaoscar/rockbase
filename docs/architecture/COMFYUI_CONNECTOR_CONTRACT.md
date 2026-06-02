# ComfyUI Connector Contract

## Purpose

Define the contract shape for a future real ComfyUI integration.

This document is planning-only.

## Contract flow

```text
renderSpec input
  -> renderJob output
  -> generatedAsset output
```

## renderSpec input

Required intent fields:

- requestId
- campaignId
- contentType
- format
- resolution
- aspectRatio
- visualStyle
- batchSize

Recommended metadata:

- promptDirection
- negativePrompt
- outputIntent
- destinationPipeline
- targetPlatforms

## renderJob output

Required execution fields:

- jobId
- requestId
- renderSpecId
- state
- retryCount
- startedAt
- updatedAt

Optional fields:

- finishedAt
- failureReason
- workerName
- checkpointPath

## generatedAsset output

Required asset fields:

- assetId
- jobId
- requestId
- fileName
- filePath
- format
- resolution
- aspectRatio
- readyForPosting

Optional fields:

- checksum
- fileSize
- mimeType
- previewPath
- archivedAt

## Simulation-only boundary

Until real execution is approved, any connector response must continue to state:

```text
simulationOnly = true
```

The connector contract should not imply that outputs are ready for posting unless a real render path has been explicitly introduced.

## Safety rules

- local endpoint only
- concurrency 1
- sequential processing only
- no parallel render
- no posting handoff
- no queue fan-out
- no direct IG execution

## Marker states

Planned real states:

- requested
- routed
- queued
- rendering
- rendered
- failed
- approved
- archived

Note:
- approval is still a separate operator decision layer
- approval must not automatically trigger posting

## Markdown diagram

```text
[Frontend orchestration]
       |
       v
[renderSpec]
       |
       v
[ComfyUI connector]
       |
       +--> [renderJob]
       |
       +--> [generatedAsset]
       |
       v
[operator review / queue planning]
```

## Future phases

1. Freeze field names.
2. Decide storage locations for job and asset metadata.
3. Add execution runner only after boundary review.
4. Keep posting-engine handoff out of this contract.
