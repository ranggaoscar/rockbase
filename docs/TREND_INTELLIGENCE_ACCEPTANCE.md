# Phase 4 Trend Intelligence — local acceptance

## Base / boundaries

`main` synchronized by fast-forward to `7821eeace53dc3961c44e24ac16e41f7da3fd919` (merged PR #5); implementation branch `feat/trend-intelligence-phase4` starts at that main. This document records the pre-release acceptance checkpoint. Owner subsequently authorized secret scan, commit, push and PR; merge/deployment remain excluded. No paid inference, Google sync, publishing job or scheduled background pipeline was performed.

## Implemented

1. Official Google Trends Trending Now RSS Indonesia, fixed HTTPS URL, explicit manual refresh with 15-minute persisted cooldown, bounded timeout/body/items and defusedxml parser; dated immutable local snapshots and honest unavailable status/last-success timestamp. No article or image scraping.
2. Workspace-scoped topic/exclusion watchlists for Magrade, Brescia Stone and Global Stone. Existing SEO identities reused; absent owner-requested watchlist identity is configuration only, not a fake social account, website or GSC property.
3. Topic/news-phrase relevance with source field and matched terms; individual headline boundaries preserved. Raw approximate traffic text and lower-bound bucket retained. Rising requires distinct dated observations at least 15 minutes apart, same topic and valid publication cycle, and positive numeric bucket movement. No percentage growth, invented trend index or popularity score.
4. Separate `rising_trend`, `trend_observation`, `gsc_opportunity`, `content_idea` classifications. Existing GSC cached report projection is local-owner/connection-gated and matched to actual workspace/brand/website/property. No new Google request is needed.
5. Original deterministic article/Reel/social-post briefs with reason and evidence; filters and visible metric/date/source details. These are editorial recommendations, not ready-to-publish facts or a CMS integration.
6. Existing Prisma `Draft` upsert with deterministic workspace/brand/recommendation identity. Compose preview→explicit Apply only; no account/media/schedule selected. Private evidence remains in draft provenance and is excluded from the publishable caption editor.

## Real-data observations

Actual application refresh called `https://trends.google.com/trending/rss?geo=ID` and stored HTTP **200**, **10** items. Two dated observations retained during work:

- `4a3ce8423a6aa23154bf1e7ca789ced4`, fetched **2026-10-17T07:15:34.182Z**.
- `ec952421b0196e02b78363b46776683e`, fetched **2026-10-17T07:33:36.548Z** (latest acceptance).

For the three default stone watchlists, both successful feeds yielded **zero relevant RSS items**, hence **zero live verified rising trends**. This is displayed honestly. Synthetic tests establish growth-rule behavior; they are not evidence of an actual rising stone topic.

Existing cached GSC reports were consumed without sync or credential changes. Matching opportunities and unsupported-brand empty states were verified against private read-back evidence. Individual properties remained distinct. Exact operator query strings, metrics, report periods, property identifiers and derived counts are deliberately omitted from this public repository document; they remain in the private acceptance artifacts and owner report. GSC opportunities were not labeled public rising trends.

## Executed verification

- `trend-engine-test.ts`: **7 focused test groups PASS** (matching/exclusions, honest observation vs measured rise, deterministic briefs, GSC provenance, bounded scoped immutable SQLite, parser malformed/XXE, fixed/bounded RSS failure outcome).
- `trend-regression-test.ts`: **PASS** for unknown publication cycle, literal/Unicode phrase boundaries, single-headline vs cross-source false match, traffic comma/K/M parsing, exclusion-respecting fallback, and first-install private directories. Single-headline reviewer finding reproduced RED then fixed GREEN.
- `trend-routes-test.ts`: **25 assertions PASS** — local/no-store/Host/Origin/workspace/brand, validation, cooldown/parallel refresh, same-intent Draft, no queue/post calls.
- `trend-gsc-projection-test.ts`: **PASS** — actual scope/property matching, low-volume evidence, disconnected cache no-read and Server Mode vault no-read, zero Google requests.
- Existing GSC routes and analytics tests: **PASS**. Fixed date-dependent pagination fixture keys to use the report's actual current start date; production GSC metric algorithm unchanged.
- Existing SEO suite: **45 passed**, one inherited Starlette/httpx test-client deprecation warning.
- Backend TypeScript `tsc --noEmit`: **PASS**.
- Frontend `npm run build` (TypeScript + Vite): **PASS**, 1,915 modules; inherited >500 kB chunk warning remains.
- `git diff --check`: **PASS** (Git line-ending notices are not failures).

## Real end-to-end browser acceptance

Actual React page→authenticated local Express Trend routes→real Trend runtime and persisted private snapshots→existing GSC cached read projection→Prisma Draft in a private consistent backup of the social DB→Compose. Browser audit API responses are not mocked. Private SEO clone supplies the genuine website registry; original installation GSC connection/cache is read, never reconfigured. Main application/publishing workers were not started. Compose account/group reads are isolated empty fixtures so no stored social sessions or transport can run.

- Native `/trends`, real three-brand selectors, watchlist save/read-back, visible RSS HTTP/source/time, classification counts and explicit no-relevant-RSS state: **PASS**.
- Actual GSC numbers/periods and separate low-volume label; classification/format filtering, zero rising empty state: **PASS**.
- Article, Reel, social-post Draft creation and repeated-intent ID stability: **PASS**. Three concurrent requests returned one identical Draft ID.
- Compose preview starts with empty editor; explicit Apply fills brief only (no GSC metrics/provenance in caption); reload reopens persisted draft without auto-apply: **PASS**.
- Browser: **0 page errors, 0 failed API responses, 0 publish/queue requests**. Only explicit refresh/watchlist/draft operations were permitted.
- Desktop **1440×1000**, Trend Radar mobile **390×844**: document width **390/390**, controls and evidence inspected visually. Existing sidebar collapsed for narrow QA.
- Existing Compose mobile header has **418 px document width at 390 px viewport** (28 px overflow from legacy Broadcast/Assign mode header). Trend Draft preview/Apply card remains within view and usable; global Compose redesign deliberately excluded. This is a retained limitation, not a claimed full mobile Compose pass.

## Data preservation / artifacts

Read-only SQLite backups verified with `PRAGMA integrity_check`. Original Social (20 tables), SEO and GSC table counts+logical digests compared before/after: **zero changed original tables**. Three acceptance Draft rows reside only in cloned social SQLite; real trend snapshots/watchlist settings reside in the per-user installation trend store. No customer sessions/credentials/queues were copied into Git or delivered evidence.

Private acceptance artifacts under Hermes scratch `trend-phase4-acceptance`: radar JSON readbacks, browser acceptance JSON, preservation digests and screenshots. Raw database backups and full private report JSON are not public repository artifacts. No live rising/niche result is manufactured to satisfy the demo.
