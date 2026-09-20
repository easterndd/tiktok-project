import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '请求参数不正确。', requestId: request.id } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: '请求与现有数据冲突。', requestId: request.id } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '请求的资源不存在。', requestId: request.id } });
    }
    const knownError = error as { statusCode?: number; message?: string };
    const statusCode = knownError.statusCode && knownError.statusCode < 500 ? knownError.statusCode : 500;
    const code = statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : statusCode === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    request.log.error(error);
    return reply.status(statusCode).send({ error: { code, message: statusCode < 500 ? knownError.message ?? '请求失败。' : '服务器发生异常，请稍后重试。', requestId: request.id } });
  });
}
