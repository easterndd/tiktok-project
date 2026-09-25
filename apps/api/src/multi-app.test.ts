import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { taletvEnvironment } from './config/mini-apps';

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
