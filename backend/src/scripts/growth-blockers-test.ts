import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { createGrowthBlockersRouter } from '../routes/growthBlockersRoutes';

async function main() {
  process.env.ROCKBASE_MODE = 'server';
  const calls: any[] = [];
  const deps: any = {
    workspaceUser: { findFirst: async (args: any) => { calls.push(['member', args]); return args.where.workspaceId === 'w1' ? { id: 'membership' } : null; } },
    socialAccount: { findMany: async (args: any) => { calls.push(['accounts', args]); return [{ id:'a', workspaceId:'w1', status:'error', sessionHealth:'UNKNOWN', sessionHealthCheckedAt:null, brandTag:'b', username:'private', cookies:'secret' }]; } },
    post: { findMany: async (args: any) => { calls.push(['posts', args]); return [{ id:'p', workspaceId:'w1', status:'failed', updatedAt:new Date('2025-01-01T00:00:00Z'), accountIds:'["a"]', content:'private', results:'private' }]; } },
  };
  const app = express();
  app.use((req: any, _res, next) => { req.user = { id: 'u', role: 'Admin' }; next(); });
  app.use('/api/activity', createGrowthBlockersRouter(deps));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/activity/growth-blockers?workspace_id=w1`);
    const json: any = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(json).sort(), ['accounts','checkedAt','posts','truncated']);
    assert.deepEqual(json.accounts, [{ id:'a', workspaceId:'w1', brandKey:'b', status:'error', sessionHealth:'UNKNOWN', checkedAt:null }]);
    assert.deepEqual(json.posts, [{ id:'p', workspaceId:'w1', status:'failed', updatedAt:'2025-01-01T00:00:00.000Z', accountIds:['a'] }]);
    assert.deepEqual(json.truncated, { accounts:false, posts:false });
    assert.deepEqual(calls[0][1].where, { userId:'u', workspaceId:'w1' });
    assert.deepEqual(calls[1][1].where, { workspaceId:'w1', OR:[{status:{in:['error','logged_out','flagged']}},{sessionHealth:{in:['NEEDS_RELOGIN','CHECKPOINT','EXPIRED']}}] });
    assert.deepEqual(calls[2][1].where, { workspaceId:'w1', status:{in:['failed','error','needs_attention','pending_verify']} });
    assert.equal(JSON.stringify(json).includes('private'), false);
    assert.equal(JSON.stringify(json).includes('secret'), false);
    const foreign = await fetch(`http://127.0.0.1:${address.port}/api/activity/growth-blockers?workspace_id=foreign`);
    assert.equal(foreign.status, 404);
    assert.equal(calls.filter(c => c[0] === 'accounts').length, 1, 'unauthorized scope must be rejected before data reads');
    console.log('growth-blockers focused HTTP test passed');
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
