import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEntryAdFlow } from '../src/features/ads/entry-ad-flow.ts';

const session = { required: true, sessionId: 'session', mode: 'REWARDED_GATED', placementId: 'placement', requiredCount: 3, completedCount: 0, onUnavailable: 'BLOCK' };
const base = { refreshSession: async () => session, wait: async () => {}, isActive: () => true, onError: () => {} };

describe('entry ad gate flow', () => {
  it('forwards the display callback without advancing before server acknowledgement', async () => {
    const events = [];
    await runEntryAdFlow({ ...session, requiredCount: 2 }, {
      ...base,
      onAdShown: () => events.push('shown'),
      show: async ({ onShown, adIndex }) => {
        events.push(`open-${adIndex}`);
        onShown();
        return { clientEventId: String(adIndex), isEnded: true };
      },
      complete: async (_sessionId, id) => {
        events.push(`confirm-${id}`);
        return { completedCount: Number(id), shouldContinue: id !== '2' };
      }
    });
    assert.deepEqual(events, ['open-1', 'shown', 'confirm-1', 'open-2', 'shown', 'confirm-2']);
  });

  it('stops BLOCK playback failures after three attempts without granting access', async () => {
    let shows = 0;
    await assert.rejects(runEntryAdFlow(session, { ...base,
      show: async () => { shows++; throw new Error('no fill'); },
      complete: async () => { throw new Error('must not complete'); }
    }), /no fill/);
    assert.equal(shows, 3);
  });

  it('bounds failed acknowledgements without opening another ad', async () => {
    let shows = 0; let completions = 0;
    await assert.rejects(runEntryAdFlow(session, { ...base,
      show: async () => { shows++; return { clientEventId: 'same-id', isEnded: true }; },
      complete: async (_session, id) => { assert.equal(id, 'same-id'); completions++; throw new Error('offline'); }
    }), /offline/);
    assert.equal(shows, 1);
    assert.equal(completions, 3);
  });
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

  it('opens the next shown-count ad while the ordered server acknowledgement is pending', async () => {
    const opened = [];
    let releaseAcknowledgements;
    const acknowledgement = new Promise((resolve) => { releaseAcknowledgements = resolve; });
    let confirms = 0;
    const flow = runEntryAdFlow({ ...session, requiredCount: 2, countMode: 'SHOWN' }, {
      ...base,
      show: async ({ adIndex, onShown }) => {
        opened.push(adIndex);
        onShown({ clientEventId: `event-${adIndex}`, isEnded: false });
        return { clientEventId: `event-${adIndex}`, isEnded: false };
      },
      complete: async (_sessionId, id, isEnded, adIndex) => {
        confirms++;
        assert.equal(isEnded, true);
        assert.equal(id, `event-${adIndex}`);
        return acknowledgement;
      }
    });
    await new Promise(setImmediate);
    assert.deepEqual(opened, [1, 2]);
    releaseAcknowledgements({ completedCount: 2, shouldContinue: false });
    await flow;
    assert.equal(confirms, 2);
  });

  it('retries a transient SHOWN acknowledgement with the same event while keeping ad playback moving', async () => {
    const opened = [];
    const confirmations = [];
    let firstAttempts = 0;
    await runEntryAdFlow({ ...session, requiredCount: 2, countMode: 'SHOWN' }, {
      ...base,
      show: async ({ adIndex, onShown }) => {
        opened.push(adIndex);
        const playback = { clientEventId: `event-${adIndex}`, isEnded: false };
        onShown(playback);
        return playback;
      },
      complete: async (_sessionId, clientEventId, isEnded, adIndex) => {
        confirmations.push([clientEventId, adIndex]);
        assert.equal(isEnded, true);
        if (adIndex === 1 && ++firstAttempts === 1) throw new Error('temporary network error');
        return { completedCount: adIndex, shouldContinue: adIndex < 2 };
      }
    });
    assert.deepEqual(opened, [1, 2]);
    assert.deepEqual(confirmations, [['event-1', 1], ['event-1', 1], ['event-2', 2]]);
  });

  it('does not grant access when SHOWN acknowledgements keep failing', async () => {
    let attempts = 0;
    await assert.rejects(runEntryAdFlow({ ...session, requiredCount: 1, countMode: 'SHOWN' }, {
      ...base,
      show: async ({ onShown }) => {
        const playback = { clientEventId: 'event-1', isEnded: false };
        onShown(playback);
        return playback;
      },
      complete: async () => { attempts++; throw new Error('offline'); }
    }), /offline/);
    assert.equal(attempts, 3);
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

  it('honors Retry-After on a limited completion without reopening the ad', async () => {
    let shows = 0;
    let completions = 0;
    const waits = [];
    await runEntryAdFlow({ ...session, requiredCount: 1 }, {
      ...base,
      show: async () => { shows++; return { clientEventId: 'shown-id', isEnded: true }; },
      complete: async (_sessionId, id) => {
        assert.equal(id, 'shown-id');
        if (++completions === 1) throw Object.assign(new Error('rate limited'), { status: 429, retryAfterSeconds: 12 });
        return { completedCount: 1, shouldContinue: false };
      },
      wait: async (ms) => { waits.push(ms); }
    });
    assert.equal(shows, 1);
    assert.equal(completions, 2);
    assert.deepEqual(waits, [12_000]);
  });

  it('refreshes server progress after a conflict and replays only an unconfirmed ad', async () => {
    let shows = 0;
    let completes = 0;
    const shownIndices = [];
    await runEntryAdFlow({ ...session, requiredCount: 1 }, {
      ...base,
      show: async ({ adIndex }) => { shows++; shownIndices.push(adIndex); return { clientEventId: `event-${shows}`, isEnded: true }; },
      complete: async () => {
        completes++;
        if (completes === 1) throw Object.assign(new Error('session conflict'), { status: 409 });
        return { completedCount: 1, shouldContinue: false };
      },
      refreshSession: async () => ({ ...session, requiredCount: 1, completedCount: 0 })
    });
    assert.equal(shows, 2);
    assert.equal(completes, 2);
    assert.deepEqual(shownIndices, [1, 1]);
  });

  it('stops on a persistent client error instead of retrying the same completion', async () => {
    let completes = 0;
    let refreshes = 0;
    await assert.rejects(runEntryAdFlow({ ...session, requiredCount: 1 }, {
      ...base,
      show: async () => ({ clientEventId: 'event', isEnded: true }),
      complete: async () => { completes++; throw Object.assign(new Error('unauthorized'), { status: 401 }); },
      refreshSession: async () => { refreshes++; return session; }
    }), /unauthorized/);
    assert.equal(completes, 1);
    assert.equal(refreshes, 0);
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
