ALTER TABLE "AppEntryAdPolicy"
ADD COLUMN "exitRetentionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "exitRetentionAdCount" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "RewardedUnlockPurpose" AS ENUM ('EPISODE_UNLOCK', 'EXIT_RETENTION');
ALTER TYPE "AdScope" ADD VALUE 'EXIT_RETENTION';

ALTER TABLE "RewardedUnlockSession"
ADD COLUMN "purpose" "RewardedUnlockPurpose" NOT NULL DEFAULT 'EPISODE_UNLOCK',
ADD COLUMN "releaseId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "RewardedUnlockSession_one_active_per_user_episode";
CREATE UNIQUE INDEX "reward_session_active_context"
ON "RewardedUnlockSession" ("userId", "episodeId", "purpose", "releaseId")
WHERE "status" = 'ACTIVE';

DROP INDEX "RewardedUnlockSession_userId_episodeId_status_expiresAt_idx";
CREATE INDEX "reward_session_lookup_context"
ON "RewardedUnlockSession" ("userId", "episodeId", "purpose", "releaseId", "status", "expiresAt");
