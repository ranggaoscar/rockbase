# Campaign Operator UX Simplification Plan

## 1. Current Problem
Campaign module has too many technical panels and automation details exposed to normal users.

## 2. UX Target
Make Campaign usable for human operators while keeping automation power available behind Advanced/Debug views.

## 3. Proposed Campaign Modes
- Simple Operator Mode
- Advanced Automation Mode
- Developer Debug Mode

## 4. Simple Operator Mode Flow
- Step 1: Create Campaign Brief
- Step 2: Select Brand / Account Group
- Step 3: Choose Content Type
- Step 4: Generate AI Plan
- Step 5: Generate Content Asset via ComfyUI-ready workflow
- Step 6: Review Generated Content
- Step 7: Approve / Regenerate / Reject
- Step 8: Send Approved Asset to Compose

## 5. Advanced Automation Mode
Should contain:
- Universal Automation Schema
- n8n Bridge
- Payload Preview
- Delivery Inspector
- Response Viewer
- Mock Asset Result
- Routing status
- Automation Request History

## 6. Developer Debug Mode
Should contain:
- raw JSON
- requestId
- renderSpec
- blockedActions
- lifecycle status
- error logs
- retry details

## 7. Human-Friendly Status Labels
- `mock_ready` = Preview siap dicek
- `readyForPosting false` = Belum siap diposting
- `pending_review` = Menunggu review
- `approved` = Disetujui
- `rejected` = Ditolak
- `needs_revision` = Perlu revisi
- `routed` = Dikirim ke automation
- `failed` = Gagal, perlu dicek

## 8. Generated Content Workspace Concept
- shows ComfyUI generated previews
- supports Approve
- supports Regenerate
- supports Reject
- supports Needs Revision
- Send to Compose only after approved
- no auto-posting

## 9. Safety Boundaries
- no posting engine changes
- no auto-posting
- no ComfyUI direct execution in this phase
- no database migration in this phase
- no deletion of advanced automation features
- UI simplification must be additive and reversible

## 10. Implementation Phases
- Phase 1: docs-only UX simplification plan
- Phase 2: add UI mode tabs without changing logic
- Phase 3: hide technical panels behind Advanced
- Phase 4: add Simple Campaign stepper
- Phase 5: connect Generated Content Workspace preview
- Phase 6: approval-gated Send to Compose

## 11. Validation Checklist
- [x] only docs file changed
- [x] git status shows docs only
- [x] no backend/frontend runtime code changed
- [x] posting engine untouched
