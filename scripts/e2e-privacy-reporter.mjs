import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const privacyReporterPath = fileURLToPath(import.meta.url);
export const privacySafeFailureDetails = { annotation: { type: 'easymde-private-failure' } };

function isProtected(test) {
  return test.annotations.some(({ type }) => type === privacySafeFailureDetails.annotation.type);
}

export function redactFailure(error, file) {
  const location = error.location?.file === file ? error.location : undefined;
  const frame = error.stack?.split('\n').find((line) => /^\s+at /u.test(line) && line.includes(`${file}:`));
  const position = location ? `${location.line}:${location.column}` : frame?.match(/:(\d+:\d+)\)?$/u)?.[1];
  const message = 'Authenticated workflow failed; browser and assertion data omitted';
  return { message: message + (position ? ` at ${basename(file)}:${position}` : '') + '.' };
}

// Configure this before any output reporter. Playwright emits step errors
// separately from testInfo.errors, including errors on parent steps and hooks.
export default class PrivacyReporter {
  onStepBegin(test, _result, step) {
    if (!isProtected(test)) return;
    if (step.category === 'expect') step.title = 'Assertion';
    if (step.category === 'pw:api') step.title = 'Browser operation';
    if (step.category === 'test.step') step.title = 'Test step';

    // Live Playwright steps capture the original title in titlePath(). Read
    // the updated titles instead. Parent steps begin before their children.
    step.titlePath = () => {
      const titles = [];
      for (let current = step; current; current = current.parent) {
        titles.push(current.title);
      }
      return titles.reverse();
    };
  }

  onStepEnd(test, _result, step) {
    if (isProtected(test) && step.error) {
      step.error = redactFailure({ ...step.error, location: step.location }, test.location.file);
    }
  }
}
