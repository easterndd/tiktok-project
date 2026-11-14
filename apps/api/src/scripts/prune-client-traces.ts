import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env';
import { configuredMiniAppKeys, miniAppEnvironment, type MiniAppKey } from '../config/mini-apps';
import { supportsV006DualApp } from '../modules/ads/ad-placement-policy';

async function prune(client: PrismaClient, cutoff: Date) {
  let sessions = 0;
  let observations = 0;
  while (true) {
    const removed = await client.$executeRaw`
      DELETE FROM "ClientTraceSession" WHERE "id" IN (
        SELECT "id" FROM "ClientTraceSession" WHERE "lastEventAt" < ${cutoff}
        ORDER BY "lastEventAt" LIMIT 500
      )`;
    sessions += removed;
    if (removed < 500) break;
  }
  while (true) {
    const removed = await client.$executeRaw`
      DELETE FROM "EntryAdObservation" WHERE "id" IN (
        SELECT "id" FROM "EntryAdObservation" WHERE "receivedAt" < ${cutoff}
        ORDER BY "receivedAt" LIMIT 500
      )`;
    observations += removed;
    if (removed < 500) break;
  }
  return { sessions, observations };
}

async function main() {
  const { values } = parseArgs({ options: {
    expect: { type: 'string' }, days: { type: 'string', default: '7' }, apply: { type: 'boolean', default: false }
  } });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('--days must be an integer from 1 to 90.');
  const keys = (values.expect ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  if (!keys.length || keys.some((key) => !supportsV006DualApp(key)) || new Set(keys).size !== keys.length) {
    throw new Error('Pass --expect=dramaflicks,heartreel,sweetreel,luxereel (or an explicit subset).');
  }
  const env = loadEnv();
  const configured = configuredMiniAppKeys(env);
  const cutoff = new Date(Date.now() - days * 86_400_000);
  for (const key of keys) {
    if (!configured.includes(key as MiniAppKey)) throw new Error(`Mini app ${key} is not configured.`);
    const appEnv = miniAppEnvironment(env, key as MiniAppKey);
    if (!appEnv) throw new Error(`Missing database URL for ${key}.`);
    const client = new PrismaClient({ datasources: { db: { url: appEnv.DATABASE_URL } } });
    try {
      if (values.apply) console.log(JSON.stringify({ appKey: key, cutoff: cutoff.toISOString(), ...(await prune(client, cutoff)) }));
      else {
        const [sessions, observations] = await Promise.all([
          client.clientTraceSession.count({ where: { lastEventAt: { lt: cutoff } } }),
          client.entryAdObservation.count({ where: { receivedAt: { lt: cutoff } } })
        ]);
        console.log(JSON.stringify({ appKey: key, cutoff: cutoff.toISOString(), sessions, observations, dryRun: true }));
      }
    } finally { await client.$disconnect(); }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Trace retention failed.'); process.exitCode = 1; });
