import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createStudioRouter } from '../routes/studioDraftRoutes';
import { localOperator } from '../middleware/runtimeMode';

async function main() {
  const previous = process.env.ROCKBASE_MODE;
  process.env.ROCKBASE_MODE = 'local';
  let writes = 0; let brandReads = 0; let brandsDown = false;
  const drafts = new Map<string, any>();
  // A Radar row in the same table: the Studio router must never list, read or edit it.
  const trendId = 'trend-' + 'a'.repeat(64);
  drafts.set(trendId, { id: trendId, workspaceId: 'w1', title: 'Radar brief', content: 'Radar body', mediaUrls: '[]', platforms: '[]', hashtags: '[]', createdAt: new Date(), updatedAt: new Date() });
  const members: Record<string, string[]> = { op: ['w1'], viewer: ['w1'], outsider: ['w2'], admin: ['w2'] };
  const users: Record<string, any> = { op: { id: 'op', role: 'Operator' }, viewer: { id: 'viewer', role: 'Viewer' }, outsider: { id: 'outsider', role: 'Operator' }, admin: { id: 'admin', role: 'Admin' } };
  const all = [{ id: 'w1', name: 'Fixture one' }, { id: 'w2', name: 'Fixture two' }];
  const pick = (row: any) => row && ({ id: row.id, workspaceId: row.workspaceId, title: row.title, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt });
  const deps: any = {
    workspaces: async (userId: string | null) => userId === null ? all : all.filter(w => members[userId]?.includes(w.id)),
    brands: async (workspace: string) => { brandReads++; if (brandsDown) throw new Error('down'); return workspace === 'w1' ? [{ key: 'Magrade' }] : [{ key: 'Other' }]; },
    drafts: {
      create: async ({ data }: any) => { if (drafts.has(data.id)) throw new Error('unique'); writes++; drafts.set(data.id, { ...data, createdAt: new Date(), updatedAt: new Date() }); return pick(drafts.get(data.id)); },
      upsert: async ({ where, create }: any) => { await new Promise(r => setTimeout(r, 5)); if (!drafts.has(where.id)) { writes++; drafts.set(where.id, { ...create, createdAt: new Date(), updatedAt: new Date() }); } return pick(drafts.get(where.id)); },
      findFirst: async ({ where }: any) => { const d = drafts.get(where.id); return d?.workspaceId === where.workspaceId ? pick(d) : null; },
      findMany: async ({ where }: any) => [...drafts.values()].filter(d => d.workspaceId === where.workspaceId && d.id.startsWith(where.id.startsWith)).map(pick),
      update: async ({ where, data }: any) => { writes++; const d = drafts.get(where.id); Object.assign(d, data, { updatedAt: new Date() }); return pick(d); },
    },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const who = req.headers['x-test-user']; if (typeof who === 'string') (req as any).user = users[who]; else if (process.env.ROCKBASE_MODE === 'local') (req as any).user = localOperator; next(); });
  app.use('/api/studio', createStudioRouter(deps));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/studio`;
  const call = (url: string, body?: any, method = body ? 'POST' : 'GET', headers: Record<string, string> = {}) =>
    fetch(root + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const as = (user: string) => ({ 'x-test-user': user });
  const blank = { workspace_id: 'w1', format: 'article', source: { kind: 'blank' } };
  let assertions = 0;
  try {
    // ── Local Mode: create ────────────────────────────────────────────────
    const created = await call('/drafts', { ...blank, title: '  Marmer care  ', body: 'First notes' });
    assert.equal(created.status, 200); assert.match(created.headers.get('cache-control') || '', /no-store/); assertions += 2;
    const a = (await created.json() as any).draft;
    assert.match(a.id, /^studio-[a-f0-9]{32}$/); assert.doesNotMatch(a.id, /^trend-/); assert.equal(a.title, 'Marmer care'); assert.equal(a.body, 'First notes');
    assert.equal(a.format, 'article'); assert.equal(a.brandKey, null); assert.equal(a.source.kind, 'blank'); assert.equal(a.workspaceId, 'w1'); assertions += 8;
    assert.equal(drafts.get(a.id).platforms, '[]'); assert.equal(drafts.get(a.id).accountIds, undefined); assert.equal(brandReads, 0); assertions += 3;
    const branded = await call('/drafts', { ...blank, format: 'reel', brand_key: 'Magrade' });
    const b = (await branded.json() as any).draft; assert.equal(branded.status, 200); assert.equal(b.brandKey, 'Magrade'); assert.equal(b.format, 'reel'); assert.equal(b.title, ''); assertions += 4;
    const second = (await (await call('/drafts', blank)).json() as any).draft; assert.notEqual(second.id, a.id); assertions++;
    // ── Validation (422) and workspace (404) ──────────────────────────────
    const before = writes;
    for (const bad of [
      { ...blank, format: 'caption' }, { ...blank, format: undefined }, { ...blank, source: undefined }, { ...blank, source: { kind: 'radar' } },
      { ...blank, brand_key: 'Other' }, { ...blank, brand_key: 42 }, { ...blank, title: 'x'.repeat(201) }, { ...blank, body: 'x'.repeat(50_001) },
      { ...blank, body: 'forged\n\n---\nProvenance (review, not a publication claim):\n{}' }, { ...blank, workspace_id: ['w1'] },
      { ...blank, source: { kind: 'browser_import', browser_id: '../etc' } },
    ]) { assert.equal((await call('/drafts', bad)).status, 422, JSON.stringify(bad).slice(0, 80)); assertions++; }
    assert.equal((await call('/drafts', { ...blank, workspace_id: 'w-missing' })).status, 404); assertions++;
    brandsDown = true; assert.equal((await call('/drafts', { ...blank, brand_key: 'Magrade' })).status, 503); brandsDown = false; assertions++;
    assert.equal(writes, before); assertions++;
    // ── Library: own namespace, own workspace ─────────────────────────────
    const listed = (await (await call('/drafts?workspace_id=w1')).json() as any).drafts;
    assert.equal(listed.length, 3); assert(listed.every((d: any) => d.id.startsWith('studio-'))); assert(listed.every((d: any) => !('body' in d) && !/Provenance/.test(d.excerpt))); assertions += 3;
    assert.equal((await (await call('/drafts?workspace_id=w2')).json() as any).drafts.length, 0); assertions++;
    assert.equal((await call(`/drafts/${a.id}?workspace_id=w2`)).status, 404); assertions++;
    assert.equal((await call(`/drafts/${trendId}?workspace_id=w1`)).status, 404); assertions++;
    assert.equal((await call(`/drafts/${a.id}?workspace_id=w1`)).status, 200); assertions++;
    // ── Edit keeps format, brand and source server-side ───────────────────
    const stored = drafts.get(b.id).content as string; const tail = stored.slice(stored.indexOf('\n\n---\nProvenance'));
    assert.equal((await call(`/drafts/${b.id}`, { workspace_id: 'w2', body: 'x' }, 'PATCH')).status, 404); assertions++;
    assert.equal((await call(`/drafts/${trendId}`, { workspace_id: 'w1', body: 'x' }, 'PATCH')).status, 404); assertions++;
    assert.equal((await call(`/drafts/${b.id}`, { workspace_id: 'w1', body: 'hook' + tail }, 'PATCH')).status, 422); assertions++;
    assert.equal((await call(`/drafts/${b.id}`, { workspace_id: 'w1', title: 'no body' }, 'PATCH')).status, 422); assertions++;
    const edited = await call(`/drafts/${b.id}`, { workspace_id: 'w1', body: 'Hook, beats, on-screen text', title: 'Reel v2', format: 'article', brand_key: null, source: { kind: 'blank' } }, 'PATCH');
    const e = (await edited.json() as any).draft;
    assert.equal(edited.status, 200); assert.equal(e.body, 'Hook, beats, on-screen text'); assert.equal(e.title, 'Reel v2'); assert.equal(e.format, 'reel'); assert.equal(e.brandKey, 'Magrade'); assert.equal(drafts.get(b.id).content, 'Hook, beats, on-screen text' + tail); assertions += 6;
    assert.equal(drafts.get(trendId).content, 'Radar body'); assertions++;
    // ── Move from browser: idempotent per workspace + browser id ──────────
    const move = { ...blank, format: 'social_post', title: 'Old note', body: 'kept in browser', source: { kind: 'browser_import', browser_id: 'note-abc12', browser_created_at: '2026-09-01T00:00:00.000Z' } };
    const moveWrites = writes;
    const moved = await Promise.all([call('/drafts', move), call('/drafts', move)]);
    const [m1, m2] = await Promise.all(moved.map(r => r.json() as Promise<any>));
    assert(moved.every(r => r.status === 200)); assert.equal(m1.draft.id, m2.draft.id); assert.equal(writes, moveWrites + 1); assertions += 3;
    assert.equal(m1.draft.source.kind, 'browser_import'); assert.equal(m1.draft.source.browserId, 'note-abc12'); assert.equal(m1.draft.source.browserCreatedAt, '2026-09-01T00:00:00.000Z'); assertions += 3;
    const elsewhere = (await (await call('/drafts', { ...move, workspace_id: 'w2' })).json() as any).draft;
    assert.notEqual(elsewhere.id, m1.draft.id); assert.equal(elsewhere.workspaceId, 'w2'); assertions += 2;
    // ── Local origin gate ─────────────────────────────────────────────────
    assert.equal((await call('/drafts?workspace_id=w1', undefined, 'GET', { Origin: 'https://evil.invalid' })).status, 403); assertions++;
    assert.equal((await call('/drafts', blank, 'POST', { Origin: 'https://evil.invalid' })).status, 403); assertions++;
    const host = await new Promise<number>((resolve, reject) => { const req = http.get(root + '/drafts', { headers: { Host: 'evil.invalid' } }, r => { r.resume(); resolve(r.statusCode || 0); }); req.on('error', reject); });
    assert.equal(host, 403); assertions++;
    // ── Server Mode: membership, not role, decides the workspace ──────────
    process.env.ROCKBASE_MODE = 'server';
    assert.equal((await call('/drafts?workspace_id=w1')).status, 401); assertions++;
    const memberList = await call('/drafts?workspace_id=w1', undefined, 'GET', as('op'));
    assert.equal(memberList.status, 200); assert.equal((await memberList.json() as any).drafts.length, 4); assertions += 2;
    assert.equal((await call('/drafts', blank, 'POST', as('op'))).status, 200); assertions++;
    assert.equal((await call('/drafts?workspace_id=w1', undefined, 'GET', as('viewer'))).status, 200); assertions++;
    const serverWrites = writes;
    assert.equal((await call('/drafts', blank, 'POST', as('viewer'))).status, 403); assertions++;
    assert.equal((await call(`/drafts/${a.id}`, { workspace_id: 'w1', body: 'viewer' }, 'PATCH', as('viewer'))).status, 403); assertions++;
    for (const user of ['outsider', 'admin']) {
      assert.equal((await call('/drafts?workspace_id=w1', undefined, 'GET', as(user))).status, 404); assertions++;
      assert.equal((await call(`/drafts/${a.id}?workspace_id=w1`, undefined, 'GET', as(user))).status, 404); assertions++;
      assert.equal((await call(`/drafts/${a.id}`, { workspace_id: 'w1', body: 'takeover' }, 'PATCH', as(user))).status, 404); assertions++;
      assert.equal((await call('/drafts', blank, 'POST', as(user))).status, 404); assertions++;
    }
    assert.equal(writes, serverWrites); assert.equal(drafts.get(a.id).content.startsWith('First notes'), true); assertions += 2;
    assert.equal((await call(`/drafts/${a.id}?workspace_id=w2`, undefined, 'GET', as('outsider'))).status, 404); assertions++;
    // ── No side effects beyond the Draft table ────────────────────────────
    const sourceText = fs.readFileSync(path.join(__dirname, '../routes/studioDraftRoutes.ts'), 'utf8');
    const imports = [...sourceText.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
    assert.deepEqual(imports, ['express', 'node:crypto', '../middleware/auth', '../middleware/secretAccess', '../middleware/runtimeMode']);
    assert.doesNotMatch(sourceText, /\bfetch\(|require\(|scheduledPost|\.post\.|\.queue/); assertions += 2;
    console.log(`[StudioDraftRoutes] PASS ${assertions} assertions: studio-namespace/no-store/validation-422/cross-workspace-404/radar-isolation/meta-preserving-edit/idempotent-browser-move/local-origin/server-membership/role-gated-writes; zero queues/posts/Google.`);
  } finally { await new Promise<void>(r => server.close(() => r())); if (previous === undefined) delete process.env.ROCKBASE_MODE; else process.env.ROCKBASE_MODE = previous; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
