# ROCK BASE Local Mode

Local Mode is for one Windows operator running RockBase on one computer.

## Start

```bat
START_ROCKBASE.bat
```

The launcher starts RockBase on:

```text
http://127.0.0.1:5173
```

Local Mode does not require a RockBase dashboard username/password. It does **not** bypass Instagram or TikTok login: account sessions still require a human to log in through Farm View / Session Control and explicitly save the session.

## Security boundary

Local Mode sets:

```text
ROCKBASE_MODE=local
```

The backend binds to `127.0.0.1` and rejects non-loopback requests. The frontend dev server also binds to `127.0.0.1`.

Local Mode is not for:

- LAN access
- another computer
- phone access
- VPS
- public hostname

Use Server Mode for those cases. Server Mode keeps Docker and dashboard authentication.

The Hermes internal API keeps its independent bearer-token boundary in both modes.

## Local prerequisites strategy

The launcher checks for Node and Redis. When `winget` is available, it can attempt to install:

- Node LTS through `OpenJS.NodeJS.LTS`
- Redis through `taizod1024.redis-windows-fork` (MIT-licensed portable Windows build distributed through winget)

No third-party binary is committed into this repository. If a package install is unavailable or Redis cannot start, Local Mode stops safely rather than bypassing queue safety.

The launcher installs project dependencies when missing, generates the Prisma client, and runs `npx playwright install chromium` for the project-local browser runtime. It does not log into social platforms or create social posts.

## Local data contract

To preserve compatibility with existing non-Docker installs, Local Mode keeps current repository-relative paths:

| Data | Local path |
|---|---|
| SQLite database | `backend/prisma/dev.db` when `DATABASE_URL=file:./dev.db` |
| configuration and encryption key | `backend/.env` |
| uploads | `backend/uploads/` |
| verified database backups | `backend/backups/` |
| logs | `backend/logs/` |
| Redis runtime data | `rockbase-data/redis/` |

Do not delete or replace `backend/.env` after sessions exist. `ENCRYPTION_KEY` remains required to decrypt saved cookie sessions.

The Local Mode launcher starts Redis with `--bind 127.0.0.1` and protected mode enabled. Its Redis persistence stays under `rockbase-data/redis/`, not the repository root.

## Stop

For graceful session shutdown, press `Ctrl+C` in the backend launcher window and wait for its shutdown output before closing the frontend window.

`STOP_ROCKBASE.bat` displays this safe stop procedure. It intentionally does not hard-kill Node processes.

## Server Mode

Use [setup-rockbase.ps1](../setup-rockbase.ps1) and the Docker workflow for shared/team/server use. See [UPGRADE.md](UPGRADE.md) for existing-install upgrades.
