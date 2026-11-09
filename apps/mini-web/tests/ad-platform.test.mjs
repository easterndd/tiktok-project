import assert from 'node:assert/strict';
import { it } from 'node:test';

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
const listeners = new Map();
let eventName;
let showCallback;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(name, callback) { listeners.set(name, callback); }
};
const minis = {
  on(name, callback) { eventName = name; showCallback = callback; return 'show-listener'; },
  onShow() { assert.fail('the documented event API should be preferred'); }
};
globalThis.window = { TTMinis: undefined };
const { subscribeMiniForeground } = await import('../src/features/ads/ad-platform.ts');

it('registers minis.show after a late SDK injection and unsubscribes component callbacks', async () => {
  let foregroundEvents = 0;
  try {
    const unsubscribeEarly = subscribeMiniForeground(() => { foregroundEvents += 1; });
    assert.equal(eventName, undefined);
    globalThis.window.TTMinis = minis;
    await new Promise((resolve) => setTimeout(resolve, 275));
    assert.equal(eventName, 'minis.show');
    assert.equal(typeof listeners.get('visibilitychange'), 'function');
    showCallback();
    assert.equal(foregroundEvents, 1);
    unsubscribeEarly();
    showCallback();
    assert.equal(foregroundEvents, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
