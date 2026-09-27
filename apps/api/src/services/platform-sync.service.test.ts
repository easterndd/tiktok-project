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
      return { version: 1, episodeIdMap: { 'seq:1': 'new-episode-1' }, requestId: 'update-log', publishStatus: 0 };
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

test('does not mark a created platform version successful when episode IDs are missing', async () => {
  const jobUpdates: Record<string, any>[] = [];
  let albumUpdated = false;
  const job = {
    id: 'version-missing-map', kind: 'ALBUM_VERSION', status: 'PENDING', attemptCount: 0, albumId: 'album-1', targetId: 'album-1',
    snapshotJson: {
      albumId: 'album-1', albumInfo: { title: 'Drama' },
      episodes: [{ localEpisodeId: 'episode-1', seq: 1, title: 'Episode 1', cover_list: ['cover-1'], byteplus_vid: 'vid-1' }]
    }
  };
  const prisma: any = {
    platformSyncJob: { findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => { jobUpdates.push(input); return input; } },
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: null }), update: async () => { albumUpdated = true; } }
  };
  const api = {
    queryAlbum: async () => ({ data: { current_version: null } }),
    updateAlbumVersion: async () => ({ version: 1, episodeIdMap: {}, requestId: 'update-log', publishStatus: 0 })
  };

  await processPlatformSyncJobs(prisma, api as any);

  assert.equal(albumUpdated, false);
  assert.equal(jobUpdates.at(-1)?.data.status, 'CONFLICT');
  assert.equal(jobUpdates.at(-1)?.data.providerResponse.version, 1);
});

test('reconciliation restores historical seq-colon episode IDs only after matching TikTok and local data', async () => {
  const episodeUpdates: Record<string, any>[] = [];
  const jobUpdates: Record<string, any>[] = [];
  const job = { id: 'reconcile-ids', kind: 'RECONCILE', status: 'PENDING', attemptCount: 0, albumId: 'album-1' };
  const versionJob = {
    snapshotJson: { episodes: [{ localEpisodeId: 'episode-1', seq: 1, byteplus_vid: 'vid-1' }] },
    providerResponse: { version: 1, episode_id_map: { 'seq:1': 'platform-episode-1' } }
  };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job], updateMany: async () => ({ count: 1 }),
      findFirst: async () => versionJob,
      update: async (input: Record<string, any>) => { jobUpdates.push(input); return input; }
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 1 }),
      update: async (input: Record<string, any>) => input
    },
    episode: {
      findMany: async () => [{ id: 'episode-1', episodeNo: 1, byteplusVid: 'vid-1', tiktokEpisodeId: null }],
      updateMany: async (input: Record<string, any>) => { episodeUpdates.push(input); return { count: 1 }; }
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { queryAlbum: async () => ({ requestId: 'query-log', data: {
    current_version: 1, online_version: null, publish_status: 0, review_status: 0,
    episode_info_list: [{ seq: 1, episode_id: 'platform-episode-1', byteplus_vid: 'vid-1' }]
  } }) };

  await processPlatformSyncJobs(prisma, api as any);

  assert.equal(episodeUpdates[0].data.tiktokEpisodeId, 'platform-episode-1');
  assert.equal(episodeUpdates[0].where.tiktokEpisodeId, null);
  assert.equal(jobUpdates.at(-1)?.data.providerResponse.repaired_episode_ids, 1);
  assert.equal(jobUpdates.at(-1)?.data.status, 'SUCCEEDED');
});

test('reconciliation refuses to restore an ID when TikTok returns a different episode', async () => {
  let episodeWrites = 0;
  const jobUpdates: Record<string, any>[] = [];
  const job = { id: 'reconcile-mismatch', kind: 'RECONCILE', status: 'PENDING', attemptCount: 0, albumId: 'album-1' };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job], updateMany: async () => ({ count: 1 }),
      findFirst: async () => ({ snapshotJson: { episodes: [{ localEpisodeId: 'episode-1', seq: 1, byteplus_vid: 'vid-1' }] }, providerResponse: { version: 1, episode_id_map: { 'seq:1': 'expected-id' } } }),
      update: async (input: Record<string, any>) => { jobUpdates.push(input); return input; }
    },
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1' }) },
    episode: {
      findMany: async () => [{ id: 'episode-1', episodeNo: 1, byteplusVid: 'vid-1', tiktokEpisodeId: null }],
      updateMany: async () => { episodeWrites += 1; return { count: 1 }; }
    }
  };
  const api = { queryAlbum: async () => ({ data: {
    current_version: 1, online_version: null, publish_status: 0,
    episode_info_list: [{ seq: 1, episode_id: 'different-id', byteplus_vid: 'vid-1' }]
  } }) };

  await processPlatformSyncJobs(prisma, api as any);

  assert.equal(episodeWrites, 0);
  assert.equal(jobUpdates.at(-1)?.data.status, 'FAILED');
  assert.match(jobUpdates.at(-1)?.data.errorMessage, /不一致/);
});

test('reviewing a new version keeps the published old version online', async () => {
  const updates: Record<string, any>[] = [];
  const job = { id: 'review-2', kind: 'REVIEW', status: 'PENDING', attemptCount: 0, albumId: 'album-1', snapshotJson: { platformAlbumId: 'platform-1', version: 2, priorityScore: 2 } };
  const prisma: any = {
    platformSyncJob: { findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => input },
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2, onlineVersion: 1, platformPublishedVersion: 1 }), update: async (input: Record<string, any>) => { updates.push(input); return input; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { submitReview: async () => ({ reviewId: 'review-id', requestId: 'request-id' }) };
  await processPlatformSyncJobs(prisma as any, api as any);
  assert.equal(updates[0].data.status, 'ONLINE');
  assert.equal(updates[0].data.reviewStatus, 'REVIEWING');
});

test('reconciliation keeps old episodes online while the new version is under review', async () => {
  const episodeUpdates: Record<string, any>[] = [];
  const albumUpdates: Record<string, any>[] = [];
  const jobUpdates: Record<string, any>[] = [];
  const job = { id: 'reconcile-1', kind: 'RECONCILE', status: 'PENDING', attemptCount: 0, albumId: 'album-1' };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => { jobUpdates.push(input); return input; },
      findFirst: async () => ({ snapshotJson: { episodes: [{ localEpisodeId: 'episode-1' }, { localEpisodeId: 'episode-2' }, { localEpisodeId: 'episode-3' }] } })
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2, onlineVersion: 1 }),
      update: async (input: Record<string, any>) => { albumUpdates.push(input); return input; }
    },
    episode: { updateMany: async (input: Record<string, any>) => { episodeUpdates.push(input); return input; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { queryAlbum: async (input: { version?: number }) => ({ requestId: 'request-id', data: input.version === 1
    ? { review_status: 2, episode_info_list: [{ episode_id: 'old-episode', seq: 1, exception_reason: 'removed from BytePlus' }] }
    : { current_version: 2, online_version: 1, publish_status: 1, review_status: 1, episode_info_list: [{ episode_id: 'new-episode', seq: 4, review_result: { overall_review_status: 3 } }] } }) };
  await processPlatformSyncJobs(prisma, api as any);
  assert.equal(albumUpdates[0].data.status, 'ONLINE');
  assert.equal(albumUpdates[0].data.reviewStatus, '1');
  assert.equal(episodeUpdates[0].data.status, 'OFFLINE');
  assert.deepEqual(episodeUpdates[1].where.id.in, ['episode-1', 'episode-2', 'episode-3']);
  assert.equal(episodeUpdates[1].data.status, 'ONLINE');
  assert.equal(jobUpdates.at(-1)?.data.providerResponse.episode_failures[0].seq, 4);
  assert.equal(jobUpdates.at(-1)?.data.providerResponse.online_episode_failures[0].exception_reason, 'removed from BytePlus');
});

test('reconciliation stores TikTok review reasons and episode failures in the job result', async () => {
  const jobUpdates: Record<string, any>[] = [];
  const albumUpdates: Record<string, any>[] = [];
  const job = { id: 'reconcile-reasons', kind: 'RECONCILE', status: 'PENDING', attemptCount: 0, albumId: 'album-1' };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job],
      updateMany: async () => ({ count: 1 }),
      update: async (input: Record<string, any>) => { jobUpdates.push(input); return input; },
      findFirst: async () => null
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 3, onlineVersion: null }),
      update: async (input: Record<string, any>) => { albumUpdates.push(input); return input; }
    },
    episode: { updateMany: async () => ({}) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = {
    queryAlbum: async () => ({ requestId: 'query-log', data: {
      current_version: 3,
      online_version: null,
      publish_status: 0,
      review_status: 3,
      review_fail_reasons: ['Episode (ep-1): Episode Cover: Non-compliant content'],
      episode_info_list: [{ episode_id: 'ep-1', seq: 1, title: 'Episode 1', review_result: { overall_review_status: 3 }, exception_reason: 'this video has already been removed' }]
    } })
  };

  await processPlatformSyncJobs(prisma, api as any);

  const result = jobUpdates.at(-1)?.data.providerResponse;
  assert.equal(albumUpdates[0].data.reviewStatus, '3');
  assert.deepEqual(result.review_fail_reasons, ['Episode (ep-1): Episode Cover: Non-compliant content']);
  assert.equal(result.episode_failures[0].seq, 1);
  assert.equal(result.episode_failures[0].exception_reason, 'this video has already been removed');
  assert.equal(jobUpdates.at(-1)?.data.providerRequestId, 'query-log');
});

test('switching a listed album waits for reconciliation before exposing new episodes', async () => {
  const episodeUpdates: Record<string, any>[] = [];
  const albumUpdates: Record<string, any>[] = [];
  const job = { id: 'online-2', kind: 'SET_ONLINE_VERSION', status: 'PENDING', attemptCount: 0, albumId: 'album-1', snapshotJson: { version: 2 } };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => input,
      findFirst: async () => ({ snapshotJson: { episodes: [1, 2, 3, 4].map((number) => ({ localEpisodeId: `episode-${number}` })) } })
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2, onlineVersion: 1, platformPublishedVersion: 1, publishStatus: 'LISTED' }),
      update: async (input: Record<string, any>) => { albumUpdates.push(input); return input; }
    },
    episode: { updateMany: async (input: Record<string, any>) => { episodeUpdates.push(input); return input; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { queryAlbum: async () => ({ data: { review_status: 2 } }), setOnlineVersion: async () => ({ onlineVersion: 2, requestId: 'request-id' }) };
  await processPlatformSyncJobs(prisma, api as any);
  assert.equal(albumUpdates[0].data.onlineVersion, 2);
  assert.equal(albumUpdates[0].data.platformPublishedVersion, undefined);
  assert.equal(episodeUpdates.length, 0);
});

test('reconciliation opens the added episode after the new online version is confirmed', async () => {
  const episodeUpdates: Record<string, any>[] = [];
  const albumUpdates: Record<string, any>[] = [];
  const job = { id: 'reconcile-2', kind: 'RECONCILE', status: 'PENDING', attemptCount: 0, albumId: 'album-1' };
  const prisma: any = {
    platformSyncJob: {
      findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => input,
      findFirst: async () => ({ snapshotJson: { episodes: [1, 2, 3, 4].map((number) => ({ localEpisodeId: `episode-${number}` })) } })
    },
    album: {
      findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2, onlineVersion: 2, platformPublishedVersion: 1 }),
      update: async (input: Record<string, any>) => { albumUpdates.push(input); return input; }
    },
    episode: { updateMany: async (input: Record<string, any>) => { episodeUpdates.push(input); return input; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { queryAlbum: async () => ({ requestId: 'request-id', data: { current_version: 2, online_version: 2, publish_status: 1, review_status: 2, episode_info_list: [] } }) };
  await processPlatformSyncJobs(prisma, api as any);
  assert.equal(albumUpdates[0].data.platformPublishedVersion, 2);
  assert.deepEqual(episodeUpdates[1].where.id.in, ['episode-1', 'episode-2', 'episode-3', 'episode-4']);
});

test('uncertain review result is not replayed automatically', async () => {
  const updates: Record<string, any>[] = [];
  const job = { id: 'review-2', kind: 'REVIEW', status: 'PENDING', attemptCount: 0, albumId: 'album-1', snapshotJson: { platformAlbumId: 'platform-1', version: 2 } };
  const prisma = {
    platformSyncJob: { findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => { updates.push(input); return input; } },
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2 }) }
  };
  const api = { submitReview: async () => { throw new TikTokShortDramaApiError('timeout', undefined, undefined, true); } };
  await processPlatformSyncJobs(prisma as any, api as any);
  assert.equal(updates.at(-1)?.data.status, 'CONFLICT');
  assert.equal(updates.at(-1)?.data.nextAttemptAt, null);
});

test('a local save failure after TikTok accepts review requires reconciliation', async () => {
  const updates: Record<string, any>[] = [];
  const job = { id: 'review-2', kind: 'REVIEW', status: 'PENDING', attemptCount: 0, albumId: 'album-1', snapshotJson: { platformAlbumId: 'platform-1', version: 2 } };
  const prisma: any = {
    platformSyncJob: { findMany: async () => [job], updateMany: async () => ({ count: 1 }), update: async (input: Record<string, any>) => { updates.push(input); return input; } },
    album: { findUnique: async () => ({ id: 'album-1', tiktokAlbumId: 'platform-1', tiktokVersion: 2 }), update: async () => { throw new Error('database unavailable'); } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  const api = { submitReview: async () => ({ reviewId: 'accepted', requestId: 'request-id' }) };
  await processPlatformSyncJobs(prisma, api as any);
  assert.equal(updates.at(-1)?.data.status, 'CONFLICT');
});

test('a stale review job is not replayed after a worker interruption', async () => {
  const updates: Record<string, any>[] = [];
  const job = { id: 'review-2', kind: 'REVIEW', status: 'PROCESSING', albumId: 'album-1', startedAt: new Date('2026-09-23T09:00:00.000Z') };
  const prisma = {
    platformSyncJob: {
      findMany: async () => [job],
      updateMany: async () => ({ count: 1 }),
      update: async (input: Record<string, any>) => { updates.push(input); return input; }
    }
  };
  const api = { submitReview: async () => assert.fail('stale review must not be resubmitted') };
  await processPlatformSyncJobs(prisma as any, api as any, { now: () => new Date('2026-09-23T10:00:00.000Z') });
  assert.equal(updates[0].data.status, 'CONFLICT');
});
