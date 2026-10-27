ALTER TABLE "AppEntryAdPolicy"
ADD COLUMN "episodeInterstitialEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "episodeInterstitialInitialDelaySeconds" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "episodeInterstitialIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "episodeInterstitialMinIntervalSeconds" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN "episodeInterstitialMaxPerSession" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "episodeInterstitialInitialSkipTransitions" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "episodeInterstitialEveryTransitions" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "episodeInterstitialRewardedCooldownSeconds" INTEGER NOT NULL DEFAULT 60;
