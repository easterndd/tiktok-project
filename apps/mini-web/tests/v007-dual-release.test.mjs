import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isClientDualRelease, isEnhancedAdRelease, isLaunchAttributionRelease } from '../src/features/ads/ad-platform.ts';
import { v007Placements, validateV007Placements } from '../scripts/v007-placements.mjs';
import { v006Placements } from '../scripts/v006-placements.mjs';

it('activates the DramaFlicks dual protocol only for the new six-app release IDs', () => {
  assert.equal(validateV007Placements(v006Placements), true);
  for (const [appKey, placement] of Object.entries(v007Placements)) {
    const releaseId = `${appKey}-v007-dual-test`;
    assert.equal(isClientDualRelease(releaseId), true);
    assert.equal(isEnhancedAdRelease(releaseId), true);
    assert.equal(isLaunchAttributionRelease(releaseId), true);
    assert.equal(placement.rewarded.length, 2);
    assert.equal(placement.interstitial.length, 2);
    assert.equal(isClientDualRelease(`${appKey}-attr1-test`), false);
  }
  assert.equal(isEnhancedAdRelease('zenclip-v005-test'), false);
});
