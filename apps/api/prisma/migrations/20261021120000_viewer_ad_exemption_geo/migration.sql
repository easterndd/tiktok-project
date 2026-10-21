ALTER TABLE "User" ADD COLUMN "appEntryAdExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mergedIntoUserId" TEXT;
CREATE INDEX "User_mergedIntoUserId_idx" ON "User"("mergedIntoUserId");
ALTER TABLE "User" ADD CONSTRAINT "User_mergedIntoUserId_fkey" FOREIGN KEY ("mergedIntoUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AppSession" ADD COLUMN "countryCode" VARCHAR(2);
CREATE INDEX "AppSession_countryCode_startedAt_idx" ON "AppSession"("countryCode", "startedAt");
