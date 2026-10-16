const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { TikTokShortDramaApiService } = require('./dist/services/tiktok-short-drama-api.service');
(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const api = new TikTokShortDramaApiService(env, { fetch: async (url, options) => {
    const start = Date.now();
    const response = await fetch(url, options);
    if (new URL(url).pathname.includes('shortdrama/image')) {
      const envelope = await response.clone().json().catch(() => null);
      console.log(JSON.stringify({ endpoint: new URL(url).pathname, status: response.status, ms: Date.now() - start, error: envelope?.error, hasImageId: Boolean(envelope?.data?.open_pic_id) }));
    }
    return response;
  } });
  // One previously accepted image as a control; never change the album binding.
  try {
    const result = await api.createImage({ imageUrl: process.argv[2] ?? 'https://api.evergreenprosper.com/api/v1/assets/covers/bc988fb6f064a0a6c5caad921341d361480d7987ca64ec385f309ee4c05f9e08.jpg' });
    console.log(JSON.stringify({ probe: process.argv[3] ?? 'previously-successful-jpeg', success: true, requestId: result.requestId }));
  } catch (e) {
    console.log(JSON.stringify({ probe: process.argv[3] ?? 'previously-successful-jpeg', success: false, message: e.message, code: e.code, requestId: e.requestId }));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
