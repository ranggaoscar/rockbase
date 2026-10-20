# RockBase Growth OS — Product Redesign

Branch `feat/growth-os-redesign` (from `main` @ `85cbe80`). Implements the direction in
`OPUS_5_5_CREATIVE_BRIEF.md` / `UX_RECON.md` in the real application. Not pushed, merged or deployed.

## Direction: "Basalt & Patina — an instrument for growth work"

RockBase should feel like a precise instrument, not a dashboard of engines. Two grammars run through
every surface, so trust is built into the visual language instead of being added as disclaimers:

| Grammar | Question it answers | Encoding |
|---|---|---|
| **Evidence grade** | "How do we know this?" | solid = measured (GSC, own crawl) · hatched = observed signal (RSS bucket, first sighting) · ring = idea (editorial only) · slashed = not measured |
| **Effect class** | "What happens when I press this?" | Saves in RockBase · Saves in this browser only · Reads a public feed · Crawls your website · Requests data from Google · Calls an AI provider (may cost) · Publishes outside RockBase |

Missing data has its own visual form, the **void** (hatched, with a reason). It is never drawn as 0.
Loading, empty, stale, error, Local-Mode-only and not-connected are distinct states (`SourcePill`).

Identity: a dark basalt surface with patina (primary action / measured), signal blue (observed), ember
(anything that leaves the machine) and ochre (stale). The type stack is entirely system fonts: Bahnschrift/DIN
display, Segoe UI Variable text, Cascadia Mono figures. The shell now makes **zero third-party requests**;
the Google Fonts link was removed. The brand mark is stacked strata: layered rock, layered evidence.

## Information architecture

Six work places follow the thinking journey; Setup holds the plumbing. Every legacy route still works and
is filed under the place it belongs to.

| Place | Route | Job | Built on |
|---|---|---|---|
| **Today** | `/` | What is worth doing now, what's blocked, what to continue, what's measured | crawl issue groups, cached GSC report, Radar, drafts, ops summary |
| **Radar** (Discover) | `/trends` | Topics with evidence → brief | Trend Radar API (Local Mode) |
| **Site & Search** (Analyze) | `/seo` | Fixes → rescan; Google performance | SEO crawler + GSC performance view |
| **Studio** (Create) | `/studio`, `/studio/d|n|c/:id`, `/ai-writer` | Every draft in one library; brief editor | Radar drafts (DB), browser drafts, Caption assistant |
| **Publish** (Distribute) | `/publish`, `/compose`, `/campaigns`, `/queue`, `/activity` | Post with preflight/pacing; action contract | existing social operations |
| **Results** (Measure) | `/results` (`/analytics` redirects here) | Only what is measured, with source + period | cached GSC, crawl history, queue status |
| **Setup** | `/setup`, `/setup/google`, `/accounts`, `/farm`, `/proxies`, `/warming`, `/engagement`, `/validation`, `/settings` | Connections and operations | existing pages; GSC connection view |

Navigation: desktop rail with a **"Working for…" brand switcher** and inline section children; Ctrl/⌘ K
command palette (pages + brand switching); mobile top bar with a brand chip, a 5-tab bottom bar
(Today · Radar · Studio · Publish · More) and a "More" sheet, plus section tabs. The rail never shrinks onto
mobile.

**Brand context** (`useWorkContext`) is a persisted UX preference `{workspaceId, brandKey, websiteId}`
resolved against the live registry (`/seo/brands`, which Trends shares). It pre-selects scope on every page.
It is not authorization: every backend route still checks its own workspace. Switching brand clears the
website choice, and Studio/Today drafts are filtered by provenance `brandKey`, so brands never mix.

## The vertical journey (implemented end to end)

Brand → Today ranks a Radar topic backed by cached GSC → **Start brief** (one click, "Creates a draft ·
no posting") → Studio editor opens the article brief, with its evidence attached read-only → edit, Ctrl+S
(unsaved-changes guard, save status) → pre-export checklist (a checklist, not a score) → **Copy Markdown /
Download .md** (RockBase has no CMS; it says so) → rescan in Site & Search → Results shows measured change
with source and period. Social formats continue to Compose instead (Apply stays explicit; nothing posts).
A manual-first path also works: Studio → New draft, with no data, AI or social setup needed.

## Recon findings → what changed

| Finding | Resolution |
|---|---|
| F1 home was campaign plumbing | Today: work queue across SEO/search/Radar; first-run path is SEO/content-first and social is explicitly optional |
| F2 context lost between modules | Global brand context + carried website; deep links carry `site`, `tab`, `focus`, `q` |
| F3 drafts scattered; articles land in a caption tool | Studio library over all stores with an honest storage label; article briefs open in Studio, not Compose; Compose points old article links to Studio |
| F4 Measure incomplete / synthetic analytics | Results page with real GSC + crawl history + execution status; social outcomes in an explicit "Not measured yet" void; `/analytics` → Results |
| F5 setup before decisions | Radar: topic list + decision-first detail (summary → briefs → evidence); watchlist/thresholds in a "Tune" sheet; feed diagnostics in a "Sources" sheet. SEO: Fixes first; GSC connection moved to Setup → Google; scan settings in a compact menu |
| F6 queue error looked empty | Queue distinguishes error / empty / filtered-empty, keeps last good rows marked stale, shows observation time and refresh |
| F7 mobile = squeezed desktop | Mobile composition: bottom nav, full-screen topic detail, mobile queue list, blockers first on Today; no horizontal overflow on 11 routes at 390px (Compose included) |
| F8 AI Writer niche/egress | Brand-neutral (stone presets, examples and **fallback hashtags removed**; hashtags only come from the AI response); provider/cost disclosed before the request; tone/niche shown only in batch mode, where they reach the payload; false "fallback mode" message corrected |

Also: the false unread dot on the old bell was removed. The "Schedule Draft ≠ Publish at" contract is stated on
Publish and on the retired Scheduler page. Radar and GSC in Server Mode show a capability page instead of a
raw `TREND_LOCAL_ONLY` error.

## Backend change (one, tested)

`backend/src/routes/trendRoutes.ts` — Studio needed to find and continue Radar drafts:

- `GET /api/trends/drafts?workspace_id=` — workspace-scoped list with parsed provenance summary (format, topic, classification, brandKey).
- `PATCH /api/trends/drafts/:id` — saves title + body only. The server re-attaches the stored provenance block, so evidence can't be edited or dropped from the client; a body containing a provenance block is rejected (422).
- Both sit behind the existing Local-Mode, local-owner and origin gates; no queue, post or Google call.

`trend-routes-test.ts`: **42 assertions pass** (was 25): list/isolation, 404 cross-workspace, forged
provenance rejected, empty title rejected, edit preserves provenance, hostile origin 403, Server Mode 409.

## Persistence — honest status

| Draft source | Stored in | Id | Modes | Shown as |
|---|---|---|---|---|
| Radar briefs | Prisma `Draft` (workspace) via `/api/trends/drafts` | `trend-<sha256>` | Local only | "RockBase" + evidence |
| Studio blank drafts ("New draft") | Prisma `Draft` (workspace) via `/api/studio/drafts` | `studio-<32 hex>` | Local + Server | "RockBase" |
| Studio notes written before the server store | this browser's localStorage (`rockbase.studio.drafts`) | `note-…` | any | "This browser" (ochre) + one-time **Move to RockBase** |
| Caption assistant (`sc_drafts`) | this browser's localStorage | — | any | "This browser"; "Copy into RockBase as an editable draft" creates a Studio draft |
| Legacy Content Planner seeds | localStorage | — | any | read-only, link to Compose |

**Studio draft store** (`backend/src/routes/studioDraftRoutes.ts`, wired in `services/StudioRuntime.ts`):

- `GET /api/studio/drafts?workspace_id=` (summaries), `POST /api/studio/drafts`, `GET|PATCH /api/studio/drafts/:id`. Same `Draft` table, no new database or migration.
- Each draft carries title, body, format (`article | social_post | reel`), `brandKey` (validated against the workspace brand registry the UI uses) and a **server-authored** `source` (`blank`, `caption_copy`, `browser_import` with the browser id/created time). The metadata sits behind the same provenance separator as Radar briefs and is re-attached on every PATCH; a body containing the separator is rejected (422).
- Local Mode: loopback local owner + host/origin gate (as Trends). Server Mode: WorkspaceUser membership decides the workspace (Admin is not a bypass; foreign workspaces answer 404), writes need Admin/Operator.
- Moving browser notes is idempotent per workspace + browser id. Originals stay in the browser (hidden from the library, shown as a backup count) until the operator confirms **Remove browser copies**.
- No delete endpoint; archiving is the closing action. The Studio router reads existing Post ids/statuses for reference verification only; it never writes posts, invokes a publisher or queue, or calls Google/AI.

`studio-draft-routes-test.ts`: **139 assertions pass** — namespace, validation 422, cross-workspace 404, Radar rows invisible to Studio, metadata-preserving edit, idempotent parallel move, review state machine, archived lock, Compose handoff, verified post references, local origin 403, Server Mode membership/role gates, import allow-list, word-boundary excerpt.

## Phase 6 — one content workflow, end to end

The journey is now carried by the same store, with no second dashboard, database or content system:

**Opportunity (GSC / Radar / SEO) → Studio → Review → Ready → Compose → Publish → Activity**

- **Review status is real persistence.** Every Studio draft carries `status` (`draft | in_review | ready | archived`) and `statusChangedAt` inside the same provenance block, on the same `Draft` row. No migration, no extra table.
- **The state machine is server-side.** `draft ↔ in_review`, either → `ready`, any → `archived`; `archived` leaves only through Restore (→ `draft`). A move the server refuses is not offered in the UI. `ready` requires a non-empty title and body — a 422 keeps the client honest.
- **A status move includes current edits.** The editor sends `{body, title, status}` in one PATCH when there are unsaved edits, so "Mark ready" saves that submitted text. This is not revision history or concurrent-edit protection. `archived` drafts are read-only (edit and handoff answer 409) until restored; Today excludes archived drafts from "Continue".
- **Handoff is explicit and honest.** `POST /api/studio/drafts/:id/handoff {channel:'compose'}` records "opened in Compose" (channel, timestamp, count) — a navigation fact, not a publication. The editor then opens Compose with `?studioDraftId=…`; Compose shows the draft read-only until the operator presses **Apply to caption editor**.
- **Distribution references are verified, not claimed.** `POST /api/studio/drafts/:id/distribution {post_ids[]}` only stores ids that exist as `Post` rows in the caller's workspace (`findMany`, read-only). If no supplied id matches, it returns 422 and nothing is linked; a mixed batch links only the matching ids and reports their count. A linked Post is a verified distribution reference, not proof of content equality, successful publication, engagement, reach or conversion. Its stored status is a queue/publish snapshot at link time.
- **Handoff to the existing publisher.** No new publisher was added: Compose still queues through `/api/posts/bulk-multi`. After a real submit, Compose asks the Studio store to link the returned post ids in sequential batches of at most 20. A later batch failure can leave earlier references saved; the UI reports incomplete linking without retrying the posting submission. Each draft retains at most the latest 50 references, so the linked count is the processed count, not an all-time retained total.
- **Export stays the article path.** Article briefs download as `.md` with the title as an H1; RockBase still has no CMS connection and says so.
- **Library.** Status tabs with counts (Active = not archived, Draft, In review, Ready, Archived), a status badge per row, format filter and search; archived rows are dashed and excluded by default.

Limitations, stated plainly:

- The distribution endpoint verifies only existence in the workspace's `Post` table; it does not prove content equality or how the post originated. The Compose UI requests this link only after applying a Studio draft and receiving post ids from the existing submit flow, but the caption can be edited before submitting. The endpoint does not verify that UI sequence.
- The list endpoint filters status after a bounded read (200 most recently updated rows per workspace); a workspace with more than 200 drafts could hide an older one from a status tab until it is opened directly.
- No delete endpoint and no multi-user review: `in_review` means "someone is reviewing it" in a single-operator Local Mode; Server Mode still gates writes by membership and role, not by a reviewer assignment.
- Post status stored on a reference is a snapshot from the moment of linking; RockBase does not refresh it or derive engagement/ reach/ conversion from it.

## Incremental plan

- **Done in shell/UI:** IA, tokens, grammars, Today, Radar, Site & Search, Studio, Results, Publish/Setup hubs, Queue trust, AI Writer neutrality, mobile.
- **Done in API:** workspace Studio draft store for blank drafts (see Persistence).
- **Done in API (Phase 6):** review status with real persistence, archive/restore, Compose handoff and verified post references back to the draft (see *Phase 6*).
- **Still open:** a link from an *exported article* back to its brief so Results can show *related* (not attributed) changes — export leaves RockBase, so there is nothing to verify against yet.
- **Deliberately deferred:** social reach/engagement analytics (no real source), any growth score, AI auto-publish, multi-user review (Local Mode is single-operator), route-level code-splitting (bundle is 1.18 MB, mainly legacy Campaigns/Compose).

## Verification

- `npm run build` (tsc + vite) passes. Backend `tsc --noEmit`: 0 errors (same as baseline).
- Backend: `trend-routes-test` 42/42, `niche-history-routes-test` PASS, `niche-runtime-privacy-test` PASS.
  `trend-engine-test` fails in this worktree only on its Python-parser case, which needs the gitignored
  `modules/seo/.venv`. The same suite passes in a worktree that has the venv; no engine code changed.
- Browser review against **synthetic fixtures** (`frontend/scripts/preview-fixtures.mjs`, fictional
  `*.example` brands): desktop 1440 and mobile 390; Local and Server Mode; scenarios `full`, `empty`
  (first run) and `degraded` (registry 503, queue 503, stale GSC); Radar → brief → edit → save round
  trip; unsaved-changes guard; command palette; no external network hosts; no unnamed buttons.
- **Not verified:** live backend, real GSC/Google, real Trends feed, real accounts/sessions/queue, AI provider,
  and Compose/Campaigns flows beyond rendering. Fixture UI is not evidence of live integration.

### Phase 6 acceptance — real backend, isolated data

Run against the real Express backend (Local Mode) on an isolated SQLite database created with
`prisma migrate deploy`, a throwaway SEO brand registry and a throwaway Redis on port 6390
(`RUN_WORKERS_SEPARATELY=true`, so no posting worker ran). No social session, real database,
real queue or Google/AI call was touched.

- Studio → new draft → edit → **Mark ready with unsaved text**: one PATCH saved 313 characters *and*
  set `ready`; `statusChangedAt` recorded.
- Article brief (232 words) → **Send to review**: status `in_review`; server status filter returned
  `in_review: [article]`, `ready: [social]`, `draft: []`, `archived: []`.
- **Archive** → API edit `409 "This draft is archived. Restore it before editing."`, handoff `409`,
  textareas read-only, Continue in Compose disabled, library `Active 0 / Archived 1`, Today's
  Continue list excluded it. **Restore** → `draft`, 232 words intact.
- **Continue in Compose** → handoff recorded (`channel: compose, count: 1`), Compose opened with the
  draft read-only; **Apply to caption editor** filled the 313-character caption; no account, media,
  schedule or publish action was selected.
- **Distribution**: linking `post-acceptance-1` (a `queued` Post row inserted as fixture) returned
  `200 linked: 1`, and the editor rendered it as `queued · just now` with the "not engagement, reach
  or conversion" note; a fabricated id returned `422 nothing was linked`.
- **Export**: `Download .md` produced a Markdown file named from the synthetic article title, starting
  with the H1 and containing the body. Test content is not owner content or material-specification evidence.
- Studio library/editor were captured at desktop 1440 and mobile 390; Compose was captured at desktop
  1440. Captured pages had no console/page errors and `scrollWidth === innerWidth`. Raw screenshots,
  exported content, databases and local QA paths are intentionally excluded from the public change.
- **Still not verified:** a real publish (needs a healthy social session, media and the posting worker),
  so post/activity rows above are fixtures, not publications; multi-workspace isolation in Server Mode
  is covered by route tests, not by this browser run.

### Reproduce the preview

```bash
node frontend/scripts/preview-fixtures.mjs
ROCKBASE_API_TARGET=http://127.0.0.1:3911 VITE_ROCKBASE_MODE=local npx vite --port 5181   # in frontend/
curl -X POST http://127.0.0.1:3911/__fixture/scenario/empty   # or full | degraded
```
