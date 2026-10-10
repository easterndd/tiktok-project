import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { assertSameMiniAppOrganization, configuredMiniAppKeys, miniAppEnvironment, miniAppKeys, miniAppOrganization, miniAppOrganizations, sameMiniAppOrganization, taletvEnvironment } from './config/mini-apps';
import { accessConfigSchema } from './lib/content-access';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  TALETV_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=taletv',
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
  BYTEPLUS_ACCOUNT_ID: 'shared-account',
  BYTEPLUS_SPACE_NAME: 'shared-space',
  BYTEPLUS_REGION: 'ap-southeast-1',
  TIKTOK_CLIENT_KEY: 'main-key',
  TALETV_TIKTOK_CLIENT_KEY: 'taletv-key',
  REWARDED_PLACEMENT_ID: 'main-rewarded-placement',
  TALETV_REWARDED_PLACEMENT_ID: 'ad7688599028879722512',
  APP_ENTRY_PLACEMENT_ID: 'main-entry-placement',
  TALETV_APP_ENTRY_PLACEMENT_ID: ''
});

function databaseFor(name: string) {
  const album = {
    id: name,
    title: name,
    description: name,
    coverUrl: 'https://example.com/cover.jpg',
    language: 'en',
    regions: null,
    accessConfig: null,
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    _count: { episodes: 1 },
    translations: [],
    genres: []
  };
  return {
    miniAppAlbumAuthorization: { findMany: async () => [], findFirst: async () => null },
    album: {
      findMany: async () => [album],
      update: async (args: { data: Record<string, unknown> }) => Object.assign(album, args.data)
    },
    adminUser: { findUnique: async () => ({ role: 'OWNER', status: 'ACTIVE', tokenVersion: 0 }) },
    appEntryAdPolicy: { findUnique: async () => null },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
    coverAsset: { findUnique: async () => null },
    watchProgress: { findMany: async () => [] }
  } as unknown as PrismaClient;
}

it('serves separate content and rejects tokens from the other mini app', async () => {
  const app = await buildApp(env, { prisma: databaseFor('main-album'), taletvPrisma: databaseFor('taletv-album') });
  try {
    await app.ready();
    const mainAlbums = await app.inject('/api/v1/albums');
    const taletvAlbums = await app.inject('/api/taletv/v1/albums');
    assert.equal(mainAlbums.statusCode, 200);
    assert.equal(taletvAlbums.statusCode, 200);
    assert.equal(mainAlbums.json().items[0].id, 'main-album');
    assert.equal(taletvAlbums.json().items[0].id, 'taletv-album');

    const mainAdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const taletvAdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'taletv', role: 'OWNER', tokenVersion: 0 });
    assert.equal((await app.inject({ url: '/api/v1/admin/albums', headers: { authorization: `Bearer ${mainAdminToken}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/taletv/v1/admin/albums', headers: { authorization: `Bearer ${taletvAdminToken}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/taletv/v1/admin/albums', headers: { authorization: `Bearer ${mainAdminToken}` } })).statusCode, 401);

    const mainUserToken = await app.jwt.sign({ sub: 'user-1', kind: 'user', appKey: 'main' });
    assert.equal((await app.inject({ url: '/api/taletv/v1/me/watch-progress', headers: { authorization: `Bearer ${mainUserToken}` } })).statusCode, 401);
  } finally {
    await app.close();
  }
});

it('uses independent ad placement defaults for each mini app admin context', async () => {
  const app = await buildApp(env, { prisma: databaseFor('main-album'), taletvPrisma: databaseFor('taletv-album') });
  try {
    await app.ready();
    const mainAdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const taletvAdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'taletv', role: 'OWNER', tokenVersion: 0 });

    const mainEntry = await app.inject({ url: '/api/v1/admin/app-entry-ad-policy', headers: { authorization: `Bearer ${mainAdminToken}` } });
    const taletvEntry = await app.inject({ url: '/api/taletv/v1/admin/app-entry-ad-policy', headers: { authorization: `Bearer ${taletvAdminToken}` } });
    assert.equal(mainEntry.statusCode, 200);
    assert.equal(taletvEntry.statusCode, 200);
    assert.equal(mainEntry.json().placementId, 'main-entry-placement');
    assert.equal(taletvEntry.json().placementId, '');

    const update = await app.inject({
      method: 'PATCH',
      url: '/api/taletv/v1/admin/albums/taletv-album',
      headers: { authorization: `Bearer ${taletvAdminToken}` },
      payload: { accessConfig: { freeEpisodeCount: 1, rewardedAdEnabled: true, rewardedPlacementId: 'main-rewarded-placement', rewardedAdCount: 2 } }
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().accessConfig.rewardedPlacementId, 'ad7688599028879722512');
  } finally {
    await app.close();
  }
});

it('requires taletv to use a separate PostgreSQL schema or database', () => {
  assert.throws(() => taletvEnvironment({ ...env, TALETV_DATABASE_URL: env.DATABASE_URL }), /different database or PostgreSQL schema/);
  assert.equal(taletvEnvironment(env)?.TIKTOK_CLIENT_KEY, 'taletv-key');
  assert.equal(taletvEnvironment(env)?.BYTEPLUS_SPACE_NAME, 'shared-space');
});

it('retires independent publishing and blocks platform changes to authorized copies', async () => {
  const db = databaseFor('shared-local-album') as any;
  db.miniAppAlbumAuthorization.findFirst = async () => ({ id: 'target-auth' });
  db.miniAppAlbumAuthorization.findMany = async () => [{ targetLocalAlbumId: 'shared-local-album' }];
  const app = await buildApp({ ...env, TIKTOK_CLIENT_SECRET: 'main-secret' }, { prisma: db, taletvPrisma: databaseFor('tale-album') });
  try {
    await app.ready();
    const token = await app.jwt.sign({ sub: 'owner', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await app.inject({ url: '/api/v1/admin/multi-app-releases/shared-local-album?targetApps=taletv', headers })).statusCode, 410);
    const change = await app.inject({ method: 'POST', url: '/api/v1/admin/albums/shared-local-album/sync-version', headers });
    assert.equal(change.statusCode, 409);
    assert.match(change.json().error.message, /授权播放副本/);
    const albums = await app.inject({ url: '/api/v1/admin/albums', headers });
    assert.equal(albums.json().items[0].sharedPlayback, true);
  } finally { await app.close(); }
});

it('accepts a different-email target OWNER session for shared playback status', async () => {
  const mainDb = databaseFor('main') as any;
  mainDb.sharedTikTokAlbum = { findUnique: async () => null };
  const sourceDb = databaseFor('source-album') as any;
  sourceDb.adminUser.findUnique = async () => ({ id: 'source-owner', email: 'source@example.com', role: 'OWNER', status: 'ACTIVE', tokenVersion: 0 });
  const targetDb = databaseFor('target-album') as any;
  targetDb.adminUser.findUnique = async ({ where }: any) => where.id === 'target-owner'
    ? { id: 'target-owner', email: 'target@example.com', role: 'OWNER', status: 'ACTIVE', tokenVersion: 0 }
    : null;
  targetDb.album.findUnique = async () => null;
  const expanded = { ...env, STORYLAND_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=storyland', STORYLAND_TIKTOK_CLIENT_KEY: 'storyland-key', STORYLAND_TIKTOK_CLIENT_SECRET: 'storyland-secret' };
  const app = await buildApp(expanded, { prisma: mainDb, taletvPrisma: targetDb, miniPrisma: { storyland: sourceDb } });
  try {
    await app.ready();
    const sourceToken = await app.jwt.sign({ sub: 'source-owner', kind: 'admin', appKey: 'storyland', role: 'OWNER', tokenVersion: 0 });
    const targetToken = await app.jwt.sign({ sub: 'target-owner', kind: 'admin', appKey: 'taletv', role: 'OWNER', tokenVersion: 0 });
    const url = '/api/storyland/v1/admin/shared-playback/source-album?targetApps=taletv';
    const withoutApproval = await app.inject({ url, headers: { authorization: `Bearer ${sourceToken}` } });
    assert.equal(withoutApproval.statusCode, 200);
    assert.equal(withoutApproval.json().items[0].status, 'ACCESS_ERROR');
    const withApproval = await app.inject({ url, headers: {
      authorization: `Bearer ${sourceToken}`,
      'x-multi-app-tokens': JSON.stringify({ taletv: targetToken })
    } });
    assert.equal(withApproval.statusCode, 200);
    assert.equal(withApproval.json().items[0].status, 'NOT_AUTHORIZED');
  } finally {
    await app.close();
  }
});

it('registers CineReels and TaleReels on independent routes and rejects duplicate schemas', async () => {
  const expanded = {
    ...env,
    CINEREELS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=cinereels',
    TALEREELS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=talereels',
    CINEREELS_TIKTOK_CLIENT_KEY: 'cinereels-key',
    TALEREELS_TIKTOK_CLIENT_KEY: 'talereels-key'
  };
  const app = await buildApp(expanded, {
    prisma: databaseFor('main-album'),
    miniPrisma: { cinereels: databaseFor('cine-album'), talereels: databaseFor('tale-album') },
    sharedPrisma: databaseFor('shared-album')
  });
  try {
    await app.ready();
    assert.equal((await app.inject('/api/cinereels/v1/albums')).json().items[0].id, 'cine-album');
    assert.equal((await app.inject('/api/talereels/v1/albums')).json().items[0].id, 'tale-album');
    const cineToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'cinereels', role: 'OWNER', tokenVersion: 0 });
    assert.equal((await app.inject({ url: '/api/cinereels/v1/admin/albums', headers: { authorization: `Bearer ${cineToken}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/talereels/v1/admin/albums', headers: { authorization: `Bearer ${cineToken}` } })).statusCode, 401);
  } finally {
    await app.close();
  }
  assert.throws(() => taletvEnvironment({ ...expanded, TALETV_DATABASE_URL: expanded.CINEREELS_DATABASE_URL }), /different database or PostgreSQL schema/);
});

it('registers all new Mini routes with separate databases and app-bound admin tokens', async () => {
  const extraKeys = miniAppKeys.slice(4);
  const extraEnv = Object.fromEntries(extraKeys.map((key) => [`${key.toUpperCase()}_DATABASE_URL`, `postgresql://test:test@localhost:5432/test?schema=${key}`]));
  const expanded = loadEnv({ NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL, TALETV_DATABASE_URL: env.TALETV_DATABASE_URL, JWT_SECRET: env.JWT_SECRET, BYTEPLUS_ACCOUNT_ID: env.BYTEPLUS_ACCOUNT_ID, BYTEPLUS_SPACE_NAME: env.BYTEPLUS_SPACE_NAME, BYTEPLUS_REGION: env.BYTEPLUS_REGION, ...extraEnv });
  assert.deepEqual(configuredMiniAppKeys(expanded), [...miniAppKeys.slice(0, 2), ...extraKeys]);
  const miniPrisma = Object.fromEntries(extraKeys.map((key) => [key, databaseFor(key)]));
  const app = await buildApp(expanded, { prisma: databaseFor('main'), taletvPrisma: databaseFor('taletv'), miniPrisma, sharedPrisma: databaseFor('shared') });
  try {
    await app.ready();
    for (const key of extraKeys) {
      assert.equal(miniAppEnvironment(expanded, key)?.DATABASE_URL, extraEnv[`${key.toUpperCase()}_DATABASE_URL`]);
      assert.equal((await app.inject(`/api/${key}/v1/albums`)).json().items[0].id, key);
      const token = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: key, role: 'OWNER', tokenVersion: 0 });
      assert.equal((await app.inject({ url: `/api/${key}/v1/admin/albums`, headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
      assert.equal((await app.inject({ url: '/api/v1/admin/albums', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    }
  } finally {
    await app.close();
  }
  assert.throws(() => miniAppEnvironment({ ...expanded, DRAMACLOUD_DATABASE_URL: expanded.STORYLAND_DATABASE_URL }, 'storyland'), /different database or PostgreSQL schema/);
  assert.throws(() => loadEnv({ DATABASE_URL: env.DATABASE_URL, JWT_SECRET: env.JWT_SECRET, BYTEPLUS_ACCOUNT_ID: env.BYTEPLUS_ACCOUNT_ID, BYTEPLUS_SPACE_NAME: env.BYTEPLUS_SPACE_NAME, BYTEPLUS_REGION: env.BYTEPLUS_REGION, STORYLAND_DATABASE_URL: 'not-a-url' }), /STORYLAND_DATABASE_URL/);
  assert.throws(() => loadEnv({ DATABASE_URL: env.DATABASE_URL, JWT_SECRET: env.JWT_SECRET, BYTEPLUS_ACCOUNT_ID: env.BYTEPLUS_ACCOUNT_ID, BYTEPLUS_SPACE_NAME: env.BYTEPLUS_SPACE_NAME, BYTEPLUS_REGION: env.BYTEPLUS_REGION, CROWNRUSH_DATABASE_URL: 'not-a-url' }), /CROWNRUSH_DATABASE_URL/);
});

it('keeps mini apps in the configured organization groups and rejects cross-organization sharing', () => {
  assert.deepEqual(Object.values(miniAppOrganizations).map((group) => group.miniApps.length), [1, 20, 10]);
  assert.deepEqual(Object.values(miniAppOrganizations).flatMap((group) => group.miniApps).sort(), [...miniAppKeys].sort());
  assert.equal(miniAppOrganization('main'), 'quickreels');
  assert.equal(miniAppOrganization('storyland'), miniAppOrganization('taletv'));
  assert.equal(miniAppOrganization('crownrush'), miniAppOrganization('elitedrama'));
  assert.equal(sameMiniAppOrganization('dramacloud', 'cinereels'), true);
  assert.equal(sameMiniAppOrganization('taletv', 'crownrush'), false);
  assert.throws(() => assertSameMiniAppOrganization('main', ['taletv']), /同一组织/);
  assert.throws(() => assertSameMiniAppOrganization('storyland', ['crownrush']), /同一组织/);
});

it('handles Mini bootstrap preflights for all apps and logs the actual allowlist decision before CORS', async () => {
  const app = await buildApp({
    ...env,
    API_CORS_ORIGIN: 'https://admin.example.com,https://*.tiktokminis.us,https://*.tiktok-minis.us',
    CINEREELS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=cinereels',
    TALEREELS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=talereels'
  }, { prisma: databaseFor('main'), taletvPrisma: databaseFor('taletv'), miniPrisma: {
    cinereels: databaseFor('cinereels'), talereels: databaseFor('talereels')
  } });
  const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const child = app.log.child.bind(app.log);
  app.log.child = ((...args: Parameters<typeof app.log.child>) => {
    const logger = child(...args);
    logger.info = ((fields: Record<string, unknown>, message: string) => { logs.push({ fields, message }); }) as typeof logger.info;
    return logger;
  }) as typeof app.log.child;
  try {
    await app.ready();
    for (const prefix of ['/api/v1', '/api/taletv/v1', '/api/cinereels/v1', '/api/talereels/v1']) {
      for (const path of ['/auth/anonymous/session', '/app-entry-ad-sessions']) {
        const url = `${prefix}${path}`;
        for (const [origin, allowed] of [
          ['https://minis-mnph4s4euzsjk6w6-3hr0tnbqgepq9-3.tiktokminis.us', true],
          ['https://preview.tiktok-minis.us', true],
          ['https://preview.tiktokminis.us.evil.example', false],
          ['https://fake-tiktokminis.us', false],
          ['http://preview.tiktokminis.us', false],
          ['https://untrusted.example', false],
          ['null', false]
        ] as const) {
          logs.length = 0;
          const response = await app.inject({ method: 'OPTIONS', url, headers: {
            origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization'
          } });
          assert.equal(response.statusCode, allowed ? 204 : 404);
          assert.equal(response.headers['access-control-allow-origin'], allowed ? origin : undefined);
          const request = logs.find((entry) => entry.message === 'Mini bootstrap request');
          assert.ok(request, `missing pre-CORS log for ${url}`);
          assert.equal(request.fields.path, url);
          assert.equal(request.fields.origin, origin);
          assert.equal(request.fields.corsAllowed, allowed);
          assert.equal(request.fields.requestedMethod, 'POST');
          const completion = logs.find((entry) => entry.message === 'Mini bootstrap response');
          assert.ok(completion);
          assert.equal(completion.fields.statusCode, allowed ? 204 : 404);
          assert.equal(completion.fields.accessControlAllowOrigin, allowed ? origin : null);
          assert.equal(Object.hasOwn(request.fields, 'authorization'), false);
        }
      }
    }
    logs.length = 0;
    await app.inject({ method: 'POST', url: '/api/cinereels/v1/auth/anonymous/session?token=do-not-log', headers: { origin: 'https://preview.tiktok-minis.us' }, payload: {} });
    assert.equal(logs.find((entry) => entry.message === 'Mini bootstrap request')?.fields.path, '/api/cinereels/v1/auth/anonymous/session');
    assert.equal(logs.filter((entry) => entry.message.startsWith('Mini bootstrap')).some((entry) => JSON.stringify(entry.fields).includes('do-not-log')), false);
    logs.length = 0;
    await app.inject('/api/cinereels/v1/albums');
    assert.equal(logs.some((entry) => entry.message.startsWith('Mini bootstrap')), false);
  } finally {
    await app.close();
  }
});

it('creates a CineReels draft with no ad placement when rewarded ads are off', async () => {
  assert.equal(accessConfigSchema.safeParse({ rewardedAdEnabled: false, rewardedPlacementId: '' }).success, true);
  const cineDb = databaseFor('cine-album') as any;
  cineDb.coverAsset.findUnique = async () => ({ id: 'cover-1', publicUrl: 'https://example.com/cover.jpg', status: 'READY' });
  cineDb.coverAsset.findMany = async () => [];
  cineDb.album.create = async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-cine-album', ...data });
  cineDb.episode = { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-cine-episode', ...data }) };
  cineDb.$transaction = async (callback: (tx: typeof cineDb) => Promise<unknown>) => callback(cineDb);
  const app = await buildApp({
    ...env,
    CINEREELS_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=cinereels',
    CINEREELS_REWARDED_PLACEMENT_ID: undefined
  }, { prisma: databaseFor('main-album'), miniPrisma: { cinereels: cineDb }, sharedPrisma: databaseFor('shared-album') });
  try {
    await app.ready();
    const cineToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'cinereels', role: 'OWNER', tokenVersion: 0 });
    const payload = {
      title: 'CineReels drama', coverAssetId: 'cover-1', releaseYear: 2026, dramaType: 2, tagList: [1],
      accessConfig: { freeEpisodeCount: 1, rewardedAdEnabled: false, rewardedPlacementId: '', rewardedAdCount: 1 },
      episodes: [{ episodeNo: 1, title: 'Episode 1', isFree: true }]
    };
    const headers = { authorization: `Bearer ${cineToken}` };
    const created = await app.inject({ method: 'POST', url: '/api/cinereels/v1/admin/dramas', headers, payload });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().album.accessConfig.rewardedPlacementId, '');
    const invalid = await app.inject({ method: 'POST', url: '/api/cinereels/v1/admin/dramas', headers, payload: { ...payload, accessConfig: { ...payload.accessConfig, rewardedAdEnabled: true } } });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.json().error.message, /激励广告位/);
  } finally {
    await app.close();
  }
});
