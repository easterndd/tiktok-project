import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { registerAppEntryAdRoutes } from './routes';

it('stores v2 observations idempotently and advances only consecutive completed ads', async () => {
  const app = Fastify();
  app.decorate('config', { MINI_APP_KEY: 'heartreel' } as never);
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long' });
  const stored: Array<{ clientEventId: string; adIndex: number; placementId: string; eventType: string }> = [];
  const session = {
    id: 'entry-test', userId: 'viewer-test', releaseId: 'heartreel-v006-dual-test', mode: 'REWARDED_GATED',
    placementId: 'primary', allowedPlacementIds: ['primary', 'backup'], countMode: 'COMPLETED', requiredCount: 2,
    completedCount: 0, clientReportedShownCount: 0, clientReportedCompletedCount: 0, status: 'ACTIVE'
  };
  app.decorate('prisma', {
    appEntryAdSession: {
      findUnique: async () => session,
      updateMany: async ({ where, data }: { where: { id: string; completedCount?: { lt: number }; clientReportedShownCount?: { lt: number }; clientReportedCompletedCount?: { lt: number } }; data: Partial<typeof session> }) => {
        const field = where.completedCount ? 'completedCount' : where.clientReportedShownCount ? 'clientReportedShownCount' : 'clientReportedCompletedCount';
        const limit = where[field]?.lt ?? 0;
        if (session.id !== where.id || session[field] >= limit) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      }
    },
    entryAdObservation: {
      createMany: async ({ data }: { data: typeof stored }) => {
        let count = 0;
        for (const item of data) {
          if (stored.some((value) => value.clientEventId === item.clientEventId && value.eventType === item.eventType)) continue;
          stored.push(item);
          count++;
        }
        return { count };
      },
      findMany: async () => stored
    }
  } as never);
  await app.register(registerAppEntryAdRoutes, { prefix: '/api/heartreel/v1' });
  const token = app.jwt.sign({ sub: 'viewer-test', kind: 'user', appKey: 'heartreel' });
  const path = '/api/heartreel/v1/app-entry-ad-sessions/entry-test/observations';
  const event1 = '11111111-1111-4111-8111-111111111111';
  const event2 = '22222222-2222-4222-8222-222222222222';
  const observation = (eventId: string, adIndex: number, placementId: string, eventType: string) => ({
    eventId, adIndex, placementId, eventType, occurredAt: new Date().toISOString()
  });
  const post = (observations: unknown[]) => app.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload: { observations } });
  const first = await post([
    observation(event2, 2, 'backup', 'CLOSED_COMPLETED'),
    observation(event2, 2, 'backup', 'SHOWN'),
    observation(event1, 1, 'primary', 'SHOWN')
  ]);
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().reportedCount, 0);
  assert.equal(session.completedCount, 0);
  const second = await post([observation(event1, 1, 'primary', 'CLOSED_COMPLETED')]);
  assert.equal(second.json().reportedCount, 2);
  assert.equal(session.status, 'COMPLETED');
  const duplicate = await post([observation(event1, 1, 'primary', 'CLOSED_COMPLETED')]);
  assert.equal(duplicate.json().accepted, 0);
  assert.equal(stored.length, 4);
  const invalid = await post([observation(event1, 1, 'unapproved', 'SHOWN')]);
  assert.equal(invalid.statusCode, 409);
  assert.equal(stored.length, 4);
  await app.close();
});
