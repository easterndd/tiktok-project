ALTER TABLE "AppEntryAdPolicy"
ADD COLUMN "releaseId" TEXT NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "AppEntryAdPolicy_releaseId_key"
ON "AppEntryAdPolicy"("releaseId");

ALTER TABLE "AppEntryAdSession"
ADD COLUMN "releaseId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "AppEntryAdSession_userId_launchId_key";

CREATE UNIQUE INDEX "AppEntryAdSession_userId_releaseId_launchId_key"
ON "AppEntryAdSession"("userId", "releaseId", "launchId");
