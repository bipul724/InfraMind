import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  outputDir: '../test-results',
  reporter: [['list']],
  timeout: 30000,
  globalTimeout: 180000,
  expect: { timeout: 10000 },
  retries: 0,
  workers: 1,
  use: {
    channel: 'chrome', headless: true, serviceWorkers: 'block',
    viewport: { width: 1280, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] }
  }
});
