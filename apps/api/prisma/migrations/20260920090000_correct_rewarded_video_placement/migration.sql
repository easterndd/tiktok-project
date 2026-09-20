-- The previous unified placement was an interstitial placement.  Keep it for
-- INTERSTITIAL sessions, but use the approved Rewarded Video placement for
-- rewarded entry gates and episode-unlock policies.
UPDATE "AppEntryAdPolicy"
SET
  "placementId" = 'ad7686459794040702993',
  "version" = "version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "mode" = 'REWARDED_GATED'
  AND "placementId" = 'ad7686459458972829697';

UPDATE "Album"
SET "accessConfig" = jsonb_set(
  COALESCE("accessConfig", '{}'::jsonb),
  '{rewardedPlacementId}',
  to_jsonb('ad7686459794040702993'::text),
  TRUE
)
WHERE "accessConfig" ->> 'rewardedPlacementId' = 'ad7686459458972829697';
