import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_KEY': JSON.stringify('bloomreel') },
  server: { port: 5210 },
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
