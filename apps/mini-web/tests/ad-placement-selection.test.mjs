import assert from 'node:assert/strict';
import { it } from 'node:test';
import { selectAdPlacement } from '../src/features/ads/ad-placement-selection.ts';

it('alternates authorized Android placements by business index', () => {
  const ids = ['primary', 'backup'];
  assert.deepEqual([1, 2, 3, 4].map((index) => selectAdPlacement(ids[0], ids, index, 'android', true)),
    ['primary', 'backup', 'primary', 'backup']);
  assert.equal(selectAdPlacement(ids[0], ids, 2, 'android', false), 'primary');
  assert.equal(selectAdPlacement(ids[0], ['primary'], 2, 'android', true), 'primary');
});

it('uses only the primary placement on iOS and unknown platforms', () => {
  const ids = ['primary', 'backup'];
  assert.equal(selectAdPlacement(ids[0], ids, 2, 'ios', true), 'primary');
  assert.equal(selectAdPlacement(ids[0], ids, 2, 'unknown', true), 'primary');
  assert.equal(selectAdPlacement(ids[0], ['backup'], 2, 'android', true), 'primary');
});
