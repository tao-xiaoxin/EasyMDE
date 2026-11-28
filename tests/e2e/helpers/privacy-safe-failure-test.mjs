import { test } from '@playwright/test';
import { privacyReporterPath, privacySafeFailureDetails, redactFailure } from '../../../scripts/e2e-privacy-reporter.mjs';

export { privacySafeFailureDetails };

export function redactRecordedFailures(testInfo) {
  const { errors, file } = testInfo;
  for (const [index, error] of errors.entries()) {
    errors[index] = redactFailure(error, file);
  }

  // Playwright reads this array for failure context and worker results. Keep
  // redacting writes after fixture teardown, when a timed-out hook can settle.
  testInfo.errors = new Proxy(errors, {
    set(target, property, value) {
      const isIndex = typeof property === 'string' && /^(?:0|[1-9]\d*)$/u.test(property);
      return Reflect.set(target, property, isIndex ? redactFailure(value, file) : value);
    }
  });
}

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
  redactFailureDetails: [async ({}, use, testInfo) => {
    const { config, annotations } = testInfo;
    if (config.reporter[0]?.[0] !== privacyReporterPath) {
      throw new Error('Protected tests require the EasyMDE privacy reporter first');
    }
    if (!annotations.some(({ type }) => type === privacySafeFailureDetails.annotation.type)) {
      throw new Error('Protected tests require the EasyMDE privacy annotation');
    }
    redactRecordedFailures(testInfo);
    await use();
  }, { auto: true, timeout: 5_000 }]
});
