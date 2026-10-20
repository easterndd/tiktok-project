import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_KEY': JSON.stringify('emberreel') },
  resolve: { alias: [{ find: './legal-docs', replacement: resolve(__dirname, '../mini-web/src/pages/breeze-legal-docs.ts') }] },
  publicDir: resolve(__dirname, '../mini-web/public'),
  server: { port: 5204, fs: { allow: [resolve(__dirname, '..')] } },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
