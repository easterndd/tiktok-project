import assert from 'node:assert/strict';
import { it } from 'node:test';
import { retainTraceRecord, traceSamplingDecision } from './routes';

it('samples consistently by trace and retains errors outside the sample', () => {
  assert.equal(traceSamplingDecision('trace-1', 0), false);
  assert.equal(traceSamplingDecision('trace-1', 100), true);
  assert.equal(traceSamplingDecision('trace-1', NaN), true);
  assert.equal(traceSamplingDecision('trace-1', 10), traceSamplingDecision('trace-1', 10));
  assert.equal(retainTraceRecord({kind: 'HTTP_REQUEST', phase: 'POST /analytics/events', payload: {}}, false), false);
  assert.equal(retainTraceRecord({kind: 'RUNTIME_ERROR', phase: 'ENTRY_AD_PLAYBACK_V2', payload: {}}, false), true);
  assert.equal(retainTraceRecord({kind: 'SDK_CALLBACK', phase: 'onError', payload: {}}, false), true);
  assert.equal(retainTraceRecord({kind: 'SDK_CALLBACK', phase: 'show', payload: {error_code: 11006}}, false), true);
});
