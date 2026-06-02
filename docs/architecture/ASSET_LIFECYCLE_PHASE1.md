# Asset Lifecycle Phase 1

## Purpose

Document the current simulated asset lifecycle so future render and queue work can stay aligned with the existing boundaries.

## Current lifecycle states

```text
requested -> routed -> mock_ready -> approved -> queued -> rendered -> failed -> archived
```

## Phase 1 behavior

- `requested` is the initial lifecycle state.
- `routed` indicates orchestration has produced a render spec.
- `mock_ready` indicates the simulated asset result has been returned.
- `approved`, `queued`, `rendered`, `failed`, and `archived` are present as future lifecycle states.
- In Phase 1, lifecycle remains **frontend-only** and derived from `mockAssetResult`.

## What is simulated

- asset pipeline visibility
- asset count
- format and resolution labels
- current state badges
- ready-for-posting flags

## What is real

Nothing in this phase writes to a render service, queue service, or database lifecycle table.

## Operator review layer

Operator review is a separate, local-only overlay on top of lifecycle state.

```text
mock_ready asset
  -> pending_review
  -> approved / rejected / needs_revision
```

Review state is advisory only and does not change execution behavior.

## Boundaries

- `mockAssetResult` lives in orchestration response payloads.
- lifecycle display lives in `AutomationRequestCenter`.
- review state lives in local component state.
- posting queue remains separate.
- ComfyUI remains non-real in Phase 1.

## Markdown diagram

```text
[renderSpec]
   |
   v
[mockAssetResult]
   |
   v
[Asset Lifecycle View]
   |
   +--> requested
   +--> routed
   +--> mock_ready
   +--> approved
   +--> queued
   +--> rendered
   +--> failed
   +--> archived
```

## Future phases

1. Persist lifecycle state in a dedicated store.
2. Connect approved assets to a planned queue model.
3. Add real render status propagation after the ComfyUI contract is stable.
4. Keep posting engine integration separated until queue semantics are proven.
