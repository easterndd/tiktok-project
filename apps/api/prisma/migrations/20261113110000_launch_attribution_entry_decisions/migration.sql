CREATE TABLE "MiniAppLaunch" (
  "id" TEXT NOT NULL,
  "miniAppKey" TEXT NOT NULL,
  "launchId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "launchRef" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "collectionStatus" TEXT NOT NULL,
  "localAttributionStatus" TEXT NOT NULL,
  "attributionReason" TEXT NOT NULL,
  "platformAttributionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "signalSummary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniAppLaunch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MiniAppLaunch_launchRef_key" ON "MiniAppLaunch"("launchRef");
CREATE UNIQUE INDEX "MiniAppLaunch_miniAppKey_launchId_key" ON "MiniAppLaunch"("miniAppKey", "launchId");
CREATE INDEX "MiniAppLaunch_miniAppKey_releaseId_createdAt_idx" ON "MiniAppLaunch"("miniAppKey", "releaseId", "createdAt");
CREATE INDEX "MiniAppLaunch_userId_createdAt_idx" ON "MiniAppLaunch"("userId", "createdAt");
CREATE INDEX "MiniAppLaunch_localAttributionStatus_createdAt_idx" ON "MiniAppLaunch"("localAttributionStatus", "createdAt");

CREATE TABLE "MiniAppEntryAdDecision" (
  "id" TEXT NOT NULL,
  "launchRef" TEXT NOT NULL,
  "miniAppKey" TEXT NOT NULL,
  "launchId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attributionStatus" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "policyVersion" INTEGER,
  "requiredCount" INTEGER,
  "countMode" TEXT,
  "sessionId" TEXT,
  "requestId" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiniAppEntryAdDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MiniAppEntryAdDecision_launchRef_key" ON "MiniAppEntryAdDecision"("launchRef");
CREATE INDEX "MiniAppEntryAdDecision_miniAppKey_releaseId_decidedAt_idx" ON "MiniAppEntryAdDecision"("miniAppKey", "releaseId", "decidedAt");
CREATE INDEX "MiniAppEntryAdDecision_userId_decidedAt_idx" ON "MiniAppEntryAdDecision"("userId", "decidedAt");
CREATE INDEX "MiniAppEntryAdDecision_decision_reason_decidedAt_idx" ON "MiniAppEntryAdDecision"("decision", "reason", "decidedAt");
