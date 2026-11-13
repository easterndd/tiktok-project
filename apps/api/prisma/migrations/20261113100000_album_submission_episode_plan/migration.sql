ALTER TABLE "Album"
ADD COLUMN "platformEpisodePlan" JSONB;

ALTER TABLE "Episode"
ADD COLUMN "platformSeq" INTEGER;
