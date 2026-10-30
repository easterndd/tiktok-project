import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import entryAdPlacementConfig from '../mini-web/src/features/ads/entry-ad-placement-config.json';

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_KEY': JSON.stringify('storyflicks'),
      'import.meta.env.VITE_ENTRY_REWARDED_AD_UNIT_IDS': JSON.stringify(entryAdPlacementConfig.storyflicks.join(',')),
      ...(isDevServer ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/storyflicks/v1') } : {})
    },
    publicDir: resolve(__dirname, '../mini-web/public'),
    server: {
      port: 5193,
      fs: { allow: [resolve(__dirname, '..')] },
      ...(isDevServer ? {
        proxy: {
          '/api/storyflicks/v1': {
            target: 'https://api.evergreenprosper.com',
            changeOrigin: true,
            secure: true
          }
        }
      } : {})
    },
    build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
  };
});
