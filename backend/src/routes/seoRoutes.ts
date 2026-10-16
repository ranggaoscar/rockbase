import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { seoRequest } from '../services/SeoWorkerService';

const prisma = new PrismaClient();
const router = Router();
router.use((req, res, next) => {
  if (getRockBaseMode() === 'local') {
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
    where: local || req.user?.role === 'Admin' ? {} : { users: { some: { userId: req.user!.id } } },
    select: { id: true, name: true, accounts: { select: { brandTag: true }, distinct: ['brandTag'] } },
    orderBy: { createdAt: 'asc' },
  });
  return workspaces.map((workspace) => ({
    id: workspace.id, name: workspace.name,
    brands: workspace.accounts.filter((account) => account.brandTag?.trim()).map((account) => ({
      key: account.brandTag!, name: account.brandTag!, workspace_id: workspace.id, source: 'SocialAccount.brandTag',
    })),
  }));
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
    const allowed = req.method === 'GET'
      ? /^\/(health|websites|websites\/\d+\/scans|scans\/\d+(\/(pages|issues|compare|export))?)$/.test(path)
      : (req.method === 'POST' && /^\/(websites|websites\/\d+\/scans)$/.test(path))
        || (req.method === 'PATCH' && /^\/websites\/\d+\/brand$/.test(path));
    if (!allowed) { res.status(404).json({ error: 'Unknown SEO operation' }); return; }
    if (req.method === 'POST' && !['Admin', 'Operator'].includes(req.user?.role || '')) {
      res.status(403).json({ error: 'Insufficient permissions' }); return;
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
    for (const key of ['q', 'priority', 'status', 'kind', 'format']) {
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
