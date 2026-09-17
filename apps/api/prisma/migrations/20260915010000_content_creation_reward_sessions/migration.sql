-- CreateEnum
CREATE TYPE "CoverAssetStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "RewardedUnlockSessionStatus" AS ENUM ('ACTIVE', 'UNLOCKED', 'ABANDONED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Album" ADD COLUMN "coverAssetId" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN "coverAssetId" TEXT;

-- AlterTable
ALTER TABLE "AdEvent" ADD COLUMN "rewardSessionId" TEXT,
ADD COLUMN "adIndex" INTEGER;

-- CreateTable
CREATE TABLE "CoverAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "providerImageId" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "status" "CoverAssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardedUnlockSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RewardedUnlockSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardedUnlockSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardedUnlockReward" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "adIndex" INTEGER NOT NULL,
    "adEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardedUnlockReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverAsset_storageKey_key" ON "CoverAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CoverAsset_providerImageId_key" ON "CoverAsset"("providerImageId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverAsset_sha256_key" ON "CoverAsset"("sha256");

-- CreateIndex
CREATE INDEX "RewardedUnlockSession_userId_episodeId_status_expiresAt_idx" ON "RewardedUnlockSession"("userId", "episodeId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardedUnlockReward_sessionId_clientEventId_key" ON "RewardedUnlockReward"("sessionId", "clientEventId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardedUnlockReward_sessionId_adIndex_key" ON "RewardedUnlockReward"("sessionId", "adIndex");

-- CreateIndex
CREATE INDEX "AdEvent_rewardSessionId_adIndex_idx" ON "AdEvent"("rewardSessionId", "adIndex");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "CoverAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "CoverAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardedUnlockSession" ADD CONSTRAINT "RewardedUnlockSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardedUnlockSession" ADD CONSTRAINT "RewardedUnlockSession_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardedUnlockReward" ADD CONSTRAINT "RewardedUnlockReward_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RewardedUnlockSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_rewardSessionId_fkey" FOREIGN KEY ("rewardSessionId") REFERENCES "RewardedUnlockSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
