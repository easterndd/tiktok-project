type Admission = { key?: string; label?: string; critical?: boolean; signal?: AbortSignal };
type RejectionReason = 'aborted' | 'global_queue_full' | 'app_queue_full' | 'wait_timeout';
type Waiter = { key: string; label: string; critical: boolean; queuedAt: number; resolve: (release: (() => void) | null) => void; cleanup: () => void };
type Options = { perKeyLimit?: number; perKeyQueueLimit?: number; reserved?: number; perKeyReserved?: number; waitMs?: number };

/** Atomic global + per-app admission; queued work never owns a database slot. */
export class RequestConcurrencyGate {
  private active = 0;
  private normal = 0;
  private admitted = 0;
  private rejected = 0;
  private readonly admittedByApp = new Map<string, number>();
  private readonly rejectedByApp = new Map<string, Record<RejectionReason, number>>();
  private readonly rejectedByRoute = new Map<string, { key: string; route: string; reason: RejectionReason; count: number }>();
  private readonly queueWaitByApp = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  private readonly keys = new Map<string, { active: number; normal: number }>();
  private readonly operations = new Map<object, { key: string; label: string; startedAt: number }>();
  private readonly waiters: Waiter[] = [];
  private readonly options: Required<Options>;

  constructor(private readonly limit: number, private readonly queueLimit: number, options: Options = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Request concurrency limit must be a positive integer.');
    if (!Number.isInteger(queueLimit) || queueLimit < 0) throw new Error('Request concurrency queue limit must be a non-negative integer.');
    this.options = { perKeyLimit: limit, perKeyQueueLimit: queueLimit, reserved: 0, perKeyReserved: 0, waitMs: 1000, ...options };
  }

  get stats() {
    const workloads = new Map<string, { key: string; route: string; active: number; oldestMs: number }>();
    const now = performance.now();
    for (const operation of this.operations.values()) {
      const id = `${operation.key}:${operation.label}`;
      const item = workloads.get(id) ?? { key: operation.key, route: operation.label, active: 0, oldestMs: 0 };
      item.active++;
      item.oldestMs = Math.max(item.oldestMs, Math.round(now - operation.startedAt));
      workloads.set(id, item);
    }
    const queuedByApp = new Map<string, number>();
    for (const waiter of this.waiters) queuedByApp.set(waiter.key, (queuedByApp.get(waiter.key) ?? 0) + 1);
    const appKeys = new Set([...this.keys.keys(), ...queuedByApp.keys(), ...this.admittedByApp.keys(), ...this.rejectedByApp.keys()]);
    const apps = [...appKeys].map((key) => ({
      key,
      active: this.keys.get(key)?.active ?? 0,
      queued: queuedByApp.get(key) ?? 0,
      admitted: this.admittedByApp.get(key) ?? 0,
      rejected: Object.values(this.rejectedByApp.get(key) ?? {}).reduce((sum, count) => sum + count, 0),
      rejectionReasons: this.rejectedByApp.get(key) ?? {},
      queueWait: this.queueWaitByApp.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 }
    }));
    return {
      active: this.active, queued: this.waiters.length, admitted: this.admitted, rejected: this.rejected,
      apps, workloads: [...workloads.values()],
      topRejectedRoutes: [...this.rejectedByRoute.values()].sort((a, b) => b.count - a.count).slice(0, 20)
    };
  }

  get activeCount() { return this.active; }
  get queuedCount() { return this.waiters.length; }

  acquire({ key = 'default', label = 'handler', critical = false, signal }: Admission = {}): Promise<(() => void) | null> {
    if (signal?.aborted) { this.recordRejection(key, label, 'aborted'); return Promise.resolve(null); }
    if (this.canRun(key, critical)) return Promise.resolve(this.start(key, critical, label));
    const queuedForKey = this.waiters.filter((waiter) => waiter.key === key).length;
    if (this.waiters.length >= this.queueLimit) { this.recordRejection(key, label, 'global_queue_full'); return Promise.resolve(null); }
    if (queuedForKey >= this.options.perKeyQueueLimit) { this.recordRejection(key, label, 'app_queue_full'); return Promise.resolve(null); }
    return new Promise((resolve) => {
      const reject = (reason: RejectionReason) => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        waiter.cleanup();
        this.recordRejection(key, label, reason);
        resolve(null);
      };
      const abort = () => reject('aborted');
      const timer = setTimeout(() => reject('wait_timeout'), this.options.waitMs);
      const waiter: Waiter = { key, label, critical, queuedAt: performance.now(), resolve, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private recordRejection(key: string, route: string, reason: RejectionReason) {
    this.rejected++;
    const reasons = this.rejectedByApp.get(key) ?? { aborted: 0, global_queue_full: 0, app_queue_full: 0, wait_timeout: 0 };
    reasons[reason]++;
    this.rejectedByApp.set(key, reasons);
    const routeKey = `${key}\0${route}\0${reason}`;
    const existing = this.rejectedByRoute.get(routeKey);
    if (existing) existing.count++;
    else if (this.rejectedByRoute.size < 256) this.rejectedByRoute.set(routeKey, { key, route, reason, count: 1 });
  }

  private recordQueueWait(key: string, queuedAt: number) {
    const waitedMs = Math.round(performance.now() - queuedAt);
    const stats = this.queueWaitByApp.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
    stats.count++;
    stats.totalMs += waitedMs;
    stats.maxMs = Math.max(stats.maxMs, waitedMs);
    this.queueWaitByApp.set(key, stats);
  }

  private canRun(key: string, critical: boolean) {
    const state = this.keys.get(key) ?? { active: 0, normal: 0 };
    return this.active < this.limit && state.active < this.options.perKeyLimit
      && (critical || (this.normal < Math.max(1, this.limit - this.options.reserved)
        && state.normal < Math.max(1, this.options.perKeyLimit - this.options.perKeyReserved)));
  }

  private start(key: string, critical: boolean, label: string) {
    const operation = { key, label, startedAt: performance.now() };
    this.operations.set(operation, operation);
    const state = this.keys.get(key) ?? { active: 0, normal: 0 };
    this.keys.set(key, state);
    state.active++; this.active++; this.admitted++;
    this.admittedByApp.set(key, (this.admittedByApp.get(key) ?? 0) + 1);
    if (!critical) { state.normal++; this.normal++; }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.operations.delete(operation);
      state.active--; this.active--;
      if (!critical) { state.normal--; this.normal--; }
      if (!state.active) this.keys.delete(key);
      this.drain();
    };
  }

  private drain() {
    // Reserve capacity for login, impression acknowledgement and unlock completion.
    for (const critical of [true, false]) {
      for (let i = 0; i < this.waiters.length;) {
        const waiter = this.waiters[i];
        if (waiter.critical !== critical || !this.canRun(waiter.key, critical)) { i++; continue; }
        this.waiters.splice(i, 1);
        waiter.cleanup();
        this.recordQueueWait(waiter.key, waiter.queuedAt);
        waiter.resolve(this.start(waiter.key, critical, waiter.label));
      }
    }
  }
}
