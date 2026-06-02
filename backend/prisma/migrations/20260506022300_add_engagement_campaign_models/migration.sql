-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Admin',
    "role" TEXT NOT NULL DEFAULT 'Operator',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkspaceUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "WorkspaceUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceUser_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accountPassword" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'warming_up',
    "cookies" TEXT,
    "proxyId" TEXT,
    "brandTag" TEXT,
    "notes" TEXT,
    "warmingDay" INTEGER NOT NULL DEFAULT 0,
    "warmingStartDate" DATETIME,
    "lastActive" DATETIME,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoDmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "replyTemplate" TEXT,
    "dmTemplate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SocialAccount_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'working',
    "lastChecked" DATETIME,
    "location" TEXT
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT NOT NULL,
    "accountIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "results" TEXT,
    "scheduleAt" DATETIME,
    "postedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WarmingLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "details" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarmingLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "socialAccountId" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "following" INTEGER NOT NULL DEFAULT 0,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" REAL NOT NULL DEFAULT 0,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Analytics_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT NOT NULL,
    "platforms" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Draft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT NOT NULL,
    "accountIds" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "recurrence" TEXT NOT NULL DEFAULT 'none',
    "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
    "recurrenceEndDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'workspace-default',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "accountIds" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "CampaignAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "scheduledAt" DATETIME,
    "executedAt" DATETIME,
    CONSTRAINT "CampaignAction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EngagementLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "target" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "details" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
