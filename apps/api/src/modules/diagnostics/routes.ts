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

export async function registerDiagnosticRoutes(app: FastifyInstance) {
  // Startup failures must be reportable before an anonymous session exists.
  app.post('/runtime-errors', {
    bodyLimit: 4096,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = diagnosticInput.parse(request.body);
    await app.prisma.miniAppRuntimeError.create({ data: {
      ...body, message: redactDiagnostic(body.message),
      path: body.path?.split(/[?#]/, 1)[0],
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : null
    } });
    return reply.code(202).send({ accepted: true });
  });
}
