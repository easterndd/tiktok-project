import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, CircleAlert, Database,
  Film, FileVideo, Gauge, Image, LayoutDashboard, ListVideo, LogIn, Megaphone, MoreHorizontal, Plus,
  RefreshCw, Save, Settings2, Trash2, Users, Wifi
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { defaultEpisodeTitle, nextEpisodeNo, renumberEpisodes, resolveAppendEpisodes } from './episode-draft';
import './styles.css';

type MiniApp = 'main' | 'taletv' | 'cinereels' | 'talereels';
const miniAppNames: Record<MiniApp, string> = { main: 'QuicK ReeLS', taletv: 'TaleTV', cinereels: 'CineReels', talereels: 'TaleReels' };
const miniAppPaths: Record<Exclude<MiniApp, 'main'>, string> = { taletv: 'taletv', cinereels: 'cinereels', talereels: 'talereels' };
const miniAppEnvPrefixes: Record<Exclude<MiniApp, 'main'>, string> = { taletv: 'TALETV', cinereels: 'CINEREELS', talereels: 'TALEREELS' };
if (localStorage.getItem('quickreels_active_app') === 'xu03') localStorage.setItem('quickreels_active_app', 'taletv');
for (const suffix of ['content_draft', 'content_templates']) {
  const oldKey = `quickreels_xu03_${suffix}`;
  const nextKey = `quickreels_taletv_${suffix}`;
  const saved = localStorage.getItem(oldKey);
  if (saved !== null) {
    if (localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, saved);
    localStorage.removeItem(oldKey);
  }
}
sessionStorage.removeItem('quickreels_xu03_admin_token');
const savedApp = localStorage.getItem('quickreels_active_app');
const activeApp: MiniApp = savedApp && savedApp in miniAppNames ? savedApp as MiniApp : 'main';
const primaryApi = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const env = import.meta.env as Record<string, string | undefined>;
const appPrefix = activeApp === 'main' ? '' : miniAppEnvPrefixes[activeApp];
const API = activeApp === 'main'
  ? primaryApi
  : env[`VITE_${appPrefix}_API_BASE_URL`] || new URL(`/api/${miniAppPaths[activeApp]}/v1`, primaryApi).toString().replace(/\/$/, '');
const adminTokenStorageKey = activeApp === 'main' ? 'quickreels_admin_token' : `quickreels_${activeApp}_admin_token`;
const defaultPlacementId = activeApp === 'main' ? env.VITE_REWARDED_PLACEMENT_ID ?? 'ad7686459794040702993' : env[`VITE_${appPrefix}_REWARDED_PLACEMENT_ID`] ?? '';
const defaultEntryPlacementId = activeApp === 'main' ? env.VITE_APP_ENTRY_PLACEMENT_ID ?? 'ad7686459458972829697' : env[`VITE_${appPrefix}_APP_ENTRY_PLACEMENT_ID`] ?? '';
function selectMiniApp(value: MiniApp) {
  if (value === activeApp) return;
  localStorage.setItem('quickreels_active_app', value);
  window.location.reload();
}
function MiniAppSelect() {
  return <label className="mini-app-select">当前小程序<select value={activeApp} onChange={(event) => selectMiniApp(event.target.value as MiniApp)}>{Object.entries(miniAppNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}
let adminSessionRecoveryStarted = false;

type Album = {
  id: string;
  title: string;
  status: string;
  episodeCount: number;
  coverUrl?: string;
  coverAssetId?: string | null;
  tiktokAlbumId?: string | null;
  tiktokVersion?: number | null;
  onlineVersion?: number | null;
  platformPublishedVersion?: number | null;
  reviewStatus?: string | null;
  publishStatus?: string | null;
  accessConfig?: { freeEpisodeCount?: number; rewardedAdEnabled?: boolean; rewardedPlacementId?: string; rewardedAdCount?: number } | null;
};
function platformNextStep(album: Album) {
  if (!album.tiktokVersion) return '先同步媒资并确认完成，再同步版本。';
  if (album.onlineVersion && album.tiktokVersion > album.onlineVersion && (album.reviewStatus === 'REVIEWING' || album.reviewStatus === '1')) return '线上旧版本继续服务，新版本审核中；稍后对账。';
  if (album.reviewStatus === 'PASSED' || album.reviewStatus === '2') {
    if (album.onlineVersion !== album.tiktokVersion) return '新版本审核已通过，设置线上版本并对账。';
    if (album.publishStatus !== 'LISTED' && album.publishStatus !== '1') return '线上版本已设置，可以上架。';
    if (album.platformPublishedVersion !== album.onlineVersion) return '线上版本已切换，请对账确认新分集。';
    return '已上架，请在小程序测试播放与广告解锁。';
  }
  if (album.reviewStatus === 'REVIEWING' || album.reviewStatus === '1') return '当前版本审核中，送审优先级不能再修改。点击“对账”查看结果；如需催审，请联系 TikTok 平台支持。';
  return '确认版本同步成功后送审；如已送审，先点“对账”确认审核结果。';
}
type EpisodeOption = { id: string; albumId: string; episodeNo: number; title: string; sortOrder: number; status: string; byteplusVid?: string | null; album: { title: string; status: string } };
type CoverAsset = { id: string; publicUrl: string; status: string; width?: number | null; height?: number | null };
type DraftEpisode = { localId: string; episodeNo: number; title: string; sortOrder: number; isFree: boolean; file?: File | null; coverFile?: File | null; coverAsset?: CoverAsset | null; coverPreviewUrl?: string; savedEpisodeId?: string; uploadStatus?: string; uploadError?: string };
type UploadJob = { id: string; episodeId: string; sourceType?: string; sourceName?: string | null; status: string; providerJobId?: string | null; errorMessage?: string | null; createdAt: string; startedAt?: string | null; completedAt?: string | null; episode?: { title: string; episodeNo: number } };
type PlatformSyncJob = { id: string; albumId?: string | null; kind: string; status: string; errorMessage?: string | null; createdAt: string; snapshotJson?: { priorityScore?: number; version?: number } | null; providerResponse?: { version?: number } | null; album?: { title: string } | null; episode?: { title: string } | null };
type SharedAuthorization = { id: string; miniAppKey: MiniApp; targetClientKey: string; targetLocalAlbumId?: string | null; status: string; errorMessage?: string | null; authorizedAt?: string | null; lastReconciledAt?: string | null };
type SharedAlbum = { id: string; ownerMiniAppKey: MiniApp; tiktokAlbumId: string; currentVersion?: number | null; onlineVersion?: number | null; reviewStatus?: string | null; publishStatus?: string | null; authorizations: SharedAuthorization[]; episodes?: { episodeNo: number; title: string; tiktokEpisodeId: string; media?: { byteplusVid: string } }[] };
type ContentTemplate = { id: string; name: string; dramaType: number; tagList: string; freeCount: number; rewardedEnabled: boolean; placementId: string; rewardedCount: number };
const platformJobLabels: Record<string, string> = { COVER: '同步封面', VIDEO: '同步视频', ALBUM_VERSION: '同步版本', REVIEW: '送审', RECONCILE: '对账', SET_ONLINE_VERSION: '设线上版本', PUBLISH: '上架', UNPUBLISH: '下架' };
type Overview = { albums: number; episodes: number; users: number; likes: number; favorites: number; shares: number; searches: number; rewardedUnlocks: number };
type Audience = { from: string; to: string; timezone: string; periodDays: number; activeUsers: number; dau: number; wau: number; mau: number; newUsers: number; watchSessions: number; completedEpisodes: number; favorites: number; shares: number; searches: number; dailyNewUsers: { date: string; count: number }[]; dailyActiveUsers: { date: string; count: number }[] };
type Playback = { from: string; to: string; timezone: string; periodDays: number; totalEvents: number; firstFrames: number; errorCount: number; errorRate: number; averageStartupMs: number | null; totalBufferMs: number; eventTypes: { eventType: string; count: number }[]; definitions: { definition: string; count: number }[]; networks: { networkType: string; count: number }[]; recentErrors: { episodeTitle: string; errorCode?: string | null; createdAt: string }[] };
type AppEntryAdPolicy = { enabled: boolean; mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; requiredCount: number; onUnavailable: 'ALLOW' | 'BLOCK'; version: number };
type AdminRole = 'OWNER' | 'EDITOR' | 'ANALYST' | 'SUPPORT';
type AdminPermission = 'content.write' | 'content.sync' | 'content.review' | 'content.publish' | 'ads.write';
type AdminProfile = { id: string; email: string; role: AdminRole; status: string; lastLoginAt?: string | null; passwordChangedAt?: string | null };
type Tab = 'overview' | 'create' | 'albums' | 'ads' | 'audience' | 'playback' | 'security';
const contentDraftStorageKey = activeApp === 'main' ? 'quickreels_content_draft' : `quickreels_${activeApp}_content_draft`;
const contentTemplateStorageKey = activeApp === 'main' ? 'quickreels_content_templates' : `quickreels_${activeApp}_content_templates`;

const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  OWNER: ['content.write', 'content.sync', 'content.review', 'content.publish', 'ads.write'],
  EDITOR: ['content.write', 'content.sync', 'ads.write'],
  ANALYST: [],
  SUPPORT: []
};

function hasAdminPermission(role: AdminRole | undefined, permission: AdminPermission) {
  return role ? rolePermissions[role].includes(permission) : false;
}

function inputDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeStart(days: number) {
  const value = new Date();
  value.setDate(value.getDate() - days + 1);
  return inputDate(value);
}

async function api<T>(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem(adminTokenStorageKey);
  const isFormData = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(isFormData || options.body == null ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error('无法连接后台 API，请检查 API 服务、域名和网络连接。');
  }
  if (!response.ok) {
    const message = (await response.json().catch(() => null))?.error?.message ?? '请求失败';
    // The login endpoint deliberately returns 401 for incorrect credentials. Every
    // other 401 means the active administrator session can no longer be used.
    if (response.status === 401 && path !== '/admin/auth/login') {
      sessionStorage.removeItem(adminTokenStorageKey);
      if (!adminSessionRecoveryStarted) {
        adminSessionRecoveryStarted = true;
        window.location.reload();
      }
      throw new Error('管理员登录已失效，正在返回登录页。');
    }
    throw new Error(message);
  }
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
      sessionStorage.setItem(adminTokenStorageKey, result.accessToken);
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    }
  }
  return <main className="login-shell"><form className="login-panel" onSubmit={submit}><div className="brand"><span><Film size={17} /></span>QuicK <span>ReeLS</span></div><p className="eyebrow">运营管理后台</p><h1>登录内容中心</h1><p className="subhead">管理剧集、广告解锁和首页展示配置。</p><MiniAppSelect /><label>管理员邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary" type="submit"><LogIn size={17} />登录</button></form></main>;
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
  const labels: Record<string, string> = {
    DRAFT: '草稿', REVIEWING: '审核中', ONLINE: '已上线', OFFLINE: '已下线', REJECTED: '已驳回',
    UPLOADING: '上传中', READY: '已就绪', PENDING: '待处理', PROCESSING: '处理中', SUCCEEDED: '已完成',
    FAILED: '失败', ERROR: '错误', CONFLICT: '结果未知', ACTIVE: '进行中', COMPLETED: '已完成', EXPIRED: '已过期',
    AUTHORIZED: '已授权', AUTHORIZING: '授权中', REVOKED: '已撤销', REVOKING: '撤销中'
  };
  const tone = value === 'SUCCEEDED' || value === 'ONLINE' || value === 'READY' || value === 'COMPLETED' ? 'green' : value === 'FAILED' || value === 'ERROR' || value === 'OFFLINE' || value === 'REJECTED' || value === 'CONFLICT' ? 'pink' : 'yellow';
  return <span className={`status ${tone}`}><i />{labels[value] ?? value}</span>;
}

function episodeNoFromName(fileName: string) {
  const patterns = [/第\s*0*(\d+)\s*集/i, /Episode\s*0*(\d+)/i, /\bE0*(\d+)\b/i, /\bS\d+E0*(\d+)\b/i];
  for (const pattern of patterns) {
    const match = pattern.exec(fileName);
    if (match) return Number(match[1]);
  }
  return null;
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}

function AdminApp() {
  const [loggedIn, setLoggedIn] = useState(Boolean(sessionStorage.getItem(adminTokenStorageKey)));
  const [tab, setTab] = useState<Tab>('overview');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState<AdminProfile | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [platformJobs, setPlatformJobs] = useState<PlatformSyncJob[]>([]);
  const [sharedAlbums, setSharedAlbums] = useState<SharedAlbum[]>([]);
  const [overview, setOverview] = useState<Overview>({ albums: 0, episodes: 0, users: 0, likes: 0, favorites: 0, shares: 0, searches: 0, rewardedUnlocks: 0 });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [entryAdPolicy, setEntryAdPolicy] = useState<AppEntryAdPolicy>({ enabled: false, mode: 'REWARDED_GATED', placementId: defaultEntryPlacementId, requiredCount: 1, onUnavailable: 'ALLOW', version: 1 });
  const [analyticsFrom, setAnalyticsFrom] = useState(() => rangeStart(30));
  const [analyticsTo, setAnalyticsTo] = useState(() => inputDate(new Date()));
  const [analyticsTimezone, setAnalyticsTimezone] = useState('Asia/Shanghai');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createReleaseYear, setCreateReleaseYear] = useState(new Date().getFullYear());
  const [createDramaType, setCreateDramaType] = useState(2);
  const [createTagList, setCreateTagList] = useState('1');
  const [createCoverFile, setCreateCoverFile] = useState<File | null>(null);
  const [createCover, setCreateCover] = useState<CoverAsset | null>(null);
  const [createCoverPreviewUrl, setCreateCoverPreviewUrl] = useState('');
  const [createFreeCount, setCreateFreeCount] = useState(3);
  const [createRewardedEnabled, setCreateRewardedEnabled] = useState(true);
  const [createPlacementId, setCreatePlacementId] = useState(defaultPlacementId);
  const [createRewardedCount, setCreateRewardedCount] = useState(1);
  const [createMode, setCreateMode] = useState<'new' | 'append'>('new');
  const [targetAlbumId, setTargetAlbumId] = useState('');
  const [createdAlbumId, setCreatedAlbumId] = useState('');
  const [templates, setTemplates] = useState<ContentTemplate[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(contentTemplateStorageKey) ?? '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [draftEpisodes, setDraftEpisodes] = useState<DraftEpisode[]>(() => Array.from({ length: 3 }, (_, index) => ({ localId: `draft-${index + 1}`, episodeNo: index + 1, title: `第 ${index + 1} 集`, sortOrder: index + 1, isFree: false })));
  const [creating, setCreating] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [message, setMessage] = useState('');
  const [createError, setCreateError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingEntryAdPolicy, setSavingEntryAdPolicy] = useState(false);
  const [savingAlbumId, setSavingAlbumId] = useState<string | null>(null);
  const [deletingAlbumId, setDeletingAlbumId] = useState<string | null>(null);
  const [dirtyAccessAlbumIds, setDirtyAccessAlbumIds] = useState<Set<string>>(() => new Set());
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [reconcilingJobId, setReconcilingJobId] = useState<string | null>(null);
  const [platformWorking, setPlatformWorking] = useState<string | null>(null);
  const [reviewPriorities, setReviewPriorities] = useState<Record<string, 1 | 2>>({});
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const loadEntryAdPolicy = async () => {
    try {
      const policy = await api<AppEntryAdPolicy>('/admin/app-entry-ad-policy');
      setEntryAdPolicy(policy);
      return true;
    } catch (error) {
      return false;
    }
  };

  const loadData = async () => {
    setLoading(true);
    const entryAdPolicyRequest = loadEntryAdPolicy();
    const failures: string[] = [];
    try {
      const results = await Promise.allSettled([
        api<{ items: Album[] }>('/admin/albums'),
        api<{ items: EpisodeOption[] }>('/admin/episodes'),
        api<Overview>('/admin/analytics/overview'),
        api<{ items: UploadJob[] }>('/admin/upload-jobs'),
        api<Audience>(`/admin/analytics/audience?${new URLSearchParams({ from: analyticsFrom, to: analyticsTo, timezone: analyticsTimezone })}`),
        api<Playback>(`/admin/analytics/playback-quality?${new URLSearchParams({ from: analyticsFrom, to: analyticsTo, timezone: analyticsTimezone })}`),
        api<{ admin: AdminProfile }>('/admin/me'),
        api<{ items: PlatformSyncJob[] }>('/admin/platform-sync-jobs?limit=50'),
        api<{ items: SharedAlbum[] }>('/admin/shared/albums')
      ]);
      const read = <T,>(index: number, label: string) => {
        const result = results[index] as PromiseSettledResult<T>;
        if (result.status === 'fulfilled') return result.value;
        failures.push(label);
        return null;
      };
      const albumResult = read<{ items: Album[] }>(0, '剧集');
      const episodeResult = read<{ items: EpisodeOption[] }>(1, '集数');
      const overviewResult = read<Overview>(2, '概览');
      const jobResult = read<{ items: UploadJob[] }>(3, '上传任务');
      const audienceResult = read<Audience>(4, '观众分析');
      const playbackResult = read<Playback>(5, '播放分析');
      const adminResult = read<{ admin: AdminProfile }>(6, '管理员信息');
      const platformJobResult = read<{ items: PlatformSyncJob[] }>(7, '平台同步任务');
      const sharedAlbumResult = read<{ items: SharedAlbum[] }>(8, '共享剧目');
      if (albumResult) setAlbums(albumResult.items);
      if (episodeResult) setEpisodes(episodeResult.items);
      if (overviewResult) setOverview(overviewResult);
      if (jobResult) setJobs(jobResult.items);
      if (audienceResult) setAudience(audienceResult);
      if (playbackResult) setPlayback(playbackResult);
      if (adminResult) setCurrentAdmin(adminResult.admin);
      if (platformJobResult) setPlatformJobs(platformJobResult.items);
      if (sharedAlbumResult) setSharedAlbums(sharedAlbumResult.items);
    } finally {
      if (!(await entryAdPolicyRequest)) failures.push('进入广告策略');
      setMessage(failures.length ? `部分数据加载失败：${failures.join('、')}。请点击刷新重试。` : '');
      setLoading(false);
    }
  };

  useEffect(() => { if (loggedIn) void loadData(); }, [loggedIn, analyticsFrom, analyticsTo, analyticsTimezone]);
  useEffect(() => {
    if (!draftReady || createdAlbumId || targetAlbumId || !episodes.length) return;
    const saved = draftEpisodes.find((episode) => episode.savedEpisodeId);
    if (!saved) return;
    const albumId = episodes.find((episode) => episode.id === saved.savedEpisodeId)?.albumId;
    if (albumId) {
      setCreateMode('append');
      setTargetAlbumId(albumId);
      setMessage('已识别旧版草稿所属剧集，后续新增分集将追加到该剧集。');
    }
  }, [draftReady, createdAlbumId, targetAlbumId, episodes, draftEpisodes]);
  useEffect(() => {
    if (!draftReady || createMode !== 'append' || !targetAlbumId || !episodes.length) return;
    const existing = episodes.filter((episode) => episode.albumId === targetAlbumId);
    if (!existing.length) return;
    setDraftEpisodes((current) => {
      const resolved = resolveAppendEpisodes(current, existing);
      if (resolved.some((draft, index) => draft !== current[index])) return resolved;
      if (current.length !== 1 || current[0].file || current[0].savedEpisodeId) return current;
      if (!existing.some((episode) => episode.episodeNo === current[0].episodeNo && episode.byteplusVid)) return current;
      const episodeNo = Math.max(...existing.map((episode) => episode.episodeNo)) + 1;
      const sortOrder = Math.max(...existing.map((episode) => episode.sortOrder)) + 1;
      return [{ localId: `draft-${Date.now()}`, episodeNo, title: defaultEpisodeTitle(episodeNo), sortOrder, isFree: false }];
    });
  }, [draftReady, createMode, targetAlbumId, episodes]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(contentDraftStorageKey) ?? 'null') as { title?: string; description?: string; releaseYear?: number; dramaType?: number; tagList?: string; cover?: CoverAsset | null; freeCount?: number; rewardedEnabled?: boolean; placementId?: string; rewardedCount?: number; episodes?: DraftEpisode[]; mode?: 'new' | 'append'; targetAlbumId?: string; createdAlbumId?: string } | null;
      if (saved) {
        setCreateMode(saved.mode === 'append' ? 'append' : 'new');
        setTargetAlbumId(saved.targetAlbumId ?? '');
        setCreatedAlbumId(saved.createdAlbumId ?? '');
        setCreateTitle(saved.title ?? '');
        setCreateDescription(saved.description ?? '');
        setCreateReleaseYear(saved.releaseYear ?? new Date().getFullYear());
        setCreateDramaType(saved.dramaType ?? 2);
        setCreateTagList(saved.tagList ?? '1');
        setCreateCover(saved.cover ?? null);
        setCreateFreeCount(saved.freeCount ?? 3);
        setCreateRewardedEnabled(saved.rewardedEnabled ?? true);
        setCreatePlacementId(saved.placementId ?? defaultPlacementId);
        setCreateRewardedCount(saved.rewardedCount ?? 1);
        if (saved.episodes?.length) setDraftEpisodes(saved.episodes.map((episode) => ({ ...episode, file: null, coverFile: null, coverPreviewUrl: '' })));
        setMessage('已恢复本地草稿；本地文件需重新选择后再上传。');
      }
    } catch {
      localStorage.removeItem(contentDraftStorageKey);
    } finally {
      setDraftReady(true);
    }
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    localStorage.setItem(contentDraftStorageKey, JSON.stringify({ title: createTitle, description: createDescription, releaseYear: createReleaseYear, dramaType: createDramaType, tagList: createTagList, cover: createCover, freeCount: createFreeCount, rewardedEnabled: createRewardedEnabled, placementId: createPlacementId, rewardedCount: createRewardedCount, mode: createMode, targetAlbumId, createdAlbumId, episodes: draftEpisodes.map(({ file, coverFile, coverPreviewUrl, ...episode }) => episode) }));
  }, [createTitle, createDescription, createReleaseYear, createDramaType, createTagList, createCover, createFreeCount, createRewardedEnabled, createPlacementId, createRewardedCount, createMode, targetAlbumId, createdAlbumId, draftEpisodes, draftReady]);
  useEffect(() => { localStorage.setItem(contentTemplateStorageKey, JSON.stringify(templates)); }, [templates]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const resetCreateForm = () => {
    setCreateError('');
    setCreateMode('new');
    setTargetAlbumId('');
    setCreatedAlbumId('');
    setCreateTitle('');
    setCreateDescription('');
    setCreateReleaseYear(new Date().getFullYear());
    setCreateDramaType(2);
    setCreateTagList('1');
    setCreateCoverFile(null);
    setCreateCover(null);
    setCreateCoverPreviewUrl('');
    setCreateFreeCount(3);
    setCreateRewardedEnabled(true);
    setCreatePlacementId(defaultPlacementId);
    setCreateRewardedCount(1);
    setBatchFeedback('');
    setSelectedTemplateId('');
    localStorage.removeItem(contentDraftStorageKey);
    setDraftEpisodes(Array.from({ length: 3 }, (_, index) => ({ localId: `draft-${Date.now()}-${index + 1}`, episodeNo: index + 1, title: `第 ${index + 1} 集`, sortOrder: index + 1, isFree: false })));
  };

  const hasActiveContent = () => Boolean(createTitle.trim() || createDescription.trim() || createCoverFile || createCover || createdAlbumId || targetAlbumId || draftEpisodes.some((episode) => episode.file || episode.savedEpisodeId));

  const selectCreateMode = (mode: 'new' | 'append') => {
    if (mode === createMode) return;
    if (hasActiveContent() && !window.confirm('切换模式将清空当前表单；已创建的剧集不会删除。确定继续吗？')) return;
    resetCreateForm();
    setCreateMode(mode);
    if (mode === 'append') setDraftEpisodes([]);
  };

  const selectTargetAlbum = (albumId: string) => {
    if (draftEpisodes.some((episode) => episode.file || episode.savedEpisodeId) && !window.confirm('切换目标剧集将清空当前分集编辑，确定继续吗？')) return;
    setTargetAlbumId(albumId);
    setCreateError('');
    const existing = episodes.filter((episode) => episode.albumId === albumId);
    const episodeNo = Math.max(0, ...existing.map((episode) => episode.episodeNo)) + 1;
    const sortOrder = Math.max(0, ...existing.map((episode) => episode.sortOrder ?? episode.episodeNo)) + 1;
    setDraftEpisodes(albumId ? [{ localId: `draft-${Date.now()}`, episodeNo, title: defaultEpisodeTitle(episodeNo), sortOrder, isFree: false }] : []);
    setMessage(albumId ? `已选择目标剧集，新增分集将从第 ${episodeNo} 集开始。` : '');
  };

  const saveTemplate = () => {
    const name = window.prompt('模板名称')?.trim();
    if (!name) return;
    const template: ContentTemplate = { id: crypto.randomUUID(), name, dramaType: createDramaType, tagList: createTagList, freeCount: createFreeCount, rewardedEnabled: createRewardedEnabled, placementId: createPlacementId, rewardedCount: createRewardedCount };
    setTemplates((current) => [...current.filter((item) => item.name !== name), template]);
    setSelectedTemplateId(template.id);
    setMessage(`模板“${name}”已保存在当前浏览器。`);
  };

  const applyTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template || createMode !== 'new' || createdAlbumId) return;
    setCreateDramaType(template.dramaType);
    setCreateTagList(template.tagList);
    setCreateFreeCount(template.freeCount);
    setCreateRewardedEnabled(template.rewardedEnabled);
    setCreatePlacementId(template.placementId);
    setCreateRewardedCount(template.rewardedCount);
    setMessage(`已应用模板“${template.name}”。`);
  };

  const uploadCover = async () => {
    if (!createCoverFile) throw new Error('请选择专辑封面');
    const form = new FormData();
    form.append('file', createCoverFile);
    const asset = await api<CoverAsset>('/admin/cover-assets', { method: 'POST', body: form });
    setCreateCover(asset);
    return asset;
  };

  const uploadEpisodeCover = async (draft: DraftEpisode) => {
    if (!draft.coverFile) return draft.coverAsset ?? null;
    const form = new FormData();
    form.append('file', draft.coverFile);
    const asset = await api<CoverAsset>('/admin/cover-assets', { method: 'POST', body: form });
    patchDraftEpisode(draft.localId, { coverAsset: asset });
    return asset;
  };

  const selectAlbumCover = (file: File | null) => {
    setCreateCoverFile(file);
    setCreateCover(null);
    setCreateCoverPreviewUrl(file ? URL.createObjectURL(file) : '');
  };

  const selectEpisodeCover = (draft: DraftEpisode, file: File | null) => {
    patchDraftEpisode(draft.localId, { coverFile: file, coverAsset: null, coverPreviewUrl: file ? URL.createObjectURL(file) : '' });
  };

  const applyEpisodeCount = (count: number) => {
    const safeCount = Math.max(1, Math.min(count, 500));
    setDraftEpisodes((current) => {
      const finalCount = Math.max(safeCount, current.filter((episode) => episode.savedEpisodeId).length);
      const existing = createMode === 'append' ? episodes.filter((episode) => episode.albumId === targetAlbumId) : [];
      const firstNewNo = Math.max(nextEpisodeNo(current), Math.max(0, ...existing.map((episode) => episode.episodeNo)) + 1);
      const firstNewOrder = Math.max(current.at(-1)?.sortOrder ?? 0, ...existing.map((episode) => episode.sortOrder)) + 1;
      return Array.from({ length: finalCount }, (_, index) => {
        if (index < current.length) return current[index];
        const episodeNo = firstNewNo + index - current.length;
        return { localId: `draft-${Date.now()}-${index + 1}`, episodeNo, title: defaultEpisodeTitle(episodeNo), sortOrder: firstNewOrder + index - current.length, isFree: false };
      });
    });
  };

  const patchDraftEpisode = (localId: string, patch: Partial<DraftEpisode>) => setDraftEpisodes((items) => items.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  const setDraftEpisodeNo = (localId: string, episodeNo: number) => setDraftEpisodes((items) => renumberEpisodes(items, localId, episodeNo));

  const applyBatchFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const existing = createMode === 'append' ? episodes.filter((episode) => episode.albumId === targetAlbumId) : [];
    const existingByNo = new Map(existing.map((episode) => [episode.episodeNo, episode]));
    const selectedNos = selected.map((file) => episodeNoFromName(file.name));
    const replacePlaceholder = draftEpisodes.length === 1 && !draftEpisodes[0].file && !draftEpisodes[0].savedEpisodeId
      && !selectedNos.includes(draftEpisodes[0].episodeNo)
      && selectedNos.some((number) => number && existingByNo.get(number) && !existingByNo.get(number)?.byteplusVid);
    const next = replacePlaceholder ? [] : [...draftEpisodes];
    const matchedByEpisode = new Map<number, File[]>();
    const unmatchedNames: string[] = [];
    const alreadyUploaded: number[] = [];
    for (const file of selected) {
      const episodeNo = episodeNoFromName(file.name);
      const saved = episodeNo ? existingByNo.get(episodeNo) : undefined;
      if (saved?.byteplusVid) {
        alreadyUploaded.push(episodeNo!);
        continue;
      }
      if (!episodeNo || (!next.some((episode) => episode.episodeNo === episodeNo) && !saved)) {
        unmatchedNames.push(file.name);
        continue;
      }
      const matches = matchedByEpisode.get(episodeNo) ?? [];
      matches.push(file);
      matchedByEpisode.set(episodeNo, matches);
    }
    const duplicateEpisodeNos = [...matchedByEpisode.entries()].filter(([, matches]) => matches.length > 1).map(([episodeNo]) => episodeNo);
    for (const [episodeNo, matches] of matchedByEpisode) {
      if (matches.length !== 1) continue;
      const index = next.findIndex((episode) => episode.episodeNo === episodeNo);
      if (index >= 0) {
        next[index] = { ...next[index], file: matches[0], uploadError: undefined };
      } else {
        const saved = existingByNo.get(episodeNo)!;
        next.push({ localId: `draft-${Date.now()}-${episodeNo}`, episodeNo, title: saved.title,
          sortOrder: saved.sortOrder, isFree: false, savedEpisodeId: saved.id, file: matches[0] });
      }
    }
    const missingEpisodeNos = next.filter((episode) => !episode.file && episode.uploadStatus !== '已上传').map((episode) => episode.episodeNo);
    setBatchFeedback([alreadyUploaded.length ? `已有视频的集数已跳过：${alreadyUploaded.join('、')}` : '', unmatchedNames.length ? `未匹配文件：${unmatchedNames.join('、')}` : '', duplicateEpisodeNos.length ? `重复匹配集数：${duplicateEpisodeNos.join('、')}` : '', missingEpisodeNos.length ? `未选择视频的集数：${missingEpisodeNos.join('、')}` : '已按集号匹配视频。'].filter(Boolean).join('；'));
    setDraftEpisodes(next.length ? next : draftEpisodes);
    setCreateError('');
  };

  const uploadDraftVideo = async (draft: DraftEpisode) => {
    if (!draft.savedEpisodeId || !draft.file) return;
    patchDraftEpisode(draft.localId, { uploadStatus: '上传中', uploadError: undefined });
    try {
      const form = new FormData();
      form.append('episodeId', draft.savedEpisodeId);
      form.append('file', draft.file);
      await api('/admin/upload-jobs/local', { method: 'POST', body: form });
      patchDraftEpisode(draft.localId, { uploadStatus: '已上传', uploadError: undefined });
    } catch (error) {
      const uploadError = error instanceof Error ? error.message : '视频上传失败';
      let needsReconciliation = false;
      try {
        const latest = await api<{ items: UploadJob[] }>('/admin/upload-jobs');
        setJobs(latest.items);
        needsReconciliation = latest.items.some((job) => job.episodeId === draft.savedEpisodeId && job.sourceType === 'FILE' && job.status === 'PROCESSING');
      } catch { /* The original upload error remains actionable if the status refresh also fails. */ }
      patchDraftEpisode(draft.localId, { uploadStatus: needsReconciliation ? '待对账' : '上传失败', uploadError: needsReconciliation ? 'BytePlus 结果未确认，请在下方上传任务中对账；不要重新上传。' : uploadError });
      throw error;
    }
  };

  const submitDrama = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    setCreateError('');
    try {
      if (createMode === 'new' && !createdAlbumId && draftEpisodes.some((episode) => episode.savedEpisodeId)) throw new Error('当前草稿包含已保存分集，但无法确认所属剧集；请刷新数据或重置后新建。');
      if (createMode === 'append' && !targetAlbumId) throw new Error('请先选择要追加分集的剧集。');
      if (!draftEpisodes.length) throw new Error('请至少添加一集。');
      if (new Set(draftEpisodes.map((episode) => episode.episodeNo)).size !== draftEpisodes.length) throw new Error('当前分集集号不能重复。');
      if (draftEpisodes.some((episode) => !Number.isSafeInteger(episode.episodeNo) || episode.episodeNo < 1 || !episode.title.trim())) throw new Error('请检查集号和标题。');
      let draftsToUpload = draftEpisodes;
      if (createMode === 'append') {
        const existing = episodes.filter((episode) => episode.albumId === targetAlbumId);
        draftsToUpload = resolveAppendEpisodes(draftEpisodes, existing);
        const duplicate = draftsToUpload.find((episode) => !episode.savedEpisodeId && existing.some((item) => item.episodeNo === episode.episodeNo && Boolean(item.byteplusVid)));
        if (duplicate) throw new Error(`第 ${duplicate.episodeNo} 集已经有 BytePlus 视频，请选择未上传的集数或从第 ${Math.max(...existing.map((item) => item.episodeNo)) + 1} 集开始。`);
        const alreadyBound = draftsToUpload.find((episode) => episode.savedEpisodeId && existing.some((item) => item.id === episode.savedEpisodeId && Boolean(item.byteplusVid)));
        if (alreadyBound) throw new Error(`第 ${alreadyBound.episodeNo} 集已经绑定 BytePlus 视频，无需再次上传。`);
        if (draftsToUpload.some((episode, index) => episode.savedEpisodeId !== draftEpisodes[index]?.savedEpisodeId)) {
          setDraftEpisodes(draftsToUpload);
          setMessage(`已识别未完成的原有分集，将直接补传：${draftsToUpload.filter((episode, index) => episode.savedEpisodeId && !draftEpisodes[index]?.savedEpisodeId).map((episode) => `第${episode.episodeNo}集`).join('、')}。`);
        }
      }
      const missingVideos = draftsToUpload.filter((episode) => !episode.file && episode.uploadStatus !== '已上传');
      if (missingVideos.length) throw new Error(`请先为第 ${missingVideos.map((episode) => episode.episodeNo).join('、')} 集选择视频。`);
      const pendingReconciliation = draftsToUpload.filter((episode) => episode.uploadStatus === '待对账');
      if (pendingReconciliation.length) throw new Error(`第 ${pendingReconciliation.map((episode) => episode.episodeNo).join('、')} 集上传结果未确认，请先在上传处理状态中对账或释放任务。`);
      const unsaved = draftsToUpload.filter((episode) => !episode.savedEpisodeId);
      if (unsaved.length) {
        const draftsWithCovers = await Promise.all(unsaved.map(async (episode) => ({ ...episode, coverAsset: await uploadEpisodeCover(episode) })));
        const payloadEpisodes = draftsWithCovers.map((episode) => ({
          episodeNo: episode.episodeNo,
          title: episode.title,
          sortOrder: episode.sortOrder,
          isFree: episode.isFree,
          coverAssetId: episode.coverAsset?.id ?? null
        }));
        let result: { album: Album; episodes: { id: string; episodeNo: number }[] };
        if (createMode === 'append' || createdAlbumId) {
          const albumId = createMode === 'append' ? targetAlbumId : createdAlbumId;
          result = await api<typeof result>(`/admin/albums/${albumId}/episodes/batch`, {
            method: 'POST', body: JSON.stringify({ episodes: payloadEpisodes })
          });
        } else {
          const tagList = createTagList.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
          if (tagList.length < 1 || tagList.length > 3 || new Set(tagList).size !== tagList.length) throw new Error('TikTok 标签需填写 1 至 3 个不重复的正整数，并以逗号分隔。');
          const cover = createCover ?? await uploadCover();
          result = await api<typeof result>('/admin/dramas', {
          method: 'POST',
          body: JSON.stringify({
            title: createTitle,
            description: createDescription,
            releaseYear: createReleaseYear,
            dramaType: createDramaType,
            tagList,
            coverAssetId: cover.id,
            accessConfig: {
              freeEpisodeCount: createFreeCount,
              rewardedAdEnabled: createRewardedEnabled,
              rewardedPlacementId: createPlacementId,
              rewardedAdCount: createRewardedCount
            },
            episodes: payloadEpisodes
          })
        });
          setCreatedAlbumId(result.album.id);
        }
        const episodeByNo = new Map(result.episodes.map((episode) => [episode.episodeNo, episode.id]));
        draftsToUpload = draftEpisodes.map((draft) => {
          const saved = draftsWithCovers.find((episode) => episode.localId === draft.localId);
          return saved ? { ...saved, savedEpisodeId: episodeByNo.get(saved.episodeNo) } : draft;
        });
        setDraftEpisodes(draftsToUpload);
      }
      const failedUploads: DraftEpisode[] = [];
      for (const draft of draftsToUpload) {
        if (!draft.file || draft.uploadStatus === '已上传') continue;
        try {
          await uploadDraftVideo(draft);
        } catch {
          failedUploads.push(draft);
        }
      }
      const resultMessage = failedUploads.length
        ? `${createMode === 'append' ? (unsaved.length ? '新增分集已保存' : '原有分集已识别') : '短剧草稿已创建'}，但有 ${failedUploads.length} 个视频未完成，请查看对应行及上传任务状态；待对账的分集不要直接重传。`
        : createMode === 'append' ? (unsaved.length ? '新增分集已保存，视频已上传。' : '原有分集的缺失视频已上传。') : '短剧草稿已创建，视频已提交处理。';
      if (!failedUploads.length) {
        if (createMode === 'append') {
          const existing = episodes.filter((episode) => episode.albumId === targetAlbumId);
          const episodeNo = Math.max(0, ...existing.map((episode) => episode.episodeNo), ...draftsToUpload.map((episode) => episode.episodeNo)) + 1;
          const sortOrder = Math.max(0, ...existing.map((episode) => episode.sortOrder), ...draftsToUpload.map((episode) => episode.sortOrder)) + 1;
          setDraftEpisodes([{ localId: `draft-${Date.now()}`, episodeNo, title: defaultEpisodeTitle(episodeNo), sortOrder, isFree: false }]);
          setBatchFeedback('');
        } else resetCreateForm();
      }
      await loadData();
      setMessage(resultMessage);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '内容创建失败';
      setCreateError(detail);
      setMessage(detail);
    } finally {
      setCreating(false);
    }
  };

  const updateAccess = async (album: Album) => {
    setSavingAlbumId(album.id);
    const accessConfig = { freeEpisodeCount: 0, rewardedAdEnabled: true, rewardedPlacementId: defaultPlacementId, rewardedAdCount: 1, ...album.accessConfig };
    try {
      const updatedAlbum = await api<Album>(`/admin/albums/${album.id}`, { method: 'PATCH', body: JSON.stringify({ accessConfig }) });
      setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, ...updatedAlbum, episodeCount: item.episodeCount } : item));
      setDirtyAccessAlbumIds((current) => {
        const next = new Set(current);
        next.delete(album.id);
        return next;
      });
      setMessage('剧集访问配置已保存');
    } catch (error) {
      setMessage(error instanceof Error ? `剧集访问配置保存失败：${error.message}` : '剧集访问配置保存失败');
    } finally {
      setSavingAlbumId(null);
    }
  };
  const updateAccessDraft = (albumId: string, patch: NonNullable<Album['accessConfig']>) => {
    setAlbums((items) => items.map((item) => item.id === albumId ? { ...item, accessConfig: { ...item.accessConfig, ...patch } } : item));
    setDirtyAccessAlbumIds((current) => new Set(current).add(albumId));
  };
  const deleteDraftAlbum = async (album: Album) => {
    if (!window.confirm(`确定删除草稿剧集“${album.title}”吗？此操作会删除本项目中的全部分集和上传任务，且无法恢复；BytePlus 中已经上传的视频不会被删除。`)) return;
    setDeletingAlbumId(album.id);
    try {
      await api<void>(`/admin/albums/${album.id}`, { method: 'DELETE' });
      setAlbums((items) => items.filter((item) => item.id !== album.id));
      setEpisodes((items) => items.filter((item) => item.albumId !== album.id));
      setDirtyAccessAlbumIds((current) => {
        const next = new Set(current);
        next.delete(album.id);
        return next;
      });
      await loadData();
      setMessage(`草稿剧集“${album.title}”已删除。`);
    } catch (error) {
      setMessage(error instanceof Error ? `删除剧集失败：${error.message}` : '删除剧集失败');
    } finally {
      setDeletingAlbumId(null);
    }
  };
  const selectAnalyticsPreset = (days: number) => {
    setAnalyticsFrom(rangeStart(days));
    setAnalyticsTo(inputDate(new Date()));
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setChangingPassword(true);
    try {
      await api('/admin/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
      sessionStorage.removeItem(adminTokenStorageKey);
      setCurrentPassword('');
      setNewPassword('');
      setLoggedIn(false);
      setMessage('密码已更新，请使用新密码重新登录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码更新失败');
    } finally {
      setChangingPassword(false);
    }
  };
  const saveEntryAdPolicy = async (event: FormEvent) => {
    event.preventDefault();
    setSavingEntryAdPolicy(true);
    try {
      const next = await api<AppEntryAdPolicy>('/admin/app-entry-ad-policy', { method: 'PUT', body: JSON.stringify(entryAdPolicy) });
      setEntryAdPolicy(next);
      setMessage(`进入广告策略已保存（版本 ${next.version}），将在新的小程序启动会话生效。`);
    } catch (error) {
      setMessage(error instanceof Error ? `进入广告策略保存失败：${error.message}` : '进入广告策略保存失败');
    } finally {
      setSavingEntryAdPolicy(false);
    }
  };
  const retryUploadJob = async (job: UploadJob) => {
    setRetryingJobId(job.id);
    try {
      await api(`/admin/upload-jobs/${job.id}/retry`, { method: 'POST' });
      setMessage(`已将“${job.episode?.title ?? job.episodeId}”重新加入上传队列。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新排队失败');
    } finally {
      setRetryingJobId(null);
    }
  };
  const reconcileUploadJob = async (job: UploadJob) => {
    const byteplusVid = window.prompt(`请输入 BytePlus 中对应的 VID（${job.episode?.title ?? job.episodeId}）。请确认 VID 属于当前配置的空间。`, job.providerJobId ?? '');
    if (!byteplusVid?.trim()) return;
    setReconcilingJobId(job.id);
    try {
      await api(`/admin/upload-jobs/${job.id}/reconcile`, { method: 'POST', body: JSON.stringify({ byteplusVid: byteplusVid.trim() }) });
      setDraftEpisodes((items) => items.map((episode) => episode.savedEpisodeId === job.episodeId ? { ...episode, uploadStatus: '已上传', uploadError: undefined } : episode));
      await loadData();
      setMessage(`已对账并绑定“${job.episode?.title ?? job.episodeId}”。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传任务对账失败');
    } finally {
      setReconcilingJobId(null);
    }
  };
  const releaseUploadJob = async (job: UploadJob) => {
    if (!window.confirm(`仅当你已在 BytePlus 当前空间确认没有对应媒资时，才能释放“${job.episode?.title ?? job.episodeId}”并重新上传。继续吗？`)) return;
    setReconcilingJobId(job.id);
    try {
      await api(`/admin/upload-jobs/${job.id}/release`, { method: 'POST', body: JSON.stringify({ confirmation: 'NO_BYTEPLUS_MEDIA' }) });
      setDraftEpisodes((items) => items.map((episode) => episode.savedEpisodeId === job.episodeId ? { ...episode, uploadStatus: '上传失败', uploadError: '已确认无 BytePlus 媒资，请重新选择视频补传。' } : episode));
      await loadData();
      setMessage(`已释放“${job.episode?.title ?? job.episodeId}”，现在可以重新选择视频上传。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '释放上传任务失败');
    } finally {
      setReconcilingJobId(null);
    }
  };
  const runPlatformAction = async (album: Album, action: 'sync-version' | 'review-submit' | 'online-version' | 'online' | 'offline' | 'reconcile') => {
    const priorityScore = reviewPriorities[album.id] ?? 2;
    if (action === 'review-submit' && priorityScore === 1 && !window.confirm(`确定将“${album.title}”以加急方式送审吗？仅适用于符合平台加急条件的剧目，每机构每天最多 35 部；已在审核中的版本无法靠重复送审加急。`)) return;
    setPlatformWorking(`${album.id}:${action}`);
    try {
      await api(`/admin/albums/${album.id}/${action}`, { method: 'POST', ...(action === 'review-submit' ? { body: JSON.stringify({ priorityScore }) } : {}) });
      await loadData();
      setMessage(`“${album.title}”的${action === 'review-submit' ? (priorityScore === 1 ? '加急送审' : '普通送审') : '平台操作'}已进入同步队列；请在下方确认任务成功后再执行下一步。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '平台操作提交失败');
    } finally {
      setPlatformWorking(null);
    }
  };
  const syncTikTokMedia = async (album: Album) => {
    setPlatformWorking(`${album.id}:media`);
    try {
      if (album.coverAssetId) await api(`/admin/cover-assets/${album.coverAssetId}/sync`, { method: 'POST' });
      const videoEpisodes = episodes.filter((episode) => episode.albumId === album.id && episode.byteplusVid);
      const results = await Promise.all(videoEpisodes.map((episode) => api<{ alreadySynced: boolean }>(`/admin/episodes/${episode.id}/sync-tiktok-video`, { method: 'POST' })));
      const queuedVideos = results.filter((result) => !result.alreadySynced).length;
      await loadData();
      setMessage(`“${album.title}”新增 ${queuedVideos} 集视频同步任务；已就绪的旧分集已跳过。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'TikTok 媒资同步提交失败');
    } finally {
      setPlatformWorking(null);
    }
  };
  const shareAlbum = async (album: Album) => {
    setPlatformWorking(`${album.id}:share`);
    try {
      await api<SharedAlbum>(`/admin/albums/${album.id}/share`, { method: 'POST' });
      await loadData();
      setMessage(`“${album.title}”已登记为共享主剧目；后续可授权给其他小程序。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建共享主剧目失败');
    } finally {
      setPlatformWorking(null);
    }
  };
  const authorizeSharedAlbum = async (sharedAlbum: SharedAlbum, targetMiniAppKey: MiniApp) => {
    const localAlbumId = window.prompt(`请输入 ${miniAppNames[targetMiniAppKey]} 目标剧目的本地 ID。目标剧目需要先在对应小程序后台创建。`)?.trim();
    if (!localAlbumId) return;
    setPlatformWorking(`${sharedAlbum.id}:authorize:${targetMiniAppKey}`);
    try {
      await api(`/admin/shared/albums/${sharedAlbum.id}/authorizations`, {
        method: 'POST',
        body: JSON.stringify({ targetMiniAppKey, targetLocalAlbumId: localAlbumId })
      });
      await loadData();
      setMessage(`共享主剧目已加入授权 ${targetMiniAppKey} 的异步队列；不会重复上传 BytePlus 或重复送审。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '共享剧目授权失败');
    } finally {
      setPlatformWorking(null);
    }
  };
  const reconcileSharedAlbum = async (sharedAlbum: SharedAlbum) => {
    setPlatformWorking(`${sharedAlbum.id}:shared-reconcile`);
    try {
      await api(`/admin/shared/albums/${sharedAlbum.id}/reconcile`, { method: 'POST' });
      await loadData();
      setMessage('共享主剧目已加入对账队列。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '共享主剧目对账失败');
    } finally {
      setPlatformWorking(null);
    }
  };
  const canWriteContent = hasAdminPermission(currentAdmin?.role, 'content.write');
  const canSyncContent = hasAdminPermission(currentAdmin?.role, 'content.sync');
  const canReviewContent = hasAdminPermission(currentAdmin?.role, 'content.review');
  const canPublishContent = hasAdminPermission(currentAdmin?.role, 'content.publish');
  const canWriteAds = hasAdminPermission(currentAdmin?.role, 'ads.write');
  const navItems: Array<[Tab, typeof Activity, string]> = [['overview', LayoutDashboard, '概览'], ['audience', Users, '观众数据'], ['playback', Activity, '播放质量']];
  if (canWriteContent) navItems.splice(1, 0, ['create', Plus, '内容创建'], ['albums', ListVideo, '剧集与解锁']);
  if (canWriteAds) navItems.splice(canWriteContent ? 3 : 1, 0, ['ads', Megaphone, '进入广告']);
  const tabLabels: Record<Tab, string> = { overview: '概览', create: '内容创建', albums: '剧集与解锁', ads: '进入广告', audience: '观众数据', playback: '播放质量', security: '账号安全' };
  const title = tab === 'overview' ? '内容运营概览' : tab === 'create' ? '内容创建' : tab === 'ads' ? '进入广告策略' : tab === 'audience' ? '观众数据' : tab === 'playback' ? '播放质量' : tab === 'security' ? '账号安全' : '剧集与解锁配置';

  return <div className="admin-layout"><aside className="sidebar"><div className="brand"><span><Film size={17} /></span>QuicK <span>ReeLS</span></div><MiniAppSelect /><p className="workspace-label">运营工作区</p><nav>
    {navItems.map(([key, Icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}
  </nav><div className="sidebar-bottom"><button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><Settings2 size={17} />账号安全</button><div className="account"><span className="account-avatar">{currentAdmin?.email.slice(0, 2).toUpperCase() ?? 'OP'}</span><span><strong>{currentAdmin?.email ?? '运营管理员'}</strong><small>{currentAdmin?.role ?? 'TK小程序管理后台'}</small></span><MoreHorizontal size={16} /></div></div></aside>
    <main className="main"><header className="page-header"><div><p className="eyebrow">{miniAppNames[activeApp]} / {tabLabels[tab]}</p><h1>{title}</h1><p className="subhead">当前展示 {miniAppNames[activeApp]} 的内容和数据。</p></div><div className="header-actions"><button className="secondary" onClick={() => void loadData()} title="刷新数据"><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button><button className="secondary" onClick={() => { sessionStorage.removeItem(adminTokenStorageKey); setLoggedIn(false); }}>退出登录</button></div></header>{message && <div className="notice"><CheckCircle2 size={16} />{message}</div>}
      {(tab === 'audience' || tab === 'playback') && <div className="toolbar"><span><CalendarDays size={15} />统计周期</span><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(7)}>近 7 天</button><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(30)}>近 30 天</button><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(90)}>近 90 天</button><label>开始<input type="date" value={analyticsFrom} max={analyticsTo} onChange={(event) => setAnalyticsFrom(event.target.value)} /></label><label>结束<input type="date" value={analyticsTo} min={analyticsFrom} max={inputDate(new Date())} onChange={(event) => setAnalyticsTo(event.target.value)} /></label><label>时区<select value={analyticsTimezone} onChange={(event) => setAnalyticsTimezone(event.target.value)}><option value="Asia/Shanghai">Asia/Shanghai</option><option value="UTC">UTC</option></select></label></div>}
      {tab === 'overview' && <><section className="metrics"><Metric label="在线剧集" value={String(overview.albums)} change="实时数据" icon={Film} tone="pink" /><Metric label="在线集数" value={String(overview.episodes)} change="已通过发布条件" icon={ListVideo} tone="cyan" /><Metric label="用户数" value={String(overview.users)} change="累计注册" icon={Users} tone="green" /><Metric label="广告解锁" value={String(overview.rewardedUnlocks)} change="累计完成" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="运营健康度" description="关键业务数据当前状态"><div className="readiness-list"><div><span className="ready-dot done"><CheckCircle2 size={15} /></span><span><strong>剧集元数据与访问策略</strong><small>{overview.albums} 部在线剧集 · {overview.episodes} 集可见</small></span><em>正常</em></div><div><span className="ready-dot done"><Database size={15} /></span><span><strong>观众行为采集</strong><small>{overview.likes} 次点赞 · {overview.favorites} 次收藏 · {overview.searches} 次搜索</small></span><em>正常</em></div><div><span className="ready-dot done"><Gauge size={15} /></span><span><strong>播放质量采集</strong><small>{playback?.totalEvents ?? 0} 条播放器事件已入库</small></span><em>正常</em></div></div></Panel><Panel title="最近上传" description="BytePlus 媒体处理任务"><div className="compact-list">{jobs.slice(0, 5).map((job) => <div className="compact-row" key={job.id}><FileVideo size={17} /><span><strong>{job.episode?.title ?? job.episodeId}</strong><small>{job.sourceName ?? job.sourceType ?? '链接'}</small></span><Status value={job.status} /></div>)}{!jobs.length && <p className="empty-copy">还没有上传任务</p>}</div></Panel></div></>}
      {tab === 'create' && <>
        <Panel title={createMode === 'append' ? '追加分集' : '创建短剧草稿'} description={createMode === 'append' ? '新分集保存到选中的剧集，沿用其访问策略。' : '一次录入专辑、封面、剧集和本地视频；失败视频可在该行单独重试。'}>
          <form className="create-form" onSubmit={submitDrama}>
            <div className="create-mode-bar"><div className="mode-segment" role="group" aria-label="内容创建模式"><button type="button" className={createMode === 'new' ? 'active' : ''} onClick={() => selectCreateMode('new')}>新建剧集</button><button type="button" className={createMode === 'append' ? 'active' : ''} onClick={() => selectCreateMode('append')}>追加到已有剧集</button></div><button className="secondary" type="button" disabled={creating} onClick={() => { if (!hasActiveContent() || window.confirm('清空当前表单并开始新剧集？已保存的模板和剧集不会删除。')) resetCreateForm(); }}>重置 / 新建</button></div>
            {createMode === 'append' && <><label className="target-album-select">目标剧集<select value={targetAlbumId} onChange={(event) => selectTargetAlbum(event.target.value)} required><option value="">请选择已有剧集</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.title} ({album.id})</option>)}</select></label>{targetAlbumId && (() => { const target = albums.find((album) => album.id === targetAlbumId); const existing = episodes.filter((episode) => episode.albumId === targetAlbumId); return target && <p className="target-album-summary">现有 {existing.length} 集 · 最大集号 {Math.max(0, ...existing.map((episode) => episode.episodeNo))} · 免费集数 {target.accessConfig?.freeEpisodeCount ?? 0} · 线上版本 {target.onlineVersion ?? '-'} · 当前版本 {target.tiktokVersion ?? '-'} · 审核 {target.reviewStatus ?? '未送审'}</p>; })()}</>}
            {createMode === 'new' && <>
              <div className="template-toolbar"><label>复用模板<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">选择模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button className="secondary" type="button" disabled={!selectedTemplateId || Boolean(createdAlbumId)} onClick={applyTemplate}>应用</button><button className="secondary" type="button" disabled={!selectedTemplateId} onClick={() => { const template = templates.find((item) => item.id === selectedTemplateId); if (template && window.confirm(`删除模板“${template.name}”？`)) { setTemplates((items) => items.filter((item) => item.id !== template.id)); setSelectedTemplateId(''); } }}>删除模板</button><button className="secondary" type="button" onClick={saveTemplate}>保存为模板</button></div>
              {selectedTemplateId && (() => { const template = templates.find((item) => item.id === selectedTemplateId); return template && <p className="target-album-summary">类型 {['', 'AIGC', '漫剧', '真人配音', '真人本地化'][template.dramaType] ?? template.dramaType} · 标签 {template.tagList} · 免费集号上限 {template.freeCount} · 广告解锁 {template.rewardedEnabled ? '启用' : '关闭'} · 每集观看 {template.rewardedCount} 次</p>; })()}
              {createdAlbumId && <p className="target-album-summary">剧集已保存。此处信息已锁定；可继续上传视频或添加分集。</p>}
              <fieldset className="album-fields" disabled={Boolean(createdAlbumId)}><div className="form-grid">
              <label>剧名<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} required /></label>
              <label>上线年份<input type="number" min="1900" max="2100" value={createReleaseYear} onChange={(event) => setCreateReleaseYear(Number(event.target.value))} required /></label>
              <label>剧目类型<select value={createDramaType} onChange={(event) => setCreateDramaType(Number(event.target.value))}><option value={1}>AIGC</option><option value={2}>漫剧</option><option value={3}>真人配音</option><option value={4}>真人本地化</option></select></label>
              <label>TikTok 标签（1–3 个）<input value={createTagList} onChange={(event) => setCreateTagList(event.target.value)} placeholder="例如：1,23" required /></label>
              <label>免费集号上限<input type="number" min="0" max="10000" value={createFreeCount} onChange={(event) => setCreateFreeCount(Number(event.target.value))} /></label>
              <label>激励广告位 ID<input value={createPlacementId} onChange={(event) => setCreatePlacementId(event.target.value)} /></label>
              <label>每集解锁所需广告观看次数<input type="number" min="1" value={createRewardedCount} onChange={(event) => setCreateRewardedCount(Number(event.target.value))} /></label>
            </div>
            <label>简介<textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} rows={4} /></label>
            <div className="cover-row">
              <label>专辑封面<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => selectAlbumCover(event.target.files?.[0] ?? null)} required={!createCover} /></label>
              {createCoverFile && <span className="file-hint"><Image size={15} />{createCoverFile.name}</span>}
              {(createCover?.publicUrl ?? createCoverPreviewUrl) && <img className="cover-preview" src={createCover?.publicUrl ?? createCoverPreviewUrl} alt="专辑封面预览" />}
              {(createCoverFile || createCover) && <button className="text-button" type="button" onClick={() => selectAlbumCover(null)}>移除封面</button>}
            </div>
            <label className="check-row"><input type="checkbox" checked={createRewardedEnabled} onChange={(event) => setCreateRewardedEnabled(event.target.checked)} />启用广告解锁</label></fieldset></>}
            <div className="episode-toolbar">
              <label>{createMode === 'append' ? '本次处理集数' : '总集数'}<input className="inline-number" type="number" min="1" max="500" value={draftEpisodes.length} onChange={(event) => applyEpisodeCount(Number(event.target.value))} /></label>
              <label>批量选择视频<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" multiple onChange={(event) => applyBatchFiles(event.target.files)} /></label>
            </div>
            {batchFeedback && <p className="batch-feedback"><AlertTriangle size={15} />{batchFeedback}</p>}
            <div className="table-wrap"><table><thead><tr><th>集号</th><th>标题</th><th>排序</th><th>单集免费</th><th>独立封面</th><th>视频文件</th><th>状态</th><th></th></tr></thead><tbody>{draftEpisodes.map((episode) => <tr key={episode.localId} className={!episode.file ? 'needs-file' : ''}>
              <td><input className="inline-number" type="number" min="1" step="1" aria-label="集号" value={episode.episodeNo} disabled={Boolean(episode.savedEpisodeId)} onChange={(event) => setDraftEpisodeNo(episode.localId, Number(event.target.value))} /></td>
              <td><input className="table-input" aria-label="分集标题" value={episode.title} disabled={Boolean(episode.savedEpisodeId)} onChange={(event) => patchDraftEpisode(episode.localId, { title: event.target.value })} /></td>
              <td><input className="inline-number" type="number" min="1" aria-label="排序" value={episode.sortOrder} disabled={Boolean(episode.savedEpisodeId)} onChange={(event) => patchDraftEpisode(episode.localId, { sortOrder: Number(event.target.value) })} /></td>
              <td><input type="checkbox" aria-label="单集免费" checked={episode.isFree} disabled={Boolean(episode.savedEpisodeId)} onChange={(event) => patchDraftEpisode(episode.localId, { isFree: event.target.checked })} /></td>
              <td><div className="episode-cover-cell"><label className="file-cell">{episode.coverFile?.name ?? (episode.coverAsset ? '已保存封面' : '使用专辑封面')}<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={Boolean(episode.savedEpisodeId)} onChange={(event) => selectEpisodeCover(episode, event.target.files?.[0] ?? null)} /></label>{(episode.coverAsset?.publicUrl ?? episode.coverPreviewUrl) && <img className="episode-cover-preview" src={episode.coverAsset?.publicUrl ?? episode.coverPreviewUrl} alt={`${episode.title} 封面预览`} />}</div></td>
              <td><label className="file-cell">{episode.file?.name ?? '选择视频'}<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" onChange={(event) => patchDraftEpisode(episode.localId, { file: event.target.files?.[0] ?? null, uploadError: undefined })} /></label></td>
              <td><div className="draft-upload-state"><span>{episode.uploadStatus ?? (episode.file ? '待保存' : '缺少视频')}</span>{episode.uploadError && <small className="table-error" title={episode.uploadError}>{episode.uploadError}</small>}{episode.uploadStatus === '上传失败' && episode.file && episode.savedEpisodeId && <button className="text-button retry-button" type="button" onClick={() => void uploadDraftVideo(episode).catch((error) => setMessage(error instanceof Error ? error.message : '上传失败'))}>重试上传</button>}</div></td>
              <td><button className="more" type="button" disabled={Boolean(episode.savedEpisodeId)} onClick={() => setDraftEpisodes((items) => items.filter((item) => item.localId !== episode.localId))} title={episode.savedEpisodeId ? '已保存分集不能从当前表单删除' : '删除'}><Trash2 size={15} /></button></td>
            </tr>)}</tbody></table></div>
            <button className="secondary" type="button" onClick={() => setDraftEpisodes((items) => {
              const existing = createMode === 'append' ? episodes.filter((episode) => episode.albumId === targetAlbumId) : [];
              const episodeNo = Math.max(nextEpisodeNo(items), Math.max(0, ...existing.map((episode) => episode.episodeNo)) + 1);
              const sortOrder = Math.max(items.at(-1)?.sortOrder ?? 0, ...existing.map((episode) => episode.sortOrder)) + 1;
              return [...items, { localId: `draft-${Date.now()}`, episodeNo, title: defaultEpisodeTitle(episodeNo), sortOrder, isFree: false }];
            })}><Plus size={15} />添加分集</button>
            {createError && <p className="form-error create-error"><CircleAlert size={15} />{createError}</p>}
            <button className="primary" type="submit" disabled={creating || (createMode === 'append' && !targetAlbumId) || !draftEpisodes.length}><Save size={17} />{creating ? '处理中...' : createMode === 'append' ? '保存并上传视频' : draftEpisodes.some((episode) => episode.savedEpisodeId) ? '保存新增分集并上传视频' : '保存草稿并上传视频'}</button>
          </form>
        </Panel>
        <Panel title="上传处理状态" description="所有由内容创建产生的上传记录集中显示；网络中断时先对账 BytePlus，再决定是否补传。"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>来源</th><th>状态</th><th>处理信息</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{jobs.map((job) => { const staleWithoutVid = job.status === 'PROCESSING' && job.sourceType === 'FILE' && !job.providerJobId && job.startedAt && Date.now() - new Date(job.startedAt).getTime() >= 2 * 60 * 60_000; return <tr key={job.id}><td><strong>{job.episode?.title ?? job.episodeId}</strong></td><td>{job.sourceName ?? job.sourceType ?? '链接'}</td><td><Status value={job.status} /></td><td>{job.errorMessage ? <small className="table-error" title={job.errorMessage}>{job.errorMessage}</small> : job.providerJobId ?? '本地上传已确认'}</td><td>{new Date(job.createdAt).toLocaleString('zh-CN')}</td><td>{job.status === 'PROCESSING' && job.sourceType === 'FILE' ? <span className="access-actions"><button className="secondary retry-button" type="button" disabled={reconcilingJobId === job.id} onClick={() => void reconcileUploadJob(job)}><RefreshCw size={14} className={reconcilingJobId === job.id ? 'spin' : ''} />{reconcilingJobId === job.id ? '对账中...' : '对账绑定 VID'}</button>{staleWithoutVid && <button className="text-button retry-button" type="button" disabled={reconcilingJobId === job.id} onClick={() => void releaseUploadJob(job)}>确认无媒资后释放</button>}</span> : job.status === 'FAILED' && job.sourceType !== 'FILE' ? <button className="secondary retry-button" type="button" disabled={retryingJobId === job.id} onClick={() => void retryUploadJob(job)}><RefreshCw size={14} className={retryingJobId === job.id ? 'spin' : ''} />{retryingJobId === job.id ? '排队中...' : '重新排队'}</button> : '—'}</td></tr>; })}</tbody></table>{!jobs.length && <p className="empty-copy table-empty">暂无上传记录</p>}</div></Panel>
      </>}
      {tab === 'albums' && <Panel title="剧集访问策略" description="免费集号上限和广告解锁配置会立即影响小程序访问"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>发布状态</th><th>解锁配置</th><th>集数</th><th>免费集号上限</th><th>广告解锁</th><th>每集解锁所需广告观看次数</th><th>操作</th></tr></thead><tbody>{albums.map((album) => { const canDelete = album.status === 'DRAFT' && !album.tiktokAlbumId; const accessDirty = dirtyAccessAlbumIds.has(album.id); return <tr key={album.id}><td><span className="drama-thumb" /><strong>{album.title}</strong></td><td><Status value={album.status} /></td><td><span className={`access-config-state ${accessDirty ? 'pending' : 'saved'}`}>{accessDirty ? '待保存' : '已保存'}</span></td><td>{album.episodeCount}</td><td><input className="inline-number" type="number" min="0" value={album.accessConfig?.freeEpisodeCount ?? 0} onChange={(event) => updateAccessDraft(album.id, { freeEpisodeCount: Number(event.target.value) })} /></td><td><input type="checkbox" checked={album.accessConfig?.rewardedAdEnabled ?? true} onChange={(event) => updateAccessDraft(album.id, { rewardedAdEnabled: event.target.checked })} /></td><td><input className="inline-number" type="number" min="1" value={album.accessConfig?.rewardedAdCount ?? 1} onChange={(event) => updateAccessDraft(album.id, { rewardedAdCount: Number(event.target.value) })} /></td><td><div className="access-actions"><button className="save-button" disabled={savingAlbumId === album.id || deletingAlbumId === album.id || !accessDirty} onClick={() => void updateAccess(album)}><Save size={15} />{savingAlbumId === album.id ? '保存中...' : '保存'}</button>{canDelete && <button className="delete-button" type="button" disabled={deletingAlbumId === album.id || savingAlbumId === album.id} onClick={() => void deleteDraftAlbum(album)} title={`删除草稿剧集 ${album.title}`}><Trash2 size={15} />{deletingAlbumId === album.id ? '删除中...' : '删除'}</button>}</div></td></tr>; })}</tbody></table></div></Panel>}
      {tab === 'albums' && <Panel title="TikTok 媒资库发布链路" description="按顺序完成每部剧的媒资、版本、审核和上架；点击按钮仅表示加入异步队列。">
        <div className="platform-guide">
          <h3>每部剧的操作顺序</h3>
          <ol>
            <li><strong>准备内容</strong><span>保存封面、集数和解锁配置，确认每集 BytePlus 上传成功并有 VID。</span></li>
            <li><strong>同步媒资</strong><span>点击“同步媒资”，等待封面与每集视频在 TikTok 登记成功；入队不等于完成。</span></li>
            <li><strong>同步版本</strong><span>媒资完成后点击“同步版本”，等待平台返回版本号；送审前不要继续改动该版本内容。</span></li>
            <li><strong>送审与对账</strong><span>点击“送审”；审核期间稍后点击“对账”获取平台结果。审核未通过时先处理原因，再重新同步版本、送审。</span></li>
            <li><strong>设线上版本 → 上架</strong><span>仅审核通过后依次操作，确认线上版本和上架状态后再到小程序测试播放；需要撤下时点击“下架”。</span></li>
          </ol>
          <p>送审前可按剧目选择普通或加急。加急适用于近期上线、投放或已有消费的剧目；官方参考时效为 1–3 个工作日，每机构每天最多 35 部，并非保证通过或准时完成。已送审的版本不能靠重复点击改为加急；需要调整请带平台剧目 ID、版本号和业务理由联系 TikTok 平台支持。</p>
        </div>
        <div className="table-wrap"><table><thead><tr><th>剧集</th><th>平台版本</th><th>审核 / 上架</th><th>同步操作</th></tr></thead><tbody>{albums.map((album) => {
          const reviewing = album.reviewStatus === 'REVIEWING' || album.reviewStatus === '1';
          return <tr key={`platform-${album.id}`}>
            <td><strong>{album.title}</strong><small>{album.tiktokAlbumId ?? '尚未创建平台剧目'}</small></td>
            <td>当前版本 {album.tiktokVersion ?? '-'} · 线上 {album.onlineVersion ?? '-'} · 已发布 {album.platformPublishedVersion ?? '-'}</td>
            <td><Status value={album.status} /><small>当前版本审核：{album.reviewStatus ?? '未送审'} · 上架：{album.publishStatus ?? '未上架'}</small></td>
            <td>
              <div className="button-row">
                {canSyncContent && <>
                  <button className="secondary" disabled={platformWorking !== null} onClick={() => void syncTikTokMedia(album)}>{platformWorking === `${album.id}:media` ? '媒资同步中...' : '同步媒资'}</button>
                  <button className="secondary" disabled={platformWorking !== null || reviewing} onClick={() => void runPlatformAction(album, 'sync-version')}>{platformWorking === `${album.id}:sync-version` ? '同步中...' : '同步版本'}</button>
                  <button className="secondary" disabled={platformWorking !== null} onClick={() => void runPlatformAction(album, 'reconcile')}>对账</button>
                  <button className="secondary" disabled={platformWorking !== null || !album.tiktokAlbumId || !album.tiktokVersion} onClick={() => void shareAlbum(album)}>{platformWorking === `${album.id}:share` ? '登记中...' : '设为共享主剧目'}</button>
                </>}
                {canReviewContent && (reviewing
                  ? <span className="review-priority">审核优先级：已送审，不可修改</span>
                  : <label className="review-priority">审核优先级<select aria-label={`${album.title}的审核优先级`} value={reviewPriorities[album.id] ?? 2} disabled={platformWorking !== null} onChange={(event) => setReviewPriorities((current) => ({ ...current, [album.id]: Number(event.target.value) as 1 | 2 }))}><option value={2}>普通（约两周）</option><option value={1}>加急（1–3 工作日）</option></select></label>)}
                {canReviewContent && <button className="secondary" disabled={platformWorking !== null || reviewing || !album.tiktokVersion || album.reviewStatus === 'PASSED'} onClick={() => void runPlatformAction(album, 'review-submit')}>送审</button>}
                {canPublishContent && <>
                  <button className="secondary" disabled={platformWorking !== null || album.reviewStatus !== 'PASSED' || album.onlineVersion === album.tiktokVersion} onClick={() => void runPlatformAction(album, 'online-version')}>设线上版本</button>
                  <button className="save-button" disabled={platformWorking !== null || album.publishStatus === 'LISTED' || album.publishStatus === '1'} onClick={() => void runPlatformAction(album, 'online')}>上架</button>
                  <button className="secondary" disabled={platformWorking !== null} onClick={() => void runPlatformAction(album, 'offline')}>下架</button>
                </>}
              </div>
              <small className="platform-next-step">建议下一步：{platformNextStep(album)}</small>
            </td>
          </tr>;
        })}</tbody></table></div>
        <div className="platform-jobs-heading"><h3>最近 50 条平台任务</h3><button className="secondary" type="button" disabled={loading} onClick={() => void loadData()}>刷新状态</button></div>
        <div className="table-wrap"><table className="platform-jobs-table"><colgroup><col className="platform-job-target-column" /><col className="platform-job-action-column" /><col className="platform-job-status-column" /><col className="platform-job-detail-column" /></colgroup><thead><tr><th>剧目 / 分集</th><th>操作</th><th>任务状态</th><th>时间 / 错误</th></tr></thead><tbody>{platformJobs.map((job) => <tr key={job.id}><td><span className="platform-job-target" title={job.album?.title ?? job.episode?.title ?? job.albumId ?? '-'}>{job.album?.title ?? job.episode?.title ?? job.albumId ?? '-'}</span></td><td>{platformJobLabels[job.kind] ?? job.kind}{job.kind === 'REVIEW' ? `（${job.snapshotJson?.priorityScore === 1 ? '加急' : job.snapshotJson?.priorityScore === 2 ? '普通' : '优先级未记录'}）` : ''}{(job.snapshotJson?.version ?? job.providerResponse?.version) ? ` · 版本 ${job.snapshotJson?.version ?? job.providerResponse?.version}` : ''}</td><td><Status value={job.status} /></td><td><small>{new Date(job.createdAt).toLocaleString('zh-CN')}</small>{job.errorMessage && <small className="table-error" title={job.errorMessage}>{job.errorMessage}</small>}</td></tr>)}</tbody></table>{!platformJobs.length && <p className="empty-copy table-empty">暂无平台同步任务</p>}</div>
      </Panel>}
      {tab === 'albums' && <Panel title="共享剧目授权" description="同一 BytePlus 账号下复用已审核的 TikTok 主剧目；目标小程序通过授权使用同一个 album_id，不重复上传或送审。">
        <div className="table-wrap"><table><thead><tr><th>主剧目</th><th>版本 / 状态</th><th>授权小程序</th><th>操作</th></tr></thead><tbody>{sharedAlbums.map((sharedAlbum) => {
          const targets = (Object.keys(miniAppNames) as MiniApp[]).filter((key) => key !== sharedAlbum.ownerMiniAppKey);
          return <tr key={sharedAlbum.id}>
            <td><strong>{sharedAlbum.tiktokAlbumId}</strong><small>主小程序：{sharedAlbum.ownerMiniAppKey}</small></td>
            <td>当前 {sharedAlbum.currentVersion ?? '-'} · 线上 {sharedAlbum.onlineVersion ?? '-'}<small>审核：{sharedAlbum.reviewStatus ?? '未对账'} · 上架：{sharedAlbum.publishStatus ?? '未对账'}</small></td>
            <td>{sharedAlbum.authorizations.map((authorization) => <span className="shared-auth" key={authorization.id}>{authorization.miniAppKey}<Status value={authorization.status} />{authorization.targetLocalAlbumId && <small>{authorization.targetLocalAlbumId}</small>}</span>)}</td>
            <td><div className="button-row">
              {canReviewContent && targets.map((targetKey) => <button key={targetKey} className="secondary" disabled={platformWorking !== null || sharedAlbum.authorizations.some((item) => item.miniAppKey === targetKey && item.status === 'AUTHORIZED')} onClick={() => void authorizeSharedAlbum(sharedAlbum, targetKey)}>{platformWorking === `${sharedAlbum.id}:authorize:${targetKey}` ? '授权中...' : `授权到 ${miniAppNames[targetKey]}`}</button>)}
              {canSyncContent && <button className="secondary" disabled={platformWorking !== null} onClick={() => void reconcileSharedAlbum(sharedAlbum)}>{platformWorking === `${sharedAlbum.id}:shared-reconcile` ? '对账中...' : '共享对账'}</button>}
            </div>{sharedAlbum.authorizations.filter((item) => item.errorMessage).map((item) => <small key={item.id} className="table-error" title={item.errorMessage ?? ''}>{miniAppNames[item.miniAppKey]}：{item.errorMessage}</small>)}</td>
          </tr>;
        })}</tbody></table>{!sharedAlbums.length && <p className="empty-copy table-empty">暂无共享主剧目；先在上方将已同步版本的剧目设为共享主剧目。</p>}</div>
      </Panel>}
      {tab === 'ads' && <Panel title="进入广告策略" description="配置将在新的小程序启动会话生效。激励门槛模式须先在 TikTok 平台确认可用。"><form className="policy-form" onSubmit={saveEntryAdPolicy}><label className="check-row"><input type="checkbox" checked={entryAdPolicy.enabled} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, enabled: event.target.checked }))} />启用进入广告</label><div className="form-grid"><label>广告模式<select value={entryAdPolicy.mode} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, mode: event.target.value as AppEntryAdPolicy['mode'] }))}><option value="INTERSTITIAL">插屏广告</option><option value="REWARDED_GATED">激励门槛广告</option></select></label><label>广告位 ID<input value={entryAdPolicy.placementId} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, placementId: event.target.value }))} required={entryAdPolicy.enabled} /></label><label>每次进入广告观看次数<input type="number" min="1" value={entryAdPolicy.requiredCount} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, requiredCount: Number(event.target.value) }))} required /></label><label>广告不可用时<select value={entryAdPolicy.onUnavailable} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, onUnavailable: event.target.value as AppEntryAdPolicy['onUnavailable'] }))}><option value="ALLOW">允许进入</option><option value="BLOCK">阻止进入并重试</option></select></label></div><p className="form-help">当前策略版本：{entryAdPolicy.version}。进入广告与剧集解锁广告使用独立会话和广告位。</p><button className="primary" type="submit" disabled={savingEntryAdPolicy}>{savingEntryAdPolicy ? '保存中...' : <><Save size={17} />保存进入广告策略</>}</button></form></Panel>}
      {tab === 'audience' && audience && <><section className="metrics"><Metric label="活跃观众" value={String(audience.activeUsers)} change={`${audience.from} 至 ${audience.to}`} icon={Users} tone="green" /><Metric label="新增观众" value={String(audience.newUsers)} change={`日活 ${audience.dau} · 周活 ${audience.wau} · 月活 ${audience.mau}`} icon={Database} tone="cyan" /><Metric label="观看会话" value={String(audience.watchSessions)} change="播放器会话开始次数" icon={Film} tone="pink" /><Metric label="完播集数" value={String(audience.completedEpisodes)} change="每用户每集首次完播" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="观众趋势" description="按天统计新增和活跃用户"><DailyBars title="新增观众" items={audience.dailyNewUsers} /><DailyBars title="日活用户" items={audience.dailyActiveUsers} /></Panel><Panel title="互动概览" description="帮助判断内容和运营活动表现"><BarList title="互动指标" items={[{ label: '收藏', value: audience.favorites }, { label: '分享', value: audience.shares }, { label: '搜索', value: audience.searches }]} color="cyan" /></Panel></div></>}
      {tab === 'playback' && playback && <><section className="metrics"><Metric label="播放器事件" value={String(playback.totalEvents)} change={`近 ${playback.periodDays} 天`} icon={Activity} tone="cyan" /><Metric label="首帧事件" value={String(playback.firstFrames)} change="成功启动" icon={Gauge} tone="green" /><Metric label="错误率" value={`${playback.errorRate}%`} change={`${playback.errorCount} 次错误`} icon={CircleAlert} tone="pink" /><Metric label="平均首帧" value={playback.averageStartupMs === null ? '-' : `${playback.averageStartupMs} 毫秒`} change="启动耗时" icon={Wifi} tone="yellow" /></section><div className="content-grid"><Panel title="播放事件分布" description="根据小程序播放器上报聚合"><BarList title="事件类型" items={playback.eventTypes.map((item) => ({ label: item.eventType, value: item.count }))} /><BarList title="清晰度" items={playback.definitions.map((item) => ({ label: item.definition, value: item.count }))} color="cyan" /><BarList title="网络类型" items={playback.networks.map((item) => ({ label: item.networkType, value: item.count }))} color="green" /></Panel><Panel title="最近播放错误" description="优先定位实际影响用户的剧集"><div className="compact-list">{playback.recentErrors.map((error, index) => <div className="compact-row" key={`${error.createdAt}-${index}`}><CircleAlert size={17} /><span><strong>{error.episodeTitle}</strong><small>{error.errorCode ?? '未知错误'} · {new Date(error.createdAt).toLocaleString('zh-CN')}</small></span></div>)}{!playback.recentErrors.length && <p className="empty-copy">暂无播放错误</p>}</div></Panel></div></>}
      {tab === 'security' && <div className="content-grid"><Panel title="当前管理员" description="角色和账号状态由服务端实时校验"><div className="readiness-list"><div><span className="ready-dot done"><CheckCircle2 size={15} /></span><span><strong>{currentAdmin?.email ?? '-'}</strong><small>角色：{currentAdmin?.role ?? '-'} · 状态：{currentAdmin?.status ?? '-'}</small></span></div><div><span className="ready-dot done"><CalendarDays size={15} /></span><span><strong>最近登录</strong><small>{currentAdmin?.lastLoginAt ? new Date(currentAdmin.lastLoginAt).toLocaleString('zh-CN') : '暂无记录'}</small></span></div></div></Panel><Panel title="修改密码" description="更新后当前登录令牌会立即失效"><form className="policy-form" onSubmit={changePassword}><label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>新密码<input type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><button className="primary" type="submit" disabled={changingPassword}><Save size={17} />{changingPassword ? '更新中...' : '更新密码'}</button></form></Panel></div>}
    </main></div>;
}

createRoot(document.getElementById('root')!).render(<AdminApp />);
