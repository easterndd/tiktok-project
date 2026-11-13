import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { registerDiagnosticRoutes } from './routes';

it('accepts authenticated dual-release callback traces, redacts secrets, and deduplicates records', async () => {
  const app = Fastify();
  app.decorate('config', { MINI_APP_KEY: 'heartreel' } as never);
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long' });
  const sessions = new Map<string, { userId: string; releaseId: string }>();
  const records = new Map<string, { payload: Record<string, unknown>; errorCode?: string; subErrorCode?: string }>();
  app.decorate('prisma', {
    clientTraceSession: {
      findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null,
      create: async ({ data }: { data: { id: string; userId: string; releaseId: string } }) => {
        sessions.set(data.id, { userId: data.userId, releaseId: data.releaseId });
      },
      update: async () => ({})
    },
    clientTraceRecord: {
      createMany: async ({ data }: { data: Array<{ traceId: string; recordId: string; payload: Record<string, unknown>; errorCode?: string; subErrorCode?: string }> }) => {
        let count = 0;
        for (const item of data) {
          const key = `${item.traceId}:${item.recordId}`;
          if (records.has(key)) continue;
          records.set(key, item);
          count++;
        }
        return { count };
      }
    }
  } as never);
  await app.register(registerDiagnosticRoutes, { prefix: '/api/heartreel/v1' });
  const token = app.jwt.sign({ sub: 'viewer-test', kind: 'user', appKey: 'heartreel' });
  const path = '/api/heartreel/v1/client-traces/batches';
  const payload = {
    traceId: 'trace-test', releaseId: 'heartreel-v006-dual-test', platform: 'android', startedAt: new Date().toISOString(),
    records: [{ recordId: 'record-test', seq: 1, kind: 'SDK_CALLBACK', phase: 'onError', eventAt: new Date().toISOString(),
      payload: { error_code: 101150000, sub_error_code: 50008, authorization: 'Bearer secret-value',
        path: '/episodes?token=hidden', error_msg: 'Bearer secret-value https://example.test/path?token=hidden' } },
      { recordId: 'empty-callback', seq: 2, kind: 'SDK_CALLBACK', phase: 'show.resolve', eventAt: new Date().toISOString(), payload: null }]
  };
  const post = (body: typeof payload, authorization = `Bearer ${token}`) => app.inject({ method: 'POST', url: path, headers: { authorization }, payload: body });
  const first = await post(payload);
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().accepted, 2);
  const saved = records.get('trace-test:record-test')?.payload;
  assert.equal(saved?.authorization, '[REDACTED]');
  assert.equal(saved?.error_code, 101150000);
  assert.equal(saved?.sub_error_code, 50008);
  assert.equal(records.get('trace-test:record-test')?.errorCode, '101150000');
  assert.equal(records.get('trace-test:record-test')?.subErrorCode, '50008');
  assert.equal(saved?.path, '/episodes');
  assert.ok(records.has('trace-test:empty-callback'));
  assert.equal(String(saved?.error_msg).includes('secret-value'), false);
  const duplicate = await post(payload);
  assert.equal(duplicate.json().accepted, 0);
  const otherUser = app.jwt.sign({ sub: 'other-viewer', kind: 'user', appKey: 'heartreel' });
  const conflicting = await post(payload, `Bearer ${otherUser}`);
  assert.equal(conflicting.statusCode, 409);
  const otherRelease = await post({ ...payload, traceId: 'other-trace', releaseId: 'heartreel-v005-test' });
  assert.equal(otherRelease.statusCode, 400);
  const unauthenticated = await app.inject({ method: 'POST', url: path, payload });
  assert.equal(unauthenticated.statusCode, 401);
  await app.close();
});
