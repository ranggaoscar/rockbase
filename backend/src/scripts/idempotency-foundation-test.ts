import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { IdempotencyStatus, PrismaClient } from '@prisma/client';
import {
  DurableIdempotencyService,
  IdempotencyConflictError,
  IdempotencyValidationError,
  InvalidIdempotencyTransitionError,
} from '../services/DurableIdempotencyService';
import {
  CanonicalPayloadError,
  canonicalRequestHash,
} from '../utils/canonicalRequestHash';

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const PRISMA_ROOT = path.join(BACKEND_ROOT, 'prisma');
const NEW_MIGRATION = '20260720062000_add_durable_idempotency_foundation';

function databaseUrl(databasePath: string): string {
  return `file:${databasePath.replace(/\\/g, '/')}`;
}

function runPrisma(schemaPath: string, databasePath: string, command: 'deploy' | 'status'): void {
  const cli = path.join(BACKEND_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  const relativeDatabase = path.relative(path.dirname(schemaPath), databasePath).replace(/\\/g, '/');
  const migrationDatabaseUrl = `file:${relativeDatabase}`;
  const result = spawnSync(process.execPath, [
    cli,
    'migrate',
    command,
    '--schema',
    schemaPath,
  ], {
    cwd: path.dirname(schemaPath),
    env: { ...process.env, DATABASE_URL: migrationDatabaseUrl, DEBUG: 'prisma:*', RUST_LOG: 'debug' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate ${command} failed: ${result.stderr || result.stdout}`);
  }
}

function copyMigrations(targetPrisma: string, includeNew: boolean): void {
  fs.mkdirSync(path.join(targetPrisma, 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(PRISMA_ROOT, 'schema.prisma'), path.join(targetPrisma, 'schema.prisma'));
  fs.copyFileSync(
    path.join(PRISMA_ROOT, 'migrations', 'migration_lock.toml'),
    path.join(targetPrisma, 'migrations', 'migration_lock.toml'),
  );
  for (const entry of fs.readdirSync(path.join(PRISMA_ROOT, 'migrations'), { withFileTypes: true })) {
    if (!entry.isDirectory() || (!includeNew && entry.name === NEW_MIGRATION)) continue;
    fs.cpSync(
      path.join(PRISMA_ROOT, 'migrations', entry.name),
      path.join(targetPrisma, 'migrations', entry.name),
      { recursive: true },
    );
  }
}

function importantCounts(database: Database.Database): Record<string, number> {
  const tables = ['User', 'Workspace', 'SocialAccount', 'Post', 'Campaign'];
  return Object.fromEntries(tables.map((table) => [
    table,
    (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count,
  ]));
}

function testMigrations(root: string, schemaPath: string): void {
  const emptyDatabase = path.join(root, 'empty.sqlite');
  runPrisma(schemaPath, emptyDatabase, 'deploy');
  runPrisma(schemaPath, emptyDatabase, 'status');

  const empty = new Database(emptyDatabase, { readonly: true });
  assert.equal(empty.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(empty.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='IdempotencyRecord'",
  ).get());
  empty.close();

  const legacyPrisma = path.join(root, 'legacy-prisma');
  const existingDatabase = path.join(root, 'existing.sqlite');
  copyMigrations(legacyPrisma, false);
  runPrisma(path.join(legacyPrisma, 'schema.prisma'), existingDatabase, 'deploy');

  const beforeDatabase = new Database(existingDatabase);
  const now = new Date().toISOString();
  beforeDatabase.prepare(
    'INSERT INTO "User" ("id","email","password","name","role","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)',
  ).run('user-sentinel', 'admin-staging-fixture@example.invalid', 'not-a-real-password-hash', 'Admin', 'Operator', now, now);
  beforeDatabase.prepare(
    'INSERT INTO "Workspace" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)',
  ).run('workspace-sentinel', 'Migration Sentinel', now, now);
  beforeDatabase.prepare(
    'INSERT INTO "Post" ("id","workspaceId","content","mediaUrls","accountIds","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)',
  ).run('post-sentinel', 'workspace-sentinel', 'sentinel', '[]', '[]', 'scheduled', now, now);
  const before = importantCounts(beforeDatabase);
  beforeDatabase.close();

  runPrisma(schemaPath, existingDatabase, 'deploy');
  runPrisma(schemaPath, existingDatabase, 'status');

  const afterDatabase = new Database(existingDatabase, { readonly: true });
  assert.deepEqual(importantCounts(afterDatabase), before);
  assert.equal(afterDatabase.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok((afterDatabase.prepare("PRAGMA table_info('Post')").all() as Array<{ name: string }>)
    .some((column) => column.name === 'idempotencyKey'));
  assert.equal(
    (afterDatabase.prepare('SELECT COUNT(*) AS count FROM "User" WHERE id=?').get('user-sentinel') as { count: number }).count,
    1,
  );
  afterDatabase.close();
}
function testCanonicalHash(): void {
  assert.equal(
    canonicalRequestHash({ caption: 'hello', accountIds: ['a'], nested: { z: 1, a: true } }),
    canonicalRequestHash({ nested: { a: true, z: 1 }, accountIds: ['a'], caption: 'hello' }),
  );
  assert.notEqual(canonicalRequestHash({ value: 1 }), canonicalRequestHash({ value: 2 }));
  assert.notEqual(canonicalRequestHash({ values: ['a', 'b'] }), canonicalRequestHash({ values: ['b', 'a'] }));
  assert.notEqual(canonicalRequestHash({ value: null }), canonicalRequestHash({}));
  assert.equal(canonicalRequestHash({ omitted: undefined }), canonicalRequestHash({}));
  assert.throws(() => canonicalRequestHash([undefined]), CanonicalPayloadError);
  assert.throws(() => canonicalRequestHash({ password: 'secret-fixture' }), CanonicalPayloadError);
  assert.throws(() => canonicalRequestHash(Buffer.from('binary-media')), CanonicalPayloadError);
}

async function testService(root: string, schemaPath: string): Promise<void> {
  const dbPath = path.join(root, 'service.sqlite');
  runPrisma(schemaPath, dbPath, 'deploy');
  const url = databaseUrl(dbPath);
  const firstClient = new PrismaClient({ datasourceUrl: url });
  const secondClient = new PrismaClient({ datasourceUrl: url });
  const firstService = new DurableIdempotencyService(firstClient);
  const secondService = new DurableIdempotencyService(secondClient);

  try {
    const firstHash = canonicalRequestHash({ campaignId: 'campaign-a', mediaChecksum: 'abc' });
    const created = await firstService.beginOperation({
      scope: 'post.submit',
      key: 'operation-new',
      requestHash: firstHash,
      metadata: { source: 'foundation-test' },
    });
    assert.equal(created.acquired, true);
    assert.equal(created.operation.status, IdempotencyStatus.IN_PROGRESS);

    const duplicate = await secondService.beginOperation({
      scope: 'post.submit',
      key: 'operation-new',
      requestHash: firstHash,
    });
    assert.equal(duplicate.acquired, false);
    assert.equal(duplicate.operation.id, created.operation.id);

    await assert.rejects(
      secondService.beginOperation({
        scope: 'post.submit',
        key: 'operation-new',
        requestHash: canonicalRequestHash({ campaignId: 'different' }),
      }),
      IdempotencyConflictError,
    );

    const raceHash = canonicalRequestHash({ campaignId: 'race' });
    const race = await Promise.all([
      firstService.beginOperation({ scope: 'post.bulk', key: 'operation-race', requestHash: raceHash }),
      secondService.beginOperation({ scope: 'post.bulk', key: 'operation-race', requestHash: raceHash }),
    ]);
    assert.equal(race.filter((result) => result.acquired).length, 1);
    assert.equal(new Set(race.map((result) => result.operation.id)).size, 1);
    assert.equal(await firstClient.idempotencyRecord.count({
      where: { scope: 'post.bulk', key: 'operation-race' },
    }), 1);

    const completed = await firstService.markCompleted('post.submit', 'operation-new', {
      resourceType: 'campaign',
      resourceId: 'campaign-a',
      resultReference: { campaignId: 'campaign-a' },
    });
    assert.equal(completed.status, IdempotencyStatus.COMPLETED);
    const repeatedCompleted = await firstService.markCompleted('post.submit', 'operation-new', {
      resourceType: 'campaign',
      resourceId: 'campaign-a',
      resultReference: { campaignId: 'campaign-a' },
    });
    assert.equal(repeatedCompleted.id, completed.id);
    await assert.rejects(
      firstService.markCompleted('post.submit', 'operation-new', {
        resourceType: 'campaign',
        resourceId: 'campaign-different',
      }),
      IdempotencyConflictError,
    );
    const completedRetry = await firstService.beginOperation({
      scope: 'post.submit',
      key: 'operation-new',
      requestHash: firstHash,
    });
    assert.equal(completedRetry.acquired, false);
    assert.equal(completedRetry.operation.status, IdempotencyStatus.COMPLETED);

    const failedHash = canonicalRequestHash({ operation: 'failed' });
    await firstService.beginOperation({ scope: 'post.prepare', key: 'operation-failed', requestHash: failedHash });
    const failed = await firstService.markFailed('post.prepare', 'operation-failed', 'VALIDATION_FAILED');
    assert.equal(failed.status, IdempotencyStatus.FAILED);
    assert.equal(
      (await firstService.markFailed('post.prepare', 'operation-failed', 'VALIDATION_FAILED')).id,
      failed.id,
    );

    const unknownHash = canonicalRequestHash({ operation: 'unknown' });
    await firstService.beginOperation({ scope: 'post.execute', key: 'operation-unknown', requestHash: unknownHash });
    const unknown = await firstService.markUnknown('post.execute', 'operation-unknown');
    assert.equal(unknown.status, IdempotencyStatus.UNKNOWN);
    await assert.rejects(
      firstService.markFailed('post.execute', 'operation-unknown', 'ASSUMED_FAILED'),
      InvalidIdempotencyTransitionError,
    );
    const unknownRetry = await secondService.beginOperation({
      scope: 'post.execute',
      key: 'operation-unknown',
      requestHash: unknownHash,
    });
    assert.equal(unknownRetry.acquired, false);
    assert.equal(unknownRetry.operation.status, IdempotencyStatus.UNKNOWN);

    await assert.rejects(
      firstService.beginOperation({
        scope: 'campaign.submit',
        key: 'contains-secret',
        requestHash: firstHash,
        metadata: { bearerToken: 'secret-fixture' },
      }),
      CanonicalPayloadError,
    );
    await assert.rejects(
      firstService.markFailed('post.prepare', 'operation-race', 'Error\n at raw stack'),
      IdempotencyValidationError,
    );
    await assert.rejects(
      firstService.beginOperation({ scope: 'bad scope', key: 'key', requestHash: firstHash }),
      IdempotencyValidationError,
    );
    await assert.rejects(
      firstService.beginOperation({ scope: 'valid', key: 'x'.repeat(201), requestHash: firstHash }),
      IdempotencyValidationError,
    );

    const stored = await firstClient.idempotencyRecord.findMany();
    const serialized = JSON.stringify(stored);
    assert.ok(!serialized.includes('secret-fixture'));
    assert.ok(!serialized.includes('raw stack'));
    assert.ok(!serialized.includes('binary-media'));
  } finally {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
  }

  const restartedClient = new PrismaClient({ datasourceUrl: url });
  try {
    const restartedService = new DurableIdempotencyService(restartedClient);
    const persisted = await restartedService.getOperation('post.submit', 'operation-new');
    assert.equal(persisted?.status, IdempotencyStatus.COMPLETED);
    assert.equal(persisted?.resourceId, 'campaign-a');
  } finally {
    await restartedClient.$disconnect();
  }
}

async function main(): Promise<void> {
  const temporaryRoot = process.env.ROCKBASE_TEST_TMP_ROOT || path.join(BACKEND_ROOT, 'node_modules', '.rockbase-idempotency-tests');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'rockbase-idempotency-'));
    const fullPrisma = path.join(root, 'full-prisma');
    copyMigrations(fullPrisma, true);
    const schemaPath = path.join(fullPrisma, 'schema.prisma');
    testCanonicalHash();
    testMigrations(root, schemaPath);
    await testService(root, schemaPath);
    console.log('[IdempotencyFoundationTest] PASS: migration, hashing, concurrency, lifecycle, security, and restart persistence.');
}

main().catch((error) => {
  console.error('[IdempotencyFoundationTest] FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
