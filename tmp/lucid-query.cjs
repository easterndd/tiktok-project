const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { TikTokShortDramaApiService } = require('./dist/services/tiktok-short-drama-api.service');

(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const api = new TikTokShortDramaApiService(env, {
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      if (new URL(url).pathname.includes('/album/query/')) {
        const raw = await response.clone().text();
        console.log(JSON.stringify({ status: response.status, raw }));
      }
      return response;
    }
  });
  try {
    const result = await api.queryAlbum({ albumId: '7696349043861440519' });
    console.log(JSON.stringify({ success: true, requestId: result.requestId, data: result.data }));
  } catch (error) {
    console.log(JSON.stringify({ success: false, message: error.message, code: error.code, requestId: error.requestId }));
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
