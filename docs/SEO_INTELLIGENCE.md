# RockBase — SEO Intelligence, Phase 1

## Product and implementation
SEO is a native `/seo` route inside RockBase's existing React shell. It does not have a second dashboard. Navigation, API client, Local Mode and Server Mode authentication remain in use. Existing social routes, session storage, publishing services and queue definitions are unchanged.

Branch: `feat/seo-intelligence-phase1`, based on `d386b6fa4bc5042b08998e5e4d787513e51fab00`. No commit or push is included in this task. Original untracked Android work is not part of SEO.

## Architecture and local storage
- Existing Express API on `127.0.0.1:3010`, Vite UI on `127.0.0.1:5173/seo`.
- `/api/seo` is mounted **after existing authentication**. Server Mode restricts workspaces by existing membership (Admin retains administrative scope); writes require Admin/Operator. Local Mode adds Host/Origin checks.
- Python `modules/seo/seo_engine` uses Crawlee `BasicCrawler` as the scheduler with an HTTPX transport that preserves HTTP error responses and controls each redirect. All network operations, including Playwright resource reads, pass through the same public-IP/robots/rate policy.
- The private Python coordinator starts lazily when SEO is accessed, binds only `127.0.0.1:8765`, and requires a random ephemeral IPC token. It serves no dashboard. Scan jobs run in separate processes so crawling cannot block Express or consume the publishing queue. One scan can be active globally.
- SEO snapshots: `rockbase-data/seo/seo.sqlite`, separate from social `backend/prisma/dev.db`. WAL, immutable completed scan snapshots, partial crash recovery. No Prisma migration, reset or key rotation.
- Workspace identity is reused by ID; existing `SocialAccount.brandTag` values appear as available brands. New websites select one existing workspace and optional brand. No forced rename, invented brand mappings, social account migration or hardcoded account IDs. Magrade was manually registered locally as the pilot, not shipped as every user's data.
- The Python process receives only minimal OS runtime variables and its own DB/IPC values, never social encryption/API environment variables. Browser context is temporary and has no saved social cookies.

## Start again — existing installation
1. Once, run `modules\seo\SETUP_SEO.bat` (uv + Python 3.12, dependencies pinned by uv.lock, installs Chromium).
2. Start RockBase using its existing `START_ROCKBASE.bat`, then open `http://127.0.0.1:5173/seo`. **Existing launcher runs its normal Prisma deploy step**; this SEO change does not introduce any migration. If the existing install must stay completely migration-free, use the explicit manual commands below instead.
3. Add your own website and choose workspace/brand. Start Scan. Default Auto uses HTTP first, and a bounded Playwright render only for detected JavaScript shells. Browser mode is explicit.
4. Existing `STOP_ROCKBASE.bat` triggers graceful backend shutdown; SEO coordinator is also stopped. Never delete the social `.env`, database or encryption key.

Migration-free manual commands from the repository, with existing Node dependencies/configuration and a running local Redis already available:

```powershell
# Terminal 1
cd backend
$env:ROCKBASE_MODE='local'
$env:PORT='3010'
$env:FRONTEND_URL='http://127.0.0.1:5173'
$env:RUN_WORKERS_SEPARATELY='true'
# Disable real social side effects for inspection. This changes only this process environment.
$env:AUTOMATION_ENABLED='false'
node -r ts-node/register/transpile-only src/server.ts

# Terminal 2
cd frontend
$env:VITE_ROCKBASE_MODE='local'
npm run dev -- --host 127.0.0.1 --strictPort
```

Do not point this installation at another installation's Redis, DB or credentials. Each checkout/install owns its local configuration, persistent queue and runtime data. Port 8765 conflict fails closed; it never kills a foreign process.

### Reopen the exact non-publishing preview used for this implementation

The current smoke preview deliberately leaves the owner's stopped persistent Redis container untouched. With Docker Desktop running, use the already-created disposable QA Redis (no social jobs):

```powershell
docker start rockbase-seo-qa-redis
# From the RockBase repository, Terminal 1:
node modules/seo/start_verification_backend.cjs
# Terminal 2:
cd frontend
$env:VITE_ROCKBASE_MODE='local'
npm run dev -- --host 127.0.0.1 --strictPort
```

Open the same RockBase `http://127.0.0.1:5173/seo`. This is the full existing app with social side effects disabled **only for this preview process**, not a second product/dashboard. Do not run this alongside an existing listener on 3010/5173; the commands never take over another process. Stop through `STOP_ROCKBASE.bat` (or the loopback shutdown endpoint), close the preview frontend terminal, then `docker stop rockbase-seo-qa-redis`. Do not remove/clear the owner's `rockbase-redis` or touch other Redis services.

## Capabilities
Start scan (1–100 URLs), HTTP/Auto/Browser, progress polling, history, URL/status/title/description/H1/canonical/robots/redirect/link inspection, deterministic issue priorities and recommendations, search/priority/status filters, authenticated CSV and JSON export matching the filters, previous completed scan comparison. CSV neutralizes spreadsheet formulas. Crawl cap is enforced at URL admission rather than Crawlee's potentially overshooting concurrent completion limit.

Rules: missing metadata, missing/multiple H1, canonical signals, noindex meta/header, duplicate titles (distinct final successful HTML pages only), HTTP errors, fetch failures, redirect advice, broken links only when target was actually observed returning an HTTP error. Indexable potential is not actual Google indexing evidence.

## Verification evidence (local, ignored)
`rockbase-data/seo/evidence/` holds screenshots, browser-qa.json, CSV/JSON exports, baseline and preservation comparison. It also holds a sensitive local recovery backup; never publish this folder.
- Focused fixture tests run only against temporary databases and injected HTTP fixtures, never mixed into real scan results.
- Browser QA uses real RockBase APIs, starts the pilot through the UI, verifies filters/exports/recommendation/history persistence and read-only social navigation. No intercepted/faked application responses.
- Magrade's live robots endpoint returned HTTP 403 during the final pilot attempt. The scan truthfully records FAILED, 0 audited pages, and one high crawl-access issue. It did not bypass protection or invent metadata findings. A full successful pilot crawl and actual site-level SEO findings remain unverified until owner-permitted HTTP access is available.
- An earlier failed attempt exposed and fixed compressed-body double decoding; its historical failed record is retained, not rewritten as success.

## Crawl and privacy boundaries
Same origin, public HTTP(S) on 80/443, no URL userinfo, no common credential query parameters, no proxy inheritance, connection-time DNS public-IP pinning, manual redirect validation, 2 MB decoded response ceiling, at most 5 sitemap documents. Minimum 1.1 seconds between requests, longer robots crawl-delay honored. No retry/evasion for protections; HTTP 429 halts further fetching. No login or consent bypass. JS mode blocks third-party/non-GET/unnecessary assets and uses an isolated browser context; some complex applications intentionally remain partially rendered. Browser assets are additional requests, not additional audited-page slots, all rate controlled.

Source pages can contain arbitrary private-looking text; audit/export only public websites you are authorized to inspect. Results and reports stay local unless the operator explicitly exports/shares them. No telemetry, SaaS, GSC or AI invocation is added by SEO.

## Open-source release gate
See `SEO_SECURITY_RELEASE_GATE.md`. Do not push/release while unresolved blockers remain. Audit current/staged files plus reachable Git history, defaults and API/log exposure; ignored local data must stay excluded. Never silently rotate existing keys or rewrite history. User-directed incident response is separate.

Future GSC contract (NOT implemented here): OAuth Desktop application + PKCE S256 + random state, loopback redirect, only `https://www.googleapis.com/auth/webmasters.readonly`, OS-protected per-install tokens via Windows Credential Manager or DPAPI (CurrentUser). No refresh/access token in Git, localStorage, logs, URLs or exported reports. No hardcoded user credentials. Desktop client identity is not a user secret and must follow provider requirements. REA is out of scope and will be installed/tested in a separate Hermes session.
