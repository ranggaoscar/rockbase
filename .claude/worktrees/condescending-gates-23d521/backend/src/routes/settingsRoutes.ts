import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

// In-memory settings store (survives restart only in dev)
let settings: Record<string, any> = {
  geminiApiKey: '',
  postingDelayMin: 800,
  postingDelayMax: 2000,
  warmingDelayMin: 3000,
  warmingDelayMax: 15000,
  warmingDuration: 14,
  notifyOnPostSuccess: true,
  notifyOnPostFail: true,
  notifyOnWarmingComplete: true,
  timezone: 'Asia/Jakarta',
  defaultHashtagPlatform: 'Instagram',
};

// GET /api/settings
router.get('/', async (_req: AuthRequest, res: Response) => {
  // Never expose the raw API key — mask it
  const masked = { ...settings };
  if (masked.geminiApiKey && masked.geminiApiKey.length > 8) {
    masked.geminiApiKey = masked.geminiApiKey.slice(0, 4) + '••••••••••••' + masked.geminiApiKey.slice(-4);
    masked.geminiKeySet = true;
  } else {
    masked.geminiKeySet = false;
  }
  res.json({ settings: masked });
});

// PATCH /api/settings
router.patch('/', async (req: AuthRequest, res: Response) => {
  const allowed = [
    'geminiApiKey', 'postingDelayMin', 'postingDelayMax',
    'warmingDelayMin', 'warmingDelayMax', 'warmingDuration',
    'notifyOnPostSuccess', 'notifyOnPostFail', 'notifyOnWarmingComplete',
    'timezone', 'defaultHashtagPlatform',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      settings[key] = req.body[key];
    }
  }
  // Apply Gemini key to env immediately (only lasts until process restarts)
  if (req.body.geminiApiKey) {
    process.env.GEMINI_API_KEY = req.body.geminiApiKey;
  }
  res.json({ success: true, message: 'Settings saved' });
});

// GET /api/settings/health — system health check
router.get('/health', async (_req: AuthRequest, res: Response) => {
  const checks: { name: string; status: 'ok' | 'warn' | 'error'; message: string; latency?: number }[] = [];

  // 1. API server (always OK since we are running)
  checks.push({ name: 'API Server', status: 'ok', message: 'Running on port ' + (process.env.PORT || 3000), latency: 0 });

  // 2. Redis
  try {
    const start = Date.now();
    const { Queue } = await import('bullmq');
    const q = new Queue('healthcheck', {
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });
    await q.getJobCounts();
    await q.close();
    checks.push({ name: 'Redis / BullMQ', status: 'ok', message: 'Connected', latency: Date.now() - start });
  } catch {
    checks.push({ name: 'Redis / BullMQ', status: 'error', message: 'Not reachable — BullMQ jobs will not run' });
  }

  // 3. Playwright Browser
  try {
    const { browserManager } = await import('../services/BrowserManager');
    const browser = (browserManager as any).browser;
    if (browser && browser.isConnected()) {
      checks.push({ name: 'Playwright Browser', status: 'ok', message: 'Browser connected' });
    } else {
      checks.push({ name: 'Playwright Browser', status: 'warn', message: 'Browser not initialized — Farm View unavailable' });
    }
  } catch {
    checks.push({ name: 'Playwright Browser', status: 'warn', message: 'Could not check browser status' });
  }

  // 4. Gemini API key
  if (settings.geminiApiKey && settings.geminiApiKey.length > 10) {
    checks.push({ name: 'Gemini AI', status: 'ok', message: 'API key configured' });
  } else if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key' && process.env.GEMINI_API_KEY.length > 10) {
    checks.push({ name: 'Gemini AI', status: 'ok', message: 'API key loaded from environment' });
  } else {
    checks.push({ name: 'Gemini AI', status: 'warn', message: 'API key not set — AI Writer using fallback mode' });
  }

  // 5. SQLite / Prisma
  try {
    const { PrismaClient: PC } = await import('@prisma/client');
    const db = new PC();
    await db.$queryRaw`SELECT 1`;
    await db.$disconnect();
    checks.push({ name: 'Database (SQLite)', status: 'ok', message: 'Connected — real data persists to dev.db' });
  } catch {
    checks.push({ name: 'Database (SQLite)', status: 'error', message: 'SQLite connection failed' });
  }

  const allOk = checks.every(c => c.status === 'ok');
  const hasError = checks.some(c => c.status === 'error');
  res.json({
    overall: hasError ? 'error' : allOk ? 'ok' : 'warn',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
