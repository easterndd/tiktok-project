declare global {
  type TikTokMiniDramaShowPayload = {
    query?: unknown;
    launch_from?: unknown;
    [key: string]: unknown;
  };

  interface Window {
    TTMinis?: {
      init(options: { clientKey: string }): void;
      login(options?: { success?: (result: { code?: string; authResponse?: { code?: string } }) => void; fail?: (error: unknown) => void; complete?: () => void }): Promise<{ code?: string; authResponse?: { code?: string } }> | void;
      canIUse(apiName: string): boolean;
      onShow?(callback: (params?: TikTokMiniDramaShowPayload) => void): string | void;
      on?(event: 'minis.show', callback: (params?: TikTokMiniDramaShowPayload) => void): string | void;
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
    player?: { play?(): Promise<void> | void; paused?: boolean; currentTime?: number };
    preLoadData?: { hit?: number; duration?: number; length?: number };
    destroy(): void;
  }

  interface RewardedVideoAd {
    show(): Promise<void>;
    load?(): Promise<void> | void;
    onLoad?(callback: () => void): void;
    offLoad?(callback: () => void): void;
    onClose(callback: (result: { isEnded: boolean }) => void): void;
    offClose(callback: (result: { isEnded: boolean }) => void): void;
    onError(callback: (error: unknown) => void): void;
    offError(callback: (error: unknown) => void): void;
    destroy?(): void;
  }

  interface InterstitialAd {
    show(): Promise<void>;
    load?(): Promise<void> | void;
    onLoad?(callback: () => void): void;
    offLoad?(callback: () => void): void;
    destroy?(): void;
    onClose(callback: () => void): void;
    offClose(callback: () => void): void;
    onError(callback: (error: unknown) => void): void;
    offError(callback: (error: unknown) => void): void;
  }
}

export {};
