export const newMiniApps = {
  cinereels: 'CineReels', talereels: 'TaleReels',
  storyland: 'StoryLand', dramacloud: 'DramaCloud', dailyreel: 'DailyReel',
  dramaone: 'DramaOne', dramaup: 'DramaUp', dramavault: 'DramaVault',
  talehub: 'TaleHub', talebox: 'TaleBox', storyworld: 'StoryWorld',
  storyhub: 'StoryHub', dramaroom: 'DramaRoom', dramazone: 'DramaZone',
  taleflick: 'TaleFlick', dramashort: 'DramaShort', storyshort: 'StoryShort',
  storyflicks: 'StoryFlicks', dramaflicks: 'DramaFlicks',
  crownrush: 'CrownRush', sugarreel: 'SugarReel', crimsonshorts: 'CrimsonShorts',
  sweetreel: 'SweetReel', dramablaze: 'DramaBlaze', heartreel: 'HeartReel',
  dramahit: 'DramaHit', crownreel: 'CrownReel', luxereel: 'LuxeReel', elitedrama: 'EliteDrama',
  lucidreel: 'LucidReel', astraclip: 'AstraClip', lumoreel: 'LumoReel', orbitplay: 'OrbitPlay',
  zenclip: 'ZenClip', auraclip: 'AuraClip', fluxplay: 'FluxPlay', driftreel: 'DriftReel',
  novaclip: 'NovaClip', lumishort: 'LumiShort'
} as const;

export type NewMiniAppKey = keyof typeof newMiniApps;

export function brandMark(name: string) {
  return name.replace(/[^A-Z]/g, '').slice(0, 3) || name.slice(0, 2).toUpperCase();
}
