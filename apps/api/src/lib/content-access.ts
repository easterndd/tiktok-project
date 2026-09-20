import { z } from 'zod';

export const accessConfigSchema = z.object({
  freeEpisodeCount: z.number().int().min(0).max(10_000).default(0),
  rewardedAdEnabled: z.boolean().default(true),
  rewardedPlacementId: z.string().trim().min(1).max(128).default('ad7686459794040702993'),
  rewardedAdCount: z.number().int().min(1).default(1)
}).default({ freeEpisodeCount: 0, rewardedAdEnabled: true, rewardedPlacementId: 'ad7686459794040702993', rewardedAdCount: 1 });

export type AccessConfig = z.infer<typeof accessConfigSchema>;

export function readAccessConfig(value: unknown): AccessConfig {
  return accessConfigSchema.parse(value ?? {});
}

export function isEpisodeFree(episode: { isFree: boolean; episodeNo: number }, accessConfig: unknown) {
  return episode.isFree || episode.episodeNo <= readAccessConfig(accessConfig).freeEpisodeCount;
}
