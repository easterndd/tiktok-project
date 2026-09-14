import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

const localeQuery = z.object({ locale: publicLocaleSchema.default(defaultLocale) });
const translated = <T extends { locale: string }>(items: T[] | undefined, locale: string) => items?.find((item) => item.locale === locale);

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireUser }, async (request) => {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
    const preference = await app.prisma.userPreference.findUnique({ where: { userId: user.id } });
    return { id: user.id, displayName: `Drama fan ${user.id.slice(-4)}`, avatarUrl: null, locale: preference?.locale ?? defaultLocale, createdAt: user.createdAt.toISOString() };
  });
  app.get('/me/preferences', { preHandler: requireUser }, async (request) => app.prisma.userPreference.upsert({ where: { userId: request.user.sub }, create: { userId: request.user.sub }, update: {} }));
  app.put('/me/preferences', { preHandler: requireUser }, async (request) => {
    const body = z.object({ locale: publicLocaleSchema.optional(), autoplay: z.boolean().optional(), reducedData: z.boolean().optional() }).parse(request.body);
    return app.prisma.userPreference.upsert({ where: { userId: request.user.sub }, create: { userId: request.user.sub, ...body }, update: body });
  });
  app.get('/me/history', { preHandler: requireUser }, async (request) => {
    const { locale } = localeQuery.parse(request.query);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const records = await app.prisma.watchProgress.findMany({ where: { userId: request.user.sub, episode: { status: 'ONLINE', album: { status: 'ONLINE' } } }, orderBy: { updatedAt: 'desc' }, take: 30, include: { episode: { include: { translations: true, album: { include: { translations: true, _count: { select: { episodes: { where: { status: 'ONLINE' } } } } } } } } } });
    return { items: records.filter((record) => isAlbumVisibleInCountry(record.episode.album.regions, country)).map((record) => { const albumTranslation = translated(record.episode.album.translations, locale); const episodeTranslation = translated(record.episode.translations, locale); return { id: record.episode.album.id, title: albumTranslation?.title ?? record.episode.album.title, description: albumTranslation?.description ?? record.episode.album.description, coverUrl: albumTranslation?.coverUrl ?? record.episode.album.coverUrl, episodeCount: record.episode.album._count.episodes, updatedAt: record.episode.album.updatedAt.toISOString(), episodeId: record.episodeId, episodeNo: record.episode.episodeNo, episodeTitle: episodeTranslation?.title ?? record.episode.title, progress: record.durationMs ? Math.min(record.positionMs / record.durationMs, 1) : 0, resumePositionMs: record.positionMs, durationMs: record.durationMs, watchedAt: record.updatedAt.toISOString() }; }) };
  });
  app.get('/me/favorites', { preHandler: requireUser }, async (request) => {
    const { locale } = localeQuery.parse(request.query);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const records = await app.prisma.albumFavorite.findMany({
      where: { userId: request.user.sub, album: { status: 'ONLINE' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { album: { include: { translations: true, _count: { select: { episodes: { where: { status: 'ONLINE' } } } } } } }
    });
    return { items: records.filter(({ album }) => isAlbumVisibleInCountry(album.regions, country)).map(({ album }) => { const albumTranslation = translated(album.translations, locale); return { id: album.id, title: albumTranslation?.title ?? album.title, description: albumTranslation?.description ?? album.description, coverUrl: albumTranslation?.coverUrl ?? album.coverUrl, episodeCount: album._count.episodes, updatedAt: album.updatedAt.toISOString(), language: album.language, status: 'ONLINE' as const }; }), nextCursor: null };
  });
}
