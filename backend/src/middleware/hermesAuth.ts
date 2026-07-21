import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const HERMES_TOKEN_ENV = 'HERMES_INTERNAL_API_TOKEN';

export function authenticateHermesInternal(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env[HERMES_TOKEN_ENV]?.trim();
  const header = req.headers.authorization;
  const supplied = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const valid = Boolean(configured && supplied && Buffer.byteLength(configured) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(configured), Buffer.from(supplied)));
  if (!valid) {
    res.status(401).json({ error: configured ? 'Invalid Hermes internal token' : 'Hermes internal API is not configured' });
    return;
  }
  next();
}
