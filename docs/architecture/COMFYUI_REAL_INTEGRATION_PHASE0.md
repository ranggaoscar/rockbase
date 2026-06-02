# ComfyUI Real Integration Phase 0

## Purpose

Phase 0 is a planning-only phase for a future real ComfyUI integration.
No runtime logic is changed here.
No ComfyUI process is installed or called.

## Core boundaries

- local endpoint only
- concurrency 1
- sequential render only
- no render while Instagram posting is active
- no posting handoff
- no queue fan-out
- no parallel render jobs

## Simulation-only boundary

Current orchestration is still simulation-first.

```text
simulationOnly = true
```

The real ComfyUI plan must not break the current simulation boundary until the execution contract is explicitly approved.

## Current planning model

```text
renderSpec input
  -> renderJob output
  -> generatedAsset output
```

### renderSpec input

`renderSpec` is the request contract that describes:

- content type
- format
- resolution
- aspect ratio
- visual style
- batch size
- prompt direction
- destination targets

### renderJob output

`renderJob` is the future execution unit.

It should represent:

- job id
- source renderSpec id
- state
- startedAt / finishedAt
- failure reason if any
- retry count
- output references

### generatedAsset output

`generatedAsset` is the future file-backed result.

It should represent:

- asset id
- job id
- file name
- output path
- format
- resolution
- aspect ratio
- ready-for-posting flag

## Local endpoint only

Real ComfyUI integration, when approved, should point to a local endpoint only.

No remote render endpoint should be used in Phase 0 planning.
No production upload endpoint should be used for render control.

## Output folder rules

The output folder plan should follow these rules:

- use a dedicated local workspace folder
- keep generated outputs separate from source assets
- keep queue artifacts separate from final media exports
- do not reuse posting-engine folders for render output
- use deterministic naming per request/job/asset
- keep cleanup and retention explicit

Suggested folder split:

```text
workspace/
  comfyui/
    incoming/
    jobs/
    outputs/
    failed/
    archived/
```

## Retry and rollback plan

### Retry

- retry only transient failures
- keep retry count bounded
- use sequential retries only
- do not retry in parallel

### Rollback

Rollback should:

- mark the render job failed
- keep the original request trace
- preserve the renderSpec
- leave posting untouched
- return the system to the simulation-safe path

## What must remain blocked

- no auto-posting
- no posting handoff
- no queue execution coupling
- no frontend/runtime behavior changes yet
- no ComfyUI install scripts
- no render API calls

## Markdown diagram

```text
[renderSpec]
   |
   v
[renderJob]
   |
   v
[generatedAsset]
   |
   +--> output files
   +--> failed artifacts
   +--> archived artifacts
```

## Future phases

1. Freeze connector contract.
2. Freeze output folder naming.
3. Define backend job runner boundary.
4. Add real ComfyUI execution behind a strict simulation gate.
5. Only after that, consider any posting-adjacent consumption.
