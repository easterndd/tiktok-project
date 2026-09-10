import { AlbumStatus, EpisodeStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.album.upsert({
    where: { id: 'demo-album' },
    update: {},
    create: {
      id: 'demo-album',
      title: 'Demo Drama',
      description: 'Seed content for local API development only.',
      coverUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=800&q=80',
      language: 'en',
      status: AlbumStatus.ONLINE,
      episodes: {
        create: [1, 2, 3].map((episodeNo) => ({
          id: `demo-episode-${episodeNo}`,
          episodeNo,
          title: `Episode ${episodeNo}`,
          sortOrder: episodeNo,
          durationMs: 90_000,
          isFree: episodeNo === 1,
          status: EpisodeStatus.ONLINE
        }))
      }
    }
  });
}

main().finally(() => prisma.$disconnect());
