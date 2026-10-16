import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createShownAcknowledgement } from '../src/features/ads/shown-acknowledgement.ts';

it('starts SHOWN while viewing and shares an in-flight request with completion', async () => {
  let calls = 0;
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const confirm = createShownAcknowledgement(() => { calls++; return response; });
  await Promise.resolve();
  assert.equal(calls, 1);
  let finished = false;
  const completion = Promise.all([confirm(), confirm()]).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls, 1);
  resolve();
  await completion;
  await confirm();
  assert.equal(calls, 1);
});

it('retries a failed SHOWN request at completion and preserves failures for another attempt', async () => {
  let calls = 0;
  const confirm = createShownAcknowledgement(async () => {
    if (++calls < 3) throw new Error('offline');
  });
  // Let the background request finish before the ad closes.
  await new Promise(setImmediate);
  await assert.rejects(confirm(), /offline/);
  await confirm();
  await confirm();
  assert.equal(calls, 3);
});

it('handles a synchronous reporting error without losing the retry', async () => {
  let calls = 0;
  const confirm = createShownAcknowledgement(() => {
    if (++calls === 1) throw new Error('transport unavailable');
    return Promise.resolve();
  });
  await new Promise(setImmediate);
  await confirm();
  assert.equal(calls, 2);
});
