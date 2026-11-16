// Public TikTok Portal placements supplied for the six v0.0.7 Mini apps.
// The first ID of each pair is the existing production primary placement.
export const v007Placements = {
  zenclip: {
    appId: '7695973362471929908',
    rewarded: ['ad7695690471826311220', 'ad7706462142492575762'],
    interstitial: ['ad7706939601122904085', 'ad7706882520915707924']
  },
  storyworld: {
    appId: '7688988654946158599',
    rewarded: ['ad7690424980064389121', 'ad7706898624479889428'],
    interstitial: ['ad7706875180212226069', 'ad7706897020931688469']
  },
  dailyreel: {
    appId: '7688950749593913351',
    rewarded: ['ad7690436762560169990', 'ad7706885627602585620'],
    interstitial: ['ad7707670435895445524', 'ad7706902620980512774']
  },
  elitedrama: {
    appId: '7694143310880966677',
    rewarded: ['ad7691072182843131925', 'ad7706873514356705301'],
    interstitial: ['ad7708210893989087252', 'ad7706882226866456596']
  },
  sonicreel: {
    appId: '7698254187724883989',
    rewarded: ['ad7696851608764467252', 'ad7706882804299401237'],
    interstitial: ['ad7698651598784448564', 'ad7706897555599542293']
  },
  orbitplay: {
    appId: '7695972730596050962',
    rewarded: ['ad7695711655645317121', 'ad7701602721589561345'],
    interstitial: ['ad7698648496551315457', 'ad7707547396834215957']
  }
};

export function validateV007Placements(existingPlacements = {}) {
  const appIds = new Set(Object.values(existingPlacements).map((item) => item.appId));
  const adIds = new Set(Object.values(existingPlacements).flatMap((item) => [...item.rewarded, ...item.interstitial]));
  for (const [appKey, config] of Object.entries(v007Placements)) {
    if (!/^\d+$/.test(config.appId) || appIds.has(config.appId)) throw new Error(`Invalid or repeated App ID for ${appKey}`);
    appIds.add(config.appId);
    for (const [type, ids] of [['rewarded', config.rewarded], ['interstitial', config.interstitial]]) {
      if (ids.length !== 2 || ids.some((id) => !/^ad\d{8,32}$/.test(id))) throw new Error(`Invalid ${type} placements for ${appKey}`);
      for (const id of ids) {
        if (adIds.has(id)) throw new Error(`Placement belongs to more than one app: ${id}`);
        adIds.add(id);
      }
    }
  }
  return true;
}
