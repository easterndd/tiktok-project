import assert from 'node:assert/strict';
import { it } from 'node:test';
import { adTimeout, adErrorMessage } from '../src/features/ads/ad-timeout.ts';

it('times out an SDK show that never settles', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reason;
  const timer = adTimeout((error) => { reason = error.message; });
  t.mock.timers.tick(29_999);
  assert.equal(reason, undefined);
  t.mock.timers.tick(1);
  assert.equal(reason, 'AD_SHOW_TIMEOUT');
  timer.clear();
});

it('waits for close after show and removes the timer on cleanup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reason;
  const timer = adTimeout((error) => { reason = error.message; });
  timer.shown();
  t.mock.timers.tick(30_001);
  assert.equal(reason, undefined);
  t.mock.timers.tick(270_000);
  assert.equal(reason, 'AD_CLOSE_TIMEOUT');
  reason = undefined;
  const cleared = adTimeout(() => { reason = 'leaked'; });
  cleared.clear();
  t.mock.timers.tick(300_000);
  assert.equal(reason, undefined);
});

it('keeps the SDK error code and reason', () => {
  assert.equal(adErrorMessage({ errCode: 1003, errMsg: 'No ad fill' }), '1003: No ad fill');
});
