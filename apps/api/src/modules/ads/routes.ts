import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

export async function registerAdRoutes(app: FastifyInstance) {
  app.post('/ad-events', {
    preHandler: requireUser,
    config: { rateLimit: { max: 120, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const body = z.object({
      clientEventId: z.string().min(1).max(128),
      adType: z.enum(['REWARDED', 'INTERSTITIAL']),
      scope: z.enum(['EPISODE_UNLOCK', 'APP_ENTRY']).default('EPISODE_UNLOCK'),
      eventType: z.enum(['REQUESTED', 'SHOWN', 'CLOSED_INCOMPLETE', 'FAILED']),
      placementId: z.string().min(1).max(128),
      episodeId: z.string().min(1).max(128).optional(),
      sessionId: z.string().min(1).max(128).optional(),
      rewardSessionId: z.string().min(1).max(128).optional(),
      appEntrySessionId: z.string().min(1).max(128).optional(),
      adIndex: z.number().int().positive(),
      errorCode: z.string().max(128).optional()
    }).parse(request.body);
    if (body.scope === 'APP_ENTRY') {
      if (body.episodeId || body.rewardSessionId || !body.appEntrySessionId || body.sessionId !== body.appEntrySessionId) {
        throw Object.assign(new Error('Invalid app-entry ad event.'), { statusCode: 400 });
      }
      const session = await app.prisma.appEntryAdSession.findUnique({ where: { id: body.appEntrySessionId } });
      if (!session || session.userId !== request.user.sub || session.status !== 'ACTIVE' || session.expiresAt <= new Date() || session.placementId !== body.placementId || session.mode !== (body.adType === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED_GATED') || body.adIndex > session.requiredCount) {
        throw Object.assign(new Error('App-entry ad session is unavailable.'), { statusCode: 409 });
      }
    } else {
      if (body.adType !== 'REWARDED' || !body.episodeId || !body.rewardSessionId || body.appEntrySessionId || body.sessionId !== body.rewardSessionId) {
        throw Object.assign(new Error('Invalid episode-unlock ad event.'), { statusCode: 400 });
      }
      const session = await app.prisma.rewardedUnlockSession.findUnique({ where: { id: body.rewardSessionId } });
      if (!session || session.userId !== request.user.sub || session.episodeId !== body.episodeId || session.status !== 'ACTIVE' || session.expiresAt <= new Date() || session.placementId !== body.placementId || body.adIndex !== session.completedCount + 1) {
        throw Object.assign(new Error('Rewarded unlock session is unavailable.'), { statusCode: 409 });
      }
    }
    await app.prisma.adEvent.upsert({
      where: { userId_clientEventId: { userId: request.user.sub, clientEventId: body.clientEventId } },
      create: { ...body, userId: request.user.sub },
      update: {
        adType: body.adType,
        scope: body.scope,
        eventType: body.eventType,
        placementId: body.placementId,
        episodeId: body.episodeId,
        sessionId: body.sessionId,
        rewardSessionId: body.rewardSessionId,
        appEntrySessionId: body.appEntrySessionId,
        adIndex: body.adIndex,
        errorCode: body.errorCode
      }
    });
    return { accepted: true };
  });
  app.post('/playback-quality-events', { preHandler: requireUser }, async (request) => {
    const body = z.object({
      episodeId: z.string().min(1),
      eventType: z.enum(['FIRST_FRAME', 'WAITING', 'DEFINITION_CHANGE', 'ERROR', 'ENDED']),
      sessionId: z.string().min(8).max(128),
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
    const now = new Date();
    await app.prisma.$transaction(async (tx) => {
      await tx.playbackQualityEvent.create({ data: { ...body, userId: request.user.sub } });
      const existingSession = await tx.playbackSession.findUnique({ where: { id: body.sessionId }, select: { userId: true, episodeId: true } });
      if (existingSession && (existingSession.userId !== request.user.sub || existingSession.episodeId !== body.episodeId)) {
        throw Object.assign(new Error('Playback session does not belong to this user and episode.'), { statusCode: 409 });
      }
      if (existingSession) {
        await tx.playbackSession.update({
          where: { id: body.sessionId },
          data: {
            firstFrameAt: body.eventType === 'FIRST_FRAME' ? now : undefined,
            lastEventAt: now,
            endedAt: body.eventType === 'ENDED' ? now : undefined,
            completed: body.eventType === 'ENDED' ? true : undefined,
            lastPositionMs: body.currentTimeMs
          }
        });
      } else {
        await tx.playbackSession.create({
          data: {
            id: body.sessionId,
            userId: request.user.sub,
            episodeId: body.episodeId,
            firstFrameAt: body.eventType === 'FIRST_FRAME' ? now : undefined,
            lastEventAt: now,
            endedAt: body.eventType === 'ENDED' ? now : undefined,
            completed: body.eventType === 'ENDED',
            lastPositionMs: body.currentTimeMs ?? 0
          }
        });
      }
      if (body.eventType === 'ENDED') {
        await tx.episodeCompletionEvent.upsert({
          where: { userId_episodeId: { userId: request.user.sub, episodeId: body.episodeId } },
          create: { userId: request.user.sub, episodeId: body.episodeId, playbackSessionId: body.sessionId },
          update: {}
        });
      }
    });
    return { accepted: true };
  });
}
