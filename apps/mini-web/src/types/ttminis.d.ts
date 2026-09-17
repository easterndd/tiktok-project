declare global {
  interface Window {
    TTMinis?: {
      init(options: { clientKey: string }): void;
      login(): Promise<{ code: string }>;
      canIUse(apiName: string): boolean;
      getPlayer?(channel?: 'byteplus'): Promise<VePlayerConstructor>;
      createRewardedVideoAd(options: { adUnitId: string }): RewardedVideoAd;
      createInterstitialAd(options: { adUnitId: string }): InterstitialAd;
    };
  }

  interface VePlayerConstructor {
    new(options: VePlayerSource & { root: HTMLElement; lang?: string; enableMp4MSE?: boolean }): VePlayerInstance;
    Events: {
      READY: string;
      LOAD_START: string;
      ERROR: string;
      PLAY: string;
      PAUSE: string;
      ENDED: string;
      TIME_UPDATE: string;
      PRELOAD_INFO: string;
    };
    prefetchMediaInfo(sources: VePlayerSource[]): Promise<Array<{ status: 'fulfilled' | 'rejected'; data?: unknown; error?: unknown; fromCache?: boolean }>>;
    prepare(options: { strategies: { preload: boolean | { preloadScene?: 0 | 1; prevCount?: number; nextCount?: number; preloadTime?: number; preloadMaxCacheCount?: number } } }): Promise<void>;
    setPreloadScene(scene: 0 | 1, options?: { prevCount?: number; nextCount?: number }): Promise<void>;
    setPreloadList(sources: VePlayerSource[]): Promise<void>;
    setMediaInfoCacheConfig?(options: { enable: boolean; cacheType: 'memory'; expireTime?: number; maxEntries?: number }): Promise<void> | void;
    preloader?: {
      clearPreloadList?(): void;
      removeAllPreloadTask?(): void;
      removeAll?(): void;
    };
  }

  interface VePlayerSource {
    vid: string;
    albumId: string;
    episodeId: string;
    getVideoByToken?: { playAuthToken?: string; needPoster?: boolean };
    enableMp4MSE?: boolean;
  }

  interface VePlayerInstance {
    on(event: string, callback: (data?: unknown) => void): void;
    off?(event: string, callback: (data?: unknown) => void): void;
    playNext?(options: VePlayerSource & { lang?: string }): Promise<void>;
    preLoadData?: { hit?: number; duration?: number; length?: number };
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
}

export {};
