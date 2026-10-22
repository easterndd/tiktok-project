CREATE TABLE "MiniAppCodeRelease" (
  "miniAppKey" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "portalVersion" TEXT,
  "portalStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniAppCodeRelease_pkey" PRIMARY KEY ("miniAppKey","releaseId")
);

CREATE INDEX "MiniAppCodeRelease_miniAppKey_portalStatus_idx" ON "MiniAppCodeRelease"("miniAppKey","portalStatus");
