# ComfyUI Runtime Boundaries

## Purpose

Describe what the future real runtime may and may not do.

This document does not change runtime behavior.

## Safe runtime boundary

```text
local ComfyUI endpoint
  <- renderSpec
  -> renderJob
  -> generatedAsset
```

## Explicitly allowed in the future

- local-only rendering
- sequential job execution
- one render job at a time
- bounded retry for transient failures
- explicit output file handling

## Explicitly blocked in the future

- rendering while IG posting is active
- parallel render fan-out
- remote render endpoint control
- direct posting-engine handoff
- automatic queue promotion into posting
- hidden background execution that bypasses review

## Lifecycle plan

Future real lifecycle:

```text
requested -> routed -> queued -> rendering -> rendered -> failed -> approved -> archived
```

Notes:

- `approved` remains an operator state, not an execution state
- `rendered` only means the file exists and passed the render step
- posting still requires a separate explicit step

## Folder and artifact rules

- outputs must stay inside a dedicated local workspace
- keep failure artifacts separate from successful assets
- keep archived outputs separate from active outputs
- never place runtime outputs inside posting-engine folders
- avoid overwriting source media

## Retry and rollback

### Retry strategy

- retry only transient renderer failures
- retry sequentially
- cap retries
- stop immediately on deterministic configuration failures

### Rollback strategy

- mark job failed
- preserve input renderSpec
- preserve failure reason
- do not mutate posting state
- return control to operator review / planning

## No posting handoff

The runtime boundary must not send generated assets directly to the posting engine.

Posting should remain a separate, explicit workflow step after review and queue planning are stable.

## Markdown diagram

```text
[local endpoint]
    |
    v
[renderJob running]
    |
    +--> sequential only
    +--> retry bounded
    +--> rollback on fail
    |
    v
[generatedAsset]
    |
    +--> archived / failed / rendered
```

## Future phases

1. Add a runtime runner behind a feature gate.
2. Keep render execution local-only.
3. Validate memory/GPU guard rails.
4. Only then evaluate queue handoff, still without posting coupling.
