import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { MiniAppKey } from '../config/mini-apps';

const rawIpRetentionMs = 30 * 86_400_000;
const sharedIpVisitAggregationWindowMs = 15 * 60_000;
type SharedIpDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
const maxPendingSharedIpVisits = 1_024;
const maxConcurrentSharedIpVisits = 2;
const sharedIpVisitOverflowLogInterval = 1_000;
const completedSharedIpVisitTtlMs = sharedIpVisitAggregationWindowMs;
const maxCompletedSharedIpVisitKeys = 50_000;
const entryAdIpExemptionTtlMs = 5_000;
const maxEntryAdIpExemptionKeys = 10_000;
type SharedIpVisitJob = {
  db: PrismaClient;
  input: Parameters<typeof recordSharedIpVisit>[1];
  onError: (error: unknown) => void;
  key: string;
  windowId: number;
};
const pendingSharedIpVisits: SharedIpVisitJob[] = [];
const pendingSharedIpVisitKeys = new Set<string>();
const completedSharedIpVisitKeys = new WeakMap<object, Map<string, number>>();
const entryAdIpExemptionCache = new WeakMap<object, Map<string, { exempt: boolean; expiresAt: number }>>();
const sharedIpVisitDrainWaiters: Array<() => void> = [];
let activeSharedIpVisits = 0;
let droppedSharedIpVisits = 0;

function reportSharedIpVisitQueueState() {
  if (activeSharedIpVisits !== 0 || pendingSharedIpVisits.length !== 0) return;
  for (const resolve of sharedIpVisitDrainWaiters.splice(0)) resolve();
}

function completedSharedIpVisitCache(db: PrismaClient) {
  let cache = completedSharedIpVisitKeys.get(db);
  if (!cache) {
    cache = new Map();
    completedSharedIpVisitKeys.set(db, cache);
  }
  return cache;
}

function hasRecentlyCompletedSharedIpVisit(db: PrismaClient, key: string, now = Date.now()) {
  const cache = completedSharedIpVisitCache(db);
  for (const [cachedKey, completedAt] of cache) {
    if (now - completedAt < completedSharedIpVisitTtlMs) break;
    cache.delete(cachedKey);
  }
  const completedAt = cache.get(key);
  return completedAt !== undefined && now - completedAt < completedSharedIpVisitTtlMs;
}

function rememberCompletedSharedIpVisit(db: PrismaClient, key: string, now = Date.now()) {
  const cache = completedSharedIpVisitCache(db);
  cache.set(key, now);
  while (cache.size > maxCompletedSharedIpVisitKeys) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function exemptionCacheFor(db: SharedIpDb) {
  let cache = entryAdIpExemptionCache.get(db);
  if (!cache) {
    cache = new Map();
    entryAdIpExemptionCache.set(db, cache);
  }
  return cache;
}

function clearEntryAdIpExemptionCache(db: SharedIpDb, ip?: string) {
  const cache = entryAdIpExemptionCache.get(db);
  if (!cache) return;
  if (ip) cache.delete(ip);
  else cache.clear();
}

function runSharedIpVisitQueue() {
  while (activeSharedIpVisits < maxConcurrentSharedIpVisits && pendingSharedIpVisits.length > 0) {
    const job = pendingSharedIpVisits.shift()!;
    activeSharedIpVisits += 1;
    void recordSharedIpVisitForWindow(job.db, job.input, job.windowId)
      .then(() => rememberCompletedSharedIpVisit(job.db, job.key))
      .catch((error) => {
        try { job.onError(error); } catch { /* Logging must not stop queue progress. */ }
      })
      .finally(() => {
        activeSharedIpVisits -= 1;
        pendingSharedIpVisitKeys.delete(job.key);
        runSharedIpVisitQueue();
        reportSharedIpVisitQueueState();
      });
  }
  reportSharedIpVisitQueueState();
}

function reportSharedIpVisitOverflow(onError: (error: unknown) => void) {
  droppedSharedIpVisits += 1;
  if (droppedSharedIpVisits < sharedIpVisitOverflowLogInterval) return;
  const dropped = droppedSharedIpVisits;
  droppedSharedIpVisits = 0;
  try {
    onError(new Error(`Shared IP visit queue is full; dropped ${dropped} visits since the last report`));
  } catch { /* Logging must not affect the request path. */ }
}

export function queueSharedIpVisit(db: PrismaClient, input: Parameters<typeof recordSharedIpVisit>[1], onError: (error: unknown) => void) {
  const ip = input.ipAddress && normalizeIp(input.ipAddress);
  if (!ip) return;
  const windowId = Math.floor(Date.now() / sharedIpVisitAggregationWindowMs);
  const key = visitKey(input.miniAppKey, input.userId, ipHash(ip, input.secret), windowId, input.secret);
  if (hasRecentlyCompletedSharedIpVisit(db, key)) return;
  if (pendingSharedIpVisitKeys.has(key)) return;
  if (pendingSharedIpVisits.length >= maxPendingSharedIpVisits) {
    reportSharedIpVisitOverflow(onError);
    return;
  }
  pendingSharedIpVisitKeys.add(key);
  pendingSharedIpVisits.push({ db, input: { ...input, ipAddress: ip }, onError, key, windowId });
  runSharedIpVisitQueue();
}

export function waitForSharedIpVisits() {
  if (activeSharedIpVisits === 0 && pendingSharedIpVisits.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => sharedIpVisitDrainWaiters.push(resolve));
}

export function normalizeIp(value: string): string | null {
  const candidate = value.trim();
  if (isIP(candidate) === 4) return candidate;
  if (candidate.toLowerCase().startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) return candidate.slice(7);
  if (isIP(candidate) !== 6) return null;
  // URL canonicalizes equivalent IPv6 spellings before matching a stored exemption.
  return new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
}

function ipHash(ip: string, secret: string) {
  return createHmac('sha256', secret).update(`shared-ip:${ip}`).digest('hex');
}

function visitKey(appKey: string, userId: string, hashedIp: string, windowId: number, secret: string) {
  return createHmac('sha256', secret).update(['shared-ip-visit-v2', appKey, userId, hashedIp, windowId].join(':')).digest('hex');
}

type SharedIpVisitInput = { ipAddress: string | null; miniAppKey: string; userId: string; clientSessionId: string; countryCode: string | null; secret: string };

async function recordSharedIpVisitForWindow(db: PrismaClient, input: SharedIpVisitInput, windowId: number) {
  const ip = input.ipAddress && normalizeIp(input.ipAddress);
  if (!ip) return;
  const hash = ipHash(ip, input.secret);
  const key = visitKey(input.miniAppKey, input.userId, hash, windowId, input.secret);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "SharedIpAddress" ("ipHash", "ipAddress", "lastMiniAppKey", "countryCode")
      VALUES (${hash}, ${ip}, ${input.miniAppKey}, ${input.countryCode})
      ON CONFLICT ("ipHash") DO NOTHING`;
    await tx.$executeRaw`
      WITH inserted_visit AS (
      INSERT INTO "SharedIpVisit" ("idempotencyKey", "ipHash", "miniAppKey", "userId")
      VALUES (${key}, ${hash}, ${input.miniAppKey}, ${input.userId})
      ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING 1
      )
      UPDATE "SharedIpAddress"
      SET "ipAddress" = ${ip},
          "lastSeenAt" = CURRENT_TIMESTAMP,
          "lastMiniAppKey" = ${input.miniAppKey},
          "countryCode" = ${input.countryCode},
          "visitCount" = "visitCount" + 1
      WHERE "ipHash" = ${hash}::char(64)
        AND EXISTS (SELECT 1 FROM inserted_visit)`;
  });
}

export async function recordSharedIpVisit(db: PrismaClient, input: SharedIpVisitInput) {
  const windowId = Math.floor(Date.now() / sharedIpVisitAggregationWindowMs);
  return recordSharedIpVisitForWindow(db, input, windowId);
}

export type SharedIpRow = { ipAddress: string | null; ipHash: string; visitCount: number; firstSeenAt: Date; lastSeenAt: Date; lastMiniAppKey: string; countryCode: string | null; exempt: boolean };

export async function listSharedIps(db: PrismaClient, input: { search: string; miniAppKey?: MiniAppKey; limit: number; secret: string }) {
  const normalized = input.search ? normalizeIp(input.search) : null;
  if (input.search && !normalized) return [];
  const filters = [
    normalized ? Prisma.sql`a."ipHash" = ${ipHash(normalized, input.secret)}::char(64)` : Prisma.empty,
    input.miniAppKey ? Prisma.sql`EXISTS (SELECT 1 FROM "SharedIpVisit" v WHERE v."ipHash" = a."ipHash" AND v."miniAppKey" = ${input.miniAppKey})` : Prisma.empty
  ].filter((part) => part !== Prisma.empty);
  const filter = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
  return db.$queryRaw<SharedIpRow[]>(Prisma.sql`
    SELECT a."ipAddress", a."ipHash", a."visitCount", a."firstSeenAt", a."lastSeenAt",
           a."lastMiniAppKey", a."countryCode", (e."ipAddress" IS NOT NULL) AS exempt
    FROM "SharedIpAddress" a LEFT JOIN "SharedEntryAdIpExemption" e ON e."ipAddress" = a."ipAddress"
    ${filter}
    ORDER BY a."lastSeenAt" DESC LIMIT ${input.limit}`);
}

export async function listViewerIdsForIp(db: PrismaClient, miniAppKey: MiniAppKey, ip: string, secret: string) {
  return db.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT DISTINCT "userId" FROM "SharedIpVisit"
    WHERE "miniAppKey" = ${miniAppKey} AND "ipHash" = ${ipHash(ip, secret)}::char(64)
    ORDER BY "userId" LIMIT 5000`);
}

export async function listSharedIpVisits(db: PrismaClient, ip: string, secret: string, limit: number, offset: number, miniAppKey?: MiniAppKey) {
  return db.$queryRaw<Array<{ miniAppKey: string; userId: string; createdAt: Date }>>(Prisma.sql`
    SELECT "miniAppKey", "userId", "createdAt" FROM "SharedIpVisit"
    WHERE "ipHash" = ${ipHash(ip, secret)}::char(64) ${miniAppKey ? Prisma.sql`AND "miniAppKey" = ${miniAppKey}` : Prisma.empty}
    ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`);
}

export async function recentViewerIps(db: PrismaClient, miniAppKey: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const rows = await db.$queryRaw<Array<{ userId: string; ipAddress: string | null }>>(Prisma.sql`
    SELECT DISTINCT ON (v."userId") v."userId", a."ipAddress"
    FROM "SharedIpVisit" v JOIN "SharedIpAddress" a ON a."ipHash" = v."ipHash"
    WHERE v."miniAppKey" = ${miniAppKey} AND v."userId" IN (${Prisma.join(userIds)})
    ORDER BY v."userId", v."createdAt" DESC`);
  return new Map(rows.map((row) => [row.userId, row.ipAddress ?? '']));
}

export async function isEntryAdIpExempt(db: PrismaClient, ipAddress: string | null) {
  const ip = ipAddress && normalizeIp(ipAddress);
  if (!ip) return false;
  const cache = exemptionCacheFor(db);
  const now = Date.now();
  for (const [cachedIp, entry] of cache) {
    if (entry.expiresAt > now) break;
    cache.delete(cachedIp);
  }
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > now) return cached.exempt;
  const rows = await db.$queryRaw<Array<{ exempt: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM "SharedEntryAdIpExemption" WHERE "ipAddress" = ${ip}) AS exempt`;
  const exempt = rows[0]?.exempt === true;
  cache.set(ip, { exempt, expiresAt: now + entryAdIpExemptionTtlMs });
  while (cache.size > maxEntryAdIpExemptionKeys) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return exempt;
}

export async function listEntryAdIpExemptions(db: PrismaClient) {
  return db.$queryRaw<Array<{ ipAddress: string; note: string | null; createdAt: Date; updatedAt: Date; updatedBy: string }>>`
    SELECT "ipAddress", "note", "createdAt", "updatedAt", "updatedBy"
    FROM "SharedEntryAdIpExemption" ORDER BY "updatedAt" DESC LIMIT 500`;
}

export async function setEntryAdIpExemption(db: SharedIpDb, ip: string, note: string | null, admin: string) {
  const rows = await db.$queryRaw<Array<{ ipAddress: string; note: string | null; createdAt: Date; updatedAt: Date; updatedBy: string }>>`
    INSERT INTO "SharedEntryAdIpExemption" ("ipAddress", "note", "updatedBy") VALUES (${ip}, ${note}, ${admin})
    ON CONFLICT ("ipAddress") DO UPDATE SET "note" = EXCLUDED."note", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "ipAddress", "note", "createdAt", "updatedAt", "updatedBy"`;
  clearEntryAdIpExemptionCache(db, ip);
  return rows[0];
}

export async function removeEntryAdIpExemption(db: SharedIpDb, ip: string) {
  const result = await db.$executeRaw`DELETE FROM "SharedEntryAdIpExemption" WHERE "ipAddress" = ${ip}`;
  clearEntryAdIpExemptionCache(db, ip);
  return result;
}

export async function setEntryAdIpExemptions(db: PrismaClient, input: { ips: string[]; exempt: boolean; note: string | null; admin: string }) {
  return db.$transaction(async (tx) => {
    for (const ip of input.ips) {
      if (input.exempt) await setEntryAdIpExemption(tx, ip, input.note, input.admin);
      else await removeEntryAdIpExemption(tx, ip);
    }
    return input.ips.length;
  });
}

export async function cleanupSharedIps(db: PrismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - rawIpRetentionMs);
  await db.$executeRaw`
    DELETE FROM "SharedIpVisit" v USING "SharedIpAddress" a
    WHERE v."ipHash" = a."ipHash" AND a."visitCount" < 3 AND v."createdAt" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "SharedEntryAdIpExemption" e WHERE e."ipAddress" = a."ipAddress")`;
  await db.$executeRaw`
    UPDATE "SharedIpAddress" a SET "ipAddress" = NULL
    WHERE a."visitCount" < 3 AND a."lastSeenAt" < ${cutoff} AND a."ipAddress" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "SharedEntryAdIpExemption" e WHERE e."ipAddress" = a."ipAddress")`;
}
