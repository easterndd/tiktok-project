import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import type { Env } from './config/env';
import { taletvEnvironment } from './config/mini-apps';
import { PrismaClient as DatabaseClient } from '@prisma/client';
import { registerAlbumRoutes } from './modules/albums/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerEpisodeRoutes } from './modules/episodes/routes';
import { registerProgressRoutes } from './modules/progress/routes';
import { registerHomeRoutes } from './modules/home/routes';
import { registerSearchRoutes } from './modules/search/routes';
import { registerInteractionRoutes } from './modules/interactions/routes';
import { registerProfileRoutes } from './modules/profile/routes';
import { registerAdRoutes } from './modules/ads/routes';
import { registerAppEntryAdRoutes } from './modules/app-entry-ads/routes';
import { registerAdminRoutes } from './modules/admin/routes';
import { registerUiRoutes } from './modules/ui/routes';
import { registerErrorHandler } from './plugins/error-handler';
import { registerPrisma } from './plugins/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    sharedPrisma: PrismaClient;
    miniAppPrisma: Record<string, PrismaClient>;
  }
}

const coverContentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function resolveCoverPath(root: string, fileName: string) {
  const storageRoot = resolve(root);
  const targetPath = resolve(storageRoot, fileName);
  const offset = relative(storageRoot, targetPath);
  if (!offset || offset.startsWith('..')) return null;
  return targetPath;
}

function isAllowedCorsOrigin(origin: string | undefined, configuredOrigins: string[]) {
  if (!origin) return true;

  return configuredOrigins.some((configuredOrigin) => {
    const allowedOrigin = configuredOrigin.trim();
    if (!allowedOrigin) return false;
    if (!allowedOrigin.startsWith('https://*.')) return origin === allowedOrigin;

    try {
      const candidate = new URL(origin);
      const suffix = allowedOrigin.slice('https://*.'.length).toLowerCase();
      return candidate.protocol === 'https:' && candidate.hostname.toLowerCase().endsWith(`.${suffix}`);
    } catch {
      return false;
    }
  });
}

const miniBootstrapPaths = new Set([
  '/api/v1/auth/anonymous/session',
  '/api/v1/app-entry-ad-sessions'
]);

function isMiniBootstrapRequest(url: string) {
  return miniBootstrapPaths.has(url.split('?', 1)[0]);
}

export async function buildApp(env: Env, options: { prisma?: PrismaClient; taletvPrisma?: PrismaClient; sharedPrisma?: PrismaClient } = {}) {
  const mainEnv: Env = { ...env, MINI_APP_KEY: 'main' };
  const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } });
  const taletvEnv = taletvEnvironment(mainEnv);
  registerErrorHandler(app);
  const configuredCorsOrigins = env.API_CORS_ORIGIN.split(',');
  await app.register(cors, {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin, configuredCorsOrigins)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });
  app.addHook('onRequest', (request, _reply, done) => {
    if (isMiniBootstrapRequest(request.url)) {
      request.log.info({
        method: request.method,
        origin: request.headers.origin ?? null,
        referer: request.headers.referer ?? null,
        requestedMethod: request.headers['access-control-request-method'] ?? null,
        requestedHeaders: request.headers['access-control-request-headers'] ?? null
      }, 'Mini bootstrap request');
    }
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    if (isMiniBootstrapRequest(request.url)) {
      request.log.info({
        method: request.method,
        statusCode: reply.statusCode,
        origin: request.headers.origin ?? null,
        accessControlAllowOrigin: reply.getHeader('access-control-allow-origin') ?? null
      }, 'Mini bootstrap response');
    }
    done();
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 2 * 1024 * 1024 * 1024 } });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await registerPrisma(app, options.prisma);
  const sharedDatabaseUrl = env.SHARED_PLATFORM_DATABASE_URL ?? mainEnv.DATABASE_URL;
  const sharedPrisma = options.sharedPrisma
    ?? (sharedDatabaseUrl === mainEnv.DATABASE_URL
      ? app.prisma
      : new DatabaseClient({ datasources: { db: { url: sharedDatabaseUrl } } }));
  app.decorate('sharedPrisma', sharedPrisma);
  if (!options.sharedPrisma && sharedDatabaseUrl !== mainEnv.DATABASE_URL) {
    app.addHook('onClose', async () => sharedPrisma.$disconnect());
  }

  app.get('/api/v1/assets/covers/:fileName', async (request, reply) => {
    const { fileName } = request.params as { fileName: string };
    const targetPath = resolveCoverPath(env.COVER_ASSET_STORAGE_DIR, fileName);
    if (!targetPath) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Cover asset not found.', requestId: request.id } });
    try {
      await stat(targetPath);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Cover asset not found.', requestId: request.id } });
    }
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.type(coverContentTypes[extname(targetPath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(targetPath));
  });

  app.get('/live', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString()
  }));

  const readiness = async (_request: unknown, reply: { code: (statusCode: number) => unknown }) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      reply.code(503);
      return { status: 'unavailable', database: 'unavailable', timestamp: new Date().toISOString() };
    }
  };
  app.get('/ready', readiness);
  app.get('/health', readiness);

  const registerContext = async (context: FastifyInstance, contextEnv: Env, prisma: PrismaClient, miniAppPrisma: Record<string, PrismaClient>) => {
    context.decorate('config', contextEnv);
    context.decorate('sharedPrisma', sharedPrisma);
    context.decorate('miniAppPrisma', miniAppPrisma);
    await registerPrisma(context, prisma);
    await context.register(async (api) => {
      await registerAuthRoutes(api);
      await registerAppEntryAdRoutes(api);
      await registerAlbumRoutes(api);
      await registerEpisodeRoutes(api);
      await registerProgressRoutes(api);
      await registerHomeRoutes(api);
      await registerSearchRoutes(api);
      await registerInteractionRoutes(api);
      await registerProfileRoutes(api);
      await registerAdRoutes(api);
      await registerUiRoutes(api);
      await registerAdminRoutes(api);
    });
  };
  const miniAppPrisma: Record<string, PrismaClient> = { main: app.prisma };
  await app.register((context) => registerContext(context, mainEnv, app.prisma, miniAppPrisma), { prefix: '/api/v1' });
  if (taletvEnv) {
    const taletvPrisma = options.taletvPrisma ?? new DatabaseClient({ datasources: { db: { url: taletvEnv.DATABASE_URL } } });
    miniAppPrisma.taletv = taletvPrisma;
    await app.register((context) => registerContext(context, taletvEnv, taletvPrisma, miniAppPrisma), { prefix: '/api/taletv/v1' });
    if (!options.taletvPrisma) app.addHook('onClose', async () => taletvPrisma.$disconnect());
  }
  return app;
}
