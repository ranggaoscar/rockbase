import assert from 'assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import accountRoutes from '../routes/accountRoutes';
import { androidScheduler } from '../services/AndroidScheduler';

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) throw new Error('Local Mode + scratch DB required');
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.create({ data: { name: 'Account binding test workspace' } });
  const device = await prisma.androidDevice.create({ data: { name: 'test-binding-device', avdName: 'test-binding-avd' } });
  const account = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, platform: 'Instagram', username: 'synthetic-binding', cookies: 'opaque-preserved-cookie-test' } });
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/accounts', accountRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Listener failed');
    const base = `http://127.0.0.1:${address.port}/api/accounts/${account.id}`;
    const patch = async (data: object) => fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await patch({ executionEngine: 'android' })).status, 400);
    const assigned = await patch({ executionEngine: 'android', homeDeviceId: device.id });
    assert.equal(assigned.status, 200, await assigned.text().then(value => value.slice(0, 200)));
    const updated = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(updated.cookies, 'opaque-preserved-cookie-test');
    assert.equal(updated.homeDeviceId, device.id);
    assert.equal(updated.executionEngine, 'android');
    const publicAccount = await fetch(base);
    const payload = (await publicAccount.json() as any).account;
    assert.equal(payload.executionEngine, 'android');
    assert.equal(payload.androidHealth, 'HEALTHY');
    assert.equal(payload.cookies, undefined);
    const blocked = await patch({ androidHealth: 'NEEDS_ATTENTION', androidHealthReason: 'operator review' });
    assert.equal(blocked.status, 200);
    await assert.rejects(() => androidScheduler.submit(account.id), /NEEDS_ATTENTION/);
    assert.equal((await patch({ androidHealth: 'HEALTHY' })).status, 200);
    const pending = await androidScheduler.submit(account.id);
    assert.equal((await patch({ executionEngine: 'chromium', homeDeviceId: null })).status, 409);
    await prisma.androidJob.update({ where: { id: pending.id }, data: { status: 'SKIPPED' } });
    assert.equal((await patch({ executionEngine: 'chromium', homeDeviceId: null })).status, 200);
    assert.equal((await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).cookies, 'opaque-preserved-cookie-test');
    console.log('PASS binding API: invalid rejected, Android home bound, public health exposed, attention blocks, pending switch blocked, cookies preserved');
  } finally {
    server.close();
    await prisma.androidJob.deleteMany({ where: { accountId: account.id } });
    await prisma.socialAccount.delete({ where: { id: account.id } });
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
