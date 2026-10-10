import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
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
      // Remote MCP endpoint and its OAuth authorization server. These are served
      // by the Node service in production (Caddy proxies them); the dev server
      // must forward them too, or the MCP/OAuth E2E would hit Vite's SPA
      // fallback and never reach the routes.
      //
      // changeOrigin is off: the OAuth server derives its public origin (issuer,
      // redirect targets, the 401 metadata URL) from the Host header, and in dev
      // the browser is talking to :3000. Rewriting Host to :3001 would bounce the
      // login redirect to the wrong origin.
      '/mcp': {
        target: 'http://localhost:3001',
      },
      '/oauth': {
        target: 'http://localhost:3001',
      },
      '/.well-known': {
        target: 'http://localhost:3001',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
