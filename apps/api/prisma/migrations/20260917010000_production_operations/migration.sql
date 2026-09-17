-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'EDITOR', 'ANALYST', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "UiConfigStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "AdminUser"
ADD COLUMN "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

ALTER TABLE "AdminUser" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "AdminUser"
ALTER COLUMN "role" TYPE "AdminRole"
USING (
  CASE
    WHEN UPPER("role") = 'OWNER' THEN 'OWNER'::"AdminRole"
    WHEN UPPER("role") = 'ANALYST' THEN 'ANALYST'::"AdminRole"
    WHEN UPPER("role") = 'SUPPORT' THEN 'SUPPORT'::"AdminRole"
    ELSE 'EDITOR'::"AdminRole"
  END
);
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'EDITOR';

-- CreateTable
CREATE TABLE "AppSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientSessionId" TEXT NOT NULL,
  "platform" TEXT,
  "clientVersion" TEXT,
  "source" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstFrameAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "lastPositionMs" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  CONSTRAINT "PlaybackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeCompletionEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "playbackSessionId" TEXT,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpisodeCompletionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceActivityEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "episodeId" TEXT,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudienceActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UiConfigVersion" (
  "version" SERIAL NOT NULL,
  "status" "UiConfigStatus" NOT NULL DEFAULT 'DRAFT',
  "content" JSONB NOT NULL,
  "createdById" TEXT,
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "UiConfigVersion_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "AlbumFavorite_createdAt_idx" ON "AlbumFavorite"("createdAt");
CREATE INDEX "PlaybackQualityEvent_sessionId_createdAt_idx" ON "PlaybackQualityEvent"("sessionId", "createdAt");
CREATE INDEX "PlaybackQualityEvent_userId_createdAt_idx" ON "PlaybackQualityEvent"("userId", "createdAt");
CREATE INDEX "AdminUser_status_role_idx" ON "AdminUser"("status", "role");
CREATE UNIQUE INDEX "AppSession_userId_clientSessionId_key" ON "AppSession"("userId", "clientSessionId");
CREATE INDEX "AppSession_startedAt_userId_idx" ON "AppSession"("startedAt", "userId");
CREATE INDEX "AppSession_userId_lastSeenAt_idx" ON "AppSession"("userId", "lastSeenAt");
CREATE INDEX "PlaybackSession_startedAt_userId_idx" ON "PlaybackSession"("startedAt", "userId");
CREATE INDEX "PlaybackSession_episodeId_startedAt_idx" ON "PlaybackSession"("episodeId", "startedAt");
CREATE INDEX "PlaybackSession_userId_lastEventAt_idx" ON "PlaybackSession"("userId", "lastEventAt");
CREATE UNIQUE INDEX "EpisodeCompletionEvent_userId_episodeId_key" ON "EpisodeCompletionEvent"("userId", "episodeId");
CREATE INDEX "EpisodeCompletionEvent_completedAt_userId_idx" ON "EpisodeCompletionEvent"("completedAt", "userId");
CREATE INDEX "EpisodeCompletionEvent_episodeId_completedAt_idx" ON "EpisodeCompletionEvent"("episodeId", "completedAt");
CREATE INDEX "AudienceActivityEvent_createdAt_userId_idx" ON "AudienceActivityEvent"("createdAt", "userId");
CREATE INDEX "AudienceActivityEvent_eventType_createdAt_idx" ON "AudienceActivityEvent"("eventType", "createdAt");
CREATE INDEX "UiConfigVersion_status_version_idx" ON "UiConfigVersion"("status", "version");
CREATE INDEX "UiConfigVersion_createdAt_idx" ON "UiConfigVersion"("createdAt");

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaybackSession" ADD CONSTRAINT "PlaybackSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaybackSession" ADD CONSTRAINT "PlaybackSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeCompletionEvent" ADD CONSTRAINT "EpisodeCompletionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeCompletionEvent" ADD CONSTRAINT "EpisodeCompletionEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeCompletionEvent" ADD CONSTRAINT "EpisodeCompletionEvent_playbackSessionId_fkey" FOREIGN KEY ("playbackSessionId") REFERENCES "PlaybackSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudienceActivityEvent" ADD CONSTRAINT "AudienceActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceActivityEvent" ADD CONSTRAINT "AudienceActivityEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UiConfigVersion" ADD CONSTRAINT "UiConfigVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UiConfigVersion" ADD CONSTRAINT "UiConfigVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
