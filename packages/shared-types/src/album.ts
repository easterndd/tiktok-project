export type AlbumSummary = {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  episodeCount: number;
  updatedAt: string;
  genres?: string[];
  language?: string;
  backdropUrl?: string;
  rating?: number;
  views?: number;
  progress?: number;
  status?: 'DRAFT' | 'REVIEWING' | 'ONLINE' | 'OFFLINE' | 'REJECTED';
};

export type AlbumDetail = AlbumSummary & {
  language: string;
  regions: string[] | null;
  tags?: string[];
  likeCount?: number;
  favoriteCount?: number;
  shareCount?: number;
  userState?: {
    liked: boolean;
    favorited: boolean;
  };
};
