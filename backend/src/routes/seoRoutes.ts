import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { isLocalOwner } from '../middleware/secretAccess';
import { seoRequest } from '../services/SeoWorkerService';

const prisma = new PrismaClient();
const router = Router();
router.use((req: AuthRequest, res, next) => {
  if (getRockBaseMode() === 'local') {
    if (!isLocalOwner(req)) { res.status(403).json({ error: 'SEO_LOCAL_OWNER_REQUIRED' }); return; }
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    const trusted = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && !trusted.test(origin))) {
      res.status(403).json({ error: 'SEO_LOCAL_ORIGIN_REQUIRED' }); return;
    }
  }
  next();
});
// Mounted after authenticateToken. Existing identity/membership controls stay authoritative.
async function identities(req: AuthRequest) {
  const local = getRockBaseMode() === 'local';
  const workspaces = await prisma.workspace.findMany({
    where: local ? {} : { users: { some: { userId: req.user!.id } } },
    select: { id: true, name: true, accounts: { select: { brandTag: true }, distinct: ['brandTag'] } },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(workspaces.map(async (workspace) => ({ id: workspace.id, name: workspace.name, brands: await registryBrands(workspace) })));
}

/** The brand registry the UI's brand switcher resolves against: website brands plus social brand tags. */
async function registryBrands(workspace: { id: string; accounts: Array<{ brandTag: string | null }> }) {
  const response = await seoRequest('/brands', workspace.id);
  if (!response.ok) throw new Error('Persistent website brand registry unavailable.');
  const stored = await response.json() as Array<{ key: string; name: string; workspace_id: string }>;
  const brands = stored.filter((brand) => brand.workspace_id === workspace.id).map((brand) => ({ ...brand, source: 'WebsiteBrand' }));
  for (const account of workspace.accounts) {
    const key = account.brandTag?.trim();
    if (key && !brands.some((brand) => brand.key.toLowerCase() === key.toLowerCase() || brand.name.toLowerCase() === key.toLowerCase())) {
      brands.push({ key, name: key, workspace_id: workspace.id, source: 'SocialAccount.brandTag' });
    }
  }
  return brands;
}

export async function workspaceBrands(workspaceId: string) {
  const accounts = await prisma.socialAccount.findMany({ where: { workspaceId }, select: { brandTag: true }, distinct: ['brandTag'] });
  return registryBrands({ id: workspaceId, accounts });
}

router.get('/brands', async (req: AuthRequest, res: Response) => {
  try {
    res.json((await identities(req)).flatMap((w) => [
      { key: '', name: w.name, workspace_id: w.id, source: 'Workspace' }, ...w.brands,
    ]));
  } catch { res.status(503).json({ error: 'Existing workspace registry is unavailable; no social data was changed.' }); }
});

router.use(async (req: AuthRequest, res: Response) => {
  try {
    const workspaces = await identities(req);
    const requested = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined;
    const workspace = requested ? workspaces.find((w) => w.id === requested) : workspaces[0];
    if (!workspace) { res.status(404).json({ error: 'No authorized workspace found.' }); return; }
    const path = req.path;
    const competitorPath = /^\/competitors(?:\/\d+(?:\/(?:scans|findings))?)?$/;
    const allowed = req.method === 'GET'
      ? /^\/(health|websites|websites\/\d+\/scans|scans\/\d+(\/(pages|issues|compare|graph|issue-groups|export))?)$/.test(path) || competitorPath.test(path)
      : (req.method === 'POST' && (/^\/(brands|websites|websites\/\d+\/scans)$/.test(path) || /^\/competitors(?:\/\d+\/scans)?$/.test(path)))
        || (req.method === 'PATCH' && /^\/websites\/\d+\/brand$/.test(path));
    if (!allowed) { res.status(404).json({ error: 'Unknown SEO operation' }); return; }
    if (req.method === 'POST' && !['Admin', 'Operator'].includes(req.user?.role || '')) {
      res.status(403).json({ error: 'Insufficient permissions' }); return;
    }

    if (competitorPath.test(path)) {
      const brands = workspace.brands;
      if (path === '/competitors' && req.method === 'POST') {
        const { name, base_url, brand_key } = req.body || {};
        let validUrl = false;
        try { const url = new URL(base_url); validUrl = ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname); } catch { /* invalid */ }
        if (typeof name !== 'string' || !name.trim() || name.length > 160 || typeof base_url !== 'string' || base_url.length > 2048 || !validUrl || typeof brand_key !== 'string' || !brands.some(b => b.key === brand_key)) {
          res.status(422).json({ error: 'Competitor name, http(s) base_url and an existing workspace brand_key are required.' }); return;
        }
      } else if (path === '/competitors' && req.method === 'GET') {
        const brandKey = req.query.brand_key;
        if (brandKey !== undefined && (typeof brandKey !== 'string' || !brands.some(b => b.key === brandKey))) { res.status(422).json({ error: 'Select a brand from the existing workspace registry.' }); return; }
      }
      const detail = path.match(/^\/competitors\/(\d+)(?:\/|$)/);
      let selectedBrand: string | undefined;
      if (detail) {
        const relationResponse = await seoRequest(`/competitors/${detail[1]}`, workspace.id);
        if (!relationResponse.ok) { res.status(relationResponse.status).send(Buffer.from(await relationResponse.arrayBuffer())); return; }
        const relationResult = await relationResponse.json() as { workspace_id?: string; brand_key?: string; competitor?: { workspace_id?: string; brand_key?: string }; relationship?: { brand_key?: string } };
        const relation = relationResult.competitor || relationResult;
        const brandKey = relation.brand_key || relationResult.relationship?.brand_key;
        if (relation.workspace_id !== workspace.id || typeof brandKey !== 'string' || !brands.some(b => b.key === brandKey)) { res.status(404).json({ error: 'Competitor not found in this authorized workspace and brand.' }); return; }
        if (req.query.brand_key !== undefined && req.query.brand_key !== brandKey) { res.status(404).json({ error: 'Competitor not found in this brand.' }); return; }
        selectedBrand = brandKey;
      } else if (req.method === 'POST') selectedBrand = req.body?.brand_key;
      else selectedBrand = typeof req.query.brand_key === 'string' ? req.query.brand_key : undefined;
      if (detail && path.endsWith('/scans') && req.method === 'POST') {
        const { max_urls, mode, brand_key } = req.body || {};
        if (!Number.isInteger(max_urls) || max_urls < 1 || max_urls > 25 || mode !== 'http' || (brand_key !== undefined && brand_key !== selectedBrand)) { res.status(422).json({ error: 'Scan requires max_urls 1..25 and mode http.' }); return; }
      }
      if (detail && path.endsWith('/findings') && req.method === 'GET' && req.query.scan_id !== undefined && (typeof req.query.scan_id !== 'string' || !/^\d+$/.test(req.query.scan_id))) { res.status(422).json({ error: 'Invalid scan_id.' }); return; }
      if (req.method === 'POST' && selectedBrand && !brands.some(b => b.key === selectedBrand)) { res.status(422).json({ error: 'Select a brand from the existing workspace registry.' }); return; }
    }

    if (path === '/brands' && req.method === 'POST') {
      // Owner-confirmed website brands are independent of social accounts.
      if (getRockBaseMode() !== 'local') { res.status(409).json({ error: 'LOCAL_BRAND_REGISTRATION_ONLY' }); return; }
      const { key, name } = req.body || {};
      if (typeof key !== 'string' || typeof name !== 'string' || !key.trim() || !name.trim() || key.length > 160 || name.length > 160) {
        res.status(422).json({ error: 'Brand key and name are required (max 160 characters).' }); return;
      }
      const existing = workspace.brands.find((b) => [b.key.toLowerCase(), b.name.toLowerCase()].some((value) => value === key.trim().toLowerCase() || value === name.trim().toLowerCase()));
      if (existing) { res.json(existing); return; }
    }
    if (path === '/websites' && req.method === 'POST' && req.body.brand_key && !workspace.brands.some((b) => b.key === req.body.brand_key)) {
      res.status(422).json({ error: 'Select a brand from the existing workspace registry.' }); return;
    }
    if (/^\/websites\/\d+\/brand$/.test(path) && req.method === 'PATCH') {
      if (!['Admin', 'Operator'].includes(req.user?.role || '')) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
      if (typeof req.body?.brand_key !== 'string' || !workspace.brands.some((b) => b.key === req.body.brand_key)) {
        res.status(422).json({ error: 'Select a brand that already exists in this workspace.' }); return;
      }
    }
    const params = new URLSearchParams();
    for (const key of ['q', 'priority', 'status', 'kind', 'format', 'category', 'confidence', 'issue_type', 'brand_key', 'scan_id']) {
      if (typeof req.query[key] === 'string') params.set(key, req.query[key] as string);
    }
    const upstream = await seoRequest(path + (params.size ? `?${params}` : ''), workspace.id, req.method, req.body);
    for (const key of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'SEO worker unavailable' });
  }
});

export default router;
