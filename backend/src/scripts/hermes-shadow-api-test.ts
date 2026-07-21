import assert from 'assert';
import { authenticateHermesInternal } from '../middleware/hermesAuth';
import { hermesSafeAccount, hermesSafeResult } from '../routes/hermesShadowCampaignRoutes';

function response() {
  return { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
}

async function main() {
  const previous = process.env.HERMES_INTERNAL_API_TOKEN;
  process.env.HERMES_INTERNAL_API_TOKEN = 'hermes-test-token';
  const valid = response(); let called = false;
  authenticateHermesInternal({ headers: { authorization: 'Bearer hermes-test-token' } } as any, valid as any, () => { called = true; });
  assert(called, 'valid Hermes token should authenticate');
  const invalid = response();
  authenticateHermesInternal({ headers: { authorization: 'Bearer wrong' } } as any, invalid as any, () => { throw new Error('invalid token accepted'); });
  assert.strictEqual(invalid.statusCode, 401);

  const account = hermesSafeAccount({ id: 'a1', username: 'demo', platform: 'Instagram', status: 'active', brandTag: null, lastActive: null, sessionHealth: 'HEALTHY', sessionHealthCheckedAt: null, accountPassword: 'secret', cookies: 'cookie' });
  assert(!('accountPassword' in account) && !('cookies' in account) && !('email' in account));
  const result = hermesSafeResult({ id: 'x', accountId: 'a1', actionType: 'post', status: 'failed', result: JSON.stringify({ error: 'failed' }), scheduledAt: null, executedAt: null });
  assert(!JSON.stringify(result).includes('cookie') && !JSON.stringify(result).includes('password'));
  if (previous === undefined) delete process.env.HERMES_INTERNAL_API_TOKEN; else process.env.HERMES_INTERNAL_API_TOKEN = previous;
  console.log('Hermes shadow API targeted tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
