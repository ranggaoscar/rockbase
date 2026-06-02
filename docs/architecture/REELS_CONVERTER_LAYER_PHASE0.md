# Reels Converter Layer Phase 0

## 1. Goal

ROCK BASE should convert approved single-image or carousel content into Reels-ready MP4 drafts for operator review. The output is a video draft, not a post, so the operator can inspect the result before any Compose handoff happens.

## 2. Why This Exists

Instagram users often consume content through Reels, while ROCK BASE content planning can produce static single-image and carousel assets. Those static assets should be able to gain an automatic video version so the same approved concept can be distributed in a Reels-friendly format.

## 3. Core Principle

- No auto-posting.
- No posting engine changes.
- No Compose posting logic changes.
- No ComfyUI call in this phase.
- No FFmpeg call in this phase.
- Output must be review-gated.
- Operator approval required before sending to Compose.

## 4. Target Flow

Approved Content Planner Draft  
-> Approved Image/Carousel Asset  
-> Reels Converter Request  
-> Motion Template  
-> MP4 Draft  
-> Operator Review  
-> Approve / Regenerate / Reject  
-> Send approved MP4 to Compose

## 5. Engine Separation

ComfyUI is for AI visual generation and image editing. It can help create or transform source visuals, but it should not be treated as the default engine for every video conversion task.

FFmpeg or a similar video renderer is better suited for fast image/carousel-to-MP4 conversion. It can animate still assets with predictable motion templates, encode MP4 files, and produce repeatable outputs without invoking heavier AI video workflows.

ROCK BASE should act as the orchestrator and review system. It decides which approved asset is eligible, stores the conversion request, tracks review status, and controls whether an approved MP4 may later move toward Compose.

The posting engine must stay separate. Reels conversion creates reviewable media drafts only; it does not publish, schedule, or alter posting behavior.

## 6. Supported Input Types

- Single image
- Carousel images
- Before-after pair
- Slab highlight image
- ComfyUI-generated image later
- Approved uploaded asset

## 7. Reels Output Defaults

- MP4
- 9:16
- 1080x1920
- 6-12 seconds
- H.264 video
- AAC audio if audio is used
- Safe audio only
- No Instagram trending music automation in early phase

## 8. Motion Templates

- Slow zoom in
- Slow zoom out
- Pan left/right
- Carousel slide sequence
- Before-after split reveal
- Slab detail scan
- Text hook intro + image motion + CTA outro

## 9. Audio Strategy

Phase 0/1 can be silent or use safe brand audio only. The converter should not depend on Instagram's music library, because trending music availability, licensing, and platform behavior can change.

Future options can include ambient audio, voiceover, brand music, and manual audio upload. Trending music should remain manual until the workflow is technically safe and rights handling is clear.

## 10. Review Gate

Generated MP4 files are drafts only. The operator can approve, regenerate, or reject each MP4.

Rejected MP4 files must not be sent to Compose. Approved MP4 files can later be attached to Compose when that integration phase is reached. Compose posting remains manual and review-controlled.

## 11. Suggested UI

- Create Reel Version button
- Select motion template
- Select aspect ratio
- Select duration
- Select audio mode
- Preview MP4
- Approve / Regenerate / Reject
- Send approved MP4 to Compose

## 12. Safe Implementation Phases

Phase 0: docs-only architecture plan.

Phase 1: frontend mock Reels Converter UI with dummy previews.

Phase 2: local renderSpec creation only, no rendering.

Phase 3: backend FFmpeg proof-of-concept for one uploaded image.

Phase 4: carousel-to-MP4 rendering.

Phase 5: review workspace for generated MP4.

Phase 6: send approved MP4 to Compose.

Phase 7: optional ComfyUI image/video support.

Phase 8: scheduling and analytics feedback.

## 13. Risks

- Rendering can be heavy if using AI video.
- FFmpeg is faster for static image motion.
- Audio copyright risk.
- Aspect ratio/crop issues.
- Storage growth from MP4 outputs.
- Need cleanup/retention policy.

## 14. Validation Checklist

- Only docs file created.
- No frontend runtime changed.
- No backend runtime changed.
- No posting engine changed.
- No Compose logic changed.
- No Prisma schema changed.
- No migration created.
- No dev.db touched.
- No .env touched.
- No ComfyUI call.
- No FFmpeg call.
- No auto-post.

## 15. Final Summary

ROCK BASE should not rely on ComfyUI for every video. It should use a fast Reels Converter for image/carousel-to-MP4, keep ComfyUI as an optional visual engine, and keep all outputs review-gated before Compose.
