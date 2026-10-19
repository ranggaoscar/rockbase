import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AuthRequest } from '../middleware/auth';
import { isLocalOwner, noStore, requireLocalSecretOrigin } from '../middleware/secretAccess';
import { getRockBaseMode } from '../middleware/runtimeMode';
import type { BrandWatch, FeedSnapshot, GscInput, GscHistoryPoint, Radar } from '../services/trends/types';
import { buildGscHistoryPoint } from '../services/trends/GscNicheSignals';
import { gscHistoryRevision } from '../services/trends/GscHistoryPrivacy';

export const TREND_COOLDOWN_MS = 15 * 60 * 1000;
interface Brand { key: string; name: string; workspace_id: string }
export interface TrendDependencies {
  store: () => {
    watchlists(workspace: string): BrandWatch[];
    saveWatchlist(workspace: string, watch: BrandWatch): BrandWatch;
    snapshots(limit?: number): FeedSnapshot[];
    latestSnapshot(): FeedSnapshot | null;
    lastGoodSnapshot(): FeedSnapshot | null;
    saveSnapshot(snapshot: FeedSnapshot): FeedSnapshot;
    saveGscHistory?(point: GscHistoryPoint): GscHistoryPoint;
    gscHistory?(workspace: string, brand: string, websiteId?: string, property?: string): GscHistoryPoint[];
  };
  workspaces(): Promise<Array<{ id: string; name: string }>>;
  brands(workspace: string): Promise<Brand[]>;
  gsc(workspace: string, brandKey: string): Promise<{ inputs: GscInput[]; status: string }>;
  fetchFeed(): Promise<FeedSnapshot>;
  buildRadar(watch: BrandWatch, snapshots: FeedSnapshot[], gsc: GscInput[], status: string): Radar;
  drafts: { upsert(args: any): Promise<any>; findFirst(args: any): Promise<any>; findMany?(args: any): Promise<any[]>; update?(args: any): Promise<any> };
}
const PROVENANCE = '\n\n---\nProvenance (review, not a publication claim):\n';
const DRAFT_ID = /^trend-[a-f0-9]{64}$/;
function draftSummary(row: { id: string; title: string | null; content: string; platforms: string; createdAt: Date | string; updatedAt: Date | string }) {
  const at = row.content.indexOf(PROVENANCE);
  const body = at >= 0 ? row.content.slice(0, at) : row.content;
  let provenance: Record<string, unknown> = {};
  try { provenance = at >= 0 ? JSON.parse(row.content.slice(at + PROVENANCE.length)) : {}; } catch { provenance = {}; }
  const pick = (key: string) => typeof provenance[key] === 'string' ? provenance[key] as string : null;
  const format = pick('format') || (row.platforms === '[]' ? 'article' : 'social_post');
  return { id: row.id, title: row.title, excerpt: body.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180), format,
    topic: pick('topic'), classification: pick('classification'), brandKey: pick('brandKey'),
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() };
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

function discovery(value: any, fallback?: BrandWatch['discovery']): NonNullable<BrandWatch['discovery']> {
  const config = value === undefined ? fallback || { minImpressions: 3, minIncrease: 3, minGrowthPct: 25 } : value;
  if (!config || typeof config !== 'object' || !Number.isInteger(config.minImpressions) || config.minImpressions < 1 || config.minImpressions > 1000
    || !Number.isInteger(config.minIncrease) || config.minIncrease < 1 || config.minIncrease > 1000
    || typeof config.minGrowthPct !== 'number' || !Number.isFinite(config.minGrowthPct) || config.minGrowthPct < 1 || config.minGrowthPct > 1000) throw new TrendRouteError(422, 'Invalid niche discovery thresholds.');
  return { minImpressions: config.minImpressions, minIncrease: config.minIncrease, minGrowthPct: config.minGrowthPct };
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
    const revision = gscHistoryRevision();
    const google = await deps.gsc(selected.workspace, selected.brand.key);
    if (revision !== gscHistoryRevision()) throw new TrendRouteError(409, 'GSC connection changed. Reload current evidence.');
    const inputs = google.inputs.map(input => ({ ...input, history: selected.store.gscHistory?.(selected.workspace, selected.brand.key, input.websiteId, input.report.mapping?.property) || [] }));
    const history = inputs.flatMap(input => input.history);
    return { ...selected, data: { ...deps.buildRadar(selected.watch, selected.store.snapshots(96), inputs, google.status),
      historyStatus: { count: history.length, lastCapturedAt: history.map(p => p.capturedAt).sort().at(-1) || null,
        note: 'Private cached GSC history only; same report capture is idempotent, overlapping periods are not independent corroboration. No Google sync.' } } };
  };
  router.get('/brands', handle(async req => {
    const { workspace, rows } = await scope(req); const brands = await deps.brands(workspace);
    const stored = deps.store().watchlists(workspace);
    return { workspaces: rows, brands, watchlists: brands.map(b => stored.find(w => w.brandKey === b.key) || defaults(b)) };
  }));
  router.put('/watchlist', handle(async req => {
    const { workspace, brand, store, watch: previous } = await selectedBrand(req);
    const watch = { brandKey: brand.key, brandName: brand.name, topics: phrases(req.body?.topics), exclude: phrases(req.body?.exclude ?? []), discovery: discovery(req.body?.discovery, previous.discovery), updatedAt: new Date().toISOString() };
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
  router.post('/capture', handle(async req => {
    const { workspace, brand, store } = await selectedBrand(req);
    if (!store.saveGscHistory || !store.gscHistory) throw new TrendRouteError(503, 'Private history storage unavailable.');
    const revision = gscHistoryRevision();
    const google = await deps.gsc(workspace, brand.key);
    if (revision !== gscHistoryRevision()) throw new TrendRouteError(409, 'GSC connection changed; capture discarded.');
    if (!google.inputs.length) throw new TrendRouteError(409, google.status);
    let captured = 0;
    for (const input of google.inputs) {
      const before = store.gscHistory(workspace, brand.key, input.websiteId, input.report.mapping?.property);
      const point = buildGscHistoryPoint(workspace, input);
      const retained = store.saveGscHistory(point);
      if (!before.some(old => old.id === retained.id)) captured++;
    }
    return { captured, historyCount: store.gscHistory(workspace, brand.key).length, status: 'Cached GSC evidence captured locally. No Google request; repeated report is not new growth evidence.' };
  }));
  router.post('/drafts', handle(async req => {
    if (typeof req.body?.recommendation_id !== 'string' || req.body.recommendation_id.length > 200) throw new TrendRouteError(422, 'Choose a saved recommendation.');
    const { workspace, data } = await radar(req);
    const recommendation = data.recommendations.find(r => r.id === req.body.recommendation_id);
    if (!recommendation) throw new TrendRouteError(409, 'Recommendation changed or expired. Reload the current evidence.');
    const id = 'trend-' + createHash('sha256').update(JSON.stringify([workspace, data.brandKey, recommendation.id])).digest('hex');
    const provenance = { source: 'RockBase Trend Radar', classification: recommendation.classification,
      brandKey: recommendation.brandKey, topic: recommendation.topic, format: recommendation.format,
      reason: recommendation.reason, evidence: recommendation.evidence };
    const content = recommendation.content + PROVENANCE + JSON.stringify(provenance, null, 2);
    const draft = await deps.drafts.upsert({ where: { id }, update: {}, create: {
      id, workspaceId: workspace, title: recommendation.title, content, mediaUrls: '[]',
      platforms: JSON.stringify(recommendation.format === 'article' ? [] : ['Instagram']), hashtags: '[]',
    } });
    return { draft: { id: draft.id, title: draft.title, content: draft.content, workspaceId: draft.workspaceId },
      composeUrl: `/compose?draftId=${encodeURIComponent(draft.id)}&workspace_id=${encodeURIComponent(workspace)}` };
  }));
  /** Studio library: Radar drafts in this workspace, newest first, with parsed provenance (read-only). */
  router.get('/drafts', handle(async req => {
    const { workspace } = await scope(req);
    if (!deps.drafts.findMany) throw new TrendRouteError(503, 'Draft listing unavailable.');
    const rows = await deps.drafts.findMany({ where: { workspaceId: workspace, id: { startsWith: 'trend-' } }, orderBy: { updatedAt: 'desc' }, take: 200,
      select: { id: true, title: true, content: true, platforms: true, createdAt: true, updatedAt: true } });
    return { drafts: rows.map(draftSummary) };
  }));
  router.get('/drafts/:id', handle(async req => {
    const { workspace } = await scope(req); const id = String(req.params.id);
    if (!DRAFT_ID.test(id)) throw new TrendRouteError(404, 'Trend draft not found.');
    const draft = await deps.drafts.findFirst({ where: { id, workspaceId: workspace }, select: { id: true, title: true, content: true, workspaceId: true, createdAt: true, updatedAt: true } });
    if (!draft) throw new TrendRouteError(404, 'Draft not found in this workspace.');
    return { draft };
  }));
  /**
   * Save edits to a Radar draft's working copy. Only the body above the
   * provenance block and the title can change; provenance is re-attached from
   * the stored row so evidence can never be edited or dropped from the client.
   */
  router.patch('/drafts/:id', handle(async req => {
    const { workspace } = await scope(req); const id = String(req.params.id);
    if (!DRAFT_ID.test(id)) throw new TrendRouteError(404, 'Trend draft not found.');
    if (!deps.drafts.update) throw new TrendRouteError(503, 'Draft editing unavailable.');
    const body = req.body?.body, title = req.body?.title;
    if (typeof body !== 'string' || body.length > 50_000 || body.includes(PROVENANCE)) throw new TrendRouteError(422, 'Draft body must be text under 50,000 characters without a provenance block.');
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) throw new TrendRouteError(422, 'Title must be 1–200 characters.');
    const existing = await deps.drafts.findFirst({ where: { id, workspaceId: workspace }, select: { id: true, content: true } });
    if (!existing) throw new TrendRouteError(404, 'Draft not found in this workspace.');
    const at = existing.content.indexOf(PROVENANCE);
    const content = body + (at >= 0 ? existing.content.slice(at) : '');
    const draft = await deps.drafts.update({ where: { id }, data: { content, ...(title !== undefined ? { title: title.trim() } : {}) },
      select: { id: true, title: true, content: true, workspaceId: true, createdAt: true, updatedAt: true } });
    return { draft };
  }));
  return router;
}
