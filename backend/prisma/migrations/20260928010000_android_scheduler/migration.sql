ALTER TABLE "SocialAccount" ADD COLUMN "androidHealth" TEXT NOT NULL DEFAULT 'HEALTHY';
ALTER TABLE "SocialAccount" ADD COLUMN "androidHealthReason" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "leaseJobId" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "AndroidDevice" ADD COLUMN "leaseHeartbeatAt" DATETIME;
ALTER TABLE "AndroidDevice" ADD COLUMN "idleSince" DATETIME;
ALTER TABLE "AndroidDevice" ADD COLUMN "lastBootDurationMs" INTEGER;
ALTER TABLE "AndroidDevice" ADD COLUMN "lastError" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "lastShutdownReason" TEXT;
CREATE INDEX "AndroidDevice_status_idleSince_idx" ON "AndroidDevice"("status", "idleSince");
CREATE INDEX "AndroidDevice_leaseExpiresAt_idx" ON "AndroidDevice"("leaseExpiresAt");
CREATE TABLE "AndroidJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'ANDROID_SMOKE',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "reason" TEXT,
  "result" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AndroidJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AndroidJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AndroidDevice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AndroidJob_status_createdAt_idx" ON "AndroidJob"("status", "createdAt");
CREATE INDEX "AndroidJob_deviceId_status_createdAt_idx" ON "AndroidJob"("deviceId", "status", "createdAt");
