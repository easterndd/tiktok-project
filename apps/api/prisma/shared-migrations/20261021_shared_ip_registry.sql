-- Apply only to SHARED_PLATFORM_DATABASE_URL (or DATABASE_URL when shared defaults to main).
-- Never run this migration against each Mini App's isolated schema.
CREATE TABLE IF NOT EXISTS "SharedIpAddress" (
  "ipHash" CHAR(64) PRIMARY KEY,
  "ipAddress" VARCHAR(45),
  "visitCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMiniAppKey" VARCHAR(64) NOT NULL,
  "countryCode" VARCHAR(2)
);
CREATE INDEX IF NOT EXISTS "SharedIpAddress_lastSeenAt_idx" ON "SharedIpAddress" ("lastSeenAt" DESC);
CREATE INDEX IF NOT EXISTS "SharedIpAddress_visitCount_idx" ON "SharedIpAddress" ("visitCount" DESC);
CREATE TABLE IF NOT EXISTS "SharedIpVisit" (
  "idempotencyKey" CHAR(64) PRIMARY KEY,
  "ipHash" CHAR(64) NOT NULL REFERENCES "SharedIpAddress" ("ipHash") ON DELETE CASCADE,
  "miniAppKey" VARCHAR(64) NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SharedIpVisit_ipHash_createdAt_idx" ON "SharedIpVisit" ("ipHash", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SharedIpVisit_miniAppKey_userId_createdAt_idx" ON "SharedIpVisit" ("miniAppKey", "userId", "createdAt" DESC);
CREATE TABLE IF NOT EXISTS "SharedEntryAdIpExemption" (
  "ipAddress" VARCHAR(45) PRIMARY KEY,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" VARCHAR(128) NOT NULL
);
