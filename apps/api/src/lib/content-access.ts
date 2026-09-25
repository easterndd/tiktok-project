import { z } from 'zod';
import type { Env } from '../config/env';
import { miniAppAdConfig, type MiniAppKey } from '../config/mini-apps';

const fallbackRewardedPlacementId = 'ad7686459794040702993';

export const accessConfigSchema = z.object({
  freeEpisodeCount: z.number().int().min(0).max(10_000).default(0),
  rewardedAdEnabled: z.boolean().default(true),
  rewardedPlacementId: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).max(128).optional()),
  rewardedAdCount: z.number().int().min(1).default(1)
});

export type AccessConfig = {
  freeEpisodeCount: number;
  rewardedAdEnabled: boolean;
  rewardedPlacementId: string;
  rewardedAdCount: number;
};

export function readAccessConfig(value: unknown, defaultRewardedPlacementId = fallbackRewardedPlacementId): AccessConfig {
  const parsed = accessConfigSchema.parse(value ?? {});
  return {
    freeEpisodeCount: parsed.freeEpisodeCount,
    rewardedAdEnabled: parsed.rewardedAdEnabled,
    rewardedPlacementId: parsed.rewardedPlacementId ?? defaultRewardedPlacementId,
    rewardedAdCount: parsed.rewardedAdCount
  };
}

export function readMiniAppAccessConfig(value: unknown, env: Env): AccessConfig {
  const adConfig = miniAppAdConfig(env);
  const parsed = readAccessConfig(value, adConfig.rewardedPlacementId);
  const otherPlacementIds = (['main', 'taletv', 'cinereels', 'talereels'] as MiniAppKey[])
    .filter((key) => key !== env.MINI_APP_KEY)
    .map((key) => miniAppAdConfig(env, key).rewardedPlacementId)
    .filter(Boolean);
  const result = {
    ...parsed,
    rewardedPlacementId: otherPlacementIds.includes(parsed.rewardedPlacementId) ? adConfig.rewardedPlacementId : parsed.rewardedPlacementId
  };
  if (result.rewardedAdEnabled && !result.rewardedPlacementId) {
    throw Object.assign(new Error('当前小程序尚未配置激励广告位 ID，请填写广告位或关闭广告解锁。'), { statusCode: 400 });
  }
  return result;
}

export function isEpisodeFree(episode: { isFree: boolean; episodeNo: number }, accessConfig: unknown) {
  return episode.isFree || episode.episodeNo <= readAccessConfig(accessConfig).freeEpisodeCount;
}
