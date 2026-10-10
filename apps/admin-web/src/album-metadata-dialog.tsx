import { RefreshCw, Save, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { albumMetadataUpdate, albumTranslationUpdate, type AlbumTranslationDraft } from './album-metadata';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

export type EditableAlbumMetadata = {
  id: string;
  title: string;
  description?: string;
  language?: string;
  sharedPlayback?: boolean;
  translations?: AlbumTranslationDraft[];
  initialTitle?: string;
  shared?: boolean;
  version?: number;
  canEdit?: boolean;
  targets?: { miniAppKey: string; title?: string; differs: boolean; differences?: string[]; syncedVersion: number; status: string; error?: string | null }[];
};

type Props = {
  album: EditableAlbumMetadata | null;
  api: Api;
  onClose: () => void;
  onSaved: (album: EditableAlbumMetadata) => void;
};

export function AlbumMetadataDialog({ album, api, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<EditableAlbumMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sync, setSync] = useState<EditableAlbumMetadata | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!album) {
      if (dialog?.open) dialog.close();
      setDraft(null);
      setError('');
      return;
    }

    setDraft({ ...album, description: album.description ?? '', translations: album.translations ?? [] });
    setError('');
    setSync(null);
    setConfirmed(false);
    setSaved(false);
    setLoading(true);
    if (dialog && !dialog.open) dialog.showModal();

    let cancelled = false;
    api<EditableAlbumMetadata>(`/admin/albums/${album.id}/display-metadata`)
      .then((detail) => {
        if (!cancelled) {
          setDraft({ ...detail, title: album.initialTitle ?? detail.title, sharedPlayback: album.sharedPlayback, description: detail.description ?? '', translations: detail.translations ?? [] });
          setSync(detail);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取剧目资料失败。');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          window.setTimeout(() => titleRef.current?.focus(), 0);
        }
      });
    return () => { cancelled = true; };
  }, [album, api]);

  useEffect(() => {
    if (!album || !sync?.shared || !sync.targets?.some((target) => ['PENDING', 'PROCESSING'].includes(target.status))) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api<EditableAlbumMetadata>(`/admin/albums/${album.id}/display-metadata`).then((view) => {
        if (!cancelled) setSync(view);
      }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '读取同步状态失败。'); });
    }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [album, api, sync]);

  const needsConfirmation = sync?.shared && sync.version === 0 && sync.targets?.some((target) => target.differs);
  async function retry(miniAppKey: string) {
    if (!album) return;
    setRetrying(true);
    setError('');
    try {
      await api(`/admin/albums/${album.id}/display-metadata/retry`, { method: 'POST', body: JSON.stringify({ miniAppKey }) });
      setSync(await api<EditableAlbumMetadata>(`/admin/albums/${album.id}/display-metadata`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重试失败。'); }
    finally { setRetrying(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || loading || !sync || sync.canEdit === false || (needsConfirmation && !confirmed)) return;
    setSaving(true);
    setError('');
    try {
      const metadata = albumMetadataUpdate(draft.title, draft.description ?? '');
      const translations = (draft.translations ?? []).map((translation) => {
        const text = albumTranslationUpdate(draft.id, translation);
        return { locale: text.locale, title: text.title, description: text.description };
      });
      const updated = await api<EditableAlbumMetadata>(`/admin/albums/${draft.id}/display-metadata`, { method: 'PATCH', body: JSON.stringify({ ...metadata, translations, expectedVersion: sync.version ?? 0 }) });
      setSync(updated);
      setDraft(updated);
      setSaved(true);
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '剧目资料保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={dialogRef} className="album-metadata-dialog" aria-labelledby="album-metadata-title" aria-describedby="album-metadata-help" onCancel={(event) => {
    if (saving) event.preventDefault();
    else onClose();
  }} onClose={() => { if (album && !saving) onClose(); }}>
    <div className="metadata-dialog-heading">
      <div><p className="eyebrow">{sync?.shared ? '全部关联小程序的统一展示资料' : '当前小程序展示资料'}</p><h2 id="album-metadata-title">编辑剧名与简介</h2></div>
      <button className="metadata-dialog-close" type="button" aria-label="关闭编辑窗口" disabled={saving} onClick={onClose}><X size={18} /></button>
    </div>
    <form className="metadata-dialog-form" onSubmit={save} onChange={() => setSaved(false)}>
      <p id="album-metadata-help" className="metadata-dialog-help">{sync?.shared
        ? `保存后将统一剧名、简介和多语言文案，并自动同步到 ${sync.targets?.length ?? 0} 个关联小程序，包括主小程序。各应用的封面和广告配置独立保留。TikTok 平台资料仍按版本发布流程更新。`
        : '此剧目尚无共享关联，保存后更新当前小程序。后续建立共享授权后，统一资料会同步到关联应用。TikTok 平台资料按版本发布流程更新。'}</p>
      {loading && <p className="metadata-dialog-loading" role="status">正在读取完整剧目资料...</p>}
      {sync?.canEdit === false && <p className="metadata-dialog-help" role="status">统一资料由主小程序 OWNER 管理，请登录对应账号后编辑。</p>}
      {draft && <fieldset disabled={loading || saving || !sync || sync.canEdit === false}>
        <label>剧名<input ref={titleRef} value={draft.title} maxLength={160} required onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} /><small>{draft.title.length} / 160</small></label>
        <label>剧情简介<textarea rows={7} value={draft.description ?? ''} maxLength={20_000} onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)} /><small>{(draft.description ?? '').length} / 20,000</small></label>
        {(draft.translations?.length ?? 0) > 0 && <details className="metadata-translations">
          <summary>多语言标题与简介 · {draft.translations?.length}</summary>
          <p>小程序使用对应语言时会优先显示这里的简介。</p>
          {draft.translations?.map((translation, index) => <div className="metadata-translation" key={translation.locale}>
            <strong>{translation.locale}</strong>
            <label>标题<input value={translation.title} maxLength={160} required onChange={(event) => setDraft((current) => current ? { ...current, translations: current.translations?.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) } : current)} /></label>
            <label>简介<textarea rows={4} value={translation.description ?? ''} maxLength={20_000} onChange={(event) => setDraft((current) => current ? { ...current, translations: current.translations?.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) } : current)} /></label>
          </div>)}
        </details>}
      </fieldset>}
      {sync?.shared && <section className="metadata-sync" aria-label="小程序同步状态">
        <strong>同步范围与状态 · {sync.version ? `资料版本 ${sync.version}` : '首次统一'}</strong>
        {!sync.version && <p>首次以主小程序文案为默认值；标记为“存在差异”的应用将被统一。目标独有语言文案会使用统一资料作为默认值。</p>}
        {sync.targets?.map((target) => <div className="metadata-sync-target" key={target.miniAppKey}>
          <div><strong>{target.miniAppKey}</strong><small>{!sync.version ? (target.differs ? `存在差异${target.differences?.length ? `：${target.differences.join('、')}` : ''}` : '资料一致') : ({ SUCCEEDED: '已同步', PENDING: '等待同步', PROCESSING: '同步中', FAILED: '同步失败', CONFLICT: '需要处理', NOT_SYNCED: '尚未同步', UNAVAILABLE: '读取失败' }[target.status] ?? target.status)}{target.title ? ` · 当前：${target.title}` : ''}</small>{target.error && <small className="form-error">{target.error}</small>}</div>
          {['FAILED', 'CONFLICT'].includes(target.status) && sync.canEdit !== false && <button className="secondary" type="button" disabled={saving || retrying} onClick={() => void retry(target.miniAppKey)}><RefreshCw size={14} />重试</button>}
        </div>)}
        {needsConfirmation && <label className="metadata-sync-confirm"><input type="checkbox" checked={confirmed} disabled={saving || sync.canEdit === false} onChange={(event) => setConfirmed(event.target.checked)} />确认将以上小程序的剧名、简介及多语言文案统一为本次保存内容</label>}
      </section>}
      {saved && <p className="metadata-dialog-help" role="status">{sync?.shared ? '统一资料已保存，同步任务已提交。可在这里查看结果；失败任务会自动重试，也可手动重试。' : '剧名与简介已保存。'}</p>}
      {error && <p className="form-error metadata-dialog-error" role="alert">{error}</p>}
      <div className="metadata-dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={onClose}>{saved ? '关闭' : '取消'}</button><button className="primary" type="submit" disabled={!draft || !sync || loading || saving || saved || sync.canEdit === false || Boolean(needsConfirmation && !confirmed)}><Save size={16} />{saving ? '保存中...' : sync?.shared ? `保存并同步到 ${sync.targets?.length ?? 0} 个小程序` : '保存到当前小程序'}</button></div>
    </form>
  </dialog>;
}
