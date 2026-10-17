# Phase 5 — Niche Trend Intelligence acceptance

## Scope and release boundary

Latest main synced at `39c82df9642c3ae903a0ee8ef1796cc024d5e355` (merged Phase 4). Working branch `feat/niche-trend-intelligence-phase5`. Owner accepted Phase 5 and authorized secret scanning, public-evidence sanitization, commit, push and a PR to main. Merge and deployment remain prohibited. Existing `/trends` and Draft/Compose only; no new app, dependency, paid API, automatic Google sync, publication or Social/SEO worker change.

## Implementation

- Full existing GSC `queryPerformance`, not only prefiltered keyword opportunities. Per-brand topic/exclusion watchlists plus transparent configurable minimum current impressions, absolute increase and growth percentage (defaults 3 / 3 / 25%). These filters do not establish statistical significance.
- Comparison evidence includes current/previous periods, impressions, clicks, CTR percentage-point change and average-position improvement. Only finalized web reports with valid adjacent equal-length nonoverlapping periods can qualify. Missing baseline remains unknown; zero baseline has no fabricated growth percentage. GSC impressions are site visibility evidence, not market-wide search volume, causal demand, forecast traffic or public Google Trends growth.
- Private local historical query snapshots, 5,000-row cap, 24 distinct period snapshots per workspace/brand/site/property. Explicit capture reads existing cached report only. Same period/report is immutable/idempotent; recapture is not a new observation. Connection/provider/remapping invalidation purges derived history, including persisted history before the first Trend request after process restart. Server-mode, disconnected and foreign-scope reads are denied.
- Existing RSS source retained unchanged. Rising GSC change, public RSS bucket movement, GSC opportunities and ordinary editorial ideas remain distinct evidence origins. No additional public source is necessary for this slice.
- Existing idempotent Draft storage and manual Compose apply preserved. Private provenance is available in draft preview, not automatically inserted in publishable caption.

## Real pipeline and evidence boundary

Disposable minimal app uses actual Trend runtime dependencies/routes, existing authorized cached GSC projection and an actual official Indonesia RSS refresh. Social Draft writes and SEO registry reads use integrity-checked private backup DBs. Trend watch/history/RSS writes use a separate cloned Trend database. Main application server, publishing and campaign workers are not loaded. Compose account/group empty responses are deliberate safety fixtures, not live account verification. No Google sync is performed.

Owner query/property/report payloads and screenshots are retained **outside Git** in the private acceptance folder. This public-safe document does not include owner query-level metrics.

The real browser run verified measured GSC comparisons, other keyword opportunities and an editorial-only no-report case. Owner-specific brand counts, queries, properties, report periods, metrics and raw responses are intentionally omitted from public evidence.

Public RSS refresh: HTTP 200, 10 feed items. The no-relevant-item state was verified without manufacturing an RSS rising trend. Query evidence comes from the cached report, not today's Google acquisition. Duplicate capture does not become independent historical corroboration. Two source report periods can support a measured comparison, not sustained momentum across collected snapshots. Real repeated historical momentum is not claimed; it requires further genuine nonoverlapping periods.

Browser exercised watchlist threshold save/read-back, cached history capture/repeat without increasing the observation count, source-qualified classification and format filters, dated timeline, three content formats, three parallel same-intent Draft requests per format returning one ID, Compose preview → explicit apply → reload. Captions exclude private provenance. No-report brands receive no invented property or analytics data.

## Verification status

Final integrated verification passed: 8 niche engine test groups; history store, capture routes, GSC endpoint privacy and restart privacy tests; existing Trend engine/regression/routes/projection, GSC analytics/routes and secret-access regression. Backend TypeScript passes. Existing SEO suite: 45 passed, one inherited Starlette/httpx deprecation warning. Frontend normal and Local Mode TypeScript/Vite builds pass, inherited large-chunk warning retained. ESLint was not available in the installed toolchain; no lint-pass claim.

Final desktop 1440×1000 and mobile 390×844 browser rerun against a freshly restarted final-source process passed: zero page/API errors, zero publish requests, document scrollWidth390/viewport390. Verified low-volume baseline labeling, GSC recommendation reasons without RSS bucket attribution, timeline capture deduplication and all three existing-Draft formats. Visual inspection confirmed readable metrics and no horizontal clipping. Original Social/SEO/GSC logical digests unchanged. Dates, negative/inconsistent metrics, non-web history and invalid/missing comparisons cannot establish rising evidence; invalid deltas remain null. Captured history does not claim repeated corroboration from overlapping periods.

## Remaining boundaries

Low-volume increases do not prove significance. GSC omissions/privacy filters mean absent previous queries are unknown, not zero. Existing cached data is delayed; no automatic refresh. Public RSS has no current niche match. Historical retention and positive-pattern rules are fixture-tested; real multi-period captured momentum is not claimed. Existing Compose mobile header overflow is outside Phase 5, not redesigned.
