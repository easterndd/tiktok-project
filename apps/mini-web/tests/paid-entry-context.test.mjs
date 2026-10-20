import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isPaidStoryLandEntry } from '../src/features/ads/paid-entry-context.ts';

it('does not schedule an entry ad for preview, direct entry, or legal pages', () => {
  assert.equal(isPaidStoryLandEntry('', '/'), false);
  assert.equal(isPaidStoryLandEntry('?ad_entry=0', '/'), false);
  assert.equal(isPaidStoryLandEntry('?ad_entry=1', '/privacy'), false);
  assert.equal(isPaidStoryLandEntry('?ad_entry=1', '/terms'), false);
  assert.equal(isPaidStoryLandEntry('?ad_entry=1&ad_entry=0', '/'), false);
});

it('schedules one optional entry ad for an explicitly marked paid landing', () => {
  assert.equal(isPaidStoryLandEntry('?ad_entry=1', '/'), true);
  assert.equal(isPaidStoryLandEntry('?album=42&ad_entry=1', '/watch/42'), false);
});
