import type { HomeResponse, Locale } from '@quickreels/shared-types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';
import { defaultUiComponents } from '../ui/routes';
import { isAlbumVisibleInCountry, isPlatformPublished, publicAlbumWhere, requestCountry } from '../../lib/content-visibility';
import { coverThumbnailUrl } from '../../lib/cover-thumbnail';
import { measureDatabase } from '../../lib/request-performance';

const querySchema = z.object({ locale: publicLocaleSchema.default(defaultLocale) });

function translatedText(
  translations: { locale: string; title: string; description: string; coverUrl: string | null }[] | undefined,
  locale: string,
  field: 'title' | 'description' | 'coverUrl'
) {
  return translations?.find((translation) => translation.locale === locale)?.[field] ?? undefined;
}

const homeCatalogCacheTtlMs = 30_000;
const homeProgressCacheTtlMs = 5_000;
const homeProgressCacheMaxEntries = 5_000;
const publicHomeResponseCacheTtlMs = 15_000;
const publicHomeResponseCacheMaxEntries = 64;

async function loadHomeCatalog(app: FastifyInstance, request: FastifyRequest, now: Date) {
  const [components, albums, genres, configuredBlocks] = await Promise.all([
    measureDatabase(request, () => app.prisma.uiComponent.findMany({ orderBy: { key: 'asc' } })),
    measureDatabase(request, () => app.prisma.album.findMany({
      where: publicAlbumWhere(app.config),
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        episodes: { where: { status: 'ONLINE' }, select: { id: true } },
        translations: true,
        genres: { include: { genre: { select: { slug: true } } } }
      }
    })),
    measureDatabase(request, () => app.prisma.genre.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { albums: { where: { album: publicAlbumWhere(app.config) } } } } } })),
    measureDatabase(request, () => app.prisma.homeBlock.findMany({
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
            },
            targetEpisode: { select: { albumId: true, status: true, localPlaybackUrl: true } }
          }
        }
      }
    }))
  ]);
  return { components, albums, genres, configuredBlocks, catalogVersion: now.toISOString() };
}

type HomeCatalog = Awaited<ReturnType<typeof loadHomeCatalog>>;
const homeCatalogCache = new Map<string, { expiresAt: number; value: Promise<HomeCatalog> }>();

type PublicHomeResponseCache = Map<string, { expiresAt: number; value: Promise<HomeResponse> }>;

function getCachedPublicHomeResponse(cache: PublicHomeResponseCache, key: string, load: () => Promise<HomeResponse>) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }

  const value = load();
  const entry = { expiresAt: Number.POSITIVE_INFINITY, value };
  cache.set(key, entry);
  while (cache.size > publicHomeResponseCacheMaxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  void value.then(() => {
    if (cache.get(key) === entry) entry.expiresAt = Date.now() + publicHomeResponseCacheTtlMs;
  }, () => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return value;
}

function getHomeCatalog(app: FastifyInstance, request: FastifyRequest, now: Date) {
  if (app.config.NODE_ENV !== 'production') return loadHomeCatalog(app, request, now);
  const key = app.config.MINI_APP_KEY;
  const cached = homeCatalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = loadHomeCatalog(app, request, now);
  const entry = { expiresAt: Number.POSITIVE_INFINITY, value };
  homeCatalogCache.set(key, entry);
  void value.then(() => {
    if (homeCatalogCache.get(key) === entry) entry.expiresAt = Date.now() + homeCatalogCacheTtlMs;
  }, () => {
    if (homeCatalogCache.get(key)?.value === value) homeCatalogCache.delete(key);
  });
  return value;
}

async function loadHomeProgress(app: FastifyInstance, request: FastifyRequest, userId: string) {
  return measureDatabase(request, () => app.prisma.watchProgress.findMany({
    where: { userId, completed: false, episode: { status: 'ONLINE', album: publicAlbumWhere(app.config) } },
    orderBy: { updatedAt: 'desc' },
    take: 6,
    select: {
      episodeId: true,
      positionMs: true,
      durationMs: true,
      episode: {
        select: {
          albumId: true,
          episodeNo: true,
          album: {
            select: {
              regions: true,
              title: true,
              coverUrl: true,
              translations: { select: { locale: true, title: true, description: true, coverUrl: true } }
            }
          }
        }
      }
    }
  }));
}

type HomeProgress = Awaited<ReturnType<typeof loadHomeProgress>>;

export async function registerHomeRoutes(app: FastifyInstance) {
  const publicHomeResponseCache: PublicHomeResponseCache = new Map();
  const progressCache = new Map<string, { expiresAt: number; value: Promise<HomeProgress> }>();
  const getHomeProgress = (request: FastifyRequest, userId: string) => {
    const cached = progressCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      progressCache.delete(userId);
      progressCache.set(userId, cached);
      return cached.value;
    }

    const value = loadHomeProgress(app, request, userId);
    const entry = { expiresAt: Number.POSITIVE_INFINITY, value };
    progressCache.set(userId, entry);
    while (progressCache.size > homeProgressCacheMaxEntries) {
      const oldest = progressCache.keys().next().value;
      if (oldest === undefined) break;
      progressCache.delete(oldest);
    }
    void value.then(() => {
      if (progressCache.get(userId) === entry) entry.expiresAt = Date.now() + homeProgressCacheTtlMs;
    }, () => {
      if (progressCache.get(userId) === entry) progressCache.delete(userId);
    });
    return value;
  };

  app.get('/home', async (request): Promise<HomeResponse> => {
    const { locale } = querySchema.parse(request.query);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const user = await optionalUser(request);
    const cacheKey = !user && app.config.NODE_ENV !== 'development' ? `${locale}:${country ?? ''}` : null;
    const response = async (): Promise<HomeResponse> => {
    const now = new Date();
    const catalogPromise = getHomeCatalog(app, request, now);
    const progressPromise: Promise<HomeProgress> = user ? getHomeProgress(request, user.sub) : Promise.resolve([]);
    const [catalog, progress] = await Promise.all([catalogPromise, progressPromise]);
    const { components, albums, genres, configuredBlocks, catalogVersion } = catalog;
    const visibleAlbums = albums.filter((album) => isAlbumVisibleInCountry(album.regions, country));
    const summaries = visibleAlbums.map((album) => ({
      id: album.id,
      title: translatedText(album.translations, locale, 'title') ?? album.title,
      description: translatedText(album.translations, locale, 'description') ?? album.description,
      coverUrl: coverThumbnailUrl(translatedText(album.translations, locale, 'coverUrl') ?? album.coverUrl),
      episodeCount: album.episodes.length,
      updatedAt: album.updatedAt.toISOString(),
      language: album.language,
      genres: (album.genres ?? []).map(({ genre }) => genre.slug),
      status: 'ONLINE' as const
    }));
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
    const configured: HomeResponse['blocks'] = [];
    for (const block of configuredBlocks) {
      const onlineItems = block.items.filter((item) => Boolean(item.album) && isPlatformPublished(item.album!, app.config) && isAlbumVisibleInCountry(item.album?.regions, country));
      if (block.type === 'CAROUSEL') {
        configured.push({
          type: 'CAROUSEL',
          title: block.title,
          items: onlineItems.map((item) => {
            const album = item.album!;
            const title = translatedText(album.translations, locale, 'title') ?? album.title;
            const coverUrl = coverThumbnailUrl(translatedText(album.translations, locale, 'coverUrl') ?? album.coverUrl);
            const localPreviewUrl = app.config.NODE_ENV !== 'production' && app.config.LOCAL_PLAYBACK_ENABLED && item.targetEpisode?.albumId === album.id && item.targetEpisode.status === 'ONLINE'
              ? item.targetEpisode.localPlaybackUrl
              : null;
            return {
              albumId: album.id,
              title,
              subtitle: translatedText(album.translations, locale, 'description') ?? album.description,
              coverUrl: coverThumbnailUrl(item.imageUrl ?? coverUrl),
              backdropUrl: coverThumbnailUrl(item.imageUrl ?? coverUrl),
              previewUrl: item.previewUrl ?? localPreviewUrl,
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
      blocks.unshift({
        type: 'CONTINUE_WATCHING',
        title: 'Continue watching',
        items: progress.filter((item) => isAlbumVisibleInCountry(item.episode.album.regions, country)).map((item) => ({
          albumId: item.episode.albumId,
          episodeId: item.episodeId,
          episodeNo: item.episode.episodeNo,
          title: translatedText(item.episode.album.translations, locale, 'title') ?? item.episode.album.title,
          coverUrl: coverThumbnailUrl(translatedText(item.episode.album.translations, locale, 'coverUrl') ?? item.episode.album.coverUrl),
          progress: item.durationMs ? Math.min(item.positionMs / item.durationMs, 1) : 0,
          resumePositionMs: item.positionMs,
          durationMs: item.durationMs
        }))
      });
    }
    return {
      locale: locale as Locale,
      cacheVersion: `home_${catalogVersion}`,
      blocks,
      components: components.length ? components.map((component) => ({ key: component.key as never, page: component.page as never, enabled: component.enabled, config: (component.config as Record<string, unknown> | null) ?? null })) : defaultUiComponents,
      feed: { items: summaries, nextCursor: null }
    };
    };
    return cacheKey ? getCachedPublicHomeResponse(publicHomeResponseCache, cacheKey, response) : response();
  });
}
