export type EpisodeAccess = 'PLAYABLE' | 'REWARDED_AD_REQUIRED';

export type EpisodeSummary = {
  id: string;
  episodeNo: number;
  title: string;
  durationMs: number | null;
  isFree: boolean;
  access: EpisodeAccess;
  progress?: number;
  resumePositionMs?: number;
  completed?: boolean;
};

export type PlayInfo = {
  albumId: string;
  localEpisodeId: string;
  episodeId: string;
  vid: string;
  playAuthToken: string | null;
  title: string;
  coverUrl: string | null;
  durationMs: number | null;
  resumePositionMs: number;
};
