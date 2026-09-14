CREATE TYPE "UploadSourceType" AS ENUM ('URL', 'FILE');

ALTER TABLE "UploadJob"
ADD COLUMN "sourceType" "UploadSourceType" NOT NULL DEFAULT 'URL',
ADD COLUMN "sourceName" TEXT;
