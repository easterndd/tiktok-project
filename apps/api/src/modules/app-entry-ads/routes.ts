import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';

const policyId = 'default';
const sessionTtlMs = 15 * 60 * 1000;
const startInput = z.object({ launchId: z.string().uuid() });
const completionInput = z.object({ clientEventId: z.string().uuid(), isEnded: z.literal(true) });
const sessionParams = z.object({ sessionId: z.string().min(1).max(128) });

const disabledPolicy = {
  id: policyId,
  enabled: false,
  mode: 'INTERSTITIAL' as const,
  placementId: 'ad7686459458972829697',
  requiredCount: 1,
  onUnavailable: 'ALLOW' as const,
  version: 1
};

export type AppEntryAdPolicyInput = typeof disabledPolicy;

function sessionResponse(session: { id: string; mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; requiredCount: number; completedCount: number; status: string }, fallback: 'ALLOW' | 'BLOCK') {
  if (session.status === 'COMPLETED' || session.completedCount >= session.requiredCount) return { required: false as const };
  return {
    required: true as const,
    sessionId: session.id,
    mode: session.mode,
    placementId: session.placementId,
    requiredCount: session.requiredCount,
    completedCount: session.completedCount,
    onUnavailable: fallback
  };
}

export async function readAppEntryAdPolicy(app: FastifyInstance) {
  return await app.prisma.appEntryAdPolicy.findUnique({ where: { id: policyId } })
    ?? (app.config.MINI_APP_KEY === 'xu03' ? { ...disabledPolicy, placementId: '' } : disabledPolicy);
}

export async function registerAppEntryAdRoutes(app: FastifyInstance) {
  app.post('/app-entry-ad-sessions', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const { launchId } = startInput.parse(request.body);
    const policy = await readAppEntryAdPolicy(app);
    if (!policy.enabled) return { required: false as const };
    const now = new Date();

    const existing = await app.prisma.appEntryAdSession.findUnique({
      where: { userId_launchId: { userId: request.user.sub, launchId } }
    });
    if (existing) {
      if (existing.status === 'COMPLETED' || existing.completedCount >= existing.requiredCount) return sessionResponse(existing, policy.onUnavailable);
      if (existing.expiresAt > now && existing.status === 'ACTIVE') return sessionResponse(existing, policy.onUnavailable);

      const renewed = await app.prisma.appEntryAdSession.update({
        where: { id: existing.id },
        data: {
          policyVersion: policy.version,
          placementId: policy.placementId,
          mode: policy.mode,
          requiredCount: policy.requiredCount,
          completedCount: 0,
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
          launchId,
          policyVersion: policy.version,
          placementId: policy.placementId,
          mode: policy.mode,
          requiredCount: policy.requiredCount,
          expiresAt: new Date(now.getTime() + sessionTtlMs)
        }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      session = await app.prisma.appEntryAdSession.findUnique({ where: { userId_launchId: { userId: request.user.sub, launchId } } });
      if (!session) throw error;
    }
    return sessionResponse(session, policy.onUnavailable);
  });

  app.post('/app-entry-ad-sessions/:sessionId/complete', {
    preHandler: requireUser,
    config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { sessionId } = sessionParams.parse(request.params);
    const { clientEventId } = completionInput.parse(request.body);
    const result = await app.prisma.$transaction(async (tx) => {
      const session = await tx.appEntryAdSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== request.user.sub || session.status !== 'ACTIVE' || session.expiresAt <= new Date()) return null;

      const completion = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_clientEventId: { sessionId, clientEventId } } });
      if (completion) {
        const current = await tx.appEntryAdSession.findUniqueOrThrow({ where: { id: sessionId } });
        return { completedCount: current.completedCount, requiredCount: current.requiredCount, shouldContinue: current.completedCount < current.requiredCount };
      }

      const adIndex = session.completedCount + 1;
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
      const event = await tx.adEvent.upsert({
        where: { userId_clientEventId: { userId: request.user.sub, clientEventId } },
        create: { userId: request.user.sub, clientEventId, adType: session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED', scope: 'APP_ENTRY', eventType: 'CLOSED_COMPLETED', placementId: session.placementId, sessionId, appEntrySessionId: sessionId, adIndex },
        update: { scope: 'APP_ENTRY', eventType: 'CLOSED_COMPLETED', placementId: session.placementId, sessionId, appEntrySessionId: sessionId, adIndex }
      });
      await tx.appEntryAdCompletion.create({ data: { sessionId, clientEventId, adIndex, adEventId: event.id } });
      const completedCount = adIndex;
      const status = completedCount >= session.requiredCount ? 'COMPLETED' as const : 'ACTIVE' as const;
      await tx.appEntryAdSession.update({ where: { id: sessionId }, data: { completedCount, status } });
      return { completedCount, requiredCount: session.requiredCount, shouldContinue: status === 'ACTIVE' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!result) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    return { ...result, access: result.shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
  });
}
