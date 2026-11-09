CREATE TABLE "ClientAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "miniAppKey" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "userId" TEXT,
    "launchId" TEXT,
    "clientSessionId" TEXT,
    "eventKey" TEXT NOT NULL,
    "eventTs" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT,
    "appVersion" TEXT,
    "tiktokClientVersion" TEXT,
    "sdkVersion" TEXT,
    "placementId" TEXT,
    "adSeq" INTEGER,
    "result" TEXT,
    "isEnded" BOOLEAN,
    "durationMs" INTEGER,
    "shouldShow" INTEGER,
    "errorCode" TEXT,
    "errorMsg" TEXT,
    "subErrorCode" TEXT,
    "errorExtra" JSONB,
    "path" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ClientAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientAnalyticsEvent_miniAppKey_eventId_key" ON "ClientAnalyticsEvent"("miniAppKey", "eventId");
CREATE INDEX "ClientAnalyticsEvent_miniAppKey_eventKey_receivedAt_idx" ON "ClientAnalyticsEvent"("miniAppKey", "eventKey", "receivedAt");
CREATE INDEX "ClientAnalyticsEvent_miniAppKey_releaseId_receivedAt_idx" ON "ClientAnalyticsEvent"("miniAppKey", "releaseId", "receivedAt");
CREATE INDEX "ClientAnalyticsEvent_userId_eventTs_idx" ON "ClientAnalyticsEvent"("userId", "eventTs");
CREATE INDEX "ClientAnalyticsEvent_placementId_eventKey_receivedAt_idx" ON "ClientAnalyticsEvent"("placementId", "eventKey", "receivedAt");

ALTER TABLE "ClientAnalyticsEvent" ADD CONSTRAINT "ClientAnalyticsEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
