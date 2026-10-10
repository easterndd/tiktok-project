import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_KEY': JSON.stringify('sugarreel') },
  publicDir: resolve(__dirname, '../mini-web/public'),
  server: { port: 5181, fs: { allow: [resolve(__dirname, '..')] } },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
