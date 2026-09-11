import type { AlbumDetail, AlbumSummary, CursorPage, EpisodeSummary } from '@breezereels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { isEpisodeFree } from '../../lib/content-access';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';

const params = z.object({ albumId: z.string().min(1).max(128) });
const localeQuery = z.object({ locale: publicLocaleSchema.default(defaultLocale) });

function toSummary(album: { id: string; title: string; description: string; coverUrl: string; language?: string; updatedAt: Date; _count: { episodes: number }; translations?: { locale: string; title: string; description: string; coverUrl: string | null }[]; genres?: { genre: { slug: string } }[] }, locale = 'en'): AlbumSummary {
  const translated = album.translations?.find((item) => item.locale === locale);
  return {
    id: album.id,
    title: translated?.title ?? album.title,
    description: translated?.description ?? album.description,
    coverUrl: translated?.coverUrl ?? album.coverUrl,
    episodeCount: album._count.episodes,
    updatedAt: album.updatedAt.toISOString(),
    language: album.language,
    genres: album.genres?.map(({ genre }) => genre.slug),
    status: 'ONLINE'
  };
}

export async function registerAlbumRoutes(app: FastifyInstance) {
  app.get('/albums', async (request): Promise<CursorPage<AlbumSummary>> => {
    const { locale } = localeQuery.parse(request.query);
    const albums = await app.prisma.album.findMany({
      where: { status: 'ONLINE' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        _count: { select: { episodes: { where: { status: 'ONLINE' } } } },
        translations: true,
        genres: { include: { genre: { select: { slug: true } } } }
      }
    });
    return { items: albums.map((album) => toSummary(album, locale)), nextCursor: null };
  });

  app.get('/albums/:albumId', async (request, reply): Promise<AlbumDetail> => {
    const { albumId } = params.parse(request.params);
    const { locale } = localeQuery.parse(request.query);
    const user = await optionalUser(request);
    const album = await app.prisma.album.findFirst({
      where: { id: albumId, status: 'ONLINE' },
      include: {
        _count: { select: { episodes: { where: { status: 'ONLINE' } } } },
        likes: user ? { where: { userId: user.sub }, select: { id: true } } : undefined,
        favorites: user ? { where: { userId: user.sub }, select: { id: true } } : undefined,
        translations: true,
        genres: { include: { genre: { select: { slug: true } } } }
      }
    });
    if (!album) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Album not found.', requestId: request.id } }) as never;
    const regions = Array.isArray(album.regions) ? album.regions.filter((value: unknown): value is string => typeof value === 'string') : null;
    return {
      ...toSummary(album, locale),
      language: album.language,
      regions,
      likeCount: await app.prisma.albumLike.count({ where: { albumId } }),
      favoriteCount: await app.prisma.albumFavorite.count({ where: { albumId } }),
      shareCount: await app.prisma.shareEvent.count({ where: { albumId } }),
      userState: { liked: Boolean(album.likes?.length), favorited: Boolean(album.favorites?.length) }
    };
  });

  app.get('/albums/:albumId/episodes', async (request, reply): Promise<{ items: EpisodeSummary[] }> => {
    const { albumId } = params.parse(request.params);
    const { locale } = localeQuery.parse(request.query);
    const user = await optionalUser(request);
    const exists = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Album not found.', requestId: request.id } }) as never;
    const album = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' }, select: { accessConfig: true } });
    const episodes = await app.prisma.episode.findMany({
      where: { albumId, status: 'ONLINE' },
      orderBy: { sortOrder: 'asc' },
      include: {
        unlocks: user ? { where: { userId: user.sub }, select: { id: true } } : undefined,
        translations: true
      }
    });
    return {
        items: episodes.map((episode: { id: string; episodeNo: number; title: string; durationMs: number | null; isFree: boolean; unlocks?: { id: string }[]; translations?: { locale: string; title: string }[] }) => ({
        id: episode.id,
        episodeNo: episode.episodeNo,
        title: episode.translations?.find((translation) => translation.locale === locale)?.title ?? episode.title,
        durationMs: episode.durationMs,
        isFree: isEpisodeFree(episode, album?.accessConfig),
        access: isEpisodeFree(episode, album?.accessConfig) || Boolean(episode.unlocks?.length) ? 'PLAYABLE' : 'REWARDED_AD_REQUIRED'
      }))
    };
  });
}
