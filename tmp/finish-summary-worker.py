from pathlib import Path
p=Path('apps/api/src/services/analytics-summary.service.ts');s=p.read_text(encoding='utf8').replace('function zonedMidnight(value: Date, timezone: string)', 'export function zonedMidnight(value: Date, timezone: string, calendarDate?: string)').replace('const target = Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day));', "const target = calendarDate ? Date.parse(`${calendarDate}T00:00:00Z`) : Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day));")
s=s.replace("zonedMidnight(new Date(`${day.toISOString().slice(0, 10)}T12:00:00Z`), timezone)", "zonedMidnight(day, timezone, day.toISOString().slice(0, 10))").replace("zonedMidnight(new Date(`${nextDay.toISOString().slice(0, 10)}T12:00:00Z`), timezone)", "zonedMidnight(nextDay, timezone, nextDay.toISOString().slice(0, 10))")
p.write_text(s,encoding='utf8')
p=Path('apps/api/src/jobs/tiktok-short-drama.worker.ts');s=p.read_text(encoding='utf8');s=s.replace('import { refreshAnalyticsDailySummaries }', 'import { refreshAnalyticsDailySummaries, refreshOverviewSnapshot }')
a=s.index('      if (Date.now() - (lastAnalyticsRefresh');b=s.index('\n    const apiByApp',a)
s=s[:a]+s[b:]; s=s.replace('    const apiByApp', '    }\n    const apiByApp',1)
a=s.index('  const lastAnalyticsRefresh');s=s[:a]+s[a:].replace('  const lastAnalyticsRefresh = new Map<string, number>();','',1)
a=s.index('  await run().catch')
s=s[:a]+'''  let analyticsRunning = false;
  const refreshAnalytics = async () => {
    if (analyticsRunning) return;
    analyticsRunning = true;
    try {
      for (const context of contexts) {
        try {
          await refreshAnalyticsDailySummaries(context.prisma, { days: 2 });
          await refreshOverviewSnapshot(context.prisma);
          await context.prisma.miniAppRuntimeError.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
        } catch (error) { console.error(`${context.env.MINI_APP_KEY} analytics summary refresh failed.`, error); }
      }
    } finally { analyticsRunning = false; }
  };
  void refreshAnalytics();
  const analyticsTimer = setInterval(() => { void refreshAnalytics(); }, 5 * 60_000);
''' +s[a:]
s=s.replace('    clearInterval(timer);','    clearInterval(timer);\n    clearInterval(analyticsTimer);')
p.write_text(s,encoding='utf8')
