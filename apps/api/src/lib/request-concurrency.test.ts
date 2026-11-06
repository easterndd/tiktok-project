import assert from 'node:assert/strict';
import { it } from 'node:test';
import { RequestConcurrencyGate } from './request-concurrency';

it('limits active work and hands a released slot to the queue', async () => {
  const gate = new RequestConcurrencyGate(1, 1);
  const first = await gate.acquire();
  assert.ok(first);
  const queued = gate.acquire();
  assert.equal(gate.activeCount, 1);
  assert.equal(gate.queuedCount, 1);
  first();
  const second = await queued;
  assert.ok(second);
  assert.equal(gate.activeCount, 1);
  second();
  assert.equal(gate.activeCount, 0);
});

it('rejects work once the bounded queue is full', async () => {
  const gate = new RequestConcurrencyGate(1, 0);
  const release = await gate.acquire();
  assert.ok(release);
  assert.equal(await gate.acquire(), null);
  release();
});

it('expires waiting work and removes cancelled work without leaking slots', async () => {
  const gate = new RequestConcurrencyGate(1, 3, { waitMs: 20 });
  const release = (await gate.acquire())!;
  const controller = new AbortController();
  const cancelled = gate.acquire({ signal: controller.signal });
  controller.abort();
  assert.equal(await cancelled, null);
  assert.equal(await gate.acquire(), null);
  assert.equal(gate.queuedCount, 0);
  release(); release();
  assert.equal(gate.activeCount, 0);
});

it('reserves global and per-app capacity for critical requests and isolates hot apps', async () => {
  const gate = new RequestConcurrencyGate(4, 8, { perKeyLimit: 2, perKeyQueueLimit: 2, reserved: 1, perKeyReserved: 1 });
  const a = (await gate.acquire({ key: 'a' }))!;
  const queued = gate.acquire({ key: 'a' });
  const critical = (await gate.acquire({ key: 'a', critical: true }))!;
  const b = (await gate.acquire({ key: 'b' }))!;
  assert.equal(gate.activeCount, 3);
  assert.equal(gate.queuedCount, 1);
  a();
  const next = (await queued)!;
  assert.ok(next);
  next(); critical(); b();
  assert.equal(gate.activeCount, 0);
});

it('gives critical queued requests the next available slot', async () => {
  const gate = new RequestConcurrencyGate(1, 2);
  const first = (await gate.acquire())!;
  let normalStarted = false;
  const normal = gate.acquire().then((release) => { normalStarted = true; return release; });
  const critical = gate.acquire({ critical: true });
  first();
  const criticalRelease = (await critical)!;
  assert.equal(normalStarted, false);
  criticalRelease();
  (await normal)!();
});

it('reports held route capacity and removes it when work finishes', async () => {
  const gate = new RequestConcurrencyGate(2, 2);
  const first = (await gate.acquire({ key: 'mini', label: '/api/mini/v1/play' }))!;
  const second = (await gate.acquire({ key: 'mini', label: '/api/mini/v1/play' }))!;
  assert.equal(gate.stats.workloads.length, 1);
  assert.equal(gate.stats.workloads[0].active, 2);
  first();
  assert.equal(gate.stats.workloads[0].active, 1);
  second();
  assert.deepEqual(gate.stats.workloads, []);
});

it('attributes queue overflow, timeouts and cancellations to the affected app', async () => {
  const gate = new RequestConcurrencyGate(1, 1, { waitMs: 20 });
  const release = (await gate.acquire({ key: 'hot' }))!;
  const waiting = gate.acquire({ key: 'hot' });
  assert.equal(await gate.acquire({ key: 'hot', label: '/home' }), null);
  assert.equal(await waiting, null);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await gate.acquire({ key: 'hot', signal: aborted.signal }), null);
  release();
  const stats = gate.stats.apps.find((app) => app.key === 'hot')!;
  assert.equal(stats.admitted, 1);
  assert.equal(stats.rejected, 3);
  assert.deepEqual(stats.rejectionReasons, { aborted: 1, global_queue_full: 1, app_queue_full: 0, wait_timeout: 1 });
  assert.deepEqual(gate.stats.topRejectedRoutes.find((item) => item.route === '/home'), {
    key: 'hot', route: '/home', reason: 'global_queue_full', count: 1
  });
});
