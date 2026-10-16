import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { GoogleDesktopOAuth, GSC_SCOPE } from '../services/gsc/GoogleDesktopOAuth';
import { WindowsCredentialVault, CredentialVault } from '../services/gsc/WindowsCredentialVault';

class MemoryVault implements CredentialVault {
  data = new Map<string, string>();
  reads = 0;
  async read(key: 'client' | 'tokens') { this.reads++; return this.data.get(key) || null; }
  async write(key: 'client' | 'tokens', value: string) { this.data.set(key, value); }
  async delete(key: 'client' | 'tokens') { this.data.delete(key); }
}
async function main() {
  const before = process.env.ROCKBASE_MODE;
  process.env.ROCKBASE_MODE = 'local';
  const vault = new MemoryVault();
  const access = randomBytes(24).toString('hex');
  const refresh = randomBytes(24).toString('hex');
  const calls: Array<{ url: string; body: URLSearchParams; headers: Headers }> = [];
  let expire = false; let quota = false;
  const upstream: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: new URLSearchParams(String(init?.body || '')), headers: new Headers(init?.headers) });
    if (url.endsWith('/token')) {
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: GSC_SCOPE });
    }
    if (url.endsWith('/revoke')) return new Response('');
    if (quota) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
    if (expire) return Response.json({ error: { message: 'DO_NOT_LEAK' } }, { status: 401 });
    return Response.json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] });
  };
  const oauth = new GoogleDesktopOAuth(vault, upstream);
  try {
    assert.equal((await oauth.status()).configured, false);
    await assert.rejects(oauth.connect(), /Configure/);
    await oauth.configure({ client_id: '123456-fixture.apps.googleusercontent.com', client_secret: 'fixture-client-only' });
    const result = await oauth.connect();
    const url = new URL(result.authorizationUrl);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'), GSC_SCOPE);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert(!url.searchParams.has('code_verifier'));
    assert(!url.searchParams.has('client_secret'));
    const redirect = url.searchParams.get('redirect_uri')!;
    const bad = await fetch(redirect + '?state=forged&code=fixture');
    assert.equal(bad.status, 400); assert.equal(calls.length, 0);
    assert.equal((await oauth.status()).pending, true);
    const callback = new URL(redirect);
    callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'synthetic-authorization-code' }).toString();
    const response = await fetch(callback);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await oauth.status()).connected, true);
    const exchange = calls.find((c) => c.url.endsWith('/token'))!;
    const verifier = exchange.body.get('code_verifier')!;
    assert(verifier.length >= 43 && verifier.length <= 128);
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.equal(exchange.body.get('redirect_uri'), redirect);
    assert.equal(exchange.body.get('grant_type'), 'authorization_code');
    const statusText = JSON.stringify(await oauth.status());
    assert(!statusText.includes(access) && !statusText.includes(refresh));
    assert.equal((await oauth.google('/sites')).siteEntry.length, 1);
    assert.equal(calls.at(-1)!.headers.get('authorization'), `Bearer ${access}`);
    await assert.rejects(oauth.google('/sites/../../https://evil.invalid'), /Unsupported/);

    const tokens = JSON.parse(vault.data.get('tokens')!); tokens.expires_at = 0;
    vault.data.set('tokens', JSON.stringify(tokens));
    await oauth.google('/sites');
    assert(calls.some((c) => c.body.get('grant_type') === 'refresh_token'));
    expire = true;
    await assert.rejects(oauth.google('/sites'), (e: any) => e.code === 'GSC_RECONNECT_REQUIRED' && !e.message.includes('DO_NOT_LEAK'));
    expire = false; quota = true;
    await assert.rejects(oauth.google('/sites'), (e: any) => e.code === 'GSC_QUOTA');
    const count = calls.length;
    await assert.rejects(oauth.google('/sites'), (e: any) => e.code === 'GSC_QUOTA');
    assert.equal(calls.length, count, 'Quota cooldown must prevent upstream retries');
    const disconnected = await oauth.disconnect();
    assert(disconnected.revoked && !vault.data.has('tokens'));
    assert.equal((await oauth.status()).connected, false);
    // A late refresh must not resurrect a disconnected Google credential.
    const raceVault = new MemoryVault();
    raceVault.data.set('client', JSON.stringify({ client_id: '123456-fixture.apps.googleusercontent.com' }));
    raceVault.data.set('tokens', JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: 0 }));
    let unblock!: () => void; let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { unblock = r; });
    const raceOauth = new GoogleDesktopOAuth(raceVault, async (input) => {
      if (String(input).endsWith('/token')) { entered(); await gate; return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, scope: GSC_SCOPE }); }
      return new Response('');
    });
    const lateRefresh = raceOauth.google('/sites');
    const rejected = assert.rejects(lateRefresh, (e: any) => e.code === 'GSC_CANCELLED');
    await started; await raceOauth.disconnect(); unblock(); await rejected;
    assert(!raceVault.data.has('tokens')); raceOauth.close();
    const htmlVault = new MemoryVault();
    htmlVault.data.set('tokens', JSON.stringify({ access_token: access, refresh_token: refresh, expires_at: Date.now() + 3600000 }));
    let htmlCalls = 0;
    const htmlQuota = new GoogleDesktopOAuth(htmlVault, async () => { htmlCalls++; return new Response('<html>busy</html>', { status: 429 }); });
    await assert.rejects(htmlQuota.google('/sites'), (e: any) => e.code === 'GSC_QUOTA');
    await assert.rejects(htmlQuota.google('/sites'), (e: any) => e.code === 'GSC_QUOTA');
    assert.equal(htmlCalls, 1, 'HTML quota responses must still enter cooldown'); htmlQuota.close();
    process.env.ROCKBASE_MODE = 'server';
    const reads = vault.reads;
    assert.equal((await oauth.status()).enabled, false);
    await assert.rejects(oauth.connect(), /disabled in Server Mode/);
    await assert.rejects(oauth.google('/sites'), /disabled in Server Mode/);
    assert.equal(vault.reads, reads, 'Server Mode must never read Local Mode credentials');
    process.env.ROCKBASE_MODE = 'local';

    // Actual OS vault smoke: unique synthetic target only, no real credential enumeration.
    if (process.platform === 'win32') {
      const osVault = new WindowsCredentialVault(path.resolve(__dirname, '../../..') + '/synthetic-vault-probe');
      const key = 'probe-' + randomBytes(8).toString('hex');
      const canary = randomBytes(32).toString('hex');
      try { await osVault.operation('write', key, canary); assert.equal(await osVault.operation('read', key), canary); }
      finally { await osVault.operation('delete', key); }
      assert.equal(await osVault.operation('read', key), null);
      assert.notEqual(osVault.namespace, new WindowsCredentialVault(path.resolve(__dirname, '../../..')).namespace);
    }
    console.log('[GscOAuth] PASS: PKCE/state real loopback callback, readonly scope, refresh, safe failures/quota, revoke/delete, Server Mode isolation; Windows vault synthetic round-trip only. No live Google calls.');
  } finally { oauth.close(); process.env.ROCKBASE_MODE = before; }
}
main().catch(() => { console.error('[GscOAuth] FAIL: inspect focused assertion locally; no secrets emitted.'); process.exitCode = 1; });
