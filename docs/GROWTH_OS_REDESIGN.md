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

| Draft source | Stored in | Shown as |
|---|---|---|
| Radar briefs | Prisma `Draft` (workspace) | "RockBase" |
| Studio blank drafts, Caption assistant | this browser's localStorage | "This browser" (ochre), with export |
| Legacy Content Planner seeds | localStorage | read-only, link to Compose |

**Not yet unified.** A server-side store for blank drafts is the next API step.

## Incremental plan

- **Done in shell/UI:** IA, tokens, grammars, Today, Radar, Site & Search, Studio, Results, Publish/Setup hubs, Queue trust, AI Writer neutrality, mobile.
- **Needs persistence/API next:** a general workspace draft store (POST/PATCH for blank drafts, with a brand key); draft status (draft/in review/ready) with real persistence; a link from a published post or exported article back to its brief so Results can show *related* (not attributed) changes.
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

### Reproduce the preview

```bash
node frontend/scripts/preview-fixtures.mjs
ROCKBASE_API_TARGET=http://127.0.0.1:3911 VITE_ROCKBASE_MODE=local npx vite --port 5181   # in frontend/
curl -X POST http://127.0.0.1:3911/__fixture/scenario/empty   # or full | degraded
```
