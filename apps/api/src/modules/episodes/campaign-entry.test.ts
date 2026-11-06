import assert from 'node:assert/strict';
import { it } from 'node:test';
import Fastify from 'fastify';
import { normalizeCampaignEntryBase } from '../../lib/campaign-entry';
import { registerEpisodeRoutes } from './routes';

it('validates a per-app TikTok Minis base and removes episode parameters', () => {
  assert.equal(
    normalizeCampaignEntryBase('https://www.tiktok.com/minis/app123?source=ads&album_id=old&episode_id=old'),
    'https://www.tiktok.com/minis/app123?source=ads'
  );
  assert.throws(() => normalizeCampaignEntryBase('https://www.tiktok.com/minis/undefined'));
  assert.throws(() => normalizeCampaignEntryBase('https://example.com/minis/app123'));
  assert.throws(() => normalizeCampaignEntryBase('http://www.tiktok.com/minis/app123'));
  assert.throws(() => normalizeCampaignEntryBase('https://www.tiktok.com/other/app123'));
});

it('resolves only a published free episode authorized in this Mini app', async () => {
  const app = Fastify();
  let freeCount = 1;
  let authorization: string | null = null;
  const episode = {
    id: 'local-episode', albumId: 'local-album', episodeNo: 1, isFree: false,
    album: { accessConfig: { freeEpisodeCount: 1 }, regions: null }
  };
  app.decorate('config', { MINI_APP_KEY: 'main', NODE_ENV: 'test', LOCAL_PLAYBACK_ENABLED: true, TRUST_GEO_COUNTRY_HEADER: false } as any);
  app.decorate('prisma', { episode: { findFirst: async ({ where }: any) => {
    if (where.tiktokEpisodeId !== 'platform-episode' || where.album.tiktokAlbumId !== 'platform-album') return null;
    return { ...episode, album: { ...episode.album, accessConfig: { freeEpisodeCount: freeCount } } };
  } } } as any);
  app.decorate('sharedPrisma', { miniAppAlbumAuthorization: { findFirst: async () => authorization ? { status: authorization } : null } } as any);
  await registerEpisodeRoutes(app);
  try {
    const path = '/campaign-entry/resolve?album_id=platform-album&episode_id=platform-episode';
    assert.deepEqual((await app.inject(path)).json(), { status: 'PLAYABLE', albumId: 'local-album', episodeId: 'local-episode' });
    assert.deepEqual((await app.inject('/campaign-entry/resolve?album_id=wrong&episode_id=platform-episode')).json(), { status: 'INVALID' });
    freeCount = 0;
    assert.deepEqual((await app.inject(path)).json(), { status: 'INVALID' });
    freeCount = 1;
    authorization = 'REVOKED';
    assert.deepEqual((await app.inject(path)).json(), { status: 'INVALID' });
  } finally {
    await app.close();
  }
});
