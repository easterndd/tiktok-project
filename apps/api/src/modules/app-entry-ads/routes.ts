import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { miniAppAdConfig } from '../../config/mini-apps';
import { measureDatabase } from '../../lib/request-performance';
import { isEntryAdIpExempt, queueSharedIpVisit } from '../../services/shared-ip.service';
import { classifyLaunchAttribution } from '../../services/launch-attribution.service';
import { requestCountry } from '../../lib/content-visibility';

const policyId = 'default';
const sessionTtlMs = 15 * 60 * 1000;
const releaseIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default('default');
const startInput = z.object({ launchId: z.string().uuid(), releaseId: releaseIdSchema, adId: z.string().trim().max(128).nullable().optional() });
const completionInput = z.object({ clientEventId: z.string().uuid(), isEnded: z.boolean() });
const sessionParams = z.object({ sessionId: z.string().min(1).max(128) });

function disabledPolicy(app: FastifyInstance, releaseId = 'default') {
  const placements = miniAppAdConfig(app.config);
  const mode = placements.appEntryPlacementId ? 'INTERSTITIAL' as const : 'REWARDED_GATED' as const;
  return {
    id: releaseId === 'default' ? policyId : `release:${releaseId}`,
    releaseId,
    enabled: false,
    exitRetentionEnabled: false,
    exitRetentionAdCount: 1,
    mode,
    placementId: mode === 'INTERSTITIAL' ? placements.appEntryPlacementId : placements.rewardedPlacementId,
    requiredCount: 1,
    countMode: 'COMPLETED' as const,
    onUnavailable: 'ALLOW' as const,
    version: 1
  };
}

export type AppEntryAdPolicyInput = ReturnType<typeof disabledPolicy>;

function sessionResponse(session: { id: string; mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; requiredCount: number; countMode: 'COMPLETED' | 'SHOWN'; completedCount: number; status: string }, fallback: 'ALLOW' | 'BLOCK') {
  if (session.status === 'COMPLETED' || session.completedCount >= session.requiredCount) return { required: false as const };
  return {
    required: true as const,
    sessionId: session.id,
    mode: session.mode,
    placementId: session.placementId,
    requiredCount: session.requiredCount,
    countMode: session.countMode,
    completedCount: session.completedCount,
    onUnavailable: fallback
  };
}

export async function readAppEntryAdPolicy(app: FastifyInstance, releaseId = 'default') {
  return await app.prisma.appEntryAdPolicy.findUnique({ where: { releaseId } })
    ?? disabledPolicy(app, releaseId);
}

export async function readExitRetentionConfig(app: FastifyInstance, releaseId: string, userId: string, ip: string) {
  const policy = await readAppEntryAdPolicy(app, releaseId);
  const placementId = miniAppAdConfig(app.config).rewardedPlacementId;
  if (!policy.exitRetentionEnabled || !placementId) return { enabled: false as const };
  const [ipExempt, viewer] = await Promise.all([
    isEntryAdIpExempt(app.sharedPrisma, ip),
    app.prisma.user.findUnique({ where: { id: userId }, select: { appEntryAdExempt: true, mergedIntoUserId: true } })
  ]);
  if (ipExempt || viewer?.appEntryAdExempt) return { enabled: false as const };
  if (viewer?.mergedIntoUserId) {
    const canonical = await app.prisma.user.findUnique({ where: { id: viewer.mergedIntoUserId }, select: { appEntryAdExempt: true } });
    if (canonical?.appEntryAdExempt) return { enabled: false as const };
  }
  return { enabled: true as const, placementId, requiredCount: policy.exitRetentionAdCount };
}

export async function registerAppEntryAdRoutes(app: FastifyInstance) {
  app.get('/exit-retention/config', { preHandler: requireUser }, async (request) => {
    const { releaseId } = z.object({ releaseId: releaseIdSchema }).parse(request.query);
    return measureDatabase(request, () => readExitRetentionConfig(app, releaseId, request.user.sub, request.ip));
  });
  app.post('/app-entry-ad-sessions', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const { launchId, releaseId, adId } = startInput.parse(request.body);
    queueSharedIpVisit(app.sharedPrisma, {
      ipAddress: request.ip, miniAppKey: app.config.MINI_APP_KEY, userId: request.user.sub, clientSessionId: launchId,
      countryCode: requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress),
      secret: app.rootConfig.JWT_SECRET
    }, (error) => request.log.warn({ err: error }, 'Shared IP visit could not be recorded'));
    let attribution;
    if (adId !== undefined) {
      attribution = classifyLaunchAttribution({ launchQuery: adId === null ? {} : { adId } });
    } else {
      const latestLaunch = await measureDatabase(request, () => app.prisma.audienceActivityEvent.findFirst({
        where: { userId: request.user.sub, eventType: 'APP_LAUNCH_CONTEXT' },
        orderBy: { createdAt: 'desc' }, select: { metadata: true }
      }));
      attribution = classifyLaunchAttribution(latestLaunch?.metadata);
    }
    if (attribution.status !== 'ATTRIBUTED') return { required: false as const };
    const saved = await measureDatabase(request, () => app.prisma.appEntryAdPolicy.findUnique({ where: { releaseId } }));
    let policy = saved ?? disabledPolicy(app, releaseId);
    if (!saved && (releaseId === 'default' || releaseId.startsWith(`${app.config.MINI_APP_KEY}-`))) {
      try {
        policy = await measureDatabase(request, () => app.prisma.appEntryAdPolicy.create({ data: { ...disabledPolicy(app, releaseId), firstSeenAt: new Date() } }));
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        policy = await measureDatabase(request, () => readAppEntryAdPolicy(app, releaseId));
      }
    }
    if (saved && !saved.firstSeenAt) await measureDatabase(request, () => app.prisma.appEntryAdPolicy.updateMany({ where: { releaseId, firstSeenAt: null }, data: { firstSeenAt: new Date() } }));
    if (!policy.enabled) return { required: false as const };
    const [ipExempt, viewer] = await Promise.all([
      measureDatabase(request, () => isEntryAdIpExempt(app.sharedPrisma, request.ip)).catch((error) => {
        request.log.warn({ err: error }, 'Shared IP exemption lookup failed; applying entry-ad policy');
        return false;
      }),
      measureDatabase(request, () => app.prisma.user.findUnique({ where: { id: request.user.sub }, select: { appEntryAdExempt: true, mergedIntoUserId: true } }))
    ]);
    if (ipExempt) return { required: false as const };
    if (viewer?.appEntryAdExempt) return { required: false as const };
    if (viewer?.mergedIntoUserId) {
      const canonical = await measureDatabase(request, () => app.prisma.user.findUnique({ where: { id: viewer.mergedIntoUserId! }, select: { appEntryAdExempt: true } }));
      if (canonical?.appEntryAdExempt) return { required: false as const };
    }
    const now = new Date();

    const existing = await measureDatabase(request, () => app.prisma.appEntryAdSession.findUnique({
      where: { userId_releaseId_launchId: { userId: request.user.sub, releaseId, launchId } }
    }));
    if (existing) {
      if (existing.status === 'COMPLETED' || existing.completedCount >= existing.requiredCount) return sessionResponse(existing, policy.onUnavailable);
      if (existing.expiresAt > now && existing.status === 'ACTIVE') return sessionResponse(existing, policy.onUnavailable);

      const renewed = await measureDatabase(request, () => app.prisma.appEntryAdSession.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          expiresAt: new Date(now.getTime() + sessionTtlMs)
        }
      }));
      return sessionResponse(renewed, policy.onUnavailable);
    }

    let session;
    try {
      session = await measureDatabase(request, () => app.prisma.appEntryAdSession.create({
        data: {
          userId: request.user.sub,
          releaseId,
          launchId,
          policyVersion: policy.version,
          placementId: policy.placementId,
          mode: policy.mode,
          requiredCount: policy.requiredCount,
          countMode: policy.countMode,
          expiresAt: new Date(now.getTime() + sessionTtlMs)
        }
      }));
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      session = await measureDatabase(request, () => app.prisma.appEntryAdSession.findUnique({ where: { userId_releaseId_launchId: { userId: request.user.sub, releaseId, launchId } } }));
      if (!session) throw error;
    }
    return sessionResponse(session, policy.onUnavailable);
  });

  app.post('/app-entry-ad-sessions/:sessionId/complete', {
    preHandler: requireUser,
    config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { sessionId } = sessionParams.parse(request.params);
    const { clientEventId, isEnded } = completionInput.parse(request.body);
    const transact = () => app.prisma.$transaction(async (tx) => {
      const session = await tx.appEntryAdSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== request.user.sub) return null;

      const completion = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_clientEventId: { sessionId, clientEventId } } });
      if (completion) {
        return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: session.completedCount < session.requiredCount, retryCurrent: false };
      }
      if (session.status !== 'ACTIVE' || session.expiresAt <= new Date()) return null;
      if (!isEnded && session.countMode === 'COMPLETED') {
        const closed = await tx.adEvent.findFirst({
          where: { userId: request.user.sub, clientEventId, scope: 'APP_ENTRY', eventType: 'CLOSED_INCOMPLETE', appEntrySessionId: sessionId, adType: 'REWARDED', placementId: session.placementId },
          select: { id: true }
        });
        if (closed) return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: true, retryCurrent: true };
      }
      const shown = await tx.adEvent.findFirst({
        where: {
          userId: request.user.sub,
          clientEventId,
          scope: 'APP_ENTRY',
          eventType: 'SHOWN',
          appEntrySessionId: sessionId,
          adType: session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED',
          placementId: session.placementId
        },
        select: { id: true, adIndex: true }
      });
      if (!shown) return { retryShownAcknowledgement: true as const };
      const adIndex = shown.adIndex;
      if (adIndex == null) return null;
      const indexCompletion = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_adIndex: { sessionId, adIndex } } });
      if (indexCompletion) {
        return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: session.completedCount < session.requiredCount, retryCurrent: false };
      }
      if (session.status !== 'ACTIVE' || session.expiresAt <= new Date() || adIndex !== session.completedCount + 1) return null;
      if (!isEnded && session.countMode === 'COMPLETED') {
        await tx.adEvent.update({ where: { id: shown.id }, data: { eventType: 'CLOSED_INCOMPLETE' } });
        return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: true, retryCurrent: true };
      }
      const event = await tx.adEvent.upsert({
        where: { userId_clientEventId: { userId: request.user.sub, clientEventId } },
        create: { userId: request.user.sub, clientEventId, adType: session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED', scope: 'APP_ENTRY', eventType: isEnded ? 'CLOSED_COMPLETED' : 'CLOSED_INCOMPLETE', placementId: session.placementId, sessionId, appEntrySessionId: sessionId, adIndex },
        update: { scope: 'APP_ENTRY', eventType: isEnded ? 'CLOSED_COMPLETED' : 'CLOSED_INCOMPLETE', placementId: session.placementId, sessionId, appEntrySessionId: sessionId, adIndex }
      });
      await tx.appEntryAdCompletion.create({ data: { sessionId, clientEventId, adIndex, adEventId: event.id } });
      const completedCount = adIndex;
      const status = completedCount >= session.requiredCount ? 'COMPLETED' as const : 'ACTIVE' as const;
      await tx.appEntryAdSession.update({ where: { id: sessionId }, data: { completedCount, status, expiresAt: new Date(Date.now() + sessionTtlMs) } });
      return { completedCount, requiredCount: session.requiredCount, shouldContinue: status === 'ACTIVE', retryCurrent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let result: Awaited<ReturnType<typeof transact>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        result = await measureDatabase(request, transact);
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, 25 * 2 ** attempt)));
      }
    }

    if (!result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    if ('retryShownAcknowledgement' in result) {
      return reply.code(409).send({ error: { code: 'AD_NOT_ACKNOWLEDGED', message: 'The ad impression has not been acknowledged yet.', requestId: request.id } });
    }
    return { ...result, access: result.shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
  });
}
