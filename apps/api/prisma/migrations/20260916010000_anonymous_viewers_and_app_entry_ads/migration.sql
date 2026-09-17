-- Anonymous viewers retain the existing User relations while no longer
-- requiring a TikTok OAuth identity.
CREATE TYPE "UserIdentityType" AS ENUM ('ANONYMOUS', 'TIKTOK');
CREATE TYPE "AdScope" AS ENUM ('EPISODE_UNLOCK', 'APP_ENTRY');
CREATE TYPE "AppEntryAdMode" AS ENUM ('INTERSTITIAL', 'REWARDED_GATED');
CREATE TYPE "AppEntryAdFallback" AS ENUM ('ALLOW', 'BLOCK');
CREATE TYPE "AppEntryAdSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'EXPIRED');

ALTER TABLE "User"
  ADD COLUMN "identityType" "UserIdentityType" NOT NULL DEFAULT 'TIKTOK',
  ADD COLUMN "visitorKeyHash" TEXT;

ALTER TABLE "User" ALTER COLUMN "tiktokOpenId" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "identityType" SET DEFAULT 'ANONYMOUS';
CREATE UNIQUE INDEX "User_visitorKeyHash_key" ON "User"("visitorKeyHash");

ALTER TABLE "AdEvent"
  ADD COLUMN "scope" "AdScope" NOT NULL DEFAULT 'EPISODE_UNLOCK',
  ADD COLUMN "appEntrySessionId" TEXT;

CREATE TABLE "AppEntryAdPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" "AppEntryAdMode" NOT NULL DEFAULT 'INTERSTITIAL',
  "placementId" TEXT NOT NULL DEFAULT 'app_entry_interstitial',
  "requiredCount" INTEGER NOT NULL DEFAULT 1,
  "onUnavailable" "AppEntryAdFallback" NOT NULL DEFAULT 'ALLOW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppEntryAdPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppEntryAdSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "launchId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "placementId" TEXT NOT NULL,
  "mode" "AppEntryAdMode" NOT NULL,
  "requiredCount" INTEGER NOT NULL,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "status" "AppEntryAdSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppEntryAdSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppEntryAdCompletion" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "adIndex" INTEGER NOT NULL,
  "adEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppEntryAdCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppEntryAdSession_userId_launchId_key" ON "AppEntryAdSession"("userId", "launchId");
CREATE INDEX "AppEntryAdSession_userId_status_expiresAt_idx" ON "AppEntryAdSession"("userId", "status", "expiresAt");
CREATE UNIQUE INDEX "AppEntryAdCompletion_sessionId_clientEventId_key" ON "AppEntryAdCompletion"("sessionId", "clientEventId");
CREATE UNIQUE INDEX "AppEntryAdCompletion_sessionId_adIndex_key" ON "AppEntryAdCompletion"("sessionId", "adIndex");
CREATE INDEX "AdEvent_appEntrySessionId_adIndex_idx" ON "AdEvent"("appEntrySessionId", "adIndex");

ALTER TABLE "AppEntryAdSession" ADD CONSTRAINT "AppEntryAdSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppEntryAdCompletion" ADD CONSTRAINT "AppEntryAdCompletion_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AppEntryAdSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_appEntrySessionId_fkey"
  FOREIGN KEY ("appEntrySessionId") REFERENCES "AppEntryAdSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
