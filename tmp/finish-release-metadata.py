from pathlib import Path
p=Path('apps/admin-web/src/main.tsx');s=p.read_text(encoding='utf-8').replace("'保存 Portal 版本状态'}</button>","'保存 Portal 版本状态'}</button></details>")
s=s.replace(" · 最后上报：{selectedEntryAdRelease?.lastSeenAt ? new Date(selectedEntryAdRelease.lastSeenAt).toLocaleString('zh-CN') : '-'}",'')
p.write_text(s,encoding='utf-8')
p=Path('apps/api/prisma/schema.prisma');s=p.read_text(encoding='utf-8');start=s.index('model AppEntryAdPolicy {');pos=s.index('\n',start)+1;s=s[:pos]+'  firstSeenAt DateTime?\n'+s[pos:];p.write_text(s,encoding='utf-8')
p=Path('apps/api/prisma/migrations/20261016030000_mini_app_runtime_error/migration.sql');s=p.read_text(encoding='utf-8');s+='\nALTER TABLE "AppEntryAdPolicy" ADD COLUMN "firstSeenAt" TIMESTAMP(3);\nUPDATE "AppEntryAdPolicy" p SET "firstSeenAt" = s.first_seen FROM (SELECT "releaseId", MIN("createdAt") AS first_seen FROM "AppEntryAdSession" GROUP BY "releaseId") s WHERE p."releaseId" = s."releaseId";\n';p.write_text(s,encoding='utf-8')
p=Path('apps/api/src/modules/app-entry-ads/routes.ts');s=p.read_text(encoding='utf-8');s=s.replace('data: disabledPolicy(app, releaseId)', 'data: { ...disabledPolicy(app, releaseId), firstSeenAt: new Date() }');s=s.replace('    if (!policy.enabled) return', '''    if (saved && !saved.firstSeenAt) await app.prisma.appEntryAdPolicy.update({ where: { releaseId }, data: { firstSeenAt: new Date() } });
    if (!policy.enabled) return''',1);p.write_text(s,encoding='utf-8')
p=Path('apps/api/src/modules/admin/routes.ts');s=p.read_text(encoding='utf-8');s=s.replace('version: true, updatedAt: true }','version: true, updatedAt: true, firstSeenAt: true }',1);s=s.replace("version: 1, updatedAt: new Date(0)","version: 1, updatedAt: new Date(0), firstSeenAt: null",1);p.write_text(s,encoding='utf-8')
