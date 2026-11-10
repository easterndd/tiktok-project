CREATE INDEX IF NOT EXISTS "ClientAnalyticsEvent_miniAppKey_operationId_idx"
  ON "ClientAnalyticsEvent"("miniAppKey", "operationId");
CREATE INDEX IF NOT EXISTS "ClientAnalyticsEvent_release_os_event_idx"
  ON "ClientAnalyticsEvent"("miniAppKey", "releaseId", "platform", "eventKey", "receivedAt");
