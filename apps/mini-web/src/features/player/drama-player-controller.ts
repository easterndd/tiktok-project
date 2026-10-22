import type { PlayInfo } from '@quickreels/shared-types';
import { getStoredLocale } from '../../lib/storage';
import { createDramaPlayer, getDramaPlayerConstructor, supportsMp4Mse, toPlayerSource, type DramaPlayer } from './create-player';

const preloadPreparation = new WeakMap<VePlayerConstructor, Promise<void>>();

function uniqueSources(episodes: PlayInfo[]) {
  const seen = new Set<string>();
  return episodes.filter((episode) => {
    if (seen.has(episode.episodeId)) return false;
    seen.add(episode.episodeId);
    return true;
  }).map(toPlayerSource);
}

async function preparePreload(VePlayer: VePlayerConstructor, episodes: PlayInfo[]) {
  const sources = uniqueSources(episodes);
  if (!sources.length) return;

  void VePlayer.prefetchMediaInfo(sources).catch(() => undefined);
  if (!supportsMp4Mse()) return;

  const existingPreparation = preloadPreparation.get(VePlayer);
  const prepared = existingPreparation ?? VePlayer.prepare({ strategies: { preload: { preloadScene: 1, prevCount: 1, nextCount: 2, preloadTime: 5, preloadMaxCacheCount: 15 } } })
      .catch((error) => {
        preloadPreparation.delete(VePlayer);
        throw error;
      });
  if (!existingPreparation) {
    preloadPreparation.set(VePlayer, prepared);
  }

  try {
    await prepared;
    await VePlayer.setMediaInfoCacheConfig?.({ enable: true, cacheType: 'memory', expireTime: 30 * 60 * 1000, maxEntries: 100 });
    await VePlayer.setPreloadScene(1, { prevCount: 1, nextCount: 2 });
    await VePlayer.setPreloadList(sources);
  } catch {
    // MSE/MMS may be unavailable despite browser feature detection. Playback remains usable without preload.
  }
}

export class DramaPlayerController {
  private VePlayer: VePlayerConstructor | undefined;
  private player: DramaPlayer | undefined;
  private current: PlayInfo | undefined;
  private generation = 0;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly root: HTMLElement) {}

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
      if (preload) void preparePreload(this.VePlayer, playlist.length ? playlist : [info]);
      if (reuse && this.player && this.current?.albumId === info.albumId && this.player.playNext) {
        try {
          await this.player.playNext({ ...toPlayerSource(info), lang: getStoredLocale() });
          assertActive();
          this.current = info;
          return this.player;
        } catch (error) {
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
  }

  async updatePreload(playlist: PlayInfo[], enabled = true) {
    if (!enabled || !this.VePlayer) return;
    await preparePreload(this.VePlayer, playlist);
  }

  destroy() {
    this.cancelPending();
    this.player?.destroy();
    this.player = undefined;
    this.current = undefined;
    this.VePlayer?.preloader?.clearPreloadList?.();
    this.VePlayer?.preloader?.removeAllPreloadTask?.();
  }
}
