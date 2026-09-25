import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TikTokShortDramaService } from '../services/tiktok-short-drama.service';
import { processJobs } from './tiktok-short-drama.worker';

const env = {
  BYTEPLUS_ACCOUNT_ID: 'account',
  BYTEPLUS_SPACE_NAME: 'space'
} as never;

function createWorkerPrisma() {
  const state: any = {
    job: {
      id: 'job-1',
      episodeId: 'episode-1',
      providerJobId: null,
      sourceUrl: 'https://example.com/video.mp4',
      sourceType: 'URL',
      sourceExpiresAt: null,
      status: 'PENDING',
      errorMessage: null,
      retryCount: 0,
      startedAt: null,
      nextAttemptAt: null,
      completedAt: null,
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      episode: { title: 'Episode 1', status: 'DRAFT', coverAsset: null }
    },
    episode: { status: 'DRAFT', byteplusVid: null }
  };
  const prisma: any = {
    uploadJob: {
      findMany: async (args: { where?: { sourceType?: string } } = {}) => args.where?.sourceType === 'URL' && state.job.sourceType !== 'URL'
        ? []
        : state.job.status === 'FAILED' || state.job.status === 'SUCCEEDED' ? [] : [structuredClone(state.job)],
      update: async (args: { data: Record<string, unknown> }) => { Object.assign(state.job, args.data); return state.job; }
    },
    episode: {
      update: async (args: { data: Record<string, unknown> }) => { Object.assign(state.episode, args.data); state.job.episode.status = state.episode.status; return state.episode; }
    },
    $transaction: async (operations: unknown[] | ((tx: typeof prisma) => Promise<unknown>)) => {
      if (typeof operations === 'function') return operations(prisma);
      return Promise.all(operations);
    }
  };
  return { prisma, state };
}

describe('upload worker', () => {
  it('creates a provider job and promotes a completed upload to READY', async () => {
    const { prisma, state } = createWorkerPrisma();
    const service: TikTokShortDramaService = {
      createVideoUpload: async () => ({ providerJobId: 'provider-1' }),
      getVideoUploadStatus: async () => ({ status: 'SUCCEEDED', byteplusVid: 'vid-1', coverUrl: 'https://example.com/cover.jpg', durationMs: 90_000 }),
      getPlayAuthToken: async () => 'unused'
    };
    await processJobs(prisma, service, { maxRetries: 2, now: () => new Date('2026-09-10T00:00:00.000Z') }, env);
    assert.equal(state.job.status, 'PROCESSING');
    assert.equal(state.job.providerJobId, 'provider-1');
    await processJobs(prisma, service, { maxRetries: 2, now: () => new Date('2026-09-10T00:01:00.000Z') }, env);
    assert.equal(state.job.status, 'SUCCEEDED');
    assert.equal(state.episode.status, 'READY');
    assert.equal(state.episode.byteplusVid, 'vid-1');
  });

  it('uses bounded retry backoff and eventually marks permanent failure', async () => {
    const { prisma, state } = createWorkerPrisma();
    const service: TikTokShortDramaService = {
      createVideoUpload: async () => { throw Object.assign(new Error('temporary provider failure'), { retryable: true }); },
      getVideoUploadStatus: async () => ({ status: 'PROCESSING' }),
      getPlayAuthToken: async () => 'unused'
    };
    const now = new Date('2026-09-10T00:00:00.000Z');
    await processJobs(prisma, service, { maxRetries: 1, now: () => now }, env);
    assert.equal(state.job.status, 'PENDING');
    assert.equal(state.job.retryCount, 1);
    assert.equal(new Date(state.job.nextAttemptAt).getTime(), now.getTime() + 30_000);
    state.job.nextAttemptAt = new Date('2026-09-10T00:01:00.000Z');
    await processJobs(prisma, service, { maxRetries: 1, now: () => new Date('2026-09-10T00:01:01.000Z') }, env);
    assert.equal(state.job.status, 'FAILED');
    assert.equal(state.episode.status, 'ERROR');
  });

  it('does not process local FILE upload jobs', async () => {
    const { prisma, state } = createWorkerPrisma();
    state.job.sourceType = 'FILE';
    let providerCalls = 0;
    const service: TikTokShortDramaService = {
      createVideoUpload: async () => { providerCalls++; return { providerJobId: 'unexpected' }; },
      getVideoUploadStatus: async () => { providerCalls++; return { status: 'PROCESSING' }; },
      getPlayAuthToken: async () => 'unused'
    };
    const processed = await processJobs(prisma, service, { maxRetries: 2 }, env);
    assert.equal(processed, 0);
    assert.equal(providerCalls, 0);
  });
});
