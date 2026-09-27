import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { miniAppAdConfig, miniAppPlatformConfig, type MiniAppKey } from '../config/mini-apps';
import { readAccessConfig } from '../lib/content-access';
import { enqueueAlbumAction, enqueueAlbumVersionSync, enqueueCoverSync, enqueueVideoSync, enqueueVideoUrlUpload, validateVideoSourceUrl } from './platform-sync.service';

type Db = PrismaClient & { [key: string]: any };
export type ReleaseAction = 'UPLOAD_VIDEO_URL' | 'SYNC_MEDIA' | 'SYNC_VERSION' | 'SUBMIT_REVIEW' | 'RECONCILE' | 'SET_ONLINE_VERSION' | 'PUBLISH';

export function targetReleaseAlbumId(sourceApp: MiniAppKey, sourceAlbumId: string) {
  return `release_${createHash('sha256').update(`${sourceApp}:${sourceAlbumId}`).digest('hex').slice(0, 24)}`;
}

async function ownerInTarget(db: Db, email: string, authorizedAdminId?: string) {
  const admin = await db.adminUser.findUnique({ where: authorizedAdminId ? { id: authorizedAdminId } : { email }, select: { id: true, role: true, status: true } });
  if (!admin || admin.status !== 'ACTIVE' || admin.role !== 'OWNER') throw new Error('目标小程序需要 ACTIVE OWNER 授权：可使用同邮箱 OWNER，或先切换到目标小程序以其 OWNER 账号登录。');
  return admin.id as string;
}

async function sourceAlbum(db: Db, albumId: string) {
  const album = await db.album.findUnique({ where: { id: albumId }, include: { coverAsset: true, episodes: { orderBy: { episodeNo: 'asc' }, include: { coverAsset: true } } } });
  if (!album) throw Object.assign(new Error('源剧目不存在。'), { statusCode: 404 });
  if (!album.coverAsset || album.coverAsset.status !== 'READY') throw Object.assign(new Error('源剧目封面尚未准备就绪。'), { statusCode: 409 });
  if (!album.coverAsset.publicUrl.startsWith('https://') || album.episodes.some((episode: any) => episode.coverAsset && !episode.coverAsset.publicUrl.startsWith('https://'))) {
    throw Object.assign(new Error('源剧目封面需要可访问的 HTTPS 地址。'), { statusCode: 409 });
  }
  if (!album.releaseYear || !album.dramaType || !Array.isArray(album.tagList) || !album.tagList.length) throw Object.assign(new Error('源剧目缺少年份、剧目类型或标签。'), { statusCode: 409 });
  if (!album.episodes.length || album.episodes.some((episode: any) => !episode.byteplusVid || (episode.coverAsset && episode.coverAsset.status !== 'READY'))) {
    throw Object.assign(new Error('源剧目缺少可用分集 VID 或封面。'), { statusCode: 409 });
  }
  if (new Set(album.episodes.map((episode: any) => episode.byteplusVid)).size !== album.episodes.length) throw Object.assign(new Error('源剧目包含重复的 BytePlus VID。'), { statusCode: 409 });
  return album;
}

async function cloneCover(tx: Prisma.TransactionClient, cover: any) {
  return tx.coverAsset.upsert({
    where: { sha256: cover.sha256 },
    create: {
      storageKey: cover.storageKey,
      publicUrl: cover.publicUrl,
      mimeType: cover.mimeType,
      fileSize: cover.fileSize,
      width: cover.width,
      height: cover.height,
      sha256: cover.sha256,
      status: 'READY'
    },
    update: {}
  });
}

async function prepareTarget(db: Db, env: Env, source: any, sourceApp: MiniAppKey, target: MiniAppKey) {
  if (target === sourceApp) return source.id as string;
  const id = targetReleaseAlbumId(sourceApp, source.id);
  const existing = await db.album.findUnique({ where: { id }, include: { coverAsset: true, episodes: { include: { coverAsset: true } } } });
  if (existing) {
    const uploaded = await db.platformSyncJob.findMany({ where: { albumId: id, kind: 'VIDEO', status: 'SUCCEEDED' } });
    const byNo = new Map(existing.episodes.map((episode: any) => [episode.episodeNo, episode]));
    if (existing.title !== source.title || existing.description !== source.description || existing.coverAsset?.sha256 !== source.coverAsset.sha256
      || existing.releaseYear !== source.releaseYear || existing.dramaType !== source.dramaType
      || JSON.stringify(existing.tagList) !== JSON.stringify(source.tagList)
      || existing.episodes.length !== source.episodes.length || source.episodes.some((episode: any) => {
      const saved = byNo.get(episode.episodeNo) as { id: string; byteplusVid?: string; title?: string; coverUrl?: string; coverAsset?: { sha256?: string } } | undefined;
      const ownUpload = uploaded.some((job: any) => job.episodeId === saved?.id && job.snapshotJson?.sourceVid === episode.byteplusVid && job.providerResponse?.vid === saved?.byteplusVid);
      return (saved?.byteplusVid && saved.byteplusVid !== episode.byteplusVid && !ownUpload) || saved?.title !== episode.title
        || (episode.coverAsset ? saved?.coverAsset?.sha256 !== episode.coverAsset.sha256 : saved?.coverUrl !== episode.coverUrl);
    })) throw new Error('目标剧目已存在但分集素材与源剧目不同；不会覆盖已审核内容。');
    return id;
  }
  const sourceAccess = readAccessConfig(source.accessConfig, miniAppAdConfig(env, sourceApp).rewardedPlacementId);
  const targetPlacementId = miniAppAdConfig(env, target).rewardedPlacementId;
  if (sourceAccess.rewardedAdEnabled && !targetPlacementId) throw new Error('目标小程序未配置激励广告位，不能复制启用广告解锁的剧目。');
  await db.$transaction(async (tx) => {
    const albumCover = await cloneCover(tx, source.coverAsset);
    const covers = new Map<string, string>([[source.coverAsset.id, albumCover.id]]);
    for (const episode of source.episodes) {
      if (episode.coverAsset && !covers.has(episode.coverAsset.id)) covers.set(episode.coverAsset.id, (await cloneCover(tx, episode.coverAsset)).id);
    }
    await tx.album.create({ data: {
      id,
      title: source.title,
      description: source.description,
      coverAssetId: albumCover.id,
      coverUrl: albumCover.publicUrl,
      language: source.language,
      releaseYear: source.releaseYear,
      dramaType: source.dramaType,
      tagList: source.tagList as Prisma.InputJsonValue,
      ...(source.regions ? { regions: source.regions as Prisma.InputJsonValue } : {}),
      accessConfig: { ...sourceAccess, rewardedPlacementId: targetPlacementId } as Prisma.InputJsonValue,
      status: 'DRAFT'
    } });
    for (const episode of source.episodes) {
      await tx.episode.create({ data: {
        albumId: id,
        episodeNo: episode.episodeNo,
        title: episode.title,
        description: episode.description,
        sortOrder: episode.sortOrder,
        isFree: episode.isFree,
        coverAssetId: episode.coverAssetId ? covers.get(episode.coverAssetId) : null,
        coverUrl: episode.coverAsset?.publicUrl ?? episode.coverUrl,
        byteplusVid: null,
        byteplusCoverUrl: episode.byteplusCoverUrl,
        durationMs: episode.durationMs,
        byteplusUploadStatus: 'PENDING',
        status: 'DRAFT'
      } });
    }
  });
  return id;
}

export async function runMultiAppRelease(input: {
  sourceDb: Db;
  dbByApp: Record<string, Db>;
  env: Env;
  sourceApp: MiniAppKey;
  sourceAlbumId: string;
  targetApps: MiniAppKey[];
  operatorEmail: string;
  authorizedAdminIds?: Partial<Record<MiniAppKey, string>>;
  action: 'PREPARE' | ReleaseAction;
  priorityScore?: 1 | 2;
  sources?: Array<{ episodeNo: number; sourceUrl: string }>;
}) {
  const source = input.action === 'PREPARE'
    ? await sourceAlbum(input.sourceDb, input.sourceAlbumId)
    : await input.sourceDb.album.findUnique({ where: { id: input.sourceAlbumId }, include: { episodes: true } });
  if (!source) throw Object.assign(new Error('源剧目不存在。'), { statusCode: 404 });
  const items = [];
  for (const target of [...new Set(input.targetApps)]) {
    try {
      const db = input.dbByApp[target];
      const platform = miniAppPlatformConfig(input.env, target);
      if (!db || !platform.clientKey || !platform.clientSecret) throw new Error('目标小程序数据库或 TikTok Client Key/Secret 未配置。');
      const adminId = await ownerInTarget(db, input.operatorEmail, input.authorizedAdminIds?.[target]);
      const albumId = input.action === 'PREPARE'
        ? await prepareTarget(db, input.env, source, input.sourceApp, target)
        : target === input.sourceApp ? source.id as string : targetReleaseAlbumId(input.sourceApp, source.id);
      const album = await db.album.findUnique({ where: { id: albumId }, include: { episodes: { orderBy: { episodeNo: 'asc' } } } });
      if (!album) throw new Error('目标剧目尚未准备，请先点击“准备目标剧目”。');
      const jobs = [];
      if (input.action === 'UPLOAD_VIDEO_URL') {
        if (target === input.sourceApp) throw new Error('源小程序不参与独立新 VID 上传；请仅勾选目标小程序。');
        if (album.tiktokAlbumId || album.tiktokVersion || album.onlineVersion) throw new Error('目标已同步 TikTok 版本，不能覆盖；独立上传仅支持未同步版本的目标草稿。');
        const sources = input.sources ?? [];
        if (!sources.length || new Set(sources.map((item) => item.episodeNo)).size !== sources.length) throw new Error('请提供不重复的集号和原文件下载地址。');
        sources.forEach((item) => validateVideoSourceUrl(item.sourceUrl));
        const verified = await db.platformSyncJob.findFirst({ where: { albumId, kind: 'VIDEO', status: 'SUCCEEDED', snapshotJson: { path: ['uploadMode'], equals: 'URL' } } });
        if (sources.length > 1 && !verified) throw new Error('该目标尚未验证独立上传，请先仅提交一集，确认成功获得新 VID 后再上传其他集。');
        const sourceByNo = new Map(source.episodes.map((episode: any) => [episode.episodeNo, episode]));
        const uploads = sources.map((item) => {
          const origin = sourceByNo.get(item.episodeNo) as any;
          const episode = album.episodes.find((entry: any) => entry.episodeNo === item.episodeNo);
          if (!origin?.byteplusVid || !episode) throw new Error(`第 ${item.episodeNo} 集不在源剧目或目标剧目中。`);
          return { item, origin, episode };
        });
        for (const { item, origin, episode } of uploads) {
          if (episode.tiktokVideoStatus === 'READY' && episode.byteplusVid && episode.byteplusVid !== origin.byteplusVid) continue;
          const job = await enqueueVideoUrlUpload(db, episode, { sourceVid: origin.byteplusVid, sourceUrl: item.sourceUrl }, adminId);
          jobs.push(job.id);
        }
      }
      if (input.action === 'PREPARE' || input.action === 'SYNC_MEDIA') {
        const coverIds = [...new Set([album.coverAssetId, ...album.episodes.map((episode: any) => episode.coverAssetId)].filter((id): id is string => Boolean(id)))];
        for (const coverId of coverIds) {
          const coverJob = await enqueueCoverSync(db, coverId, adminId);
          if (coverJob) jobs.push(coverJob.id);
        }
        for (const episode of album.episodes) {
          if (target !== input.sourceApp) continue;
          const job = await enqueueVideoSync(db, episode.id, adminId);
          if (job) jobs.push(job.id);
        }
      } else if (input.action === 'SYNC_VERSION') {
        if (target !== input.sourceApp && album.episodes.some((episode: any) => !episode.byteplusVid || source.episodes.some((origin: any) => origin.byteplusVid === episode.byteplusVid))) throw new Error('目标仍缺少独立的新 VID；请先完成独立媒资上传，勿复用源 VID 同步版本。');
        jobs.push((await enqueueAlbumVersionSync(db, albumId, adminId)).id);
      }
      else if (input.action === 'SUBMIT_REVIEW') jobs.push((await enqueueAlbumAction(db, 'REVIEW', albumId, adminId, input.priorityScore ?? 2)).id);
      else if (input.action === 'RECONCILE') jobs.push((await enqueueAlbumAction(db, 'RECONCILE', albumId, adminId)).id);
      else if (input.action === 'SET_ONLINE_VERSION') jobs.push((await enqueueAlbumAction(db, 'SET_ONLINE_VERSION', albumId, adminId)).id);
      else if (input.action === 'PUBLISH') jobs.push((await enqueueAlbumAction(db, 'PUBLISH', albumId, adminId)).id);
      items.push({ miniAppKey: target, albumId, accepted: true, jobIds: jobs });
    } catch (error) {
      items.push({ miniAppKey: target, accepted: false, error: error instanceof Error ? error.message : '目标小程序处理失败。' });
    }
  }
  return { items };
}

export async function multiAppReleaseStatus(input: { dbByApp: Record<string, Db>; sourceApp: MiniAppKey; sourceAlbumId: string; targetApps: MiniAppKey[]; operatorEmail: string; authorizedAdminIds?: Partial<Record<MiniAppKey, string>> }) {
  const items = [];
  for (const target of [...new Set(input.targetApps)]) {
    try {
      const db = input.dbByApp[target];
      if (!db) throw new Error('目标小程序数据库未配置。');
      await ownerInTarget(db, input.operatorEmail, input.authorizedAdminIds?.[target]);
      const albumId = target === input.sourceApp ? input.sourceAlbumId : targetReleaseAlbumId(input.sourceApp, input.sourceAlbumId);
      const album = await db.album.findUnique({ where: { id: albumId }, select: { id: true, title: true, tiktokAlbumId: true, tiktokVersion: true, onlineVersion: true, reviewStatus: true, publishStatus: true, status: true, coverAsset: { select: { providerImageId: true } }, episodes: { select: { id: true, byteplusVid: true, tiktokVideoStatus: true, coverAssetId: true, coverAsset: { select: { providerImageId: true } } } } } });
      if (!album) { items.push({ miniAppKey: target, prepared: false, reason: 'NOT_PREPARED' }); continue; }
      const jobs = await db.platformSyncJob.findMany({ where: { albumId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, status: true, errorMessage: true, providerJobId: true, providerRequestId: true, providerResponse: true, snapshotJson: true, createdAt: true, completedAt: true, episode: { select: { episodeNo: true, title: true } } } });
      const independent = target === input.sourceApp ? [] : await db.platformSyncJob.findMany({ where: { albumId, kind: 'VIDEO', status: 'SUCCEEDED', snapshotJson: { path: ['uploadMode'], equals: 'URL' } }, select: { episodeId: true, providerResponse: true } });
      const videoReady = (episode: any) => episode.tiktokVideoStatus === 'READY' && (target === input.sourceApp || independent.some((job: any) => job.episodeId === episode.id && job.providerResponse?.vid === episode.byteplusVid));
      items.push({
        miniAppKey: target, prepared: true, albumId, title: album.title, tiktokAlbumId: album.tiktokAlbumId,
        version: album.tiktokVersion, onlineVersion: album.onlineVersion, reviewStatus: album.reviewStatus,
        publishStatus: album.publishStatus, status: album.status,
        mediaReady: Boolean(album.coverAsset?.providerImageId) && album.episodes.every((episode: any) => videoReady(episode) && (!episode.coverAssetId || episode.coverAsset?.providerImageId)),
        videoReadyCount: album.episodes.filter(videoReady).length,
        episodeCount: album.episodes.length, jobs: jobs.map(({ snapshotJson, ...job }: any) => ({ ...job, uploadMode: snapshotJson?.uploadMode }))
      });
    } catch (error) {
      items.push({ miniAppKey: target, prepared: false, reason: 'ACCESS_ERROR', error: error instanceof Error ? error.message : '状态读取失败。' });
    }
  }
  return { items };
}
