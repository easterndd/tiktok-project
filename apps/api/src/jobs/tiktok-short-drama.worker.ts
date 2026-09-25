import { PrismaClient, type UploadJob } from '@prisma/client';
import { loadEnv } from '../config/env';
import { configuredMiniAppKeys, miniAppEnvironment } from '../config/mini-apps';
import {
  ProviderNotConfiguredError,
  UnconfiguredTikTokShortDramaService,
  type TikTokShortDramaService,
  type UploadStatusResult
} from '../services/tiktok-short-drama.service';
import { BytePlusVodService } from '../services/byteplus-vod.service';
import { TikTokShortDramaApiService } from '../services/tiktok-short-drama-api.service';
import { enqueueVideoSync, processPlatformSyncJobs } from '../services/platform-sync.service';
import { processSharedPlatformOperations } from '../services/shared-platform.service';

const defaultIntervalMs = 30_000;
const defaultMaxRetries = 5;

type WorkerOptions = {
  maxRetries?: number;
  now?: () => Date;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type JobWithEpisode = UploadJob & {
  episode: {
    title: string;
    status: string;
    coverAsset: { publicUrl: string; status: string } | null;
  };
};

function retryDelayMs(retryCount: number) {
  return Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, retryCount - 1)));
}

function safeErrorMessage(error: unknown) {
  if (error instanceof ProviderNotConfiguredError) return error.message;
  if (error instanceof Error && error.message.length <= 240) return error.message;
  return 'Provider request failed.';
}

function isRetryable(error: unknown) {
  return error instanceof ProviderNotConfiguredError || Boolean((error as { retryable?: boolean }).retryable);
}

async function markFailure(
  prisma: PrismaClient,
  job: UploadJob,
  message: string,
  retryable: boolean,
  options: Required<Pick<WorkerOptions, 'maxRetries' | 'now'>> & Pick<WorkerOptions, 'log'>
) {
  const retryCount = job.retryCount + 1;
  const shouldRetry = retryable && retryCount <= options.maxRetries;
  if (shouldRetry) {
    const nextAttemptAt = new Date(options.now().getTime() + retryDelayMs(retryCount));
    await prisma.uploadJob.update({
      where: { id: job.id },
      data: {
        status: job.providerJobId ? 'PROCESSING' : 'PENDING',
        retryCount,
        errorMessage: message,
        nextAttemptAt
      }
    });
    options.log?.('Upload job scheduled for retry.', {
      jobId: job.id,
      retryCount,
      nextAttemptAt: nextAttemptAt.toISOString()
    });
    return;
  }

  await prisma.$transaction([
    prisma.uploadJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        retryCount,
        errorMessage: message,
        nextAttemptAt: null,
        completedAt: options.now()
      }
    }),
    prisma.episode.update({
      where: { id: job.episodeId },
        data: { status: 'ERROR', byteplusUploadStatus: 'FAILED' }
    })
  ]);
  options.log?.('Upload job permanently failed.', { jobId: job.id, retryCount });
}

async function processJob(
  prisma: PrismaClient,
  job: JobWithEpisode,
  service: TikTokShortDramaService,
  env: ReturnType<typeof loadEnv>,
  options: Required<Pick<WorkerOptions, 'maxRetries' | 'now'>> & Pick<WorkerOptions, 'log'>
) {
  if (job.status === 'PENDING') {
    if (job.sourceExpiresAt && job.sourceExpiresAt <= options.now()) {
      await markFailure(prisma, job, 'Upload source URL has expired.', false, options);
      return;
    }
    try {
      const result = await service.createVideoUpload({
        sourceUrl: job.sourceUrl,
        title: job.episode.title,
        spaceName: env.BYTEPLUS_SPACE_NAME,
        byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID
      });
      await prisma.$transaction([
        prisma.uploadJob.update({
          where: { id: job.id },
          data: {
            providerJobId: result.providerJobId,
            status: 'PROCESSING',
            startedAt: options.now(),
            nextAttemptAt: null,
            errorMessage: null
          }
        }),
        prisma.episode.update({
          where: { id: job.episodeId },
          data: { status: 'UPLOADING', byteplusUploadStatus: 'UPLOADING' }
        })
      ]);
    } catch (error) {
      await markFailure(prisma, job, safeErrorMessage(error), isRetryable(error), options);
    }
    return;
  }

  if (!job.providerJobId) {
    await markFailure(prisma, job, 'Provider job id is missing.', false, options);
    return;
  }

  let result: UploadStatusResult;
  try {
    result = await service.getVideoUploadStatus({
      providerJobId: job.providerJobId,
      byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID
    });
  } catch (error) {
    await markFailure(prisma, job, safeErrorMessage(error), isRetryable(error), options);
    return;
  }

  if (result.status === 'PROCESSING') {
    await prisma.uploadJob.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        startedAt: job.startedAt ?? options.now(),
        nextAttemptAt: new Date(options.now().getTime() + 30_000),
        errorMessage: null
      }
    });
    return;
  }

  if (result.status === 'FAILED') {
    await markFailure(prisma, job, result.errorMessage ?? 'Provider rejected the upload.', result.retryable ?? false, options);
    return;
  }

  if (!result.byteplusVid) {
    await markFailure(prisma, job, 'Provider completed without a video id.', false, options);
    return;
  }

  await prisma.$transaction([
    prisma.uploadJob.update({
      where: { id: job.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: options.now(),
        nextAttemptAt: null,
        errorMessage: null
      }
    }),
    prisma.episode.update({
      where: { id: job.episodeId },
      data: {
        status: 'READY',
        byteplusUploadStatus: 'READY',
        byteplusVid: result.byteplusVid,
        byteplusCoverUrl: result.coverUrl,
        coverUrl: job.episode.coverAsset?.status === 'READY' ? job.episode.coverAsset.publicUrl : result.coverUrl,
        durationMs: result.durationMs
      }
    })
  ]);
  if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) {
    await enqueueVideoSync(prisma as any, job.episodeId).catch((error) => {
      options.log?.('Could not enqueue TikTok video registration.', { jobId: job.id, error: safeErrorMessage(error) });
    });
  }
  options.log?.('Upload job completed.', { jobId: job.id, episodeId: job.episodeId });
}

export async function processJobs(
  prisma: PrismaClient,
  service: TikTokShortDramaService,
  workerOptions: WorkerOptions = {},
  env = loadEnv()
) {
  const now = workerOptions.now ?? (() => new Date());
  const maxRetries = workerOptions.maxRetries ?? defaultMaxRetries;
  const currentTime = now();
  const jobs = await prisma.uploadJob.findMany({
    where: {
      sourceType: 'URL',
      status: { in: ['PENDING', 'PROCESSING'] },
      retryCount: { lte: maxRetries },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: currentTime } }]
    },
    take: 20,
    orderBy: { createdAt: 'asc' },
    include: { episode: { select: { title: true, status: true, coverAsset: { select: { publicUrl: true, status: true } } } } }
  });
  for (const job of jobs) {
    await processJob(prisma, job, service, env, { maxRetries, now, log: workerOptions.log });
  }
  return jobs.length;
}

export async function startUploadWorker() {
  const env = { ...loadEnv(), MINI_APP_KEY: 'main' as const };
  const environments = configuredMiniAppKeys(env).map((key) => miniAppEnvironment(env, key)).filter((item): item is typeof env => item !== null);
  const contexts = environments.map((contextEnv) => ({
    env: contextEnv,
    prisma: new PrismaClient({ datasources: { db: { url: contextEnv.DATABASE_URL } } }),
    service: contextEnv.BYTEPLUS_ACCESS_KEY && contextEnv.BYTEPLUS_SECRET_KEY
      ? new BytePlusVodService(contextEnv)
      : new UnconfiguredTikTokShortDramaService(),
    platformApi: new TikTokShortDramaApiService(contextEnv)
  }));
  const sharedDatabaseUrl = env.SHARED_PLATFORM_DATABASE_URL ?? env.DATABASE_URL;
  const sharedPrisma = sharedDatabaseUrl === env.DATABASE_URL
    ? contexts.find((context) => context.env.MINI_APP_KEY === 'main')?.prisma
    : new PrismaClient({ datasources: { db: { url: sharedDatabaseUrl } } });
  if (!sharedPrisma) throw new Error('Main Prisma context is required for shared platform operations.');
  const run = async () => {
    for (const context of contexts) {
      try {
        await processJobs(context.prisma, context.service, {
          maxRetries: context.env.UPLOAD_MAX_RETRIES,
          log: (message, details) => console.info(context.env.MINI_APP_KEY, message, details)
        }, context.env);
        if (context.platformApi.isConfigured()) {
          await processPlatformSyncJobs(context.prisma as any, context.platformApi, {
            maxRetries: context.env.UPLOAD_MAX_RETRIES,
            log: (message, details) => console.info(context.env.MINI_APP_KEY, message, details)
          });
        }
      } catch (error) {
        console.error(`${context.env.MINI_APP_KEY} worker cycle failed.`, error);
      }
    }
    const apiByApp = Object.fromEntries(contexts.map((context) => [context.env.MINI_APP_KEY, context.platformApi]));
    const localPrismaByApp = Object.fromEntries(contexts.map((context) => [context.env.MINI_APP_KEY, context.prisma]));
    await processSharedPlatformOperations(sharedPrisma as any, {
      maxRetries: env.UPLOAD_MAX_RETRIES,
      localPrismaByApp,
      apiByApp,
      log: (message, details) => console.info('shared-platform', message, details)
    });
  };

  await run().catch((error) => console.error('Upload worker cycle failed.', error));
  const timer = setInterval(() => void run().catch((error) => console.error('Upload worker cycle failed.', error)), env.UPLOAD_WORKER_INTERVAL_MS || defaultIntervalMs);
  const shutdown = async () => {
    clearInterval(timer);
    await Promise.all([
      ...contexts.map((context) => context.prisma.$disconnect()),
      ...(sharedPrisma !== contexts.find((context) => context.env.MINI_APP_KEY === 'main')?.prisma ? [sharedPrisma.$disconnect()] : [])
    ]);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (/tiktok-short-drama\.worker\.(?:ts|js)$/.test(process.argv[1] ?? '')) {
  void startUploadWorker();
}
