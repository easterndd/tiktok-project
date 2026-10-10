import { createHash, randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';
import { BytePlusVodError, BytePlusVodService, episodeMediaTitle, type BytePlusMedia } from './byteplus-vod.service';
import { enqueueVideoSync } from './platform-sync.service';
import { getOrCreateSharedMediaAsset } from './shared-platform.service';

type Db = PrismaClient;
const leaseMs = 2 * 60_000;
const recoveryDelayMs = 60_000;
const recoveryWindowMs = 10 * 60_000;

function conflict(message: string) { return Object.assign(new Error(message), { statusCode: 409 }); }

export function localUploadDirectory(env: Env) {
  return resolve(env.LOCAL_UPLOAD_STORAGE_DIR ?? resolve(env.COVER_ASSET_STORAGE_DIR, '..', 'video-uploads'));
}

export function uploadScope(env: Env) {
  const identity = [env.MINI_APP_KEY, env.TIKTOK_CLIENT_KEY ?? '', env.BYTEPLUS_ACCOUNT_ID, env.BYTEPLUS_SPACE_NAME, env.BYTEPLUS_REGION];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function uploadTags(scope: string, jobId: string) {
  return [`qr-scope-${scope}`, `qr-upload-${jobId}`];
}

export async function assertMediaScope(sharedPrisma: Db, env: Env, media: BytePlusMedia) {
  const scopes = (media.tags ?? []).filter((tag) => tag.startsWith('qr-scope-'));
  if (scopes.length && (scopes.length !== 1 || scopes[0] !== `qr-scope-${uploadScope(env)}`)) {
    throw Object.assign(new Error('此 VID 由其他小程序或旧 Client Key 上传，不能绑定到当前小程序，请在当前小程序重新上传。'), { statusCode: 409 });
  }
  const owner = await sharedPrisma.sharedMediaAsset.findUnique({ where: { byteplusVid: media.vid } });
  if (owner && (owner.firstUploadedByApp !== env.MINI_APP_KEY || owner.byteplusAccountId !== env.BYTEPLUS_ACCOUNT_ID || owner.byteplusSpaceName !== env.BYTEPLUS_SPACE_NAME || owner.byteplusRegion !== env.BYTEPLUS_REGION)) {
    throw Object.assign(new Error('此 VID 已属于其他小程序的媒资，不能在当前小程序重新登记，请重新上传或使用剧目授权。'), { statusCode: 409 });
  }
  if (!scopes.length && !owner) throw conflict('此 VID 缺少可验证的小程序归属，请在当前小程序重新上传。');
}

export async function findUploadMedia(service: BytePlusVodService, env: Env, job: { id: string; uploadScope: string | null; providerJobId: string | null }) {
  if (job.uploadScope && job.uploadScope !== uploadScope(env)) throw conflict('上传任务的小程序或 Client Key 已改变，不能自动关联旧作用域的媒资。');
  if (job.providerJobId) {
    const [media] = await service.getMediaInfos({ vids: [job.providerJobId] });
    if (!media) return null;
    if (media.spaceName !== env.BYTEPLUS_SPACE_NAME) throw conflict('上传结果不属于当前 BytePlus 空间。');
    if (job.uploadScope && !uploadTags(job.uploadScope, job.id).every((tag) => media.tags?.includes(tag))) {
      const scopeTag = media.tags?.find((tag) => tag.startsWith('qr-scope-'));
      if (scopeTag && scopeTag !== `qr-scope-${job.uploadScope}`) throw conflict('VID 属于其他小程序，不能自动绑定。');
      return null;
    }
    return media;
  }
  if (!job.uploadScope) return null;
  const expected = uploadTags(job.uploadScope, job.id);
  const matches: BytePlusMedia[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await service.listMedia({ offset, pageSize: 100, tags: expected[1] });
    matches.push(...page.items.filter((media) => media.spaceName === env.BYTEPLUS_SPACE_NAME && expected.every((tag) => media.tags?.includes(tag))));
    if (page.items.length < 100 || offset + page.items.length >= page.total) break;
    if (offset >= 9_900) throw new Error('VOD 查询结果超过上限，无法确认完整结果，请检查媒资标签。');
  }
  if (matches.length > 1) throw conflict('同一上传任务出现多个 VID，已暂停自动绑定，请核查 BytePlus 媒资。');
  return matches[0] ?? null;
}

export async function processLocalUploadJobs(prisma: Db, sharedPrisma: Db, service: BytePlusVodService, env: Env, options: { now?: () => Date; maxRetries?: number; log?: (message: string, details?: Record<string, unknown>) => void } = {}) {
  const now = options.now ?? (() => new Date());
  const jobs = await prisma.uploadJob.findMany({
    where: { sourceType: 'FILE', status: { in: ['PENDING', 'PROCESSING'] },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }] },
        { OR: [{ leaseExpiresAt: { lte: now() } }, { leaseExpiresAt: null, status: 'PENDING' },
          { leaseExpiresAt: null, status: 'PROCESSING', nextAttemptAt: { not: null } },
          { leaseExpiresAt: null, status: 'PROCESSING', startedAt: { lte: new Date(now().getTime() - 10 * 60_000) } }] }
      ] },
    orderBy: { createdAt: 'asc' }, take: 5,
    include: { episode: { include: { album: true, coverAsset: true } } }
  });
  for (const job of jobs) {
    const leaseToken = randomUUID();
    const remoteStartedAt = job.remoteStartedAt;
    const claimed = await prisma.uploadJob.updateMany({ where: { id: job.id, status: job.status, leaseToken: job.leaseToken, leaseExpiresAt: job.leaseExpiresAt }, data: { status: 'PROCESSING', leaseToken, leaseExpiresAt: new Date(now().getTime() + leaseMs), startedAt: job.startedAt ?? now(), remoteStartedAt } });
    if (!claimed.count) continue;
    let lostLease = false;
    let attemptedUpload = false;
    const renew = setInterval(() => {
      const next = new Date(now().getTime() + leaseMs);
      void prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { leaseExpiresAt: next } })
        .then((result) => { if (!result.count) lostLease = true; })
        .catch(() => { lostLease = true; });
    }, 30_000);
    const fail = async (message: string) => prisma.$transaction(async (tx) => {
      const changed = await tx.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { status: 'FAILED', errorMessage: message, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, completedAt: now() } });
      if (changed.count) await tx.episode.updateMany({ where: { id: job.episodeId, byteplusVid: null }, data: { status: 'ERROR', byteplusUploadStatus: 'FAILED' } });
    });
    try {
      let media: BytePlusMedia | null;
      try {
        media = await findUploadMedia(service, env, job);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode) throw error;
        const message = error instanceof Error ? error.message.slice(0, 400) : 'VOD 查询失败。';
        await prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: {
          leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(now().getTime() + recoveryDelayMs),
          errorMessage: `VOD 查询暂不可用，稍后自动重试：${message}`
        } });
        continue;
      }
      if (!media && remoteStartedAt && now().getTime() - remoteStartedAt.getTime() < recoveryWindowMs) {
        await prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(now().getTime() + recoveryDelayMs), errorMessage: '上传结果确认中，正在自动查询当前小程序的 VOD 媒资。' } });
        continue;
      }
      if (!media) {
        if (!job.localFilePath || !job.uploadScope) {
          await fail('上传已中断，未找到可确认归属的 VID，原临时文件已丢失。任务已解除占用，请在当前小程序重新选择文件上传。');
          continue;
        }
        if (job.providerJobId) { await fail('已记录的 VID 在 BytePlus 中不存在，请重新上传。'); continue; }
        if (job.episode.byteplusVid) { await fail('分集已绑定其他视频，已停止旧上传任务。'); continue; }
        if (job.retryCount >= (options.maxRetries ?? env.UPLOAD_MAX_RETRIES)) { await fail('自动上传重试次数已耗尽，请重试原任务或重新选择文件上传。'); continue; }
        const directory = localUploadDirectory(env);
        const path = relative(directory, resolve(job.localFilePath));
        if (!path || path.startsWith('..') || isAbsolute(path)) throw conflict('上传文件不在配置的持久化目录中。');
        await stat(job.localFilePath);
        const started = await prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { remoteStartedAt: now(), retryCount: { increment: 1 } } });
        if (!started.count || lostLease) continue;
        attemptedUpload = true;
        const result = await service.uploadLocalVideo({ filePath: job.localFilePath, fileName: job.sourceName ?? 'episode.mp4',
          title: episodeMediaTitle(job.episode.album.title, job.episode.episodeNo),
          spaceName: env.BYTEPLUS_SPACE_NAME, byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID, tags: uploadTags(job.uploadScope, job.id) });
        // Persist the VID before binding so a database failure never starts another upload.
        const recorded = await prisma.uploadJob.updateMany({ where: { id: job.id, leaseToken, status: 'PROCESSING' }, data: { providerJobId: result.byteplusVid } });
        if (!recorded.count || lostLease) throw new BytePlusVodError('上传已完成，任务占用发生变化，正在自动查询 VOD 确认结果。', true, true);
        // The upload response alone does not prove that VOD stored the expected scope tags.
        const [confirmed] = await service.getMediaInfos({ vids: [result.byteplusVid] });
        if (!confirmed) {
          await prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: {
            leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(now().getTime() + recoveryDelayMs),
            errorMessage: 'BytePlus 已返回 VID，正在等待媒资可查询后确认归属。'
          } });
          continue;
        }
        if (confirmed.vid !== result.byteplusVid || confirmed.spaceName !== env.BYTEPLUS_SPACE_NAME ||
            !uploadTags(job.uploadScope, job.id).every((tag) => confirmed.tags?.includes(tag))) {
          throw conflict('BytePlus 返回的媒资缺少当前上传任务的归属标签，已停止自动绑定。');
        }
        media = confirmed;
      }
      if (lostLease) continue;
      await assertMediaScope(sharedPrisma, env, media);
      await getOrCreateSharedMediaAsset(sharedPrisma as any, { byteplusVid: media.vid, byteplusAccountId: env.BYTEPLUS_ACCOUNT_ID,
        byteplusSpaceName: env.BYTEPLUS_SPACE_NAME, byteplusRegion: env.BYTEPLUS_REGION, miniAppKey: env.MINI_APP_KEY,
        title: media.title, coverUrl: media.coverUrl, durationMs: media.durationMs, firstUploadJobId: job.id, sourceFileName: job.sourceName ?? undefined });
      await prisma.$transaction(async (tx) => {
        const changed = await tx.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { status: 'SUCCEEDED', providerJobId: media!.vid, completedAt: now(), errorMessage: null, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, localFilePath: null } });
        if (!changed.count) throw new Error('上传任务已由其他操作接管。');
        const bound = await tx.episode.updateMany({ where: { id: job.episodeId, OR: [{ byteplusVid: null }, { byteplusVid: media!.vid }] }, data: { status: 'READY', byteplusUploadStatus: 'READY', byteplusVid: media!.vid, byteplusCoverUrl: media!.coverUrl,
          coverUrl: job.episode.coverAsset?.status === 'READY' ? job.episode.coverAsset.publicUrl : media!.coverUrl, durationMs: media!.durationMs,
          tiktokVideoStatus: 'NOT_STARTED', tiktokVideoJobId: null, tiktokVideoError: null } });
        if (!bound.count) throw new Error('分集已绑定其他 VID，无法覆盖。');
      });
      if (job.localFilePath) await unlink(job.localFilePath).catch(() => undefined);
      if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) await enqueueVideoSync(prisma as any, job.episodeId).catch((error) => options.log?.('Could not enqueue video sync.', { jobId: job.id, error: String(error) }));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : '视频上传失败。';
      const retryable = error instanceof BytePlusVodError ? error.retryable : (error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error as { statusCode?: number }).statusCode;
      if (retryable && job.retryCount < (options.maxRetries ?? env.UPLOAD_MAX_RETRIES)) {
        await prisma.uploadJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseToken }, data: { ...(!attemptedUpload ? { retryCount: { increment: 1 } } : {}), leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(now().getTime() + recoveryDelayMs), errorMessage: `自动恢复中：${message}` } });
      } else await fail(message);
      options.log?.('Local upload recovery.', { jobId: job.id, error: message });
    } finally { clearInterval(renew); }
  }
  return jobs.length;
}
