import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { assertV006PlacementPair, invalidateAdPlacementPolicyCache, resolveAdPlacementPolicy } from './ad-placement-policy';

const primary = 'ad7690961683200739334';
const backup = 'ad7698686827641587732';
const releaseId = 'heartreel-v006-test';
const appId = '7694176685453625365';

it('accepts only the configured pair for the current app and ad type', () => {
  const valid = { releaseId, adType: 'REWARDED' as const, primaryPlacementId: primary, backupPlacementId: backup, enabled: true };
  assert.doesNotThrow(() => assertV006PlacementPair('heartreel', valid, appId));
  assert.throws(() => assertV006PlacementPair('sweetreel', valid, appId), { statusCode: 400 });
  assert.throws(() => assertV006PlacementPair('heartreel', { ...valid, releaseId: 'sweetreel-v006-test' }, appId), { statusCode: 400 });
  assert.throws(() => assertV006PlacementPair('heartreel', { ...valid, adType: 'INTERSTITIAL' }, appId), { statusCode: 400 });
  assert.throws(() => assertV006PlacementPair('heartreel', { ...valid, primaryPlacementId: backup, backupPlacementId: primary }, appId), { statusCode: 400 });
  assert.throws(() => assertV006PlacementPair('heartreel', { ...valid, backupPlacementId: null }, appId), { statusCode: 400 });
  assert.throws(() => assertV006PlacementPair('heartreel', valid, 'wrong-app-id'), { statusCode: 400 });
});

it('keeps old releases single-placement and rejects an invalid persisted pair', async () => {
  let lookups = 0;
  const app = {
    config: { MINI_APP_KEY: 'heartreel', TIKTOK_APP_ID: appId },
    prisma: { adPlacementPair: { findUnique: async () => {
      lookups += 1;
      return { releaseId, adType: 'REWARDED', primaryPlacementId: primary, backupPlacementId: 'ad7690856060425275398', enabled: true };
    } } }
  } as unknown as FastifyInstance;
  const old = await resolveAdPlacementPolicy(app, { releaseId: 'heartreel-v005-test', adType: 'REWARDED', primaryPlacementId: primary, platform: 'ios' });
  assert.deepEqual(old.placementIds, [primary]);
  assert.equal(lookups, 0);
  const invalid = await resolveAdPlacementPolicy(app, { releaseId, adType: 'REWARDED', primaryPlacementId: primary, platform: 'ios' });
  assert.deepEqual(invalid.placementIds, [primary]);
  assert.equal(invalid.adLoadMode, 'EXPLICIT_LOAD');
});

it('caches only the pair lookup and invalidates it after an admin change', async () => {
  let lookups = 0;
  let enabled = false;
  const app = {
    config: { MINI_APP_KEY: 'heartreel', TIKTOK_APP_ID: appId },
    prisma: { adPlacementPair: { findUnique: async () => {
      lookups += 1;
      return { releaseId, adType: 'REWARDED', primaryPlacementId: primary, backupPlacementId: backup, enabled,
        iosLoadMode: 'DIRECT_SHOW', androidLoadMode: 'EXPLICIT_LOAD', iosExperimentPercent: 100, version: 1 };
    } } }
  } as unknown as FastifyInstance;
  const input = { releaseId, adType: 'REWARDED' as const, primaryPlacementId: primary, platform: 'ios' as const };
  assert.deepEqual((await resolveAdPlacementPolicy(app, input)).placementIds, [primary]);
  enabled = true;
  assert.deepEqual((await resolveAdPlacementPolicy(app, input)).placementIds, [primary]);
  assert.equal(lookups, 1);
  invalidateAdPlacementPolicyCache(app);
  const updated = await resolveAdPlacementPolicy(app, input);
  assert.deepEqual(updated.placementIds, [primary, backup]);
  assert.equal(updated.adLoadMode, 'DIRECT_SHOW');
  assert.equal(lookups, 2);
});
