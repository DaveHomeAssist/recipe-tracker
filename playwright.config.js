import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
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
        command: 'python3 -m http.server 8787',
        url: 'http://127.0.0.1:8787/index.html',
        reuseExistingServer: true,
        timeout: 15_000,
      },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
