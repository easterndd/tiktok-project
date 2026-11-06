const maxInFlightKeysPerScope = 2_048;
const inFlightByScope = new WeakMap<object, Map<string, Promise<unknown>>>();

export function singleFlight<T>(scope: object, key: string, operation: () => Promise<T>): Promise<T> {
  let inFlight = inFlightByScope.get(scope);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByScope.set(scope, inFlight);
  }

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  if (inFlight.size >= maxInFlightKeysPerScope) return Promise.resolve().then(operation);

  const promise = Promise.resolve().then(operation);
  inFlight.set(key, promise);
  const release = () => {
    if (inFlight?.get(key) === promise) inFlight.delete(key);
  };
  void promise.then(release, release);
  return promise;
}

const serialByScope = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Serialize one session, including different event IDs, without holding a DB connection. */
export async function serialByKey<T>(scope: object, key: string, operation: () => Promise<T>): Promise<T> {
  let jobs = serialByScope.get(scope);
  if (!jobs) { jobs = new Map(); serialByScope.set(scope, jobs); }
  const previous = jobs.get(key);
  if (!previous && jobs.size >= maxInFlightKeysPerScope) {
    throw Object.assign(new Error('Session queue is busy.'), { statusCode: 503 });
  }
  const job = (previous ?? Promise.resolve()).catch(() => undefined).then(operation);
  jobs.set(key, job);
  try { return await job; }
  finally { if (jobs.get(key) === job) jobs.delete(key); }
}
