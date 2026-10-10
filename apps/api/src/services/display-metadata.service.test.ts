import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../app';
import { loadEnv } from '../config/env';
import { applyDisplayMetadata, assertDisplayMetadataOwner, carryBaseTextChanges, displayMetadataInput, enqueueDisplayMetadata, readDisplayMetadata, retryDisplayMetadata, saveSharedDisplayMetadata } from './display-metadata.service';
import { processSharedPlatformOperations } from './shared-platform.service';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', TALETV_DATABASE_URL: 'postgresql://test:test@localhost/test?schema=taletv',
  JWT_SECRET: 'display-metadata-test-secret-at-least-32', BYTEPLUS_ACCOUNT_ID: 'test', BYTEPLUS_SPACE_NAME: 'test', BYTEPLUS_REGION: 'test' });
const metadata = (title: string) => displayMetadataInput.parse({ title, description: `${title} description`, translations: [{ locale: 'en', title: `${title} EN`, description: `${title} EN description` }] });

function fixture() {
  let shared: any = { id: 'shared-1', ownerMiniAppKey: 'main', canonicalKey: 'main:source-1', tiktokAlbumId: 'platform-1', displayMetadataVersion: 0, displayMetadata: null,
    authorizations: [{ id: 'auth-main', miniAppKey: 'main', status: 'AUTHORIZED', targetLocalAlbumId: 'source-1', metadataSyncedVersion: 0 },
      { id: 'auth-target', miniAppKey: 'taletv', status: 'AUTHORIZED', targetLocalAlbumId: 'target-1', metadataSyncedVersion: 0 },
      { id: 'auth-revoked', miniAppKey: 'cinereels', status: 'REVOKED', targetLocalAlbumId: 'revoked-1', metadataSyncedVersion: 0 }] };
  const jobs: any[] = [];
  const snapshots: any[] = [];
  const sharedDb: any = {
    sharedTikTokAlbum: {
      findFirst: async () => structuredClone(shared), findUnique: async () => structuredClone(shared), findUniqueOrThrow: async () => structuredClone(shared),
      updateMany: async ({ where, data }: any) => {
        if (where.displayMetadataVersion !== shared.displayMetadataVersion) return { count: 0 };
        shared = { ...shared, ...data, displayMetadataVersion: shared.displayMetadataVersion + 1 };
        snapshots.push(structuredClone(shared)); return { count: 1 };
      }
    },
    miniAppAlbumAuthorization: { updateMany: async ({ where, data }: any) => {
      const target = shared.authorizations.find((item: any) => item.id === where.id);
      if (target.metadataSyncedVersion >= where.metadataSyncedVersion.lt) return { count: 0 };
      Object.assign(target, data); return { count: 1 };
    } },
    sharedPlatformOperation: {
      upsert: async ({ where, create }: any) => {
        let job = jobs.find((item) => item.dedupeKey === where.dedupeKey);
        if (!job) { job = { id: `job-${jobs.length}`, attemptCount: 0, ...structuredClone(create) }; jobs.push(job); }
        return structuredClone(job);
      },
      findUnique: async ({ where }: any) => jobs.find((job) => job.dedupeKey === where.dedupeKey) ?? null,
      findMany: async () => structuredClone(jobs.filter((job) => ['PENDING', 'PROCESSING'].includes(job.status))),
      updateMany: async ({ where, data }: any) => {
        const job = jobs.find((item) => where.id ? item.id === where.id : item.dedupeKey === where.dedupeKey);
        if (!job || (Array.isArray(where.status?.in) && !where.status.in.includes(job.status))) return { count: 0 };
        Object.assign(job, data); return { count: 1 };
      },
      update: async ({ where, data }: any) => { const job = jobs.find((item) => item.id === where.id); Object.assign(job, data); return job; }
    }
  };
  sharedDb.$transaction = async (callback: any) => callback(sharedDb);
  const makeLocal = (id: string, title: string, cover: string) => {
    const album: any = { id, title, description: 'Old description', language: 'en', coverUrl: cover, tiktokAlbumId: 'platform-1', status: 'ONLINE',
      accessConfig: { rewardedPlacementId: `${id}-ad` }, displayMetadataVersion: 0, displayMetadataSharedId: null,
      translations: [{ id: `${id}-en`, locale: 'en', title: `${title} EN`, description: 'Old EN', coverUrl: `${cover}/en` },
        { id: `${id}-zh`, locale: 'zh', title: 'Old ZH', description: 'Old ZH', coverUrl: `${cover}/zh` }] };
    const admin: any = { id: 'owner', email: 'owner@example.com', role: 'OWNER', status: 'ACTIVE', tokenVersion: 0 };
    let fail = false;
    const db: any = {
      album: {
        findUnique: async ({ where }: any) => { if (fail) throw new Error('Database temporarily unavailable'); return where.id === id ? structuredClone(album) : null; },
        findUniqueOrThrow: async () => structuredClone(album),
        update: async ({ data }: any) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) album[key] = value; return structuredClone(album); },
        updateMany: async ({ where, data }: any) => {
          if (where.id !== album.id || (album.displayMetadataSharedId && album.displayMetadataVersion > where.OR[1].displayMetadataVersion.lte)) return { count: 0 };
          Object.assign(album, data); return { count: 1 };
        }
      },
      albumTranslation: {
        findUnique: async ({ where }: any) => structuredClone(album.translations.find((item: any) => item.locale === where.albumId_locale.locale) ?? null),
        update: async ({ where, data }: any) => { const item = album.translations.find((value: any) => value.id === where.id); Object.assign(item, data); return structuredClone(item); },
        updateMany: async ({ where, data }: any) => { for (const item of album.translations) if (!where.locale.notIn.includes(item.locale)) Object.assign(item, data); },
        upsert: async ({ where, create, update }: any) => {
          const item = album.translations.find((value: any) => value.locale === where.albumId_locale.locale);
          if (item) { Object.assign(item, update); return structuredClone(item); }
          const created = { id: `${id}-${create.locale}`, ...create }; album.translations.push(created); return structuredClone(created);
        }
      },
      adminUser: { findUnique: async () => structuredClone(admin), findUniqueOrThrow: async () => structuredClone(admin) },
      auditLog: { create: async () => ({}) }, $disconnect: async () => {}, $queryRaw: async () => [{ one: 1 }]
    };
    db.$transaction = async (callback: any) => callback(db);
    return { db, album, admin, setFail: (value: boolean) => { fail = value; } };
  };
  const source = makeLocal('source-1', 'Source text', 'https://example.com/source');
  const target = makeLocal('target-1', 'Target text', 'https://example.com/target');
  const dbByApp = { main: source.db, taletv: target.db };
  const run = () => processSharedPlatformOperations(sharedDb, { env, localPrismaByApp: dbByApp, apiByApp: {} });
  const save = (title: string, version = shared.displayMetadataVersion) => saveSharedDisplayMetadata(sharedDb, structuredClone(shared), metadata(title), version, 'main:owner');
  return { sharedDb, dbByApp, source, target, jobs, snapshots, save, run, getShared: () => structuredClone(shared) };
}

test('initial view uses source text and reports differences without changing local apps', async () => {
  const f = fixture();
  const view = await readDisplayMetadata(f.sharedDb, f.dbByApp, 'taletv', 'target-1');
  assert.equal(view.title, 'Source text');
  assert.equal(view.targets.length, 2);
  assert.equal(view.targets[1].differs, true);
  assert.equal(f.target.album.title, 'Target text');
});

test('base text edits update inherited locale fields while preserving explicit translations', () => {
  const previous = displayMetadataInput.parse({ title: 'Old', description: 'Old synopsis', translations: [
    { locale: 'en', title: 'Old', description: 'Old synopsis' },
    { locale: 'fr', title: '自定义剧名', description: '自定义简介' }
  ] });
  const next = carryBaseTextChanges({ ...previous, title: 'New', description: 'New synopsis' }, previous);
  assert.deepEqual(next.translations[0], { locale: 'en', title: 'New', description: 'New synopsis' });
  assert.deepEqual(next.translations[1], previous.translations[1]);
  const explicit = carryBaseTextChanges({ ...next, translations: [{ ...previous.translations[0], title: 'Explicit', description: 'Explicit synopsis' }] }, previous);
  assert.equal(explicit.translations[0].title, 'Explicit');
  assert.equal(explicit.translations[0].description, 'Explicit synopsis');
});

test('missing source mapping produces a clear initialization error', async () => {
  const f = fixture();
  const shared = f.getShared();
  shared.authorizations[0].targetLocalAlbumId = null;
  f.sharedDb.sharedTikTokAlbum.findFirst = async () => shared;
  await assert.rejects(readDisplayMetadata(f.sharedDb, f.dbByApp, 'taletv', 'target-1'), /主小程序资料或映射缺失/);
});

test('repairing a missing target mapping allows the failed job to retry with the current mapping', async () => {
  const f = fixture();
  const shared = f.getShared();
  shared.authorizations[1].targetLocalAlbumId = null;
  await enqueueDisplayMetadata(f.sharedDb, { ...shared, displayMetadata: metadata('Unified'), displayMetadataVersion: 1 });
  await f.save('Unified');
  await f.run();
  assert.equal(f.jobs[1].status, 'FAILED');
  await retryDisplayMetadata(f.sharedDb, f.getShared(), 'taletv');
  await f.run();
  assert.equal(f.jobs[1].status, 'SUCCEEDED');
  assert.equal(f.target.album.title, 'Unified');
});

test('localized cover saves before text projection do not use stale client text', async () => {
  const f = fixture();
  await saveSharedDisplayMetadata(f.sharedDb, f.getShared(), { ...metadata('Unified'), translations: [
    { locale: 'fr', title: 'French title', description: 'French synopsis' }
  ] }, 0, 'main:owner');
  const app = await buildApp(env, { prisma: f.source.db, taletvPrisma: f.target.db, sharedPrisma: f.sharedDb });
  try {
    const token = app.jwt.sign({ sub: 'owner', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const headers = { authorization: `Bearer ${token}` };
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/translations', headers,
      payload: { kind: 'album', contentId: 'source-1', locale: 'fr', title: 'Stale title', description: 'Stale synopsis', coverOnly: true, coverUrl: 'https://example.com/fr-cover' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().title, 'French title');
    assert.equal(response.json().description, 'French synopsis');
    await f.run();
    const translation = f.source.album.translations.find((item: any) => item.locale === 'fr');
    assert.equal(translation.title, 'French title');
    assert.equal(translation.coverUrl, 'https://example.com/fr-cover');
  } finally { await app.close(); }
});

test('one save updates all associated apps and languages while preserving covers, ads and playback', async () => {
  const f = fixture();
  const before = structuredClone(f.target.album);
  await f.save('Unified');
  assert.equal(f.jobs.length, 2);
  await f.run();
  for (const app of [f.source, f.target]) {
    assert.equal(app.album.title, 'Unified');
    assert.equal(app.album.description, 'Unified description');
    assert.equal(app.album.translations[0].title, 'Unified EN');
    assert.equal(app.album.translations[1].title, 'Unified');
    assert.equal(app.album.displayMetadataVersion, 1);
  }
  assert.equal(f.target.album.coverUrl, before.coverUrl);
  assert.equal(f.target.album.translations[0].coverUrl, before.translations[0].coverUrl);
  assert.equal(f.target.album.translations[1].coverUrl, before.translations[1].coverUrl);
  assert.deepEqual(f.target.album.accessConfig, before.accessConfig);
  assert.equal(f.target.album.status, before.status);
  assert.ok(f.jobs.every((job) => job.status === 'SUCCEEDED'));
});

test('stale save is rejected and older in-flight projections cannot overwrite newer translations', async () => {
  const f = fixture();
  const old = await f.save('First', 0);
  const latest = await f.save('Second', 1);
  await assert.rejects(f.save('Stale', 0), /其他管理员/);
  await applyDisplayMetadata(f.sharedDb, f.target.db, latest, latest.authorizations[1]);
  await applyDisplayMetadata(f.sharedDb, f.target.db, old, old.authorizations[1]);
  assert.equal(f.target.album.title, 'Second');
  assert.equal(f.target.album.translations[0].title, 'Second EN');
  assert.equal(f.getShared().authorizations[1].metadataSyncedVersion, 2);
});

test('old queued jobs read the latest version rather than their captured version', async () => {
  const f = fixture(); await f.save('First'); await f.save('Latest'); await f.run();
  assert.equal(f.source.album.title, 'Latest');
  assert.equal(f.target.album.title, 'Latest');
  assert.ok(f.jobs.every((job) => job.providerResponse.syncedVersion === 2));
});

test('database failure retries text independently of playback authorization and reports partial success', async () => {
  const f = fixture(); await f.save('Unified'); f.target.setFail(true); await f.run();
  assert.equal(f.jobs[0].status, 'SUCCEEDED');
  assert.equal(f.jobs[1].status, 'PENDING');
  assert.equal(f.jobs[1].attemptCount, 1);
  assert.ok(f.jobs[1].nextAttemptAt);
  assert.equal(f.getShared().authorizations[1].status, 'AUTHORIZED');
  f.target.setFail(false); await f.run();
  assert.equal(f.target.album.title, 'Unified');
});

test('wrong platform identity fails without a write and the repaired target can be retried', async () => {
  const f = fixture(); await f.save('Unified'); f.target.album.tiktokAlbumId = 'another-platform'; await f.run();
  assert.equal(f.jobs[1].status, 'FAILED');
  assert.equal(f.target.album.title, 'Target text');
  f.target.album.tiktokAlbumId = 'platform-1';
  await retryDisplayMetadata(f.sharedDb, f.getShared(), 'taletv'); await f.run();
  assert.equal(f.jobs[1].status, 'SUCCEEDED');
  assert.equal(f.target.album.title, 'Unified');
});

test('new consumers are queued with the latest text even after the first sync completed', async () => {
  const f = fixture(); await f.save('Unified'); await f.run();
  const shared = f.getShared();
  await enqueueDisplayMetadata(f.sharedDb, shared, [{ id: 'new-auth', miniAppKey: 'talereels', targetLocalAlbumId: 'new-copy' }]);
  assert.equal(f.jobs.length, 3);
  assert.equal(f.jobs[2].snapshotJson.version, 1);
});

test('a target OWNER must also be a source OWNER, and EDITOR cannot write shared text', async () => {
  const f = fixture();
  await assert.rejects(assertDisplayMetadataOwner(f.getShared(), f.dbByApp, 'main', 'EDITOR', 'owner@example.com'), /OWNER/);
  f.source.admin.role = 'EDITOR';
  await assert.rejects(assertDisplayMetadataOwner(f.getShared(), f.dbByApp, 'taletv', 'OWNER', 'owner@example.com'), /主小程序/);
});

test('admin endpoints return canonical text, enqueue one batch and reject stale versions and editors', async () => {
  const f = fixture();
  const app = await buildApp(env, { prisma: f.source.db, taletvPrisma: f.target.db, sharedPrisma: f.sharedDb });
  try {
    const token = app.jwt.sign({ sub: 'owner', kind: 'admin', appKey: 'main', role: 'OWNER', tokenVersion: 0 });
    const headers = { authorization: `Bearer ${token}` };
    const get = await app.inject({ method: 'GET', url: '/api/v1/admin/albums/source-1/display-metadata', headers });
    assert.equal(get.statusCode, 200); assert.equal(get.json().sharedAlbum, undefined);
    const payload = { ...metadata('Unified'), expectedVersion: 0 };
    const patch = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/source-1/display-metadata', headers, payload });
    assert.equal(patch.statusCode, 200, patch.body); assert.equal(patch.json().targets.length, 2);
    assert.equal(f.jobs.length, 2);
    const stale = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/source-1/display-metadata', headers, payload });
    assert.equal(stale.statusCode, 409);
    await f.run();
    const rename = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/source-1', headers, payload: { title: 'Legacy rename' } });
    assert.equal(rename.statusCode, 200, rename.body);
    await f.run();
    assert.equal(f.target.album.title, 'Legacy rename');
    const covered = f.target.album.translations.find((item: any) => item.locale === 'zh');
    assert.equal(covered.title, 'Legacy rename');
    f.source.admin.role = 'EDITOR';
    const denied = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/source-1/display-metadata', headers, payload: { ...payload, expectedVersion: 1 } });
    assert.equal(denied.statusCode, 403);
    const legacy = await app.inject({ method: 'PATCH', url: '/api/v1/admin/albums/source-1', headers, payload: { title: 'Bypass' } });
    assert.equal(legacy.statusCode, 403);
  } finally { await app.close(); }
});
