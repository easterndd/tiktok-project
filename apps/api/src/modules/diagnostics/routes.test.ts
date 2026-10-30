import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import { registerDiagnosticRoutes } from './routes';

it('accepts startup errors without a session and strips secrets and query strings', async () => {
  const saved: unknown[] = [];
  const app = Fastify();
  app.decorate('rootConfig', { MINI_APP_KEY: 'talereels', PERSIST_CLIENT_AD_DIAGNOSTICS: true } as never);
  app.decorate('prisma', { miniAppRuntimeError: { create: async (value: unknown) => { saved.push(value); return value; } } } as never);
  await app.register(registerDiagnosticRoutes, { prefix: '/api/talereels/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'STARTUP', phase: 'AUTH', message: 'Bearer secret https://example.test/path?token=abc', path: '/episodes?token=abc', releaseId: 'talereels-build-1' } });
  assert.equal(response.statusCode, 202);
  const data = (saved[0] as { data: { message: string; path: string; releaseId: string } }).data;
  assert.equal(data.message, 'Bearer [REDACTED] [URL]');
  assert.equal(data.path, '/episodes');
  assert.equal(data.releaseId, 'talereels-build-1');
  const duplicate = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'STARTUP', phase: 'AUTH', message: 'Bearer secret https://example.test/path?token=abc', path: '/episodes?token=abc', releaseId: 'talereels-build-1' } });
  assert.equal(duplicate.statusCode, 202);
  assert.deepEqual(duplicate.json(), { accepted: true, deduplicated: true });
  const invalid = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'UNKNOWN', phase: 'AUTH', message: 'broken' } });
  assert.equal(invalid.statusCode, 500);
  assert.equal(saved.length, 1);
  await app.close();
});

it('acknowledges client ad diagnostics without persisting them when disabled', async () => {
  const saved: unknown[] = [];
  const app = Fastify();
  app.decorate('rootConfig', { MINI_APP_KEY: 'talereels', PERSIST_CLIENT_AD_DIAGNOSTICS: false } as never);
  app.decorate('prisma', { miniAppRuntimeError: { create: async (value: unknown) => { saved.push(value); return value; } } } as never);
  await app.register(registerDiagnosticRoutes, { prefix: '/api/talereels/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'AD', phase: 'ENTRY_AD_PLAYBACK', message: 'AD_SHOW_FAILED', releaseId: 'talereels-build-1' } });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { accepted: true, dropped: true });
  assert.equal(saved.length, 0);
  await app.close();
});

it('short-circuits disabled ad diagnostics before validating the payload', async () => {
  const saved: unknown[] = [];
  const app = Fastify();
  app.decorate('rootConfig', { MINI_APP_KEY: 'talereels', PERSIST_CLIENT_AD_DIAGNOSTICS: false } as never);
  app.decorate('prisma', { miniAppRuntimeError: { create: async (value: unknown) => { saved.push(value); return value; } } } as never);
  await app.register(registerDiagnosticRoutes, { prefix: '/api/talereels/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'AD' } });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { accepted: true, dropped: true });
  assert.equal(saved.length, 0);
  await app.close();
});
