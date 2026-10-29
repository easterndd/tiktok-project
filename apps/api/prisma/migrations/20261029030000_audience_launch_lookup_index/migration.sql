-- The launch-context and entry-policy lookups filter by user and event type.
-- The existing createdAt/userId index reads most of the index for each lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AudienceActivityEvent_userId_eventType_createdAt_idx"
ON "AudienceActivityEvent"("userId", "eventType", "createdAt");
