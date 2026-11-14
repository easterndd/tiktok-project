import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { assertRejectedEpisodeReplacement, readRejectedEpisodeReplacements } from './rejected-episode-replacement.service';

function fixture() {
  const episodes = [1, 2, 17].map((episodeNo) => ({
    id: 'local-' + episodeNo,
    episodeNo,
    tiktokEpisodeId: 'platform-' + episodeNo,
    byteplusVid: 'old-' + episodeNo,
    byteplusUploadStatus: 'READY',
    tiktokVideoStatus: 'READY',
    status: 'OFFLINE'
  }));
  const album = {
    id: 'album-1', tiktokVersion: 1, reviewStatus: '3', status: 'OFFLINE', publishStatus: 'UNLISTED', episodes
  };
  const reconciliation = {
    id: 'reconcile-1',
    completedAt: new Date('2026-11-12T05:37:35.000Z'),
    providerResponse: {
      checked_version: 1, review_status: 3,
      episode_info_list: episodes.map((episode) => ({
        episode_id: episode.tiktokEpisodeId,
        seq: episode.episodeNo,
        byteplus_vid: episode.byteplusVid,
        review_result: { overall_review_status: episode.episodeNo === 2 ? 2 : 3 }
      })),
      episode_failures: [
        { episode_id: 'platform-1', review_status: '3', exception_reason: 'Episode Video: rejected' },
        { episode_id: 'platform-17', review_status: '3', exception_reason: 'Episode Video: guidelines' }
      ]
    }
  };
  let activeJob = false;
  const db = {
    album: { findUnique: async (args: any) => args.select?.episodes?.where
      ? { status: album.status, publishStatus: album.publishStatus,
        episodes: episodes.filter((episode) => episode.id === args.select.episodes.where.id) }
      : album },
    platformSyncJob: { findFirst: async (args: any) => args.where.kind === 'RECONCILE'
      ? reconciliation
      : activeJob ? { id: 'active-platform-job' } : null }
  } as unknown as PrismaClient;
  return { db, album, episodes, reconciliation, setActiveJob: (value: boolean) => { activeJob = value; } };
}

test('only the rejected episodes from the current reviewed version can replace their original VID', async () => {
  const { db } = fixture();
  const report = await readRejectedEpisodeReplacements(db, 'album-1');
  assert.deepEqual(report.items.map((item) => item.episodeNo), [1, 17]);
  assert.equal(report.items[0].reason, 'Episode Video: rejected');
  assert.equal(report.items[0].canStartReplacement, true);
  await assertRejectedEpisodeReplacement(db, 'album-1', 'local-1', 'old-1', 'READY');
  await assert.rejects(
    () => assertRejectedEpisodeReplacement(db, 'album-1', 'local-2', 'old-2', 'READY'),
    /不在当前版本的审核驳回分集清单/
  );
});

test('finds rejected episodes by the submitted sequence after earlier rejected episodes were excluded', async () => {
  const { db, reconciliation } = fixture();
  const versionSnapshot = {
    episodes: [
      { localEpisodeId: 'local-1', episode_id: 'platform-1', seq: 1 },
      { localEpisodeId: 'local-2', episode_id: 'platform-2', seq: 2 },
      { localEpisodeId: 'local-17', episode_id: 'platform-17', seq: 3 }
    ]
  };
  const versionJob = {
    snapshotJson: versionSnapshot,
    providerResponse: { version: 1, episode_id_map: { 'platform-17': 'platform-17-v1' } }
  };
  (db as any).platformSyncJob.findFirst = async ({ where }: any) => {
    if (where.kind === 'RECONCILE') return {
      ...reconciliation,
      providerResponse: {
        checked_version: 1, review_status: 3,
        episode_info_list: [
          { episode_id: 'platform-1', seq: 1, byteplus_vid: 'old-1', review_result: { overall_review_status: 2 } },
          { episode_id: 'platform-2', seq: 2, byteplus_vid: 'old-2', review_result: { overall_review_status: 2 } },
          { episode_id: 'platform-17-v1', seq: 3, byteplus_vid: 'old-17', review_result: { overall_review_status: 3 } }
        ],
        episode_failures: [{ episode_id: 'platform-17-v1', review_status: 3, exception_reason: 'rejected after renumbering' }]
      }
    };
    if (where.kind === 'ALBUM_VERSION') return versionJob;
    return null;
  };

  const report = await readRejectedEpisodeReplacements(db, 'album-1');
  assert.deepEqual(report.items.map((item) => [item.id, item.episodeNo, item.localEpisodeNo, item.tiktokEpisodeId]), [
    ['local-17', 3, 17, 'platform-17-v1']
  ]);
  assert.equal(report.items[0].reason, 'rejected after renumbering');
});

test('replacement eligibility expires when the reviewed VID or current version changes', async () => {
  const { db, album, episodes, reconciliation } = fixture();
  episodes[0].byteplusVid = 'replacement-1';
  const report = await readRejectedEpisodeReplacements(db, 'album-1');
  assert.equal(report.items[0].canStartReplacement, false);
  await assert.rejects(
    () => assertRejectedEpisodeReplacement(db, 'album-1', 'local-1', 'old-1', 'READY'),
    /视频已更换/
  );
  episodes[0].byteplusVid = 'old-1';
  album.tiktokVersion = 2;
  assert.match((await readRejectedEpisodeReplacements(db, 'album-1')).message ?? '', /请先.*对账/);
  album.tiktokVersion = 1;
  reconciliation.providerResponse.review_status = 2;
  assert.match((await readRejectedEpisodeReplacements(db, 'album-1')).message ?? '', /请先.*对账/);
});

test('an active platform task or mismatched upload state prevents replacement', async () => {
  const { db, episodes, setActiveJob } = fixture();
  setActiveJob(true);
  await assert.rejects(
    () => assertRejectedEpisodeReplacement(db, 'album-1', 'local-17', 'old-17', 'READY'),
    /平台任务/
  );
  setActiveJob(false);
  episodes[2].byteplusUploadStatus = 'UPLOADING';
  await assert.rejects(
    () => assertRejectedEpisodeReplacement(db, 'album-1', 'local-17', 'old-17', 'READY'),
    /正在上传/
  );
  await assertRejectedEpisodeReplacement(db, 'album-1', 'local-17', 'old-17', 'UPLOADING');
});

test('a rejected version cannot replace a video still used by an online album', async () => {
  const { db, album } = fixture();
  album.status = 'ONLINE';
  album.publishStatus = 'LISTED';
  await assert.rejects(
    () => assertRejectedEpisodeReplacement(db, 'album-1', 'local-1', 'old-1', 'READY'),
    /仍在线上/
  );
});
