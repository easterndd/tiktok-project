import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { Env } from './config/env';
import { registerAlbumRoutes } from './modules/albums/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerEpisodeRoutes } from './modules/episodes/routes';
import { registerProgressRoutes } from './modules/progress/routes';
import { registerErrorHandler } from './plugins/error-handler';
import { registerPrisma } from './plugins/prisma';

export async function buildApp(env: Env) {
  const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } });
  registerErrorHandler(app);
  await app.register(cors, { origin: env.API_CORS_ORIGIN.split(','), credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await registerPrisma(app);

  app.get('/health', async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unavailable' };
    }
  });

  await app.register(async (api) => {
    await registerAuthRoutes(api);
    await registerAlbumRoutes(api);
    await registerEpisodeRoutes(api);
    await registerProgressRoutes(api);
  }, { prefix: '/api/v1' });
  return app;
}
