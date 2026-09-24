UPDATE "SharedMediaAsset"
SET "firstUploadedByApp" = 'taletv'
WHERE "firstUploadedByApp" = 'xu03';

UPDATE "SharedTikTokAlbum"
SET "ownerMiniAppKey" = 'taletv'
WHERE "ownerMiniAppKey" = 'xu03';

UPDATE "SharedTikTokAlbum"
SET "canonicalKey" = 'taletv:' || substring("canonicalKey" from 6)
WHERE "canonicalKey" LIKE 'xu03:%';

UPDATE "MiniAppAlbumAuthorization"
SET "miniAppKey" = 'taletv'
WHERE "miniAppKey" = 'xu03';

UPDATE "SharedPlatformOperation"
SET "targetMiniAppKey" = 'taletv'
WHERE "targetMiniAppKey" = 'xu03';

UPDATE "SharedPlatformOperation"
SET "dedupeKey" = replace("dedupeKey", ':xu03', ':taletv')
WHERE "dedupeKey" LIKE '%:xu03';

UPDATE "SharedPlatformOperation"
SET "snapshotJson" = jsonb_set("snapshotJson", '{targetMiniAppKey}', to_jsonb('taletv'::text), false)
WHERE "snapshotJson" ->> 'targetMiniAppKey' = 'xu03';

UPDATE "SharedPlatformOperation"
SET "snapshotJson" = jsonb_set("snapshotJson", '{ownerMiniAppKey}', to_jsonb('taletv'::text), false)
WHERE "snapshotJson" ->> 'ownerMiniAppKey' = 'xu03';
