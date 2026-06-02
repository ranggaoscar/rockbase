-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountGroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountGroupMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountGroup_workspaceId_isArchived_name_idx" ON "AccountGroup"("workspaceId", "isArchived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_workspaceId_name_key" ON "AccountGroup"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AccountGroupMember_accountId_idx" ON "AccountGroupMember"("accountId");

-- CreateIndex
CREATE INDEX "AccountGroupMember_groupId_idx" ON "AccountGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroupMember_groupId_accountId_key" ON "AccountGroupMember"("groupId", "accountId");
