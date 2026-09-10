import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';

const progressInput = z.object({
  episodeId: z.string().cuid(),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable().optional(),
  completed: z.boolean()
});

export async function registerProgressRoutes(app: FastifyInstance) {
  app.put('/me/watch-progress', { preHandler: requireUser }, async (request, reply) => {
    const input = progressInput.parse(request.body);
    const episode = await app.prisma.episode.findFirst({ where: { id: input.episodeId, status: 'ONLINE' }, select: { durationMs: true } });
    if (!episode) return reply.code(404).send();
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
