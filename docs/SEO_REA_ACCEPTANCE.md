# SEO REA improvements — local acceptance

Branch: `feat/seo-rea-improvements`. Starting/remaining HEAD: `d39244ee793f36ff81b55887d06d1d804318795d`. No commit, staging, push, merge or deploy.

## Implemented

1. **Observed link graph/depth** — bounded typed occurrence capture, unique and followed source counts, original anchor/rel evidence, redirect/canonical/sitemap relation separation, deterministic shortest HTML path and histogram. Additive `scan_graphs` in SEO SQLite only; historical snapshots without occurrence data remain explicitly unavailable.
2. **Target-aware integrity** — canonical to error/noindex/blocked/redirect/unobserved targets, conflict/cycle detection, normal self-canonical termination, separate raw first/final statuses, observed redirect hop preservation through policy/network failure, original duplicate-description rule. Intentional noindex and cross-URL consolidation remain review signals.
3. **Grouped actions** — category, severity, issue type, confidence, original explanation/checklist, eligible observed population, affected URL drilldown and deterministic ordering. Filtered CSV/JSON source→target status evidence; formula-injection safeguards retained.

Source contract: `docs/SEO_REA_IMPLEMENTATION.md`. No new dependencies or lockfile changes. GSC components/provider credentials, social queues and RockDroid were not changed.

## Executed gates

- SEO suite: `modules/seo/.venv/Scripts/python.exe -m pytest modules/seo/tests -q --basetemp=<Hermes scratch>` → **45 passed**, 1 existing Starlette/httpx deprecation warning.
- Ruff: `modules/seo/.venv/Scripts/python.exe -m ruff check modules/seo/seo_engine modules/seo/tests` → **All checks passed**.
- Express SEO analysis adapter: `node node_modules/ts-node/dist/bin.js --files src/scripts/seo-analysis-routes-test.ts` → **40 assertions PASS** (auth/scope/allowlists/download/local-origin; synthetic registry and IPC).
- Backend: `node node_modules/typescript/bin/tsc --noEmit --pretty false` → **PASS**.
- GSC routes and analytics scripts → **PASS**, fixture-only, no live Google calls.
- Frontend `npm run build` → **PASS**, TypeScript + Vite, 1,913 modules. Existing >500 kB bundle warning remains.
- `git diff --check` → **PASS**.

## Integrated browser evidence

Browser used the actual `/seo` React page, actual Express auth/SEO router and actual FastAPI/SQLite read paths. Synthetic identity registry and disconnected GSC status were supplied by a disposable harness; page/action API responses were not mocked. Crawlee used HTTPX MockTransport against the versioned owned static fixture, not a live/public crawl. No production data, Google indexing, Google permissions or publishing functionality is claimed verified.

- 19 persisted URL records; `/catalog/` **14 hyperlink occurrences / 13 unique sources**, deepest specification **depth 4**.
- Sitemap-only URL remains depth unknown; canonical relations do not fabricate an HTML path.
- 301→302→200 remains visible, canonical→404 distinguishes known failure from valid consolidation; duplicate description affects two final documents.
- Desktop **1440×1000**, mobile **390×844** (existing sidebar collapsed). Document scroll width equals mobile viewport, **390**.
- Search, depth filter, URL inspector, grouped priority rationale/fix steps, category/confidence/type filters, history legacy fallback and reload **PASS**.
- Browser downloaded Links JSON, Groups JSON and Actions CSV; read back and parsed. Combined metadata/observed/opportunity filters produced **4 groups / 6 CSV rows**, all within selected scope.
- **0 page errors, 0 failed API responses, 0 API writes** during browser acceptance. Harness never loaded publishing queues or Google credential providers.
- Task-owned servers stopped; ports **18312 and 18313 closed**, independently probed.

## Limits

Graph/coverage describe this bounded observed scan, not whole-site orphan proof or Google indexing. Capture budgets: 5,000 edges per page, 50,000 per scan with explicit truncation notes. Legacy scans need a new crawl for occurrence metrics; no old evidence is fabricated or rewritten. Existing Vite bundle-size and Starlette test-client warnings are not addressed by unrelated dependency changes. No live owner-site scan was needed or performed.

## Evidence files

`browser-acceptance.json`, downloaded `links-browser.json`, `groups-browser.json`, `actions-browser.csv`; desktop/mobile screenshots; disposable QA SQLite retained outside repository. Reproducible fixture and regression tests are in `modules/seo/tests/`. All evidence is synthetic fixture data, not owner metrics.
