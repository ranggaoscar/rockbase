ALTER TABLE "AndroidJob" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "AndroidJob" ADD COLUMN "mediaPath" TEXT;
ALTER TABLE "AndroidJob" ADD COLUMN "mediaSha256" TEXT;
ALTER TABLE "AndroidJob" ADD COLUMN "caption" TEXT;
ALTER TABLE "AndroidJob" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "AndroidJob" ADD COLUMN "publishBoundaryAt" DATETIME;
ALTER TABLE "AndroidJob" ADD COLUMN "verificationResult" TEXT;
ALTER TABLE "AndroidJob" ADD COLUMN "evidencePath" TEXT;
CREATE UNIQUE INDEX "AndroidJob_idempotencyKey_key" ON "AndroidJob"("idempotencyKey");
