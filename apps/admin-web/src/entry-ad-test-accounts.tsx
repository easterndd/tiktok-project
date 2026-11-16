import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type MiniApp = { key: string; name: string };
type TestAccount = {
  miniAppKey: string; userId: string; enabled: boolean; note: string | null;
  expiresAt: string; createdAt: string; updatedAt: string;
};

export function EntryAdTestAccounts({ api, miniApps, currentMiniApp }: { api: Api; miniApps: MiniApp[]; currentMiniApp: string }) {
  const [miniAppKey, setMiniAppKey] = useState(currentMiniApp);
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(7);
  const [items, setItems] = useState<TestAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async (key: string) => {
    try {
      const result = await api<{ items: TestAccount[] }>(`/admin/shared/entry-ad-test-accounts?miniAppKey=${encodeURIComponent(key)}`);
      setItems(result.items);
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取测试账号失败'); }
  };
  useEffect(() => { void load(miniAppKey); }, [miniAppKey]);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId.trim() || busy) return;
    setBusy(true);
    try {
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      await api('/admin/shared/entry-ad-test-accounts', {
        method: 'POST', body: JSON.stringify({ miniAppKey, userId: userId.trim(), note: note.trim() || null, expiresAt })
      });
      setUserId('');
      setNote('');
      setMessage('测试账号已登记；下一次启动生效。');
      await load(miniAppKey);
    } catch (error) { setMessage(error instanceof Error ? error.message : '登记失败'); }
    finally { setBusy(false); }
  };
  const setEnabled = async (item: TestAccount) => {
    if (busy) return;
    const active = item.enabled && new Date(item.expiresAt).getTime() > Date.now();
    setBusy(true);
    try {
      await api(`/admin/shared/entry-ad-test-accounts/${encodeURIComponent(item.userId)}`, {
        method: 'PATCH', body: JSON.stringify({ miniAppKey, enabled: !active })
      });
      setMessage(active ? '已停用；新启动不再获得测试放行。' : '已启用；下一次启动生效。');
      await load(miniAppKey);
    } catch (error) { setMessage(error instanceof Error ? error.message : '更新失败'); }
    finally { setBusy(false); }
  };
  return <Panel title="入口广告测试账号" description="按小程序用户 ID 手动登记；VPN IP 变化不会影响账号识别。">
    <form className="policy-form" onSubmit={add}>
      <label>小程序<select value={miniAppKey} onChange={(event) => setMiniAppKey(event.target.value)}>{miniApps.map((app) => <option key={app.key} value={app.key}>{app.name}</option>)}</select></label>
      <label>用户 ID<input value={userId} maxLength={128} onChange={(event) => setUserId(event.target.value)} placeholder="从下方用户列表复制该小程序的用户 ID" required /></label>
      <label>备注<input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="测试人员或设备" /></label>
      <label>有效期<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? '保存中...' : '手动加入测试账号'}</button>
    </form>
    <p className="form-help">真实归因状态照常保存；未归因测试账号仅在入口决策中标记为测试放行。全局 IP 豁免、用户广告豁免及入口策略关闭仍优先执行。修改从下一次启动生效。</p>
    {message && <p className="form-help">{message}</p>}
    <div className="table-wrap"><table><thead><tr><th>用户 ID</th><th>备注</th><th>状态</th><th>到期时间</th><th>操作</th></tr></thead><tbody>{items.map((item) => {
      const expired = new Date(item.expiresAt).getTime() <= Date.now();
      return <tr key={item.userId}><td><code>{item.userId}</code></td><td>{item.note || '-'}</td><td>{!item.enabled ? '已停用' : expired ? '已到期' : '生效中'}</td><td>{new Date(item.expiresAt).toLocaleString('zh-CN')}</td><td><button className="secondary" type="button" disabled={busy} onClick={() => void setEnabled(item)}>{item.enabled && !expired ? '停用' : '重新启用 7 天'}</button></td></tr>;
    })}</tbody></table>{!items.length && <p className="empty-copy table-empty">暂无测试账号</p>}</div>
  </Panel>;
}
