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
  assert.equal(pooled.searchParams.get('connection_limit'), '3');
  assert.equal(pooled.searchParams.get('pool_timeout'), '20');
});
