export type UploadStatusResult = {
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  byteplusVid?: string;
  coverUrl?: string;
  durationMs?: number;
  errorMessage?: string;
};

export interface TikTokShortDramaService {
  createVideoUpload(input: { sourceUrl: string; title: string; spaceName: string; byteplusAccountId: string }): Promise<{ providerJobId: string }>;
  getVideoUploadStatus(input: { providerJobId: string; byteplusAccountId: string }): Promise<UploadStatusResult>;
  getPlayAuthToken(input: { tiktokEpisodeId: string }): Promise<string>;
}

/**
 * Platform paths and payloads change independently of business routes. Keep the
 * integration behind this interface and implement it only from the current TikTok API reference.
 */
export class UnconfiguredTikTokShortDramaService implements TikTokShortDramaService {
  async createVideoUpload(): Promise<{ providerJobId: string }> {
    throw new Error('TikTok Short Drama integration is not configured.');
  }

  async getVideoUploadStatus(): Promise<UploadStatusResult> {
    throw new Error('TikTok Short Drama integration is not configured.');
  }

  async getPlayAuthToken(): Promise<string> {
    throw new Error('TikTok Short Drama integration is not configured.');
  }
}
