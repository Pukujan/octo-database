import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';
import { fileURLToPath, URL } from 'node:url';

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
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
