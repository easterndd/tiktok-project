CREATE TYPE "PlatformSyncJobKind" AS ENUM (
  'COVER',
  'VIDEO',
  'ALBUM_VERSION',
  'REVIEW',
  'SET_ONLINE_VERSION',
  'PUBLISH',
  'UNPUBLISH',
  'RECONCILE'
);

CREATE TYPE "PlatformSyncJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'CONFLICT'
);

CREATE TYPE "BytePlusUploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'READY', 'FAILED');
CREATE TYPE "TikTokVideoStatus" AS ENUM ('NOT_STARTED', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "Album"
  ADD COLUMN "platformPublishedVersion" INTEGER,
  ADD COLUMN "platformPublishedAt" TIMESTAMP(3),
  ADD COLUMN "releaseYear" INTEGER,
  ADD COLUMN "dramaType" INTEGER,
  ADD COLUMN "tagList" JSONB;

ALTER TABLE "CoverAsset"
  ADD COLUMN "platformSyncedAt" TIMESTAMP(3),
  ADD COLUMN "platformSyncError" TEXT;

ALTER TABLE "Episode"
  ADD COLUMN "tiktokVideoJobId" TEXT,
  ADD COLUMN "tiktokVideoStatus" "TikTokVideoStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "tiktokVideoError" TEXT,
  ADD COLUMN "byteplusUploadStatus" "BytePlusUploadStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "platformSyncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Episode_tiktokVideoJobId_key" ON "Episode"("tiktokVideoJobId");

CREATE TABLE "PlatformSyncJob" (
  "id" TEXT NOT NULL,
  "kind" "PlatformSyncJobKind" NOT NULL,
  "status" "PlatformSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "targetId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "snapshotHash" TEXT,
  "snapshotJson" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "providerJobId" TEXT,
  "providerRequestId" TEXT,
  "providerResponse" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdByAdminUserId" TEXT,
  "albumId" TEXT,
  "episodeId" TEXT,
  "coverAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformSyncJob_dedupeKey_key" ON "PlatformSyncJob"("dedupeKey");
CREATE INDEX "PlatformSyncJob_status_nextAttemptAt_idx" ON "PlatformSyncJob"("status", "nextAttemptAt");
CREATE INDEX "PlatformSyncJob_kind_targetId_createdAt_idx" ON "PlatformSyncJob"("kind", "targetId", "createdAt");
CREATE INDEX "PlatformSyncJob_albumId_createdAt_idx" ON "PlatformSyncJob"("albumId", "createdAt");

ALTER TABLE "PlatformSyncJob"
  ADD CONSTRAINT "PlatformSyncJob_albumId_fkey"
  FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PlatformSyncJob_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PlatformSyncJob_coverAssetId_fkey"
  FOREIGN KEY ("coverAssetId") REFERENCES "CoverAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PlatformSyncJob_createdByAdminUserId_fkey"
  FOREIGN KEY ("createdByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
