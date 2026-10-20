import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import { registerDiagnosticRoutes } from './routes';

it('accepts startup errors without a session and strips secrets and query strings', async () => {
  const saved: unknown[] = [];
  const app = Fastify();
  app.decorate('prisma', { miniAppRuntimeError: { create: async (value: unknown) => { saved.push(value); return value; } } } as never);
  await app.register(registerDiagnosticRoutes, { prefix: '/api/talereels/v1' });
  const response = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'STARTUP', phase: 'AUTH', message: 'Bearer secret https://example.test/path?token=abc', path: '/episodes?token=abc', releaseId: 'talereels-build-1' } });
  assert.equal(response.statusCode, 202);
  const data = (saved[0] as { data: { message: string; path: string; releaseId: string } }).data;
  assert.equal(data.message, 'Bearer [REDACTED] [URL]');
  assert.equal(data.path, '/episodes');
  assert.equal(data.releaseId, 'talereels-build-1');
  const invalid = await app.inject({ method: 'POST', url: '/api/talereels/v1/runtime-errors', payload: { kind: 'UNKNOWN', phase: 'AUTH', message: 'broken' } });
  assert.equal(invalid.statusCode, 500);
  assert.equal(saved.length, 1);
  await app.close();
});
