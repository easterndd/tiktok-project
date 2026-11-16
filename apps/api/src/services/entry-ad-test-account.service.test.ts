import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { activeEntryAdTestAccount, testAccountAttributionDecision } from './entry-ad-test-account.service';

it('matches a test account by mini app and user ID, with enabled and expiry checks', async () => {
  const now = new Date('2026-11-16T00:00:00.000Z');
  const rows = new Map([
    ['zenclip:user-1', { enabled: true, expiresAt: new Date('2026-11-17T00:00:00.000Z') }],
    ['zenclip:user-2', { enabled: false, expiresAt: new Date('2026-11-17T00:00:00.000Z') }],
    ['zenclip:user-3', { enabled: true, expiresAt: now }]
  ]);
  const db = { entryAdTestAccount: { findUnique: async ({ where }: any) => rows.get(`${where.miniAppKey_userId.miniAppKey}:${where.miniAppKey_userId.userId}`) ?? null } } as unknown as PrismaClient;
  assert.equal(await activeEntryAdTestAccount(db, 'zenclip', 'user-1', now), true);
  assert.equal(await activeEntryAdTestAccount(db, 'storyworld', 'user-1', now), false);
  assert.equal(await activeEntryAdTestAccount(db, 'zenclip', 'user-2', now), false);
  assert.equal(await activeEntryAdTestAccount(db, 'zenclip', 'user-3', now), false);
});

it('overrides only unattributed launches and never invalid attribution signals', () => {
  assert.deepEqual(testAccountAttributionDecision('UNATTRIBUTED', true), { allowed: true, reason: 'TEST_ACCOUNT_OVERRIDE' });
  assert.deepEqual(testAccountAttributionDecision('UNATTRIBUTED', false), { allowed: false, reason: 'UNATTRIBUTED' });
  assert.deepEqual(testAccountAttributionDecision('ATTRIBUTED', true), { allowed: true, reason: 'ENTRY_AD_REQUIRED' });
  assert.deepEqual(testAccountAttributionDecision('INVALID', true), { allowed: false, reason: 'INVALID_ATTRIBUTION_SIGNAL' });
  assert.deepEqual(testAccountAttributionDecision('AD_ID_CONFLICT', true), { allowed: false, reason: 'AD_ID_CONFLICT' });
});
