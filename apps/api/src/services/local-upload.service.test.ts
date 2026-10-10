import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { assertMediaScope, findUploadMedia, processLocalUploadJobs, uploadScope, uploadTags } from './local-upload.service';
import type { BytePlusMedia, BytePlusVodService } from './byteplus-vod.service';

const env = {
  MINI_APP_KEY: 'storyland', TIKTOK_CLIENT_KEY: 'storyland-client', TIKTOK_CLIENT_SECRET: undefined,
  BYTEPLUS_ACCOUNT_ID: 'account', BYTEPLUS_SPACE_NAME: 'space', BYTEPLUS_REGION: 'region',
  COVER_ASSET_STORAGE_DIR: join(tmpdir(), 'quickreels-cover'), UPLOAD_MAX_RETRIES: 3
} as Env;
const instant = new Date('2026-10-10T08:00:00.000Z');

function mediaFor(jobId = 'job-1', owner = env): BytePlusMedia {
  return { vid: 'vid-1', title: 'Episode 1', spaceName: 'space', tags: uploadTags(uploadScope(owner), jobId) };
}

function vod(input: { items?: BytePlusMedia[]; known?: BytePlusMedia[]; upload?: () => Promise<{ byteplusVid: string }> } = {}) {
  let uploads = 0;
  const service = {
    listMedia: async ({ tags }: { tags: string }) => {
      assert.equal(tags, uploadTags(uploadScope(env), 'job-1')[1]);
      return { items: input.items ?? [], total: input.items?.length ?? 0 };
    },
    getMediaInfos: async () => input.known ?? [],
    uploadLocalVideo: async () => { uploads++; return input.upload ? input.upload() : { byteplusVid: 'vid-1' }; }
  } as unknown as BytePlusVodService;
  return { service, uploadCount: () => uploads };
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

describe('local upload recovery', () => {
  it('binds only the exact task and scope match after a lost upload response', async () => {
    const foreign = { ...env, MINI_APP_KEY: 'taletv', TIKTOK_CLIENT_KEY: 'other-client' } as Env;
    const { service } = vod({ items: [mediaFor('job-1', foreign), mediaFor('other-job'), mediaFor()] });
    assert.equal((await findUploadMedia(service, env, { id: 'job-1', uploadScope: uploadScope(env), providerJobId: null }))?.vid, 'vid-1');
    await assert.rejects(() => findUploadMedia(vod({ items: [mediaFor(), { ...mediaFor(), vid: 'vid-2' }] }).service,
      env, { id: 'job-1', uploadScope: uploadScope(env), providerJobId: null }), /多个 VID/);
    await assert.rejects(() => assertMediaScope(database(null).prisma, env, mediaFor('job-1', foreign)), /其他小程序/);
    await assert.rejects(() => assertMediaScope(database(null).prisma, env, { vid: 'untagged', title: 'Episode 1' }), /缺少可验证/);
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

  it('releases a legacy task whose temporary file was lost', async () => {
    const db = database(null, { status: 'PROCESSING', uploadScope: null, startedAt: new Date(instant.getTime() - 60 * 60_000) });
    const provider = vod();
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'FAILED');
    assert.equal(db.episode.byteplusUploadStatus, 'FAILED');
  });

  it('does not upload while VOD lookup is unavailable', async () => {
    const db = database(null);
    const provider = vod();
    provider.service.listMedia = async () => { throw new Error('network down'); };
    await processLocalUploadJobs(db.prisma, db.prisma, provider.service, env, { now: () => instant });
    assert.equal(provider.uploadCount(), 0);
    assert.equal(db.job.status, 'PROCESSING');
    assert.equal(db.job.retryCount, 0);
    assert.match(db.job.errorMessage, /VOD 查询暂不可用/);
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
});
