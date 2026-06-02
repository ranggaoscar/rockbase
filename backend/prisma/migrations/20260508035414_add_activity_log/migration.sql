-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT,
    "groupId" TEXT,
    "campaignId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_createdAt_idx" ON "ActivityLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_type_createdAt_idx" ON "ActivityLog"("workspaceId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_status_createdAt_idx" ON "ActivityLog"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_accountId_createdAt_idx" ON "ActivityLog"("workspaceId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_groupId_createdAt_idx" ON "ActivityLog"("workspaceId", "groupId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_campaignId_createdAt_idx" ON "ActivityLog"("workspaceId", "campaignId", "createdAt");
