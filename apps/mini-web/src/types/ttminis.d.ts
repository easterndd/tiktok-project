declare global {
  interface Window {
    TTMinis?: {
      init(options: { clientKey: string }): void;
      login(): Promise<{ code: string }>;
      canIUse(apiName: string): boolean;
      getPlayer(channel?: 'byteplus'): Promise<VePlayerConstructor>;
      createRewardedVideoAd(options: { adUnitId: string }): RewardedVideoAd;
      createInterstitialAd(options: { adUnitId: string }): InterstitialAd;
    };
  }
}

interface VePlayerConstructor {
  new(options: { root: HTMLElement; vid: string; albumId: string; episodeId: string; lang?: string; getVideoByToken?: { playAuthToken?: string; needPoster?: boolean } }): VePlayerInstance;
}

interface VePlayerInstance {
  on(event: string, callback: (data?: unknown) => void): void;
  destroy(): void;
}

interface RewardedVideoAd {
  show(): Promise<void>;
  onClose(callback: (result: { isEnded: boolean }) => void): void;
  offClose(callback: (result: { isEnded: boolean }) => void): void;
  onError(callback: (error: unknown) => void): void;
  offError(callback: (error: unknown) => void): void;
}

interface InterstitialAd {
  show(): Promise<void>;
  onClose(callback: () => void): void;
  offClose(callback: () => void): void;
  onError(callback: (error: unknown) => void): void;
  offError(callback: (error: unknown) => void): void;
}

export {};
