from pathlib import Path
import re
p=Path('apps/api/src/modules/admin/routes.ts');s=p.read_text();s=s.replace("import { Prisma }", "import { Prisma, type AnalyticsDailySummary }")
s=s.replace("const model = (app.prisma as any).analyticsDailySummary as { findMany?: (args: unknown) => Promise<Array<Record<string, any>>> } | undefined;", "const model = app.prisma.analyticsDailySummary;")
s=s.replace("rows.reduce((result, row) =>", "rows.reduce((result, row: AnalyticsDailySummary) =>")
s=s.replace('new Date(row.updatedAt).getTime()', 'new Date(row.sourceWindowEnd).getTime()')
s=s.replace('dateKey(new Date(row.day), range.timezone)', 'new Date(row.day).toISOString().slice(0, 10)')
s=re.sub(r'("(?:createdAt|startedAt)") AT TIME ZONE \$\{range.timezone\}',r"\1 AT TIME ZONE 'UTC' AT TIME ZONE ${range.timezone}",s)
p.write_text(s)

