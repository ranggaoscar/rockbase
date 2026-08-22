import { Request, Response, NextFunction } from 'express';
import { AuthIdentity, verifyAccessToken } from './security';
import { getRockBaseMode, isLoopbackAddress, localOperator } from './runtimeMode';

export interface AuthRequest extends Request {
  user?: AuthIdentity;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (getRockBaseMode() === 'local' && isLoopbackAddress(req.socket.remoteAddress)) {
    req.user = localOperator;
    next();
    return;
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
};
