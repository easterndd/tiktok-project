import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Viewer = { id: string; identityType: string; tiktokOpenId: string | null; appEntryAdExempt: boolean; createdAt: string; lastSeenAt: string | null; countryCode: string | null; ipAddress: string | null };
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
  const load = async (term: string, ipTerm: string, appKey: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ search: term, ipAddress: ipTerm, miniAppKey: appKey, limit: '30' });
      const result = await api<{ items: Viewer[] }>('/admin/shared/viewers?' + query);
      setItems(result.items);
      setSelected(new Set());
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取用户失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load('', '', currentMiniApp); }, [currentMiniApp]);
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
  return <Panel title="指定用户进入广告" description="按组织内小程序、用户 ID、TikTok OpenID 或 IP 筛选；用户豁免只对所选小程序生效。">
    <form className="policy-form" onSubmit={submit}>
      <label>小程序<select value={miniAppKey} onChange={(event) => { const key = event.target.value; setMiniAppKey(key); void load(search.trim(), ipAddress.trim(), key); }}>{miniApps.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
      <label>用户 ID / OpenID<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="留空显示最近 30 位用户" /></label>
      <label>IP 地址<input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="输入完整 IPv4 或 IPv6" /></label>
      <button className="secondary" type="submit" disabled={loading}>{loading ? '查询中...' : '查询用户'}</button>
    </form>
    {message && <p className="form-help">{message}</p>}
    <div className="toolbar"><span>{selectedMiniApp?.name ?? miniAppKey} · 已选择 {selected.size} 位</span><button className="secondary" type="button" disabled={!canEdit || saving || !selected.size} onClick={() => void changeSelected(true)}>豁免所选用户</button><button className="secondary" type="button" disabled={!canEdit || saving || !selected.size} onClick={() => void changeSelected(false)}>正常展示所选用户</button></div>
    <div className="table-wrap"><table><thead><tr><th><input aria-label="选择当前页用户" type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())} /></th><th>小程序用户 ID</th><th>身份</th><th>最近会话</th><th>最近 IP</th><th>国家/地区</th><th>进入广告</th></tr></thead><tbody>{items.map((viewer) => <tr key={viewer.id}><td><input aria-label={`选择用户 ${viewer.id}`} type="checkbox" checked={selected.has(viewer.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(viewer.id); else next.delete(viewer.id); return next; })} /></td><td><code>{viewer.id}</code>{viewer.tiktokOpenId && <small>OpenID：{viewer.tiktokOpenId}</small>}</td><td>{viewer.identityType}</td><td>{viewer.lastSeenAt ? new Date(viewer.lastSeenAt).toLocaleString('zh-CN') : '-'}</td><td><code>{viewer.ipAddress ?? '-'}</code></td><td>{viewer.countryCode ?? '未知'}</td><td><button className="secondary" type="button" disabled={!canEdit || saving} onClick={() => void change(viewer)}>{viewer.appEntryAdExempt ? '已豁免 · 点击恢复' : '正常展示 · 点击豁免'}</button></td></tr>)}</tbody></table>{!items.length && !loading && <p className="empty-copy table-empty">暂无匹配用户</p>}</div>
  </Panel>;
}
