import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPreviewRequestOutcomes,
  waitForPreviewRequestSettlements
} from '../e2e/helpers/preview-request-evidence.mjs';

function outcome(overrides = {}) {
  return {
    markdownTheme: 'spring',
    payloadDigest: 'payload',
    status: 200,
    failure: null,
    cancelled: false,
    parseError: null,
    responseErrorCode: null,
    responseBodyError: null,
    responseParseError: null,
    ...overrides
  };
}

test('keeps cancelled preview outcomes observable without counting them as active failures', () => {
  const cancelled = outcome({
    cancelled: true,
    status: null,
    responseBodyError: 'response body was unavailable after abort'
  });
  const successful = outcome();

  const evidence = classifyPreviewRequestOutcomes([cancelled, successful], 'spring');

  assert.deepEqual(evidence.observed, [cancelled, successful]);
  assert.deepEqual(evidence.cancelled, [cancelled]);
  assert.deepEqual(evidence.cancelledResponseInvalid, [cancelled]);
  assert.deepEqual(evidence.active, [successful]);
  assert.deepEqual(evidence.invalid, []);
  assert.deepEqual(evidence.payloadInvalid, []);
  assert.deepEqual(evidence.responseInvalid, []);
  assert.deepEqual(evidence.successful, [successful]);
  assert.deepEqual(evidence.failed, []);
});

test('rejects malformed payload evidence even when the request was cancelled', () => {
  const cancelled = outcome({
    cancelled: true,
    markdownTheme: null,
    parseError: 'unexpected token',
    payloadDigest: null,
    status: null
  });

  const evidence = classifyPreviewRequestOutcomes([cancelled], 'spring');

  assert.deepEqual(evidence.cancelled, [cancelled]);
  assert.deepEqual(evidence.payloadInvalid, [cancelled]);
  assert.deepEqual(evidence.invalid, [cancelled]);
});

test('accepts one adjacent nonce retry while ignoring an observed cancellation', () => {
  const cancelled = outcome({ cancelled: true, status: null });
  const nonceRetry = outcome({
    status: 403,
    responseErrorCode: 'rest_cookie_invalid_nonce'
  });
  const successful = outcome();

  const evidence = classifyPreviewRequestOutcomes(
    [cancelled, nonceRetry, successful],
    'spring'
  );

  assert.equal(evidence.nonceRetryIsValid, true);
  assert.deepEqual(evidence.nonceRetries, [nonceRetry]);
  assert.deepEqual(evidence.successful, [successful]);
});

test('keeps non-cancellation transport errors in the failed evidence', () => {
  const failed = outcome({
    status: null,
    failure: 'net::ERR_CONNECTION_RESET'
  });

  const evidence = classifyPreviewRequestOutcomes([failed], 'spring');

  assert.deepEqual(evidence.cancelled, []);
  assert.deepEqual(evidence.failed, [failed]);
  assert.equal(evidence.nonceRetryIsValid, false);
});

test('fails fast with scoped evidence when a preview request never settles', async () => {
  await assert.rejects(
    waitForPreviewRequestSettlements(
      [new Promise(() => {})],
      { markdownTheme: 'spring', startIndex: 7, timeoutMs: 5 }
    ),
    /preview-request-evidence-timeout theme=spring start=7 count=1/
  );
});
