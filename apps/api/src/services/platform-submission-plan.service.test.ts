import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueRejectedEpisodeExclusionPlan, readRejectedEpisodeExclusionPlan } from './platform-submission-plan.service';

function fixture() {
  const episodes = [
    { id: 'local-1', episodeNo: 1, title: 'One', tiktokEpisodeId: 'platform-1', byteplusVid: 'vid-1', byteplusUploadStatus: 'READY', tiktokVideoStatus: 'READY', coverAsset: null },
    { id: 'local-2', episodeNo: 2, title: 'Rejected', tiktokEpisodeId: 'platform-2', byteplusVid: 'vid-2', byteplusUploadStatus: 'READY', tiktokVideoStatus: 'READY', coverAsset: null },
    { id: 'local-17', episodeNo: 17, title: 'Seventeen', tiktokEpisodeId: 'platform-17', byteplusVid: 'vid-17', byteplusUploadStatus: 'READY', tiktokVideoStatus: 'READY', coverAsset: null }
  ];
  const album = {
    id: 'album-1', title: 'Drama', description: 'Description', language: 'en', releaseYear: 2026, dramaType: 2, tagList: [1],
    tiktokAlbumId: 'platform-album', tiktokVersion: 3, reviewStatus: '3', publishStatus: 'UNLISTED', status: 'OFFLINE',
    coverAsset: { providerImageId: 'album-cover' }, episodes
  };
  const versionJob = {
    id: 'version-3', snapshotJson: { albumId: 'album-1', albumInfo: { title: 'Drama' }, episodes: episodes.map((episode, index) => ({
      localEpisodeId: episode.id, episode_id: episode.tiktokEpisodeId, seq: index + 1, title: episode.title,
      byteplus_vid: episode.byteplusVid, cover_list: ['album-cover']
    })) },
    providerResponse: { version: 3, episode_id_map: { 'seq:1': 'platform-1', 'seq:2': 'platform-2', 'seq:3': 'platform-17' } }
  };
  const reconciliation = {
    id: 'reconcile-3', completedAt: new Date('2026-11-13T03:00:00Z'),
    providerResponse: { checked_version: 3, review_status: 3, episode_info_list: [
      { episode_id: 'platform-1', seq: 1, byteplus_vid: 'vid-1' },
      { episode_id: 'platform-2', seq: 2, byteplus_vid: 'vid-2', review_result: { overall_review_status: 3 } },
      { episode_id: 'platform-17', seq: 3, byteplus_vid: 'vid-17' }
    ], episode_failures: [{ episode_id: 'platform-2', review_status: 3, exception_reason: 'Rejected' }] }
  };
  const jobs: any[] = [];
  let planRow: any = null;
  const db: any = {
    album: { findUnique: async () => album },
    platformSyncJob: {
      findFirst: async ({ where }: any) => {
        if (where.kind === 'RECONCILE') return reconciliation;
        if (where.kind === 'ALBUM_VERSION' && where.providerResponse) return versionJob;
        if (where.kind === 'ALBUM_VERSION' && where.status === 'CONFLICT') return null;
        return null;
      },
      findUnique: async ({ where }: any) => jobs.find((job) => job.id === where.id || job.dedupeKey === where.dedupeKey) ?? null,
      upsert: async ({ create }: any) => { const job = { id: 'sync-job', ...create }; jobs.push(job); return job; }
    },
    platformEpisodePlan: {
      findUnique: async () => planRow,
      upsert: async ({ create, update }: any) => { planRow = planRow ? { ...planRow, ...update } : create; return planRow; },
      update: async ({ data }: any) => { planRow = { ...planRow, ...data }; return planRow; }
    }
  };
  return { db, album, jobs, getPlan: () => planRow };
}

test('previews every non-rejected episode even when none is confirmed passed', async () => {
  const { db } = fixture();
  const plan = await readRejectedEpisodeExclusionPlan(db, 'album-1');
  assert.equal(plan.canSubmit, true);
  assert.deepEqual(plan.included.map((episode: any) => [episode.id, episode.localEpisodeNo, episode.platformSeq]), [
    ['local-1', 1, 1], ['local-17', 17, 2]
  ]);
  assert.deepEqual(plan.excluded.map((episode: any) => [episode.id, episode.localEpisodeNo]), [['local-2', 2]]);
  assert.equal(plan.excluded[0].reason, 'Rejected');
});

test('queues an immutable version snapshot without deleting or renumbering local episodes', async () => {
  const { db, album, jobs, getPlan } = fixture();
  const result = await enqueueRejectedEpisodeExclusionPlan(db, 'album-1', 'reconcile-3', 'admin-1');
  assert.equal(result.job.status, 'PENDING');
  assert.equal(getPlan().status, 'SYNC_QUEUED');
  const snapshot = result.job.snapshotJson as any;
  assert.deepEqual(snapshot.episodes.map((episode: any) => [episode.localEpisodeId, episode.seq]), [
    ['local-1', 1], ['local-17', 2]
  ]);
  assert.deepEqual(album.episodes.map((episode: any) => [episode.id, episode.episodeNo]), [
    ['local-1', 1], ['local-2', 2], ['local-17', 17]
  ]);
  assert.equal(jobs.length, 1);
});

test('does not create a plan when a retained episode VID changed since the reviewed version', async () => {
  const { db, album } = fixture();
  album.episodes[0].byteplusVid = 'changed-vid';
  const plan = await readRejectedEpisodeExclusionPlan(db, 'album-1');
  assert.equal(plan.canSubmit, false);
  assert.match(plan.message ?? '', /VID 与当前平台版本不一致/);
});
