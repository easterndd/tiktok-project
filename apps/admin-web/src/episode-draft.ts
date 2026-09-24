type NumberedEpisode = { localId: string; episodeNo: number; title: string };

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
