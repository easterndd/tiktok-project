import type { AlbumSummary, SearchResponse } from '@quickreels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

const querySchema = z.object({ q: z.string().trim().max(120).default(''), locale: publicLocaleSchema.default(defaultLocale), limit: z.coerce.number().int().min(1).max(50).default(20) });
const genreParams = z.object({ slug: z.string().trim().min(1).max(80) });

function toSummary(
  album: {
    id: string;
    title: string;
    description: string;
    coverUrl: string;
    language: string;
    updatedAt: Date;
    _count: { episodes: number };
    genres?: { genre: { slug: string } }[];
    translations?: { locale: string; title: string; description: string; coverUrl: string | null }[];
  },
  locale: string = defaultLocale
): AlbumSummary {
  const translated = album.translations?.find((translation) => translation.locale === locale);
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

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get('/genres', async (request) => {
    const { locale } = querySchema.pick({ locale: true }).parse(request.query);
    const genres = await app.prisma.genre.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { albums: { where: { album: { status: 'ONLINE' } } } } } }
    });
    return {
      items: genres.map((genre) => {
        const translations = genre.translations && typeof genre.translations === 'object' && !Array.isArray(genre.translations) ? genre.translations as Record<string, unknown> : {};
        const translated = translations[locale];
        return { slug: genre.slug, name: typeof translated === 'string' ? translated : genre.name, count: genre._count.albums };
      })
    };
  });

  app.get('/genres/:slug/albums', async (request): Promise<{ items: AlbumSummary[]; nextCursor: string | null }> => {
    const { slug } = genreParams.parse(request.params);
    const { limit, locale } = querySchema.pick({ limit: true, locale: true }).parse(request.query);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const albums = await app.prisma.album.findMany({
      where: { status: 'ONLINE', genres: { some: { genre: { slug } } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { episodes: { where: { status: 'ONLINE' } } } },
        genres: { include: { genre: { select: { slug: true } } } },
        translations: true
      }
    });
    return { items: albums.filter((album) => isAlbumVisibleInCountry(album.regions, country)).map((album) => toSummary(album, locale)), nextCursor: null };
  });

  app.get('/search', async (request): Promise<SearchResponse> => {
    const { q, locale, limit } = querySchema.parse(request.query);
    const user = await optionalUser(request);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const albums = await app.prisma.album.findMany({
      where: q ? {
        status: 'ONLINE',
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { genres: { some: { genre: { slug: { contains: q, mode: 'insensitive' } } } } },
          { translations: { some: { locale, OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } } }
        ]
      } : { status: 'ONLINE' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { episodes: { where: { status: 'ONLINE' } } } },
        genres: { include: { genre: { select: { slug: true } } } },
        translations: true
      }
    });
    const items = albums.filter((album) => isAlbumVisibleInCountry(album.regions, country)).map((album) => toSummary(album, locale));
    if (q) await app.prisma.searchEvent.create({ data: { query: q, locale, resultCount: items.length, userId: user?.sub } }).catch(() => undefined);
    const fallbackAlbums = items.length ? [] : await app.prisma.album.findMany({
      where: { status: 'ONLINE' },
      orderBy: { updatedAt: 'desc' },
      take: 4,
      include: {
        _count: { select: { episodes: { where: { status: 'ONLINE' } } } },
        genres: { include: { genre: { select: { slug: true } } } },
        translations: true
      }
    });
    return { items, nextCursor: null, query: q, fallbackItems: fallbackAlbums.filter((album) => isAlbumVisibleInCountry(album.regions, country)).map((album) => toSummary(album, locale)) };
  });
}
