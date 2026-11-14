ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "platformSeq" INTEGER;

CREATE TABLE "PlatformEpisodePlan" (
  "id" TEXT NOT NULL,
  "albumId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceReconciliationJobId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "planJson" JSONB NOT NULL,
  "syncJobId" TEXT,
  "platformVersion" INTEGER,
  "createdByAdminUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformEpisodePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformEpisodePlan_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlatformEpisodePlan_syncJobId_key" ON "PlatformEpisodePlan"("syncJobId");
CREATE UNIQUE INDEX "PlatformEpisodePlan_albumId_sourceVersion_sourceReconciliationJobId_key"
  ON "PlatformEpisodePlan"("albumId", "sourceVersion", "sourceReconciliationJobId");
CREATE INDEX "PlatformEpisodePlan_albumId_status_idx" ON "PlatformEpisodePlan"("albumId", "status");
