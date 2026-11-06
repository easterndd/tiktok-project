CREATE TABLE "CampaignEntryBase" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "url" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignEntryBase_pkey" PRIMARY KEY ("id")
);
