import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { assertMediaScope, findUploadMedia, matchesUploadTags, processLocalUploadJobs, uploadScope, uploadTags } from './local-upload.service';
import { BytePlusVodError, type BytePlusMedia, type BytePlusVodService } from './byteplus-vod.service';

const env = {
  MINI_APP_KEY: 'storyland', TIKTOK_CLIENT_KEY: 'storyland-client', TIKTOK_CLIENT_SECRET: undefined,
  BYTEPLUS_ACCOUNT_ID: 'account', BYTEPLUS_SPACE_NAME: 'space', BYTEPLUS_REGION: 'region',
  COVER_ASSET_STORAGE_DIR: join(tmpdir(), 'quickreels-cover'), UPLOAD_MAX_RETRIES: 3
} as Env;
const instant = new Date('2026-10-10T08:00:00.000Z');

function mediaFor(jobId = 'job-1', owner = env): BytePlusMedia {
  return { vid: 'vid-1', title: 'Episode 1', spaceName: 'space', publishStatus: 'Published', tags: uploadTags(uploadScope(owner), jobId) };
}

function vod(input: { items?: BytePlusMedia[]; known?: BytePlusMedia[]; upload?: () => Promise<{ byteplusVid: string }>; playable?: () => boolean } = {}) {
  let uploads = 0;
  let publishes = 0;
  const service = {
    listMedia: async ({ tags }: { tags: string }) => {
      const items = (input.items ?? []).filter((item) => item.tags?.includes(tags));
      return { items, total: items.length };
    },
    getMediaInfos: async () => input.known ?? [],
    publishMedia: async (vid: string) => {
      const media = (input.known ?? input.items ?? []).find((item) => item.vid === vid);
      if (!media) throw new Error('Media not found');
      publishes++;
      media.publishStatus = 'Published';
    },
    hasPlayableUrl: async () => input.playable?.() ?? true,
    uploadLocalVideo: async ({ tags }: { tags?: string[] }) => {
      assert.equal(tags?.join(',').length, 35);
      uploads++;
      return input.upload ? input.upload() : { byteplusVid: 'vid-1' };
    }
  } as unknown as BytePlusVodService;
  return { service, uploadCount: () => uploads, publishCount: () => publishes };
}

function database(filePath: string | null, overrides: Record<string, unknown> = {}) {
  const episode: Record<string, any> = { id: 'episode-1', albumId: 'album-1', episodeNo: 1, title: 'Episode 1',
    status: 'UPLOADING', byteplusVid: null, byteplusUploadStatus: 'UPLOADING', coverAsset: null, album: { title: 'Drama' } };
  const job: Record<string, any> = { id: 'job-1', episodeId: 'episode-1', sourceType: 'FILE', sourceName: 'episode.mp4',
    status: 'PENDING', uploadScope: uploadScope(env), localFilePath: filePath, providerJobId: null, leaseToken: null,
    leaseExpiresAt: null, remoteStartedAt: null, nextAttemptAt: instant, startedAt: null, retryCount: 0,
    createdAt: instant, episode, ...overrides };
  const assets = new Map<string, any>();
  const matches = (where: Record<string, any>) => Object.entries(where).every(([key, expected]) => {
    if (key === 'id') return job.id === expected;
    if (expected instanceof Date || expected === null || typeof expected !== 'object') return job[key]?.valueOf?.() === expected?.valueOf?.();
    if ('in' in expected) return expected.in.includes(job[key]);
    return true;
  });
  const prisma = {
    uploadJob: {
      findMany: async () => ['PENDING', 'PROCESSING'].includes(job.status) ? [job] : [],
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) job[key] = value && typeof value === 'object' && 'increment' in value
          ? (job[key] ?? 0) + (value as { increment: number }).increment : value;
        return { count: 1 };
      }
    },
    episode: { updateMany: async ({ where, data }: any) => {
      if (where.id !== episode.id || (where.byteplusVid === null && episode.byteplusVid)) return { count: 0 };
      Object.assign(episode, data); return { count: 1 };
    } },
    sharedMediaAsset: {
      findUnique: async ({ where }: any) => assets.get(where.byteplusVid) ?? null,
      create: async ({ data }: any) => { const asset = { id: 'asset-1', ...data }; assets.set(data.byteplusVid, asset); return asset; }
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
  };
  return { prisma: prisma as unknown as PrismaClient, job, episode, assets };
}

function rejectedReplacementDatabase(filePath: string | null) {
  const db = database(filePath, { replacesByteplusVid: 'old-vid' });
  const album = { id: 'album-1', title: 'Drama', status: 'OFFLINE', reviewStatus: '3',
    tiktokVersion: 1, publishStatus: 'UNLISTED' };
  Object.assign(db.episode, { album, status: 'OFFLINE', tiktokEpisodeId: 'platform-1',
    byteplusVid: 'old-vid', byteplusUploadStatus: 'UPLOADING', tiktokVideoStatus: 'READY' });
  const prisma = db.prisma as any;
  prisma.album = { findUnique: async (args: any) => args.select?.episodes?.where
    ? { episodes: [db.episode] }
    : { ...album, episodes: [db.episode] } };
  prisma.platformSyncJob = { findFirst: async (args: any) => args.where.kind === 'RECONCILE'
    ? { id: 'reconcile-1', completedAt: instant, providerResponse: {
      checked_version: 1, review_status: 3,
      episode_info_list: [{ episode_id: 'platform-1', seq: 1, byteplus_vid: 'old-vid', review_result: { overall_review_status: 3 } }],
      episode_failures: [{ episode_id: 'platform-1', review_status: '3', exception_reason: 'Episode Video: rejected' }]
    } } : null };
  prisma.episode.findUnique = async () => db.episode;
  const updateMany = prisma.episode.updateMany.bind(prisma.episode);
  prisma.episode.updateMany = async (args: any) => {
    if (args.where.byteplusVid !== undefined && args.where.byteplusVid !== db.episode.byteplusVid) return { count: 0 };
    if (args.where.byteplusUploadStatus && args.where.byteplusUploadStatus !== db.episode.byteplusUploadStatus) return { count: 0 };
    return updateMany(args);
  };
  return db;
}

describe('local upload recovery', () => {
  it('keeps the rejected episode old VID until the new video is playable, then preserves its platform episode ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-replacement-'));
    try {
      const path = join(directory, 'corrected.mp4');
      await writeFile(path, 'video');
      const db = rejectedReplacementDatabase(path);
      let playable = false;
      const provider = vod({ known: [mediaFor()], playable: () => playable });
      let current = instant;
      const config = { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(provider.uploadCount(), 1);
      assert.equal(db.job.status, 'PROCESSING');
      assert.equal(db.episode.byteplusVid, 'old-vid');
      assert.equal(db.episode.tiktokEpisodeId, 'platform-1');
      playable = true;
      current = new Date(instant.getTime() + 60_000);
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(provider.uploadCount(), 1);
      assert.equal(db.job.status, 'SUCCEEDED');
      assert.equal(db.episode.byteplusVid, 'vid-1');
      assert.equal(db.episode.tiktokEpisodeId, 'platform-1');
      assert.equal(db.episode.tiktokVideoStatus, 'NOT_STARTED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('retains the rejected episode old VID when replacement upload fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-replacement-failed-'));
    try {
      const path = join(directory, 'corrected.mp4');
      await writeFile(path, 'video');
      const db = rejectedReplacementDatabase(path);
      const provider = vod({ upload: async () => { throw new BytePlusVodError('rejected upload', false); } });
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service,
        { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant });
      assert.equal(db.job.status, 'FAILED');
      assert.equal(db.episode.byteplusVid, 'old-vid');
      assert.equal(db.episode.byteplusUploadStatus, 'READY');
      assert.equal(db.episode.status, 'OFFLINE');
      assert.equal((await stat(path)).size, 5);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('uses BytePlus-compatible tags while keeping app and job identities distinct', () => {
    const scope = uploadScope(env);
    const tags = uploadTags(scope, 'job-1');
    assert.equal(tags.join(',').length, 35);
    assert.notEqual(tags[0], uploadTags(uploadScope({ ...env, MINI_APP_KEY: 'taletv' } as Env), 'job-1')[0]);
    assert.notEqual(tags[1], uploadTags(scope, 'job-2')[1]);
    assert.equal(matchesUploadTags(tags, scope, 'job-1'), true);
    assert.equal(matchesUploadTags([`qr-scope-${scope}`, 'qr-upload-job-1'], scope, 'job-1'), true);
  });

  it('binds only the exact task and scope match after a lost upload response', async () => {
    const foreign = { ...env, MINI_APP_KEY: 'taletv', TIKTOK_CLIENT_KEY: 'other-client' } as Env;
    const { service } = vod({ items: [mediaFor('job-1', foreign), mediaFor('other-job'), mediaFor()] });
    assert.equal((await findUploadMedia(service, env, { id: 'job-1', uploadScope: uploadScope(env), providerJobId: null }))?.vid, 'vid-1');
    await assert.rejects(() => findUploadMedia(vod({ items: [mediaFor(), { ...mediaFor(), vid: 'vid-2' }] }).service,
      env, { id: 'job-1', uploadScope: uploadScope(env), providerJobId: null }), /多个 VID/);
    await assert.rejects(() => assertMediaScope(database(null).prisma, env, mediaFor('job-1', foreign)), /其他小程序/);
    await assert.rejects(() => assertMediaScope(database(null).prisma, env, { vid: 'untagged', title: 'Episode 1' }), /缺少可验证/);
    const oldMedia = { ...mediaFor(), tags: [`qr-scope-${uploadScope(env)}`, 'qr-upload-job-1'] };
    assert.equal((await findUploadMedia(vod({ known: [oldMedia] }).service, env,
      { id: 'job-1', uploadScope: uploadScope(env), providerJobId: 'vid-1' }))?.vid, 'vid-1');
    await assertMediaScope(database(null).prisma, env, oldMedia);
  });

  it('recovers a committed upload without transferring the file again', async () => {
    const db = database(null, { status: 'PROCESSING', remoteStartedAt: new Date(instant.getTime() - 60_000) });
    const provider = vod({ items: [mediaFor()] });
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'SUCCEEDED');
    assert.equal(db.job.providerJobId, 'vid-1');
    assert.equal(db.episode.byteplusVid, 'vid-1');
    assert.equal(db.assets.size, 1);
  });

  it('waits for VOD visibility after a restart before retrying the retained file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-recovery-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path, { status: 'PROCESSING', leaseToken: 'old-lease', leaseExpiresAt: new Date(instant.getTime() - 1), remoteStartedAt: new Date(instant.getTime() - 60_000) });
      const provider = vod();
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant });
      assert.equal(provider.uploadCount(), 0);
      assert.equal(db.job.status, 'PROCESSING');
      assert.equal(db.job.nextAttemptAt.getTime(), instant.getTime() + 60_000);
      assert.equal(db.episode.byteplusUploadStatus, 'UPLOADING');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('releases a legacy parameter rejection after checking that no task VID exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-legacy-invalid-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path, { status: 'PROCESSING', remoteStartedAt: new Date(instant.getTime() - 11 * 60_000),
        errorMessage: '上传结果待确认：Upload Media Error: Error: {"ResponseMetadata":{"Error":{"Code":"InvalidParameter.InvalidParamErro' });
      const provider = vod();
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant });
      assert.equal(provider.uploadCount(), 0);
      assert.equal(db.job.status, 'FAILED');
      assert.equal(db.job.remoteStartedAt, null);
      assert.equal(db.job.localFilePath, path);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('releases a legacy task whose temporary file was lost', async () => {
    const db = database(null, { status: 'PROCESSING', uploadScope: null, startedAt: new Date(instant.getTime() - 60 * 60_000) });
    const provider = vod();
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'FAILED');
    assert.equal(db.episode.byteplusUploadStatus, 'FAILED');
  });

  it('does not upload an uncertain prior attempt while VOD lookup is unavailable', async () => {
    const db = database(null, { remoteStartedAt: new Date(instant.getTime() - 60_000) });
    const provider = vod();
    provider.service.listMedia = async () => { throw new Error('network down'); };
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'PROCESSING');
    assert.equal(db.job.retryCount, 0);
    assert.match(db.job.errorMessage, /VOD 查询暂不可用/);
  });

  it('uploads a new server file without querying VOD before the upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-first-upload-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      const provider = vod({ known: [mediaFor()] });
      provider.service.listMedia = async () => { throw new Error('VOD list should not run before a first upload'); };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant });
      assert.equal(provider.uploadCount(), 1);
      assert.equal(db.job.status, 'SUCCEEDED');
      assert.equal(db.job.providerJobId, 'vid-1');
      assert.equal(db.episode.byteplusVid, 'vid-1');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('publishes an owned VID and waits for playback without uploading the file twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-playback-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      const media = { ...mediaFor(), publishStatus: 'Unpublished' };
      let playable = false;
      const provider = vod({ known: [media], playable: () => playable });
      let current = instant;
      const config = { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(provider.uploadCount(), 1);
      assert.equal(provider.publishCount(), 1);
      assert.equal(db.job.status, 'PROCESSING');
      assert.equal(db.job.providerJobId, 'vid-1');
      assert.equal(db.episode.byteplusVid, null);
      assert.match(db.job.errorMessage, /等待视频可播放/);
      playable = true;
      current = new Date(instant.getTime() + 60_000);
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(db.job.status, 'SUCCEEDED');
      assert.equal(db.episode.byteplusVid, 'vid-1');
      assert.equal(provider.uploadCount(), 1);
      assert.equal(provider.publishCount(), 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('fails an unplayable VID after the wait limit while retaining its identity and source file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-playback-timeout-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      const provider = vod({ known: [mediaFor()], playable: () => false });
      let current = instant;
      const config = { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(db.job.status, 'PROCESSING');
      current = new Date(instant.getTime() + 31 * 60_000);
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => current });
      assert.equal(db.job.status, 'FAILED');
      assert.equal(db.job.providerJobId, 'vid-1');
      assert.equal(provider.uploadCount(), 1);
      assert.equal((await stat(path)).size, 5);
      assert.match(db.job.errorMessage, /30 分钟内仍不可播放/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('retries a definite upload failure without waiting for VOD discovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-definite-failure-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      let attempts = 0;
      const provider = vod({ known: [mediaFor()], upload: async () => {
        attempts++;
        if (attempts === 1) throw new BytePlusVodError('网络连接失败', true, false);
        return { byteplusVid: 'vid-1' };
      } });
      provider.service.listMedia = async () => { throw new Error('Definite failure should retry the file directly'); };
      const options = { now: () => instant };
      const config = { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, options);
      assert.equal(db.job.status, 'PROCESSING');
      assert.equal(db.job.remoteStartedAt, null);
      assert.match(db.job.errorMessage, /网络连接失败/);
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, options);
      assert.equal(attempts, 2);
      assert.equal(db.job.status, 'SUCCEEDED');
      assert.equal(db.episode.byteplusVid, 'vid-1');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('retries a retained legacy SDK part failure without waiting for VID reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-sdk-part-retry-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path, { status: 'PROCESSING', retryCount: 1,
        remoteStartedAt: new Date(instant.getTime() - 60_000),
        errorMessage: '上传结果待确认：BytePlus 上传视频文件失败：Upload Media Error: Error: upload part error:AxiosError: Request failed with status code 503' });
      const provider = vod({ known: [mediaFor()] });
      provider.service.listMedia = async () => { throw new Error('An uncommitted part failure should not query VOD'); };
      provider.service.uploadLocalVideo = async () => {
        assert.equal(db.job.errorMessage, null, 'A running retry must not display the previous failure');
        assert.equal(db.job.nextAttemptAt, null);
        return { byteplusVid: 'vid-1', coverUrl: undefined, durationMs: undefined };
      };
      const findMany = db.prisma.uploadJob.findMany.bind(db.prisma.uploadJob);
      db.prisma.uploadJob.findMany = (async (args: any) => {
        assert.equal(args.where.id, 'job-1');
        assert.ok(args.where.AND, 'Manual resume must retain the lease and retry eligibility checks');
        return findMany(args);
      }) as typeof db.prisma.uploadJob.findMany;
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service,
        { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant, jobId: 'job-1' });
      assert.equal(db.job.retryCount, 2);
      assert.equal(db.job.status, 'SUCCEEDED');
      assert.equal(db.episode.byteplusVid, 'vid-1');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('recovers a recorded VID even if the previous error mentions a failed part', async () => {
    const db = database(null, { status: 'PROCESSING', providerJobId: 'vid-1',
      remoteStartedAt: new Date(instant.getTime() - 60_000), errorMessage: 'upload part error: status code 503' });
    const provider = vod({ known: [mediaFor()] });
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'SUCCEEDED');
    assert.equal(db.episode.byteplusVid, 'vid-1');
  });

  it('fails a provider parameter rejection and can retry the retained file directly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-invalid-commit-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      let attempts = 0;
      const provider = vod({ known: [mediaFor()], upload: async () => {
        attempts++;
        if (attempts === 1) throw new BytePlusVodError('InvalidParameter.InvalidParamError: invalid Tags', false);
        return { byteplusVid: 'vid-1' };
      } });
      provider.service.listMedia = async () => { throw new Error('Definite rejection must not query VOD on retry'); };
      const config = { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory };
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => instant });
      assert.equal(db.job.status, 'FAILED');
      assert.equal(db.job.remoteStartedAt, null);
      assert.equal(db.job.localFilePath, path);
      assert.match(db.job.errorMessage, /InvalidParameter/);
      db.job.status = 'PENDING';
      db.job.retryCount = 0;
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, config, { now: () => instant });
      assert.equal(attempts, 2);
      assert.equal(db.job.status, 'SUCCEEDED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not bind a VID until VOD exposes the task ownership tags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-visibility-'));
    try {
      const path = join(directory, 'episode.mp4');
      await writeFile(path, 'video');
      const db = database(path);
      const provider = vod();
      await processLocalUploadJobs(db.prisma, db.prisma, provider.service, { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory }, { now: () => instant });
      assert.equal(provider.uploadCount(), 1);
      assert.equal(db.job.status, 'PROCESSING');
      assert.equal(db.job.providerJobId, 'vid-1');
      assert.equal(db.episode.byteplusVid, null);
      assert.match(db.job.errorMessage, /等待媒资可查询/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('uploads at most two episodes concurrently and starts the next when a slot opens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quickreels-parallel-upload-'));
    const releases = new Map<number, () => void>();
    let run: Promise<number> | undefined;
    try {
      const databases = await Promise.all([1, 2, 3].map(async (number) => {
        const path = join(directory, `episode-${number}.mp4`);
        await writeFile(path, 'video');
        const db = database(path, { id: `job-${number}`, episodeId: `episode-${number}`, sourceName: `episode-${number}.mp4` });
        db.episode.id = `episode-${number}`;
        db.episode.episodeNo = number;
        return db;
      }));
      const batch: Record<string, any> = {
        uploadJob: {
          findMany: async () => databases.map((db) => db.job),
          updateMany: async (args: any) => databases.find((db) => db.job.id === args.where.id)!.prisma.uploadJob.updateMany(args)
        },
        episode: {
          updateMany: async (args: any) => databases.find((db) => db.episode.id === args.where.id)!.prisma.episode.updateMany(args)
        },
        sharedMediaAsset: databases[0].prisma.sharedMediaAsset
      };
      batch.$transaction = async (callback: (tx: unknown) => Promise<unknown>) => callback(batch);
      const prisma = batch as PrismaClient;
      let active = 0;
      let peak = 0;
      const started: number[] = [];
      let firstPairStarted!: () => void;
      let thirdStarted!: () => void;
      const firstPair = new Promise<void>((resolve) => { firstPairStarted = resolve; });
      const third = new Promise<void>((resolve) => { thirdStarted = resolve; });
      const service = {
        uploadLocalVideo: async ({ fileName }: { fileName: string }) => {
          const number = Number(fileName.match(/episode-(\d+)/)?.[1]);
          started.push(number);
          peak = Math.max(peak, ++active);
          if (started.length === 2) firstPairStarted();
          if (started.length === 3) thirdStarted();
          await new Promise<void>((resolve) => { releases.set(number, resolve); });
          active--;
          return { byteplusVid: `vid-${number}` };
        },
        getMediaInfos: async ({ vids }: { vids: string[] }) => {
          const number = Number(vids[0].split('-')[1]);
          return [{ ...mediaFor(`job-${number}`), vid: vids[0] }];
        },
        hasPlayableUrl: async () => true
      } as unknown as BytePlusVodService;
      const within = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Parallel upload did not advance')), 2_000);
      })]);
      run = processLocalUploadJobs(prisma, prisma, service, { ...env, LOCAL_UPLOAD_STORAGE_DIR: directory },
        { now: () => instant, concurrency: 2 });
      await within(firstPair);
      assert.deepEqual(started, [1, 2]);
      assert.equal(peak, 2);
      releases.get(1)!();
      await within(third);
      assert.deepEqual(started, [1, 2, 3]);
      assert.equal(peak, 2);
      releases.get(2)!();
      releases.get(3)!();
      assert.equal(await within(run), 3);
      assert.ok(databases.every((db) => db.job.status === 'SUCCEEDED' && db.episode.byteplusVid));
    } finally {
      for (const release of releases.values()) release();
      await run?.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
