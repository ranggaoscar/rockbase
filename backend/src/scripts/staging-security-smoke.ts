import assert from 'node:assert/strict';
import { browserManager } from '../services/BrowserManager';
import { instagramPostingService } from '../services/InstagramPostingService';

const baseUrl = process.env.STAGING_BASE_URL || 'http://127.0.0.1:3010';
const bootstrapToken = process.env.BOOTSTRAP_ADMIN_TOKEN;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!bootstrapToken || !email || !password) {
  throw new Error('Staging bootstrap environment is required');
}

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, init);
}

async function expectStatus(path: string, status: number, init?: RequestInit) {
  const response = await request(path, init);
  assert.equal(response.status, status, `${path} returned ${response.status}`);
  return response;
}

async function assertAnonymousSocketRejected() {
  const opened = await request('/socket.io/?EIO=4&transport=polling');
  assert.equal(opened.status, 200, 'Socket.IO polling handshake failed');
  const openingPacket = await opened.text();
  const match = openingPacket.match(/^0(\{.*\})/);
  assert.ok(match, 'Socket.IO did not return an opening packet');
  const { sid } = JSON.parse(match[1]);
  assert.equal(typeof sid, 'string', 'Socket.IO opening packet has no sid');

  await request(`/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: '40',
  });
  const rejected = await request(`/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`);
  assert.match(await rejected.text(), /Authentication required/, 'Anonymous Socket.IO connection was accepted');
}

async function main() {
async function assertDirectAutomationGuards() {
  const expectDisabled = async (promise: Promise<unknown>) => {
    await assert.rejects(promise, { name: 'AutomationDisabledError' });
  };
  await Promise.all([
    expectDisabled(browserManager.initBrowser()),
    expectDisabled(instagramPostingService.postToInstagram('test-account', 'test-content', 'test-media-path')),
  ]);
}

  await expectStatus('/livez', 200);
  await expectStatus('/readyz', 200);
  await expectStatus('/api/accounts', 401);
  await expectStatus('/api/accounts', 403, { headers: { Authorization: 'Bearer invalid' } });
  await expectStatus('/api/auth/register', 403, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'attacker@example.invalid', password: 'not-used', role: 'Admin' }),
  });

  const bootstrap = await request('/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'x-bootstrap-token': bootstrapToken! },
  });
  assert.ok([201, 409].includes(bootstrap.status), `Bootstrap returned ${bootstrap.status}`);
  await expectStatus('/api/auth/bootstrap-admin', 409, {
    method: 'POST',
    headers: { 'x-bootstrap-token': bootstrapToken! },
  });

  const login = await expectStatus('/api/auth/login', 200, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await login.json() as { token: string };
  assert.equal(typeof token, 'string', 'Login did not return a token');
  await expectStatus('/api/posts', 503, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  await assertAnonymousSocketRejected();
  await assertDirectAutomationGuards();

  console.log('Staging security smoke test passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
