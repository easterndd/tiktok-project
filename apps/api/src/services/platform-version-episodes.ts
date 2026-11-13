type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export type VersionEpisode = {
  localEpisodeId: string;
  seq: number;
  byteplus_vid: string;
  episode_id?: string;
  title?: string;
  cover_list?: string[];
};

export function readVersionEpisodes(snapshotValue: unknown, responseValue: unknown) {
  const snapshot = record(snapshotValue);
  const response = record(responseValue);
  const episodeIdMap = record(response.episode_id_map);
  if (!Array.isArray(snapshot.episodes)) return [];
  const rows = snapshot.episodes.map((value) => {
    const episode = record(value);
    const seq = Number(episode.seq);
    const localEpisodeId = string(episode.localEpisodeId);
    if (!Number.isInteger(seq) || seq < 1 || !localEpisodeId || typeof episode.byteplus_vid !== 'string') return null;
    const mappedId = string(episode.episode_id)
      ?? string(episodeIdMap[`seq_${seq}`])
      ?? string(episodeIdMap[`seq:${seq}`]);
    return {
      localEpisodeId,
      seq,
      byteplus_vid: episode.byteplus_vid,
      ...(mappedId ? { episode_id: mappedId } : {}),
      ...(typeof episode.title === 'string' ? { title: episode.title } : {}),
      ...(Array.isArray(episode.cover_list) ? { cover_list: episode.cover_list.filter((item): item is string => typeof item === 'string') } : {})
    } satisfies VersionEpisode;
  });
  return rows.filter((row): row is VersionEpisode => Boolean(row));
}
