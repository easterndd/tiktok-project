import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEntryAdFlow } from '../src/features/ads/entry-ad-flow.ts';

const session = { required: true, sessionId: 'session', mode: 'REWARDED_GATED', placementId: 'placement', requiredCount: 3, completedCount: 0, onUnavailable: 'BLOCK' };
const base = { wait: async () => {}, isActive: () => true, onError: () => {} };

describe('entry ad gate flow', () => {
  it('repeats the same index after early closes in completed mode', async () => {
    const indices = [];
    let shows = 0;
    let completed = 0;
    await runEntryAdFlow(session, {
      ...base,
      show: async ({ adIndex }) => { indices.push(adIndex); shows++; return { clientEventId: String(shows), isEnded: shows > 2 }; },
      complete: async (_sessionId, _id, isEnded) => {
        if (isEnded) completed++;
        return { completedCount: completed, shouldContinue: completed < 3 };
      }
    });
    assert.deepEqual(indices, [1, 1, 1, 2, 3]);
  });

  it('advances across three closed popups in shown mode', async () => {
    const indices = [];
    await runEntryAdFlow(session, {
      ...base,
      show: async ({ adIndex }) => { indices.push(adIndex); return { clientEventId: String(adIndex), isEnded: false }; },
      complete: async (_sessionId, _id, isEnded) => {
        assert.equal(isEnded, false);
        const completedCount = indices.length;
        return { completedCount, shouldContinue: completedCount < 3 };
      }
    });
    assert.deepEqual(indices, [1, 2, 3]);
  });

  it('retries the same completion after a lost response before another popup', async () => {
    const events = [];
    let attempts = 0;
    await runEntryAdFlow({ ...session, requiredCount: 1 }, {
      ...base,
      show: async () => { events.push('show'); return { clientEventId: 'shown-id', isEnded: false }; },
      complete: async (_sessionId, id) => {
        events.push(id);
        if (++attempts === 1) throw new Error('network');
        return { completedCount: 1, shouldContinue: false };
      }
    });
    assert.deepEqual(events, ['show', 'shown-id', 'shown-id']);
  });

  it('applies ALLOW only to unavailable ad playback and stops after cancellation', async () => {
    let attempts = 0;
    await runEntryAdFlow({ ...session, onUnavailable: 'ALLOW' }, {
      ...base,
      show: async () => { attempts++; throw new Error('no fill'); },
      complete: async () => { throw new Error('unexpected completion'); }
    });
    assert.equal(attempts, 3);
    let active = true;
    let shows = 0;
    await runEntryAdFlow(session, {
      ...base,
      isActive: () => active,
      show: async () => { shows++; active = false; return { clientEventId: 'id', isEnded: true }; },
      complete: async () => { throw new Error('completion after cancellation'); }
    });
    assert.equal(shows, 1);
  });
});
