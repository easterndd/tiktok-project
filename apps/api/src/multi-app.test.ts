import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { xu03Environment } from './config/mini-apps';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  XU03_DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=xu03',
  JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
  BYTEPLUS_ACCOUNT_ID: 'shared-account',
  BYTEPLUS_SPACE_NAME: 'shared-space',
  BYTEPLUS_REGION: 'ap-southeast-1',
  TIKTOK_CLIENT_KEY: 'main-key',
  XU03_TIKTOK_CLIENT_KEY: 'xu03-key'
});

function databaseFor(name: string) {
  return {
    album: {
      findMany: async () => [{
        id: name,
        title: name,
        description: name,
        coverUrl: 'https://example.com/cover.jpg',
        language: 'en',
        regions: null,
        updatedAt: new Date('2026-09-20T00:00:00Z'),
        _count: { episodes: 1 },
        translations: [],
        genres: []
      }]
    },
    adminUser: { findUnique: async () => ({ role: 'OWNER', status: 'ACTIVE', tokenVersion: 0 }) },
    watchProgress: { findMany: async () => [] }
  } as unknown as PrismaClient;
}

it('serves separate content and rejects tokens from the other mini app', async () => {
  const app = await buildApp(env, { prisma: databaseFor('main-album'), xu03Prisma: databaseFor('xu03-album') });
  try {
    await app.ready();
    const mainAlbums = await app.inject('/api/v1/albums');
    const xu03Albums = await app.inject('/api/xu03/v1/albums');
    assert.equal(mainAlbums.statusCode, 200);
    assert.equal(xu03Albums.statusCode, 200);
    assert.equal(mainAlbums.json().items[0].id, 'main-album');
    assert.equal(xu03Albums.json().items[0].id, 'xu03-album');

    const mainAdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const xu03AdminToken = await app.jwt.sign({ sub: 'admin-1', kind: 'admin', appKey: 'xu03', role: 'OWNER', tokenVersion: 0 });
    assert.equal((await app.inject({ url: '/api/v1/admin/albums', headers: { authorization: `Bearer ${mainAdminToken}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/xu03/v1/admin/albums', headers: { authorization: `Bearer ${xu03AdminToken}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/xu03/v1/admin/albums', headers: { authorization: `Bearer ${mainAdminToken}` } })).statusCode, 401);

    const mainUserToken = await app.jwt.sign({ sub: 'user-1', kind: 'user', appKey: 'main' });
    assert.equal((await app.inject({ url: '/api/xu03/v1/me/watch-progress', headers: { authorization: `Bearer ${mainUserToken}` } })).statusCode, 401);
  } finally {
    await app.close();
  }
});

it('requires xu03 to use a separate PostgreSQL schema or database', () => {
  assert.throws(() => xu03Environment({ ...env, XU03_DATABASE_URL: env.DATABASE_URL }), /different database or PostgreSQL schema/);
  assert.equal(xu03Environment(env)?.TIKTOK_CLIENT_KEY, 'xu03-key');
  assert.equal(xu03Environment(env)?.BYTEPLUS_SPACE_NAME, 'shared-space');
});
