import type { AlbumDetail, AlbumSummary, CursorPage, EpisodeSummary } from '@breezereels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const params = z.object({ albumId: z.string().cuid() });

function toSummary(album: { id: string; title: string; description: string; coverUrl: string; updatedAt: Date; _count: { episodes: number } }): AlbumSummary {
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    coverUrl: album.coverUrl,
    episodeCount: album._count.episodes,
    updatedAt: album.updatedAt.toISOString()
  };
}

export async function registerAlbumRoutes(app: FastifyInstance) {
  app.get('/albums', async (): Promise<CursorPage<AlbumSummary>> => {
    const albums = await app.prisma.album.findMany({
      where: { status: 'ONLINE' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: { _count: { select: { episodes: { where: { status: 'ONLINE' } } } } }
    });
    return { items: albums.map(toSummary), nextCursor: null };
  });

  app.get('/albums/:albumId', async (request, reply): Promise<AlbumDetail> => {
    const { albumId } = params.parse(request.params);
    const album = await app.prisma.album.findFirst({
      where: { id: albumId, status: 'ONLINE' },
      include: { _count: { select: { episodes: { where: { status: 'ONLINE' } } } } }
    });
    if (!album) return reply.code(404).send() as never;
    const regions = Array.isArray(album.regions) ? album.regions.filter((value: unknown): value is string => typeof value === 'string') : null;
    return { ...toSummary(album), language: album.language, regions };
  });

  app.get('/albums/:albumId/episodes', async (request, reply): Promise<{ items: EpisodeSummary[] }> => {
    const { albumId } = params.parse(request.params);
    const exists = await app.prisma.album.findFirst({ where: { id: albumId, status: 'ONLINE' }, select: { id: true } });
    if (!exists) return reply.code(404).send() as never;
    const episodes = await app.prisma.episode.findMany({ where: { albumId, status: 'ONLINE' }, orderBy: { sortOrder: 'asc' } });
    return {
      items: episodes.map((episode: { id: string; episodeNo: number; title: string; durationMs: number | null; isFree: boolean }) => ({
        id: episode.id,
        episodeNo: episode.episodeNo,
        title: episode.title,
        durationMs: episode.durationMs,
        isFree: episode.isFree,
        access: episode.isFree ? 'PLAYABLE' : 'REWARDED_AD_REQUIRED'
      }))
    };
  });
}
