import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx tsx src/server/index.ts',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 30000,
      env: {
        // CI/dev has no R2 credentials; the local backend must be opted into
        // explicitly so production still fails closed without R2.
        OCTO_STORAGE_BACKEND: process.env['OCTO_STORAGE_BACKEND'] ?? 'local',
        OCTO_MEDIA_SECRET: process.env['OCTO_MEDIA_SECRET'] ?? 'e2e-media-secret',
        DATABASE_URL:
          process.env['DATABASE_URL'] ??
          'postgresql://postgres:postgres@localhost:54329/postgres',
      },
    },
    {
      command: 'npx vite --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env['CI'],
      timeout: 30000,
    },
  ],
});
