import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Viewer = { id: string; identityType: string; tiktokOpenId: string | null; appEntryAdExempt: boolean; createdAt: string; lastSeenAt: string | null; countryCode: string | null; ipAddress: string | null };
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

export function ViewerAdControls({ api, canEdit }: { api: Api; canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Viewer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const load = async (term: string) => {
    setLoading(true);
    try {
      const result = await api<{ items: Viewer[] }>('/admin/viewers?search=' + encodeURIComponent(term) + '&limit=30');
      setItems(result.items);
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取用户失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(''); }, []);
  const submit = (event: FormEvent) => { event.preventDefault(); void load(search.trim()); };
  const change = async (viewer: Viewer) => {
    setSaving(viewer.id);
    try {
      const updated = await api<{ appEntryAdExempt: boolean }>('/admin/viewers/' + encodeURIComponent(viewer.id) + '/app-entry-ad', { method: 'PATCH', body: JSON.stringify({ appEntryAdExempt: !viewer.appEntryAdExempt }) });
      setItems((current) => current.map((item) => item.id === viewer.id ? { ...item, appEntryAdExempt: updated.appEntryAdExempt } : item));
      setMessage('已保存；下一次进入广告会话立即生效。剧集解锁广告不受影响。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(null); }
  };
  return <Panel title="指定用户进入广告" description="按当前小程序的用户 ID 或 TikTok OpenID 搜索；此处按用户豁免，下方可单独按 IP 跨小程序豁免。">
    <form className="policy-form" onSubmit={submit}><label>用户 ID / OpenID<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="留空显示最近 30 位用户" /></label><button className="secondary" type="submit" disabled={loading}>{loading ? '查询中...' : '查询用户'}</button></form>
    {message && <p className="form-help">{message}</p>}
    <div className="table-wrap"><table><thead><tr><th>小程序用户 ID</th><th>身份</th><th>最近会话</th><th>最近 IP</th><th>国家/地区</th><th>进入广告</th></tr></thead><tbody>{items.map((viewer) => <tr key={viewer.id}><td><code>{viewer.id}</code>{viewer.tiktokOpenId && <small>OpenID：{viewer.tiktokOpenId}</small>}</td><td>{viewer.identityType}</td><td>{viewer.lastSeenAt ? new Date(viewer.lastSeenAt).toLocaleString('zh-CN') : '-'}</td><td><code>{viewer.ipAddress ?? '-'}</code></td><td>{viewer.countryCode ?? '未知'}</td><td><button className="secondary" type="button" disabled={!canEdit || saving === viewer.id} onClick={() => void change(viewer)}>{viewer.appEntryAdExempt ? '已豁免 · 点击恢复' : '正常展示 · 点击豁免'}</button></td></tr>)}</tbody></table>{!items.length && !loading && <p className="empty-copy table-empty">暂无匹配用户</p>}</div>
  </Panel>;
}
