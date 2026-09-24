import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin, requirePermission } from '../../plugins/auth';
import { hashPassword, verifyPassword } from '../../services/password';
import { accessConfigSchema } from '../../lib/content-access';
import { publicLocaleSchema } from '../../lib/locales';
import { BytePlusVodService } from '../../services/byteplus-vod.service';
import { LocalObjectStorageService } from '../../services/object-storage.service';
import { defaultUiComponents } from '../ui/routes';
import { readAppEntryAdPolicy } from '../app-entry-ads/routes';
import {
  enqueueAlbumAction,
  enqueueAlbumVersionSync,
  enqueueCoverSync,
  enqueueVideoSync
} from '../../services/platform-sync.service';
import {
  bindEpisodeToSharedMedia,
  createSharedAlbumFromLocal,
  enqueueSharedAlbumAuthorization,
  enqueueSharedAlbumReconcile,
  getOrCreateSharedMediaAsset,
  listSharedMediaAssets,
  sharedMiniAppConfig
} from '../../services/shared-platform.service';

const albumParams = z.object({ albumId: z.string().min(1).max(128) });
const episodeParams = z.object({ episodeId: z.string().min(1).max(128) });
const albumInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).default(''),
  coverUrl: z.string().url().optional(),
  coverAssetId: z.string().min(1).max(128).optional().nullable(),
  language: z.string().min(2).max(10).default('en'),
  releaseYear: z.number().int().min(1900).max(2100).optional().nullable(),
  dramaType: z.number().int().positive().optional().nullable(),
  tagList: z.array(z.number().int().positive()).min(1).max(3).optional().nullable(),
  regions: z.array(z.string().min(2).max(32)).optional(),
  accessConfig: accessConfigSchema.optional()
});
const albumPatch = albumInput.partial();
const episodeInput = z.object({
  albumId: z.string().min(1).max(128),
  episodeNo: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).optional(),
  coverUrl: z.string().url().optional(),
  coverAssetId: z.string().min(1).max(128).optional().nullable(),
  durationMs: z.number().int().positive().optional(),
  isFree: z.boolean().default(false),
  sortOrder: z.number().int().positive().optional()
});
const episodePatch = episodeInput.omit({ albumId: true, episodeNo: true }).partial();
const mediaBindingInput = z.object({
  byteplusVid: z.string().trim().min(1).max(256),
  byteplusCoverUrl: z.string().url().optional().nullable(),
  durationMs: z.number().int().positive().optional().nullable()
});
const sharedMediaBindingInput = z.object({
  sharedMediaAssetId: z.string().trim().min(1).max(128)
});
const sharedAuthorizationInput = z.object({
  targetMiniAppKey: z.enum(['main', 'xu03']),
  targetLocalAlbumId: z.string().trim().min(1).max(128).optional()
});
const uploadInput = z.object({
  episodeId: z.string().min(1).max(128),
  sourceUrl: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '来源地址必须使用 HTTP 或 HTTPS。'),
  sourceExpiresAt: z.string().datetime().optional()
});
const dramaInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).default(''),
  coverAssetId: z.string().min(1).max(128),
  language: z.string().min(2).max(10).default('en'),
  releaseYear: z.number().int().min(1900).max(2100),
  dramaType: z.number().int().positive(),
  tagList: z.array(z.number().int().positive()).min(1).max(3),
  regions: z.array(z.string().min(2).max(32)).optional(),
  accessConfig: accessConfigSchema.optional(),
  episodes: z.array(z.object({
    episodeNo: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).optional(),
    sortOrder: z.number().int().positive().optional(),
    isFree: z.boolean().default(false),
    coverAssetId: z.string().min(1).max(128).optional().nullable()
  })).min(1).max(500)
});
const appendEpisodesInput = z.object({ episodes: dramaInput.shape.episodes });
const jobParams = z.object({ jobId: z.string().min(1).max(128) });
const blockParams = z.object({ blockId: z.string().min(1).max(128) });
const blockItemParams = z.object({ blockId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) });
const componentParams = z.object({ key: z.enum(['APP_TOPBAR', 'APP_BOTTOM_NAV', 'HOME_INTRO', 'HOME_FEED', 'ALBUM_DESCRIPTION', 'PROFILE_HISTORY', 'PROFILE_FAVORITES']) });
const uiComponentPageInput = z.enum(['APP', 'HOME', 'ALBUM', 'PROFILE']);
const uiComponentConfigInput = z.record(z.string(), z.unknown()).nullable().optional();
const uiComponentSnapshotInput = z.array(z.object({
  key: componentParams.shape.key,
  page: uiComponentPageInput,
  enabled: z.boolean(),
  config: uiComponentConfigInput
})).min(1).max(20);
const adminRoleInput = z.enum(['OWNER', 'EDITOR', 'ANALYST', 'SUPPORT']);
const adminStatusInput = z.enum(['ACTIVE', 'DISABLED']);
const adminCreateInput = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(256),
  role: adminRoleInput.default('EDITOR'),
  status: adminStatusInput.default('ACTIVE')
});
const adminPatchInput = z.object({
  email: z.string().trim().email().max(320).optional(),
  password: z.string().min(12).max(256).optional(),
  role: adminRoleInput.optional(),
  status: adminStatusInput.optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
const passwordChangeInput = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
});
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const analyticsQuery = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
  days: z.coerce.number().int().min(1).max(90).optional()
}).refine((value) => Boolean(value.from) === Boolean(value.to), { message: '开始日期和结束日期必须同时填写。' });
const appEntryAdPolicyInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(['INTERSTITIAL', 'REWARDED_GATED']),
  placementId: z.string().trim().min(1).max(128),
  requiredCount: z.number().int().min(1),
  onUnavailable: z.enum(['ALLOW', 'BLOCK'])
});

const componentLabels: Record<z.infer<typeof componentParams>['key'], string> = {
  APP_TOPBAR: '顶部导航',
  APP_BOTTOM_NAV: '底部导航',
  HOME_INTRO: '首页介绍区',
  HOME_FEED: '首页内容流',
  ALBUM_DESCRIPTION: '剧集简介',
  PROFILE_HISTORY: '观看历史',
  PROFILE_FAVORITES: '收藏列表'
};

function dateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDateKeyDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function zonedMidnight(value: string, timezone: string) {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  let candidate = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    candidate += target - represented;
  }
  return new Date(candidate);
}

function resolveAnalyticsRange(input: z.infer<typeof analyticsQuery>) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format();
  } catch {
    throw Object.assign(new Error('统计时区不正确。'), { statusCode: 400 });
  }
  const to = input.to ?? dateKey(new Date(), input.timezone);
  const from = input.from ?? addDateKeyDays(to, -(input.days ?? 30) + 1);
  if (from > to) throw Object.assign(new Error('统计开始日期不能晚于结束日期。'), { statusCode: 400 });
  const periodDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (periodDays > 366) throw Object.assign(new Error('统计日期范围不能超过 366 天。'), { statusCode: 400 });
  return {
    from,
    to,
    timezone: input.timezone,
    periodDays,
    start: zonedMidnight(from, input.timezone),
    end: zonedMidnight(addDateKeyDays(to, 1), input.timezone)
  };
}

function completeDailySeries(from: string, periodDays: number, values: Array<{ date: string; count: number }>) {
  const counts = new Map(values.map((value) => [value.date, Number(value.count)]));
  return Array.from({ length: periodDays }, (_, index) => {
    const date = addDateKeyDays(from, index);
    return { date, count: counts.get(date) ?? 0 };
  });
}

function extensionMime(extension: string) {
  if (['.jpg', '.jpeg'].includes(extension)) return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return null;
}

function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp' };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return { mimeType: 'image/jpeg' };
  }
  return null;
}

async function validateReadyCover(app: FastifyInstance, coverAssetId?: string | null) {
  if (!coverAssetId) return null;
  const asset = await app.prisma.coverAsset.findUnique({ where: { id: coverAssetId } });
  if (!asset || asset.status !== 'READY') throw Object.assign(new Error('封面资源尚未准备就绪。'), { statusCode: 400 });
  return asset;
}

function ensureTikTokPlatformConfigured(app: FastifyInstance) {
  if (app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET) return;
  throw Object.assign(new Error('TikTok Short Drama OpenAPI 尚未配置。请设置 TIKTOK_CLIENT_KEY 和 TIKTOK_CLIENT_SECRET。'), { statusCode: 503 });
}

function albumDataWithAccess<T extends { accessConfig?: unknown; tagList?: unknown }>(input: T) {
  return {
    ...input,
    accessConfig: input.accessConfig as Prisma.InputJsonValue | undefined,
    tagList: input.tagList === undefined ? undefined : input.tagList === null ? Prisma.JsonNull : input.tagList as Prisma.InputJsonValue
  };
}

async function audit(app: FastifyInstance, adminUserId: string, action: string, resource: string, resourceId?: string, metadata?: unknown) {
  await app.prisma.auditLog.create({ data: { adminUserId, action, resource, resourceId, metadata: metadata as never } });
}

type UiComponentSnapshot = z.infer<typeof uiComponentSnapshotInput>;

function mergeUiComponents(items: UiComponentSnapshot): UiComponentSnapshot {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return defaultUiComponents.map((component) => {
    const stored = byKey.get(component.key);
    return {
      key: component.key,
      page: stored?.page ?? component.page,
      enabled: stored?.enabled ?? component.enabled,
      config: stored?.config ?? null
    };
  });
}

function normalizeUiComponentSnapshot(content: unknown) {
  const parsed = uiComponentSnapshotInput.safeParse(content);
  if (parsed.success) return { items: mergeUiComponents(parsed.data), repaired: false };

  const legacyItems = Array.isArray(content) ? content : [];
  const repairedItems: UiComponentSnapshot = [];
  for (const value of legacyItems) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    const key = componentParams.shape.key.safeParse(candidate.key);
    if (!key.success) continue;
    const fallback = defaultUiComponents.find((component) => component.key === key.data)!;
    const page = uiComponentPageInput.safeParse(candidate.page);
    const config = uiComponentConfigInput.safeParse(candidate.config);
    repairedItems.push({
      key: key.data,
      page: page.success ? page.data : fallback.page,
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
      config: config.success ? config.data ?? null : null
    });
  }
  return { items: mergeUiComponents(repairedItems), repaired: true };
}

async function uiSnapshotFromRows(app: FastifyInstance): Promise<UiComponentSnapshot> {
  const stored = await app.prisma.uiComponent.findMany({ orderBy: [{ page: 'asc' }, { key: 'asc' }] });
  return normalizeUiComponentSnapshot(stored.map((component) => ({
    key: component.key as UiComponentSnapshot[number]['key'],
    page: component.page as UiComponentSnapshot[number]['page'],
    enabled: component.enabled,
    config: component.config as Record<string, unknown> | null
  }))).items;
}

async function currentUiDraft(app: FastifyInstance) {
  const draft = await app.prisma.uiConfigVersion.findFirst({ where: { status: 'DRAFT' }, orderBy: { version: 'desc' } });
  if (draft) {
    const snapshot = normalizeUiComponentSnapshot(draft.content);
    return { version: draft.version, ...snapshot };
  }
  return { version: null, items: await uiSnapshotFromRows(app), repaired: false };
}

async function syncUiComponentRows(tx: Prisma.TransactionClient, items: UiComponentSnapshot) {
  await Promise.all(items.map((item) => tx.uiComponent.upsert({
    where: { key: item.key },
    create: { key: item.key, page: item.page, enabled: item.enabled, config: item.config === null ? Prisma.JsonNull : item.config as Prisma.InputJsonValue | undefined },
    update: { page: item.page, enabled: item.enabled, config: item.config === null ? Prisma.JsonNull : item.config as Prisma.InputJsonValue | undefined }
  })));
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post('/admin/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    const input = z.object({
      email: z.string().trim().email().max(320),
      password: z.string().min(1).max(256)
    }).parse(request.body);
    const admin = await app.prisma.adminUser.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!admin || admin.status !== 'ACTIVE' || !(await verifyPassword(input.password, admin.passwordHash))) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid administrator credentials.', requestId: request.id }
      });
    }
    await app.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const accessToken = await app.jwt.sign(
      { sub: admin.id, kind: 'admin', appKey: app.config.MINI_APP_KEY, role: admin.role, tokenVersion: admin.tokenVersion },
      { expiresIn: app.config.ADMIN_JWT_EXPIRES_IN }
    );
    return { accessToken, expiresIn: app.config.ADMIN_JWT_EXPIRES_IN, admin: { id: admin.id, email: admin.email, role: admin.role } };
  });

  app.get('/admin/me', { preHandler: requireAdmin }, async (request) => {
    const admin = await app.prisma.adminUser.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: { id: true, email: true, role: true, status: true, lastLoginAt: true, passwordChangedAt: true, createdAt: true }
    });
    return { admin };
  });

  app.put('/admin/me/password', { preHandler: requireAdmin }, async (request) => {
    const input = passwordChangeInput.parse(request.body);
    const admin = await app.prisma.adminUser.findUniqueOrThrow({ where: { id: request.user.sub } });
    if (!(await verifyPassword(input.currentPassword, admin.passwordHash))) {
      throw Object.assign(new Error('当前密码不正确。'), { statusCode: 400 });
    }
    const updated = await app.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
      select: { id: true, email: true, role: true }
    });
    await audit(app, request.user.sub, 'CHANGE_PASSWORD', 'AdminUser', updated.id);
    return { admin: updated };
  });

  app.get('/admin/admin-users', { preHandler: requireAdmin }, async () => {
    const items = await app.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, role: true, status: true, lastLoginAt: true, passwordChangedAt: true, createdAt: true, updatedAt: true }
    });
    return { items };
  });

  app.post('/admin/admin-users', { preHandler: requireAdmin }, async (request) => {
    const input = adminCreateInput.parse(request.body);
    const admin = await app.prisma.adminUser.create({
      data: { email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), role: input.role, status: input.status, passwordChangedAt: new Date() },
      select: { id: true, email: true, role: true, status: true, createdAt: true }
    });
    await audit(app, request.user.sub, 'CREATE', 'AdminUser', admin.id, { email: admin.email, role: admin.role, status: admin.status });
    return { admin };
  });

  app.patch('/admin/admin-users/:adminUserId', { preHandler: requireAdmin }, async (request) => {
    const { adminUserId } = z.object({ adminUserId: z.string().min(1).max(128) }).parse(request.params);
    const input = adminPatchInput.parse(request.body);
    if (adminUserId === request.user.sub && input.status === 'DISABLED') {
      throw Object.assign(new Error('不能禁用当前管理员账号。'), { statusCode: 400 });
    }
    const data: Prisma.AdminUserUpdateInput = {
      email: input.email?.toLowerCase(),
      role: input.role,
      status: input.status,
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
      passwordChangedAt: input.password ? new Date() : undefined,
      tokenVersion: input.password || input.role || input.status ? { increment: 1 } : undefined
    };
    const admin = await app.prisma.adminUser.update({
      where: { id: adminUserId },
      data,
      select: { id: true, email: true, role: true, status: true, lastLoginAt: true, passwordChangedAt: true, createdAt: true, updatedAt: true }
    });
    await audit(app, request.user.sub, 'UPDATE', 'AdminUser', admin.id, { email: input.email, role: input.role, status: input.status, passwordChanged: Boolean(input.password) });
    return { admin };
  });

  app.get('/admin/audit-logs', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const items = await app.prisma.auditLog.findMany({
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { id: true, email: true, role: true } } }
    });
    const hasMore = items.length > query.limit;
    const visible = hasMore ? items.slice(0, query.limit) : items;
    return { items: visible, nextCursor: hasMore ? visible.at(-1)?.id ?? null : null };
  });

  app.get('/admin/app-entry-ad-policy', { preHandler: requireAdmin }, async () => readAppEntryAdPolicy(app));
  app.put('/admin/app-entry-ad-policy', { preHandler: requireAdmin }, async (request) => {
    const input = appEntryAdPolicyInput.parse(request.body);
    const current = await readAppEntryAdPolicy(app);
    const policy = await app.prisma.appEntryAdPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...input, version: 1, updatedBy: request.user.sub },
      update: { ...input, version: current.version + 1, updatedBy: request.user.sub }
    });
    await audit(app, request.user.sub, 'UPDATE', 'AppEntryAdPolicy', policy.id, input);
    return policy;
  });

  app.get('/admin/albums', { preHandler: requireAdmin }, async () => {
    const albums = await app.prisma.album.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { episodes: true } } }
    });
    return { items: albums.map((album) => ({ ...album, episodeCount: album._count.episodes, _count: undefined })) };
  });

  app.get('/admin/episodes', { preHandler: requireAdmin }, async () => {
    const episodes = await app.prisma.episode.findMany({
      orderBy: [{ album: { title: 'asc' } }, { sortOrder: 'asc' }],
      select: { id: true, albumId: true, episodeNo: true, title: true, sortOrder: true, status: true, byteplusVid: true, byteplusCoverUrl: true, coverUrl: true, durationMs: true, tiktokEpisodeId: true, album: { select: { title: true, status: true, tiktokAlbumId: true } } }
    });
    return { items: episodes };
  });

  app.get('/admin/albums/:albumId', { preHandler: requireAdmin }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.findUnique({
      where: { id: albumId },
      include: { episodes: { orderBy: { sortOrder: 'asc' }, include: { translations: true } }, translations: true, genres: { include: { genre: true } } }
    });
    if (!album) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '剧集不存在。', requestId: request.id } });
    return album;
  });

  app.post('/admin/cover-assets', { preHandler: requireAdmin }, async (request, reply) => {
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '请选择一张封面图片上传。', requestId: request.id } });
    const fileName = upload.filename.trim();
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    const expectedMime = extensionMime(extension);
    if (!expectedMime) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '支持 JPEG、PNG 和 WebP 封面格式。', requestId: request.id } });

    const tempDirectory = join(tmpdir(), 'quickreels-covers');
    const tempPath = join(tempDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    await mkdir(tempDirectory, { recursive: true });
    try {
      await pipeline(upload.file, createWriteStream(tempPath));
      if (upload.file.truncated) throw Object.assign(new Error('所选图片超过 10 MB 大小限制。'), { statusCode: 413 });
      const buffer = await readFile(tempPath);
      if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '封面图片大小必须在 1 字节至 10 MB 之间。', requestId: request.id } });
      }
      const image = detectImage(buffer);
      if (!image || image.mimeType !== expectedMime || (upload.mimetype && upload.mimetype !== expectedMime)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '封面文件扩展名与图片类型不匹配。', requestId: request.id } });
      }
      if (image.width && image.height) {
        const pixels = image.width * image.height;
        const ratio = image.width / image.height;
        if (pixels > 24_000_000 || ratio < 0.4 || ratio > 2.5) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '封面尺寸超出允许范围。', requestId: request.id } });
        }
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const existing = await app.prisma.coverAsset.findUnique({ where: { sha256 } });
      if (existing?.status === 'READY') {
        const syncJob = app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET
          ? await enqueueCoverSync(app.prisma as any, existing.id, request.user.sub)
          : null;
        return { ...existing, platformSyncJob: syncJob };
      }

      const storage = await new LocalObjectStorageService(app.config).putObject({
        key: `${sha256}${extension === '.jpeg' ? '.jpg' : extension}`,
        filePath: tempPath,
        contentType: expectedMime
      });
      const asset = await app.prisma.coverAsset.upsert({
        where: { sha256 },
        create: {
          storageKey: storage.storageKey,
          publicUrl: storage.publicUrl,
          mimeType: expectedMime,
          fileSize: buffer.length,
          width: image.width,
          height: image.height,
          sha256,
          status: 'READY'
        },
        update: {
          storageKey: storage.storageKey,
          publicUrl: storage.publicUrl,
          mimeType: expectedMime,
          fileSize: buffer.length,
          width: image.width,
          height: image.height,
          status: 'READY'
        }
      });
      await audit(app, request.user.sub, 'UPLOAD', 'CoverAsset', asset.id, { fileName, fileSize: buffer.length });
      const syncJob = app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET
        ? await enqueueCoverSync(app.prisma as any, asset.id, request.user.sub)
        : null;
      return { ...asset, platformSyncJob: syncJob };
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  });

  app.post('/admin/dramas', { preHandler: requirePermission('content.write') }, async (request) => {
    const input = dramaInput.parse(request.body);
    if (new Set(input.episodes.map((episode) => episode.episodeNo)).size !== input.episodes.length) {
      throw Object.assign(new Error('分集集号不能重复。'), { statusCode: 400 });
    }
    const albumCover = await validateReadyCover(app, input.coverAssetId);
    const episodeCoverIds = Array.from(new Set(input.episodes.flatMap((episode) => episode.coverAssetId ? [episode.coverAssetId] : [])));
    const episodeCovers = episodeCoverIds.length ? await app.prisma.coverAsset.findMany({ where: { id: { in: episodeCoverIds }, status: 'READY' } }) : [];
    if (episodeCovers.length !== episodeCoverIds.length) throw Object.assign(new Error('一个或多个分集封面资源尚未准备就绪。'), { statusCode: 400 });
    const coverById = new Map(episodeCovers.map((cover) => [cover.id, cover]));

    const result = await app.prisma.$transaction(async (tx) => {
      const album = await tx.album.create({
        data: {
          title: input.title,
          description: input.description,
          coverAssetId: albumCover!.id,
          coverUrl: albumCover!.publicUrl,
          language: input.language,
          releaseYear: input.releaseYear,
          dramaType: input.dramaType,
          tagList: input.tagList as Prisma.InputJsonValue,
          regions: input.regions,
          accessConfig: input.accessConfig as Prisma.InputJsonValue | undefined,
          status: 'DRAFT'
        }
      });
      const episodes = await Promise.all(input.episodes.map((episode) => {
        const cover = episode.coverAssetId ? coverById.get(episode.coverAssetId) : null;
        return tx.episode.create({
          data: {
            albumId: album.id,
            episodeNo: episode.episodeNo,
            title: episode.title,
            description: episode.description,
            sortOrder: episode.sortOrder ?? episode.episodeNo,
            isFree: episode.isFree,
            coverAssetId: cover?.id,
            coverUrl: cover?.publicUrl,
            status: 'DRAFT'
          }
        });
      }));
      await tx.auditLog.create({ data: { adminUserId: request.user.sub, action: 'CREATE', resource: 'Drama', resourceId: album.id, metadata: { episodeCount: episodes.length } as never } });
      return { album, episodes };
    });
    return result;
  });

  app.post('/admin/albums/:albumId/episodes/batch', { preHandler: requirePermission('content.write') }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const { episodes: inputEpisodes } = appendEpisodesInput.parse(request.body);
    const numbers = inputEpisodes.map((episode) => episode.episodeNo);
    if (new Set(numbers).size !== numbers.length) throw Object.assign(new Error('新增分集集号不能重复。'), { statusCode: 400 });
    const coverIds = [...new Set(inputEpisodes.flatMap((episode) => episode.coverAssetId ? [episode.coverAssetId] : []))];
    const covers = coverIds.length ? await app.prisma.coverAsset.findMany({ where: { id: { in: coverIds }, status: 'READY' } }) : [];
    if (covers.length !== coverIds.length) throw Object.assign(new Error('一个或多个分集封面尚未准备就绪。'), { statusCode: 400 });
    const coverById = new Map(covers.map((cover) => [cover.id, cover]));
    try {
      return await app.prisma.$transaction(async (tx) => {
        const album = await tx.album.findUnique({ where: { id: albumId }, select: { id: true, title: true, accessConfig: true, _count: { select: { episodes: true } } } });
        if (!album) throw Object.assign(new Error('目标剧集不存在。'), { statusCode: 404 });
        if (album._count.episodes + inputEpisodes.length > 500) throw Object.assign(new Error('单部剧集最多 500 集。'), { statusCode: 400 });
        const existing = await tx.episode.findMany({ where: { albumId, episodeNo: { in: numbers } }, select: { episodeNo: true } });
        if (existing.length) throw Object.assign(new Error(`集号已存在：${existing.map((episode) => episode.episodeNo).join('、')}。`), { statusCode: 409 });
        const episodes = [];
        for (const input of inputEpisodes) {
          const cover = input.coverAssetId ? coverById.get(input.coverAssetId) : null;
          episodes.push(await tx.episode.create({ data: {
            albumId,
            episodeNo: input.episodeNo,
            title: input.title,
            description: input.description,
            sortOrder: input.sortOrder ?? input.episodeNo,
            isFree: input.isFree,
            coverAssetId: cover?.id,
            coverUrl: cover?.publicUrl,
            status: 'DRAFT'
          } }));
        }
        await tx.auditLog.create({ data: { adminUserId: request.user.sub, action: 'APPEND', resource: 'Album', resourceId: albumId, metadata: { episodeNos: numbers } as never } });
        return { album: { id: album.id, title: album.title, accessConfig: album.accessConfig }, episodes };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Object.assign(new Error('集号已被其他操作占用，请刷新分集列表后重试。'), { statusCode: 409 });
      }
      throw error;
    }
  });

  app.post('/admin/albums', { preHandler: requireAdmin }, async (request) => {
    const input = albumInput.parse(request.body);
    const cover = await validateReadyCover(app, input.coverAssetId);
    if (!cover && !input.coverUrl) throw Object.assign(new Error('必须提供封面地址或封面资源 ID。'), { statusCode: 400 });
    const album = await app.prisma.album.create({ data: { ...albumDataWithAccess(input), coverUrl: cover?.publicUrl ?? input.coverUrl!, coverAssetId: cover?.id ?? input.coverAssetId, regions: input.regions } });
    await audit(app, request.user.sub, 'CREATE', 'Album', album.id);
    return album;
  });

  app.patch('/admin/albums/:albumId', { preHandler: requireAdmin }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const input = albumPatch.parse(request.body);
    const cover = await validateReadyCover(app, input.coverAssetId);
    const album = await app.prisma.album.update({ where: { id: albumId }, data: { ...albumDataWithAccess(input), coverUrl: cover?.publicUrl ?? input.coverUrl, coverAssetId: input.coverAssetId === undefined ? undefined : cover?.id ?? null } });
    await audit(app, request.user.sub, 'UPDATE', 'Album', album.id, input);
    return album;
  });

  app.delete('/admin/albums/:albumId', { preHandler: requirePermission('content.write') }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true, title: true, status: true, tiktokAlbumId: true }
    });
    if (!album) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '剧集不存在。', requestId: request.id } });
    if (album.status !== 'DRAFT' || album.tiktokAlbumId) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: '仅未同步至 TikTok 的草稿剧集可以删除。请先下架并保留已同步内容的审计记录。', requestId: request.id } });
    }
    await app.prisma.album.delete({ where: { id: album.id } });
    await audit(app, request.user.sub, 'DELETE', 'Album', album.id, { title: album.title });
    return reply.code(204).send();
  });

  app.post('/admin/episodes', { preHandler: requireAdmin }, async (request) => {
    const input = episodeInput.parse(request.body);
    const cover = await validateReadyCover(app, input.coverAssetId);
    const episode = await app.prisma.episode.create({ data: { ...input, coverUrl: cover?.publicUrl ?? input.coverUrl, coverAssetId: cover?.id ?? input.coverAssetId, sortOrder: input.sortOrder ?? input.episodeNo } });
    await audit(app, request.user.sub, 'CREATE', 'Episode', episode.id);
    return episode;
  });

  app.patch('/admin/episodes/:episodeId', { preHandler: requireAdmin }, async (request) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = episodePatch.parse(request.body);
    const cover = await validateReadyCover(app, input.coverAssetId);
    const episode = await app.prisma.episode.update({ where: { id: episodeId }, data: { ...input, coverUrl: cover?.publicUrl ?? input.coverUrl, coverAssetId: input.coverAssetId === undefined ? undefined : cover?.id ?? null } });
    await audit(app, request.user.sub, 'UPDATE', 'Episode', episode.id, input);
    return episode;
  });

  app.post('/admin/episodes/:episodeId/bind-byteplus', { preHandler: requireAdmin }, async (request, reply) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = mediaBindingInput.parse(request.body);
    const mediaService = new BytePlusVodService(app.config);
    const [media] = await mediaService.getMediaInfos({ vids: [input.byteplusVid] });
    if (!media) {
      return reply.code(404).send({ error: { code: 'BYTEPLUS_MEDIA_NOT_FOUND', message: '在配置的媒体空间中找不到 BytePlus 视频 ID。', requestId: request.id } });
    }
    const sharedMedia = await getOrCreateSharedMediaAsset(app.sharedPrisma as any, {
      byteplusVid: media.vid,
      byteplusAccountId: app.config.BYTEPLUS_ACCOUNT_ID,
      byteplusSpaceName: app.config.BYTEPLUS_SPACE_NAME,
      byteplusRegion: app.config.BYTEPLUS_REGION,
      miniAppKey: app.config.MINI_APP_KEY,
      title: media.title,
      coverUrl: input.byteplusCoverUrl ?? media.coverUrl,
      durationMs: input.durationMs ?? media.durationMs
    });
    const currentEpisode = await app.prisma.episode.findUnique({ where: { id: episodeId }, select: { coverAsset: { select: { publicUrl: true, status: true } } } });
    const providerCoverUrl = input.byteplusCoverUrl ?? media.coverUrl;
    const episode = await app.prisma.episode.update({
      where: { id: episodeId },
      data: {
        byteplusVid: media.vid,
        byteplusCoverUrl: providerCoverUrl,
        coverUrl: currentEpisode?.coverAsset?.status === 'READY' ? currentEpisode.coverAsset.publicUrl : providerCoverUrl,
        durationMs: input.durationMs ?? media.durationMs,
        status: 'READY',
        byteplusUploadStatus: 'READY',
        tiktokVideoStatus: 'NOT_STARTED',
        tiktokVideoJobId: null,
        tiktokVideoError: null
      }
    });
    await audit(app, request.user.sub, 'BIND_BYTEPLUS_MEDIA', 'Episode', episode.id, {
      byteplusVid: media.vid,
      sharedMediaAssetId: sharedMedia.id
    });
    const syncJob = app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET
      ? await enqueueVideoSync(app.prisma as any, episode.id, request.user.sub)
      : null;
    return { ...episode, sharedMediaAsset: sharedMedia, platformSyncJob: syncJob };
  });

  app.post('/admin/episodes/:episodeId/bind-shared-media', { preHandler: requirePermission('content.write') }, async (request) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = sharedMediaBindingInput.parse(request.body);
    const result = await bindEpisodeToSharedMedia(app.sharedPrisma as any, app.prisma as any, app.config, app.config.MINI_APP_KEY, episodeId, input.sharedMediaAssetId);
    await audit(app, request.user.sub, 'BIND_SHARED_MEDIA', 'Episode', episodeId, {
      sharedMediaAssetId: input.sharedMediaAssetId,
      byteplusVid: result.media.byteplusVid
    });
    const syncJob = app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET
      ? await enqueueVideoSync(app.prisma as any, episodeId, request.user.sub)
      : null;
    return { ...result.episode, sharedMediaAsset: result.media, platformSyncJob: syncJob };
  });

  app.patch('/admin/episodes/:episodeId/access', { preHandler: requireAdmin }, async (request) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = z.object({ isFree: z.boolean() }).parse(request.body);
    const episode = await app.prisma.episode.update({ where: { id: episodeId }, data: { isFree: input.isFree } });
    await audit(app, request.user.sub, 'UPDATE_ACCESS', 'Episode', episode.id, input);
    return { id: episode.id, isFree: episode.isFree };
  });

  app.get('/admin/ui-components', { preHandler: requireAdmin }, async () => {
    const [draft, published] = await Promise.all([
      currentUiDraft(app),
      app.prisma.uiConfigVersion.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' } })
    ]);
    return {
      items: draft.items.map((component) => ({ ...component, label: componentLabels[component.key] })),
      draftVersion: draft.version,
      publishedVersion: published?.version ?? 0,
      publishedAt: published?.publishedAt ?? null
    };
  });
  app.patch('/admin/ui-components/:key', { preHandler: requireAdmin }, async (request) => {
    const { key } = componentParams.parse(request.params);
    const input = z.object({ page: uiComponentPageInput.optional(), enabled: z.boolean().optional(), config: uiComponentConfigInput }).parse(request.body);
    const draft = await currentUiDraft(app);
    const items = draft.items.map((component) => component.key === key ? { ...component, ...input, config: input.config === undefined ? component.config ?? null : input.config } : component);
    const saved = draft.version
      ? await app.prisma.uiConfigVersion.update({ where: { version: draft.version }, data: { content: items as unknown as Prisma.InputJsonValue } })
      : await app.prisma.uiConfigVersion.create({ data: { content: items as unknown as Prisma.InputJsonValue, createdById: request.user.sub } });
    await audit(app, request.user.sub, 'SAVE_DRAFT', 'UiConfigVersion', String(saved.version), { key, ...input });
    return { items, draftVersion: saved.version, status: saved.status };
  });

  app.put('/admin/ui-components/draft', { preHandler: requireAdmin }, async (request) => {
    const input = z.object({ items: uiComponentSnapshotInput }).parse(request.body);
    const draft = await currentUiDraft(app);
    const items = mergeUiComponents(input.items);
    const saved = draft.version
      ? await app.prisma.uiConfigVersion.update({ where: { version: draft.version }, data: { content: items as unknown as Prisma.InputJsonValue } })
      : await app.prisma.uiConfigVersion.create({ data: { content: items as unknown as Prisma.InputJsonValue, createdById: request.user.sub } });
    await audit(app, request.user.sub, 'SAVE_DRAFT', 'UiConfigVersion', String(saved.version), { componentCount: items.length });
    return { items, draftVersion: saved.version, status: saved.status };
  });

  app.post('/admin/ui-components/publish', { preHandler: requireAdmin }, async (request) => {
    const draft = await app.prisma.uiConfigVersion.findFirst({ where: { status: 'DRAFT' }, orderBy: { version: 'desc' } });
    if (!draft) throw Object.assign(new Error('没有可发布的页面组件草稿。'), { statusCode: 409 });
    const { items, repaired } = normalizeUiComponentSnapshot(draft.content);
    const published = await app.prisma.$transaction(async (tx) => {
      await tx.uiConfigVersion.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      const result = await tx.uiConfigVersion.update({
        where: { version: draft.version },
        data: { status: 'PUBLISHED', content: items as unknown as Prisma.InputJsonValue, publishedById: request.user.sub, publishedAt: new Date() }
      });
      await syncUiComponentRows(tx, items);
      return result;
    });
    await audit(app, request.user.sub, 'PUBLISH', 'UiConfigVersion', String(published.version), { componentCount: items.length, repairedLegacyContent: repaired });
    return { items, version: published.version, publishedAt: published.publishedAt, repairedLegacyContent: repaired };
  });

  app.post('/admin/ui-components/rollback', { preHandler: requireAdmin }, async (request) => {
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body);
    const target = await app.prisma.uiConfigVersion.findUnique({ where: { version } });
    if (!target) throw Object.assign(new Error('找不到页面配置版本。'), { statusCode: 404 });
    const { items, repaired } = normalizeUiComponentSnapshot(target.content);
    const restored = await app.prisma.$transaction(async (tx) => {
      await tx.uiConfigVersion.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      const result = await tx.uiConfigVersion.create({
        data: { status: 'PUBLISHED', content: items as unknown as Prisma.InputJsonValue, createdById: request.user.sub, publishedById: request.user.sub, publishedAt: new Date() }
      });
      await syncUiComponentRows(tx, items);
      return result;
    });
    await audit(app, request.user.sub, 'ROLLBACK', 'UiConfigVersion', String(restored.version), { sourceVersion: version, repairedLegacyContent: repaired });
    return { items, version: restored.version, publishedAt: restored.publishedAt, repairedLegacyContent: repaired };
  });

  app.get('/admin/upload-jobs', { preHandler: requireAdmin }, async () => {
    const jobs = await app.prisma.uploadJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { episode: true } });
    return { items: jobs };
  });

  app.post('/admin/upload-jobs', { preHandler: requireAdmin }, async (request) => {
    const input = uploadInput.parse(request.body);
    const episode = await app.prisma.episode.findFirst({ where: { id: input.episodeId }, select: { id: true, album: { select: { status: true } } } });
    if (!episode) throw Object.assign(new Error('分集不存在。'), { statusCode: 404 });
    if (episode.album.status === 'OFFLINE') throw Object.assign(new Error('下线剧集的分集不能上传。'), { statusCode: 409 });
    if (input.sourceExpiresAt && new Date(input.sourceExpiresAt) <= new Date()) {
      throw Object.assign(new Error('来源过期时间必须晚于当前时间。'), { statusCode: 400 });
    }
    const job = await app.prisma.uploadJob.create({ data: { episodeId: input.episodeId, sourceUrl: input.sourceUrl, sourceExpiresAt: input.sourceExpiresAt ? new Date(input.sourceExpiresAt) : undefined } });
    await audit(app, request.user.sub, 'CREATE', 'UploadJob', job.id, { episodeId: input.episodeId });
    return job;
  });

  app.get('/admin/byteplus/media', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({
      offset: z.coerce.number().int().min(0).default(0),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      status: z.string().trim().min(1).optional()
    }).parse(request.query);
    return new BytePlusVodService(app.config).listMedia(query);
  });

  app.post('/admin/upload-jobs/local', { preHandler: requireAdmin }, async (request, reply) => {
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '请选择视频文件上传。', requestId: request.id } });
    const episodeField = upload.fields.episodeId;
    const episodeId = episodeField && !Array.isArray(episodeField) && 'value' in episodeField && typeof episodeField.value === 'string' ? episodeField.value.trim() : '';
    if (!episodeId) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'episodeId is required.', requestId: request.id } });
    const fileName = upload.filename.trim();
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    if (!['.mp4', '.mov', '.m4v'].includes(extension)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'TikTok 短剧仅接受兼容的 MP4、MOV 或 M4V 视频格式。', requestId: request.id } });
    }
    const episode = await app.prisma.episode.findUnique({ where: { id: episodeId }, select: { id: true, title: true, coverAsset: { select: { publicUrl: true, status: true } }, album: { select: { status: true } } } });
    if (!episode) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '分集不存在。', requestId: request.id } });
    if (episode.album.status === 'OFFLINE') return reply.code(409).send({ error: { code: 'CONFLICT', message: '下线剧集的分集不能上传。', requestId: request.id } });

    const tempDirectory = join(tmpdir(), 'quickreels-vod');
    const tempPath = join(tempDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    await mkdir(tempDirectory, { recursive: true });
    try {
      await pipeline(upload.file, (await import('node:fs')).createWriteStream(tempPath));
      if (upload.file.truncated) throw Object.assign(new Error('所选文件超过 2 GB 大小限制。'), { statusCode: 413 });
      const service = new BytePlusVodService(app.config);
      const result = await service.uploadLocalVideo({
        filePath: tempPath,
        fileName,
        spaceName: app.config.BYTEPLUS_SPACE_NAME,
        byteplusAccountId: app.config.BYTEPLUS_ACCOUNT_ID
      });
      const [job] = await app.prisma.$transaction([
        app.prisma.uploadJob.create({ data: { episodeId, sourceUrl: `local://${fileName}`, sourceType: 'FILE', sourceName: fileName, status: 'SUCCEEDED', startedAt: new Date(), completedAt: new Date() } }),
        app.prisma.episode.update({ where: { id: episodeId }, data: { status: 'READY', byteplusUploadStatus: 'READY', tiktokVideoStatus: 'NOT_STARTED', tiktokVideoJobId: null, tiktokVideoError: null, byteplusVid: result.byteplusVid, byteplusCoverUrl: result.coverUrl, coverUrl: episode.coverAsset?.status === 'READY' ? episode.coverAsset.publicUrl : result.coverUrl, durationMs: result.durationMs } })
      ]);
      await audit(app, request.user.sub, 'UPLOAD_LOCAL', 'UploadJob', job.id, { episodeId, fileName, byteplusVid: result.byteplusVid });
      const syncJob = app.config.TIKTOK_CLIENT_KEY && app.config.TIKTOK_CLIENT_SECRET
        ? await enqueueVideoSync(app.prisma as any, episodeId, request.user.sub)
        : null;
      return { job, platformSyncJob: syncJob, episode: { id: episodeId, status: 'READY', byteplusVid: result.byteplusVid, durationMs: result.durationMs } };
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  });

  app.get('/admin/upload-jobs/:jobId', { preHandler: requireAdmin }, async (request, reply) => {
    const { jobId } = jobParams.parse(request.params);
    const job = await app.prisma.uploadJob.findUnique({ where: { id: jobId }, include: { episode: true } });
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Upload job not found.', requestId: request.id } });
    return job;
  });

  app.post('/admin/upload-jobs/:jobId/retry', { preHandler: requireAdmin }, async (request, reply) => {
    const { jobId } = jobParams.parse(request.params);
    const job = await app.prisma.uploadJob.findUnique({ where: { id: jobId } });
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Upload job not found.', requestId: request.id } });
    if (job.sourceType === 'FILE') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: '本地上传任务需要重新选择视频文件后再试。', requestId: request.id } });
    }
    if (job.status !== 'FAILED') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Only failed upload jobs can be retried.', requestId: request.id } });
    }
    if (job.sourceExpiresAt && job.sourceExpiresAt <= new Date()) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: '上传来源地址已过期，无法重试。', requestId: request.id } });
    }
    const retriedJob = await app.prisma.$transaction(async (tx) => {
      const next = await tx.uploadJob.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          providerJobId: null,
          retryCount: 0,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          nextAttemptAt: new Date()
        }
      });
      await tx.episode.update({ where: { id: job.episodeId }, data: { status: 'DRAFT' } });
      return next;
    });
    await audit(app, request.user.sub, 'RETRY', 'UploadJob', retriedJob.id, { episodeId: retriedJob.episodeId });
    return retriedJob;
  });

  app.get('/admin/platform-sync-jobs', { preHandler: requirePermission('content.read') }, async (request) => {
    const query = z.object({ albumId: z.string().min(1).max(128).optional(), episodeId: z.string().min(1).max(128).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const items = await (app.prisma as any).platformSyncJob.findMany({
      where: { ...(query.albumId ? { albumId: query.albumId } : {}), ...(query.episodeId ? { episodeId: query.episodeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { album: { select: { id: true, title: true } }, episode: { select: { id: true, episodeNo: true, title: true } }, coverAsset: { select: { id: true, publicUrl: true } }, createdByAdminUser: { select: { id: true, email: true } } }
    });
    return { items };
  });

  app.get('/admin/shared/media-assets', { preHandler: requirePermission('content.read') }, async (request) => {
    const query = z.object({
      status: z.string().trim().min(1).optional(),
      byteplusVid: z.string().trim().min(1).max(256).optional(),
      sourceSha256: z.string().trim().min(1).max(128).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(100)
    }).parse(request.query);
    return { items: await listSharedMediaAssets(app.sharedPrisma as any, { ...query, status: query.status as any }) };
  });

  app.get('/admin/shared/albums', { preHandler: requirePermission('content.read') }, async () => {
    const items = await (app.sharedPrisma as any).sharedTikTokAlbum.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { episodes: true, authorizations: true } },
        authorizations: true
      }
    });
    return { items };
  });

  app.get('/admin/shared/albums/:sharedAlbumId', { preHandler: requirePermission('content.read') }, async (request, reply) => {
    const { sharedAlbumId } = z.object({ sharedAlbumId: z.string().min(1).max(128) }).parse(request.params);
    const item = await (app.sharedPrisma as any).sharedTikTokAlbum.findUnique({
      where: { id: sharedAlbumId },
      include: {
        episodes: { include: { media: true }, orderBy: { episodeNo: 'asc' } },
        authorizations: true,
        operations: { orderBy: { createdAt: 'desc' }, take: 20 }
      }
    });
    if (!item) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '共享主剧目不存在。', requestId: request.id } });
    return item;
  });

  app.post('/admin/albums/:albumId/share', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { albumId } = albumParams.parse(request.params);
    const sharedAlbum = await createSharedAlbumFromLocal(app.sharedPrisma as any, app.prisma as any, app.config, app.config.MINI_APP_KEY, albumId);
    await audit(app, request.user.sub, 'CREATE_SHARED_ALBUM', 'SharedTikTokAlbum', sharedAlbum.id, {
      albumId,
      tiktokAlbumId: sharedAlbum.tiktokAlbumId
    });
    return sharedAlbum;
  });

  app.post('/admin/shared/albums/:sharedAlbumId/authorizations', { preHandler: requirePermission('content.review') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { sharedAlbumId } = z.object({ sharedAlbumId: z.string().min(1).max(128) }).parse(request.params);
    const input = sharedAuthorizationInput.parse(request.body);
    const targetPrisma = app.miniAppPrisma[input.targetMiniAppKey];
    if (!targetPrisma) throw Object.assign(new Error(`目标小程序 ${input.targetMiniAppKey} 未启用。`), { statusCode: 409 });
    if (input.targetLocalAlbumId) {
      const targetAlbum = await targetPrisma.album.findUnique({ where: { id: input.targetLocalAlbumId }, select: { id: true } });
      if (!targetAlbum) throw Object.assign(new Error('目标小程序本地剧目不存在。'), { statusCode: 404 });
    }
    const result = await enqueueSharedAlbumAuthorization(
      app.sharedPrisma as any,
      app.config,
      sharedAlbumId,
      input.targetMiniAppKey,
      input.targetLocalAlbumId,
      request.user.sub
    );
    await audit(app, request.user.sub, 'AUTHORIZE_SHARED_ALBUM', 'SharedTikTokAlbum', sharedAlbumId, {
      targetMiniAppKey: input.targetMiniAppKey,
      targetLocalAlbumId: input.targetLocalAlbumId ?? null,
      operationId: result.operation?.id ?? null
    });
    return result;
  });

  app.post('/admin/shared/albums/:sharedAlbumId/reconcile', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { sharedAlbumId } = z.object({ sharedAlbumId: z.string().min(1).max(128) }).parse(request.params);
    const operation = await enqueueSharedAlbumReconcile(app.sharedPrisma as any, sharedAlbumId, request.user.sub);
    await audit(app, request.user.sub, 'RECONCILE_SHARED_ALBUM', 'SharedTikTokAlbum', sharedAlbumId, { operationId: operation.id });
    return { operation };
  });

  app.post('/admin/cover-assets/:coverAssetId/sync', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { coverAssetId } = z.object({ coverAssetId: z.string().min(1).max(128) }).parse(request.params);
    const job = await enqueueCoverSync(app.prisma as any, coverAssetId, request.user.sub);
    await audit(app, request.user.sub, 'SYNC_TIKTOK', 'CoverAsset', coverAssetId, { jobId: job?.id ?? null });
    return { job, alreadySynced: !job };
  });

  app.post('/admin/episodes/:episodeId/sync-tiktok-video', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { episodeId } = episodeParams.parse(request.params);
    const job = await enqueueVideoSync(app.prisma as any, episodeId, request.user.sub);
    await audit(app, request.user.sub, 'SYNC_TIKTOK_VIDEO', 'Episode', episodeId, { jobId: job?.id ?? null });
    return { job, alreadySynced: !job };
  });

  app.post('/admin/albums/:albumId/sync-version', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { albumId } = albumParams.parse(request.params);
    const job = await enqueueAlbumVersionSync(app.prisma as any, albumId, request.user.sub);
    await audit(app, request.user.sub, 'SYNC_TIKTOK_ALBUM_VERSION', 'Album', albumId, { jobId: job.id, snapshotHash: job.snapshotHash });
    return { job };
  });

  app.post('/admin/albums/:albumId/reconcile', { preHandler: requirePermission('content.sync') }, async (request) => {
    ensureTikTokPlatformConfigured(app);
    const { albumId } = albumParams.parse(request.params);
    const job = await enqueueAlbumAction(app.prisma as any, 'RECONCILE', albumId, request.user.sub);
    await audit(app, request.user.sub, 'RECONCILE_TIKTOK_ALBUM', 'Album', albumId, { jobId: job.id });
    return { job };
  });

  app.post('/admin/albums/:albumId/review-submit', { preHandler: requirePermission('content.review') }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const { priorityScore } = z.object({ priorityScore: z.union([z.literal(1), z.literal(2)]).default(2) }).strict().parse(request.body ?? {});
    ensureTikTokPlatformConfigured(app);
    const job = await enqueueAlbumAction(app.prisma as any, 'REVIEW', albumId, request.user.sub, priorityScore);
    await audit(app, request.user.sub, 'SUBMIT_TIKTOK_REVIEW', 'Album', albumId, { jobId: job.id, priorityScore });
    return { job };
  });

  app.post('/admin/albums/:albumId/online-version', { preHandler: requirePermission('content.publish') }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    ensureTikTokPlatformConfigured(app);
    const job = await enqueueAlbumAction(app.prisma as any, 'SET_ONLINE_VERSION', albumId, request.user.sub);
    await audit(app, request.user.sub, 'SET_TIKTOK_ONLINE_VERSION', 'Album', albumId, { jobId: job.id });
    return { job };
  });

  app.post('/admin/albums/:albumId/online', { preHandler: requirePermission('content.publish') }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    ensureTikTokPlatformConfigured(app);
    const job = await enqueueAlbumAction(app.prisma as any, 'PUBLISH', albumId, request.user.sub);
    await audit(app, request.user.sub, 'PUBLISH_TIKTOK_ALBUM', 'Album', albumId, { jobId: job.id });
    return { job };
  });

  app.post('/admin/albums/:albumId/offline', { preHandler: requirePermission('content.publish') }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    ensureTikTokPlatformConfigured(app);
    const job = await enqueueAlbumAction(app.prisma as any, 'UNPUBLISH', albumId, request.user.sub);
    await audit(app, request.user.sub, 'UNPUBLISH_TIKTOK_ALBUM', 'Album', albumId, { jobId: job.id });
    return { job };
  });

  app.get('/admin/home-blocks', { preHandler: requireAdmin }, async () => app.prisma.homeBlock.findMany({ orderBy: { sortOrder: 'asc' }, include: { items: true } }));
  app.patch('/admin/home-blocks/:blockId', { preHandler: requireAdmin }, async (request) => {
    const { blockId } = blockParams.parse(request.params);
    const input = z.object({ title: z.string().trim().min(1).max(160).optional(), enabled: z.boolean().optional(), sortOrder: z.number().int().nonnegative().optional(), config: z.unknown().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const block = await app.prisma.homeBlock.update({ where: { id: blockId }, data: { ...input, config: input.config === undefined ? undefined : input.config === null ? Prisma.JsonNull : input.config as Prisma.InputJsonValue, startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null } });
    await audit(app, request.user.sub, 'UPDATE', 'HomeBlock', block.id, input);
    return block;
  });
  app.post('/admin/home-blocks/:blockId/items', { preHandler: requireAdmin }, async (request) => {
    const { blockId } = blockParams.parse(request.params);
    const input = z.object({ albumId: z.string().min(1).max(128).optional(), targetEpisodeId: z.string().min(1).max(128).optional(), imageUrl: z.string().url().optional(), previewUrl: z.string().url().optional(), linkPath: z.string().regex(/^\/(album|watch)\//).optional(), sortOrder: z.number().int().nonnegative(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const item = await app.prisma.homeBlockItem.create({ data: { ...input, blockId, startsAt: input.startsAt ? new Date(input.startsAt) : undefined, endsAt: input.endsAt ? new Date(input.endsAt) : undefined } });
    await audit(app, request.user.sub, 'CREATE', 'HomeBlockItem', item.id, { blockId });
    return item;
  });
  app.patch('/admin/home-blocks/:blockId/items/:itemId', { preHandler: requireAdmin }, async (request) => {
    const { blockId, itemId } = blockItemParams.parse(request.params);
    const input = z.object({ imageUrl: z.string().url().nullable().optional(), previewUrl: z.string().url().nullable().optional(), linkPath: z.string().regex(/^\/(album|watch)\//).nullable().optional(), sortOrder: z.number().int().nonnegative().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const result = await app.prisma.homeBlockItem.updateMany({ where: { id: itemId, blockId }, data: { ...input, startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null } });
    if (!result.count) throw Object.assign(new Error('首页区块内容不存在。'), { statusCode: 404 });
    const item = await app.prisma.homeBlockItem.findUniqueOrThrow({ where: { id: itemId } });
    await audit(app, request.user.sub, 'UPDATE', 'HomeBlockItem', item.id, input);
    return item;
  });
  app.get('/admin/genres', { preHandler: requireAdmin }, async () => app.prisma.genre.findMany({ orderBy: { name: 'asc' } }));
  app.post('/admin/genres', { preHandler: requireAdmin }, async (request) => {
    const input = z.object({ slug: z.string().trim().regex(/^[a-z0-9-]+$/), name: z.string().trim().min(1).max(80), translations: z.record(z.string(), z.string()).optional() }).parse(request.body);
    const genre = await app.prisma.genre.create({ data: input });
    await audit(app, request.user.sub, 'CREATE', 'Genre', genre.id);
    return genre;
  });
  app.patch('/admin/genres/:genreId', { preHandler: requireAdmin }, async (request) => {
    const { genreId } = z.object({ genreId: z.string().min(1).max(128) }).parse(request.params);
    const input = z.object({ name: z.string().trim().min(1).max(80).optional(), translations: z.record(z.string(), z.string()).optional() }).parse(request.body);
    const genre = await app.prisma.genre.update({ where: { id: genreId }, data: input });
    await audit(app, request.user.sub, 'UPDATE', 'Genre', genre.id, input);
    return genre;
  });
  app.post('/admin/translations', { preHandler: requireAdmin }, async (request) => {
    const input = z.object({ kind: z.enum(['album', 'episode']), contentId: z.string().min(1).max(128), locale: publicLocaleSchema, title: z.string().trim().min(1).max(160), description: z.string().trim().max(20_000).optional(), coverUrl: z.string().url().nullable().optional(), subtitleRef: z.string().max(512).nullable().optional() }).parse(request.body);
    if (input.kind === 'album') {
      const translation = await app.prisma.albumTranslation.upsert({ where: { albumId_locale: { albumId: input.contentId, locale: input.locale } }, create: { albumId: input.contentId, locale: input.locale, title: input.title, description: input.description ?? '', coverUrl: input.coverUrl }, update: { title: input.title, description: input.description ?? '', coverUrl: input.coverUrl } });
      await audit(app, request.user.sub, 'UPSERT', 'AlbumTranslation', translation.id, input);
      return translation;
    }
    const translation = await app.prisma.episodeTranslation.upsert({ where: { episodeId_locale: { episodeId: input.contentId, locale: input.locale } }, create: { episodeId: input.contentId, locale: input.locale, title: input.title, description: input.description, coverUrl: input.coverUrl, subtitleRef: input.subtitleRef }, update: { title: input.title, description: input.description, coverUrl: input.coverUrl, subtitleRef: input.subtitleRef } });
    await audit(app, request.user.sub, 'UPSERT', 'EpisodeTranslation', translation.id, input);
    return translation;
  });
  app.get('/admin/analytics/revenue', { preHandler: requireAdmin }, async () => app.prisma.adRevenue.findMany({ orderBy: { reportDate: 'desc' }, take: 100 }));
  app.post('/admin/analytics/revenue/import', { preHandler: requireAdmin }, async (request) => {
    const input = z.object({
      source: z.string().trim().min(1).max(64),
      rows: z.array(z.object({
        reportDate: z.string().datetime(),
        adType: z.enum(['REWARDED', 'INTERSTITIAL']),
        placementId: z.string().trim().min(1).max(128),
        albumId: z.string().min(1).max(128).nullable().optional(),
        episodeId: z.string().min(1).max(128).nullable().optional(),
        reportKey: z.string().trim().min(1).max(256),
        impressions: z.number().int().nonnegative().default(0),
        completedViews: z.number().int().nonnegative().default(0),
        revenueMicros: z.string().regex(/^\d+$/).default('0'),
        currency: z.string().trim().length(3).default('USD')
      })).min(1).max(10_000)
    }).parse(request.body);
    let imported = 0;
    for (const row of input.rows) {
      await app.prisma.adRevenue.upsert({
        where: { reportKey: row.reportKey },
        create: { ...row, source: input.source, reportDate: new Date(row.reportDate), revenueMicros: BigInt(row.revenueMicros) },
        update: { ...row, source: input.source, reportDate: new Date(row.reportDate), revenueMicros: BigInt(row.revenueMicros) }
      });
      imported += 1;
    }
    await audit(app, request.user.sub, 'IMPORT', 'AdRevenue', undefined, { source: input.source, rows: imported });
    return { imported };
  });
  app.get('/admin/analytics/overview', { preHandler: requireAdmin }, async () => {
    const [albums, episodes, users, likes, favorites, shares, searches, unlocks] = await Promise.all([
      app.prisma.album.count({ where: { status: 'ONLINE' } }),
      app.prisma.episode.count({ where: { status: 'ONLINE', album: { status: 'ONLINE' } } }),
      app.prisma.user.count(),
      app.prisma.albumLike.count(),
      app.prisma.albumFavorite.count(),
      app.prisma.shareEvent.count(),
      app.prisma.searchEvent.count(),
      app.prisma.episodeUnlock.count()
    ]);
    return { albums, episodes, users, likes, favorites, shares, searches, rewardedUnlocks: unlocks };
  });
  app.get('/admin/analytics/audience', { preHandler: requireAdmin }, async (request) => {
    const range = resolveAnalyticsRange(analyticsQuery.parse(request.query));
    const where = { gte: range.start, lt: range.end };
    const [activeRows, newUsers, watchSessions, completedEpisodes, favorites, shares, searches, dailyNewRows, dailyActiveRows, dauRows, wauRows, mauRows] = await Promise.all([
      app.prisma.appSession.findMany({ where: { startedAt: where }, distinct: ['userId'], select: { userId: true } }),
      app.prisma.user.count({ where: { createdAt: where } }),
      app.prisma.playbackSession.count({ where: { startedAt: where } }),
      app.prisma.episodeCompletionEvent.count({ where: { completedAt: where } }),
      app.prisma.albumFavorite.count({ where: { createdAt: where } }),
      app.prisma.shareEvent.count({ where: { createdAt: where } }),
      app.prisma.searchEvent.count({ where: { createdAt: where } }),
      app.prisma.$queryRaw<Array<{ date: string; count: number }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM "User"
        WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
        GROUP BY 1
        ORDER BY 1
      `),
      app.prisma.$queryRaw<Array<{ date: string; count: number }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', "startedAt" AT TIME ZONE ${range.timezone}), 'YYYY-MM-DD') AS date,
               COUNT(DISTINCT "userId")::int AS count
        FROM "AppSession"
        WHERE "startedAt" >= ${range.start} AND "startedAt" < ${range.end}
        GROUP BY 1
        ORDER BY 1
      `),
      app.prisma.appSession.findMany({ where: { startedAt: { gte: zonedMidnight(range.to, range.timezone), lt: range.end } }, distinct: ['userId'], select: { userId: true } }),
      app.prisma.appSession.findMany({ where: { startedAt: { gte: zonedMidnight(addDateKeyDays(range.to, -6), range.timezone), lt: range.end } }, distinct: ['userId'], select: { userId: true } }),
      app.prisma.appSession.findMany({ where: { startedAt: { gte: zonedMidnight(addDateKeyDays(range.to, -29), range.timezone), lt: range.end } }, distinct: ['userId'], select: { userId: true } })
    ]);
    return {
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      periodDays: range.periodDays,
      activeUsers: activeRows.length,
      dau: dauRows.length,
      wau: wauRows.length,
      mau: mauRows.length,
      newUsers,
      watchSessions,
      completedEpisodes,
      favorites,
      shares,
      searches,
      dailyNewUsers: completeDailySeries(range.from, range.periodDays, dailyNewRows),
      dailyActiveUsers: completeDailySeries(range.from, range.periodDays, dailyActiveRows)
    };
  });
  app.get('/admin/analytics/playback-quality', { preHandler: requireAdmin }, async (request) => {
    const range = resolveAnalyticsRange(analyticsQuery.parse(request.query));
    const createdAt = { gte: range.start, lt: range.end };
    const [totals, errorCount, eventTypes, definitions, networks, recentErrors] = await Promise.all([
      app.prisma.playbackQualityEvent.aggregate({ where: { createdAt }, _count: true, _avg: { startupMs: true }, _sum: { bufferMs: true } }),
      app.prisma.playbackQualityEvent.count({ where: { createdAt, eventType: 'ERROR' } }),
      app.prisma.playbackQualityEvent.groupBy({ by: ['eventType'], where: { createdAt }, _count: { _all: true } }),
      app.prisma.playbackQualityEvent.groupBy({ by: ['definition'], where: { createdAt, definition: { not: null } }, _count: { _all: true } }),
      app.prisma.playbackQualityEvent.groupBy({ by: ['networkType'], where: { createdAt, networkType: { not: null } }, _count: { _all: true } }),
      app.prisma.playbackQualityEvent.findMany({
        where: { createdAt, eventType: 'ERROR' },
        select: { errorCode: true, createdAt: true, episode: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);
    const totalEvents = totals._count;
    return {
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      periodDays: range.periodDays,
      totalEvents,
      firstFrames: eventTypes.find((item) => item.eventType === 'FIRST_FRAME')?._count._all ?? 0,
      errorCount,
      errorRate: totalEvents ? Number((errorCount / totalEvents * 100).toFixed(2)) : 0,
      averageStartupMs: totals._avg.startupMs === null ? null : Math.round(totals._avg.startupMs),
      totalBufferMs: totals._sum.bufferMs ?? 0,
      eventTypes: eventTypes.map((item) => ({ eventType: item.eventType, count: item._count._all })),
      definitions: definitions.map((item) => ({ definition: item.definition, count: item._count._all })),
      networks: networks.map((item) => ({ networkType: item.networkType, count: item._count._all })),
      recentErrors: recentErrors.map((event) => ({ episodeTitle: event.episode.title, errorCode: event.errorCode, createdAt: event.createdAt }))
    };
  });
}
