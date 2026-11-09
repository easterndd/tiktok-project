import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devApiProxyTarget = process.env.ADMIN_DEV_API_PROXY_TARGET;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    ...(devApiProxyTarget ? {
      proxy: {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
          secure: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'));
          }
        }
      }
    } : {})
  }
});
