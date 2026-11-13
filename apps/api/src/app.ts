import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import type { Env } from './config/env';
import { configuredMiniAppKeys, miniAppEnvironment, miniAppPath, miniAppKeys, type MiniAppKey } from './config/mini-apps';
import { runtimeDatabaseUrl } from './config/database-pool';
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
import { registerDiagnosticRoutes } from './modules/diagnostics/routes';
import { registerAnalyticsRoutes } from './modules/analytics/routes';
import { registerAppEntryAdRoutes } from './modules/app-entry-ads/routes';
import { registerAdminRoutes } from './modules/admin/routes';
import { registerUiRoutes } from './modules/ui/routes';
import { registerErrorHandler } from './plugins/error-handler';
import { registerPrisma } from './plugins/prisma';
import { getDatabaseDuration, sampleResponseLog, type ResponseLogSampleCache } from './lib/request-performance';
import { RequestConcurrencyGate } from './lib/request-concurrency';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    rootConfig: Env;
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

const miniBootstrapPath = new RegExp(`^/api/(?:(?:${miniAppKeys.filter((key) => key !== 'main').join('|')})/)?v1/(?:auth/anonymous/session|app-entry-ad-sessions)$`);
const miniPerformancePath = /\/(?:auth\/anonymous\/session|app-entry-ad-sessions(?:\/[^/]+\/(?:complete|shown))?|home(?:\/progress)?|ad-events|episode-interstitial\/config|episodes\/[^/]+\/reward-session(?:\/[^/]+\/complete)?)$/;
const requestStartedAt = new WeakMap<object, number>();
const requestReceivedAt = new WeakMap<object, number>();
const responseErrorCode = new WeakMap<object, string>();
const responseLogSamples: ResponseLogSampleCache = new Map();
const responseLogSampleIntervalMs = 10_000;
const maxResponseLogSampleKeys = 4_096;

function isMiniBootstrapRequest(url: string) {
  return miniBootstrapPath.test(url.split('?', 1)[0]);
}

export async function buildApp(env: Env, options: { prisma?: PrismaClient; taletvPrisma?: PrismaClient; miniPrisma?: Partial<Record<MiniAppKey, PrismaClient>>; sharedPrisma?: PrismaClient } = {}) {
  const mainEnv: Env = { ...env, MINI_APP_KEY: 'main' };
  const trustedProxies = env.TRUSTED_PROXY_CIDRS.split(',').map((value) => value.trim()).filter(Boolean);
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    logController: new LogController({ disableRequestLogging: env.NODE_ENV === 'production' }),
    trustProxy: trustedProxies.length ? trustedProxies : false
  });
  const requestGate = new RequestConcurrencyGate(env.API_DB_CONCURRENCY, env.API_DB_QUEUE_LIMIT, {
    perKeyLimit: env.API_DB_CONCURRENCY_PER_APP, perKeyQueueLimit: env.API_DB_QUEUE_LIMIT_PER_APP,
    reserved: env.API_DB_RESERVED, perKeyReserved: 1, waitMs: env.API_DB_QUEUE_WAIT_MS
  });
  const responseMetricsStartedAt = new Date().toISOString();
  const responsesByApp = new Map<string, { success: number; redirect: number; clientError: number; serverError: number }>();
  const serverErrorsByRoute = new Map<string, { appKey: string; route: string; statusCode: number; count: number }>();
  const requestReleases = new WeakMap<object, () => void>();
  const releaseRequest = (request: object) => {
    requestReleases.get(request)?.();
    requestReleases.delete(request);
  };
  registerErrorHandler(app);
  const configuredCorsOrigins = env.API_CORS_ORIGIN.split(',');
  app.addHook('onRequest', (request, _reply, done) => {
    requestReceivedAt.set(request, performance.now());
    const isBootstrapRequest = isMiniBootstrapRequest(request.url);
    const corsAllowed = isAllowedCorsOrigin(request.headers.origin, configuredCorsOrigins);
    if (isBootstrapRequest && (env.NODE_ENV !== 'production' || !corsAllowed || Math.random() < 0.01)) {
      request.log.info({
        method: request.method,
        path: request.url.split('?', 1)[0],
        origin: request.headers.origin ?? null,
        corsAllowed,
        requestedMethod: request.headers['access-control-request-method'] ?? null,
        requestedHeaders: request.headers['access-control-request-headers'] ?? null
      }, 'Mini bootstrap request');
    }
    if (miniPerformancePath.test(request.url.split('?', 1)[0])) requestStartedAt.set(request, performance.now());
    done();
  });
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?', 1)[0];
    if (request.method === 'OPTIONS' || path === '/live' || path === '/ready' || path === '/health' || path.startsWith('/api/v1/assets/covers/')) return;
    const routeConfig = request.routeOptions.config as { hasReadyPublicHomeResponse?: (request: FastifyRequest) => boolean } | undefined;
    if (request.method === 'GET' && routeConfig?.hasReadyPublicHomeResponse?.(request)) return;
    const body = request.body as { eventType?: string } | undefined;
    if (path.endsWith('/ad-events') && (body?.eventType === 'REQUESTED' || body?.eventType === 'CLOSED_INCOMPLETE'
      || (body?.eventType === 'FAILED' && env.PERSIST_CLIENT_AD_DIAGNOSTICS !== true))) return;
    const parts = path.split('/');
    const candidateKey = parts[2] === 'v1' ? 'main' : parts[2];
    const key = miniAppKeys.includes(candidateKey as MiniAppKey) ? candidateKey : 'system';
    const critical = /\/(?:auth\/(?:anonymous\/session|login)|app-entry-ad-sessions(?:\/[^/]+\/(?:complete|shown))?|ad-events|episodes\/[^/]+\/reward-session(?:\/[^/]+\/complete)?)$/.test(path);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    const release = await requestGate.acquire({ key, label: request.routeOptions.url ?? 'unmatched', critical, signal: controller.signal });
    reply.raw.removeListener('close', abort);
    if (!release) {
      reply.header('Retry-After', '2');
      return reply.code(503).send({ error: { code: 'SERVER_BUSY', message: 'The service is busy. Please retry shortly.', requestId: request.id } });
    }
    requestReleases.set(request, release);

  });
  await app.register(cors, {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin, configuredCorsOrigins)),
    credentials: true,
    maxAge: 600,
    exposedHeaders: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Server-Timing', 'X-Request-ID', 'Content-Length'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  app.addHook('onError', async (request) => { releaseRequest(request); });
  app.addHook('onSend', async (request, reply) => {
    releaseRequest(request);
    if (request.url.startsWith('/api/')) reply.header('X-Request-ID', request.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (miniPerformancePath.test(request.url.split('?', 1)[0])) {
      const databaseMs = getDatabaseDuration(request);
      const startedAt = requestStartedAt.get(request) ?? performance.now();
      reply.header('Server-Timing', `${databaseMs === undefined ? '' : `db;dur=${databaseMs.toFixed(1)}, `}app;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`);
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode >= 400 && typeof payload === 'string' && payload.length <= 8_192) {
      try {
        const code = (JSON.parse(payload) as { error?: { code?: unknown } }).error?.code;
        if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)) responseErrorCode.set(request, code);
      } catch { /* Non-JSON error responses retain their HTTP status. */ }
    }
    return payload;
  });
  app.addHook('onResponse', (request, reply, done) => {
    releaseRequest(request);
    if (reply.statusCode >= 400) {
      const details = {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url.split('?', 1)[0],
        statusCode: reply.statusCode,
        errorCode: responseErrorCode.get(request) ?? null,
        durationMs: requestReceivedAt.has(request) ? Number((performance.now() - requestReceivedAt.get(request)!).toFixed(1)) : null
      };
      if (reply.statusCode >= 500) request.log.error(details, 'API request failed');
      else request.log.warn(details, 'API request rejected');
    }
    const pathParts = request.url.split('?', 1)[0].split('/');
    if (pathParts[1] === 'api') {
      const candidateKey = pathParts[2] === 'v1' ? 'main' : pathParts[2];
      if (miniAppKeys.includes(candidateKey as MiniAppKey)) {
        const counts = responsesByApp.get(candidateKey) ?? { success: 0, redirect: 0, clientError: 0, serverError: 0 };
        if (reply.statusCode >= 500) counts.serverError++;
        else if (reply.statusCode >= 400) counts.clientError++;
        else if (reply.statusCode >= 300) counts.redirect++;
        else counts.success++;
        responsesByApp.set(candidateKey, counts);
        if (reply.statusCode >= 500) {
          const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
          const metricKey = `${candidateKey}:${route}:${reply.statusCode}`;
          const existing = serverErrorsByRoute.get(metricKey);
          if (existing) existing.count++;
          else if (serverErrorsByRoute.size < 512) serverErrorsByRoute.set(metricKey, { appKey: candidateKey, route, statusCode: reply.statusCode, count: 1 });
        }
      }
    }
    const startedAt = requestStartedAt.get(request);
    if (startedAt !== undefined) {
      const durationMs = Number((performance.now() - startedAt).toFixed(1));
      const needsDetailedLog = durationMs >= 2_000;
      let shouldLog = needsDetailedLog || env.NODE_ENV !== 'production' || Math.random() < 0.01;
      let suppressedResponses = 0;
      if (env.NODE_ENV === 'production' && needsDetailedLog) {
        const route = request.routeOptions.url ?? request.url.split('?', 1)[0];
        const sample = sampleResponseLog(responseLogSamples, `${route}:${reply.statusCode}`, Date.now(), responseLogSampleIntervalMs, maxResponseLogSampleKeys);
        shouldLog = sample !== null;
        suppressedResponses = sample ?? 0;
      }
      if (shouldLog) {
        const databaseMs = getDatabaseDuration(request);
        const isBootstrapRequest = isMiniBootstrapRequest(request.url);
        request.log.info({
          method: request.method,
          path: request.url.split('?', 1)[0],
          statusCode: reply.statusCode,
          durationMs,
          databaseMs: databaseMs === undefined ? null : Number(databaseMs.toFixed(1)),
          sampleRate: reply.statusCode >= 400 || durationMs >= 2_000 ? 1 : 0.01,
          ...(suppressedResponses ? { suppressedResponses } : {}),
          ...(isBootstrapRequest ? {
            origin: request.headers.origin ?? null,
            corsAllowed: isAllowedCorsOrigin(request.headers.origin, configuredCorsOrigins),
            accessControlAllowOrigin: reply.getHeader('access-control-allow-origin') ?? null
          } : {})
        }, isBootstrapRequest ? 'Mini bootstrap response' : 'Mini performance response');
      }
      requestStartedAt.delete(request);
    }
    done();
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 2 * 1024 * 1024 * 1024 } });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, {
    max: (request) => request.url.split('?', 1)[0].includes('/admin/') ? 240 : 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const parts = request.url.split('?', 1)[0].split('/');
      const appKey = parts[1] === 'api' && parts[2] === 'v1' ? 'main' : parts[1] === 'api' && parts[3] === 'v1' ? parts[2] : 'system';
      const ipKey = `ip:${appKey}:${request.ip}`;
      // The anonymous bootstrap runs before a bearer token exists. Keep the
      // stricter login endpoint separate from other unauthenticated traffic.
      if (request.url.split('?', 1)[0].endsWith('/auth/login')) return `admin-login:${appKey}:${request.ip}`;
      if (request.url.split('?', 1)[0].endsWith('/auth/anonymous/session')) return `anonymous-login:${appKey}:${request.ip}`;
      const authorization = request.headers.authorization;
      if (authorization?.startsWith('Bearer ')) {
        try {
          const claims = app.jwt.verify<{ sub?: string; kind?: string; appKey?: string }>(authorization.slice(7));
          if (claims.sub && claims.appKey === appKey && (claims.kind === 'admin' || claims.kind === 'user')) {
            return `${claims.kind}:${appKey}:${claims.sub}`;
          }
        } catch { /* Invalid tokens retain an IP based limit and fail authorization normally. */ }
      }
      return ipKey;
    }
  });
  await registerPrisma(app, options.prisma, runtimeDatabaseUrl(mainEnv.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT, env.API_DATABASE_CONNECTION_LIMIT));
  const sharedDatabaseUrl = env.SHARED_PLATFORM_DATABASE_URL ?? mainEnv.DATABASE_URL;
  const sharedPrisma = options.sharedPrisma
    ?? (sharedDatabaseUrl === mainEnv.DATABASE_URL
      ? app.prisma
      : new DatabaseClient({ datasources: { db: { url: runtimeDatabaseUrl(sharedDatabaseUrl, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT, env.API_DATABASE_CONNECTION_LIMIT) } } }));
  app.decorate('sharedPrisma', sharedPrisma);
  if (!options.sharedPrisma && sharedDatabaseUrl !== mainEnv.DATABASE_URL) {
    app.addHook('onClose', async () => sharedPrisma.$disconnect());
  }

  app.get('/api/v1/assets/covers/:fileName', async (request, reply) => {
    const { fileName } = request.params as { fileName: string };
    const targetPath = resolveCoverPath(env.COVER_ASSET_STORAGE_DIR, fileName);
    if (!targetPath) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Cover asset not found.', requestId: request.id } });
    let metadata;
    try {
      metadata = await stat(targetPath);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Cover asset not found.', requestId: request.id } });
    }
    const etag = `"${metadata.size.toString(16)}-${Math.floor(metadata.mtimeMs).toString(16)}"`;
    reply.header('etag', etag);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('content-length', String(metadata.size));
    reply.type(coverContentTypes[extname(targetPath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(targetPath));
  });

  app.get('/live', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    admission: requestGate.stats,
    responseMetrics: {
      since: responseMetricsStartedAt,
      apps: [...responsesByApp].map(([key, counts]) => ({ key, ...counts })),
      topServerErrors: [...serverErrorsByRoute.values()].sort((a, b) => b.count - a.count).slice(0, 20)
    },
    timestamp: new Date().toISOString()
  }));

  const probeUrl = new URL(runtimeDatabaseUrl(mainEnv.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT, env.API_DATABASE_CONNECTION_LIMIT));
  probeUrl.searchParams.set('connection_limit', '1');
  probeUrl.searchParams.set('pool_timeout', '1');
  probeUrl.searchParams.set('connect_timeout', '2');
  const probePrisma = options.prisma ?? new DatabaseClient({ datasources: { db: { url: probeUrl.toString() } } });
  if (!options.prisma) app.addHook('onClose', async () => probePrisma.$disconnect());
  let pendingProbe: Promise<unknown> | undefined;
  const readiness = async (_request: unknown, reply: { code: (statusCode: number) => unknown }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!pendingProbe) {
        const probe = probePrisma.$queryRaw`SELECT 1`;
        pendingProbe = Promise.resolve(probe).finally(() => { pendingProbe = undefined; });
      }
      await Promise.race([pendingProbe, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe timeout')), 1500); })]);
      return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      reply.code(503);
      return { status: 'unavailable', database: 'unavailable', timestamp: new Date().toISOString() };
    } finally { clearTimeout(timer); }
  };
  app.get('/ready', { config: { rateLimit: false } }, readiness);
  app.get('/health', { config: { rateLimit: false } }, readiness);

  const registerContext = async (context: FastifyInstance, contextEnv: Env, prisma: PrismaClient, miniAppPrisma: Record<string, PrismaClient>) => {
    context.decorate('config', contextEnv);
    context.decorate('rootConfig', mainEnv);
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
      await registerDiagnosticRoutes(api);
      await registerAnalyticsRoutes(api);
      await registerUiRoutes(api);
      await registerAdminRoutes(api);
    });
  };
  const miniAppPrisma: Record<string, PrismaClient> = { main: app.prisma };
  await app.register((context) => registerContext(context, mainEnv, app.prisma, miniAppPrisma), { prefix: '/api/v1' });
  for (const key of configuredMiniAppKeys(mainEnv).filter((item): item is Exclude<MiniAppKey, 'main'> => item !== 'main')) {
    const contextEnv = miniAppEnvironment(mainEnv, key);
    if (!contextEnv) continue;
    const providedPrisma = options.miniPrisma?.[key] ?? (key === 'taletv' ? options.taletvPrisma : undefined);
    const prisma = providedPrisma ?? new DatabaseClient({ datasources: { db: { url: runtimeDatabaseUrl(contextEnv.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT, env.API_DATABASE_CONNECTION_LIMIT) } } });
    miniAppPrisma[key] = prisma;
    await app.register((context) => registerContext(context, contextEnv, prisma, miniAppPrisma), { prefix: `/api/${miniAppPath(key)}/v1` });
    if (!providedPrisma) app.addHook('onClose', async () => prisma.$disconnect());
  }
  return app;
}
