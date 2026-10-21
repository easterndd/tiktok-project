import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Ip = { ipAddress: string | null; ipHash: string; visitCount: number; firstSeenAt: string; lastSeenAt: string; lastMiniAppKey: string; exempt: boolean };
type Exemption = { ipAddress: string; note: string | null; updatedAt: string; updatedBy: string };
type Visit = { miniAppKey: string; userId: string; createdAt: string };
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export function SharedIpControls({ api, canEdit }: { api: Api; canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [ips, setIps] = useState<Ip[]>([]);
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [more, setMore] = useState(false);
  const [ipInput, setIpInput] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async (term: string) => {
    const [ipResult, exemptionResult] = await Promise.all([
      api<{ items: Ip[] }>('/admin/shared/ips?search=' + encodeURIComponent(term) + '&limit=50'),
      api<{ items: Exemption[] }>('/admin/shared/entry-ad-ip-exemptions')
    ]);
    setIps(ipResult.items); setExemptions(exemptionResult.items);
  };
  useEffect(() => { void load('').catch((error) => setMessage(error instanceof Error ? error.message : '读取共享 IP 失败')); }, []);
  const submitSearch = (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    void load(search.trim()).then(() => setMessage(''), (error) => setMessage(error instanceof Error ? error.message : '查询失败')).finally(() => setBusy(false));
  };
  const showVisits = async (ip: string, offset = 0) => {
    setBusy(true);
    try {
      const result = await api<{ items: Visit[] }>('/admin/shared/ips/' + encodeURIComponent(ip) + '/visits?limit=50&offset=' + offset);
      setVisits((current) => offset ? [...current, ...result.items] : result.items);
      setSelected(ip); setMore(result.items.length === 50); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取历史失败'); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await api('/admin/shared/entry-ad-ip-exemptions', { method: 'PUT', body: JSON.stringify({ ipAddress: ipInput.trim(), note: note.trim() || null }) });
      await load(search.trim()); setIpInput(''); setNote(''); setMessage('已保存。该 IP 在所有小程序的下一次入场强弹检查中豁免。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const remove = async (ip: string) => {
    setBusy(true);
    try {
      await api('/admin/shared/entry-ad-ip-exemptions/' + encodeURIComponent(ip), { method: 'DELETE' });
      await load(search.trim()); setMessage('已移除 IP 豁免。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '移除失败'); }
    finally { setBusy(false); }
  };
  return <>
    <Panel title="全小程序 IP 汇总" description="按完整 IP 查询；独立会话累计达到 3 次即长期保留。少于 3 次且未豁免的原始 IP 在最后访问 30 天后清除。">
      <form className="policy-form" onSubmit={submitSearch}><label>IP 地址<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="留空显示最近 50 个 IP" /></label><button className="secondary" type="submit" disabled={busy}>查询 IP</button></form>
      {message && <p className="form-help">{message}</p>}
      <div className="table-wrap"><table><thead><tr><th>IP</th><th>访问次数</th><th>首次进入</th><th>最近进入</th><th>最近小程序</th><th>入场强弹</th><th>历史</th></tr></thead><tbody>{ips.map((item) => <tr key={item.ipHash}><td><code>{item.ipAddress ?? '已清除'}</code></td><td>{item.visitCount}</td><td>{date(item.firstSeenAt)}</td><td>{date(item.lastSeenAt)}</td><td>{item.lastMiniAppKey}</td><td>{item.exempt ? 'IP 已豁免' : '正常展示'}</td><td>{item.ipAddress ? <button className="secondary" type="button" disabled={busy} onClick={() => void showVisits(item.ipAddress!)}>查看历史</button> : '-'}</td></tr>)}</tbody></table>{!ips.length && <p className="empty-copy table-empty">暂无匹配 IP</p>}</div>
      {selected && <><p className="form-help">{selected} 的跨小程序访问历史</p><div className="table-wrap"><table><thead><tr><th>小程序</th><th>用户 ID</th><th>进入时间</th></tr></thead><tbody>{visits.map((visit, index) => <tr key={visit.miniAppKey + ':' + visit.userId + ':' + visit.createdAt + ':' + index}><td>{visit.miniAppKey}</td><td><code>{visit.userId}</code></td><td>{date(visit.createdAt)}</td></tr>)}</tbody></table></div>{more && <button className="secondary" type="button" disabled={busy} onClick={() => void showVisits(selected, visits.length)}>加载更多</button>}</>}
    </Panel>
    <Panel title="入场强弹 IP 豁免" description="仅跳过入场强弹，所有小程序统一生效；剧集解锁广告保持原有规则。豁免 IP 持久保存。">
      <form className="policy-form" onSubmit={save}><label>IP 地址<input value={ipInput} onChange={(event) => setIpInput(event.target.value)} placeholder="IPv4 或 IPv6" required /></label><label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：用途或负责人" /></label><button className="primary" type="submit" disabled={!canEdit || busy}>添加或更新豁免</button></form>
      <div className="table-wrap"><table><thead><tr><th>豁免 IP</th><th>备注</th><th>更新时间</th><th>操作人</th><th>操作</th></tr></thead><tbody>{exemptions.map((item) => <tr key={item.ipAddress}><td><code>{item.ipAddress}</code></td><td>{item.note ?? '-'}</td><td>{date(item.updatedAt)}</td><td>{item.updatedBy}</td><td><button className="secondary" type="button" disabled={!canEdit || busy} onClick={() => void remove(item.ipAddress)}>移除豁免</button></td></tr>)}</tbody></table>{!exemptions.length && <p className="empty-copy table-empty">暂无 IP 豁免</p>}</div>
    </Panel>
  </>;
}
