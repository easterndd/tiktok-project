import type { PrismaClient } from '@prisma/client';
import { readRejectedEpisodeReplacements } from './rejected-episode-replacement.service';

type EpisodeRow = {
  id: string;
  episodeNo: number;
  title: string;
  byteplusVid: string | null;
  byteplusUploadStatus: string;
  tiktokVideoStatus: string;
};

type Db = Pick<PrismaClient, 'album' | 'platformSyncJob' | 'uploadJob'>;

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function storedIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw conflict('已保存的版本分集清单格式无效，请联系管理员检查。');
  }
  return value as string[];
}

function presentPlan(episodes: EpisodeRow[], ids: string[], rejectedIds: Set<string>, persisted: boolean) {
  const byId = new Map(episodes.map((episode) => [episode.id, episode]));
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw conflict('版本分集清单与当前剧集不一致，请重新生成清单。');
  }
  const included = ids.map((id, index) => ({ ...byId.get(id)!, submissionSeq: index + 1 }));
  const includedIds = new Set(ids);
  const excluded = episodes.filter((episode) => !includedIds.has(episode.id)).map((episode) => ({
    ...episode,
    reason: rejectedIds.has(episode.id) ? '当前审核版本已驳回，已从新版本排除。' : '未包含在当前提交清单中。'
  }));
  return { included, excluded, persisted };
}

async function readAlbumAndRejections(db: Db, albumId: string) {
  const album = await db.album.findUnique({ where: { id: albumId }, select: {
    id: true,
    reviewStatus: true,
    status: true,
    publishStatus: true,
    platformEpisodePlan: true,
    episodes: { orderBy: { episodeNo: 'asc' }, select: {
      id: true, episodeNo: true, title: true, byteplusVid: true,
      byteplusUploadStatus: true, tiktokVideoStatus: true
    } }
  } }) as null | { id: string; reviewStatus: string | null; status: string; publishStatus: string | null; platformEpisodePlan: unknown; episodes: EpisodeRow[] };
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });
  const rejected = await readRejectedEpisodeReplacements(db, albumId);
  const rejectedVersion = ['3', '7', 'REJECTED', 'APPEAL_REJECTED'].includes(String(album.reviewStatus ?? ''));
  const rejectedIds = new Set(rejected.items.map((item) => item.id));
  if (rejectedVersion && (!rejected.reconciliationJobId || rejected.message || !rejected.items.length)) {
    throw conflict(rejected.message ?? '当前驳回版本没有可核实的分集清单，请先完成平台对账。');
  }
  return { album, rejected, rejectedIds };
}

export async function readAlbumSubmissionPlan(db: Db, albumId: string) {
  try {
    const { album, rejected, rejectedIds } = await readAlbumAndRejections(db, albumId);
    const saved = storedIds(album.platformEpisodePlan);
    const ids = saved ?? album.episodes.filter((episode) => !rejectedIds.has(episode.id)).map((episode) => episode.id);
    if (!ids.length) return { albumId, reviewedVersion: rejectedVersionNumber(album.reviewStatus) ? rejected.version : null,
      included: [], excluded: album.episodes, persisted: false, message: '新版本至少需要包含一集。' };
    return {
      albumId,
      reviewedVersion: rejectedVersionNumber(album.reviewStatus) ? rejected.version : null,
      ...presentPlan(album.episodes, ids, rejectedIds, saved !== null)
    };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 409) throw error;
    return { albumId, reviewedVersion: null, included: [], excluded: [], persisted: false,
      message: error instanceof Error ? error.message : '无法读取当前版本分集清单。' };
  }
}

function rejectedVersionNumber(status: string | null) {
  return ['3', '7', 'REJECTED', 'APPEAL_REJECTED'].includes(String(status ?? ''));
}

export async function excludeRejectedAndSaveSubmissionPlan(db: Db, albumId: string) {
  const { album, rejected, rejectedIds } = await readAlbumAndRejections(db, albumId);
  if (!rejectedIds.size) throw conflict('当前审核版本没有可排除的驳回分集。');
  if (album.status === 'ONLINE' || album.publishStatus === 'LISTED' || album.publishStatus === '1') {
    throw conflict('剧目仍在线上，请先按平台流程下架后再调整版本分集。');
  }
  const [activePlatformJob, activeUploadJob] = await Promise.all([
    db.platformSyncJob.findFirst({ where: { albumId, status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true } }),
    db.uploadJob.findFirst({ where: { episode: { albumId }, status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true } })
  ]);
  if (activePlatformJob || activeUploadJob) throw conflict('剧目仍有平台任务或视频上传任务处理中，请完成后刷新再生成清单。');
  const kept = album.episodes.filter((episode) => !rejectedIds.has(episode.id));
  if (!kept.length) throw conflict('当前版本所有分集均被驳回，不能生成空的新版本。');
  const notReady = kept.filter((episode) => !episode.byteplusVid || episode.byteplusUploadStatus !== 'READY' || episode.tiktokVideoStatus !== 'READY');
  if (notReady.length) throw conflict(`保留分集的媒资尚未全部就绪：${notReady.map((episode) => `第 ${episode.episodeNo} 集`).join('、')}。`);
  const ids = kept.map((episode) => episode.id);
  await db.album.update({ where: { id: albumId }, data: { platformEpisodePlan: ids } });
  return {
    albumId,
    reviewedVersion: rejected.version,
    reconciliationJobId: rejected.reconciliationJobId,
    ...presentPlan(album.episodes, ids, rejectedIds, true)
  };
}

export function submissionIds(value: unknown, fallback: EpisodeRow[]) {
  const ids = storedIds(value) ?? fallback.map((episode) => episode.id);
  if (!ids.length || new Set(ids).size !== ids.length) throw conflict('版本分集清单为空或包含重复分集。');
  return ids;
}
