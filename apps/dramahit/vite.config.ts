import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import entryAdPlacementConfig from '../mini-web/src/features/ads/entry-ad-placement-config.json';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_KEY': JSON.stringify('dramahit'),
    'import.meta.env.VITE_ENTRY_REWARDED_AD_UNIT_IDS': JSON.stringify(entryAdPlacementConfig.dramahit.join(','))
  },
  publicDir: resolve(__dirname, '../mini-web/public'),
  server: { port: 5186, fs: { allow: [resolve(__dirname, '..')] } },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
