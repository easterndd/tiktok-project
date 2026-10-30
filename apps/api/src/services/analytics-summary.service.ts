import { Prisma, PrismaClient } from '@prisma/client';

const defaultTimezone = 'Asia/Shanghai';
const defaultDays = 2;

type SummaryRow = {
  day: Date;
  newUsers: bigint;
  activeUsers: bigint;
  watchSessions: bigint;
  completedEpisodes: bigint;
  favorites: bigint;
  shares: bigint;
  searches: bigint;
  playbackEvents: bigint;
  playbackErrors: bigint;
  adRequested: bigint;
  adShown: bigint;
  adFailed: bigint;
};

type PlaybackAggregateRow = {
  grouping: number;
  key: string | null;
  count: bigint;
  startupCount: bigint;
  startupSum: bigint | null;
  bufferMs: bigint | null;
};

function asNumber(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

export function zonedMidnight(value: Date, timezone: string, calendarDate?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const day = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const target = calendarDate ? Date.parse(`${calendarDate}T00:00:00Z`) : Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  let candidate = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const representedParts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(representedParts.year), Number(representedParts.month) - 1,
      Number(representedParts.day), Number(representedParts.hour), Number(representedParts.minute), Number(representedParts.second));
    candidate += target - represented;
  }
  return new Date(candidate);
}

/** Refreshes only the current and immediately previous local day. Late events are
 * intentionally included by re-reading both days on every worker cycle. */
export async function refreshAnalyticsDailySummaries(
  prisma: PrismaClient,
  options: { now?: Date; timezone?: string; days?: number } = {}
) {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? defaultTimezone;
  const days = Math.max(1, Math.min(90, options.days ?? defaultDays));
  const localParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const localToday = Date.UTC(Number(localParts.year), Number(localParts.month) - 1, Number(localParts.day));
  const firstDay = new Date(localToday - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const sourceWindowStart = zonedMidnight(now, timezone, firstDay);
  const sourceWindowEnd = now;
  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH bounds AS (
      SELECT date_trunc('day', ${sourceWindowStart}::timestamptz AT TIME ZONE ${timezone}) AS start_day,
        date_trunc('day', ${sourceWindowEnd}::timestamptz AT TIME ZONE ${timezone}) AS end_day
    ), days AS (
      SELECT generate_series(start_day, end_day, interval '1 day') AS day FROM bounds
    ), metrics AS (
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}) AS day,
        COUNT(*) FILTER (WHERE "createdAt" >= ${sourceWindowStart})::bigint AS new_users,
        0::bigint AS active_users, 0::bigint AS watch_sessions, 0::bigint AS completed_episodes,
        0::bigint AS favorites, 0::bigint AS shares, 0::bigint AS searches,
        0::bigint AS playback_events, 0::bigint AS playback_errors,
        0::bigint AS ad_requested, 0::bigint AS ad_shown, 0::bigint AS ad_failed
      FROM "User" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, COUNT(DISTINCT "userId"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      FROM "AppSession" WHERE "startedAt" >= ${sourceWindowStart} AND "startedAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, COUNT(*), 0, 0, 0, 0, 0, 0, 0, 0, 0
      FROM "PlaybackSession" WHERE "startedAt" >= ${sourceWindowStart} AND "startedAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, COUNT(*), 0, 0, 0, 0, 0, 0, 0, 0
      FROM "EpisodeCompletionEvent" WHERE "completedAt" >= ${sourceWindowStart} AND "completedAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, 0, COUNT(*), 0, 0, 0, 0, 0, 0, 0
      FROM "AlbumFavorite" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, 0, 0, COUNT(*), 0, 0, 0, 0, 0, 0
      FROM "ShareEvent" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, 0, 0, 0, COUNT(*), 0, 0, 0, 0, 0
      FROM "SearchEvent" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, 0, 0, 0, 0, COUNT(*), COUNT(*) FILTER (WHERE "eventType" = 'ERROR'), 0, 0, 0
      FROM "PlaybackQualityEvent" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 0, 0, 0, 0, 0, 0, 0, 0, 0,
        COUNT(*) FILTER (WHERE "eventType" = 'REQUESTED'), COUNT(*) FILTER (WHERE "eventType" = 'SHOWN'), COUNT(*) FILTER (WHERE "eventType" = 'FAILED')
      FROM "AdEvent" WHERE "createdAt" >= ${sourceWindowStart} AND "createdAt" < ${sourceWindowEnd} GROUP BY 1
    )
    SELECT day,
      SUM(new_users)::bigint AS "newUsers", SUM(active_users)::bigint AS "activeUsers",
      SUM(watch_sessions)::bigint AS "watchSessions", SUM(completed_episodes)::bigint AS "completedEpisodes",
      SUM(favorites)::bigint AS favorites, SUM(shares)::bigint AS shares, SUM(searches)::bigint AS searches,
      SUM(playback_events)::bigint AS "playbackEvents", SUM(playback_errors)::bigint AS "playbackErrors",
      SUM(ad_requested)::bigint AS "adRequested", SUM(ad_shown)::bigint AS "adShown", SUM(ad_failed)::bigint AS "adFailed"
    FROM days LEFT JOIN metrics USING (day)
    GROUP BY days.day ORDER BY days.day
  `);

  for (const row of rows) {
    const day = new Date(row.day);
    const dayStart = zonedMidnight(day, timezone, day.toISOString().slice(0, 10));
    const nextDay = new Date(day); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dayEnd = zonedMidnight(nextDay, timezone, nextDay.toISOString().slice(0, 10));
    const end = dayEnd < now ? dayEnd : now;
    // One scan computes the same per-dimension counts and overall sums.
    const playbackRows = await prisma.$queryRaw<PlaybackAggregateRow[]>(Prisma.sql`
      SELECT GROUPING("eventType", "definition", "networkType") AS grouping,
        CASE GROUPING("eventType", "definition", "networkType")
          WHEN 3 THEN "eventType" WHEN 5 THEN "definition" WHEN 6 THEN "networkType" ELSE NULL
        END AS key,
        COUNT(*)::bigint AS count, COUNT("startupMs")::bigint AS "startupCount",
        SUM("startupMs")::bigint AS "startupSum", SUM("bufferMs")::bigint AS "bufferMs"
      FROM "PlaybackQualityEvent"
      WHERE "createdAt" >= ${dayStart} AND "createdAt" < ${end}
      GROUP BY GROUPING SETS ((), ("eventType"), ("definition"), ("networkType"))
    `);
    const totals = playbackRows.find((item) => item.grouping === 7);
    const groups = (grouping: number) => playbackRows
      .filter((item): item is PlaybackAggregateRow & { key: string } => item.grouping === grouping && item.key !== null)
      .map((item) => ({ key: item.key, count: asNumber(item.count) }));
    const playbackSummary = {
      startupCount: asNumber(totals?.startupCount), startupSum: asNumber(totals?.startupSum),
      bufferMs: asNumber(totals?.bufferMs),
      eventTypes: groups(3), definitions: groups(5), networks: groups(6)
    };
    await prisma.analyticsDailySummary.upsert({
      where: { day_timezone: { day, timezone } },
      create: {
        day, timezone, sourceWindowStart, sourceWindowEnd, playbackSummary,
        newUsers: asNumber(row.newUsers), activeUsers: asNumber(row.activeUsers),
        watchSessions: asNumber(row.watchSessions), completedEpisodes: asNumber(row.completedEpisodes),
        favorites: asNumber(row.favorites), shares: asNumber(row.shares), searches: asNumber(row.searches),
        playbackEvents: asNumber(row.playbackEvents), playbackErrors: asNumber(row.playbackErrors),
        adRequested: asNumber(row.adRequested), adShown: asNumber(row.adShown), adFailed: asNumber(row.adFailed)
      },
      update: {
        sourceWindowStart, sourceWindowEnd, playbackSummary,
        newUsers: asNumber(row.newUsers), activeUsers: asNumber(row.activeUsers),
        watchSessions: asNumber(row.watchSessions), completedEpisodes: asNumber(row.completedEpisodes),
        favorites: asNumber(row.favorites), shares: asNumber(row.shares), searches: asNumber(row.searches),
        playbackEvents: asNumber(row.playbackEvents), playbackErrors: asNumber(row.playbackErrors),
        adRequested: asNumber(row.adRequested), adShown: asNumber(row.adShown), adFailed: asNumber(row.adFailed)
      }
    });
  }
  return { rows: rows.length, updatedAt: now };
}

export async function refreshOverviewSnapshot(prisma: PrismaClient) {
  const [albums, episodes, users, likes, favorites, shares, searches, rewardedUnlocks] = await Promise.all([
    prisma.album.count({ where: { status: 'ONLINE' } }), prisma.episode.count({ where: { status: 'ONLINE', album: { status: 'ONLINE' } } }),
    prisma.user.count(), prisma.albumLike.count(), prisma.albumFavorite.count(), prisma.shareEvent.count(), prisma.searchEvent.count(), prisma.episodeUnlock.count()
  ]);
  await prisma.analyticsOverviewSnapshot.upsert({ where: { id: 'default' }, create: { totals: { albums, episodes, users, likes, favorites, shares, searches, rewardedUnlocks } },
    update: { totals: { albums, episodes, users, likes, favorites, shares, searches, rewardedUnlocks } } });
}

export { defaultTimezone };
