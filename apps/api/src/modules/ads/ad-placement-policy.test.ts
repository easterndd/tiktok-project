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
  assert.deepEqual(updated.placementIds, [primary]);
  assert.equal(updated.adLoadMode, 'DIRECT_SHOW');
  assert.equal(lookups, 2);
  const android = await resolveAdPlacementPolicy(app, { ...input, platform: 'android' });
  assert.deepEqual(android.placementIds, [primary, backup]);
  const unknown = await resolveAdPlacementPolicy(app, { ...input, platform: 'unknown' });
  assert.deepEqual(unknown.placementIds, [primary]);
});

it('authorizes the new client-managed pair without a database switch and preserves old releases', async () => {
  const app = {
    config: { MINI_APP_KEY: 'heartreel', TIKTOK_APP_ID: appId },
    prisma: { adPlacementPair: { findUnique: () => { throw new Error('new release must not query pairs'); } } }
  } as unknown as FastifyInstance;
  for (const platform of ['android', 'ios', 'unknown'] as const) {
    const policy = await resolveAdPlacementPolicy(app, {
      releaseId: 'heartreel-v006-dual-test', adType: 'REWARDED', primaryPlacementId: primary, platform
    });
    assert.deepEqual(policy.placementIds, [primary, backup]);
    assert.equal(policy.adLoadMode, 'EXPLICIT_LOAD');
    assert.equal(policy.strategyVariant, platform === 'android' ? 'ANDROID_DUAL_CLIENT' : platform === 'ios' ? 'IOS_SINGLE_CLIENT' : 'SINGLE_CLIENT');
  }
  const mismatched = await resolveAdPlacementPolicy(app, {
    releaseId: 'sweetreel-v006-dual-test', adType: 'REWARDED', primaryPlacementId: primary, platform: 'android'
  });
  assert.deepEqual(mismatched.placementIds, [primary]);
  const wrongPrimary = await resolveAdPlacementPolicy(app, {
    releaseId: 'heartreel-v006-dual-test', adType: 'REWARDED', primaryPlacementId: backup, platform: 'android'
  });
  assert.deepEqual(wrongPrimary.placementIds, [backup]);
  const wrongAppId = { ...app, config: { MINI_APP_KEY: 'heartreel', TIKTOK_APP_ID: 'wrong' } } as FastifyInstance;
  assert.deepEqual((await resolveAdPlacementPolicy(wrongAppId, {
    releaseId: 'heartreel-v006-dual-test', adType: 'REWARDED', primaryPlacementId: primary, platform: 'android'
  })).placementIds, [primary]);
});
