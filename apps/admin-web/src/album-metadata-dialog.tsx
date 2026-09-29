import { Save, X } from 'lucide-react';
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
    setLoading(true);
    if (dialog && !dialog.open) dialog.showModal();

    let cancelled = false;
    api<EditableAlbumMetadata>(`/admin/albums/${album.id}`)
      .then((detail) => {
        if (!cancelled) setDraft({ ...detail, sharedPlayback: album.sharedPlayback, description: detail.description ?? '', translations: detail.translations ?? [] });
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || loading) return;
    setSaving(true);
    setError('');
    try {
      const metadata = albumMetadataUpdate(draft.title, draft.description ?? '');
      const translations = (draft.translations ?? []).map((translation) => albumTranslationUpdate(draft.id, translation));
      const updated = await api<EditableAlbumMetadata>(`/admin/albums/${draft.id}`, { method: 'PATCH', body: JSON.stringify(metadata) });
      await Promise.all(translations.map((translation) => api('/admin/translations', { method: 'POST', body: JSON.stringify(translation) })));
      onSaved({ ...draft, ...updated, ...metadata, translations: draft.translations ?? [] });
      onClose();
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
      <div><p className="eyebrow">当前小程序展示资料</p><h2 id="album-metadata-title">编辑剧名与简介</h2></div>
      <button className="metadata-dialog-close" type="button" aria-label="关闭编辑窗口" disabled={saving} onClick={onClose}><X size={18} /></button>
    </div>
    <form className="metadata-dialog-form" onSubmit={save}>
      <p id="album-metadata-help" className="metadata-dialog-help">{draft?.sharedPlayback
        ? '这是共享授权播放副本。保存后只修改当前小程序的显示名称和简介，不会修改主小程序或 TikTok 线上剧目。'
        : '保存后当前小程序会立即读取新的名称和简介；TikTok 平台版本仍按原发布流程单独同步。'}</p>
      {loading && <p className="metadata-dialog-loading" role="status">正在读取完整剧目资料...</p>}
      {draft && <fieldset disabled={loading || saving}>
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
      {error && <p className="form-error metadata-dialog-error" role="alert">{error}</p>}
      <div className="metadata-dialog-actions"><button className="secondary" type="button" disabled={saving} onClick={onClose}>取消</button><button className="primary" type="submit" disabled={!draft || loading || saving}><Save size={16} />{saving ? '保存中...' : '保存并同步到小程序'}</button></div>
    </form>
  </dialog>;
}
