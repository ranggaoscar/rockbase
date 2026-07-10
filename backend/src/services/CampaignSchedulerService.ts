import { campaignService } from './CampaignService';

const DEFAULT_INTERVAL_MS = 60_000;

export class CampaignSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private consecutiveErrors = 0;
  private hasInitialized = false;

  public init(): void {
    if (this.timer) return;

    const intervalMs = Number(process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    const safeIntervalMs = Number.isFinite(intervalMs)
      ? Math.max(15_000, intervalMs)
      : DEFAULT_INTERVAL_MS;

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[CampaignScheduler] Poll failed:', err.message || err);
        this.consecutiveErrors++;
      });
    }, safeIntervalMs);

    // Allow process to exit even if timer is active
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    // Initial tick - fire immediately
    this.tick().catch((err) => {
      console.error('[CampaignScheduler] Initial poll failed:', err.message || err);
    });

    console.log(`[CampaignScheduler] Started with ${Math.round(safeIntervalMs / 1000)}s interval`);
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log('[CampaignScheduler] Stopped.');
  }

  public async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      // Reset error counter on success
      this.consecutiveErrors = 0;

      // Quick check: if no campaigns exist, skip expensive query
      const count = await campaignService.getSchedulableCampaignCount().catch(() => 0);
      if (count === 0) {
        if (!this.hasInitialized) {
          console.log('[CampaignScheduler] No schedulable campaigns — skipping poll');
          this.hasInitialized = true;
        }
        return 0;
      }

      const prepared = await campaignService.pollDueScheduledCampaigns(new Date());
      if (prepared > 0) {
        console.log(`[CampaignScheduler] Prepared ${prepared} campaign draft(s)`);
      }
      return prepared;
    } finally {
      this.running = false;
    }
  }
}

export const campaignSchedulerService = new CampaignSchedulerService();
