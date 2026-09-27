import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env';
import { configuredMiniAppKeys, miniAppEnvironment } from '../config/mini-apps';
import { recoverSavedAuthorization, retryUnknownAuthorizationOnce } from '../services/shared-platform.service';
import { redactTikTokAuthorizationResponse, TikTokShortDramaApiService } from '../services/tiktok-short-drama-api.service';

async function main() {
  const [requestId, ...args] = process.argv.slice(2);
  if (!requestId || requestId === '--help') {
    console.log('Read-only: node dist/scripts/inspect-shared-authorization.js <TikTok-request-id>');
    console.log('Recover local mapping from saved platform proof (no authorization POST): append --recover-saved-response');
    console.log('One confirmed call: append --retry-target <app-key> --confirm REAUTHORIZE_ONE_TARGET');
    return;
  }
  const env = loadEnv();
  const shared = new PrismaClient({ datasources: { db: { url: env.SHARED_PLATFORM_DATABASE_URL ?? env.DATABASE_URL } } });
  const locals: Record<string, PrismaClient> = {};
  try {
    const jobs = await shared.sharedPlatformOperation.findMany({ where: { providerRequestId: requestId, kind: 'AUTHORIZE_ALBUM', NOT: { dedupeKey: { startsWith: 'SAVED_AUTHORIZATION_RECOVERY:' } } }, take: 2 });
    if (jobs.length !== 1) throw new Error('Expected exactly one authorization job for this request ID. No changes made.');
    const original = jobs[0];
    console.log(JSON.stringify({ operationId: original.id, targetMiniAppKey: original.targetMiniAppKey, status: original.status, errorCode: original.errorCode, errorMessage: original.errorMessage,
      originalResponseSaved: original.providerResponse != null, response: redactTikTokAuthorizationResponse(original.providerResponse) }, null, 2));
    if (!args.length) return;
    const recover = args.length === 1 && args[0] === '--recover-saved-response';
    if (!recover && (args.length !== 4 || args[0] !== '--retry-target' || args[2] !== '--confirm' || args[3] !== 'REAUTHORIZE_ONE_TARGET' || args[1] !== original.targetMiniAppKey)) throw new Error('Invalid confirmation or target mismatch. No changes made.');
    const apiByApp: Record<string, TikTokShortDramaApiService> = {};
    for (const key of configuredMiniAppKeys(env)) {
      const context = miniAppEnvironment(env, key);
      if (!context) continue;
      locals[key] = new PrismaClient({ datasources: { db: { url: context.DATABASE_URL } } });
      apiByApp[key] = new TikTokShortDramaApiService(context);
    }
    const options = { env, localPrismaByApp: locals as any, apiByApp };
    const result = recover ? await recoverSavedAuthorization(shared as any, options, original.id)
      : await retryUnknownAuthorizationOnce(shared as any, options, original.id, args[1], args[3]);
    console.log(JSON.stringify({ newOperationId: result.id, targetMiniAppKey: result.targetMiniAppKey, status: result.status, requestId: result.providerRequestId,
      errorMessage: result.errorMessage, response: redactTikTokAuthorizationResponse(result.providerResponse) }, null, 2));
  } finally {
    for (const db of Object.values(locals)) await db.$disconnect();
    await shared.$disconnect();
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Authorization inspection failed.'); process.exitCode = 1; });
