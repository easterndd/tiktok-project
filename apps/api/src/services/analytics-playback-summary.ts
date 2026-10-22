import type { Prisma } from '@prisma/client';

type DailyPlayback = {
  startupCount: number; startupSum: number; bufferMs: number;
  eventTypes: { key: string; count: number }[];
  definitions: { key: string; count: number }[];
  networks: { key: string; count: number }[];
};
export function combinePlaybackSummaries(values: (Prisma.JsonValue | null)[]) {
  if (values.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) return null;
  const days = values as unknown as DailyPlayback[];
  if (days.some((day) => !Array.isArray(day.eventTypes) || !Array.isArray(day.definitions) || !Array.isArray(day.networks))) return null;
  const merge = (key: 'eventTypes' | 'definitions' | 'networks') => {
    const counts = new Map<string, number>();
    for (const day of days) for (const item of day[key]) counts.set(item.key, (counts.get(item.key) ?? 0) + item.count);
    return [...counts].map(([key, count]) => ({ key, count }));
  };
  const eventTypes = merge('eventTypes');
  const startupCount = days.reduce((sum, day) => sum + day.startupCount, 0);
  return {
    totalEvents: eventTypes.reduce((sum, item) => sum + item.count, 0),
    averageStartupMs: startupCount ? Math.round(days.reduce((sum, day) => sum + day.startupSum, 0) / startupCount) : null,
    totalBufferMs: days.reduce((sum, day) => sum + day.bufferMs, 0),
    eventTypes: eventTypes.map((item) => ({ eventType: item.key, count: item.count })),
    definitions: merge('definitions').map((item) => ({ definition: item.key, count: item.count })),
    networks: merge('networks').map((item) => ({ networkType: item.key, count: item.count }))
  };
}
