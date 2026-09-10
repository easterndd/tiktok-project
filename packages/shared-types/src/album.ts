export type AlbumSummary = {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  episodeCount: number;
  updatedAt: string;
};

export type AlbumDetail = AlbumSummary & {
  language: string;
  regions: string[] | null;
};
