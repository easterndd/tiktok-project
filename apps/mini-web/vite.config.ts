import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const localMediaDirectory = resolve(__dirname, 'local-test-media');
const localMediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function localPlaybackMedia() {
  return {
    name: 'local-playback-media',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, handler: (request: { url?: string; headers: Record<string, string | string[] | undefined> }, response: { writeHead: (status: number, headers?: Record<string, string | number>) => void; end: () => void }) => void) => void } }) {
      server.middlewares.use('/local-test-media', (request, response) => {
        const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
        const filePath = resolve(localMediaDirectory, `.${requestPath}`);
        if (relative(localMediaDirectory, filePath).startsWith('..') || !existsSync(filePath)) {
          response.writeHead(404);
          response.end();
          return;
        }
        const size = statSync(filePath).size;
        const range = typeof request.headers.range === 'string' ? request.headers.range.match(/^bytes=(\d*)-(\d*)$/) : null;
        const start = range?.[1] ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || end < start) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}` });
          response.end();
          return;
        }
        const status = range ? 206 : 200;
        const headers: Record<string, string | number> = {
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': localMediaTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        response.writeHead(status, headers);
        createReadStream(filePath, { start, end }).pipe(response as never);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), localPlaybackMedia()],
  server: { port: 5173 },
  // Production source maps stay private unless a CI error-monitoring upload explicitly enables them.
  build: { sourcemap: process.env.VITE_SOURCEMAP === 'true' }
});
