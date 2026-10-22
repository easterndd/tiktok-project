CREATE TABLE "AnalyticsDailySummary" (
  "id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "newUsers" INTEGER NOT NULL DEFAULT 0,
  "activeUsers" INTEGER NOT NULL DEFAULT 0,
  "watchSessions" INTEGER NOT NULL DEFAULT 0,
  "completedEpisodes" INTEGER NOT NULL DEFAULT 0,
  "favorites" INTEGER NOT NULL DEFAULT 0,
  "shares" INTEGER NOT NULL DEFAULT 0,
  "searches" INTEGER NOT NULL DEFAULT 0,
  "playbackEvents" INTEGER NOT NULL DEFAULT 0,
  "playbackErrors" INTEGER NOT NULL DEFAULT 0,
  "adRequested" INTEGER NOT NULL DEFAULT 0,
  "adShown" INTEGER NOT NULL DEFAULT 0,
  "adFailed" INTEGER NOT NULL DEFAULT 0,
  "sourceWindowStart" TIMESTAMP(3) NOT NULL,
  "sourceWindowEnd" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsDailySummary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsDailySummary_day_timezone_key" ON "AnalyticsDailySummary"("day", "timezone");
CREATE INDEX "AnalyticsDailySummary_timezone_day_idx" ON "AnalyticsDailySummary"("timezone", "day");
