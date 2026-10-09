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

function retiredWorkflow(message: string) {
  return Object.assign(workflowConflict(message), { retiredWorkflow: true });
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
const ambiguousReplayKinds: PlatformSyncKind[] = ['ALBUM_VERSION', 'REVIEW', 'SET_ONLINE_VERSION', 'PUBLISH', 'UNPUBLISH'];

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
    const mediaScopeConflict = /video already exists with a different media scope/i.test(error.message);
    return {
      code: error.code,
      message: mediaScopeConflict
        ? `TikTok 拒绝在当前小程序重复登记此 BytePlus VID（video already exists with a different media scope）。需要目标作用域的新 VID，或改走剧目授权；重复同步无效。`
        : error.message,
      requestId: error.requestId,
      retryable: mediaScopeConflict ? false : error.retryable
    };
  }
  if (error instanceof TikTokShortDramaNotConfiguredError) return { message: error.message, retryable: false };
  return { message: error instanceof Error ? error.message.slice(0, 500) : 'TikTok platform sync failed.', retryable: false };
}

function uncertainLocalSave() {
  return new TikTokShortDramaApiError('平台已接受操作，但本地状态保存失败；请先对账。', undefined, undefined, true);
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

function mappedEpisodeId(map: Record<string, unknown>, episode: AlbumSnapshot['episodes'][number], usePreviousId: boolean) {
  const keys = [
    ...(usePreviousId && episode.episode_id ? [episode.episode_id] : []),
    `seq_${episode.seq}`,
    `seq:${episode.seq}`
  ];
  return keys.map((key) => stringify(map[key])?.trim()).find(Boolean)
    ?? (usePreviousId ? episode.episode_id : undefined);
}

function resolvedEpisodeIds(snapshot: AlbumSnapshot, map: Record<string, unknown>, usePreviousIds: boolean) {
  const ids = snapshot.episodes.map((episode) => mappedEpisodeId(map, episode, usePreviousIds));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (typeof item === 'number') return [String(item)];
    return [];
  });
}

function episodeFailureDetails(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const episode = record(item);
    const exceptionReason = stringify(episode.exception_reason)?.trim();
    const reviewResult = record(episode.review_result);
    const reviewStatus = reviewResult.overall_review_status;
    const rejected = reviewStatus === 3 || reviewStatus === '3' || reviewStatus === 7 || reviewStatus === '7' || reviewStatus === 'REJECTED' || reviewStatus === 'APPEAL_REJECTED';
    if (!exceptionReason && !rejected) return [];
    return [{
      episode_id: stringify(episode.episode_id),
      seq: numberValue(episode.seq),
      title: stringify(episode.title),
      exception_reason: exceptionReason,
      review_status: stringify(reviewStatus),
      review_result: reviewResult
    }];
  });
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
  const missingVideos = album.episodes.filter((episode: any) => !episode.byteplusVid || episode.tiktokVideoStatus !== 'READY');
  if (missingVideos.length) {
    const episodeNumbers = missingVideos.map((episode: any) => episode.episodeNo).join('、');
    throw workflowConflict(`第 ${episodeNumbers} 集视频尚未完成 TikTok 登记（共 ${missingVideos.length} 集）；请先同步媒资并等待任务成功。`);
  }
  const episodes = album.episodes.map((episode: any) => {
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
    if (input.kind === 'VIDEO' && /video already exists with a different media scope/i.test(existing.errorMessage ?? '')) {
      throw workflowConflict('此 BytePlus VID 已属于另一个 TikTok 媒资作用域，不能在当前小程序重复登记。需要目标作用域的新 VID，或改走剧目授权；重复点击同步无效。');
    }
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
        errorMessage: null,
        ...(input.snapshotJson ? { snapshotJson: input.snapshotJson as any } : {}),
        ...(record(input.snapshotJson).uploadMode === 'URL' ? { providerJobId: null, providerResponse: {} } : {})
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
  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { reviewStatus: true } });
  if (['REVIEWING', '1'].includes(album?.reviewStatus ?? '')) throw workflowConflict('当前版本正在审核，请等待审核结束后再同步新版本。');
  const snapshot = await buildAlbumSnapshot(prisma, albumId);
  const snapshotHash = hashSnapshot({ ...snapshot, episodes: snapshot.episodes.map(({ episode_id: _platformId, ...episode }) => episode) });
  const active = await prisma.platformSyncJob.findFirst({ where: { albumId, kind: 'ALBUM_VERSION', status: { in: ['PENDING', 'PROCESSING'] } } });
  if (active) {
    if (active.snapshotHash !== snapshotHash) throw workflowConflict('已有不同内容的版本同步任务在处理，请等待完成后重试。');
    return active;
  }
  await requireReconciledConflict(prisma, albumId, 'ALBUM_VERSION');
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

async function requireReconciledConflict(prisma: Db, albumId: string, kind: PlatformSyncKind) {
  const conflict = await prisma.platformSyncJob.findFirst({ where: { albumId, kind, status: 'CONFLICT' }, orderBy: { createdAt: 'desc' } });
  if (!conflict) return;
  const reconciliation = await prisma.platformSyncJob.findFirst({
    where: { albumId, kind: 'RECONCILE', status: 'SUCCEEDED', completedAt: { gt: conflict.completedAt ?? conflict.createdAt } },
    orderBy: { completedAt: 'desc' }
  });
  if (!reconciliation) throw workflowConflict('上一次平台操作结果未知，请先对账，再决定是否提交新任务。');
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

export async function enqueueAlbumAction(prisma: Db, kind: Extract<PlatformSyncKind, 'REVIEW' | 'SET_ONLINE_VERSION' | 'PUBLISH' | 'UNPUBLISH' | 'RECONCILE'>, albumId: string, createdByAdminUserId?: string, priorityScore: 1 | 2 = 2) {
  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { id: true, tiktokVersion: true, onlineVersion: true, tiktokAlbumId: true, reviewStatus: true, publishStatus: true, platformPublishedVersion: true } });
  if (!album?.tiktokAlbumId) throw workflowConflict('剧目尚未同步至 TikTok，请先执行“同步版本”。');
  if (kind === 'REVIEW' && ['REVIEWING', '1'].includes(album.reviewStatus ?? '')) throw workflowConflict('当前版本已在审核中，不能通过重复送审改为加急；请对账查询结果或联系 TikTok 平台支持。');
  if (kind === 'REVIEW' && ['PASSED', '2'].includes(album.reviewStatus ?? '')) throw workflowConflict('当前版本已审核通过，无需重复送审。');
  if (kind === 'REVIEW' && ['REJECTED', '3'].includes(album.reviewStatus ?? '')) throw workflowConflict('当前版本审核未通过；请修正内容并同步新版本后再送审。');
  if (kind === 'SET_ONLINE_VERSION' && album.onlineVersion === album.tiktokVersion) throw workflowConflict('当前版本已经是线上版本。');
  if (kind === 'PUBLISH' && album.publishStatus === 'LISTED') throw workflowConflict('剧集已上架；切换新线上版本后请先对账，无需重复上架。');
  const version = kind === 'SET_ONLINE_VERSION' || kind === 'REVIEW' ? album.tiktokVersion : album.onlineVersion ?? album.tiktokVersion;
  if (['REVIEW', 'SET_ONLINE_VERSION'].includes(kind) && !version) throw workflowConflict('剧目尚无可操作的 TikTok 版本，请先执行“同步版本”。');
  const snapshot = { albumId, platformAlbumId: album.tiktokAlbumId, version, ...(kind === 'REVIEW' ? { priorityScore } : {}) };
  const active = await prisma.platformSyncJob.findFirst({
    where: { kind, albumId, status: { in: ['PENDING', 'PROCESSING'] }, ...(kind === 'REVIEW' ? {} : { snapshotHash: hashSnapshot(snapshot) }) },
    orderBy: { createdAt: 'desc' }
  });
  if (active) {
    if (kind === 'REVIEW' && (active.snapshotJson as { priorityScore?: number } | null)?.priorityScore !== priorityScore) throw workflowConflict('已有不同优先级的送审任务在处理，请等待结果，勿重复送审。');
    return active;
  }
  if (kind !== 'RECONCILE') await requireReconciledConflict(prisma, albumId, kind);
  if (kind === 'REVIEW') {
    const submitted = await prisma.platformSyncJob.findFirst({ where: { kind: 'REVIEW', albumId, status: 'SUCCEEDED', snapshotJson: { path: ['version'], equals: version! } } });
    if (submitted) throw workflowConflict('当前版本已经送审；请对账查询结果，修改内容后须先同步新版本。');
  }
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

export async function enqueueDueReviewReconciliations(prisma: Db, now = new Date(), onError?: (albumId: string, error: unknown) => void) {
  const reviewing = await prisma.album.findMany({
    where: { reviewStatus: { in: ['REVIEWING', '1'] }, tiktokAlbumId: { not: null } },
    select: { id: true, tiktokVersion: true },
    orderBy: { updatedAt: 'asc' },
    take: 20
  });
  let queued = 0;
  for (const album of reviewing) {
    try {
      if (!album.tiktokVersion) continue;
      const submitted = await prisma.platformSyncJob.findFirst({ where: { albumId: album.id, kind: 'REVIEW', status: 'SUCCEEDED', snapshotJson: { path: ['version'], equals: album.tiktokVersion } } });
      if (!submitted) continue;
      const recent = await prisma.platformSyncJob.findFirst({ where: { albumId: album.id, kind: 'RECONCILE', createdAt: { gte: new Date(now.getTime() - 10 * 60_000) } } });
      if (recent) continue;
      await enqueueAlbumAction(prisma, 'RECONCILE', album.id);
      queued += 1;
    } catch (error) {
      onError?.(album.id, error);
    }
  }
  return queued;
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
  const urlUpload = job.kind === 'VIDEO' && job.snapshotJson?.uploadMode === 'URL';
  const urlUncertain = urlUpload && (!job.providerJobId || attemptCount > maxRetries || details.code === 'URL_UPLOAD_UNCONFIRMED');
  const ambiguousAction = (ambiguousReplayKinds.includes(job.kind) || urlUncertain) && details.retryable;
  const retry = !ambiguousAction && details.retryable && attemptCount <= maxRetries;
  await prisma.platformSyncJob.update({
    where: { id: job.id },
    data: {
      status: ambiguousAction ? 'CONFLICT' : retry ? 'PENDING' : 'FAILED',
      attemptCount,
      nextAttemptAt: retry ? new Date(now.getTime() + retryDelayMs(attemptCount)) : null,
      completedAt: retry ? null : now,
      errorCode: details.code ?? null,
      errorMessage: ambiguousAction ? `${details.message} ${urlUpload ? '上传结果未确认，保留 job_id/请求 ID，请核实平台上传任务；勿重新提交上传。' : '平台操作结果未知，已停止自动重试；请先执行平台对账。'}` : details.message,
      providerRequestId: details.requestId ?? undefined
    }
  });
  if (job.kind === 'COVER' && job.coverAssetId) await prisma.coverAsset.update({ where: { id: job.coverAssetId }, data: { platformSyncError: details.message } });
  if (job.kind === 'VIDEO' && job.episodeId && !record(error).retiredWorkflow) await prisma.episode.update({ where: { id: job.episodeId }, data: { tiktokVideoStatus: 'FAILED', tiktokVideoError: details.message } });
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
  if (job.snapshotJson?.uploadMode === 'URL') throw retiredWorkflow('多小程序独立上传已停用；保留历史 job_id 和 VID，请核实已受理的平台任务，不再重复上传。');
  const episode = await prisma.episode.findUnique({ where: { id: job.episodeId ?? job.targetId }, select: { id: true, title: true, byteplusVid: true, tiktokVideoJobId: true, tiktokVideoStatus: true, album: { select: { id: true } } } });
  if (episode?.album?.id?.startsWith('release_')) throw retiredWorkflow('旧独立发布目标已停用，请改用主剧目授权播放。');
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
  const album = await prisma.album.findUnique({ where: { id: job.albumId ?? job.targetId }, select: { id: true, tiktokAlbumId: true, tiktokVersion: true, onlineVersion: true, publishStatus: true } });
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
  const episodeIds = resolvedEpisodeIds(snapshot, result.episodeIdMap, !createdForJob);
  if (!episodeIds) {
    await prisma.platformSyncJob.update({ where: { id: job.id }, data: {
      status: 'CONFLICT',
      completedAt: now,
      nextAttemptAt: null,
      providerRequestId: result.requestId,
      providerResponse: { version: result.version, platform_album_id: platformAlbumId, episode_id_map: result.episodeIdMap },
      errorMessage: 'TikTok 已创建版本，但返回的分集 ID 映射缺失或重复。请先对账恢复分集 ID，勿重复同步版本。'
    } });
    return;
  }
  try {
    await (prisma.$transaction as any)(async (tx: Db) => {
      await tx.album.update({ where: { id: album.id }, data: {
        tiktokAlbumId: platformAlbumId!,
        tiktokVersion: result.version,
        reviewStatus: null,
        publishStatus: album.onlineVersion ? album.publishStatus : stringify(result.publishStatus) ?? null,
        ...(recreatedAlbum ? { onlineVersion: null, platformPublishedVersion: null, platformPublishedAt: null, reviewStatus: null } : {})
      } });
      await Promise.all(snapshot.episodes.map((episode, index) => {
        return tx.episode.update({ where: { id: episode.localEpisodeId }, data: { tiktokEpisodeId: episodeIds[index], tiktokCoverPicId: episode.cover_list[0] } });
      }));
      await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { version: result.version, platform_album_id: platformAlbumId, episode_id_map: result.episodeIdMap } }, now);
    });
  } catch {
    throw uncertainLocalSave();
  }
}

async function activateOnlineEpisodes(prisma: Db, albumId: string, version: number, requireSnapshot = false) {
  const versionJob = await prisma.platformSyncJob.findFirst({
    where: { albumId, kind: 'ALBUM_VERSION', status: 'SUCCEEDED', providerResponse: { path: ['version'], equals: version } },
    orderBy: { createdAt: 'desc' }
  });
  const snapshot = versionJob?.snapshotJson as AlbumSnapshot | null;
  if (!snapshot?.episodes?.length) {
    if (requireSnapshot) throw workflowConflict('找不到线上版本对应的分集快照，请先对账，不可开放新分集。');
    return;
  }
  const episodeIds = snapshot.episodes.map((episode) => episode.localEpisodeId);
  await prisma.episode.updateMany({ where: { albumId }, data: { status: 'OFFLINE' } });
  await prisma.episode.updateMany({ where: { albumId, id: { in: episodeIds }, tiktokVideoStatus: 'READY', tiktokEpisodeId: { not: null } }, data: { status: 'ONLINE' } });
}

async function episodeIdRepairs(prisma: Db, album: { id: string; tiktokAlbumId: string }, version: number | undefined, platformEpisodes: Record<string, unknown>[]) {
  if (!version) return [];
  const versionJob = await prisma.platformSyncJob.findFirst({
    where: { albumId: album.id, kind: 'ALBUM_VERSION', status: { in: ['SUCCEEDED', 'CONFLICT'] }, providerResponse: { path: ['version'], equals: version } },
    orderBy: { createdAt: 'desc' }
  });
  const response = platformResponse(versionJob?.providerResponse);
  const snapshot = versionJob?.snapshotJson as AlbumSnapshot | null;
  if (!snapshot?.episodes?.length || !Object.keys(record(response.episode_id_map)).length) return [];
  if (response.platform_album_id && response.platform_album_id !== album.tiktokAlbumId) throw workflowConflict('版本任务所属 TikTok 剧目与当前剧目不一致，不能恢复分集 ID。');
  const ids = resolvedEpisodeIds(snapshot, record(response.episode_id_map), true);
  if (!ids) throw workflowConflict('版本任务中的分集 ID 映射不完整或重复，不能自动恢复。');
  const localEpisodes = await prisma.episode.findMany({ where: { albumId: album.id }, select: { id: true, episodeNo: true, byteplusVid: true, tiktokEpisodeId: true } });
  if (snapshot.episodes.every((episode) => localEpisodes.some((local: any) => local.id === episode.localEpisodeId && local.tiktokEpisodeId))) return [];
  if (platformEpisodes.length !== snapshot.episodes.length) throw workflowConflict('版本快照与 TikTok 平台的分集数量不一致，不能自动恢复分集 ID。');
  const platformBySeq = new Map(platformEpisodes.map((episode) => [numberValue(episode.seq), episode]));
  const localById = new Map(localEpisodes.map((episode: any) => [episode.id, episode]));
  const repairs: Array<{ id: string; episodeNo: number; byteplusVid: string; tiktokEpisodeId: string }> = [];
  for (const [index, episode] of snapshot.episodes.entries()) {
    const local = localById.get(episode.localEpisodeId) as { episodeNo: number; byteplusVid: string | null; tiktokEpisodeId: string | null } | undefined;
    const platform = platformBySeq.get(episode.seq);
    const expectedId = ids[index];
    if (!local || local.episodeNo !== episode.seq || local.byteplusVid !== episode.byteplus_vid
      || !platform || stringify(platform.episode_id) !== expectedId
      || (stringify(platform.byteplus_vid) && stringify(platform.byteplus_vid) !== episode.byteplus_vid)
      || (local.tiktokEpisodeId && local.tiktokEpisodeId !== expectedId)) {
      throw workflowConflict(`第 ${episode.seq} 集的本地数据与 TikTok 当前版本不一致，不能自动恢复分集 ID。`);
    }
    if (!local.tiktokEpisodeId) repairs.push({ id: episode.localEpisodeId, episodeNo: episode.seq, byteplusVid: episode.byteplus_vid, tiktokEpisodeId: expectedId });
  }
  return repairs;
}

async function processAlbumAction(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  const album = await prisma.album.findUnique({ where: { id: job.albumId ?? job.targetId }, select: { id: true, tiktokAlbumId: true, tiktokVersion: true, onlineVersion: true, reviewStatus: true, publishStatus: true, platformPublishedVersion: true } });
  if (!album?.tiktokAlbumId) throw new Error('剧目尚未同步至 TikTok。');
  if (job.kind === 'REVIEW') {
    if (!album.tiktokVersion) throw new Error('剧目尚无可送审的 TikTok 版本。');
    const snapshot = job.snapshotJson as { platformAlbumId?: string; version?: number; priorityScore?: number } | null;
    if ((snapshot?.platformAlbumId && snapshot.platformAlbumId !== album.tiktokAlbumId) || (snapshot?.version && snapshot.version !== album.tiktokVersion)) throw workflowConflict('送审排队后剧目版本已变化，请对账后重新确认送审。');
    const priorityScore = snapshot?.priorityScore === 1 ? 1 : 2;
    const result = await api.submitReview({ albumId: album.tiktokAlbumId, version: album.tiktokVersion, priorityScore });
    try {
      await (prisma.$transaction as any)(async (tx: Db) => {
        await tx.album.update({ where: { id: album.id }, data: { status: album.platformPublishedVersion ? 'ONLINE' : 'REVIEWING', reviewStatus: 'REVIEWING' } });
        await completeJob(tx, job, {
          providerRequestId: result.requestId,
          providerResponse: {
            review_id: result.reviewId,
            version: album.tiktokVersion,
            priority_score: priorityScore,
            review_status: '1'
          }
        }, now);
      });
    } catch {
      throw uncertainLocalSave();
    }
    return;
  }
  if (job.kind === 'SET_ONLINE_VERSION') {
    if (!album.tiktokVersion) throw new Error('剧目尚无可设为线上版本的 TikTok 版本。');
    const snapshot = job.snapshotJson as { version?: number } | null;
    if (snapshot?.version !== album.tiktokVersion) throw workflowConflict('设线上版本排队后剧目版本已变化，请重新确认。');
    const queried = await api.queryAlbum({ albumId: album.tiktokAlbumId, version: album.tiktokVersion });
    const status = queried.data.review_status;
    if (!reviewPassed(status)) throw new Error('TikTok 审核尚未通过，不能设置线上版本。');
    if (album.publishStatus === 'LISTED') {
      const versionJob = await prisma.platformSyncJob.findFirst({ where: { albumId: album.id, kind: 'ALBUM_VERSION', status: 'SUCCEEDED', providerResponse: { path: ['version'], equals: album.tiktokVersion } } });
      if (!(versionJob?.snapshotJson as AlbumSnapshot | null)?.episodes?.length) throw workflowConflict('找不到新版本分集快照，请先对账，不能切换线上版本。');
    }
    const result = await api.setOnlineVersion({ albumId: album.tiktokAlbumId, version: album.tiktokVersion });
    try {
      await (prisma.$transaction as any)(async (tx: Db) => {
        await tx.album.update({ where: { id: album.id }, data: {
          onlineVersion: result.onlineVersion,
          reviewStatus: 'PASSED'
        } });
        await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { online_version: result.onlineVersion } }, now);
      });
    } catch {
      throw uncertainLocalSave();
    }
    return;
  }
  if (job.kind === 'PUBLISH') {
    if (!album.onlineVersion) throw new Error('剧目尚未设置线上版本。');
    const snapshot = job.snapshotJson as { version?: number } | null;
    if (snapshot?.version !== album.onlineVersion) throw workflowConflict('上架排队后线上版本已变化，请重新确认。');
    const online = await api.queryAlbum({ albumId: album.tiktokAlbumId, version: album.onlineVersion });
    if (!reviewPassed(online.data.review_status)) throw new Error('线上版本尚未审核通过，不能上架。');
    const versionJob = await prisma.platformSyncJob.findFirst({ where: { albumId: album.id, kind: 'ALBUM_VERSION', status: 'SUCCEEDED', providerResponse: { path: ['version'], equals: album.onlineVersion } } });
    if (!versionJob) throw workflowConflict('找不到线上版本快照，请先对账。');
    const result = await api.setAlbumStatus({ albumId: album.tiktokAlbumId, status: 1 });
    try {
      await (prisma.$transaction as any)(async (tx: Db) => {
        await tx.album.update({ where: { id: album.id }, data: { status: 'ONLINE', publishStatus: 'LISTED', platformPublishedVersion: album.onlineVersion, platformPublishedAt: now } });
        await activateOnlineEpisodes(tx, album.id, album.onlineVersion!);
        await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { status: result.status } }, now);
      });
    } catch {
      throw uncertainLocalSave();
    }
    return;
  }
  if (job.kind === 'UNPUBLISH') {
    const result = await api.setAlbumStatus({ albumId: album.tiktokAlbumId, status: 2 });
    try {
      await (prisma.$transaction as any)(async (tx: Db) => {
        await tx.album.update({ where: { id: album.id }, data: { status: 'OFFLINE', publishStatus: 'UNLISTED', platformPublishedVersion: null, platformPublishedAt: null } });
        await tx.episode.updateMany({ where: { albumId: album.id }, data: { status: 'OFFLINE' } });
        await completeJob(tx, job, { providerRequestId: result.requestId, providerResponse: { status: result.status } }, now);
      });
    } catch {
      throw uncertainLocalSave();
    }
    return;
  }
  const queried = await api.queryAlbum({ albumId: album.tiktokAlbumId });
  const state = queried.data;
  const currentVersion = numberValue(state.current_version);
  const onlineVersion = numberValue(state.online_version);
  const isPublished = published(state.publish_status);
  const isPassed = reviewPassed(state.review_status);
  if (isPublished && !onlineVersion) throw new TikTokShortDramaApiError('平台对账未返回线上版本，稍后重试。', undefined, queried.requestId, true);
  const onlineReview = onlineVersion && onlineVersion !== currentVersion
    ? await api.queryAlbum({ albumId: album.tiktokAlbumId, version: onlineVersion })
    : queried;
  if (isPublished && onlineReview.data.review_status == null) throw new TikTokShortDramaApiError('平台对账未返回线上版本审核状态，稍后重试。', undefined, onlineReview.requestId, true);
  const isOnlinePassed = reviewPassed(onlineReview.data.review_status);
  const platformEpisodes = Array.isArray(onlineReview.data.episode_info_list) ? onlineReview.data.episode_info_list.map(record) : [];
  const currentEpisodes = Array.isArray(state.episode_info_list) ? state.episode_info_list.map(record) : [];
  const repairs = await episodeIdRepairs(prisma, { id: album.id, tiktokAlbumId: album.tiktokAlbumId }, currentVersion, currentEpisodes);
  const reviewFailReasons = stringList(state.review_fail_reasons);
  const onlineReviewFailReasons = stringList(onlineReview.data.review_fail_reasons);
  const episodeFailures = episodeFailureDetails(currentEpisodes);
  const onlineEpisodeFailures = onlineVersion && onlineVersion !== currentVersion ? episodeFailureDetails(platformEpisodes) : [];
  const missingVideoEpisodeIds = platformEpisodes
    .filter((episode) => typeof episode.exception_reason === 'string' && episode.exception_reason.trim())
    .map((episode) => stringify(episode.episode_id))
    .filter((episodeId): episodeId is string => Boolean(episodeId));
  const locallyPlayable = Boolean(isPublished && isOnlinePassed && onlineVersion);
  await (prisma.$transaction as any)(async (tx: Db) => {
    for (const repair of repairs) {
      const updated = await tx.episode.updateMany({ where: { id: repair.id, albumId: album.id, episodeNo: repair.episodeNo, byteplusVid: repair.byteplusVid, tiktokEpisodeId: null }, data: { tiktokEpisodeId: repair.tiktokEpisodeId } });
      if (updated.count !== 1) throw workflowConflict('分集在对账期间发生变化，未写入任何分集 ID；请重新对账。');
    }
    await tx.album.update({ where: { id: album.id }, data: {
      ...(currentVersion ? { tiktokVersion: currentVersion } : {}),
      ...(onlineVersion ? { onlineVersion } : {}),
      reviewStatus: isPassed ? 'PASSED' : stringify(state.review_status) ?? null,
      publishStatus: isPublished ? 'LISTED' : stringify(state.publish_status) ?? 'UNLISTED',
      status: locallyPlayable ? 'ONLINE' : 'OFFLINE',
      platformPublishedVersion: locallyPlayable ? onlineVersion : null,
      platformPublishedAt: locallyPlayable ? now : null
    } });
    if (locallyPlayable) await activateOnlineEpisodes(tx, album.id, onlineVersion!);
    else await tx.episode.updateMany({ where: { albumId: album.id }, data: { status: 'OFFLINE' } });
    if (missingVideoEpisodeIds.length) {
      await tx.episode.updateMany({
        where: { albumId: album.id, tiktokEpisodeId: { in: missingVideoEpisodeIds } },
        data: { status: 'OFFLINE', tiktokVideoStatus: 'FAILED', tiktokVideoError: 'TikTok reported that the BytePlus video was deleted.' }
      });
    }
    await completeJob(tx, job, {
      providerRequestId: queried.requestId,
      providerResponse: {
        ...state,
        checked_version: numberValue(state.version) ?? currentVersion,
        review_status: state.review_status,
        review_fail_reasons: reviewFailReasons,
        online_review_status: onlineReview.data.review_status,
        online_review_fail_reasons: onlineReviewFailReasons,
        episode_failures: episodeFailures,
        online_episode_failures: onlineEpisodeFailures,
        repaired_episode_ids: repairs.length,
        episode_info_list: currentEpisodes
      }
    }, now);
  });
}

async function processPlatformJob(prisma: Db, api: TikTokShortDramaApiService, job: any, now: Date) {
  if (job.albumId?.startsWith('release_')) throw retiredWorkflow('旧独立发布任务已停用，保留历史记录，不再自动发布或送审。');
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
    if (pending.status === 'PROCESSING' && (ambiguousReplayKinds.includes(pending.kind) || (record(pending.snapshotJson).uploadMode === 'URL' && !pending.providerJobId && !record(pending.providerResponse).vid))) {
      await prisma.platformSyncJob.update({ where: { id: pending.id }, data: {
        status: 'CONFLICT',
        completedAt: current,
        nextAttemptAt: null,
        errorMessage: '平台操作执行中断，结果未知；已停止自动重放，请先对账。'
      } });
      continue;
    }
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
