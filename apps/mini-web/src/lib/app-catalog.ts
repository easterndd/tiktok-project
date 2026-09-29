export const newMiniApps = {
  cinereels: 'CineReels', talereels: 'TaleReels',
  storyland: 'StoryLand', dramacloud: 'DramaCloud', dailyreel: 'DailyReel',
  dramaone: 'DramaOne', dramaup: 'DramaUp', dramavault: 'DramaVault',
  talehub: 'TaleHub', talebox: 'TaleBox', storyworld: 'StoryWorld',
  storyhub: 'StoryHub', dramaroom: 'DramaRoom', dramazone: 'DramaZone',
  taleflick: 'TaleFlick', dramashort: 'DramaShort', storyshort: 'StoryShort',
  storyflicks: 'StoryFlicks', dramaflicks: 'DramaFlicks'
} as const;

export type NewMiniAppKey = keyof typeof newMiniApps;

export function brandMark(name: string) {
  return name.replace(/[^A-Z]/g, '').slice(0, 3) || name.slice(0, 2).toUpperCase();
}
