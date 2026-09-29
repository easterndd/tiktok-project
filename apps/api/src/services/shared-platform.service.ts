import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type SharedMediaStatus } from '@prisma/client';
import { miniAppEnvironment, miniAppPlatformConfig, miniAppKeys, type MiniAppKey } from '../config/mini-apps';
import type { Env } from '../config/env';
import { TikTokShortDramaApiService, TikTokShortDramaApiError, isTikTokAlbumAuthorized, parseTikTokAlbumAuthorizationResults } from './tiktok-short-drama-api.service';

type Db = PrismaClient & { [key: string]: any };

type SharedWorkerOptions = {
  env: Env;
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
  if (miniAppKeys.includes(value as MiniAppKey)) return value as MiniAppKey;
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

export async function registerSharedPlaybackSnapshot(sharedPrisma: Db, env: Env, ownerMiniAppKey: string, album: any) {
  const owner = requireMiniAppKey(ownerMiniAppKey);
  const ownerConfig = sharedMiniAppConfig(env, owner);
  if (!ownerConfig.clientKey) throw conflict(`小程序 ${owner} 未配置 TikTok Client Key。`);
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });
  if (!album.onlineVersion || !reviewPassed(album.reviewStatus) || !published(album.publishStatus)) throw conflict('共享快照必须是已审核通过并上架的线上版本。');
  if (!album.tiktokAlbumId) throw conflict('剧目尚未同步至 TikTok，不能创建共享主剧目。');
  if (!album.tiktokVersion) throw conflict('剧目尚无 TikTok 版本，不能创建共享主剧目。');
  const registered = await sharedPrisma.sharedTikTokAlbum.findUnique({ where: { tiktokAlbumId: album.tiktokAlbumId } });
  if (registered && (registered.ownerMiniAppKey !== owner || registered.canonicalKey !== `${owner}:${album.id}`)) throw conflict('此剧目属于其他主小程序，不能通过授权副本变更主剧目归属。');
  if (registered && registered.ownerClientKey !== ownerConfig.clientKey) throw conflict('主剧目 Client Key 与登记时不同，请核实配置，不能自动变更授权来源。');
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

  return (sharedPrisma.$transaction as any)(async (tx: Db) => {
    const sharedAlbum = await tx.sharedTikTokAlbum.upsert({
      where: { tiktokAlbumId: album.tiktokAlbumId },
      create: {
        canonicalKey: `${owner}:${album.id}`,
        ownerMiniAppKey: owner,
        ownerClientKey: ownerConfig.clientKey!,
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

    // These rows are the current verified playback snapshot, not the media files.
    await tx.sharedTikTokEpisode.deleteMany({ where: { sharedAlbumId: sharedAlbum.id } });
    for (const episode of album.episodes) {
      await tx.sharedTikTokEpisode.upsert({
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

    await tx.miniAppAlbumAuthorization.upsert({
      where: { sharedAlbumId_miniAppKey: { sharedAlbumId: sharedAlbum.id, miniAppKey: owner } },
      create: {
        sharedAlbumId: sharedAlbum.id,
        miniAppKey: owner,
        targetClientKey: ownerConfig.clientKey!,
        targetAppId: ownerConfig.appId,
        targetLocalAlbumId: album.id,
        status: 'AUTHORIZED',
        authorizedAt: new Date(),
        lastReconciledAt: new Date()
      },
      update: {
        targetClientKey: ownerConfig.clientKey,
        targetAppId: ownerConfig.appId,
        targetLocalAlbumId: album.id,
        status: 'AUTHORIZED',
        authorizedAt: new Date(),
        lastReconciledAt: new Date()
      }
    });

    return tx.sharedTikTokAlbum.findUniqueOrThrow({
      where: { id: sharedAlbum.id },
      include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
    });
  }, { timeout: 30_000 });
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
  const previous = await sharedPrisma.miniAppAlbumAuthorization.findUnique({ where: { sharedAlbumId_miniAppKey: { sharedAlbumId, miniAppKey: target } } });
  const changedClient = previous && previous.targetClientKey !== targetConfig.clientKey;

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
      ...(targetLocalAlbumId ? { targetLocalAlbumId } : {}),
      ...(changedClient ? { status: 'PENDING', providerResponse: Prisma.JsonNull, providerRequestId: null, authorizedAt: null, lastReconciledAt: null, errorCode: null, errorMessage: null } : {})
    }
  });

  const active = await sharedPrisma.sharedPlatformOperation.findFirst({
    where: { kind: 'AUTHORIZE_ALBUM', sharedAlbumId, targetMiniAppKey: target, status: { in: ['PENDING', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' }
  });
  if (active) return { authorization, operation: active };
  if (authorization.status === 'CONFLICT') throw conflict('上次授权结果未知，请先用原请求 ID 核实平台授权，不能自动重复提交。');
  if (authorization.status === 'AUTHORIZED') return { authorization, operation: null };

  const snapshot = { sharedAlbumId, targetMiniAppKey: target, targetClientKey: targetConfig.clientKey, targetLocalAlbumId: targetLocalAlbumId ?? authorization.targetLocalAlbumId ?? null, targetOwnerAdminId: createdByAdminUserId };
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
      snapshotJson: snapshot,
      ...(changedClient ? { providerResponse: Prisma.JsonNull, providerRequestId: null } : {})
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

export async function projectSharedAlbumToLocal(sharedAlbum: any, authorization: any, localPrisma: Db) {
  if (!authorization.targetLocalAlbumId) throw conflict('目标剧目映射缺失，无法完成授权播放。');
  const playable = Boolean(sharedAlbum.onlineVersion && reviewPassed(sharedAlbum.reviewStatus) && published(sharedAlbum.publishStatus));
  const localAlbum = await localPrisma.album.findUnique({ where: { id: authorization.targetLocalAlbumId }, select: { id: true, tiktokAlbumId: true } });
  if (!localAlbum) throw conflict(`目标小程序剧目不存在：${authorization.targetLocalAlbumId}`);
  if (localAlbum.tiktokAlbumId && localAlbum.tiktokAlbumId !== sharedAlbum.tiktokAlbumId) throw conflict('目标剧目已绑定其他 TikTok 剧目，不会覆盖。');
  await (localPrisma.$transaction as any)(async (tx: Db) => {
    const localEpisodes = await tx.episode.findMany({ where: { albumId: authorization.targetLocalAlbumId }, orderBy: { episodeNo: 'asc' } });
    const sharedEpisodes = [...sharedAlbum.episodes].sort((left: any, right: any) => left.episodeNo - right.episodeNo);
    if (!sharedEpisodes.length) throw conflict('主剧目分集快照为空，不能完成播放映射。');
    await tx.episode.updateMany({ where: { albumId: authorization.targetLocalAlbumId }, data: { status: 'OFFLINE', tiktokEpisodeId: null, byteplusVid: null } });
    for (const sharedEpisode of sharedEpisodes) {
      const localEpisode = localEpisodes.find((item: any) => item.episodeNo === sharedEpisode.episodeNo);
      const data = {
        byteplusVid: sharedEpisode.media.byteplusVid,
        tiktokEpisodeId: sharedEpisode.tiktokEpisodeId,
        tiktokCoverPicId: sharedEpisode.tiktokCoverPicId,
        tiktokVideoStatus: 'READY' as const,
        tiktokVideoError: null,
        byteplusUploadStatus: 'READY' as const,
        title: sharedEpisode.title,
        status: playable ? 'ONLINE' as const : 'OFFLINE' as const
      };
      if (localEpisode) {
        if (localEpisode.byteplusVid && localEpisode.byteplusVid !== data.byteplusVid && localAlbum.tiktokAlbumId !== sharedAlbum.tiktokAlbumId) throw conflict(`第 ${sharedEpisode.episodeNo} 集已有不同 VID，不能覆盖。`);
        await tx.episode.update({ where: { id: localEpisode.id }, data });
      } else await tx.episode.create({ data: { ...data, albumId: authorization.targetLocalAlbumId, episodeNo: sharedEpisode.episodeNo, sortOrder: sharedEpisode.episodeNo, title: sharedEpisode.title, coverUrl: sharedEpisode.media.coverUrl, durationMs: sharedEpisode.media.durationMs } });
    }
    await tx.album.update({
      where: { id: authorization.targetLocalAlbumId },
      data: {
        tiktokAlbumId: sharedAlbum.tiktokAlbumId,
        tiktokVersion: sharedAlbum.onlineVersion,
        onlineVersion: sharedAlbum.onlineVersion,
        reviewStatus: sharedAlbum.reviewStatus,
        publishStatus: sharedAlbum.publishStatus,
        platformPublishedVersion: playable ? sharedAlbum.onlineVersion : null,
        platformPublishedAt: playable ? sharedAlbum.platformPublishedAt ?? new Date() : null,
        status: playable ? 'ONLINE' : 'OFFLINE'
      }
    });
  }, { timeout: 30_000 });
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
  const uncertain = operation.kind === 'AUTHORIZE_ALBUM' && retryable && !(operation.providerResponse as any)?.platformAuthorized;
  const retry = !uncertain && retryable && attemptCount <= maxRetries;
  const message = error instanceof Error ? error.message.slice(0, 500) : '共享平台任务失败。';
  await sharedPrisma.sharedPlatformOperation.update({
    where: { id: operation.id },
    data: {
      status: uncertain ? 'CONFLICT' : retry ? 'PENDING' : 'FAILED',
      attemptCount,
      nextAttemptAt: retry ? new Date(now.getTime() + retryDelayMs(attemptCount)) : null,
      completedAt: retry ? null : now,
      errorCode: typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null,
      errorMessage: uncertain ? `${message} 平台授权结果未知，停止自动重复授权；请带请求 ID 核实。` : message,
      providerRequestId: (error as { requestId?: string }).requestId,
      ...(error instanceof TikTokShortDramaApiError && error.responseData ? { providerResponse: error.responseData as Prisma.InputJsonValue } : {})
    }
  });
  if (operation.kind === 'AUTHORIZE_ALBUM' && operation.targetMiniAppKey) await sharedPrisma.miniAppAlbumAuthorization.updateMany({
    where: { sharedAlbumId: operation.sharedAlbumId, miniAppKey: operation.targetMiniAppKey },
    data: { status: uncertain ? 'CONFLICT' : 'FAILED', errorMessage: message, providerRequestId: (error as { requestId?: string }).requestId }
  });
}

async function refreshSharedSource(sharedPrisma: Db, album: any, options: SharedWorkerOptions) {
  const owner = album.authorizations.find((entry: any) => entry.miniAppKey === album.ownerMiniAppKey);
  const db = options.localPrismaByApp[album.ownerMiniAppKey];
  const api = options.apiByApp[album.ownerMiniAppKey];
  if (!owner?.targetLocalAlbumId || !db || !api) throw conflict('主剧目数据库、凭据或本地来源映射缺失。');
  if (sharedMiniAppConfig(options.env, album.ownerMiniAppKey).clientKey !== album.ownerClientKey) throw conflict('主小程序 Client Key 已变化，不能用新凭据操作旧授权。');
  const { verifyPlaybackSource } = await import('./shared-playback.service');
  const source = await verifyPlaybackSource(db, api, owner.targetLocalAlbumId);
  const updated = await registerSharedPlaybackSnapshot(sharedPrisma, options.env, album.ownerMiniAppKey, source);
  return { ...updated, verifiedSource: source };
}

async function processSharedAuthorization(sharedPrisma: Db, operation: any, options: SharedWorkerOptions, now: Date, allowAuthorizationRequest = true) {
  let album = await sharedPrisma.sharedTikTokAlbum.findUnique({
    where: { id: operation.sharedAlbumId },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  if (!album) throw new Error('共享主剧目不存在。');
  const target = requireMiniAppKey(operation.targetMiniAppKey);
  const authorization = album.authorizations.find((item: any) => item.miniAppKey === target);
  if (!authorization) throw new Error('共享主剧目授权记录不存在。');
  if (sharedMiniAppConfig(options.env, target).clientKey !== authorization.targetClientKey) throw conflict('目标 Client Key 已变化，请核实授权对象。');
  if ((operation.snapshotJson as any)?.targetClientKey && (operation.snapshotJson as any).targetClientKey !== authorization.targetClientKey) throw conflict('授权排队后目标 Client Key 已变化，不能使用旧批准操作新凭据。');
  const targetOwnerAdminId = (operation.snapshotJson as any)?.targetOwnerAdminId;
  if (!targetOwnerAdminId && authorization.status !== 'AUTHORIZED' && !(operation.providerResponse as any)?.platformAuthorized && !(authorization.providerResponse as any)?.platformAuthorized) throw conflict('旧授权任务缺少目标 OWNER 批准，请通过新版授权入口重新提交。');
  if (targetOwnerAdminId) {
    const admin = await options.localPrismaByApp[target]?.adminUser.findUnique({ where: { id: targetOwnerAdminId } });
    if (!admin || admin.role !== 'OWNER' || admin.status !== 'ACTIVE') throw conflict('目标 OWNER 授权已失效，停止平台授权。');
  }
  album = await refreshSharedSource(sharedPrisma, album, options);
  if (!album) throw conflict('主剧目线上快照刷新失败。');
  const ownerApi = options.apiByApp[album.ownerMiniAppKey];
  if (!ownerApi) throw new Error(`主小程序 ${album.ownerMiniAppKey} 的 TikTok API 未配置。`);
  const proof = (operation.providerResponse as any)?.platformAuthorized && (operation.providerResponse as any)?.targetClientKey === authorization.targetClientKey;
  const savedProof = (authorization.providerResponse as any)?.platformAuthorized && (authorization.providerResponse as any)?.targetClientKey === authorization.targetClientKey;
  if (authorization.status !== 'AUTHORIZED' && !proof && !savedProof) {
    if (!allowAuthorizationRequest) throw conflict('本地恢复缺少匹配的成功证明，禁止重新调用平台授权。');
    await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { status: 'AUTHORIZING', errorCode: null, errorMessage: null } });
    const result = await ownerApi.authorizeAlbum({ albumId: album.tiktokAlbumId, targetClientKeys: [authorization.targetClientKey], operateType: 1 });
    const targetResult = result.results.find((item) => item.clientKey === authorization.targetClientKey);
    const authorized = isTikTokAlbumAuthorized(targetResult);
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
      await sharedPrisma.sharedPlatformOperation.update({ where: { id: operation.id }, data: { status: 'FAILED', completedAt: now, nextAttemptAt: null, providerRequestId: result.requestId, providerResponse: result.raw as Prisma.InputJsonValue, errorCode: targetResult?.errorCode ?? 'AUTHORIZATION_FAILED', errorMessage: targetResult?.errorMessage ?? 'TikTok 未确认目标小程序授权。' } });
      return;
    }
    try {
      await (sharedPrisma.$transaction as any)(async (tx: Db) => {
        const changed = await tx.miniAppAlbumAuthorization.updateMany({
          where: { id: authorization.id, targetClientKey: authorization.targetClientKey },
          data: {
            status: 'AUTHORIZING',
            providerRequestId: result.requestId,
            providerResponse: { ...result.raw, platformAuthorized: true, targetClientKey: authorization.targetClientKey } as Prisma.InputJsonValue,
            errorCode: null,
            errorMessage: null,
            authorizedAt: now,
            lastReconciledAt: null
          }
        });
        if (changed.count !== 1) throw conflict('授权期间目标凭据已变化，停止本地映射。');
        await tx.sharedPlatformOperation.update({ where: { id: operation.id }, data: { providerRequestId: result.requestId, providerResponse: { ...result.raw, platformAuthorized: true, targetClientKey: authorization.targetClientKey } } });
      });
    } catch { throw new TikTokShortDramaApiError('平台已返回授权成功，但授权凭据保存失败，请核实原请求结果。', undefined, result.requestId, true); }
    operation.providerResponse = { ...result.raw, platformAuthorized: true, targetClientKey: authorization.targetClientKey };
  }
  const localPrisma = options.localPrismaByApp[target];
  if (!localPrisma) throw conflict('目标数据库未配置，平台授权尚未完成本地映射。');
  await projectSharedAlbumToLocal(album, authorization, localPrisma);
  await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { status: 'AUTHORIZED', errorCode: null, errorMessage: null, lastReconciledAt: now } });
  await completeSharedOperation(sharedPrisma, operation, { providerResponse: { platformAuthorized: true, targetClientKey: authorization.targetClientKey, mappedEpisodeCount: album.episodes.length, onlineVersion: album.onlineVersion } }, now);
}

async function processSharedReconcile(sharedPrisma: Db, operation: any, options: SharedWorkerOptions, now: Date) {
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({
    where: { id: operation.sharedAlbumId },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  if (!album) throw new Error('共享主剧目不存在。');
  if (sharedMiniAppConfig(options.env, album.ownerMiniAppKey).clientKey !== album.ownerClientKey) throw conflict('主小程序 Client Key 已变化，停止旧授权对账。');
  const ownerApi = options.apiByApp[album.ownerMiniAppKey];
  if (!ownerApi) throw new Error(`主小程序 ${album.ownerMiniAppKey} 的 TikTok API 未配置。`);
  const queried = await ownerApi.queryAlbum({ albumId: album.tiktokAlbumId });
  const state = queried.data;
  const onlineVersion = asNumber(state.online_version);
  const online = onlineVersion && onlineVersion !== asNumber(state.version) ? await ownerApi.queryAlbum({ albumId: album.tiktokAlbumId, version: onlineVersion }) : queried;
  const playable = published(state.publish_status) && onlineVersion && reviewPassed(online.data.review_status);
  const summary = { current_version: state.current_version, online_version: onlineVersion, publish_status: state.publish_status, online_review_status: online.data.review_status };
  const updated = playable ? await refreshSharedSource(sharedPrisma, album, options) : await sharedPrisma.sharedTikTokAlbum.update({
    where: { id: album.id },
    data: {
      currentVersion: asNumber(state.current_version) ?? album.currentVersion,
      onlineVersion: onlineVersion ?? null,
      reviewStatus: platformStatus(online.data.review_status),
      publishStatus: platformStatus(state.publish_status),
      platformPublishedAt: published(state.publish_status) ? now : null
    },
    include: { episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } }, authorizations: true }
  });
  const failures: Array<{ miniAppKey: string; message: string }> = [];
  for (const authorization of updated.authorizations) {
    if (authorization.miniAppKey === updated.ownerMiniAppKey) continue;
    if (authorization.status !== 'AUTHORIZED' && !(authorization.providerResponse as any)?.platformAuthorized) continue;
    const localPrisma = options.localPrismaByApp[authorization.miniAppKey];
    try {
      if (sharedMiniAppConfig(options.env, authorization.miniAppKey).clientKey !== authorization.targetClientKey) throw conflict('目标 Client Key 已变化，旧授权不能开放当前小程序播放。');
      if (!localPrisma) throw conflict('目标数据库未配置。');
      await projectSharedAlbumToLocal(updated, authorization, localPrisma);
      await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { status: 'AUTHORIZED', errorMessage: null, errorCode: null, lastReconciledAt: now } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '目标映射失败。';
      failures.push({ miniAppKey: authorization.miniAppKey, message });
      if (localPrisma && authorization.targetLocalAlbumId) {
        await localPrisma.album.updateMany({ where: { id: authorization.targetLocalAlbumId }, data: { status: 'OFFLINE', platformPublishedVersion: null, platformPublishedAt: null } });
      }
      await sharedPrisma.miniAppAlbumAuthorization.update({ where: { id: authorization.id }, data: { errorMessage: message } });
    }
  }
  if (failures.length) {
    await sharedPrisma.sharedPlatformOperation.update({ where: { id: operation.id }, data: { status: 'FAILED', completedAt: now, nextAttemptAt: null, providerRequestId: queried.requestId, providerResponse: { ...summary, targetFailures: failures } as Prisma.InputJsonValue, errorMessage: '平台状态查询完成，但部分目标本地映射失败，已停止其本地播放。' } });
  } else await completeSharedOperation(sharedPrisma, operation, { providerRequestId: queried.requestId, providerResponse: summary }, now);
}

export async function enqueueDueSharedReconciliations(sharedPrisma: Db, now = new Date()) {
  const albums = await sharedPrisma.sharedTikTokAlbum.findMany({ where: { OR: miniAppKeys.map((owner) => ({
    ownerMiniAppKey: owner, authorizations: { some: { miniAppKey: { not: owner }, status: 'AUTHORIZED' as const } }
  })) }, orderBy: { updatedAt: 'asc' }, take: 20 });
  for (const album of albums) {
    const recent = await sharedPrisma.sharedPlatformOperation.findFirst({ where: { sharedAlbumId: album.id, kind: 'RECONCILE_ALBUM', OR: [{ status: { in: ['PENDING', 'PROCESSING'] } }, { createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } }] } });
    if (!recent) await enqueueSharedAlbumReconcile(sharedPrisma, album.id);
  }
}

export async function recoverSavedAuthorization(sharedPrisma: Db, options: SharedWorkerOptions, operationId: string) {
  const original = await sharedPrisma.sharedPlatformOperation.findUnique({ where: { id: operationId } });
  if (!original || original.kind !== 'AUTHORIZE_ALBUM' || original.status !== 'CONFLICT' || !original.targetMiniAppKey || !original.sharedAlbumId) throw conflict('只有结果未知的授权任务可以从已保存响应恢复。');
  const target = requireMiniAppKey(original.targetMiniAppKey);
  const evidence = original.providerResponse as any;
  const envelope = evidence?.providerEnvelope;
  const album = await sharedPrisma.sharedTikTokAlbum.findUnique({ where: { id: original.sharedAlbumId }, include: { authorizations: true } });
  const authorization = album?.authorizations.find((item: any) => item.miniAppKey === target);
  const clientKey = authorization?.targetClientKey;
  if (!album || !clientKey || sharedMiniAppConfig(options.env, target).clientKey !== clientKey
    || (original.snapshotJson as any)?.targetClientKey !== clientKey) throw conflict('目标凭据或原任务批准不匹配，不能恢复授权。');
  if (evidence?.httpStatus !== 200 || evidence.requestedAlbumId !== album.tiktokAlbumId
    || !Array.isArray(evidence.requestedClientKeys) || evidence.requestedClientKeys.length !== 1 || evidence.requestedClientKeys[0] !== clientKey
    || !envelope?.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)
    || (envelope.error?.code && envelope.error.code !== 'ok')) throw conflict('已保存响应缺少匹配剧目和目标的有效平台证据，不能恢复。');
  const results = parseTikTokAlbumAuthorizationResults(envelope.data, [clientKey], { requestId: original.providerRequestId ?? undefined });
  if (!isTikTokAlbumAuthorized(results.find((item) => item.clientKey === clientKey))) throw conflict('已保存响应没有明确确认该目标已授权，不能恢复。');
  const ownerId = (original.snapshotJson as any)?.targetOwnerAdminId;
  const owner = ownerId ? await options.localPrismaByApp[target]?.adminUser.findUnique({ where: { id: ownerId } }) : null;
  if (!owner || owner.status !== 'ACTIVE' || owner.role !== 'OWNER') throw conflict('目标 OWNER 批准已失效，不能恢复本地播放。');
  const dedupeKey = `SAVED_AUTHORIZATION_RECOVERY:${original.id}`;
  const existing = await sharedPrisma.sharedPlatformOperation.findUnique({ where: { dedupeKey } });
  if (existing) return existing;
  const active = await sharedPrisma.sharedPlatformOperation.findFirst({ where: { sharedAlbumId: original.sharedAlbumId, targetMiniAppKey: target, kind: 'AUTHORIZE_ALBUM', status: { in: ['PENDING', 'PROCESSING'] } } });
  if (active) throw conflict('该目标已有处理中授权任务，请等待完成后恢复。');
  const now = options.now?.() ?? new Date();
  const proof = { ...envelope.data, platformAuthorized: true, targetClientKey: clientKey, recoveredFromOperationId: original.id };
  const operation = await (sharedPrisma.$transaction as any)(async (tx: Db) => {
    const created = await tx.sharedPlatformOperation.create({ data: {
      kind: 'AUTHORIZE_ALBUM', status: 'PROCESSING', sharedAlbumId: original.sharedAlbumId, targetMiniAppKey: target, dedupeKey,
      snapshotJson: { ...(original.snapshotJson as any), recoveryOfOperationId: original.id },
      providerRequestId: original.providerRequestId, providerResponse: proof, startedAt: now, nextAttemptAt: null
    } });
    const changed = await tx.miniAppAlbumAuthorization.updateMany({ where: { id: authorization.id, targetClientKey: clientKey }, data: {
      status: 'AUTHORIZING', providerRequestId: original.providerRequestId, providerResponse: proof,
      errorCode: null, errorMessage: null, authorizedAt: now
    } });
    if (changed.count !== 1) throw conflict('恢复期间目标凭据已变化，停止本地映射。');
    return created;
  });
  try {
    await processSharedAuthorization(sharedPrisma, operation, options, now, false);
  } catch (error) {
    await failSharedOperation(sharedPrisma, operation, error, now, 0);
  }
  return sharedPrisma.sharedPlatformOperation.findUniqueOrThrow({ where: { id: operation.id } });
}

export async function retryUnknownAuthorizationOnce(sharedPrisma: Db, options: SharedWorkerOptions, operationId: string, target: string, confirmation: string) {
  if (confirmation !== 'REAUTHORIZE_ONE_TARGET') throw conflict('需要明确确认再次授权一个目标。');
  const original = await sharedPrisma.sharedPlatformOperation.findUnique({ where: { id: operationId } });
  if (!original || original.kind !== 'AUTHORIZE_ALBUM' || original.status !== 'CONFLICT' || original.targetMiniAppKey !== target) throw conflict('原任务不是该目标的结果未知授权任务。');
  const active = await sharedPrisma.sharedPlatformOperation.findFirst({ where: { sharedAlbumId: original.sharedAlbumId, targetMiniAppKey: target, kind: 'AUTHORIZE_ALBUM', status: { in: ['PENDING', 'PROCESSING'] } } });
  if (active) throw conflict('该目标已有处理中授权任务，不能再次提交。');
  const ownerId = (original.snapshotJson as any)?.targetOwnerAdminId;
  const owner = ownerId ? await options.localPrismaByApp[target]?.adminUser.findUnique({ where: { id: ownerId } }) : null;
  if (!owner || owner.status !== 'ACTIVE' || owner.role !== 'OWNER') throw conflict('原任务的目标 OWNER 批准已失效，不能通过维护工具绕过。');
  const now = options.now?.() ?? new Date();
  const dedupeKey = `MANUAL_AUTHORIZATION:${original.id}`;
  if (await sharedPrisma.sharedPlatformOperation.findUnique({ where: { dedupeKey } })) throw conflict('该原任务已执行过一次维护授权，请检查新任务的响应，不要重复执行。');
  const operation = await sharedPrisma.sharedPlatformOperation.create({ data: {
    kind: 'AUTHORIZE_ALBUM', status: 'PROCESSING', sharedAlbumId: original.sharedAlbumId, targetMiniAppKey: target,
    dedupeKey,
    snapshotJson: { ...(original.snapshotJson as any), manualRetryOfOperationId: original.id, originalProviderRequestId: original.providerRequestId },
    startedAt: now, nextAttemptAt: null
  } });
  try {
    await processSharedAuthorization(sharedPrisma, operation, options, now);
  } catch (error) {
    await failSharedOperation(sharedPrisma, operation, error, now, 0);
  }
  return sharedPrisma.sharedPlatformOperation.findUniqueOrThrow({ where: { id: operation.id } });
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
    if (pending.status === 'PROCESSING' && pending.kind === 'AUTHORIZE_ALBUM' && !(pending.providerResponse as any)?.platformAuthorized) {
      await sharedPrisma.sharedPlatformOperation.update({ where: { id: pending.id }, data: { status: 'CONFLICT', completedAt: current, nextAttemptAt: null, errorMessage: '共享平台操作中断，结果未知；请先对账。' } });
      await sharedPrisma.miniAppAlbumAuthorization.updateMany({ where: { sharedAlbumId: pending.sharedAlbumId!, miniAppKey: pending.targetMiniAppKey! }, data: { status: 'CONFLICT', errorMessage: '授权执行中断，平台结果未知，请核实原请求，勿重复授权。' } });
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
