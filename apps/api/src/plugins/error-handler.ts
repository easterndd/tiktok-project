import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { BytePlusVodError } from '../services/byteplus-vod.service';
import { ProviderNotConfiguredError } from '../services/tiktok-short-drama.service';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }, 'Request validation failed');
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '请求参数不正确。', requestId: request.id } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: '请求与现有数据冲突。', requestId: request.id } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '请求的资源不存在。', requestId: request.id } });
    }
    if (error instanceof ProviderNotConfiguredError) {
      request.log.error(error, 'BytePlus VOD is not configured');
      return reply.status(503).send({
        error: {
          code: 'BYTEPLUS_VOD_NOT_CONFIGURED',
          message: 'BytePlus VOD 未配置。请检查服务器环境变量 BYTEPLUS_ACCESS_KEY 和 BYTEPLUS_SECRET_KEY。',
          requestId: request.id
        }
      });
    }
    if (error instanceof BytePlusVodError) {
      request.log.error(error, 'BytePlus VOD local upload failed');
      return reply.status(502).send({
        error: {
          code: 'BYTEPLUS_VOD_ERROR',
          message: `BytePlus VOD 上传失败：${error.message}`,
          requestId: request.id
        }
      });
    }
    const knownError = error as { statusCode?: number; message?: string };
    const statusCode = knownError.statusCode && knownError.statusCode < 500 ? knownError.statusCode : 500;
    const code = statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : statusCode === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    request.log.error(error);
    return reply.status(statusCode).send({ error: { code, message: statusCode < 500 ? knownError.message ?? '请求失败。' : '服务器发生异常，请稍后重试。', requestId: request.id } });
  });
}
