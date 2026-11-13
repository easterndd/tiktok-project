ALTER TABLE "AppEntryAdSession"
  ADD COLUMN "clientReportedShownCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientReportedCompletedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clientReportedAt" TIMESTAMP(3);

CREATE TABLE "EntryAdObservation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "adIndex" INTEGER NOT NULL,
  "placementId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntryAdObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EntryAdObservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AppEntryAdSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EntryAdObservation_sessionId_clientEventId_eventType_key" ON "EntryAdObservation"("sessionId", "clientEventId", "eventType");
CREATE INDEX "EntryAdObservation_sessionId_adIndex_receivedAt_idx" ON "EntryAdObservation"("sessionId", "adIndex", "receivedAt");
CREATE INDEX "EntryAdObservation_receivedAt_idx" ON "EntryAdObservation"("receivedAt");

CREATE TABLE "ClientTraceSession" (
  "id" TEXT NOT NULL,
  "miniAppKey" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "userId" TEXT,
  "platform" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "lastEventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientTraceSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientTraceSession_miniAppKey_releaseId_lastEventAt_idx" ON "ClientTraceSession"("miniAppKey", "releaseId", "lastEventAt");
CREATE INDEX "ClientTraceSession_lastEventAt_idx" ON "ClientTraceSession"("lastEventAt");

CREATE TABLE "ClientTraceRecord" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "phase" TEXT,
  "operationId" TEXT,
  "sessionId" TEXT,
  "requestId" TEXT,
  "placementId" TEXT,
  "errorCode" TEXT,
  "subErrorCode" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB NOT NULL,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ClientTraceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientTraceRecord_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "ClientTraceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClientTraceRecord_traceId_recordId_key" ON "ClientTraceRecord"("traceId", "recordId");
CREATE INDEX "ClientTraceRecord_traceId_seq_idx" ON "ClientTraceRecord"("traceId", "seq");
CREATE INDEX "ClientTraceRecord_operationId_eventAt_idx" ON "ClientTraceRecord"("operationId", "eventAt");
CREATE INDEX "ClientTraceRecord_requestId_eventAt_idx" ON "ClientTraceRecord"("requestId", "eventAt");
CREATE INDEX "ClientTraceRecord_errorCode_eventAt_idx" ON "ClientTraceRecord"("errorCode", "eventAt");
CREATE INDEX "ClientTraceRecord_sessionId_eventAt_idx" ON "ClientTraceRecord"("sessionId", "eventAt");
CREATE INDEX "ClientTraceRecord_receivedAt_idx" ON "ClientTraceRecord"("receivedAt");
