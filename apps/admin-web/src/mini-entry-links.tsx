import { Link2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CampaignEntryLinks } from './campaign-entry-links';

type AdminApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type ObservedBuild = { releaseId: string; webviewBase?: string; lastSeenAt: string };
type LinkData = { observedBuilds: ObservedBuild[] };

export function MiniEntryLinks({ api, miniAppKey, miniAppName }: { api: AdminApi; miniAppKey: string; miniAppName: string }) {
  const [data, setData] = useState<LinkData>({ observedBuilds: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await api<LinkData>('/admin/mini-entry-links');
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '运行版本记录加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [miniAppKey]);

  return <div className="entry-links-page">
    <CampaignEntryLinks api={api} miniAppKey={miniAppKey} miniAppName={miniAppName} />
    <section className="panel">
      <div className="panel-heading"><div><h2>运行版本记录</h2><p>当前小程序：{miniAppName} · {miniAppKey}</p></div><button className="secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />{loading ? '刷新中' : '刷新'}</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data.observedBuilds.length ? <div className="table-wrap"><table><thead><tr><th>客户端构建号</th><th>实际 WebView 基址</th><th>最近启动</th></tr></thead><tbody>{data.observedBuilds.map((build) => <tr key={build.releaseId}><td>{build.releaseId}</td><td className="entry-link-url">{build.webviewBase ?? '当前运行版本未上报'}</td><td>{new Date(build.lastSeenAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div> : <p className="empty-copy">尚无启动记录。新包运行并连接 API 后会在此显示；旧包不会自动带有构建号。</p>}
    </section>
  </div>;
}
