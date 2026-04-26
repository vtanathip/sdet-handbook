import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL,
    screenshot: 'on',
    video: 'on',
    headless: true,
  },
  reporter: [
    ['list'],
    ['junit', { outputFile: 'results/junit.xml' }],
    ['./src/reporter/quality-reporter.ts'],
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
});
