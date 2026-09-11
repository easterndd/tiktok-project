import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import type { Env } from './config/env';
import { hashPassword } from './services/password';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  API_CORS_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
  TIKTOK_CLIENT_KEY: 'test-client-key',
  TIKTOK_CLIENT_SECRET: 'test-client-secret',
  TIKTOK_OAUTH_TOKEN_URL: 'https://example.com/oauth/token',
  TIKTOK_USER_INFO_URL: 'https://example.com/user/info',
  TIKTOK_REDIRECT_URI: undefined,
  USER_JWT_EXPIRES_IN: 3_600,
  ADMIN_JWT_EXPIRES_IN: 28_800,
  ADMIN_BOOTSTRAP_EMAIL: undefined,
  ADMIN_BOOTSTRAP_PASSWORD: undefined,
  BYTEPLUS_ACCOUNT_ID: 'test-account',
  BYTEPLUS_SPACE_NAME: 'test-space',
  BYTEPLUS_REGION: 'test-region',
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
    regions: null,
    status: 'ONLINE',
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
    adEvents: new Map<string, { episodeId: string; adType: string; eventType: string }>(),
    shareCount: 0
  };
  const adminPasswordHash = await hashPassword('not-used');
  const prisma: any = {
    album: {
      findMany: async () => [album],
      findFirst: async () => ({ ...album, likes: [], favorites: [] }),
      findUnique: async () => album,
      create: async (args: { data: unknown }) => ({ ...album, ...(args.data as object) }),
      update: async () => album,
      count: async () => 1
    },
    episode: {
      findMany: async () => [episode],
      findFirst: async () => episode,
      findUnique: async () => episode,
      create: async () => episode,
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
    adEvent: {
      upsert: async (args: { where: { userId_clientEventId: { userId: string; clientEventId: string } }; create: { episodeId: string; adType: string; eventType: string } }) => {
        const key = `${args.where.userId_clientEventId.userId}:${args.where.userId_clientEventId.clientEventId}`;
        const existing = state.adEvents.get(key);
        if (existing) return existing;
        const event = { episodeId: args.create.episodeId, adType: args.create.adType, eventType: args.create.eventType };
        state.adEvents.set(key, event);
        return event;
      },
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
      upsert: async () => ({ id: 'user-1', tiktokOpenId: 'open-1', createdAt: new Date() }),
      findUniqueOrThrow: async () => ({ id: 'user-1', tiktokOpenId: 'open-1', createdAt: new Date() }),
      count: async () => 1
    },
    userPreference: {
      upsert: async () => ({ locale: 'en', autoplay: true, reducedData: false }),
      findUnique: async () => null
    },
    adminUser: {
      findUnique: async () => ({ id: 'admin-1', email: 'operator@example.com', passwordHash: adminPasswordHash, role: 'OWNER' })
    },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
    homeBlock: { findMany: async () => [] },
    uiComponent: { findMany: async () => [], upsert: async () => ({ key: 'HOME_FEED', page: 'HOME', enabled: true, config: null }) },
    genre: { findMany: async () => [], create: async () => ({ id: 'genre-1' }), update: async () => ({ id: 'genre-1' }) },
    playbackQualityEvent: { create: async () => ({ id: 'quality-1' }), groupBy: async () => [] },
    adRevenue: { findMany: async () => [], upsert: async () => ({ id: 'revenue-1' }) },
    uploadJob: { findMany: async () => [], findUnique: async () => null, create: async () => ({ id: 'job-1' }) },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma)
  };
  return prisma;
}

async function createTestApp() {
  const prisma = await createPrismaStub();
  const app = await buildApp(env, { prisma: prisma as unknown as PrismaClient });
  await app.ready();
  return app;
}

async function token(app: Awaited<ReturnType<typeof createTestApp>>, kind: 'user' | 'admin') {
  return app.jwt.sign({ sub: kind === 'user' ? 'user-1' : 'admin-1', kind });
}

describe('QuicK ReeLS API', () => {
  const apps: Awaited<ReturnType<typeof createTestApp>>[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    while (apps.length) await apps.pop()!.close();
  });

  it('serves public home and search without authentication', async () => {
    const app = await createTestApp();
    apps.push(app);
    const home = await app.inject({ method: 'GET', url: '/api/v1/home' });
    assert.equal(home.statusCode, 200);
    assert.equal(home.json().feed.items[0].title, 'Test Drama');

    const search = await app.inject({ method: 'GET', url: '/api/v1/search?q=test' });
    assert.equal(search.statusCode, 200);
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

  it('exchanges a TikTok login code server-side and returns a business session', async () => {
    const app = await createTestApp();
    apps.push(app);
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: 'provider-access-token',
      open_id: 'tiktok-open-1',
      expires_in: 7_200
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/tiktok/login',
      payload: { code: 'one-time-login-code' }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().expiresIn, 3_600);
    assert.equal(typeof response.json().accessToken, 'string');
    assert.equal(response.json().user.id, 'user-1');
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
    const authorization = { authorization: `Bearer ${await token(app, 'user')}` };
    const incomplete = await app.inject({
      method: 'POST',
      url: '/api/v1/episodes/episode-1/reward-unlock',
      headers: authorization,
      payload: { placementId: 'rewarded-test', clientEventId: 'event-1', isEnded: false }
    });
    assert.equal(incomplete.statusCode, 400);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/episodes/episode-1/reward-unlock',
      headers: authorization,
      payload: { placementId: 'rewarded-test', clientEventId: 'event-1', isEnded: true }
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/episodes/episode-1/reward-unlock',
      headers: authorization,
      payload: { placementId: 'rewarded-test', clientEventId: 'event-1', isEnded: true }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
  });

  it('rejects playback progress past the online episode duration', async () => {
    const app = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/watch-progress',
      headers: { authorization: `Bearer ${await token(app, 'user')}` },
      payload: { episodeId: 'episode-1', positionMs: 100_001, durationMs: 100_000, completed: false }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  });
});
