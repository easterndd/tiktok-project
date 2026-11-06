import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_KEY': JSON.stringify('runereel') },
  publicDir: resolve(__dirname, '../mini-web/public'),
  server: {
    port: 5214,
    fs: { allow: [resolve(__dirname, '..')] },
    proxy: { '/api': { target: 'https://api.evergreenprosper.com', changeOrigin: true, secure: true } }
  },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
