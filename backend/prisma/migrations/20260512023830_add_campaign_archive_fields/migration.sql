-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'workspace-default',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "accountIds" TEXT NOT NULL,
    "groupIds" TEXT NOT NULL DEFAULT '[]',
    "planningSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dailyFollowLimit" INTEGER NOT NULL DEFAULT 25,
    "dailyLikeLimit" INTEGER NOT NULL DEFAULT 65,
    "dailyCommentLimit" INTEGER NOT NULL DEFAULT 12,
    "totalActions" INTEGER NOT NULL DEFAULT 0,
    "completedActions" INTEGER NOT NULL DEFAULT 0,
    "failedActions" INTEGER NOT NULL DEFAULT 0,
    "activeHoursStart" TEXT NOT NULL DEFAULT '08:00',
    "activeHoursEnd" TEXT NOT NULL DEFAULT '22:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "scheduledAt" DATETIME,
    "schedulerStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME
);
INSERT INTO "new_Campaign" ("accountIds", "activeHoursEnd", "activeHoursStart", "completedActions", "completedAt", "createdAt", "dailyCommentLimit", "dailyFollowLimit", "dailyLikeLimit", "failedActions", "groupIds", "id", "name", "planningSummary", "scheduledAt", "schedulerStatus", "status", "targetType", "targetValue", "timezone", "totalActions", "type", "updatedAt", "workspaceId") SELECT "accountIds", "activeHoursEnd", "activeHoursStart", "completedActions", "completedAt", "createdAt", "dailyCommentLimit", "dailyFollowLimit", "dailyLikeLimit", "failedActions", "groupIds", "id", "name", "planningSummary", "scheduledAt", "schedulerStatus", "status", "targetType", "targetValue", "timezone", "totalActions", "type", "updatedAt", "workspaceId" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_schedulerStatus_scheduledAt_idx" ON "Campaign"("schedulerStatus", "scheduledAt");
CREATE INDEX "Campaign_workspaceId_isArchived_createdAt_idx" ON "Campaign"("workspaceId", "isArchived", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
