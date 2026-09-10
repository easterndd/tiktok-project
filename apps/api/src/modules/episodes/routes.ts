import type { PlayInfo } from '@breezereels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';

const params = z.object({ episodeId: z.string().cuid() });

export async function registerEpisodeRoutes(app: FastifyInstance) {
  app.get('/episodes/:episodeId/play', { preHandler: requireUser }, async (request, reply): Promise<PlayInfo> => {
    const { episodeId } = params.parse(request.params);
    const episode = await app.prisma.episode.findFirst({
      where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
      include: { album: true }
    });
    if (!episode) return reply.code(404).send() as never;

    const unlocked = episode.isFree || Boolean(await app.prisma.episodeUnlock.findUnique({
      where: { userId_episodeId: { userId: request.user.sub, episodeId } },
      select: { id: true }
    }));
    if (!unlocked) return reply.code(403).send({ error: { code: 'EPISODE_LOCKED', message: 'Watch a rewarded ad to unlock this episode.', requestId: request.id } }) as never;
    if (!episode.album.tiktokAlbumId || !episode.tiktokEpisodeId || !episode.byteplusVid) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'This episode is not ready for platform playback.', requestId: request.id } }) as never;
    }
    const progress = await app.prisma.watchProgress.findUnique({ where: { userId_episodeId: { userId: request.user.sub, episodeId } } });
    return {
      albumId: episode.album.tiktokAlbumId,
      episodeId: episode.tiktokEpisodeId,
      vid: episode.byteplusVid,
      playAuthToken: null,
      title: episode.title,
      coverUrl: episode.coverUrl,
      durationMs: episode.durationMs,
      resumePositionMs: progress?.positionMs ?? 0
    };
  });
}
