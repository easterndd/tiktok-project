import assert from 'node:assert/strict';
import { it } from 'node:test';
import { refreshAnalyticsDailySummaries, zonedMidnight } from './analytics-summary.service';
import { combinePlaybackSummaries } from './analytics-playback-summary';
import type { PrismaClient } from '@prisma/client';

it('finds local midnight across positive, negative and DST timezones', () => {
  const now = new Date('2026-10-16T03:00:00.000Z');
  assert.equal(zonedMidnight(now, 'Asia/Shanghai').toISOString(), '2026-10-15T16:00:00.000Z');
  assert.equal(zonedMidnight(now, 'America/Los_Angeles').toISOString(), '2026-10-15T07:00:00.000Z');
  assert.equal(zonedMidnight(now, 'Asia/Shanghai', '2026-10-16').toISOString(), '2026-10-15T16:00:00.000Z');
});

it('combines startup latency weighted by measured events', () => {
  const day = (startupCount: number, startupSum: number) => ({ startupCount, startupSum, bufferMs: 10, eventTypes: [{ key: 'FIRST_FRAME', count: startupCount }], definitions: [], networks: [] });
  const result = combinePlaybackSummaries([day(1, 100), day(9, 9000)]);
  assert.equal(result?.averageStartupMs, 910);
  assert.equal(result?.totalEvents, 10);
  assert.equal(result?.totalBufferMs, 20);
});

it('builds playback summaries from grouped aggregates and excludes null dimensions', async () => {
  let saved: any;
  let aggregateCalls = 0;
  const prisma = {
    $queryRaw: async (query: any) => {
      if (query.sql.includes('GROUPING SETS')) {
        aggregateCalls++;
        return [
          { grouping: 7, key: null, count: 3n, startupCount: 2n, startupSum: 300n, bufferMs: 7n },
          { grouping: 3, key: 'FIRST_FRAME', count: 2n }, { grouping: 3, key: 'ERROR', count: 1n },
          { grouping: 5, key: null, count: 1n }, { grouping: 5, key: 'HD', count: 2n },
          { grouping: 6, key: 'wifi', count: 2n }, { grouping: 6, key: null, count: 1n }
        ];
      }
      return [{ day: new Date('2026-10-16T00:00:00Z'), newUsers: 0n, activeUsers: 0n,
        watchSessions: 0n, completedEpisodes: 0n, favorites: 0n, shares: 0n, searches: 0n,
        playbackEvents: 0n, playbackErrors: 0n, adRequested: 0n, adShown: 0n, adFailed: 0n }];
    },
    analyticsDailySummary: { upsert: async (args: any) => { saved = args.create; } }
  } as unknown as PrismaClient;
  await refreshAnalyticsDailySummaries(prisma, { now: new Date('2026-10-16T12:00:00Z'), timezone: 'UTC', days: 1 });
  assert.equal(aggregateCalls, 1);
  assert.equal(saved.playbackSummary.startupCount, 2);
  assert.equal(saved.playbackSummary.startupSum, 300);
  assert.equal(saved.playbackSummary.bufferMs, 7);
  assert.deepEqual(saved.playbackSummary.eventTypes, [{ key: 'FIRST_FRAME', count: 2 }, { key: 'ERROR', count: 1 }]);
  assert.deepEqual(saved.playbackSummary.definitions, [{ key: 'HD', count: 2 }]);
  assert.deepEqual(saved.playbackSummary.networks, [{ key: 'wifi', count: 2 }]);
});
