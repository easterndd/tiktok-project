import type { AlbumSummary } from './album';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EPISODE_LOCKED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
  };
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

/** Public language choices. Countries are targeting metadata, not user-facing locales. */
export type Locale = 'en' | 'pt' | 'fr' | 'id' | 'ja' | 'es' | 'ko' | 'th';

export type UiComponentKey =
  | 'APP_TOPBAR'
  | 'APP_BOTTOM_NAV'
  | 'HOME_INTRO'
  | 'HOME_FEED'
  | 'ALBUM_DESCRIPTION'
  | 'PROFILE_HISTORY'
  | 'PROFILE_FAVORITES';

export type UiComponent = {
  key: UiComponentKey;
  page: 'APP' | 'HOME' | 'ALBUM' | 'PROFILE';
  enabled: boolean;
  config?: Record<string, unknown> | null;
};

export type HomeBlockType =
  | 'CONTINUE_WATCHING'
  | 'CAROUSEL'
  | 'GENRES'
  | 'TRENDING'
  | 'NEW_RELEASES'
  | 'FEED';

export type WatchProgress = {
  episodeId: string;
  episodeNo: number;
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
  updatedAt: string;
};

export type UserState = {
  liked: boolean;
  favorited: boolean;
  likeCount: number;
  favoriteCount: number;
  shareCount: number;
};

export type HomeContinueItem = {
  albumId: string;
  episodeId: string;
  episodeNo: number;
  title: string;
  coverUrl: string;
  progress: number;
  resumePositionMs: number;
  durationMs: number | null;
};

export type HomeHeroItem = {
  albumId: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  backdropUrl: string;
  deepLink: string;
  badge?: string;
};

export type Genre = {
  slug: string;
  name: string;
  count?: number;
  accent?: string;
};

export type HomeBlock =
  | { type: 'CONTINUE_WATCHING'; title: string; items: HomeContinueItem[] }
  | { type: 'CAROUSEL'; title: string; items: HomeHeroItem[] }
  | { type: 'GENRES'; title: string; items: Genre[] }
  | { type: 'TRENDING' | 'NEW_RELEASES' | 'FEED'; title: string; items: AlbumSummary[] };

export type HomeResponse = {
  locale: Locale;
  cacheVersion: string;
  blocks: HomeBlock[];
  components: UiComponent[];
  feed: CursorPage<AlbumSummary>;
};

export type SearchResponse = CursorPage<AlbumSummary> & {
  query: string;
  fallbackItems: AlbumSummary[];
};

export type InteractionResponse = UserState;

export type ShareResponse = {
  deepLink: string;
  title: string;
  coverUrl: string;
  shareCount: number;
};

export type UserProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  locale: Locale;
  createdAt?: string;
};

export type HistoryItem = AlbumSummary & {
  episodeId: string;
  episodeNo: number;
  episodeTitle: string;
  progress: number;
  resumePositionMs: number;
  durationMs: number | null;
  watchedAt: string;
};

export type Preferences = {
  locale: Locale;
  autoplay: boolean;
  reducedData: boolean;
};

export type AdEventInput = {
  adType: 'REWARDED' | 'INTERSTITIAL';
  eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_COMPLETED' | 'CLOSED_INCOMPLETE' | 'FAILED';
  placementId: string;
  episodeId?: string;
  sessionId?: string;
  errorCode?: string;
};

export type PlaybackQualityEventInput = {
  episodeId: string;
  eventType: 'FIRST_FRAME' | 'WAITING' | 'DEFINITION_CHANGE' | 'ERROR' | 'ENDED';
  startupMs?: number;
  bufferMs?: number;
  definition?: string;
  errorCode?: string;
};
