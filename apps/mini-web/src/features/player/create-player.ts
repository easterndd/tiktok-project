import type { PlayInfo } from '@breezereels/shared-types';
import { getStoredLocale } from '../../lib/storage';

export async function createDramaPlayer(root: HTMLElement, info: PlayInfo): Promise<{ destroy(): void }> {
  if (!window.TTMinis?.getPlayer) throw new Error('The official drama player capability is unavailable.');
  const VePlayer = await window.TTMinis.getPlayer('byteplus');
  return new VePlayer({
    root,
    vid: info.vid,
    albumId: info.albumId,
    episodeId: info.episodeId,
    lang: getStoredLocale(),
    getVideoByToken: { playAuthToken: info.playAuthToken ?? undefined, needPoster: true }
  });
}
