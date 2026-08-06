import { createHash } from 'node:crypto';

export function classifyPreviewRequestOutcomes(observed, markdownTheme) {
  const cancelled = observed.filter(({ cancelled: wasCancelled }) => wasCancelled);
  const active = observed.filter(({ cancelled: wasCancelled }) => !wasCancelled);
  const invalidPayload = ({
    markdownTheme: observedTheme,
    payloadDigest,
    parseError
  }) => (
    parseError
    || null === observedTheme
    || null === payloadDigest
  );
  const invalidResponse = ({
    responseBodyError,
    responseParseError
  }) => (
    responseBodyError
    || responseParseError
  );
  const payloadInvalid = observed.filter(invalidPayload);
  const responseInvalid = active.filter(invalidResponse);
  const cancelledResponseInvalid = cancelled.filter(invalidResponse);
  const invalid = [...new Set([...payloadInvalid, ...responseInvalid])];
  const nonTarget = active.filter(
    ({ markdownTheme: observedTheme }) => observedTheme !== markdownTheme
  );
  const target = active.filter(
    ({ markdownTheme: observedTheme }) => observedTheme === markdownTheme
  );
  const successful = target.filter(
    ({ status, failure }) => (
      null === failure
      && null !== status
      && status >= 200
      && status < 300
    )
  );
  const failed = target.filter((outcome) => !successful.includes(outcome));
  const nonceRetries = failed.filter(
    ({ failure, responseErrorCode, status }) => (
      null === failure
      && 403 === status
      && 'rest_cookie_invalid_nonce' === responseErrorCode
    )
  );
  const nonceRetryIsValid =
    1 === nonceRetries.length
    && 1 === successful.length
    && 1 === failed.length
    && nonceRetries[0].payloadDigest === successful[0].payloadDigest
    && active.indexOf(nonceRetries[0]) + 1 === active.indexOf(successful[0])
    && active.length === target.length
    && target.indexOf(nonceRetries[0]) < target.indexOf(successful[0]);

  return {
    observed,
    active,
    cancelled,
    cancelledResponseInvalid,
    invalid,
    payloadInvalid,
    responseInvalid,
    nonTarget,
    target,
    successful,
    failed,
    nonceRetries,
    nonceRetryIsValid
  };
}

export async function waitForPreviewRequestSettlements(
  settlements,
  {
    markdownTheme,
    startIndex,
    timeoutMs = 15_000
  }
) {
  let timeout;
  try {
    await Promise.race([
      Promise.all(settlements),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `preview-request-evidence-timeout theme=${markdownTheme}`
            + ` start=${startIndex} count=${settlements.length}`
        )), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function collectPreviewRequestOutcomes(page) {
  const outcomes = [];
  const outcomeByRequest = new WeakMap();
  const settledByOutcome = new WeakMap();
  const settleByOutcome = new WeakMap();
  const previewPath = '/wp-json/easymde/v1/preview';

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if ('POST' !== request.method() || !pathname.endsWith(previewPath)) {
      return;
    }

    let payload;
    const payloadText = request.postData();
    let parseError = null;
    try {
      payload = request.postDataJSON();
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const outcome = {
      markdownTheme:
        payload && 'object' === typeof payload && 'string' === typeof payload.markdown_theme
          ? payload.markdown_theme
          : null,
      payloadDigest: 'string' === typeof payloadText
        ? createHash('sha256').update(payloadText).digest('hex')
        : null,
      status: null,
      failure: null,
      cancelled: false,
      parseError,
      responseErrorCode: null,
      responseBodyError: null,
      responseParseError: null
    };
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    outcomes.push(outcome);
    outcomeByRequest.set(request, outcome);
    settledByOutcome.set(outcome, settled);
    settleByOutcome.set(outcome, settle);
  });

  page.on('response', async (response) => {
    const outcome = outcomeByRequest.get(response.request());
    if (!outcome) {
      return;
    }

    outcome.status = response.status();
    try {
      const responseBody = await response.body();
      if (!response.ok()) {
        const body = JSON.parse(responseBody.toString('utf8'));
        outcome.responseErrorCode =
          body && 'object' === typeof body && 'string' === typeof body.code
            ? body.code
            : null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (response.ok()) {
        outcome.responseBodyError = errorMessage;
      } else {
        outcome.responseParseError = errorMessage;
      }
    } finally {
      settleByOutcome.get(outcome)?.();
    }
  });

  page.on('requestfailed', (request) => {
    const outcome = outcomeByRequest.get(request);
    if (!outcome) {
      return;
    }

    const errorText = request.failure()?.errorText ?? 'unknown-request-failure';
    if ('net::ERR_ABORTED' === errorText) {
      outcome.cancelled = true;
    } else {
      outcome.failure = errorText;
    }
    settleByOutcome.get(outcome)?.();
  });

  return {
    get length() {
      return outcomes.length;
    },
    async evidence(startIndex, markdownTheme) {
      let observed = [];
      let stabilized = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const observedEnd = outcomes.length;
        observed = outcomes.slice(startIndex, observedEnd);
        await waitForPreviewRequestSettlements(
          observed.map((outcome) => settledByOutcome.get(outcome)),
          { markdownTheme, startIndex }
        );
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        if (outcomes.length === observedEnd) {
          stabilized = true;
          break;
        }
      }
      if (!stabilized) {
        throw new Error('preview-request-evidence-did-not-stabilize');
      }

      return classifyPreviewRequestOutcomes(observed, markdownTheme);
    }
  };
}
