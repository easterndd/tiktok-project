import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', requestId: request.id } });
    }
    const knownError = error as { statusCode?: number; message?: string };
    const statusCode = knownError.statusCode && knownError.statusCode < 500 ? knownError.statusCode : 500;
    const code = statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR';
    request.log.error(error);
    return reply.status(statusCode).send({ error: { code, message: statusCode < 500 ? knownError.message ?? 'Request failed.' : 'Unexpected server error.', requestId: request.id } });
  });
}
