CREATE TABLE "MiniAppRuntimeError" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "path" TEXT,
  "requestId" TEXT,
  "statusCode" INTEGER,
  "durationMs" INTEGER,
  "occurredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiniAppRuntimeError_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MiniAppRuntimeError_createdAt_idx" ON "MiniAppRuntimeError"("createdAt");
CREATE INDEX "MiniAppRuntimeError_kind_createdAt_idx" ON "MiniAppRuntimeError"("kind", "createdAt");
ALTER TABLE "AnalyticsDailySummary" ADD COLUMN "playbackSummary" JSONB;
CREATE TABLE "AnalyticsOverviewSnapshot" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "totals" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsOverviewSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AppEntryAdPolicy" ADD COLUMN "firstSeenAt" TIMESTAMP(3);
UPDATE "AppEntryAdPolicy" p SET "firstSeenAt" = s.first_seen FROM (SELECT "releaseId", MIN("createdAt") AS first_seen FROM "AppEntryAdSession" GROUP BY "releaseId") s WHERE p."releaseId" = s."releaseId";
