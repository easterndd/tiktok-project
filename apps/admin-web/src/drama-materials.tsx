import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, RefreshCw, Save } from 'lucide-react';
import './drama-materials.css';
import type { EditableAlbumMetadata } from './album-metadata-dialog';
import type { UploadProgress } from './upload-request';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Cover = { id: string; publicUrl: string };
type Media = { vid: string; title: string };
type Episode = { id: string; episodeNo: number; title: string; isFree?: boolean; status?: string; byteplusVid?: string | null; byteplusUploadStatus?: string; byteplusCoverUrl?: string | null; coverUrl?: string | null; coverAssetId?: string | null };
type Translation = { locale: string; title: string; description?: string; coverUrl?: string | null };
type Drama = { id: string; title: string; description?: string; language?: string; coverUrl?: string; coverAssetId?: string | null; reviewStatus?: string | null; episodes: Episode[]; translations?: Translation[]; metadata?: EditableAlbumMetadata };
type AlbumOption = { id: string; title: string; sharedPlayback?: boolean; reviewStatus?: string | null };
type UploadJob = { id: string; episodeId: string; sourceName?: string | null; status: string; providerJobId?: string | null; localFilePath?: string | null; errorMessage?: string | null; nextAttemptAt?: string | null; leaseExpiresAt?: string | null };
type UploadVideo = (episodeId: string, file: File, onProgress: (progress: UploadProgress) => void) => Promise<{ job: UploadJob }>;

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

function EpisodeMaterials({ episode, media, job: latestJob, api, uploadVideoFile, onJobChanged, onSaved, locked, albumCoverUrl }: { episode: Episode; media: Media[]; job?: UploadJob; api: Api; uploadVideoFile: UploadVideo; onJobChanged: (job: UploadJob) => void; onSaved: () => Promise<void>; locked: boolean; albumCoverUrl?: string }) {
  const [saved, setSaved] = useState(episode);
  const [title, setTitle] = useState(episode.title);
  const [vid, setVid] = useState(episode.byteplusVid ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverPreview = useCoverPreview(coverFile, saved.coverUrl);
  const [clearCover, setClearCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const job = latestJob?.status === 'SUCCEEDED' && latestJob.providerJobId !== saved.byteplusVid ? undefined : latestJob;
  const changedVid = vid.trim() !== (saved.byteplusVid ?? '');
  const dirty = changedVid || title.trim() !== saved.title || Boolean(coverFile) || clearCover;

  useEffect(() => {
    if (episode.byteplusVid && episode.byteplusVid !== saved.byteplusVid) {
      setSaved(episode);
      setVid(episode.byteplusVid);
    }
  }, [episode, saved.byteplusVid]);
  const activeJob = job && ['PENDING', 'PROCESSING'].includes(job.status);
  const waitingRetry = job?.status === 'PROCESSING' && job.nextAttemptAt && new Date(job.nextAttemptAt).getTime() > Date.now() && (!job.leaseExpiresAt || new Date(job.leaseExpiresAt).getTime() <= Date.now());
  const jobLabel = job?.status === 'PENDING' ? '服务器已收文件，等待传至 BytePlus'
    : job?.status === 'PROCESSING' && job.providerJobId ? 'BytePlus 已返回 VID，正在确认归属'
    : waitingRetry ? '上传遇到问题，等待后台自动重试'
    : job?.status === 'PROCESSING' ? '正在上传至 BytePlus'
    : job?.status === 'SUCCEEDED' ? 'BytePlus VID 已取得并绑定'
    : job?.status === 'FAILED' ? '上传失败' : '';

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

  async function resetVideo() {
    if (!window.confirm(`解除第 ${episode.episodeNo} 集的视频绑定，以便在当前小程序重新上传？原 BytePlus 视频将保留。`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await api<Episode>(`/admin/episodes/${episode.id}/reset-byteplus`, { method: 'POST', body: JSON.stringify({ confirmation: 'RESET_VIDEO_BINDING' }) });
      setSaved(next); setVid('');
      setMessage('已解除绑定，请选择当前小程序的视频文件上传。');
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '解除绑定失败'); }
    finally { setBusy(false); }
  }

  async function uploadVideo(file: File) {
    setBusy(true); setError(''); setMessage(''); setUploadProgress({ phase: 'sending', percent: 0 });
    try {
      const result = await uploadVideoFile(episode.id, file, setUploadProgress);
      onJobChanged(result.job);
      setMessage('视频已入队，将自动传至 BytePlus 并获取 VID。');
      void onSaved().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交视频失败');
    } finally { setUploadProgress(null); setBusy(false); }
  }

  async function retryUpload() {
    if (!job) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<UploadJob>(`/admin/upload-jobs/${job.id}/retry`, { method: 'POST' });
      onJobChanged(result);
      setMessage('已重新加入 BytePlus 上传队列。');
      void onSaved().catch(() => undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重新排队失败'); }
    finally { setBusy(false); }
  }

  return <form className="material-episode" onSubmit={save}>
    <div className="material-episode-heading"><strong>第 {episode.episodeNo} 集</strong>{coverPreview && <img className="episode-cover-preview" src={coverPreview} alt={`第 ${episode.episodeNo} 集封面`} />}</div>
    <fieldset disabled={busy || locked || Boolean(activeJob)}>
      <label>分集标题<input value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label>BytePlus VID<input value={vid} required maxLength={256} onChange={(event) => selectVid(event.target.value)} /><small>当前：{saved.byteplusVid ?? '未绑定'}</small></label>
      <label>VOD 媒资<select value={media.some((item) => item.vid === vid) ? vid : ''} onChange={(event) => { if (event.target.value) selectVid(event.target.value); }}><option value="">选择媒资</option>{media.map((item) => <option key={item.vid} value={item.vid}>{item.title} · {item.vid}</option>)}</select></label>
      <label>分集封面<input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setCoverFile(event.target.files?.[0] ?? null); }} />{coverFile && <small>{coverFile.name}</small>}</label>
      <label className="material-check"><input type="checkbox" checked={clearCover} onChange={(event) => setClearCover(event.target.checked)} />清除原独立封面</label>
      <button className="secondary" type="submit" disabled={!dirty}><Save size={15} />{busy ? '保存中...' : '保存此集'}</button>
      {saved.byteplusVid ? <button className="secondary" type="button" onClick={() => void resetVideo()}><RefreshCw size={15} />解除绑定并重传</button> : <label>上传视频<input type="file" accept="video/mp4,video/quicktime,.m4v" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadVideo(file); }} /></label>}
    </fieldset>
    {(uploadProgress || job) && <div className="material-upload-task" role="status">
      <strong>上传任务{job?.sourceName ? ` · ${job.sourceName}` : ''}</strong>
      {uploadProgress ? <>
        <div className={`upload-meter ${uploadProgress.phase}`} role="progressbar" aria-label={`第 ${episode.episodeNo} 集上传进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress.phase === 'sending' ? uploadProgress.percent : undefined}>
          <span style={uploadProgress.phase === 'sending' ? { width: `${uploadProgress.percent}%` } : undefined} />
        </div>
        <small>{uploadProgress.phase === 'sending' ? `传至服务器 ${uploadProgress.percent}%` : '服务器正在接收文件'}</small>
      </> : <>
        <div className={`upload-meter ${activeJob ? 'processing' : job?.status === 'SUCCEEDED' ? 'server-stored' : ''}`} role={activeJob ? 'progressbar' : undefined} aria-label={`第 ${episode.episodeNo} 集 BytePlus 上传状态`}><span style={job?.status === 'SUCCEEDED' ? { width: '100%' } : undefined} /></div>
        <small>{jobLabel}{job?.status === 'SUCCEEDED' && job.providerJobId ? `：${job.providerJobId}` : ''}</small>
        {job?.errorMessage && job.status !== 'SUCCEEDED' && <small className="material-upload-error">{job.errorMessage}</small>}
        {job?.status === 'FAILED' && job.localFilePath && !saved.byteplusVid && <button className="secondary" type="button" disabled={busy || locked} onClick={() => void retryUpload()}><RefreshCw size={14} />重新排队</button>}
      </>}
    </div>}
    {message && <p className="material-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function DramaMaterialEditor({ drama, api, media, jobs, uploadVideoFile, onJobChanged, onSaved }: { drama: Drama; api: Api; media: Media[]; jobs: UploadJob[]; uploadVideoFile: UploadVideo; onJobChanged: (job: UploadJob) => void; onSaved: () => Promise<void> }) {
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
  const [scope, setScope] = useState(drama.metadata);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirmation = scope?.canEdit !== false && scope?.shared && scope.version === 0 && scope.targets?.some((target) => target.differs);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    let textSaved = false;
    try {
      if (needsConfirmation && !confirmed) throw new Error('请先确认统一资料的同步范围。');
      const metadata = scope?.canEdit === false ? scope : await api<EditableAlbumMetadata>(`/admin/albums/${drama.id}/display-metadata`, { method: 'PATCH', body: JSON.stringify({
        title: title.trim(), description: description.trim(), expectedVersion: scope?.version ?? 0,
        translations: translations.map((item) => ({ locale: item.locale, title: item.title.trim(), description: (item.description ?? '').trim() }))
      }) });
      textSaved = scope?.canEdit !== false;
      setScope(metadata);
      setTitle(metadata.title);
      setDescription(metadata.description ?? '');
      const uploaded = coverFile ? await uploadCover(api, coverFile) : null;
      const result = await api<Drama>(`/admin/albums/${drama.id}`, { method: 'PATCH', body: JSON.stringify({ language: drama.language, ...(uploaded ? { coverAssetId: uploaded.id } : {}) }) });
      setCover(result.coverUrl);
      setCoverFile(null);
      if (coverInput.current) coverInput.current.value = '';
      // Localized images override the primary cover in the mini app.
      const nextTranslations = (metadata.translations ?? []).map((item) => ({ ...item,
        coverUrl: uploaded ? null : translations.find((draft) => draft.locale === item.locale)?.coverUrl }));
      setTranslations(nextTranslations);
      for (const translation of nextTranslations) {
        await api('/admin/translations', { method: 'POST', body: JSON.stringify({ kind: 'album', contentId: drama.id, ...translation, title: translation.title.trim(), coverOnly: true }) });
      }
      setMessage(metadata.canEdit === false ? '当前应用的封面已保存。统一文案由主小程序 OWNER 管理。' : metadata.shared ? `统一文案已保存，正在同步到 ${metadata.targets?.length ?? 0} 个小程序。封面保存在当前应用；TikTok 平台素材需发布新版本。` : '剧目展示资料已保存。TikTok 平台素材需发布新版本。');
      await onSaved();
    } catch (cause) { setError(`${textSaved ? '文案已保存，后续素材保存失败：' : ''}${cause instanceof Error ? cause.message : '保存失败'}`); }
    finally { setBusy(false); }
  }
  return <>
    {locked && <p className="material-message" role="status">当前版本审核中，暂不可编辑素材。</p>}
    {scope?.canEdit === false && <p className="material-message" role="status">统一文案由主小程序 OWNER 管理，当前可编辑本应用封面。</p>}
    {scope?.shared && <div className="material-message"><p>剧名、简介及多语言文案将同步到：{scope.targets?.map((target) => `${target.miniAppKey}${!scope.version && target.differs ? '（存在差异）' : ''}`).join('、')}。可在剧目列表的“编辑剧名与简介”查看同步结果及重试。</p>{needsConfirmation && <label className="material-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />确认统一以上小程序的文案</label>}</div>}
    <form className="material-album" onSubmit={save}>
      <fieldset disabled={busy || locked}>
        <div className="material-meta">
          <label>剧名<input disabled={scope?.canEdit === false} required value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>剧情简介<textarea disabled={scope?.canEdit === false} rows={4} maxLength={20_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        <div className="material-cover">{coverPreview && <img src={coverPreview} alt="剧目封面" />}<label><span><ImagePlus size={16} />剧目封面</span><input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)} />{coverFile && <small>{coverFile.name}</small>}</label></div>
        {translations.length > 0 && <details className="material-translations"><summary>多语言标题与简介 · {translations.length}</summary>{translations.map((item, index) => <div key={item.locale} className="material-translation"><strong>{item.locale}</strong><label>标题<input required disabled={scope?.canEdit === false} maxLength={160} value={item.title} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} /></label><label>简介<textarea rows={2} disabled={scope?.canEdit === false} maxLength={20_000} value={item.description ?? ''} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, description: event.target.value } : value))} /></label><label>独立封面地址<input type="url" value={item.coverUrl ?? ''} onChange={(event) => setTranslations((items) => items.map((value, i) => i === index ? { ...value, coverUrl: event.target.value || null } : value))} /></label></div>)}</details>}
        <button className="primary" type="submit" disabled={Boolean(needsConfirmation && !confirmed)}><Save size={15} />{busy ? '保存中...' : scope?.canEdit === false ? '保存当前应用封面' : scope?.shared ? '保存并同步统一文案' : '保存剧目信息'}</button>
      </fieldset>
      {message && <p className="material-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </form>
    <div className="material-episodes">{drama.episodes.map((episode) => <EpisodeMaterials key={episode.id} episode={episode} media={media}
      job={jobs.find((item) => item.episodeId === episode.id)}
      api={api} uploadVideoFile={uploadVideoFile} onJobChanged={onJobChanged} onSaved={onSaved} locked={locked || busy} albumCoverUrl={cover} />)}</div>
  </>;
}

export function DramaMaterials({ albums, api, uploadVideo, onSaved, selection }: { albums: AlbumOption[]; api: Api; uploadVideo: UploadVideo; onSaved: () => Promise<void>; selection?: { albumId: string; request: number } | null }) {
  const [albumId, setAlbumId] = useState('');
  const [drama, setDrama] = useState<Drama | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);
  const activeUploads = jobs.some((job) => job.status === 'PENDING' || job.status === 'PROCESSING');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!selection || !albums.some((item) => item.id === selection.albumId && !item.sharedPlayback)) return;
    if (drama && !window.confirm('切换剧目将关闭当前编辑，未保存的修改会丢失。继续吗？')) return;
    setAlbumId(selection.albumId);
  }, [selection?.request]);
  useEffect(() => {
    let cancelled = false;
    setDrama(null);
    jobsRef.current = [];
    setJobs([]);
    setError('');
    if (!albumId) return;
    setLoading(true);
    Promise.all([api<Drama>(`/admin/albums/${albumId}`), api<EditableAlbumMetadata>(`/admin/albums/${albumId}/display-metadata`),
      api<{ items: UploadJob[] }>(`/admin/upload-jobs?albumId=${encodeURIComponent(albumId)}`)]).then(([result, metadata, uploads]) => {
      if (!cancelled) setDrama({ ...result, title: metadata.title, description: metadata.description, metadata,
        translations: (metadata.translations ?? []).map((item) => ({ ...item, coverUrl: result.translations?.find((local) => local.locale === item.locale)?.coverUrl })) });
      if (!cancelled) { jobsRef.current = uploads.items; setJobs(uploads.items); }
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [albumId, retry, api]);
  useEffect(() => {
    if (!albumId) { jobsRef.current = []; setJobs([]); return; }
    if (!activeUploads) return;
    let cancelled = false;
    let polling = false;
    const refresh = async () => {
      if (polling || document.visibilityState !== 'visible') return;
      polling = true;
      try {
        const uploads = await api<{ items: UploadJob[] }>(`/admin/upload-jobs?albumId=${encodeURIComponent(albumId)}`);
        if (cancelled) return;
        const previous = jobsRef.current;
        const completed = uploads.items.some((job) => job.status === 'SUCCEEDED' && previous.some((old) => old.id === job.id && old.status !== 'SUCCEEDED'));
        if (completed) {
          const latest = await api<Drama>(`/admin/albums/${albumId}`);
          if (cancelled) return;
          setDrama((current) => current?.id === albumId ? { ...current, episodes: latest.episodes } : current);
        }
        jobsRef.current = uploads.items;
        setJobs(uploads.items);
      } catch { /* Keep the last known task state; the next poll will retry. */ }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => void refresh(), 5_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [albumId, api, activeUploads]);
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
  return <section id="drama-materials" className="drama-materials" aria-labelledby="material-heading">
    <header><h2 id="material-heading">剧目素材</h2><button type="button" className="secondary" disabled={loadingMedia} onClick={() => void loadMedia()}><RefreshCw size={15} />{loadingMedia ? '读取中...' : '刷新 VOD 媒资'}</button></header>
    <label className="material-picker">剧目<select value={albumId} onChange={(event) => { if (!drama || window.confirm('切换剧目将关闭当前编辑，未保存的修改会丢失。继续吗？')) setAlbumId(event.target.value); }}><option value="">请选择剧目</option>{albums.filter((item) => !item.sharedPlayback).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {loading && <p role="status">正在加载剧目...</p>}
    {error && <div role="alert" className="material-message"><p className="form-error">{error}</p><button className="secondary" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />重新加载</button></div>}
    {drama && <DramaMaterialEditor key={`${drama.id}:${retry}`} drama={{ ...drama, reviewStatus: albums.find((item) => item.id === drama.id)?.reviewStatus ?? drama.reviewStatus }}
      api={api} media={media} jobs={jobs} uploadVideoFile={uploadVideo} onJobChanged={(job) => { const next = [job, ...jobsRef.current.filter((item) => item.id !== job.id)]; jobsRef.current = next; setJobs(next); }} onSaved={onSaved} />}
  </section>;
}
