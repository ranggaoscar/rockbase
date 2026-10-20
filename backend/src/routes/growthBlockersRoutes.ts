import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { isLocalOwner, noStore, requireLocalSecretOrigin } from '../middleware/secretAccess';
import { getRockBaseMode } from '../middleware/runtimeMode';

const LIMIT = 200;
const ACCOUNT_ATTENTION = ['error', 'logged_out', 'flagged'];
const SESSION_ATTENTION = ['NEEDS_RELOGIN', 'CHECKPOINT', 'EXPIRED'];
const POST_ATTENTION = ['failed', 'error', 'needs_attention', 'pending_verify'];

export interface GrowthBlockersDependencies {
  workspaceUser: { findFirst(args: any): Promise<{ id: string } | null> };
  socialAccount: { findMany(args: any): Promise<any[]> };
  post: { findMany(args: any): Promise<any[]> };
}

export function createGrowthBlockersRouter(deps: GrowthBlockersDependencies): Router {
  const router = Router();
  router.use(noStore);
  router.use((req: AuthRequest, res: Response, next) => {
    if (getRockBaseMode() === 'local') {
      if (!isLocalOwner(req)) { res.status(403).json({ error: 'LOCAL_OWNER_REQUIRED' }); return; }
      requireLocalSecretOrigin(req, res, next); return;
    }
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    next();
  });
  router.get('/growth-blockers', async (req: AuthRequest, res: Response) => {
    try {
      const workspaceId = req.query.workspace_id;
      if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 200) {
        res.status(422).json({ error: 'workspace_id is required.' }); return;
      }
      if (getRockBaseMode() !== 'local') {
        const member = await deps.workspaceUser.findFirst({ where: { userId: req.user!.id, workspaceId }, select: { id: true } });
        if (!member) { res.status(404).json({ error: 'Workspace not found.' }); return; }
      }
      const workspaceScope = { workspaceId };
      const [accountRows, postRows] = await Promise.all([
        deps.socialAccount.findMany({ where: { ...workspaceScope, OR: [ { status: { in: ACCOUNT_ATTENTION } }, { sessionHealth: { in: SESSION_ATTENTION } } ] },
          select: { id: true, workspaceId: true, status: true, sessionHealth: true, sessionHealthCheckedAt: true, brandTag: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT + 1 }),
        deps.post.findMany({ where: { ...workspaceScope, status: { in: POST_ATTENTION } },
          select: { id: true, workspaceId: true, status: true, updatedAt: true, accountIds: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT + 1 }),
      ]);
      const accounts = accountRows.slice(0, LIMIT).map(row => ({ id: row.id, workspaceId: row.workspaceId, brandKey: row.brandTag || null, status: row.status, sessionHealth: row.sessionHealth, checkedAt: row.sessionHealthCheckedAt }));
      const posts = postRows.slice(0, LIMIT).map(row => {
        let accountIds: string[] = [];
        try { const parsed = JSON.parse(row.accountIds); if (Array.isArray(parsed)) accountIds = parsed.filter((id: unknown): id is string => typeof id === 'string'); } catch { /* malformed legacy value becomes an empty reference list */ }
        return { id: row.id, workspaceId: row.workspaceId, status: row.status, updatedAt: row.updatedAt, accountIds };
      });
      res.json({ checkedAt: new Date().toISOString(), accounts, posts, truncated: { accounts: accountRows.length > LIMIT, posts: postRows.length > LIMIT } });
    } catch {
      res.status(503).json({ error: 'Growth blockers unavailable.' });
    }
  });
  return router;
}
