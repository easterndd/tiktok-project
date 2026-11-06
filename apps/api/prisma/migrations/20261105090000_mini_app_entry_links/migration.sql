CREATE TABLE "MiniAppEntryLink" (
  "miniAppKey" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL_LINK',
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniAppEntryLink_pkey" PRIMARY KEY ("miniAppKey", "environment")
);

CREATE INDEX "MiniAppEntryLink_miniAppKey_registeredAt_idx" ON "MiniAppEntryLink"("miniAppKey", "registeredAt");
