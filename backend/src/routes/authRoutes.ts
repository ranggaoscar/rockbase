import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getJwtSecret } from '../middleware/security';

const router = Router();
const prisma = new PrismaClient();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
function getBootstrapConfig() {
  if (process.env.BOOTSTRAP_ADMIN_ENABLED !== 'true') return null;

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const token = process.env.BOOTSTRAP_ADMIN_TOKEN;
  if (!email || !password || password.length < 12 || !token || token.length < 24) {
    return null;
  }
  return { email, password, token };
}


// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN } as any);

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — verify token and return current user
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// POST /api/auth/register — Admin only in production; open during dev
router.post('/register', async (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Public registration is disabled' });
});

// One-time staging/bootstrap path. Credentials and token only come from the environment.
router.post('/bootstrap-admin', async (req: Request, res: Response) => {
  const config = getBootstrapConfig();
  if (!config || req.header('x-bootstrap-token') !== config.token) {
    res.status(403).json({ error: 'Bootstrap is unavailable' });
    return;
  }

  try {
    if (await prisma.user.count()) {
      res.status(409).json({ error: 'Bootstrap is unavailable' });
      return;
    }

    const hashedPassword = await bcrypt.hash(config.password, 12);
    const newUser = await prisma.user.create({
      data: {
        email: config.email,
        password: hashedPassword,
        name: 'Administrator',
        role: 'Admin',
      },
    });

    res.status(201).json({
      user: { id: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name },
    });
  } catch (error) {
    console.error('Bootstrap admin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
