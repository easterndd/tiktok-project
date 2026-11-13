import assert from 'node:assert/strict';
import { it } from 'node:test';
import { preflightKeys, requiredV006Migrations, requiredV006DualMigrations, validateV006Schema, type V006SchemaSnapshot } from './check-v006-schema';

const appliedAt = new Date('2026-11-09T00:00:00.000Z');
const snapshot: V006SchemaSnapshot = {
  schema: 'heartreel',
  migrations: requiredV006Migrations.map((migration_name) => ({ migration_name, finished_at: appliedAt, rolled_back_at: null })),
  columns: Object.entries({
    AdPlacementPair: ['id', 'releaseId', 'adType', 'primaryPlacementId', 'backupPlacementId', 'enabled', 'iosLoadMode', 'androidLoadMode', 'iosExperimentPercent', 'version'],
    RewardedUnlockSession: ['allowedPlacementIds', 'placementPolicyVersion', 'adLoadMode', 'strategyVariant'],
    AppEntryAdSession: ['allowedPlacementIds', 'placementPolicyVersion', 'adLoadMode', 'strategyVariant'],
    AppEntryAdPolicy: ['episodeInterstitialEnabled'],
    ClientAnalyticsEvent: ['adType', 'operationId', 'attemptNo', 'adPhase', 'errorOrigin', 'strategyVariant', 'placementRole'],
    PlaybackQualityEvent: ['platform', 'tiktokClientVersion', 'stage', 'playerOperationId', 'preloadHit']
  }).flatMap(([table_name, names]) => names.map((column_name) => ({
    table_name, column_name,
    is_nullable: ['RewardedUnlockSession', 'AppEntryAdSession', 'AppEntryAdPolicy'].includes(table_name) ? 'NO' : 'YES',
    column_default: table_name === 'AppEntryAdPolicy' ? 'true'
      : ['RewardedUnlockSession', 'AppEntryAdSession'].includes(table_name) ? '1' : null
  }))),
  indexes: [
    'AdPlacementPair_releaseId_adType_primaryPlacementId_key',
    'ClientAnalyticsEvent_miniAppKey_operationId_idx',
    'ClientAnalyticsEvent_release_os_event_idx',
    'PlaybackQualityEvent_playerOperationId_createdAt_idx'
  ]
};

it('accepts a fully migrated Mini app database', () => {
  assert.deepEqual(validateV006Schema(snapshot, 'heartreel'), []);
});

it('requires the new entry trace migration only for a dual-release target', () => {
  assert.deepEqual(validateV006Schema(snapshot, 'heartreel'), []);
  const issues = validateV006Schema(snapshot, 'heartreel', true);
  assert.ok(issues.some((issue) => issue.includes(requiredV006DualMigrations[0])));
  assert.ok(issues.some((issue) => issue.includes('ClientTraceRecord.payload')));
  assert.ok(issues.some((issue) => issue.includes('EntryAdObservation_sessionId_clientEventId_eventType_key')));
});

it('fails closed on a pending migration, unsafe legacy default, missing column, index, or wrong schema', () => {
  const result = validateV006Schema({
    ...snapshot,
    schema: 'public',
    migrations: snapshot.migrations.map((row) => row.migration_name === requiredV006Migrations[2]
      ? { ...row, finished_at: null } : row),
    columns: snapshot.columns.filter((column) => column.column_name !== 'allowedPlacementIds').map((column) =>
      column.table_name === 'AppEntryAdPolicy' ? { ...column, column_default: 'false' }
        : column.table_name === 'AppEntryAdSession' && column.column_name === 'adLoadMode' ? { ...column, column_default: null } : column),
    indexes: snapshot.indexes.filter((index) => !index.startsWith('PlaybackQualityEvent_'))
  }, 'heartreel');
  assert.ok(result.some((issue) => issue.startsWith('schema mismatch:')));
  assert.ok(result.some((issue) => issue.includes(requiredV006Migrations[2])));
  assert.ok(result.some((issue) => issue.includes('RewardedUnlockSession.allowedPlacementIds')));
  assert.ok(result.some((issue) => issue.includes('AppEntryAdSession.adLoadMode')));
  assert.ok(result.some((issue) => issue.includes('AppEntryAdPolicy.episodeInterstitialEnabled')));
  assert.ok(result.some((issue) => issue.includes('PlaybackQualityEvent_playerOperationId_createdAt_idx')));
});

it('requires the expected target and checks every configured app', () => {
  const configured = ['main', 'heartreel', 'taletv'] as const;
  assert.deepEqual(preflightKeys(configured, ['heartreel']), configured);
  assert.throws(() => preflightKeys(configured, []), /--expect/);
  assert.throws(() => preflightKeys(configured, ['sweetreel']), /sweetreel/);
});
