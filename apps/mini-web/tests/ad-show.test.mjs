import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runAdShow } from '../src/features/ads/ad-show.ts';

it('does not classify a failed SHOWN acknowledgement as an SDK failure', async () => {
  const calls = [];
  await runAdShow(async () => calls.push('displayed'), async () => { throw new Error('HTTP 503'); },
    () => calls.push('sdk-failed'), (error) => calls.push(error.message));
  assert.deepEqual(calls, ['displayed', 'HTTP 503']);
});

it('classifies SDK rejection before attempting to acknowledge display', async () => {
  const calls = [];
  const sdkError = { errCode: 1003, errMsg: 'No ad fill' };
  await runAdShow(async () => { throw sdkError; }, async () => calls.push('acknowledged'),
    (error) => calls.push(error), () => calls.push('report-failed'));
  assert.deepEqual(calls, [sdkError]);
});

it('catches synchronous SDK throws and acknowledges successful display once', async () => {
  const calls = [];
  await runAdShow(() => { throw new Error('SDK unavailable'); }, async () => calls.push('unexpected'),
    (error) => calls.push(error.message), () => calls.push('unexpected'));
  await runAdShow(async () => calls.push('displayed'), async () => calls.push('acknowledged'),
    () => calls.push('unexpected'), () => calls.push('unexpected'));
  assert.deepEqual(calls, ['SDK unavailable', 'displayed', 'acknowledged']);
});
