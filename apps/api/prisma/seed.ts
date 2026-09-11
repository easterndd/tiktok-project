import { AlbumStatus, EpisodeStatus, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/password';

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
      regions: ['AU', 'BR', 'CA', 'ID', 'JP', 'MX', 'NZ', 'KR', 'TH', 'US'],
      accessConfig: { freeEpisodeCount: 3, rewardedAdEnabled: true, rewardedPlacementId: 'rewarded_episode_unlock' },
      status: AlbumStatus.ONLINE,
      episodes: {
        create: [1, 2, 3].map((episodeNo) => ({
          id: `demo-episode-${episodeNo}`,
          episodeNo,
          title: `Episode ${episodeNo}`,
          sortOrder: episodeNo,
          durationMs: 90_000,
          isFree: false,
          status: EpisodeStatus.ONLINE
        }))
      }
    }
  });

  for (const genre of [
    { slug: 'romance', name: 'Romance', translations: { pt: 'Romance', fr: 'Romance', id: 'Romantis', ja: 'ロマンス', es: 'Romance', ko: '로맨스', th: 'โรแมนติก' } },
    { slug: 'mystery', name: 'Mystery', translations: { pt: 'Misterio', fr: 'Mystere', id: 'Misteri', ja: 'ミステリー', es: 'Misterio', ko: '미스터리', th: 'ลึกลับ' } },
    { slug: 'family', name: 'Family', translations: { pt: 'Familia', fr: 'Famille', id: 'Keluarga', ja: '家族', es: 'Familia', ko: '가족', th: 'ครอบครัว' } }
  ]) {
    const record = await prisma.genre.upsert({ where: { slug: genre.slug }, create: genre, update: { name: genre.name, translations: genre.translations } });
    await prisma.albumGenre.upsert({ where: { albumId_genreId: { albumId: 'demo-album', genreId: record.id } }, create: { albumId: 'demo-album', genreId: record.id }, update: {} });
  }

  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (adminEmail || adminPassword) {
    if (!adminEmail || !adminPassword || adminPassword.length < 12) {
      throw new Error('ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (12+ characters) must be provided together.');
    }
    await prisma.adminUser.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash: await hashPassword(adminPassword), role: 'OWNER' },
      update: {}
    });
  }

  for (const component of [
    { key: 'APP_TOPBAR', page: 'APP' },
    { key: 'APP_BOTTOM_NAV', page: 'APP' },
    { key: 'HOME_INTRO', page: 'HOME' },
    { key: 'HOME_FEED', page: 'HOME' },
    { key: 'ALBUM_DESCRIPTION', page: 'ALBUM' },
    { key: 'PROFILE_HISTORY', page: 'PROFILE' },
    { key: 'PROFILE_FAVORITES', page: 'PROFILE' }
  ]) {
    await prisma.uiComponent.upsert({ where: { key: component.key }, create: { ...component, enabled: true }, update: {} });
  }
}

main().finally(() => prisma.$disconnect());
