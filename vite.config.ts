import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';
import { fileURLToPath, URL } from 'node:url';

/**
 * The Octo API is a separate process (`npm run server`, port 3001) that the
 * Vite dev server does not start. When it is not running the proxy would log a
 * stack trace per attempt, so ECONNREFUSED is swallowed here — the client
 * already renders an explicit "server unreachable" state, and the adapter
 * backs off after a connection failure.
 */
const quietExpectedRefusal = (proxy: {
  on: (event: 'error', listener: (error: { code?: string; message?: string }) => void) => void;
}) => {
  proxy.on('error', (error) => {
    if (error?.code === 'ECONNREFUSED') return;
    console.error('[vite] octo api proxy error:', error?.message ?? error);
  });
};

export default defineConfig({
  plugins: [dyadComponentTagger(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@v2': fileURLToPath(new URL('./src/v2', import.meta.url)),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'src/v1/**'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: quietExpectedRefusal,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: quietExpectedRefusal,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
