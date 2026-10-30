import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/entry-ad-placements.ts') && specifier === '../../lib/app-brand') {
      return { url: `data:text/javascript,${encodeURIComponent('export const storagePrefix = "entry-ad-test";')}`, shortCircuit: true };
    }
    return next(specifier, context);
  }
});

const { chooseEntryAdPlacement, markEntryAdPlacementAccepted, parseEntryAdPlacementIds } = await import('../src/features/ads/entry-ad-placements.ts');
after(() => hooks.deregister());

it('accepts exactly two distinct TikTok rewarded placement IDs', () => {
  assert.deepEqual(parseEntryAdPlacementIds('ad123, ad456'), ['ad123', 'ad456']);
  assert.deepEqual(parseEntryAdPlacementIds('ad123'), []);
  assert.deepEqual(parseEntryAdPlacementIds('ad123,ad123'), []);
  assert.deepEqual(parseEntryAdPlacementIds('ad123, invalid'), []);
});

it('alternates placement IDs across accepted entry impressions', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const placements = ['ad123', 'ad456'];

  const first = chooseEntryAdPlacement(placements, storage);
  assert.equal(first.index, 0);
  markEntryAdPlacementAccepted(placements, first.index, storage);

  const second = chooseEntryAdPlacement(placements, storage);
  assert.equal(second.index, 1);
  markEntryAdPlacementAccepted(placements, second.index, storage);

  assert.equal(chooseEntryAdPlacement(placements, storage).index, 0);
});
