import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createGscRouter, propertyCoversWebsite } from '../routes/gscRoutes';
import { localOperator } from '../middleware/runtimeMode';

async function main() {
  const previous = process.env.ROCKBASE_MODE;
  process.env.ROCKBASE_MODE = 'local';
  let saves = 0; let syncs = 0; let clears = 0; let secrets = 0;
  let mapping: any = null;
  let connected = true;
  const oauth: any = {
    status: async () => ({ enabled: process.env.ROCKBASE_MODE === 'local', configured: false, connected, pending: false }),
    configure: async () => { secrets++; }, connect: async () => { secrets++; return {}; },
    disconnect: async () => { secrets++; return { disconnected: true, revoked: true }; },
  };
  const analytics: any = {
    listProperties: async () => [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }],
    mapping: () => mapping,
    saveMapping: (workspace: string, website: string, property: string, brand: string) => { saves++; return mapping = { workspace, website, property, brand }; },
    report: () => ({ pagePerformance: [{ page: 'https://example.com/a' }, { page: 'https://example.com/not-crawled' }] }),
    sync: async () => { syncs++; return null; },
  };
  const seo: any = async (resource: string, workspace: string) => {
    if (resource === '/websites/1/scans') return Response.json([{ id: 12, status: 'completed' }]);
    if (resource === '/scans/12/pages') return Response.json([{ url: 'https://example.com/a', final_url: 'https://example.com/a', status_code: 200, title: 'Fixture title', indexable: true }]);
    if (resource === '/scans/12/issues') return Response.json([{ url: 'https://example.com/a', code: 'missing_description' }]);
    return Response.json([
    { id: 1, workspace_id: 'w1', brand_key: 'actual-brand', base_url: 'https://example.com/', name: 'Fixture' },
    ].filter((s) => s.workspace_id === workspace));
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = process.env.ROCKBASE_MODE === 'local' ? localOperator : { id: 'server-admin', role: 'Admin' }; next(); });
  app.use('/api/gsc', createGscRouter({ oauth, analytics: () => analytics, seo, clearData: () => { clears++; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/gsc`;
  const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(root + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
  try {
    assert(propertyCoversWebsite('sc-domain:example.com', 'https://www.example.com/'));
    assert(!propertyCoversWebsite('sc-domain:example.com', 'https://example.com.attacker.invalid/'));
    assert(!propertyCoversWebsite('https://example.com/path/', 'https://example.com/other/'));
    assert(propertyCoversWebsite('https://example.com/', 'https://example.com/path/'));
    const status = await fetch(root + '/status'); assert.equal(status.status, 200); assert.match(status.headers.get('cache-control')!, /no-store/);
    const deniedOrigin = await post('/connect', {}, { Origin: 'https://evil.invalid' }); assert.equal(deniedOrigin.status, 403); assert.equal(secrets, 0);
    const deniedHost = await new Promise<number>((resolve, reject) => {
      const req = http.get(root + '/status', { headers: { Host: 'evil.invalid' } }, (r) => { r.resume(); resolve(r.statusCode || 0); }); req.on('error', reject);
    });
    assert.equal(deniedHost, 403);
    assert.equal((await post('/mapping', { workspace_id: 'w2', website_id: '1', property: 'sc-domain:example.com' })).status, 404);
    assert.equal((await post('/mapping', { workspace_id: 'w1', website_id: '1', property: 'sc-domain:attacker.invalid' })).status, 422);
    assert.equal((await post('/mapping', { workspace_id: 'w1', website_id: '1', property: 'https://example.com/' })).status, 409, 'A covering but unpermitted property must be rejected');
    assert.equal(saves, 0);
    const mapped = await post('/mapping', { workspace_id: 'w1', website_id: '1', property: 'sc-domain:example.com', brand_key: 'spoofed-brand' });
    assert.equal(mapped.status, 200); assert.equal((await mapped.json() as any).brand, 'actual-brand');
    assert.equal((await post('/sync', { workspace_id: 'w1', website_id: '1', days: 90 })).status, 422); assert.equal(syncs, 0);
    assert.equal((await post('/sync', { workspace_id: 'w1', website_id: '1', days: 7 })).status, 200); assert.equal(syncs, 1);
    const report = await (await fetch(root + '/report?workspace_id=w1&website_id=1')).json() as any;
    assert.equal(report.pagePerformance[0].crawl.status_code, 200);
    assert.equal(report.pagePerformance[0].crawl.issues, 1);
    assert.match(report.pagePerformance[1].crawl.note, /Not observed/);
    connected = false;
    assert.equal((await fetch(root + '/report?workspace_id=w1&website_id=1')).status, 409, 'Cached analytics must be gated after disconnect');
    connected = true;
    process.env.ROCKBASE_MODE = 'server';
    assert.equal((await fetch(root + '/status')).status, 200);
    const reads = secrets;
    for (const path of ['/connect', '/config', '/service-account', '/disconnect', '/sync', '/mapping']) {
      const r = await post(path, {}); assert.equal(r.status, 409); assert.match(r.headers.get('cache-control')!, /no-store/);
    }
    assert.equal((await fetch(root + '/report?workspace_id=w1&website_id=1')).status, 409);
    assert.equal(secrets, reads); assert.equal(clears, 0);
    process.env.ROCKBASE_MODE = 'local';
    assert.equal((await post('/disconnect', {})).status, 200); assert.equal(clears, 1);
    console.log('[GscRoutes] PASS: Local owner/origin/host/no-store, Server Mode isolation, property domain/permission mapping, actual brand not client brand, period validation and explicit disconnect. Fixture data only.');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); process.env.ROCKBASE_MODE = previous; }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'GSC route fixture failed'); process.exitCode = 1; });
