import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '../config/env';
import { multiAppReleaseStatus, runMultiAppRelease, targetReleaseAlbumId } from './multi-app-release.service';

const env = {
  TIKTOK_CLIENT_KEY: 'main-key', TIKTOK_CLIENT_SECRET: 'main-secret',
  TALETV_TIKTOK_CLIENT_KEY: 'tale-key', TALETV_TIKTOK_CLIENT_SECRET: 'tale-secret',
  REWARDED_PLACEMENT_ID: 'main-ad', TALETV_REWARDED_PLACEMENT_ID: 'tale-ad'
} as Env;

const source = {
  id: 'source-1', title: 'Drama', description: 'Description', language: 'en', releaseYear: 2026,
  dramaType: 2, tagList: [1], regions: ['US'], accessConfig: { freeEpisodeCount: 1, rewardedAdEnabled: true, rewardedPlacementId: 'main-ad', rewardedAdCount: 1 },
  coverAsset: { id: 'source-cover', storageKey: 'covers/one.jpg', publicUrl: 'https://example.com/one.jpg', mimeType: 'image/jpeg', fileSize: 10, sha256: 'hash-1', status: 'READY' },
  episodes: [{ id: 'source-episode', episodeNo: 1, title: 'Episode 1', description: '', sortOrder: 1, isFree: true, byteplusVid: 'vid-1', durationMs: 1000, coverAsset: null, coverAssetId: null }]
};

test('prepares an independent target draft without copying the source VID or its ad placement', async () => {
  const created: Record<string, any> = {};
  const jobs: string[] = [];
  const target: any = {
    adminUser: { findUnique: async () => ({ id: 'target-owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: {
      findUnique: async () => created.album ?? null,
      create: async ({ data }: any) => { created.album = { ...data, episodes: [] }; return created.album; }
    },
    episode: {
      findFirst: async () => null,
      findUnique: async () => created.episode,
      create: async ({ data }: any) => { created.episode = { id: 'target-episode', ...data }; created.album.episodes.push(created.episode); return created.episode; }
    },
    coverAsset: {
      upsert: async () => ({ ...source.coverAsset, id: 'target-cover', providerImageId: null }),
      findUnique: async () => ({ id: 'target-cover', sha256: 'hash-1', publicUrl: source.coverAsset.publicUrl, providerImageId: null })
    },
    platformSyncJob: {
      findUnique: async () => null,
      upsert: async ({ create }: any) => { jobs.push(create.kind); return { id: `${create.kind}-job` }; }
    }
  };
  target.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(target);
  const sourceDb: any = { album: { findUnique: async () => source } };

  const result = await runMultiAppRelease({ sourceDb, dbByApp: { taletv: target }, env, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'PREPARE' });

  assert.equal(result.items[0].accepted, true);
  assert.equal(created.album.id, targetReleaseAlbumId('main', source.id));
  assert.equal(created.album.tiktokAlbumId, undefined);
  assert.equal(created.album.accessConfig.rewardedPlacementId, 'tale-ad');
  assert.equal(created.episode.byteplusVid, null);
  assert.equal(created.episode.byteplusUploadStatus, 'PENDING');
  assert.deepEqual(jobs, ['COVER']);
});

test('submits separate review jobs for selected mini apps', async () => {
  const jobs: Array<{ app: string; albumId: string }> = [];
  const makeDb = (app: string, albumId: string): any => ({
    adminUser: { findUnique: async () => ({ id: `${app}-owner`, role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => app === 'main' ? { ...source, tiktokAlbumId: 'main-platform-album', tiktokVersion: 1, reviewStatus: null } : { id: albumId, episodes: [], tiktokAlbumId: 'tale-platform-album', tiktokVersion: 1, reviewStatus: null } },
    platformSyncJob: {
      findFirst: async () => null,
      findUnique: async () => null,
      upsert: async ({ create }: any) => { jobs.push({ app, albumId: create.albumId }); return { id: `${app}-review-job` }; }
    }
  });
  const main = makeDb('main', source.id);
  const tale = makeDb('taletv', targetReleaseAlbumId('main', source.id));

  const result = await runMultiAppRelease({ sourceDb: main, dbByApp: { main, taletv: tale }, env, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['main', 'taletv'], operatorEmail: 'owner@example.com', action: 'SUBMIT_REVIEW' });

  assert.deepEqual(result.items.map((item) => item.accepted), [true, true]);
  assert.deepEqual(jobs, [{ app: 'main', albumId: source.id }, { app: 'taletv', albumId: targetReleaseAlbumId('main', source.id) }]);
});

test('rejects cross-app operations without an active owner in the target app', async () => {
  const result = await runMultiAppRelease({
    sourceDb: { album: { findUnique: async () => source } } as any,
    dbByApp: { taletv: { adminUser: { findUnique: async () => ({ role: 'EDITOR', status: 'ACTIVE' }) } } as any },
    env, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'PREPARE'
  });
  assert.equal(result.items[0].accepted, false);
  assert.match(result.items[0].error ?? '', /ACTIVE OWNER/);
});

test('does not use the source app client key for a different target app', async () => {
  const result = await runMultiAppRelease({
    sourceDb: { album: { findUnique: async () => ({ id: 'source-1' }) } } as any,
    dbByApp: { main: { adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) } } as any },
    env: { ...env, TIKTOK_CLIENT_KEY: undefined, TIKTOK_CLIENT_SECRET: undefined } as Env,
    sourceApp: 'taletv', sourceAlbumId: 'source-1', targetApps: ['main'], operatorEmail: 'owner@example.com', action: 'RECONCILE'
  });
  assert.equal(result.items[0].accepted, false);
  assert.match(result.items[0].error ?? '', /Client Key\/Secret/);
});

test('does not overwrite a prepared target whose media differs from the source', async () => {
  let wrote = false;
  const target: any = {
    adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => ({
      id: targetReleaseAlbumId('main', source.id), title: source.title, description: source.description,
      coverAsset: source.coverAsset, releaseYear: source.releaseYear, dramaType: source.dramaType,
      tagList: source.tagList, episodes: [{ episodeNo: 1, title: 'Episode 1', byteplusVid: 'different-vid' }]
    }) },
    $transaction: async () => { wrote = true; },
    platformSyncJob: { findMany: async () => [] }
  };
  const result = await runMultiAppRelease({ sourceDb: { album: { findUnique: async () => source } } as any, dbByApp: { taletv: target }, env, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'PREPARE' });
  assert.equal(result.items[0].accepted, false);
  assert.match(result.items[0].error ?? '', /不会覆盖/);
  assert.equal(wrote, false);
});

test('queues both album and episode covers for an independent target', async () => {
  const queued: string[] = [];
  const albumId = targetReleaseAlbumId('main', source.id);
  const target: any = {
    adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => ({ id: albumId, coverAssetId: 'album-cover', episodes: [{ id: 'episode-1', coverAssetId: 'episode-cover', byteplusVid: 'vid-1' }] }) },
    coverAsset: { findUnique: async ({ where }: any) => ({ id: where.id, sha256: where.id, publicUrl: 'https://example.com/cover.jpg', providerImageId: null }) },
    episode: { findUnique: async () => ({ id: 'episode-1', byteplusVid: 'vid-1', tiktokVideoStatus: 'NOT_STARTED' }) },
    platformSyncJob: {
      findUnique: async () => null,
      upsert: async ({ create }: any) => { queued.push(`${create.kind}:${create.targetId}`); return { id: create.dedupeKey }; }
    }
  };
  const result = await runMultiAppRelease({ sourceDb: { album: { findUnique: async () => ({ id: source.id }) } } as any, dbByApp: { taletv: target }, env, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'SYNC_MEDIA' });
  assert.equal(result.items[0].accepted, true);
  assert.deepEqual(queued, ['COVER:album-cover', 'COVER:episode-cover']);
});

test('returns target-app jobs for the cross-app log after a different-email owner authorizes', async () => {
  const target: any = {
    adminUser: { findUnique: async ({ where }: any) => where.id === 'other-owner' ? { id: 'other-owner', role: 'OWNER', status: 'ACTIVE' } : null },
    album: { findUnique: async () => ({
      id: targetReleaseAlbumId('main', source.id), title: source.title, tiktokAlbumId: 'target-platform-album',
      tiktokVersion: 1, onlineVersion: null, reviewStatus: 'REVIEWING', publishStatus: '0', status: 'REVIEWING',
      coverAsset: { providerImageId: 'target-cover-id' }, episodes: [{ tiktokVideoStatus: 'READY', coverAssetId: null }]
    }) },
    platformSyncJob: { findMany: async () => [{ id: 'review-job', kind: 'REVIEW', status: 'SUCCEEDED', createdAt: new Date('2026-09-27T10:00:00Z'), providerResponse: { review_status: 1 } }] }
  };
  const result = await multiAppReleaseStatus({ dbByApp: { taletv: target }, sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'source@example.com', authorizedAdminIds: { taletv: 'other-owner' } });
  assert.equal(result.items[0].prepared, true);
  assert.equal(result.items[0].jobs?.[0].kind, 'REVIEW');
  assert.equal(result.items[0].reviewStatus, 'REVIEWING');
});

test('requires a single-episode upload before enabling a batch for each target', async () => {
  let queued = 0;
  const target: any = {
    adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => ({ id: 'target-album', episodes: [] }) },
    platformSyncJob: { findFirst: async () => null, upsert: async () => { queued += 1; } }
  };
  const result = await runMultiAppRelease({ sourceDb: { album: { findUnique: async () => source } } as any, dbByApp: { taletv: target }, env,
    sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'UPLOAD_VIDEO_URL',
    sources: [{ episodeNo: 1, sourceUrl: 'https://example.com/one.mp4' }, { episodeNo: 2, sourceUrl: 'https://example.com/two.mp4' }]
  });
  assert.equal(result.items[0].accepted, false);
  assert.match(result.items[0].error ?? '', /先仅提交一集/);
  assert.equal(queued, 0);
});

test('creates URL upload tasks for a legacy target with a scope-rejected source VID', async () => {
  let queued: any;
  const target: any = {
    adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => ({ id: 'target-album', episodes: [{ id: 'target-episode', albumId: 'target-album', episodeNo: 1, title: 'Episode 1', byteplusVid: 'vid-1', tiktokVideoStatus: 'FAILED' }] }) },
    platformSyncJob: { findFirst: async () => null, findUnique: async () => null, upsert: async ({ create }: any) => { queued = create; return { id: 'url-upload' }; } }
  };
  const result = await runMultiAppRelease({ sourceDb: { album: { findUnique: async () => source } } as any, dbByApp: { taletv: target }, env,
    sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['taletv'], operatorEmail: 'owner@example.com', action: 'UPLOAD_VIDEO_URL',
    sources: [{ episodeNo: 1, sourceUrl: 'https://example.com/one.mp4' }]
  });
  assert.equal(result.items[0].accepted, true);
  assert.match(queued.dedupeKey, /^VIDEO_URL:/);
  assert.equal(queued.snapshotJson.sourceVid, 'vid-1');
  assert.equal(queued.snapshotJson.uploadMode, 'URL');
  assert.equal(queued.snapshotJson.expectedVid, 'vid-1');
});

test('rejects URL uploads to the source app without creating any task', async () => {
  const db: any = {
    adminUser: { findUnique: async () => ({ id: 'owner', role: 'OWNER', status: 'ACTIVE' }) },
    album: { findUnique: async () => source }
  };
  const result = await runMultiAppRelease({ sourceDb: db, dbByApp: { main: db }, env,
    sourceApp: 'main', sourceAlbumId: source.id, targetApps: ['main'], operatorEmail: 'owner@example.com', action: 'UPLOAD_VIDEO_URL',
    sources: [{ episodeNo: 1, sourceUrl: 'https://example.com/one.mp4' }]
  });
  assert.equal(result.items[0].accepted, false);
  assert.match(result.items[0].error ?? '', /源小程序不参与/);
});
