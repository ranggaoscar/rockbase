-- Campaign Scheduler Phase 1: scheduling metadata only.
ALTER TABLE "Campaign" ADD COLUMN "scheduledAt" DATETIME;
ALTER TABLE "Campaign" ADD COLUMN "schedulerStatus" TEXT NOT NULL DEFAULT 'PENDING';

CREATE INDEX "Campaign_schedulerStatus_scheduledAt_idx" ON "Campaign"("schedulerStatus", "scheduledAt");
