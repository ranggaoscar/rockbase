import { NextFunction, Request, Response } from 'express';

export type RockBaseMode = 'local' | 'server';

export function getRockBaseMode(): RockBaseMode {
  return process.env.ROCKBASE_MODE === 'local' ? 'local' : 'server';
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

export function requireLocalLoopback(req: Request, res: Response, next: NextFunction): void {
  if (getRockBaseMode() !== 'local') return next();
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'LOCAL_MODE_LOOPBACK_ONLY' });
    return;
  }
  next();
}

export const localOperator = { id: 'local-operator', email: 'local@rockbase.local', role: 'Admin', name: 'Local Operator' };
