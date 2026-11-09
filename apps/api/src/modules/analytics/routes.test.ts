import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import { registerAnalyticsRoutes } from './routes';

it('accepts a bounded batch, redacts SDK diagnostics, and uses event idempotency', async () => {
  const batches: unknown[] = [];
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof Error && error.name === 'ZodError' ? 400 : 500).send());
  app.decorate('config', { MINI_APP_KEY: 'heartreel' } as never);
  app.decorateRequest('jwtVerify', async function(this: { user: unknown }) { this.user = { kind: 'user', appKey: 'heartreel', sub: 'user-1' }; });
  app.decorate('prisma', { clientAnalyticsEvent: { createMany: async (value: unknown) => { batches.push(value); return { count: 2 }; } } } as never);
  await app.register(registerAnalyticsRoutes, { prefix: '/api/heartreel/v1' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/heartreel/v1/analytics/events',
    payload: { events: [
      { eventId: 'event-000001', eventKey: 'ad_show', releaseId: 'heartreel-build-1', placementId: 'ad-1', adType: 'REWARDED', operationId: 'reward-unique-1', attemptNo: 1, errorOrigin: 'SDK_CALLBACK', result: 'fail', errorCode: '50008', errorMsg: 'token=secret https://example.test/path?x=1', errorExtra: { accessToken: 'secret', inner_error_code: 'E1' }, metadata: { sdkCallback: { name: 'onError', capturedAt: '2026-11-07T07:17:56.298Z', payload: { errorCode: '50008', errMsg: 'env check failed', subErrorCode: 'E1', errorExtra: { trace: 'short' }, authorization: 'secret' } } } },
      { eventId: 'event-000002', eventKey: 'ad_close', releaseId: 'heartreel-build-1', placementId: 'ad-1', isEnded: null, durationMs: 1200 }
    ] }
  });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { accepted: 2, received: 2 });
  const data = (batches[0] as { data: Array<{ errorMsg?: string; errorExtra?: Record<string, unknown>; metadata?: { sdkCallback?: { name: string; payload?: Record<string, unknown> } }; eventKey: string; adType?: string; operationId?: string; errorOrigin?: string }> }).data;
  assert.equal(data[0].errorMsg, 'token=[REDACTED] [URL]');
  assert.equal(data[0].errorExtra?.accessToken, '[REDACTED]');
  assert.equal(data[0].metadata?.sdkCallback?.name, 'onError');
  assert.equal(data[0].metadata?.sdkCallback?.payload?.errorCode, '50008');
  assert.equal(data[0].metadata?.sdkCallback?.payload?.authorization, '[REDACTED]');
  assert.equal(data[0].adType, 'REWARDED');
  assert.equal(data[0].operationId, 'reward-unique-1');
  assert.equal(data[0].errorOrigin, 'SDK_CALLBACK');
  assert.equal(data[1].eventKey, 'ad_close');
  await app.close();
});

it('rejects an ad close without the explicit interstitial/rewarded completion state', async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof Error && error.name === 'ZodError' ? 400 : 500).send());
  app.decorate('config', { MINI_APP_KEY: 'heartreel' } as never);
  app.decorateRequest('jwtVerify', async function(this: { user: unknown }) { this.user = { kind: 'user', appKey: 'heartreel', sub: 'user-1' }; });
  app.decorate('prisma', { clientAnalyticsEvent: { createMany: async () => ({ count: 0 }) } } as never);
  await app.register(registerAnalyticsRoutes, { prefix: '/api/heartreel/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/heartreel/v1/analytics/events', payload: {
    events: [{ eventId: 'event-000003', eventKey: 'ad_close', releaseId: 'build', placementId: 'ad-1' }]
  } });
  assert.equal(response.statusCode, 400);
  await app.close();
});

it('requires a matching user session even for app_open', async () => {
  const app = Fastify();
  app.decorate('config', { MINI_APP_KEY: 'heartreel' } as never);
  app.decorateRequest('jwtVerify', async () => { throw new Error('No session'); });
  app.decorate('prisma', { clientAnalyticsEvent: { createMany: async () => { throw new Error('Must not write'); } } } as never);
  await app.register(registerAnalyticsRoutes, { prefix: '/api/heartreel/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/heartreel/v1/analytics/events', payload: {
    events: [{ eventId: 'event-000004', eventKey: 'app_open', releaseId: 'build' }]
  } });
  assert.equal(response.statusCode, 401);
  await app.close();
});
