export type UploadStatusResult = {
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  byteplusVid?: string;
  coverUrl?: string;
  durationMs?: number;
  errorMessage?: string;
  retryable?: boolean;
};

export interface TikTokShortDramaService {
  createVideoUpload(input: { sourceUrl: string; title: string; spaceName: string; byteplusAccountId: string }): Promise<{ providerJobId: string }>;
  getVideoUploadStatus(input: { providerJobId: string; byteplusAccountId: string }): Promise<UploadStatusResult>;
  getPlayAuthToken(input: { vid: string }): Promise<string>;
}

export class ProviderNotConfiguredError extends Error {
  readonly retryable = true;

  constructor() {
    super('TikTok media provider is not configured.');
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * Platform paths and payloads change independently of business routes. Keep the
 * integration behind this interface and implement it only from the current TikTok API reference.
 */
export class UnconfiguredTikTokShortDramaService implements TikTokShortDramaService {
  async createVideoUpload(): Promise<{ providerJobId: string }> {
    throw new ProviderNotConfiguredError();
  }

  async getVideoUploadStatus(): Promise<UploadStatusResult> {
    throw new ProviderNotConfiguredError();
  }

  async getPlayAuthToken(): Promise<string> {
    throw new ProviderNotConfiguredError();
  }
}
