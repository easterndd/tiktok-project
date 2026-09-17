import { AlbumStatus, EpisodeStatus, PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env';

const albumId = 'local-playback-album';
const coverUrl = '/local-test-media/while-my-fiance-knocked-cover.png';
const episodes = [
  { id: 'local-playback-episode-1', episodeNo: 1, durationMs: 66_804, localPlaybackUrl: '/local-test-media/while-my-fiance-knocked-episode-1.mp4' },
  { id: 'local-playback-episode-2', episodeNo: 2, durationMs: 66_804, localPlaybackUrl: '/local-test-media/while-my-fiance-knocked-episode-2.mp4' },
  { id: 'local-playback-episode-3', episodeNo: 3, durationMs: 66_804, localPlaybackUrl: '/local-test-media/while-my-fiance-knocked-episode-3.mp4' }
];

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production' || !env.LOCAL_PLAYBACK_ENABLED) {
    throw new Error('LOCAL_PLAYBACK_ENABLED=true is required outside production before creating the local playback fixture.');
  }

  const prisma = new PrismaClient();
  try {
    await prisma.album.upsert({
      where: { id: albumId },
      create: {
        id: albumId,
        title: 'While My Fiance Knocked, I Was Still Kissing My Father\'s Old Friend',
        description: 'Local browser playback fixture using the supplied episode 1 media. It exists only to verify the development playback chain without BytePlus VOD.',
        coverUrl,
        language: 'en',
        accessConfig: { freeEpisodeCount: 1, rewardedAdEnabled: false },
        status: AlbumStatus.ONLINE
      },
      update: {
        coverUrl,
        status: AlbumStatus.ONLINE,
        accessConfig: { freeEpisodeCount: 1, rewardedAdEnabled: false }
      }
    });
    await Promise.all(episodes.map((episode) => prisma.episode.upsert({
      where: { id: episode.id },
      create: {
        id: episode.id,
        albumId,
        episodeNo: episode.episodeNo,
        title: `Episode ${episode.episodeNo}`,
        sortOrder: episode.episodeNo,
        isFree: true,
        coverUrl,
        durationMs: episode.durationMs,
        localPlaybackUrl: episode.localPlaybackUrl,
        status: EpisodeStatus.ONLINE
      },
      update: {
        coverUrl,
        durationMs: episode.durationMs,
        localPlaybackUrl: episode.localPlaybackUrl,
        status: EpisodeStatus.ONLINE,
        isFree: true
      }
    })));
    console.log(`Local playback fixture is ready: /watch/${albumId}/${episodes[0].id}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
