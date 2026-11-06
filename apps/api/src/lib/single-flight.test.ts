import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serialByKey, singleFlight } from './single-flight';

describe('singleFlight', () => {
  it('shares concurrent work for the same scope and key, then releases it', async () => {
    const scope = {};
    let calls = 0;
    let resolveOperation!: (value: number) => void;
    const operation = () => {
      calls += 1;
      return new Promise<number>((resolve) => { resolveOperation = resolve; });
    };

    const first = singleFlight(scope, 'same', operation);
    const second = singleFlight(scope, 'same', operation);
    assert.equal(first, second);
    assert.equal(calls, 0);

    await Promise.resolve();
    assert.equal(calls, 1);
    resolveOperation(7);
    assert.deepEqual(await Promise.all([first, second]), [7, 7]);
    assert.equal(await singleFlight(scope, 'same', async () => { calls += 1; return 8; }), 8);
    assert.equal(calls, 2);
  });

  it('does not share work across scopes and releases rejected work', async () => {
    const error = new Error('temporary failure');
    const scope = {};
    await assert.rejects(singleFlight(scope, 'key', async () => { throw error; }), error);
    assert.equal(await singleFlight(scope, 'key', async () => 'recovered'), 'recovered');
    assert.equal(await singleFlight({}, 'key', async () => 'separate'), 'separate');
  });
});

it('serializes the same session while another session progresses independently', async () => {
  const scope = {};
  const events: string[] = [];
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const first = serialByKey(scope, 'session-a', async () => { events.push('first-start'); await blocked; events.push('first-end'); });
  const next = serialByKey(scope, 'session-a', async () => { events.push('second'); });
  await serialByKey(scope, 'session-b', async () => { events.push('other'); });
  assert.deepEqual(events, ['first-start', 'other']);
  unblock();
  await Promise.all([first, next]);
  assert.deepEqual(events, ['first-start', 'other', 'first-end', 'second']);
});

it('continues a session queue after a rejected operation and releases the key', async () => {
  const scope = {};
  const failed = serialByKey(scope, 'session', async () => { throw new Error('transaction failed'); });
  const recovered = serialByKey(scope, 'session', async () => 1);
  await assert.rejects(failed, /transaction failed/);
  assert.equal(await recovered, 1);
  assert.equal(await serialByKey(scope, 'session', async () => 2), 2);
});
