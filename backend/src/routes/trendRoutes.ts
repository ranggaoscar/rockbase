import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AuthRequest } from '../middleware/auth';
import { isLocalOwner, noStore, requireLocalSecretOrigin } from '../middleware/secretAccess';
import { getRockBaseMode } from '../middleware/runtimeMode';
import type { BrandWatch, FeedSnapshot, GscInput, Radar } from '../services/trends/types';

export const TREND_COOLDOWN_MS = 15 * 60 * 1000;
interface Brand { key: string; name: string; workspace_id: string }
interface TrendDependencies {
  store: () => {
    watchlists(workspace: string): BrandWatch[];
    saveWatchlist(workspace: string, watch: BrandWatch): BrandWatch;
    snapshots(limit?: number): FeedSnapshot[];
    latestSnapshot(): FeedSnapshot | null;
    lastGoodSnapshot(): FeedSnapshot | null;
    saveSnapshot(snapshot: FeedSnapshot): FeedSnapshot;
  };
  workspaces(): Promise<Array<{ id: string; name: string }>>;
  brands(workspace: string): Promise<Brand[]>;
  gsc(workspace: string, brandKey: string): Promise<{ inputs: GscInput[]; status: string }>;
  fetchFeed(): Promise<FeedSnapshot>;
  buildRadar(watch: BrandWatch, snapshots: FeedSnapshot[], gsc: GscInput[], status: string): Radar;
  drafts: { upsert(args: any): Promise<any>; findFirst(args: any): Promise<any> };
}
class TrendRouteError extends Error { constructor(public status: number, message: string) { super(message); } }
const defaults = (brand: Brand): BrandWatch => ({
  brandKey: brand.key, brandName: brand.name,
  topics: /magrade/i.test(brand.name) ? ['marmer', 'granit', 'batu alam', 'travertine', 'perawatan marmer', 'jenis marmer']
    : /global stone/i.test(brand.name) ? ['granit', 'batu alam', 'fasad', 'proyek konstruksi', 'marmer', 'arsitektur']
      : ['marmer', 'natural stone', 'travertine', 'interior', 'arsitektur', 'villa'], exclude: [], updatedAt: '',
});
function phrases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 100 || /[\u0000-\u001f]/.test(v))) throw new TrendRouteError(422, 'Use up to 30 nonempty phrases of at most 100 characters.');
  return [...new Set(value.map(v => v.trim()))];
}

/** Local-only owner tool. Never imports or invokes a publishing/queue service. */
export function createTrendRouter(deps: TrendDependencies): Router {
  const router = Router(); let refreshing = false;
  router.use(noStore);
  router.use((req: AuthRequest, res, next) => {
    if (getRockBaseMode() !== 'local') { res.status(409).json({ error: 'TREND_LOCAL_ONLY' }); return; }
    if (!isLocalOwner(req)) { res.status(403).json({ error: 'TREND_LOCAL_OWNER_REQUIRED' }); return; }
    requireLocalSecretOrigin(req, res, next);
  });
  const handle = (fn: (req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: any) => {
    try { res.json(await fn(req)); }
    catch (error) { res.status(error instanceof TrendRouteError ? error.status : 503).json({ error: error instanceof TrendRouteError ? error.message : 'Trend operation unavailable; retained data was not replaced.' }); }
  };
  const scope = async (req: AuthRequest) => {
    const workspace = req.method === 'GET' ? req.query.workspace_id : req.body?.workspace_id;
    const rows = await deps.workspaces();
    if (workspace !== undefined && (typeof workspace !== 'string' || workspace.length > 200)) throw new TrendRouteError(422, 'Invalid workspace.');
    const selected = workspace ? rows.find(w => w.id === workspace) : rows[0];
    if (!selected) throw new TrendRouteError(404, 'Workspace not found.');
    return { workspace: selected.id, rows };
  };
  const selectedBrand = async (req: AuthRequest) => {
    const { workspace } = await scope(req);
    const key = req.method === 'GET' ? req.query.brand_key : req.body?.brand_key;
    if (typeof key !== 'string' || !key || key.length > 160) throw new TrendRouteError(422, 'Choose an existing brand.');
    const brand = (await deps.brands(workspace)).find(b => b.key === key && b.workspace_id === workspace);
    if (!brand) throw new TrendRouteError(404, 'Brand not found in this workspace.');
    const store = deps.store();
    const watch = store.watchlists(workspace).find(w => w.brandKey === key) || defaults(brand);
    return { workspace, brand, watch, store };
  };
  const radar = async (req: AuthRequest) => {
    const selected = await selectedBrand(req);
    const google = await deps.gsc(selected.workspace, selected.brand.key);
    return { ...selected, data: deps.buildRadar(selected.watch, selected.store.snapshots(96), google.inputs, google.status) };
  };
  router.get('/brands', handle(async req => {
    const { workspace, rows } = await scope(req); const brands = await deps.brands(workspace);
    const stored = deps.store().watchlists(workspace);
    return { workspaces: rows, brands, watchlists: brands.map(b => stored.find(w => w.brandKey === b.key) || defaults(b)) };
  }));
  router.put('/watchlist', handle(async req => {
    const { workspace, brand, store } = await selectedBrand(req);
    const watch = { brandKey: brand.key, brandName: brand.name, topics: phrases(req.body?.topics), exclude: phrases(req.body?.exclude ?? []), updatedAt: new Date().toISOString() };
    return store.saveWatchlist(workspace, watch);
  }));
  router.post('/refresh', handle(async req => {
    const { workspace } = await scope(req); const store = deps.store(); const latest = store.latestSnapshot();
    const existing = store.watchlists(workspace);
    for (const brand of await deps.brands(workspace)) {
      if (!existing.some(w => w.brandKey === brand.key)) store.saveWatchlist(workspace, { ...defaults(brand), updatedAt: new Date().toISOString() });
    }
    if (refreshing) throw new TrendRouteError(409, 'Feed refresh already running.');
    const until = latest ? Date.parse(latest.fetchedAt) + TREND_COOLDOWN_MS : 0;
    if (Number.isFinite(until) && Date.now() < until) return { cached: true, snapshot: latest, cooldownUntil: new Date(until).toISOString() };
    refreshing = true;
    try { const snapshot = store.saveSnapshot(await deps.fetchFeed()); return { cached: false, snapshot, cooldownUntil: new Date(Date.parse(snapshot.fetchedAt) + TREND_COOLDOWN_MS).toISOString() }; }
    finally { refreshing = false; }
  }));
  router.get('/radar', handle(async req => (await radar(req)).data));
  router.post('/drafts', handle(async req => {
    if (typeof req.body?.recommendation_id !== 'string' || req.body.recommendation_id.length > 200) throw new TrendRouteError(422, 'Choose a saved recommendation.');
    const { workspace, data } = await radar(req);
    const recommendation = data.recommendations.find(r => r.id === req.body.recommendation_id);
    if (!recommendation) throw new TrendRouteError(409, 'Recommendation changed or expired. Reload the current evidence.');
    const id = 'trend-' + createHash('sha256').update(JSON.stringify([workspace, data.brandKey, recommendation.id])).digest('hex');
    const provenance = { source: 'RockBase Trend Radar', classification: recommendation.classification,
      brandKey: recommendation.brandKey, topic: recommendation.topic, format: recommendation.format,
      reason: recommendation.reason, evidence: recommendation.evidence };
    const content = recommendation.content + '\n\n---\nProvenance (review, not a publication claim):\n' + JSON.stringify(provenance, null, 2);
    const draft = await deps.drafts.upsert({ where: { id }, update: {}, create: {
      id, workspaceId: workspace, title: recommendation.title, content, mediaUrls: '[]',
      platforms: JSON.stringify(recommendation.format === 'article' ? [] : ['Instagram']), hashtags: '[]',
    } });
    return { draft: { id: draft.id, title: draft.title, content: draft.content, workspaceId: draft.workspaceId },
      composeUrl: `/compose?draftId=${encodeURIComponent(draft.id)}&workspace_id=${encodeURIComponent(workspace)}` };
  }));
  router.get('/drafts/:id', handle(async req => {
    const { workspace } = await scope(req); const id = String(req.params.id);
    if (!/^trend-[a-f0-9]{64}$/.test(id)) throw new TrendRouteError(404, 'Trend draft not found.');
    const draft = await deps.drafts.findFirst({ where: { id, workspaceId: workspace }, select: { id: true, title: true, content: true, workspaceId: true } });
    if (!draft) throw new TrendRouteError(404, 'Draft not found in this workspace.');
    return { draft };
  }));
  return router;
}
