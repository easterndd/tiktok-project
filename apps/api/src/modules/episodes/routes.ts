import type { PlayInfo } from '@breezereels/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { requireUser } from '../../plugins/auth';
import { isEpisodeFree, readAccessConfig } from '../../lib/content-access';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';

const params = z.object({ episodeId: z.string().min(1).max(128) });
const localeQuery = z.object({ locale: publicLocaleSchema.default(defaultLocale) });
const unlockInput = z.object({
  placementId: z.string().trim().min(1).max(128),
  clientEventId: z.string().trim().min(1).max(128),
  isEnded: z.literal(true),
  sessionId: z.string().trim().min(1).max(128).optional()
});

export async function registerEpisodeRoutes(app: FastifyInstance) {
  app.post('/episodes/:episodeId/reward-unlock', { preHandler: requireUser }, async (request, reply) => {
    const { episodeId } = params.parse(request.params);
    const input = unlockInput.parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      const episode = await tx.episode.findFirst({
        where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
        select: { id: true, isFree: true, episodeNo: true, album: { select: { accessConfig: true } } }
      });
      if (!episode) return { missing: true as const };
      if (isEpisodeFree(episode, episode.album.accessConfig)) return { access: 'PLAYABLE' as const };
      const accessConfig = readAccessConfig(episode.album.accessConfig);
      if (!accessConfig.rewardedAdEnabled) return { adDisabled: true as const };
      if (episode.album.accessConfig != null && input.placementId !== accessConfig.rewardedPlacementId) return { invalidPlacement: true as const };

      const event = await tx.adEvent.upsert({
        where: { userId_clientEventId: { userId: request.user.sub, clientEventId: input.clientEventId } },
        create: {
          userId: request.user.sub,
          clientEventId: input.clientEventId,
          adType: 'REWARDED',
          eventType: 'CLOSED_COMPLETED',
          placementId: input.placementId,
          episodeId,
          sessionId: input.sessionId
        },
        update: {}
      });
      if (event.episodeId !== episodeId || event.adType !== 'REWARDED' || event.eventType !== 'CLOSED_COMPLETED') {
        return { conflict: true as const };
      }
      await tx.episodeUnlock.upsert({
        where: { userId_episodeId: { userId: request.user.sub, episodeId } },
        create: { userId: request.user.sub, episodeId, unlockType: 'REWARDED_AD', placementId: input.placementId },
        update: {}
      });
      return { access: 'PLAYABLE' as const };
    });
    if ('missing' in result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;
    if ('adDisabled' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlocking is disabled for this drama.', requestId: request.id } }) as never;
    if ('invalidPlacement' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded ad placement does not match this drama configuration.', requestId: request.id } }) as never;
    if ('conflict' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'The client event id was already used for another episode.', requestId: request.id } }) as never;
    return { access: 'PLAYABLE' as const };
  });

  app.get('/episodes/:episodeId/play', async (request, reply): Promise<PlayInfo> => {
    const { episodeId } = params.parse(request.params);
    const { locale } = localeQuery.parse(request.query);
    const user = await optionalUser(request);
    const episode = await app.prisma.episode.findFirst({
      where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
      include: { album: { include: { translations: true } }, translations: true }
    });
    if (!episode) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;

    const unlocked = isEpisodeFree(episode, episode.album.accessConfig) || Boolean(user && await app.prisma.episodeUnlock.findUnique({
      where: { userId_episodeId: { userId: user.sub, episodeId } },
      select: { id: true }
    }));
    if (!unlocked) {
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sign in to unlock this episode.', requestId: request.id } }) as never;
      return reply.code(403).send({ error: { code: 'EPISODE_LOCKED', message: 'Watch a rewarded ad to unlock this episode.', requestId: request.id } }) as never;
    }
    if (!episode.album.tiktokAlbumId || !episode.tiktokEpisodeId || !episode.byteplusVid) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'This episode is not ready for platform playback.', requestId: request.id } }) as never;
    }
    const progress = user ? await app.prisma.watchProgress.findUnique({ where: { userId_episodeId: { userId: user.sub, episodeId } } }) : null;
    return {
      albumId: episode.album.tiktokAlbumId,
      episodeId: episode.tiktokEpisodeId,
      vid: episode.byteplusVid,
      playAuthToken: null,
      title: episode.translations.find((translation) => translation.locale === locale)?.title ?? episode.title,
      coverUrl: episode.translations.find((translation) => translation.locale === locale)?.coverUrl ?? episode.coverUrl,
      durationMs: episode.durationMs,
      resumePositionMs: progress?.positionMs ?? 0
    };
  });
}
