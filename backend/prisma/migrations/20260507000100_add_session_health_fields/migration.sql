-- Additive session health metadata. Existing operational account status remains unchanged.
ALTER TABLE "SocialAccount" ADD COLUMN "sessionHealth" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "SocialAccount" ADD COLUMN "sessionHealthReason" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "sessionHealthCheckedAt" DATETIME;
