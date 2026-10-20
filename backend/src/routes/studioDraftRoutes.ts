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
 *
 * Review flow: every draft carries a server-held status (draft → in_review → ready,
 * archived as the end state, restore back to draft). Status, brand and source sit
 * behind the provenance separator and are re-attached on every edit. The router also
 * records distribution references: an explicit Compose handoff (a navigation fact,
 * not a publication claim) and post ids the caller must prove exist in the same
 * workspace. A post reference carries only queue/publish state — never engagement.
 */
export interface StudioDependencies {
  /** Workspaces the caller may use. `null` = the Local Mode owner, who owns every workspace. */
  workspaces(userId: string | null): Promise<Array<{ id: string; name: string }>>;
  brands(workspace: string): Promise<Array<{ key: string }>>;
  drafts: { create(args: any): Promise<any>; upsert(args: any): Promise<any>; findFirst(args: any): Promise<any>; findMany(args: any): Promise<any[]>; update(args: any): Promise<any> };
  /** Read-only existence check for distribution references. Nothing is written here. */
  posts: { findMany(args: any): Promise<Array<{ id: string; status: string }>> };
}

export const STUDIO_FORMATS = ['article', 'social_post', 'reel'] as const;
export const STUDIO_STATUSES = ['draft', 'in_review', 'ready', 'archived'] as const;
export type StudioFormat = typeof STUDIO_FORMATS[number];
export type StudioStatus = typeof STUDIO_STATUSES[number];
/** The review flow as a real state machine; archived leaves only through Restore. */
const TRANSITIONS: Record<StudioStatus, StudioStatus[]> = {
  draft: ['in_review', 'ready', 'archived'],
  in_review: ['draft', 'ready', 'archived'],
  ready: ['draft', 'in_review', 'archived'],
  archived: ['draft'],
};
const HANDOFF_CHANNELS = ['compose'] as const;
const STATUS_LABEL: Record<StudioStatus, string> = { draft: 'draft', in_review: 'in review', ready: 'ready', archived: 'archived' };

const PROVENANCE = '\n\n---\nProvenance (review, not a publication claim):\n';
const DRAFT_ID = /^studio-[a-f0-9]{32}$/;
const BROWSER_ID = /^[\w-]{1,100}$/;
const POST_ID = /^[\w-]{1,64}$/;
const WRITE_ROLES = ['Admin', 'Operator'];
const COLUMNS = { id: true, workspaceId: true, title: true, content: true, createdAt: true, updatedAt: true } as const;
const MAX_POST_REFS = 50;

class StudioRouteError extends Error { constructor(public status: number, message: string) { super(message); } }

interface Row { id: string; workspaceId: string; title: string | null; content: string; createdAt: Date | string; updatedAt: Date | string }
interface Handoff { channel: string; at: string; count: number }
interface PostRef { id: string; status: string; at: string }
interface Distribution { handoffs: Handoff[]; posts: PostRef[] }

function splitContent(content: string) {
  const at = content.indexOf(PROVENANCE);
  const body = at >= 0 ? content.slice(0, at) : content;
  let meta: Record<string, any> = {};
  try { meta = at >= 0 ? JSON.parse(content.slice(at + PROVENANCE.length)) : {}; } catch { meta = {}; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
  return { body, meta };
}
const joinContent = (body: string, meta: Record<string, unknown>) => body + PROVENANCE + JSON.stringify(meta, null, 2);

const statusOf = (meta: Record<string, any>): StudioStatus =>
  (STUDIO_STATUSES as readonly string[]).includes(meta.status as string) ? meta.status as StudioStatus : 'draft';

/** Stored references, filtered down to the shapes this router writes. */
function distributionOf(meta: Record<string, any>): Distribution {
  const stored = meta.distribution && typeof meta.distribution === 'object' ? meta.distribution : {};
  const handoffs: Handoff[] = Array.isArray(stored.handoffs)
    ? stored.handoffs.filter((h: any) => h && typeof h.channel === 'string' && typeof h.at === 'string' && Number.isFinite(Date.parse(h.at)))
      .map((h: any) => ({ channel: h.channel, at: new Date(h.at).toISOString(), count: Number.isFinite(h.count) ? h.count : 1 })).slice(-5)
    : [];
  const posts: PostRef[] = Array.isArray(stored.posts)
    ? stored.posts.filter((p: any) => p && typeof p.id === 'string' && typeof p.status === 'string')
      .map((p: any) => ({ id: p.id, status: p.status, at: typeof p.at === 'string' && Number.isFinite(Date.parse(p.at)) ? new Date(p.at).toISOString() : new Date(0).toISOString() }))
      .slice(-MAX_POST_REFS)
    : [];
  return { handoffs, posts };
}

function parse(row: Row) {
  const { body, meta } = splitContent(row.content);
  const format: StudioFormat = STUDIO_FORMATS.includes(meta.format) ? meta.format : 'article';
  return { id: row.id, workspaceId: row.workspaceId, title: row.title || '', body, format,
    brandKey: typeof meta.brandKey === 'string' ? meta.brandKey : null,
    status: statusOf(meta),
    statusChangedAt: typeof meta.statusChangedAt === 'string' ? meta.statusChangedAt : null,
    source: meta.source && typeof meta.source === 'object' ? meta.source : { kind: 'unknown' },
    distribution: distributionOf(meta),
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() };
}
const summary = (row: Row) => {
  const { body, ...rest } = parse(row);
  return { ...rest, excerpt: excerptOf(body) };
};

/** Library excerpt: cut on a word boundary and say it was cut, instead of stopping mid-word. */
function excerptOf(body: string): string {
  const text = body.replace(/^#+\s*/gm, '').replace(/[*_>`]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= 180) return text;
  const cut = text.slice(0, 180);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 120 ? space : 180).trimEnd()}…`;
}

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
    const requested = req.query.status;
    if (requested !== undefined && (typeof requested !== 'string' || !(STUDIO_STATUSES as readonly string[]).includes(requested))) {
      throw new StudioRouteError(422, 'Status filter must be draft, in_review, ready or archived.');
    }
    const rows = await deps.drafts.findMany({ where: { workspaceId: workspace, id: { startsWith: 'studio-' } }, orderBy: { updatedAt: 'desc' }, take: 200, select: COLUMNS });
    // Filtered after the bounded read; the library also filters client-side, so a full page is never lost.
    const drafts = rows.map(summary);
    return { drafts: requested ? drafts.filter(d => d.status === requested) : drafts };
  }));
  router.post('/drafts', handle(async req => {
    const workspace = await scope(req, true);
    const format = req.body?.format;
    if (!STUDIO_FORMATS.includes(format)) throw new StudioRouteError(422, 'Format must be article, social_post or reel.');
    // A new draft always starts unreviewed; review state is a server transition, not a create field.
    if (req.body?.status !== undefined && req.body.status !== 'draft') throw new StudioRouteError(422, 'New drafts always start as draft.');
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
    const content = joinContent(body, { store: 'RockBase Studio', format, brandKey, status: 'draft', source: origin.record, distribution: { handoffs: [], posts: [] } });
    const data = { id, workspaceId: workspace, title: title || null, content, mediaUrls: '[]', platforms: '[]', hashtags: '[]' };
    const row = origin.record.kind === 'browser_import'
      ? await deps.drafts.upsert({ where: { id }, update: {}, create: data, select: COLUMNS })
      : await deps.drafts.create({ data, select: COLUMNS });
    if (row.workspaceId !== workspace) throw new StudioRouteError(409, 'Draft id conflict; nothing was changed.');
    return { draft: parse(row) };
  }));
  router.get('/drafts/:id', handle(async req => ({ draft: parse(await owned(req, await scope(req))) })));
  /**
   * Body, title and review status. Format, brand, source and distribution are re-attached
   * from the stored row. Status + text arrive in one request so a status change never
   * drops unsaved text.
   */
  router.patch('/drafts/:id', handle(async req => {
    const workspace = await scope(req, true);
    const existing = await owned(req, workspace);
    const { body: currentBody, meta } = splitContent(existing.content);
    const current = statusOf(meta);
    const wantsBody = req.body?.body !== undefined;
    const wantsTitle = req.body?.title !== undefined;
    const wantsStatus = req.body?.status !== undefined;
    if (!wantsBody && !wantsTitle && !wantsStatus) throw new StudioRouteError(422, 'Nothing to save: send a body, a title or a status.');
    if (current === 'archived' && (wantsBody || wantsTitle)) throw new StudioRouteError(409, 'This draft is archived. Restore it before editing.');
    const body = wantsBody ? text(req.body.body, 'Draft body', 50_000) : currentBody;
    const title = wantsTitle ? text(req.body.title, 'Title', 200).trim() : undefined;
    let status = current;
    if (wantsStatus) {
      const requested = req.body.status;
      if (typeof requested !== 'string' || !(STUDIO_STATUSES as readonly string[]).includes(requested)) {
        throw new StudioRouteError(422, 'Status must be draft, in_review, ready or archived.');
      }
      if (requested !== current) {
        if (!TRANSITIONS[current].includes(requested as StudioStatus)) {
          throw new StudioRouteError(422, `A ${STATUS_LABEL[current]} draft cannot move straight to ${STATUS_LABEL[requested as StudioStatus]}. Restore it first.`);
        }
        if (requested === 'ready' && (!(title ?? existing.title ?? '').trim() || !body.trim())) {
          throw new StudioRouteError(422, 'A draft needs a title and a body before it can be marked ready.');
        }
        status = requested as StudioStatus;
      }
    }
    const nextMeta = { ...meta, status, ...(status !== current ? { statusChangedAt: new Date().toISOString() } : {}), distribution: distributionOf(meta) };
    const row = await deps.drafts.update({ where: { id: existing.id }, select: COLUMNS, data: {
      content: joinContent(body, nextMeta),
      ...(title !== undefined ? { title: title || null } : {}),
    } });
    return { draft: parse(row) };
  }));
  /** Records that this draft left Studio for Compose. A navigation fact — not a publication claim. */
  router.post('/drafts/:id/handoff', handle(async req => {
    const workspace = await scope(req, true);
    const channel = req.body?.channel;
    if (typeof channel !== 'string' || !(HANDOFF_CHANNELS as readonly string[]).includes(channel)) throw new StudioRouteError(422, 'Handoff channel must be compose.');
    const existing = await owned(req, workspace);
    const { body, meta } = splitContent(existing.content);
    const status = statusOf(meta);
    if (status === 'archived') throw new StudioRouteError(409, 'Restore this archived draft before continuing it in Compose.');
    const distribution = distributionOf(meta);
    const at = new Date().toISOString();
    const prior = distribution.handoffs.find(h => h.channel === channel);
    const handoffs = prior
      ? distribution.handoffs.map(h => h.channel === channel ? { channel, at, count: h.count + 1 } : h)
      : [...distribution.handoffs, { channel, at, count: 1 }].slice(-5);
    const row = await deps.drafts.update({ where: { id: existing.id }, select: COLUMNS,
      data: { content: joinContent(body, { ...meta, status, distribution: { ...distribution, handoffs } }) } });
    return { draft: parse(row) };
  }));
  /**
   * Links a draft to posts that already exist in this workspace. Every id is verified
   * against the caller's workspace, so a client cannot fabricate a reference; a stored
   * status is queue/publish state only, never engagement, reach or conversion.
   */
  router.post('/drafts/:id/distribution', handle(async req => {
    const workspace = await scope(req, true);
    const ids = req.body?.post_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !POST_ID.test(id))) {
      throw new StudioRouteError(422, 'post_ids must be 1 to 20 post ids.');
    }
    const existing = await owned(req, workspace);
    const { body, meta } = splitContent(existing.content);
    if (statusOf(meta) === 'archived') throw new StudioRouteError(409, 'Restore this archived draft before linking distribution.');
    const rows = await deps.posts.findMany({ where: { workspaceId: workspace, id: { in: ids } }, select: { id: true, status: true } });
    if (rows.length === 0) throw new StudioRouteError(422, 'No post in this workspace matched those ids; nothing was linked.');
    const distribution = distributionOf(meta);
    const at = new Date().toISOString();
    const posts = [...distribution.posts];
    for (const found of rows) {
      const ref: PostRef = { id: found.id, status: String(found.status), at };
      const index = posts.findIndex(p => p.id === found.id);
      if (index >= 0) posts[index] = ref; else posts.push(ref);
    }
    const row = await deps.drafts.update({ where: { id: existing.id }, select: COLUMNS,
      data: { content: joinContent(body, { ...meta, distribution: { ...distribution, posts: posts.slice(-MAX_POST_REFS) } }) } });
    return { draft: parse(row), linked: rows.length };
  }));
  return router;
}
