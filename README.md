# ROCK BASE

**Supporting campaign operations for small teams and AI agents.**

RockBase is a self-hosted social campaign operations platform that helps small teams coordinate content distribution across the social accounts they manage.

Connect accounts once, prepare campaigns with humans or AI agents, and let RockBase handle session reuse, queued execution, pacing, publishing, and operational visibility.

```text
Prepare campaign
→ Select accounts
→ Queue execution
→ RockBase publishes progressively
→ Track results
→ Resolve account sessions when needed
```

## Why RockBase exists

A startup may have one marketing operator, several salespeople, brand accounts, regional accounts, project accounts, and an AI agent—but not a large social media department.

RockBase gives that team one internal control plane for coordinated campaign support. It keeps account sessions and browser execution inside the self-hosted runtime, while humans and AI agents focus on campaign intent, content, and account selection.

### Example: New Product Launch

A human operator or Hermes prepares artwork/video, caption variants, and target account groups.

RockBase then:

- queues account operations
- spaces execution across selected accounts
- restores saved account sessions
- performs supported publishing actions
- records per-account results and activity
- surfaces session issues so an operator can reconnect an account when needed

## How it works

```text
Human or AI agent
  → prepares campaign intent and content
  → selects accounts or account groups
  → submits work to RockBase

RockBase
  → reuses saved account sessions
  → queues controlled execution
  → applies reasonable pacing and account locks
  → publishes progressively through supported connectors
  → records status, results, and activity

Operator
  → monitors progress
  → resolves session/login challenges in Farm View / Session Control
```

## Main capabilities

### Account operations

- manage multiple social accounts
- organize accounts into reusable groups
- track account, connection, and session-health state
- associate accounts with brand/project context and proxies where needed

### Farm View / Session Control

Farm View is the current session-control workspace.

- open an isolated browser context for an account
- complete manual login and platform verification
- use remote browser control for click, type, scroll, and navigation
- save a reusable encrypted cookie session
- monitor selected account sessions with live screenshots

Saved sessions currently use encrypted cookies, not full persistent Chromium browser profiles.

### Campaign execution

- submit content and campaign intent
- select accounts and account groups
- queue one controlled operation per account
- stagger publishing instead of triggering all accounts at once
- apply account execution locks and posting budgets
- review activity, status, failures, and session attention needs

### AI agent integration

RockBase is designed so an AI agent can submit campaign intent without receiving raw social-account secrets.

The internal Hermes API can:

- list available accounts without exposing cookies or passwords
- create campaigns with durable idempotency support
- upload campaign media
- inspect campaign status and per-action results

The agent prepares intent and content. RockBase owns account-session handling and execution.

### Operational reliability

- encrypted saved cookie sessions
- per-account execution locks
- durable idempotency records
- Redis-backed posting budgets and queue state
- session-health checks
- activity history
- verified SQLite backups with checksum and integrity validation

## Windows / Docker quick start

Docker Desktop is the only runtime prerequisite for a normal Windows install. You do not need to manually install Node, Redis, Prisma, or Playwright.

```powershell
git clone https://github.com/ranggaoscar/rockbase.git
cd rockbase
powershell -ExecutionPolicy Bypass -File .\setup-rockbase.ps1
```

The setup script checks Docker, creates `backend/.env` only when missing, generates unique local secrets, starts Docker Compose, waits for `/readyz`, and prints the dashboard URL plus one-time fresh-install credentials.

Open:

```text
http://localhost:5173
```

### Manual Docker method

```bash
cp backend/.env.example backend/.env
# Set a unique JWT_SECRET and a 64-hex-character ENCRYPTION_KEY.
docker compose up -d --build
```

For an **existing installation**, do not use first-install instructions to replace configuration. Read [docs/UPGRADE.md](docs/UPGRADE.md), run `scripts/preflight-upgrade.ps1`, create a verified backup, preserve `backend/.env`, and then rebuild without deleting named volumes.

The default Compose configuration starts Redis, applies safe Prisma migrations with `migrate deploy`, starts the backend API, and starts the frontend. Use the optional worker profile only when you intentionally want a separate worker process.

## Data persistence and session safety

RockBase operational data is intentionally outside Git and stored in persistent Docker volumes:

| Volume | Purpose |
|---|---|
| `backend-db` | SQLite database, including accounts and encrypted saved sessions |
| `backend-uploads` | uploaded and campaign media |
| `backend-backups` | verified SQLite backup snapshots |
| `backend-logs` | runtime logs |
| `redis-data` | BullMQ job state and Redis-backed runtime counters |

Important:

- saved social sessions currently live in `SocialAccount.cookies` as encrypted cookie data
- the exact same `ENCRYPTION_KEY` is required to read existing saved sessions after an upgrade or recovery
- a database backup **and** the correct encryption key are both required for encrypted-session recovery
- uploads must be backed up separately from SQLite snapshots
- `docker compose down -v` deletes persistent volumes and therefore destroys local RockBase data

Read [docs/PRODUCTION_DATA_CONTRACT.md](docs/PRODUCTION_DATA_CONTRACT.md) before operating a long-lived installation or upgrading an environment with saved account sessions.

### Destructive reset — erases all local RockBase data

Do not run this during normal operation or upgrades:

```bash
docker compose down -v
```

It removes persistent volumes, including the local database, saved encrypted sessions, uploads, backups, logs, and Redis data. Use it only for an explicitly approved disposable development reset.

Never use these as normal recovery commands:

```bash
prisma migrate reset
prisma db push
docker volume prune
```

## Current limitations

RockBase is an evolving self-hosted product. Treat these areas carefully:

- supported browser publishing can fail when platforms change UI, account sessions expire, or manual verification is required
- current session persistence is cookie-based; it does not preserve a complete browser profile
- operator intervention remains necessary for login, 2FA, checkpoint, and challenge flows
- analytics is not currently a product priority and should not be treated as a trustworthy source of platform performance data
- some advanced tools remain experimental and are not part of the core campaign-support workflow
- Docker runtime validation should be done in a dedicated staging environment before production upgrades

## Architecture

```text
┌──────────────────────┐
│ Human / AI agent     │
│ Campaign intent      │
└──────────┬───────────┘
           │ internal API / dashboard
┌──────────▼───────────┐
│ ROCK BASE frontend   │
│ Accounts · Campaigns │
│ Sessions · Activity  │
└──────────┬───────────┘
           │
┌──────────▼───────────────────────────────────────┐
│ ROCK BASE backend                                 │
│ Express · Prisma/SQLite · Socket.io · Playwright │
│ campaign services · session control               │
└──────────┬───────────────────────┬────────────────┘
           │                       │
┌──────────▼───────────┐ ┌─────────▼───────────────┐
│ SQLite named volume  │ │ Redis / BullMQ           │
│ accounts · sessions  │ │ queue · locks · budgets  │
└──────────────────────┘ └─────────────────────────┘
```

## Advanced and experimental capabilities

These capabilities are preserved but are not the primary product identity:

- account warming workflows
- engagement operations
- proxy management
- planning-only campaign tools
- experimental AI-assisted drafting

They are operational tools around the core campaign-support loop, not replacements for a human campaign strategy or a general automation-workflow builder.

## Developer setup

For local development without Docker:

```bash
# Backend
cd backend
npm ci
npx prisma generate
npm run dev

# Frontend, in another terminal
cd frontend
npm ci
npm run dev
```

A local development setup also needs Redis reachable by the backend for queue-backed operations. Use `SETUP_ROCK_BASE.bat`, `START_ROCK_BASE.bat`, and `CHECK_ROCK_BASE.bat` only for local development or a fresh disposable installation—not as a substitute for the production data contract.

## Development status

RockBase is under active development. The current priority is a reliable, understandable core loop:

```text
Connect account
→ preserve reusable session
→ submit campaign/content
→ queue controlled execution
→ publish progressively
→ show results and session attention needs
```

Before changing a persistent installation, review the production data contract, make a verified backup, preserve `ENCRYPTION_KEY`, and test on a non-critical account first.

## License

See the repository license when one is added.
