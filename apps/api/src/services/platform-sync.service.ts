import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import {
  TikTokShortDramaApiError,
  TikTokShortDramaApiService,
  TikTokShortDramaNotConfiguredError,
  type TikTokAlbumInfoInput,
  type TikTokEpisodeInfoInput
} from './tiktok-short-drama-api.service';

type Db = PrismaClient & { [key: string]: any };

export type PlatformSyncKind = 'COVER' | 'VIDEO' | 'ALBUM_VERSION' | 'REVIEW' | 'SET_ONLINE_VERSION' | 'PUBLISH' | 'UNPUBLISH' | 'RECONCILE';

function workflowConflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

type AlbumSnapshot = {
  albumId: string;
  albumInfo: TikTokAlbumInfoInput;
  episodes: Array<TikTokEpisodeInfoInput & { localEpisodeId: string }>;
};

type PlatformJobInput = {
  kind: PlatformSyncKind;
  targetId: string;
  dedupeKey: string;
  createdByAdminUserId?: string;
  albumId?: string;
  episodeId?: string;
  coverAssetId?: string;
  snapshotHash?: string;
  snapshotJson?: unknown;
};

type WorkerOptions = {
  now?: () => Date;
  maxRetries?: number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

const defaultMaxRetries = 5;
const staleProcessingMs = 10 * 60_000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function hashSnapshot(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function retryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

function platformError(error: unknown) {
  if (error instanceof TikTokShortDramaApiError) {
    return { code: error.code, message: error.message, requestId: error.requestId, retryable: error.retryable };
  }
  if (error instanceof TikTokShortDramaNotConfiguredError) return { message: error.message, retryable: false };
  return { message: error instanceof Error ? error.message.slice(0, 500) : 'TikTok platform sync failed.', retryable: false };
}

function isTikTokAlbumNotFound(error: unknown) {
  return error instanceof TikTokShortDramaApiError && error.code === '22001';
}

function tags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is number => typeof tag === 'number' && Number.isInteger(tag));
}

function reviewPassed(status: unknown) {
  return status === 2 || status === '2' || status === 'PASSED' || status === 'APPROVED';
}

function published(status: unknown) {
  return status === 1 || status === '1' || status === 'LISTED' || status === 'PUBLISHED';
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function platformResponse(value: unknown) {
  return record(value);
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringify(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

export async function buildAlbumSnapshot(prisma: Db, albumId: string): Promise<AlbumSnapshot> {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: {
      coverAsset: true,
      episodes: { orderBy: { sortOrder: 'asc' }, include: { coverAsset: true } }
    }
  });
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });
  if (!album.coverAsset?.providerImageId) throw workflowConflict('专辑封面尚未同步到 TikTok。');
  if (!album.releaseYear || !album.dramaType || tags(album.tagList).length < 1 || tags(album.tagList).length > 3) {
    throw workflowConflict('剧目缺少 TikTok 所需的年份、剧目类型或 1 至 3 个标签。');
  }
  const albumCoverPicId = album.coverAsset.providerImageId;
  const episodes = album.episodes.map((episode: any) => {
    if (!episode.byteplusVid || episode.tiktokVideoStatus !== 'READY') throw workflowConflict(`第 ${episode.episodeNo} 集视频尚未完成 TikTok 登记。`);
    const coverPicId = episode.coverAsset?.providerImageId ?? albumCoverPicId;
    if (!coverPicId) throw workflowConflict(`第 ${episode.episodeNo} 集封面尚未同步到 TikTok。`);
    return {
      localEpisodeId: episode.id,
      ...(episode.tiktokEpisodeId ? { episode_id: episode.tiktokEpisodeId } : {}),
      title: episode.title,
      seq: episode.episodeNo,
      cover_list: [coverPicId],
      byteplus_vid: episode.byteplusVid
    };
  });
  return {
    albumId,
    albumInfo: {
      language: album.language,
      title: album.title,
      seq_num: episodes.length,
      cover_list: [albumCoverPicId],
      year: album.releaseYear,
      album_status: 3,
      desp: album.description,
      drama_type: album.dramaType,
      tag_list: tags(album.tagList),
      publish_status: 0
    },
    episodes
  };
}

export async function enqueuePlatformSyncJob(prisma: Db, input: PlatformJobInput) {
  const existing = await prisma.platformSyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) {
    if (existing.status !== 'FAILED') return existing;
    // A deliberate operator retry should recover jobs that exhausted automatic
    // retries during a transient provider or network outage.
    return prisma.platformSyncJob.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
        nextAttemptAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });
  }
  return prisma.platformSyncJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      ...input,
      status: 'PENDING',
      nextAttemptAt: new Date()
    } as any,
    update: {}
  });
}

export async function enqueueAlbumVersionSync(prisma: Db, albumId: string, createdByAdminUserId?: string) {
  const snapshot = await buildAlbumSnapshot(prisma, albumId);
  const snapshotHash = hashSnapshot(snapshot);
  return enqueuePlatformSyncJob(prisma, {
    kind: 'ALBUM_VERSION',
    targetId: albumId,
    albumId,
    createdByAdminUserId,
    snapshotHash,
    snapshotJson: snapshot,
    dedupeKey: `ALBUM_VERSION:${albumId}:${snapshotHash}`
  });
}

export async function enqueueCoverSync(prisma: Db, coverAssetId: string, createdByAdminUserId?: string) {
  const cover = await prisma.coverAsset.findUnique({ where: { id: coverAssetId } });
  if (!cover) throw new Error('封面资源不存在。');
  if (cover.providerImageId) return null;
  return enqueuePlatformSyncJob(prisma, {
    kind: 'COVER',
    targetId: coverAssetId,
    coverAssetId,
    createdByAdminUserId,
    dedupeKey: `COVER:${coverAssetId}:${cover.sha256}`
  });
}

export async function enqueueVideoSync(prisma: Db, episodeId: string, createdByAdminUserId?: string) {
  const episode = await prisma.episode.findUnique({ where: { id: episodeId }, select: { id: true, byteplusVid: true, tiktokVideoStatus: true } });
  if (!episode?.byteplusVid) throw new Error('分集尚未完成 BytePlus 视频上传。');
  if (episode.tiktokVideoStatus === 'READY') return null;
  return enqueuePlatformSyncJob(prisma, {
    kind: 'VIDEO',
    targetId: episodeId,
    episodeId,
    createdByAdminUserId,
    dedupeKey: `VIDEO:${episodeId}:${episode.byteplusVid}`
  });
}

export async function enqueueAlbumAction(prisma: Db, kind: Extract<PlatformSyncKind, 'REVIEW' | 'SET_ONLINE_VERSION' | 'PUBLISH' | 'UNPUBLISH' | 'RECONCILE'>, albumId: string, createdByAdminUserId?: string) {
  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { id: true, tiktokVersion: true, onlineVersion: true, tiktokAlbumId: true } });
  if (!album?.tiktokAlbumId) throw workflowConflict('剧目尚未同步至 TikTok，请先执行“同步版本”。');
  const version = kind === 'SET_ONLINE_VERSION' ? album.tiktokVersion : album.onlineVersion ?? album.tiktokVersion;
  if (['REVIEW', 'SET_ONLINE_VERSION'].includes(kind) && !version) throw workflowConflict('剧目尚无可操作的 TikTok 版本，请先执行“同步版本”。');
  const snapshot = { albumId, platformAlbumId: album.tiktokAlbumId, version };
  const active = await prisma.platformSyncJob.findFirst({
    where: { kind, albumId, status: { in: ['PENDING', 'PROCESSING'] }, snapshotHash: hashSnapshot(snapshot) },
    orderBy: { createdAt: 'desc' }
  });
  if (active) return active;
  return enqueuePlatformSyncJob(prisma, {
    kind,
    targetId: albumId,
    albumId,
    createdByAdminUserId,
    snapshotHash: hashSnapshot(snapshot),
    snapshotJson: snapshot,
    // Completed actions remain immutable audit records. A new operation uses a
    // distinct key, while the active-job lookup above absorbs repeat clicks.
    dedupeKey: `${kind}:${albumId}:${version ?? 'current'}:${Date.now()}`
  });
}

async function completeJob(prisma: Db, job: any, data: Record<string, unknown>, now: Date) {
  await prisma.platformSyncJob.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED', completedAt: now, nextAttemptAt: null, errorCode: null, errorMessage: null, ...data }
  });
}

async function failJob(prisma: Db, job: any, error: unknown, now: Date, maxRetries: number) {
  const details = platformError(error);
  const attemptCount = job.attemptCount + 1;
  // album/update always creates a new version. A timeout after TikTok accepted
  // it is ambiguous, so automatic replay would duplicate platform versions.
  const ambiguousAlbumUpdate = job.kind === 'ALBUM_VERSION' && details.retryable;
  const retry = !ambiguousAlbumUpdate && details.retryable && attemptCount <= maxRetries;
  await prisma.platformSyncJob.update({
    where: { id: job.id },
    data: {
      status: ambiguousAlbumUpdate ? 'CONFLICT' : retry ? 'PENDING' : 'FAILED',
      attemptCount,
      nextAttemptAt: retry ? new Date(now.getTime() + retryDelayMs(attemptCount)) : null,
      completedAt: retry ? null : now,
      errorCode: details.code ?? null,
      errorMessage: ambiguousAlbumUpdate ? `${details.message} 剧目更新结果未知，已停止自动重试；请先执行平台对账后再决定是否创建新版本。` : details.message,
      providerRequestId: details.requestId ?? undefined
    }
  });
  if (job.kind === 'COVER' && job.coverAssetId) await prisma.coverAsset.update({ where: { id: job.coverAssetId }, data: { platformSyncError: details.message } });
  if (job.kind === 'VIDEO' && job.episodeId) await prisma.episode.update({ where: { id: job.episodeId }, data: { tiktokVideoStatus: 'FAILED', tiktokVideoError: details.message } });
}

async function processCover(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  const cover = await prisma.coverAsset.findUnique({ where: { id: job.coverAssetId ?? job.targetId } });
  if (!cover) throw new Error('封面资源不存在。');
  if (cover.providerImageId) return completeJob(prisma, job, {}, now);
  if (!cover.publicUrl.startsWith('https://')) throw new Error('TikTok 封面同步要求公网 HTTPS 地址。');
  const result = await api.createImage({ imageUrl: cover.publicUrl });
  await (prisma.$transaction as any)(async (tx: Db) => {
    await tx.coverAsset.update({ where: { id: cover.id }, data: { providerImageId: result.openPicId, platformSyncedAt: now, platformSyncError: null } });
    await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { open_pic_id: result.openPicId } }, now);
  });
}

async function processVideo(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  const episode = await prisma.episode.findUnique({ where: { id: job.episodeId ?? job.targetId }, select: { id: true, title: true, byteplusVid: true, tiktokVideoJobId: true, tiktokVideoStatus: true } });
  if (!episode?.byteplusVid) throw new Error('分集尚未完成 BytePlus 视频上传。');
  if (episode.tiktokVideoStatus === 'READY') return completeJob(prisma, job, {}, now);
  const registeredVid = typeof job.providerResponse?.byteplus_vid === 'string' ? job.providerResponse.byteplus_vid : undefined;
  if (!episode.tiktokVideoJobId && registeredVid) {
    const result = await api.getVideo({ vid: registeredVid });
    if (result.uploadStatus === 1) {
      await prisma.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 30_000), providerRequestId: result.requestId } });
      return;
    }
    if (result.uploadStatus === 3 || !result.vid) throw new TikTokShortDramaApiError('TikTok rejected the registered video.', undefined, result.requestId, false);
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.episode.update({ where: { id: episode.id }, data: { byteplusVid: result.vid, tiktokVideoStatus: 'READY', tiktokVideoError: null, platformSyncedAt: now } });
      await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { vid: result.vid, upload_status: result.uploadStatus } }, now);
    });
    return;
  }
  if (!episode.tiktokVideoJobId) {
    const result = await api.createVideo({ vid: episode.byteplusVid, title: episode.title });
    if (result.status === 'READY') {
      await (prisma.$transaction as any)(async (tx: Db) => {
        await tx.episode.update({ where: { id: episode.id }, data: { byteplusVid: result.byteplusVid, tiktokVideoStatus: 'READY', tiktokVideoError: null, platformSyncedAt: now } });
        await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { byteplus_vid: result.byteplusVid, result_type: 1 } }, now);
      });
      return;
    }
    if (result.status === 'VERIFYING') {
      const verification = await api.getVideo({ vid: result.byteplusVid });
      if (verification.uploadStatus === 2 && verification.vid) {
        await (prisma.$transaction as any)(async (tx: Db) => {
          await tx.episode.update({ where: { id: episode.id }, data: { byteplusVid: verification.vid, tiktokVideoStatus: 'READY', tiktokVideoError: null, platformSyncedAt: now } });
          await completeJob(tx, job, { providerRequestId: verification.requestId, providerResponse: { vid: verification.vid, upload_status: verification.uploadStatus } }, now);
        });
        return;
      }
      if (verification.uploadStatus === 3 || !verification.vid) throw new TikTokShortDramaApiError('TikTok rejected the registered video.', undefined, verification.requestId, false);
      await prisma.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 30_000), providerRequestId: verification.requestId, providerResponse: { byteplus_vid: result.byteplusVid, result_type: 'VERIFYING' } } });
      return;
    }
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.episode.update({ where: { id: episode.id }, data: { tiktokVideoJobId: result.jobId, tiktokVideoStatus: 'PROCESSING', tiktokVideoError: null } });
      await tx.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', providerJobId: result.jobId, providerRequestId: result.requestId, providerResponse: { byteplus_vid: result.byteplusVid, result_type: 2 }, startedAt: job.startedAt ?? now, nextAttemptAt: new Date(now.getTime() + 30_000) } });
    });
    return;
  }
  const result = await api.getVideo({ jobId: episode.tiktokVideoJobId, vid: episode.byteplusVid });
  if (result.uploadStatus === 1) {
    await prisma.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 30_000), providerRequestId: result.requestId } });
    return;
  }
  if (result.uploadStatus === 3 || !result.vid) throw new TikTokShortDramaApiError('TikTok rejected the registered video.', undefined, result.requestId, false);
  await (prisma.$transaction as any)(async (tx: Db) => {
    await tx.episode.update({ where: { id: episode.id }, data: { byteplusVid: result.vid, tiktokVideoStatus: 'READY', tiktokVideoError: null, platformSyncedAt: now } });
    await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { vid: result.vid, upload_status: result.uploadStatus } }, now);
  });
}

async function processAlbumVersion(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  const snapshot = job.snapshotJson as AlbumSnapshot | null;
  if (!snapshot?.albumInfo || !snapshot.episodes?.length) throw new Error('剧目同步任务缺少不可变版本快照。');
  const album = await prisma.album.findUnique({ where: { id: job.albumId ?? job.targetId }, select: { id: true, tiktokAlbumId: true, tiktokVersion: true } });
  if (!album) throw new Error('剧目不存在。');
  let platformAlbumId = album.tiktokAlbumId;
  let expectedVersion = album.tiktokVersion ?? undefined;
  let recreatedAlbum = false;
  const savedCreatedAlbumId = stringify(platformResponse(job.providerResponse).created_album_id);
  let createdForJob = Boolean(platformAlbumId && savedCreatedAlbumId === platformAlbumId);
  if (platformAlbumId) {
    try {
      const queried = await api.queryAlbum({ albumId: platformAlbumId });
      const current = numberValue(queried.data.current_version);
      if (current) expectedVersion = current;
    } catch (error) {
      if (!isTikTokAlbumNotFound(error)) throw error;
      if (savedCreatedAlbumId === platformAlbumId) {
        await prisma.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 60_000), providerRequestId: (error as TikTokShortDramaApiError).requestId, errorCode: '22001', errorMessage: 'TikTok 剧目刚创建，平台仍在同步，稍后自动重试。' } });
        return;
      }
      // An album may have been created with an earlier Client Key or removed on
      // TikTok. Its episode IDs cannot be reused with a replacement album.
      platformAlbumId = null;
      expectedVersion = undefined;
      recreatedAlbum = true;
    }
  }
  if (!platformAlbumId) {
    const created = await api.createAlbum();
    platformAlbumId = created.albumId;
    createdForJob = true;
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.album.update({ where: { id: album.id }, data: {
        tiktokAlbumId: platformAlbumId!,
        ...(recreatedAlbum ? { tiktokVersion: null, onlineVersion: null, platformPublishedVersion: null, platformPublishedAt: null, reviewStatus: null } : {})
      } });
      if (recreatedAlbum) await tx.episode.updateMany({ where: { albumId: album.id }, data: { tiktokEpisodeId: null } });
      await tx.platformSyncJob.update({ where: { id: job.id }, data: { providerRequestId: created.requestId, providerResponse: { created_album_id: platformAlbumId } } });
    });
  }
  const submittedEpisodes = snapshot.episodes.map(({ localEpisodeId: _localEpisodeId, ...episode }) => {
    if (!createdForJob) return episode;
    const { episode_id: _staleEpisodeId, ...newEpisode } = episode;
    return newEpisode;
  });
  let result;
  try {
    result = await api.updateAlbumVersion({
      albumId: platformAlbumId!,
      version: expectedVersion,
      albumInfo: snapshot.albumInfo,
      episodes: submittedEpisodes
    });
  } catch (error) {
    if (!createdForJob || !isTikTokAlbumNotFound(error)) throw error;
    await prisma.platformSyncJob.update({ where: { id: job.id }, data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 60_000), providerRequestId: (error as TikTokShortDramaApiError).requestId, providerResponse: { created_album_id: platformAlbumId }, errorCode: '22001', errorMessage: 'TikTok 剧目刚创建，平台仍在同步，稍后自动重试。' } });
    return;
  }
  await (prisma.$transaction as any)(async (tx: Db) => {
    await tx.album.update({ where: { id: album.id }, data: {
      tiktokAlbumId: platformAlbumId!,
      tiktokVersion: result.version,
      publishStatus: stringify(result.publishStatus) ?? null,
      ...(recreatedAlbum ? { onlineVersion: null, platformPublishedVersion: null, platformPublishedAt: null, reviewStatus: null } : {})
    } });
    await Promise.all(snapshot.episodes.map((episode) => {
      const mapped = result.episodeIdMap[createdForJob ? `seq_${episode.seq}` : episode.episode_id ?? `seq_${episode.seq}`];
      return tx.episode.update({ where: { id: episode.localEpisodeId }, data: { tiktokEpisodeId: mapped ?? (createdForJob ? null : episode.episode_id), tiktokCoverPicId: episode.cover_list[0] } });
    }));
    await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { version: result.version, episode_id_map: result.episodeIdMap } }, now);
  });
}

async function processAlbumAction(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  const album = await prisma.album.findUnique({ where: { id: job.albumId ?? job.targetId }, select: { id: true, tiktokAlbumId: true, tiktokVersion: true, onlineVersion: true, reviewStatus: true } });
  if (!album?.tiktokAlbumId) throw new Error('剧目尚未同步至 TikTok。');
  if (job.kind === 'REVIEW') {
    if (!album.tiktokVersion) throw new Error('剧目尚无可送审的 TikTok 版本。');
    const result = await api.submitReview({ albumId: album.tiktokAlbumId, version: album.tiktokVersion });
    await prisma.album.update({ where: { id: album.id }, data: { status: 'REVIEWING', reviewStatus: 'REVIEWING' } });
    return completeJob(prisma, job, { providerRequestId: result.requestId, providerResponse: { review_id: result.reviewId } }, now);
  }
  if (job.kind === 'SET_ONLINE_VERSION') {
    if (!album.tiktokVersion) throw new Error('剧目尚无可设为线上版本的 TikTok 版本。');
    const queried = await api.queryAlbum({ albumId: album.tiktokAlbumId, version: album.tiktokVersion });
    const status = queried.data.review_status;
    if (!reviewPassed(status)) throw new Error('TikTok 审核尚未通过，不能设置线上版本。');
    const result = await api.setOnlineVersion({ albumId: album.tiktokAlbumId, version: album.tiktokVersion });
    await prisma.album.update({ where: { id: album.id }, data: { onlineVersion: result.onlineVersion, reviewStatus: 'PASSED' } });
    return completeJob(prisma, job, { providerRequestId: result.requestId, providerResponse: { online_version: result.onlineVersion } }, now);
  }
  if (job.kind === 'PUBLISH') {
    if (!album.onlineVersion || !reviewPassed(album.reviewStatus)) throw new Error('剧目尚未审核通过或未设置线上版本。');
    const result = await api.setAlbumStatus({ albumId: album.tiktokAlbumId, status: 1 });
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.album.update({ where: { id: album.id }, data: { status: 'ONLINE', publishStatus: 'LISTED', platformPublishedVersion: album.onlineVersion, platformPublishedAt: now } });
      await tx.episode.updateMany({ where: { albumId: album.id, tiktokVideoStatus: 'READY' }, data: { status: 'ONLINE' } });
      await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { status: result.status } }, now);
    });
    return;
  }
  if (job.kind === 'UNPUBLISH') {
    const result = await api.setAlbumStatus({ albumId: album.tiktokAlbumId, status: 2 });
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.album.update({ where: { id: album.id }, data: { status: 'OFFLINE', publishStatus: 'UNLISTED', platformPublishedVersion: null, platformPublishedAt: null } });
      await tx.episode.updateMany({ where: { albumId: album.id }, data: { status: 'OFFLINE' } });
      await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { status: result.status } }, now);
    });
    return;
  }
  const queried = await api.queryAlbum({ albumId: album.tiktokAlbumId });
  const state = queried.data;
  const currentVersion = numberValue(state.current_version);
  const onlineVersion = numberValue(state.online_version);
  const isPublished = published(state.publish_status);
  const isPassed = reviewPassed(state.review_status);
  const platformEpisodes = Array.isArray(state.episode_info_list) ? state.episode_info_list.map(record) : [];
  const missingVideoEpisodeIds = platformEpisodes
    .filter((episode) => typeof episode.exception_reason === 'string' && episode.exception_reason.trim())
    .map((episode) => stringify(episode.episode_id))
    .filter((episodeId): episodeId is string => Boolean(episodeId));
  const locallyPlayable = Boolean(isPublished && isPassed && onlineVersion);
  await (prisma.$transaction as any)(async (tx: Db) => {
    await tx.album.update({ where: { id: album.id }, data: {
      ...(currentVersion ? { tiktokVersion: currentVersion } : {}),
      ...(onlineVersion ? { onlineVersion } : {}),
      reviewStatus: isPassed ? 'PASSED' : stringify(state.review_status) ?? null,
      publishStatus: isPublished ? 'LISTED' : stringify(state.publish_status) ?? 'UNLISTED',
      status: locallyPlayable ? 'ONLINE' : 'OFFLINE',
      platformPublishedVersion: locallyPlayable ? onlineVersion : null,
      platformPublishedAt: locallyPlayable ? now : null
    } });
    await tx.episode.updateMany({
      where: { albumId: album.id },
      data: { status: locallyPlayable ? 'ONLINE' : 'OFFLINE' }
    });
    if (missingVideoEpisodeIds.length) {
      await tx.episode.updateMany({
        where: { albumId: album.id, tiktokEpisodeId: { in: missingVideoEpisodeIds } },
        data: { status: 'OFFLINE', tiktokVideoStatus: 'FAILED', tiktokVideoError: 'TikTok reported that the BytePlus video was deleted.' }
      });
    }
    await completeJob(tx, job, { providerRequestId: queried.requestId, providerResponse: state }, now);
  });
}

async function processPlatformJob(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  if (job.kind === 'COVER') return processCover(prisma, api, job, now);
  if (job.kind === 'VIDEO') return processVideo(prisma, api, job, now);
  if (job.kind === 'ALBUM_VERSION') return processAlbumVersion(prisma, api, job, now);
  return processAlbumAction(prisma, api, job, now);
}

export async function processPlatformSyncJobs(prisma: Db, api: TikTokShortDramaApiService, workerOptions: WorkerOptions = {}) {
  const now = workerOptions.now ?? (() => new Date());
  const current = now();
  const maxRetries = workerOptions.maxRetries ?? defaultMaxRetries;
  const jobs = await prisma.platformSyncJob.findMany({
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
    const claim = await prisma.platformSyncJob.updateMany({
      where: pending.status === 'PENDING'
        ? { id: pending.id, status: 'PENDING' }
        : { id: pending.id, status: 'PROCESSING', startedAt: { lte: new Date(current.getTime() - staleProcessingMs) } },
      data: { status: 'PROCESSING', startedAt: current }
    });
    if (!claim.count) continue;
    const job = { ...pending, status: 'PROCESSING' };
    try {
      await processPlatformJob(prisma, api, job, current);
      workerOptions.log?.('TikTok platform sync job completed.', { jobId: job.id, kind: job.kind });
    } catch (error) {
      await failJob(prisma, job, error, current, maxRetries);
      const details = platformError(error);
      workerOptions.log?.('TikTok platform sync job failed.', {
        jobId: job.id,
        kind: job.kind,
        error: details.message,
        ...(details.code ? { errorCode: details.code } : {}),
        ...(details.requestId ? { requestId: details.requestId } : {})
      });
    }
  }
  return jobs.length;
}
