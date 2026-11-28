import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { E2E_TEST_MATCH } from './scripts/e2e-test-match.mjs';

const localEnv = new URL('.env', import.meta.url);
if (existsSync(localEnv)) {
  loadEnvFile(localEnv);
}

// Playwright's bundled headless shell reports document.hasFocus() === true on
// every page, so the focus-loss case can never observe a real blur. A full
// Chrome binary does emit it; point at one locally through this env var rather
// than hard-coding a machine path in the repository.
const chromiumExecutable = process.env.EASYMDE_E2E_CHROMIUM_EXECUTABLE;

const baseURL = process.env.EASYMDE_E2E_BASE_URL || 'http://127.0.0.1:8089';

// Chromium exposes navigator.clipboard, ClipboardItem, and permission-gated
// APIs only in a secure context. Loopback HTTP already is one; a non-loopback
// HTTP test origin is marked secure through Chromium's own standard flag so
// the real browser APIs run unmocked instead of being skipped.
function insecureTestOrigin(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ('http:' !== parsed.protocol) return null;
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if ('localhost' === host || host.endsWith('.localhost') || '::1' === host || /^127\./u.test(host)) {
    return null;
  }
  return parsed.origin;
}

const secureTestOrigin = insecureTestOrigin(baseURL);
const launchOptions = {
  ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  ...(secureTestOrigin
    ? { args: [`--unsafely-treat-insecure-origin-as-secure=${secureTestOrigin}`] }
    : {})
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: E2E_TEST_MATCH,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  retries: 0,
  reporter: process.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE
    ? [
        ['junit', { outputFile: process.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE }],
        ['./scripts/e2e-shard-case-reporter.mjs', { outputFile: `${process.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE}.cases.json` }]
      ]
    : process.env.CI
      ? [['list'], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]]
      : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(Object.keys(launchOptions).length > 0 ? { launchOptions } : {})
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
