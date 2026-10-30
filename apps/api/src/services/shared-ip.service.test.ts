import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  isEntryAdIpExempt, listSharedIps, listSharedIpVisits, listViewerIdsForIp,
  queueSharedIpVisit, recordSharedIpVisit, removeEntryAdIpExemption, setEntryAdIpExemption, waitForSharedIpVisits
} from './shared-ip.service';

const databaseUrl = process.env.SHARED_IP_TEST_DATABASE_URL;
type Plan = { 'Node Type': string; 'Relation Name'?: string; Plans?: Plan[] };
type Explain = Array<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>;
function nodes(plan: Plan): Plan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

function fakeSharedIpTx() {
  return {
    $queryRaw: async (query: any) => {
      if (String(query?.sql ?? '').includes('INSERT INTO "SharedIpVisit"')) return [{ idempotencyKey: 'visit' }];
      return [];
    },
    $executeRaw: async () => 1
  };
}

function sharedIpInput(clientSessionId: string, userId = 'viewer-main') {
  return { ipAddress: '198.51.100.77', miniAppKey: 'main', userId, clientSessionId, countryCode: 'US', secret: 'queue-test-secret' };
}

it('aggregates repeated user/IP visits while bounding shared IP queue concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  let transactions = 0;
  const tx = fakeSharedIpTx();
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      active += 1;
      transactions += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return await callback(tx);
      } finally {
        active -= 1;
      }
    }
  } as unknown as PrismaClient;
  const errors: unknown[] = [];
  const duplicate = sharedIpInput('same-session');
  queueSharedIpVisit(db, duplicate, (error) => errors.push(error));
  queueSharedIpVisit(db, duplicate, (error) => errors.push(error));
  queueSharedIpVisit(db, sharedIpInput('another-session-same-user'), (error) => errors.push(error));
  for (let index = 0; index < 32; index += 1) {
    queueSharedIpVisit(db, sharedIpInput(`session-${index}`, `viewer-${index}`), (error) => errors.push(error));
  }

  await waitForSharedIpVisits();
  assert.equal(transactions, 33, 'same user/IP/app should be written once per aggregation window');
  assert.ok(maxActive > 1, 'independent visits should not be serialized');
  assert.ok(maxActive <= 2, 'shared IP writes must stay below the reduced concurrency cap');
  assert.deepEqual(errors, []);
});

it('bounds shared IP backlog and aggregates repeated overflow reports', async () => {
  let releaseTransactions!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseTransactions = resolve; });
  let transactions = 0;
  const tx = fakeSharedIpTx();
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      await blocked;
      return callback(tx);
    }
  } as unknown as PrismaClient;
  const errors: Error[] = [];
  for (let index = 0; index < 2_032; index += 1) {
    queueSharedIpVisit(db, sharedIpInput(`overflow-${index}`, `overflow-viewer-${index}`), (error) => errors.push(error as Error));
  }

  assert.equal(transactions, 2, 'only the configured worker count should run concurrently');
  assert.equal(errors.length, 1, 'a burst of overflow should not log once per dropped request');
  assert.match(errors[0].message, /dropped 1000 visits/);

  releaseTransactions();
  await waitForSharedIpVisits();
  assert.equal(transactions, 1_026, 'active work plus the bounded pending queue should drain');
});

// Use a disposable PostgreSQL database; ordinary API tests still run without one.
it('uses indexes with real Prisma parameters and preserves shared IP counts, app isolation and exemptions',
  { skip: !databaseUrl, timeout: 60_000 }, async () => {
    assert.match(new URL(databaseUrl!).pathname, /_shared_ip_test$/, 'Use a dedicated test database');
    const db = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      await db.$transaction(async (tx) => {
        const schema = `shared_ip_${randomUUID().replaceAll('-', '')}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        const migration = readFileSync(resolve(__dirname, '../../prisma/shared-migrations/20261021_shared_ip_registry.sql'), 'utf8');
        for (const sql of migration.split(';').filter((part) => part.trim())) await tx.$executeRawUnsafe(sql);
        await tx.$executeRaw`
          INSERT INTO "SharedIpAddress" ("ipHash", "lastMiniAppKey")
          SELECT md5(i::text) || md5(i::text), 'main' FROM generate_series(1, 20000) AS i`;
        await tx.$executeRaw`
          INSERT INTO "SharedIpVisit" ("idempotencyKey", "ipHash", "miniAppKey", "userId")
          SELECT md5(i::text) || md5(i::text), md5(i::text) || md5(i::text), 'main', 'seed-' || i
          FROM generate_series(1, 20000) AS i`;
        await tx.$executeRawUnsafe('ANALYZE "SharedIpAddress"');
        await tx.$executeRawUnsafe('ANALYZE "SharedIpVisit"');

        // Reproduce the incident: a text-bound key makes PostgreSQL scan the table.
        const oldPlan = await tx.$queryRaw<Explain>(Prisma.sql`
          EXPLAIN (FORMAT JSON) SELECT "ipHash" FROM "SharedIpVisit" WHERE "idempotencyKey" = ${'0'.repeat(64)}`);
        assert.ok(nodes(oldPlan[0]['QUERY PLAN'][0].Plan).some((node) => node['Node Type'] === 'Seq Scan'));

        const plans: Plan[] = [];
        const sqlQuery = (query: TemplateStringsArray | Prisma.Sql, values: unknown[]) =>
          Array.isArray(query) ? Prisma.sql(query as TemplateStringsArray, ...values) : query as Prisma.Sql;
        const inspect = async (query: Prisma.Sql) => {
          if (/^\s*SELECT/.test(query.sql) || /INSERT INTO "SharedIpVisit"|UPDATE "SharedIpAddress"/.test(query.sql)) {
            const rows = await tx.$queryRaw<Explain>(Prisma.sql`EXPLAIN (FORMAT JSON) ${query}`);
            plans.push(rows[0]['QUERY PLAN'][0].Plan);
          }
        };
        const instrumented = {
          $transaction: (callback: (client: PrismaClient) => Promise<unknown>) => callback(instrumented),
          $queryRaw: async (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
            const sql = sqlQuery(query, values);
            await inspect(sql);
            return tx.$queryRaw(sql);
          },
          $executeRaw: async (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
            const sql = sqlQuery(query, values);
            await inspect(sql);
            return tx.$executeRaw(sql);
          }
        } as unknown as PrismaClient;
        const input = { ipAddress: '198.51.100.77', miniAppKey: 'main', userId: 'viewer-main',
          clientSessionId: 'same-session', countryCode: 'US', secret: 'regression-test-secret' };
        await recordSharedIpVisit(instrumented, input);
        await recordSharedIpVisit(instrumented, input);
        await recordSharedIpVisit(instrumented, { ...input, clientSessionId: 'second-session' });
        await recordSharedIpVisit(instrumented, { ...input, userId: 'viewer-main-2', clientSessionId: 'third-session' });
        await recordSharedIpVisit(instrumented, { ...input, miniAppKey: 'taletv', userId: 'viewer-taletv' });
        const ips = await listSharedIps(instrumented, { search: input.ipAddress, limit: 10, secret: input.secret, miniAppKey: 'main' });
        assert.equal(ips.length, 1);
        assert.equal(ips[0].visitCount, 2, 'same user/IP/app visits are aggregated within one window');
        assert.deepEqual(await listViewerIdsForIp(instrumented, 'main', input.ipAddress, input.secret), [{ userId: 'viewer-main' }, { userId: 'viewer-main-2' }]);
        assert.deepEqual(await listViewerIdsForIp(instrumented, 'taletv', input.ipAddress, input.secret), [{ userId: 'viewer-taletv' }]);
        assert.equal((await listSharedIpVisits(instrumented, input.ipAddress, input.secret, 10, 0)).length, 3);
        assert.equal((await listSharedIpVisits(instrumented, input.ipAddress, input.secret, 10, 0, 'main')).length, 2);
        assert.equal((await listSharedIpVisits(instrumented, input.ipAddress, input.secret, 1, 1, 'main')).length, 1);
        await setEntryAdIpExemption(instrumented, input.ipAddress, 'test', 'test-admin');
        assert.equal(await isEntryAdIpExempt(instrumented, `::ffff:${input.ipAddress}`), true);
        assert.equal((await listSharedIps(instrumented, { search: input.ipAddress, limit: 10, secret: input.secret }))[0].exempt, true);
        await removeEntryAdIpExemption(instrumented, input.ipAddress);
        assert.equal(await isEntryAdIpExempt(instrumented, input.ipAddress), false);

        const sharedScans = plans.flatMap(nodes).filter((node) =>
          ['SharedIpAddress', 'SharedIpVisit'].includes(node['Relation Name'] ?? '') && /Scan/.test(node['Node Type']));
        assert.ok(sharedScans.length >= 10, 'inspect actual lookup and counter update statements');
        for (const plan of sharedScans) assert.match(plan['Node Type'], /Index/, JSON.stringify(plan));
        console.log(`Verified ${sharedScans.length} shared IP scans use indexes with real Prisma parameters`);
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      }, { timeout: 50_000 });
    } finally {
      await db.$disconnect();
    }
  });
