# ROCK BASE Setup Guide

This guide is for running ROCK BASE on a new Windows PC after cloning the GitHub repo.

## What Is Not Shared In Git

The repo does not include private local runtime data:

- `backend/.env`
- SQLite databases such as `backend/dev.db` and `backend/prisma/dev.db`
- Instagram cookies and saved sessions
- uploaded media
- logs, screenshots, and backups
- `node_modules`

Each PC starts with its own local database, sessions, accounts, and API keys.

## Requirements

- Windows 10 or newer
- Node.js 18 or newer
- npm
- Redis running locally on `127.0.0.1:6379`
- Internet access for `npm install` and Playwright browser install

## First-Time Setup

1. Clone the repo.

```bat
git clone https://github.com/ranggaoscar/rockbase.git
cd rockbase
```

2. Run the setup script.

```bat
SETUP_ROCK_BASE.bat
```

The setup script:

- creates `backend\.env` from `backend\.env.example` if missing
- installs backend dependencies
- generates Prisma client
- applies database migrations
- seeds the default workspace and admin user
- installs Playwright Chromium
- installs frontend dependencies

3. Start Redis.

Redis must be reachable at `127.0.0.1:6379` for queued mass posting jobs.

4. Start ROCK BASE.

```bat
START_ROCK_BASE.bat
```

5. Open the dashboard.

```text
http://localhost:5173
```

Default login:

```text
Email: admin@rockbase.com
Password: Admin@123
```

## Preflight Check

Run this anytime to check whether the local machine is ready:

```bat
CHECK_ROCK_BASE.bat
```

It checks Node, npm, `.env`, dependencies, Redis, Prisma schema, backend health, and frontend port.

## Important Safety Notes

- Do not run `prisma migrate reset` unless you have a verified backup.
- Do not share `backend\.env`.
- Do not share local `.db` files if they contain accounts or saved sessions.
- Do not share `backend\logs`, `backend\uploads`, or `backend\backups` if they contain private operational data.

## Mass Posting Checklist

Before trying a large batch:

- backend health is OK
- Redis is running
- queue is empty or intentionally scheduled
- selected accounts have healthy sessions
- media is a real local upload or a downloadable URL
- test 1 account first
- test 3 accounts next
- then run the larger batch

ROCK BASE includes human-behavior automation around posting, but Instagram automation can still fail when accounts are checkpointed, sessions expire, proxies fail, or Instagram changes its UI.

## Troubleshooting

If only one launcher window appears:

- if ports `3010` and `5173` are already active, the launcher reuses the existing backend/frontend
- run `CHECK_ROCK_BASE.bat` to confirm
- if a server is stuck, close the backend/frontend command windows and run `START_ROCK_BASE.bat` again

If backend is not reachable:

- check `backend\.env`
- make sure `PORT=3010`
- make sure Redis is running
- run `cd backend && npm run dev` to see the error directly

If posting fails with media errors:

- use uploaded media when possible
- remote URLs must be downloadable by the backend PC
- check the backend terminal for the exact download or upload error
