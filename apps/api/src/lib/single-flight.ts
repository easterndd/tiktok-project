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
