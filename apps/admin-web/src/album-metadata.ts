export type AlbumTranslationDraft = {
  locale: string;
  title: string;
  description?: string;
  coverUrl?: string | null;
};

export function albumMetadataUpdate(title: string, description: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('剧集名称不能为空。');
  return { title: normalizedTitle, description: description.trim() };
}

export function albumTranslationUpdate(contentId: string, translation: AlbumTranslationDraft) {
  const title = translation.title.trim();
  if (!title) throw new Error(`${translation.locale} 的标题不能为空。`);
  return {
    kind: 'album' as const,
    contentId,
    locale: translation.locale,
    title,
    description: (translation.description ?? '').trim(),
    coverUrl: translation.coverUrl ?? null
  };
}
