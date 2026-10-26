import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Attribution = { status: 'ATTRIBUTED' | 'UNATTRIBUTED'; adId: string | null; reason: string };
type Viewer = { id: string; identityType: string; tiktokOpenId: string | null; appEntryAdExempt: boolean; createdAt: string; lastSeenAt: string | null; countryCode: string | null; ipAddress: string | null; launchContext: { metadata?: unknown; createdAt: string; attribution?: Attribution } | null };
type LaunchEvent = { id: string; createdAt: string; metadata: unknown; attribution?: Attribution };
type LaunchMetadata = { rawUrl?: unknown; sdkPayloadRaw?: unknown; launchScene?: unknown; launchPath?: unknown; launchQuery?: unknown };
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

type MiniApp = { key: string; name: string };

export function ViewerAdControls({ api, canEdit, miniApps, currentMiniApp }: { api: Api; canEdit: boolean; miniApps: MiniApp[]; currentMiniApp: string }) {
  const [search, setSearch] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [miniAppKey, setMiniAppKey] = useState(currentMiniApp);
  const [items, setItems] = useState<Viewer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [launches, setLaunches] = useState<LaunchEvent[]>([]);
  const [launchesLoading, setLaunchesLoading] = useState(false);
  const [launchesMore, setLaunchesMore] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const loadingRef = useRef(false);
  const filtersRef = useRef({ search: '', ipAddress: '', miniAppKey: currentMiniApp });
  filtersRef.current = { search, ipAddress, miniAppKey };
  const load = async (term: string, ipTerm: string, appKey: string, options: { preserveView?: boolean; silent?: boolean } = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const query = new URLSearchParams({ search: term, ipAddress: ipTerm, miniAppKey: appKey, limit: '30' });
      const result = await api<{ items: Viewer[] }>('/admin/shared/viewers?' + query);
      setItems(result.items);
      setSelected((current) => options.preserveView ? new Set([...current].filter((id) => result.items.some((item) => item.id === id))) : new Set());
      setExpandedUserId((current) => options.preserveView && current && result.items.some((item) => item.id === current) ? current : null);
      setLastUpdatedAt(new Date());
      if (!options.silent) setMessage('');
    } catch (error) { if (!options.silent) setMessage(error instanceof Error ? error.message : '读取用户失败'); }
    finally { loadingRef.current = false; setLoading(false); }
  };
  useEffect(() => { void load('', '', currentMiniApp); }, [currentMiniApp]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const filters = filtersRef.current;
      void load(filters.search.trim(), filters.ipAddress.trim(), filters.miniAppKey, { preserveView: true, silent: true });
    };
    const timer = window.setInterval(refresh, 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [currentMiniApp]);
  const submit = (event: FormEvent) => { event.preventDefault(); void load(search.trim(), ipAddress.trim(), miniAppKey); };
  const change = async (viewer: Viewer) => {
    setSaving(true);
    try {
      const updated = await api<{ appEntryAdExempt: boolean }>('/admin/shared/viewers/app-entry-ad/batch', { method: 'PATCH', body: JSON.stringify({ miniAppKey, userIds: [viewer.id], appEntryAdExempt: !viewer.appEntryAdExempt }) });
      setItems((current) => current.map((item) => item.id === viewer.id ? { ...item, appEntryAdExempt: updated.appEntryAdExempt } : item));
      setMessage('已保存；下一次进入广告会话立即生效。剧集解锁广告不受影响。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const changeSelected = async (appEntryAdExempt: boolean) => {
    const userIds = [...selected];
    if (!userIds.length || !window.confirm(`确定将所选 ${userIds.length} 位用户设为${appEntryAdExempt ? '豁免入场广告' : '正常展示入场广告'}？`)) return;
    setSaving(true);
    try {
      const result = await api<{ count: number }>('/admin/shared/viewers/app-entry-ad/batch', { method: 'PATCH', body: JSON.stringify({ miniAppKey, userIds, appEntryAdExempt }) });
      setItems((current) => current.map((item) => (userIds.includes(item.id) ? { ...item, appEntryAdExempt } : item)));
      setSelected(new Set());
      setMessage(`已更新 ${result.count} 位用户；只影响当前小程序的入场广告。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '批量更新失败'); }
    finally { setSaving(false); }
  };
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedMiniApp = miniApps.find((item) => item.key === miniAppKey);
  const metadataFor = (value: unknown): LaunchMetadata => value && typeof value === 'object' && !Array.isArray(value) ? value as LaunchMetadata : {};
  const rawUrlFor = (value: unknown) => {
    const rawUrl = metadataFor(value).rawUrl;
    return typeof rawUrl === 'string' && rawUrl ? rawUrl : null;
  };
  const attributionFor = (value: Attribution | undefined) => value?.status === 'ATTRIBUTED' ? `归因 · adId ${value.adId}` : '未归因';
  const loadLaunches = async (userId: string, offset = 0) => {
    setLaunchesLoading(true);
    try {
      const query = new URLSearchParams({ miniAppKey, limit: '30', offset: String(offset) });
      const result = await api<{ items: LaunchEvent[]; hasMore: boolean }>(`/admin/shared/viewers/${encodeURIComponent(userId)}/launches?${query}`);
      setLaunches((previous) => offset ? [...previous, ...result.items] : result.items);
      setLaunchesMore(result.hasMore);
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取入口记录失败'); }
    finally { setLaunchesLoading(false); }
  };
  const showLaunches = (userId: string) => {
    if (expandedUserId === userId) { setExpandedUserId(null); return; }
    setExpandedUserId(userId);
    setLaunches([]);
    void loadLaunches(userId);
  };
  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setMessage('已复制 WebView 原始 URL。'); }
    catch { setMessage('复制失败，请直接选中链接文字复制。'); }
  };
  const launchSummary = (viewer: Viewer) => {
    const metadata = viewer.launchContext?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '-';
    const context = metadataFor(metadata);
    const rawUrl = rawUrlFor(metadata);
    if (rawUrl) return rawUrl;
    const query = context.launchQuery && typeof context.launchQuery === 'object' && !Array.isArray(context.launchQuery)
      ? Object.entries(context.launchQuery as Record<string, unknown>).map(([key, value]) => `${key}=${String(value).slice(0, 64)}`).join('&') : '';
    return [typeof context.launchScene === 'string' ? context.launchScene : '', typeof context.launchPath === 'string' ? context.launchPath : '', query].filter(Boolean).join(' · ') || '-';
  };
  return <Panel title="指定用户进入广告" description="按组织内小程序、用户 ID、TikTok OpenID 或 IP 筛选；用户豁免只对所选小程序生效。">
    <form className="policy-form" onSubmit={submit}>
      <label>小程序<select value={miniAppKey} onChange={(event) => { const key = event.target.value; setMiniAppKey(key); void load(search.trim(), ipAddress.trim(), key); }}>{miniApps.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
      <label>用户 ID / OpenID<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="留空显示最近 30 位用户" /></label>
      <label>IP 地址<input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="输入完整 IPv4 或 IPv6" /></label>
      <button className="secondary" type="submit" disabled={loading}>{loading ? '查询中...' : '查询用户'}</button>
    </form>
    {message && <p className="form-help">{message}</p>}
    <div className="toolbar"><span>{selectedMiniApp?.name ?? miniAppKey} · 已选择 {selected.size} 位 · {lastUpdatedAt ? `更新于 ${lastUpdatedAt.toLocaleTimeString('zh-CN')}` : '等待更新'}</span><button className="secondary" type="button" disabled={!canEdit || saving || !selected.size} onClick={() => void changeSelected(true)}>豁免所选用户</button><button className="secondary" type="button" disabled={!canEdit || saving || !selected.size} onClick={() => void changeSelected(false)}>正常展示所选用户</button></div>
    <p className="form-help">归因规则：入口原始 URL 或入口参数中存在非空、非占位符的 adId 即判定为归因；没有有效 adId 时固定不弹入口强弹广告。归因用户继续按当前小程序的入口广告配置执行。</p>
    <div className="table-wrap"><table><thead><tr><th><input aria-label="选择当前页用户" type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())} /></th><th>小程序用户 ID</th><th>身份</th><th>最近会话</th><th>最近 WebView 原始 URL</th><th>最近 IP</th><th>国家/地区</th><th>进入广告</th></tr></thead><tbody>{items.map((viewer) => <Fragment key={viewer.id}><tr><td><input aria-label={`选择用户 ${viewer.id}`} type="checkbox" checked={selected.has(viewer.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(viewer.id); else next.delete(viewer.id); return next; })} /></td><td><code>{viewer.id}</code>{viewer.tiktokOpenId && <small>OpenID：{viewer.tiktokOpenId}</small>}</td><td>{viewer.identityType}</td><td>{viewer.lastSeenAt ? new Date(viewer.lastSeenAt).toLocaleString('zh-CN') : '-'}</td><td className="launch-url-cell"><code title={launchSummary(viewer)}>{launchSummary(viewer)}</code><button className="text-button" type="button" onClick={() => showLaunches(viewer.id)} aria-expanded={expandedUserId === viewer.id}>{expandedUserId === viewer.id ? '收起记录' : '查看历史'}</button></td><td><code>{viewer.ipAddress ?? '-'}</code></td><td>{viewer.countryCode ?? '未知'}</td><td><button className="secondary" type="button" disabled={!canEdit || saving} onClick={() => void change(viewer)}>{viewer.appEntryAdExempt ? '已豁免 · 点击恢复' : '正常展示 · 点击豁免'}</button></td></tr>{expandedUserId === viewer.id && <tr><td colSpan={8}><div className="launch-history"><strong>入口记录 · {viewer.id}</strong>{launchesLoading && !launches.length && <p>加载中...</p>}{!launchesLoading && !launches.length && <p>暂无入口记录</p>}{launches.map((event) => { const context = metadataFor(event.metadata); const url = rawUrlFor(event.metadata); return <div className="launch-history-item" key={event.id}><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time><div><span>WebView 原始 URL</span><code>{url ?? '旧记录未保存原始 URL'}</code>{url && <button className="text-button" type="button" onClick={() => void copyUrl(url)}>复制 URL</button>}</div><div><span>SDK 原始回调</span><code>{typeof context.sdkPayloadRaw === 'string' ? context.sdkPayloadRaw : 'SDK 未提供或当前版本不支持'}</code></div><div><span>入口摘要</span><code>{JSON.stringify({ scene: context.launchScene ?? null, path: context.launchPath ?? null, query: context.launchQuery ?? {} })}</code></div></div>; })}{launchesMore && <button className="secondary" type="button" disabled={launchesLoading} onClick={() => void loadLaunches(viewer.id, launches.length)}>{launchesLoading ? '加载中...' : '加载更多'}</button>}</div></td></tr>}</Fragment>)}</tbody></table>{!items.length && !loading && <p className="empty-copy table-empty">暂无匹配用户</p>}</div>
  </Panel>;
}
