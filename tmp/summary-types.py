from pathlib import Path
p=Path('apps/api/src/modules/admin/routes.ts');s=p.read_text(encoding='utf8');s=s.replace("'adShown', 'adFailed']) result", "'adShown', 'adFailed'] as const) result");p.write_text(s,encoding='utf8')
