type NumberedEpisode = { localId: string; episodeNo: number; title: string };
type ExistingEpisode = { id: string; episodeNo: number; title: string; sortOrder: number; byteplusVid?: string | null };

export function defaultEpisodeTitle(episodeNo: number) {
  return `第 ${episodeNo} 集`;
}

function chineseEpisodeNo(value: string): number | null {
  const digits: Record<string, number> = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const units: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };
  let total = 0;
  let digit = 0;
  let lastUnit = 10000;
  let zero = false;
  for (const character of value) {
    if (character === '零' || character === '〇') {
      if (lastUnit === 10000 || digit || zero) return null;
      zero = true;
    } else if (digits[character]) {
      if (digit) return null;
      digit = digits[character];
      zero = false;
    } else {
      const unit = units[character];
      if (!unit || unit >= lastUnit || zero || (!digit && (unit !== 10 || lastUnit !== 10000))) return null;
      total += (digit || 1) * unit;
      digit = 0;
      lastUnit = unit;
    }
  }
  return zero ? null : total + digit || null;
}

export function episodeNoFromName(fileName: string): number | null {
  const name = fileName.replace(/\.[^.]+$/, '');
  const arabic = [/第\s*0*(\d+)\s*集/i, /Episode\s*0*(\d+)/i, /\bS\d+E0*(\d+)\b/i, /\bEP?0*(\d+)\b/i, /^0*(\d+)(?:\s*集)?(?=$|[\s._-])/];
  for (const pattern of arabic) {
    const match = pattern.exec(name);
    if (match) {
      const number = Number(match[1]);
      return Number.isSafeInteger(number) && number > 0 ? number : null;
    }
  }
  const chinese = /第\s*([零〇一二两三四五六七八九十百千]+)\s*集/.exec(name);
  return chinese ? chineseEpisodeNo(chinese[1]) : null;
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
