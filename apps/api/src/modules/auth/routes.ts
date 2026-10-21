import { createCipheriv, createHmac, createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requestCountry } from '../../lib/content-visibility';
import { requireUser } from '../../plugins/auth';
import { addDatabaseDuration } from '../../lib/request-performance';

const anonymousSessionInput = z.object({
  visitorKey: z.string().min(32).max(512),
  clientSessionId: z.string().min(8).max(128),
  platform: z.string().trim().min(1).max(64).optional(),
  clientVersion: z.string().trim().min(1).max(64).optional(),
  source: z.string().trim().min(1).max(64).optional()
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

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/anonymous/session', {
    // Shared NATs can contain many real viewers; keep this above the global
    // per-IP API budget while still rejecting abnormal bootstrap bursts.
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request) => {
    const { visitorKey, clientSessionId, platform, clientVersion, source } = anonymousSessionInput.parse(request.body);
    const countryCode = requestCountry(request, app.config.TRUST_GEO_COUNTRY_HEADER && request.ip !== request.raw.socket.remoteAddress);
    const visitorKeyHash = createHmac('sha256', app.config.JWT_SECRET).update(visitorKey).digest('base64url');
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
    const accessToken = await app.jwt.sign({ sub: user.id, kind: 'user', appKey: app.config.MINI_APP_KEY }, { expiresIn: app.config.USER_JWT_EXPIRES_IN });
    return {
      accessToken,
      expiresIn: app.config.USER_JWT_EXPIRES_IN,
      viewer: { id: user.id, type: user.identityType }
    };
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
