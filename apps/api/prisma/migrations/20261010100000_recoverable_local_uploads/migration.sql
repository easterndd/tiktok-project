ALTER TABLE "UploadJob"
  ADD COLUMN "localFilePath" TEXT,
  ADD COLUMN "uploadScope" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "remoteStartedAt" TIMESTAMP(3);
