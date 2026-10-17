# ROCK BASE

> **Open-source, local-first Digital Growth OS.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Local-first](https://img.shields.io/badge/Local--first-0B7285)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Self-hosted](https://img.shields.io/badge/Self--hosted-111827)
![Windows Local Mode](https://img.shields.io/badge/Windows-Local%20Mode-0078D4?logo=windows&logoColor=white)
![Docker Server Mode](https://img.shields.io/badge/Docker-Server%20Mode-2496ED?logo=docker&logoColor=white)
![Status: Alpha](https://img.shields.io/badge/Status-Alpha-F59E0B)

RockBase is an open-source, local-first **Digital Growth OS**. It runs on your own computer — or on your own server — and keeps five connected growth surfaces inside one workspace:

| Surface | Where | What it answers |
|---|---|---|
| **SEO Intelligence** | `/seo` | Is the site technically sound, and what should be fixed first? |
| **Google Search Console Intelligence** | SEO Intelligence → Google Search Console | What is Google actually reporting for my properties? |
| **Trend Radar** | `/trends` | What is moving in the market right now, and on what evidence? |
| **Content Drafts** | Trend Radar → `/compose` | What should be published, and where did that idea come from? |
| **Social Media Operations** | `/accounts`, `/farm`, `/campaigns`, `/queue`, `/activity` | Getting approved content out through owned accounts, safely and unhurried. |

Those five surfaces are not separate products stitched together. They share one local database layer, one operator shell, and one evidence trail: what Trend Radar and Search Console find becomes the reason a draft exists, and what a draft says is what the publishing queue eventually executes.

RockBase also still carries the multi-account social operator surface it started from: reusable browser sessions, campaign targeting, paced queued publishing, session recovery, and an activity history. That layer is Alpha-grade and documented honestly below — including what does **not** work yet.

Everything is local-first. There is no SaaS account to create, no vendor workspace holding your crawl results or Search Console data, and no product telemetry. Your growth data stays in local SQLite files on your machine or your server.

## The integrated growth loop

```text
Trend Radar  →  SEO Intelligence  →  GSC Intelligence  →  Content Drafts  →  Compose  →  Campaigns  →  Queue  →  Publish  →  Activity  →  Session recovery
 discover        audit                 measure              plan              prepare     target        pace      ship        monitor       keep accounts healthy
   RSS +           crawl +               Google               evidence-         draft →     account       paced     Playwright     audit         human login /
   watchlists      issue rules           Search Console       linked draft      editor      groups        execution browser drive   trail         2FA / challenge
```

Evidence flows forward, never backwards. Trend Radar produces classified candidates with reasons; SEO Intelligence produces prioritized technical findings; Search Console Intelligence produces real Google metrics for your own properties; Content Drafts converts a candidate into a draft that keeps its provenance; Compose shows that provenance and waits for the operator to apply it. Nothing in this loop publishes on its own.

## Available today

### 1. SEO Intelligence

A native `/seo` route inside the existing RockBase shell — not a second dashboard.

- **Crawl scope:** 1–100 URLs per scan, from a website you register locally.
- **Crawl modes:** `Auto` (HTTP first, bounded browser render only for detected JavaScript shells), `HTTP` (explicit), `Browser` (explicit).
- **Per-page inspection:** URL, HTTP status, title, meta description, H1, canonical, robots directives, redirects, and links.
- **Findings:** deterministic issue priorities and recommendations for missing metadata, missing or multiple H1, canonical signals, `noindex` (meta and header), duplicate titles across distinct final pages, HTTP errors, fetch failures, redirect advice, and broken internal links — the last only when the destination was actually fetched and returned an HTTP error.
- **Link graph and integrity:** observed link graph, integrity diagnostics, and an action queue for repairs.
- **Operator workflow:** search / priority / status filters, comparison against the previous completed scan, immutable completed scan snapshots, and authenticated CSV + JSON export that matches the filters currently on screen. CSV cells are neutralized against spreadsheet formula injection.
- **Crawl policy:** same-origin public HTTP(S) on ports 80/443 only, refuses non-public IP addresses, validates every redirect manually, honors `robots.txt` (including longer crawl-delay), minimum ~1.1 s between requests with concurrency capped at 2, a 2 MB decoded response ceiling, and halts fetching on HTTP 429. No login, consent, or protection-bypass behavior, and no evasion retries.
- **Storage:** results live in `rockbase-data/seo/seo.sqlite`, separate from the social database. The crawler runs in its own local Python coordinator bound to `127.0.0.1:8765`, started on demand, with no dashboard and none of your social secrets in its environment.
- **Honesty rules the product actually enforces:** a blocked crawl is recorded as `FAILED` with a crawl-access issue rather than inventing metadata findings, "indexable potential" is not presented as proof of Google indexing, and a scan with missing coverage is never described as a deletion.

### 2. Google Search Console Intelligence

Inside SEO Intelligence, an owner-approved connection to your own Google Search Console data. Read-only, local, and off by default until you connect.

- **Two connection paths:** a **Desktop OAuth client** (authorization code + PKCE `S256`, random state, one-use random-port `127.0.0.1` callback, requesting only `https://www.googleapis.com/auth/webmasters.readonly`, consent in a real browser window and never an embedded WebView), or an **existing authorized service account** whose JSON stays outside the RockBase repository.
- **Credential storage:** per-install secrets go to **Windows Credential Manager** through a narrow standard-library bridge — scoped by Windows account plus install-root hash. Tokens are never written to Git, browser `localStorage`, logs, URLs, or exported reports. Service-account access tokens live in process memory only, and no owner key or token is shipped in the open-source repository.
- **Property mapping:** pick a property Google returns for your account, map it to an existing RockBase website/workspace, and the brand comes from that website record — never from an arbitrary client-supplied value. A domain property must cover its hostname; a URL-prefix property must cover its origin/path.
- **Reports:** 7-day and 28-day windows with a non-overlapping previous period, clicks, impressions, CTR (derived from clicks ÷ impressions, with percentage-point deltas), and API position. Property totals stay independent per property and are never summed back out of detailed rows.
- **Crawl join:** Page Performance rows are joined read-only to the crawler's exact URLs, so you can see which observed pages earn impressions. Missing crawl coverage is not evidence of deletion, and Search Console data is not presented as proof of crawl coverage or indexing.
- **Honest limits:** pagination is bounded with truncation surfaced, quotas and 429/5xx responses are classified explicitly, and the last returned data date is shown as-is instead of being claimed as "fresh".
- **Sync is explicit:** there is no forced or background Google sync. You choose a window and click sync; cached results stay labelled.
- **Mode boundary:** this surface is **Local Mode only**. In Server Mode every Google connection and data endpoint is disabled — including for Admin — and cached data is not read.

### 3. Trend Radar

A native `/trends` route for trend research that shows its evidence instead of asserting a vibe.

- **Fixed public source:** Google Trends "Trending Now" RSS for Indonesia (`geo=ID`). One bounded request — size, timeout and redirects controlled, parsed with `defusedxml` and no external entities, no article or image fetching, no paid AI call.
- **Brand watchlists:** per workspace and brand, with topic phrases plus include/exclude phrases. Watchlists are configuration identities; they do not create social accounts, websites, or Google properties.
- **Classification with explicit evidence labels:**
  - `rising trend` — same topic and publication cycle present in at least two dated snapshots ≥15 minutes apart with a positive numeric lower-bound traffic increase. Shown as approximate bucket movement, never as exact search growth or a normalized Trend index.
  - `trend observation` — present in the feed but not measurable yet. First-seen is not "rising", and this is never marketed as verified growth.
  - `GSC opportunity` — a real keyword change from your own connected, cached Search Console reports for the exact workspace/website/brand mapping, with period, metrics, confidence and sync time carried through.
  - `editorial idea` — a watchlist idea with no external trend evidence, labelled as such.
- **Deterministic briefs:** each candidate yields up to three briefs — `article`, `reel`, `social_post` — with title, hook, outline, CTA, reason and evidence. No stock, price, availability or technical facts are invented.
- **Storage and hygiene:** immutable snapshots in a per-installation private SQLite file, a 15-minute refresh cooldown, last-good data kept and explicitly labelled stale when a refresh fails, and no automatic polling.
- **Mode boundary:** Trend Radar is **Local Mode only**; Server Mode refuses trend endpoints before reading any local data.

### 4. Content Drafts

The bridge from research to publishing, deliberately manual at the last step.

- Creating a draft from a Trend Radar recommendation produces an **idempotent, workspace-scoped draft record** — repeated or replayed requests return the same draft instead of duplicating it. Drafts are not posts, not campaigns, and never enter the publishing queue.
- The draft carries its provenance (classification, matched phrases, momentum bounds, source timestamps, GSC period). Compose loads a draft **read-only** with that provenance visible.
- Nothing is auto-filled: no accounts, no media, no schedule. Applying the draft to the editor is an explicit click, and the provenance section is stripped before the caption becomes publishable.
- Existing campaign and planner draft flows are untouched by this path.

### 5. Social Media Operations

The operator surface for actually running owned accounts.

| Area | What it does | Maturity |
|---|---|---|
| Accounts | Account identities, groups, platform/status fields, brand tags, session-health visibility | Core |
| Farm View / Sessions | Interactive local browser per account, **human** login / 2FA / challenge handling, Control + screenshots, Save Session, encrypted cookie persistence | Core |
| Campaigns | Campaign intent and content, account- or group-targeted distribution | Core |
| Compose & Post | Single or smaller publishing operations with content preparation | Core |
| Queue | `Queued → Running → Delayed → Completed`, with needs-attention and failed states | Core |
| Activity | Campaign, publishing and session operational history | Core |
| Execution reliability | Account locks, posting budgets, durable idempotency, paced human-like timing, Redis fail-closed behavior, ambiguous-delivery protection, restart reconciliation | Core |
| Backup / recovery | SQLite backup, checksums, integrity validation | Core |
| Engagement | Optional targeted engagement tooling with daily safety limits | Advanced / optional |
| Warming | Optional account-warming tooling | Advanced / optional |
| Proxies | Optional runtime configuration | Advanced / optional |
| AI Writer | Optional local drafting assistance; external agents remain the preferred content layer | Advanced / optional |

Social platform login, 2FA, and any checkpoint or challenge remain human work. RockBase does not bypass them.

## Not part of this build yet

These panels exist in the shell but are intentionally gated behind an "Advanced / Experimental — not part of the operator workflow" state in this Alpha, because they do not yet provide a verified production workflow:

- **Analytics** — not a trustworthy product-performance source yet
- **Content Planner** — retained for future evaluation
- **Campaign Engine** — retained for future evaluation
- **Standalone Scheduler page** — delayed queue timing is managed through Compose/Queue instead

Use Accounts, Sessions, Campaigns, Queue and Activity for normal campaign operations.

## Roadmap

Planned or exploratory work that is **not implemented** in this build. Nothing here is a release commitment, and none of it is available in the product today.

- **Competitor Intelligence** — extend SEO Intelligence and Search Console evidence with competitor-site comparison, so findings can be read against a market context instead of only against your own properties.
- Activating/completing the advanced panels listed above once they have verified workflows.
- Richer scheduler recurrence beyond current delayed-queue timing.

## Quick start

### Windows Local Mode — easiest

Best for one Windows operator on one workstation.

```bat
git clone https://github.com/ranggaoscar/rockbase.git
cd rockbase
START_ROCKBASE.bat
```

Open:

```text
http://127.0.0.1:5173
```

No RockBase login is required in Local Mode.

Then go to:

```text
Accounts → Farm View / Sessions → log in to a social account manually → Save Session
```

Local Mode prepares the native Node, Redis, Prisma, and Playwright runtime when needed. It is localhost-only and is not intended for LAN, phone, VPS, or public-hostname access.

**Enable SEO Intelligence and Trend Radar (one-time):** these two surfaces use a local Python engine. Install `uv` from <https://docs.astral.sh/uv/>, then run:

```bat
modules\seo\SETUP_SEO.bat
```

That creates the pinned Python 3.12 environment and installs the module's Chromium build. Skip it if you only want Social Media Operations. Google Search Console additionally needs your own Google Cloud Desktop OAuth client or an existing authorized service account — see [docs/GSC_INTELLIGENCE.md](docs/GSC_INTELLIGENCE.md).

### Server Mode — Docker

Best for teams, VPS deployments, and network-accessible installations.

```powershell
git clone https://github.com/ranggaoscar/rockbase.git
cd rockbase
powershell -ExecutionPolicy Bypass -File .\setup-rockbase.ps1
```

Then open:

```text
http://localhost:5173
```

Server Mode uses authenticated RockBase access. On a fresh installation, the setup flow prints a generated first administrator credential. For an existing installation, follow the dedicated [upgrade guide](docs/UPGRADE.md) instead of first-install steps.

> In Server Mode, **SEO Intelligence scanning works**, but **Trend Radar and Google Search Console Intelligence are disabled** — they are local-operator surfaces by design.

## How to use RockBase

### 1. Start RockBase

- **Local Mode:** run `START_ROCKBASE.bat`
- **Server Mode:** use Docker with `setup-rockbase.ps1`

### 2. Add accounts

Open **Accounts** to add and organize account identities, platforms, status, and groups.

### 3. Open Sessions

Open **Farm View / Sessions**, choose an account, then:

1. open its browser session
2. log in to Instagram or TikTok manually
3. complete verification or 2FA when required
4. choose **Save Session**

RockBase login and social-platform login are separate. Local Mode removes the RockBase dashboard login only; social account login remains human-controlled.

### 4. Audit a site (SEO Intelligence)

Open **SEO Intelligence**, add the website you own or are authorized to inspect, select a workspace and optional brand, choose a crawl mode, and start a scan of up to 100 URLs. Review prioritized issues, recommendations, the link graph, and the action queue; filter by priority or status; export CSV/JSON if you need the raw evidence. Rescan later and compare against the previous completed scan.

### 5. Connect Google (optional, Local Mode)

Inside SEO Intelligence, open the Google Search Console panel, save your own Google credentials locally, connect the account that actually has property access, map a returned property to a RockBase website, choose 7 or 28 days, and sync. Disconnect removes the local tokens and derived mapping/cache.

### 6. Watch the market (Trend Radar)

Open **Trend Radar**, pick a workspace and brand, edit the watchlist topics and include/exclude phrases, and refresh explicitly (15-minute cooldown). Read each candidate with its evidence label, then create a draft from a recommendation.

### 7. Draft and prepare content

The draft opens in **Compose** with its provenance visible. Edit it, apply it to the editor, then prepare the publishing work:

- content and caption
- target accounts or account groups
- execution intent

### 8. Monitor the queue

Use **Queue** to follow operational states:

```text
Queued → Running → Delayed → Completed
                    ↘ Needs attention / Failed
```

### 9. Resolve account attention

When a session needs attention, open it again in **Farm View / Sessions**, reconnect or complete verification, then save the refreshed session.

### 10. Review activity

**Activity** provides campaign, publishing, and session operational history across all of the above.

## Local Mode vs Server Mode

| | Local Mode | Server Mode |
|---|---|---|
| Best for | One Windows operator | Team, VPS, or network deployment |
| Start | `START_ROCKBASE.bat` | Docker Compose / `setup-rockbase.ps1` |
| RockBase dashboard login | No (loopback requests only) | Yes (JWT) |
| Network | `localhost` only | Server deployment |
| URL | `http://127.0.0.1:5173` | Deployment URL; fresh Docker defaults to `http://localhost:5173` |
| Runtime | Native Node + Redis + Playwright prepared by launcher | Docker services |
| Social Media Operations | Yes | Yes |
| SEO Intelligence | Yes | Yes (workspace access by membership; writing requires Admin/Operator) |
| Trend Radar | Yes | No — disabled by design |
| Google Search Console Intelligence | Yes | No — disabled by design, including for Admin |
| Data | Local repository/runtime paths | Persistent Docker volumes |
| Recommended for | Personal workstation / campaign operator | Shared team environment |

## Where RockBase stores data

### Local Mode

| Data | Location |
|---|---|
| SQLite database (accounts, campaigns, posts, activity, encrypted session blobs, drafts) | `backend/prisma/dev.db` |
| Configuration and encryption key | `backend/.env` |
| Uploads | `backend/uploads/` |
| Backups | `backend/backups/` |
| Logs | `backend/logs/` |
| Redis runtime data | `rockbase-data/redis/` |
| SEO scan results | `rockbase-data/seo/seo.sqlite` |
| Google Search Console derived cache and mapping | per-Windows-account path under `%LOCALAPPDATA%`, keyed to the install root |
| Trend Radar watchlists and snapshots | per-installation private SQLite under `%LOCALAPPDATA%\RockBase\installations\<install-hash>\` |

### Server Mode

| Persistent volume | Purpose |
|---|---|
| `backend-db` | SQLite database, accounts, and encrypted saved sessions |
| `backend-uploads` | Uploaded/campaign media |
| `backend-backups` | Verified SQLite backup snapshots |
| `backend-logs` | Runtime logs |
| `redis-data` | Redis/BullMQ persistent state |

Social account sessions are currently stored as encrypted cookie data.

> **Recovery-critical:** a database backup without the original `ENCRYPTION_KEY` is not sufficient to recover encrypted account sessions. Preserve the database and the original key together. Do not print, expose, rotate, or replace saved cookies or secrets during normal operation.

> **Local-first also means local responsibility:** these files are plain local data. Anyone with access to the machine's filesystem and your OS account can read the databases. Windows Credential Manager is used for Google credentials, but the SQLite files themselves are not an encrypted vault.

## Security model

### Local Mode

- no RockBase dashboard login — local loopback requests are treated as the local operator
- explicit `ROCKBASE_MODE=local`
- backend binds to `127.0.0.1` and rejects non-loopback requests
- SEO/Trend/Google endpoints additionally require a trusted Host/Origin and, for Google and trend data, the local owner identity, with `no-store` responses
- the boundary protects against **network** access, not other processes or users already running on the same Windows account

### Server Mode

- JWT authentication
- first-administrator bootstrap for fresh installs
- workspace-scoped access by membership; write actions require Admin/Operator
- local-only surfaces (Trend Radar, Google Search Console) fail closed rather than reading a local cache or vault

### Google connection

- read-only scope only (`webmasters.readonly`), PKCE `S256` + random state, loopback callback
- secrets in Windows Credential Manager, scoped per Windows account and install root
- never in Git, `localStorage`, logs, URLs, or exported reports
- disconnect invalidates in-flight data writes so late responses cannot restore private data

### Social accounts and AI agents

- social-platform login remains human-controlled
- saved cookies are encrypted with your local `ENCRYPTION_KEY`
- AI agents do not normally receive raw social passwords or cookies
- the `/internal/hermes` agent routes keep an independent bearer-token boundary in both modes, separate from dashboard access

## AI agents

RockBase is designed to be driven by humans **and** by local AI agents.

- The Hermes/internal API exposes account discovery, media upload, campaign submission, and status/result reads without handing over raw social cookies or passwords, with durable idempotency so a retried submission does not create duplicate work.
- In Local Mode the whole HTTP API is reachable from `127.0.0.1` without a dashboard password, which is what makes an agent running on the same machine practical. The trade-off is explicit: keep Local Mode loopback-only.
- SEO Intelligence, Trend Radar, and Google Search Console sit behind the same authenticated API layer, so an agent can read the same evidence a human sees — and the crawler/trend engine never receives your social secrets.
- In Server Mode, agents use real tokens like any other client.

## Project status

**Current stage: `v0.1.0-alpha`**

The integrated loop — audit, measure, discover, draft, publish, monitor — works end to end locally, but RockBase is not marketed as production-grade enterprise software. Browser-driven social connectors can require maintenance as platform UIs change, and the advanced panels listed above are deliberately disabled.

## Current limitations

- social platform UI changes can break browser publishing selectors
- operators may need to reconnect expired sessions
- session persistence is encrypted cookies, not a complete browser profile
- login, 2FA, checkpoints, and challenges remain human-controlled
- Analytics is not currently a trustworthy product-performance source, and Content Planner / Campaign Engine / the standalone Scheduler page are disabled
- advanced scheduler recurrence is not fully mature
- SEO Intelligence depends on live site access — a site that blocks crawling is reported as failed, not audited
- Trend Radar and Google Search Console Intelligence are Local Mode only
- Google OAuth grants in External/Testing mode can expire after seven days; each installation must configure and authorize its own Google account
- Google Search Console numbers are Google's, not a complete extraction of all query data (anonymized queries and row caps apply)
- Local Mode is Windows-first
- Server/production upgrades require backup plus the [preflight and upgrade procedure](docs/UPGRADE.md)

## Documentation

- [SEO Intelligence](docs/SEO_INTELLIGENCE.md) — crawler architecture, policy boundaries, and local storage
- [Google Search Console Intelligence](docs/GSC_INTELLIGENCE.md) — connection setup, metric contract, and trust boundaries
- [Trend Radar](docs/TREND_INTELLIGENCE.md) — source contract, evidence classification, and draft handoff
- [Local Mode](docs/LOCAL_MODE.md) — localhost runtime, data paths, and graceful stop
- [Upgrade guide](docs/UPGRADE.md) — safe existing-installation upgrades
- [Production data contract](docs/PRODUCTION_DATA_CONTRACT.md) — session, volume, encryption-key, and recovery guarantees
- [Release checklist draft](docs/RELEASE_CHECKLIST_DRAFT.md) — alpha release preparation

## License

RockBase is licensed under the MIT License.

See [LICENSE](LICENSE).
