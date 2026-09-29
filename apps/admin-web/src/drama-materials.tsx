import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, RefreshCw, Save } from 'lucide-react';
import './drama-materials.css';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Cover = { id: string; publicUrl: string };
type Media = { vid: string; title: string };
type Episode = { id: string; episodeNo: number; title: string; isFree?: boolean; byteplusVid?: string | null; byteplusCoverUrl?: string | null; coverUrl?: string | null; coverAssetId?: string | null };
type Translation = { locale: string; title: string; description?: string; coverUrl?: string | null };
type Drama = { id: string; title: string; description?: string; language?: string; coverUrl?: string; coverAssetId?: string | null; reviewStatus?: string | null; episodes: Episode[]; translations?: Translation[] };
type AlbumOption = { id: string; title: string; sharedPlayback?: boolean; reviewStatus?: string | null };

function useCoverPreview(file: File | null, savedUrl?: string | null) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!file) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview ?? savedUrl;
}

async function uploadCover(api: Api, file: File) {
  const form = new FormData();
  form.append('file', file);
  return api<Cover>('/admin/cover-assets', { method: 'POST', body: form });
}

function EpisodeMaterials({ episode, media, api, onSaved, locked, albumCoverUrl }: { episode: Episode; media: Media[]; api: Api; onSaved: () => Promise<void>; locked: boolean; albumCoverUrl?: string }) {
  const [saved, setSaved] = useState(episode);
  const [title, setTitle] = useState(episode.title);
  const [vid, setVid] = useState(episode.byteplusVid ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverPreview = useCoverPreview(coverFile, saved.coverUrl);
  const [clearCover, setClearCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const changedVid = vid.trim() !== (saved.byteplusVid ?? '');
  const dirty = changedVid || title.trim() !== saved.title || Boolean(coverFile) || clearCover;

  function selectVid(value: string) {
    setVid(value);
    if (value.trim() !== saved.byteplusVid) setClearCover(true);
    setMessage('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    let next = saved;
    try {
      const cover = coverFile ? await uploadCover(api, coverFile) : null;
      if (title.trim() !== saved.title) {
        next = { ...next, ...await api<Episode>(`/admin/episodes/${episode.id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim(), isFree: saved.isFree }) }) };
        setSaved(next);
      }
      const coverAssetId = cover?.id ?? (clearCover ? null : undefined);
      if (changedVid) {
        next = { ...next, ...await api<Episode>(`/admin/episodes/${episode.id}/bind-byteplus`, { method: 'POST', body: JSON.stringify({ byteplusVid: vid.trim(), coverAssetId }) }) };
        setSaved(next);
      }
      if (coverAssetId !== undefined) {
        const defaultCover = next.byteplusCoverUrl && URL.canParse(next.byteplusCoverUrl) ? next.byteplusCoverUrl : albumCoverUrl;
        next = { ...next, ...await api<Episode>(`/admin/episodes/${episode.id}`, { method: 'PATCH', body: JSON.stringify({ coverAssetId, coverUrl: cover?.publicUrl ?? (clearCover ? defaultCover : undefined), isFree: next.isFree }) }) };
      }
      setSaved(next);
      setCoverFile(null);
      if (coverInput.current) coverInput.current.value = '';
      setClearCover(false);
      setMessage(changedVid ? '视频已替换，TikTok 登记已入队。' : '已保存。');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally { setBusy(false); }
  }

  return <form className="material-episode" onSubmit={save}>
    <div className="material-episode-heading"><strong>第 {episode.episodeNo} 集</strong>{coverPreview && <img className="episode-cover-preview" src={coverPreview} alt={`第 ${episode.episodeNo} 集封面`} />}</div>
    <fieldset disabled={busy || locked}>
      <label>分集标题<input value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label>BytePlus VID<input value={vid} required maxLength={256} onChange={(event) => selectVid(event.target.value)} /><small>当前：{saved.byteplusVid ?? '未绑定'}</small></label>
      <label>VOD 媒资<select value={media.some((item) => item.vid === vid) ? vid : ''} onChange={(event) => { if (event.target.value) selectVid(event.target.value); }}><option value="">选择媒资</option>{media.map((item) => <option key={item.vid} value={item.vid}>{item.title} · {item.vid}</option>)}</select></label>
      <label>分集封面<input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setCoverFile(event.target.files?.[0] ?? null); }} />{coverFile && <small>{coverFile.name}</small>}</label>
      <label className="material-check"><input type="checkbox" checked={clearCover} onChange={(event) => setClearCover(event.target.checked)} />清除原独立封面</label>
      <button className="secondary" type="submit" disabled={!dirty}><Save size={15} />{busy ? '保存中...' : '保存此集'}</button>
    </fieldset>
    {message && <p className="material-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function DramaMaterialEditor({ drama, api, media, onSaved }: { drama: Drama; api: Api; media: Media[]; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(drama.title);
  const [description, setDescription] = useState(drama.description ?? '');
  const [cover, setCover] = useState(drama.coverUrl);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverPreview = useCoverPreview(coverFile, cover);
  const [translations, setTranslations] = useState(drama.translations ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const locked = ['REVIEWING', '1'].includes(drama.reviewStatus ?? '');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const uploaded = coverFile ? await uploadCover(api, coverFile) : null;
      const result = await api<Drama>(`/admin/albums/${drama.id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim(), description: description.trim(), language: drama.language, ...(uploaded ? { coverAssetId: uploaded.id } : {}) }) });
      setCover(result.coverUrl);
      setCoverFile(null);
      if (coverInput.current) coverInput.current.value = '';
      // Localized images override the primary cover in the mini app.
      const nextTranslations = uploaded ? translations.map((item) => ({ ...item, coverUrl: null })) : translations;
      setTranslations(nextTranslations);
      for (const translation of nextTranslations) {
        await api('/admin/translations', { method: 'POST', body: JSON.stringify({ kind: 'album', contentId: drama.id, ...translation, title: translation.title.trim() }) });
      }
      setMessage('剧目已保存，待同步新版本。');
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  return <>
    {locked && <p className="material-message" role="status">当前版本审核中，暂不可编辑素材。</p>}
    <form className="material-album" onSubmit={save}>
      <fieldset disabled={busy || locked}>
        <div className="material-meta">
          <label>剧名<input required value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>剧情简介<textarea rows={4} maxLength={20_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        <div className="material-cover">{coverPreview && <img src={coverPreview} alt="剧目封面" />}<label><span><ImagePlus size={16} />剧目封面</span><input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)} />{coverFile && <small>{coverFile.name}</small>}</label></div>
        {translations.length > 0 && <details className="material-translations"><summary>多语言标题与简介 · {translations.length}</summary>{translations.map((item, index) => <div key={item.locale} className="material-translation"><strong>{item.locale}</strong><label>标题<input required maxLength={160} value={item.title} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} /></label><label>简介<textarea rows={2} maxLength={20_000} value={item.description ?? ''} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, description: event.target.value } : value))} /></label><label>独立封面地址<input type="url" value={item.coverUrl ?? ''} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, coverUrl: event.target.value || null } : value))} /></label></div>)}</details>}
        <button className="primary" type="submit"><Save size={15} />{busy ? '保存中...' : '保存剧目信息'}</button>
      </fieldset>
      {message && <p className="material-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </form>
    <div className="material-episodes">{drama.episodes.map((episode) => <EpisodeMaterials key={episode.id} episode={episode} media={media} api={api} onSaved={onSaved} locked={locked || busy} albumCoverUrl={cover} />)}</div>
  </>;
}

export function DramaMaterials({ albums, api, onSaved }: { albums: AlbumOption[]; api: Api; onSaved: () => Promise<void> }) {
  const [albumId, setAlbumId] = useState('');
  const [drama, setDrama] = useState<Drama | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDrama(null);
    setError('');
    if (!albumId) return;
    setLoading(true);
    api<Drama>(`/admin/albums/${albumId}`).then((result) => { if (!cancelled) setDrama(result); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [albumId, retry, api]);
  async function loadMedia() {
    setLoadingMedia(true);
    setError('');
    try {
      const items: Media[] = [];
      for (let offset = 0; ; offset += 100) {
        const result = await api<{ items: Media[]; total?: number }>(`/admin/byteplus/media?offset=${offset}&pageSize=100`);
        items.push(...result.items);
        if (result.items.length < 100 || (result.total !== undefined && items.length >= result.total)) break;
      }
      setMedia(items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取媒资失败'); }
    finally { setLoadingMedia(false); }
  }
  return <section className="drama-materials" aria-labelledby="material-heading">
    <header><h2 id="material-heading">剧目素材</h2><button type="button" className="secondary" disabled={loadingMedia} onClick={() => void loadMedia()}><RefreshCw size={15} />{loadingMedia ? '读取中...' : '刷新 VOD 媒资'}</button></header>
    <label className="material-picker">剧目<select value={albumId} onChange={(event) => { if (!drama || window.confirm('切换剧目将关闭当前编辑，未保存的修改会丢失。继续吗？')) setAlbumId(event.target.value); }}><option value="">请选择剧目</option>{albums.filter((item) => !item.sharedPlayback).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {loading && <p role="status">正在加载剧目...</p>}
    {error && <div role="alert" className="material-message"><p className="form-error">{error}</p><button className="secondary" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />重新加载</button></div>}
    {drama && <DramaMaterialEditor key={`${drama.id}:${retry}`} drama={{ ...drama, reviewStatus: albums.find((item) => item.id === drama.id)?.reviewStatus ?? drama.reviewStatus }} api={api} media={media} onSaved={onSaved} />}
  </section>;
}
