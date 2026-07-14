/**
 * SessionHealthScheduler — daily health-check sweep for all accounts.
 *
 * Runs once per day and re-checks every account that hasn't been verified
 * in the last 24 hours. This prevents stale sessionHealth flags from
 * rotting in the database (e.g. 35 days old like the @budikanebo case).
 */

import { PrismaClient } from '@prisma/client';
import { sessionHealthService } from './SessionHealthService';
import { logger } from './logger';
import { logActivity } from './ActivityLogService';

const prisma = new PrismaClient();

const RE_CHECK_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const CHECK_COOLDOWN_MS = 30 * 60 * 1000;       // 30min — don't check the same account twice in a row
const TICK_INTERVAL_MS = 60 * 60 * 1000;        // sweep every 1 hour, check if 24h elapsed

export class SessionHealthScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastFullSweepAt: Date | null = null;
  private running = false;

  public init(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('SessionHealthScheduler tick failed', { error: err.message });
      });
    }, TICK_INTERVAL_MS);
    logger.info('SessionHealthScheduler initialized', {
      tickIntervalMs: TICK_INTERVAL_MS,
      recheckAfterMs: RE_CHECK_AFTER_MS,
    });
  }

  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    // Skip if a sweep ran recently
    if (this.lastFullSweepAt && Date.now() - this.lastFullSweepAt.getTime() < CHECK_COOLDOWN_MS) {
      return;
    }
    await this.runSweep();
  }

  /**
   * Re-check every account whose sessionHealth is older than RE_CHECK_AFTER_MS.
   * Skips accounts that are paused. Runs in batches of 10 to avoid
   * resource spikes.
   */
  public async runSweep(force = false): Promise<{ checked: number; updated: number; durationMs: number }> {
    if (this.running) {
      logger.warn('SessionHealthScheduler sweep already running, skipping');
      return { checked: 0, updated: 0, durationMs: 0 };
    }
    this.running = true;
    const start = Date.now();
    const cutoff = new Date(Date.now() - RE_CHECK_AFTER_MS);

    const accounts = await prisma.socialAccount.findMany({
      where: {
        status: { not: 'idle' },
        platform: { in: ['Instagram', 'TikTok', 'Tiktok'] },
        ...(force ? {} : {
          OR: [
            { sessionHealthCheckedAt: null },
            { sessionHealthCheckedAt: { lt: cutoff } },
          ],
        }),
      },
      select: { id: true, username: true, platform: true, sessionHealth: true, sessionHealthCheckedAt: true },
    });

    if (accounts.length === 0) {
      this.running = false;
      this.lastFullSweepAt = new Date();
      return { checked: 0, updated: 0, durationMs: Date.now() - start };
    }

    logger.info('SessionHealthScheduler sweep starting', {
      accountCount: accounts.length,
      cutoff: cutoff.toISOString(),
    });

    let updated = 0;
    let checked = 0;
    const BATCH_SIZE = 10;
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      for (const account of batch) {
        try {
          const previousHealth = account.sessionHealth;
          const result = await sessionHealthService.checkAccount(account.id);
          checked++;
          if (result.health !== previousHealth) {
            updated++;
            logActivity({
              workspaceId: 'workspace-default',
              type: 'session',
              entityType: 'account',
              entityId: account.id,
              accountId: account.id,
              action: 'scheduled_health_check_changed',
              status: result.health === 'HEALTHY' ? 'success' : 'warning',
              message: `Scheduled health check for @${account.username}: ${previousHealth} → ${result.health}`,
              metadata: {
                previousHealth,
                newHealth: result.health,
                reason: result.reason,
                platform: account.platform,
              },
            });
          }
        } catch (err: any) {
          logger.error('SessionHealthScheduler account check failed', {
            accountId: account.id,
            username: account.username,
            error: err.message,
          });
        }
      }
      // Small pause between batches to avoid hammering the system
      if (i + BATCH_SIZE < accounts.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const durationMs = Date.now() - start;
    this.lastFullSweepAt = new Date();
    this.running = false;
    logger.info('SessionHealthScheduler sweep complete', {
      checked,
      updated,
      total: accounts.length,
      durationMs,
    });
    return { checked, updated, durationMs };
  }
}

export const sessionHealthScheduler = new SessionHealthScheduler();
