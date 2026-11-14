import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth';
import { miniAppAdConfig } from '../../config/mini-apps';
import { measureDatabase, sampleResponseLog, type ResponseLogSampleCache } from '../../lib/request-performance';
import { serialByKey, singleFlight } from '../../lib/single-flight';
import { isEntryAdIpExempt, queueSharedIpVisit } from '../../services/shared-ip.service';
import { classifyLaunchAttribution } from '../../services/launch-attribution.service';
import { requestCountry } from '../../lib/content-visibility';
import { isV006Release, resolveAdPlacementPolicy, sessionAllowedPlacementIds, type AdClientPlatform } from '../ads/ad-placement-policy';

const policyId = 'default';
const sessionTtlMs = 15 * 60 * 1000;
const policyCacheTtlMs = 5_000;
const releaseIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default('default');
const startInput = z.object({ launchId: z.string().uuid(), releaseId: releaseIdSchema, adId: z.string().trim().max(128).nullable().optional(), platform: z.enum(['ios', 'android', 'unknown']).optional() });
const completionInput = z.object({ clientEventId: z.string().uuid(), isEnded: z.boolean() });
const shownInput = z.object({ clientEventId: z.string().uuid(), adIndex: z.number().int().positive(), placementId: z.string().trim().min(1).max(128).optional() });
const sessionParams = z.object({ sessionId: z.string().min(1).max(128) });

type PolicyRecord = Awaited<ReturnType<FastifyInstance['prisma']['appEntryAdPolicy']['findUnique']>>;
type PolicyValue = NonNullable<PolicyRecord> | ReturnType<typeof disabledPolicy>;
type PolicyCacheEntry = { policy: PolicyValue; saved: PolicyRecord; expiresAt: number };

const policyCache = new WeakMap<FastifyInstance, Map<string, PolicyCacheEntry>>();
const completionLogSamples = new WeakMap<FastifyInstance, ResponseLogSampleCache>();

function logCompletionSample(app: FastifyInstance, request: FastifyRequest, key: string, details: Record<string, unknown>, message: string) {
  let samples = completionLogSamples.get(app);
  if (!samples) {
    samples = new Map();
    completionLogSamples.set(app, samples);
  }
  const suppressed = sampleResponseLog(samples, key, Date.now(), 10_000, 32);
  if (suppressed === null) return;
  request.log.warn({ miniAppKey: app.config.MINI_APP_KEY, route: 'entry-ad-complete', ...details, suppressed }, message);
}

function disabledPolicy(app: FastifyInstance, releaseId = 'default') {
  const placements = miniAppAdConfig(app.config);
  const mode = placements.appEntryPlacementId ? 'INTERSTITIAL' as const : 'REWARDED_GATED' as const;
  const v005 = ['bloomreel', 'quillshort', 'amberplay', 'nimbusclip', 'runereel'].includes(app.config.MINI_APP_KEY)
    && releaseId.startsWith(`${app.config.MINI_APP_KEY}-v005-`);
  return {
    id: releaseId === 'default' ? policyId : `release:${releaseId}`,
    releaseId,
    enabled: false,
    exitRetentionEnabled: false,
    exitRetentionAdCount: 1,
    episodeInterstitialEnabled: !isV006Release(releaseId),
    episodeInterstitialInitialDelaySeconds: 30,
    episodeInterstitialIntervalSeconds: v005 ? 40 : 60,
    episodeInterstitialMinIntervalSeconds: v005 ? 40 : 180,
    episodeInterstitialMaxPerSession: v005 ? 20 : 2,
    episodeInterstitialInitialSkipTransitions: v005 ? 100 : 2,
    episodeInterstitialEveryTransitions: 3,
    episodeInterstitialRewardedCooldownSeconds: 60,
    mode,
    placementId: mode === 'INTERSTITIAL' ? placements.appEntryPlacementId : placements.rewardedPlacementId,
    requiredCount: 1,
    countMode: 'COMPLETED' as const,
    onUnavailable: 'ALLOW' as const,
    version: 1
  };
}

export type AppEntryAdPolicyInput = ReturnType<typeof disabledPolicy>;

function sessionResponse(session: { id: string; releaseId?: string; mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; allowedPlacementIds?: string[]; placementPolicyVersion?: number; adLoadMode?: string; strategyVariant?: string; requiredCount: number; countMode: 'COMPLETED' | 'SHOWN'; completedCount: number; status: string }, fallback: 'ALLOW' | 'BLOCK') {
  if (session.status === 'COMPLETED' || session.completedCount >= session.requiredCount) return { required: false as const };
  return {
    required: true as const,
    sessionId: session.id,
    mode: session.mode,
    placementId: session.placementId,
    placementIds: sessionAllowedPlacementIds(session),
    placementPolicyVersion: session.placementPolicyVersion ?? 1,
    adLoadMode: session.adLoadMode ?? 'EXPLICIT_LOAD',
    strategyVariant: session.strategyVariant ?? 'CONTROL',
    requiredCount: session.requiredCount,
    countMode: session.countMode,
    completedCount: session.completedCount,
    onUnavailable: fallback
  };
}

function getPolicyCache(app: FastifyInstance) {
  let cache = policyCache.get(app);
  if (!cache) {
    cache = new Map();
    policyCache.set(app, cache);
  }
  return cache;
}

function setPolicyCache(app: FastifyInstance, releaseId: string, policy: PolicyValue, saved: PolicyRecord) {
  getPolicyCache(app).set(releaseId, { policy, saved, expiresAt: Date.now() + policyCacheTtlMs });
}

export function invalidateAppEntryAdPolicyCache(app: FastifyInstance, releaseId?: string) {
  const cache = policyCache.get(app);
  if (!cache) return;
  if (releaseId) cache.delete(releaseId);
  else cache.clear();
}

async function readAppEntryAdPolicyRecord(app: FastifyInstance, releaseId = 'default') {
  const cached = getPolicyCache(app).get(releaseId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const saved = await app.prisma.appEntryAdPolicy.findUnique({ where: { releaseId } });
  const policy = saved ?? disabledPolicy(app, releaseId);
  setPolicyCache(app, releaseId, policy, saved);
  return { policy, saved, expiresAt: Date.now() + policyCacheTtlMs };
}

export async function readAppEntryAdPolicy(app: FastifyInstance, releaseId = 'default') {
  return (await readAppEntryAdPolicyRecord(app, releaseId)).policy;
}

export async function observeAppEntryAdRelease(app: FastifyInstance, releaseId: string, markSeen = true) {
  const { policy, saved } = await readAppEntryAdPolicyRecord(app, releaseId);
  if (!saved && (releaseId === 'default' || releaseId.startsWith(`${app.config.MINI_APP_KEY}-`))) {
    try {
      const created = await app.prisma.appEntryAdPolicy.create({ data: { ...disabledPolicy(app, releaseId), ...(markSeen ? { firstSeenAt: new Date() } : {}) } });
      setPolicyCache(app, releaseId, created, created);
      return created;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      invalidateAppEntryAdPolicyCache(app, releaseId);
      return readAppEntryAdPolicy(app, releaseId);
    }
  }
  if (markSeen && saved && !saved.firstSeenAt) {
    await app.prisma.appEntryAdPolicy.updateMany({ where: { releaseId, firstSeenAt: null }, data: { firstSeenAt: new Date() } });
    invalidateAppEntryAdPolicyCache(app, releaseId);
  }
  return policy;
}

export async function readExitRetentionConfig(app: FastifyInstance, releaseId: string, userId: string, ip: string, platform: AdClientPlatform = 'unknown') {
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
  const placementPolicy = await resolveAdPlacementPolicy(app, { releaseId, adType: 'REWARDED', primaryPlacementId: placementId, platform });
  return {
    enabled: true as const,
    placementId,
    placementIds: placementPolicy.placementIds,
    placementPolicyVersion: placementPolicy.version,
    adLoadMode: placementPolicy.adLoadMode,
    strategyVariant: placementPolicy.strategyVariant,
    requiredCount: policy.exitRetentionAdCount
  };
}

export async function registerAppEntryAdRoutes(app: FastifyInstance) {
  app.get('/exit-retention/config', { preHandler: requireUser }, async (request) => {
    const { releaseId, platform } = z.object({ releaseId: releaseIdSchema, platform: z.enum(['ios', 'android', 'unknown']).default('unknown') }).parse(request.query);
    return measureDatabase(request, () => readExitRetentionConfig(app, releaseId, request.user.sub, request.ip, platform));
  });
  app.get('/episode-interstitial/config', { preHandler: requireUser }, async (request) => {
    const { releaseId, platform } = z.object({ releaseId: releaseIdSchema, platform: z.enum(['ios', 'android', 'unknown']).default('unknown') }).parse(request.query);
    const policy = await measureDatabase(request, () => readAppEntryAdPolicy(app, releaseId));
    const placementId = miniAppAdConfig(app.config).episodeInterstitialPlacementId;
    const placementPolicy = await resolveAdPlacementPolicy(app, { releaseId, adType: 'INTERSTITIAL', primaryPlacementId: placementId, platform });
    return {
      enabled: policy.episodeInterstitialEnabled && Boolean(placementId),
      placementId: placementId || null,
      placementIds: placementPolicy.placementIds,
      placementPolicyVersion: placementPolicy.version,
      adLoadMode: placementPolicy.adLoadMode,
      strategyVariant: placementPolicy.strategyVariant,
      initialDelaySeconds: policy.episodeInterstitialInitialDelaySeconds,
      intervalSeconds: policy.episodeInterstitialIntervalSeconds,
      minIntervalSeconds: policy.episodeInterstitialMinIntervalSeconds,
      maxPerSession: policy.episodeInterstitialMaxPerSession,
      initialSkipTransitions: policy.episodeInterstitialInitialSkipTransitions,
      everyTransitions: policy.episodeInterstitialEveryTransitions,
      rewardedCooldownSeconds: policy.episodeInterstitialRewardedCooldownSeconds
    };
  });
  app.post('/app-entry-ad-sessions', {
    preHandler: requireUser,
    config: { rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const { launchId, releaseId, adId, platform = 'unknown' } = startInput.parse(request.body);
    queueSharedIpVisit(app.sharedPrisma, {
      ipAddress: request.ip, miniAppKey: app.config.MINI_APP_KEY, userId: request.user.sub, clientSessionId: launchId,
      countryCode: requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress),
      secret: app.rootConfig.JWT_SECRET
    }, (error) => request.log.warn({ err: error }, 'Shared IP visit could not be recorded'));
    return singleFlight(app, `entry-session:${request.user.sub}:${request.ip}:${releaseId}:${launchId}:${JSON.stringify(adId)}`, async () => {
    if (app.rootConfig.ENTRY_AD_ATTRIBUTION_GATE_ENABLED) {
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
    }
    const policy = await measureDatabase(request, () => observeAppEntryAdRelease(app, releaseId));
    if (!policy.enabled || !policy.placementId) return { required: false as const };
    const placementPolicy = await resolveAdPlacementPolicy(app, {
      releaseId,
      adType: policy.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED',
      primaryPlacementId: policy.placementId,
      platform
    });
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
          allowedPlacementIds: placementPolicy.placementIds,
          placementPolicyVersion: placementPolicy.version,
          adLoadMode: placementPolicy.adLoadMode,
          strategyVariant: placementPolicy.strategyVariant,
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
  });

  app.post('/app-entry-ad-sessions/:sessionId/complete', {
    preHandler: requireUser,
    config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { sessionId } = sessionParams.parse(request.params);
    const { clientEventId, isEnded } = completionInput.parse(request.body);
    const transact = () => app.prisma.$transaction(async (tx) => {
      // READ COMMITTED + a single row lock serializes only this session, including
      // requests routed to another API instance. All eligibility is rechecked below.
      await tx.$queryRaw`SELECT "id" FROM "AppEntryAdSession" WHERE "id" = ${sessionId} AND "userId" = ${request.user.sub} FOR UPDATE`;
      const session = await tx.appEntryAdSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== request.user.sub) return null;

      const completion = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_clientEventId: { sessionId, clientEventId } } });
      if (completion) {
        return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: session.completedCount < session.requiredCount, retryCurrent: false };
      }
      if (session.status !== 'ACTIVE' || session.expiresAt <= new Date()) return null;
      if (!isEnded && session.countMode === 'COMPLETED') {
        const closed = await tx.adEvent.findFirst({
          where: { userId: request.user.sub, clientEventId, scope: 'APP_ENTRY', eventType: 'CLOSED_INCOMPLETE', appEntrySessionId: sessionId, adType: 'REWARDED' },
          select: { id: true }
        });
        if (closed) return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue: true, retryCurrent: true };
      }
      const shown = await tx.adEvent.findUnique({ where: { userId_clientEventId: { userId: request.user.sub, clientEventId } } });
      if (!shown || shown.eventType !== 'SHOWN' || shown.scope !== 'APP_ENTRY' || shown.appEntrySessionId !== sessionId
        || shown.adType !== (session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED')
        || !sessionAllowedPlacementIds(session).includes(shown.placementId)) {
        return { retryShownAcknowledgement: true as const };
      }
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
      const event = await tx.adEvent.update({
        where: { id: shown.id },
        data: { eventType: isEnded ? 'CLOSED_COMPLETED' : 'CLOSED_INCOMPLETE' }
      });
      await tx.appEntryAdCompletion.create({ data: { sessionId, clientEventId, adIndex, adEventId: event.id } });
      const completedCount = adIndex;
      const status = completedCount >= session.requiredCount ? 'COMPLETED' as const : 'ACTIVE' as const;
      await tx.appEntryAdSession.update({ where: { id: sessionId }, data: { completedCount, status, expiresAt: new Date(Date.now() + sessionTtlMs) } });
      return { completedCount, requiredCount: session.requiredCount, shouldContinue: status === 'ACTIVE', retryCurrent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 1_000, timeout: 3_000 });
    const result = await measureDatabase(request, () => singleFlight(
      app,
      `entry-complete:${request.user.sub}:${sessionId}:${clientEventId}:${isEnded}`,
      () => serialByKey(app, `entry-session:${sessionId}`, async () => {
        const current = await app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } });
        if (!current || current.userId !== request.user.sub) return null;
        const completed = await app.prisma.appEntryAdCompletion.findUnique({ where: { sessionId_clientEventId: { sessionId, clientEventId } } });
        if (completed) return { completedCount: current.completedCount, requiredCount: current.requiredCount, shouldContinue: current.completedCount < current.requiredCount, retryCurrent: false };
        if (current.status !== 'ACTIVE' || current.expiresAt <= new Date()) return null;
        const event = await app.prisma.adEvent.findUnique({ where: { userId_clientEventId: { userId: request.user.sub, clientEventId } } });
        const matches = event && event.scope === 'APP_ENTRY' && event.appEntrySessionId === sessionId
          && event.adType === (current.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED')
          && sessionAllowedPlacementIds(current).includes(event.placementId);
        if (matches && event.eventType === 'CLOSED_INCOMPLETE' && !isEnded && current.countMode === 'COMPLETED') {
          return { completedCount: current.completedCount, requiredCount: current.requiredCount, shouldContinue: true, retryCurrent: true };
        }
        // An already consumed index is idempotent even with a different event ID.
        if (matches && event.adIndex != null) {
          const consumed = await app.prisma.appEntryAdCompletion.findUnique({ where: { sessionId_adIndex: { sessionId, adIndex: event.adIndex } } });
          if (consumed) return { completedCount: current.completedCount, requiredCount: current.requiredCount, shouldContinue: current.completedCount < current.requiredCount, retryCurrent: false };
        }
        if (!matches || event.eventType !== 'SHOWN') return { retryShownAcknowledgement: true as const };
        let transactionResult: Awaited<ReturnType<typeof transact>> | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            transactionResult = await transact();
            if (attempt > 0) logCompletionSample(app, request, `recovered:${attempt}`, { retryCount: attempt }, 'Entry ad transaction recovered after serialization conflicts');
            break;
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
            if (attempt === 4) {
              request.log.error({ miniAppKey: app.config.MINI_APP_KEY, retryCount: attempt, route: 'entry-ad-complete', errorCode: 'P2034' }, 'Entry ad transaction retries exhausted');
              throw error;
            }
            const backoffMs = Math.min(200, 25 * 2 ** attempt);
            // Spread retries from simultaneous requests rather than restarting them in lockstep.
            const jitterMs = Math.floor(Math.random() * (backoffMs / 2));
            await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
          }
        }
        return transactionResult;
      })
    ));

    if (!result) {
      logCompletionSample(app, request, 'rejected:CONFLICT', { errorCode: 'CONFLICT' }, 'Entry ad completion rejected');
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    }
    if ('retryShownAcknowledgement' in result) {
      logCompletionSample(app, request, 'rejected:AD_NOT_ACKNOWLEDGED', { errorCode: 'AD_NOT_ACKNOWLEDGED' }, 'Entry ad completion rejected');
      return reply.code(409).send({ error: { code: 'AD_NOT_ACKNOWLEDGED', message: 'The ad impression has not been acknowledged yet.', requestId: request.id } });
    }
    return { ...result, access: result.shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
  });

  app.post('/app-entry-ad-sessions/:sessionId/shown', {
    preHandler: requireUser,
    config: { rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const { sessionId } = sessionParams.parse(request.params);
    const { clientEventId, adIndex, placementId } = shownInput.parse(request.body);
    // The ordered session counter is the durable idempotency record for SHOWN
    // mode, so avoid a second completion row for every impression.
    const session = await measureDatabase(request, () => app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } }));
    if (!session || session.userId !== request.user.sub) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    if (session.countMode !== 'SHOWN') return reply.code(409).send({ error: { code: 'COUNT_MODE_MISMATCH', message: 'This entry-ad session does not count impressions.', requestId: request.id } });
    const allowedPlacementIds = sessionAllowedPlacementIds(session);
    if (placementId && !allowedPlacementIds.includes(placementId)) {
      return reply.code(409).send({ error: { code: 'PLACEMENT_NOT_ALLOWED', message: 'This placement is not allowed for the entry-ad session.', requestId: request.id } });
    }
    if (isV006Release(session.releaseId) && session.allowedPlacementIds.length > 0) {
      if (!placementId) return reply.code(400).send({ error: { code: 'PLACEMENT_REQUIRED', message: 'A placement ID is required for this release.', requestId: request.id } });
      const event = await measureDatabase(request, () => app.prisma.adEvent.findUnique({ where: { userId_clientEventId: { userId: request.user.sub, clientEventId } } }));
      if (!event || event.eventType !== 'SHOWN' || event.scope !== 'APP_ENTRY' || event.appEntrySessionId !== sessionId
        || event.sessionId !== sessionId || event.adIndex !== adIndex
        || event.adType !== (session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED')
        || event.placementId !== placementId || !allowedPlacementIds.includes(event.placementId)) {
        return reply.code(409).send({ error: { code: 'AD_NOT_ACKNOWLEDGED', message: 'The matching ad impression has not been recorded.', requestId: request.id } });
      }
    }
    const now = new Date();
    const canAdvance = session.status === 'ACTIVE' && session.expiresAt > now && adIndex <= session.requiredCount;
    const isNextIndex = adIndex === session.completedCount + 1;
    const readCurrent = () => measureDatabase(request, () => app.prisma.appEntryAdSession.findUnique({ where: { id: sessionId } }));
    if (!canAdvance || !isNextIndex) {
      if (adIndex <= session.completedCount) {
        const shouldContinue = session.status === 'ACTIVE' && session.completedCount < session.requiredCount;
        return { completedCount: session.completedCount, requiredCount: session.requiredCount, shouldContinue, access: shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
      }
      if (canAdvance && !isNextIndex) return reply.code(409).send({ error: { code: 'AD_INDEX_CONFLICT', message: 'This ad index was already acknowledged.', requestId: request.id } });
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
    }
    const completedCount = adIndex;
    const status = completedCount >= session.requiredCount ? 'COMPLETED' as const : 'ACTIVE' as const;
    const advanced = await measureDatabase(request, () => app.prisma.appEntryAdSession.updateMany({
      where: {
        id: sessionId,
        userId: request.user.sub,
        countMode: 'SHOWN',
        status: 'ACTIVE',
        expiresAt: { gt: now },
        completedCount: adIndex - 1,
        requiredCount: { gte: adIndex }
      },
      data: { completedCount, status, expiresAt: new Date(now.getTime() + sessionTtlMs) }
    }));
    if (!advanced.count) {
      const current = await readCurrent();
      if (!current || current.userId !== request.user.sub) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Entry ad session is unavailable.', requestId: request.id } });
      if (current.completedCount >= adIndex) {
        const shouldContinue = current.status === 'ACTIVE' && current.completedCount < current.requiredCount;
        return { completedCount: current.completedCount, requiredCount: current.requiredCount, shouldContinue, access: shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
      }
      return reply.code(409).send({ error: { code: 'AD_INDEX_CONFLICT', message: 'This ad index was already acknowledged.', requestId: request.id } });
    }
    const result = { completedCount, requiredCount: session.requiredCount, shouldContinue: status === 'ACTIVE' };
    return { ...result, access: result.shouldContinue ? 'ENTRY_AD_REQUIRED' as const : 'APP_PLAYABLE' as const };
  });
}
