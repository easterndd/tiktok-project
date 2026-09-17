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

  constructor(private readonly root: HTMLElement) {}

  get instance() {
    return this.player;
  }

  get events() {
    return this.VePlayer?.Events;
  }

  async start(info: PlayInfo, playlist: PlayInfo[], preload = true) {
    this.VePlayer = await getDramaPlayerConstructor();
    if (preload) await preparePreload(this.VePlayer, playlist.length ? playlist : [info]);
    this.player = await createDramaPlayer(this.root, info);
    this.current = info;
    return this.player;
  }

  async switchTo(info: PlayInfo, playlist: PlayInfo[], preload = true) {
    if (!this.player || !this.current) return this.start(info, playlist, preload);
    if (preload) await preparePreload(this.VePlayer!, playlist.length ? playlist : [info]);
    if (this.current.albumId === info.albumId && this.player.playNext) {
      try {
        await this.player.playNext({ ...toPlayerSource(info), lang: getStoredLocale() });
        this.current = info;
        return this.player;
      } catch {
        // Fall through to one controlled rebuild when the SDK cannot switch this episode in place.
      }
    }

    this.player.destroy();
    this.player = undefined;
    this.current = undefined;
    return this.start(info, playlist, preload);
  }

  async updatePreload(playlist: PlayInfo[], enabled = true) {
    if (!enabled || !this.VePlayer) return;
    await preparePreload(this.VePlayer, playlist);
  }

  destroy() {
    this.player?.destroy();
    this.player = undefined;
    this.current = undefined;
    this.VePlayer?.preloader?.clearPreloadList?.();
    this.VePlayer?.preloader?.removeAllPreloadTask?.();
  }
}
