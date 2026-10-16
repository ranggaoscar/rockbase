import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CredentialVault, CredentialKey } from '../services/gsc/WindowsCredentialVault';
import { GscConnection } from '../services/gsc/GscConnection';
import { GSC_SCOPE } from '../services/gsc/GoogleDesktopOAuth';

class MemoryVault implements CredentialVault {
  data = new Map<string, string>(); reads = 0;
  async read(key: CredentialKey) { this.reads++; return this.data.get(key) || null; }
  async write(key: CredentialKey, value: string) { this.data.set(key, value); }
  async delete(key: CredentialKey) { this.data.delete(key); }
}
async function main() {
  const before = process.env.ROCKBASE_MODE;
  process.env.ROCKBASE_MODE = 'local';
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gsc-sa-fixture-'));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const file = path.join(root, 'synthetic.json');
  fs.writeFileSync(file, JSON.stringify({ type: 'service_account', client_email: 'fixture@fixture-project.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }));
  const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const original = digest();
  const vault = new MemoryVault(); let tokenCalls = 0; let revokeCalls = 0; let apiCalls = 0;
  const upstream: typeof fetch = async (input, init) => {
    const url = String(input);
    assert(!url.includes('private_key'));
    if (url.endsWith('/token')) {
      tokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const claim = jwt.verify(body.get('assertion')!, publicKey, { algorithms: ['RS256'], audience: 'https://oauth2.googleapis.com/token' }) as jwt.JwtPayload;
      assert.equal(claim.scope, GSC_SCOPE); assert.equal(claim.iss, 'fixture@fixture-project.iam.gserviceaccount.com');
      assert.equal(claim.sub, undefined); assert.equal(claim.exp! - claim.iat!, 3600);
      return Response.json({ access_token: 'synthetic-token-fixture-only', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.endsWith('/revoke')) { revokeCalls++; throw new Error('Service disconnect must never revoke shared access'); }
    apiCalls++;
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-token-fixture-only');
    return Response.json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] });
  };
  const connection = new GscConnection(vault, path.join(root, 'installation'), upstream);
  try {
    assert.equal((await connection.status()).connected, false);
    await assert.rejects(connection.importServiceAccount('https://evil.invalid/key.json'));
    const imported = await connection.importServiceAccount(file);
    assert.equal(imported.provider, 'service_account'); assert.equal(imported.propertyCount, 1);
    assert.equal(tokenCalls, 1); assert.equal(digest(), original);
    const stored = JSON.parse(vault.data.get('service_account')!);
    assert.deepEqual(Object.keys(stored).sort(), ['client_email', 'private_key']);
    assert(!vault.data.has('tokens'), 'Service access token must stay in memory, not OAuth token storage');
    const safe = JSON.stringify(await connection.status());
    assert(!safe.includes(privateKey) && !safe.includes('fixture-project') && !safe.includes(file));
    assert.equal((await connection.google('/sites')).siteEntry.length, 1); assert.equal(tokenCalls, 1);
    await assert.rejects(connection.connect(), /Disconnect/);
    process.env.ROCKBASE_MODE = 'server'; const reads = vault.reads;
    assert.equal((await connection.status()).enabled, false);
    await assert.rejects(connection.google('/sites'), /disabled in Server Mode/);
    await assert.rejects(connection.importServiceAccount(file), /disabled in Server Mode/);
    assert.equal(vault.reads, reads);
    process.env.ROCKBASE_MODE = 'local';
    const result = await connection.disconnect();
    assert(result.disconnected && !result.revoked && (result as any).sourcePreserved);
    assert.equal(revokeCalls, 0); assert.equal(vault.data.has('service_account'), false); assert.equal(digest(), original);
    const previousCalls = apiCalls;
    await assert.rejects(connection.google('/sites'), /Connect Google/); assert.equal(apiCalls, previousCalls);
    // Switching provider keeps Desktop OAuth available without shared Google revocation.
    await connection.configure({ client_id: '12345-fixture.apps.googleusercontent.com' });
    const desktop = await connection.connect();
    assert.equal(new URL(desktop.authorizationUrl).searchParams.get('scope'), GSC_SCOPE);
    connection.close();
    console.log('[GscServiceAccount] PASS: scoped RS256 assertion, fixed Google endpoint, vault-minimum import, source preserved, no revoke on disconnect, cached-token reuse, Server Mode no-read, Desktop coexistence. Synthetic RSA key only.');
  } finally { connection.close(); process.env.ROCKBASE_MODE = before; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : 'Service-account fixture failed (no credentials emitted).'); process.exitCode = 1; });
