import { Check, ChevronDown, Clipboard, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type AdminApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type Album = { id: string; title: string; tiktokAlbumId: string | null };
type Episode = { id: string; episodeNo: number; title: string; tiktokEpisodeId: string | null };
type EntryLink = { environment: 'PREVIEW' | 'PRODUCTION'; baseUrl: string };

export const campaignEntryApps = new Set(['bloomreel', 'quillshort', 'amberplay', 'nimbusclip', 'runereel']);

export function CampaignEntryLinks({ api, miniAppKey }: { api: AdminApi; miniAppKey: string }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [baseSource, setBaseSource] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [albumId, setAlbumId] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const albumRequest = useRef(0);

  useEffect(() => {
    let active = true;
    setAlbumId('');
    setEpisodeId('');
    setEpisodes([]);
    const request = ++albumRequest.current;
    setError('');
    void Promise.allSettled([
      api<{ links: EntryLink[] }>('/admin/mini-entry-links'),
      api<{ url: string | null }>('/admin/campaign-entry/base')
    ]).then(([registered, legacy]) => {
      if (!active) return;
      const production = registered.status === 'fulfilled' ? registered.value.links.find((link) => link.environment === 'PRODUCTION') : undefined;
      const legacyUrl = legacy.status === 'fulfilled' ? legacy.value.url : null;
      setBaseUrl(production?.baseUrl ?? legacyUrl ?? '');
      setBaseSource(production ? '正式入口登记' : legacyUrl ? '原投放基址' : '');
    });
    setLoading(true);
    void api<{ items: Album[] }>('/admin/campaign-entry/albums?q=')
      .then((result) => { if (active && request === albumRequest.current) setAlbums(result.items); })
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
  let fullUrl = '';
  if (baseUrl && params) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('album_id', album!.tiktokAlbumId!);
      url.searchParams.set('episode_id', episode!.tiktokEpisodeId!);
      fullUrl = url.toString();
    } catch { /* The registered base is validated by the API. */ }
  }

  async function searchAlbums() {
    const request = ++albumRequest.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ items: Album[] }>(`/admin/campaign-entry/albums?q=${encodeURIComponent(search.trim())}`);
      if (request !== albumRequest.current) return;
      setAlbums(result.items);
      setAlbumId('');
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

  return <section className="panel campaign-entry-panel">
    <div className="panel-heading"><div><h2>投放剧集链接</h2><p>仅列出该小程序可访问且已上线的免费分集。</p></div></div>
    <p className="form-help">使用基址：{baseUrl || '尚未登记正式入口'}{baseSource && ` · ${baseSource}`}</p>
    <div className="campaign-link-form">
      <div className="campaign-search-row"><label>搜索剧集<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchAlbums(); }} placeholder="输入剧集名称" /></label>
        <button className="secondary" type="button" onClick={() => void searchAlbums()} disabled={loading}><Search size={16} />{loading ? '搜索中' : '搜索'}</button></div>
      <div className="campaign-select-row">
        <label>剧集<span className="campaign-select"><select value={albumId} onChange={(event) => { setError(''); setAlbumId(event.target.value); }} disabled={loading}><option value="">{loading ? '正在加载剧集' : albums.length ? '选择已上线剧集' : '暂无可选剧集'}</option>{albums.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={16} /></span></label>
        <label>免费分集<span className="campaign-select"><select value={episodeId} onChange={(event) => setEpisodeId(event.target.value)} disabled={!albumId || loadingEpisodes}><option value="">{loadingEpisodes ? '正在加载免费分集' : albumId && !episodes.length ? '暂无可用免费分集' : '选择免费分集'}</option>{episodes.map((item) => <option key={item.id} value={item.id}>Episode {item.episodeNo} · {item.title}</option>)}</select><ChevronDown size={16} /></span></label>
      </div>
    </div>
    {params && <div className="campaign-output"><label>参数片段<input readOnly value={params} onFocus={(event) => event.target.select()} /></label><button className="secondary" type="button" onClick={() => void copy(params, '参数片段')}><Clipboard size={16} />复制参数</button></div>}
    {fullUrl && <div className="campaign-output"><label>完整链接<input readOnly value={fullUrl} onFocus={(event) => event.target.select()} /></label><button className="secondary" type="button" onClick={() => void copy(fullUrl, '完整链接')}><Clipboard size={16} />复制完整链接</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status"><Check size={15} />{message}</p>}
  </section>;
}
