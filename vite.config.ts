import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { orionMiddleware } from './server/orion.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    base: mode === 'pages' ? './' : '/',
    plugins: [
      react(),
      {
        name: 'orion-connector',
        configureServer(server) {
          server.middlewares.use(orionMiddleware(env));
        },
        configurePreviewServer(server) {
          server.middlewares.use(orionMiddleware(env));
        },
      },
    ],
    optimizeDeps: { include: ['gltf-validator'] },
    server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
    build: {
      chunkSizeWarningLimit: 850,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/three/')) return 'geometry';
          },
        },
      },
    },
    test: { include: ['tests/**/*.test.{ts,mjs}'] },
  };
});
