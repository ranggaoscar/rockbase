import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decrypt, encrypt } from '../utils/encryption';
import {
  accountPublicPayload,
  normalizeAccountInput,
  normalizeImportedCookies,
} from '../utils/accountPayload';
import {
  calculateSequentialWaits,
  containsPlatformChallenge,
  normalizeInstagramUsername,
  parseExplicitAccountIds,
  validateInstagramPostUrl,
} from '../services/EngagementPolicy';

const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const previousKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = encryptionKey;

try {
  const encrypted = encrypt('session-secret');
  assert.match(encrypted, /^v2:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i);
  assert.equal(decrypt(encrypted), 'session-secret');

  const publicAccount = accountPublicPayload({
    id: 'a1',
    workspaceId: 'workspace-default',
    username: 'demo',
    platform: 'Instagram',
    status: 'active',
    accountPassword: 'encrypted-password',
    cookies: 'encrypted-cookies',
    email: 'owner@example.com',
  });
  assert.equal(publicAccount.username, 'demo');
  assert.equal(publicAccount.email, 'owner@example.com');
  assert(!('accountPassword' in publicAccount));
  assert(!('cookies' in publicAccount));

  assert.deepEqual(normalizeAccountInput({ username: '  @Demo.User  ', platform: 'instagram' }), {
    username: 'Demo.User',
    platform: 'Instagram',
  });
  assert.throws(() => normalizeAccountInput({ username: '', platform: 'Instagram' }), /Username is required/);
  assert.throws(() => normalizeAccountInput({ username: 'demo', platform: 'facebook' }), /Unsupported platform/);

  const normalizedCookies = normalizeImportedCookies('[{"name":"sessionid","value":"abc","domain":".instagram.com"}]');
  assert.equal(normalizedCookies.cookieCount, 1);
  assert.match(normalizedCookies.serialized, /sessionid/);
  assert.throws(() => normalizeImportedCookies('sessionid=abc; csrftoken=xyz'), /JSON cookie array/);
  assert.throws(() => normalizeImportedCookies('[{"name":"sessionid"}]'), /name and value/);

  assert.deepEqual(parseExplicitAccountIds(['a', 'a', 'b'], 3), ['a', 'b']);
  assert.throws(() => parseExplicitAccountIds(['a', 'b', 'c', 'd'], 3), /limited to 3 accounts/);
  assert.throws(() => parseExplicitAccountIds('a', 3), /accountIds must be an array/);

  assert.equal(validateInstagramPostUrl('https://www.instagram.com/p/ABC123/'), 'https://www.instagram.com/p/ABC123/');
  assert.equal(validateInstagramPostUrl('https://instagram.com/reel/ABC123/?utm_source=x'), 'https://instagram.com/reel/ABC123/');
  assert.throws(() => validateInstagramPostUrl('https://example.com/p/ABC123/'), /Instagram post or reel URL/);
  assert.throws(() => validateInstagramPostUrl('https://www.instagram.com/accounts/login/'), /Instagram post or reel URL/);

  assert.equal(normalizeInstagramUsername(' @valid.user_1 '), 'valid.user_1');
  assert.throws(() => normalizeInstagramUsername('../accounts/login'), /Invalid Instagram username/);

  assert.deepEqual(calculateSequentialWaits([0, 900_000, 1_800_000]), [0, 900_000, 900_000]);
  assert.equal(containsPlatformChallenge('Please verify your account to continue'), true);
  assert.equal(containsPlatformChallenge('Welcome to your feed'), false);

  const engagementRoutes = fs.readFileSync(path.resolve(__dirname, '../routes/engagementRoutes.ts'), 'utf8');
  assert.match(engagementRoutes, /validateInstagramPostUrl\(req\.body\?\.postUrl\)/);
  assert.match(engagementRoutes, /normalizeInstagramUsername\(req\.body\?\.username\)/);
  assert.match(engagementRoutes, /parseExplicitAccountIds\(req\.body\?\.accountIds\)/);
  assert(!/force:\s*true/.test(engagementRoutes), 'direct routes must not bypass active-hours and skip guards');
  for (const routeName of ['like', 'follow', 'comment', 'follow-and-like']) {
    const routeSource = engagementRoutes.split(`router.post('/${routeName}'`, 2)[1].split('\n});', 1)[0];
    assert.match(routeSource, /res\.status\(400\)\.json\(\{ error: err\.message \}\)/);
  }

  console.log('[AccountEngagementHardeningTest] PASS: authenticated encryption, safe account payloads, strict cookie onboarding, bounded targets, correct stagger waits, challenge detection, and guarded direct routes.');
} finally {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousKey;
}
