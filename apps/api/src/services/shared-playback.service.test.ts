import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '../config/env';
import { authorizeSharedPlayback, preparePlaybackTarget, verifyPlaybackSource } from './shared-playback.service';
import { processSharedPlatformOperations, projectSharedAlbumToLocal, retryUnknownAuthorizationOnce } from './shared-platform.service';
import { TikTokShortDramaApiError } from './tiktok-short-drama-api.service';

const env = { MINI_APP_KEY: 'main', TIKTOK_CLIENT_KEY: 'main-key', TIKTOK_CLIENT_SECRET: 'main-secret', TALETV_TIKTOK_CLIENT_KEY: 'target-key', TALETV_TIKTOK_CLIENT_SECRET: 'target-secret', BYTEPLUS_ACCOUNT_ID: 'account', BYTEPLUS_SPACE_NAME: 'space', BYTEPLUS_REGION: 'region', REWARDED_PLACEMENT_ID: 'main-ad', TALETV_REWARDED_PLACEMENT_ID: 'target-ad' } as Env;

function fixture() {
  const localSource: any = { id: 'source-1', tiktokAlbumId: 'platform-1', title: 'Draft title', coverUrl: 'https://example.com/draft.jpg', description: 'Draft', language: 'en', status: 'ONLINE', accessConfig: { rewardedAdEnabled: true, freeEpisodeCount: 1, rewardedPlacementId: 'main-ad', rewardedAdCount: 1 }, episodes: [{ id: 'source-episode', episodeNo: 1, byteplusVid: 'new-draft-vid', tiktokEpisodeId: 'new-draft-id', isFree: true, durationMs: 1000 }] };
  const online: any = { version: 1, review_status: 2, episode_info_list: [{ seq: 1, episode_id: 'online-episode', byteplus_vid: 'online-vid' }] };
  const sourceDb: any = {
    album: { findUnique: async () => localSource },
    coverAsset: { findMany: async () => [{ providerImageId: 'cover-id', publicUrl: 'https://example.com/online.jpg' }] },
    platformSyncJob: { findFirst: async () => ({ snapshotJson: { albumInfo: { title: 'Online title', desp: 'Online description', language: 'en', year: 2026, drama_type: 2, tag_list: [1], cover_list: ['cover-id'] }, episodes: [{ localEpisodeId: 'source-episode', seq: 1, title: 'Episode 1', byteplus_vid: 'online-vid', cover_list: ['cover-id'] }] }, providerResponse: { episode_id_map: { 'seq:1': 'online-episode' } } }) }
  };
  const state: any = { album: null, sharedEpisodes: [], auths: new Map(), ops: [], media: new Map(), grantCalls: 0, targetAlbum: null, targetEpisodes: [] };
  const fullAlbum = () => ({ ...state.album, authorizations: [...state.auths.values()], episodes: state.sharedEpisodes.map((entry: any) => ({ ...entry, media: [...state.media.values()].find((media: any) => media.id === entry.sharedMediaId) })) });
  const sharedDb: any = {
    sharedMediaAsset: {
      findUnique: async ({ where }: any) => state.media.get(where.byteplusVid) ?? null,
      create: async ({ data }: any) => { const media = { id: `media-${data.byteplusVid}`, ...data }; state.media.set(data.byteplusVid, media); return media; }
    },
    sharedTikTokAlbum: {
      findUnique: async () => state.album ? fullAlbum() : null,
      findUniqueOrThrow: async () => fullAlbum(),
      upsert: async ({ create, update }: any) => { state.album = state.album ? { ...state.album, ...update } : { id: 'shared-album', ...create }; return state.album; },
      update: async ({ data }: any) => { Object.assign(state.album, data); return fullAlbum(); }
    },
    sharedTikTokEpisode: {
      deleteMany: async () => { state.sharedEpisodes = []; },
      upsert: async ({ create }: any) => { state.sharedEpisodes.push(create); return create; }
    },
    miniAppAlbumAuthorization: {
      findUnique: async ({ where }: any) => state.auths.get(where.sharedAlbumId_miniAppKey.miniAppKey) ?? null,
      upsert: async ({ where, create, update }: any) => { const key = where.sharedAlbumId_miniAppKey.miniAppKey; const old = state.auths.get(key); const item = old ? { ...old, ...update } : { id: `auth-${key}`, ...create }; state.auths.set(key, item); return item; },
      update: async ({ where, data }: any) => { const item = [...state.auths.values()].find((entry: any) => entry.id === where.id); Object.assign(item, data); return item; },
      updateMany: async ({ where, data }: any) => { const item = where.id ? [...state.auths.values()].find((entry: any) => entry.id === where.id && (!where.targetClientKey || entry.targetClientKey === where.targetClientKey)) : state.auths.get(where.miniAppKey); if (item) Object.assign(item, data); return { count: item ? 1 : 0 }; }
    },
    sharedPlatformOperation: {
      findUnique: async ({ where }: any) => state.ops.find((entry: any) => where.id ? entry.id === where.id : entry.dedupeKey === where.dedupeKey) ?? null,
      findUniqueOrThrow: async ({ where }: any) => state.ops.find((entry: any) => entry.id === where.id),
      create: async ({ data }: any) => {
        if (state.ops.some((entry: any) => entry.dedupeKey === data.dedupeKey)) throw new Error('Duplicate maintenance request');
        const op = { id: `manual-op-${state.ops.length}`, attemptCount: 0, ...data }; state.ops.push(op); return op;
      },
      findFirst: async ({ where }: any) => state.ops.find((entry: any) => entry.kind === where.kind && ['PENDING', 'PROCESSING'].includes(entry.status)) ?? null,
      upsert: async ({ create, update, where }: any) => { let op = state.ops.find((entry: any) => entry.dedupeKey === where.dedupeKey); if (op) Object.assign(op, update); else { op = { id: 'grant-op', attemptCount: 0, ...create }; state.ops.push(op); } return op; },
      findMany: async () => state.ops.filter((entry: any) => ['PENDING', 'PROCESSING'].includes(entry.status)),
      updateMany: async () => ({ count: 1 }),
      update: async ({ where, data }: any) => { const op = state.ops.find((entry: any) => entry.id === where.id); Object.assign(op, data); return op; }
    }
  };
  sharedDb.$transaction = async (callback: any) => callback(sharedDb);
  const targetDb: any = {
    adminUser: { findUnique: async () => ({ id: 'target-owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: {
      findUnique: async ({ where }: any) => !state.targetAlbum ? null : ((where.id === state.targetAlbum.id || where.tiktokAlbumId === state.targetAlbum.tiktokAlbumId) ? { ...state.targetAlbum, episodes: state.targetEpisodes.map((entry: any) => ({ ...entry })) } : null),
      create: async ({ data }: any) => { state.targetAlbum = { ...data }; return data; },
      update: async ({ data }: any) => { Object.assign(state.targetAlbum, data); return state.targetAlbum; },
      updateMany: async ({ data }: any) => { Object.assign(state.targetAlbum, data); return { count: 1 }; }
    },
    episode: {
      findFirst: async () => null,
      findMany: async () => state.targetEpisodes.map((entry: any) => ({ ...entry })),
      create: async ({ data }: any) => { const item = { id: `target-episode-${data.episodeNo}`, ...data }; state.targetEpisodes.push(item); return item; },
      update: async ({ where, data }: any) => { const item = state.targetEpisodes.find((entry: any) => entry.id === where.id); Object.assign(item, data); return item; },
      updateMany: async ({ data }: any) => { state.targetEpisodes.forEach((entry: any) => Object.assign(entry, data)); return { count: state.targetEpisodes.length }; }
    }
  };
  targetDb.$transaction = async (callback: any) => callback(targetDb);
  const api: any = {
    queryAlbum: async ({ version }: any) => ({ requestId: 'query-log', data: version === 1 ? online : { version: 2, current_version: 2, online_version: 1, review_status: 1, publish_status: 1, episode_info_list: [] } }),
    authorizeAlbum: async () => { state.grantCalls += 1; return { requestId: 'grant-log', results: [{ clientKey: 'target-key', authStatus: 1 }], raw: { client_key_result_list: [{ client_key: 'target-key', auth_status: 1 }] } }; },
    createVideo: async () => assert.fail('must not upload or register videos'),
    submitReview: async () => assert.fail('must not submit a new review')
  };
  const prepare = () => authorizeSharedPlayback({ sharedDb, sourceDb, dbByApp: { main: sourceDb, taletv: targetDb }, env, sourceApp: 'main', sourceAlbumId: 'source-1', targetApps: ['taletv'], operatorEmail: 'source@example.com', authorizedAdminIds: { taletv: 'target-owner' }, sourceApi: api });
  const run = () => processSharedPlatformOperations(sharedDb, { env, localPrismaByApp: { main: sourceDb, taletv: targetDb }, apiByApp: { main: api, taletv: api } });
  return { sourceDb, sharedDb, targetDb, api, state, online, localSource, prepare, run };
}

test('uses approved online snapshot while a newer draft is reviewing', async () => {
  const f = fixture();
  const source = await verifyPlaybackSource(f.sourceDb, f.api, 'source-1');
  assert.equal(source.title, 'Online title');
  assert.equal(source.onlineVersion, 1);
  assert.equal(source.episodes[0].byteplusVid, 'online-vid');
  assert.equal(source.episodes[0].tiktokEpisodeId, 'online-episode');
  assert.equal(f.localSource.episodes[0].byteplusVid, 'new-draft-vid');
});

test('automatically prepares and authorizes a full target mapping without uploads or reviews', async () => {
  const f = fixture();
  const queued = await f.prepare();
  assert.equal(queued.items[0].accepted, true);
  assert.equal(f.state.targetAlbum.status, 'OFFLINE');
  assert.equal(f.state.targetAlbum.accessConfig.rewardedPlacementId, 'target-ad');
  await f.run();
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.targetAlbum.tiktokAlbumId, 'platform-1');
  assert.equal(f.state.targetAlbum.tiktokVersion, 1);
  assert.equal(f.state.targetEpisodes[0].tiktokEpisodeId, 'online-episode');
  assert.equal(f.state.targetEpisodes[0].byteplusVid, 'online-vid');
  assert.equal(f.state.targetAlbum.status, 'ONLINE');
  assert.equal(f.state.ops[0].status, 'SUCCEEDED');
  assert.equal(f.state.ops[0].providerRequestId, 'grant-log');
  assert.equal(f.state.ops[0].providerResponse.mappedEpisodeCount, 1);
});

test('records a per-target authorization rejection as FAILED instead of completed', async () => {
  const f = fixture(); await f.prepare();
  f.api.authorizeAlbum = async () => ({ requestId: 'rejected-log', results: [{ clientKey: 'target-key', authStatus: 2, errorCode: '22010', errorMessage: 'not permitted' }], raw: {} });
  await f.run();
  assert.equal(f.state.ops[0].status, 'FAILED');
  assert.equal(f.state.auths.get('taletv').status, 'FAILED');
  assert.equal(f.state.targetAlbum.status, 'OFFLINE');
});

test('never accepts the result for a different target client key', async () => {
  const f = fixture(); await f.prepare();
  f.api.authorizeAlbum = async () => ({ requestId: 'wrong-key-log', results: [{ clientKey: 'different-key', authStatus: 1 }], raw: {} });
  await f.run();
  assert.equal(f.state.ops[0].status, 'FAILED');
});

test('retains platform acceptance when local mapping fails and retries mapping without another grant', async () => {
  const f = fixture(); await f.prepare();
  const create = f.targetDb.episode.create;
  f.state.targetEpisodes = [];
  f.targetDb.episode.create = async () => { throw new Error('local write unavailable'); };
  await f.run();
  assert.equal(f.state.ops[0].status, 'FAILED');
  assert.equal(f.state.ops[0].providerResponse.platformAuthorized, true);
  f.targetDb.episode.create = create;
  f.state.ops[0].status = 'PENDING';
  await f.run();
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.ops[0].status, 'SUCCEEDED');
});

test('stops automatic replay after an ambiguous platform grant timeout', async () => {
  const f = fixture(); await f.prepare();
  f.api.authorizeAlbum = async () => { throw new TikTokShortDramaApiError('timeout', undefined, 'timeout-log', true); };
  await f.run();
  assert.equal(f.state.ops[0].status, 'CONFLICT');
  assert.equal(f.state.auths.get('taletv').status, 'CONFLICT');
  assert.equal(f.state.ops[0].providerRequestId, 'timeout-log');
});

test('saves missing-result evidence without opening target playback or retrying automatically', async () => {
  const f = fixture(); await f.prepare();
  const evidence = { httpStatus: 200, providerEnvelope: { data: {}, error: { code: 'ok', log_id: 'empty-log' } } };
  f.api.authorizeAlbum = async () => { f.state.grantCalls += 1; throw new TikTokShortDramaApiError('missing results', 'AUTHORIZATION_RESULT_UNCONFIRMED', 'empty-log', true, evidence); };
  await f.run(); await f.run();
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.ops[0].status, 'CONFLICT');
  assert.deepEqual(f.state.ops[0].providerResponse, evidence);
  assert.equal(f.state.targetAlbum.status, 'OFFLINE');
});

function maintenanceOptions(f: ReturnType<typeof fixture>) {
  return { env, localPrismaByApp: { main: f.sourceDb, taletv: f.targetDb }, apiByApp: { main: f.api, taletv: f.api } };
}

async function uncertainFixture() {
  const f = fixture(); await f.prepare();
  const authorize = f.api.authorizeAlbum;
  f.api.authorizeAlbum = async () => { throw new TikTokShortDramaApiError('missing results', undefined, 'original-log', true); };
  await f.run();
  f.api.authorizeAlbum = authorize;
  return f;
}

test('manual recovery requires exact target and confirmation and a still active target OWNER', async () => {
  const f = await uncertainFixture(); const options = maintenanceOptions(f);
  await assert.rejects(() => retryUnknownAuthorizationOnce(f.sharedDb, options, 'grant-op', 'taletv', ''), /明确确认/);
  await assert.rejects(() => retryUnknownAuthorizationOnce(f.sharedDb, options, 'grant-op', 'main', 'REAUTHORIZE_ONE_TARGET'), /不是该目标/);
  f.targetDb.adminUser.findUnique = async () => ({ role: 'OWNER', status: 'DISABLED' });
  await assert.rejects(() => retryUnknownAuthorizationOnce(f.sharedDb, options, 'grant-op', 'taletv', 'REAUTHORIZE_ONE_TARGET'), /批准已失效/);
  assert.equal(f.state.ops.length, 1);
  assert.equal(f.state.grantCalls, 0);
});

test('manual recovery refuses an already pending target authorization', async () => {
  const f = await uncertainFixture();
  f.state.ops.push({ id: 'active-op', kind: 'AUTHORIZE_ALBUM', status: 'PENDING' });
  await assert.rejects(() => retryUnknownAuthorizationOnce(f.sharedDb, maintenanceOptions(f), 'grant-op', 'taletv', 'REAUTHORIZE_ONE_TARGET'), /处理中/);
  assert.equal(f.state.grantCalls, 0);
});

test('manual recovery preserves the original conflict and only calls the platform once per original job', async () => {
  const f = await uncertainFixture(); const original = { ...f.state.ops[0] };
  const result = await retryUnknownAuthorizationOnce(f.sharedDb, maintenanceOptions(f), original.id, 'taletv', 'REAUTHORIZE_ONE_TARGET');
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal((result.snapshotJson as any).manualRetryOfOperationId, original.id);
  assert.equal((result.snapshotJson as any).originalProviderRequestId, 'original-log');
  assert.deepEqual(f.state.ops[0], original);
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.targetAlbum.status, 'ONLINE');
  await assert.rejects(() => retryUnknownAuthorizationOnce(f.sharedDb, maintenanceOptions(f), original.id, 'taletv', 'REAUTHORIZE_ONE_TARGET'));
  assert.equal(f.state.grantCalls, 1);
});

test('an unconfirmed manual response keeps new evidence and does not automatically repeat the call', async () => {
  const f = await uncertainFixture();
  const evidence = { providerEnvelope: { data: { client_key_result_list: [] } } };
  f.api.authorizeAlbum = async () => { f.state.grantCalls += 1; throw new TikTokShortDramaApiError('empty results', 'AUTHORIZATION_RESULT_UNCONFIRMED', 'new-log', true, evidence); };
  const result = await retryUnknownAuthorizationOnce(f.sharedDb, maintenanceOptions(f), 'grant-op', 'taletv', 'REAUTHORIZE_ONE_TARGET');
  await f.run();
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.providerRequestId, 'new-log');
  assert.deepEqual(result.providerResponse, evidence);
  assert.equal(result.nextAttemptAt, null);
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.targetAlbum.status, 'OFFLINE');
});

test('concurrent maintenance calls for the same original task cannot both submit authorization', async () => {
  const f = await uncertainFixture();
  const results = await Promise.allSettled([0, 1].map(() => retryUnknownAuthorizationOnce(f.sharedDb, maintenanceOptions(f), 'grant-op', 'taletv', 'REAUTHORIZE_ONE_TARGET')));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.ops.length, 2);
});

test('refuses to overwrite a separately published target drama', async () => {
  const f = fixture();
  const source = await verifyPlaybackSource(f.sourceDb, f.api, 'source-1');
  f.targetDb.album.findUnique = async () => ({ id: 'existing', title: source.title, tiktokAlbumId: 'different-platform-album', episodes: [] });
  await assert.rejects(() => preparePlaybackTarget(f.targetDb, env, 'main', 'taletv', source), /不会覆盖/);
});

test('fails verification if a video was deleted from the platform', async () => {
  const f = fixture(); f.online.episode_info_list[0].exception_reason = 'video removed';
  await assert.rejects(() => verifyPlaybackSource(f.sourceDb, f.api, 'source-1'), /不能授权/);
});

test('takes targets offline when the main drama is unlisted', async () => {
  const f = fixture(); await f.prepare(); await f.run();
  f.api.queryAlbum = async () => ({ requestId: 'unlisted-log', data: { version: 1, current_version: 2, online_version: 1, review_status: 2, publish_status: 2 } });
  f.state.ops.push({ id: 'reconcile-op', kind: 'RECONCILE_ALBUM', sharedAlbumId: 'shared-album', status: 'PENDING', attemptCount: 0 });
  await f.run();
  assert.equal(f.state.targetAlbum.status, 'OFFLINE');
  assert.equal(f.state.targetEpisodes[0].status, 'OFFLINE');
});

test('projection requires a real target mapping instead of silently skipping it', async () => {
  const f = fixture();
  await assert.rejects(() => projectSharedAlbumToLocal({}, {}, f.targetDb), /映射缺失/);
});

test('does not replay a queued grant when the approving OWNER is disabled', async () => {
  const f = fixture(); await f.prepare();
  f.targetDb.adminUser.findUnique = async () => ({ id: 'target-owner', role: 'OWNER', status: 'DISABLED' });
  await f.run();
  assert.equal(f.state.grantCalls, 0);
  assert.equal(f.state.ops[0].status, 'FAILED');
});

test('treats an explicit already-authorized target as idempotent success', async () => {
  const f = fixture(); await f.prepare();
  f.api.authorizeAlbum = async () => ({ requestId: 'already-log', results: [{ clientKey: 'target-key', authStatus: 1, errorCode: '22010', errorMessage: 'authorization already exists' }], raw: {} });
  await f.run();
  assert.equal(f.state.ops[0].status, 'SUCCEEDED');
  assert.equal(f.state.targetAlbum.status, 'ONLINE');
});

test('does not grant with a main client key different from the registered owner', async () => {
  const f = fixture(); await f.prepare();
  f.state.album.ownerClientKey = 'old-main-key';
  await f.run();
  assert.equal(f.state.grantCalls, 0);
  assert.equal(f.state.ops[0].status, 'FAILED');
});

test('clears old target proof before authorizing a changed client key', async () => {
  const f = fixture(); await f.prepare();
  Object.assign(f.state.auths.get('taletv'), { status: 'AUTHORIZED', targetClientKey: 'old-target-key', providerResponse: { platformAuthorized: true, targetClientKey: 'old-target-key' } });
  Object.assign(f.state.ops[0], { status: 'SUCCEEDED', providerResponse: { platformAuthorized: true, targetClientKey: 'old-target-key' } });
  await f.prepare();
  assert.equal(f.state.auths.get('taletv').status, 'PENDING');
  assert.equal(f.state.ops[0].providerResponse.platformAuthorized, undefined);
  await f.run();
  assert.equal(f.state.grantCalls, 1);
  assert.equal(f.state.ops[0].status, 'SUCCEEDED');
});
