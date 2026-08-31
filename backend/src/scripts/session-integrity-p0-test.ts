import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { decrypt, encrypt, getEncryptionKey } from '../utils/encryption';
import { InFlightContextCoordinator, shouldPreserveExistingCookies } from '../services/BrowserManager';
import { shouldCloseHealthCheckContext } from '../services/SessionHealthService';

function withEncryptionKey(value: string | undefined, run: () => void): void {
  const previous = process.env.ENCRYPTION_KEY;
  try {
    if (value === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  }
}

function assertEncryptionKeyValidation(): void {
  withEncryptionKey(undefined, () => {
    assert.throws(() => getEncryptionKey(), /ENCRYPTION_KEY must be configured/);
  });

  withEncryptionKey('not-hex', () => {
    assert.throws(() => getEncryptionKey(), /64 hexadecimal characters/);
  });

  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  withEncryptionKey(validKey, () => {
    assert.equal(getEncryptionKey(), validKey);
  });
}

function assertLegacyCookieCiphertextCompatibility(): void {
  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  withEncryptionKey(validKey, () => {
    const ciphertext = encrypt(JSON.stringify([{ name: 'sessionid', value: 'test' }]));
    assert.match(ciphertext, /^v2:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i);
    assert.deepEqual(JSON.parse(decrypt(ciphertext)), [{ name: 'sessionid', value: 'test' }]);

    const key = Buffer.from(validKey, 'hex');
    const iv = Buffer.alloc(16, 7);
    const cipher = require('crypto').createCipheriv('aes-256-cbc', key, iv);
    const legacy = `${iv.toString('hex')}:${Buffer.concat([cipher.update('legacy-session'), cipher.final()]).toString('hex')}`;
    assert.equal(decrypt(legacy), 'legacy-session');
  });
}

async function assertCookieAndContextRegressionBehavior(): Promise<void> {
  assert.equal(shouldPreserveExistingCookies(0, 'encrypted-existing-cookie-blob'), true);
  assert.equal(shouldPreserveExistingCookies(0, null), false);
  assert.equal(shouldPreserveExistingCookies(1, 'encrypted-existing-cookie-blob'), false);

  let creations = 0;
  let releaseCreation!: () => void;
  const coordinator = new InFlightContextCoordinator<{ id: string }>();
  const create = async () => {
    creations += 1;
    await new Promise<void>((resolve) => { releaseCreation = resolve; });
    return { id: 'shared-context' };
  };
  const first = coordinator.getOrCreate('account-1', create);
  const second = coordinator.getOrCreate('account-1', create);
  assert.equal(creations, 1);
  releaseCreation();
  assert.strictEqual(await first, await second);

  assert.equal(shouldCloseHealthCheckContext(true), false);
  assert.equal(shouldCloseHealthCheckContext(false), true);
}

function assertSessionGuardWiring(): void {
  const root = path.resolve(__dirname, '..');
  const browserManager = fs.readFileSync(path.join(root, 'services', 'BrowserManager.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  const farm = fs.readFileSync(path.join(root, 'services', 'FarmService.ts'), 'utf8');

  assert.match(browserManager, /No usable cookies were captured; the previously saved session was preserved/);
  assert.match(browserManager, /contextCoordinator\.getOrCreate/);
  assert.ok(server.indexOf('await sessionPool.releaseAll()') < server.indexOf('await browserManager.forceKillAll()'));
  assert.match(server, /acknowledgement\?\.\(\{ ok: true, \.\.\.\(result \|\| \{\}\) \}\)/);
  assert.match(farm, /return \{ cookieCount: saved\.cookieCount \}/);
}

async function main(): Promise<void> {
  assertEncryptionKeyValidation();
  assertLegacyCookieCiphertextCompatibility();
  await assertCookieAndContextRegressionBehavior();
  assertSessionGuardWiring();
  console.log('[SessionIntegrityP0Test] PASS: encryption validation, legacy ciphertext compatibility, cookie preservation, context deduplication, health ownership, and session guard wiring.');
}

main().catch((error) => {
  console.error('[SessionIntegrityP0Test] FAIL:', error);
  process.exitCode = 1;
});
