import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { configuredMiniAppKeys, miniAppEnvironment, miniAppKeys, type MiniAppKey } from '../config/mini-apps';
import { loadEnv } from '../config/env';
import { supportsV006DualApp } from '../modules/ads/ad-placement-policy';

export const requiredV006Migrations = [
  '20261106090000_client_analytics_event',
  '20261107090000_preserve_episode_interstitial_default',
  '20261109090000_v006_ads_player_observability',
  '20261110090000_v006_analytics_indexes'
] as const;
export const requiredV006DualMigrations = ['20261110180000_entry_trace_v2'] as const;

const requiredColumns: Record<string, readonly string[]> = {
  AdPlacementPair: ['id', 'releaseId', 'adType', 'primaryPlacementId', 'backupPlacementId', 'enabled', 'iosLoadMode', 'androidLoadMode', 'iosExperimentPercent', 'version'],
  RewardedUnlockSession: ['allowedPlacementIds', 'placementPolicyVersion', 'adLoadMode', 'strategyVariant'],
  AppEntryAdSession: ['allowedPlacementIds', 'placementPolicyVersion', 'adLoadMode', 'strategyVariant'],
  AppEntryAdPolicy: ['episodeInterstitialEnabled'],
  ClientAnalyticsEvent: ['adType', 'operationId', 'attemptNo', 'adPhase', 'errorOrigin', 'strategyVariant', 'placementRole'],
  PlaybackQualityEvent: ['platform', 'tiktokClientVersion', 'stage', 'playerOperationId', 'preloadHit']
};

const requiredIndexes = [
  'AdPlacementPair_releaseId_adType_primaryPlacementId_key',
  'ClientAnalyticsEvent_miniAppKey_operationId_idx',
  'ClientAnalyticsEvent_release_os_event_idx',
  'PlaybackQualityEvent_playerOperationId_createdAt_idx'
] as const;
const requiredDualColumns: Record<string, readonly string[]> = {
  AppEntryAdSession: ['clientReportedShownCount', 'clientReportedCompletedCount', 'clientReportedAt'],
  EntryAdObservation: ['sessionId', 'clientEventId', 'adIndex', 'placementId', 'eventType', 'occurredAt', 'receivedAt'],
  ClientTraceSession: ['id', 'miniAppKey', 'releaseId', 'userId', 'platform', 'startedAt', 'lastEventAt'],
  ClientTraceRecord: ['traceId', 'recordId', 'seq', 'kind', 'phase', 'eventAt', 'receivedAt', 'payload', 'truncated', 'errorCode', 'subErrorCode']
};
const requiredDualIndexes = [
  'EntryAdObservation_sessionId_clientEventId_eventType_key',
  'ClientTraceRecord_traceId_recordId_key',
  'ClientTraceRecord_traceId_seq_idx',
  'ClientTraceRecord_errorCode_eventAt_idx',
  'ClientTraceSession_miniAppKey_releaseId_lastEventAt_idx',
  'ClientTraceSession_lastEventAt_idx'
] as const;

export type V006SchemaSnapshot = {
  schema: string | null;
  migrations: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>;
  columns: Array<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>;
  indexes: string[];
};

export function validateV006Schema(snapshot: V006SchemaSnapshot, expectedSchema: string, requireDual = false): string[] {
  const issues: string[] = [];
  if (snapshot.schema !== expectedSchema) issues.push(`schema mismatch: expected ${expectedSchema}, got ${snapshot.schema ?? 'none'}`);

  for (const name of [...requiredV006Migrations, ...(requireDual ? requiredV006DualMigrations : [])]) {
    const rows = snapshot.migrations.filter((row) => row.migration_name === name);
    if (!rows.some((row) => row.finished_at && !row.rolled_back_at)) issues.push(`migration not applied: ${name}`);
    if (rows.some((row) => !row.finished_at && !row.rolled_back_at)) issues.push(`migration failed or in progress: ${name}`);
  }

  const actualColumns = new Map(snapshot.columns.map((column) => [`${column.table_name}.${column.column_name}`, column]));
  for (const [table, names] of Object.entries(requiredColumns)) {
    for (const name of names) {
      const column = actualColumns.get(`${table}.${name}`);
      if (!column) issues.push(`missing column: ${table}.${name}`);
      else if (table === 'RewardedUnlockSession' || table === 'AppEntryAdSession') {
        if (column.is_nullable !== 'NO' || !column.column_default) issues.push(`unsafe legacy insert: ${table}.${name} lacks NOT NULL DEFAULT`);
      } else if (table === 'AppEntryAdPolicy' && (column.is_nullable !== 'NO' || column.column_default !== 'true')) {
        issues.push('unsafe legacy policy default: AppEntryAdPolicy.episodeInterstitialEnabled');
      }
    }
  }
  if (requireDual) {
    for (const [table, names] of Object.entries(requiredDualColumns)) {
      for (const name of names) if (!actualColumns.has(`${table}.${name}`)) issues.push(`missing column: ${table}.${name}`);
    }
    for (const name of ['clientReportedShownCount', 'clientReportedCompletedCount']) {
      const column = actualColumns.get(`AppEntryAdSession.${name}`);
      if (column && (column.is_nullable !== 'NO' || !column.column_default)) issues.push(`unsafe legacy insert: AppEntryAdSession.${name} lacks NOT NULL DEFAULT`);
    }
  }

  const actualIndexes = new Set(snapshot.indexes);
  for (const name of [...requiredIndexes, ...(requireDual ? requiredDualIndexes : [])]) {
    if (!actualIndexes.has(name)) issues.push(`missing index: ${name}`);
  }
  return issues;
}

async function inspectDatabase(databaseUrl: string): Promise<V006SchemaSnapshot> {
  const probeUrl = new URL(databaseUrl);
  probeUrl.searchParams.set('connection_limit', '1');
  probeUrl.searchParams.set('pool_timeout', '3');
  probeUrl.searchParams.set('connect_timeout', '3');
  const client = new PrismaClient({ datasources: { db: { url: probeUrl.toString() } } });
  try {
    const schemaRows = await client.$queryRaw<Array<{ schema: string | null }>>`SELECT current_schema() AS schema`;
    const migrations = await client.$queryRaw<V006SchemaSnapshot['migrations']>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
    const columns = await client.$queryRaw<V006SchemaSnapshot['columns']>`
      SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('AdPlacementPair', 'RewardedUnlockSession', 'AppEntryAdSession', 'AppEntryAdPolicy', 'ClientAnalyticsEvent', 'PlaybackQualityEvent', 'EntryAdObservation', 'ClientTraceSession', 'ClientTraceRecord')
    `;
    const indexes = await client.$queryRaw<Array<{ indexname: string }>>`
      SELECT index_class.relname AS indexname
      FROM pg_index index_data
      JOIN pg_class index_class ON index_class.oid = index_data.indexrelid
      JOIN pg_namespace index_schema ON index_schema.oid = index_class.relnamespace
      WHERE index_schema.nspname = current_schema()
        AND index_data.indisvalid AND index_data.indisready
        AND index_class.relname IN (
          'AdPlacementPair_releaseId_adType_primaryPlacementId_key',
          'ClientAnalyticsEvent_miniAppKey_operationId_idx',
          'ClientAnalyticsEvent_release_os_event_idx',
          'PlaybackQualityEvent_playerOperationId_createdAt_idx',
          'EntryAdObservation_sessionId_clientEventId_eventType_key',
          'ClientTraceRecord_traceId_recordId_key',
          'ClientTraceRecord_traceId_seq_idx',
          'ClientTraceRecord_errorCode_eventAt_idx',
          'ClientTraceSession_miniAppKey_releaseId_lastEventAt_idx',
          'ClientTraceSession_lastEventAt_idx'
        )
    `;
    return { schema: schemaRows[0]?.schema ?? null, migrations, columns, indexes: indexes.map((index) => index.indexname) };
  } finally {
    await client.$disconnect();
  }
}

export function preflightKeys(configured: readonly MiniAppKey[], expected: readonly MiniAppKey[]) {
  if (!expected.length) throw new Error('Pass --expect=<mini-app-key>[,<mini-app-key>...] for the planned rollout.');
  const missing = expected.filter((key) => !configured.includes(key));
  if (missing.length) throw new Error(`Expected Mini apps are absent from this API environment: ${missing.join(', ')}`);
  return configured;
}

async function main() {
  const { values } = parseArgs({ options: { expect: { type: 'string' } }, strict: true });
  const expected = (values.expect ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  if (expected.some((key) => !miniAppKeys.includes(key as MiniAppKey)) || new Set(expected).size !== expected.length) {
    throw new Error('The --expect list contains an unknown or repeated Mini app key.');
  }
  const env = loadEnv();
  const keys = preflightKeys(configuredMiniAppKeys(env), expected as MiniAppKey[]);
  let failed = false;
  for (const key of keys) {
    const appEnv = miniAppEnvironment(env, key);
    if (!appEnv) throw new Error(`Missing database configuration for ${key}.`);
    const expectedSchema = new URL(appEnv.DATABASE_URL).searchParams.get('schema') ?? 'public';
    try {
      const issues = validateV006Schema(await inspectDatabase(appEnv.DATABASE_URL), expectedSchema, supportsV006DualApp(key) && expected.includes(key));
      if (issues.length) {
        failed = true;
        console.error(`${key}: FAIL (${issues.join('; ')})`);
      } else console.log(`${key}: PASS (${expectedSchema})`);
    } catch (error) {
      failed = true;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'QUERY_FAILED';
      console.error(`${key}: FAIL (read-only schema query: ${code})`);
    }
  }
  console.log(`Checked ${keys.length} configured Mini app database(s).`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'v0.0.6 schema preflight failed.');
    process.exitCode = 1;
  });
}
