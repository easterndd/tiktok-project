import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, RefreshCw, Save } from 'lucide-react';
import './drama-materials.css';
import type { EditableAlbumMetadata } from './album-metadata-dialog';
import type { UploadProgress } from './upload-request';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Cover = { id: string; publicUrl: string };
type Media = { vid: string; title: string };
type Episode = { id: string; episodeNo: number; title: string; isFree?: boolean; status?: string; tiktokEpisodeId?: string | null; byteplusVid?: string | null; byteplusUploadStatus?: string; byteplusCoverUrl?: string | null; coverUrl?: string | null; coverAssetId?: string | null };
type Translation = { locale: string; title: string; description?: string; coverUrl?: string | null };
type Drama = { id: string; title: string; description?: string; language?: string; coverUrl?: string; coverAssetId?: string | null; reviewStatus?: string | null; episodes: Episode[]; translations?: Translation[]; metadata?: EditableAlbumMetadata };
type AlbumOption = { id: string; title: string; sharedPlayback?: boolean; reviewStatus?: string | null };
type UploadJob = { id: string; episodeId: string; sourceName?: string | null; status: string; providerJobId?: string | null; replacesByteplusVid?: string | null; localFilePath?: string | null; errorMessage?: string | null; nextAttemptAt?: string | null; leaseExpiresAt?: string | null };
type RejectedEpisode = { id: string; episodeNo: number; reviewedByteplusVid: string; currentByteplusVid: string | null; reason: string; canStartReplacement: boolean };
type RejectedEpisodeReport = { version: number | null; items: RejectedEpisode[]; message: string | null };
type SubmissionPlanEpisode = { id: string; localEpisodeNo: number; sourcePlatformSeq: number; platformSeq: number; title: string; byteplusVid: string };
type SubmissionPlan = { sourceVersion: number | null; reconciliationJobId: string | null; canSubmit: boolean; status?: string; message: string | null; included: SubmissionPlanEpisode[]; excluded: Array<{ id: string; localEpisodeNo: number; sourcePlatformSeq: number; title: string; reason: string }>; syncJob?: { id: string; status: string } | null };
type UploadVideo = (episodeId: string, file: File, onProgress: (progress: UploadProgress) => void, mode?: 'replace') => Promise<{ job: UploadJob }>;

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

function EpisodeMaterials({ episode, media, job: latestJob, reviewFailure, api, uploadVideoFile, onJobChanged, onSaved, locked, albumCoverUrl }: { episode: Episode; media: Media[]; job?: UploadJob; reviewFailure?: RejectedEpisode; api: Api; uploadVideoFile: UploadVideo; onJobChanged: (job: UploadJob) => void; onSaved: () => Promise<void>; locked: boolean; albumCoverUrl?: string }) {
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
    : job?.status === 'SUCCEEDED' ? (job.replacesByteplusVid ? '修正视频已绑定，等待 TikTok 媒资登记并同步新版本' : 'BytePlus VID 已取得并绑定')
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

  async function uploadVideo(file: File, mode?: 'replace') {
    setBusy(true); setError(''); setMessage(''); setUploadProgress({ phase: 'sending', percent: 0 });
    try {
      const result = await uploadVideoFile(episode.id, file, setUploadProgress, mode);
      onJobChanged(result.job);
      setMessage(mode === 'replace' ? '修正视频已入队；旧 VID 在新视频完成校验前保持绑定。' : '视频已入队，将自动传至 BytePlus 并获取 VID。');
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
      {saved.byteplusVid && reviewFailure?.canStartReplacement && <label>上传修正视频替换驳回集数<input type="file" accept="video/mp4,video/quicktime,.m4v" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadVideo(file, 'replace'); }} /></label>}
      {saved.byteplusVid && !saved.tiktokEpisodeId && <button className="secondary" type="button" onClick={() => void resetVideo()}><RefreshCw size={15} />解除未同步视频绑定</button>}
      {!saved.byteplusVid && <label>上传视频<input type="file" accept="video/mp4,video/quicktime,.m4v" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadVideo(file); }} /></label>}
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
        {job?.status === 'FAILED' && job.localFilePath && (!saved.byteplusVid || job.replacesByteplusVid === saved.byteplusVid) && <button className="secondary" type="button" disabled={busy || locked} onClick={() => void retryUpload()}><RefreshCw size={14} />重新排队</button>}
      </>}
    </div>}
    {reviewFailure && <p className="material-message">第 {episode.episodeNo} 集审核驳回：{reviewFailure.reason}{!reviewFailure.canStartReplacement && reviewFailure.currentByteplusVid !== reviewFailure.reviewedByteplusVid ? '；本地已更换 VID，请等待新版本送审。' : ''}</p>}
    {message && <p className="material-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function DramaMaterialEditor({ drama, report, submissionPlan, setSubmissionPlan, api, media, jobs, uploadVideoFile, onJobChanged, onSaved }: { drama: Drama; report: RejectedEpisodeReport | null; submissionPlan: SubmissionPlan | null; setSubmissionPlan: (plan: SubmissionPlan) => void; api: Api; media: Media[]; jobs: UploadJob[]; uploadVideoFile: UploadVideo; onJobChanged: (job: UploadJob) => void; onSaved: () => Promise<void> }) {
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
  const [submittingPlan, setSubmittingPlan] = useState(false);
  const locked = ['REVIEWING', '1'].includes(drama.reviewStatus ?? '');
  const [scope, setScope] = useState(drama.metadata);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirmation = scope?.canEdit !== false && scope?.shared && scope.version === 0 && scope.targets?.some((target) => target.differs);
  async function syncRejectionExclusionPlan() {
    if (!submissionPlan?.canSubmit || !submissionPlan.reconciliationJobId) return;
    const confirmText = `将创建 TikTok 新版本：仅排除明确驳回的 ${submissionPlan.excluded.length} 集，保留其余 ${submissionPlan.included.length} 集（包括审核状态未确认的分集），并将平台序号重排为 1-${submissionPlan.included.length}。同步完成后仍需执行平台对账，再从“平台审核”发起送审。本地集数和解锁记录不变。继续吗？`;
    if (!window.confirm(confirmText)) return;
    setSubmittingPlan(true);
    setError('');
    try {
      await api(`/admin/albums/${drama.id}/submission-plan/sync`, { method: 'POST', body: JSON.stringify({ reconciliationJobId: submissionPlan.reconciliationJobId }) });
      const refreshed = await api<SubmissionPlan>(`/admin/albums/${drama.id}/submission-plan`);
      setSubmissionPlan(refreshed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交计划失败'); }
    finally { setSubmittingPlan(false); }
  }
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
    {report?.items.length ? <p className="material-message">当前审核版本 {report.version} 被驳回：{report.items.map((item) => '第 ' + item.episodeNo + ' 集').join('、')}。只替换这些分集的视频，其他分集保持原 VID；全部修正并完成媒资登记后，同步新版本再送审。</p>
      : report?.message && ['REJECTED', '3', 'APPEAL_REJECTED', '7'].includes(drama.reviewStatus ?? '') ? <p className="material-message">{report.message}</p> : null}
    {submissionPlan && (report?.items.length || ['REJECTED', '3', 'APPEAL_REJECTED', '7'].includes(drama.reviewStatus ?? '')) ? <section className="submission-plan" aria-label="排除驳回分集并重排平台序号">
      <div className="submission-plan-heading"><strong>新版本提交计划</strong><span>审核版本 {submissionPlan.sourceVersion ?? '未知'} · 保留 {submissionPlan.included.length} 集 · 排除 {submissionPlan.excluded.length} 集</span></div>
      {submissionPlan.included.length > 0 && <details><summary>查看新平台序号</summary><ol>{submissionPlan.included.map((episode) => <li key={episode.id}>本地第 {episode.localEpisodeNo} 集 → 平台第 {episode.platformSeq} 集：{episode.title}</li>)}</ol></details>}
      {submissionPlan.excluded.length > 0 && <details><summary>查看排除分集</summary><ul>{submissionPlan.excluded.map((episode) => <li key={episode.id}>本地第 {episode.localEpisodeNo} 集：{episode.title} · {episode.reason}</li>)}</ul></details>}
      <p className="material-message">排除的分集不会删除本地记录；新版本通过审核并切换上架后，它们才会从用户端剧集列表中移除。</p>
      {submissionPlan.message && <p className="material-message" role="status">{submissionPlan.message}</p>}
      {submissionPlan.syncJob && <p className="material-message" role="status">版本同步任务：{submissionPlan.syncJob.status} · {submissionPlan.syncJob.id}</p>}
      <button className="primary" type="button" disabled={!submissionPlan.canSubmit || submittingPlan} onClick={() => void syncRejectionExclusionPlan()}><RefreshCw size={15} />{submittingPlan ? '提交中...' : '排除驳回集并同步新版本'}</button>
    </section> : null}
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
      reviewFailure={report?.items.find((item) => item.id === episode.id)}
      api={api} uploadVideoFile={uploadVideoFile} onJobChanged={onJobChanged} onSaved={onSaved} locked={locked || busy} albumCoverUrl={cover} />)}</div>
  </>;
}

export function DramaMaterials({ albums, api, uploadVideo, onSaved, selection, enableRejectedReplacement = false, enableSubmissionPlan = false }: { albums: AlbumOption[]; api: Api; uploadVideo: UploadVideo; onSaved: () => Promise<void>; selection?: { albumId: string; request: number } | null; enableRejectedReplacement?: boolean; enableSubmissionPlan?: boolean }) {
  const [albumId, setAlbumId] = useState('');
  const [drama, setDrama] = useState<Drama | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [report, setReport] = useState<RejectedEpisodeReport | null>(null);
  const [submissionPlan, setSubmissionPlan] = useState<SubmissionPlan | null>(null);
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
    setReport(null);
    setSubmissionPlan(null);
    jobsRef.current = [];
    setJobs([]);
    setError('');
    if (!albumId) return;
    setLoading(true);
    Promise.all([api<Drama>(`/admin/albums/${albumId}`), api<EditableAlbumMetadata>(`/admin/albums/${albumId}/display-metadata`),
      api<{ items: UploadJob[] }>(`/admin/upload-jobs?albumId=${encodeURIComponent(albumId)}`),
      enableRejectedReplacement ? api<RejectedEpisodeReport>(`/admin/albums/${albumId}/rejected-episodes`) : Promise.resolve(null),
      enableSubmissionPlan ? api<SubmissionPlan>(`/admin/albums/${albumId}/submission-plan`) : Promise.resolve(null)]).then(([result, metadata, uploads, rejected, plan]) => {
      if (!cancelled) setDrama({ ...result, title: metadata.title, description: metadata.description, metadata,
        translations: (metadata.translations ?? []).map((item) => ({ ...item, coverUrl: result.translations?.find((local) => local.locale === item.locale)?.coverUrl })) });
      if (!cancelled) { jobsRef.current = uploads.items; setJobs(uploads.items); }
      if (!cancelled) setReport(rejected);
      if (!cancelled) setSubmissionPlan(plan);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [albumId, retry, api, enableRejectedReplacement]);
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
          const rejected = enableRejectedReplacement ? await api<RejectedEpisodeReport>(`/admin/albums/${albumId}/rejected-episodes`) : null;
          const plan = enableSubmissionPlan ? await api<SubmissionPlan>(`/admin/albums/${albumId}/submission-plan`) : null;
          if (cancelled) return;
          setDrama((current) => current?.id === albumId ? { ...current, episodes: latest.episodes } : current);
          setReport(rejected);
          setSubmissionPlan(plan);
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
  }, [albumId, api, activeUploads, enableRejectedReplacement, enableSubmissionPlan]);
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
    {drama && <DramaMaterialEditor key={`${drama.id}:${retry}`} drama={{ ...drama, reviewStatus: albums.find((item) => item.id === drama.id)?.reviewStatus ?? drama.reviewStatus }} report={report} submissionPlan={submissionPlan} setSubmissionPlan={setSubmissionPlan}
      api={api} media={media} jobs={jobs} uploadVideoFile={uploadVideo} onJobChanged={(job) => { const next = [job, ...jobsRef.current.filter((item) => item.id !== job.id)]; jobsRef.current = next; setJobs(next); }} onSaved={onSaved} />}
  </section>;
}
