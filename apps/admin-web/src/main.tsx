import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, CircleAlert, Database,
  Film, FileVideo, Gauge, Image, LayoutDashboard, ListVideo, LogIn, Megaphone, MoreHorizontal, Plus,
  RefreshCw, Save, Settings2, Trash2, Users, Wifi
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import './styles.css';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const adminTokenStorageKey = 'quickreels_admin_token';
let adminSessionRecoveryStarted = false;

type Album = {
  id: string;
  title: string;
  status: string;
  episodeCount: number;
  accessConfig?: { freeEpisodeCount?: number; rewardedAdEnabled?: boolean; rewardedPlacementId?: string; rewardedAdCount?: number } | null;
};
type EpisodeOption = { id: string; albumId: string; episodeNo: number; title: string; status: string; byteplusVid?: string | null; album: { title: string; status: string } };
type CoverAsset = { id: string; publicUrl: string; status: string; width?: number | null; height?: number | null };
type DraftEpisode = { localId: string; episodeNo: number; title: string; sortOrder: number; isFree: boolean; file?: File | null; coverFile?: File | null; coverAsset?: CoverAsset | null; coverPreviewUrl?: string; savedEpisodeId?: string; uploadStatus?: string; uploadError?: string };
type UploadJob = { id: string; episodeId: string; sourceType?: string; sourceName?: string | null; status: string; providerJobId?: string | null; errorMessage?: string | null; createdAt: string; completedAt?: string | null; episode?: { title: string; episodeNo: number } };
type Overview = { albums: number; episodes: number; users: number; likes: number; favorites: number; shares: number; searches: number; rewardedUnlocks: number };
type Audience = { from: string; to: string; timezone: string; periodDays: number; activeUsers: number; dau: number; wau: number; mau: number; newUsers: number; watchSessions: number; completedEpisodes: number; favorites: number; shares: number; searches: number; dailyNewUsers: { date: string; count: number }[]; dailyActiveUsers: { date: string; count: number }[] };
type Playback = { from: string; to: string; timezone: string; periodDays: number; totalEvents: number; firstFrames: number; errorCount: number; errorRate: number; averageStartupMs: number | null; totalBufferMs: number; eventTypes: { eventType: string; count: number }[]; definitions: { definition: string; count: number }[]; networks: { networkType: string; count: number }[]; recentErrors: { episodeTitle: string; errorCode?: string | null; createdAt: string }[] };
type AppEntryAdPolicy = { enabled: boolean; mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; requiredCount: number; onUnavailable: 'ALLOW' | 'BLOCK'; version: number };
type AdminRole = 'OWNER' | 'EDITOR' | 'ANALYST' | 'SUPPORT';
type AdminPermission = 'content.write' | 'ads.write';
type AdminProfile = { id: string; email: string; role: AdminRole; status: string; lastLoginAt?: string | null; passwordChangedAt?: string | null };
type Tab = 'overview' | 'create' | 'albums' | 'ads' | 'audience' | 'playback' | 'security';
const contentDraftStorageKey = 'quickreels_content_draft';

const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  OWNER: ['content.write', 'ads.write'],
  EDITOR: ['content.write', 'ads.write'],
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
  const labels: Record<string, string> = {
    DRAFT: '草稿', REVIEWING: '审核中', ONLINE: '已上线', OFFLINE: '已下线', REJECTED: '已驳回',
    UPLOADING: '上传中', READY: '已就绪', PENDING: '待处理', PROCESSING: '处理中', SUCCEEDED: '已完成',
    FAILED: '失败', ERROR: '错误', ACTIVE: '进行中', COMPLETED: '已完成', EXPIRED: '已过期'
  };
  const tone = value === 'SUCCEEDED' || value === 'ONLINE' || value === 'READY' || value === 'COMPLETED' ? 'green' : value === 'FAILED' || value === 'ERROR' || value === 'OFFLINE' || value === 'REJECTED' ? 'pink' : 'yellow';
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
  const [overview, setOverview] = useState<Overview>({ albums: 0, episodes: 0, users: 0, likes: 0, favorites: 0, shares: 0, searches: 0, rewardedUnlocks: 0 });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [entryAdPolicy, setEntryAdPolicy] = useState<AppEntryAdPolicy>({ enabled: false, mode: 'REWARDED_GATED', placementId: 'ad7686459794040702993', requiredCount: 1, onUnavailable: 'ALLOW', version: 1 });
  const [analyticsFrom, setAnalyticsFrom] = useState(() => rangeStart(30));
  const [analyticsTo, setAnalyticsTo] = useState(() => inputDate(new Date()));
  const [analyticsTimezone, setAnalyticsTimezone] = useState('Asia/Shanghai');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createCoverFile, setCreateCoverFile] = useState<File | null>(null);
  const [createCover, setCreateCover] = useState<CoverAsset | null>(null);
  const [createCoverPreviewUrl, setCreateCoverPreviewUrl] = useState('');
  const [createFreeCount, setCreateFreeCount] = useState(3);
  const [createRewardedEnabled, setCreateRewardedEnabled] = useState(true);
  const [createPlacementId, setCreatePlacementId] = useState('ad7686459794040702993');
  const [createRewardedCount, setCreateRewardedCount] = useState(1);
  const [draftEpisodes, setDraftEpisodes] = useState<DraftEpisode[]>(() => Array.from({ length: 3 }, (_, index) => ({ localId: `draft-${index + 1}`, episodeNo: index + 1, title: `第 ${index + 1} 集`, sortOrder: index + 1, isFree: index < 3 })));
  const [creating, setCreating] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingEntryAdPolicy, setSavingEntryAdPolicy] = useState(false);
  const [savingAlbumId, setSavingAlbumId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
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
        api<{ admin: AdminProfile }>('/admin/me')
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
      if (albumResult) setAlbums(albumResult.items);
      if (episodeResult) setEpisodes(episodeResult.items);
      if (overviewResult) setOverview(overviewResult);
      if (jobResult) setJobs(jobResult.items);
      if (audienceResult) setAudience(audienceResult);
      if (playbackResult) setPlayback(playbackResult);
      if (adminResult) setCurrentAdmin(adminResult.admin);
    } finally {
      if (!(await entryAdPolicyRequest)) failures.push('进入广告策略');
      setMessage(failures.length ? `部分数据加载失败：${failures.join('、')}。请点击刷新重试。` : '');
      setLoading(false);
    }
  };

  useEffect(() => { if (loggedIn) void loadData(); }, [loggedIn, analyticsFrom, analyticsTo, analyticsTimezone]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(contentDraftStorageKey) ?? 'null') as { title?: string; description?: string; cover?: CoverAsset | null; freeCount?: number; rewardedEnabled?: boolean; placementId?: string; rewardedCount?: number; episodes?: DraftEpisode[] } | null;
      if (saved) {
        setCreateTitle(saved.title ?? '');
        setCreateDescription(saved.description ?? '');
        setCreateCover(saved.cover ?? null);
        setCreateFreeCount(saved.freeCount ?? 3);
        setCreateRewardedEnabled(saved.rewardedEnabled ?? true);
        setCreatePlacementId(saved.placementId ?? 'ad7686459794040702993');
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
    localStorage.setItem(contentDraftStorageKey, JSON.stringify({ title: createTitle, description: createDescription, cover: createCover, freeCount: createFreeCount, rewardedEnabled: createRewardedEnabled, placementId: createPlacementId, rewardedCount: createRewardedCount, episodes: draftEpisodes.map(({ file, coverFile, coverPreviewUrl, ...episode }) => episode) }));
  }, [createTitle, createDescription, createCover, createFreeCount, createRewardedEnabled, createPlacementId, createRewardedCount, draftEpisodes, draftReady]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const resetCreateForm = () => {
    setCreateTitle('');
    setCreateDescription('');
    setCreateCoverFile(null);
    setCreateCover(null);
    setCreateCoverPreviewUrl('');
    setCreateFreeCount(3);
    setCreateRewardedEnabled(true);
    setCreatePlacementId('ad7686459794040702993');
    setCreateRewardedCount(1);
    setBatchFeedback('');
    localStorage.removeItem(contentDraftStorageKey);
    setDraftEpisodes(Array.from({ length: 3 }, (_, index) => ({ localId: `draft-${Date.now()}-${index + 1}`, episodeNo: index + 1, title: `第 ${index + 1} 集`, sortOrder: index + 1, isFree: index < 3 })));
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
    setDraftEpisodes((current) => Array.from({ length: safeCount }, (_, index) => current[index] ?? { localId: `draft-${Date.now()}-${index + 1}`, episodeNo: index + 1, title: `第 ${index + 1} 集`, sortOrder: index + 1, isFree: index < createFreeCount }));
  };

  const patchDraftEpisode = (localId: string, patch: Partial<DraftEpisode>) => setDraftEpisodes((items) => items.map((item) => item.localId === localId ? { ...item, ...patch } : item));

  const applyBatchFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const configuredEpisodeNos = new Set(draftEpisodes.map((episode) => episode.episodeNo));
    const matchedByEpisode = new Map<number, File[]>();
    const unmatchedNames: string[] = [];
    for (const file of selected) {
      const episodeNo = episodeNoFromName(file.name);
      if (!episodeNo || !configuredEpisodeNos.has(episodeNo)) {
        unmatchedNames.push(file.name);
        continue;
      }
      const matches = matchedByEpisode.get(episodeNo) ?? [];
      matches.push(file);
      matchedByEpisode.set(episodeNo, matches);
    }
    const duplicateEpisodeNos = [...matchedByEpisode.entries()].filter(([, matches]) => matches.length > 1).map(([episodeNo]) => episodeNo);
    const missingEpisodeNos = draftEpisodes.filter((episode) => !episode.file && !matchedByEpisode.has(episode.episodeNo)).map((episode) => episode.episodeNo);
    setBatchFeedback([unmatchedNames.length ? `未匹配文件：${unmatchedNames.join('、')}` : '', duplicateEpisodeNos.length ? `重复匹配集数：${duplicateEpisodeNos.join('、')}` : '', missingEpisodeNos.length ? `未选择视频的集数：${missingEpisodeNos.join('、')}` : '所有已选择文件都已按集号匹配。'].filter(Boolean).join('；'));
    setDraftEpisodes((items) => {
      const used = new Set<File>();
      return items.map((episode) => {
        if (episode.file) return episode;
        const match = selected.find((file) => !used.has(file) && episodeNoFromName(file.name) === episode.episodeNo);
        if (!match) return episode;
        used.add(match);
        return { ...episode, file: match };
      });
    });
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
      patchDraftEpisode(draft.localId, { uploadStatus: '上传失败', uploadError });
      throw error;
    }
  };

  const submitDrama = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    try {
      let draftsToUpload = draftEpisodes;
      if (!draftEpisodes.some((episode) => episode.savedEpisodeId)) {
        const cover = createCover ?? await uploadCover();
        const draftsWithCovers = await Promise.all(draftEpisodes.map(async (episode) => ({ ...episode, coverAsset: await uploadEpisodeCover(episode) })));
        const result = await api<{ album: Album; episodes: { id: string; episodeNo: number }[] }>('/admin/dramas', {
          method: 'POST',
          body: JSON.stringify({
            title: createTitle,
            description: createDescription,
            coverAssetId: cover.id,
            accessConfig: {
              freeEpisodeCount: createFreeCount,
              rewardedAdEnabled: createRewardedEnabled,
              rewardedPlacementId: createPlacementId,
              rewardedAdCount: createRewardedCount
            },
            episodes: draftsWithCovers.map((episode) => ({
              episodeNo: episode.episodeNo,
              title: episode.title,
              sortOrder: episode.sortOrder,
              isFree: episode.isFree,
              coverAssetId: episode.coverAsset?.id ?? null
            }))
          })
        });
        const episodeByNo = new Map(result.episodes.map((episode) => [episode.episodeNo, episode.id]));
        draftsToUpload = draftsWithCovers.map((draft) => ({ ...draft, savedEpisodeId: episodeByNo.get(draft.episodeNo) }));
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
      if (failedUploads.length) {
        setMessage(`短剧已创建，但有 ${failedUploads.length} 个视频上传失败，可在对应行单独重试。`);
      } else {
        setMessage('短剧草稿已创建，已选择的视频也完成上传。');
        resetCreateForm();
      }
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '内容创建失败');
    } finally {
      setCreating(false);
    }
  };

  const updateAccess = async (album: Album) => {
    setSavingAlbumId(album.id);
    const accessConfig = { freeEpisodeCount: 0, rewardedAdEnabled: true, rewardedPlacementId: 'ad7686459794040702993', rewardedAdCount: 1, ...album.accessConfig };
    try {
      await api(`/admin/albums/${album.id}`, { method: 'PATCH', body: JSON.stringify({ accessConfig }) });
      setMessage('剧集访问配置已保存');
    } catch (error) {
      setMessage(error instanceof Error ? `剧集访问配置保存失败：${error.message}` : '剧集访问配置保存失败');
    } finally {
      setSavingAlbumId(null);
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
  const canWriteContent = hasAdminPermission(currentAdmin?.role, 'content.write');
  const canWriteAds = hasAdminPermission(currentAdmin?.role, 'ads.write');
  const navItems: Array<[Tab, typeof Activity, string]> = [['overview', LayoutDashboard, '概览'], ['audience', Users, '观众数据'], ['playback', Activity, '播放质量']];
  if (canWriteContent) navItems.splice(1, 0, ['create', Plus, '内容创建'], ['albums', ListVideo, '剧集与解锁']);
  if (canWriteAds) navItems.splice(canWriteContent ? 3 : 1, 0, ['ads', Megaphone, '进入广告']);
  const tabLabels: Record<Tab, string> = { overview: '概览', create: '内容创建', albums: '剧集与解锁', ads: '进入广告', audience: '观众数据', playback: '播放质量', security: '账号安全' };
  const title = tab === 'overview' ? '内容运营概览' : tab === 'create' ? '内容创建' : tab === 'ads' ? '进入广告策略' : tab === 'audience' ? '观众数据' : tab === 'playback' ? '播放质量' : tab === 'security' ? '账号安全' : '剧集与解锁配置';

  return <div className="admin-layout"><aside className="sidebar"><div className="brand"><span><Film size={17} /></span>QuicK <span>ReeLS</span></div><p className="workspace-label">运营工作区</p><nav>
    {navItems.map(([key, Icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}
  </nav><div className="sidebar-bottom"><button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><Settings2 size={17} />账号安全</button><div className="account"><span className="account-avatar">{currentAdmin?.email.slice(0, 2).toUpperCase() ?? 'OP'}</span><span><strong>{currentAdmin?.email ?? '运营管理员'}</strong><small>{currentAdmin?.role ?? 'TK小程序管理后台'}</small></span><MoreHorizontal size={16} /></div></div></aside>
    <main className="main"><header className="page-header"><div><p className="eyebrow">运营管理 / {tabLabels[tab]}</p><h1>{title}</h1><p className="subhead">数据和配置通过 API 实时同步到 QuicK ReeLS 小程序。</p></div><div className="header-actions"><button className="secondary" onClick={() => void loadData()} title="刷新数据"><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button><button className="secondary" onClick={() => { sessionStorage.removeItem(adminTokenStorageKey); setLoggedIn(false); }}>退出登录</button></div></header>{message && <div className="notice"><CheckCircle2 size={16} />{message}</div>}
      {(tab === 'audience' || tab === 'playback') && <div className="toolbar"><span><CalendarDays size={15} />统计周期</span><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(7)}>近 7 天</button><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(30)}>近 30 天</button><button className="secondary" type="button" onClick={() => selectAnalyticsPreset(90)}>近 90 天</button><label>开始<input type="date" value={analyticsFrom} max={analyticsTo} onChange={(event) => setAnalyticsFrom(event.target.value)} /></label><label>结束<input type="date" value={analyticsTo} min={analyticsFrom} max={inputDate(new Date())} onChange={(event) => setAnalyticsTo(event.target.value)} /></label><label>时区<select value={analyticsTimezone} onChange={(event) => setAnalyticsTimezone(event.target.value)}><option value="Asia/Shanghai">Asia/Shanghai</option><option value="UTC">UTC</option></select></label></div>}
      {tab === 'overview' && <><section className="metrics"><Metric label="在线剧集" value={String(overview.albums)} change="实时数据" icon={Film} tone="pink" /><Metric label="在线集数" value={String(overview.episodes)} change="已通过发布条件" icon={ListVideo} tone="cyan" /><Metric label="用户数" value={String(overview.users)} change="累计注册" icon={Users} tone="green" /><Metric label="广告解锁" value={String(overview.rewardedUnlocks)} change="累计完成" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="运营健康度" description="关键业务数据当前状态"><div className="readiness-list"><div><span className="ready-dot done"><CheckCircle2 size={15} /></span><span><strong>剧集元数据与访问策略</strong><small>{overview.albums} 部在线剧集 · {overview.episodes} 集可见</small></span><em>正常</em></div><div><span className="ready-dot done"><Database size={15} /></span><span><strong>观众行为采集</strong><small>{overview.likes} 次点赞 · {overview.favorites} 次收藏 · {overview.searches} 次搜索</small></span><em>正常</em></div><div><span className="ready-dot done"><Gauge size={15} /></span><span><strong>播放质量采集</strong><small>{playback?.totalEvents ?? 0} 条播放器事件已入库</small></span><em>正常</em></div></div></Panel><Panel title="最近上传" description="BytePlus 媒体处理任务"><div className="compact-list">{jobs.slice(0, 5).map((job) => <div className="compact-row" key={job.id}><FileVideo size={17} /><span><strong>{job.episode?.title ?? job.episodeId}</strong><small>{job.sourceName ?? job.sourceType ?? '链接'}</small></span><Status value={job.status} /></div>)}{!jobs.length && <p className="empty-copy">还没有上传任务</p>}</div></Panel></div></>}
      {tab === 'create' && <>
        <Panel title="创建短剧草稿" description="一次录入专辑、封面、剧集和本地视频；失败视频可在该行单独重试。">
          <form className="create-form" onSubmit={submitDrama}>
            <div className="form-grid">
              <label>剧名<input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} required /></label>
              <label>免费集数<input type="number" min="0" max="10000" value={createFreeCount} onChange={(event) => setCreateFreeCount(Number(event.target.value))} /></label>
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
            <label className="check-row"><input type="checkbox" checked={createRewardedEnabled} onChange={(event) => setCreateRewardedEnabled(event.target.checked)} />启用广告解锁</label>
            <div className="episode-toolbar">
              <label>总集数<input className="inline-number" type="number" min="1" max="500" value={draftEpisodes.length} onChange={(event) => applyEpisodeCount(Number(event.target.value))} /></label>
              <label>批量选择视频<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" multiple onChange={(event) => applyBatchFiles(event.target.files)} /></label>
            </div>
            {batchFeedback && <p className="batch-feedback"><AlertTriangle size={15} />{batchFeedback}</p>}
            <div className="table-wrap"><table><thead><tr><th>集号</th><th>标题</th><th>排序</th><th>免费</th><th>独立封面</th><th>视频文件</th><th>状态</th><th></th></tr></thead><tbody>{draftEpisodes.map((episode) => <tr key={episode.localId} className={!episode.file ? 'needs-file' : ''}><td><input className="inline-number" type="number" min="1" value={episode.episodeNo} onChange={(event) => patchDraftEpisode(episode.localId, { episodeNo: Number(event.target.value) })} /></td><td><input className="table-input" value={episode.title} onChange={(event) => patchDraftEpisode(episode.localId, { title: event.target.value })} /></td><td><input className="inline-number" type="number" min="1" value={episode.sortOrder} onChange={(event) => patchDraftEpisode(episode.localId, { sortOrder: Number(event.target.value) })} /></td><td><input type="checkbox" checked={episode.isFree} onChange={(event) => patchDraftEpisode(episode.localId, { isFree: event.target.checked })} /></td><td><div className="episode-cover-cell"><label className="file-cell">{episode.coverFile?.name ?? (episode.coverAsset ? '已保存封面' : '使用专辑封面')}<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => selectEpisodeCover(episode, event.target.files?.[0] ?? null)} /></label>{(episode.coverAsset?.publicUrl ?? episode.coverPreviewUrl) && <img className="episode-cover-preview" src={episode.coverAsset?.publicUrl ?? episode.coverPreviewUrl} alt={`${episode.title} 封面预览`} />}</div></td><td><label className="file-cell">{episode.file?.name ?? '选择视频'}<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" onChange={(event) => patchDraftEpisode(episode.localId, { file: event.target.files?.[0] ?? null, uploadError: undefined })} /></label></td><td><div className="draft-upload-state"><span>{episode.uploadStatus ?? (episode.file ? '待保存' : '缺少视频')}</span>{episode.uploadError && <small className="table-error" title={episode.uploadError}>{episode.uploadError}</small>}{episode.uploadStatus === '上传失败' && episode.file && episode.savedEpisodeId && <button className="text-button retry-button" type="button" onClick={() => void uploadDraftVideo(episode)}>重试上传</button>}</div></td><td><button className="more" type="button" onClick={() => setDraftEpisodes((items) => items.filter((item) => item.localId !== episode.localId))} title="删除"><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
            <button className="secondary" type="button" onClick={() => setDraftEpisodes((items) => [...items, { localId: `draft-${Date.now()}`, episodeNo: items.length + 1, title: `第 ${items.length + 1} 集`, sortOrder: items.length + 1, isFree: items.length < createFreeCount }])}><Plus size={15} />添加分集</button>
            <button className="primary" type="submit" disabled={creating}><Save size={17} />{creating ? '处理中...' : draftEpisodes.some((episode) => episode.savedEpisodeId) ? '上传已选择的视频' : '保存草稿并上传视频'}</button>
          </form>
        </Panel>
        <Panel title="上传处理状态" description="所有由内容创建产生的上传记录集中显示；链接任务失败后可重新加入处理队列。"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>来源</th><th>状态</th><th>处理信息</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.episode?.title ?? job.episodeId}</strong></td><td>{job.sourceName ?? job.sourceType ?? '链接'}</td><td><Status value={job.status} /></td><td>{job.errorMessage ? <small className="table-error" title={job.errorMessage}>{job.errorMessage}</small> : job.providerJobId ?? '本地上传已确认'}</td><td>{new Date(job.createdAt).toLocaleString('zh-CN')}</td><td>{job.status === 'FAILED' && job.sourceType !== 'FILE' ? <button className="secondary retry-button" type="button" disabled={retryingJobId === job.id} onClick={() => void retryUploadJob(job)}><RefreshCw size={14} className={retryingJobId === job.id ? 'spin' : ''} />{retryingJobId === job.id ? '排队中...' : '重新排队'}</button> : '—'}</td></tr>)}</tbody></table>{!jobs.length && <p className="empty-copy table-empty">暂无上传记录</p>}</div></Panel>
      </>}
      {tab === 'albums' && <Panel title="剧集访问策略" description="免费集数和广告解锁配置会立即影响小程序访问"><div className="table-wrap"><table><thead><tr><th>剧集</th><th>状态</th><th>集数</th><th>免费集数</th><th>广告解锁</th><th>每集解锁所需广告观看次数</th><th>操作</th></tr></thead><tbody>{albums.map((album) => <tr key={album.id}><td><span className="drama-thumb" /><strong>{album.title}</strong></td><td><Status value={album.status} /></td><td>{album.episodeCount}</td><td><input className="inline-number" type="number" min="0" value={album.accessConfig?.freeEpisodeCount ?? 0} onChange={(event) => setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, accessConfig: { ...item.accessConfig, freeEpisodeCount: Number(event.target.value) } } : item))} /></td><td><input type="checkbox" checked={album.accessConfig?.rewardedAdEnabled ?? true} onChange={(event) => setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, accessConfig: { ...item.accessConfig, rewardedAdEnabled: event.target.checked } } : item))} /></td><td><input className="inline-number" type="number" min="1" value={album.accessConfig?.rewardedAdCount ?? 1} onChange={(event) => setAlbums((items) => items.map((item) => item.id === album.id ? { ...item, accessConfig: { ...item.accessConfig, rewardedAdCount: Number(event.target.value) } } : item))} /></td><td><button className="save-button" disabled={savingAlbumId === album.id} onClick={() => void updateAccess(album)}><Save size={15} />{savingAlbumId === album.id ? '保存中...' : '保存'}</button></td></tr>)}</tbody></table></div></Panel>}
      {tab === 'ads' && <Panel title="进入广告策略" description="配置将在新的小程序启动会话生效。激励门槛模式须先在 TikTok 平台确认可用。"><form className="policy-form" onSubmit={saveEntryAdPolicy}><label className="check-row"><input type="checkbox" checked={entryAdPolicy.enabled} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, enabled: event.target.checked }))} />启用进入广告</label><div className="form-grid"><label>广告模式<select value={entryAdPolicy.mode} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, mode: event.target.value as AppEntryAdPolicy['mode'] }))}><option value="INTERSTITIAL">插屏广告</option><option value="REWARDED_GATED">激励门槛广告</option></select></label><label>广告位 ID<input value={entryAdPolicy.placementId} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, placementId: event.target.value }))} required /></label><label>每次进入广告观看次数<input type="number" min="1" value={entryAdPolicy.requiredCount} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, requiredCount: Number(event.target.value) }))} required /></label><label>广告不可用时<select value={entryAdPolicy.onUnavailable} onChange={(event) => setEntryAdPolicy((policy) => ({ ...policy, onUnavailable: event.target.value as AppEntryAdPolicy['onUnavailable'] }))}><option value="ALLOW">允许进入</option><option value="BLOCK">阻止进入并重试</option></select></label></div><p className="form-help">当前策略版本：{entryAdPolicy.version}。进入广告与剧集解锁广告使用独立会话和广告位。</p><button className="primary" type="submit" disabled={savingEntryAdPolicy}>{savingEntryAdPolicy ? '保存中...' : <><Save size={17} />保存进入广告策略</>}</button></form></Panel>}
      {tab === 'audience' && audience && <><section className="metrics"><Metric label="活跃观众" value={String(audience.activeUsers)} change={`${audience.from} 至 ${audience.to}`} icon={Users} tone="green" /><Metric label="新增观众" value={String(audience.newUsers)} change={`日活 ${audience.dau} · 周活 ${audience.wau} · 月活 ${audience.mau}`} icon={Database} tone="cyan" /><Metric label="观看会话" value={String(audience.watchSessions)} change="播放器会话开始次数" icon={Film} tone="pink" /><Metric label="完播集数" value={String(audience.completedEpisodes)} change="每用户每集首次完播" icon={CheckCircle2} tone="yellow" /></section><div className="content-grid"><Panel title="观众趋势" description="按天统计新增和活跃用户"><DailyBars title="新增观众" items={audience.dailyNewUsers} /><DailyBars title="日活用户" items={audience.dailyActiveUsers} /></Panel><Panel title="互动概览" description="帮助判断内容和运营活动表现"><BarList title="互动指标" items={[{ label: '收藏', value: audience.favorites }, { label: '分享', value: audience.shares }, { label: '搜索', value: audience.searches }]} color="cyan" /></Panel></div></>}
      {tab === 'playback' && playback && <><section className="metrics"><Metric label="播放器事件" value={String(playback.totalEvents)} change={`近 ${playback.periodDays} 天`} icon={Activity} tone="cyan" /><Metric label="首帧事件" value={String(playback.firstFrames)} change="成功启动" icon={Gauge} tone="green" /><Metric label="错误率" value={`${playback.errorRate}%`} change={`${playback.errorCount} 次错误`} icon={CircleAlert} tone="pink" /><Metric label="平均首帧" value={playback.averageStartupMs === null ? '-' : `${playback.averageStartupMs} 毫秒`} change="启动耗时" icon={Wifi} tone="yellow" /></section><div className="content-grid"><Panel title="播放事件分布" description="根据小程序播放器上报聚合"><BarList title="事件类型" items={playback.eventTypes.map((item) => ({ label: item.eventType, value: item.count }))} /><BarList title="清晰度" items={playback.definitions.map((item) => ({ label: item.definition, value: item.count }))} color="cyan" /><BarList title="网络类型" items={playback.networks.map((item) => ({ label: item.networkType, value: item.count }))} color="green" /></Panel><Panel title="最近播放错误" description="优先定位实际影响用户的剧集"><div className="compact-list">{playback.recentErrors.map((error, index) => <div className="compact-row" key={`${error.createdAt}-${index}`}><CircleAlert size={17} /><span><strong>{error.episodeTitle}</strong><small>{error.errorCode ?? '未知错误'} · {new Date(error.createdAt).toLocaleString('zh-CN')}</small></span></div>)}{!playback.recentErrors.length && <p className="empty-copy">暂无播放错误</p>}</div></Panel></div></>}
      {tab === 'security' && <div className="content-grid"><Panel title="当前管理员" description="角色和账号状态由服务端实时校验"><div className="readiness-list"><div><span className="ready-dot done"><CheckCircle2 size={15} /></span><span><strong>{currentAdmin?.email ?? '-'}</strong><small>角色：{currentAdmin?.role ?? '-'} · 状态：{currentAdmin?.status ?? '-'}</small></span></div><div><span className="ready-dot done"><CalendarDays size={15} /></span><span><strong>最近登录</strong><small>{currentAdmin?.lastLoginAt ? new Date(currentAdmin.lastLoginAt).toLocaleString('zh-CN') : '暂无记录'}</small></span></div></div></Panel><Panel title="修改密码" description="更新后当前登录令牌会立即失效"><form className="policy-form" onSubmit={changePassword}><label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>新密码<input type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><button className="primary" type="submit" disabled={changingPassword}><Save size={17} />{changingPassword ? '更新中...' : '更新密码'}</button></form></Panel></div>}
    </main></div>;
}

createRoot(document.getElementById('root')!).render(<AdminApp />);
