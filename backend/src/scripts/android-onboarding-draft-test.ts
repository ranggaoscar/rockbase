import assert from 'assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import accountRoutes from '../routes/accountRoutes';
import draftRoutes from '../routes/androidImageDraftRoutes';
import { androidScheduler } from '../services/AndroidScheduler';

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) throw new Error('Local Mode + scratch database required');
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.create({ data: { id: 'workspace-default', name: 'Isolated API test workspace' } });
  const device = await prisma.androidDevice.create({ data: { name: 'Draft-Test-Device', avdName: 'unbooted-draft-avd' } });
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/accounts', accountRoutes); app.use('/api/android/image-drafts', draftRoutes);
  const server = app.listen(0, '127.0.0.1');
  let uploaded: string | null = null;
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Listener failed');
    const url = `http://127.0.0.1:${address.port}`;
    const create = await fetch(url + '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'synthetic_draft', platform: 'Instagram', executionEngine: 'android', homeDeviceId: device.id }) });
    assert.equal(create.status, 201, await create.text().then(v => v.slice(0, 200)));
    const account = (await prisma.socialAccount.findFirstOrThrow({ where: { username: 'synthetic_draft' } }));
    assert.equal(account.androidHealth, 'NEEDS_ATTENTION');
    assert.equal(account.androidLastVerifiedAt, null);
    const healthy = await fetch(url + `/api/accounts/${account.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ androidHealth: 'HEALTHY' }) });
    assert.equal(healthy.status, 409);
    const image = await fs.readFile(path.resolve(process.cwd(), '..', 'docs', 'images', 'dashboard.png'));
    const draft = async (caption: string, key: string) => {
      const form = new FormData(); form.append('accountId', account.id); form.append('caption', caption); form.append('idempotencyKey', key); form.append('media', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'test.png');
      return fetch(url + '/api/android/image-drafts', { method: 'POST', body: form });
    };
    const first = await draft('Safe synthetic caption; not published', 'phase3-draft-retry');
    assert.equal(first.status, 201, await first.clone().text().then(v => v.slice(0, 200)));
    const job = (await first.json() as any).job;
    uploaded = job.mediaPath;
    assert.equal(job.status, 'DRAFT');
    const repeated = await draft('Safe synthetic caption; not published', 'phase3-draft-retry');
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json() as any).job.id, job.id);
    assert.equal((await draft('Different caption', 'phase3-draft-retry')).status, 409);
    const approval = await fetch(url + `/api/android/image-drafts/${job.id}/approve`, { method: 'POST' });
    assert.equal(approval.status, 409);
    assert.equal((await androidScheduler.run(job.id)).status, 'SKIPPED');
    assert.equal((await prisma.androidJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'DRAFT');
    assert.equal(await prisma.androidJob.count({ where: { accountId: account.id } }), 1);
    console.log('PASS onboarding/draft: manual verification required, same key deduplicated, mismatch rejected, approval blocked, no device/Instagram action');
    await prisma.androidJob.delete({ where: { id: job.id } });
    await prisma.socialAccount.delete({ where: { id: account.id } });
  } finally {
    server.close();
    if (uploaded) await fs.unlink(uploaded).catch(() => undefined);
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
