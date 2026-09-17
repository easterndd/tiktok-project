-- A user can resume one active reward session per episode. Expired sessions are
-- transitioned before a new one is created, so this partial unique index also
-- protects concurrent start requests from creating two active sessions.
CREATE UNIQUE INDEX "RewardedUnlockSession_one_active_per_user_episode"
ON "RewardedUnlockSession" ("userId", "episodeId")
WHERE "status" = 'ACTIVE';
