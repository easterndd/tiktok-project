CREATE TYPE "AppEntryAdCountMode" AS ENUM ('COMPLETED', 'SHOWN');

ALTER TABLE "AppEntryAdPolicy"
  ADD COLUMN "countMode" "AppEntryAdCountMode" NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE "AppEntryAdSession"
  ADD COLUMN "countMode" "AppEntryAdCountMode" NOT NULL DEFAULT 'COMPLETED';
