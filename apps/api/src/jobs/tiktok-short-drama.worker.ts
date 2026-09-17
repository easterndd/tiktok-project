import { PrismaClient, type UploadJob } from '@prisma/client';
import { loadEnv } from '../config/env';
import {
  ProviderNotConfiguredError,
  UnconfiguredTikTokShortDramaService,
  type TikTokShortDramaService,
  type UploadStatusResult
} from '../services/tiktok-short-drama.service';
import { BytePlusVodService } from '../services/byteplus-vod.service';

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
      data: { status: 'ERROR' }
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
          data: { status: 'UPLOADING' }
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
        byteplusVid: result.byteplusVid,
        byteplusCoverUrl: result.coverUrl,
        coverUrl: job.episode.coverAsset?.status === 'READY' ? job.episode.coverAsset.publicUrl : result.coverUrl,
        durationMs: result.durationMs
      }
    })
  ]);
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
  const env = loadEnv();
  const prisma = new PrismaClient();
  const service = env.BYTEPLUS_ACCESS_KEY && env.BYTEPLUS_SECRET_KEY
    ? new BytePlusVodService(env)
    : new UnconfiguredTikTokShortDramaService();
  const run = () => processJobs(prisma, service, {
    maxRetries: env.UPLOAD_MAX_RETRIES,
    log: (message, details) => console.info(message, details)
  }, env).catch((error) => console.error('Upload worker cycle failed.', error));

  await run();
  const timer = setInterval(run, env.UPLOAD_WORKER_INTERVAL_MS || defaultIntervalMs);
  const shutdown = async () => {
    clearInterval(timer);
    await prisma.$disconnect();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (/tiktok-short-drama\.worker\.(?:ts|js)$/.test(process.argv[1] ?? '')) {
  void startUploadWorker();
}
