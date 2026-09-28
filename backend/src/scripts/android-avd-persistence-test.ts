import assert from 'assert';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import { androidRuntime } from '../services/AndroidRuntimeService';

const exec = promisify(execFile);
const avdName = process.env.ROCKBASE_AVD_NAME;
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const marker = `/data/local/tmp/rockbase-phase1-${randomUUID()}`;
const content = `rockbase-${randomUUID()}`;

async function shell(serial: string, command: string): Promise<string> {
  const { stdout } = await exec(adb, ['-s', serial, 'shell', command], { timeout: 20000, windowsHide: true });
  return stdout.trim();
}
async function main() {
  if (!avdName) throw new Error('Set ROCKBASE_AVD_NAME explicitly for a known AVD');
  if (!(await androidRuntime.listAvds()).includes(avdName)) throw new Error(`AVD not found: ${avdName}`);
  if (await androidRuntime.resolveSerial(avdName)) throw new Error('AVD already running; refusing to stop an operator-owned emulator');
  const bootTimes: number[] = [];
  let serial: string | null = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      serial = await androidRuntime.start(avdName, 2048, 2);
      bootTimes.push(Date.now() - started);
      assert.strictEqual(await androidRuntime.health(serial), true);
      if (attempt === 0) {
        await shell(serial, `echo ${content} > ${marker}`);
        assert.strictEqual(await shell(serial, `cat ${marker}`), content);
      } else {
        assert.strictEqual(await shell(serial, `cat ${marker}`), content, 'userdata marker missing after restart');
      }
      await androidRuntime.stop(serial);
      serial = null;
    }
    console.log(JSON.stringify({ status: 'PASS', avdName, bootMs: bootTimes, ramMb: 2048, cpuCores: 2, userdataRetained: true }));
  } finally {
    if (serial) await androidRuntime.stop(serial).catch(error => console.error('Manual stop required:', error.message));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });
