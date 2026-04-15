import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 30_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'tests/e2e/.last-run.json' }]],
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://127.0.0.1:8787',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'python3 scripts/static_server.py',
        url: 'http://127.0.0.1:8787/index.html',
        reuseExistingServer: true,
        timeout: 15_000,
      },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/mobile.spec.js'],
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile-320',
      testMatch: '**/mobile.spec.js',
      use: {
        browserName: 'chromium',
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-375',
      testMatch: '**/mobile.spec.js',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
