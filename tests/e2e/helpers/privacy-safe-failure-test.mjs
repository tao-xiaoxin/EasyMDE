import { basename } from 'node:path';
import { test } from '@playwright/test';

export const privacySafeFailureTest = test.extend({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  withoutFailurePageSnapshot: [async ({}, use) => {
    // Playwright's failure prompt takes a page snapshot independently of screenshots and trace.
    const previous = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    try {
      await use();
    } finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
      else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previous;
    }
  }, { scope: 'worker', auto: true }],
  // Keep redaction runnable after another fixture exhausts the shared teardown budget.
  redactFailureDetails: [async ({}, use, testInfo) => {
    try {
      await use();
    } finally {
      // Run after each-test hooks and page fixtures, but before Playwright builds the
      // failure attachment and reports the result. Keep the original status and error count.
      const file = basename(testInfo.file);
      for (const [index, error] of testInfo.errors.entries()) {
        const match = error.stack?.split('\n').find((line) => /^\s+at /u.test(line)
          && line.includes(`${testInfo.file}:`));
        const position = match?.match(/:(\d+:\d+)\)?$/u)?.[1];
        testInfo.errors[index] = {
          message: 'Authenticated workflow failed; browser and assertion data omitted'
            + (position ? ` at ${file}:${position}` : '') + '.'
        };
      }
    }
  }, { auto: true, timeout: 5_000 }]
});
