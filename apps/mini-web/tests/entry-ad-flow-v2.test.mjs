import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

const previousStorage = globalThis.sessionStorage;
const values = new Map();
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/features/ads/')) {
      if (specifier === './ad-platform') return { url: `data:text/javascript,${encodeURIComponent(`
        export const getAdPlatform = () => globalThis.__v2TestPlatform;
        export const isMiniPageVisible = () => globalThis.__v2TestVisible !== false;
        export const noteMiniForegroundRejection = () => { globalThis.__v2TestForegroundRejections = (globalThis.__v2TestForegroundRejections || 0) + 1; };
        export const waitForMiniForeground = async () => globalThis.__v2TestWaitForForeground ? globalThis.__v2TestWaitForForeground() : true;
      `)}`, shortCircuit: true };
      if (specifier === '../../lib/app-brand') return { url: `data:text/javascript,${encodeURIComponent('export const storagePrefix = "test";')}`, shortCircuit: true };
      if (specifier.startsWith('./') && !/\.(?:ts|tsx|js)$/.test(specifier)) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  }
});
const { runEntryAdFlowV2 } = await import('../src/features/ads/entry-ad-flow-v2.ts');
after(() => {
  hooks.deregister();
  globalThis.sessionStorage = previousStorage;
  delete globalThis.__v2TestPlatform;
  delete globalThis.__v2TestForegroundRejections;
  delete globalThis.__v2TestWaitForForeground;
  delete globalThis.__v2TestVisible;
});

function session(id, countMode = 'COMPLETED') {
  return {
    required: true, sessionId: id, placementId: 'primary', placementIds: ['primary', 'backup'],
    mode: 'REWARDED_GATED', countMode, requiredCount: 2, completedCount: 0,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), onUnavailable: 'BLOCK'
  };
}

it('counts Android completed ads locally and resumes the same session after a reload', async () => {
  globalThis.__v2TestPlatform = 'android';
  const seen = [];
  const observed = [];
  let active = true;
  const actions = {
    show: async (input) => {
      seen.push({ index: input.adIndex, placementId: input.placementId, fastHandoff: input.fastHandoff });
      const result = { clientEventId: `event-${input.adIndex}`, isEnded: true, placementId: input.placementId, adType: 'REWARDED' };
      input.onShown(result);
      if (input.adIndex === 1) active = false;
      return result;
    },
    observe: (value) => observed.push(value),
    isActive: () => active, onError: (error) => { throw error; }, wait: async () => {}
  };
  await runEntryAdFlowV2(session('android-reload'), actions);
  assert.deepEqual(seen, [{ index: 1, placementId: 'primary', fastHandoff: true }]);
  active = true;
  await runEntryAdFlowV2(session('android-reload'), actions);
  assert.deepEqual(seen[1], { index: 2, placementId: 'backup', fastHandoff: true });
  assert.deepEqual(observed.map((item) => item.eventType), ['SHOWN', 'CLOSED_COMPLETED', 'SHOWN', 'CLOSED_COMPLETED']);
  assert.equal(JSON.parse(values.get('test_entry_v2_android-reload')).completed, 2);
});

it('counts iOS SHOWN impressions locally even when the ad closes incomplete', async () => {
  globalThis.__v2TestPlatform = 'ios';
  const placements = [];
  await runEntryAdFlowV2(session('ios-shown', 'SHOWN'), {
    show: async (input) => {
      placements.push({ id: input.placementId, fastHandoff: input.fastHandoff });
      const result = { clientEventId: `event-${input.adIndex}`, isEnded: false, placementId: input.placementId, adType: 'REWARDED' };
      input.onShown(result);
      return result;
    }, observe: () => {}, isActive: () => true, onError: (error) => { throw error; }, wait: async () => {}
  });
  assert.deepEqual(placements, [{ id: 'primary', fastHandoff: false }, { id: 'primary', fastHandoff: false }]);
});

it('short-retries an Android busy SDK result on the same ad index', async () => {
  globalThis.__v2TestPlatform = 'android';
  let attempts = 0;
  const waits = [];
  await runEntryAdFlowV2({ ...session('android-busy'), requiredCount: 1 }, {
    show: async (input) => {
      attempts++;
      if (attempts === 1) throw new Error('104111006: ad already showing');
      const result = { clientEventId: 'event-busy', isEnded: true, placementId: input.placementId, adType: 'REWARDED' };
      input.onShown(result);
      return result;
    }, observe: () => {}, isActive: () => true, onError: () => {}, wait: async (ms) => { waits.push(ms); }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [100]);
});
