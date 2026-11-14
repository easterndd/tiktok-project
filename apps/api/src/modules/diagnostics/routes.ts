import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireUser } from '../../plugins/auth';
import { isV006DualRelease, supportsV006DualApp } from '../ads/ad-placement-policy';

export const diagnosticInput = z.object({
  kind: z.enum(['STARTUP', 'API', 'SCRIPT', 'AD', 'PLAYBACK']),
  releaseId: z.string().max(64).regex(/^[A-Za-z0-9._-]+$/).default('default'),
  phase: z.string().max(80),
  message: z.string().max(500),
  path: z.string().max(200).optional(),
  requestId: z.string().max(128).optional(),
  statusCode: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  occurredAt: z.string().datetime().optional()
});

const traceRecordInput = z.object({
  recordId: z.string().min(1).max(128), seq: z.number().int().nonnegative(),
  kind: z.enum(['SDK_CALL', 'SDK_CALLBACK', 'SDK_PROMISE', 'HTTP_REQUEST', 'HTTP_RESPONSE', 'RUNTIME_ERROR', 'ENTRY_STATE']),
  phase: z.string().max(80), eventAt: z.string().datetime(),
  operationId: z.string().max(128).optional(), sessionId: z.string().max(128).optional(),
  requestId: z.string().max(128).optional(), placementId: z.string().max(128).optional(),
  payload: z.unknown().refine((value) => value !== undefined, 'Trace payload is required'), truncated: z.boolean().default(false)
}).superRefine((value, ctx) => {
  const encoded = JSON.stringify(value.payload);
  if (encoded && Buffer.byteLength(encoded, 'utf8') > 17_000) ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Trace payload is too large' });
});
const traceBatchInput = z.object({
  traceId: z.string().min(1).max(128), releaseId: z.string().min(1).max(64),
  platform: z.enum(['ios', 'android', 'unknown']).default('unknown'),
  startedAt: z.string().datetime(), records: z.array(traceRecordInput).min(1).max(5)
});

const traceSensitiveKey = /(?:authorization|cookie|token|secret|password|auth.?code|openid|open_id|ttclid|ttoclid|click_id|signature|signed.?url|user.?id|email|phone)/i;

export function sanitizeTracePayload(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactDiagnostic(value).slice(0, 8_192);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 7) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeTracePayload(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => {
    if (traceSensitiveKey.test(key)) return [key, '[REDACTED]'];
    if (/^(?:path|url|requestUrl)$/i.test(key) && typeof item === 'string') {
      try {
        const parsed = new URL(item, 'https://redaction.invalid');
        return [key, /^https?:\/\//i.test(item) ? parsed.origin + parsed.pathname : parsed.pathname];
      } catch { return [key, '[URL]']; }
    }
    return [key, sanitizeTracePayload(item, depth + 1)];
  }));
}

function traceErrorCodes(value: unknown): { errorCode?: string; subErrorCode?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const code = source.error_code ?? source.errorCode ?? source.errCode ?? source.code;
  const subCode = source.sub_error_code ?? source.subErrorCode;
  const format = (candidate: unknown) => typeof candidate === 'string' || typeof candidate === 'number'
    ? String(candidate).slice(0, 128) : undefined;
  if (code != null || subCode != null) return { errorCode: format(code), subErrorCode: format(subCode) };
  for (const key of ['error', 'responseBody', 'callback', 'payload']) {
    if (source[key] && typeof source[key] === 'object') {
      const nested = traceErrorCodes(source[key]);
      if (nested.errorCode || nested.subErrorCode) return nested;
    }
  }
  return {};
}

export function redactDiagnostic(value: string) {
  return value.replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|password|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

const duplicateWindowMs = 30_000;
const maxDiagnosticKeys = 10_000;
const recentDiagnosticKeys = new Map<string, number>();

function isClientAdDiagnostic(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'AD';
}

function pruneDiagnosticKeys(now: number) {
  // Map insertion order is chronological because expired keys are removed
  // before they are re-added. Stop at the first live key to avoid an O(n)
  // sweep for every telemetry request.
  while (true) {
    const first = recentDiagnosticKeys.entries().next().value as [string, number] | undefined;
    if (!first || now - first[1] < duplicateWindowMs) return;
    recentDiagnosticKeys.delete(first[0]);
  }
}

function shouldPersistDiagnostic(app: FastifyInstance, body: z.infer<typeof diagnosticInput>, message: string, path?: string) {
  const now = Date.now();
  pruneDiagnosticKeys(now);
  const miniAppKey = (app as FastifyInstance & { config?: { MINI_APP_KEY?: string } }).config?.MINI_APP_KEY ?? 'unknown';
  const key = [miniAppKey, body.releaseId, body.kind, body.phase, message, path ?? '', body.statusCode ?? ''].join('\u001f');
  const seenAt = recentDiagnosticKeys.get(key);
  if (seenAt !== undefined && now - seenAt < duplicateWindowMs) return false;
  if (recentDiagnosticKeys.size >= maxDiagnosticKeys) {
    const oldest = recentDiagnosticKeys.keys().next().value;
    if (oldest) recentDiagnosticKeys.delete(oldest);
  }
  recentDiagnosticKeys.set(key, now);
  return true;
}

export async function registerDiagnosticRoutes(app: FastifyInstance) {
  app.post('/client-traces/batches', {
    preHandler: requireUser,
    bodyLimit: 128 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request) => request.user.sub } }
  }, async (request, reply) => {
    const body = traceBatchInput.parse(request.body);
    if (!supportsV006DualApp(app.config.MINI_APP_KEY) || !isV006DualRelease(body.releaseId) || !body.releaseId.startsWith(`${app.config.MINI_APP_KEY}-v006-dual-`)) {
      return reply.code(400).send({ error: { code: 'TRACE_RELEASE_MISMATCH', message: 'Trace release does not match this mini app.', requestId: request.id } });
    }
    const belongsToRequester = (session: { userId: string | null; releaseId: string } | null) =>
      session?.userId === request.user.sub && session.releaseId === body.releaseId;
    let existing = await app.prisma.clientTraceSession.findUnique({ where: { id: body.traceId }, select: { userId: true, releaseId: true } });
    if (existing && !belongsToRequester(existing)) {
      return reply.code(409).send({ error: { code: 'TRACE_SESSION_CONFLICT', message: 'Trace session belongs to another user or release.', requestId: request.id } });
    }
    if (!existing) {
      try {
        await app.prisma.clientTraceSession.create({ data: {
          id: body.traceId, miniAppKey: app.config.MINI_APP_KEY, releaseId: body.releaseId,
          userId: request.user.sub, platform: body.platform, startedAt: new Date(body.startedAt), lastEventAt: new Date()
        } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        existing = await app.prisma.clientTraceSession.findUnique({ where: { id: body.traceId }, select: { userId: true, releaseId: true } });
        if (!belongsToRequester(existing)) return reply.code(409).send({ error: { code: 'TRACE_SESSION_CONFLICT', message: 'Trace session belongs to another user or release.', requestId: request.id } });
      }
    }
    if (existing) await app.prisma.clientTraceSession.update({ where: { id: body.traceId }, data: { lastEventAt: new Date() } });
    const saved = await app.prisma.clientTraceRecord.createMany({ data: body.records.map((item) => {
      const payload = sanitizeTracePayload(item.payload);
      const codes = traceErrorCodes(payload);
      return {
        traceId: body.traceId, recordId: item.recordId, seq: item.seq, kind: item.kind, phase: item.phase,
        operationId: item.operationId, sessionId: item.sessionId, requestId: item.requestId,
        placementId: item.placementId, eventAt: new Date(item.eventAt),
        ...codes,
        payload: payload === null ? Prisma.JsonNull : payload as Prisma.InputJsonValue, truncated: item.truncated
      };
    }), skipDuplicates: true });
    return reply.code(202).send({ accepted: saved.count, received: body.records.length });
  });

  // Startup failures must be reportable before an anonymous session exists.
  app.post('/runtime-errors', {
    bodyLimit: 4096,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    // AD diagnostics are explicitly non-persistent by default. Check the
    // discriminator before parsing/redacting the payload so SDK error storms
    // spend only the cost of the request acknowledgement.
    if (app.rootConfig.PERSIST_CLIENT_AD_DIAGNOSTICS !== true && isClientAdDiagnostic(request.body)) {
      return reply.code(202).send({ accepted: true, dropped: true });
    }
    const body = diagnosticInput.parse(request.body);
    const message = redactDiagnostic(body.message);
    const path = body.path?.split(/[?#]/, 1)[0];
    // The client already coalesces diagnostics per device. Coalesce the same
    // signature across devices too; retaining one sample per 30 seconds keeps
    // the admin signal while preventing startup storms from becoming a DB write
    // storm. This route is diagnostic-only and does not affect access decisions.
    if (!shouldPersistDiagnostic(app, body, message, path)) return reply.code(202).send({ accepted: true, deduplicated: true });
    await app.prisma.miniAppRuntimeError.create({ data: {
      ...body, message, path,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : null
    } });
    return reply.code(202).send({ accepted: true });
  });
}
