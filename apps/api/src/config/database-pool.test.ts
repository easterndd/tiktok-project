import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runtimeDatabaseUrl } from './database-pool';

it('preserves direct migration URLs unless a runtime pooler is configured', () => {
  const direct = 'postgresql://user:password@postgres:5432/quickreels?schema=talereels&connection_limit=1';
  assert.equal(runtimeDatabaseUrl(direct), direct);
  const pooled = new URL(runtimeDatabaseUrl(direct, 'pgbouncer'));
  assert.equal(pooled.host, 'pgbouncer:6432');
  assert.equal(pooled.pathname, '/quickreels__talereels');
  assert.equal(pooled.searchParams.get('schema'), 'talereels');
  assert.equal(pooled.searchParams.get('connection_limit'), '2');
  assert.equal(pooled.searchParams.get('pool_timeout'), '20');
});

it('budgets API and worker connections for a 47-app blue-green rollout', () => {
  const source = 'postgresql://test:test@postgres:5432/test?schema=public';
  assert.equal(new URL(runtimeDatabaseUrl(source, 'pgbouncer', 6432, 1)).searchParams.get('connection_limit'), '1');
  assert.equal(new URL(runtimeDatabaseUrl(source, 'pgbouncer', 6432, 2)).searchParams.get('connection_limit'), '2');
  assert.ok(47 * (2 + 2 + 1) + 2 < 300, 'two APIs, one worker and health probes leave pooler capacity');
  assert.throws(() => runtimeDatabaseUrl(source, 'pgbouncer', 6432, 0), /connection limit/);
});
