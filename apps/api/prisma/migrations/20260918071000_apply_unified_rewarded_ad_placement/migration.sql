INSERT INTO "AppEntryAdPolicy" (
  "id",
  "enabled",
  "mode",
  "placementId",
  "requiredCount",
  "onUnavailable",
  "version",
  "createdAt",
  "updatedAt"
)
VALUES (
  'default',
  TRUE,
  'REWARDED_GATED',
  'ad7686459458972829697',
  1,
  'ALLOW',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE
SET
  "enabled" = EXCLUDED."enabled",
  "mode" = EXCLUDED."mode",
  "placementId" = EXCLUDED."placementId",
  "requiredCount" = EXCLUDED."requiredCount",
  "onUnavailable" = EXCLUDED."onUnavailable",
  "version" = "AppEntryAdPolicy"."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Album"
SET "accessConfig" = jsonb_set(
  COALESCE("accessConfig", '{}'::jsonb),
  '{rewardedPlacementId}',
  to_jsonb('ad7686459458972829697'::text),
  TRUE
);
