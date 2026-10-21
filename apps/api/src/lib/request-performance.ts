const databaseDurations = new WeakMap<object, number>();

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
