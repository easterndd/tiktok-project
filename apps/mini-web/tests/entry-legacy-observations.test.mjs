import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

const priorWindow = globalThis.window;
const priorStorage = globalThis.localStorage;
const stored = new Map();
const calls = [];
globalThis.window = { addEventListener() {} };
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value)
};
globalThis.__entryLegacyCalls = calls;

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/entry-legacy-observations.ts')) {
      if (specifier === '../../lib/api-client') return {
        url: 'data:text/javascript,export class ApiError extends Error { constructor(status) { super(); this.status = status; } }', shortCircuit: true
      };
      if (specifier === '../../lib/app-brand') return {
        url: 'data:text/javascript,export const storagePrefix = "test";', shortCircuit: true
      };
      if (specifier === './app-entry-ad') return {
        url: `data:text/javascript,${encodeURIComponent(`
          export async function recordAppEntryAdEvent(value) { globalThis.__entryLegacyCalls.push(['evidence', value]); }
          export async function acknowledgeAppEntryAdShown(...value) { globalThis.__entryLegacyCalls.push(['shown', value]); }
          export async function completeAppEntryAd(...value) { globalThis.__entryLegacyCalls.push(['complete', value]); }
        `)}`, shortCircuit: true
      };
    }
    return next(specifier, context);
  }
});

const { queueLegacyEntryObservation, flushLegacyEntryObservations } = await import('../src/features/ads/entry-legacy-observations.ts');
after(() => {
  hooks.deregister();
  globalThis.window = priorWindow;
  globalThis.localStorage = priorStorage;
  delete globalThis.__entryLegacyCalls;
});

const event = (id, adIndex, eventType) => ({ eventId: id, adIndex, placementId: 'primary', eventType,
  occurredAt: new Date().toISOString() });

it('queues legacy SHOWN evidence and count in order without waiting to enqueue the next ad', async () => {
  queueLegacyEntryObservation('shown-session', 'SHOWN', event('first', 1, 'SHOWN'));
  queueLegacyEntryObservation('shown-session', 'SHOWN', event('first', 1, 'CLOSED_COMPLETED'));
  queueLegacyEntryObservation('shown-session', 'SHOWN', event('second', 2, 'SHOWN'));
  assert.equal(calls.length, 0);
  await flushLegacyEntryObservations();
  assert.deepEqual(calls.map(([type]) => type), ['shown', 'shown']);
  assert.equal(calls[0][1][2], 1);
  assert.equal(calls[1][1][2], 2);
});

it('sends completed evidence before its confirmation on the legacy API', async () => {
  calls.splice(0);
  queueLegacyEntryObservation('complete-session', 'COMPLETED', event('third', 1, 'SHOWN'));
  queueLegacyEntryObservation('complete-session', 'COMPLETED', event('third', 1, 'CLOSED_COMPLETED'));
  await flushLegacyEntryObservations();
  assert.deepEqual(calls.map(([type]) => type), ['evidence', 'complete']);
  assert.equal(calls[1][1][2], true);
});
