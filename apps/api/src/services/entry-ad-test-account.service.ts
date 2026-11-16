import type { PrismaClient } from '@prisma/client';

export async function activeEntryAdTestAccount(db: PrismaClient, miniAppKey: string, userId: string, now = new Date()) {
  const account = await db.entryAdTestAccount.findUnique({ where: { miniAppKey_userId: { miniAppKey, userId } },
    select: { enabled: true, expiresAt: true } });
  return Boolean(account?.enabled && account.expiresAt > now);
}

export function testAccountAttributionDecision(status: string, active: boolean) {
  if (status === 'ATTRIBUTED') return { allowed: true, reason: 'ENTRY_AD_REQUIRED' };
  if (status === 'UNATTRIBUTED' && active) return { allowed: true, reason: 'TEST_ACCOUNT_OVERRIDE' };
  return { allowed: false, reason: status === 'AD_ID_CONFLICT' ? 'AD_ID_CONFLICT'
    : status === 'INVALID' ? 'INVALID_ATTRIBUTION_SIGNAL' : 'UNATTRIBUTED' };
}
