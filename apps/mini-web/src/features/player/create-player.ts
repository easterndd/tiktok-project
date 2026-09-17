import type { PlayInfo } from '@quickreels/shared-types';
import { getStoredLocale } from '../../lib/storage';

export type DramaPlayer = VePlayerInstance;
export type DramaPlayerSource = Pick<PlayInfo, 'albumId' | 'episodeId' | 'vid' | 'playAuthToken'>;

let playerConstructorPromise: Promise<VePlayerConstructor> | undefined;

export function supportsMp4Mse() {
  const browser = window as Window & { ManagedMediaSource?: unknown };
  return Boolean(window.MediaSource || browser.ManagedMediaSource);
}

export function toPlayerSource(info: DramaPlayerSource): VePlayerSource {
  return {
    albumId: info.albumId,
    episodeId: info.episodeId,
    vid: info.vid,
    getVideoByToken: info.playAuthToken ? { playAuthToken: info.playAuthToken, needPoster: true } : undefined,
    enableMp4MSE: supportsMp4Mse()
  };
}

export async function getDramaPlayerConstructor(): Promise<VePlayerConstructor> {
  if (!window.TTMinis?.getPlayer) throw new Error('The official drama player capability is unavailable.');
  if (!playerConstructorPromise) {
    playerConstructorPromise = window.TTMinis.getPlayer('byteplus').catch((error) => {
      playerConstructorPromise = undefined;
      throw error;
    });
  }
  return playerConstructorPromise;
}

export async function createDramaPlayer(root: HTMLElement, info: PlayInfo): Promise<DramaPlayer> {
  const VePlayer = await getDramaPlayerConstructor();
  return new VePlayer({
    root,
    lang: getStoredLocale(),
    ...toPlayerSource(info)
  });
}
