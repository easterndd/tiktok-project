import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, CircleAlert, Database,
  Film, FileVideo, Gauge, LayoutDashboard, ListVideo, LogIn, MoreHorizontal, RefreshCw,
  Save, Settings2, Upload, Users, Wifi
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import './styles.css';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

type Album = {
  id: string;
  title: string;
  status: string;
  episodeCount: number;
  accessConfig?: { freeEpisodeCount?: number; rewardedAdEnabled?: boolean; rewardedPlacementId?: string } | null;
};
type EpisodeOption = { id: string; albumId: string; episodeNo: number; title: string; status: string; byteplusVid?: string | null; album: { title: string; status: string } };
type Component = { key: string; page: string; enabled: boolean; config?: unknown; label?: string; updatedAt?: string | null };
type UploadJob = { id: string; episodeId: string; sourceType?: string; sourceName?: string | null; status: string; providerJobId?: string | null; errorMessage?: string | null; createdAt: string; completedAt?: string | null; episode?: { title: string; episodeNo: number } };
type Overview = { albums: number; episodes: number; users: number; likes: number; favorites: number; shares: number; searches: number; rewardedUnlocks: number };
type Audience = { periodDays: number; activeUsers: number; newUsers: number; watchSessions: number; completedEpisodes: number; favorites: number; shares: number; searches: number; dailyNewUsers: { date: string; count: number }[]; dailyActiveUsers: { date: string; count: number }[] };
type Playback = { periodDays: number; totalEvents: number; firstFrames: number; errorCount: number; errorRate: number; averageStartupMs: number | null; totalBufferMs: number; eventTypes: { eventType: string; count: number }[]; definitions: { definition: string; count: number }[]; networks: { networkType: string; count: number }[]; recentErrors: { episodeTitle: string; errorCode?: string | null; createdAt: string }[] };
type Tab = 'overview' | 'albums' | 'uploads' | 'audience' | 'playback' | 'components';

async function api<T>(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem('quickreels_admin_token');
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? '请求失败');
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function Metric({ label, value, change, icon: Icon, tone }: { label: string; value: string; change: string; icon: typeof Activity; tone: string }) {
  return <article className="metric"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong><small>{change}</small></div></article>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ accessToken: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      sessionStorage.setItem('quickreels_admin_token', result.accessToken);
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    }
  }
  return <main className="login-shell"><form className="login-panel" onSubmit={submit}><div className="brand"><span><Film size={17} /></span>QuicK <span>ReeLS</span></div><p className="eyebrow">运营管理后台</p><h1>登录内容中心</h1><p className="subhead">管理剧集、广告解锁和首页展示配置。</p><label>管理员邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary" type="submit"><LogIn size={17} />登录</button></form></main>;
}

function BarList({ title, items, color = 'pink' }: { title: string; items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return <section className="bar-list"><div className="mini-heading"><strong>{title}</strong><BarChart3 size={16} /></div>{items.length ? items.map((item) => <div className="bar-row" key={item.label}><span>{item.label}</span><i><b className={color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 5 : 0)}%` }} /></i><em>{item.value}</em></div>) : <p className="empty-copy">暂无数据</p>}</section>;
}

function DailyBars({ title, items }: { title: string; items: { date: string; count: number }[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  const visible = items.length > 14 ? items.filter((_, index) => index % Math.ceil(items.length / 14) === 0) : items;
  return <section className="daily-chart"><div className="mini-heading"><strong>{title}</strong><CalendarDays size={16} /></div><div className="daily-bars">{visible.map((item) => <div className="daily-bar" key={item.date} title={`${item.date}: ${item.count}`}><i style={{ height: `${Math.max(item.count / max * 100, item.count ? 8 : 2)}%` }} /><small>{item.date.slice(5)}</small></div>)}</div></section>;
}

function Status({ value }: { value: string }) {
  const tone = value === 'SUCCEEDED' || value === 'ONLINE' || value === 'READY' ? 'green' : value === 'FAILED' || value === 'ERROR' ? 'pink' : 'yellow';
  return <span className={`status ${tone}`}><i />{value}</span>;
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}

function AdminApp() {
  const [loggedIn, setLoggedIn] = useState(Boolean(sessionStorage.getItem('quickreels_admin_token')));
  const [tab, setTab] = useState<Tab>('overview');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [overview, setOverview] = useState<Overview>({ albums: 0, episodes: 0, users: 0, likes: 0, favorites: 0, shares: 0, searches: 0, rewardedUnlocks: 0 });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [uploadEpisodeId, setUploadEpisodeId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [albumResult, episodeResult, componentResult, overviewResult, jobResult, audienceResult, playbackResult] = await Promise.all([
        api<{ items: Album[] }>('/admin/albums'),
        api<{ items: EpisodeOption[] }>('/admin/episodes'),
        api<Component[]>('/admin/ui-components'),
        api<Overview>('/admin/analytics/overview'),
        api<{ items: UploadJob[] }>('/admin/upload-jobs'),
        api<Audience>(`/admin/analytics/audience?days=${analyticsDays}`),
        api<Playback>(`/admin/analytics/playback-quality?days=${analyticsDays}`)
      ]);
      setAlbums(albumResult.items);
      setEpisodes(episodeResult.items);
      setComponents(componentResult);
      setOverview(overviewResult);
      setJobs(jobResult.items);
      setAudience(audienceResult);
      setPlayback(playbackResult);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (loggedIn) void loadData(); }, [loggedIn, analyticsDays]);
  const selectedEpisodes = useMemo(() => episodes.filter((episode) => episode.album.status !== 'OFFLINE'), [episodes]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const updateAccess = async (album: Album) => {
    const accessConfig = { freeEpisodeCount: 0, rewardedAdEnabled: true, rewardedPlacementId: 'rewarded_episode_unlock', ...album.accessConfig };
    await api(`/admin/albums/${album.id}`, { method: 'PATCH', body: JSON.stringify({ accessConfig }) });
    setMessage('剧集访问配置已保存');
  };
  const updateComponent = async (component: Component) => {
    const next = { ...component, enabled: !component.enabled };
    await api(`/admin/ui-components/${component.key}`, { method: 'PATCH', body: JSON.stringify({ enabled: next.enabled, page: component.page }) });
    setComponents((items) => items.map((item) => item.key === component.key ? next : item));
    setMessage(`${component.label ?? component.key}已${next.enabled ? '开启' : '关闭'}`);
  };
  const submitUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!uploadFile || !uploadEpisodeId) {
      setMessage('请选择剧集和视频文件');
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('episodeId', uploadEpisodeId);
      form.append('file', uploadFile);
      await api('/admin/upload-jobs/local', { method: 'POST', body: form });
      setMessage('视频已上传到 BytePlus VOD，Episode 已进入 READY 状态。');
      setUploadFile(null);
      setUploadEpisodeId('');
      const input = document.getElementById('video-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '视频上传失败');
    } finally {
      setUploading(false);
    }
  };
  const tabLabels: Record<Tab, string> = { overview: '概览', albums: '剧集与解锁', uploads: '上传任务', audience: '观众数据', playback: '播放质量', components: '页面组件开关' };
  const title = tab === 'overview' ? '内容运营概览' : tab === 'uploads' ? 'BytePlus 媒资上传' : tab === 'audience' ? '观众数据' : tab === 'playback' ? '播放质量' : tab === 'components' ? '页面组件开关' : '剧集与解锁配置';

  return <div className="admin-layout"><aside className="sidebar"><div className="brand"><span><Film size={17} /></span>QuicK <span>ReeLS</span></div><p className="workspace-label">运营工作区</p><nav>
    {([['overview', LayoutDashboard, '概览'], ['albums', ListVideo, '剧集与解锁'], ['uploads', Upload, '上传任务'], ['audience', Users, '观众数据'], ['playback', Activity, '播放质量']] as const).map(([key, Icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}
  </nav><div className="sidebar-bottom"><button className={tab === 'components' ? 'active' : ''} onClick={() => setTab('components')}><Settings2 size={17} />页面组件开关</button><div className="account"><span className="account-avatar">OP</span><span><strong>运营管理员</strong><small>TK小程序管理后台</small></span><MoreHorizontal size={16} /></div></div></aside>
    <main className="main"><header className="page-header"><div><p className="eyebrow">运营管理 / {tabLabels[tab]}</p><h1>{title}</h1><p className="subhead">数据和配置通过 API 实时同步到 QuicK ReeLS 小程序。</p></div><div className="header-actions"><button className="secondary" onClick={() => void loadData()} title="刷新数据"><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button><button className="secondary" onClick={() => { sessionStorage.removeItem('quickreels_admin_token'); setLoggedIn(false); }}>退出登录</button></div></header>{message && <div className="notice"><CheckCircle2 size={16} />{message}</div>}
      {(tab === 'audience' || tab === 'playback') && <div className="toolbar"><span><CalendarDays size={15} />统计周期</span><select value={analyticsDays} onChange={(event) => setAnalyticsDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></div>}
      {tab === 'overview' && <><section className="metrics"><Metric label="在线剧集" value={String(overview.albums)} change="实时数据" icon={Film} tone="pink" /><Metric label="在线集数" value={String(overview.episodes)} change="已通过发布条件" icon={ListVideo} tone="cyan" /><Metric label="用户数" value={String(overview.users)} change="累计注册" icon={Users} tone="green" /><Metric label="广告解锁" value={String(overview.rewardedUnlocks)} change="累计完成" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="运营健康度" description="关键业务数据当前状态"><div className="readiness-list"><div><span className="ready-dot done"><CheckCircle2 size={15} /></span><span><strong>剧集元数据与访问策略</strong><small>{overview.albums} 部在线剧集 · {overview.episodes} 集可见</small></span><em>正常</em></div><div><span className="ready-dot done"><Database size={15} /></span><span><strong>观众行为采集</strong><small>{overview.likes} 次点赞 · {overview.favorites} 次收藏 · {overview.searches} 次搜索</small></span><em>正常</em></div><div><span className="ready-dot done"><Gauge size={15} /></span><span><strong>播放质量采集</strong><small>{playback?.totalEvents ?? 0} 条播放器事件已入库</small></span><em>正常</em></div></div></Panel><Panel title="最近上传" description="BytePlus VOD 媒资任务"><div className="compact-list">{jobs.slice(0, 5).map((job) => <div className="compact-row" key={job.id}><FileVideo size={17} /><span><strong>{job.episode?.title ?? job.episodeId}</strong><small>{job.sourceName ?? job.sourceType ?? 'URL'}</small></span><Status value={job.status} /></div>)}{!jobs.length && <p className="empty-copy">还没有上传任务</p>}</div></Panel></div></>}
      {tab === 'albums' && <Panel title="剧集访问策略" description="免费集数和广告解锁配置会立即影响小程序访问"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>状态</th><th>集数</th><th>免费集数</th><th>广告解锁</th><th>操作</th></tr></thead><tbody>{albums.map((album) => <tr key={album.id}><td><span className="drama-thumb" /><strong>{album.title}</strong></td><td><Status value={album.status} /></td><td>{album.episodeCount}</td><td><input className="inline-number" type="number" min="0" value={album.accessConfig?.freeEpisodeCount ?? 0} onChange={(event) => setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, accessConfig: { ...item.accessConfig, freeEpisodeCount: Number(event.target.value) } } : item))} /></td><td><input type="checkbox" checked={album.accessConfig?.rewardedAdEnabled ?? true} onChange={(event) => setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, accessConfig: { ...item.accessConfig, rewardedAdEnabled: event.target.checked } } : item))} /></td><td><button className="save-button" onClick={() => void updateAccess(album)}><Save size={15} />保存</button></td></tr>)}</tbody></table></div></Panel>}
      {tab === 'uploads' && <><Panel title="上传本地视频到 BytePlus VOD" description="选择本地视频后由后端使用安全凭证上传，密钥不会进入浏览器"><form className="upload-form" onSubmit={submitUpload}><label>目标剧集<select value={uploadEpisodeId} onChange={(event) => setUploadEpisodeId(event.target.value)} required><option value="">选择一个 Episode</option>{selectedEpisodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.album.title} · 第 {episode.episodeNo} 集 · {episode.title} {episode.byteplusVid ? '· 已有媒资' : ''}</option>)}</select></label><label>本地视频文件<input id="video-file" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required /></label>{uploadFile && <p className="file-hint"><FileVideo size={15} />{uploadFile.name} · {(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>}<button className="primary" type="submit" disabled={uploading}><Upload size={17} />{uploading ? '上传中，请勿关闭页面...' : '上传到 BytePlus'}</button></form></Panel><Panel title="上传任务" description="本地上传完成后会直接写入 BytePlus Vid；公网 URL 任务仍由 Worker 继续处理"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>来源</th><th>状态</th><th>BytePlus Job</th><th>创建时间</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.episode?.title ?? job.episodeId}</strong></td><td>{job.sourceName ?? job.sourceType ?? 'URL'}</td><td><Status value={job.status} />{job.errorMessage && <small className="table-error">{job.errorMessage}</small>}</td><td>{job.providerJobId ?? '本地上传已确认'}</td><td>{new Date(job.createdAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table>{!jobs.length && <p className="empty-copy table-empty">暂无上传任务</p>}</div></Panel></>}
      {tab === 'audience' && audience && <><section className="metrics"><Metric label="活跃观众" value={String(audience.activeUsers)} change={`近 ${audience.periodDays} 天`} icon={Users} tone="green" /><Metric label="新增观众" value={String(audience.newUsers)} change="按注册时间" icon={Database} tone="cyan" /><Metric label="观看会话" value={String(audience.watchSessions)} change="进度上报次数" icon={Film} tone="pink" /><Metric label="完播集数" value={String(audience.completedEpisodes)} change="进度完成标记" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="观众趋势" description="按天统计新增和活跃用户"><DailyBars title="新增观众" items={audience.dailyNewUsers} /><DailyBars title="活跃观众事件" items={audience.dailyActiveUsers} /></Panel><Panel title="互动概览" description="帮助判断内容和运营活动表现"><BarList title="互动指标" items={[{ label: '收藏', value: audience.favorites }, { label: '分享', value: audience.shares }, { label: '搜索', value: audience.searches }]} color="cyan" /></Panel></div></>}
      {tab === 'playback' && playback && <><section className="metrics"><Metric label="播放器事件" value={String(playback.totalEvents)} change={`近 ${playback.periodDays} 天`} icon={Activity} tone="cyan" /><Metric label="首帧事件" value={String(playback.firstFrames)} change="成功启动" icon={Gauge} tone="green" /><Metric label="错误率" value={`${playback.errorRate}%`} change={`${playback.errorCount} 次错误`} icon={CircleAlert} tone="pink" /><Metric label="平均首帧" value={playback.averageStartupMs === null ? '-' : `${playback.averageStartupMs} ms`} change="启动耗时" icon={Wifi} tone="yellow" /></section><div className="content-grid"><Panel title="播放事件分布" description="根据小程序播放器上报聚合"><BarList title="事件类型" items={playback.eventTypes.map((item) => ({ label: item.eventType, value: item.count }))} /><BarList title="清晰度" items={playback.definitions.map((item) => ({ label: item.definition, value: item.count }))} color="cyan" /><BarList title="网络类型" items={playback.networks.map((item) => ({ label: item.networkType, value: item.count }))} color="green" /></Panel><Panel title="最近播放错误" description="优先定位实际影响用户的剧集"><div className="compact-list">{playback.recentErrors.map((error, index) => <div className="compact-row" key={`${error.createdAt}-${index}`}><CircleAlert size={17} /><span><strong>{error.episodeTitle}</strong><small>{error.errorCode ?? 'UNKNOWN'} · {new Date(error.createdAt).toLocaleString('zh-CN')}</small></span></div>)}{!playback.recentErrors.length && <p className="empty-copy">暂无播放错误</p>}</div></Panel></div></>}
      {tab === 'components' && <Panel title="小程序组件开关" description="开关保存后，小程序下一次拉取配置即可生效" action={<AlertTriangle size={18} className="alert" />}><div className="component-list">{components.map((component) => <div className="component-row" key={component.key}><span><strong>{component.label ?? component.key}</strong><small>{component.key} · {component.page} 页面</small></span><button className={`switch ${component.enabled ? 'on' : ''}`} onClick={() => void updateComponent(component)} aria-label={`${component.label ?? component.key} ${component.enabled ? '关闭' : '开启'}`}><span /></button><em className={component.enabled ? '' : 'disabled-text'}>{component.enabled ? '已开启' : '已关闭'}</em></div>)}</div></Panel>}
    </main></div>;
}

createRoot(document.getElementById('root')!).render(<AdminApp />);
