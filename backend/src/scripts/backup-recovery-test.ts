import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { resolveActiveSqliteDatabasePath, validateBackup } from '../utils/sqliteRecovery';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rockbase-recovery-test-'));
try {
  const prismaDirectory = path.join(temporaryRoot, 'prisma');
  fs.mkdirSync(prismaDirectory);
  const databasePath = path.join(prismaDirectory, 'test.db');
  const database = new Database(databasePath);
  for (const table of ['User', 'Workspace', 'SocialAccount', 'Post', 'Campaign', 'ActivityLog']) database.exec(`CREATE TABLE "${table}" (id TEXT)`);
  database.exec('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT)');
  database.exec("INSERT INTO _prisma_migrations VALUES ('test_migration', '2026-01-01')");
  database.close();

  assert.equal(resolveActiveSqliteDatabasePath('file:./test.db', temporaryRoot), databasePath);
  assert.throws(() => resolveActiveSqliteDatabasePath('postgres://invalid', temporaryRoot));
  assert.throws(() => resolveActiveSqliteDatabasePath('file:../outside.db', temporaryRoot));

  const backupDirectory = path.join(temporaryRoot, 'backup');
  fs.mkdirSync(backupDirectory);
  const backupPath = path.join(backupDirectory, 'database.sqlite');
  fs.copyFileSync(databasePath, backupPath);
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex');
  fs.writeFileSync(path.join(backupDirectory, 'checksums.sha256'), `${checksum}  database.sqlite\n`);
  fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify({
    formatVersion: 1, createdAt: new Date().toISOString(), environment: 'test', sourceDatabase: 'prisma/test.db',
    databaseFile: 'database.sqlite', sha256: checksum, sizeBytes: fs.statSync(backupPath).size,
    migrations: ['test_migration'], media: { included: false, strategy: 'separate-media-backup' },
  }));
  validateBackup(backupDirectory);
  fs.appendFileSync(backupPath, 'corrupt');
  assert.throws(() => validateBackup(backupDirectory));
  console.log('[BackupRecoveryTest] passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
