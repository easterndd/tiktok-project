CREATE TABLE "EntryAdTestAccount" (
  "miniAppKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntryAdTestAccount_pkey" PRIMARY KEY ("miniAppKey", "userId")
);

CREATE INDEX "EntryAdTestAccount_enabled_expiresAt_idx" ON "EntryAdTestAccount"("enabled", "expiresAt");
