# Routing and Connector Flow

## Purpose

Describe the current n8n routing flow and connector boundaries without implying real render execution.

## Current routing flow

```text
Webhook
  -> Normalize Payload
  -> Validate Schema
  -> Route Content Type
  -> Build Render Spec
  -> Build Mock Asset Result
  -> Build Execution Summary
  -> Respond to Webhook
```

## Connector behavior

### n8n

- receives the local orchestration payload
- validates the payload shape
- builds a route decision
- emits a render spec
- emits a mock asset result
- returns a simulation-only response

### Frontend

- sends the local webhook payload
- renders the response viewer
- renders mock asset preview
- renders lifecycle badges
- renders operator review buttons

### Posting engine

- remains separate
- must not be called from the mock connector path
- must not consume `mockAssetResult` directly in Phase 1

## Simulation-only contract

The response contract must remain under the following boundary:

```text
simulationOnly = true
```

This means:

- no real ComfyUI call
- no file write
- no asset upload
- no auto-post
- no queue execution
- no backend mutation

## Blocked actions

The routing contract should clearly mark blocked actions such as:

- real asset generation
- real render execution
- file persistence
- asset upload
- auto posting

## Safe connector boundary

```text
Campaign detail
  -> AutomationRequestCenter
    -> localhost webhook
      -> n8n router
        -> simulation-only response
```

Anything past this boundary that affects queue or posting must remain disabled until later phases.

## Markdown diagram

```text
[Frontend Local Payload]
        |
        v
[n8n Webhook Router]
        |
        +--> Normalize Payload
        +--> Validate Schema
        +--> Route Content Type
        +--> Build Render Spec
        +--> Build Mock Asset Result
        +--> Build Execution Summary
        |
        v
[simulationOnly response]
        |
        v
[Frontend Response Viewer]
```

## Future phases

1. Add approved-asset contract without enabling execution.
2. Define queue handoff metadata.
3. Introduce real render status only after simulation contract is stable.
4. Keep posting engine outside connector execution until explicit integration work is approved.
