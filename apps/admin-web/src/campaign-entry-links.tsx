import { Check, ChevronDown, Clipboard, ExternalLink, Link2, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type AdminApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type Album = { id: string; title: string; tiktokAlbumId: string | null };
type Episode = { id: string; episodeNo: number; title: string; tiktokEpisodeId: string | null };

export function CampaignEntryLinks({ api, miniAppKey, miniAppName }: { api: AdminApi; miniAppKey: string; miniAppName: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [albumId, setAlbumId] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [minisPath, setMinisPath] = useState('');
  const [credentialsConfigured, setCredentialsConfigured] = useState<boolean | null>(null);
  const albumRequest = useRef(0);

  useEffect(() => {
    let active = true;
    setAlbumId('');
    setEpisodeId('');
    setGeneratedUrl('');
    setMinisPath('');
    setEpisodes([]);
    const request = ++albumRequest.current;
    setError('');
    setLoading(true);
    void api<{ items: Album[]; credentialsConfigured: boolean }>('/admin/campaign-entry/albums?q=')
      .then((result) => { if (active && request === albumRequest.current) { setAlbums(result.items); setCredentialsConfigured(result.credentialsConfigured); } })
      .catch((cause) => { if (active && request === albumRequest.current) setError(cause instanceof Error ? cause.message : '剧集加载失败'); })
      .finally(() => { if (active && request === albumRequest.current) setLoading(false); });
    return () => { active = false; albumRequest.current++; };
  }, [api, miniAppKey]);

  useEffect(() => {
    let active = true;
    setEpisodes([]);
    setEpisodeId('');
    setLoadingEpisodes(false);
    if (!albumId) return () => { active = false; };
    setLoadingEpisodes(true);
    void api<{ items: Episode[] }>(`/admin/campaign-entry/episodes?albumId=${encodeURIComponent(albumId)}`)
      .then((result) => { if (active) setEpisodes(result.items); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '免费集数加载失败'); })
      .finally(() => { if (active) setLoadingEpisodes(false); });
    return () => { active = false; };
  }, [api, albumId, miniAppKey]);

  const album = albums.find((item) => item.id === albumId);
  const episode = episodes.find((item) => item.id === episodeId);
  const params = album?.tiktokAlbumId && episode?.tiktokEpisodeId
    ? new URLSearchParams({ album_id: album.tiktokAlbumId, episode_id: episode.tiktokEpisodeId }).toString() : '';
  async function searchAlbums() {
    const request = ++albumRequest.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ items: Album[]; credentialsConfigured: boolean }>(`/admin/campaign-entry/albums?q=${encodeURIComponent(search.trim())}`);
      if (request !== albumRequest.current) return;
      setAlbums(result.items);
      setCredentialsConfigured(result.credentialsConfigured);
      setAlbumId('');
      setEpisodeId('');
      setGeneratedUrl('');
      setMinisPath('');
      setMessage('');
    } catch (cause) {
      if (request === albumRequest.current) setError(cause instanceof Error ? cause.message : '剧集搜索失败');
    } finally {
      if (request === albumRequest.current) setLoading(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label}已复制`);
      setError('');
    } catch {
      setError('复制失败，请从下方文本框手动复制。');
    }
  }

  async function generateLink() {
    if (!episodeId) return;
    setGenerating(true);
    setError('');
    setMessage('');
    setGeneratedUrl('');
    try {
      const result = await api<{ url: string; minisPath: string }>('/admin/campaign-entry/generate-link', {
        method: 'POST', body: JSON.stringify({ episodeId })
      });
      setGeneratedUrl(result.url);
      setMinisPath(result.minisPath);
      setMessage('TikTok Minis 完整链接已生成。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'TikTok 链接生成失败');
    } finally {
      setGenerating(false);
    }
  }

  return <section className="panel campaign-entry-panel">
    <div className="panel-heading"><div><h2>投放剧集链接</h2><p>为当前小程序 {miniAppName} 配置直达剧集的投放链接。</p></div><span className={`campaign-credential-state ${credentialsConfigured ? 'ready' : credentialsConfigured === false ? 'missing' : ''}`}>{credentialsConfigured === null ? '正在检查服务端凭据' : credentialsConfigured ? 'TikTok 凭据已配置' : 'TikTok 凭据未配置'}</span></div>
    <p className="form-help">Client Key 与 Client Secret 由服务端安全读取，不会返回到浏览器。仅支持已上线、当前小程序有权访问且免费的分集。</p>
    <div className="campaign-link-form">
      <div className="campaign-search-row"><label>搜索剧集<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchAlbums(); }} placeholder="输入剧集名称" /></label>
        <button className="secondary" type="button" onClick={() => void searchAlbums()} disabled={loading}><Search size={16} />{loading ? '搜索中' : '搜索'}</button></div>
      <div className="campaign-select-row">
        <label>剧集<span className="campaign-select"><select value={albumId} onChange={(event) => { setError(''); setGeneratedUrl(''); setAlbumId(event.target.value); }} disabled={loading}><option value="">{loading ? '正在加载剧集' : albums.length ? '选择已上线剧集' : '暂无可选剧集'}</option>{albums.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={16} /></span></label>
        <label>免费分集<span className="campaign-select"><select value={episodeId} onChange={(event) => { setEpisodeId(event.target.value); setGeneratedUrl(''); setMessage(''); }} disabled={!albumId || loadingEpisodes}><option value="">{loadingEpisodes ? '正在加载免费分集' : albumId && !episodes.length ? '暂无可用免费分集' : '选择免费分集'}</option>{episodes.map((item) => <option key={item.id} value={item.id}>Episode {item.episodeNo} · {item.title}</option>)}</select><ChevronDown size={16} /></span></label>
      </div>
      <button className="primary" type="button" onClick={() => void generateLink()} disabled={!episodeId || generating || credentialsConfigured !== true}>
        {generating ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{generating ? '生成中' : '生成 TikTok 完整链接'}
      </button>
    </div>
    {params && <div className="campaign-output"><label>参数片段<input readOnly value={params} onFocus={(event) => event.target.select()} /></label><button className="secondary" type="button" onClick={() => void copy(params, '参数片段')}><Clipboard size={16} />复制参数</button></div>}
    {minisPath && <div className="campaign-output"><label>Minis Path<input readOnly value={minisPath} onFocus={(event) => event.target.select()} /></label><button className="secondary" type="button" onClick={() => void copy(minisPath, 'Minis Path')}><Clipboard size={16} />复制路径</button></div>}
    {generatedUrl && <div className="campaign-output"><label>完整链接<input readOnly value={generatedUrl} onFocus={(event) => event.target.select()} /></label><button className="secondary" type="button" onClick={() => void copy(generatedUrl, '完整链接')}><Clipboard size={16} />复制完整链接</button><a className="secondary" href={generatedUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开</a></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status"><Check size={15} />{message}</p>}
  </section>;
}
