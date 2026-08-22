# ROCK BASE Production Data Contract

## Purpose

This document defines the current production-data preservation contract for ROCK BASE. It applies to normal upgrades of an existing installation that has connected social accounts and saved browser-cookie sessions.

The current session mechanism is **cookie-based**. It does not use full persistent Chromium browser profiles or `userDataDir` profiles.

## Persistent Docker volumes

The current `docker-compose.yml` declares these named volumes. Their names and mounts must remain compatible during normal upgrades.

| Volume | Container mount | Purpose |
|---|---|---|
| `backend-db` | `/app/backend/prisma` | SQLite database directory. With `DATABASE_URL=file:./dev.db`, active database is `/app/backend/prisma/dev.db`. |
| `backend-uploads` | `/app/backend/uploads` | Uploaded media and campaign media. |
| `backend-backups` | `/app/backend/backups` | Verified SQLite backup snapshots. |
| `backend-logs` | `/app/backend/logs` | Runtime logs. |
| `redis-data` | `/data` in Redis | BullMQ/job state and Redis-backed runtime counters. |

Normal `docker compose down` preserves named volumes. `docker compose down -v`, explicit Docker volume deletion, and Docker volume pruning can destroy this data.

## Accounts and saved sessions

Accounts are stored in SQLite in the `SocialAccount` table.

The `SocialAccount.cookies` column contains the saved browser cookie array for an account. The cookie array is serialized as JSON and encrypted before storage. `BrowserManager` restores it by decrypting the value and injecting the cookie array into a new Playwright `BrowserContext`.

Existing cookie blobs are part of the operational identity of an account. They must not be deleted, reformatted, or replaced with empty cookie arrays during normal upgrades.

## Encryption key requirement

`ENCRYPTION_KEY` is required to decrypt existing saved cookies. It must remain the exact same 64-hex-character value across upgrades and recovery.

**Database backup plus the correct `ENCRYPTION_KEY` are both required to recover encrypted saved sessions.** A database backup without the original key may restore account rows but cannot restore readable encrypted cookie sessions.

Do not rotate, replace, or remove this key as part of a normal application upgrade. Store `backend/.env` securely outside Git and include its recovery handling in the machine's protected operational runbook.

## Backups and limitations

`BackupService` creates verified SQLite online backups in `backend-backups`. Each current snapshot includes:

- `database.sqlite`
- `manifest.json`
- `checksums.sha256`

The backup validation checks checksum, SQLite header, `PRAGMA integrity_check`, required tables, and migration inventory.

Current SQLite snapshots do **not** include uploads or `.env`. Upload media must be backed up separately from `backend-uploads`. The encryption key and other recovery-critical environment values must be backed up securely outside the repository.

A named Docker volume is not an off-machine disaster-recovery copy. Copy verified DB snapshots and uploads to protected off-machine storage according to the operator's recovery policy.

## Safe upgrade flow

1. Confirm `backend-db`, `backend-uploads`, `backend-backups`, `backend-logs`, and `redis-data` are present and mounted as expected.
2. Confirm the existing `ENCRYPTION_KEY` is present and unchanged.
3. Create and validate a SQLite backup; copy it off-machine.
4. Back up uploads separately.
5. Inspect the approved code/migration plan. Database evolution must be forward-only and additive where possible.
6. Pull the approved commit and run `docker compose up -d --build` without deleting volumes.
7. Verify readiness, account count, and a small number of non-critical saved sessions before any batch execution.
8. Do not run mass posting as the first post-upgrade validation.

## Forbidden destructive commands and operations

Do not use these commands as part of normal operation or upgrade:

```bash
prisma migrate reset
prisma db push
docker compose down -v
docker volume prune
```

Also forbidden without an explicit recovery plan and approval:

- deleting SQLite files
- deleting named volumes
- replacing `ENCRYPTION_KEY`
- destructive seed operations
- migrations that drop/replace saved-session data
- migrations that require every account to log in again

## Compatibility policy

Database changes must preserve existing `SocialAccount` records and their encrypted cookie values. The current encrypted cookie format is AES-256-CBC with `ivHex:cipherHex` text encoding. A future encryption or browser-persistence migration must provide a transitional, backward-compatible reader for existing cookie sessions.

Normal upgrades must preserve the invariant:

```text
existing database volume + existing ENCRYPTION_KEY
→ existing SocialAccount.cookies remain loadable
→ no mass relogin
```

## Redis role

Redis persists BullMQ job state and Redis-backed operational counters when `redis-data` remains available. SQLite remains the durable source for account records, saved cookies, posts, campaigns, activity, and idempotency records.

Clearing Redis may disrupt queued/delayed runtime work and reset Redis-only controls. It must not be treated as a harmless routine operation.

## Scope

This contract describes the current architecture only. It does not introduce persistent browser profiles, change volume names, change encryption format, or alter existing database records.
