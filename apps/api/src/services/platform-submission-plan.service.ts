import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { readRejectedEpisodeReplacements } from './rejected-episode-replacement.service';
import { buildAlbumSnapshot, enqueuePlatformSyncJob, hashSnapshot } from './platform-sync.service';

type Db = PrismaClient & { [key: string]: any };
type PlanEpisode = {
  id: string;
  localEpisodeNo: number;
  sourcePlatformSeq: number;
  platformSeq: number;
  title: string;
  byteplusVid: string;
};
type PlanExcludedEpisode = { id: string; localEpisodeNo: number; sourcePlatformSeq: number; title: string; reason: string };

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRejected(value: unknown) {
  return ['3', '7', 'REJECTED', 'APPEAL_REJECTED'].includes(String(value ?? ''));
}

function planPayload(value: unknown) {
  const plan = object(value);
  return {
    included: Array.isArray(plan.included) ? plan.included as PlanEpisode[] : [],
    excluded: Array.isArray(plan.excluded) ? plan.excluded as PlanExcludedEpisode[] : []
  };
}

export async function readApprovedEpisodeSubmissionPlan(db: Db, albumId: string) {
  const report = await readRejectedEpisodeReplacements(db, albumId);
  const album = await db.album.findUnique({
    where: { id: albumId },
    select: { id: true, reviewStatus: true, tiktokVersion: true, coverAsset: { select: { providerImageId: true } },
      episodes: { select: { id: true, episodeNo: true, title: true, byteplusVid: true, byteplusUploadStatus: true,
        tiktokVideoStatus: true, coverAsset: { select: { providerImageId: true } } } } }
  });
  if (!album) throw Object.assign(new Error('剧目不存在。'), { statusCode: 404 });

  const emptyPlan = {
    albumId, sourceVersion: album.tiktokVersion, reconciliationJobId: report.reconciliationJobId,
    versionSnapshotJobId: report.versionSnapshotJobId, reconciledAt: report.reconciledAt, canSubmit: false,
    included: [] as PlanEpisode[], excluded: [] as PlanExcludedEpisode[], message: report.message
  };
  if (!isRejected(album.reviewStatus) || !album.tiktokVersion || !report.reconciliationJobId || !report.versionSnapshotAvailable) {
    return emptyPlan;
  }

  const rejectedById = new Map(report.items.map((episode: any) => [episode.id, episode]));
  const localById = new Map(album.episodes.map((episode: any) => [episode.id, episode]));
  const included: PlanEpisode[] = [];
  const excluded: PlanExcludedEpisode[] = [];
  const errors: string[] = [];
  const reviewed = [...report.reviewedEpisodes].sort((left: any, right: any) => left.platformSeq - right.platformSeq);
  if (!report.items.length) errors.push('当前审核版本没有可定位的驳回分集，不能生成排除计划');

  for (const episode of reviewed) {
    const local: any = localById.get(episode.id);
    if (!local) {
      errors.push(`本地第 ${episode.episodeNo} 集已不存在`);
      continue;
    }
    if (rejectedById.has(episode.id) || isRejected(episode.reviewStatus)) {
      const rejected: any = rejectedById.get(episode.id);
      excluded.push({ id: episode.id, localEpisodeNo: episode.episodeNo, sourcePlatformSeq: episode.platformSeq,
        title: local.title, reason: rejected?.reason ?? '当前审核版本已驳回' });
      continue;
    }
    if (!['2', 'PASSED', 'APPROVED'].includes(String(episode.reviewStatus ?? ''))) {
      excluded.push({ id: episode.id, localEpisodeNo: episode.episodeNo, sourcePlatformSeq: episode.platformSeq,
        title: local.title, reason: '当前审核版本未确认通过' });
      errors.push(`TikTok 尚未确认第 ${episode.episodeNo} 集通过`);
      continue;
    }
    if (!episode.reviewedByteplusVid || local.byteplusVid !== episode.reviewedByteplusVid ||
        local.byteplusUploadStatus !== 'READY' || local.tiktokVideoStatus !== 'READY') {
      errors.push(`第 ${episode.episodeNo} 集的本地 VID 与通过审核版本不一致，或媒资尚未就绪`);
      continue;
    }
    if (!(local.coverAsset?.providerImageId || album.coverAsset?.providerImageId)) {
      errors.push(`第 ${episode.episodeNo} 集没有可用的 TikTok 封面`);
      continue;
    }
    included.push({ id: episode.id, localEpisodeNo: episode.episodeNo, sourcePlatformSeq: episode.platformSeq,
      platformSeq: included.length + 1, title: local.title, byteplusVid: local.byteplusVid });
  }

  if (!included.length) errors.push('当前审核版本没有可提交的已通过分集');
  if (report.reviewedEpisodes.length !== report.versionEpisodeCount) {
    errors.push('对账结果与本地分集无法完整对应，请重新执行平台对账');
  }

  const unique = await db.platformEpisodePlan.findUnique({ where: {
    albumId_sourceVersion_sourceReconciliationJobId: {
      albumId, sourceVersion: album.tiktokVersion, sourceReconciliationJobId: report.reconciliationJobId
    }
  } });
  const stored = planPayload(unique?.planJson);
  const syncJob = unique?.syncJobId ? await db.platformSyncJob.findUnique({ where: { id: unique.syncJobId }, select: { id: true, status: true } }) : null;
  const submitted = unique && ['SYNC_QUEUED', 'SYNCED', 'ACTIVE'].includes(unique.status)
    && !(unique.status === 'SYNC_QUEUED' && syncJob?.status === 'FAILED');
  const message = submitted ? `提交计划状态：${unique.status}${syncJob ? `，版本任务 ${syncJob.status}` : ''}。` : errors.length ? errors.join('；') : null;
  return {
    ...emptyPlan,
    planId: unique?.id ?? null,
    status: unique?.status ?? 'READY',
    syncJob: syncJob ?? null,
    included: submitted ? stored.included : included,
    excluded: submitted ? stored.excluded : excluded,
    canSubmit: !submitted && errors.length === 0,
    message
  };
}

export async function enqueueApprovedEpisodeSubmissionPlan(db: Db, albumId: string, reconciliationJobId: string, createdByAdminUserId?: string) {
  const preview = await readApprovedEpisodeSubmissionPlan(db, albumId);
  if (preview.reconciliationJobId !== reconciliationJobId) throw conflict('审核对账结果已变化，请刷新计划预览后再提交。');
  if (!preview.canSubmit || !preview.sourceVersion || !preview.reconciliationJobId) {
    throw conflict(preview.message ?? '当前审核结果不能生成提交计划。');
  }

  const planJson = { included: preview.included, excluded: preview.excluded,
    sourceVersion: preview.sourceVersion, reconciliationJobId: preview.reconciliationJobId };
  const compound = { albumId_sourceVersion_sourceReconciliationJobId: {
    albumId, sourceVersion: preview.sourceVersion, sourceReconciliationJobId: reconciliationJobId
  } };
  let plan = await db.platformEpisodePlan.findUnique({ where: compound });
  if (plan && ['SYNC_QUEUED', 'SYNCED', 'ACTIVE'].includes(plan.status)) {
    const job = plan.syncJobId ? await db.platformSyncJob.findUnique({ where: { id: plan.syncJobId } }) : null;
    if (job && job.status !== 'FAILED') return { planId: plan.id, job, alreadyQueued: true };
    if (!job) throw conflict('提交计划已进入处理状态，但未找到对应平台任务；请先对账。');
    plan = { ...plan, status: 'FAILED' };
  }
  if (plan && !['DRAFT', 'READY', 'FAILED'].includes(plan.status)) throw conflict('当前提交计划状态不允许重复排队。');

  const planId = plan?.id ?? randomUUID();
  plan = await db.platformEpisodePlan.upsert({
    where: compound,
    create: { id: planId, albumId, sourceVersion: preview.sourceVersion, sourceReconciliationJobId: reconciliationJobId,
      status: 'DRAFT', planJson, createdByAdminUserId },
    update: { status: 'DRAFT', planJson, syncJobId: null, platformVersion: null, createdByAdminUserId }
  });

  const episodeIds = preview.included.map((episode) => episode.id);
  const sequenceById = Object.fromEntries(preview.included.map((episode) => [episode.id, episode.platformSeq]));
  const snapshot = await buildAlbumSnapshot(db, albumId, { episodeIds, platformSequenceByEpisodeId: sequenceById, submissionPlanId: plan.id });
  const snapshotHash = hashSnapshot({ ...snapshot, episodes: snapshot.episodes.map(({ episode_id: _platformId, ...episode }) => episode) });
  const active = await db.platformSyncJob.findFirst({ where: { albumId, kind: 'ALBUM_VERSION', status: { in: ['PENDING', 'PROCESSING'] } } });
  if (active && active.snapshotHash !== snapshotHash) throw conflict('已有其他剧目版本任务在处理，请等待完成后再提交。');

  const conflictJob = await db.platformSyncJob.findFirst({ where: { albumId, kind: 'ALBUM_VERSION', status: 'CONFLICT' }, orderBy: { createdAt: 'desc' } });
  if (conflictJob && preview.reconciledAt && new Date(conflictJob.completedAt ?? conflictJob.createdAt) > new Date(preview.reconciledAt)) {
    const lastReconcile = await db.platformSyncJob.findFirst({ where: { albumId, kind: 'RECONCILE', status: 'SUCCEEDED', completedAt: { gt: conflictJob.completedAt ?? conflictJob.createdAt } } });
    if (!lastReconcile || lastReconcile.id !== reconciliationJobId) throw conflict('上次平台版本结果仍待对账，请重新对账后刷新计划。');
  }

  const job = active ?? await enqueuePlatformSyncJob(db, {
    kind: 'ALBUM_VERSION', targetId: albumId, albumId, createdByAdminUserId,
    snapshotHash, snapshotJson: snapshot, dedupeKey: `ALBUM_VERSION:${albumId}:${snapshotHash}`
  });
  await db.platformEpisodePlan.update({ where: { id: plan.id }, data: { status: 'SYNC_QUEUED', syncJobId: job.id } });
  return { planId: plan.id, job, alreadyQueued: false };
}
