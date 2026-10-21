import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type MiniApp = { key: string; name: string };
type Ip = { ipAddress: string | null; ipHash: string; visitCount: number; firstSeenAt: string; lastSeenAt: string; lastMiniAppKey: string; exempt: boolean };
type Exemption = { ipAddress: string; note: string | null; updatedAt: string; updatedBy: string };
type Visit = { miniAppKey: string; userId: string; createdAt: string };
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export function SharedIpControls({ api, canEdit, miniApps }: { api: Api; canEdit: boolean; miniApps: MiniApp[] }) {
  const [search, setSearch] = useState('');
  const [miniAppKey, setMiniAppKey] = useState('');
  const [ips, setIps] = useState<Ip[]>([]);
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [more, setMore] = useState(false);
  const [ipInput, setIpInput] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async (term: string, appKey: string) => {
    const query = new URLSearchParams({ search: term, limit: '50' });
    if (appKey) query.set('miniAppKey', appKey);
    const [ipResult, exemptionResult] = await Promise.all([
      api<{ items: Ip[] }>('/admin/shared/ips?' + query),
      api<{ items: Exemption[] }>('/admin/shared/entry-ad-ip-exemptions')
    ]);
    setIps(ipResult.items);
    setExemptions(exemptionResult.items);
    setSelected(new Set());
  };
  useEffect(() => { void load('', '').catch((error) => setMessage(error instanceof Error ? error.message : '读取共享 IP 失败')); }, []);
  const submitSearch = (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    void load(search.trim(), miniAppKey).then(() => setMessage(''), (error) => setMessage(error instanceof Error ? error.message : '查询失败')).finally(() => setBusy(false));
  };
  const showVisits = async (ip: string, offset = 0) => {
    setBusy(true);
    try {
      const query = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (miniAppKey) query.set('miniAppKey', miniAppKey);
      const result = await api<{ items: Visit[] }>('/admin/shared/ips/' + encodeURIComponent(ip) + '/visits?' + query);
      setVisits((current) => offset ? [...current, ...result.items] : result.items);
      setSelectedIp(ip); setMore(result.items.length === 50); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取历史失败'); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await api('/admin/shared/entry-ad-ip-exemptions', { method: 'PUT', body: JSON.stringify({ ipAddress: ipInput.trim(), note: note.trim() || null }) });
      await load(search.trim(), miniAppKey); setIpInput(''); setNote(''); setMessage('已保存。该 IP 在所有小程序的下一次入场强弹检查中豁免。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const remove = async (ip: string) => {
    setBusy(true);
    try {
      await api('/admin/shared/entry-ad-ip-exemptions/' + encodeURIComponent(ip), { method: 'DELETE' });
      await load(search.trim(), miniAppKey); setMessage('已移除 IP 豁免。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '移除失败'); }
    finally { setBusy(false); }
  };
  const changeSelected = async (exempt: boolean) => {
    const ipAddresses = ips.filter((item) => item.ipAddress && selected.has(item.ipHash)).map((item) => item.ipAddress!);
    if (!ipAddresses.length || !window.confirm(`确定将所选 ${ipAddresses.length} 个 IP 设为${exempt ? '豁免入场广告' : '正常展示入场广告'}？此设置对所有小程序生效。`)) return;
    setBusy(true);
    try {
      const result = await api<{ count: number }>('/admin/shared/entry-ad-ip-exemptions/batch', { method: 'POST', body: JSON.stringify({ ipAddresses, exempt, note: null }) });
      await load(search.trim(), miniAppKey);
      setMessage(`已更新 ${result.count} 个 IP；设置对所有小程序的入场广告生效。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '批量更新失败'); }
    finally { setBusy(false); }
  };
  const allSelected = ips.length > 0 && ips.every((item) => selected.has(item.ipHash));
  const miniAppName = (key: string) => miniApps.find((item) => item.key === key)?.name ?? key;
  return <>
    <Panel title="全小程序 IP 汇总" description="按 IP 或小程序筛选；少于 3 次且未豁免的原始 IP 在最后访问 30 天后清除。">
      <form className="policy-form" onSubmit={(event) => { setSelectedIp(null); setVisits([]); submitSearch(event); }}>
        <label>IP 地址<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="留空显示最近 50 个 IP" /></label>
        <label>小程序<select value={miniAppKey} onChange={(event) => { const key = event.target.value; setMiniAppKey(key); setSelectedIp(null); setVisits([]); setBusy(true); void load(search.trim(), key).then(() => setMessage(''), (error) => setMessage(error instanceof Error ? error.message : '查询失败')).finally(() => setBusy(false)); }}><option value="">所有小程序</option>{miniApps.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        <button className="secondary" type="submit" disabled={busy}>查询 IP</button>
      </form>
      {message && <p className="form-help">{message}</p>}
      <div className="toolbar"><span>已选择 {selected.size} 个 IP</span><button className="secondary" type="button" disabled={!canEdit || busy || !selected.size} onClick={() => void changeSelected(true)}>豁免所选 IP</button><button className="secondary" type="button" disabled={!canEdit || busy || !selected.size} onClick={() => void changeSelected(false)}>正常展示所选 IP</button></div>
      <div className="table-wrap"><table><thead><tr><th><input aria-label="选择当前页 IP" type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(ips.map((item) => item.ipHash)) : new Set())} /></th><th>IP</th><th>访问次数</th><th>首次进入</th><th>最近进入</th><th>最近小程序</th><th>入场强弹</th><th>历史</th></tr></thead><tbody>{ips.map((item) => <tr key={item.ipHash}><td><input aria-label={`选择 IP ${item.ipAddress ?? '已清除'}`} type="checkbox" disabled={!item.ipAddress} checked={selected.has(item.ipHash)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.ipHash); else next.delete(item.ipHash); return next; })} /></td><td><code>{item.ipAddress ?? '已清除'}</code></td><td>{item.visitCount}</td><td>{date(item.firstSeenAt)}</td><td>{date(item.lastSeenAt)}</td><td>{miniAppName(item.lastMiniAppKey)}</td><td>{item.exempt ? '已豁免' : '正常展示'}</td><td>{item.ipAddress ? <button className="secondary" type="button" disabled={busy} onClick={() => void showVisits(item.ipAddress!)}>查看历史</button> : '-'}</td></tr>)}</tbody></table>{!ips.length && <p className="empty-copy table-empty">暂无匹配 IP</p>}</div>
      {selectedIp && <><p className="form-help">{selectedIp} 的访问历史{miniAppKey ? ` · ${miniAppName(miniAppKey)}` : ' · 所有小程序'}</p><div className="table-wrap"><table><thead><tr><th>小程序</th><th>用户 ID</th><th>进入时间</th></tr></thead><tbody>{visits.map((visit, index) => <tr key={visit.miniAppKey + ':' + visit.userId + ':' + visit.createdAt + ':' + index}><td>{miniAppName(visit.miniAppKey)}</td><td><code>{visit.userId}</code></td><td>{date(visit.createdAt)}</td></tr>)}</tbody></table></div>{more && <button className="secondary" type="button" disabled={busy} onClick={() => void showVisits(selectedIp, visits.length)}>加载更多</button>}</>}
    </Panel>
    <Panel title="入场强弹 IP 豁免" description="仅跳过入场强弹，所有小程序统一生效；剧集解锁广告保持原有规则。">
      <form className="policy-form" onSubmit={save}><label>IP 地址<input value={ipInput} onChange={(event) => setIpInput(event.target.value)} placeholder="IPv4 或 IPv6" required /></label><label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：用途或负责人" /></label><button className="primary" type="submit" disabled={!canEdit || busy}>添加或更新豁免</button></form>
      <div className="table-wrap"><table><thead><tr><th>豁免 IP</th><th>备注</th><th>更新时间</th><th>操作人</th><th>操作</th></tr></thead><tbody>{exemptions.map((item) => <tr key={item.ipAddress}><td><code>{item.ipAddress}</code></td><td>{item.note ?? '-'}</td><td>{date(item.updatedAt)}</td><td>{item.updatedBy}</td><td><button className="secondary" type="button" disabled={!canEdit || busy} onClick={() => void remove(item.ipAddress)}>移除豁免</button></td></tr>)}</tbody></table>{!exemptions.length && <p className="empty-copy table-empty">暂无 IP 豁免</p>}</div>
    </Panel>
  </>;
}
