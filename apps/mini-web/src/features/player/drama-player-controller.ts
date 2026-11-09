import type { PlayInfo } from '@quickreels/shared-types';
import { getStoredLocale } from '../../lib/storage';
import { getAdPlatform, isV006Release } from '../ads/ad-platform';
import { reportDiagnostic } from '../../lib/diagnostics';
import { createDramaPlayer, getDramaPlayerConstructor, supportsMp4Mse, toPlayerSource, type DramaPlayer } from './create-player';

const preloadPreparation = new WeakMap<VePlayerConstructor, Promise<void>>();
type PreloadState = { latest: PlayInfo[] | undefined; requested: PlayInfo[]; version: number; running?: Promise<void> };
const preloadUpdates = new WeakMap<VePlayerConstructor, PreloadState>();
const playNextTimeoutMs = 8_000;
const preloadTimeoutMs = 5_000;

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, code: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function uniqueSources(episodes: PlayInfo[]) {
  const seen = new Set<string>();
  return episodes.filter((episode) => {
    if (seen.has(episode.episodeId)) return false;
    seen.add(episode.episodeId);
    return true;
  }).slice(0, 2).map(toPlayerSource);
}

function reportPreloadFailure(stage: string, error: unknown) {
  if (!isV006Release()) return;
  const message = error instanceof Error && error.message.startsWith('PLAYER_') ? error.message : 'SDK_PRELOAD_FAILED';
  reportDiagnostic({ kind: 'PLAYBACK', phase: 'PLAYER_PRELOAD_' + stage, message, path: '/player/preload' });
}

async function applyPreload(VePlayer: VePlayerConstructor, episodes: PlayInfo[], isCurrent: () => boolean) {
  const sources = uniqueSources(episodes);
  if (!sources.length) {
    VePlayer.preloader?.clearPreloadList?.();
    VePlayer.preloader?.removeAllPreloadTask?.();
    return;
  }

  if (!supportsMp4Mse() || getAdPlatform() === 'ios') {
    try {
      await withTimeout(VePlayer.prefetchMediaInfo(sources), preloadTimeoutMs, 'PLAYER_PREFETCH_TIMEOUT');
    } catch (error) {
      reportPreloadFailure('PREFETCH_MEDIA_INFO', error);
    }
    return;
  }

  try {
    let prepared = preloadPreparation.get(VePlayer);
    if (!prepared) {
      prepared = Promise.resolve(VePlayer.prepare({ strategies: { preload: { preloadScene: 1, prevCount: 1, nextCount: 2, preloadTime: 5, preloadMaxCacheCount: 15 } } }))
        .catch((error) => {
          preloadPreparation.delete(VePlayer);
          throw error;
        });
      preloadPreparation.set(VePlayer, prepared);
    }
    await withTimeout(prepared, preloadTimeoutMs, 'PLAYER_PRELOAD_PREPARE_TIMEOUT');
    if (!isCurrent()) return;
    await withTimeout(Promise.resolve(VePlayer.setMediaInfoCacheConfig?.({ enable: true, cacheType: 'memory', expireTime: 30 * 60 * 1000, maxEntries: 100 })), preloadTimeoutMs, 'PLAYER_PRELOAD_CACHE_TIMEOUT');
    if (!isCurrent()) return;
    await withTimeout(VePlayer.setPreloadScene(1, { prevCount: 1, nextCount: 2 }), preloadTimeoutMs, 'PLAYER_PRELOAD_SCENE_TIMEOUT');
    if (!isCurrent()) return;
    const update = Promise.resolve(VePlayer.setPreloadList(sources));
    void update.then(() => {
      if (!isCurrent()) {
        const latest = preloadUpdates.get(VePlayer)?.requested ?? [];
        void preparePreload(VePlayer, latest);
      }
    }, () => undefined);
    await withTimeout(update, preloadTimeoutMs, 'PLAYER_PRELOAD_LIST_TIMEOUT');
  } catch (error) {
    reportPreloadFailure('PRELOAD_LIST', error);
  }
}

function preparePreload(VePlayer: VePlayerConstructor, episodes: PlayInfo[]) {
  let state = preloadUpdates.get(VePlayer);
  if (!state) {
    state = { latest: undefined, requested: [], version: 0 };
    preloadUpdates.set(VePlayer, state);
  }
  state.latest = episodes;
  state.requested = episodes;
  state.version += 1;
  if (state.running) return state.running;

  state.running = (async () => {
    while (state?.latest) {
      const next = state.latest;
      const version = state.version;
      state.latest = undefined;
      try {
        await applyPreload(VePlayer, next, () => state?.version === version);
      } catch (error) {
        reportPreloadFailure('QUEUE', error);
      }
    }
  })().finally(() => {
    if (!state) return;
    state.running = undefined;
    if (state.latest) void preparePreload(VePlayer, state.latest);
  });
  return state.running;
}

export class DramaPlayerController {
  private VePlayer: VePlayerConstructor | undefined;
  private player: DramaPlayer | undefined;
  private current: PlayInfo | undefined;
  private generation = 0;
  private operation: Promise<void> = Promise.resolve();
  private readonly root: HTMLElement;
  private readonly operationTimeoutMs: number;

  constructor(root: HTMLElement, operationTimeoutMs = playNextTimeoutMs) {
    this.root = root;
    this.operationTimeoutMs = operationTimeoutMs;
  }

  get instance() {
    return this.player;
  }

  get events() {
    return this.VePlayer?.Events;
  }

  start(info: PlayInfo, playlist: PlayInfo[], preload = true) {
    return this.load(info, playlist, preload, false);
  }

  switchTo(info: PlayInfo, playlist: PlayInfo[], preload = true) {
    return this.load(info, playlist, preload, true);
  }

  private load(info: PlayInfo, playlist: PlayInfo[], preload: boolean, reuse: boolean) {
    const generation = ++this.generation;
    const assertActive = () => {
      if (generation !== this.generation) throw new Error('PLAYER_OPERATION_CANCELLED');
    };
    // A pending playNext must finish before a newer episode touches the same SDK instance.
    const operation = this.operation.then(async () => {
      assertActive();
      this.VePlayer = await getDramaPlayerConstructor();
      assertActive();
      if (preload) void preparePreload(this.VePlayer, [info, ...playlist.filter((item) => item.albumId === info.albumId && item.episodeId !== info.episodeId)]);
      if (reuse && this.player && this.current?.albumId === info.albumId && this.player.playNext) {
        try {
          await withTimeout(Promise.resolve(this.player.playNext({ ...toPlayerSource(info), lang: getStoredLocale() })), this.operationTimeoutMs, 'PLAYER_PLAY_NEXT_TIMEOUT');
          assertActive();
          this.current = info;
          return this.player;
        } catch (error) {
          if (error instanceof Error && error.message === 'PLAYER_PLAY_NEXT_TIMEOUT') {
            this.player.destroy();
            this.player = undefined;
            this.current = undefined;
          }
          assertActive();
          // Rebuild once when the SDK cannot switch this episode in place.
          void error;
        }
      }

      this.player?.destroy();
      this.player = undefined;
      this.current = undefined;
      const player = await createDramaPlayer(this.root, info);
      if (generation !== this.generation) {
        player.destroy();
        assertActive();
      }
      this.player = player;
      this.current = info;
      return player;
    });
    this.operation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  cancelPending() {
    this.generation += 1;
    if (this.VePlayer) {
      void preparePreload(this.VePlayer, []);
      this.VePlayer.preloader?.clearPreloadList?.();
      this.VePlayer.preloader?.removeAllPreloadTask?.();
    }
  }

  async updatePreload(playlist: PlayInfo[], enabled = true) {
    if (!this.VePlayer) return;
    await preparePreload(this.VePlayer, enabled ? playlist : []);
  }

  destroy() {
    this.cancelPending();
    this.player?.destroy();
    this.player = undefined;
    this.current = undefined;
  }
}
