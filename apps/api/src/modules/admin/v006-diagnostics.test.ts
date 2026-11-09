import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { readV006AdDiagnostics, readV006PlayerDiagnostics, parseV006DiagnosticsQuery } from './v006-diagnostics';

it('bounds diagnostic queries to the last 72 hours', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');
  assert.equal(parseV006DiagnosticsQuery({ hours: 24 }, now).start.toISOString(), '2026-11-08T12:00:00.000Z');
  assert.throws(() => parseV006DiagnosticsQuery({ from: '2026-11-01T10:00:00.000Z', to: '2026-11-01T11:00:00.000Z' }, now), { statusCode: 400 });
  assert.throws(() => parseV006DiagnosticsQuery({ hours: 73 }, now));
  assert.throws(() => parseV006DiagnosticsQuery({ from: '2026-11-09T11:00:00.000Z', to: '2026-11-09T10:00:00.000Z' }, now), { statusCode: 400 });
});

it('uses parameterized app, release, platform, type, and operation filters', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const app = {
    config: { MINI_APP_KEY: 'heartreel' },
    prisma: { $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return [];
    } }
  } as unknown as FastifyInstance;
  const input = { releaseId: 'heartreel-v006-test', platform: 'ios', adType: 'REWARDED', operationId: 'reward-test' };
  const ads = await readV006AdDiagnostics(app, input);
  assert.deepEqual(ads.summary, []);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /GROUP BY 1, 2, 3, 4, 5, 6/);
    assert.ok(query.values.includes('heartreel'));
    assert.ok(query.values.includes(input.releaseId));
    assert.ok(query.values.includes(input.platform));
    assert.ok(query.values.includes(input.adType));
    assert.ok(query.values.includes(input.operationId));
    assert.equal(query.sql.includes(input.operationId), false);
  }
  queries.length = 0;
  await readV006PlayerDiagnostics(app, { releaseId: input.releaseId, platform: input.platform, operationId: input.operationId });
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /GROUP BY 1, 2/);
  assert.match(queries[1].sql, /GROUP BY 1, 2, 3, 4/);
});
