from pathlib import Path
import re
p=Path('apps/admin-web/src/main.tsx');s=p.read_text(encoding='utf-8');types=[];bodies=[]
for name,var in [('Audience','audience'),('Playback','playback')]:
 m=re.search(r'^type '+name+r' = .*\n',s,re.M);types.append('export '+m.group());s=s[:m.start()]+s[m.end():]
 prefix="      {tab === '"+var+"' && "+var+' && '
 a=s.index(prefix);b=s.index('\n',a);line=s[a:b];jsx=line[len(prefix):-1]
 bodies.append('export function '+name+'Page({ '+var+' }: { '+var+': '+name+' }) { return '+jsx+'; }\n')
 s=s[:a]+"      {tab === '"+var+"' && "+var+' && <'+name+'Page '+var+'={'+var+'} />}'+s[b:]
Path('apps/admin-web/src/analytics-pages.tsx').write_text("import { Activity, Users, Database, Film, CheckCircle2, Gauge, CircleAlert, Wifi } from 'lucide-react';\nimport { Metric, BarList, DailyBars, Panel } from './dashboard-ui';\n"+''.join(types)+''.join(bodies),encoding='utf-8')
s=s.replace("import { Metric, BarList, DailyBars, Status, Panel }", "import { Metric, Status, Panel }")
s=s.replace("import './styles.css';","import { AudiencePage, PlaybackPage, type Audience, type Playback } from './analytics-pages';\nimport './styles.css';")
p.write_text(s,encoding='utf-8')
