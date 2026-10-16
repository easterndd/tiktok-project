from pathlib import Path
p=Path('apps/api/src/modules/admin/routes.ts');s=p.read_text(encoding='utf8');s="import { combinePlaybackSummaries } from '../../services/analytics-playback-summary';\n"+s
s=s.replace('      totals,\n      updatedAt:', '      totals,\n      playback: combinePlaybackSummaries(rows.map((row) => row.playbackSummary)),\n      updatedAt:')
s=s.replace("    return cachedAnalytics(app, 'overview', async () => {", "    return cachedAnalytics(app, 'overview', async () => {\n      const snapshot = await app.prisma.analyticsOverviewSnapshot?.findUnique({ where: { id: 'default' } });\n      if (snapshot?.totals) return { ...(snapshot.totals as Prisma.JsonObject), updatedAt: snapshot.updatedAt };\n")
# Snapshot playback response, recent errors remain real time.
a=s.index("      const [totals, errorCount, eventTypes",s.index("app.get('/admin/analytics/playback-quality'"))
s=s[:a]+'''      if (summary?.playback) {
        const recentErrors = await app.prisma.playbackQualityEvent.findMany({
          where: { createdAt, eventType: 'ERROR' }, select: { errorCode: true, createdAt: true, episode: { select: { title: true } } },
          orderBy: { createdAt: 'desc' }, take: 10
        });
        const { totalEvents } = summary.playback;
        const errorCount = summary.totals.playbackErrors;
        return { from: range.from, to: range.to, timezone: range.timezone, periodDays: range.periodDays,
          ...summary.playback, errorCount, firstFrames: summary.playback.eventTypes.find((item) => item.eventType === 'FIRST_FRAME')?.count ?? 0,
          errorRate: totalEvents ? Number((errorCount / totalEvents * 100).toFixed(2)) : 0,
          updatedAt: summary.updatedAt,
          recentErrors: recentErrors.map((event) => ({ episodeTitle: event.episode.title, errorCode: event.errorCode, createdAt: event.createdAt })) };
      }
''' +s[a:]
# fallback playback must consistently use raw (no mixing stale error count with current denominator)
s=s.replace("summary ? Promise.resolve(summary.totals.playbackErrors) : app.prisma.playbackQualityEvent.count", "app.prisma.playbackQualityEvent.count")
s=s.replace('      updatedAt: summary?.updatedAt ?? null,\n      eventTypes:', '      updatedAt: null,\n      eventTypes:')
# health query can inspect last 24h, selection filters runtime diagnostics
s=s.replace("app.get('/admin/analytics/health', { preHandler: requireAdmin }, async () => {\n    const windowStart = new Date(Date.now() - 30 * 60_000);", "app.get('/admin/analytics/health', { preHandler: requireAdmin }, async (request) => {\n    const { minutes } = z.object({ minutes: z.coerce.number().int().min(5).max(1440).default(30) }).parse(request.query);\n    const windowStart = new Date(Date.now() - minutes * 60_000);\n    const runtimeModel = app.prisma.miniAppRuntimeError;\n    const runtimeGroups = runtimeModel ? await runtimeModel.groupBy({ by: ['kind'], where: { createdAt: { gte: windowStart } }, _count: { _all: true } }) : [];\n    const runtimeErrors = runtimeModel ? await runtimeModel.findMany({ where: { createdAt: { gte: windowStart } }, orderBy: { createdAt: 'desc' }, take: 30 }) : [];\n    const runtimeCount = (kind: string) => runtimeGroups.find((row) => row.kind === kind)?._count._all ?? 0;")
s=s.replace('counts: { adFailures, playbackErrors, uploadFailures, platformFailures },', "counts: { adFailures, playbackErrors, uploadFailures, platformFailures, startupErrors: runtimeCount('STARTUP'), apiErrors: runtimeCount('API') + runtimeCount('PLAYBACK'), scriptErrors: runtimeCount('SCRIPT'), clientAdErrors: runtimeCount('AD') },")
s=s.replace("      recent: [\n        ...recentAds", "      recent: [\n        ...runtimeErrors.map((item) => ({ kind: ({ STARTUP: '启动异常', API: '接口加载失败', PLAYBACK: '剧集加载失败', SCRIPT: '脚本异常', AD: '广告运行异常' } as Record<string, string>)[item.kind] ?? item.kind, createdAt: item.createdAt, message: `${item.phase} · ${item.message}`, releaseId: item.releaseId, path: item.path, requestId: item.requestId, durationMs: item.durationMs, statusCode: item.statusCode, occurredAt: item.occurredAt })),\n        ...recentAds")
s=s.replace('.slice(0, 10)\n    };\n  });\n  app.get', '.slice(0, 30)\n    };\n  });\n  app.get')
p.write_text(s,encoding='utf8')
