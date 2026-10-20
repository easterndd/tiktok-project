import assert from 'node:assert/strict';
import { it } from 'node:test';
import { zonedMidnight } from './analytics-summary.service';
import { combinePlaybackSummaries } from './analytics-playback-summary';

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
