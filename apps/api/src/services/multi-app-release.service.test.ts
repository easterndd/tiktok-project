import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '../config/env';
import { runMultiAppRelease, targetReleaseAlbumId } from './multi-app-release.service';

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

test('prepares an independent target album with the same BytePlus VID and its own ad placement', async () => {
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
  assert.equal(created.episode.byteplusVid, 'vid-1');
  assert.deepEqual(jobs, ['COVER', 'VIDEO']);
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
    $transaction: async () => { wrote = true; }
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
  assert.deepEqual(queued, ['COVER:album-cover', 'COVER:episode-cover', 'VIDEO:episode-1']);
});
