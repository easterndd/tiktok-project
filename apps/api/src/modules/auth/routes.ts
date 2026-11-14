import { createCipheriv, createHmac, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requestCountry } from '../../lib/content-visibility';
import { requireUser } from '../../plugins/auth';
import { addDatabaseDuration } from '../../lib/request-performance';
import { singleFlight } from '../../lib/single-flight';
import { exemptIpForReviewRelease, isEntryAdIpExempt, queueSharedIpVisit } from '../../services/shared-ip.service';
import { observeAppEntryAdRelease } from '../app-entry-ads/routes';
import { classifyLaunchAttribution } from '../../services/launch-attribution.service';

const launchContextInput = z.object({
  launchId: z.string().uuid().optional(),
  entryId: z.string().min(8).max(128).optional(),
  rawUrl: z.url().max(32768).optional(),
  sdkPayloadRaw: z.string().max(32768).optional(),
  launchScene: z.string().trim().max(64).optional(),
  launchPath: z.string().trim().max(256).optional(),
  launchQuery: z.record(z.string(), z.string().max(4096)).optional(),
  webviewBase: z.string().trim().max(512).optional(),
  releaseId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).optional()
});
const recordedLaunchContextInput = launchContextInput.extend({ entryId: z.string().min(8).max(128) });
const localEntryReleaseIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const localEntryLaunchContextInput = recordedLaunchContextInput.extend({
  releaseId: localEntryReleaseIdSchema.optional(),
  localEntryAd: z.boolean().optional()
});
const localEntryAdMiniApps = new Set(['storyflicks', 'dramablaze', 'cinereels', 'dramahit', 'taletv']);

const anonymousSessionInput = z.object({
  visitorKey: z.string().min(32).max(512),
  clientSessionId: z.string().min(8).max(128),
  platform: z.string().trim().min(1).max(64).optional(),
  clientVersion: z.string().trim().min(1).max(64).optional(),
  source: z.string().trim().min(1).max(64).optional(),
  launchContext: launchContextInput.optional()
});

const tikTokSessionInput = z.object({
  code: z.string().trim().min(1).max(4096),
  clientSessionId: z.string().min(8).max(128).optional(),
  clientVersion: z.string().trim().min(1).max(64).optional()
});

type TikTokTokenResponse = {
  access_token?: unknown;
  open_id?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function encryptCredential(value: string, secret: string, appKey: string) {
  const key = createHash('sha256').update(`tiktok-credential:${appKey}:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function positiveSeconds(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function exchangeTikTokCode(app: FastifyInstance, code: string) {
  if (!app.config.TIKTOK_CLIENT_KEY || !app.config.TIKTOK_CLIENT_SECRET) {
    throw Object.assign(new Error('TikTok login is not configured for this Mini App.'), { statusCode: 503 });
  }
  const body = new URLSearchParams({
    client_key: app.config.TIKTOK_CLIENT_KEY,
    client_secret: app.config.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code'
  });
  let response: Response;
  try {
    response = await fetch(new URL('/v2/oauth/token/', app.config.TIKTOK_SHORT_DRAMA_API_BASE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw Object.assign(new Error('TikTok login could not reach the authorization service.'), { statusCode: 502 });
  }
  const token = await response.json().catch(() => null) as TikTokTokenResponse | null;
  if (!response.ok || typeof token?.open_id !== 'string' || !token.open_id || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string') {
    throw Object.assign(new Error('TikTok could not verify this login. Please retry.'), { statusCode: 401 });
  }
  return token;
}

async function saveLaunchContext(app: FastifyInstance, request: FastifyRequest, userId: string, context: z.infer<typeof launchContextInput>, fallbackEntryId?: string) {
  const entryId = context.entryId ?? fallbackEntryId;
  if (!entryId) return { saved: false as const };
  const launchId = context.launchId ?? entryId;
  const launchQuery = Object.fromEntries(Object.entries(context.launchQuery ?? {}).filter(([key, value]) =>
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)
    && !/(?:token|auth|secret|password|email|phone|openid|open_id|user.?id|username|uid|visitor|session|credential|code|url|redirect|callback)/i.test(key)
    && !(/^(?:ttclid|ttoclid|click_id)$/i.test(key) && /(?:^|-)v006-dual(?:-|$)/i.test(context.releaseId ?? ''))
    && !/(?:https?:\/\/|www\.)/i.test(value)
  ).slice(0, 32));
  const fingerprint = createHash('sha256').update(JSON.stringify({ context, launchQuery })).digest('hex');
  return singleFlight(app, `launch-context:${userId}:${entryId}:${fingerprint}`, async () => {
    try {
    const existing = await app.prisma.audienceActivityEvent.findFirst({
      where: { userId, eventType: 'APP_LAUNCH_CONTEXT', metadata: { path: ['entryId'], equals: entryId } },
      select: { id: true, metadata: true }
    });
    if (existing) {
      const metadata = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {};
      const isDualV006 = /(?:^|-)v006-dual(?:-|$)/i.test(context.releaseId ?? String(metadata.releaseId ?? ''));
      const { rawUrl: _rawUrl, sdkPayloadRaw: _sdkPayloadRaw, ...metadataWithoutRawEvidence } = metadata;
      const existingQuery = metadata.launchQuery && typeof metadata.launchQuery === 'object' && !Array.isArray(metadata.launchQuery)
        ? metadata.launchQuery as Record<string, string> : {};
      const safeExistingQuery = isDualV006 ? Object.fromEntries(Object.entries(existingQuery).filter(([key]) => !/^(?:ttclid|ttoclid|click_id)$/i.test(key))) : existingQuery;
      const launchRef = typeof metadata.launchRef === 'string' ? metadata.launchRef : randomUUID();
      const nextMetadataObject = {
        ...metadataWithoutRawEvidence,
        launchId,
        launchRef,
        ...(!isDualV006 ? { rawUrl: context.rawUrl ?? metadata.rawUrl, sdkPayloadRaw: context.sdkPayloadRaw ?? metadata.sdkPayloadRaw } : {}),
        launchScene: context.launchScene ?? metadata.launchScene,
        launchPath: context.launchPath ?? metadata.launchPath,
        webviewBase: context.webviewBase ?? metadata.webviewBase,
        releaseId: context.releaseId ?? metadata.releaseId,
        launchQuery: { ...safeExistingQuery, ...launchQuery }
      };
      // Anonymous bootstrap and authenticated launch-context reporting can
      // carry the same entry twice. Avoid rewriting the JSON row when no
      // launch information actually changed.
      if (JSON.stringify(nextMetadataObject) !== JSON.stringify(metadata)) {
        await app.prisma.audienceActivityEvent.update({ where: { id: existing.id }, data: { metadata: nextMetadataObject as Prisma.InputJsonValue } });
      }
      const attributionEvidence = {
        ...nextMetadataObject,
        rawUrl: context.rawUrl ?? metadata.rawUrl,
        sdkPayloadRaw: context.sdkPayloadRaw ?? metadata.sdkPayloadRaw,
        launchQuery: { ...existingQuery, ...launchQuery }
      };
      const attribution = classifyLaunchAttribution(attributionEvidence);
      await saveStructuredLaunch(app, userId, launchId, entryId, launchRef, context.releaseId ?? 'default', attribution, attributionEvidence);
      return { saved: true as const, launchRef, launchId, attribution: { status: attribution.status, reason: attribution.reason, signalStatus: attribution.signalStatus } };
    }
    const existingLaunch = context.launchId && /(?:^|-)v006-dual(?:-|$)/i.test(context.releaseId ?? '')
      ? await app.prisma.miniAppLaunch.findUnique({ where: { miniAppKey_launchId: { miniAppKey: app.config.MINI_APP_KEY, launchId } } }) : null;
    const launchRef = existingLaunch?.launchRef ?? randomUUID();
    const attribution = classifyLaunchAttribution({ ...context, launchQuery });
    const dualV006Context = /(?:^|-)v006-dual(?:-|$)/i.test(context.releaseId ?? '');
    await app.prisma.audienceActivityEvent.create({ data: {
      userId, eventType: 'APP_LAUNCH_CONTEXT', metadata: {
        launchId,
        launchRef,
        entryId,
        ...(!dualV006Context ? { rawUrl: context.rawUrl, sdkPayloadRaw: context.sdkPayloadRaw } : {}),
        launchScene: context.launchScene,
        launchPath: context.launchPath?.startsWith('/') && !context.launchPath.startsWith('//')
          ? context.launchPath.split(/[?#]/, 1)[0] : undefined,
        webviewBase: context.webviewBase,
        releaseId: context.releaseId,
        launchQuery
      } as Prisma.InputJsonValue
    } });
    await saveStructuredLaunch(app, userId, launchId, entryId, launchRef, context.releaseId ?? 'default', attribution, { ...context, launchQuery });
    return { saved: true as const, launchRef, launchId, attribution: { status: attribution.status, reason: attribution.reason, signalStatus: attribution.signalStatus } };
    } catch (error) {
      request.log.warn({ err: error }, 'Mini app launch context could not be saved');
      return { saved: false as const };
    }
  });
}

async function saveStructuredLaunch(app: FastifyInstance, userId: string, launchId: string, entryId: string, launchRef: string, releaseId: string,
  attribution: ReturnType<typeof classifyLaunchAttribution>, context: Record<string, unknown>) {
  if (!/(?:^|-)v006-dual(?:-|$)/i.test(releaseId)) return;
  const query = context.launchQuery && typeof context.launchQuery === 'object' ? context.launchQuery as Record<string, string> : {};
  const sdkQuery = (() => {
    try {
      const payload = typeof context.sdkPayloadRaw === 'string' ? JSON.parse(context.sdkPayloadRaw) as { query?: unknown } : {};
      return payload.query && typeof payload.query === 'object' && !Array.isArray(payload.query) ? payload.query as Record<string, unknown> : {};
    } catch { return {}; }
  })();
  const queryValues = { ...sdkQuery, ...query };
  if (typeof context.rawUrl === 'string') {
    try { for (const [key, value] of new URL(context.rawUrl).searchParams) queryValues[key] ??= value; } catch { /* Keep other launch sources. */ }
  }
  const signalKeys = Object.keys(queryValues).filter((key) => /^(?:campaign|adgroup|creative|ttclid|ttoclid|click_id|placement)/i.test(key));
  const clickIdFingerprints = Object.fromEntries(Object.entries(queryValues)
    .filter(([key, value]) => /^(?:ttclid|ttoclid|click_id)$/i.test(key) && typeof value === 'string')
    .map(([key, value]) => [key, createHmac('sha256', `${app.config.MINI_APP_KEY}:${app.config.JWT_SECRET}`).update(value as string).digest('hex')]));
  const sdkHasSignals = Object.keys(sdkQuery).some((key) => /^(?:ad.?id|campaign|adgroup|creative|ttclid|ttoclid|click_id|placement)/i.test(key));
  const summary = {
    signalStatus: attribution.signalStatus, adId: attribution.adId, signalKeys, clickIdFingerprints,
    sources: { webviewUrl: Boolean(context.rawUrl), tiktokSdkOptions: sdkHasSignals }
  } as Prisma.InputJsonValue;
  await app.prisma.miniAppLaunch.upsert({
    where: { miniAppKey_launchId: { miniAppKey: app.config.MINI_APP_KEY, launchId } },
    create: {
      miniAppKey: app.config.MINI_APP_KEY, launchId, entryId, launchRef, userId, releaseId,
      collectionStatus: context.rawUrl || Object.keys(query).length ? 'COMPLETE' : 'UNAVAILABLE',
      localAttributionStatus: attribution.status, attributionReason: attribution.reason,
      platformAttributionStatus: 'UNKNOWN',
      signalSummary: summary
    },
    update: {
      localAttributionStatus: attribution.status, attributionReason: attribution.reason,
      collectionStatus: context.rawUrl || Object.keys(query).length ? 'COMPLETE' : 'UNAVAILABLE',
      signalSummary: summary
    }
  });
}

async function readLocalEntryAdEligibility(app: FastifyInstance, request: FastifyRequest, input: {
  releaseId?: string;
  launchQuery?: Record<string, string>;
  rawUrl?: string;
}, userExempt: boolean) {
  if (!localEntryAdMiniApps.has(app.config.MINI_APP_KEY)) return { showEntryAd: false, reason: 'APP_NOT_CONFIGURED' };
  const releaseId = input.releaseId;
  if (!releaseId || (releaseId !== 'default' && !releaseId.startsWith(`${app.config.MINI_APP_KEY}-`))) {
    return { showEntryAd: false, reason: 'INVALID_RELEASE' };
  }
  if (app.rootConfig.ENTRY_AD_ATTRIBUTION_GATE_ENABLED
    && classifyLaunchAttribution({ launchQuery: input.launchQuery, rawUrl: input.rawUrl }).status !== 'ATTRIBUTED') {
    return { showEntryAd: false, reason: 'UNATTRIBUTED' };
  }

  const databaseStartedAt = performance.now();
  const policy = await observeAppEntryAdRelease(app, releaseId);
  addDatabaseDuration(request, performance.now() - databaseStartedAt);
  if (!policy?.enabled) return { showEntryAd: false, reason: 'POLICY_DISABLED' };
  if (policy.mode !== 'REWARDED_GATED') return { showEntryAd: false, reason: 'REWARDED_MODE_REQUIRED' };
  if (userExempt) return { showEntryAd: false, reason: 'USER_EXEMPT' };

  try {
    const exemptionStartedAt = performance.now();
    const ipExempt = await isEntryAdIpExempt(app.sharedPrisma, request.ip);
    addDatabaseDuration(request, performance.now() - exemptionStartedAt);
    if (ipExempt) return { showEntryAd: false, reason: 'IP_EXEMPT' };
  } catch (error) {
    request.log.warn({ err: error }, 'Shared IP exemption lookup failed; skipping local entry ad');
    return { showEntryAd: false, reason: 'EXEMPTION_LOOKUP_FAILED' };
  }

  return { showEntryAd: true, reason: 'ELIGIBLE' };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/anonymous/session', {
    // Shared NATs can contain many real viewers; keep this above the global
    // per-IP API budget while still rejecting abnormal bootstrap bursts.
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request) => {
    const { visitorKey, clientSessionId, platform, clientVersion, source, launchContext } = anonymousSessionInput.parse(request.body);
    const countryCode = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress);
    const visitorKeyHash = createHmac('sha256', app.config.JWT_SECRET).update(visitorKey).digest('base64url');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      visitorKeyHash, clientSessionId, platform, clientVersion, source, countryCode, launchContext
    })).digest('hex');
    return singleFlight(app, `anonymous-session:${fingerprint}`, async () => {
    const databaseStartedAt = performance.now();
    let user = await app.prisma.user.upsert({
      where: { visitorKeyHash },
      create: { identityType: 'ANONYMOUS', visitorKeyHash },
      update: {}
    });
    if (user.mergedIntoUserId) user = await app.prisma.user.findUniqueOrThrow({ where: { id: user.mergedIntoUserId } });
    await app.prisma.appSession.upsert({
      where: { userId_clientSessionId: { userId: user.id, clientSessionId } },
      create: { userId: user.id, clientSessionId, platform, clientVersion, source, countryCode },
      update: { platform, clientVersion, source, countryCode }
    });
    addDatabaseDuration(request, performance.now() - databaseStartedAt);
    if (launchContext) await saveLaunchContext(app, request, user.id, launchContext, clientSessionId);
    const accessToken = await app.jwt.sign({ sub: user.id, kind: 'user', appKey: app.config.MINI_APP_KEY }, { expiresIn: app.config.USER_JWT_EXPIRES_IN });
    return {
      accessToken,
      expiresIn: app.config.USER_JWT_EXPIRES_IN,
      viewer: { id: user.id, type: user.identityType }
    };
    });
  });

  app.post('/auth/launch-context', {
    preHandler: requireUser,
    config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request) => {
    const context = localEntryLaunchContextInput.parse(request.body);
    let user = await app.prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, select: { id: true, mergedIntoUserId: true, appEntryAdExempt: true } });
    if (user.mergedIntoUserId) user = await app.prisma.user.findUniqueOrThrow({ where: { id: user.mergedIntoUserId }, select: { id: true, mergedIntoUserId: true, appEntryAdExempt: true } });
    const launchRecord = await saveLaunchContext(app, request, user.id, context);
    if (context.releaseId) {
      try {
        const reviewExemptionStartedAt = performance.now();
        await exemptIpForReviewRelease({
          db: app.sharedPrisma,
          miniAppKey: app.config.MINI_APP_KEY,
          releaseId: context.releaseId,
          ipAddress: request.ip
        });
        addDatabaseDuration(request, performance.now() - reviewExemptionStartedAt);
      } catch (error) {
        request.log.warn({ err: error }, 'Review release IP exemption could not be applied');
      }
    }
    const localEntryAd = context.localEntryAd === true && localEntryAdMiniApps.has(app.config.MINI_APP_KEY);
    if (!localEntryAd) return launchRecord;

    queueSharedIpVisit(app.sharedPrisma, {
      ipAddress: request.ip,
      miniAppKey: app.config.MINI_APP_KEY,
      userId: request.user.sub,
      clientSessionId: context.entryId,
      countryCode: requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress),
      secret: app.rootConfig.JWT_SECRET
    }, (error) => request.log.warn({ err: error }, 'Shared IP visit could not be recorded'));

    const entryAdEligibility = await readLocalEntryAdEligibility(app, request, context, user.appEntryAdExempt);
    return { ...launchRecord, entryAdEligibility };
  });

  app.post('/auth/tiktok/session', {
    preHandler: requireUser,
    config: { rateLimit: { max: 10, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const input = tikTokSessionInput.parse(request.body);
    const countryCode = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress);

    const token = await exchangeTikTokCode(app, input.code);
    const openId = token.open_id as string;
    const oauthAccessToken = token.access_token as string;
    const oauthRefreshToken = token.refresh_token as string;
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + positiveSeconds(token.expires_in, 7_200) * 1_000);
    const refreshExpiresAt = new Date(now.getTime() + positiveSeconds(token.refresh_expires_in, 31_536_000) * 1_000);
    const credentialKey = app.config.USER_DATA_ENCRYPTION_KEY ?? app.config.JWT_SECRET;
    const encryptedAccessToken = encryptCredential(oauthAccessToken, credentialKey, app.config.MINI_APP_KEY);
    const encryptedRefreshToken = encryptCredential(oauthRefreshToken, credentialKey, app.config.MINI_APP_KEY);
    const viewer = await app.prisma.$transaction(async (tx) => {
      let currentUser = await tx.user.findUnique({ where: { id: request.user.sub } });
      if (!currentUser) throw Object.assign(new Error('Viewer session is unavailable.'), { statusCode: 401 });
      if (currentUser.mergedIntoUserId) {
        currentUser = await tx.user.findUnique({ where: { id: currentUser.mergedIntoUserId } });
        if (!currentUser) throw Object.assign(new Error('Viewer session is unavailable.'), { statusCode: 401 });
      }
      if (currentUser.identityType === 'TIKTOK' && currentUser.tiktokOpenId && currentUser.tiktokOpenId !== openId) {
        throw Object.assign(new Error('This viewer session is linked to another TikTok account.'), { statusCode: 409 });
      }

      let user = await tx.user.findUnique({ where: { tiktokOpenId: openId } });
      if (user && user.id !== currentUser.id) {
        await mergeViewerData(tx, currentUser.id, user.id);
        if (currentUser.appEntryAdExempt && !user.appEntryAdExempt) user = await tx.user.update({ where: { id: user.id }, data: { appEntryAdExempt: true } });
        user = await tx.user.update({ where: { id: currentUser.id }, data: { mergedIntoUserId: user.id } });
        user = await tx.user.findUniqueOrThrow({ where: { id: user.mergedIntoUserId! } });
      } else if (!user) {
        user = await tx.user.update({
          where: { id: currentUser.id },
          data: { identityType: 'TIKTOK', tiktokOpenId: openId }
        });
      }

      await tx.tikTokCredential.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          accessExpiresAt,
          refreshExpiresAt,
          scope: typeof token.scope === 'string' ? token.scope : null,
          tokenType: typeof token.token_type === 'string' ? token.token_type : null
        },
        update: {
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          accessExpiresAt,
          refreshExpiresAt,
          scope: typeof token.scope === 'string' ? token.scope : null,
          tokenType: typeof token.token_type === 'string' ? token.token_type : null
        }
      });

      if (input.clientSessionId) {
        await tx.appSession.upsert({
          where: { userId_clientSessionId: { userId: user.id, clientSessionId: input.clientSessionId } },
          create: { userId: user.id, clientSessionId: input.clientSessionId, platform: 'TIKTOK_MINIS', clientVersion: input.clientVersion, source: 'TIKTOK_SILENT_LOGIN', countryCode },
          update: { platform: 'TIKTOK_MINIS', clientVersion: input.clientVersion, source: 'TIKTOK_SILENT_LOGIN', countryCode }
        });
      }
      return user;
    }, { isolationLevel: 'Serializable' });

    const accessToken = await app.jwt.sign({ sub: viewer.id, kind: 'user', appKey: app.config.MINI_APP_KEY }, { expiresIn: app.config.USER_JWT_EXPIRES_IN });
    return {
      accessToken,
      expiresIn: app.config.USER_JWT_EXPIRES_IN,
      viewer: { id: viewer.id, type: 'TIKTOK' as const }
    };
  });
}

async function mergeViewerData(tx: Prisma.TransactionClient, sourceUserId: string, targetUserId: string) {
  const progress = await tx.watchProgress.findMany({ where: { userId: sourceUserId } });
  for (const item of progress) {
    const existing = await tx.watchProgress.findUnique({ where: { userId_episodeId: { userId: targetUserId, episodeId: item.episodeId } } });
    if (!existing) await tx.watchProgress.create({ data: { ...item, userId: targetUserId } });
    else if (item.updatedAt > existing.updatedAt) await tx.watchProgress.update({ where: { id: existing.id }, data: { positionMs: item.positionMs, durationMs: item.durationMs, completed: item.completed } });
  }
  await tx.watchProgress.deleteMany({ where: { userId: sourceUserId } });

  const unlocks = await tx.episodeUnlock.findMany({ where: { userId: sourceUserId } });
  for (const item of unlocks) await tx.episodeUnlock.upsert({ where: { userId_episodeId: { userId: targetUserId, episodeId: item.episodeId } }, create: { userId: targetUserId, episodeId: item.episodeId, unlockType: item.unlockType, placementId: item.placementId, unlockedAt: item.unlockedAt }, update: {} });
  await tx.episodeUnlock.deleteMany({ where: { userId: sourceUserId } });

  const likes = await tx.albumLike.findMany({ where: { userId: sourceUserId } });
  for (const item of likes) await tx.albumLike.upsert({ where: { userId_albumId: { userId: targetUserId, albumId: item.albumId } }, create: { userId: targetUserId, albumId: item.albumId, createdAt: item.createdAt }, update: {} });
  await tx.albumLike.deleteMany({ where: { userId: sourceUserId } });

  const favorites = await tx.albumFavorite.findMany({ where: { userId: sourceUserId } });
  for (const item of favorites) await tx.albumFavorite.upsert({ where: { userId_albumId: { userId: targetUserId, albumId: item.albumId } }, create: { userId: targetUserId, albumId: item.albumId, createdAt: item.createdAt }, update: {} });
  await tx.albumFavorite.deleteMany({ where: { userId: sourceUserId } });

  const completions = await tx.episodeCompletionEvent.findMany({ where: { userId: sourceUserId } });
  for (const item of completions) {
    await tx.episodeCompletionEvent.upsert({
      where: { userId_episodeId: { userId: targetUserId, episodeId: item.episodeId } },
      create: { userId: targetUserId, episodeId: item.episodeId, playbackSessionId: item.playbackSessionId, completedAt: item.completedAt },
      update: {}
    });
  }
  await tx.episodeCompletionEvent.deleteMany({ where: { userId: sourceUserId } });

  const sourcePreference = await tx.userPreference.findUnique({ where: { userId: sourceUserId } });
  const targetPreference = await tx.userPreference.findUnique({ where: { userId: targetUserId } });
  if (sourcePreference && !targetPreference) await tx.userPreference.update({ where: { id: sourcePreference.id }, data: { userId: targetUserId } });
  else if (sourcePreference) await tx.userPreference.delete({ where: { id: sourcePreference.id } });

  const appSessions = await tx.appSession.findMany({ where: { userId: sourceUserId } });
  for (const item of appSessions) {
    const existing = await tx.appSession.findUnique({ where: { userId_clientSessionId: { userId: targetUserId, clientSessionId: item.clientSessionId } } });
    if (!existing) await tx.appSession.update({ where: { id: item.id }, data: { userId: targetUserId } });
    else {
      await tx.appSession.update({ where: { id: existing.id }, data: { startedAt: item.startedAt < existing.startedAt ? item.startedAt : existing.startedAt, lastSeenAt: item.lastSeenAt > existing.lastSeenAt ? item.lastSeenAt : existing.lastSeenAt } });
      await tx.appSession.delete({ where: { id: item.id } });
    }
  }

  const entrySessions = await tx.appEntryAdSession.findMany({ where: { userId: sourceUserId } });
  const entrySessionIds = new Map<string, string>();
  for (const item of entrySessions) {
    const existing = await tx.appEntryAdSession.findUnique({ where: { userId_releaseId_launchId: { userId: targetUserId, releaseId: item.releaseId, launchId: item.launchId } } });
    if (!existing) {
      await tx.appEntryAdSession.update({ where: { id: item.id }, data: { userId: targetUserId } });
      entrySessionIds.set(item.id, item.id);
      continue;
    }
    entrySessionIds.set(item.id, existing.id);
    await tx.appEntryAdSession.update({ where: { id: existing.id }, data: { completedCount: Math.max(existing.completedCount, item.completedCount), expiresAt: existing.expiresAt > item.expiresAt ? existing.expiresAt : item.expiresAt } });
    await tx.adEvent.updateMany({ where: { appEntrySessionId: item.id }, data: { appEntrySessionId: existing.id } });
    const completionsForSession = await tx.appEntryAdCompletion.findMany({ where: { sessionId: item.id } });
    for (const completion of completionsForSession) {
      const byEvent = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_clientEventId: { sessionId: existing.id, clientEventId: completion.clientEventId } } });
      const byIndex = await tx.appEntryAdCompletion.findUnique({ where: { sessionId_adIndex: { sessionId: existing.id, adIndex: completion.adIndex } } });
      if (!byEvent && !byIndex) await tx.appEntryAdCompletion.update({ where: { id: completion.id }, data: { sessionId: existing.id } });
      else await tx.appEntryAdCompletion.delete({ where: { id: completion.id } });
    }
    await tx.appEntryAdSession.delete({ where: { id: item.id } });
  }

  await tx.rewardedUnlockSession.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.playbackSession.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.audienceActivityEvent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.shareEvent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.searchEvent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.playbackQualityEvent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });

  const adEvents = await tx.adEvent.findMany({ where: { userId: sourceUserId } });
  for (const event of adEvents) {
    const appEntrySessionId = event.appEntrySessionId ? entrySessionIds.get(event.appEntrySessionId) ?? event.appEntrySessionId : null;
    const existing = event.clientEventId
      ? await tx.adEvent.findUnique({ where: { userId_clientEventId: { userId: targetUserId, clientEventId: event.clientEventId } } })
      : null;
    if (existing) {
      await tx.rewardedUnlockReward.updateMany({ where: { adEventId: event.id }, data: { adEventId: existing.id } });
      await tx.appEntryAdCompletion.updateMany({ where: { adEventId: event.id }, data: { adEventId: existing.id } });
      await tx.adEvent.delete({ where: { id: event.id } });
    } else {
      await tx.adEvent.update({ where: { id: event.id }, data: { userId: targetUserId, appEntrySessionId } });
    }
  }

}
