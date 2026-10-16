import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { miniAppAdConfig } from '../../config/mini-apps';

const policyId = 'default';
const sessionTtlMs = 15 * 60 * 1000;
const releaseIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default('default');
const startInput = z.object({ launchId: z.string().uuid(), releaseId: releaseIdSchema });
const completionInput = z.object({ clientEventId: z.string().uuid(), isEnded: z.boolean() });
const sessionParams = z.object({ sessionId: z.string().min(1).max(128) });

function disabledPolicy(app: FastifyInstance, releaseId = 'default') {
  return {
    id: releaseId === 'default' ? policyId : `release:${releaseId}`,
    releaseId,
    enabled: false,
    mode: 'INTERSTITIAL' as const,
    placementId: miniAppAdConfig(app.config).appEntryPlacementId,
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

export async function registerAppEntryAdRoutes(app: FastifyInstance) {
  app.post('/app-entry-ad-sessions', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const { launchId, releaseId } = startInput.parse(request.body);
    const policy = await readAppEntryAdPolicy(app, releaseId);
    if (!policy.enabled) return { required: false as const };
    const now = new Date();

    const existing = await app.prisma.appEntryAdSession.findUnique({
      where: { userId_releaseId_launchId: { userId: request.user.sub, releaseId, launchId } }
    });
    if (existing) {
      if (existing.status === 'COMPLETED' || existing.completedCount >= existing.requiredCount) return sessionResponse(existing, policy.onUnavailable);
      if (existing.expiresAt > now && existing.status === 'ACTIVE') return sessionResponse(existing, policy.onUnavailable);

      const renewed = await app.prisma.appEntryAdSession.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          expiresAt: new Date(now.getTime() + sessionTtlMs)
        }
      });
      return sessionResponse(renewed, policy.onUnavailable);
    }

    let session;
    try {
      session = await app.prisma.appEntryAdSession.create({
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
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      session = await app.prisma.appEntryAdSession.findUnique({ where: { userId_releaseId_launchId: { userId: request.user.sub, releaseId, launchId } } });
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

      const adIndex = session.completedCount + 1;
      if (!isEnded && session.countMode === 'COMPLETED') {
        const closed = await tx.adEvent.findFirst({
          where: { userId: request.user.sub, clientEventId, scope: 'APP_ENTRY', eventType: 'CLOSED_INCOMPLETE', appEntrySessionId: sessionId, adIndex, adType: 'REWARDED', placementId: session.placementId },
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
          adIndex,
          adType: session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED',
          placementId: session.placementId
        },
        select: { id: true }
      });
      if (!shown) return null;
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
      await tx.appEntryAdSession.update({ where: { id: sessionId }, data: { completedCount, status } });
      return { completedCount, requiredCount: session.requiredCount, shouldContinue: status === 'ACTIVE', retryCurrent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let result: Awaited<ReturnType<typeof transact>> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await transact();
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
      }
    }

    if (!result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    return { ...result, access: result.shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
  });
}
