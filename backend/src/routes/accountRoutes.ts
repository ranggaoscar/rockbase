import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { automationGuard } from '../middleware/automation';
import { encrypt, decrypt } from '../utils/encryption';
import multer from 'multer';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import { sessionHealthService } from '../services/SessionHealthService';
import { accountPublicPayload, accountPublicSelect, normalizeAccountInput, normalizeImportedCookies } from '../utils/accountPayload';
import { getRockBaseMode } from '../middleware/runtimeMode';

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' });
async function validateEngine(engine: unknown, deviceId: unknown, platform: string) {
  if (engine === 'chromium' && !deviceId) return { executionEngine: 'chromium', homeDeviceId: null };
  if (engine !== 'android') throw new Error('Invalid execution engine or home device');
  if (getRockBaseMode() !== 'local' || process.platform !== 'win32' || platform !== 'Instagram') {
    throw new Error('Android accounts require Instagram on Windows Local Mode');
  }
  if (typeof deviceId !== 'string' || !deviceId || !(await prisma.androidDevice.findUnique({ where: { id: deviceId, enabled: true } }))) {
    throw new Error('Android accounts require a registered enabled home device');
  }
  return { executionEngine: 'android', homeDeviceId: deviceId };
}
const MAX_BULK_SESSION_CHECK = Math.max(1, Number(process.env.MAX_BULK_SESSION_CHECK || 3));

// All account routes require authentication
router.use(authenticateToken);

// GET /api/accounts — list all accounts
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany({
      where: { workspaceId: 'workspace-default' },
      select: accountPublicSelect as any,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ accounts });
  } catch (err) {
    console.error('List accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// GET /api/accounts/stats — summary stats for dashboard
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [total, active, warming_up, idle, error, instagram, tiktok] = await prisma.$transaction([
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', status: 'active' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', status: 'warming_up' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', status: 'idle' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', status: 'error' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', platform: 'Instagram' } }),
      prisma.socialAccount.count({ where: { workspaceId: 'workspace-default', platform: 'TikTok' } }),
    ]);
    const stats = {
      total, active, warming_up, idle, error, instagram, tiktok,
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
router.post('/check-session-bulk', automationGuard, async (req: AuthRequest, res: Response) => {
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

// POST /api/accounts/check-session-all?platform=Instagram
// Checks all accounts for a given platform. Returns a streaming-style
// result array — frontend can poll status during the bulk run.
router.post('/check-session-all', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const platform = String(req.query.platform || req.body?.platform || 'Instagram');
    const accounts = await prisma.socialAccount.findMany({
      where: { platform, status: { not: 'idle' } },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);
    if (accountIds.length === 0) {
      res.json({ checked: 0, results: [], summary: await sessionHealthService.getSummary() });
      return;
    }
    if (accountIds.length > MAX_BULK_SESSION_CHECK) {
      res.status(400).json({ error: `Total ${platform} accounts (${accountIds.length}) exceeds bulk limit (${MAX_BULK_SESSION_CHECK}). Use check-session-bulk with accountIds instead.` });
      return;
    }
    const results = await sessionHealthService.checkBulk(accountIds);
    res.json({
      checked: results.length,
      results,
      summary: await sessionHealthService.getSummary(),
    });
  } catch (err: any) {
    console.error('Bulk-all session health check error:', err);
    res.status(500).json({ error: 'Failed to check sessions', details: err.message });
  }
});

// POST /api/accounts/session-sweep?force=true
// Triggers the daily health-check sweep manually. Returns the sweep result.
router.post('/session-sweep', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionHealthScheduler } = await import('../services/SessionHealthScheduler');
    const force = req.query.force === 'true' || req.body?.force === true;
    const result = await sessionHealthScheduler.runSweep(force);
    res.json({ ...result, summary: await sessionHealthService.getSummary() });
  } catch (err: any) {
    console.error('Session sweep error:', err);
    res.status(500).json({ error: 'Failed to run session sweep', details: err.message });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const account = await prisma.socialAccount.findUnique({ where: { id }, select: accountPublicSelect as any });
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json({ account: accountPublicPayload(account as any) });
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
      } catch {
        res.status(409).json({ error: 'Stored password cannot be decrypted safely' });
        return;
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
router.post('/:id/check-session', automationGuard, async (req: AuthRequest, res: Response) => {
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
  const { username, password, platform, email, proxy, brandTag, notes, executionEngine, homeDeviceId } = req.body;

  try {
    const normalized = normalizeAccountInput({ username, platform });
    // Encrypt account password if provided
    let encryptedPassword: string | undefined;
    if (password) {
      encryptedPassword = encrypt(String(password));
    }

    const data: any = {
      username: normalized.username,
      platform: normalized.platform,
      status: 'warming_up',
      warmingDay: 0,
      warmingStartDate: new Date(),
      workspaceId: 'workspace-default',
    };
    if (executionEngine !== undefined || homeDeviceId !== undefined) Object.assign(data, await validateEngine(executionEngine ?? 'chromium', homeDeviceId, normalized.platform));

    if (encryptedPassword) data.accountPassword = encryptedPassword;
    if (email) data.email = email;
    if (brandTag) data.brandTag = brandTag;
    if (notes) data.notes = notes;

    // Parse proxy string "host:port:user:pass" and store as notes for now
    if (proxy) data.notes = `${notes ? notes + '\n' : ''}proxy:${proxy}`;

    const account = await prisma.socialAccount.create({ data, select: accountPublicSelect as any });
    res.status(201).json({ account: accountPublicPayload(account as any) });
  } catch (err: any) {
    console.error('Create account error:', err);
    if (/Username is required|Username is too long|Unsupported platform|execution engine|Android accounts/.test(err.message || '')) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// PATCH /api/accounts/:id — update account
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const { password } = req.body;
    const data: any = {};

    if (req.body.username !== undefined || req.body.platform !== undefined) {
      const existing = await prisma.socialAccount.findUnique({ where: { id }, select: { username: true, platform: true } });
      if (!existing) { res.status(404).json({ error: 'Account not found' }); return; }
      const normalized = normalizeAccountInput({
        username: req.body.username ?? existing.username,
        platform: req.body.platform ?? existing.platform,
      });
      if (req.body.username !== undefined) data.username = normalized.username;
      if (req.body.platform !== undefined) data.platform = normalized.platform;
    }
    for (const field of ['email', 'proxyId', 'brandTag', 'notes', 'autoReplyEnabled', 'autoDmEnabled', 'replyTemplate', 'dmTemplate'] as const) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }
    if (req.body.executionEngine !== undefined || req.body.homeDeviceId !== undefined || req.body.platform !== undefined) {
      const current = await prisma.socialAccount.findUnique({ where: { id }, select: { executionEngine: true, homeDeviceId: true, platform: true } });
      if (!current) { res.status(404).json({ error: 'Account not found' }); return; }
      Object.assign(data, await validateEngine(req.body.executionEngine ?? current.executionEngine,
        req.body.homeDeviceId !== undefined ? req.body.homeDeviceId : (req.body.executionEngine === 'chromium' ? null : current.homeDeviceId),
        data.platform ?? current.platform));
    }

    if (password) {
      data.accountPassword = encrypt(String(password));
    }

    const account = await prisma.socialAccount.update({ where: { id }, data, select: accountPublicSelect as any });
    res.json({ account: accountPublicPayload(account as any) });
  } catch (err: any) {
    console.error('Update account error:', err);
    if (/Username is required|Username is too long|Unsupported platform|execution engine|Android accounts/.test(err.message || '')) {
      res.status(400).json({ error: err.message });
      return;
    }
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
router.post('/:id/start-session', automationGuard, async (req: AuthRequest, res: Response) => {
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
          encryptedPassword = encrypt(String(password));
        }

        const normalized = normalizeAccountInput({ username, platform });

        await prisma.socialAccount.create({
          data: {
            username: normalized.username,
            platform: normalized.platform,
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

// ── Cookie Paste ─────────────────────────────────────────────────────────────
// POST /api/accounts/:id/cookies — import cookies for an account (no Playwright needed)
router.post('/:id/cookies', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const { cookies } = req.body;

  if (!cookies) {
    res.status(400).json({ error: 'cookies is required' });
    return;
  }

  try {
    const normalized = normalizeImportedCookies(cookies);

    // Encrypt cookies before storing
    const encrypted = encrypt(normalized.serialized);

    await prisma.socialAccount.update({
      where: { id },
      data: {
        cookies: encrypted,
        sessionHealth: 'UNKNOWN',
        sessionHealthReason: `Imported ${normalized.cookieCount} cookies; verification required`,
        sessionHealthCheckedAt: null,
        status: 'warming_up',
      },
    });

    res.json({
      success: true,
      message: 'Cookies imported securely. Run Check Session before automation.',
      requiresVerification: true,
      cookieCount: normalized.cookieCount,
    });
  } catch (err: any) {
    console.error('Cookie import error:', err);
    const status = /Cookies must|Cookie \d+|limited to 250/.test(err.message || '') ? 400 : 500;
    res.status(status).json({ error: status === 400 ? err.message : 'Failed to import cookies' });
  }
});

// POST /api/accounts/import-cookies-bulk — bulk import cookies via JSON
router.post('/import-cookies-bulk', async (req: AuthRequest, res: Response) => {
  const { accounts } = req.body;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    res.status(400).json({ error: 'accounts array is required' });
    return;
  }

  let successCount = 0;
  const errors: { username?: string; error: string }[] = [];

  for (const entry of accounts) {
    try {
      const account = await prisma.socialAccount.findFirst({
        where: {
          OR: [
            { id: entry.id || '' },
            { username: entry.username || '' },
          ],
        },
      });

      if (!account) {
        errors.push({ username: entry.username || entry.id, error: 'Account not found' });
        continue;
      }

      if (!entry.cookies) {
        errors.push({ username: account.username, error: 'No cookies provided' });
        continue;
      }

      const normalized = normalizeImportedCookies(entry.cookies);
      const encrypted = encrypt(normalized.serialized);

      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          cookies: encrypted,
          sessionHealth: 'UNKNOWN',
          sessionHealthReason: `Imported ${normalized.cookieCount} cookies; verification required`,
          sessionHealthCheckedAt: null,
          status: 'warming_up',
        },
      });

      successCount++;
    } catch (err: any) {
      errors.push({ username: entry.username || entry.id, error: err.message });
    }
  }

  res.json({
    success: successCount > 0,
    message: `Bulk import complete: ${successCount} success, ${errors.length} failed.`,
    successCount,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  });
});

// GET /api/accounts/:id/cookies — export cookies (for backup / export)
router.get('/:id/cookies', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const account = await prisma.socialAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    if (!account.cookies) {
      res.status(404).json({ error: 'No cookies stored for this account' });
      return;
    }

    let decrypted: string;
    try {
      decrypted = decrypt(account.cookies);
    } catch {
      res.status(409).json({ error: 'Stored cookies cannot be decrypted safely' });
      return;
    }

    // Try to parse as JSON for pretty display
    try {
      const parsed = JSON.parse(decrypted);
      res.json({ success: true, cookies: parsed });
    } catch {
      res.json({ success: true, cookies: decrypted });
    }
  } catch (err: any) {
    console.error('Cookie export error:', err);
    res.status(500).json({ error: 'Failed to export cookies' });
  }
});

export default router;
