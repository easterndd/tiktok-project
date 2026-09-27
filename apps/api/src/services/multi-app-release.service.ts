import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { miniAppAdConfig, miniAppPlatformConfig, type MiniAppKey } from '../config/mini-apps';
import { readAccessConfig } from '../lib/content-access';
import { enqueueAlbumAction, enqueueAlbumVersionSync, enqueueCoverSync, enqueueVideoSync } from './platform-sync.service';

type Db = PrismaClient & { [key: string]: any };
export type ReleaseAction = 'SYNC_MEDIA' | 'SYNC_VERSION' | 'SUBMIT_REVIEW' | 'RECONCILE' | 'SET_ONLINE_VERSION' | 'PUBLISH';

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
    const byNo = new Map(existing.episodes.map((episode: any) => [episode.episodeNo, episode]));
    if (existing.title !== source.title || existing.description !== source.description || existing.coverAsset?.sha256 !== source.coverAsset.sha256
      || existing.releaseYear !== source.releaseYear || existing.dramaType !== source.dramaType
      || JSON.stringify(existing.tagList) !== JSON.stringify(source.tagList)
      || existing.episodes.length !== source.episodes.length || source.episodes.some((episode: any) => {
      const saved = byNo.get(episode.episodeNo) as { byteplusVid?: string; title?: string; coverUrl?: string; coverAsset?: { sha256?: string } } | undefined;
      return saved?.byteplusVid !== episode.byteplusVid || saved?.title !== episode.title
        || (episode.coverAsset ? saved?.coverAsset?.sha256 !== episode.coverAsset.sha256 : saved?.coverUrl !== episode.coverUrl);
    })) throw new Error('目标剧目已存在但分集素材与源剧目不同；不会覆盖已审核内容。');
    return id;
  }
  const sourceAccess = readAccessConfig(source.accessConfig, miniAppAdConfig(env, sourceApp).rewardedPlacementId);
  const targetPlacementId = miniAppAdConfig(env, target).rewardedPlacementId;
  if (sourceAccess.rewardedAdEnabled && !targetPlacementId) throw new Error('目标小程序未配置激励广告位，不能复制启用广告解锁的剧目。');
  const vids = source.episodes.map((episode: any) => episode.byteplusVid as string);
  const occupied = await db.episode.findFirst({ where: { byteplusVid: { in: vids } }, select: { albumId: true, episodeNo: true } });
  if (occupied) throw new Error(`目标小程序已有分集占用源剧目的 BytePlus VID（第 ${occupied.episodeNo} 集）；不会建立重复剧目。`);
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
        byteplusVid: episode.byteplusVid,
        byteplusCoverUrl: episode.byteplusCoverUrl,
        durationMs: episode.durationMs,
        byteplusUploadStatus: 'READY',
        status: 'READY'
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
}) {
  const source = input.action === 'PREPARE'
    ? await sourceAlbum(input.sourceDb, input.sourceAlbumId)
    : await input.sourceDb.album.findUnique({ where: { id: input.sourceAlbumId }, select: { id: true } });
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
      if (input.action === 'PREPARE' || input.action === 'SYNC_MEDIA') {
        const coverIds = [...new Set([album.coverAssetId, ...album.episodes.map((episode: any) => episode.coverAssetId)].filter((id): id is string => Boolean(id)))];
        for (const coverId of coverIds) {
          const coverJob = await enqueueCoverSync(db, coverId, adminId);
          if (coverJob) jobs.push(coverJob.id);
        }
        for (const episode of album.episodes) {
          const job = await enqueueVideoSync(db, episode.id, adminId);
          if (job) jobs.push(job.id);
        }
      } else if (input.action === 'SYNC_VERSION') jobs.push((await enqueueAlbumVersionSync(db, albumId, adminId)).id);
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
      const album = await db.album.findUnique({ where: { id: albumId }, select: { id: true, title: true, tiktokAlbumId: true, tiktokVersion: true, onlineVersion: true, reviewStatus: true, publishStatus: true, status: true, coverAsset: { select: { providerImageId: true } }, episodes: { select: { tiktokVideoStatus: true, coverAssetId: true, coverAsset: { select: { providerImageId: true } } } } } });
      if (!album) { items.push({ miniAppKey: target, prepared: false, reason: 'NOT_PREPARED' }); continue; }
      const jobs = await db.platformSyncJob.findMany({ where: { albumId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, status: true, errorMessage: true, providerRequestId: true, providerResponse: true, createdAt: true, completedAt: true, episode: { select: { episodeNo: true, title: true } } } });
      items.push({
        miniAppKey: target, prepared: true, albumId, title: album.title, tiktokAlbumId: album.tiktokAlbumId,
        version: album.tiktokVersion, onlineVersion: album.onlineVersion, reviewStatus: album.reviewStatus,
        publishStatus: album.publishStatus, status: album.status,
        mediaReady: Boolean(album.coverAsset?.providerImageId) && album.episodes.every((episode: any) => episode.tiktokVideoStatus === 'READY' && (!episode.coverAssetId || episode.coverAsset?.providerImageId)),
        videoReadyCount: album.episodes.filter((episode: any) => episode.tiktokVideoStatus === 'READY').length,
        episodeCount: album.episodes.length, jobs
      });
    } catch (error) {
      items.push({ miniAppKey: target, prepared: false, reason: 'ACCESS_ERROR', error: error instanceof Error ? error.message : '状态读取失败。' });
    }
  }
  return { items };
}
