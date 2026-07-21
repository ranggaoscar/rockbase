-- Add the previously schema-only Post field without changing existing rows.
ALTER TABLE "Post" ADD COLUMN "idempotencyKey" TEXT;

-- SQLite permits multiple NULL values in a unique index, preserving legacy rows.
CREATE UNIQUE INDEX "Post_idempotencyKey_key" ON "Post"("idempotencyKey");

-- Generic durable operation registry. Request bodies and credentials are not stored.
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "resourceType" TEXT,
    "resourceId" TEXT,
    "resultReference" JSONB,
    "errorCategory" TEXT,
    "metadata" JSONB,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
CREATE INDEX "IdempotencyRecord_status_updatedAt_idx" ON "IdempotencyRecord"("status", "updatedAt");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
