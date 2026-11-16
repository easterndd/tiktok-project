import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { v007Placements } from '../mini-web/scripts/v007-placements.mjs';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_KEY': JSON.stringify('dailyreel'),
    'import.meta.env.VITE_REWARDED_AD_UNIT_IDS': JSON.stringify(v007Placements.dailyreel.rewarded.join(',')),
    'import.meta.env.VITE_INTERSTITIAL_AD_UNIT_IDS': JSON.stringify(v007Placements.dailyreel.interstitial.join(','))
  },
  publicDir: resolve(__dirname, '../mini-web/public'),
  server: { port: 5180, fs: { allow: [resolve(__dirname, '..')] } },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
