import type { PrismaClient } from '@prisma/client';
import { readVersionEpisodes } from './platform-version-episodes';

type Db = Pick<PrismaClient, 'album' | 'platformSyncJob'>;

type RejectedEpisode = {
  id: string;
  episodeNo: number;
  platformSeq: number;
  tiktokEpisodeId: string;
  reviewedByteplusVid: string;
  currentByteplusVid: string | null;
  reason: string;
  canStartReplacement: boolean;
};

type ReviewedEpisode = {
  id: string;
  episodeNo: number;
  platformSeq: number;
  title?: string;
  reviewStatus: string | null;
  reviewedByteplusVid: string | null;
  currentByteplusVid: string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRejected(value: unknown) {
  return ['3', '7', 'REJECTED', 'APPEAL_REJECTED'].includes(String(value ?? ''));
}

function isPassed(value: unknown) {
  return ['2', 'PASSED', 'APPROVED'].includes(String(value ?? ''));
}

function reviewStatus(...values: unknown[]) {
  const value = values.find((item) => item !== null && item !== undefined);
  return value === undefined ? null : String(value);
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export async function readRejectedEpisodeReplacements(db: Db, albumId: string) {
  const album = await db.album.findUnique({
    where: { id: albumId },
    select: {
      id: true, tiktokVersion: true, reviewStatus: true, status: true, publishStatus: true,
      episodes: { select: {
        id: true, episodeNo: true, tiktokEpisodeId: true, byteplusVid: true,
        byteplusUploadStatus: true, tiktokVideoStatus: true, status: true
      } }
    }
  });
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });
  const empty = (message: string) => ({ albumId, version: album.tiktokVersion, reconciledAt: null as Date | null,
    reconciliationJobId: null as string | null, versionSnapshotJobId: null as string | null,
    versionSnapshotAvailable: false, versionEpisodeCount: 0, reviewedEpisodes: [] as ReviewedEpisode[],
    items: [] as RejectedEpisode[], message });
  if (!isRejected(album.reviewStatus) || !album.tiktokVersion) return empty('当前版本没有已对账的审核驳回分集。');
  const reconciliation = await db.platformSyncJob.findFirst({
    where: { albumId, kind: 'RECONCILE', status: 'SUCCEEDED' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, providerResponse: true }
  });
  const result = object(reconciliation?.providerResponse);
  if (!reconciliation || Number(result.checked_version ?? result.current_version) !== album.tiktokVersion ||
      !isRejected(result.review_status) || !Array.isArray(result.episode_info_list)) {
    return empty('缺少当前驳回版本的完整分集对账结果，请先在平台任务中执行“对账”。');
  }
  const versionJob = await db.platformSyncJob.findFirst({
    where: { albumId, kind: 'ALBUM_VERSION', status: { in: ['SUCCEEDED', 'CONFLICT'] },
      providerResponse: { path: ['version'], equals: album.tiktokVersion } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, snapshotJson: true, providerResponse: true }
  });
  const versionEpisodes = readVersionEpisodes(versionJob?.snapshotJson, versionJob?.providerResponse);
  const platformEpisodes = result.episode_info_list.map(object);
  const failures = Array.isArray(result.episode_failures) ? result.episode_failures.map(object) : [];
  const reasons = Array.isArray(result.review_fail_reasons) ? result.review_fail_reasons.filter((item): item is string => typeof item === 'string') : [];
  const items: RejectedEpisode[] = [];
  const reviewedEpisodes: ReviewedEpisode[] = [];
  const versionMap = new Map(versionEpisodes.map((episode) => [episode.localEpisodeId, episode]));
  for (const episode of album.episodes) {
    const snapshotEpisode = versionMap.get(episode.id);
    const platformSeq = snapshotEpisode?.seq ?? episode.episodeNo;
    const platformEpisodeId = snapshotEpisode?.episode_id ?? episode.tiktokEpisodeId;
    if (!platformEpisodeId) continue;
    const platform = platformEpisodes.find((item) => string(item.episode_id) === platformEpisodeId && Number(item.seq) === platformSeq);
    if (!platform) continue;
    const failure = failures.find((item) => string(item.episode_id) === platformEpisodeId) ?? {};
    const status = reviewStatus(failure.review_status, object(failure.review_result).overall_review_status,
      platform.review_status, object(platform.review_result).overall_review_status);
    const reviewedByteplusVid = string(platform.byteplus_vid) ?? snapshotEpisode?.byteplus_vid ?? null;
    reviewedEpisodes.push({ id: episode.id, episodeNo: episode.episodeNo, platformSeq,
      ...(snapshotEpisode?.title ? { title: snapshotEpisode.title } : {}), reviewStatus: status,
      reviewedByteplusVid, currentByteplusVid: episode.byteplusVid });
    if (!isRejected(status)) continue;
    if (!reviewedByteplusVid) continue;
    const reason = string(failure.exception_reason) ?? string(platform.exception_reason)
      ?? reasons.find((item) => item.includes(platformEpisodeId)) ?? 'TikTok 标记该集审核驳回。';
    items.push({
      id: episode.id,
      episodeNo: episode.episodeNo,
      platformSeq,
      tiktokEpisodeId: platformEpisodeId,
      reviewedByteplusVid,
      currentByteplusVid: episode.byteplusVid,
      reason,
      canStartReplacement: episode.byteplusVid === reviewedByteplusVid &&
        episode.byteplusUploadStatus === 'READY' && episode.tiktokVideoStatus !== 'PROCESSING' &&
        episode.status !== 'ONLINE' && album.status !== 'ONLINE' && album.publishStatus !== 'LISTED'
    });
  }
  items.sort((left, right) => left.episodeNo - right.episodeNo);
  return { albumId, version: album.tiktokVersion, reconciledAt: reconciliation.completedAt,
    reconciliationJobId: reconciliation.id, versionSnapshotJobId: versionJob?.id ?? null,
    versionSnapshotAvailable: versionEpisodes.length > 0, versionEpisodeCount: versionEpisodes.length, reviewedEpisodes,
    items, message: items.length ? null : '对账没有返回可定位的驳回分集；请核对平台原始审核结果。' };
}

export async function assertRejectedEpisodeReplacement(
  db: Db, albumId: string, episodeId: string, expectedVid: string, expectedUploadStatus: 'READY' | 'UPLOADING'
) {
  const report = await readRejectedEpisodeReplacements(db, albumId);
  if (report.message) throw conflict(report.message);
  const episode = report.items.find((item) => item.id === episodeId);
  if (!episode) throw conflict('该集不在当前版本的审核驳回分集清单中，不能替换视频。');
  if (episode.reviewedByteplusVid !== expectedVid || episode.currentByteplusVid !== expectedVid) {
    throw conflict('该集视频已更换或与审核版本不一致，请刷新后重新对账。');
  }
  const current = await db.album.findUnique({
    where: { id: albumId },
    select: { status: true, publishStatus: true,
      episodes: { where: { id: episodeId }, select: { status: true, byteplusUploadStatus: true, tiktokVideoStatus: true } } }
  });
  if (current?.status === 'ONLINE' || current?.publishStatus === 'LISTED' || current?.episodes[0]?.status === 'ONLINE') {
    throw conflict('剧目或分集仍在线上，不能直接覆盖当前视频。');
  }
  if (current?.episodes[0]?.byteplusUploadStatus !== expectedUploadStatus ||
      current.episodes[0].tiktokVideoStatus === 'PROCESSING') {
    throw conflict('该集正在上传或同步视频，请等待任务结束后再操作。');
  }
  const active = await db.platformSyncJob.findFirst({
    where: { OR: [{ episodeId }, { albumId, kind: { not: 'VIDEO' } }], status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true }
  });
  const unresolved = await db.platformSyncJob.findFirst({
    where: { OR: [{ episodeId }, { albumId, kind: { not: 'VIDEO' } }], status: 'CONFLICT',
      completedAt: { gt: report.reconciledAt ?? new Date(0) } },
    select: { id: true }
  });
  if (active || unresolved) throw conflict('该剧仍有平台任务或待对账冲突，请先完成平台对账。');
  return episode;
}
