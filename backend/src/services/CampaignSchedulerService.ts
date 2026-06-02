import { campaignService } from './CampaignService';

const DEFAULT_INTERVAL_MS = 60_000;

export class CampaignSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public init(): void {
    if (this.timer) return;

    const intervalMs = Number(process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    const safeIntervalMs = Number.isFinite(intervalMs)
      ? Math.max(15_000, intervalMs)
      : DEFAULT_INTERVAL_MS;

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[CampaignScheduler] Poll failed:', err.message || err);
      });
    }, safeIntervalMs);

    this.timer.unref?.();
    this.tick().catch((err) => {
      console.error('[CampaignScheduler] Initial poll failed:', err.message || err);
    });
    console.log(`[CampaignScheduler] Started with ${Math.round(safeIntervalMs / 1000)}s interval`);
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
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
