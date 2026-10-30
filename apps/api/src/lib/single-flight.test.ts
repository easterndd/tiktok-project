import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { singleFlight } from './single-flight';

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
