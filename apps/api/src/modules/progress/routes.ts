import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { isAlbumVisibleInCountry, publicAlbumWhere, requestCountry } from '../../lib/content-visibility';

const progressInput = z.object({
  episodeId: z.string().min(1).max(128),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable().optional(),
  completed: z.boolean()
});

export async function registerProgressRoutes(app: FastifyInstance) {
  app.get('/me/watch-progress', { preHandler: requireUser }, async (request) => {
    const items = await app.prisma.watchProgress.findMany({
      where: { userId: request.user.sub, episode: { status: 'ONLINE', album: publicAlbumWhere(app.config) } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      include: { episode: true }
    });
    return { items };
  });

  app.put('/me/watch-progress', { preHandler: requireUser }, async (request, reply) => {
    const input = progressInput.parse(request.body);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const episode = await app.prisma.episode.findFirst({ where: { id: input.episodeId, status: 'ONLINE', album: publicAlbumWhere(app.config) }, select: { durationMs: true, album: { select: { regions: true } } } });
    if (!episode || !isAlbumVisibleInCountry(episode.album.regions, country)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } });
    const maxDuration = episode.durationMs ?? input.durationMs;
    if (maxDuration !== null && maxDuration !== undefined && input.positionMs > maxDuration) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Playback position exceeds duration.', requestId: request.id } });
    }
    await app.prisma.watchProgress.upsert({
      where: { userId_episodeId: { userId: request.user.sub, episodeId: input.episodeId } },
      create: { userId: request.user.sub, ...input },
      update: input
    });
    return reply.code(204).send();
  });
}
