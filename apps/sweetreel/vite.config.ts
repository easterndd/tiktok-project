import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { v006Placements } from '../mini-web/scripts/v006-placements.mjs';

export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve';
  const env = loadEnv(mode, process.cwd(), '');
  const apiPath = '/api/sweetreel/v1';
  const apiTarget = process.env.VITE_API_DEV_TARGET ?? 'http://127.0.0.1:3000';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_KEY': JSON.stringify('sweetreel'),
      'import.meta.env.VITE_REWARDED_AD_UNIT_IDS': JSON.stringify(v006Placements.sweetreel.rewarded.join(',')),
      'import.meta.env.VITE_INTERSTITIAL_AD_UNIT_IDS': JSON.stringify(v006Placements.sweetreel.interstitial.join(',')),
      'import.meta.env.VITE_DEBUG_PANEL': JSON.stringify(process.env.VITE_DEBUG_PANEL ?? env.VITE_DEBUG_PANEL ?? (isDevServer ? 'true' : 'false')),
      ...(isDevServer ? { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiPath) } : {})
    },
    publicDir: resolve(__dirname, '../mini-web/public'),
    server: {
      port: 5183,
      fs: { allow: [resolve(__dirname, '..')] },
      ...(isDevServer ? { proxy: { [apiPath]: { target: apiTarget, changeOrigin: true, secure: apiTarget.startsWith('https://') } } } : {})
    },
    build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
  };
});
