import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLaunchAttribution } from './launch-attribution.service';

test('classifies a valid adId in the raw WebView URL', () => {
  assert.deepEqual(classifyLaunchAttribution({ rawUrl: 'https://example.test/?ttoclid=preview&adId=1879822310597858' }), {
    status: 'ATTRIBUTED', adId: '1879822310597858', reason: 'VALID_AD_ID'
  });
});

test('classifies preview-code traffic without adId as unattributed', () => {
  assert.deepEqual(classifyLaunchAttribution({ rawUrl: 'https://example.test/?ttoclid=fd007e49-593a-4c61-84c3-326c913a8609' }), {
    status: 'UNATTRIBUTED', adId: null, reason: 'MISSING_AD_ID'
  });
});

test('rejects common adId placeholders', () => {
  for (const adId of ['', '__ADID__', '{{ad_id}}', 'undefined', '0']) {
    assert.equal(classifyLaunchAttribution({ launchQuery: { adId } }).status, 'UNATTRIBUTED');
  }
});
