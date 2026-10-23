import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { MiniAppKey } from '../config/mini-apps';

const rawIpRetentionMs = 30 * 86_400_000;
type SharedIpDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
const maxPendingSharedIpVisits = 256;
let pendingSharedIpVisits = 0;
let sharedIpVisitTail: Promise<void> = Promise.resolve();

export function queueSharedIpVisit(db: PrismaClient, input: Parameters<typeof recordSharedIpVisit>[1], onError: (error: unknown) => void) {
  if (pendingSharedIpVisits >= maxPendingSharedIpVisits) {
    onError(new Error('Shared IP visit queue is full'));
    return;
  }
  pendingSharedIpVisits++;
  sharedIpVisitTail = sharedIpVisitTail.then(() => recordSharedIpVisit(db, input))
    .catch(onError)
    .finally(() => { pendingSharedIpVisits--; });
}

export function waitForSharedIpVisits() {
  return sharedIpVisitTail;
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

function visitKey(appKey: string, clientSessionId: string, secret: string) {
  return createHmac('sha256', secret).update(['shared-ip-visit', appKey, clientSessionId].join(':')).digest('hex');
}

export async function recordSharedIpVisit(db: PrismaClient, input: { ipAddress: string | null; miniAppKey: string; userId: string; clientSessionId: string; countryCode: string | null; secret: string }) {
  const ip = input.ipAddress && normalizeIp(input.ipAddress);
  if (!ip) return;
  const hash = ipHash(ip, input.secret);
  const key = visitKey(input.miniAppKey, input.clientSessionId, input.secret);
  await db.$transaction(async (tx) => {
    const previous = await tx.$queryRaw<Array<{ ipHash: string }>>(Prisma.sql`SELECT "ipHash" FROM "SharedIpVisit" WHERE "idempotencyKey" = ${key}`);
    if (previous.length) return;
    await tx.$executeRaw`
      INSERT INTO "SharedIpAddress" ("ipHash", "ipAddress", "lastMiniAppKey", "countryCode")
      VALUES (${hash}, ${ip}, ${input.miniAppKey}, ${input.countryCode})
      ON CONFLICT ("ipHash") DO UPDATE SET
        "ipAddress" = EXCLUDED."ipAddress",
        "lastSeenAt" = CURRENT_TIMESTAMP,
        "lastMiniAppKey" = EXCLUDED."lastMiniAppKey",
        "countryCode" = EXCLUDED."countryCode"`;
    const inserted = await tx.$queryRaw<Array<{ idempotencyKey: string }>>`
      INSERT INTO "SharedIpVisit" ("idempotencyKey", "ipHash", "miniAppKey", "userId")
      VALUES (${key}, ${hash}, ${input.miniAppKey}, ${input.userId})
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING "idempotencyKey"`;
    if (inserted.length) await tx.$executeRaw`
      UPDATE "SharedIpAddress" SET "visitCount" = "visitCount" + 1 WHERE "ipHash" = ${hash}`;
  });
}

export type SharedIpRow = { ipAddress: string | null; ipHash: string; visitCount: number; firstSeenAt: Date; lastSeenAt: Date; lastMiniAppKey: string; countryCode: string | null; exempt: boolean };

export async function listSharedIps(db: PrismaClient, input: { search: string; miniAppKey?: MiniAppKey; limit: number; secret: string }) {
  const normalized = input.search ? normalizeIp(input.search) : null;
  if (input.search && !normalized) return [];
  const filters = [
    normalized ? Prisma.sql`a."ipHash" = ${ipHash(normalized, input.secret)}` : Prisma.empty,
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
    WHERE "miniAppKey" = ${miniAppKey} AND "ipHash" = ${ipHash(ip, secret)}
    ORDER BY "userId" LIMIT 5000`);
}

export async function listSharedIpVisits(db: PrismaClient, ip: string, secret: string, limit: number, offset: number, miniAppKey?: MiniAppKey) {
  return db.$queryRaw<Array<{ miniAppKey: string; userId: string; createdAt: Date }>>(Prisma.sql`
    SELECT "miniAppKey", "userId", "createdAt" FROM "SharedIpVisit"
    WHERE "ipHash" = ${ipHash(ip, secret)} ${miniAppKey ? Prisma.sql`AND "miniAppKey" = ${miniAppKey}` : Prisma.empty}
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
  const rows = await db.$queryRaw<Array<{ exempt: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM "SharedEntryAdIpExemption" WHERE "ipAddress" = ${ip}) AS exempt`;
  return rows[0]?.exempt === true;
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
  return rows[0];
}

export async function removeEntryAdIpExemption(db: SharedIpDb, ip: string) {
  return db.$executeRaw`DELETE FROM "SharedEntryAdIpExemption" WHERE "ipAddress" = ${ip}`;
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
