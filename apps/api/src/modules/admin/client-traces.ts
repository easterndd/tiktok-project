import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const searchInput = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
  releaseId: z.string().max(64).optional(),
  traceId: z.string().max(128).optional(),
  platform: z.enum(['ios', 'android', 'unknown']).optional(),
  operationId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  requestId: z.string().max(128).optional(),
  placementId: z.string().max(128).optional(),
  errorCode: z.string().max(128).optional(),
  cursor: z.string().max(128).optional()
});
const detailInput = z.object({ traceId: z.string().min(1).max(128) });

export async function readClientTraceSessions(app: FastifyInstance, rawQuery: unknown) {
  const query = searchInput.parse(rawQuery);
  const recordFilter = {
    operationId: query.operationId || undefined,
    sessionId: query.sessionId || undefined,
    requestId: query.requestId || undefined,
    placementId: query.placementId || undefined,
    errorCode: query.errorCode || undefined
  };
  const filterRecords = Object.values(recordFilter).some(Boolean);
  const sessions = await app.prisma.clientTraceSession.findMany({
    where: {
      id: query.traceId || undefined,
      releaseId: query.releaseId || undefined,
      platform: query.platform,
      lastEventAt: { gte: new Date(Date.now() - query.hours * 3_600_000) },
      ...(filterRecords ? { records: { some: recordFilter } } : {})
    },
    orderBy: [{ lastEventAt: 'desc' }, { id: 'desc' }],
    take: 31,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    select: {
      id: true, miniAppKey: true, releaseId: true, platform: true, userId: true,
      startedAt: true, lastEventAt: true, createdAt: true,
      _count: { select: { records: true } }
    }
  });
  return { items: sessions.slice(0, 30), nextCursor: sessions.length > 30 ? sessions[29]?.id ?? null : null };
}

export async function readClientTraceRecords(app: FastifyInstance, rawParams: unknown, rawQuery: unknown) {
  const { traceId } = detailInput.parse(rawParams);
  const { cursor } = z.object({ cursor: z.string().max(128).optional() }).parse(rawQuery);
  const session = await app.prisma.clientTraceSession.findUnique({
    where: { id: traceId },
    select: { id: true, miniAppKey: true, releaseId: true, platform: true, userId: true, startedAt: true, lastEventAt: true }
  });
  if (!session) return { session: null, items: [], nextCursor: null };
  const records = await app.prisma.clientTraceRecord.findMany({
    where: { traceId },
    orderBy: [{ seq: 'asc' }, { id: 'asc' }],
    take: 201,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true, recordId: true, seq: true, kind: true, phase: true,
      operationId: true, sessionId: true, requestId: true, placementId: true,
      errorCode: true, subErrorCode: true,
      eventAt: true, receivedAt: true, payload: true, truncated: true
    }
  });
  return { session, items: records.slice(0, 200), nextCursor: records.length > 200 ? records[199]?.id ?? null : null };
}
