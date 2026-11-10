CREATE TABLE "AdPlacementPair" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL DEFAULT '*',
  "adType" "AdType" NOT NULL,
  "primaryPlacementId" TEXT NOT NULL,
  "backupPlacementId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "iosLoadMode" TEXT NOT NULL DEFAULT 'DIRECT_SHOW',
  "androidLoadMode" TEXT NOT NULL DEFAULT 'EXPLICIT_LOAD',
  "iosExperimentPercent" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdPlacementPair_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdPlacementPair_iosExperimentPercent_check" CHECK ("iosExperimentPercent" BETWEEN 0 AND 100),
  CONSTRAINT "AdPlacementPair_distinct_placements_check" CHECK ("backupPlacementId" IS NULL OR "backupPlacementId" <> "primaryPlacementId")
);

CREATE UNIQUE INDEX "AdPlacementPair_releaseId_adType_primaryPlacementId_key"
  ON "AdPlacementPair"("releaseId", "adType", "primaryPlacementId");
CREATE INDEX "AdPlacementPair_adType_primaryPlacementId_enabled_idx"
  ON "AdPlacementPair"("adType", "primaryPlacementId", "enabled");

ALTER TABLE "RewardedUnlockSession"
  ADD COLUMN "allowedPlacementIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "placementPolicyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "adLoadMode" TEXT NOT NULL DEFAULT 'EXPLICIT_LOAD',
  ADD COLUMN "strategyVariant" TEXT NOT NULL DEFAULT 'CONTROL';

ALTER TABLE "AppEntryAdSession"
  ADD COLUMN "allowedPlacementIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "placementPolicyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "adLoadMode" TEXT NOT NULL DEFAULT 'EXPLICIT_LOAD',
  ADD COLUMN "strategyVariant" TEXT NOT NULL DEFAULT 'CONTROL';

ALTER TABLE "ClientAnalyticsEvent"
  ADD COLUMN "adType" TEXT,
  ADD COLUMN "operationId" TEXT,
  ADD COLUMN "attemptNo" INTEGER,
  ADD COLUMN "adPhase" TEXT,
  ADD COLUMN "errorOrigin" TEXT,
  ADD COLUMN "strategyVariant" TEXT,
  ADD COLUMN "placementRole" TEXT;
ALTER TABLE "PlaybackQualityEvent"
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "tiktokClientVersion" TEXT,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "playerOperationId" TEXT,
  ADD COLUMN "preloadHit" BOOLEAN;
CREATE INDEX "PlaybackQualityEvent_playerOperationId_createdAt_idx"
  ON "PlaybackQualityEvent"("playerOperationId", "createdAt");
