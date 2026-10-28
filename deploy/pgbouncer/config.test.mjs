import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPgBouncerConfig } from './config.mjs';

test('PgBouncer exposes bounded per-database and overflow pools', () => {
  const config = renderPgBouncerConfig('quickreels', ['heartreel', 'public']);

  assert.match(config, /quickreels__heartreel = host=postgres port=5432 dbname=quickreels/);
  assert.match(config, /default_pool_size = 4\n/);
  assert.match(config, /reserve_pool_size = 2\n/);
  assert.match(config, /reserve_pool_timeout = 1\n/);
  assert.match(config, /max_user_connections = 60\n/);
  assert.match(config, /pool_mode = transaction\nignore_startup_parameters = search_path\n/);
});

test('PgBouncer rejects unsafe database and schema names', () => {
  assert.throws(() => renderPgBouncerConfig('quickreels;DROP', ['public']), /Invalid PgBouncer database name/);
  assert.throws(() => renderPgBouncerConfig('quickreels', ['public;DROP']), /Unexpected database schema/);
  assert.throws(() => renderPgBouncerConfig('quickreels', ['heartreel']), /Unexpected database schema/);
});
