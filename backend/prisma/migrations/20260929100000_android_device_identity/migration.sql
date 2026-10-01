-- RockDroid device identity + persistence guard (Phase 3E).
-- Additive and nullable: existing AndroidDevice rows stay unenrolled (all NULL) and keep booting,
-- until their first authorized boot pins the host identity and the persistent marker UUID.
-- The marker is unique so two devices can never advertise the same identity (cloned userdata).
ALTER TABLE "AndroidDevice" ADD COLUMN "avdIniPath" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "avdAbsolutePath" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "userdataPath" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "systemImage" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "persistentMarker" TEXT;
ALTER TABLE "AndroidDevice" ADD COLUMN "identityEnrolledAt" DATETIME;
ALTER TABLE "AndroidDevice" ADD COLUMN "identityVerifiedAt" DATETIME;
ALTER TABLE "AndroidDevice" ADD COLUMN "identityError" TEXT;
CREATE UNIQUE INDEX "AndroidDevice_persistentMarker_key" ON "AndroidDevice"("persistentMarker");
