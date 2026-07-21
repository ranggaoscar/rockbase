import assert from 'assert';

const base = (process.env.ROCKBASE_HERMES_URL || 'http://backend:3010/internal/hermes').replace(/\/$/, '');
const token = process.env.HERMES_INTERNAL_API_TOKEN;
if (!token) throw new Error('HERMES_INTERNAL_API_TOKEN is required');

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const invalid = await fetch(`${base}/accounts/available`, { headers: { Authorization: 'Bearer invalid' } });
  assert.strictEqual(invalid.status, 401);
  const available = await request('/accounts/available');
  assert(available.response.ok && Array.isArray(available.body.accounts));
  const count = await request('/accounts/available/count');
  assert(count.response.ok && typeof count.body.availableCount === 'number');
  const accountId = process.env.HERMES_SMOKE_ACCOUNT_ID || available.body.accounts[0]?.id;
  if (!accountId) throw new Error('No available account; set HERMES_SMOKE_ACCOUNT_ID for staging data');
  const key = `hermes-smoke-${Date.now()}`;
  const payload = { name: `Hermes smoke ${Date.now()}`, type: 'like', targetType: 'post', targetValue: 'https://example.invalid/post', accountIds: [accountId] };
  const first = await request('/shadow-campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  assert(first.response.ok, JSON.stringify(first.body));
  const second = await request('/shadow-campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  assert(second.response.ok && second.body.campaign?.id === first.body.campaign?.id);
  const id = first.body.campaign.id;
  const form = new FormData(); form.append('media', new Blob(['smoke'], { type: 'image/png' }), 'smoke.png');
  const upload = await request(`/campaigns/${id}/media`, { method: 'POST', body: form });
  assert(upload.response.ok, JSON.stringify(upload.body));
  const status = await request(`/campaigns/${id}/status`); assert(status.response.ok);
  const results = await request(`/campaigns/${id}/results`); assert(results.response.ok);
  const serialized = JSON.stringify({ available, count, first, second, upload, status, results });
  for (const forbidden of ['accountPassword', 'password', 'cookies', 'proxy', 'HERMES_INTERNAL_API_TOKEN', '/app/']) assert(!serialized.includes(forbidden), `leak: ${forbidden}`);
  console.log('Hermes staging smoke passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
