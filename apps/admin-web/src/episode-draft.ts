type NumberedEpisode = { localId: string; episodeNo: number; title: string };
type ExistingEpisode = { id: string; episodeNo: number; title: string; sortOrder: number; byteplusVid?: string | null };

export function defaultEpisodeTitle(episodeNo: number) {
  return `第 ${episodeNo} 集`;
}

export function nextEpisodeNo(episodes: readonly NumberedEpisode[]) {
  return (episodes.at(-1)?.episodeNo ?? 0) + 1;
}

export function renumberEpisodes<T extends NumberedEpisode>(episodes: readonly T[], localId: string, episodeNo: number): T[] {
  const startIndex = episodes.findIndex((episode) => episode.localId === localId);
  if (startIndex < 0 || !Number.isSafeInteger(episodeNo) || episodeNo < 1) return [...episodes];
  return episodes.map((episode, index) => {
    if (index < startIndex) return episode;
    const nextNo = episodeNo + index - startIndex;
    return {
      ...episode,
      episodeNo: nextNo,
      title: episode.title === defaultEpisodeTitle(episode.episodeNo) ? defaultEpisodeTitle(nextNo) : episode.title
    };
  });
}

export function resolveAppendEpisodes<T extends NumberedEpisode & { savedEpisodeId?: string; sortOrder: number; uploadStatus?: string }>(
  drafts: readonly T[], existing: readonly ExistingEpisode[]
): T[] {
  const byNumber = new Map(existing.map((episode) => [episode.episodeNo, episode]));
  const byId = new Map(existing.map((episode) => [episode.id, episode]));
  return drafts.map((draft) => {
    if (draft.savedEpisodeId) {
      const saved = byId.get(draft.savedEpisodeId);
      return saved && !saved.byteplusVid && draft.uploadStatus === '已上传'
        ? { ...draft, uploadStatus: undefined } : draft;
    }
    const match = byNumber.get(draft.episodeNo);
    if (!match || match.byteplusVid) return draft;
    return {
      ...draft,
      savedEpisodeId: match.id,
      title: match.title,
      sortOrder: match.sortOrder,
      uploadStatus: draft.uploadStatus === '已上传' ? undefined : draft.uploadStatus
    };
  });
}
