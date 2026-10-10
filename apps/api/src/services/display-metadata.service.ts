import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicLocaleSchema } from '../lib/locales';

type Db = PrismaClient & { [key: string]: any };
export const displayMetadataInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000),
  translations: z.array(z.object({
    locale: publicLocaleSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).default('')
  })).max(50).refine((items) => new Set(items.map((item) => item.locale)).size === items.length, '语言不能重复。')
});
export type DisplayMetadata = z.infer<typeof displayMetadataInput>;
/** Keep unchanged copies of base text in step with edits, preserving custom translations. */
export function carryBaseTextChanges(metadata: DisplayMetadata, previous: DisplayMetadata): DisplayMetadata {
  return { ...metadata, translations: metadata.translations.map((item) => {
    const before = previous.translations.find((translation) => translation.locale === item.locale);
    return { ...item,
      title: before?.title === previous.title && item.title === before.title ? metadata.title : item.title,
      description: before?.description === previous.description && item.description === before.description ? metadata.description : item.description };
  }) };
}
const problem = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const textMetadata = (album: any): DisplayMetadata => ({ title: album.title, description: album.description ?? '',
  translations: (album.translations ?? []).map((item: any) => ({ locale: item.locale, title: item.title, description: item.description ?? '' })).sort((a: any, b: any) => a.locale.localeCompare(b.locale)) });
export const metadataTargets = (shared: any): any[] => shared.authorizations.filter((item: any) => item.status !== 'REVOKED');

export async function findDisplayMetadataAlbum(db: Db, miniAppKey: string, albumId: string) {
  return db.sharedTikTokAlbum.findFirst({ where: { OR: [
    { canonicalKey: `${miniAppKey}:${albumId}` },
    { authorizations: { some: { miniAppKey, targetLocalAlbumId: albumId, status: { not: 'REVOKED' } } } }
  ] }, include: { authorizations: true } });
}

/** The source OWNER manages the shared text; existing playback grants identify its consumers. */
export async function assertDisplayMetadataOwner(shared: any, dbByApp: Record<string, Db>, currentApp: string, role: string | undefined, email: string, sourceAdminId?: string) {
  if (role !== 'OWNER') throw problem('统一剧目资料需要 OWNER 权限。', 403);
  if (shared.ownerMiniAppKey === currentApp) return;
  const db = dbByApp[shared.ownerMiniAppKey];
  const owner = await db?.adminUser.findUnique({ where: sourceAdminId ? { id: sourceAdminId } : { email } });
  if (!owner || owner.role !== 'OWNER' || owner.status !== 'ACTIVE') throw problem('请使用主小程序的 OWNER 账号编辑统一资料，或先登录主小程序 OWNER 后再切回。', 403);
}

export async function readDisplayMetadata(sharedDb: Db, dbByApp: Record<string, Db>, currentApp: string, albumId: string) {
  const local = await dbByApp[currentApp].album.findUnique({ where: { id: albumId }, include: { translations: true } });
  if (!local) throw problem('剧目不存在。', 404);
  const shared = await findDisplayMetadataAlbum(sharedDb, currentApp, albumId);
  if (!shared) return { id: albumId, language: local.language, ...textMetadata(local), shared: false, version: 0, targets: [], sharedAlbum: null };
  const targets = metadataTargets(shared);
  const owner = targets.find((item) => item.miniAppKey === shared.ownerMiniAppKey);
  let metadata: DisplayMetadata;
  if (shared.displayMetadata) metadata = textMetadata(displayMetadataInput.parse(shared.displayMetadata));
  else {
    const source = owner?.targetLocalAlbumId && await dbByApp[owner.miniAppKey]?.album.findUnique({ where: { id: owner.targetLocalAlbumId }, include: { translations: true } });
    if (!source) throw problem('主小程序资料或映射缺失，不能初始化统一资料。');
    metadata = textMetadata(source);
  }
  const items = await Promise.all(targets.map(async (target) => {
    const job = shared.displayMetadataVersion ? await sharedDb.sharedPlatformOperation.findUnique({ where: {
      dedupeKey: `display:${shared.id}:${shared.displayMetadataVersion}:${target.miniAppKey}`
    } }) : null;
    try {
      if (!target.targetLocalAlbumId) throw new Error('目标剧目映射缺失。');
      const album = await dbByApp[target.miniAppKey]?.album.findUnique({ where: { id: target.targetLocalAlbumId }, include: { translations: true } });
      if (!album) throw new Error('小程序数据库或剧目映射不可用。');
      return { miniAppKey: target.miniAppKey, albumId: album.id, title: album.title,
        differs: JSON.stringify(textMetadata(album)) !== JSON.stringify(metadata),
        differences: [album.title !== metadata.title ? '剧名' : '', (album.description ?? '') !== metadata.description ? '简介' : '',
          JSON.stringify(textMetadata(album).translations) !== JSON.stringify(metadata.translations) ? '多语言文案' : ''].filter(Boolean),
        syncedVersion: target.metadataSyncedVersion,
        status: target.metadataSyncedVersion >= shared.displayMetadataVersion && shared.displayMetadataVersion > 0 ? 'SUCCEEDED' : job?.status ?? 'NOT_SYNCED',
        error: job?.errorMessage ?? null };
    } catch (error) {
      return { miniAppKey: target.miniAppKey, albumId: target.targetLocalAlbumId, differs: true, syncedVersion: target.metadataSyncedVersion,
        status: job?.status ?? 'UNAVAILABLE', error: error instanceof Error ? error.message : '读取失败。' };
    }
  }));
  return { id: albumId, language: local.language, ...metadata, shared: true, version: shared.displayMetadataVersion, targets: items, sharedAlbum: shared };
}

export async function enqueueDisplayMetadata(db: Db, shared: any, targets = metadataTargets(shared)) {
  if (!shared.displayMetadata || !shared.displayMetadataVersion) return;
  for (const target of targets) {
    const dedupeKey = `display:${shared.id}:${shared.displayMetadataVersion}:${target.miniAppKey}`;
    await db.sharedPlatformOperation.upsert({ where: { dedupeKey }, create: {
      kind: 'SYNC_DISPLAY_METADATA', status: 'PENDING', sharedAlbumId: shared.id, targetMiniAppKey: target.miniAppKey, dedupeKey,
      snapshotJson: { version: shared.displayMetadataVersion, targetLocalAlbumId: target.targetLocalAlbumId }
    }, update: {} });
  }
}

export async function saveSharedDisplayMetadata(db: Db, shared: any, metadata: DisplayMetadata, expectedVersion: number, operator: string) {
  return (db.$transaction as any)(async (tx: Db) => {
    const changed = await tx.sharedTikTokAlbum.updateMany({ where: { id: shared.id, displayMetadataVersion: expectedVersion }, data: {
      displayMetadata: metadata as Prisma.InputJsonValue, displayMetadataVersion: { increment: 1 }, displayMetadataUpdatedBy: operator, displayMetadataUpdatedAt: new Date()
    } });
    if (changed.count !== 1) throw problem('资料已被其他管理员修改，请重新打开编辑窗口后保存。');
    const latest = await tx.sharedTikTokAlbum.findUniqueOrThrow({ where: { id: shared.id }, include: { authorizations: true } });
    await enqueueDisplayMetadata(tx, latest);
    return latest;
  }, { timeout: 30_000 });
}

async function writeText(tx: Db, albumId: string, metadata: DisplayMetadata) {
  // Preserve each application's localized covers; reset extra locale text so it cannot hide the unified text.
  await tx.albumTranslation.updateMany({ where: { albumId, locale: { notIn: metadata.translations.map((item) => item.locale) } }, data: { title: metadata.title, description: metadata.description } });
  for (const translation of metadata.translations) await tx.albumTranslation.upsert({ where: { albumId_locale: { albumId, locale: translation.locale } },
    create: { albumId, ...translation }, update: { title: translation.title, description: translation.description } });
}

export async function saveLocalDisplayMetadata(db: Db, albumId: string, metadata: DisplayMetadata) {
  await (db.$transaction as any)(async (tx: Db) => {
    await tx.album.update({ where: { id: albumId }, data: { title: metadata.title, description: metadata.description, displayMetadataVersion: { increment: 1 } } });
    await writeText(tx, albumId, metadata);
  }, { timeout: 30_000 });
}

/** Row version and transaction prevent older workers from overwriting newer text or translations. */
export async function applyDisplayMetadata(sharedDb: Db, localDb: Db, shared: any, target: any) {
  if (!target.targetLocalAlbumId) throw problem('目标小程序的剧目映射缺失，停止资料同步。');
  const metadata = displayMetadataInput.parse(shared.displayMetadata);
  const version = shared.displayMetadataVersion;
  await (localDb.$transaction as any)(async (tx: Db) => {
    const local = await tx.album.findUnique({ where: { id: target.targetLocalAlbumId } });
    if (!local) throw problem('目标小程序剧目不存在。', 404);
    if (local.tiktokAlbumId && local.tiktokAlbumId !== shared.tiktokAlbumId) throw problem('目标已绑定其他剧目，停止资料同步。');
    if (local.displayMetadataSharedId && local.displayMetadataSharedId !== shared.id) throw problem('目标资料归属不同的共享剧目，停止同步。');
    const changed = await tx.album.updateMany({ where: { id: local.id,
      OR: [{ displayMetadataSharedId: null }, { displayMetadataSharedId: shared.id, displayMetadataVersion: { lte: version } }] },
      data: { title: metadata.title, description: metadata.description, displayMetadataSharedId: shared.id, displayMetadataVersion: version } });
    if (changed.count) await writeText(tx, local.id, metadata);
  }, { timeout: 30_000 });
  await sharedDb.miniAppAlbumAuthorization.updateMany({ where: { id: target.id, metadataSyncedVersion: { lt: version } }, data: { metadataSyncedVersion: version } });
}

export async function processDisplayMetadataOperation(db: Db, job: any, dbByApp: Record<string, Db>, now: Date) {
  const shared = await db.sharedTikTokAlbum.findUnique({ where: { id: job.sharedAlbumId }, include: { authorizations: true } });
  if (!shared?.displayMetadata) throw problem('统一资料不存在。', 404);
  const target = metadataTargets(shared).find((item) => item.miniAppKey === job.targetMiniAppKey);
  if (!target || target.targetLocalAlbumId !== job.snapshotJson?.targetLocalAlbumId) throw problem('授权或目标映射已经改变，请重新保存统一资料。');
  const localDb = dbByApp[target.miniAppKey];
  if (!localDb) throw new Error('目标小程序数据库未配置。');
  await applyDisplayMetadata(db, localDb, shared, target);
  await db.sharedPlatformOperation.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', completedAt: now, nextAttemptAt: null,
    errorMessage: null, errorCode: null, providerResponse: { syncedVersion: shared.displayMetadataVersion } } });
}

export async function retryDisplayMetadata(db: Db, shared: any, miniAppKey: string) {
  const target = metadataTargets(shared).find((item) => item.miniAppKey === miniAppKey);
  if (!target || !shared.displayMetadataVersion) throw problem('没有可重试的资料同步任务。');
  await enqueueDisplayMetadata(db, shared, [target]);
  await db.sharedPlatformOperation.updateMany({ where: { dedupeKey: `display:${shared.id}:${shared.displayMetadataVersion}:${miniAppKey}`, status: { in: ['FAILED', 'CONFLICT'] } },
    data: { status: 'PENDING', attemptCount: 0, errorMessage: null, errorCode: null, nextAttemptAt: null, completedAt: null, startedAt: null,
      snapshotJson: { version: shared.displayMetadataVersion, targetLocalAlbumId: target.targetLocalAlbumId } } });
}
