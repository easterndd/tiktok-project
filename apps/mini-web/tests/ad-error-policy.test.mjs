import assert from 'node:assert/strict';
import { it } from 'node:test';
import { classifyAdFailure, normalizeErrorOrigin, taggedAdFailure } from '../src/features/ads/ad-error-policy.ts';

it('switches to the backup only for an SDK no-fill result', () => {
  assert.equal(classifyAdFailure(taggedAdFailure('NO_FILL', 'SDK_PROMISE'), 'SDK_PROMISE'), 'TRY_BACKUP_ONCE');
  assert.equal(classifyAdFailure(taggedAdFailure('50008 env check failed', 'SDK_CALLBACK'), 'SDK_CALLBACK'), 'STOP');
  assert.equal(classifyAdFailure(taggedAdFailure('11006 active ad', 'SDK_CALLBACK'), 'SDK_CALLBACK'), 'STOP');
  assert.equal(classifyAdFailure(new Error('NO_FILL'), 'API_HTTP'), 'STOP');
});

it('keeps callback, Promise, timeout, and API errors distinct', () => {
  assert.equal(normalizeErrorOrigin(taggedAdFailure('NO_FILL', 'SDK_CALLBACK')), 'SDK_CALLBACK');
  assert.equal(normalizeErrorOrigin(taggedAdFailure('NO_FILL', 'SDK_PROMISE')), 'SDK_PROMISE');
  assert.equal(normalizeErrorOrigin(new Error('AD_SHOW_TIMEOUT'), 'onError'), 'APP_TIMEOUT');
  assert.equal(normalizeErrorOrigin({ status: 500 }, 'show.reject'), 'API_HTTP');
});
