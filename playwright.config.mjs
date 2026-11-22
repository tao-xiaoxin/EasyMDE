import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const localEnv = new URL('.env', import.meta.url);
if (existsSync(localEnv)) {
  loadEnvFile(localEnv);
}

// Playwright's bundled headless shell reports document.hasFocus() === true on
// every page, so the focus-loss case can never observe a real blur. A full
// Chrome binary does emit it; point at one locally through this env var rather
// than hard-coding a machine path in the repository.
const chromiumExecutable = process.env.EASYMDE_E2E_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]] : [['list']],
  use: {
    baseURL: process.env.EASYMDE_E2E_BASE_URL || 'http://127.0.0.1:8089',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {})
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: /@performance/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium-performance',
      grep: /@performance/,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'off',
        video: 'off'
      }
    }
  ],
  outputDir: 'test-results/playwright'
});
