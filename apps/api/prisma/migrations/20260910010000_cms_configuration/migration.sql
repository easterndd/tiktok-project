-- CMS-owned rollout configuration. It is data, not frontend code, so operators can tune it weekly.
ALTER TABLE "Album" ADD COLUMN "accessConfig" JSONB;

CREATE TABLE "UiComponent" (
    "key" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiComponent_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "UiComponent_page_enabled_idx" ON "UiComponent"("page", "enabled");
