import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

export async function registerAdRoutes(app: FastifyInstance) {
  app.post('/ad-events', { preHandler: requireUser }, async (request) => {
    const body = z.object({ clientEventId: z.string().min(1).max(128).optional(), adType: z.enum(['REWARDED', 'INTERSTITIAL']), eventType: z.enum(['REQUESTED', 'SHOWN', 'CLOSED_COMPLETED', 'CLOSED_INCOMPLETE', 'FAILED']), placementId: z.string().min(1), episodeId: z.string().min(1).max(128).optional(), sessionId: z.string().optional(), errorCode: z.string().optional() }).parse(request.body);
    if (body.clientEventId) {
      await app.prisma.adEvent.upsert({
        where: { userId_clientEventId: { userId: request.user.sub, clientEventId: body.clientEventId } },
        create: { ...body, userId: request.user.sub },
        update: {}
      });
    } else {
      await app.prisma.adEvent.create({ data: { ...body, userId: request.user.sub } });
    }
    return { accepted: true };
  });
  app.post('/playback-quality-events', { preHandler: requireUser }, async (request) => {
    const body = z.object({
      episodeId: z.string().min(1),
      eventType: z.enum(['FIRST_FRAME', 'WAITING', 'DEFINITION_CHANGE', 'ERROR', 'ENDED']),
      sessionId: z.string().max(128).optional(),
      startupMs: z.number().int().nonnegative().optional(),
      currentTimeMs: z.number().int().nonnegative().optional(),
      bufferMs: z.number().int().nonnegative().optional(),
      networkType: z.string().max(32).optional(),
      definition: z.string().max(32).optional(),
      clientVersion: z.string().max(64).optional(),
      errorCode: z.string().max(128).optional()
    }).parse(request.body);
    const episode = await app.prisma.episode.findFirst({ where: { id: body.episodeId, status: 'ONLINE', album: { status: 'ONLINE' } }, select: { id: true, album: { select: { regions: true } } } });
    if (!episode || !isAlbumVisibleInCountry(episode.album.regions, requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER))) throw Object.assign(new Error('Episode not found.'), { statusCode: 404 });
    await app.prisma.playbackQualityEvent.create({ data: { ...body, userId: request.user.sub } });
    return { accepted: true };
  });
}
