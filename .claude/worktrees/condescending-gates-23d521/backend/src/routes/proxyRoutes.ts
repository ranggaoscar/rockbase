import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken);

// GET /api/proxies
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany();
    res.json({ proxies });
  } catch {
    res.status(500).json({ error: 'Failed to fetch proxies' });
  }
});

// POST /api/proxies
router.post('/', async (req: AuthRequest, res: Response) => {
  const { host, port, username, password, location } = req.body;
  if (!host || !port) { res.status(400).json({ error: 'Host and port are required' }); return; }

  try {
    const proxy = await prisma.proxy.create({
      data: { host, port: parseInt(port), username, password, location, status: 'working', isActive: true, lastChecked: new Date() },
    });
    res.status(201).json({ proxy });
  } catch {
    res.status(500).json({ error: 'Failed to create proxy' });
  }
});

// POST /api/proxies/bulk — paste format: host:port:user:pass per line
router.post('/bulk', async (req: AuthRequest, res: Response) => {
  const { lines } = req.body as { lines: string };
  if (!lines) { res.status(400).json({ error: 'No proxy lines provided' }); return; }

  const parsed = lines
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean)
    .map((line: string) => {
      const parts = line.split(':');
      if (parts.length < 2) return null;
      return {
        host: parts[0],
        port: parseInt(parts[1]),
        username: parts[2] ?? undefined,
        password: parts[3] ?? undefined,
        status: 'working',
        isActive: true,
        lastChecked: new Date(),
      };
    })
    .filter(Boolean);

  if (parsed.length === 0) { res.status(400).json({ error: 'No valid proxy lines found' }); return; }

  try {
    const created = [];
    for (const data of parsed) {
      const proxy = await prisma.proxy.create({ data: data as any });
      created.push(proxy);
    }
    res.status(201).json({ proxies: created, count: created.length });
  } catch {
    res.status(500).json({ error: 'Failed to import proxies' });
  }
});

// PATCH /api/proxies/:id
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.proxy.update({ where: { id: req.params.id }, data: req.body });
    const proxy = await prisma.proxy.findUnique({ where: { id: req.params.id } });
    res.json({ proxy });
  } catch {
    res.status(500).json({ error: 'Failed to update proxy' });
  }
});

// DELETE /api/proxies/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.proxy.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete proxy' });
  }
});

// POST /api/proxies/:id/test — simulate proxy connectivity test
router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const rand = Math.random();
    const status = rand > 0.25 ? 'working' : rand > 0.1 ? 'slow' : 'dead';
    const latency = status === 'dead' ? null : Math.floor(Math.random() * 180) + 40;

    await prisma.proxy.update({
      where: { id: req.params.id },
      data: { status, lastChecked: new Date(), isActive: status !== 'dead' },
    });

    res.json({ id: req.params.id, status, latency, location: 'ID - Jakarta', testedAt: new Date() });
  } catch {
    res.status(500).json({ error: 'Test failed' });
  }
});

// POST /api/proxies/test-all
router.post('/test-all', async (_req: AuthRequest, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany();
    const results = [];
    for (const p of proxies) {
      const rand = Math.random();
      const status = rand > 0.25 ? 'working' : rand > 0.1 ? 'slow' : 'dead';
      const latency = status === 'dead' ? null : Math.floor(Math.random() * 180) + 40;
      await prisma.proxy.update({
        where: { id: p.id },
        data: { status, lastChecked: new Date(), isActive: status !== 'dead' },
      });
      results.push({ id: p.id, status, latency });
    }
    res.json({ results, testedAt: new Date() });
  } catch {
    res.status(500).json({ error: 'Test-all failed' });
  }
});

export default router;
