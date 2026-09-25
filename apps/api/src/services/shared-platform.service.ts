import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type SharedMediaStatus } from '@prisma/client';
import { miniAppEnvironment, miniAppPlatformConfig, type MiniAppKey } from '../config/mini-apps';
import type { Env } from '../config/env';
import { TikTokShortDramaApiService } from './tiktok-short-drama-api.service';

type Db = PrismaClient & { [key: string]: any };

type SharedWorkerOptions = {
  now?: () => Date;
  maxRetries?: number;
  log?: (message: string, details?: Record<string, unknown>) => void;
  localPrismaByApp: Record<string, Db>;
  apiByApp: Record<string, TikTokShortDramaApiService>;
};

const staleProcessingMs = 10 * 60_000;
const defaultMaxRetries = 5;

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function hash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function retryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

function reviewPassed(status: unknown) {
  return status === 2 || status === '2' || status === 'PASSED' || status === 'APPROVED';
}

function published(status: unknown) {
  return status === 1 || status === '1' || status === 'LISTED' || status === 'PUBLISHED';
}

function platformStatus(value: unknown) {
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireMiniAppKey(value: string): MiniAppKey {
  if (value === 'main' || value === 'taletv' || value === 'cinereels' || value === 'talereels') return value;
  throw conflict(`未知的小程序标识：${value}`);
}

export function sharedApiForEnv(env: Env, miniAppKey: string) {
  const key = requireMiniAppKey(miniAppKey);
  const contextEnv = miniAppEnvironment(env, key);
  if (!contextEnv) throw conflict(`小程序 ${key} 未配置数据库或 TikTok 环境。`);
  return new TikTokShortDramaApiService(contextEnv);
}

export function sharedMiniAppConfig(env: Env, miniAppKey: string) {
  return miniAppPlatformConfig(env, requireMiniAppKey(miniAppKey));
}

export async function listSharedMediaAssets(sharedPrisma: Db, input: { status?: SharedMediaStatus; byteplusVid?: string; sourceSha256?: string; limit?: number }) {
  const items = await sharedPrisma.sharedMediaAsset.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.byteplusVid ? { byteplusVid: input.byteplusVid } : {}),
      ...(input.sourceSha256 ? { sourceSha256: input.sourceSha256 } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 100,
    include: { _count: { select: { episodes: true } } }
  });
  return items.map((item: any) => ({ ...item, boundEpisodeCount: item._count?.episodes ?? 0, _count: undefined }));
}

export async function getOrCreateSharedMediaAsset(
  sharedPrisma: Db,
  input: {
    byteplusVid: string;
    byteplusAccountId: string;
    byteplusSpaceName: string;
    byteplusRegion: string;
    miniAppKey: string;
    title?: string;
    coverUrl?: string;
    durationMs?: number;
    sourceSha256?: string;
    sourceFileName?: string;
    firstUploadJobId?: string;
  }
) {
  const existing = await sharedPrisma.sharedMediaAsset.findUnique({ where: { byteplusVid: input.byteplusVid } });
  if (existing) {
    if (existing.byteplusAccountId !== input.byteplusAccountId || existing.byteplusSpaceName !== input.byteplusSpaceName || existing.byteplusRegion !== input.byteplusRegion) {
      throw conflict('BytePlus VID 已存在，但所属账号、空间或地区与当前共享配置不一致。');
    }
    return existing;
  }
  return sharedPrisma.sharedMediaAsset.create({
    data: {
      byteplusVid: input.byteplusVid,
      byteplusAccountId: input.byteplusAccountId,
      byteplusSpaceName: input.byteplusSpaceName,
      byteplusRegion: input.byteplusRegion,
      firstUploadedByApp: input.miniAppKey,
      status: 'READY',
      title: input.title,
      coverUrl: input.coverUrl,
      durationMs: input.durationMs,
      sourceSha256: input.sourceSha256,
      sourceFileName: input.sourceFileName,
      firstUploadJobId: input.firstUploadJobId,
      lastVerifiedAt: new Date()
    }
  });
}

export async function bindEpisodeToSharedMedia(sharedPrisma: Db, localPrisma: Db, env: Env, miniAppKey: string, episodeId: string, sharedMediaAssetId: string) {
  const media = await sharedPrisma.sharedMediaAsset.findUnique({ where: { id: sharedMediaAssetId } });
  if (!media) throw Object.assign(new Error('共享媒资不存在。'), { statusCode: 404 });
  if (media.status !== 'READY') throw conflict('共享媒资尚未就绪，不能绑定。');
  if (media.byteplusAccountId !== env.BYTEPLUS_ACCOUNT_ID || media.byteplusSpaceName !== env.BYTEPLUS_SPACE_NAME || media.byteplusRegion !== env.BYTEPLUS_REGION) {
    throw conflict('共享媒资不属于当前 BytePlus 账号、空间或地区。');
  }
  const episode = await localPrisma.episode.findUnique({ where: { id: episodeId }, select: { id: true, title: true, coverUrl: true, durationMs: true, coverAsset: { select: { publicUrl: true, status: true } } } });
  if (!episode) throw Object.assign(new Error('分集不存在。'), { statusCode: 404 });
  const updated = await localPrisma.episode.update({
    where: { id: episodeId },
    data: {
      byteplusVid: media.byteplusVid,
      byteplusCoverUrl: media.coverUrl,
      coverUrl: episode.coverAsset?.status === 'READY' ? episode.coverAsset.publicUrl : media.coverUrl ?? episode.coverUrl,
      durationMs: media.durationMs ?? episode.durationMs,
      status: 'READY',
      byteplusUploadStatus: 'READY',
      tiktokVideoStatus: 'NOT_STARTED',
      tiktokVideoJobId: null,
      tiktokVideoError: null
    }
  });
  return { episode: updated, media };
}

export async function createSharedAlbumFromLocal(sharedPrisma: Db, localPrisma: Db, env: Env, ownerMiniAppKey: string, localAlbumId: string) {
  const owner = requireMiniAppKey(ownerMiniAppKey);
  const ownerConfig = sharedMiniAppConfig(env, owner);
  if (!ownerConfig.clientKey) throw conflict(`小程序 ${owner} 未配置 TikTok Client Key。`);
  const album = await localPrisma.album.findUnique({
    where: { id: localAlbumId },
    include: { episodes: { orderBy: { episodeNo: 'asc' } } }
  });
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });
  if (!album.tiktokAlbumId) throw conflict('剧目尚未同步至 TikTok，不能创建共享主剧目。');
  if (!album.tiktokVersion) throw conflict('剧目尚无 TikTok 版本，不能创建共享主剧目。');
  if (!album.episodes.length || album.episodes.some((episode: any) => !episode.tiktokEpisodeId || !episode.byteplusVid)) {
    throw conflict('剧目分集缺少 TikTok 分集 ID 或 BytePlus VID，不能创建共享主剧目。');
  }

  const mediaRows = new Map<string, any>();
  for (const episode of album.episodes) {
    const media = await getOrCreateSharedMediaAsset(sharedPrisma, {
      byteplusVid: episode.byteplusVid!,
      byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID,
      byteplusSpaceName: env.BYTEPLUS_SPACE_NAME,
      byteplusRegion: env.BYTEPLUS_REGION,
      miniAppKey: owner,
      title: episode.title,
      coverUrl: episode.byteplusCoverUrl ?? episode.coverUrl ?? undefined,
      durationMs: episode.durationMs ?? undefined
    });
    mediaRows.set(episode.id, media);
  }

  const sharedAlbum = await sharedPrisma.sharedTikTokAlbum.upsert({
    where: { tiktokAlbumId: album.tiktokAlbumId },
    create: {
      canonicalKey: `${owner}:${album.id}`,
      ownerMiniAppKey: owner,
      ownerClientKey: ownerConfig.clientKey,
      tiktokAlbumId: album.tiktokAlbumId,
      currentVersion: album.tiktokVersion,
      onlineVersion: album.onlineVersion,
      reviewStatus: album.reviewStatus,
      publishStatus: album.publishStatus,
      platformPublishedAt: album.platformPublishedAt
    },
    update: {
      ownerMiniAppKey: owner,
      ownerClientKey: ownerConfig.clientKey,
      currentVersion: album.tiktokVersion,
      onlineVersion: album.onlineVersion,
      reviewStatus: album.reviewStatus,
      publishStatus: album.publishStatus,
      platformPublishedAt: album.platformPublishedAt
    }
  });

  for (const episode of album.episodes) {
    await sharedPrisma.sharedTikTokEpisode.upsert({
      where: { sharedAlbumId_episodeNo: { sharedAlbumId: sharedAlbum.id, episodeNo: episode.episodeNo } },
      create: {
        sharedAlbumId: sharedAlbum.id,
        episodeKey: episode.id,
        episodeNo: episode.episodeNo,
        tiktokEpisodeId: episode.tiktokEpisodeId!,
        tiktokCoverPicId: episode.tiktokCoverPicId,
        sharedMediaId: mediaRows.get(episode.id).id,
        title: episode.title
      },
      update: {
        episodeKey: episode.id,
        tiktokEpisodeId: episode.tiktokEpisodeId!,
        tiktokCoverPicId: episode.tiktokCoverPicId,
        sharedMediaId: mediaRows.get(episode.id).id,
        title: episode.title
      }
    });
  }

  await sharedPrisma.miniAppAlbumAuthorization.upsert({
    where: { sharedAlbumId_miniAppKey: { sharedAlbumId: sharedAlbum.id, miniAppKey: owner } },
    create: {
      sharedAlbumId: sharedAlbum.id,
      miniAppKey: owner,
      targetClientKey: ownerConfig.clientKey,
      targetAppId: ownerConfig.appId,
      targetLocalAlbumId: localAlbumId,
      status: 'AUTHORIZED',
      authorizedAt: new Date(),
      lastReconciledAt: new Date()
    },
    update: {
      targetClientKey: ownerConfig.clientKey,
      targetAppId: ownerConfig.appId,
      targetLocalAlbumId: localAlbumId,
      status: 'AUTHORIZED',
      authorizedAt: new Date(),
      lastReconciledAt: new Date()
    }
  });

  return sharedPrisma.sharedTikTokAlbum.findUniqueOrThrow({
    where: { id: sharedAlbum.id },
    include: { episodes: { orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
}

export async function enqueueSharedAlbumAuthorization(
  sharedPrisma: Db,
  env: Env,
  sharedAlbumId: string,
  targetMiniAppKey: string,
  targetLocalAlbumId: string | undefined,
  createdByAdminUserId?: string
) {
  const target = requireMiniAppKey(targetMiniAppKey);
  const targetConfig = sharedMiniAppConfig(env, target);
  if (!targetConfig.clientKey) throw conflict(`小程序 ${target} 未配置 TikTok Client Key。`);
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({ where: { id: sharedAlbumId } });
  if (!album) throw Object.assign(new Error('共享主剧目不存在。'), { statusCode: 404 });
  if (album.ownerMiniAppKey === target) throw conflict('主小程序已经拥有该剧目，无需再次授权。');

  const authorization = await sharedPrisma.miniAppAlbumAuthorization.upsert({
    where: { sharedAlbumId_miniAppKey: { sharedAlbumId, miniAppKey: target } },
    create: {
      sharedAlbumId,
      miniAppKey: target,
      targetClientKey: targetConfig.clientKey,
      targetAppId: targetConfig.appId,
      targetLocalAlbumId,
      status: 'PENDING'
    },
    update: {
      targetClientKey: targetConfig.clientKey,
      targetAppId: targetConfig.appId,
      ...(targetLocalAlbumId ? { targetLocalAlbumId } : {})
    }
  });

  const active = await sharedPrisma.sharedPlatformOperation.findFirst({
    where: { kind: 'AUTHORIZE_ALBUM', sharedAlbumId, targetMiniAppKey: target, status: { in: ['PENDING', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' }
  });
  if (active) return { authorization, operation: active };
  if (authorization.status === 'AUTHORIZED') return { authorization, operation: null };

  const snapshot = { sharedAlbumId, targetMiniAppKey: target, targetClientKey: targetConfig.clientKey, targetLocalAlbumId: targetLocalAlbumId ?? authorization.targetLocalAlbumId ?? null };
  const dedupeKey = `AUTHORIZE_ALBUM:${sharedAlbumId}:${target}`;
  const operation = await sharedPrisma.sharedPlatformOperation.upsert({
    where: { dedupeKey },
    create: {
      kind: 'AUTHORIZE_ALBUM',
      status: 'PENDING',
      sharedAlbumId,
      targetMiniAppKey: target,
      dedupeKey,
      snapshotHash: hash(snapshot),
      snapshotJson: snapshot,
      nextAttemptAt: new Date()
    },
    update: {
      status: 'PENDING',
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: new Date(),
      snapshotHash: hash(snapshot),
      snapshotJson: snapshot
    }
  });
  await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { status: 'PENDING', errorCode: null, errorMessage: null } });
  return { authorization, operation };
}

export async function enqueueSharedAlbumReconcile(sharedPrisma: Db, sharedAlbumId: string, createdByAdminUserId?: string) {
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({ where: { id: sharedAlbumId } });
  if (!album) throw Object.assign(new Error('共享主剧目不存在。'), { statusCode: 404 });
  const dedupeKey = `RECONCILE_ALBUM:${sharedAlbumId}:${Date.now()}`;
  return sharedPrisma.sharedPlatformOperation.create({
    data: {
      kind: 'RECONCILE_ALBUM',
      status: 'PENDING',
      sharedAlbumId,
      dedupeKey,
      snapshotJson: { sharedAlbumId, ownerMiniAppKey: album.ownerMiniAppKey }
    }
  });
}

async function projectSharedAlbumToLocal(sharedAlbum: any, authorization: any, localPrisma: Db) {
  if (!authorization.targetLocalAlbumId) return;
  const playable = Boolean(sharedAlbum.onlineVersion && reviewPassed(sharedAlbum.reviewStatus) && published(sharedAlbum.publishStatus));
  const localAlbum = await localPrisma.album.findUnique({ where: { id: authorization.targetLocalAlbumId }, select: { id: true } });
  if (!localAlbum) throw conflict(`目标小程序剧目不存在：${authorization.targetLocalAlbumId}`);
  await localPrisma.album.update({
    where: { id: authorization.targetLocalAlbumId },
    data: {
      tiktokAlbumId: sharedAlbum.tiktokAlbumId,
      tiktokVersion: sharedAlbum.currentVersion,
      onlineVersion: sharedAlbum.onlineVersion,
      reviewStatus: sharedAlbum.reviewStatus,
      publishStatus: sharedAlbum.publishStatus,
      platformPublishedVersion: playable ? sharedAlbum.onlineVersion : null,
      platformPublishedAt: playable ? sharedAlbum.platformPublishedAt ?? new Date() : null,
      status: playable ? 'ONLINE' : 'OFFLINE'
    }
  });
  const localEpisodes = await localPrisma.episode.findMany({ where: { albumId: authorization.targetLocalAlbumId }, orderBy: { episodeNo: 'asc' } });
  const sharedEpisodes = [...sharedAlbum.episodes].sort((left: any, right: any) => left.episodeNo - right.episodeNo);
  for (const sharedEpisode of sharedEpisodes) {
    const localEpisode = localEpisodes.find((item: any) => item.episodeNo === sharedEpisode.episodeNo);
    if (!localEpisode) continue;
    await localPrisma.episode.update({
      where: { id: localEpisode.id },
      data: {
        byteplusVid: sharedEpisode.media.byteplusVid,
        tiktokEpisodeId: sharedEpisode.tiktokEpisodeId,
        tiktokCoverPicId: sharedEpisode.tiktokCoverPicId,
        tiktokVideoStatus: 'READY',
        tiktokVideoError: null,
        byteplusUploadStatus: 'READY',
        status: playable ? 'ONLINE' : 'READY'
      }
    });
  }
}

async function completeSharedOperation(sharedPrisma: Db, operation: any, data: Record<string, unknown>, now: Date) {
  await sharedPrisma.sharedPlatformOperation.update({
    where: { id: operation.id },
    data: { status: 'SUCCEEDED', completedAt: now, nextAttemptAt: null, errorCode: null, errorMessage: null, ...data }
  });
}

async function failSharedOperation(sharedPrisma: Db, operation: any, error: unknown, now: Date, maxRetries: number) {
  const retryable = Boolean((error as { retryable?: boolean }).retryable);
  const attemptCount = operation.attemptCount + 1;
  const retry = retryable && attemptCount <= maxRetries;
  await sharedPrisma.sharedPlatformOperation.update({
    where: { id: operation.id },
    data: {
      status: retry ? 'PENDING' : 'FAILED',
      attemptCount,
      nextAttemptAt: retry ? new Date(now.getTime() + retryDelayMs(attemptCount)) : null,
      completedAt: retry ? null : now,
      errorCode: typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null,
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : '共享平台任务失败。'
    }
  });
}

async function processSharedAuthorization(sharedPrisma: Db, operation: any, options: SharedWorkerOptions, now: Date) {
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({
    where: { id: operation.sharedAlbumId },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  if (!album) throw new Error('共享主剧目不存在。');
  const target = requireMiniAppKey(operation.targetMiniAppKey);
  const authorization = album.authorizations.find((item: any) => item.miniAppKey === target);
  if (!authorization) throw new Error('共享主剧目授权记录不存在。');
  if (authorization.status === 'AUTHORIZED') {
    await completeSharedOperation(sharedPrisma, operation, { providerResponse: { alreadyAuthorized: true } }, now);
    return;
  }
  const ownerApi = options.apiByApp[album.ownerMiniAppKey];
  if (!ownerApi) throw new Error(`主小程序 ${album.ownerMiniAppKey} 的 TikTok API 未配置。`);
  await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { status: 'AUTHORIZING', errorCode: null, errorMessage: null } });
  const result = await ownerApi.authorizeAlbum({ albumId: album.tiktokAlbumId, targetClientKeys: [authorization.targetClientKey], operateType: 1 });
  const targetResult = result.results.find((item) => item.clientKey === authorization.targetClientKey) ?? result.results[0];
  const authorized = targetResult?.authStatus === 1 && (!targetResult.errorCode || targetResult.errorCode === '0');
  if (!authorized) {
    await sharedPrisma.miniAppAlbumAuthorization.update({
      where: { id: authorization.id },
      data: {
        status: 'FAILED',
        providerRequestId: result.requestId,
        providerResponse: result.raw as Prisma.InputJsonValue,
        errorCode: targetResult?.errorCode ?? 'AUTHORIZATION_FAILED',
        errorMessage: targetResult?.errorMessage ?? 'TikTok 未授权目标小程序。'
      }
    });
    await completeSharedOperation(sharedPrisma, operation, { providerRequestId: result.requestId, providerResponse: result.raw }, now);
    return;
  }
  const localPrisma = options.localPrismaByApp[target];
  await (sharedPrisma.$transaction as any)(async (tx: Db) => {
    await tx.miniAppAlbumAuthorization.update({
      where: { id: authorization.id },
      data: {
        status: 'AUTHORIZED',
        providerRequestId: result.requestId,
        providerResponse: result.raw as Prisma.InputJsonValue,
        errorCode: null,
        errorMessage: null,
        authorizedAt: now,
        lastReconciledAt: now
      }
    });
    await completeSharedOperation(tx, operation, { providerRequestId: result.requestId, providerResponse: result.raw }, now);
  });
  if (localPrisma) await projectSharedAlbumToLocal(album, { ...authorization, status: 'AUTHORIZED' }, localPrisma);
}

async function processSharedReconcile(sharedPrisma: Db, operation: any, options: SharedWorkerOptions, now: Date) {
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({
    where: { id: operation.sharedAlbumId },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  if (!album) throw new Error('共享主剧目不存在。');
  const ownerApi = options.apiByApp[album.ownerMiniAppKey];
  if (!ownerApi) throw new Error(`主小程序 ${album.ownerMiniAppKey} 的 TikTok API 未配置。`);
  const queried = await ownerApi.queryAlbum({ albumId: album.tiktokAlbumId });
  const state = queried.data;
  const updated = await sharedPrisma.sharedTikTokAlbum.update({
    where: { id: album.id },
    data: {
      currentVersion: asNumber(state.current_version) ?? album.currentVersion,
      onlineVersion: asNumber(state.online_version) ?? album.onlineVersion,
      reviewStatus: platformStatus(state.review_status),
      publishStatus: platformStatus(state.publish_status),
      platformPublishedAt: published(state.publish_status) ? now : null
    },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  for (const authorization of updated.authorizations) {
    if (authorization.status !== 'AUTHORIZED') continue;
    const localPrisma = options.localPrismaByApp[authorization.miniAppKey];
    if (localPrisma) await projectSharedAlbumToLocal(updated, authorization, localPrisma);
    await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { lastReconciledAt: now } });
  }
  await completeSharedOperation(sharedPrisma, operation, { providerRequestId: queried.requestId, providerResponse: state }, now);
}

export async function processSharedPlatformOperations(sharedPrisma: Db, options: SharedWorkerOptions) {
  const now = options.now ?? (() => new Date());
  const current = now();
  const maxRetries = options.maxRetries ?? defaultMaxRetries;
  const jobs = await sharedPrisma.sharedPlatformOperation.findMany({
    where: {
      OR: [
        { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: current } }] },
        { status: 'PROCESSING', startedAt: { lte: new Date(current.getTime() - staleProcessingMs) } }
      ]
    },
    orderBy: { createdAt: 'asc' },
    take: 20
  });
  for (const pending of jobs) {
    const claim = await sharedPrisma.sharedPlatformOperation.updateMany({
      where: pending.status === 'PENDING'
        ? { id: pending.id, status: 'PENDING' }
        : { id: pending.id, status: 'PROCESSING', startedAt: { lte: new Date(current.getTime() - staleProcessingMs) } },
      data: { status: 'PROCESSING', startedAt: current }
    });
    if (!claim.count) continue;
    if (pending.status === 'PROCESSING') {
      await sharedPrisma.sharedPlatformOperation.update({ where: { id: pending.id }, data: { status: 'CONFLICT', completedAt: current, nextAttemptAt: null, errorMessage: '共享平台操作中断，结果未知；请先对账。' } });
      continue;
    }
    const job = { ...pending, status: 'PROCESSING' };
    try {
      if (job.kind === 'AUTHORIZE_ALBUM') await processSharedAuthorization(sharedPrisma, job, options, current);
      else if (job.kind === 'RECONCILE_ALBUM') await processSharedReconcile(sharedPrisma, job, options, current);
      else throw new Error(`暂不支持的共享平台任务：${job.kind}`);
      options.log?.('Shared platform operation completed.', { jobId: job.id, kind: job.kind });
    } catch (error) {
      await failSharedOperation(sharedPrisma, job, error, current, maxRetries);
      options.log?.('Shared platform operation failed.', { jobId: job.id, kind: job.kind, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return jobs.length;
}
