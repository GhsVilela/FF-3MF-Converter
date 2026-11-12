import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8090',
    headless: true,
    viewport: { width: 1360, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/api/dist/server.js',
    url: 'http://127.0.0.1:8090/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: '8090',
      DATA_DIR: '/tmp/ff3mf-e2e',
      LOG_LEVEL: 'warn',
      AUTH_TOKEN: '',
      MAX_UPLOAD_MB: '100',
    },
  },
});
