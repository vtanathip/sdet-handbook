import { defineConfig } from '@playwright/test';

// Freeze tests are NOT flake: a hang is a real result, so never retry it away and
// never parallelize (the Electron target is a singleton). Timeout is generous because
// freezes are slow by nature. Trace/video are captured per-run in tests/fixtures.ts
// (Electron needs recordVideo at launch and tracing on the BrowserContext).
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './runs/artifacts',
});
