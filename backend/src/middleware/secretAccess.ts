import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth';
import { getRockBaseMode, isLoopbackAddress, localOperator } from './runtimeMode';

export function requireLocalSecretOrigin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (getRockBaseMode() === 'local') {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      || (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      res.status(403).json({ error: 'Local operator origin required' }); return;
    }
  }
  next();
}

/** Single-user Local Mode owns its installation; Server Mode always requires DB membership. */
export function isLocalOwner(req: AuthRequest): boolean {
  return getRockBaseMode() === 'local'
    && isLoopbackAddress(req.socket.remoteAddress)
    && req.user?.id === localOperator.id;
}

export function noStore(_req: AuthRequest, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

export function requireSecretAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  if (!isLocalOwner(req) && req.user.role !== 'Admin') {
    res.status(403).json({ error: 'Administrator access required' }); return;
  }
  next();
}

interface SecretAccessStore {
  socialAccount: { findUnique(args: { where: { id: string }; select: { workspaceId: true } }): Promise<{ workspaceId: string } | null> };
  workspaceUser: { findFirst(args: { where: { userId: string; workspaceId: string }; select: { id: true } }): Promise<{ id: string } | null> };
}

export async function ownsAccountWorkspace(req: AuthRequest, store: SecretAccessStore, accountId: string): Promise<boolean> {
  const account = await store.socialAccount.findUnique({ where: { id: accountId }, select: { workspaceId: true } });
  if (!account) return false;
  if (isLocalOwner(req)) return true;
  if (!req.user) return false;
  // Admin role is not a global bypass. WorkspaceUser is the existing ownership/membership relation.
  return !!(await store.workspaceUser.findFirst({
    where: { userId: req.user.id, workspaceId: account.workspaceId }, select: { id: true },
  }));
}

export function requireAccountWorkspace(store: SecretAccessStore) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!await ownsAccountWorkspace(req, store, String(req.params.id))) {
        // Do not disclose whether a foreign account exists.
        res.status(404).json({ error: 'Account not found in authorized workspace' }); return;
      }
      next();
    } catch {
      res.status(503).json({ error: 'Account authorization unavailable' });
    }
  };
}
