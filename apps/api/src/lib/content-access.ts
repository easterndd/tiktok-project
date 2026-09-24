import { z } from 'zod';
import type { Env } from '../config/env';
import { miniAppAdConfig } from '../config/mini-apps';

const fallbackRewardedPlacementId = 'ad7686459794040702993';

export const accessConfigSchema = z.object({
  freeEpisodeCount: z.number().int().min(0).max(10_000).default(0),
  rewardedAdEnabled: z.boolean().default(true),
  rewardedPlacementId: z.string().trim().min(1).max(128).optional(),
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
  const otherPlacementId = env.MINI_APP_KEY === 'main' ? env.TALETV_REWARDED_PLACEMENT_ID : env.REWARDED_PLACEMENT_ID;
  return {
    ...parsed,
    rewardedPlacementId: parsed.rewardedPlacementId === otherPlacementId ? adConfig.rewardedPlacementId : parsed.rewardedPlacementId
  };
}

export function isEpisodeFree(episode: { isFree: boolean; episodeNo: number }, accessConfig: unknown) {
  return episode.isFree || episode.episodeNo <= readAccessConfig(accessConfig).freeEpisodeCount;
}
