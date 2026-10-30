import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import type { Env } from './config/env';
import type { MiniAppKey } from './config/mini-apps';
import { miniAppAdConfig } from './config/mini-apps';
import { loadEnv } from './config/env';
import { hashPassword } from './services/password';
import { BytePlusVodService } from './services/byteplus-vod.service';
import { uploadScope, uploadTags } from './services/local-upload.service';
import { cleanupSharedIps, recordSharedIpVisit, setEntryAdIpExemption, waitForSharedIpVisits } from './services/shared-ip.service';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MINI_APP_KEY: 'main',
  API_CORS_ORIGIN: 'http://localhost:5173',
  TRUSTED_PROXY_CIDRS: '',
  TRUST_GEO_COUNTRY_HEADER: true,
  ENTRY_AD_ATTRIBUTION_GATE_ENABLED: false,
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
  USER_JWT_EXPIRES_IN: 3_600,
  ADMIN_JWT_EXPIRES_IN: 28_800,
  ADMIN_BOOTSTRAP_EMAIL: undefined,
  ADMIN_BOOTSTRAP_PASSWORD: undefined,
  BYTEPLUS_ACCOUNT_ID: 'test-account',
  BYTEPLUS_SPACE_NAME: 'test-space',
  BYTEPLUS_REGION: 'test-region',
  BYTEPLUS_ACCESS_KEY: undefined,
  BYTEPLUS_SECRET_KEY: undefined,
  BYTEPLUS_VOD_ENDPOINT: 'https://vod.byteplusapi.com',
  TIKTOK_CLIENT_KEY: undefined,
  TIKTOK_CLIENT_SECRET: undefined,
  TIKTOK_APP_ID: undefined,
  TALETV_TIKTOK_CLIENT_KEY: undefined,
  TALETV_TIKTOK_CLIENT_SECRET: undefined,
  TALETV_TIKTOK_APP_ID: undefined,
  REWARDED_PLACEMENT_ID: 'ad7686459794040702993',
  TALETV_REWARDED_PLACEMENT_ID: 'ad7688599028879722512',
  APP_ENTRY_PLACEMENT_ID: 'ad7686459458972829697',
  TALETV_APP_ENTRY_PLACEMENT_ID: '',
  TIKTOK_SHORT_DRAMA_API_BASE: 'https://open.tiktokapis.com',
  API_PUBLIC_BASE_URL: undefined,
  COVER_ASSET_STORAGE_DIR: 'tmp/cover-assets-test',
  COVER_ASSET_PUBLIC_BASE_URL: undefined,
  LOCAL_PLAYBACK_ENABLED: false,
  UPLOAD_WORKER_INTERVAL_MS: 30_000,
  UPLOAD_MAX_RETRIES: 5
};

async function createPrismaStub() {
  const album = {
    id: 'album-1',
    title: 'Test Drama',
    description: 'A test drama.',
    coverUrl: 'https://example.com/cover.jpg',
    language: 'en',
    regions: ['US'],
    accessConfig: { freeEpisodeCount: 0, rewardedAdEnabled: true, rewardedPlacementId: 'rewarded_episode_unlock', rewardedAdCount: 3 },
    status: 'ONLINE',
    platformPublishedVersion: 1,
    onlineVersion: 1,
    reviewStatus: 'PASSED',
    publishStatus: 'LISTED',
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    tiktokAlbumId: 'tiktok-album-1',
    episodes: [{ id: 'episode-1' }],
    _count: { episodes: 1 }
  };
  const episode = {
    id: 'episode-1',
    albumId: 'album-1',
    tiktokEpisodeId: 'tiktok-episode-1',
    byteplusVid: 'vid-1',
    title: 'Episode 1',
    coverUrl: 'https://example.com/episode.jpg',
    durationMs: 100_000,
    isFree: false,
    status: 'ONLINE',
    sortOrder: 1,
    episodeNo: 1,
    album
  };
  const state = {
    viewer: { id: 'user-1', identityType: 'ANONYMOUS', appEntryAdExempt: false, tiktokOpenId: null as string | null, visitorKeyHash: null as string | null, createdAt: new Date(), updatedAt: new Date() },
    credentials: new Map<string, any>(),
    likes: new Set<string>(),
    favorites: new Set<string>(),
    unlocks: new Set<string>(),
    adEvents: new Map<string, any>(),
    rewardSessions: new Map<string, any>(),
    rewards: new Map<string, any>(),
    entrySessions: new Map<string, any>(),
    entryCompletions: new Map<string, any>(),
    appSessions: new Map<string, any>(),
    activityEvents: new Map<string, any>(),
    healthQueryCalls: { adFailureCount: 0, adFailureList: 0 },
    legacyLaunchMetadata: { metadata: { launchQuery: { adId: 'test-ad-id' } } } as any | null,
    sharedIps: new Map<string, any>(),
    sharedVisits: new Map<string, any>(),
    sharedExemptions: new Map<string, any>(),
    playbackSessions: new Map<string, any>(),
    completionEvents: new Map<string, any>(),
    uiConfigVersions: new Map<number, any>(),
    entryPolicies: new Map<string, any>(),
    codeReleases: new Map<string, any>(),
    shareCount: 0,
    admin: { id: 'admin-1', email: 'operator@example.com', passwordHash: '', role: 'OWNER', status: 'ACTIVE', tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() }
  };
  const adminPasswordHash = await hashPassword('not-used');
  state.admin.passwordHash = adminPasswordHash;
  const prisma: any = {
    _state: state,
    miniAppCodeRelease: {
      findMany: async ({ where }: any) => [...state.codeReleases.values()].filter((item) => item.miniAppKey === where.miniAppKey),
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.miniAppKey_releaseId.miniAppKey}:${where.miniAppKey_releaseId.releaseId}`;
        const item = { ...(state.codeReleases.get(key) ?? create), ...update };
        state.codeReleases.set(key, item);
        return item;
      }
    },
    miniAppAlbumAuthorization: { findMany: async () => [], findFirst: async () => null },
    album: {
      findMany: async () => [album],
      findFirst: async () => ({ ...album, likes: [], favorites: [] }),
      findUnique: async () => album,
      create: async (args: { data: unknown }) => ({ ...album, ...(args.data as object) }),
      update: async (args: { data: Record<string, unknown> }) => Object.assign(album, args.data),
      delete: async () => ({ ...album }),
      count: async () => 1
    },
    episode: {
      findMany: async (args?: { where?: { episodeNo?: { in: number[] } } }) => args?.where?.episodeNo?.in ? [episode].filter((item) => args.where!.episodeNo!.in.includes(item.episodeNo)) : [episode],
      findFirst: async () => episode,
      findUnique: async () => episode,
      create: async (args?: { data?: Record<string, unknown> }) => ({ ...episode, ...args?.data, id: `episode-${args?.data?.episodeNo ?? 1}` }),
      update: async () => episode,
      count: async () => 1
    },
    episodeUnlock: {
      findUnique: async (args: { where: { userId_episodeId: { userId: string; episodeId: string } } }) => state.unlocks.has(`${args.where.userId_episodeId.userId}:${args.where.userId_episodeId.episodeId}`) ? { id: 'unlock-1' } : null,
      upsert: async (args: { where: { userId_episodeId: { userId: string; episodeId: string } } }) => {
        state.unlocks.add(`${args.where.userId_episodeId.userId}:${args.where.userId_episodeId.episodeId}`);
        return { id: 'unlock-1' };
      },
      count: async () => state.unlocks.size
    },
    rewardedUnlockSession: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async (args: { where: { userId: string; episodeId: string; status: string; purpose?: string; releaseId?: string } }) => Array.from(state.rewardSessions.values()).find((session) => session.userId === args.where.userId && session.episodeId === args.where.episodeId && session.status === args.where.status && (session.purpose ?? 'EPISODE_UNLOCK') === (args.where.purpose ?? 'EPISODE_UNLOCK') && (session.releaseId ?? 'default') === (args.where.releaseId ?? 'default')) ?? null,
      findUnique: async (args: { where: { id: string } }) => state.rewardSessions.get(args.where.id) ?? null,
      findUniqueOrThrow: async (args: { where: { id: string } }) => state.rewardSessions.get(args.where.id),
      create: async (args: { data: any }) => {
        const session = { id: `session-${state.rewardSessions.size + 1}`, completedCount: 0, status: 'ACTIVE', ...args.data };
        state.rewardSessions.set(session.id, session);
        return session;
      },
      update: async (args: { where: { id: string }; data: any }) => {
        const session = { ...state.rewardSessions.get(args.where.id), ...args.data };
        state.rewardSessions.set(args.where.id, session);
        return session;
      }
    },
    rewardedUnlockReward: {
      findUnique: async (args: { where: { sessionId_clientEventId: { sessionId: string; clientEventId: string } } }) => state.rewards.get(`${args.where.sessionId_clientEventId.sessionId}:${args.where.sessionId_clientEventId.clientEventId}`) ?? null,
      create: async (args: { data: any }) => {
        const reward = { id: `reward-${state.rewards.size + 1}`, ...args.data };
        state.rewards.set(`${reward.sessionId}:${reward.clientEventId}`, reward);
        return reward;
      }
    },
    adEvent: {
      findUnique: async (args: any) => state.adEvents.get(`${args.where.userId_clientEventId.userId}:${args.where.userId_clientEventId.clientEventId}`) ?? null,
      findMany: async () => { state.healthQueryCalls.adFailureList += 1; return []; },
      upsert: async (args: any) => {
        const key = `${args.where.userId_clientEventId.userId}:${args.where.userId_clientEventId.clientEventId}`;
        const existing = state.adEvents.get(key);
        if (existing) {
          const event = { ...existing, ...args.update };
          state.adEvents.set(key, event);
          return event;
        }
        const event = { id: `ad-event-${state.adEvents.size + 1}`, ...args.create };
        state.adEvents.set(key, event);
        return event;
      },
      findFirst: async (args: any) => Array.from(state.adEvents.values()).find((event) => Object.entries(args.where).every(([key, value]) => event[key] === value)) ?? null,
      update: async (args: any) => {
        const entry = Array.from(state.adEvents.entries()).find(([, event]) => event.id === args.where.id);
        if (!entry) throw new Error('Ad event not found');
        const event = { ...entry[1], ...args.data };
        state.adEvents.set(entry[0], event);
        return event;
      },
      create: async (args: any) => {
        const key = `${args.data.userId}:${args.data.clientEventId}`;
        if (state.adEvents.has(key)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.19.1' });
        }
        const event = { id: `ad-event-${state.adEvents.size + 1}`, ...args.data };
        state.adEvents.set(key, event);
        return event;
      },
      count: async () => { state.healthQueryCalls.adFailureCount += 1; return state.adEvents.size; }
    },
    albumLike: {
      findUnique: async (args: { where: { userId_albumId: { userId: string; albumId: string } } }) => state.likes.has(`${args.where.userId_albumId.userId}:${args.where.userId_albumId.albumId}`) ? { id: 'like-1' } : null,
      upsert: async (args: { where: { userId_albumId: { userId: string; albumId: string } } }) => { state.likes.add(`${args.where.userId_albumId.userId}:${args.where.userId_albumId.albumId}`); return { id: 'like-1' }; },
      deleteMany: async (args: { where: { userId: string; albumId: string } }) => { state.likes.delete(`${args.where.userId}:${args.where.albumId}`); return { count: 1 }; },
      count: async () => state.likes.size
    },
    albumFavorite: {
      findUnique: async (args: { where: { userId_albumId: { userId: string; albumId: string } } }) => state.favorites.has(`${args.where.userId_albumId.userId}:${args.where.userId_albumId.albumId}`) ? { id: 'favorite-1' } : null,
      upsert: async (args: { where: { userId_albumId: { userId: string; albumId: string } } }) => { state.favorites.add(`${args.where.userId_albumId.userId}:${args.where.userId_albumId.albumId}`); return { id: 'favorite-1' }; },
      deleteMany: async (args: { where: { userId: string; albumId: string } }) => { state.favorites.delete(`${args.where.userId}:${args.where.albumId}`); return { count: 1 }; },
      count: async () => state.favorites.size
    },
    shareEvent: {
      count: async () => state.shareCount,
      create: async () => { state.shareCount += 1; return { id: `share-${state.shareCount}` }; }
    },
    searchEvent: { create: async () => ({ id: 'search-1' }), count: async () => 0 },
    audienceActivityEvent: {
      findFirst: async ({ where, orderBy }: any) => {
        const events = [...state.activityEvents.values()].filter((event) => event.userId === where.userId && event.eventType === where.eventType);
        if (where.metadata) return events.find((event) => event.metadata?.entryId === where.metadata.equals) ?? null;
        if (orderBy) return events.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? state.legacyLaunchMetadata;
        return events[0] ?? null;
      },
      create: async ({ data }: any) => {
        const event = { id: `activity-${state.activityEvents.size + 1}`, createdAt: new Date(), ...data };
        state.activityEvents.set(event.id, event);
        return event;
      },
      update: async ({ where, data }: any) => {
        const event = Object.assign(state.activityEvents.get(where.id), data);
        state.activityEvents.set(where.id, event);
        return event;
      },
      findMany: async ({ where, take, skip = 0 }: any) => [...state.activityEvents.values()].reverse().filter((event) =>
        (typeof where.userId === 'string' ? where.userId === event.userId : where.userId.in.includes(event.userId))
        && event.eventType === where.eventType).slice(skip, skip + take)
    },
    watchProgress: { findMany: async () => [] },
    user: {
      upsert: async ({ where, create, update }: any) => {
        if (where.visitorKeyHash && state.viewer.visitorKeyHash === where.visitorKeyHash) return state.viewer;
        if (where.visitorKeyHash) Object.assign(state.viewer, create, update, { visitorKeyHash: where.visitorKeyHash });
        return state.viewer;
      },
      findUnique: async ({ where }: any) => where.id ? (where.id === state.viewer.id ? state.viewer : null) : where.tiktokOpenId === state.viewer.tiktokOpenId ? state.viewer : null,
      findMany: async () => [{ ...state.viewer, appSessions: [...state.appSessions.values()].filter((session) => session.userId === state.viewer.id).slice(-1) }],
      updateMany: async ({ where, data }: any) => {
        const ids = Array.isArray(where.id?.in) ? where.id.in : [where.id];
        if (!ids.includes(state.viewer.id)) return { count: 0 };
        Object.assign(state.viewer, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => state.viewer,
      update: async ({ data }: any) => Object.assign(state.viewer, data),
      count: async () => 1
    },
    tikTokCredential: {
      upsert: async ({ where, create, update }: any) => {
        const value = { ...(state.credentials.get(where.userId) ?? create), ...update };
        state.credentials.set(where.userId, value);
        return value;
      }
    },
    appSession: {
      upsert: async (args: any) => {
        const key = `${args.where.userId_clientSessionId.userId}:${args.where.userId_clientSessionId.clientSessionId}`;
        const session = { ...(state.appSessions.get(key) ?? args.create), ...(state.appSessions.has(key) ? args.update : {}), id: key };
        state.appSessions.set(key, session);
        return session;
      },
      findMany: async () => [],
      groupBy: async () => {
        const counts = new Map<string | null, number>();
        for (const session of state.appSessions.values()) counts.set(session.countryCode ?? null, (counts.get(session.countryCode ?? null) ?? 0) + 1);
        return [...counts].map(([countryCode, count]) => ({ countryCode, _count: { _all: count } }));
      }
    },
    appEntryAdPolicy: {
      findUnique: async (args: any) => state.entryPolicies.get(args.where.releaseId ?? 'default') ?? null,
      updateMany: async (args: any) => {
        const policy = state.entryPolicies.get(args.where.releaseId);
        if (!policy || policy.firstSeenAt) return { count: 0 };
        state.entryPolicies.set(args.where.releaseId, { ...policy, ...args.data });
        return { count: 1 };
      },
      findMany: async () => [...state.entryPolicies.values()].reverse(),
      create: async (args: any) => {
        const policy = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
        state.entryPolicies.set(policy.releaseId, policy);
        return policy;
      },
      upsert: async (args: any) => {
        const releaseId = args.where.releaseId;
        const policy = { ...(state.entryPolicies.get(releaseId) ?? args.create), ...args.update, releaseId, updatedAt: new Date() };
        state.entryPolicies.set(releaseId, policy);
        return policy;
      }
    },
    appEntryAdSession: {
      findUnique: async (args: any) => {
        if (args.where.id) return state.entrySessions.get(args.where.id) ?? null;
        const unique = args.where.userId_releaseId_launchId ?? { ...args.where.userId_launchId, releaseId: 'default' };
        const key = `${unique.userId}:${unique.releaseId}:${unique.launchId}`;
        return state.entrySessions.get(key) ?? null;
      },
      findUniqueOrThrow: async (args: any) => state.entrySessions.get(args.where.id),
      create: async (args: any) => {
        const session = { id: `entry-session-${state.entrySessions.size + 1}`, completedCount: 0, status: 'ACTIVE', ...args.data };
        state.entrySessions.set(session.id, session);
        state.entrySessions.set(`${session.userId}:${session.releaseId ?? 'default'}:${session.launchId}`, session);
        return session;
      },
      update: async (args: any) => {
        const session = { ...state.entrySessions.get(args.where.id), ...args.data };
        state.entrySessions.set(session.id, session);
        state.entrySessions.set(`${session.userId}:${session.releaseId ?? 'default'}:${session.launchId}`, session);
        return session;
      },
      updateMany: async ({ where, data }: any) => {
        const session = state.entrySessions.get(where.id);
        if (!session || session.userId !== where.userId || session.countMode !== where.countMode || session.status !== where.status
          || session.expiresAt <= where.expiresAt.gt || session.completedCount !== where.completedCount || session.requiredCount < where.requiredCount.gte) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      }
    },
    appEntryAdCompletion: {
      findUnique: async (args: any) => {
        const unique = args.where.sessionId_clientEventId;
        if (unique) return state.entryCompletions.get(`${unique.sessionId}:${unique.clientEventId}`) ?? null;
        const byIndex = args.where.sessionId_adIndex;
        return state.entryCompletions.get(`${byIndex.sessionId}:index:${byIndex.adIndex}`) ?? null;
      },
      findFirst: async (args: any) => {
        const where = args.where ?? {};
        return [...state.entryCompletions.values()].find((completion: any) => completion.sessionId === where.sessionId
          && (where.OR ?? []).some((candidate: any) => Object.entries(candidate).every(([key, value]) => completion[key] === value))) ?? null;
      },
      create: async (args: any) => {
        const completion = { id: `entry-completion-${state.entryCompletions.size + 1}`, ...args.data };
        state.entryCompletions.set(`${completion.sessionId}:${completion.clientEventId}`, completion);
        state.entryCompletions.set(`${completion.sessionId}:index:${completion.adIndex}`, completion);
        return completion;
      }
    },
    userPreference: {
      upsert: async () => ({ locale: 'en', autoplay: true, reducedData: false }),
      findUnique: async () => null
    },
    adminUser: {
      findUnique: async (args: any) => {
        if (args.where.id && args.where.id !== state.admin.id) return null;
        if (args.where.email && args.where.email !== state.admin.email) return null;
        return state.admin;
      },
      findUniqueOrThrow: async () => state.admin,
      update: async (args: any) => {
        const changes = { ...args.data };
        if (changes.tokenVersion?.increment) changes.tokenVersion = state.admin.tokenVersion + changes.tokenVersion.increment;
        state.admin = { ...state.admin, ...changes, updatedAt: new Date() };
        return state.admin;
      },
      findMany: async () => [state.admin],
      create: async (args: any) => ({ id: 'admin-2', ...args.data })
    },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
    coverAsset: { findUnique: async () => null, findMany: async () => [], upsert: async () => ({ id: 'cover-1', publicUrl: 'https://example.com/cover.jpg', status: 'READY' }) },
    homeBlock: { findMany: async () => [] },
    uiComponent: { findMany: async () => [], upsert: async () => ({ key: 'HOME_FEED', page: 'HOME', enabled: true, config: null }) },
    uiConfigVersion: {
      findFirst: async (args: any) => Array.from(state.uiConfigVersions.values()).filter((item: any) => !args?.where?.status || item.status === args.where.status).at(-1) ?? null,
      findUnique: async (args: any) => state.uiConfigVersions.get(args.where.version) ?? null,
      create: async (args: any) => { const version = state.uiConfigVersions.size + 1; const item = { version, status: 'DRAFT', ...args.data }; state.uiConfigVersions.set(version, item); return item; },
      update: async (args: any) => { const item = { ...state.uiConfigVersions.get(args.where.version), ...args.data }; state.uiConfigVersions.set(args.where.version, item); return item; },
      updateMany: async (args: any) => { for (const [version, item] of state.uiConfigVersions) if (!args.where?.status || item.status === args.where.status) state.uiConfigVersions.set(version, { ...item, ...args.data }); return { count: state.uiConfigVersions.size }; }
    },
    genre: { findMany: async () => [], create: async () => ({ id: 'genre-1' }), update: async () => ({ id: 'genre-1' }) },
    miniAppRuntimeError: { groupBy: async () => [], findMany: async () => [] },
    playbackQualityEvent: { create: async () => ({ id: 'quality-1' }), groupBy: async () => [], aggregate: async () => ({ _count: 0, _avg: { startupMs: null }, _sum: { bufferMs: null } }), count: async () => 0, findMany: async () => [] },
    playbackSession: {
      findUnique: async (args: any) => state.playbackSessions.get(args.where.id) ?? null,
      create: async (args: any) => { state.playbackSessions.set(args.data.id, args.data); return args.data; },
      update: async (args: any) => { const item = { ...state.playbackSessions.get(args.where.id), ...args.data }; state.playbackSessions.set(args.where.id, item); return item; },
      count: async () => state.playbackSessions.size
    },
    episodeCompletionEvent: {
      upsert: async (args: any) => { const key = `${args.where.userId_episodeId.userId}:${args.where.userId_episodeId.episodeId}`; const item = state.completionEvents.get(key) ?? args.create; state.completionEvents.set(key, item); return item; },
      count: async () => state.completionEvents.size
    },
    adRevenue: { findMany: async () => [], upsert: async () => ({ id: 'revenue-1' }) },
    uploadJob: { count: async () => 0, findMany: async () => [], findUnique: async () => null, findFirst: async () => null, create: async () => ({ id: 'job-1' }), updateMany: async () => ({ count: 1 }) },
    platformSyncJob: { count: async () => 0, findMany: async () => [] },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    $executeRaw: async (query: any, ...values: any[]) => {
      const sql = typeof query?.sql === 'string' ? query.sql : Array.isArray(query) ? query.join('?') : String(query);
      if (sql.includes('INSERT INTO "SharedIpAddress"')) {
        const [hash, ipAddress, lastMiniAppKey, countryCode] = values;
        state.sharedIps.set(hash, { ...(state.sharedIps.get(hash) ?? { ipHash: hash, visitCount: 0, firstSeenAt: new Date() }), ipAddress, lastMiniAppKey, countryCode, lastSeenAt: new Date() }); return 1;
      }
      if (sql.includes('WITH inserted_visit AS') && sql.includes('INSERT INTO "SharedIpVisit"')) {
        const [idempotencyKey, ipHash, miniAppKey, userId, ipAddress, lastMiniAppKey, countryCode] = values;
        if (state.sharedVisits.has(idempotencyKey)) return 0;
        state.sharedVisits.set(idempotencyKey, { idempotencyKey, ipHash, miniAppKey, userId, createdAt: new Date() });
        const address = state.sharedIps.get(ipHash);
        if (address) {
          address.ipAddress = ipAddress;
          address.lastMiniAppKey = lastMiniAppKey;
          address.countryCode = countryCode;
          address.lastSeenAt = new Date();
          address.visitCount += 1;
        }
        return 1;
      }
      if (sql.includes('UPDATE "SharedIpAddress"') && sql.includes('"visitCount" = "visitCount" + 1')) {
        const hash = values.at(-1);
        state.sharedIps.get(hash).visitCount += 1;
        return 1;
      }
      if (sql.includes('DELETE FROM "SharedIpVisit" v USING "SharedIpAddress"')) {
        const [cutoff] = values;
        let deleted = 0;
        for (const [key, visit] of state.sharedVisits) {
          const address = state.sharedIps.get(visit.ipHash);
          if (address?.visitCount < 3 && visit.createdAt < cutoff && !state.sharedExemptions.has(address.ipAddress)) {
            state.sharedVisits.delete(key); deleted++;
          }
        }
        return deleted;
      }
      if (sql.includes('UPDATE "SharedIpAddress" a SET "ipAddress" = NULL')) {
        const [cutoff] = values;
        let updated = 0;
        for (const address of state.sharedIps.values()) {
          if (address.visitCount < 3 && address.lastSeenAt < cutoff && address.ipAddress !== null && !state.sharedExemptions.has(address.ipAddress)) {
            address.ipAddress = null; updated++;
          }
        }
        return updated;
      }
      if (sql.includes('DELETE FROM "SharedEntryAdIpExemption"')) return state.sharedExemptions.delete(values[0]) ? 1 : 0;
      return 0;
    },
    $queryRaw: async (query: any, ...tagValues: any[]) => {
      const sql = typeof query?.sql === 'string' ? query.sql : Array.isArray(query) ? query.join('?') : String(query);
      const values = typeof query?.sql === 'string' ? query.values : tagValues;
      if (sql.includes('SELECT "ipHash" FROM "SharedIpVisit"')) {
        const visit = state.sharedVisits.get(values[0]);
        return visit ? [{ ipHash: visit.ipHash }] : [];
      }
      if (sql.includes('INSERT INTO "SharedIpVisit"')) {
        const [idempotencyKey, ipHash, miniAppKey, userId] = values;
        if (state.sharedVisits.has(idempotencyKey)) return [];
        state.sharedVisits.set(idempotencyKey, { idempotencyKey, ipHash, miniAppKey, userId, createdAt: new Date() }); return [{ idempotencyKey }];
      }
      if (sql.includes('SELECT EXISTS(SELECT 1 FROM "SharedEntryAdIpExemption"')) return [{ exempt: state.sharedExemptions.has(values[0]) }];
      if (sql.includes('INSERT INTO "SharedEntryAdIpExemption"')) {
        const [ipAddress, note, updatedBy] = values;
        const item = { ...(state.sharedExemptions.get(ipAddress) ?? { ipAddress, createdAt: new Date() }), note, updatedBy, updatedAt: new Date() };
        state.sharedExemptions.set(ipAddress, item); return [item];
      }
      if (sql.includes('FROM "SharedEntryAdIpExemption" ORDER BY')) return [...state.sharedExemptions.values()];
      if (sql.includes('SELECT DISTINCT ON (v."userId")')) {
        const [miniAppKey, ...userIds] = values;
        return userIds.map((userId: string) => { const visit = [...state.sharedVisits.values()].reverse().find((item) => item.miniAppKey === miniAppKey && item.userId === userId); return visit && { userId, ipAddress: state.sharedIps.get(visit.ipHash)?.ipAddress ?? null }; }).filter(Boolean);
      }
      if (sql.includes('SELECT DISTINCT "userId" FROM "SharedIpVisit"')) {
        const [miniAppKey, hash] = values;
        return [...state.sharedVisits.values()].filter((item) => item.miniAppKey === miniAppKey && item.ipHash === hash).map((item) => ({ userId: item.userId }));
      }
      if (sql.includes('FROM "SharedIpAddress" a LEFT JOIN')) {
        const all = [...state.sharedIps.values()].map((item) => ({ ...item, exempt: state.sharedExemptions.has(item.ipAddress) }));
        const searched = sql.includes('WHERE a."ipHash"') ? all.filter((item) => item.ipHash === values.find((value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value as string))) : all;
        const miniAppKey = values.find((value: unknown) => ['main', 'taletv', 'cinereels', 'talereels'].includes(String(value)));
        const filtered = miniAppKey ? searched.filter((address) => [...state.sharedVisits.values()].some((visit) => visit.ipHash === address.ipHash && visit.miniAppKey === miniAppKey)) : searched;
        return filtered.slice(0, values.at(-1));
      }
      if (sql.includes('FROM "SharedIpVisit"')) {
        const [hash, ...rest] = values;
        const miniAppKey = rest.length === 3 ? rest[0] : undefined;
        const limit = rest.at(-2);
        const offset = rest.at(-1);
        return [...state.sharedVisits.values()].filter((item) => item.ipHash === hash && (!miniAppKey || item.miniAppKey === miniAppKey)).slice(offset, offset + limit);
      }
      return [{ '?column?': 1 }];
    }
  };
  return prisma;
}

async function createTestApp(envOverrides: Partial<Env> = {}, options: { miniPrisma?: Partial<Record<MiniAppKey, PrismaClient>>; sharedPrisma?: PrismaClient } = {}) {
  const prisma = await createPrismaStub();
  const app = await buildApp({ ...env, ...envOverrides }, {
    prisma: prisma as unknown as PrismaClient,
    ...(envOverrides.TALETV_DATABASE_URL ? { taletvPrisma: prisma as unknown as PrismaClient } : {}),
    ...options
  });
  await app.ready();
  return app;
}

async function token(app: Awaited<ReturnType<typeof createTestApp>>, kind: 'user' | 'admin') {
  return app.jwt.sign(kind === 'user' ? { sub: 'user-1', kind, appKey: 'main' } : { sub: 'admin-1', kind, appKey: 'main', role: 'OWNER', tokenVersion: 0 });
}

describe('QuicK ReeLS API', () => {
  const apps: Awaited<ReturnType<typeof createTestApp>>[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await waitForSharedIpVisits();
    while (apps.length) await apps.pop()!.close();
  });

  it('parses the production geo header flag as a real boolean', () => {
    assert.equal(loadEnv({ ...env, TRUST_GEO_COUNTRY_HEADER: 'false' } as any).TRUST_GEO_COUNTRY_HEADER, false);
    assert.equal(loadEnv({ ...env, TRUST_GEO_COUNTRY_HEADER: 'true' } as any).TRUST_GEO_COUNTRY_HEADER, true);
  });

  it('loads episode-interstitial placements independently for each configured Mini', () => {
    const placements = {
      storyflicks: '7698625673044428852',
      dramablaze: 'ad7701250594312390677',
      cinereels: 'ad7701598971906803713',
      dramahit: 'ad7701591362000848902',
      taletv: 'ad7701229465732532245'
    } as const;
    for (const [miniAppKey, placementId] of Object.entries(placements) as [keyof typeof placements, string][]) {
      const configured = loadEnv({ ...env, [`${miniAppKey.toUpperCase()}_EPISODE_INTERSTITIAL_PLACEMENT_ID`]: placementId } as any);
      assert.equal(miniAppAdConfig(configured, miniAppKey).episodeInterstitialPlacementId, placementId);
    }
  });

  it('uses a forwarded client IP only when the immediate proxy is trusted', async () => {
    const trusted = await createTestApp({ TRUSTED_PROXY_CIDRS: '172.20.0.2/32' });
    apps.push(trusted);
    for (let index = 0; index < 120; index += 1) {
      const response = await trusted.inject({ method: 'GET', url: '/ready', remoteAddress: '172.20.0.2', headers: { 'x-forwarded-for': '198.51.100.1' } });
      assert.equal(response.statusCode, 200);
    }
    const limited = await trusted.inject({ method: 'GET', url: '/ready', remoteAddress: '172.20.0.2', headers: { 'x-forwarded-for': '198.51.100.1' } });
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers['retry-after']) > 0);
    const spoofedFirstHop = await trusted.inject({ method: 'GET', url: '/ready', remoteAddress: '172.20.0.2', headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.1' } });
    assert.equal(spoofedFirstHop.statusCode, 429);
    const otherClient = await trusted.inject({ method: 'GET', url: '/ready', remoteAddress: '172.20.0.2', headers: { 'x-forwarded-for': '198.51.100.2' } });
    assert.equal(otherClient.statusCode, 200);

    const untrusted = await createTestApp({ TRUSTED_PROXY_CIDRS: '172.20.0.2/32' });
    apps.push(untrusted);
    for (let index = 0; index < 120; index += 1) {
      const response = await untrusted.inject({ method: 'GET', url: '/ready', remoteAddress: '198.51.100.10', headers: { 'x-forwarded-for': `198.51.100.${index + 20}` } });
      assert.equal(response.statusCode, 200);
    }
    const spoofed = await untrusted.inject({ method: 'GET', url: '/ready', remoteAddress: '198.51.100.10', headers: { 'x-forwarded-for': '203.0.113.99' } });
    assert.equal(spoofed.statusCode, 429);
  });

  it('separates an administrator from anonymous traffic and keeps login strict', async () => {
    const app = await createTestApp({ TALETV_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=taletv' });
    apps.push(app);
    for (let index = 0; index < 120; index += 1) {
      assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 200);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 429);
    assert.equal((await app.inject({ method: 'GET', url: '/api/taletv/v1/albums' })).statusCode, 200);
    const authorization = `Bearer ${await token(app, 'admin')}`;
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization } })).statusCode, 200);
    for (let index = 0; index < 119; index += 1) {
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/albums', headers: { authorization } })).statusCode, 200);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/albums', headers: { authorization } })).statusCode, 429);
    const secondAdmin = `Bearer ${await app.jwt.sign({ sub: 'admin-2', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 })}`;
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/albums', headers: { authorization: secondAdmin } })).statusCode, 200);

    const loginApp = await createTestApp();
    apps.push(loginApp);
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await loginApp.inject({ method: 'POST', url: '/api/v1/admin/auth/login', payload: {} })).statusCode, 400);
    }
    assert.equal((await loginApp.inject({ method: 'POST', url: '/api/v1/admin/auth/login', payload: {} })).statusCode, 429);
  });

  it('isolates anonymous bootstrap from unrelated public API traffic at a shared IP', async () => {
    const app = await createTestApp();
    apps.push(app);
    for (let index = 0; index < 120; index += 1) assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/ready' })).statusCode, 429);
    const session = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session',
      payload: { visitorKey: 'c'.repeat(64), clientSessionId: 'shared-ip-test-0001' } });
    assert.equal(session.statusCode, 200, session.body);
  });

  it('replaces an episode VID and clears its old independent cover without deleting shared media', async () => {
    const prisma = await createPrismaStub();
    const before = await prisma.episode.findUnique();
    before.coverAsset = { id: 'old-cover', status: 'READY', publicUrl: 'https://example.com/wrong.jpg' };
    before.coverAssetId = 'old-cover';
    before.tiktokVideoStatus = 'READY';
    let update: any;
    prisma.episode.update = async (args: any) => { update = args.data; return { ...before, ...args.data }; };
    prisma.platformSyncJob = { findFirst: async () => null };
    let createdMedia: any;
    prisma.sharedMediaAsset = { findUnique: async () => null, create: async (args: any) => { createdMedia = args.data; return { id: 'new-media', ...args.data }; } };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const original = BytePlusVodService.prototype.getMediaInfos;
    BytePlusVodService.prototype.getMediaInfos = async () => [{ vid: 'correct-vid', title: 'Correct drama', spaceName: env.BYTEPLUS_SPACE_NAME, coverUrl: 'https://example.com/correct.jpg', tags: uploadTags(uploadScope(env), 'original-upload') }];
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/episodes/episode-1/bind-byteplus', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { byteplusVid: 'correct-vid', coverAssetId: null } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(update.byteplusVid, 'correct-vid');
      assert.equal(update.coverAssetId, null);
      assert.equal(update.coverUrl, 'https://example.com/correct.jpg');
      assert.equal(update.tiktokVideoStatus, 'NOT_STARTED');
      assert.equal(update.tiktokVideoJobId, null);
      assert.equal(createdMedia.byteplusVid, 'correct-vid');
      assert.equal(before.byteplusVid, 'vid-1');
    } finally { BytePlusVodService.prototype.getMediaInfos = original; }
  });

  it('rejects replacement media in a different space and preserves the original binding', async () => {
    const prisma = await createPrismaStub();
    prisma.platformSyncJob = { findFirst: async () => null };
    let updated = false;
    prisma.episode.update = async () => { updated = true; return {}; };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const original = BytePlusVodService.prototype.getMediaInfos;
    BytePlusVodService.prototype.getMediaInfos = async () => [{ vid: 'wrong-space-vid', title: 'Other space', spaceName: 'other-space' }];
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/episodes/episode-1/bind-byteplus', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { byteplusVid: 'wrong-space-vid', coverAssetId: null } });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(updated, false);
    } finally { BytePlusVodService.prototype.getMediaInfos = original; }
  });

  it('blocks replacement while a previous platform task is active', async () => {
    const prisma = await createPrismaStub();
    prisma.platformSyncJob = { findFirst: async () => ({ status: 'PROCESSING' }) };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/episodes/episode-1/bind-byteplus', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { byteplusVid: 'new-vid' } });
    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().error.message, /平台任务/);
  });

  it('resets a wrongly bound episode even when the album has an existing platform version', async () => {
    const prisma = await createPrismaStub();
    const episode = await prisma.episode.findUnique();
    episode.tiktokEpisodeId = null;
    episode.status = 'READY';
    episode.tiktokVideoStatus = 'NOT_STARTED';
    episode.byteplusUploadStatus = 'READY';
    prisma.episode.updateMany = async (args: any) => { Object.assign(episode, args.data); return { count: 1 }; };
    prisma.episode.findUniqueOrThrow = async () => episode;
    prisma.platformSyncJob = { findFirst: async () => null };
    let uploadJobSelect: unknown;
    prisma.uploadJob.findFirst = async (args: any) => { uploadJobSelect = args.select; return null; };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/episodes/episode-1/reset-byteplus', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { confirmation: 'RESET_VIDEO_BINDING' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(uploadJobSelect, { id: true });
    assert.equal(episode.byteplusVid, null);
    assert.equal(episode.byteplusUploadStatus, 'PENDING');
    assert.equal(episode.status, 'DRAFT');
  });

  it('deletes an offline shared playback copy without deleting its source authorization', async () => {
    const prisma = await createPrismaStub();
    const album = await prisma.album.findUnique();
    album.status = 'OFFLINE';
    album.tiktokAlbumId = 'shared-platform-album';
    const authorization: any = { id: 'auth-1', sharedAlbumId: 'shared-1', miniAppKey: 'main', targetLocalAlbumId: album.id, status: 'AUTHORIZED', album: { ownerMiniAppKey: 'storyland' } };
    prisma.album.findUnique = async () => album;
    prisma.album.delete = async () => album;
    prisma.miniAppAlbumAuthorization.findFirst = async () => authorization;
    prisma.miniAppAlbumAuthorization.update = async ({ data }: any) => Object.assign(authorization, data);
    prisma.sharedPlatformOperation = { findFirst: async () => null };
    prisma.platformSyncJob = { findFirst: async () => null };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/admin/albums/${album.id}`, headers: { authorization: `Bearer ${await token(app, 'admin')}` } });
    assert.equal(response.statusCode, 204, response.body);
    assert.equal(authorization.status, 'FAILED');
    assert.equal(authorization.targetLocalAlbumId, null);
    assert.match(authorization.errorMessage, /TikTok 平台授权仍保留/);
  });

  it('cleans up an online legacy shared copy from another organization', async () => {
    const prisma = await createPrismaStub();
    const album = await prisma.album.findUnique();
    const authorization: any = { id: 'auth-1', sharedAlbumId: 'shared-1', miniAppKey: 'main', targetLocalAlbumId: album.id, status: 'FAILED', album: { ownerMiniAppKey: 'storyland' } };
    let albumUpdate: any;
    let episodeUpdate: any;
    prisma.album.findUnique = async () => album;
    prisma.album.update = async ({ data }: any) => { albumUpdate = data; Object.assign(album, data); return album; };
    prisma.episode.updateMany = async ({ data }: any) => { episodeUpdate = data; return { count: 1 }; };
    prisma.album.delete = async () => album;
    prisma.miniAppAlbumAuthorization.findFirst = async () => authorization;
    prisma.miniAppAlbumAuthorization.update = async ({ data }: any) => Object.assign(authorization, data);
    prisma.sharedPlatformOperation = { findFirst: async () => null };
    prisma.platformSyncJob = { findFirst: async () => null };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/admin/albums/${album.id}`, headers: { authorization: `Bearer ${await token(app, 'admin')}` } });
    assert.equal(response.statusCode, 204, response.body);
    assert.equal(albumUpdate.status, 'OFFLINE');
    assert.equal(episodeUpdate.status, 'OFFLINE');
    assert.equal(authorization.status, 'FAILED');
    assert.equal(authorization.targetLocalAlbumId, null);
  });

  it('clearing an independent episode cover restores the current BytePlus cover', async () => {
    const prisma = await createPrismaStub();
    const episode = await prisma.episode.findUnique();
    episode.byteplusCoverUrl = 'https://example.com/current-vod.jpg';
    let update: any;
    prisma.episode.update = async (args: any) => { update = args.data; return { ...episode, ...args.data }; };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/admin/episodes/episode-1', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { coverAssetId: null } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(update.coverAssetId, null);
    assert.equal(update.coverUrl, episode.byteplusCoverUrl);
  });

  it('updating only an album cover preserves its description and language', async () => {
    const prisma = await createPrismaStub();
    const album = await prisma.album.findUnique();
    album.language = 'es';
    const description = album.description;
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/album-1', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { coverUrl: 'https://example.com/new-cover.png' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(album.description, description);
    assert.equal(album.language, 'es');
  });

  it('updating an episode title leaves its free access flag unchanged', async () => {
    const prisma = await createPrismaStub();
    let update: any;
    prisma.episode.update = async (args: any) => { update = args.data; return { id: 'episode-1', isFree: true, ...args.data }; };
    const app = await buildApp(env, { prisma });
    apps.push(app);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/admin/episodes/episode-1', headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { title: 'Correct Episode 1' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(Object.hasOwn(update, 'isFree'), false);
    assert.equal(response.json().isFree, true);
  });

  it('reports liveness and database readiness separately', async () => {
    const app = await createTestApp();
    apps.push(app);
    const live = await app.inject({ method: 'GET', url: '/live' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, 'ok');
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().database, 'ok');
  });

  it('allows configured TikTok Mini origins without allowing arbitrary origins', async () => {
    const app = await createTestApp({
      API_CORS_ORIGIN: 'https://admin.evergreenprosper.com,https://tiktok.com,https://*.tiktok.com,https://*.tiktok-minis.us'
    });
    apps.push(app);

    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/anonymous/session',
      headers: {
        origin: 'https://microapp.tiktok.com',
        'access-control-request-method': 'POST'
      }
    });
    const allowedRootDomain = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/anonymous/session',
      headers: {
        origin: 'https://tiktok.com',
        'access-control-request-method': 'POST'
      }
    });
    const allowedMiniRuntime = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/anonymous/session',
      headers: {
        origin: 'https://minis-example-preview.tiktok-minis.us',
        'access-control-request-method': 'POST'
      }
    });
    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/anonymous/session',
      headers: {
        origin: 'https://microapp.tiktok.evil.example',
        'access-control-request-method': 'POST'
      }
    });

    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://microapp.tiktok.com');
    assert.equal(allowed.headers['access-control-max-age'], '600');
    assert.equal(allowedRootDomain.statusCode, 204);
    assert.equal(allowedRootDomain.headers['access-control-allow-origin'], 'https://tiktok.com');
    assert.equal(allowedMiniRuntime.statusCode, 204);
    assert.equal(allowedMiniRuntime.headers['access-control-allow-origin'], 'https://minis-example-preview.tiktok-minis.us');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('serves public home and search without authentication', async () => {
    const app = await createTestApp();
    apps.push(app);
    const albumModel = app.prisma.album as unknown as { findMany: (...args: any[]) => Promise<unknown[]> };
    const originalAlbumFindMany = albumModel.findMany.bind(albumModel);
    let catalogQueries = 0;
    albumModel.findMany = async (...args) => {
      catalogQueries += 1;
      return originalAlbumFindMany(...args);
    };
    const progressModel = app.prisma.watchProgress as unknown as { findMany: (...args: any[]) => Promise<unknown[]> };
    const originalFindMany = progressModel.findMany.bind(progressModel);
    let progressQueries = 0;
    progressModel.findMany = async (...args) => {
      progressQueries += 1;
      return originalFindMany(...args);
    };

    const home = await app.inject({ method: 'GET', url: '/api/v1/home', headers: { 'x-geo-country': 'US' } });
    assert.equal(home.statusCode, 200);
    assert.match(String(home.headers['server-timing'] ?? ''), /db;dur=\d+(?:\.\d+)?, app;dur=\d+(?:\.\d+)?/);
    assert.equal(home.json().feed.items[0].title, 'Test Drama');
    const repeatedPublic = await app.inject({ method: 'GET', url: '/api/v1/home', headers: { 'x-geo-country': 'US' } });
    assert.equal(repeatedPublic.statusCode, 200);
    assert.equal(catalogQueries, 1);
    assert.equal(repeatedPublic.json().blocks.some((block: { type: string }) => block.type === 'CONTINUE_WATCHING'), false);
    const authorization = `Bearer ${await token(app, 'user')}`;
    const personalized = await app.inject({ method: 'GET', url: '/api/v1/home', headers: { authorization } });
    assert.equal(personalized.statusCode, 200);
    assert.equal(personalized.json().blocks[0].type, 'CONTINUE_WATCHING');
    const repeatedPersonalized = await app.inject({ method: 'GET', url: '/api/v1/home', headers: { authorization } });
    assert.equal(repeatedPersonalized.statusCode, 200);
    assert.equal(repeatedPersonalized.json().blocks[0].type, 'CONTINUE_WATCHING');
    assert.equal(progressQueries, 1);

    const search = await app.inject({ method: 'GET', url: '/api/v1/search?q=test' });
    assert.equal(search.statusCode, 200);
  });

  it('coalesces concurrent retries of the same anonymous session request', async () => {
    const app = await createTestApp();
    apps.push(app);
    const userModel = app.prisma.user as unknown as { upsert: (...args: any[]) => Promise<unknown> };
    const sessionModel = app.prisma.appSession as unknown as { upsert: (...args: any[]) => Promise<unknown> };
    const originalUserUpsert = userModel.upsert.bind(userModel);
    const originalSessionUpsert = sessionModel.upsert.bind(sessionModel);
    let userUpserts = 0;
    let sessionUpserts = 0;
    userModel.upsert = async (...args) => {
      userUpserts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalUserUpsert(...args);
    };
    sessionModel.upsert = async (...args) => {
      sessionUpserts += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalSessionUpsert(...args);
    };
    const payload = { visitorKey: 'v'.repeat(64), clientSessionId: 'coalesced-session-0001', platform: 'TIKTOK_MINIS', source: 'APP_LAUNCH' };
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', payload }),
      app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', payload })
    ]);

    assert.deepEqual(responses.map((response) => response.statusCode), [200, 200]);
    assert.equal(responses[0].json().viewer.id, responses[1].json().viewer.id);
    assert.equal(userUpserts, 1);
    assert.equal(sessionUpserts, 1);
  });

  it('does not expose regional content when the trusted country does not match', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { 'x-geo-country': 'CA' };

    const [home, albums, detail, episodes, search] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/home', headers }),
      app.inject({ method: 'GET', url: '/api/v1/albums', headers }),
      app.inject({ method: 'GET', url: '/api/v1/albums/album-1', headers }),
      app.inject({ method: 'GET', url: '/api/v1/albums/album-1/episodes', headers }),
      app.inject({ method: 'GET', url: '/api/v1/search?q=test', headers })
    ]);

    assert.deepEqual(home.json().feed.items, []);
    assert.deepEqual(albums.json().items, []);
    assert.equal(detail.statusCode, 404);
    assert.equal(episodes.statusCode, 404);
    assert.deepEqual(search.json().items, []);
  });

  it('rejects authenticated interactions without a user token', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/albums/album-1/like',
      payload: { active: true }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'UNAUTHORIZED');
  });

  it('creates an anonymous viewer session without TikTok OAuth', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/anonymous/session',
      payload: { visitorKey: 'a'.repeat(64), clientSessionId: 'session-test-0001', platform: 'WEB' }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().viewer.type, 'ANONYMOUS');
    assert.equal(typeof response.json().accessToken, 'string');
  });

  it('preserves each WebView entry URL and exposes its history only to an owner', async () => {
    const app = await createTestApp();
    apps.push(app);
    const previewUrl = 'https://mini.example.test/?src=preview&src=qr#watch';
    const adUrl = 'https://mini.example.test/?campaign_id=123&ttclid=click%2Bvalue#watch';
    const entryId = 'preview-entry-0001';
    const session = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', payload: {
      visitorKey: 'p'.repeat(64), clientSessionId: 'launch-session-0001',
      launchContext: { entryId, rawUrl: previewUrl, launchPath: '/', launchQuery: { src: 'preview' } }
    } });
    assert.equal(session.statusCode, 200, session.body);
    const viewerId = session.json().viewer.id;
    const userHeaders = { authorization: `Bearer ${session.json().accessToken}` };
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/auth/launch-context', headers: userHeaders,
      payload: { entryId, rawUrl: previewUrl, launchQuery: { campaign: 'spring' }, sdkPayloadRaw: '{"query":{"source":"preview"},"launch_from":"anchor"}' } });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    const later = await app.inject({ method: 'POST', url: '/api/v1/auth/launch-context', headers: userHeaders,
      payload: { entryId: 'paid-entry-0002', rawUrl: adUrl, launchPath: '/', launchQuery: { campaign_id: '123' } } });
    assert.equal(later.statusCode, 200, later.body);
    assert.equal((app.prisma as any)._state.activityEvents.size, 2);
    const path = `/api/v1/admin/shared/viewers/${viewerId}/launches?miniAppKey=main&limit=1`;
    assert.equal((await app.inject({ method: 'GET', url: path, headers: userHeaders })).statusCode, 403);
    const ownerHeaders = { authorization: `Bearer ${await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 })}` };
    const latest = await app.inject({ method: 'GET', url: path, headers: ownerHeaders });
    assert.equal(latest.statusCode, 200, latest.body);
    assert.equal(latest.json().items[0].metadata.rawUrl, adUrl);
    assert.equal(latest.json().hasMore, true);
    const older = await app.inject({ method: 'GET', url: `${path}&offset=1`, headers: ownerHeaders });
    assert.equal(older.json().items[0].metadata.rawUrl, previewUrl);
    assert.equal(older.json().items[0].metadata.sdkPayloadRaw, '{"query":{"source":"preview"},"launch_from":"anchor"}');
    assert.deepEqual(older.json().items[0].metadata.launchQuery, { src: 'preview', campaign: 'spring' });
    assert.equal(older.json().hasMore, false);
  });

  it('returns local entry-ad eligibility without writing entry impression records', async () => {
    const prisma = await createPrismaStub();
    const releaseId = 'storyflicks-20261029-test';
    prisma._state.entryPolicies.set(releaseId, { releaseId, enabled: true, mode: 'REWARDED_GATED' });
    const app = await buildApp({ ...env, STORYFLICKS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=storyflicks' }, {
      prisma: prisma as unknown as PrismaClient,
      miniPrisma: { storyflicks: prisma as unknown as PrismaClient }
    });
    apps.push(app);

    const session = await app.inject({ method: 'POST', url: '/api/storyflicks/v1/auth/anonymous/session', payload: {
      visitorKey: 'l'.repeat(64), clientSessionId: 'local-entry-session-0001'
    } });
    assert.equal(session.statusCode, 200, session.body);
    const response = await app.inject({ method: 'POST', url: '/api/storyflicks/v1/auth/launch-context',
      headers: { authorization: `Bearer ${session.json().accessToken}` },
      payload: { entryId: 'local-entry-launch-0001', localEntryAd: true, releaseId, launchQuery: { source: 'storyflicks' } } });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().entryAdEligibility.showEntryAd, true);
    await waitForSharedIpVisits();
    assert.equal(prisma._state.sharedVisits.size, 1);
    assert.equal(prisma._state.entrySessions.size, 0);
    assert.equal(prisma._state.entryCompletions.size, 0);
    assert.equal(prisma._state.adEvents.size, 0);
  });

  it('keeps user and shared-IP entry-ad exemptions on the local eligibility path', async () => {
    const releaseId = 'storyflicks-20261029-test';
    const makeApp = async (userExempt: boolean, ipExempt: boolean) => {
      const prisma = await createPrismaStub();
      prisma._state.entryPolicies.set(releaseId, { releaseId, enabled: true, mode: 'REWARDED_GATED' });
      prisma._state.viewer.appEntryAdExempt = userExempt;
      if (ipExempt) prisma._state.sharedExemptions.set('127.0.0.1', { ipAddress: '127.0.0.1' });
      const app = await buildApp({ ...env, STORYFLICKS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=storyflicks' }, {
        prisma: prisma as unknown as PrismaClient,
        miniPrisma: { storyflicks: prisma as unknown as PrismaClient }
      });
      apps.push(app);
      const session = await app.inject({ method: 'POST', url: '/api/storyflicks/v1/auth/anonymous/session', payload: {
        visitorKey: `${userExempt ? 'u' : 'i'}`.repeat(64), clientSessionId: `local-entry-exempt-${userExempt ? 'user' : 'ip'}`
      } });
      const response = await app.inject({ method: 'POST', url: '/api/storyflicks/v1/auth/launch-context',
        headers: { authorization: `Bearer ${session.json().accessToken}` },
        payload: { entryId: `local-entry-exempt-${userExempt ? 'user' : 'ip'}-launch`, localEntryAd: true, releaseId } });
      return response;
    };

    const userResponse = await makeApp(true, false);
    assert.equal(userResponse.statusCode, 200, userResponse.body);
    assert.deepEqual(userResponse.json().entryAdEligibility, { showEntryAd: false, reason: 'USER_EXEMPT' });
    const ipResponse = await makeApp(false, true);
    assert.equal(ipResponse.statusCode, 200, ipResponse.body);
    assert.deepEqual(ipResponse.json().entryAdEligibility, { showEntryAd: false, reason: 'IP_EXEMPT' });
    await waitForSharedIpVisits();
  });

  it('accepts launch context from an older Mini build without an entry ID', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', payload: {
      visitorKey: 'q'.repeat(64), clientSessionId: 'legacy-launch-session-0001',
      launchContext: { launchPath: '/', launchQuery: { source: 'preview' } }
    } });
    assert.equal(response.statusCode, 200, response.body);
    const event = [...(app.prisma as any)._state.activityEvents.values()][0] as any;
    assert.equal(event.metadata.entryId, 'legacy-launch-session-0001');
  });

  it('stores the resolved client IP and trusted country for regional analytics', async () => {
    const app = await createTestApp({ TRUSTED_PROXY_CIDRS: '172.20.0.2/32' });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', remoteAddress: '172.20.0.2',
      headers: { 'x-forwarded-for': '198.51.100.25', 'x-geo-country': 'US' },
      payload: { visitorKey: 'b'.repeat(64), clientSessionId: 'region-test-001' } });
    assert.equal(response.statusCode, 200, response.body);
    const session = (app.prisma as any)._state.appSessions.get('user-1:region-test-001');
    assert.equal(Object.hasOwn(session, 'ipAddress'), false);
    assert.equal(session.countryCode, 'US');
    const entry = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions',
      headers: { authorization: `Bearer ${response.json().accessToken}`, 'x-forwarded-for': '198.51.100.25', 'x-geo-country': 'US' },
      remoteAddress: '172.20.0.2', payload: { launchId: 'f6ac6057-1714-45ea-9ac2-cb9d1fe9e210' } });
    assert.equal(entry.statusCode, 200, entry.body);
    assert.equal([...((app.sharedPrisma as any)._state.sharedIps.values())][0].ipAddress, '198.51.100.25');
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const viewers = await app.inject({ method: 'GET', url: '/api/v1/admin/viewers?search=user-1', headers: adminHeaders });
    assert.equal(viewers.statusCode, 200, viewers.body);
    assert.equal(viewers.json().items[0].ipAddress, '198.51.100.25');
    assert.equal(viewers.json().items[0].countryCode, 'US');
    (app.prisma as any).$queryRaw = async () => [{ countryCode: 'US', viewers: 1, sessions: 1 }];
    const countries = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/audience-countries?days=7', headers: adminHeaders });
    assert.equal(countries.statusCode, 200, countries.body);
    assert.deepEqual(countries.json().items, [{ countryCode: 'US', viewers: 1, sessions: 1 }]);
  });

  it('ignores a user supplied country header when no trusted proxy is configured', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session',
      headers: { 'x-geo-country': 'US' },
      payload: { visitorKey: 'd'.repeat(64), clientSessionId: 'untrusted-geo-001' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((app.prisma as any)._state.appSessions.get('user-1:untrusted-geo-001').countryCode, null);
  });

  it('ignores a direct country header even when another proxy address is trusted', async () => {
    const app = await createTestApp({ TRUSTED_PROXY_CIDRS: '172.20.0.2/32' });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/anonymous/session', remoteAddress: '198.51.100.10',
      headers: { 'x-forwarded-for': '203.0.113.1', 'x-geo-country': 'US' },
      payload: { visitorKey: 'e'.repeat(64), clientSessionId: 'direct-geo-test-001' } });
    assert.equal(response.statusCode, 200, response.body);
    const session = (app.prisma as any)._state.appSessions.get('user-1:direct-geo-test-001');
    assert.equal(Object.hasOwn(session, 'ipAddress'), false);
    assert.equal(session.countryCode, null);
    const entry = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions',
      headers: { authorization: `Bearer ${response.json().accessToken}`, 'x-forwarded-for': '203.0.113.1', 'x-geo-country': 'US' },
      remoteAddress: '198.51.100.10', payload: { launchId: 'e1c1d05f-a0af-4d8b-9520-c5417972bb15' } });
    assert.equal(entry.statusCode, 200, entry.body);
    assert.equal([...((app.sharedPrisma as any)._state.sharedIps.values())][0].ipAddress, '198.51.100.10');
  });

  it('records launches from every mini app in one shared database and counts one launch once', async () => {
    const taletvPrisma = await createPrismaStub();
    const sharedPrisma = await createPrismaStub();
    const app = await createTestApp({ TALETV_DATABASE_URL: 'postgresql://test:test@localhost:5432/taletv' }, {
      miniPrisma: { taletv: taletvPrisma as unknown as PrismaClient },
      sharedPrisma: sharedPrisma as unknown as PrismaClient
    });
    apps.push(app);
    const mainToken = await app.jwt.sign({ sub: 'user-1', kind: 'user', appKey: 'main' });
    const taletvToken = await app.jwt.sign({ sub: 'taletv-user-1', kind: 'user', appKey: 'taletv' });
    const sharedIp = '198.51.100.40';
    const launchId = 'bb2f05a1-285a-4f84-8c6d-2b6dd97fa1c1';
    const mainHeaders = { authorization: `Bearer ${mainToken}` };
    const first = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: mainHeaders, remoteAddress: sharedIp, payload: { launchId } });
    const retry = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: mainHeaders, remoteAddress: sharedIp, payload: { launchId } });
    const taletv = await app.inject({ method: 'POST', url: '/api/taletv/v1/app-entry-ad-sessions', headers: { authorization: `Bearer ${taletvToken}` }, remoteAddress: sharedIp,
      payload: { launchId: '6cb54d6e-5042-4e47-96e9-53fa9eb5cf3b' } });

    assert.equal(first.statusCode, 200, first.body);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(taletv.statusCode, 200, taletv.body);
    await waitForSharedIpVisits();
    const registry = (sharedPrisma as any)._state;
    assert.equal(registry.sharedIps.size, 1);
    assert.equal([...registry.sharedIps.values()][0].visitCount, 2);
    assert.deepEqual([...registry.sharedVisits.values()].map((visit: any) => visit.miniAppKey).sort(), ['main', 'taletv']);
    assert.equal((app.prisma as any)._state.sharedIps.size, 0);
    assert.equal((taletvPrisma as any)._state.sharedIps.size, 0);
  });

  it('keeps entry ads available when shared IP writes or exemption reads fail', async () => {
    const sharedPrisma = await createPrismaStub();
    const app = await createTestApp({}, { sharedPrisma: sharedPrisma as PrismaClient });
    apps.push(app);
    const owner = { authorization: `Bearer ${await token(app, 'admin')}` };
    const viewer = { authorization: `Bearer ${await token(app, 'user')}` };
    const policy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: owner,
      payload: { enabled: true, mode: 'INTERSTITIAL', placementId: 'entry-ad', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(policy.statusCode, 200, policy.body);

    (sharedPrisma as any).$transaction = async () => { throw new Error('P2028: transaction could not be started'); };
    const first = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer,
      remoteAddress: '198.51.100.51', payload: { launchId: 'f7544158-5312-450c-96d4-6507f0894350' } });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().required, true);
    await waitForSharedIpVisits();

    (sharedPrisma as any).$queryRaw = async () => { throw new Error('shared IP lookup unavailable'); };
    const second = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer,
      remoteAddress: '198.51.100.51', payload: { launchId: 'c22c9d77-aa09-40da-8e54-f9a6095df1da' } });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().required, true);
  });

  it('persists exempt IPs, skips only entry ads, and keeps repeated launch counting idempotent', async () => {
    const app = await createTestApp({ TRUST_GEO_COUNTRY_HEADER: true });
    apps.push(app);
    const owner = { authorization: `Bearer ${await token(app, 'admin')}` };
    const viewer = { authorization: `Bearer ${await token(app, 'user')}` };
    const ip = '203.0.113.44';
    const policy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: owner,
      payload: { enabled: true, mode: 'INTERSTITIAL', placementId: 'entry-ad', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(policy.statusCode, 200, policy.body);
    const exemption = await app.inject({ method: 'PUT', url: '/api/v1/admin/shared/entry-ad-ip-exemptions', headers: owner,
      payload: { ipAddress: ip, note: 'trusted office' } });
    assert.equal(exemption.statusCode, 200, exemption.body);
    const launchId = 'bf85110f-c79c-4cb9-9cf4-2f34bf52c014';
    const entry = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer, remoteAddress: ip, payload: { launchId } });
    const retry = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer, remoteAddress: ip, payload: { launchId } });
    assert.deepEqual(entry.json(), { required: false });
    assert.deepEqual(retry.json(), { required: false });

    const episodeReward = await app.inject({ method: 'POST', url: '/api/v1/episodes/episode-1/reward-session', headers: { ...viewer, 'x-geo-country': 'US' }, remoteAddress: ip, payload: {} });
    assert.equal(episodeReward.statusCode, 200, episodeReward.body);
    assert.equal(typeof episodeReward.json().sessionId, 'string');

    await waitForSharedIpVisits();
    const registry = (app.sharedPrisma as any)._state;
    assert.equal([...registry.sharedIps.values()][0].visitCount, 1);
    assert.equal(registry.sharedExemptions.has(ip), true);
    const search = await app.inject({ method: 'GET', url: `/api/v1/admin/shared/ips?search=${encodeURIComponent(ip)}`, headers: owner });
    assert.equal(search.statusCode, 200, search.body);
    assert.equal(search.json().items[0].exempt, true);
    const history = await app.inject({ method: 'GET', url: `/api/v1/admin/shared/ips/${encodeURIComponent(ip)}/visits`, headers: owner });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().items.length, 1);
  });

  it('can gate entry strong ads by attribution when the server switch is enabled', async () => {
    const app = await createTestApp({ ENTRY_AD_ATTRIBUTION_GATE_ENABLED: true });
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders,
      payload: { enabled: true, exitRetentionEnabled: true, exitRetentionAdCount: 2, mode: 'INTERSTITIAL', placementId: 'attributed-entry', requiredCount: 1, onUnavailable: 'ALLOW' } });

    const preview = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: 'a5ac5104-8d0f-40f6-a857-0a2eaf261d36', adId: null } });
    assert.deepEqual(preview.json(), { required: false });
    assert.equal((app.prisma as any)._state.entrySessions.size, 0);

    const placeholder = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: 'a5ac5104-8d0f-40f6-a857-0a2eaf261d37', adId: '__AD_ID__' } });
    assert.deepEqual(placeholder.json(), { required: false });

    const attributed = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: 'a5ac5104-8d0f-40f6-a857-0a2eaf261d38', adId: '1879822310597858' } });
    assert.equal(attributed.statusCode, 200, attributed.body);
    assert.equal(attributed.json().required, true);
    assert.equal(attributed.json().placementId, 'attributed-entry');
  });

  it('keeps exit retention separate from entry ads and episode unlock sessions', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' };
    const policy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders,
      payload: { releaseId: 'main-test-v1', enabled: true, exitRetentionEnabled: true, exitRetentionAdCount: 2, mode: 'INTERSTITIAL', placementId: 'entry-only', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(policy.statusCode, 200, policy.body);

    const config = await app.inject({ method: 'GET', url: '/api/v1/exit-retention/config?releaseId=main-test-v1', headers: userHeaders });
    assert.deepEqual(config.json(), { enabled: true, placementId: env.REWARDED_PLACEMENT_ID, requiredCount: 2 });
    const normal = await app.inject({ method: 'POST', url: '/api/v1/episodes/episode-1/reward-session', headers: userHeaders, payload: {} });
    const retention = await app.inject({ method: 'POST', url: '/api/v1/episodes/episode-1/reward-session', headers: userHeaders, payload: { purpose: 'EXIT_RETENTION', releaseId: 'main-test-v1' } });
    assert.equal(normal.json().requiredCount, 3);
    assert.equal(retention.json().requiredCount, 2);
    assert.notEqual(normal.json().sessionId, retention.json().sessionId);

    const badScope = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers: userHeaders,
      payload: { clientEventId: 'retention-event-1', adType: 'REWARDED', eventType: 'SHOWN', placementId: env.REWARDED_PLACEMENT_ID, episodeId: 'episode-1', sessionId: retention.json().sessionId, rewardSessionId: retention.json().sessionId, adIndex: 1 } });
    assert.equal(badScope.statusCode, 409);
    const firstShown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers: userHeaders,
      payload: { clientEventId: 'retention-event-1', adType: 'REWARDED', scope: 'EXIT_RETENTION', eventType: 'SHOWN', placementId: env.REWARDED_PLACEMENT_ID, episodeId: 'episode-1', sessionId: retention.json().sessionId, rewardSessionId: retention.json().sessionId, adIndex: 1 } });
    assert.equal(firstShown.statusCode, 200, firstShown.body);
    const firstComplete = await app.inject({ method: 'POST', url: `/api/v1/episodes/episode-1/reward-session/${retention.json().sessionId}/complete`, headers: userHeaders,
      payload: { clientEventId: 'retention-event-1', isEnded: true } });
    assert.equal(firstComplete.json().access, 'REWARDED_AD_REQUIRED');
    const secondShown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers: userHeaders,
      payload: { clientEventId: 'retention-event-2', adType: 'REWARDED', scope: 'EXIT_RETENTION', eventType: 'SHOWN', placementId: env.REWARDED_PLACEMENT_ID, episodeId: 'episode-1', sessionId: retention.json().sessionId, rewardSessionId: retention.json().sessionId, adIndex: 2 } });
    assert.equal(secondShown.statusCode, 200, secondShown.body);
    const secondComplete = await app.inject({ method: 'POST', url: `/api/v1/episodes/episode-1/reward-session/${retention.json().sessionId}/complete`, headers: userHeaders,
      payload: { clientEventId: 'retention-event-2', isEnded: true } });
    assert.equal(secondComplete.json().access, 'PLAYABLE');
    assert.equal(secondComplete.json().shouldContinue, false);
  });

  it('acknowledges ad request telemetry without writing an event or changing entry progress', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders,
      payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: 'cbffb69f-29cb-4d45-a26c-3c4139df90d2' } });
    const sessionId = started.json().sessionId as string;
    const before = (app.prisma as any)._state.adEvents.size;
    const unauthenticatedRequested = await app.inject({ method: 'POST', url: '/api/v1/ad-events',
      payload: { clientEventId: 'entry-request-only-legacy', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'REQUESTED', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(unauthenticatedRequested.statusCode, 200, unauthenticatedRequested.body);
    assert.deepEqual(unauthenticatedRequested.json(), { accepted: true });

    const requested = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers: userHeaders,
      payload: { clientEventId: 'entry-request-only', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'REQUESTED', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(requested.statusCode, 200, requested.body);
    assert.deepEqual(requested.json(), { accepted: true });
    const unauthenticatedFailed = await app.inject({ method: 'POST', url: '/api/v1/ad-events', payload: {
      clientEventId: 'entry-failed-only', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'FAILED',
      placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1, errorCode: 'SDK_ERROR'
    } });
    assert.equal(unauthenticatedFailed.statusCode, 200, unauthenticatedFailed.body);
    assert.deepEqual(unauthenticatedFailed.json(), { accepted: true, dropped: true });
    const malformedFailed = await app.inject({ method: 'POST', url: '/api/v1/ad-events', payload: { eventType: 'FAILED' } });
    assert.equal(malformedFailed.statusCode, 200, malformedFailed.body);
    assert.deepEqual(malformedFailed.json(), { accepted: true, dropped: true });
    const unauthenticatedClosed = await app.inject({ method: 'POST', url: '/api/v1/ad-events', payload: {
      clientEventId: 'entry-close-only-legacy', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'CLOSED_INCOMPLETE',
      placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1
    } });
    assert.equal(unauthenticatedClosed.statusCode, 200, unauthenticatedClosed.body);
    assert.deepEqual(unauthenticatedClosed.json(), { accepted: true, dropped: true });
    assert.equal((app.prisma as any)._state.adEvents.size, before);
    const progress = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
    assert.equal(progress!.completedCount, 0);
    assert.equal(progress!.status, 'ACTIVE');
    let sessionLookups = 0;
    const sessionModel = (app.prisma as any).appEntryAdSession;
    const findSession = sessionModel.findUnique;
    sessionModel.findUnique = async (...args: any[]) => { sessionLookups += 1; return findSession(...args); };
    const closed = await app.inject({ method: 'POST', url: '/api/v1/ad-events',
      payload: { clientEventId: 'entry-close-only', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'CLOSED_INCOMPLETE', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.deepEqual(closed.json(), { accepted: true, dropped: true });
    assert.equal(sessionLookups, 0, 'diagnostic incomplete closes must bypass session reads');
    assert.equal((app.prisma as any)._state.adEvents.size, before);
  });

  it('filters viewers by exact IP and mini app and bulk updates entry-ad exemptions', async () => {
    const app = await createTestApp();
    apps.push(app);
    const owner = { authorization: `Bearer ${await token(app, 'admin')}` };
    const ip = '198.51.100.77';
    await recordSharedIpVisit(app.sharedPrisma, { ipAddress: ip, miniAppKey: 'main', userId: 'user-1', clientSessionId: 'search-ip-session', countryCode: null, secret: env.JWT_SECRET });
    await recordSharedIpVisit(app.sharedPrisma, { ipAddress: ip, miniAppKey: 'taletv', userId: 'other-app-user', clientSessionId: 'other-app-session', countryCode: null, secret: env.JWT_SECRET });

    const viewers = await app.inject({ method: 'GET', url: `/api/v1/admin/viewers?ipAddress=${encodeURIComponent(ip)}`, headers: owner });
    assert.equal(viewers.statusCode, 200, viewers.body);
    assert.deepEqual(viewers.json().items.map((item: any) => item.id), ['user-1']);
    const invalidIp = await app.inject({ method: 'GET', url: '/api/v1/admin/viewers?ipAddress=not-an-ip', headers: owner });
    assert.equal(invalidIp.statusCode, 400);

    const exemptViewer = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/app-entry-ad/batch', headers: owner, payload: { userIds: ['user-1'], appEntryAdExempt: true } });
    assert.equal(exemptViewer.statusCode, 200, exemptViewer.body);
    assert.equal(exemptViewer.json().count, 1);
    assert.equal((app as any).prisma._state.viewer.appEntryAdExempt, true);
    const normalViewer = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/app-entry-ad/batch', headers: owner, payload: { userIds: ['user-1'], appEntryAdExempt: false } });
    assert.equal(normalViewer.statusCode, 200, normalViewer.body);
    assert.equal((app as any).prisma._state.viewer.appEntryAdExempt, false);

    const exemptIp = await app.inject({ method: 'POST', url: '/api/v1/admin/shared/entry-ad-ip-exemptions/batch', headers: owner, payload: { ipAddresses: [ip], exempt: true } });
    assert.equal(exemptIp.statusCode, 200, exemptIp.body);
    assert.equal(exemptIp.json().count, 1);
    const filteredIps = await app.inject({ method: 'GET', url: '/api/v1/admin/shared/ips?miniAppKey=main', headers: owner });
    assert.equal(filteredIps.json().items.length, 1, filteredIps.body);
    assert.equal(filteredIps.json().items[0].exempt, true);
    const visits = await app.inject({ method: 'GET', url: `/api/v1/admin/shared/ips/${encodeURIComponent(ip)}/visits?miniAppKey=main`, headers: owner });
    assert.equal(visits.statusCode, 200, visits.body);
    assert.deepEqual(visits.json().items.map((item: any) => item.miniAppKey), ['main']);
    const normalIp = await app.inject({ method: 'POST', url: '/api/v1/admin/shared/entry-ad-ip-exemptions/batch', headers: owner, payload: { ipAddresses: [ip], exempt: false } });
    assert.equal(normalIp.statusCode, 200, normalIp.body);
    assert.equal((app as any).sharedPrisma._state.sharedExemptions.has(ip), false);
  });

  it('requires an active target owner and same-organization access for cross-app viewer operations', async () => {
    const sourcePrisma = await createPrismaStub();
    const targetPrisma = await createPrismaStub();
    (targetPrisma as any)._state.viewer.id = 'storyshort-viewer';
    (targetPrisma as any)._state.viewer.tiktokOpenId = 'storyshort-open-id';
    const app = await createTestApp({
      TALEFLICK_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=taleflick',
      STORYSHORT_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=storyshort'
    }, { miniPrisma: { taleflick: sourcePrisma as unknown as PrismaClient, storyshort: targetPrisma as unknown as PrismaClient } });
    apps.push(app);
    const currentToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'taleflick', role: 'OWNER', tokenVersion: 0 });
    const targetToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'storyshort', role: 'OWNER', tokenVersion: 0 });
    const headers = {
      authorization: `Bearer ${currentToken}`,
      'x-multi-app-tokens': JSON.stringify({ storyshort: targetToken })
    };

    const unauthorized = await app.inject({ method: 'GET', url: '/api/taleflick/v1/admin/shared/viewers?miniAppKey=storyshort', headers: { authorization: `Bearer ${currentToken}` } });
    assert.equal(unauthorized.statusCode, 403, unauthorized.body);
    const launchPath = '/api/taleflick/v1/admin/shared/viewers/storyshort-viewer/launches?miniAppKey=storyshort';
    assert.equal((await app.inject({ method: 'GET', url: launchPath, headers: { authorization: `Bearer ${currentToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: launchPath, headers })).statusCode, 200);

    const viewers = await app.inject({ method: 'GET', url: '/api/taleflick/v1/admin/shared/viewers?miniAppKey=storyshort&search=storyshort-open-id', headers });
    assert.equal(viewers.statusCode, 200, viewers.body);
    assert.equal(viewers.json().items[0].id, 'storyshort-viewer');
    assert.equal(viewers.json().items[0].miniAppKey, 'storyshort');

    const updated = await app.inject({ method: 'PATCH', url: '/api/taleflick/v1/admin/shared/viewers/app-entry-ad/batch', headers,
      payload: { miniAppKey: 'storyshort', userIds: ['storyshort-viewer'], appEntryAdExempt: true } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().count, 1);
    assert.equal((targetPrisma as any)._state.viewer.appEntryAdExempt, true);

    const crossOrganization = await app.inject({ method: 'GET', url: '/api/taleflick/v1/admin/shared/viewers?miniAppKey=crownrush', headers });
    assert.equal(crossOrganization.statusCode, 409, crossOrganization.body);
  });

  it('clears stale raw IPs after 30 days but retains exemptions and IPs with three visits', async () => {
    const app = await createTestApp();
    apps.push(app);
    const db = app.sharedPrisma;
    const secret = env.JWT_SECRET;
    const staleAt = new Date('2026-07-01T00:00:00.000Z');
    const addVisits = async (ipAddress: string, count: number, prefix: string) => {
      for (let index = 0; index < count; index++) {
        await recordSharedIpVisit(db, { ipAddress, miniAppKey: 'main', userId: `${prefix}-user-${index}`, clientSessionId: `${prefix}-${index}`, countryCode: null, secret });
      }
      const address = [...(db as any)._state.sharedIps.values()].find((item: any) => item.ipAddress === ipAddress);
      address.lastSeenAt = staleAt;
      for (const visit of (db as any)._state.sharedVisits.values()) if (visit.ipHash === address.ipHash) visit.createdAt = staleAt;
    };
    await addVisits('192.0.2.20', 2, 'short-lived');
    await addVisits('192.0.2.21', 1, 'exempt');
    await setEntryAdIpExemption(db, '192.0.2.21', 'keep', 'admin-1');
    await addVisits('192.0.2.22', 3, 'repeat');

    await cleanupSharedIps(db, new Date('2026-08-01T00:00:00.000Z'));

    const state = (db as any)._state;
    const shortLivedAddress = [...state.sharedIps.values()].find((item: any) => item.visitCount === 2);
    const exemptVisit = [...state.sharedVisits.values()].find((item: any) => item.userId.startsWith('exempt-user-'));
    const repeatVisit = [...state.sharedVisits.values()].find((item: any) => item.userId.startsWith('repeat-user-'));
    assert.equal(shortLivedAddress?.ipAddress, null);
    assert.equal([...state.sharedVisits.values()].filter((visit: any) => visit.ipHash === shortLivedAddress?.ipHash).length, 0);
    assert.equal(state.sharedIps.get(exemptVisit?.ipHash)?.ipAddress, '192.0.2.21');
    assert.equal(state.sharedIps.get(repeatVisit?.ipHash)?.ipAddress, '192.0.2.22');
    assert.equal([...state.sharedVisits.values()].filter((visit: any) => visit.userId.startsWith('repeat-user-')).length, 3);
    assert.equal([...state.sharedVisits.values()].filter((visit: any) => visit.userId.startsWith('exempt-user-')).length, 1);
  });

  it('lets an owner exempt a selected user from entry ads without affecting other ad flows', async () => {
    const app = await createTestApp();
    apps.push(app);
    const owner = { authorization: `Bearer ${await token(app, 'admin')}` };
    const viewer = { authorization: `Bearer ${await token(app, 'user')}` };
    const enabled = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: owner,
      payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, onUnavailable: 'ALLOW' } });
    assert.equal(enabled.statusCode, 200, enabled.body);
    const first = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer, payload: { launchId: '28be20a3-72fa-4f22-9da4-9a6d0563932f' } });
    assert.equal(first.json().required, true);
    const update = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/user-1/app-entry-ad', headers: owner, payload: { appEntryAdExempt: true } });
    assert.equal(update.statusCode, 200, update.body);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/viewers?search=user-1', headers: owner });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().items[0].appEntryAdExempt, true);
    const exempt = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer, payload: { launchId: 'bc0b327e-03fb-46d2-ae67-a25d9fe58b8b' } });
    assert.deepEqual(exempt.json(), { required: false });
    const restore = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/user-1/app-entry-ad', headers: owner, payload: { appEntryAdExempt: false } });
    assert.equal(restore.statusCode, 200);
    const resumed = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: viewer, payload: { launchId: '01cc8998-6433-43a6-83da-c8c3e781702a' } });
    assert.equal(resumed.json().required, true);
    const missing = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/absent/app-entry-ad', headers: owner, payload: { appEntryAdExempt: true } });
    assert.equal(missing.statusCode, 404);
    await app.prisma.adminUser.update({ where: { id: 'admin-1' }, data: { role: 'EDITOR' } });
    const editorWrite = await app.inject({ method: 'PATCH', url: '/api/v1/admin/viewers/user-1/app-entry-ad', headers: owner, payload: { appEntryAdExempt: true } });
    assert.equal(editorWrite.statusCode, 403);
    const editorList = await app.inject({ method: 'GET', url: '/api/v1/admin/viewers', headers: owner });
    assert.equal(editorList.statusCode, 403);
  });

  it('exchanges a TikTok login code, links the OpenID and stores OAuth credentials encrypted', async () => {
    const app = await createTestApp({ TIKTOK_CLIENT_KEY: 'test-client-key', TIKTOK_CLIENT_SECRET: 'test-client-secret' });
    apps.push(app);
    let requestBody: URLSearchParams | undefined;
    globalThis.fetch = async (input, init) => {
      assert.equal(new URL(String(input)).pathname, '/v2/oauth/token/');
      requestBody = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({
        access_token: 'sensitive-access-token', refresh_token: 'sensitive-refresh-token',
        expires_in: 3600, refresh_expires_in: 86_400, open_id: 'tiktok-open-id', scope: 'user.info.basic', token_type: 'Bearer'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/tiktok/session',
      headers: { authorization: `Bearer ${await token(app, 'user')}` },
      payload: { code: 'one-time-code-123', clientSessionId: 'session-test-0001', clientVersion: 'test' }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().viewer, { id: 'user-1', type: 'TIKTOK' });
    assert.equal(requestBody?.get('client_key'), 'test-client-key');
    assert.equal(requestBody?.get('client_secret'), 'test-client-secret');
    assert.equal(requestBody?.get('code'), 'one-time-code-123');
    const state = (app.prisma as any)._state;
    assert.equal(state.viewer.tiktokOpenId, 'tiktok-open-id');
    assert.equal(state.viewer.identityType, 'TIKTOK');
    assert.notEqual(state.credentials.get('user-1').accessTokenEncrypted, 'sensitive-access-token');
    assert.notEqual(state.credentials.get('user-1').refreshTokenEncrypted, 'sensitive-refresh-token');
    assert.doesNotMatch(response.body, /sensitive-access-token|sensitive-refresh-token|tiktok-open-id/);
  });

  it('records a completed playback session separately from watch progress', async () => {
    const app = await createTestApp();
    apps.push(app);
    let qualityWrites = 0;
    const qualityModel = (app.prisma as any).playbackQualityEvent;
    const createQualityEvent = qualityModel.create;
    qualityModel.create = async (...args: any[]) => { qualityWrites += 1; return createQualityEvent(...args); };
    for (const eventType of ['WAITING', 'DEFINITION_CHANGE']) {
      const diagnostic = await app.inject({
        method: 'POST',
        url: '/api/v1/playback-quality-events',
        headers: { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' },
        payload: { episodeId: 'episode-1', sessionId: 'playback-session-0001', eventType, currentTimeMs: 10_000 }
      });
      assert.equal(diagnostic.statusCode, 200, diagnostic.body);
      assert.deepEqual(diagnostic.json(), { accepted: true, dropped: true });
    }
    assert.equal(qualityWrites, 0);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/playback-quality-events',
      headers: { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' },
      payload: { episodeId: 'episode-1', sessionId: 'playback-session-0001', eventType: 'ENDED', currentTimeMs: 100_000 }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().accepted, true);
    assert.equal(qualityWrites, 1, 'episode completion telemetry remains persisted');
  });

  it('publishes component drafts and serves only the published version to the mini app', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const draft = await app.inject({ method: 'PATCH', url: '/api/v1/admin/ui-components/HOME_FEED', headers, payload: { enabled: false, page: 'HOME' } });
    assert.equal(draft.statusCode, 200);
    const beforePublish = await app.inject({ method: 'GET', url: '/api/v1/ui-components' });
    assert.equal(beforePublish.json().items.find((item: { key: string }) => item.key === 'HOME_FEED').enabled, true);
    const publish = await app.inject({ method: 'POST', url: '/api/v1/admin/ui-components/publish', headers });
    assert.equal(publish.statusCode, 200);
    const afterPublish = await app.inject({ method: 'GET', url: '/api/v1/ui-components' });
    assert.equal(afterPublish.json().items.find((item: { key: string }) => item.key === 'HOME_FEED').enabled, false);
    assert.equal(afterPublish.json().version, 1);
  });

  it('repairs legacy component draft fields while preserving recognized component switches', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.prisma.uiConfigVersion.create({
      data: {
        content: [{ key: 'HOME_FEED', page: 'LEGACY_HOME', enabled: false, config: ['obsolete'] }]
      }
    });

    const publish = await app.inject({ method: 'POST', url: '/api/v1/admin/ui-components/publish', headers });

    assert.equal(publish.statusCode, 200);
    assert.equal(publish.json().repairedLegacyContent, true);
    const feed = publish.json().items.find((item: { key: string }) => item.key === 'HOME_FEED');
    assert.deepEqual(feed, { key: 'HOME_FEED', page: 'HOME', enabled: false, config: null });
  });

  it('invalidates an administrator token after a password change', async () => {
    const app = await createTestApp();
    apps.push(app);
    const oldToken = await token(app, 'admin');
    const change = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/me/password',
      headers: { authorization: `Bearer ${oldToken}` },
      payload: { currentPassword: 'not-used', newPassword: 'a-new-test-password' }
    });
    assert.equal(change.statusCode, 200);
    const expired = await app.inject({ method: 'GET', url: '/api/v1/admin/albums', headers: { authorization: `Bearer ${oldToken}` } });
    assert.equal(expired.statusCode, 403);
  });

  it('enforces role permissions server-side and accepts explicit analytics dates', async () => {
    const app = await createTestApp();
    apps.push(app);
    await app.prisma.adminUser.update({ where: { id: 'admin-1' }, data: { role: 'ANALYST' } });
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const forbiddenWrite = await app.inject({ method: 'POST', url: '/api/v1/admin/albums', headers, payload: {} });
    assert.equal(forbiddenWrite.statusCode, 403);
    const analytics = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/audience?from=2026-09-01&to=2026-09-07&timezone=Asia%2FShanghai', headers });
    assert.equal(analytics.statusCode, 200);
    assert.equal(analytics.json().from, '2026-09-01');
    assert.equal(analytics.json().to, '2026-09-07');
    assert.equal(analytics.json().timezone, 'Asia/Shanghai');
  });

  it('caches the admin health summary and coalesces concurrent reads', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const url = '/api/v1/admin/analytics/health?minutes=30';
    const [first, concurrent] = await Promise.all([
      app.inject({ method: 'GET', url, headers }),
      app.inject({ method: 'GET', url, headers })
    ]);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(concurrent.statusCode, 200, concurrent.body);
    assert.equal((app.prisma as any)._state.healthQueryCalls.adFailureCount, 1);
    assert.equal((app.prisma as any)._state.healthQueryCalls.adFailureList, 1);

    const cached = await app.inject({ method: 'GET', url, headers });
    assert.equal(cached.statusCode, 200, cached.body);
    assert.equal((app.prisma as any)._state.healthQueryCalls.adFailureCount, 1);
    assert.equal((app.prisma as any)._state.healthQueryCalls.adFailureList, 1);
  });

  it('counts distinct audience users in SQL without returning user ID rows', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    prisma.appSession.findMany = async () => { throw new Error('Audience count must not fetch user ID rows'); };
    let countQueries = 0;
    prisma.$queryRaw = async (query: { strings: string[] }) => {
      if (query.strings.join('').includes('SELECT COUNT(DISTINCT "userId")')) {
        countQueries += 1;
        return [{ count: 7 }];
      }
      return [];
    };
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/analytics/audience?from=2026-09-01&to=2026-09-07',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(countQueries, 4);
    assert.deepEqual([response.json().activeUsers, response.json().dau, response.json().wau, response.json().mau], [7, 7, 7, 7]);
  });

  it('requires configured app-entry ad completions exactly once per launch', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const update = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/app-entry-ad-policy',
      headers: adminHeaders,
      payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, onUnavailable: 'ALLOW' }
    });
    assert.equal(update.statusCode, 200);
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '5da2f7b4-73fd-4d8e-a1b8-6c6dc03120ef';
    const start = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().requiredCount, 2);
    const sessionId = start.json().sessionId as string;
    for (const eventId of ['de0d4d84-f1e5-4a4d-b6b6-1de0124e1201', 'b124bec0-1af4-4dc6-aec6-98f1c0f77e4a']) {
      const premature = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: eventId, isEnded: true } });
      assert.equal(premature.statusCode, 409);
      assert.equal(premature.json().error.code, 'AD_NOT_ACKNOWLEDGED');
      const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId: eventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: eventId.startsWith('de0') ? 1 : 2 } });
      assert.equal(shown.statusCode, 200);
      const completed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: eventId, isEnded: true } });
      assert.equal(completed.statusCode, 200);
    }
    const repeatedLaunch = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(repeatedLaunch.statusCode, 200);
    assert.equal(repeatedLaunch.json().required, false);
  });

  it('keeps entry-ad policies independent by release while old clients use default', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}` };
    const legacyPolicy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'INTERSTITIAL', placementId: 'v5-entry', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(legacyPolicy.json().releaseId, 'default');
    const candidatePolicy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { releaseId: 'taletv-v6', enabled: false, mode: 'INTERSTITIAL', placementId: 'v6-entry', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(candidatePolicy.statusCode, 200);

    const legacyStart = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders, payload: { launchId: '7e553a3a-13c2-49dd-835d-65a7744be1c1' } });
    const candidateStart = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders, payload: { launchId: '7e553a3a-13c2-49dd-835d-65a7744be1c1', releaseId: 'taletv-v6' } });
    assert.equal(legacyStart.json().required, true);
    assert.equal(candidateStart.json().required, false);

    const enabledCandidate = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { releaseId: 'taletv-v6', enabled: true, mode: 'INTERSTITIAL', placementId: 'v6-entry', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(enabledCandidate.statusCode, 200);
    const approvedReleaseStart = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders, payload: { launchId: '7e553a3a-13c2-49dd-835d-65a7744be1c1', releaseId: 'taletv-v6' } });
    assert.equal(approvedReleaseStart.json().required, true);
    const unchangedLegacyPolicy = await app.inject({ method: 'GET', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders });
    assert.equal(unchangedLegacyPolicy.json().enabled, true);
    assert.equal(unchangedLegacyPolicy.json().placementId, 'v5-entry');
  });

  it('discovers a preview build and keeps its ad settings separate from the released build', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}` };
    const preview = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: '72211e1c-303f-4f95-b861-a0ff6aef0137', releaseId: 'main-review-v7' } });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().required, false);
    const list = await app.inject({ url: '/api/v1/admin/app-entry-ad-policies', headers: adminHeaders });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().items.map((item: { releaseId: string }) => item.releaseId), ['main-review-v7', 'default']);
    assert.equal(list.json().placementDefaults.INTERSTITIAL, env.APP_ENTRY_PLACEMENT_ID);
    const previewPolicy = await app.inject({ url: '/api/v1/admin/app-entry-ad-policy?releaseId=main-review-v7', headers: adminHeaders });
    assert.equal(previewPolicy.json().placementId, env.APP_ENTRY_PLACEMENT_ID);
    const configured = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders,
      payload: { releaseId: 'main-review-v7', enabled: true, mode: 'INTERSTITIAL', placementId: 'review-placement', requiredCount: 2, onUnavailable: 'ALLOW' } });
    assert.equal(configured.statusCode, 200);
    const reviewLaunch = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: '0d6815d9-d7b8-44dd-a95d-e0c79ba951bc', releaseId: 'main-review-v7' } });
    assert.equal(reviewLaunch.json().placementId, 'review-placement');
    assert.equal(reviewLaunch.json().requiredCount, 2);
    const releasedLaunch = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: '256c629e-f8ba-4aa2-b0f2-34a04383c1c5' } });
    assert.equal(releasedLaunch.json().required, false);
  });

  it('stores Portal status separately from each code version ad policy', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const userHeaders = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers: userHeaders,
      payload: { launchId: '72211e1c-303f-4f95-b861-a0ff6aef0138', releaseId: 'main-review-v7' } });
    const before = await app.inject({ url: '/api/v1/admin/app-entry-ad-policies', headers: adminHeaders });
    assert.equal(before.json().items.find((item: any) => item.releaseId === 'main-review-v7').portalStatus, 'UNKNOWN');
    const saved = await app.inject({ method: 'PATCH', url: '/api/v1/admin/app-entry-ad-releases/main-review-v7', headers: adminHeaders,
      payload: { portalVersion: 'Version 7', portalStatus: 'IN_REVIEW' } });
    assert.equal(saved.statusCode, 200);
    const after = await app.inject({ url: '/api/v1/admin/app-entry-ad-policies', headers: adminHeaders });
    assert.deepEqual(after.json().items.find((item: any) => item.releaseId === 'main-review-v7'),
      { ...before.json().items.find((item: any) => item.releaseId === 'main-review-v7'), portalVersion: 'Version 7', portalStatus: 'IN_REVIEW' });
    const missing = await app.inject({ method: 'PATCH', url: '/api/v1/admin/app-entry-ad-releases/main-missing', headers: adminHeaders,
      payload: { portalVersion: 'Version 8', portalStatus: 'RELEASED' } });
    assert.equal(missing.statusCode, 404);
  });

  it('replays the current entry ad on an early close in completed mode', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const policy = await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 1, onUnavailable: 'ALLOW' } });
    assert.equal(policy.statusCode, 200);
    assert.equal(policy.json().countMode, 'COMPLETED');
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const start = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: 'e2c11116-0563-4ac0-a971-c5819d2058cc' } });
    const sessionId = start.json().sessionId as string;
    assert.equal(start.json().countMode, 'COMPLETED');
    const firstEventId = 'fc404158-ef01-491b-87c5-2eeae259aa80';
    const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId: firstEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(shown.statusCode, 200);
    const closed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: firstEventId, isEnded: false } });
    assert.equal(closed.statusCode, 200);
    assert.equal(closed.json().completedCount, 0);
    assert.equal(closed.json().retryCurrent, true);
    const repeatedClose = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: firstEventId, isEnded: false } });
    assert.equal(repeatedClose.statusCode, 200);
    assert.equal(repeatedClose.json().completedCount, 0);
    const replay = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: firstEventId, isEnded: true } });
    assert.equal(replay.statusCode, 409);
    const replayShown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId: firstEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(replayShown.statusCode, 409);
    const secondEventId = '243150fb-1078-4d0e-a7f6-c1d7bb037d4c';
    const shownAgain = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId: secondEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(shownAgain.statusCode, 200);
    const completed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: secondEventId, isEnded: true } });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().shouldContinue, false);
  });

  it('counts shown impressions atomically and idempotently without waiting for close completion', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: '2d734801-9f3d-4427-9d13-f893b2b9e8d0' } });
    const sessionId = started.json().sessionId as string;
    const firstId = '6bf5a3e1-9e6b-40ba-a4cc-d5c6f8b0e120';
    const completionModel = (app.prisma as any).appEntryAdCompletion;
    const createCompletion = completionModel.create;
    let completionWrites = 0;
    completionModel.create = async (args: unknown) => { completionWrites += 1; return createCompletion(args); };
    const first = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: firstId, adIndex: 1 } });
    assert.equal(first.statusCode, 200, first.body);
    assert.match(String(first.headers['server-timing']), /db;dur=/);
    assert.equal(first.json().completedCount, 1);
    assert.equal(first.json().shouldContinue, true);
    const duplicate = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: '4091907e-17c4-4999-9cbe-27f9a6876334', adIndex: 1 } });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(duplicate.json().completedCount, 1);
    const wrongIndex = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: '9ae88250-1f83-46af-a808-ade9742e9235', adIndex: 3 } });
    assert.equal(wrongIndex.statusCode, 409);
    const second = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: 'eb2d536a-2cc7-405a-b4cc-66dab238515e', adIndex: 2 } });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().completedCount, 2);
    assert.equal(second.json().shouldContinue, false);
    assert.equal(completionWrites, 0);
    assert.equal((await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } }))!.status, 'COMPLETED');
  });

  it('accepts legacy SHOWN-mode incomplete-close events without an extra completion lookup', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 1, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: '9051c9d2-26c0-4b83-bde1-38d5072e8864' } });
    const sessionId = started.json().sessionId as string;
    const shown = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: 'dbac9cca-8146-466a-894b-0417f11e8c60', adIndex: 1 } });
    assert.equal(shown.statusCode, 200, shown.body);
    assert.equal(shown.json().shouldContinue, false);

    const completionModel = (app.prisma as any).appEntryAdCompletion;
    const findUnique = completionModel.findUnique;
    let completionLookups = 0;
    completionModel.findUnique = async (...args: any[]) => {
      completionLookups += 1;
      return findUnique(...args);
    };
    const closed = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: {
      clientEventId: 'b5d261a1-3876-43f0-ae57-5e02e76e89be', adType: 'REWARDED', scope: 'APP_ENTRY',
      eventType: 'CLOSED_INCOMPLETE', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1
    } });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.deepEqual(closed.json(), { accepted: true, dropped: true });
    assert.equal(completionLookups, 0);
    await waitForSharedIpVisits();
  });

  it('treats concurrent shown acknowledgements for the same ad index as idempotent', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: '4a9b10ba-cd5a-488c-bfeb-e836cd5f54bf' } });
    const sessionId = started.json().sessionId as string;
    const completionModel = (app.prisma as any).appEntryAdCompletion;
    const createCompletion = completionModel.create;
    let completionWrites = 0;
    completionModel.create = async (args: unknown) => { completionWrites += 1; return createCompletion(args); };
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: '54d65cf1-59eb-488d-a965-2f6f4c513bde', adIndex: 1 } }),
      app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/shown`, headers, payload: { clientEventId: 'a4f2d4b1-4d8a-4817-a69c-c4ee4d5072fb', adIndex: 1 } })
    ]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 200]);
    assert.equal((await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } }))!.completedCount, 1);
    assert.equal(await (app.prisma as any).adEvent.count(), 0);
    assert.equal(completionWrites, 0);
  });

  it('counts three closed entry ads in shown mode and preserves the session policy snapshot', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 3, countMode: 'SHOWN', onUnavailable: 'ALLOW' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '84085b67-3e4d-4467-93c9-4ebd0859edaa';
    const start = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(start.json().countMode, 'SHOWN');
    const sessionId = start.json().sessionId as string;
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 1, countMode: 'COMPLETED', onUnavailable: 'ALLOW' } });
    const resumed = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(resumed.json().countMode, 'SHOWN');
    assert.equal(resumed.json().requiredCount, 3);
    const ids = ['4cdde205-78bc-4c53-9af2-3c67952d8121', 'e7e38eea-f756-49cf-8439-1863350d7190', 'ab037ca6-3b28-4118-adc0-65d75065d8d1'];
    for (const [index, clientEventId] of ids.entries()) {
      const premature = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: false } });
      assert.equal(premature.statusCode, 409);
      const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: index + 1 } });
      assert.equal(shown.statusCode, 200);
      const closed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: false } });
      assert.equal(closed.statusCode, 200);
      assert.equal(closed.json().completedCount, index + 1);
      assert.equal(closed.json().shouldContinue, index < 2);
      const duplicate = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: false } });
      assert.equal(duplicate.statusCode, 200);
      assert.equal(duplicate.json().completedCount, index + 1);
    }
    const finished = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(finished.json().required, false);
  });

  it('keeps an active entry session alive as ads are requested and confirmed', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '1a86b45f-d399-464d-a2f9-a612d2035794';
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    const sessionId = started.json().sessionId as string;
    await app.prisma.appEntryAdSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 1000) } });
    const firstEventId = '69921855-2d74-4bc5-b566-97fd6017c2e3';
    const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId: firstEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(shown.statusCode, 200);
    const renewed = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
    assert.ok(renewed!.expiresAt.getTime() > Date.now() + 14 * 60 * 1000);
    const completed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId: firstEventId, isEnded: true } });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().completedCount, 1);
    const afterCompletion = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
    assert.ok(afterCompletion!.expiresAt.getTime() > Date.now() + 14 * 60 * 1000);
  });

  it('coalesces concurrent starts for the same app-entry launch', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '8f1bf9e1-4a5e-4aa0-83b2-96557dc96f11';
    const sessionModel = app.prisma.appEntryAdSession as any;
    const findUnique = sessionModel.findUnique.bind(sessionModel);
    let sessionReads = 0;
    sessionModel.findUnique = async (...args: any[]) => {
      sessionReads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return findUnique(...args);
    };

    const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject({
      method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId }
    })));

    assert.deepEqual(responses.map((response) => response.statusCode), Array(8).fill(200));
    assert.equal(new Set(responses.map((response) => response.json().sessionId)).size, 1);
    assert.equal(sessionReads, 1);
  });

  it('does not rewrite an entry session for failure telemetry while it is still fresh', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'COMPLETED', onUnavailable: 'ALLOW' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: '8c1d76b7-b5e9-47d3-8fd3-7aa1b7a0e2dd' } });
    const sessionId = started.json().sessionId as string;
    const freshExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await app.prisma.appEntryAdSession.update({ where: { id: sessionId }, data: { expiresAt: freshExpiry } });
    const failure = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: {
      clientEventId: '6e5b25af-1dd4-4f38-b0cb-e50dc17a7a72', adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'FAILED',
      placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1, errorCode: '11006'
    } });
    assert.equal(failure.statusCode, 200, failure.body);
    const afterFailure = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
    assert.equal(afterFailure!.expiresAt.getTime(), freshExpiry.getTime());
  });

  it('treats a second confirmed impression for the same ad index as idempotent', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '37a0c4eb-4a47-49c4-8f59-136969812126';
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    const sessionId = started.json().sessionId as string;
    const firstEventId = '1c77bb69-e660-4301-83c8-d6f53a3de801';
    const duplicateEventId = '4091907e-17c4-4999-9cbe-27f9a6876334';
    for (const clientEventId of [firstEventId, duplicateEventId]) {
      const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
      assert.equal(shown.statusCode, 200);
      const completed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: true } });
      assert.equal(completed.statusCode, 200, completed.body);
      assert.equal(completed.json().completedCount, 1);
      assert.equal(completed.json().shouldContinue, true);
    }
    const session = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
    assert.equal(session!.completedCount, 1);
  });

  it('retries entry-ad completion after a Prisma serialization conflict', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 1, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId: '1ca2994c-7cda-440f-ac92-366ac8bb17fa' } });
    const sessionId = started.json().sessionId as string;
    const clientEventId = '2aa3bf2e-8a50-4e0a-81e0-a1dace7d13f4';
    const shown = await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    assert.equal(shown.statusCode, 200);

    const prisma = app.prisma as any;
    const transaction = prisma.$transaction.bind(prisma);
    let conflicts = 2;
    prisma.$transaction = async (callback: (tx: typeof prisma) => Promise<unknown>, options?: unknown) => {
      if (conflicts-- > 0) throw new Prisma.PrismaClientKnownRequestError('serialization conflict', { code: 'P2034', clientVersion: '6.19.1' });
      return transaction(callback, options);
    };
    const completed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: true } });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json().completedCount, 1);
    assert.equal(conflicts, -1);
  });

  it('renews an expired unfinished app-entry session for the same launch', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'INTERSTITIAL', placementId: 'entry-interstitial', requiredCount: 1, onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '20d0846e-441d-4c12-9d32-bcf8f876734b';
    const first = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    const sessionId = first.json().sessionId as string;
    await app.prisma.appEntryAdSession.update({ where: { id: sessionId }, data: { status: 'EXPIRED', expiresAt: new Date(0) } });
    const resumed = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().sessionId, sessionId);
    assert.equal(resumed.json().completedCount, 0);
    assert.equal(resumed.json().required, true);
  });

  it('preserves the counted progress and policy snapshot when an unfinished entry session expires', async () => {
    const app = await createTestApp();
    apps.push(app);
    const adminHeaders = { authorization: `Bearer ${await token(app, 'admin')}` };
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'REWARDED_GATED', placementId: 'entry-rewarded', requiredCount: 2, countMode: 'SHOWN', onUnavailable: 'BLOCK' } });
    const headers = { authorization: `Bearer ${await token(app, 'user')}` };
    const launchId = '385fc614-b274-4718-ac59-477035260bf2';
    const started = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    const sessionId = started.json().sessionId as string;
    const clientEventId = '80630ff9-af43-42f7-8758-b93416012c85';
    await app.inject({ method: 'POST', url: '/api/v1/ad-events', headers, payload: { clientEventId, adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: 'entry-rewarded', sessionId, appEntrySessionId: sessionId, adIndex: 1 } });
    const closed = await app.inject({ method: 'POST', url: `/api/v1/app-entry-ad-sessions/${sessionId}/complete`, headers, payload: { clientEventId, isEnded: false } });
    assert.equal(closed.json().completedCount, 1);
    await app.prisma.appEntryAdSession.update({ where: { id: sessionId }, data: { status: 'EXPIRED', expiresAt: new Date(0) } });
    await app.inject({ method: 'PUT', url: '/api/v1/admin/app-entry-ad-policy', headers: adminHeaders, payload: { enabled: true, mode: 'INTERSTITIAL', placementId: 'new-placement', requiredCount: 1, countMode: 'COMPLETED', onUnavailable: 'BLOCK' } });
    const resumed = await app.inject({ method: 'POST', url: '/api/v1/app-entry-ad-sessions', headers, payload: { launchId } });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().completedCount, 1);
    assert.equal(resumed.json().requiredCount, 2);
    assert.equal(resumed.json().countMode, 'SHOWN');
    assert.equal(resumed.json().placementId, 'entry-rewarded');
  });

  it('separates user and admin tokens', async () => {
    const app = await createTestApp();
    apps.push(app);
    const userResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/albums',
      headers: { authorization: `Bearer ${await token(app, 'user')}` }
    });
    assert.equal(userResponse.statusCode, 403);

    const adminResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/albums',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` }
    });
    assert.equal(adminResponse.statusCode, 200);
  });

  it('does not allow synced or non-draft dramas to be deleted', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/albums/album-1',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` }
    });
    assert.equal(response.statusCode, 409);
  });

  it('appends episodes to the selected album without changing its access policy', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const payload = { episodes: [{ episodeNo: 4, title: '第 4 集', sortOrder: 4, isFree: false }] };
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/albums/album-1/episodes/batch', headers, payload });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().album.accessConfig.freeEpisodeCount, 0);
    assert.equal(created.json().episodes[0].episodeNo, 4);
    assert.equal(created.json().episodes[0].status, 'DRAFT');
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/admin/albums/album-1/episodes/batch', headers, payload: { episodes: [{ episodeNo: 1, title: 'Duplicate' }] } });
    assert.equal(duplicate.statusCode, 409);
  });

  it('rejects a local upload when another task already owns the episode', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    prisma.episode.findUnique = async () => ({ id: 'episode-1', episodeNo: 1, byteplusVid: null, byteplusUploadStatus: 'FAILED', coverAsset: null, album: { title: 'Test Drama', status: 'DRAFT' } });
    prisma.episode.updateMany = async () => ({ count: 0 });
    prisma.uploadJob.create = async () => { throw new Error('must not create a competing upload job'); };
    const boundary = 'upload-test-boundary';
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/upload-jobs/local',
      headers: { authorization: `Bearer ${await token(app, 'admin')}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="episodeId"\r\n\r\nepisode-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="episode.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo-data\r\n--${boundary}--\r\n`)
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error.message, /其他上传任务/);
  });

  it('filters upload jobs to the selected drama', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    prisma.uploadJob.findMany = async ({ where, take, orderBy }: any) => {
      assert.deepEqual(where, { episode: { albumId: 'album-1' } });
      assert.equal(take, 200);
      assert.deepEqual(orderBy, { createdAt: 'desc' });
      return [{ id: 'job-1', episodeId: 'episode-1', status: 'PENDING' }];
    };
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/upload-jobs?albumId=album-1',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items[0].id, 'job-1');
  });

  it('limits upload jobs for the overview without changing the default list', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    const limits: number[] = [];
    prisma.uploadJob.findMany = async ({ take }: { take: number }) => { limits.push(take); return []; };
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const recent = await app.inject({ method: 'GET', url: '/api/v1/admin/upload-jobs?limit=5', headers });
    const all = await app.inject({ method: 'GET', url: '/api/v1/admin/upload-jobs', headers });
    assert.equal(recent.statusCode, 200, recent.body);
    assert.equal(all.statusCode, 200, all.body);
    assert.deepEqual(limits, [5, 100]);
  });

  it('does not release a recent or identified BytePlus upload', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    const job: any = { id: 'job-1', episodeId: 'episode-1', sourceType: 'FILE', status: 'PROCESSING', providerJobId: null, startedAt: new Date() };
    prisma.uploadJob.findUnique = async () => job;
    prisma.uploadJob.updateMany = async () => { throw new Error('must not release the task'); };
    const headers = { authorization: `Bearer ${await token(app, 'admin')}` };
    const request = () => app.inject({ method: 'POST', url: '/api/v1/admin/upload-jobs/job-1/release', headers, payload: { confirmation: 'NO_BYTEPLUS_MEDIA' } });
    assert.equal((await request()).statusCode, 409);
    job.startedAt = new Date(Date.now() - 3 * 60 * 60_000);
    job.providerJobId = 'vid-1';
    assert.equal((await request()).statusCode, 409);
  });

  it('resumes only the requested upload immediately instead of waiting for the worker batch', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    const job = { id: 'job-1', sourceType: 'FILE', status: 'PROCESSING', leaseToken: null, leaseExpiresAt: null };
    prisma.uploadJob.findUnique = async () => job;
    let requestedId: string | undefined;
    prisma.uploadJob.findMany = async ({ where }: any) => { requestedId = where.id; return []; };
    prisma.uploadJob.updateMany = async ({ where }: any) => {
      assert.equal(where.leaseToken, null);
      assert.equal(where.leaseExpiresAt, null);
      return { count: 1 };
    };
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/upload-jobs/job-1/reconcile',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: {} });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().processing, 'QUEUED');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requestedId, 'job-1');
  });

  it('reports an active upload without resetting its lease or starting another transfer', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    prisma.uploadJob.findUnique = async () => ({ id: 'job-1', sourceType: 'FILE', status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 120_000) });
    prisma.uploadJob.updateMany = async () => { throw new Error('An active upload must not be reset'); };
    prisma.uploadJob.findMany = async () => { throw new Error('An active upload must not be restarted'); };
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/upload-jobs/job-1/reconcile',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: {} });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().processing, 'ACTIVE');
  });

  it('rejects resume when another process changed the task', async () => {
    const app = await createTestApp();
    apps.push(app);
    const prisma = app.prisma as any;
    prisma.uploadJob.findUnique = async () => ({ id: 'job-1', sourceType: 'FILE', status: 'PROCESSING', leaseToken: null, leaseExpiresAt: null });
    prisma.uploadJob.updateMany = async () => ({ count: 0 });
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/upload-jobs/job-1/reconcile',
      headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: {} });
    assert.equal(response.statusCode, 409);
  });

  it('rejects reconciliation with media from another BytePlus space', async () => {
    const app = await createTestApp();
    apps.push(app);
    (app.prisma as any).uploadJob.findUnique = async () => ({
      id: 'job-1', episodeId: 'episode-1', sourceType: 'FILE', status: 'PROCESSING', providerJobId: null,
      episode: { byteplusVid: null, coverAsset: null, album: { title: 'Test Drama' } }
    });
    const original = BytePlusVodService.prototype.getMediaInfos;
    BytePlusVodService.prototype.getMediaInfos = async () => [{ vid: 'vid-1', spaceName: 'different-space', title: 'Episode 1' }];
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/admin/upload-jobs/job-1/reconcile',
        headers: { authorization: `Bearer ${await token(app, 'admin')}` }, payload: { byteplusVid: 'vid-1' }
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error.code, 'BYTEPLUS_SPACE_MISMATCH');
    } finally {
      BytePlusVodService.prototype.getMediaInfos = original;
    }
  });

  it('logs administrators in with a password hash and returns an admin token', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { email: 'operator@example.com', password: 'not-used' }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.json().accessToken, 'string');
    assert.equal(response.json().admin.role, 'OWNER');
  });

  it('requires isEnded and makes rewarded unlock idempotent', async () => {
    const app = await createTestApp();
    apps.push(app);
    const authorization = { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' };
    const start = await app.inject({ method: 'POST', url: '/api/v1/episodes/episode-1/reward-session', headers: authorization, payload: {} });
    const sessionId = start.json().sessionId as string;
    const incomplete = await app.inject({
      method: 'POST',
      url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
      headers: authorization,
      payload: { clientEventId: 'event-1', isEnded: false }
    });
    assert.equal(incomplete.statusCode, 400);

    const withoutShown = await app.inject({
      method: 'POST',
      url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
      headers: authorization,
      payload: { clientEventId: 'event-1', isEnded: true }
    });
    assert.equal(withoutShown.statusCode, 409);

    const shown = await app.inject({
      method: 'POST',
      url: '/api/v1/ad-events',
      headers: authorization,
      payload: { clientEventId: 'event-1', adType: 'REWARDED', eventType: 'SHOWN', placementId: 'rewarded_episode_unlock', episodeId: 'episode-1', sessionId, rewardSessionId: sessionId, adIndex: 1 }
    });
    assert.equal(shown.statusCode, 200);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
      headers: authorization,
      payload: { clientEventId: 'event-1', isEnded: true }
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
      headers: authorization,
      payload: { clientEventId: 'event-1', isEnded: true }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
  });

  it('requires every configured rewarded completion before granting an unlock', async () => {
    const app = await createTestApp();
    apps.push(app);
    const headers = { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' };
    const start = await app.inject({ method: 'POST', url: '/api/v1/episodes/episode-1/reward-session', headers, payload: {} });
    assert.equal(start.statusCode, 200);
    const sessionId = start.json().sessionId as string;

    for (const [index, expectedAccess] of ['REWARDED_AD_REQUIRED', 'REWARDED_AD_REQUIRED', 'PLAYABLE'].entries()) {
      const eventId = `three-step-${index + 1}`;
      const shown = await app.inject({
        method: 'POST',
        url: '/api/v1/ad-events',
        headers,
        payload: { clientEventId: eventId, adType: 'REWARDED', eventType: 'SHOWN', placementId: 'rewarded_episode_unlock', episodeId: 'episode-1', sessionId, rewardSessionId: sessionId, adIndex: index + 1 }
      });
      assert.equal(shown.statusCode, 200);
      const complete = await app.inject({
        method: 'POST',
        url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
        headers,
        payload: { clientEventId: eventId, isEnded: true }
      });
      assert.equal(complete.statusCode, 200);
      assert.equal(complete.json().access, expectedAccess);
      assert.equal(complete.json().shouldContinue, index < 2);
    }

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/episodes/episode-1/reward-session/${sessionId}/complete`,
      headers,
      payload: { clientEventId: 'three-step-3', isEnded: true }
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().access, 'PLAYABLE');
  });

  it('rejects playback progress past the online episode duration', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/watch-progress',
      headers: { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' },
      payload: { episodeId: 'episode-1', positionMs: 100_001, durationMs: 100_000, completed: false }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  });
});
