const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('../dist/config/env');
const { buildApp } = require('../dist/app');

(async () => {
  const database = process.env.TEST_DATABASE_URL;
  assert.ok(database && new URL(database).hostname === 'quickreels-cpu-testdb-20261102', 'Only the isolated test database is allowed');
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: database, JWT_SECRET: 'isolated-acceptance-secret-at-least-32-chars',
    BYTEPLUS_ACCOUNT_ID: 'test', BYTEPLUS_SPACE_NAME: 'test', BYTEPLUS_REGION: 'test',
    API_DB_CONCURRENCY: '24', API_DB_CONCURRENCY_PER_APP: '3', API_DB_QUEUE_LIMIT: '64',
    API_DB_QUEUE_LIMIT_PER_APP: '8', API_DB_RESERVED: '8', PERSIST_CLIENT_AD_DIAGNOSTICS: 'false' });
  const prisma = new PrismaClient({ datasources: { db: { url: database } } });
  const app = await buildApp(env, { prisma });
  const secondPrisma = new PrismaClient({ datasources: { db: { url: database } } });
  const second = await buildApp(env, { prisma: secondPrisma });
  await Promise.all([app.ready(), second.ready()]);
  const user = await prisma.user.create({ data: {} });
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, kind: 'user', appKey: 'main' })}` };
  const session = async (mode, requiredCount = 2) => prisma.appEntryAdSession.create({ data: {
    userId: user.id, launchId: randomUUID(), policyVersion: 1, placementId: 'isolated-test-ad', mode: 'REWARDED_GATED',
    requiredCount, countMode: mode, expiresAt: new Date(Date.now() + 600000) } });
  const event = async (s, index) => prisma.adEvent.create({ data: { userId: user.id, clientEventId: randomUUID(),
    adType: 'REWARDED', scope: 'APP_ENTRY', eventType: 'SHOWN', placementId: s.placementId,
    sessionId: s.id, appEntrySessionId: s.id, adIndex: index } });
  const complete = (s, e, isEnded, instance = app) => instance.inject({ method: 'POST',
    url: `/api/v1/app-entry-ad-sessions/${s.id}/complete`, headers, payload: { clientEventId: e.clientEventId, isEnded } });
  try {
    const s = await session('COMPLETED');
    const e = await event(s, 1);
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => complete(s, e, true, i % 2 ? app : second)));
    for (const r of responses) assert.equal(r.statusCode, 200, r.body);
    assert.equal((await prisma.appEntryAdSession.findUnique({ where: { id: s.id } })).completedCount, 1);
    assert.equal(await prisma.appEntryAdCompletion.count({ where: { sessionId: s.id } }), 1);
    const replay = await complete(s, e, true); // Lost HTTP response retried after commit.
    assert.equal(replay.statusCode, 200); assert.equal(replay.json().completedCount, 1);
    console.log('PASS duplicate/lost-response retries across two independent API/Prisma instances');

    const competing = await session('COMPLETED');
    const events = await Promise.all([event(competing, 1), event(competing, 1)]);
    const raced = await Promise.all(events.map((e, i) => complete(competing, e, true, i ? second : app)));
    for (const r of raced) assert.equal(r.statusCode, 200, r.body);
    assert.equal(await prisma.appEntryAdCompletion.count({ where: { sessionId: competing.id } }), 1);
    assert.equal((await prisma.appEntryAdSession.findUnique({ where: { id: competing.id } })).completedCount, 1);
    console.log('PASS competing event IDs for the same index count exactly once');

    const early = await session('COMPLETED');
    const closed = await event(early, 1);
    const notEnded = await complete(early, closed, false);
    assert.equal(notEnded.statusCode, 200, notEnded.body); assert.equal(notEnded.json().completedCount, 0);
    assert.equal((await complete(early, closed, true)).statusCode, 409);
    console.log('PASS incomplete rewarded close never grants a completed-view count');

    const shown = await session('SHOWN', 1);
    const shownEvent = await event(shown, 1);
    const shownResult = await complete(shown, shownEvent, false);
    assert.equal(shownResult.statusCode, 200, shownResult.body); assert.equal(shownResult.json().completedCount, 1);
    assert.equal(shownResult.json().access, 'APP_PLAYABLE');
    console.log('PASS legacy SHOWN mode and old completion response contract');

    // Multiple distinct sessions exercise pool admission and transaction acquisition.
    const work = await Promise.all(Array.from({ length: 12 }, async () => {
      const s = await session('COMPLETED', 1); const e = await event(s, 1); return { s, e };
    }));
    const parallel = await Promise.all(work.map(({ s, e }) => complete(s, e, true)));
    assert.ok(parallel.some((r) => r.statusCode === 503), 'Burst exceeds 3 active + 8 waiting capacity');
    for (let i = 0; i < parallel.length; i++) {
      const r = parallel[i];
      if (r.statusCode === 503) {
        assert.equal(r.headers['retry-after'], '2');
        const retried = await complete(work[i].s, work[i].e, true);
        assert.equal(retried.statusCode, 200, retried.body);
      } else assert.equal(r.statusCode, 200, r.body);
      assert.equal((await prisma.appEntryAdSession.findUnique({ where: { id: work[i].s.id } })).completedCount, 1);
    }
    console.log('PASS overload is bounded, Retry-After is returned, retried completions retain exact counts');
    console.log('POSTGRES_ACCEPTANCE_PASSED');
  } finally {
    await Promise.all([app.close(), second.close()]);
    await Promise.all([prisma.$disconnect(), secondPrisma.$disconnect()]);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
