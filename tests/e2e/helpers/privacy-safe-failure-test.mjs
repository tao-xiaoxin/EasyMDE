import { test } from '@playwright/test';
import { privacyReporterPath, privacySafeFailureDetails, redactFailure } from '../../../scripts/e2e-privacy-reporter.mjs';

export { privacySafeFailureDetails };

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
    const { config, annotations } = testInfo;
    if (config.reporter[0]?.[0] !== privacyReporterPath) {
      throw new Error('Protected tests require the EasyMDE privacy reporter first');
    }
    if (!annotations.some(({ type }) => type === privacySafeFailureDetails.annotation.type)) {
      throw new Error('Protected tests require the EasyMDE privacy annotation');
    }
    try {
      await use();
    } finally {
      // Strip matcher context before Playwright can use it in an attachment.
      for (const [index, error] of testInfo.errors.entries()) {
        testInfo.errors[index] = redactFailure(error, testInfo.file);
      }
    }
  }, { auto: true, timeout: 5_000 }]
});
