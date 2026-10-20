import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import type { Env } from './config/env';
import { hashPassword } from './services/password';
import { BytePlusVodService } from './services/byteplus-vod.service';
import { uploadScope, uploadTags } from './services/local-upload.service';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MINI_APP_KEY: 'main',
  API_CORS_ORIGIN: 'http://localhost:5173',
  TRUSTED_PROXY_CIDRS: '',
  TRUST_GEO_COUNTRY_HEADER: true,
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
    viewer: { id: 'user-1', identityType: 'ANONYMOUS', tiktokOpenId: null as string | null, visitorKeyHash: null as string | null, createdAt: new Date(), updatedAt: new Date() },
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
      findFirst: async (args: { where: { userId: string; episodeId: string; status: string } }) => Array.from(state.rewardSessions.values()).find((session) => session.userId === args.where.userId && session.episodeId === args.where.episodeId && session.status === args.where.status) ?? null,
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
        const event = { id: `ad-event-${state.adEvents.size + 1}`, ...args.data };
        state.adEvents.set(`${event.userId}:${event.clientEventId}`, event);
        return event;
      },
      count: async () => state.adEvents.size
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
    user: {
      upsert: async () => ({ id: 'user-1', identityType: 'ANONYMOUS', tiktokOpenId: 'open-1', createdAt: new Date() }),
      findUnique: async ({ where }: any) => where.id ? (where.id === state.viewer.id ? state.viewer : null) : where.tiktokOpenId === state.viewer.tiktokOpenId ? state.viewer : null,
      findUniqueOrThrow: async () => state.viewer,
      update: async ({ data }: any) => Object.assign(state.viewer, data),
      delete: async () => state.viewer,
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
      findMany: async () => []
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
      }
    },
    appEntryAdCompletion: {
      findUnique: async (args: any) => {
        const unique = args.where.sessionId_clientEventId;
        if (unique) return state.entryCompletions.get(`${unique.sessionId}:${unique.clientEventId}`) ?? null;
        const byIndex = args.where.sessionId_adIndex;
        return state.entryCompletions.get(`${byIndex.sessionId}:index:${byIndex.adIndex}`) ?? null;
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
    uploadJob: { findMany: async () => [], findUnique: async () => null, findFirst: async () => null, create: async () => ({ id: 'job-1' }), updateMany: async () => ({ count: 1 }) },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    $queryRaw: async () => [{ '?column?': 1 }]
  };
  return prisma;
}

async function createTestApp(envOverrides: Partial<Env> = {}) {
  const prisma = await createPrismaStub();
  const app = await buildApp({ ...env, ...envOverrides }, { prisma: prisma as unknown as PrismaClient, ...(envOverrides.TALETV_DATABASE_URL ? { taletvPrisma: prisma as unknown as PrismaClient } : {}) });
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
    while (apps.length) await apps.pop()!.close();
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
    assert.equal(allowedRootDomain.statusCode, 204);
    assert.equal(allowedRootDomain.headers['access-control-allow-origin'], 'https://tiktok.com');
    assert.equal(allowedMiniRuntime.statusCode, 204);
    assert.equal(allowedMiniRuntime.headers['access-control-allow-origin'], 'https://minis-example-preview.tiktok-minis.us');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('serves public home and search without authentication', async () => {
    const app = await createTestApp();
    apps.push(app);
    const home = await app.inject({ method: 'GET', url: '/api/v1/home', headers: { 'x-geo-country': 'US' } });
    assert.equal(home.statusCode, 200);
    assert.equal(home.json().feed.items[0].title, 'Test Drama');

    const search = await app.inject({ method: 'GET', url: '/api/v1/search?q=test' });
    assert.equal(search.statusCode, 200);
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

  it('exchanges a TikTok login code and stores encrypted credentials on the viewer', async () => {
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
    assert.equal(state.viewer.tiktokOpenId, 'tiktok-open-id');
    assert.equal(state.viewer.identityType, 'TIKTOK');
    assert.notEqual(state.credentials.get('user-1').accessTokenEncrypted, 'sensitive-access-token');
    assert.notEqual(state.credentials.get('user-1').refreshTokenEncrypted, 'sensitive-refresh-token');
    assert.doesNotMatch(response.body, /sensitive-access-token|sensitive-refresh-token|tiktok-open-id/);
  });

  it('records a completed playback session separately from watch progress', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/playback-quality-events',
      headers: { authorization: `Bearer ${await token(app, 'user')}`, 'x-geo-country': 'US' },
      payload: { episodeId: 'episode-1', sessionId: 'playback-session-0001', eventType: 'ENDED', currentTimeMs: 100_000 }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().accepted, true);
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
