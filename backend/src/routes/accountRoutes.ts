import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/encryption';
import multer from 'multer';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import { sessionHealthService } from '../services/SessionHealthService';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' });
const MAX_BULK_SESSION_CHECK = Math.max(1, Number(process.env.MAX_BULK_SESSION_CHECK || 3));

// All account routes require authentication
router.use(authenticateToken);

// GET /api/accounts — list all accounts
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany();
    res.json({ accounts });
  } catch (err) {
    console.error('List accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// GET /api/accounts/stats — summary stats for dashboard
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany();
    const stats = {
      total: accounts.length,
      active: accounts.filter((a: any) => a.status === 'active').length,
      warming_up: accounts.filter((a: any) => a.status === 'warming_up').length,
      idle: accounts.filter((a: any) => a.status === 'idle').length,
      error: accounts.filter((a: any) => a.status === 'error').length,
      instagram: accounts.filter((a: any) => a.platform === 'Instagram').length,
      tiktok: accounts.filter((a: any) => a.platform === 'TikTok').length,
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/accounts/:id — get single account
// GET /api/accounts/session-health-summary
router.get('/session-health-summary', async (_req: AuthRequest, res: Response) => {
  try {
    const summary = await sessionHealthService.getSummary();
    res.json(summary);
  } catch (err) {
    console.error('Session health summary error:', err);
    res.status(500).json({ error: 'Failed to fetch session health summary' });
  }
});

// POST /api/accounts/check-session-bulk
router.post('/check-session-bulk', async (req: AuthRequest, res: Response) => {
  try {
    const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds.map(String) : [];
    if (accountIds.length === 0) {
      res.status(400).json({ error: 'accountIds is required' });
      return;
    }
    if (accountIds.length > MAX_BULK_SESSION_CHECK) {
      res.status(400).json({ error: `Bulk session check is limited to ${MAX_BULK_SESSION_CHECK} accounts` });
      return;
    }

    const results = await sessionHealthService.checkBulk(accountIds);
    res.json({ results, summary: await sessionHealthService.getSummary() });
  } catch (err: any) {
    console.error('Bulk session health check error:', err);
    res.status(500).json({ error: 'Failed to check sessions', details: err.message });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const account = await prisma.socialAccount.findUnique({ where: { id } });
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json({ account });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// GET /api/accounts/:id/credentials
router.get('/:id/credentials', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const account = await prisma.socialAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    let decryptedPassword = '';
    if (account.accountPassword) {
      try {
        decryptedPassword = decrypt(account.accountPassword);
      } catch (e) {
        // Maybe the password was not encrypted for some reason
        decryptedPassword = account.accountPassword;
      }
    }

    res.json({
      username: account.username,
      email: account.email,
      password: decryptedPassword,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch account credentials' });
  }
});

// POST /api/accounts — create account
// POST /api/accounts/:id/check-session
router.post('/:id/check-session', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const result = await sessionHealthService.checkAccount(id);
    res.json({ result, summary: await sessionHealthService.getSummary() });
  } catch (err: any) {
    console.error('Session health check error:', err);
    res.status(500).json({ error: 'Failed to check session', details: err.message });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { username, password, platform, email, proxy, brandTag, notes } = req.body;

  if (!username || !platform) {
    res.status(400).json({ error: 'Username and platform are required' });
    return;
  }

  try {
    // Encrypt account password if provided
    let encryptedPassword: string | undefined;
    if (password) {
      try { encryptedPassword = encrypt(password); } catch { encryptedPassword = password; }
    }

    const data: any = {
      username,
      platform,
      status: 'warming_up',
      warmingDay: 0,
      warmingStartDate: new Date(),
      workspaceId: 'workspace-default',
    };

    if (encryptedPassword) data.accountPassword = encryptedPassword;
    if (email) data.email = email;
    if (brandTag) data.brandTag = brandTag;
    if (notes) data.notes = notes;

    // Parse proxy string "host:port:user:pass" and store as notes for now
    if (proxy) data.notes = `${notes ? notes + '\n' : ''}proxy:${proxy}`;

    const account = await prisma.socialAccount.create({ data });
    res.status(201).json({ account });
  } catch (err) {
    console.error('Create account error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// PATCH /api/accounts/:id — update account
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const { password, ...rest } = req.body;
    const data: any = { ...rest, updatedAt: new Date() };

    if (password) {
      try { data.accountPassword = encrypt(password); } catch { data.accountPassword = password; }
    }

    await prisma.socialAccount.update({ where: { id }, data });
    const account = await prisma.socialAccount.findUnique({ where: { id } });
    res.json({ account });
  } catch (err) {
    console.error('Update account error:', err);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    await prisma.socialAccount.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// POST /api/accounts/:id/start-session
router.post('/:id/start-session', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    await prisma.socialAccount.update({
      where: { id },
      data: { status: 'active', lastActive: new Date() },
    });
    res.json({ success: true, message: 'Session started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// POST /api/accounts/import — bulk import from CSV
router.post('/import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No CSV file provided' });
    return;
  }

  const results: any[] = [];
  const errors: string[] = [];
  let successCount = 0;
  let rowNumber = 0;

  try {
    const fileContent = fs.readFileSync(req.file.path);
    const parser = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for await (const row of parser) {
      rowNumber++;
      results.push(row);

      try {
        const { username, email, password, platform, brandTag } = row;
        
        if (!username || !platform) {
          errors.push(`Row ${rowNumber}: Username and Platform are required`);
          continue;
        }

        let encryptedPassword: string | undefined;
        if (password) {
          try { encryptedPassword = encrypt(password); } catch { encryptedPassword = password; }
        }

        await prisma.socialAccount.create({
          data: {
            username,
            platform: platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase(), // Normalize e.g. "instagram" -> "Instagram"
            email: email || null,
            accountPassword: encryptedPassword || null,
            brandTag: brandTag || null,
            status: 'warming_up',
            warmingDay: 0,
            warmingStartDate: new Date(),
            workspaceId: 'workspace-default',
          }
        });
        successCount++;
      } catch (err: any) {
        errors.push(`Row ${rowNumber} (${row.username || 'unknown'}): ${err.message}`);
      }
    }

    res.json({
      message: `Import complete: ${successCount} success, ${errors.length} failed.`,
      successCount,
      errorCount: errors.length,
      errors: errors.slice(0, 50), // Cap errors list
    });

  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to process CSV file', details: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// POST /api/accounts/:id/stop-session

// POST /api/accounts/:id/stop-session
router.post('/:id/stop-session', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    await prisma.socialAccount.update({
      where: { id },
      data: { status: 'idle' },
    });
    res.json({ success: true, message: 'Session stopped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

export default router;
