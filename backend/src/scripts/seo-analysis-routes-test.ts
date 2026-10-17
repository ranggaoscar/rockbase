import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import Module from 'node:module';
import path from 'node:path';

// Real SEO router, in-memory identity and IPC fixtures. No Prisma/worker/owner DB is opened.
const previous = process.env.ROCKBASE_MODE;
process.env.ROCKBASE_MODE = 'server';
const calls: Array<{ resource: string; workspace: string; method: string }> = [];
const prisma = {
  workspace: { findMany: async ({ where }: any) => where.users?.some?.userId === 'member'
    ? [{ id: 'w1', name: 'Fixture workspace', accounts: [] }] : [] },
};
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, parent: any, isMain: boolean) {
  if (parent?.filename.endsWith(path.join('routes', 'seoRoutes.ts'))) {
    if (name === '@prisma/client') return { PrismaClient: class { constructor() { return prisma; } } };
    if (name === '../services/SeoWorkerService') return {
      seoRequest: async (resource: string, workspace: string, method = 'GET') => {
        calls.push({ resource, workspace, method });
        if (resource === '/brands') return Response.json([]);
        if (resource.startsWith('/scans/2/')) return Response.json({ error: 'Wrong scan workspace' }, { status: 404 });
        return new Response(JSON.stringify({ resource, workspace }), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="fixture.json"' } });
      },
    };
  }
  return originalLoad.call(this, name, parent, isMain);
};

async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-fixture-auth'] !== 'member') { res.status(401).json({ error: 'Fixture auth required' }); return; }
    (req as any).user = { id: 'member', role: 'Operator' }; next();
  });
  try { app.use('/api/seo', require('../routes/seoRoutes').default); } finally { loader._load = originalLoad; }
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/seo`;
  const headers = { 'x-fixture-auth': 'member' };
  let assertions = 0;
  try {
    for (const suffix of ['graph', 'issue-groups', 'export?kind=links&format=json', 'export?kind=actions&priority=high', 'export?kind=issue-groups&format=csv']) {
      assert.equal((await fetch(root + '/scans/1/' + suffix)).status, 401); assertions++;
      const response = await fetch(root + '/scans/1/' + suffix, { headers });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition') || '', /fixture/); assertions += 2;
      const before = calls.length;
      assert.equal((await fetch(root + '/scans/1/' + suffix + (suffix.includes('?') ? '&' : '?') + 'workspace_id=w2', { headers })).status, 404);
      assert(calls.slice(before).every((call) => call.resource === '/brands'), 'Denied scope must never read scan data'); assertions += 2;
      assert.equal((await fetch(root + '/scans/2/' + suffix, { headers })).status, 404); assertions++;
    }
    const forwarded = await (await fetch(root + '/scans/1/export?kind=actions&format=json&q=stone&priority=high&category=metadata&confidence=observed&issue_type=opportunity&untrusted=ignored', { headers })).json() as any;
    assert.match(forwarded.resource, /kind=actions/); assert.match(forwarded.resource, /q=stone/);
    assert(!forwarded.resource.includes('untrusted')); assert.equal(forwarded.workspace, 'w1'); assertions += 4;
    for (const value of ['category=metadata', 'confidence=observed', 'issue_type=opportunity']) {
      assert(forwarded.resource.includes(value)); assertions++;
    }
    assert.equal((await fetch(root + '/scans/1/arbitrary', { headers })).status, 404); assertions++;
    process.env.ROCKBASE_MODE = 'local';
    assert.equal((await fetch(root + '/scans/1/graph', { headers: { ...headers, Origin: 'https://hostile.invalid' } })).status, 403); assertions++;
    const hostileHost = await new Promise<number>((resolve, reject) => {
      const req = http.get(root + '/scans/1/graph', { headers: { ...headers, Host: 'hostile.invalid' } }, (response) => { response.resume(); resolve(response.statusCode || 0); });
      req.on('error', reject);
    });
    assert.equal(hostileHost, 403); assertions++;
    console.log(`[SeoAnalysisRoutes] PASS: ${assertions} auth/workspace/allowlist/download/local-origin assertions; fixture identities and IPC only.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.ROCKBASE_MODE; else process.env.ROCKBASE_MODE = previous;
  }
}
main().catch((error) => { loader._load = originalLoad; console.error(error); process.exitCode = 1; });
