# Backup and recovery

RockBase backs up the SQLite database resolved from `DATABASE_URL`. In staging, `file:./dev.db` resolves to the named volume at `/app/backend/prisma/dev.db`; it never uses a working-directory database.

Each snapshot is an SQLite online backup and contains `database.sqlite`, `manifest.json`, and `checksums.sha256`. It is atomically published only after checksum, SQLite header, `PRAGMA integrity_check`, required Prisma tables, and migration inventory validate. Automatic deletion is disabled.

## Operations

```powershell
cd backend
npx ts-node src/scripts/backup-now.ts
npx ts-node src/scripts/restore-backup.ts verify-only <backup-directory>
npx ts-node src/scripts/restore-backup.ts restore-to-target <backup-directory> <new-target-db>
```

Restore never overwrites a database. The target must be beneath `RESTORE_TARGET_ROOT` (or `backend/restore-targets` locally). Validate a restored target with `npx prisma migrate status` and its explicit `DATABASE_URL`.

## Staging drill

The `restore-tool` service mounts backups read-only and the separate `rockbase-staging-restore-test` named volume:

```powershell
docker compose -f docker-compose.staging.yml run --rm restore-tool npx ts-node src/scripts/restore-backup.ts verify-only /backups/<backup-directory>
docker compose -f docker-compose.staging.yml run --rm restore-tool npx ts-node src/scripts/restore-backup.ts restore-to-target /backups/<backup-directory> /restore/database.sqlite
docker compose -f docker-compose.staging.yml run --rm -e DATABASE_URL=file:/restore/database.sqlite restore-tool npx prisma migrate status
```

The running backend never mounts this restore volume. No migration is run during the drill.

## Media and off-machine copies

Uploads are intentionally excluded from database snapshots: copying media for every backup causes uncontrolled storage growth. Schedule encrypted, off-machine media backup separately. Copy verified database snapshots off-machine too; a named Docker volume is not disaster recovery. Backups may contain account/session data, so restrict access and never commit them.

Before migrations, create and verify a backup, copy it off-machine, record its checksum, then rehearse restore-to-new-target. Never use `prisma migrate reset` as recovery.
