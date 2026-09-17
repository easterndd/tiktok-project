import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../plugins/auth';
import { hashPassword, verifyPassword } from '../../services/password';
import { accessConfigSchema } from '../../lib/content-access';
import { publicLocaleSchema } from '../../lib/locales';
import { BytePlusVodService } from '../../services/byteplus-vod.service';
import { LocalObjectStorageService } from '../../services/object-storage.service';
import { defaultUiComponents } from '../ui/routes';
import { readAppEntryAdPolicy } from '../app-entry-ads/routes';

const albumParams = z.object({ albumId: z.string().min(1).max(128) });
const episodeParams = z.object({ episodeId: z.string().min(1).max(128) });
const albumInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).default(''),
  coverUrl: z.string().url().optional(),
  coverAssetId: z.string().min(1).max(128).optional().nullable(),
  language: z.string().min(2).max(10).default('en'),
  regions: z.array(z.string().min(2).max(32)).optional(),
  accessConfig: accessConfigSchema.optional()
});
const albumPatch = albumInput.partial().extend({
  tiktokAlbumId: z.string().trim().min(1).max(256).optional().nullable(),
  status: z.enum(['DRAFT', 'REVIEWING', 'ONLINE', 'OFFLINE', 'REJECTED']).optional(),
  publishStatus: z.string().trim().max(64).optional().nullable()
});
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
  durationMs: z.number().int().positive().optional().nullable(),
  tiktokEpisodeId: z.string().trim().min(1).max(256).optional().nullable(),
  status: z.enum(['DRAFT', 'READY', 'REVIEWING', 'ONLINE', 'OFFLINE', 'ERROR']).optional()
});
const uploadInput = z.object({
  episodeId: z.string().min(1).max(128),
  sourceUrl: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Only HTTP(S) source URLs are supported.'),
  sourceExpiresAt: z.string().datetime().optional()
});
const dramaInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).default(''),
  coverAssetId: z.string().min(1).max(128),
  language: z.string().min(2).max(10).default('en'),
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
const jobParams = z.object({ jobId: z.string().min(1).max(128) });
const blockParams = z.object({ blockId: z.string().min(1).max(128) });
const blockItemParams = z.object({ blockId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) });
const componentParams = z.object({ key: z.enum(['APP_TOPBAR', 'APP_BOTTOM_NAV', 'HOME_INTRO', 'HOME_FEED', 'ALBUM_DESCRIPTION', 'PROFILE_HISTORY', 'PROFILE_FAVORITES']) });
const uiComponentSnapshotInput = z.array(z.object({
  key: componentParams.shape.key,
  page: z.enum(['APP', 'HOME', 'ALBUM', 'PROFILE']),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).nullable().optional()
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
}).refine((value) => Boolean(value.from) === Boolean(value.to), { message: 'from and to must be provided together.' });
const appEntryAdPolicyInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(['INTERSTITIAL', 'REWARDED_GATED']),
  placementId: z.string().trim().min(1).max(128),
  requiredCount: z.number().int().min(1).max(3),
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
    throw Object.assign(new Error('Invalid analytics timezone.'), { statusCode: 400 });
  }
  const to = input.to ?? dateKey(new Date(), input.timezone);
  const from = input.from ?? addDateKeyDays(to, -(input.days ?? 30) + 1);
  if (from > to) throw Object.assign(new Error('Analytics from date must not be after to date.'), { statusCode: 400 });
  const periodDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (periodDays > 366) throw Object.assign(new Error('Analytics date range cannot exceed 366 days.'), { statusCode: 400 });
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
  if (!asset || asset.status !== 'READY') throw Object.assign(new Error('Cover asset is not ready.'), { statusCode: 400 });
  return asset;
}

function albumDataWithAccess<T extends { accessConfig?: unknown }>(input: T) {
  return { ...input, accessConfig: input.accessConfig as Prisma.InputJsonValue | undefined };
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

async function uiSnapshotFromRows(app: FastifyInstance): Promise<UiComponentSnapshot> {
  const stored = await app.prisma.uiComponent.findMany({ orderBy: [{ page: 'asc' }, { key: 'asc' }] });
  return mergeUiComponents(stored.map((component) => ({
    key: component.key as UiComponentSnapshot[number]['key'],
    page: component.page as UiComponentSnapshot[number]['page'],
    enabled: component.enabled,
    config: component.config as Record<string, unknown> | null
  })));
}

async function currentUiDraft(app: FastifyInstance) {
  const draft = await app.prisma.uiConfigVersion.findFirst({ where: { status: 'DRAFT' }, orderBy: { version: 'desc' } });
  if (draft) return { version: draft.version, items: mergeUiComponents(uiComponentSnapshotInput.parse(draft.content)) };
  return { version: null, items: await uiSnapshotFromRows(app) };
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
      { sub: admin.id, kind: 'admin', role: admin.role, tokenVersion: admin.tokenVersion },
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
      throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 400 });
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
      throw Object.assign(new Error('You cannot disable your own administrator account.'), { statusCode: 400 });
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
      select: { id: true, albumId: true, episodeNo: true, title: true, status: true, byteplusVid: true, byteplusCoverUrl: true, coverUrl: true, durationMs: true, tiktokEpisodeId: true, album: { select: { title: true, status: true, tiktokAlbumId: true } } }
    });
    return { items: episodes };
  });

  app.get('/admin/albums/:albumId', { preHandler: requireAdmin }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.findUnique({
      where: { id: albumId },
      include: { episodes: { orderBy: { sortOrder: 'asc' }, include: { translations: true } }, translations: true, genres: { include: { genre: true } } }
    });
    if (!album) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Album not found.', requestId: request.id } });
    return album;
  });

  app.post('/admin/cover-assets', { preHandler: requireAdmin }, async (request, reply) => {
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Select one cover image to upload.', requestId: request.id } });
    const fileName = upload.filename.trim();
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    const expectedMime = extensionMime(extension);
    if (!expectedMime) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Supported cover formats are JPEG, PNG, and WebP.', requestId: request.id } });

    const tempDirectory = join(tmpdir(), 'quickreels-covers');
    const tempPath = join(tempDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    await mkdir(tempDirectory, { recursive: true });
    try {
      await pipeline(upload.file, createWriteStream(tempPath));
      if (upload.file.truncated) throw Object.assign(new Error('The selected image exceeds the 10 MB upload limit.'), { statusCode: 413 });
      const buffer = await readFile(tempPath);
      if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cover image must be between 1 byte and 10 MB.', requestId: request.id } });
      }
      const image = detectImage(buffer);
      if (!image || image.mimeType !== expectedMime || (upload.mimetype && upload.mimetype !== expectedMime)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cover file extension and image type do not match.', requestId: request.id } });
      }
      if (image.width && image.height) {
        const pixels = image.width * image.height;
        const ratio = image.width / image.height;
        if (pixels > 24_000_000 || ratio < 0.4 || ratio > 2.5) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cover dimensions are outside the allowed range.', requestId: request.id } });
        }
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const existing = await app.prisma.coverAsset.findUnique({ where: { sha256 } });
      if (existing?.status === 'READY') return existing;

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
      return asset;
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  });

  app.post('/admin/dramas', { preHandler: requireAdmin }, async (request) => {
    const input = dramaInput.parse(request.body);
    const albumCover = await validateReadyCover(app, input.coverAssetId);
    const episodeCoverIds = Array.from(new Set(input.episodes.flatMap((episode) => episode.coverAssetId ? [episode.coverAssetId] : [])));
    const episodeCovers = episodeCoverIds.length ? await app.prisma.coverAsset.findMany({ where: { id: { in: episodeCoverIds }, status: 'READY' } }) : [];
    if (episodeCovers.length !== episodeCoverIds.length) throw Object.assign(new Error('One or more episode cover assets are not ready.'), { statusCode: 400 });
    const coverById = new Map(episodeCovers.map((cover) => [cover.id, cover]));

    const result = await app.prisma.$transaction(async (tx) => {
      const album = await tx.album.create({
        data: {
          title: input.title,
          description: input.description,
          coverAssetId: albumCover!.id,
          coverUrl: albumCover!.publicUrl,
          language: input.language,
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

  app.post('/admin/albums', { preHandler: requireAdmin }, async (request) => {
    const input = albumInput.parse(request.body);
    const cover = await validateReadyCover(app, input.coverAssetId);
    if (!cover && !input.coverUrl) throw Object.assign(new Error('coverUrl or coverAssetId is required.'), { statusCode: 400 });
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
    if (input.status === 'ONLINE' && !input.tiktokEpisodeId) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'An ONLINE episode requires a TikTok Episode ID.', requestId: request.id } });
    }
    const mediaService = new BytePlusVodService(app.config);
    const [media] = await mediaService.getMediaInfos({ vids: [input.byteplusVid] });
    if (!media) {
      return reply.code(404).send({ error: { code: 'BYTEPLUS_MEDIA_NOT_FOUND', message: 'BytePlus Vid not found in the configured space.', requestId: request.id } });
    }
    const currentEpisode = await app.prisma.episode.findUnique({ where: { id: episodeId }, select: { coverAsset: { select: { publicUrl: true, status: true } } } });
    const providerCoverUrl = input.byteplusCoverUrl ?? media.coverUrl;
    const episode = await app.prisma.episode.update({
      where: { id: episodeId },
      data: {
        byteplusVid: media.vid,
        byteplusCoverUrl: providerCoverUrl,
        coverUrl: currentEpisode?.coverAsset?.status === 'READY' ? currentEpisode.coverAsset.publicUrl : providerCoverUrl,
        durationMs: input.durationMs ?? media.durationMs,
        tiktokEpisodeId: input.tiktokEpisodeId,
        status: input.status ?? 'READY'
      }
    });
    await audit(app, request.user.sub, 'BIND_BYTEPLUS_MEDIA', 'Episode', episode.id, {
      byteplusVid: media.vid,
      tiktokEpisodeId: input.tiktokEpisodeId
    });
    return episode;
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
    const input = z.object({ page: z.enum(['APP', 'HOME', 'ALBUM', 'PROFILE']).optional(), enabled: z.boolean().optional(), config: z.record(z.string(), z.unknown()).nullable().optional() }).parse(request.body);
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
    if (!draft) throw Object.assign(new Error('No UI component draft is available to publish.'), { statusCode: 409 });
    const items = mergeUiComponents(uiComponentSnapshotInput.parse(draft.content));
    const published = await app.prisma.$transaction(async (tx) => {
      await tx.uiConfigVersion.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      const result = await tx.uiConfigVersion.update({
        where: { version: draft.version },
        data: { status: 'PUBLISHED', content: items as unknown as Prisma.InputJsonValue, publishedById: request.user.sub, publishedAt: new Date() }
      });
      await syncUiComponentRows(tx, items);
      return result;
    });
    await audit(app, request.user.sub, 'PUBLISH', 'UiConfigVersion', String(published.version), { componentCount: items.length });
    return { items, version: published.version, publishedAt: published.publishedAt };
  });

  app.post('/admin/ui-components/rollback', { preHandler: requireAdmin }, async (request) => {
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body);
    const target = await app.prisma.uiConfigVersion.findUnique({ where: { version } });
    if (!target) throw Object.assign(new Error('UI configuration version not found.'), { statusCode: 404 });
    const items = mergeUiComponents(uiComponentSnapshotInput.parse(target.content));
    const restored = await app.prisma.$transaction(async (tx) => {
      await tx.uiConfigVersion.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      const result = await tx.uiConfigVersion.create({
        data: { status: 'PUBLISHED', content: items as unknown as Prisma.InputJsonValue, createdById: request.user.sub, publishedById: request.user.sub, publishedAt: new Date() }
      });
      await syncUiComponentRows(tx, items);
      return result;
    });
    await audit(app, request.user.sub, 'ROLLBACK', 'UiConfigVersion', String(restored.version), { sourceVersion: version });
    return { items, version: restored.version, publishedAt: restored.publishedAt };
  });

  app.get('/admin/upload-jobs', { preHandler: requireAdmin }, async () => {
    const jobs = await app.prisma.uploadJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { episode: true } });
    return { items: jobs };
  });

  app.post('/admin/upload-jobs', { preHandler: requireAdmin }, async (request) => {
    const input = uploadInput.parse(request.body);
    const episode = await app.prisma.episode.findFirst({ where: { id: input.episodeId }, select: { id: true, album: { select: { status: true } } } });
    if (!episode) throw Object.assign(new Error('Episode not found.'), { statusCode: 404 });
    if (episode.album.status === 'OFFLINE') throw Object.assign(new Error('Cannot upload an offline album episode.'), { statusCode: 409 });
    if (input.sourceExpiresAt && new Date(input.sourceExpiresAt) <= new Date()) {
      throw Object.assign(new Error('sourceExpiresAt must be in the future.'), { statusCode: 400 });
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
    if (!upload) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Select a video file to upload.', requestId: request.id } });
    const episodeField = upload.fields.episodeId;
    const episodeId = episodeField && !Array.isArray(episodeField) && 'value' in episodeField && typeof episodeField.value === 'string' ? episodeField.value.trim() : '';
    if (!episodeId) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'episodeId is required.', requestId: request.id } });
    const fileName = upload.filename.trim();
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    if (!['.mp4', '.mov', '.m4v', '.webm'].includes(extension)) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Supported video formats are MP4, MOV, M4V, and WebM.', requestId: request.id } });
    }
    const episode = await app.prisma.episode.findUnique({ where: { id: episodeId }, select: { id: true, title: true, coverAsset: { select: { publicUrl: true, status: true } }, album: { select: { status: true } } } });
    if (!episode) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } });
    if (episode.album.status === 'OFFLINE') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Cannot upload an offline album episode.', requestId: request.id } });

    const tempDirectory = join(tmpdir(), 'quickreels-vod');
    const tempPath = join(tempDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    await mkdir(tempDirectory, { recursive: true });
    try {
      await pipeline(upload.file, (await import('node:fs')).createWriteStream(tempPath));
      if (upload.file.truncated) throw Object.assign(new Error('The selected file exceeds the 2 GB upload limit.'), { statusCode: 413 });
      const service = new BytePlusVodService(app.config);
      const result = await service.uploadLocalVideo({
        filePath: tempPath,
        fileName,
        spaceName: app.config.BYTEPLUS_SPACE_NAME,
        byteplusAccountId: app.config.BYTEPLUS_ACCOUNT_ID
      });
      const [job] = await app.prisma.$transaction([
        app.prisma.uploadJob.create({ data: { episodeId, sourceUrl: `local://${fileName}`, sourceType: 'FILE', sourceName: fileName, status: 'SUCCEEDED', startedAt: new Date(), completedAt: new Date() } }),
        app.prisma.episode.update({ where: { id: episodeId }, data: { status: 'READY', byteplusVid: result.byteplusVid, byteplusCoverUrl: result.coverUrl, coverUrl: episode.coverAsset?.status === 'READY' ? episode.coverAsset.publicUrl : result.coverUrl, durationMs: result.durationMs } })
      ]);
      await audit(app, request.user.sub, 'UPLOAD_LOCAL', 'UploadJob', job.id, { episodeId, fileName, byteplusVid: result.byteplusVid });
      return { job, episode: { id: episodeId, status: 'READY', byteplusVid: result.byteplusVid, durationMs: result.durationMs } };
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
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Local uploads must be retried by selecting the video file again.', requestId: request.id } });
    }
    if (job.status !== 'FAILED') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Only failed upload jobs can be retried.', requestId: request.id } });
    }
    if (job.sourceExpiresAt && job.sourceExpiresAt <= new Date()) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'The upload source URL has expired and cannot be retried.', requestId: request.id } });
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

  app.post('/admin/albums/:albumId/review-submit', { preHandler: requireAdmin }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    return reply.code(501).send({ error: { code: 'PLATFORM_INTEGRATION_UNAVAILABLE', message: `TikTok Short Drama review submission is not configured for album ${albumId}.`, requestId: request.id } });
  });

  app.post('/admin/albums/:albumId/online', { preHandler: requireAdmin }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    return reply.code(501).send({ error: { code: 'PLATFORM_INTEGRATION_UNAVAILABLE', message: `TikTok Short Drama listing is not configured for album ${albumId}.`, requestId: request.id } });
  });

  app.post('/admin/albums/:albumId/offline', { preHandler: requireAdmin }, async (request, reply) => {
    const { albumId } = albumParams.parse(request.params);
    return reply.code(501).send({ error: { code: 'PLATFORM_INTEGRATION_UNAVAILABLE', message: `TikTok Short Drama unlisting is not configured for album ${albumId}.`, requestId: request.id } });
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
    const input = z.object({ albumId: z.string().min(1).max(128).optional(), targetEpisodeId: z.string().min(1).max(128).optional(), imageUrl: z.string().url().optional(), linkPath: z.string().regex(/^\/(album|watch)\//).optional(), sortOrder: z.number().int().nonnegative(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const item = await app.prisma.homeBlockItem.create({ data: { ...input, blockId, startsAt: input.startsAt ? new Date(input.startsAt) : undefined, endsAt: input.endsAt ? new Date(input.endsAt) : undefined } });
    await audit(app, request.user.sub, 'CREATE', 'HomeBlockItem', item.id, { blockId });
    return item;
  });
  app.patch('/admin/home-blocks/:blockId/items/:itemId', { preHandler: requireAdmin }, async (request) => {
    const { blockId, itemId } = blockItemParams.parse(request.params);
    const input = z.object({ imageUrl: z.string().url().nullable().optional(), linkPath: z.string().regex(/^\/(album|watch)\//).nullable().optional(), sortOrder: z.number().int().nonnegative().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const result = await app.prisma.homeBlockItem.updateMany({ where: { id: itemId, blockId }, data: { ...input, startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null } });
    if (!result.count) throw Object.assign(new Error('Home block item not found.'), { statusCode: 404 });
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
