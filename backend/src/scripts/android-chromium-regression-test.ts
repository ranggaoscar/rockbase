import assert from 'assert/strict';
import { PrismaClient } from '@prisma/client';
import { browserManager } from '../services/BrowserManager';

async function main() {
  if (!process.env.DATABASE_URL?.includes('scratch') || process.env.AUTOMATION_ENABLED !== 'true') throw new Error('scratch DB and explicit automation test flag required');
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.create({ data: { name: 'Chromium isolated smoke workspace' } });
  const device = await prisma.androidDevice.create({ data: { name: 'chromium-test-device', avdName: 'no-boot-test-avd' } });
  const account = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, username: 'synthetic-chromium-no-login', platform: 'Instagram' } });
  try {
    const context = await browserManager.getContext(account.id);
    const page = await context.newPage();
    await page.goto('about:blank');
    assert.equal(page.url(), 'about:blank');
    await prisma.socialAccount.update({ where: { id: account.id }, data: { executionEngine: 'android', homeDeviceId: device.id } });
    await assert.rejects(() => browserManager.getContext(account.id), /ANDROID_EXECUTION_NOT_IMPLEMENTED/);
    await context.close();
    console.log('PASS Chromium browser context opens and Android assignment cannot reuse cached Playwright context');
  } finally {
    await browserManager.forceKillAll();
    await prisma.socialAccount.delete({ where: { id: account.id } });
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
