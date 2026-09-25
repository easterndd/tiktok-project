import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import type { Env } from './config/env';
import { hashPassword } from './services/password';
import { BytePlusVodService } from './services/byteplus-vod.service';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  MINI_APP_KEY: 'main',
  API_CORS_ORIGIN: 'http://localhost:5173',
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
    entryPolicy: null as any,
    shareCount: 0,
    admin: { id: 'admin-1', email: 'operator@example.com', passwordHash: '', role: 'OWNER', status: 'ACTIVE', tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() }
  };
  const adminPasswordHash = await hashPassword('not-used');
  state.admin.passwordHash = adminPasswordHash;
  const prisma: any = {
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
      create: async () => ({ id: 'ad-event-1' }),
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
      findUniqueOrThrow: async () => ({ id: 'user-1', tiktokOpenId: 'open-1', createdAt: new Date() }),
      count: async () => 1
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
      findUnique: async () => state.entryPolicy,
      upsert: async (args: any) => {
        state.entryPolicy = { ...(state.entryPolicy ?? args.create), ...args.update, id: 'default' };
        return state.entryPolicy;
      }
    },
    appEntryAdSession: {
      findUnique: async (args: any) => {
        if (args.where.id) return state.entrySessions.get(args.where.id) ?? null;
        const key = `${args.where.userId_launchId.userId}:${args.where.userId_launchId.launchId}`;
        return state.entrySessions.get(key) ?? null;
      },
      findUniqueOrThrow: async (args: any) => state.entrySessions.get(args.where.id),
      create: async (args: any) => {
        const session = { id: `entry-session-${state.entrySessions.size + 1}`, completedCount: 0, status: 'ACTIVE', ...args.data };
        state.entrySessions.set(session.id, session);
        state.entrySessions.set(`${session.userId}:${session.launchId}`, session);
        return session;
      },
      update: async (args: any) => {
        const session = { ...state.entrySessions.get(args.where.id), ...args.data };
        state.entrySessions.set(session.id, session);
        state.entrySessions.set(`${session.userId}:${session.launchId}`, session);
        return session;
      }
    },
    appEntryAdCompletion: {
      findUnique: async (args: any) => state.entryCompletions.get(`${args.where.sessionId_clientEventId.sessionId}:${args.where.sessionId_clientEventId.clientEventId}`) ?? null,
      create: async (args: any) => {
        const completion = { id: `entry-completion-${state.entryCompletions.size + 1}`, ...args.data };
        state.entryCompletions.set(`${completion.sessionId}:${completion.clientEventId}`, completion);
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
    uploadJob: { findMany: async () => [], findUnique: async () => null, create: async () => ({ id: 'job-1' }) },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    $queryRaw: async () => [{ '?column?': 1 }]
  };
  return prisma;
}

async function createTestApp(envOverrides: Partial<Env> = {}) {
  const prisma = await createPrismaStub();
  const app = await buildApp({ ...env, ...envOverrides }, { prisma: prisma as unknown as PrismaClient });
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
