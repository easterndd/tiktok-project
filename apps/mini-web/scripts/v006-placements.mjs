// Public IDs supplied for the four v0.0.6 Mini apps. Keep the app mapping scoped at build time.
export const v006Placements = {
  dramaflicks: {
    appId: '7688943418164119560',
    rewarded: ['ad7690454033278421044', 'ad7706095388599568385'],
    interstitial: ['ad7698625673044428852', 'ad7706108249669732404']
  },
  heartreel: {
    appId: '7694176685453625365',
    rewarded: ['ad7690961683200739334', 'ad7698686827641587732'],
    interstitial: ['ad7698953713079453717', 'ad7698645910760867861']
  },
  sweetreel: {
    appId: '7694176755472418837',
    rewarded: ['ad7690432723417581588', 'ad7706095806566139956'],
    interstitial: ['ad7701247035449575444', 'ad7706096223212685313']
  },
  luxereel: {
    appId: '7694100516736927765',
    rewarded: ['ad7690856060425275398', 'ad7706097016505403398'],
    interstitial: ['ad7706097750135310388', 'ad7706106505217247238']
  }
};

export function validateV006Placements() {
  const allIds = new Set();
  const allAppIds = new Set();
  for (const [appKey, config] of Object.entries(v006Placements)) {
    if (!/^\d+$/.test(config.appId) || allAppIds.has(config.appId)) throw new Error('Invalid or repeated App ID for ' + appKey);
    allAppIds.add(config.appId);
    for (const [type, ids] of [['rewarded', config.rewarded], ['interstitial', config.interstitial]]) {
      if (ids.length !== 2 || ids.some((id) => !/^ad\d{8,32}$/.test(id))) throw new Error('Invalid ' + type + ' placements for ' + appKey);
      for (const id of ids) {
        if (allIds.has(id)) throw new Error('Placement belongs to more than one app: ' + id);
        allIds.add(id);
      }
    }
  }
  return true;
}
