import { Check, Clipboard, Link2, QrCode, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { decodeEntryQr } from './entry-qr';

type AdminApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type EntryEnvironment = 'PREVIEW' | 'PRODUCTION';
type EntryLink = { miniAppKey: string; environment: EntryEnvironment; baseUrl: string; source: string; registeredAt: string; updatedAt: string };
type ObservedBuild = { releaseId: string; webviewBase?: string; lastSeenAt: string };
type LinkData = { links: EntryLink[]; observedBuilds: ObservedBuild[] };

const environments: Array<{ id: EntryEnvironment; label: string }> = [
  { id: 'PREVIEW', label: '预览入口' },
  { id: 'PRODUCTION', label: '正式入口' }
];

export function MiniEntryLinks({ api, miniAppKey, miniAppName, canEdit }: { api: AdminApi; miniAppKey: string; miniAppName: string; canEdit: boolean }) {
  const [data, setData] = useState<LinkData>({ links: [], observedBuilds: [] });
  const [drafts, setDrafts] = useState<Record<EntryEnvironment, string>>({ PREVIEW: '', PRODUCTION: '' });
  const [sources, setSources] = useState<Record<EntryEnvironment, 'PORTAL_LINK' | 'PORTAL_QR'>>({ PREVIEW: 'PORTAL_LINK', PRODUCTION: 'PORTAL_LINK' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EntryEnvironment | null>(null);
  const [decoding, setDecoding] = useState<EntryEnvironment | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await api<LinkData>('/admin/mini-entry-links');
      setData(result);
      setDrafts((current) => ({
        PREVIEW: result.links.find((link) => link.environment === 'PREVIEW')?.baseUrl ?? current.PREVIEW,
        PRODUCTION: result.links.find((link) => link.environment === 'PRODUCTION')?.baseUrl ?? current.PRODUCTION
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '入口信息加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [miniAppKey]);

  async function importQr(environment: EntryEnvironment, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setDecoding(environment);
    setError('');
    setMessage('');
    try {
      const url = await decodeEntryQr(file);
      setDrafts((current) => ({ ...current, [environment]: url }));
      setSources((current) => ({ ...current, [environment]: 'PORTAL_QR' }));
      setError('');
      setMessage(`${environments.find((item) => item.id === environment)?.label}二维码已识别；保存后绑定到 ${miniAppName}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '二维码无法识别，请使用清晰的 TikTok 平台二维码。');
    } finally {
      setDecoding(null);
    }
  }

  async function save(environment: EntryEnvironment) {
    setSaving(environment);
    setError('');
    setMessage('');
    try {
      await api<EntryLink>(`/admin/mini-entry-links/${environment}`, {
        method: 'PUT', body: JSON.stringify({ baseUrl: drafts[environment], source: sources[environment] })
      });
      await refresh();
      setMessage(`${environments.find((item) => item.id === environment)?.label}已登记。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '入口保存失败');
    } finally {
      setSaving(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('入口基址已复制。');
    } catch {
      setError('复制失败，请从输入框中复制链接。');
    }
  }

  return <div className="entry-links-page">
    <section className="panel">
      <div className="panel-heading"><div><h2>TikTok 入口基址</h2><p>当前小程序：{miniAppName} · {miniAppKey}。预览和正式入口分别登记。</p></div><button className="secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />刷新</button></div>
      {loading && <p className="empty-copy">正在读取入口记录...</p>}
      {environments.map(({ id, label }) => {
        const existing = data.links.find((link) => link.environment === id);
        return <div className="entry-link-row" key={id}>
          <div className="entry-link-meta"><strong>{label}</strong><small>{existing ? `最近登记 ${new Date(existing.registeredAt).toLocaleString('zh-CN')} · ${existing.source === 'PORTAL_QR' ? '二维码导入' : '链接录入'}` : '尚未登记平台入口'}</small></div>
          <label className="entry-link-input">入口链接
            <input type="url" value={drafts[id]} onChange={(event) => { setDrafts((current) => ({ ...current, [id]: event.target.value })); setSources((current) => ({ ...current, [id]: 'PORTAL_LINK' })); }} placeholder="https://www.tiktok.com/minis/短码" disabled={!canEdit} />
          </label>
          <div className="entry-link-actions">
            <label className={`secondary qr-import${canEdit && decoding === null ? '' : ' disabled'}`}><QrCode size={16} />{decoding === id ? '识别中' : '导入二维码'}<input type="file" accept="image/*" onChange={(event) => void importQr(id, event)} disabled={!canEdit || decoding !== null} /></label>
            {existing && <button className="secondary" type="button" title="复制入口基址" aria-label={`复制${label}`} onClick={() => void copy(existing.baseUrl)}><Clipboard size={16} /></button>}
            {canEdit && <button className="primary" type="button" onClick={() => void save(id)} disabled={!drafts[id].trim() || saving === id}><Save size={16} />{saving === id ? '保存中' : '登记入口'}</button>}
          </div>
        </div>;
      })}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status"><Check size={15} />{message}</p>}
      <p className="form-help entry-link-note">二维码图片仅在本机浏览器解析，不会上传。平台入口短链由 TikTok 提供；这里记录预览或正式入口及其最近登记时间，不代表平台对链接有效期的承诺。</p>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>运行时识别记录</h2><p>新包上报的构建标识和 WebView 地址，帮助核对实际运行包。</p></div><Link2 size={18} /></div>
      {data.observedBuilds.length ? <div className="table-wrap"><table><thead><tr><th>客户端构建号</th><th>实际 WebView 基址</th><th>最近启动</th></tr></thead><tbody>{data.observedBuilds.map((build) => <tr key={build.releaseId}><td>{build.releaseId}</td><td className="entry-link-url">{build.webviewBase ?? '当前运行版本未上报'}</td><td>{new Date(build.lastSeenAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div> : <p className="empty-copy">尚无启动记录。新包运行并连接 API 后会在此显示；旧包不会自动带有构建号。</p>}
    </section>
  </div>;
}
