import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const localBaseUrl = process.env.LOCAL_BASE_URL ?? 'http://localhost:5173';
const ec2BaseUrl = process.env.EC2_BASE_URL ?? 'http://localhost:3001';
const runId = process.env.E2E_RUN_ID ?? `pw-${Date.now()}-${randomUUID().slice(0, 8)}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'x-e2e-run-id': runId,
      'x-e2e-source': 'playwright-e2e',
    },
  },
  projects: [
    {
      name: 'local',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: localBaseUrl,
      },
    },
    {
      name: 'ec2',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ec2BaseUrl,
      },
    },
  ],
});
