import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Env } from './config/env';
import { registerAlbumRoutes } from './modules/albums/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerEpisodeRoutes } from './modules/episodes/routes';
import { registerProgressRoutes } from './modules/progress/routes';
import { registerHomeRoutes } from './modules/home/routes';
import { registerSearchRoutes } from './modules/search/routes';
import { registerInteractionRoutes } from './modules/interactions/routes';
import { registerProfileRoutes } from './modules/profile/routes';
import { registerAdRoutes } from './modules/ads/routes';
import { registerAdminRoutes } from './modules/admin/routes';
import { registerUiRoutes } from './modules/ui/routes';
import { registerErrorHandler } from './plugins/error-handler';
import { registerPrisma } from './plugins/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}

export async function buildApp(env: Env, options: { prisma?: PrismaClient } = {}) {
  const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } });
  app.decorate('config', env);
  registerErrorHandler(app);
  await app.register(cors, { origin: env.API_CORS_ORIGIN.split(','), credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await registerPrisma(app, options.prisma);

  app.get('/health', async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', database: 'unavailable', timestamp: new Date().toISOString() };
    }
  });

  await app.register(async (api) => {
    await registerAuthRoutes(api, env);
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
  }, { prefix: '/api/v1' });
  return app;
}
