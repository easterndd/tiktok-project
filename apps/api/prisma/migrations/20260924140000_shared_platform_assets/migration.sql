-- Shared platform records live in the main database schema and are accessed by
-- every Mini App context. Local Album/Episode rows remain app-scoped.

CREATE TYPE "SharedMediaStatus" AS ENUM (
  'PENDING',
  'UPLOADING',
  'READY',
  'FAILED',
  'DELETED',
  'CONFLICT'
);

CREATE TYPE "AlbumAuthorizationStatus" AS ENUM (
  'PENDING',
  'AUTHORIZING',
  'AUTHORIZED',
  'REVOKING',
  'REVOKED',
  'FAILED',
  'CONFLICT'
);

CREATE TYPE "SharedPlatformOperationKind" AS ENUM (
  'AUTHORIZE_ALBUM',
  'REVOKE_ALBUM',
  'RECONCILE_ALBUM',
  'VERIFY_MEDIA'
);

CREATE TABLE "SharedMediaAsset" (
  "id" TEXT NOT NULL,
  "byteplusVid" TEXT NOT NULL,
  "byteplusAccountId" TEXT NOT NULL,
  "byteplusSpaceName" TEXT NOT NULL,
  "byteplusRegion" TEXT NOT NULL,
  "sourceSha256" TEXT,
  "sourceFileName" TEXT,
  "title" TEXT,
  "coverUrl" TEXT,
  "durationMs" INTEGER,
  "status" "SharedMediaStatus" NOT NULL DEFAULT 'PENDING',
  "firstUploadedByApp" TEXT NOT NULL,
  "firstUploadJobId" TEXT,
  "lastVerifiedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedMediaAsset_byteplusVid_key" ON "SharedMediaAsset"("byteplusVid");
CREATE INDEX "SharedMediaAsset_sourceSha256_byteplusAccountId_byteplusSpaceName_idx"
  ON "SharedMediaAsset"("sourceSha256", "byteplusAccountId", "byteplusSpaceName");
CREATE INDEX "SharedMediaAsset_status_updatedAt_idx"
  ON "SharedMediaAsset"("status", "updatedAt");
CREATE INDEX "SharedMediaAsset_byteplusAccountId_byteplusSpaceName_idx"
  ON "SharedMediaAsset"("byteplusAccountId", "byteplusSpaceName");

CREATE TABLE "SharedTikTokAlbum" (
  "id" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "ownerMiniAppKey" TEXT NOT NULL,
  "ownerClientKey" TEXT NOT NULL,
  "tiktokAlbumId" TEXT NOT NULL,
  "currentVersion" INTEGER,
  "onlineVersion" INTEGER,
  "reviewStatus" TEXT,
  "publishStatus" TEXT,
  "platformPublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedTikTokAlbum_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedTikTokAlbum_canonicalKey_key" ON "SharedTikTokAlbum"("canonicalKey");
CREATE UNIQUE INDEX "SharedTikTokAlbum_tiktokAlbumId_key" ON "SharedTikTokAlbum"("tiktokAlbumId");
CREATE INDEX "SharedTikTokAlbum_ownerMiniAppKey_updatedAt_idx"
  ON "SharedTikTokAlbum"("ownerMiniAppKey", "updatedAt");

CREATE TABLE "SharedTikTokEpisode" (
  "id" TEXT NOT NULL,
  "sharedAlbumId" TEXT NOT NULL,
  "episodeKey" TEXT NOT NULL,
  "episodeNo" INTEGER NOT NULL,
  "tiktokEpisodeId" TEXT NOT NULL,
  "tiktokCoverPicId" TEXT,
  "sharedMediaId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedTikTokEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedTikTokEpisode_sharedAlbumId_episodeKey_key"
  ON "SharedTikTokEpisode"("sharedAlbumId", "episodeKey");
CREATE UNIQUE INDEX "SharedTikTokEpisode_sharedAlbumId_episodeNo_key"
  ON "SharedTikTokEpisode"("sharedAlbumId", "episodeNo");
CREATE UNIQUE INDEX "SharedTikTokEpisode_tiktokEpisodeId_key"
  ON "SharedTikTokEpisode"("tiktokEpisodeId");
CREATE INDEX "SharedTikTokEpisode_sharedAlbumId_idx"
  ON "SharedTikTokEpisode"("sharedAlbumId");
CREATE INDEX "SharedTikTokEpisode_sharedMediaId_idx"
  ON "SharedTikTokEpisode"("sharedMediaId");

CREATE TABLE "MiniAppAlbumAuthorization" (
  "id" TEXT NOT NULL,
  "sharedAlbumId" TEXT NOT NULL,
  "miniAppKey" TEXT NOT NULL,
  "targetClientKey" TEXT NOT NULL,
  "targetAppId" TEXT,
  "targetLocalAlbumId" TEXT,
  "status" "AlbumAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
  "providerRequestId" TEXT,
  "providerResponse" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniAppAlbumAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiniAppAlbumAuthorization_sharedAlbumId_miniAppKey_key"
  ON "MiniAppAlbumAuthorization"("sharedAlbumId", "miniAppKey");
CREATE UNIQUE INDEX "MiniAppAlbumAuthorization_sharedAlbumId_targetClientKey_key"
  ON "MiniAppAlbumAuthorization"("sharedAlbumId", "targetClientKey");
CREATE INDEX "MiniAppAlbumAuthorization_miniAppKey_status_idx"
  ON "MiniAppAlbumAuthorization"("miniAppKey", "status");

CREATE TABLE "SharedPlatformOperation" (
  "id" TEXT NOT NULL,
  "kind" "SharedPlatformOperationKind" NOT NULL,
  "status" "PlatformSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "sharedAlbumId" TEXT,
  "targetMiniAppKey" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "snapshotHash" TEXT,
  "snapshotJson" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "providerRequestId" TEXT,
  "providerResponse" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedPlatformOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedPlatformOperation_dedupeKey_key"
  ON "SharedPlatformOperation"("dedupeKey");
CREATE INDEX "SharedPlatformOperation_status_nextAttemptAt_idx"
  ON "SharedPlatformOperation"("status", "nextAttemptAt");
CREATE INDEX "SharedPlatformOperation_sharedAlbumId_createdAt_idx"
  ON "SharedPlatformOperation"("sharedAlbumId", "createdAt");
CREATE INDEX "SharedPlatformOperation_targetMiniAppKey_createdAt_idx"
  ON "SharedPlatformOperation"("targetMiniAppKey", "createdAt");

ALTER TABLE "SharedTikTokEpisode"
  ADD CONSTRAINT "SharedTikTokEpisode_sharedAlbumId_fkey"
  FOREIGN KEY ("sharedAlbumId") REFERENCES "SharedTikTokAlbum"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SharedTikTokEpisode"
  ADD CONSTRAINT "SharedTikTokEpisode_sharedMediaId_fkey"
  FOREIGN KEY ("sharedMediaId") REFERENCES "SharedMediaAsset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MiniAppAlbumAuthorization"
  ADD CONSTRAINT "MiniAppAlbumAuthorization_sharedAlbumId_fkey"
  FOREIGN KEY ("sharedAlbumId") REFERENCES "SharedTikTokAlbum"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SharedPlatformOperation"
  ADD CONSTRAINT "SharedPlatformOperation_sharedAlbumId_fkey"
  FOREIGN KEY ("sharedAlbumId") REFERENCES "SharedTikTokAlbum"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
