import { BrowserContext, Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { browserManager } from './BrowserManager';
import { logActivity } from './ActivityLogService';

const prisma = new PrismaClient();

export type SessionHealthStatus =
  | 'HEALTHY'
  | 'NEEDS_RELOGIN'
  | 'CHECKPOINT'
  | 'EXPIRED'
  | 'PAUSED'
  | 'UNKNOWN';

export interface SessionHealthResult {
  accountId: string;
  username: string;
  health: SessionHealthStatus;
  reason: string;
  checkedAt: string;
}

/**
 * HEALTHY: session verified working
 * UNKNOWN: not yet checked (allowed — account may work fine)
 *
 * Blocked states: NEEDS_RELOGIN, CHECKPOINT, EXPIRED, PAUSED
 */
const HEALTHY_STATUSES = new Set<SessionHealthStatus>(['HEALTHY', 'UNKNOWN']);
const BULK_CHECK_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.SESSION_HEALTH_CHECK_CONCURRENCY || 2)));

export class SessionHealthService {
  public isPostableHealth(value: string | null | undefined): boolean {
    return HEALTHY_STATUSES.has((value || 'UNKNOWN') as SessionHealthStatus);
  }

  public async checkAccount(accountId: string): Promise<SessionHealthResult> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    const checkedAt = new Date();

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    if (account.status === 'idle') {
      return this.persistResult(account.id, account.workspaceId, account.username, 'PAUSED', 'Account is paused/idle', checkedAt);
    }

    if (account.platform !== 'Instagram') {
      return this.persistResult(account.id, account.workspaceId, account.username, 'UNKNOWN', 'Session checks currently support Instagram only', checkedAt);
    }

    if (!account.cookies) {
      return this.persistResult(account.id, account.workspaceId, account.username, 'EXPIRED', 'No saved Instagram cookies', checkedAt);
    }

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await browserManager.getContext(account.id);
      page = await context.newPage();
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const detected = await this.detectInstagramHealth(page);
      if (detected.health === 'HEALTHY') {
        await browserManager.saveCookies(account.id).catch((err: any) => {
          console.warn(`[SessionHealth] Cookie save failed for @${account.username}: ${err.message}`);
        });
      }

      return this.persistResult(account.id, account.workspaceId, account.username, detected.health, detected.reason, checkedAt);
    } catch (err: any) {
      return this.persistResult(
        account.id,
        account.workspaceId,
        account.username,
        'UNKNOWN',
        `Health check failed: ${err.message || String(err)}`,
        checkedAt,
      );
    } finally {
      await page?.close().catch(() => {});
      await browserManager.closeContext(account.id, { saveCookies: false });
    }
  }

  public async checkBulk(accountIds: string[]): Promise<SessionHealthResult[]> {
    const uniqueIds = [...new Set(accountIds.filter(Boolean))];
    const results: SessionHealthResult[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < uniqueIds.length) {
        const index = cursor++;
        results[index] = await this.checkAccount(uniqueIds[index]);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BULK_CHECK_CONCURRENCY, uniqueIds.length) }, () => worker()),
    );

    return results.filter(Boolean);
  }

  public async getSummary() {
    const accounts = await prisma.socialAccount.findMany({
      select: { sessionHealth: true },
    });

    const base: Record<SessionHealthStatus, number> = {
      HEALTHY: 0,
      NEEDS_RELOGIN: 0,
      CHECKPOINT: 0,
      EXPIRED: 0,
      PAUSED: 0,
      UNKNOWN: 0,
    };

    for (const account of accounts) {
      const health = (account.sessionHealth || 'UNKNOWN') as SessionHealthStatus;
      base[health] = (base[health] || 0) + 1;
    }

    return { ...base, total: accounts.length };
  }

  private async detectInstagramHealth(page: Page): Promise<{ health: SessionHealthStatus; reason: string }> {
    const url = page.url();
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

    if (/checkpoint|challenge|suspended|verify|confirm your/i.test(url) || /checkpoint|challenge|confirm your account|verify your account|suspended/i.test(bodyText)) {
      return { health: 'CHECKPOINT', reason: 'Instagram checkpoint/challenge detected' };
    }

    const loginVisible = await page.locator('input[name="username"], input[name="password"], form:has(input[name="username"])')
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);

    if (loginVisible || /\/accounts\/login/i.test(url)) {
      return { health: 'NEEDS_RELOGIN', reason: 'Instagram login page detected' };
    }

    const loggedInSignal = await page.locator(
      'a[href="/"], a[href="/explore/"], svg[aria-label="Home"], svg[aria-label="Create"], [aria-label="Home"], [aria-label="Profile"]',
    ).first().isVisible({ timeout: 5000 }).catch(() => false);

    if (loggedInSignal) {
      return { health: 'HEALTHY', reason: 'Logged-in Instagram UI detected' };
    }

    if (/log in|sign up/i.test(bodyText)) {
      return { health: 'NEEDS_RELOGIN', reason: 'Logged-out Instagram text detected' };
    }

    return { health: 'UNKNOWN', reason: 'Could not confidently determine session state' };
  }

  private async persistResult(
    accountId: string,
    workspaceId: string,
    username: string,
    health: SessionHealthStatus,
    reason: string,
    checkedAt: Date,
  ): Promise<SessionHealthResult> {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        sessionHealth: health,
        sessionHealthReason: reason,
        sessionHealthCheckedAt: checkedAt,
        ...(health === 'HEALTHY' ? { lastActive: checkedAt } : {}),
      } as any,
    });

    const result = {
      accountId,
      username,
      health,
      reason,
      checkedAt: checkedAt.toISOString(),
    };

    console.log(`[SessionHealth] @${username} health=${health} reason="${reason}" checkedAt=${result.checkedAt}`);
    logActivity({
      workspaceId,
      type: 'session',
      entityType: 'account',
      entityId: accountId,
      accountId,
      action: 'session_health_check',
      status: health === 'HEALTHY' ? 'success' : health === 'CHECKPOINT' ? 'warning' : 'failed',
      message: `@${username} session health: ${health}`,
      metadata: { health, reason, checkedAt: result.checkedAt },
    });
    return result;
  }
}

export const sessionHealthService = new SessionHealthService();
