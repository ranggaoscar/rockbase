# Orchestration System Map

## Current scope

This repository currently runs a **simulation-first orchestration flow** for campaign planning, local webhook routing, mock asset generation, operator review, and bridge/package preparation.

It does **not** run real ComfyUI rendering yet.
Real ComfyUI integration remains future-only and must stay behind a separate runtime boundary until the connector contract is frozen.
It does **not** couple mock asset state to the posting engine.
It does **not** persist operator review state.

## Current orchestration flow

```text
Campaign / Campaign detail
  -> AutomationRequestCenter
    -> local webhook send
      -> n8n routing payload
        -> renderSpec
        -> mockAssetResult
        -> execution summary
    -> response viewer
    -> mock asset preview
    -> asset lifecycle badges
    -> operator review badges
```

## System boundaries

### Simulated

- orchestration payload construction
- route selection
- render spec generation
- mock asset result generation
- asset lifecycle view state
- operator review state
- response viewer rendering

### Real / separate

- posting queue
- posting engine
- campaign delivery execution
- media upload persistence
- database-backed campaign planning data

## Safe boundaries

The safe boundary for Phase 1 is:

```text
local UI state
  + simulationOnly webhook response
  + mockAssetResult
  + operator review state
  + no backend persistence
```

Anything that touches queue execution, posting automation, or real media rendering must remain outside this boundary.

## What must not touch the posting engine

- mock asset lifecycle
- operator review state
- response viewer logic
- simulation-only render output
- n8n mock routing
- bridge documentation / planning snapshots

The posting engine remains a separate operational surface and should not consume mock assets directly in Phase 1.

## Future phases planned

1. Frontend-only review state and mock asset visibility.
2. DB-backed lifecycle persistence for approved assets.
3. Queue planning model with explicit handoff to execution.
4. Real render integration behind a strict simulation boundary.
5. Posting-engine integration only after asset, review, and queue contracts are stable.

## Markdown diagram

```text
[Campaign]
   |
   v
[AutomationRequestCenter]
   |
   v
[Local webhook send]
   |
   v
[n8n router]
   |
   +--> [renderSpec]
   |
   +--> [mockAssetResult]
   |
   +--> [execution summary]
   |
   v
[Response Viewer]
   |
   +--> [Mock Asset Preview]
   |
   +--> [Asset Lifecycle]
   |
   +--> [Operator Review]
```
