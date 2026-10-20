from pathlib import Path
p=Path('apps/admin-web/src/main.tsx'); s=p.read_text(encoding='utf-8')
# Extract common UI components using their top-level boundaries.
names=['Metric','BarList','DailyBars','Status','Panel']; parts=[]
import re
for name in names:
 m=re.search(r'^function '+name+r'\(.*?^}\n',s,re.M|re.S)
 assert m, name
 parts.append(m.group(0).replace('function '+name,'export function '+name,1)); s=s[:m.start()]+s[m.end():]
Path('apps/admin-web/src/dashboard-ui.tsx').write_text("import { Activity, BarChart3, CalendarDays } from 'lucide-react';\nimport type { ReactNode } from 'react';\n\n"+'\n'.join(parts),encoding='utf-8')
# Extract request client; its context is immutable for each workspace.
a=s.index('async function api<T>'); b=s.index('\nfunction Login',a)
api=s[a:b]; api=api.replace('window.location.reload();','onUnauthorized();')
Path('apps/admin-web/src/admin-api.ts').write_text('export function createAdminApi(API: string, adminTokenStorageKey: string, platformSubmissionStorageKey: string, onUnauthorized: () => void) {\nlet adminSessionRecoveryStarted = false;\n'+api+'\nreturn api;\n}\n',encoding='utf-8')
s=s[:a]+'const api = createAdminApi(API, adminTokenStorageKey, platformSubmissionStorageKey, () => onSelect(activeApp));\n'+s[b:]
s=s.replace('useEffect, useRef, useState, type FormEvent, type ReactNode','useEffect, useMemo, useRef, useState, type FormEvent')
s=s.replace("import './styles.css';","import { Metric, BarList, DailyBars, Status, Panel } from './dashboard-ui';\nimport { createAdminApi } from './admin-api';\nimport { HealthPanel, type Health } from './health-panel';\nimport './styles.css';")
s=re.sub(r'^type Health = .*\n','',s,flags=re.M)
s=s.replace('rewardedUnlocks: number };','rewardedUnlocks: number; updatedAt?: string };')
s=s.replace('portalStatus: PortalStatus };','portalStatus: PortalStatus; firstSeenAt?: string | null; lastSeenAt?: string | null };')
# Factory fixes each workspace to its own app/token/config; remount cancels resource requests.
s=s.replace("const activeApp: MiniApp = savedApp && savedApp in miniAppNames ? savedApp as MiniApp : 'main';","const initialApp: MiniApp = savedApp && savedApp in miniAppNames ? savedApp as MiniApp : 'main';")
s=s.replace("const appPrefix =", "function createAdminWorkspace(activeApp: MiniApp, onSelect: (value: MiniApp) => void) {\nconst appPrefix =",1)
s=s.replace('window.location.reload();','onSelect(activeApp);')
s=s.replace("  onSelect(activeApp);\n}\nfunction MiniAppSelect", "  onSelect(value);\n}\nfunction MiniAppSelect",1)
s=s.replace("const [health, setHealth] = useState<Health | null>(null);","const [health, setHealth] = useState<Health | null>(null);\n  const [healthMinutes, setHealthMinutes] = useState(30);\n  useEffect(() => { workspaceBusy = creating; return () => { workspaceBusy = false; }; }, [creating]);")
# Above effect cannot access creating before declaration during execution; move below that declaration.
s=s.replace("  useEffect(() => { workspaceBusy = creating; return () => { workspaceBusy = false; }; }, [creating]);\n",'')
s=s.replace("  const [creating, setCreating] = useState(false);","  const [creating, setCreating] = useState(false);\n  useEffect(() => { workspaceBusy = creating; return () => { workspaceBusy = false; }; }, [creating]);")
s=s.replace("  if (value === activeApp) return;", "  if (value === activeApp || workspaceBusy) return;")
s=s.replace('function selectMiniApp(value:', 'let workspaceBusy = false;\nfunction selectMiniApp(value:',1)
s=s.replace('<MiniAppSelect /><p className="workspace-label">','<MiniAppSelect />{creating && <p className="form-help">上传进行中，完成后可切换小程序。</p>}<p className="workspace-label">')
s=s.replace("api<Health>('/admin/analytics/health', { signal })", "api<Health>(`/admin/analytics/health?minutes=${healthMinutes}`, { signal })")
a=s.index('        <Panel title="小程序运行异常"'); b=s.index('        </Panel>',a)+len('        </Panel>')
s=s[:a]+'''        <HealthPanel health={health} minutes={healthMinutes} onMinutes={setHealthMinutes} error={resourceStatus.health?.error} onRefresh={() => void loadResource('health', (signal) => api<Health>(`/admin/analytics/health?minutes=${healthMinutes}`, { signal }), setHealth)} />'''+s[b:]
needle="  const activeUploads = jobs.some"
pos=s.index(needle)
s=s[:pos]+'''  useEffect(() => {
    if (!loggedIn || tab !== 'overview') return;
    const refresh = () => { if (document.visibilityState === 'visible' && !resourceControllers.current.health) void loadResource('health', (signal) => api<Health>(`/admin/analytics/health?minutes=${healthMinutes}`, { signal }), setHealth); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.clearInterval(timer); resourceControllers.current.health?.abort(); };
  }, [loggedIn, tab, healthMinutes]);
'''+s[pos:]
s=s.replace("{item.portalVersion || 'Portal 版本未填'} · {portalStatusLabels[item.portalStatus]}{item.enabled ? ' · 广告已启用' : ''}","{item.enabled ? '广告已启用' : '广告未启用'}")
s=s.replace('<label>代码版本<select','<label>构建包标识<select')
s=s.replace('<div className="form-grid"><label>Portal 版本号', '<p className="form-help">首次上报：{selectedEntryAdRelease?.firstSeenAt ? new Date(selectedEntryAdRelease.firstSeenAt).toLocaleString(\'zh-CN\') : \'尚未收到该包上报\'} · 最后上报：{selectedEntryAdRelease?.lastSeenAt ? new Date(selectedEntryAdRelease.lastSeenAt).toLocaleString(\'zh-CN\') : \'-\'}。同一构建包审核通过后继续使用同一标识和策略。</p><details><summary>Portal 人工备注（非平台自动识别）</summary><div className="form-grid"><label>Portal 版本号')
s=s.replace('保存 Portal 版本状态</button>','保存 Portal 版本状态</button></details>')
s=s.replace("      {tab === 'overview' && <>","      {tab === 'overview' && <>{overview?.updatedAt && <p className=\"data-updated\">统计更新于 {new Date(overview.updatedAt).toLocaleString('zh-CN')} · 汇总每 5 分钟刷新</p>}")
s=s.replace("createRoot(document.getElementById('root')!).render(<AdminApp />);",'''return AdminApp;
}

function AdminWorkspace() {
  const [selection, setSelection] = useState({ app: initialApp, generation: 0 });
  const Workspace = useMemo(() => createAdminWorkspace(selection.app, (app) => {
    localStorage.setItem('quickreels_active_app', app);
    setSelection((current) => ({ app, generation: current.generation + 1 }));
  }), [selection]);
  return <Workspace />;
}
createRoot(document.getElementById('root')!).render(<AdminWorkspace />);''')
p.write_text(s,encoding='utf-8')
