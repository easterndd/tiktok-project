import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
