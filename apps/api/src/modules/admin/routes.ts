import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '../../plugins/auth';
import { verifyPassword } from '../../services/password';
import { accessConfigSchema } from '../../lib/content-access';
import { publicLocaleSchema } from '../../lib/locales';

const albumParams = z.object({ albumId: z.string().min(1).max(128) });
const episodeParams = z.object({ episodeId: z.string().min(1).max(128) });
const albumInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).default(''),
  coverUrl: z.string().url(),
  language: z.string().min(2).max(10).default('en'),
  regions: z.array(z.string().min(2).max(32)).optional(),
  accessConfig: accessConfigSchema.optional()
});
const episodeInput = z.object({
  albumId: z.string().min(1).max(128),
  episodeNo: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(20_000).optional(),
  coverUrl: z.string().url().optional(),
  durationMs: z.number().int().positive().optional(),
  isFree: z.boolean().default(false),
  sortOrder: z.number().int().positive().optional()
});
const episodePatch = episodeInput.omit({ albumId: true, episodeNo: true }).partial();
const uploadInput = z.object({
  episodeId: z.string().min(1).max(128),
  sourceUrl: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Only HTTP(S) source URLs are supported.'),
  sourceExpiresAt: z.string().datetime().optional()
});
const jobParams = z.object({ jobId: z.string().min(1).max(128) });
const blockParams = z.object({ blockId: z.string().min(1).max(128) });
const blockItemParams = z.object({ blockId: z.string().min(1).max(128), itemId: z.string().min(1).max(128) });
const componentParams = z.object({ key: z.enum(['APP_TOPBAR', 'APP_BOTTOM_NAV', 'HOME_INTRO', 'HOME_FEED', 'ALBUM_DESCRIPTION', 'PROFILE_HISTORY', 'PROFILE_FAVORITES']) });

async function audit(app: FastifyInstance, adminUserId: string, action: string, resource: string, resourceId?: string, metadata?: unknown) {
  await app.prisma.auditLog.create({ data: { adminUserId, action, resource, resourceId, metadata: metadata as never } });
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post('/admin/auth/login', async (request, reply) => {
    const input = z.object({
      email: z.string().trim().email().max(320),
      password: z.string().min(1).max(256)
    }).parse(request.body);
    const admin = await app.prisma.adminUser.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid administrator credentials.', requestId: request.id }
      });
    }
    const accessToken = await app.jwt.sign(
      { sub: admin.id, kind: 'admin', role: admin.role },
      { expiresIn: app.config.ADMIN_JWT_EXPIRES_IN }
    );
    return { accessToken, expiresIn: app.config.ADMIN_JWT_EXPIRES_IN, admin: { id: admin.id, email: admin.email, role: admin.role } };
  });

  app.get('/admin/albums', { preHandler: requireAdmin }, async () => {
    const albums = await app.prisma.album.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { episodes: true } } }
    });
    return { items: albums.map((album) => ({ ...album, episodeCount: album._count.episodes, _count: undefined })) };
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

  app.post('/admin/albums', { preHandler: requireAdmin }, async (request) => {
    const input = albumInput.parse(request.body);
    const album = await app.prisma.album.create({ data: { ...input, regions: input.regions, accessConfig: input.accessConfig as Prisma.InputJsonValue | undefined } });
    await audit(app, request.user.sub, 'CREATE', 'Album', album.id);
    return album;
  });

  app.patch('/admin/albums/:albumId', { preHandler: requireAdmin }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const input = albumInput.partial().parse(request.body);
    const album = await app.prisma.album.update({ where: { id: albumId }, data: { ...input, accessConfig: input.accessConfig as Prisma.InputJsonValue | undefined } });
    await audit(app, request.user.sub, 'UPDATE', 'Album', album.id, input);
    return album;
  });

  app.post('/admin/episodes', { preHandler: requireAdmin }, async (request) => {
    const input = episodeInput.parse(request.body);
    const episode = await app.prisma.episode.create({ data: { ...input, sortOrder: input.sortOrder ?? input.episodeNo } });
    await audit(app, request.user.sub, 'CREATE', 'Episode', episode.id);
    return episode;
  });

  app.patch('/admin/episodes/:episodeId', { preHandler: requireAdmin }, async (request) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = episodePatch.parse(request.body);
    const episode = await app.prisma.episode.update({ where: { id: episodeId }, data: input });
    await audit(app, request.user.sub, 'UPDATE', 'Episode', episode.id, input);
    return episode;
  });

  app.patch('/admin/episodes/:episodeId/access', { preHandler: requireAdmin }, async (request) => {
    const { episodeId } = episodeParams.parse(request.params);
    const input = z.object({ isFree: z.boolean() }).parse(request.body);
    const episode = await app.prisma.episode.update({ where: { id: episodeId }, data: { isFree: input.isFree } });
    await audit(app, request.user.sub, 'UPDATE_ACCESS', 'Episode', episode.id, input);
    return { id: episode.id, isFree: episode.isFree };
  });

  app.get('/admin/ui-components', { preHandler: requireAdmin }, async () => app.prisma.uiComponent.findMany({ orderBy: [{ page: 'asc' }, { key: 'asc' }] }));
  app.patch('/admin/ui-components/:key', { preHandler: requireAdmin }, async (request) => {
    const { key } = componentParams.parse(request.params);
    const input = z.object({ page: z.enum(['APP', 'HOME', 'ALBUM', 'PROFILE']).optional(), enabled: z.boolean().optional(), config: z.record(z.string(), z.unknown()).nullable().optional() }).parse(request.body);
    const component = await app.prisma.uiComponent.upsert({
      where: { key },
      create: { key, page: input.page ?? (key.startsWith('APP_') ? 'APP' : key.startsWith('HOME_') ? 'HOME' : key.startsWith('ALBUM_') ? 'ALBUM' : 'PROFILE'), enabled: input.enabled ?? true, config: input.config === null ? Prisma.JsonNull : input.config as Prisma.InputJsonValue | undefined },
      update: { ...input, config: input.config === undefined ? undefined : input.config === null ? Prisma.JsonNull : input.config as Prisma.InputJsonValue }
    });
    await audit(app, request.user.sub, 'UPDATE', 'UiComponent', component.key, input);
    return component;
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

  app.get('/admin/upload-jobs/:jobId', { preHandler: requireAdmin }, async (request, reply) => {
    const { jobId } = jobParams.parse(request.params);
    const job = await app.prisma.uploadJob.findUnique({ where: { id: jobId }, include: { episode: true } });
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Upload job not found.', requestId: request.id } });
    return job;
  });

  app.post('/admin/albums/:albumId/review-submit', { preHandler: requireAdmin }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.update({ where: { id: albumId }, data: { status: 'REVIEWING', reviewStatus: 'SUBMITTED' } });
    await audit(app, request.user.sub, 'SUBMIT_REVIEW', 'Album', album.id);
    return album;
  });

  app.post('/admin/albums/:albumId/online', { preHandler: requireAdmin }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.findUnique({ where: { id: albumId }, include: { episodes: { select: { status: true, tiktokEpisodeId: true, byteplusVid: true } } } });
    if (!album) throw Object.assign(new Error('Album not found.'), { statusCode: 404 });
    if (!album.tiktokAlbumId || album.episodes.some((episode) => episode.status !== 'ONLINE' || !episode.tiktokEpisodeId || !episode.byteplusVid)) {
      throw Object.assign(new Error('All published episodes require platform ids and ONLINE status.'), { statusCode: 409 });
    }
    const online = await app.prisma.album.update({ where: { id: albumId }, data: { status: 'ONLINE', publishStatus: 'LISTED' } });
    await audit(app, request.user.sub, 'PUBLISH', 'Album', online.id);
    return online;
  });

  app.post('/admin/albums/:albumId/offline', { preHandler: requireAdmin }, async (request) => {
    const { albumId } = albumParams.parse(request.params);
    const album = await app.prisma.album.update({ where: { id: albumId }, data: { status: 'OFFLINE', publishStatus: 'OFFLINE' } });
    await audit(app, request.user.sub, 'UNPUBLISH', 'Album', album.id);
    return album;
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
  app.get('/admin/analytics/playback-quality', { preHandler: requireAdmin }, async () => {
    const groups = await app.prisma.playbackQualityEvent.groupBy({ by: ['eventType'], _count: { _all: true }, orderBy: { eventType: 'asc' } });
    return { items: groups.map((group) => ({ eventType: group.eventType, count: group._count._all })) };
  });
}
