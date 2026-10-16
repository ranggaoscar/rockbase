import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import Module from 'node:module';
import http from 'node:http';

// In-memory fixture store only: the real routers/auth/membership middleware run, not production DB.
const previous = { ...process.env };
const root = path.resolve(__dirname, '../..');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rockbase-auth-'));
process.env.LOG_DIR = path.join(scratch, 'logs');
process.env.JWT_SECRET = 'fixture-jwt-signing-key-only-not-for-production-123';
process.env.ROCKBASE_MODE = 'server';
const account = { id: 'a1', workspaceId: 'w1', username: 'fixture', email: 'fixture@example.invalid', accountPassword: 'encrypted-fixture', cookies: 'encrypted-fixture' };
let decrypts = 0;
const prisma = {
  socialAccount: {
    findUnique: async ({ where, select }: any) => where.id === account.id ? select ? { workspaceId: account.workspaceId } : account : null,
    findFirst: async () => account,
    update: async () => { throw new Error('Unexpected write in read-only test'); },
  },
  workspaceUser: { findFirst: async ({ where }: any) => where.workspaceId === 'w1' && where.userId === 'admin-own' ? { id: 'membership' } : null },
};
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, parent: any, isMain: boolean) {
  if (parent?.filename.endsWith(path.join('routes', 'accountRoutes.ts'))) {
    if (name === '@prisma/client') return { PrismaClient: class { constructor() { return prisma; } } };
    if (name === '../utils/encryption') return { decrypt: () => { decrypts++; return 'FIXTURE_CANARY'; }, encrypt: () => 'fixture' };
    if (name.startsWith('../services/')) return {};
  }
  if (parent?.filename.endsWith(path.join('routes', 'systemRoutes.ts')) && name === '../controllers/systemController') {
    return { getLogs: (_req: any, res: any) => res.json({ data: ['fixture-log'] }), listLogFilesEndpoint: (_req: any, res: any) => res.json([]), clearQueue: () => {}, resetQueue: () => {} };
  }
  return originalLoad.call(this, name, parent, isMain);
};

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', require('../routes/accountRoutes').default);
  const { authenticateToken } = require('../middleware/auth');
  app.use('/api/system', authenticateToken, require('../routes/systemRoutes').default);
  loader._load = originalLoad;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let assertions = 0;
  const token = (id: string, role: string) => jwt.sign({ id, role, email: 'fixture@example.invalid', name: 'Fixture' }, process.env.JWT_SECRET!);
  try {
    for (const suffix of ['credentials', 'cookies']) {
      for (const [identity, role, expected] of [['admin-own', 'Admin', 200], ['admin-other', 'Admin', 404], ['viewer-own', 'Viewer', 403], ['operator-own', 'Operator', 403]] as const) {
        const before = decrypts;
        const response = await fetch(`${base}/api/accounts/a1/${suffix}`, { headers: { Authorization: `Bearer ${token(identity, role)}` } });
        assert.equal(response.status, expected, `${suffix} ${identity}`);
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const body = await response.text();
        assert.equal(body.includes('FIXTURE_CANARY'), expected === 200);
        if (expected !== 200) assert.equal(decrypts, before, 'Denied request must never decrypt');
        assertions++;
      }
      const missing = await fetch(`${base}/api/accounts/a1/${suffix}`);
      assert.equal(missing.status, 401); assert.match(missing.headers.get('cache-control') || '', /no-store/); assertions++;
      const spoofed = await fetch(`${base}/api/accounts/a1/${suffix}`, { headers: { Authorization: `Bearer ${token('viewer-own', 'Viewer')}`, 'x-role': 'Admin', 'x-workspace-id': 'w1' } });
      assert.equal(spoofed.status, 403); assertions++;
    }
    for (const suffix of ['logs', 'logs/files']) {
      const viewer = await fetch(`${base}/api/system/${suffix}`, { headers: { Authorization: `Bearer ${token('viewer-own', 'Viewer')}` } });
      assert.equal(viewer.status, 403);
      const admin = await fetch(`${base}/api/system/${suffix}`, { headers: { Authorization: `Bearer ${token('admin-own', 'Admin')}` } });
      assert.equal(admin.status, 200); assert.match(admin.headers.get('cache-control') || '', /no-store/); assertions += 2;
    }
    const before = decrypts;
    const imported = await fetch(`${base}/api/accounts/a1/cookies`, { method: 'POST', headers: { Authorization: `Bearer ${token('admin-other', 'Admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies: [{ name: 'fake', value: 'canary' }] }) });
    assert.equal(imported.status, 404); assert.equal(decrypts, before); assertions++;
    const bulk = await fetch(`${base}/api/accounts/import-cookies-bulk`, { method: 'POST', headers: { Authorization: `Bearer ${token('admin-other', 'Admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: [{ id: 'a1', cookies: [{ name: 'fake', value: 'canary' }] }] }) });
    assert.equal(bulk.status, 200);
    const bulkResult = await bulk.json() as { successCount: number; errors: unknown[] };
    assert.equal(bulkResult.successCount, 0); assert.equal(bulkResult.errors.length, 1); assertions++;
    const passwordWrite = await fetch(`${base}/api/accounts/a1`, { method: 'PATCH', headers: { Authorization: `Bearer ${token('admin-other', 'Admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture-not-applied' }) });
    assert.equal(passwordWrite.status, 404); assertions++;
    process.env.ROCKBASE_MODE = 'local';
    const local = await fetch(`${base}/api/accounts/a1/credentials`);
    assert.equal(local.status, 200); assert.match(local.headers.get('cache-control') || '', /no-store/); assertions++;
    const hostileOrigin = await fetch(`${base}/api/accounts/a1/credentials`, { headers: { Origin: 'https://hostile.invalid' } });
    assert.equal(hostileOrigin.status, 403); assertions++;
    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      const request = http.get(`${base}/api/accounts/a1/cookies`, { headers: { Host: 'hostile.invalid' } }, (response) => { response.resume(); resolve(response.statusCode || 0); });
      request.on('error', reject);
    });
    assert.equal(hostileHostStatus, 403); assertions++;
    process.env.ROCKBASE_MODE = 'server';
    console.log(`[SecretAccessRegression] PASS: ${assertions} role/workspace/no-store/auth cases; authorized owner and Local Mode preserved; no real secret/database writes.`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    process.env = previous;
  }
}
main().catch((error) => { loader._load = originalLoad; console.error(error); process.exitCode = 1; });
