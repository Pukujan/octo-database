import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The app is a same-origin client of the Octo API. In dev it runs on :3000 and
// proxies the API and the MCP/OAuth routes to the Node service on :3001; in
// production the Node service serves the built bundle from the repo-root dist.
export default defineConfig(() => ({
  server: {
    host: "::",
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
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: true,
  },
}));
