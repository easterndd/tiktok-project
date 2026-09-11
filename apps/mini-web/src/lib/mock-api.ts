import type {
  AlbumDetail,
  AlbumSummary,
  CursorPage,
  HistoryItem,
  InteractionResponse,
  Locale,
  Preferences,
  SearchResponse,
  ShareResponse,
  UserProfile
} from '@breezereels/shared-types';
import {
  getMockAlbum,
  getMockEpisodes,
  getMockHistory,
  getMockHome,
  mockAlbums,
  mockGenres,
  readPreferences,
  readStringSet,
  searchMockAlbums,
  writePreferences,
  writeStringSet
} from '../data/mock-data';
import { defaultUiComponents } from '../features/cms/defaults';

type MockRequest = { method: string; path: string; body?: unknown };

export async function mockApiRequest<T>({ method, path, body }: MockRequest): Promise<T> {
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/home') return getMockHome((url.searchParams.get('locale') as Locale | null) ?? readPreferences().locale) as T;
  if (method === 'GET' && pathname === '/ui-components') return { items: defaultUiComponents } as T;
  const locale = (url.searchParams.get('locale') as Locale | null) ?? readPreferences().locale;
  if (method === 'GET' && pathname === '/albums') return { items: getMockHome(locale).feed.items, nextCursor: null } as T;
  if (method === 'GET' && pathname === '/genres') return { items: getMockHome(locale).blocks.find((block) => block.type === 'GENRES' && 'items' in block)?.items ?? mockGenres } as T;
  if (method === 'GET' && pathname.startsWith('/genres/') && pathname.endsWith('/albums')) {
    const slug = pathname.split('/')[2];
    return { items: getMockHome(locale).feed.items.filter((album) => mockAlbums.find((source) => source.id === album.id)?.genres?.some((genre) => genre.toLowerCase() === slug)), nextCursor: null } as T;
  }
  if (method === 'GET' && pathname === '/search') return searchMockAlbums(url.searchParams.get('q') ?? '', locale) as T;

  const albumMatch = pathname.match(/^\/albums\/([^/]+)$/);
  if (method === 'GET' && albumMatch) {
    const album = getMockAlbum(albumMatch[1], locale);
    if (!album) throw new Error('Drama not found.');
    return album as T;
  }
  const episodeListMatch = pathname.match(/^\/albums\/([^/]+)\/episodes$/);
  if (method === 'GET' && episodeListMatch) return { items: getMockEpisodes(episodeListMatch[1], locale) } as T;

  const interactionMatch = pathname.match(/^\/albums\/([^/]+)\/(like|favorite)$/);
  if (method === 'PUT' && interactionMatch) {
    const [, albumId, action] = interactionMatch;
    const active = Boolean((body as { active?: boolean } | undefined)?.active);
    const key = action === 'like' ? 'breezereels_mock_likes' : 'breezereels_mock_favorites';
    const values = readStringSet(key);
    active ? values.add(albumId) : values.delete(albumId);
    writeStringSet(key, values);
    const album = getMockAlbum(albumId, locale)!;
    return { liked: album.userState?.liked ?? false, favorited: album.userState?.favorited ?? false, likeCount: album.likeCount ?? 0, favoriteCount: album.favoriteCount ?? 0, shareCount: album.shareCount ?? 0 } satisfies InteractionResponse as T;
  }
  const shareMatch = pathname.match(/^\/albums\/([^/]+)\/share$/);
  if (method === 'POST' && shareMatch) {
    const album = getMockAlbum(shareMatch[1], locale)!;
    return { deepLink: `/album/${album.id}`, title: album.title, coverUrl: album.coverUrl, shareCount: (album.shareCount ?? 0) + 1 } satisfies ShareResponse as T;
  }
  const unlockMatch = pathname.match(/^\/episodes\/([^/]+)\/reward-unlock$/);
  if (method === 'POST' && unlockMatch) {
    const unlocked = readStringSet('breezereels_mock_unlocked');
    unlocked.add(unlockMatch[1]);
    writeStringSet('breezereels_mock_unlocked', unlocked);
    return { access: 'PLAYABLE' } as T;
  }
  const playMatch = pathname.match(/^\/episodes\/([^/]+)\/play$/);
  if (method === 'GET' && playMatch) {
    const episodeId = playMatch[1];
    const albumId = episodeId.split('-episode-')[0];
    const episode = getMockEpisodes(albumId, locale).find((item) => item.id === episodeId);
    const album = getMockAlbum(albumId, locale);
    if (!episode || !album) throw new Error('Episode not found.');
    if (episode.access !== 'PLAYABLE') throw new Error('Watch a rewarded ad to unlock this episode.');
    return { albumId: `mock-${albumId}`, episodeId: `mock-${episodeId}`, vid: `mock-vid-${episodeId}`, playAuthToken: null, title: episode.title, coverUrl: album.backdropUrl ?? album.coverUrl, durationMs: episode.durationMs, resumePositionMs: episode.resumePositionMs ?? 0 } as T;
  }
  if (method === 'GET' && pathname === '/me') return { id: 'mock-user', displayName: 'Drama fan', avatarUrl: null, locale: readPreferences().locale, createdAt: '2026-08-18T00:00:00.000Z' } satisfies UserProfile as T;
  if (method === 'GET' && (pathname === '/me/history' || pathname === '/me/watch-progress')) return { items: getMockHistory(locale) } as T;
  if (method === 'GET' && pathname === '/me/favorites') {
    const favorites = readStringSet('breezereels_mock_favorites');
    const albums = getMockHome(locale).feed.items;
    const items = favorites.size ? albums.filter((album) => favorites.has(album.id)) : albums.slice(1, 4);
    return { items, nextCursor: null } satisfies CursorPage<AlbumSummary> as T;
  }
  if (method === 'GET' && pathname === '/me/preferences') return readPreferences() as T;
  if (method === 'PUT' && pathname === '/me/preferences') {
    const preferences = { ...readPreferences(), ...(body as Partial<Preferences>) };
    writePreferences(preferences);
    return preferences as T;
  }
  if (method === 'PUT' && pathname === '/me/watch-progress') return undefined as T;
  if (method === 'POST' && (pathname === '/ad-events' || pathname === '/playback-quality-events')) return undefined as T;
  if (method === 'POST' && pathname === '/auth/tiktok/login') return { accessToken: 'mock-business-session', expiresIn: 3600, user: { id: 'mock-user' } } as T;

  throw new Error(`Mock endpoint is not implemented: ${method} ${pathname}`);
}
