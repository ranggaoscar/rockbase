import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidMedia } from '../services/AndroidMediaService';

async function main() {
  if (!process.env.DATABASE_URL?.includes('scratch')) throw new Error('Scratch test environment required');
  const avd = 'Medium_Phone_API_36.1';
  if (await androidRuntime.resolveSerial(avd)) throw new Error('AVD must be offline before isolated test');
  const serial = await androidRuntime.start(avd, 2048, 2);
  const jobId = randomUUID();
  const local = path.resolve(process.cwd(), 'uploads', `android-staging-test-${jobId}.png`);
  let remote: string | null = null;
  try {
    await fs.mkdir(path.dirname(local), { recursive: true });
    await fs.writeFile(local, await androidRuntime.screenshot(serial));
    const result = await androidMedia.stage(serial, jobId, local);
    remote = result.remote;
    assert.ok(result.bytes > 100 && result.sha256.length === 64);
    assert.equal((await fs.stat(local)).size, result.bytes);
    await assert.rejects(() => androidMedia.cleanup(serial, jobId, '/sdcard/other-file'));
    await androidMedia.cleanup(serial, jobId, remote);
    assert.throws(() => execFileSync(path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      ['-s', serial, 'shell', 'ls', remote!], { stdio: 'ignore', timeout: 12000 }));
    remote = null;
    console.log(JSON.stringify({ status: 'PASS', bytes: result.bytes, transferVerified: true, originalPreservedUntilCleanup: true }));
  } finally {
    if (remote) await androidMedia.cleanup(serial, jobId, remote).catch(() => undefined);
    await fs.rm(local, { force: true });
    await androidRuntime.stop(serial);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
