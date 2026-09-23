import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueAlbumAction, enqueuePlatformSyncJob, processPlatformSyncJobs } from './platform-sync.service';
import { TikTokShortDramaApiError } from './tiktok-short-drama-api.service';

test('requeues a failed platform sync job when an operator retries it', async () => {
  const updateInputs: Record<string, unknown>[] = [];
  const prisma = {
    platformSyncJob: {
      findUnique: async () => ({ id: 'job-1', status: 'FAILED' }),
      update: async (input: Record<string, unknown>) => {
        updateInputs.push(input);
        return { id: 'job-1', status: 'PENDING' };
      },
      upsert: async () => assert.fail('failed jobs should be reset instead of upserted')
    }
  };

  const result = await enqueuePlatformSyncJob(prisma as any, {
    kind: 'VIDEO',
    targetId: 'episode-1',
    episodeId: 'episode-1',
    dedupeKey: 'VIDEO:episode-1:vid-1'
  });

  assert.deepEqual(result, { id: 'job-1', status: 'PENDING' });
  const updateInput = updateInputs[0];
  assert.ok(updateInput);
  const data = updateInput.data as Record<string, unknown>;
  assert.equal(data.status, 'PENDING');
  assert.equal(data.attemptCount, 0);
  assert.equal(data.errorMessage, null);
});

test('does not duplicate an active platform sync job', async () => {
  const existing = { id: 'job-1', status: 'PROCESSING' };
  const prisma = {
    platformSyncJob: {
      findUnique: async () => existing,
      update: async () => assert.fail('active jobs should not be reset'),
      upsert: async () => assert.fail('active jobs should not be duplicated')
    }
  };

  const result = await enqueuePlatformSyncJob(prisma as any, {
    kind: 'VIDEO',
    targetId: 'episode-1',
    episodeId: 'episode-1',
    dedupeKey: 'VIDEO:episode-1:vid-1'
  });

  assert.equal(result, existing);
});

test('stores review priority in the queued snapshot and rejects changing an active review', async () => {
  let queued: Record<string, any> | null = null;
  const prisma = {
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: '7688551749335058439', tiktokVersion: 2, onlineVersion: 1, reviewStatus: null }) },
    platformSyncJob: {
      findFirst: async () => queued,
      findUnique: async () => null,
      upsert: async (input: Record<string, any>) => {
        queued = { id: 'review-1', ...input.create };
        return queued;
      }
    }
  };
  const job = await enqueueAlbumAction(prisma as any, 'REVIEW', 'album-1', 'admin-1', 1);
  assert.deepEqual(job.snapshotJson, { albumId: 'album-1', platformAlbumId: '7688551749335058439', version: 2, priorityScore: 1 });
  await assert.rejects(() => enqueueAlbumAction(prisma as any, 'REVIEW', 'album-1', 'admin-1', 2), /不同优先级/);
});

test('recreates a TikTok album when its saved ID is not found for the current client', async () => {
  const albumUpdates: Record<string, unknown>[] = [];
  const episodeUpdateManyInputs: Record<string, unknown>[] = [];
  const episodeUpdates: Record<string, unknown>[] = [];
  const submittedEpisodes: Record<string, unknown>[] = [];
  const syncJobUpdates: Record<string, unknown>[] = [];
  const job = {
    id: 'job-1',
    kind: 'ALBUM_VERSION',
    status: 'PENDING',
    attemptCount: 0,
    albumId: 'album-1',
    targetId: 'album-1',
    snapshotJson: {
      albumId: 'album-1',
      albumInfo: { language: 'en', title: 'Drama', seq_num: 1, cover_list: ['cover-1'], year: 2026, album_status: 3, desp: 'Description', drama_type: 2, tag_list: [1] },
      episodes: [{ localEpisodeId: 'episode-1', episode_id: 'stale-episode-1', title: 'Episode 1', seq: 1, cover_list: ['cover-1'], byteplus_vid: 'vid-1' }]
    }
  };
  const prisma = {
    platformSyncJob: {
      findMany: async () => [job],
      updateMany: async () => ({ count: 1 }),
      update: async (input: Record<string, unknown>) => { syncJobUpdates.push(input); return input; }
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'stale-album-1', tiktokVersion: 7 }),
      update: async (input: Record<string, unknown>) => { albumUpdates.push(input); return input; }
    },
    episode: {
      updateMany: async (input: Record<string, unknown>) => { episodeUpdateManyInputs.push(input); return input; },
      update: async (input: Record<string, unknown>) => { episodeUpdates.push(input); return input; }
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = {
    queryAlbum: async () => { throw new TikTokShortDramaApiError('Short drama album not found', '22001'); },
    createAlbum: async () => ({ albumId: 'new-album-1', requestId: 'create-log' }),
    updateAlbumVersion: async (input: { episodes: Record<string, unknown>[] }) => {
      submittedEpisodes.push(...input.episodes);
      return { version: 1, episodeIdMap: { seq_1: 'new-episode-1' }, requestId: 'update-log', publishStatus: 0 };
    }
  };

  await processPlatformSyncJobs(prisma as any, api as any, { now: () => new Date('2026-09-23T10:00:00.000Z') });

  assert.equal((submittedEpisodes[0] as { episode_id?: string }).episode_id, undefined);
  assert.deepEqual((episodeUpdateManyInputs[0].data as Record<string, unknown>).tiktokEpisodeId, null);
  assert.equal((episodeUpdates[0].data as Record<string, unknown>).tiktokEpisodeId, 'new-episode-1');
  assert.equal((albumUpdates.at(-1)?.data as Record<string, unknown>).tiktokAlbumId, 'new-album-1');
  assert.equal((syncJobUpdates.at(-1)?.data as Record<string, unknown>).status, 'SUCCEEDED');
});

test('resumes a recreated album without reusing episode ids from the old snapshot', async () => {
  const episodeUpdates: Record<string, unknown>[] = [];
  const submittedEpisodes: Record<string, unknown>[] = [];
  const syncJobUpdates: Record<string, unknown>[] = [];
  const job = {
    id: 'job-1', kind: 'ALBUM_VERSION', status: 'PENDING', attemptCount: 1,
    albumId: 'album-1', targetId: 'album-1',
    providerResponse: { created_album_id: 'new-album-1' },
    snapshotJson: {
      albumId: 'album-1',
      albumInfo: { language: 'en', title: 'Drama', seq_num: 1, cover_list: ['cover-1'], year: 2026, album_status: 3, desp: 'Description', drama_type: 2, tag_list: [1] },
      episodes: [{ localEpisodeId: 'episode-1', episode_id: 'stale-episode-1', title: 'Episode 1', seq: 1, cover_list: ['cover-1'], byteplus_vid: 'vid-1' }]
    }
  };
  const prisma = {
    platformSyncJob: {
      findMany: async () => [job],
      updateMany: async () => ({ count: 1 }),
      update: async (input: Record<string, unknown>) => { syncJobUpdates.push(input); return input; }
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'new-album-1', tiktokVersion: null }),
      update: async (input: Record<string, unknown>) => input
    },
    episode: { update: async (input: Record<string, unknown>) => { episodeUpdates.push(input); return input; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = {
    queryAlbum: async () => ({ data: { current_version: null } }),
    createAlbum: async () => assert.fail('a recreated album must not be created again'),
    updateAlbumVersion: async (input: { episodes: Record<string, unknown>[] }) => {
      submittedEpisodes.push(...input.episodes);
      return { version: 1, episodeIdMap: { seq_1: 'new-episode-1' }, requestId: 'update-log', publishStatus: 0 };
    }
  };

  await processPlatformSyncJobs(prisma as any, api as any, { now: () => new Date('2026-09-23T10:00:00.000Z') });

  assert.equal(submittedEpisodes[0].episode_id, undefined);
  assert.equal((episodeUpdates[0].data as Record<string, unknown>).tiktokEpisodeId, 'new-episode-1');
  assert.equal((syncJobUpdates.at(-1)?.data as Record<string, unknown>).status, 'SUCCEEDED');
});

test('waits after an initial album creation reports not found without creating another album', async () => {
  const syncJobUpdates: Record<string, unknown>[] = [];
  let creations = 0;
  const job = {
    id: 'job-1', kind: 'ALBUM_VERSION', status: 'PENDING', attemptCount: 0,
    albumId: 'album-1', targetId: 'album-1',
    snapshotJson: {
      albumId: 'album-1',
      albumInfo: { language: 'en', title: 'Drama', seq_num: 1, cover_list: ['cover-1'], year: 2026, album_status: 3, desp: 'Description', drama_type: 2, tag_list: [1] },
      episodes: [{ localEpisodeId: 'episode-1', title: 'Episode 1', seq: 1, cover_list: ['cover-1'], byteplus_vid: 'vid-1' }]
    }
  };
  const prisma = {
    platformSyncJob: {
      findMany: async () => [job],
      updateMany: async () => ({ count: 1 }),
      update: async (input: Record<string, unknown>) => { syncJobUpdates.push(input); return input; }
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: null, tiktokVersion: null }),
      update: async (input: Record<string, unknown>) => input
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = {
    createAlbum: async () => { creations += 1; return { albumId: 'new-album-1', requestId: 'create-log' }; },
    updateAlbumVersion: async () => { throw new TikTokShortDramaApiError('Short drama album not found', '22001', 'update-log'); }
  };

  await processPlatformSyncJobs(prisma as any, api as any, { now: () => new Date('2026-09-23T10:00:00.000Z') });

  assert.equal(creations, 1);
  assert.equal((syncJobUpdates.at(-1)?.data as Record<string, unknown>).status, 'PENDING');
  assert.deepEqual((syncJobUpdates.at(-1)?.data as Record<string, unknown>).providerResponse, { created_album_id: 'new-album-1' });
});
