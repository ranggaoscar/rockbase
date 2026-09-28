CREATE TABLE "AndroidDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "avdName" TEXT NOT NULL,
    "adbSerial" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "ramMb" INTEGER NOT NULL DEFAULT 2048,
    "cpuCores" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastBootAt" DATETIME,
    "lastHealthcheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AndroidDevice_name_key" ON "AndroidDevice"("name");
CREATE UNIQUE INDEX "AndroidDevice_avdName_key" ON "AndroidDevice"("avdName");
ALTER TABLE "SocialAccount" ADD COLUMN "executionEngine" TEXT NOT NULL DEFAULT 'chromium';
ALTER TABLE "SocialAccount" ADD COLUMN "homeDeviceId" TEXT REFERENCES "AndroidDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SocialAccount_homeDeviceId_idx" ON "SocialAccount"("homeDeviceId");
