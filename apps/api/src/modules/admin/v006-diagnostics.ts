import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const querySchema = z.object({
  hours: z.coerce.number().int().min(1).max(72).default(24),
  releaseId: z.string().trim().min(1).max(64).optional(),
  platform: z.enum(['ios', 'android', 'unknown']).optional(),
  adType: z.enum(['REWARDED', 'INTERSTITIAL']).optional(),
  placementId: z.string().trim().max(128).optional(),
  strategyVariant: z.string().trim().max(64).optional(),
  operationId: z.string().trim().max(128).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export function parseV006DiagnosticsQuery(value: unknown, now = new Date()) {
  const query = querySchema.parse(value);
  const end = query.to ? new Date(query.to) : now;
  const start = query.from ? new Date(query.from) : new Date(end.getTime() - query.hours * 3_600_000);
  if (end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 72 * 3_600_000
    || start.getTime() < now.getTime() - 72 * 3_600_000 || end.getTime() > now.getTime() + 60_000) {
    throw Object.assign(new Error('Diagnostics range must be within the past 72 hours.'), { statusCode: 400 });
  }
  return { query, start, end };
}

type AdSummaryRow = {
  releaseId: string;
  platform: string;
  strategyVariant: string;
  adType: string;
  placementId: string;
  placementRole: string;
  firstAttempts: number;
  backupAttempts: number;
  showSuccesses: number;
  showFailures: number;
  closeOperations: number;
  completedOperations: number;
  error50008: number;
  error11006: number;
  callbackEligibleEvents: number;
  sdkCallbackEvents: number;
};

type AdErrorRow = {
  releaseId: string;
  platform: string;
  strategyVariant: string;
  adType: string;
  placementId: string;
  adPhase: string;
  errorOrigin: string;
  errorCode: string;
  subErrorCode: string;
  operations: number;
  events: number;
};

type PlayerSummaryRow = {
  releaseId: string;
  platform: string;
  starts: number;
  firstFrames: number;
  errors: number;
  preloadHits: number;
  preloadObservations: number;
  firstFrameP50Ms: number | null;
  firstFrameP95Ms: number | null;
};

type PlayerErrorRow = {
  releaseId: string;
  platform: string;
  stage: string;
  errorCode: string;
  operations: number;
  events: number;
};

export async function readV006AdDiagnostics(app: FastifyInstance, input: unknown) {
  const { query, start, end } = parseV006DiagnosticsQuery(input);
  const conditions = [
    Prisma.sql`"miniAppKey" = ${app.config.MINI_APP_KEY}`,
    Prisma.sql`"receivedAt" >= ${start}`,
    Prisma.sql`"receivedAt" < ${end}`,
    Prisma.sql`"operationId" IS NOT NULL`
  ];
  if (query.releaseId) conditions.push(Prisma.sql`"releaseId" = ${query.releaseId}`);
  if (query.platform) conditions.push(Prisma.sql`"platform" = ${query.platform}`);
  if (query.placementId) conditions.push(Prisma.sql`"placementId" = ${query.placementId}`);
  if (query.strategyVariant) conditions.push(Prisma.sql`"strategyVariant" = ${query.strategyVariant}`);
  if (query.operationId) conditions.push(Prisma.sql`"operationId" = ${query.operationId}`);
  if (query.adType) conditions.push(Prisma.sql`"adType" = ${query.adType}`);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const [summary, errors] = await Promise.all([
    app.prisma.$queryRaw<AdSummaryRow[]>(Prisma.sql`
      SELECT "releaseId", COALESCE("platform", 'unknown') AS "platform",
        COALESCE("strategyVariant", 'CONTROL') AS "strategyVariant",
        COALESCE("adType", 'UNKNOWN') AS "adType",
        COALESCE("placementId", '') AS "placementId",
        COALESCE("placementRole", 'UNKNOWN') AS "placementRole",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND "placementRole" IS DISTINCT FROM 'BACKUP'))::int AS "firstAttempts",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND "placementRole" = 'BACKUP'))::int AS "backupAttempts",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND "result" = 'success'))::int AS "showSuccesses",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND "result" IN ('fail', 'timeout')))::int AS "showFailures",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_close'))::int AS "closeOperations",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_close' AND "isEnded" = true))::int AS "completedOperations",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND ("subErrorCode" = '50008' OR "errorCode" = '50008')))::int AS "error50008",
        (COUNT(DISTINCT "operationId") FILTER (WHERE "eventKey" = 'ad_show' AND ("subErrorCode" = '11006' OR "errorCode" = '11006')))::int AS "error11006",
        (COUNT(*) FILTER (WHERE "eventKey" = 'ad_close' OR ("eventKey" = 'ad_show' AND "errorOrigin" = 'SDK_CALLBACK')))::int AS "callbackEligibleEvents",
        (COUNT(*) FILTER (WHERE ("eventKey" = 'ad_close' AND "metadata"->'sdkCallback'->>'name' = 'onClose')
          OR ("eventKey" = 'ad_show' AND "errorOrigin" = 'SDK_CALLBACK' AND "metadata"->'sdkCallback'->>'name' = 'onError')))::int AS "sdkCallbackEvents"
      FROM "ClientAnalyticsEvent" ${where}
      GROUP BY 1, 2, 3, 4, 5, 6
      ORDER BY "firstAttempts" DESC, "backupAttempts" DESC LIMIT 100
    `),
    app.prisma.$queryRaw<AdErrorRow[]>(Prisma.sql`
      SELECT "releaseId", COALESCE("platform", 'unknown') AS "platform",
        COALESCE("strategyVariant", 'CONTROL') AS "strategyVariant",
        COALESCE("adType", 'UNKNOWN') AS "adType",
        COALESCE("placementId", '') AS "placementId", COALESCE("adPhase", 'UNKNOWN') AS "adPhase",
        COALESCE("errorOrigin", 'UNKNOWN') AS "errorOrigin",
        COALESCE("errorCode", 'UNKNOWN') AS "errorCode",
        COALESCE("subErrorCode", 'UNKNOWN') AS "subErrorCode",
        COUNT(DISTINCT "operationId")::int AS "operations", COUNT(*)::int AS "events"
      FROM "ClientAnalyticsEvent" ${where}
        AND "eventKey" IN ('ad_load', 'ad_show') AND "result" IN ('fail', 'timeout')
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
      ORDER BY "operations" DESC LIMIT 50
    `)
  ]);
  return { from: start.toISOString(), to: end.toISOString(), summary, errors };
}

export async function readV006PlayerDiagnostics(app: FastifyInstance, input: unknown) {
  const { query, start, end } = parseV006DiagnosticsQuery(input);
  const conditions = [
    Prisma.sql`"createdAt" >= ${start}`,
    Prisma.sql`"createdAt" < ${end}`,
    Prisma.sql`"playerOperationId" IS NOT NULL`
  ];
  if (query.releaseId) conditions.push(Prisma.sql`"clientVersion" = ${query.releaseId}`);
  if (query.platform) conditions.push(Prisma.sql`"platform" = ${query.platform}`);
  if (query.operationId) conditions.push(Prisma.sql`"playerOperationId" = ${query.operationId}`);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const [summary, errors] = await Promise.all([
    app.prisma.$queryRaw<PlayerSummaryRow[]>(Prisma.sql`
      SELECT COALESCE("clientVersion", 'unknown') AS "releaseId", COALESCE("platform", 'unknown') AS "platform",
        (COUNT(DISTINCT "playerOperationId") FILTER (WHERE "eventType" = 'START'))::int AS "starts",
        (COUNT(DISTINCT "playerOperationId") FILTER (WHERE "eventType" = 'FIRST_FRAME'))::int AS "firstFrames",
        (COUNT(DISTINCT "playerOperationId") FILTER (WHERE "eventType" = 'ERROR'))::int AS "errors",
        (COUNT(*) FILTER (WHERE "eventType" = 'PLAYER_CONSTRUCTED' AND "preloadHit" = true))::int AS "preloadHits",
        (COUNT(*) FILTER (WHERE "eventType" = 'PLAYER_CONSTRUCTED' AND "preloadHit" IS NOT NULL))::int AS "preloadObservations",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "startupMs") FILTER (WHERE "eventType" = 'FIRST_FRAME') AS "firstFrameP50Ms",
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "startupMs") FILTER (WHERE "eventType" = 'FIRST_FRAME') AS "firstFrameP95Ms"
      FROM "PlaybackQualityEvent" ${where}
      GROUP BY 1, 2 ORDER BY "starts" DESC LIMIT 50
    `),
    app.prisma.$queryRaw<PlayerErrorRow[]>(Prisma.sql`
      SELECT COALESCE("clientVersion", 'unknown') AS "releaseId", COALESCE("platform", 'unknown') AS "platform",
        COALESCE("stage", 'UNKNOWN') AS "stage", COALESCE("errorCode", 'UNKNOWN') AS "errorCode",
        COUNT(DISTINCT "playerOperationId")::int AS "operations", COUNT(*)::int AS "events"
      FROM "PlaybackQualityEvent" ${where} AND "eventType" = 'ERROR'
      GROUP BY 1, 2, 3, 4
      ORDER BY "operations" DESC LIMIT 50
    `)
  ]);
  return { from: start.toISOString(), to: end.toISOString(), summary, errors };
}
