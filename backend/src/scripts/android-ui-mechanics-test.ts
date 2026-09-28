/**
 * Phase 3B — real-device UI mechanics test for the Instagram adapter.
 *
 * Proves the app-agnostic mechanics the adapter depends on actually work on a live AVD:
 * uiautomator hierarchy dump → parse → find a node → tap its centre → the foreground app changes.
 * Uses only pre-installed apps (launcher + Play Store); it never signs in, installs or posts.
 *
 * Requires: Windows Local Mode, a booted test AVD (default Medium_Phone_API_36.1, override with
 * ROCKBASE_AVD_NAME), and a scratch DB migrated for the runtimeService guard.
 */
import assert from 'assert/strict';
import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { AdbInstagramUiAdapter } from '../services/instagram/AdbInstagramUiAdapter';
import { androidRuntime } from '../services/AndroidRuntimeService';

const runFile = promisify(execFile);
const sdkAdb = () => {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  return root ? path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
};

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local') throw new Error('Windows Local Mode required');
  const avd = process.env.ROCKBASE_AVD_NAME || 'Medium_Phone_API_36.1';
  const serial = await androidRuntime.resolveSerial(avd);
  if (!serial) throw new Error(`Test AVD ${avd} is not running; start it first`);
  const adapter = new AdbInstagramUiAdapter(serial);

  // 1. Wake + home so the launcher is the focused surface.
  await androidRuntime.control(serial, { action: 'wake' });
  await androidRuntime.control(serial, { action: 'home' });
  const nodes = await adapter.dumpHierarchy();
  assert.ok(nodes.length > 10, `expected a real hierarchy, got ${nodes.length} nodes`);
  const withText = nodes.filter((node) => node.text);
  assert.ok(withText.length >= 3, 'expected several text nodes (launcher labels)');
  const playStore = nodes.find((node) => node.text === 'Play Store' && node.clickable);
  assert.ok(playStore, 'expected a clickable "Play Store" launcher node');
  assert.ok(playStore!.center.x > 0 && playStore!.center.x < 2000 && playStore!.center.y > 0 && playStore!.center.y < 3000);

  // 2. Evidence screenshot mechanics.
  const evidence = await adapter.captureEvidence('mechanicstest');
  const shot = await fsp.readFile(evidence);
  assert.equal(shot.subarray(1, 4).toString('ascii'), 'PNG');
  assert.ok(shot.length > 10_000, 'evidence screenshot should contain a real frame');

  // 3. Tap the node centre and confirm the foreground app actually changed (Play Store opens).
  await androidRuntime.control(serial, { action: 'tap', x: playStore!.center.x, y: playStore!.center.y });
  let foreground = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const focus = await runFile(sdkAdb(), ['-s', serial, 'shell', 'dumpsys', 'window'], { windowsHide: true }).then((r) => String(r.stdout)).catch(() => '');
    if (/mCurrentFocus=.*com\.android\.vending/.test(focus)) { foreground = 'com.android.vending'; break; }
  }
  assert.equal(foreground, 'com.android.vending', 'tapping the node centre should open Play Store');
  await androidRuntime.control(serial, { action: 'home' });

  console.log(JSON.stringify({ status: 'PASS', serial, nodes: nodes.length, textNodes: withText.length, tapped: { x: playStore!.center.x, y: playStore!.center.y }, foregroundAfterTap: foreground, evidenceBytes: shot.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
