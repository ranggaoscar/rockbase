import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { AuthRequest } from '../middleware/auth';
import { isLocalOwner, noStore, requireLocalSecretOrigin } from '../middleware/secretAccess';
import { getRockBaseMode } from '../middleware/runtimeMode';

/**
 * Studio draft store — blank drafts written in RockBase Studio, kept as Prisma
 * `Draft` rows next to Radar briefs. Ids are `studio-<32 hex>`, a namespace the
 * `trend-<sha256>` Radar ids can never enter, and each router only reads its own.
 *
 * Local Mode: the loopback local owner, behind the same origin gate as Trends.
 * Server Mode: WorkspaceUser membership (Admin is not a bypass); writes need Admin/Operator.
 * Never imports or invokes a publishing, queue or Google service.
 */
export interface StudioDependencies {
  /** Workspaces the caller may use. `null` = the Local Mode owner, who owns every workspace. */
  workspaces(userId: string | null): Promise<Array<{ id: string; name: string }>>;
  brands(workspace: string): Promise<Array<{ key: string }>>;
  drafts: { create(args: any): Promise<any>; upsert(args: any): Promise<any>; findFirst(args: any): Promise<any>; findMany(args: any): Promise<any[]>; update(args: any): Promise<any> };
}

export const STUDIO_FORMATS = ['article', 'social_post', 'reel'] as const;
type StudioFormat = typeof STUDIO_FORMATS[number];
const PROVENANCE = '\n\n---\nProvenance (review, not a publication claim):\n';
const DRAFT_ID = /^studio-[a-f0-9]{32}$/;
const BROWSER_ID = /^[\w-]{1,100}$/;
const WRITE_ROLES = ['Admin', 'Operator'];
const COLUMNS = { id: true, workspaceId: true, title: true, content: true, createdAt: true, updatedAt: true } as const;

class StudioRouteError extends Error { constructor(public status: number, message: string) { super(message); } }

interface Row { id: string; workspaceId: string; title: string | null; content: string; createdAt: Date | string; updatedAt: Date | string }
function parse(row: Row) {
  const at = row.content.indexOf(PROVENANCE);
  const body = at >= 0 ? row.content.slice(0, at) : row.content;
  let meta: Record<string, any> = {};
  try { meta = at >= 0 ? JSON.parse(row.content.slice(at + PROVENANCE.length)) : {}; } catch { meta = {}; }
  const format: StudioFormat = STUDIO_FORMATS.includes(meta.format) ? meta.format : 'article';
  return { id: row.id, workspaceId: row.workspaceId, title: row.title || '', body, format,
    brandKey: typeof meta.brandKey === 'string' ? meta.brandKey : null,
    source: meta.source && typeof meta.source === 'object' ? meta.source : { kind: 'unknown' },
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() };
}
const summary = (row: Row) => {
  const { body, ...rest } = parse(row);
  return { ...rest, excerpt: body.replace(/^#+\s*/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) };
};

function text(value: unknown, field: string, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new StudioRouteError(422, `${field} must be text under ${max.toLocaleString('en')} characters.`);
  if (value.includes(PROVENANCE)) throw new StudioRouteError(422, `${field} cannot contain a provenance block.`);
  return value;
}

/** Server-authored source record. The client picks a kind; it can never write free-form provenance. */
function source(value: any): { id: (workspace: string) => string; record: Record<string, string> } {
  const fresh = () => 'studio-' + randomBytes(16).toString('hex');
  const kind = value?.kind;
  if (kind === 'blank') return { id: fresh, record: { kind, label: 'Written in RockBase Studio' } };
  if (kind === 'caption_copy') return { id: fresh, record: { kind, label: 'Copied from a Caption assistant draft kept in a browser' } };
  if (kind === 'browser_import') {
    if (typeof value.browser_id !== 'string' || !BROWSER_ID.test(value.browser_id)) throw new StudioRouteError(422, 'Browser draft id is invalid.');
    const created = typeof value.browser_created_at === 'string' && !Number.isNaN(Date.parse(value.browser_created_at)) ? new Date(value.browser_created_at).toISOString() : null;
    // Deterministic per workspace + browser draft, so a repeated or parallel move never duplicates.
    return { id: workspace => 'studio-' + createHash('sha256').update(JSON.stringify([workspace, 'browser_import', value.browser_id])).digest('hex').slice(0, 32),
      record: { kind, label: 'Moved from this browser’s Studio drafts', browserId: value.browser_id, ...(created ? { browserCreatedAt: created } : {}), movedAt: new Date().toISOString() } };
  }
  throw new StudioRouteError(422, 'Source must be blank, caption_copy or browser_import.');
}

export function createStudioRouter(deps: StudioDependencies): Router {
  const router = Router();
  router.use(noStore);
  router.use((req: AuthRequest, res, next) => {
    if (getRockBaseMode() === 'local') {
      if (!isLocalOwner(req)) { res.status(403).json({ error: 'STUDIO_LOCAL_OWNER_REQUIRED' }); return; }
      requireLocalSecretOrigin(req, res, next); return;
    }
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    next();
  });
  const handle = (fn: (req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: any) => {
    try { res.json(await fn(req)); }
    catch (error) { res.status(error instanceof StudioRouteError ? error.status : 503).json({ error: error instanceof StudioRouteError ? error.message : 'Draft store unavailable; nothing was changed.' }); }
  };
  const scope = async (req: AuthRequest, write = false) => {
    const local = getRockBaseMode() === 'local';
    if (write && !local && !WRITE_ROLES.includes(req.user?.role || '')) throw new StudioRouteError(403, 'Insufficient permissions');
    const requested = req.method === 'GET' ? req.query.workspace_id : req.body?.workspace_id;
    if (requested !== undefined && (typeof requested !== 'string' || requested.length > 200)) throw new StudioRouteError(422, 'Invalid workspace.');
    const rows = await deps.workspaces(local ? null : req.user!.id);
    const selected = requested ? rows.find(w => w.id === requested) : rows[0];
    // Same answer for "missing" and "not yours": never disclose a foreign workspace.
    if (!selected) throw new StudioRouteError(404, 'Workspace not found.');
    return selected.id;
  };
  const owned = async (req: AuthRequest, workspace: string) => {
    const id = String(req.params.id);
    if (!DRAFT_ID.test(id)) throw new StudioRouteError(404, 'Studio draft not found.');
    const row = await deps.drafts.findFirst({ where: { id, workspaceId: workspace }, select: COLUMNS });
    if (!row) throw new StudioRouteError(404, 'Draft not found in this workspace.');
    return row as Row;
  };

  router.get('/drafts', handle(async req => {
    const workspace = await scope(req);
    const rows = await deps.drafts.findMany({ where: { workspaceId: workspace, id: { startsWith: 'studio-' } }, orderBy: { updatedAt: 'desc' }, take: 200, select: COLUMNS });
    return { drafts: rows.map(summary) };
  }));
  router.post('/drafts', handle(async req => {
    const workspace = await scope(req, true);
    const format = req.body?.format;
    if (!STUDIO_FORMATS.includes(format)) throw new StudioRouteError(422, 'Format must be article, social_post or reel.');
    const title = text(req.body?.title, 'Title', 200).trim();
    const body = text(req.body?.body, 'Draft body', 50_000);
    const origin = source(req.body?.source);
    let brandKey: string | null = null;
    if (req.body?.brand_key !== undefined && req.body.brand_key !== null && req.body.brand_key !== '') {
      if (typeof req.body.brand_key !== 'string' || req.body.brand_key.length > 160) throw new StudioRouteError(422, 'Choose an existing brand.');
      const brands = await deps.brands(workspace).catch(() => { throw new StudioRouteError(503, 'Brand registry unavailable; the draft was not saved.'); });
      if (!brands.some(b => b.key === req.body.brand_key)) throw new StudioRouteError(422, 'Brand not found in this workspace.');
      brandKey = req.body.brand_key;
    }
    const id = origin.id(workspace);
    const content = body + PROVENANCE + JSON.stringify({ store: 'RockBase Studio', format, brandKey, source: origin.record }, null, 2);
    const data = { id, workspaceId: workspace, title: title || null, content, mediaUrls: '[]', platforms: '[]', hashtags: '[]' };
    const row = origin.record.kind === 'browser_import'
      ? await deps.drafts.upsert({ where: { id }, update: {}, create: data, select: COLUMNS })
      : await deps.drafts.create({ data, select: COLUMNS });
    if (row.workspaceId !== workspace) throw new StudioRouteError(409, 'Draft id conflict; nothing was changed.');
    return { draft: parse(row) };
  }));
  router.get('/drafts/:id', handle(async req => ({ draft: parse(await owned(req, await scope(req))) })));
  /** Title and body only. Format, brand and source are re-attached from the stored row. */
  router.patch('/drafts/:id', handle(async req => {
    const workspace = await scope(req, true);
    if (typeof req.body?.body !== 'string') throw new StudioRouteError(422, 'Draft body is required.');
    const body = text(req.body.body, 'Draft body', 50_000);
    const title = req.body?.title === undefined ? undefined : text(req.body.title, 'Title', 200).trim();
    const existing = await owned(req, workspace);
    const at = existing.content.indexOf(PROVENANCE);
    const row = await deps.drafts.update({ where: { id: existing.id }, select: COLUMNS,
      data: { content: body + (at >= 0 ? existing.content.slice(at) : ''), ...(title !== undefined ? { title: title || null } : {}) } });
    return { draft: parse(row) };
  }));
  return router;
}
