ALTER TYPE "SharedPlatformOperationKind" ADD VALUE 'SYNC_DISPLAY_METADATA';
ALTER TABLE "SharedTikTokAlbum"
  ADD COLUMN "displayMetadata" JSONB,
  ADD COLUMN "displayMetadataVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "displayMetadataUpdatedBy" TEXT,
  ADD COLUMN "displayMetadataUpdatedAt" TIMESTAMP(3);
ALTER TABLE "MiniAppAlbumAuthorization" ADD COLUMN "metadataSyncedVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Album"
  ADD COLUMN "displayMetadataVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "displayMetadataSharedId" TEXT;
