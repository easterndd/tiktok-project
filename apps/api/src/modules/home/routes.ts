import type { HomeResponse, Locale } from '@quickreels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';
import { defaultUiComponents } from '../ui/routes';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

const querySchema = z.object({ locale: publicLocaleSchema.default(defaultLocale) });

function translatedText(
  translations: { locale: string; title: string; description: string; coverUrl: string | null }[] | undefined,
  locale: string,
  field: 'title' | 'description' | 'coverUrl'
) {
  return translations?.find((translation) => translation.locale === locale)?.[field] ?? undefined;
}

export async function registerHomeRoutes(app: FastifyInstance) {
  app.get('/home', async (request): Promise<HomeResponse> => {
    const { locale } = querySchema.parse(request.query);
    const user = await optionalUser(request);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const components = await app.prisma.uiComponent.findMany({ orderBy: { key: 'asc' } });
    const albums = await app.prisma.album.findMany({
      where: { status: 'ONLINE' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        episodes: { where: { status: 'ONLINE' }, select: { id: true } },
        translations: true,
        genres: { include: { genre: { select: { slug: true } } } }
      }
    });
    const visibleAlbums = albums.filter((album) => isAlbumVisibleInCountry(album.regions, country));
    const summaries = visibleAlbums.map((album) => ({
      id: album.id,
      title: translatedText(album.translations, locale, 'title') ?? album.title,
      description: translatedText(album.translations, locale, 'description') ?? album.description,
      coverUrl: translatedText(album.translations, locale, 'coverUrl') ?? album.coverUrl,
      episodeCount: album.episodes.length,
      updatedAt: album.updatedAt.toISOString(),
      language: album.language,
      genres: (album.genres ?? []).map(({ genre }) => genre.slug),
      status: 'ONLINE' as const
    }));
    const genres = await app.prisma.genre.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { albums: { where: { album: { status: 'ONLINE' } } } } } } });
    const localizedGenres = genres.map((genre) => {
      const translations = genre.translations && typeof genre.translations === 'object' && !Array.isArray(genre.translations)
        ? genre.translations as Record<string, unknown>
        : {};
      return {
        slug: genre.slug,
        name: typeof translations[locale] === 'string' ? translations[locale] : genre.name,
        count: genre._count.albums
      };
    });
    const now = new Date();
    const configuredBlocks = await app.prisma.homeBlock.findMany({
      where: {
        enabled: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }]
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: {
            AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }]
          },
          orderBy: { sortOrder: 'asc' },
          include: {
            album: {
              include: {
                episodes: { where: { status: 'ONLINE' }, select: { id: true } },
                translations: true,
                genres: { include: { genre: { select: { slug: true } } } }
              }
            }
          }
        }
      }
    });
    const configured: HomeResponse['blocks'] = [];
    for (const block of configuredBlocks) {
      const onlineItems = block.items.filter((item) => item.album?.status === 'ONLINE' && isAlbumVisibleInCountry(item.album?.regions, country));
      if (block.type === 'CAROUSEL') {
        configured.push({
          type: 'CAROUSEL',
          title: block.title,
          items: onlineItems.map((item) => {
            const album = item.album!;
            const title = translatedText(album.translations, locale, 'title') ?? album.title;
            const coverUrl = translatedText(album.translations, locale, 'coverUrl') ?? album.coverUrl;
            return {
              albumId: album.id,
              title,
              subtitle: translatedText(album.translations, locale, 'description') ?? album.description,
              coverUrl: item.imageUrl ?? coverUrl,
              backdropUrl: item.imageUrl ?? coverUrl,
              deepLink: item.linkPath ?? `/album/${album.id}`
            };
          })
        });
        continue;
      }
      if (block.type === 'GENRE') {
        configured.push({ type: 'GENRES', title: block.title, items: localizedGenres });
        continue;
      }
      const mapped = onlineItems.map((item) => summaries.find((album) => album.id === item.album?.id)).filter((item): item is typeof summaries[number] => Boolean(item));
      if (block.type === 'HOT') configured.push({ type: 'TRENDING', title: block.title, items: mapped });
      else if (block.type === 'NEW_RELEASES') configured.push({ type: 'NEW_RELEASES', title: block.title, items: mapped });
      else configured.push({ type: 'FEED', title: block.title, items: mapped });
    }
    const blocks: HomeResponse['blocks'] = configuredBlocks.length ? configured : [
      { type: 'CAROUSEL', title: 'Featured', items: summaries.slice(0, 3).map((album) => ({ albumId: album.id, title: album.title, subtitle: album.description, coverUrl: album.coverUrl, backdropUrl: album.coverUrl, deepLink: `/album/${album.id}`, badge: 'EDITOR PICK' })) },
      { type: 'GENRES', title: 'Browse by mood', items: localizedGenres },
      { type: 'TRENDING', title: 'Trending now', items: summaries.slice(0, 8) },
      { type: 'NEW_RELEASES', title: 'Fresh episodes', items: summaries.slice(0, 8) }
    ];
    if (user) {
      const progress = await app.prisma.watchProgress.findMany({
        where: { userId: user.sub, completed: false, episode: { status: 'ONLINE', album: { status: 'ONLINE' } } },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: { episode: { include: { album: { include: { translations: true } } } } }
      });
      blocks.unshift({
        type: 'CONTINUE_WATCHING',
        title: 'Continue watching',
        items: progress.filter((item) => isAlbumVisibleInCountry(item.episode.album.regions, country)).map((item) => ({
          albumId: item.episode.albumId,
          episodeId: item.episodeId,
          episodeNo: item.episode.episodeNo,
          title: translatedText(item.episode.album.translations, locale, 'title') ?? item.episode.album.title,
          coverUrl: translatedText(item.episode.album.translations, locale, 'coverUrl') ?? item.episode.album.coverUrl,
          progress: item.durationMs ? Math.min(item.positionMs / item.durationMs, 1) : 0,
          resumePositionMs: item.positionMs,
          durationMs: item.durationMs
        }))
      });
    }
    return {
      locale: locale as Locale,
      cacheVersion: `home_${new Date().toISOString()}`,
      blocks,
      components: components.length ? components.map((component) => ({ key: component.key as never, page: component.page as never, enabled: component.enabled, config: (component.config as Record<string, unknown> | null) ?? null })) : defaultUiComponents,
      feed: { items: summaries, nextCursor: null }
    };
  });
}
