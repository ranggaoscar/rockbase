import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { changeAdminPassword } from './change-admin-password';

async function seedCase(env: Record<string, string>, exists = false) {
  const source = fs.readFileSync(path.resolve(__dirname, 'seed.ts'), 'utf8');
  const logs: string[] = [];
  const changes: string[] = [];
  let exitCode = 0;
  const store = {
    workspace: { findUnique: async () => ({ id: 'w1', name: 'fixture' }), create: async () => { changes.push('workspace'); return { id: 'w1' }; } },
    user: { findUnique: async () => exists ? { id: 'admin-existing' } : null, create: async ({ data }: any) => { changes.push('user'); assert.match(data.password, /^\$2/); return { id: 'new-admin' }; } },
    workspaceUser: { create: async () => { changes.push('membership'); } },
    $disconnect: async () => {},
  };
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  vm.runInNewContext(compiled, {
    exports: {}, Buffer, process: { env, exit: (code: number) => { exitCode = code; } },
    console: { log: (...args: unknown[]) => logs.push(args.join(' ')), error: () => logs.push('error') },
    require: (name: string) => name === '@prisma/client' ? { PrismaClient: class { constructor() { return store; } } } : name === 'dotenv' ? { config: () => {} } : name === 'bcryptjs' ? bcrypt : require(name),
  });
  // Resolve the seed promise including async bcrypt without real DB calls.
  for (let i = 0; i < 100 && !logs.some((line) => line.includes('successfully')) && !exitCode; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  return { changes, logs: logs.join('\n'), exitCode };
}

async function main() {
  const missing = await seedCase({});
  assert.equal(missing.exitCode, 1); assert.deepEqual(missing.changes, []);
  const weak = await seedCase({ SEED_ADMIN_EMAIL: 'fixture@example.invalid', SEED_ADMIN_PASSWORD: 'short' });
  assert.equal(weak.exitCode, 1); assert.deepEqual(weak.changes, []);
  const secret = 'Fixture-Canary-StrongPass-2026';
  const created = await seedCase({ SEED_ADMIN_EMAIL: 'fixture@example.invalid', SEED_ADMIN_PASSWORD: secret });
  assert.deepEqual(created.changes, ['user', 'membership']); assert(!created.logs.includes(secret));
  const preserved = await seedCase({ SEED_ADMIN_EMAIL: 'fixture@example.invalid', SEED_ADMIN_PASSWORD: secret }, true);
  assert.deepEqual(preserved.changes, []); assert(!preserved.logs.includes(secret));

  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rockbase-password-test-'));
  const file = path.join(dir, 'fixture.sqlite');
  const db = new Database(file);
  db.exec('CREATE TABLE User(id TEXT PRIMARY KEY, role TEXT, password TEXT, updatedAt INTEGER); CREATE TABLE SocialAccount(id TEXT,cookies TEXT)');
  db.prepare('INSERT INTO User VALUES(?,?,?,?)').run('admin', 'Admin', await bcrypt.hash('FixtureOld-Password-2026', 4), 0);
  db.prepare('INSERT INTO SocialAccount VALUES(?,?)').run('a1', 'encrypted-cookie-fixture');
  db.close();
  await assert.rejects(changeAdminPassword(file, path.join(dir, 'invalid.sqlite'), 'missing', secret));
  const result = await changeAdminPassword(file, path.join(dir, 'backup.sqlite'), 'admin', secret);
  assert.equal(result.updated, true);
  const after = new Database(file, { readonly: true });
  assert.equal(after.prepare('SELECT cookies FROM SocialAccount').pluck().get(), 'encrypted-cookie-fixture');
  assert(await bcrypt.compare(secret, after.prepare('SELECT password FROM User').pluck().get() as string));
  after.close();
  const backup = new Database(path.join(dir, 'backup.sqlite'), { readonly: true });
  assert(await bcrypt.compare('FixtureOld-Password-2026', backup.prepare('SELECT password FROM User').pluck().get() as string)); backup.close();
  console.log('[SeedSecurityRegression] PASS: missing/weak config fails before writes, no password output, existing user unchanged; owner utility backup/read-back validated in scratch only.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
