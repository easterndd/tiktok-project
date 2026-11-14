import assert from 'node:assert/strict';
import test from 'node:test';
import { excludeRejectedAndSaveSubmissionPlan, readAlbumSubmissionPlan } from './album-submission-plan.service';

function fixture() {
  const episodes = [1, 2, 3].map((episodeNo) => ({
    id: `local-${episodeNo}`,
    episodeNo,
    title: `Episode ${episodeNo}`,
    tiktokEpisodeId: `platform-${episodeNo}`,
    byteplusVid: `vid-${episodeNo}`,
    byteplusUploadStatus: 'READY',
    tiktokVideoStatus: 'READY',
    status: 'OFFLINE'
  }));
  const album: any = {
    id: 'album-1', tiktokVersion: 1, reviewStatus: '3', status: 'OFFLINE', publishStatus: 'UNLISTED',
    platformEpisodePlan: null, episodes
  };
  const writes: any[] = [];
  const reconciliation: any = {
    id: 'reconcile-1', completedAt: new Date('2026-11-12T00:00:00Z'),
    providerResponse: {
      checked_version: 1, review_status: 3,
      episode_info_list: episodes.map((episode) => ({
        episode_id: episode.tiktokEpisodeId,
        seq: episode.episodeNo,
        byteplus_vid: episode.byteplusVid,
        review_result: { overall_review_status: episode.episodeNo === 2 ? 3 : 2 }
      }))
    }
  };
  const db: any = {
    album: {
      findUnique: async () => album,
      update: async (input: any) => { writes.push(input); Object.assign(album, input.data); return album; }
    },
    platformSyncJob: {
      findFirst: async ({ where }: any) => where.kind === 'RECONCILE' ? reconciliation : null
    },
    uploadJob: { findFirst: async () => null }
  };
  return { db, album, episodes, writes };
}

test('defaults a rejected version plan to all non-rejected episodes with contiguous sequence numbers', async () => {
  const { db, episodes } = fixture();
  const plan = await readAlbumSubmissionPlan(db, 'album-1');
  assert.deepEqual(plan.included.map((item) => [item.id, item.episodeNo, item.submissionSeq]), [
    ['local-1', 1, 1], ['local-3', 3, 2]
  ]);
  assert.deepEqual(plan.excluded.map((item) => item.id), ['local-2']);
  assert.equal(plan.persisted, false);
  assert.deepEqual(episodes.map((item) => item.episodeNo), [1, 2, 3]);
});

test('persists the verified passing episode IDs without changing local episode numbers', async () => {
  const { db, album, episodes, writes } = fixture();
  const plan = await excludeRejectedAndSaveSubmissionPlan(db, 'album-1');
  assert.deepEqual(album.platformEpisodePlan, ['local-1', 'local-3']);
  assert.equal(writes.length, 1);
  assert.deepEqual(plan.included.map((item) => item.submissionSeq), [1, 2]);
  assert.deepEqual(episodes.map((item) => item.episodeNo), [1, 2, 3]);
  assert.equal((await readAlbumSubmissionPlan(db, 'album-1')).persisted, true);
});

test('does not generate a plan when the current rejected version has no complete reconciliation', async () => {
  const { db } = fixture();
  db.platformSyncJob.findFirst = async () => null;
  await assert.rejects(() => excludeRejectedAndSaveSubmissionPlan(db, 'album-1'), /先在平台任务中执行“对账”/);
});

test('blocks plan creation while retained episode media is not ready', async () => {
  const { db, episodes } = fixture();
  episodes[2].tiktokVideoStatus = 'PROCESSING';
  await assert.rejects(() => excludeRejectedAndSaveSubmissionPlan(db, 'album-1'), /第 3 集/);
});
