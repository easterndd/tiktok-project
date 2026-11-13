import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const eventKeys = ['app_open', 'ad_config', 'ad_load', 'ad_show', 'ad_close', 'launch_attribution', 'entry_ad_decision'] as const;
const results = ['success', 'fail', 'timeout', 'unsupported'] as const;
const analyticsEnabledMiniApps = new Set(['dramaflicks', 'heartreel', 'zenclip', 'sweetreel', 'luxereel']);
const jsonValue = z.unknown().superRefine((value, ctx) => {
  try {
    if (JSON.stringify(value).length > 8_192) ctx.addIssue({ code: 'custom', message: 'JSON field is too large' });
  } catch { ctx.addIssue({ code: 'custom', message: 'JSON field is not serializable' }); }
});

export const clientAnalyticsEventInput = z.object({
  eventId: z.string().min(8).max(128),
  eventKey: z.enum(eventKeys),
  releaseId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default('default'),
  launchId: z.string().max(128).optional(),
  clientSessionId: z.string().max(128).optional(),
  eventTs: z.string().datetime().optional(),
  platform: z.enum(['android', 'ios', 'web', 'unknown']).optional(),
  appVersion: z.string().max(64).optional(),
  tiktokClientVersion: z.string().max(64).optional(),
  sdkVersion: z.string().max(64).optional(),
  placementId: z.string().max(128).optional(),
  adType: z.enum(['REWARDED', 'INTERSTITIAL']).optional(),
  adSeq: z.number().int().positive().optional(),
  operationId: z.string().max(128).optional(),
  attemptNo: z.number().int().positive().max(10).optional(),
  adPhase: z.string().max(64).optional(),
  errorOrigin: z.enum(['SDK_CALLBACK', 'SDK_PROMISE', 'APP_TIMEOUT', 'API_HTTP', 'UNKNOWN']).optional(),
  strategyVariant: z.string().max(64).optional(),
  placementRole: z.enum(['PRIMARY', 'BACKUP']).optional(),
  result: z.enum(results).optional(),
  isEnded: z.boolean().nullable().optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  shouldShow: z.number().int().min(0).max(100).nullable().optional(),
  errorCode: z.string().max(256).optional(),
  errorMsg: z.string().max(1_000).optional(),
  subErrorCode: z.string().max(256).optional(),
  errorExtra: jsonValue.optional(),
  path: z.string().max(256).optional(),
  requestId: z.string().max(128).optional(),
  metadata: z.record(z.string(), jsonValue).superRefine((value, ctx) => {
    if (JSON.stringify(value).length > 8_192) ctx.addIssue({ code: 'custom', message: 'metadata is too large' });
  }).optional()
}).superRefine((event, ctx) => {
  if (!['app_open', 'ad_config', 'launch_attribution', 'entry_ad_decision'].includes(event.eventKey) && !event.placementId) {
    ctx.addIssue({ code: 'custom', path: ['placementId'], message: 'placementId is required for ad events' });
  }
  if (event.eventKey === 'ad_close' && event.isEnded === undefined) {
    ctx.addIssue({ code: 'custom', path: ['isEnded'], message: 'ad_close must include isEnded (null for interstitial)' });
  }
});

const batchInput = z.object({ events: z.array(clientAnalyticsEventInput).min(1).max(25) }).strict();

function redactText(value: string | undefined, max = 1_000) {
  if (!value) return value;
  return value.replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|password|secret|authorization|code)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, max);
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeJson(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => {
      if (/(?:token|secret|password|authorization|auth.?code|openid|open_id|cookie|signature|signed.?url)/i.test(key)) return [key, '[REDACTED]'];
      if (typeof item === 'string') return [key, redactText(item, 1_000)];
      return [key, sanitizeJson(item, depth + 1)];
    }));
  }
  return typeof value === 'string' ? redactText(value, 1_000) : value;
}

function jsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(sanitizeJson(value))) as Prisma.InputJsonValue; } catch { return undefined; }
}

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  if (!analyticsEnabledMiniApps.has(app.config.MINI_APP_KEY)) return;
  app.post('/analytics/events', { bodyLimit: 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = batchInput.parse(request.body);
    try {
      await request.jwtVerify();
      if (request.user.kind !== 'user' || request.user.appKey !== app.config.MINI_APP_KEY) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A matching mini app session is required.', requestId: request.id } });
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A matching mini app session is required.', requestId: request.id } });
    }
    const userId = request.user.sub;
    const receivedAt = new Date();
    const data = body.events.map((event) => ({
      eventId: event.eventId,
      miniAppKey: app.config.MINI_APP_KEY,
      releaseId: event.releaseId,
      userId,
      launchId: event.launchId,
      clientSessionId: event.clientSessionId,
      eventKey: event.eventKey,
      eventTs: event.eventTs ? new Date(event.eventTs) : receivedAt,
      receivedAt,
      platform: event.platform,
      appVersion: event.appVersion,
      tiktokClientVersion: event.tiktokClientVersion,
      sdkVersion: event.sdkVersion,
      placementId: event.placementId,
      adType: event.adType,
      adSeq: event.adSeq,
      operationId: redactText(event.operationId, 128),
      attemptNo: event.attemptNo,
      adPhase: event.adPhase,
      errorOrigin: event.errorOrigin,
      strategyVariant: event.strategyVariant,
      placementRole: event.placementRole,
      result: event.result,
      isEnded: event.isEnded,
      durationMs: event.durationMs,
      shouldShow: event.shouldShow,
      errorCode: redactText(event.errorCode, 256),
      errorMsg: redactText(event.errorMsg),
      subErrorCode: redactText(event.subErrorCode, 256),
      errorExtra: jsonInput(event.errorExtra),
      path: event.path?.split(/[?#]/, 1)[0],
      requestId: redactText(event.requestId, 128),
      metadata: jsonInput(event.metadata)
    }));
    const result = await app.prisma.clientAnalyticsEvent.createMany({ data, skipDuplicates: true });
    return reply.code(202).send({ accepted: result.count, received: data.length });
  });
}
