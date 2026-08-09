import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const localEnv = new URL('.env', import.meta.url);
if (existsSync(localEnv)) {
  loadEnvFile(localEnv);
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]] : [['list']],
  use: {
    baseURL: process.env.EASYMDE_E2E_BASE_URL || 'http://127.0.0.1:8089',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on-first-retry' : 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  outputDir: 'test-results/playwright'
});
