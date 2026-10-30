const databaseDurations = new WeakMap<object, number>();

export type ResponseLogSampleCache = Map<string, { lastLoggedAt: number; suppressedResponses: number }>;

export function sampleResponseLog(
  cache: ResponseLogSampleCache,
  key: string,
  now: number,
  intervalMs: number,
  maxEntries: number
): number | null {
  const previous = cache.get(key);
  if (previous && now - previous.lastLoggedAt < intervalMs) {
    previous.suppressedResponses += 1;
    return null;
  }

  const suppressedResponses = previous?.suppressedResponses ?? 0;
  if (previous) cache.delete(key);
  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { lastLoggedAt: now, suppressedResponses: 0 });
  return suppressedResponses;
}

export function addDatabaseDuration(request: object, durationMs: number) {
  databaseDurations.set(request, (databaseDurations.get(request) ?? 0) + durationMs);
}

export function getDatabaseDuration(request: object) {
  return databaseDurations.get(request);
}

export async function measureDatabase<T>(request: object, operation: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    addDatabaseDuration(request, performance.now() - startedAt);
  }
}
