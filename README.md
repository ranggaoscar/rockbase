# ROCK BASE Dashboard

ROCK BASE is a local dashboard for managing multiple social media accounts with Farm View, session saving, warming flows, AI-assisted captions, and mass posting queues.

## Start Here

For a new PC, follow the full setup guide:

[README_SETUP.md](README_SETUP.md)

Quick Windows flow:

```bat
SETUP_ROCK_BASE.bat
CHECK_ROCK_BASE.bat
START_ROCK_BASE.bat
```

Dashboard URL:

```text
http://localhost:5173
```

Default login:

```text
Email: admin@rockbase.com
Password: Admin@123
```

## Requirements

- Node.js 18+
- npm
- Redis on `127.0.0.1:6379`
- SQLite through Prisma

## Local Data Safety

Private runtime files are intentionally not committed to Git:

- `backend/.env`
- local `.db` files
- account cookies and saved sessions
- uploads
- logs and screenshots
- backups
- `node_modules`

Each PC needs its own `.env`, database, accounts, and saved sessions.

## Useful Scripts

- `SETUP_ROCK_BASE.bat` - installs dependencies, prepares Prisma, seeds the default admin user, and installs Playwright Chromium.
- `CHECK_ROCK_BASE.bat` - checks Node, npm, `.env`, dependencies, Redis, Prisma, backend health, and frontend port.
- `START_ROCK_BASE.bat` - opens backend and frontend in separate Windows command windows.
- `start.bat` - simpler starter for local development.

## Features

| Feature | Status | Description |
|:---|:---|:---|
| Farm View | Working | Real-time monitoring of account sessions through Playwright screenshots. |
| Remote Control | Working | Manually control browser sessions for login and checkpoints. |
| Save Session | Working | Persists encrypted cookies in the local SQLite database. |
| Instagram Warming | Working | Human-behavior style warming actions. |
| Mass Auto Posting | Working | Bulk posting with account filtering, queueing, and caption variation. |
| Caption Spinner | Working | Uses AI configuration for caption and hashtag variants. |
| TikTok Automation | Planned | Manual control only for now. |

## Developer Notes

Do not delete these local runtime folders unless you intentionally want to remove local data:

- `backend/dev.db`
- `backend/prisma/dev.db`
- `backend/uploads/`
- `backend/backups/`
- `backend/logs/`

Before testing large posting batches, run `CHECK_ROCK_BASE.bat`, confirm Redis is up, test 1 account, then test a small group.
