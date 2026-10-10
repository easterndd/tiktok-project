import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { assertSameMiniAppOrganization, miniAppAdConfig, miniAppPlatformConfig, type MiniAppKey } from '../config/mini-apps';
import { readAccessConfig } from '../lib/content-access';
import { registerSharedPlaybackSnapshot, enqueueSharedAlbumAuthorization, enqueueSharedAlbumReconcile } from './shared-platform.service';
import { TikTokShortDramaApiService } from './tiktok-short-drama-api.service';
import { displayMetadataInput, enqueueDisplayMetadata, saveSharedDisplayMetadata } from './display-metadata.service';

type Db = PrismaClient & { [key: string]: any };
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const record = (value: any): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numeric = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

export const playbackAlbumId = (sourceApp: string, sourceId: string) => `shared_${createHash('sha256').update(`${sourceApp}:${sourceId}`).digest('hex').slice(0, 24)}`;

export async function verifyPlaybackSource(db: Db, api: TikTokShortDramaApiService, sourceId: string) {
  const local = await db.album.findUnique({ where: { id: sourceId }, include: { episodes: true } });
  if (!local?.tiktokAlbumId) throw conflict('源剧目尚未同步到 TikTok。');
  const queried = await api.queryAlbum({ albumId: local.tiktokAlbumId });
  const latest = record(queried.data);
  const version = numeric(latest.online_version);
  if (!version || ![1, '1', 'LISTED'].includes(latest.publish_status)) throw conflict('请先在主小程序设置审核通过的线上版本并上架，再授权播放。');
  const online = numeric(latest.version) === version ? latest : record((await api.queryAlbum({ albumId: local.tiktokAlbumId, version })).data);
  if (numeric(online.version) !== version || ![2, '2', 'PASSED', 'APPROVED'].includes(online.review_status)) throw conflict('TikTok 线上版本尚未确认审核通过，不能授权播放。');
  const job = await db.platformSyncJob.findFirst({ where: { albumId: local.id, kind: 'ALBUM_VERSION', status: 'SUCCEEDED', providerResponse: { path: ['version'], equals: version } }, orderBy: { createdAt: 'desc' } });
  const snapshot = record(job?.snapshotJson);
  const info = record(snapshot.albumInfo);
  if (!Array.isArray(snapshot.episodes) || !snapshot.episodes.length || !info.title) throw conflict('找不到线上版本的完整本地快照，不能凭当前草稿内容授权。');
  const remote = Array.isArray(online.episode_info_list) ? online.episode_info_list.map(record) : [];
  if (remote.length !== snapshot.episodes.length || new Set(remote.map((entry: any) => numeric(entry.seq))).size !== remote.length) throw conflict('线上分集列表与版本快照不一致，请先核实平台分集。');
  const coverIds = [...new Set([...(info.cover_list ?? []), ...snapshot.episodes.flatMap((entry: any) => entry.cover_list ?? [])])];
  const covers = await db.coverAsset.findMany({ where: { providerImageId: { in: coverIds } } });
  const coverById = new Map(covers.map((cover: any) => [cover.providerImageId, cover]));
  const albumCover = coverById.get(info.cover_list?.[0]) as any;
  if (!albumCover?.publicUrl) throw conflict('找不到线上版本对应的封面资源。');
  const idMap = record(record(job?.providerResponse).episode_id_map);
  const episodes = snapshot.episodes.map((entry: any) => {
    const platform = remote.find((item: any) => numeric(item.seq) === entry.seq);
    const expectedId = idMap[entry.episode_id] ?? idMap[`seq:${entry.seq}`] ?? idMap[`seq_${entry.seq}`] ?? entry.episode_id;
    const localEpisode = local.episodes.find((item: any) => item.id === entry.localEpisodeId);
    if (!localEpisode || !entry.byteplus_vid || !platform?.episode_id || String(platform.episode_id) !== String(expectedId)
      || (platform.byteplus_vid && platform.byteplus_vid !== entry.byteplus_vid) || platform.exception_reason) throw conflict(`第 ${entry.seq} 集线上素材或 ID 不一致，不能授权。`);
    const cover = coverById.get(entry.cover_list?.[0]) as any;
    return { ...localEpisode, episodeNo: entry.seq, title: entry.title, sortOrder: entry.seq, byteplusVid: entry.byteplus_vid,
      tiktokEpisodeId: String(platform.episode_id), tiktokCoverPicId: entry.cover_list?.[0], coverUrl: cover?.publicUrl ?? albumCover.publicUrl,
      durationMs: localEpisode.byteplusVid === entry.byteplus_vid ? localEpisode.durationMs : null };
  });
  if (new Set(episodes.map((entry: any) => entry.byteplusVid)).size !== episodes.length) throw conflict('线上快照含重复 VID，不能建立完整映射。');
  return { ...local, title: info.title, description: info.desp ?? '', language: info.language, releaseYear: info.year,
    dramaType: info.drama_type, tagList: info.tag_list, coverUrl: albumCover.publicUrl,
    tiktokVersion: numeric(latest.current_version) ?? version, onlineVersion: version, reviewStatus: 'PASSED', publishStatus: 'LISTED', episodes };
}

export async function targetPlaybackOwner(db: Db, email: string, adminId?: string) {
  const admin = await db.adminUser.findUnique({ where: adminId ? { id: adminId } : { email }, select: { id: true, role: true, status: true } });
  if (!admin || admin.role !== 'OWNER' || admin.status !== 'ACTIVE') throw conflict('目标小程序需要 ACTIVE OWNER 授权；不同邮箱请先在同一标签页登录目标 OWNER，再切回主小程序。');
  return admin.id;
}

export async function preparePlaybackTarget(db: Db, env: Env, sourceApp: MiniAppKey, target: MiniAppKey, source: any, previousTargetId?: string | null) {
  assertSameMiniAppOrganization(sourceApp, [target]);
  const linked = await db.album.findUnique({ where: { tiktokAlbumId: source.tiktokAlbumId }, include: { episodes: true } });
  const legacyId = `release_${createHash('sha256').update(`${sourceApp}:${source.id}`).digest('hex').slice(0, 24)}`;
  const existing = linked ?? await db.album.findUnique({ where: { id: previousTargetId ?? playbackAlbumId(sourceApp, source.id) }, include: { episodes: true } })
    ?? await db.album.findUnique({ where: { id: legacyId }, include: { episodes: true } });
  if (existing && (existing.tiktokAlbumId && existing.tiktokAlbumId !== source.tiktokAlbumId)) throw conflict('目标剧目已独立同步至 TikTok，不会覆盖其平台剧目或删除媒资。');
  if (existing && existing.tiktokAlbumId !== source.tiktokAlbumId && (existing.title !== source.title || existing.episodes.some((entry: any) => {
    const expected = source.episodes.find((item: any) => item.episodeNo === entry.episodeNo);
    return !expected || (entry.byteplusVid && entry.byteplusVid !== expected.byteplusVid) || (entry.tiktokEpisodeId && entry.tiktokEpisodeId !== expected.tiktokEpisodeId);
  }))) throw conflict('目标已有不同素材或分集映射，不会自动覆盖；请先核实目标内容。');
  const id = existing?.id ?? playbackAlbumId(sourceApp, source.id);
  const occupied = await db.episode.findFirst({ where: { albumId: { not: id }, OR: [{ byteplusVid: { in: source.episodes.map((entry: any) => entry.byteplusVid) } }, { tiktokEpisodeId: { in: source.episodes.map((entry: any) => entry.tiktokEpisodeId) } }] } });
  if (occupied) throw conflict('目标其他剧目已占用对应 VID 或平台分集 ID，不会重复建立或覆盖。');
  const access = readAccessConfig(source.accessConfig, miniAppAdConfig(env, sourceApp).rewardedPlacementId);
  const placement = miniAppAdConfig(env, target).rewardedPlacementId;
  if (!existing && access.rewardedAdEnabled && !placement) throw conflict('目标未配置自己的激励广告位；请先配置，避免复制源小程序广告位。');
  await db.$transaction(async (tx) => {
    if (!existing) await tx.album.create({ data: { id, title: source.title, description: source.description, coverUrl: source.coverUrl,
      language: source.language, releaseYear: source.releaseYear, dramaType: source.dramaType, tagList: source.tagList as Prisma.InputJsonValue,
      ...(source.regions ? { regions: source.regions as Prisma.InputJsonValue } : {}),
      accessConfig: { ...access, rewardedPlacementId: placement } as Prisma.InputJsonValue, status: 'OFFLINE' } });
    for (const entry of source.episodes) {
      if (existing?.episodes.some((item: any) => item.episodeNo === entry.episodeNo)) continue;
      await tx.episode.create({ data: { albumId: id, episodeNo: entry.episodeNo, title: entry.title, sortOrder: entry.sortOrder,
        isFree: entry.isFree, byteplusVid: entry.byteplusVid, byteplusCoverUrl: entry.byteplusCoverUrl,
        coverUrl: entry.coverUrl, durationMs: entry.durationMs, byteplusUploadStatus: 'READY', status: 'OFFLINE' } });
    }
  });
  return id as string;
}

type PlaybackInput = { sharedDb: Db; sourceDb: Db; dbByApp: Record<string, Db>; env: Env; sourceApp: MiniAppKey; sourceAlbumId: string;
  targetApps: MiniAppKey[]; operatorEmail: string; authorizedAdminIds?: Partial<Record<MiniAppKey, string>>; sourceApi?: TikTokShortDramaApiService };

export async function authorizeSharedPlayback(input: PlaybackInput) {
  assertSameMiniAppOrganization(input.sourceApp, input.targetApps);
  const api = input.sourceApi ?? new TikTokShortDramaApiService({ ...input.env, TIKTOK_CLIENT_KEY: miniAppPlatformConfig(input.env, input.sourceApp).clientKey, TIKTOK_CLIENT_SECRET: miniAppPlatformConfig(input.env, input.sourceApp).clientSecret });
  const source = await verifyPlaybackSource(input.sourceDb, api, input.sourceAlbumId);
  let shared = await registerSharedPlaybackSnapshot(input.sharedDb, input.env, input.sourceApp, source);
  // Explicit display edits made before the first grant must survive the platform snapshot.
  if (!shared.displayMetadata) {
    const local = await input.sourceDb.album.findUnique({ where: { id: input.sourceAlbumId }, include: { translations: true } });
    if (local && (local.displayMetadataVersion ?? 0) > 0) shared = await saveSharedDisplayMetadata(input.sharedDb, shared,
      displayMetadataInput.parse({ title: local.title, description: local.description ?? '', translations: (local.translations ?? []).map((item: any) => ({ locale: item.locale, title: item.title, description: item.description ?? '' })) }),
      shared.displayMetadataVersion, `${input.sourceApp}:${input.operatorEmail}`);
  }
  const items = [];
  for (const target of [...new Set(input.targetApps)]) {
    try {
      if (target === input.sourceApp) throw conflict('主小程序已经拥有剧目，无需授权给自己。');
      const db = input.dbByApp[target];
      const config = miniAppPlatformConfig(input.env, target);
      if (!db || !config.clientKey || !config.clientSecret) throw conflict('目标小程序数据库或 TikTok 凭据未配置。');
      const targetOwnerId = await targetPlaybackOwner(db, input.operatorEmail, input.authorizedAdminIds?.[target]);
      const previous = shared.authorizations.find((entry: any) => entry.miniAppKey === target);
      const displaySource = shared.displayMetadata ? { ...source, ...displayMetadataInput.parse(shared.displayMetadata) } : source;
      const albumId = await preparePlaybackTarget(db, input.env, input.sourceApp, target, displaySource, previous?.targetLocalAlbumId);
      const result = await enqueueSharedAlbumAuthorization(input.sharedDb, input.env, shared.id, target, albumId, targetOwnerId);
      const latest = await input.sharedDb.sharedTikTokAlbum.findUnique({ where: { id: shared.id }, include: { authorizations: true } });
      if (latest) await enqueueDisplayMetadata(input.sharedDb, latest, latest.authorizations.filter((entry: any) => entry.miniAppKey === target));
      items.push({ miniAppKey: target, accepted: true, albumId, operationId: result.operation?.id ?? null });
      if (!result.operation) await enqueueSharedAlbumReconcile(input.sharedDb, shared.id);
    } catch (error) { items.push({ miniAppKey: target, accepted: false, error: error instanceof Error ? error.message : '授权准备失败。' }); }
  }
  return { items };
}

export async function sharedPlaybackStatus(input: Omit<PlaybackInput, 'env'>) {
  assertSameMiniAppOrganization(input.sourceApp, input.targetApps);
  const shared = await input.sharedDb.sharedTikTokAlbum.findUnique({ where: { canonicalKey: `${input.sourceApp}:${input.sourceAlbumId}` }, include: { authorizations: true, episodes: { include: { media: true } } } });
  const items = [];
  for (const target of [...new Set(input.targetApps)]) {
    try {
      const db = input.dbByApp[target];
      if (!db) throw conflict('目标小程序数据库未配置。');
      await targetPlaybackOwner(db, input.operatorEmail, input.authorizedAdminIds?.[target]);
      const auth = shared?.authorizations.find((entry: any) => entry.miniAppKey === target);
      const local = auth?.targetLocalAlbumId ? await db.album.findUnique({ where: { id: auth.targetLocalAlbumId }, include: { episodes: { select: { episodeNo: true, tiktokEpisodeId: true, byteplusVid: true } } } }) : null;
      const expected = shared?.episodes ?? [];
      const mapped = expected.filter((entry: any) => local?.episodes.some((item: any) => item.episodeNo === entry.episodeNo && item.tiktokEpisodeId === entry.tiktokEpisodeId && item.byteplusVid === entry.media.byteplusVid)).length;
      const operations = shared ? await input.sharedDb.sharedPlatformOperation.findMany({ where: { sharedAlbumId: shared.id, OR: [{ targetMiniAppKey: target }, { kind: 'RECONCILE_ALBUM' }] }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
      items.push({ miniAppKey: target, status: auth?.status ?? 'NOT_AUTHORIZED', albumId: local?.id, tiktokAlbumId: shared?.tiktokAlbumId,
        onlineVersion: shared?.onlineVersion, reviewStatus: shared?.reviewStatus, publishStatus: shared?.publishStatus,
        localStatus: local?.status, episodeCount: expected.length, mappedEpisodeCount: mapped, error: auth?.errorMessage,
        requestId: auth?.providerRequestId, lastReconciledAt: auth?.lastReconciledAt, operations });
    } catch (error) { items.push({ miniAppKey: target, status: 'ACCESS_ERROR', error: error instanceof Error ? error.message : '读取授权状态失败。' }); }
  }
  return { items, sharedAlbumId: shared?.id };
}
