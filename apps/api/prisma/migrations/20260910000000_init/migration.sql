-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AlbumStatus" AS ENUM ('DRAFT', 'REVIEWING', 'ONLINE', 'OFFLINE', 'REJECTED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'UPLOADING', 'READY', 'REVIEWING', 'ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "UnlockType" AS ENUM ('FREE', 'REWARDED_AD', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AdType" AS ENUM ('REWARDED', 'INTERSTITIAL');

-- CreateEnum
CREATE TYPE "AdEventType" AS ENUM ('REQUESTED', 'SHOWN', 'CLOSED_COMPLETED', 'CLOSED_INCOMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "HomeBlockType" AS ENUM ('CONTINUE_WATCHING', 'CAROUSEL', 'GENRE', 'HOT', 'NEW_RELEASES', 'FEED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tiktokOpenId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "tiktokAlbumId" TEXT,
    "tiktokVersion" INTEGER,
    "onlineVersion" INTEGER,
    "reviewStatus" TEXT,
    "publishStatus" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "coverUrl" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "regions" JSONB,
    "status" "AlbumStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "tiktokEpisodeId" TEXT,
    "byteplusVid" TEXT,
    "tiktokCoverPicId" TEXT,
    "byteplusCoverUrl" TEXT,
    "episodeNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "durationMs" INTEGER,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "positionMs" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "unlockType" "UnlockType" NOT NULL,
    "placementId" TEXT,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientEventId" TEXT,
    "adType" "AdType" NOT NULL,
    "eventType" "AdEventType" NOT NULL,
    "placementId" TEXT NOT NULL,
    "episodeId" TEXT,
    "sessionId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "albumId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deepLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "autoplay" BOOLEAN NOT NULL DEFAULT true,
    "reducedData" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumTranslation" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "coverUrl" TEXT,

    CONSTRAINT "AlbumTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeTranslation" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "subtitleRef" TEXT,

    CONSTRAINT "EpisodeTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "translations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumGenre" (
    "albumId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,

    CONSTRAINT "AlbumGenre_pkey" PRIMARY KEY ("albumId","genreId")
);

-- CreateTable
CREATE TABLE "HomeBlock" (
    "id" TEXT NOT NULL,
    "type" "HomeBlockType" NOT NULL,
    "title" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "config" JSONB,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBlockItem" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "albumId" TEXT,
    "targetEpisodeId" TEXT,
    "imageUrl" TEXT,
    "linkPath" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "HomeBlockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackQualityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "episodeId" TEXT NOT NULL,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "startupMs" INTEGER,
    "currentTimeMs" INTEGER,
    "bufferMs" INTEGER,
    "networkType" TEXT,
    "definition" TEXT,
    "clientVersion" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackQualityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdRevenue" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "adType" "AdType" NOT NULL,
    "placementId" TEXT NOT NULL,
    "albumId" TEXT,
    "episodeId" TEXT,
    "reportKey" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "completedViews" INTEGER NOT NULL DEFAULT 0,
    "revenueMicros" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "providerJobId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceExpiresAt" TIMESTAMP(3),
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tiktokOpenId_key" ON "User"("tiktokOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_tiktokAlbumId_key" ON "Album"("tiktokAlbumId");

-- CreateIndex
CREATE INDEX "Album_status_updatedAt_idx" ON "Album"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_tiktokEpisodeId_key" ON "Episode"("tiktokEpisodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_byteplusVid_key" ON "Episode"("byteplusVid");

-- CreateIndex
CREATE INDEX "Episode_albumId_status_sortOrder_idx" ON "Episode"("albumId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_albumId_episodeNo_key" ON "Episode"("albumId", "episodeNo");

-- CreateIndex
CREATE INDEX "WatchProgress_userId_updatedAt_idx" ON "WatchProgress"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchProgress_userId_episodeId_key" ON "WatchProgress"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "EpisodeUnlock_episodeId_unlockedAt_idx" ON "EpisodeUnlock"("episodeId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeUnlock_userId_episodeId_key" ON "EpisodeUnlock"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "AdEvent_userId_adType_createdAt_idx" ON "AdEvent"("userId", "adType", "createdAt");

-- CreateIndex
CREATE INDEX "AdEvent_placementId_eventType_createdAt_idx" ON "AdEvent"("placementId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdEvent_userId_clientEventId_key" ON "AdEvent"("userId", "clientEventId");

-- CreateIndex
CREATE INDEX "AlbumLike_albumId_createdAt_idx" ON "AlbumLike"("albumId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumLike_userId_albumId_key" ON "AlbumLike"("userId", "albumId");

-- CreateIndex
CREATE INDEX "AlbumFavorite_userId_createdAt_idx" ON "AlbumFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumFavorite_userId_albumId_key" ON "AlbumFavorite"("userId", "albumId");

-- CreateIndex
CREATE INDEX "ShareEvent_albumId_createdAt_idx" ON "ShareEvent"("albumId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEvent_userId_createdAt_idx" ON "ShareEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_query_createdAt_idx" ON "SearchEvent"("query", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_locale_createdAt_idx" ON "SearchEvent"("locale", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "AlbumTranslation_locale_albumId_idx" ON "AlbumTranslation"("locale", "albumId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumTranslation_albumId_locale_key" ON "AlbumTranslation"("albumId", "locale");

-- CreateIndex
CREATE INDEX "EpisodeTranslation_locale_episodeId_idx" ON "EpisodeTranslation"("locale", "episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeTranslation_episodeId_locale_key" ON "EpisodeTranslation"("episodeId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE INDEX "AlbumGenre_genreId_albumId_idx" ON "AlbumGenre"("genreId", "albumId");

-- CreateIndex
CREATE INDEX "HomeBlock_enabled_sortOrder_idx" ON "HomeBlock"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HomeBlock_type_key" ON "HomeBlock"("type");

-- CreateIndex
CREATE INDEX "HomeBlockItem_blockId_sortOrder_idx" ON "HomeBlockItem"("blockId", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeBlockItem_albumId_idx" ON "HomeBlockItem"("albumId");

-- CreateIndex
CREATE INDEX "HomeBlockItem_targetEpisodeId_idx" ON "HomeBlockItem"("targetEpisodeId");

-- CreateIndex
CREATE INDEX "PlaybackQualityEvent_episodeId_createdAt_idx" ON "PlaybackQualityEvent"("episodeId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaybackQualityEvent_eventType_createdAt_idx" ON "PlaybackQualityEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdRevenue_reportKey_key" ON "AdRevenue"("reportKey");

-- CreateIndex
CREATE INDEX "AdRevenue_reportDate_albumId_episodeId_idx" ON "AdRevenue"("reportDate", "albumId", "episodeId");

-- CreateIndex
CREATE INDEX "AdRevenue_placementId_reportDate_idx" ON "AdRevenue"("placementId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "UploadJob_providerJobId_key" ON "UploadJob"("providerJobId");

-- CreateIndex
CREATE INDEX "UploadJob_status_createdAt_idx" ON "UploadJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UploadJob_status_nextAttemptAt_idx" ON "UploadJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_createdAt_idx" ON "AuditLog"("resource", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeUnlock" ADD CONSTRAINT "EpisodeUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeUnlock" ADD CONSTRAINT "EpisodeUnlock_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumLike" ADD CONSTRAINT "AlbumLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumLike" ADD CONSTRAINT "AlbumLike_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumFavorite" ADD CONSTRAINT "AlbumFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumFavorite" ADD CONSTRAINT "AlbumFavorite_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchEvent" ADD CONSTRAINT "SearchEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumTranslation" ADD CONSTRAINT "AlbumTranslation_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTranslation" ADD CONSTRAINT "EpisodeTranslation_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumGenre" ADD CONSTRAINT "AlbumGenre_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumGenre" ADD CONSTRAINT "AlbumGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeBlockItem" ADD CONSTRAINT "HomeBlockItem_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "HomeBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeBlockItem" ADD CONSTRAINT "HomeBlockItem_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeBlockItem" ADD CONSTRAINT "HomeBlockItem_targetEpisodeId_fkey" FOREIGN KEY ("targetEpisodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackQualityEvent" ADD CONSTRAINT "PlaybackQualityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackQualityEvent" ADD CONSTRAINT "PlaybackQualityEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenue" ADD CONSTRAINT "AdRevenue_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenue" ADD CONSTRAINT "AdRevenue_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadJob" ADD CONSTRAINT "UploadJob_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

