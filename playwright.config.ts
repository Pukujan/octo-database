import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
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
    },
    {
      command: 'npx vite --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env['CI'],
      timeout: 30000,
    },
  ],
});
