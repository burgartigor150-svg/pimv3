import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  expect: {
    timeout: 8000,
  },
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'https://pim.giper.fm.postobot.online',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  outputDir: 'test-results',
});
