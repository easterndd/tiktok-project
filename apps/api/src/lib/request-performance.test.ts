import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleResponseLog, type ResponseLogSampleCache } from './request-performance';

test('samples repeated response logs and reports suppressed counts', () => {
  const cache: ResponseLogSampleCache = new Map();

  assert.equal(sampleResponseLog(cache, '/home:200', 1_000, 10_000, 10), 0);
  assert.equal(sampleResponseLog(cache, '/home:200', 2_000, 10_000, 10), null);
  assert.equal(sampleResponseLog(cache, '/home:200', 3_000, 10_000, 10), null);
  assert.equal(sampleResponseLog(cache, '/home:200', 11_000, 10_000, 10), 2);
});

test('bounds the per-process response log sampling keys', () => {
  const cache: ResponseLogSampleCache = new Map();

  sampleResponseLog(cache, '/home:200', 1_000, 10_000, 2);
  sampleResponseLog(cache, '/search:200', 1_000, 10_000, 2);
  sampleResponseLog(cache, '/albums:200', 1_000, 10_000, 2);

  assert.equal(cache.size, 2);
  assert.equal(cache.has('/home:200'), false);
});
