import type { PlayInfo } from '@quickreels/shared-types';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { optionalUser } from '../../plugins/optional-auth';
import { BytePlusVodService } from '../../services/byteplus-vod.service';
import { requireUser } from '../../plugins/auth';
import { isEpisodeFree, readAccessConfig } from '../../lib/content-access';
import { defaultLocale, publicLocaleSchema } from '../../lib/locales';
import { isAlbumVisibleInCountry, requestCountry } from '../../lib/content-visibility';

const params = z.object({ episodeId: z.string().min(1).max(128) });
const sessionParams = params.extend({ sessionId: z.string().min(1).max(128) });
const localeQuery = z.object({ locale: publicLocaleSchema.default(defaultLocale) });
const unlockInput = z.object({
  clientEventId: z.string().trim().min(1).max(128),
  isEnded: z.literal(true)
});
const legacyUnlockInput = unlockInput.extend({
  placementId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128).optional()
});
const sessionTtlMs = 30 * 60 * 1000;

type RewardSessionStart =
  | { missing: true }
  | { adDisabled: true }
  | { access: 'PLAYABLE' }
  | { access: 'REWARDED_AD_REQUIRED'; sessionId: string; placementId: string };

type RewardSessionComplete =
  | { missing: true }
  | { adDisabled: true }
  | { invalidPlacement: true }
  | { invalidSession: true }
  | { invalidAdEvidence: true }
  | { access: 'PLAYABLE'; shouldContinue: false }
  | { access: 'REWARDED_AD_REQUIRED'; shouldContinue: true };

async function createOrResumeRewardSession(app: FastifyInstance, userId: string, episodeId: string, country: string | null): Promise<RewardSessionStart> {
  const now = new Date();
  const episode = await app.prisma.episode.findFirst({
    where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
    select: { id: true, isFree: true, episodeNo: true, album: { select: { accessConfig: true, regions: true } } }
  });
  if (!episode || !isAlbumVisibleInCountry(episode.album.regions, country)) return { missing: true };
  if (isEpisodeFree(episode, episode.album.accessConfig)) return { access: 'PLAYABLE' };
  const unlocked = await app.prisma.episodeUnlock.findUnique({ where: { userId_episodeId: { userId, episodeId } }, select: { id: true } });
  if (unlocked) return { access: 'PLAYABLE' };

  const accessConfig = readAccessConfig(episode.album.accessConfig);
  if (!accessConfig.rewardedAdEnabled) return { adDisabled: true };
  await app.prisma.rewardedUnlockSession.updateMany({
    where: { userId, episodeId, status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' }
  });
  let session = await app.prisma.rewardedUnlockSession.findFirst({
    where: { userId, episodeId, status: 'ACTIVE', expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' }
  });
  if (!session) {
    try {
      session = await app.prisma.rewardedUnlockSession.create({
        data: {
          userId,
          episodeId,
          placementId: accessConfig.rewardedPlacementId,
          requiredCount: accessConfig.rewardedAdCount,
          expiresAt: new Date(now.getTime() + sessionTtlMs)
        }
      });
    } catch (error) {
      // The partial unique index can win a race between two concurrent start requests.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      session = await app.prisma.rewardedUnlockSession.findFirst({
        where: { userId, episodeId, status: 'ACTIVE', expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' }
      });
      if (!session) throw error;
    }
  }
  return { access: 'REWARDED_AD_REQUIRED', sessionId: session.id, placementId: session.placementId };
}

async function completeRewardSession(app: FastifyInstance, userId: string, episodeId: string, sessionId: string, clientEventId: string, country: string | null): Promise<RewardSessionComplete> {
  return app.prisma.$transaction(async (tx) => {
    const now = new Date();
    const episode = await tx.episode.findFirst({
      where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
      select: { id: true, isFree: true, episodeNo: true, album: { select: { accessConfig: true, regions: true } } }
    });
    if (!episode || !isAlbumVisibleInCountry(episode.album.regions, country)) return { missing: true as const };
    if (isEpisodeFree(episode, episode.album.accessConfig)) return { access: 'PLAYABLE' as const, shouldContinue: false as const };
    const unlocked = await tx.episodeUnlock.findUnique({ where: { userId_episodeId: { userId, episodeId } }, select: { id: true } });
    if (unlocked) return { access: 'PLAYABLE' as const, shouldContinue: false as const };

    const session = await tx.rewardedUnlockSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.episodeId !== episodeId || session.status !== 'ACTIVE' || session.expiresAt <= now) return { invalidSession: true as const };

    const existingReward = await tx.rewardedUnlockReward.findUnique({ where: { sessionId_clientEventId: { sessionId, clientEventId } } });
    if (existingReward) {
      const current = await tx.rewardedUnlockSession.findUniqueOrThrow({ where: { id: sessionId } });
      return current.status === 'UNLOCKED' || current.completedCount >= current.requiredCount
        ? { access: 'PLAYABLE' as const, shouldContinue: false as const }
        : { access: 'REWARDED_AD_REQUIRED' as const, shouldContinue: true as const };
    }

    const adIndex = session.completedCount + 1;
    const shown = await tx.adEvent.findFirst({
      where: {
        userId,
        clientEventId,
        adType: 'REWARDED',
        scope: 'EPISODE_UNLOCK',
        eventType: 'SHOWN',
        placementId: session.placementId,
        episodeId,
        sessionId,
        rewardSessionId: sessionId,
        adIndex
      },
      select: { id: true }
    });
    if (!shown) return { invalidAdEvidence: true as const };

    const event = await tx.adEvent.upsert({
      where: { userId_clientEventId: { userId, clientEventId } },
      create: {
        userId,
        clientEventId,
        adType: 'REWARDED',
        scope: 'EPISODE_UNLOCK',
        eventType: 'CLOSED_COMPLETED',
        placementId: session.placementId,
        episodeId,
        sessionId,
        rewardSessionId: sessionId,
        adIndex
      },
      update: {
        adType: 'REWARDED',
        scope: 'EPISODE_UNLOCK',
        eventType: 'CLOSED_COMPLETED',
        placementId: session.placementId,
        episodeId,
        sessionId,
        rewardSessionId: sessionId,
        adIndex
      }
    });
    await tx.rewardedUnlockReward.create({ data: { sessionId, clientEventId, adIndex, adEventId: event.id } });
    const completedCount = adIndex;
    if (completedCount >= session.requiredCount) {
      await tx.episodeUnlock.upsert({
        where: { userId_episodeId: { userId, episodeId } },
        create: { userId, episodeId, unlockType: 'REWARDED_AD', placementId: session.placementId },
        update: {}
      });
      await tx.rewardedUnlockSession.update({ where: { id: sessionId }, data: { completedCount, status: 'UNLOCKED' } });
      return { access: 'PLAYABLE' as const, shouldContinue: false as const };
    }
    await tx.rewardedUnlockSession.update({ where: { id: sessionId }, data: { completedCount } });
    return { access: 'REWARDED_AD_REQUIRED' as const, shouldContinue: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function registerEpisodeRoutes(app: FastifyInstance) {
  app.post('/episodes/:episodeId/reward-session', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { episodeId } = params.parse(request.params);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const result = await createOrResumeRewardSession(app, request.user.sub, episodeId, country);
    if ('missing' in result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;
    if ('adDisabled' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlocking is disabled for this drama.', requestId: request.id } }) as never;
    return result;
  });

  app.post('/episodes/:episodeId/reward-session/:sessionId/complete', {
    preHandler: requireUser,
    config: { rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { episodeId, sessionId } = sessionParams.parse(request.params);
    const input = unlockInput.parse(request.body);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const result = await completeRewardSession(app, request.user.sub, episodeId, sessionId, input.clientEventId, country);
    if ('missing' in result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;
    if ('adDisabled' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlocking is disabled for this drama.', requestId: request.id } }) as never;
    if ('invalidPlacement' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded ad placement does not match this drama configuration.', requestId: request.id } }) as never;
    if ('invalidSession' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlock session is unavailable.', requestId: request.id } }) as never;
    if ('invalidAdEvidence' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A matching rewarded ad impression was not recorded.', requestId: request.id } }) as never;
    return result;
  });

  app.post('/episodes/:episodeId/reward-unlock', { preHandler: requireUser }, async (request, reply) => {
    const { episodeId } = params.parse(request.params);
    const input = legacyUnlockInput.parse(request.body);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const session = input.sessionId
      ? { access: 'REWARDED_AD_REQUIRED' as const, sessionId: input.sessionId, placementId: input.placementId }
      : await createOrResumeRewardSession(app, request.user.sub, episodeId, country);
    if ('missing' in session) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;
    if ('adDisabled' in session) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlocking is disabled for this drama.', requestId: request.id } }) as never;
    if (session.access === 'PLAYABLE') return { access: 'PLAYABLE' as const, shouldContinue: false };
    if (session.placementId !== input.placementId) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded ad placement does not match this drama configuration.', requestId: request.id } }) as never;
    const result = await completeRewardSession(app, request.user.sub, episodeId, session.sessionId, input.clientEventId, country);
    if ('missing' in result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;
    if ('adDisabled' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlocking is disabled for this drama.', requestId: request.id } }) as never;
    if ('invalidPlacement' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded ad placement does not match this drama configuration.', requestId: request.id } }) as never;
    if ('invalidSession' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Rewarded unlock session is unavailable.', requestId: request.id } }) as never;
    if ('invalidAdEvidence' in result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A matching rewarded ad impression was not recorded.', requestId: request.id } }) as never;
    return result;
  });

  app.get('/episodes/:episodeId/play', async (request, reply): Promise<PlayInfo> => {
    const { episodeId } = params.parse(request.params);
    const { locale } = localeQuery.parse(request.query);
    const user = await optionalUser(request);
    const country = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER);
    const episode = await app.prisma.episode.findFirst({
      where: { id: episodeId, status: 'ONLINE', album: { status: 'ONLINE' } },
      include: { album: { include: { translations: true } }, translations: true }
    });
    if (!episode || !isAlbumVisibleInCountry(episode.album.regions, country)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found.', requestId: request.id } }) as never;

    const unlocked = isEpisodeFree(episode, episode.album.accessConfig) || Boolean(user && await app.prisma.episodeUnlock.findUnique({
      where: { userId_episodeId: { userId: user.sub, episodeId } },
      select: { id: true }
    }));
    if (!unlocked) {
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sign in to unlock this episode.', requestId: request.id } }) as never;
      return reply.code(403).send({ error: { code: 'EPISODE_LOCKED', message: 'Watch a rewarded ad to unlock this episode.', requestId: request.id } }) as never;
    }
    const localPlaybackUrl = app.config.NODE_ENV !== 'production' && app.config.LOCAL_PLAYBACK_ENABLED
      ? episode.localPlaybackUrl
      : null;
    if (!localPlaybackUrl && (!episode.album.tiktokAlbumId || !episode.tiktokEpisodeId || !episode.byteplusVid)) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'This episode is not ready for platform playback.', requestId: request.id } }) as never;
    }
    const progress = user ? await app.prisma.watchProgress.findUnique({ where: { userId_episodeId: { userId: user.sub, episodeId } } }) : null;
    let playAuthToken: string | null = null;
    if (!localPlaybackUrl && app.config.BYTEPLUS_ACCESS_KEY && app.config.BYTEPLUS_SECRET_KEY) {
      try {
        playAuthToken = await new BytePlusVodService(app.config).getPlayAuthToken({ vid: episode.byteplusVid! });
      } catch (error) {
        request.log.warn({ error, episodeId }, 'BytePlus play auth token could not be generated.');
      }
    }
    return {
      playbackMode: localPlaybackUrl ? 'LOCAL' : 'BYTEPLUS',
      albumId: episode.album.tiktokAlbumId ?? `local-${episode.albumId}`,
      localEpisodeId: episode.id,
      episodeId: episode.tiktokEpisodeId ?? `local-${episode.id}`,
      vid: episode.byteplusVid ?? `local-${episode.id}`,
      playAuthToken,
      sourceUrl: localPlaybackUrl,
      title: episode.translations.find((translation) => translation.locale === locale)?.title ?? episode.title,
      coverUrl: episode.translations.find((translation) => translation.locale === locale)?.coverUrl ?? episode.coverUrl,
      durationMs: episode.durationMs,
      resumePositionMs: progress?.positionMs ?? 0
    };
  });
}
