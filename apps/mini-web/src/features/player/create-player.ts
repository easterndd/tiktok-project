import type { PlayInfo } from '@breezereels/shared-types';

export async function createDramaPlayer(root: HTMLElement, info: PlayInfo): Promise<{ destroy(): void }> {
  if (!window.TTMinis) throw new Error('TikTok Minis SDK is unavailable.');
  const VePlayer = await window.TTMinis.getPlayer('byteplus');
  return new VePlayer({
    root,
    vid: info.vid,
    albumId: info.albumId,
    episodeId: info.episodeId,
    lang: 'en',
    getVideoByToken: { playAuthToken: info.playAuthToken ?? undefined, needPoster: true }
  });
}
