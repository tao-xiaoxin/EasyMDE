// Source-only CDP evidence contract: frozen primary/cleanup states, the
// ordered cleanup runner, and the CDP session cleanup wrapper.

import { releaseCdpObject } from "./cdp-geometry.mjs";

export function freezeSourceOnlyPrimary(status, code) {
  if (!['available', 'failed', 'unavailable'].includes(status) || typeof code !== 'string') {
    throw new Error('wechat-task-context-source-only-contract-primary-invalid');
  }
  return Object.freeze({ code, status });
}

export function freezeSourceOnlyCleanup(status, code) {
  if (!['failed', 'success'].includes(status) || (status === 'failed' && typeof code !== 'string')) {
    throw new Error('wechat-task-context-source-only-contract-cleanup-invalid');
  }
  return Object.freeze({ code: code ?? null, status });
}

export async function runSourceOnlyCleanupContract(primary, operations = {}) {
  const cleanup = {};
  const attempts = {};
  const cleanupOrder = ['restore', 'release', 'resume', 'detach'];
  for (const name of cleanupOrder) {
    attempts[name] = 0;
    const operation = operations[name];
    if (typeof operation !== 'function') continue;
    attempts[name] = 1;
    try {
      const outcome = await operation();
      if (!outcome || !['failed', 'success'].includes(outcome.status)) {
        throw new Error('wechat-task-context-source-only-contract-cleanup-failed');
      }
      cleanup[name] = freezeSourceOnlyCleanup(outcome.status, outcome.code);
    } catch (error) {
      const code = error instanceof Error && /^wechat-task-context-source-only-[a-z0-9-]+$/u.test(error.message)
        ? error.message
        : 'wechat-task-context-source-only-contract-cleanup-failed';
      cleanup[name] = freezeSourceOnlyCleanup('failed', code);
    }
  }
  const cleanupCodes = cleanupOrder
    .map((name) => cleanup[name])
    .filter(Boolean)
    .filter(({ status }) => status === 'failed')
    .map(({ code }) => code);
  return Object.freeze({
    attempts: Object.freeze(attempts),
    cleanup: Object.freeze(cleanup),
    cleanupCodes: Object.freeze(cleanupCodes),
    code: primary.code,
    primary,
    status: primary.status === 'failed' || cleanupCodes.length ? 'failed' : primary.status
  });
}

export async function runSourceOnlyCdpCleanup(primary, cdp, rootObjectId, release = releaseCdpObject) {
  return runSourceOnlyCleanupContract(primary, {
    ...(cdp && rootObjectId ? {
      release: async () => {
        const released = await release(cdp, rootObjectId);
        return released === true
          ? freezeSourceOnlyCleanup('success', null)
          : freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-release-failed');
      }
    } : {}),
    ...(cdp ? {
      detach: async () => {
        try {
          await cdp.detach();
          return freezeSourceOnlyCleanup('success', null);
        } catch {
          return freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-detach-failed');
        }
      }
    } : {})
  });
}

export function completeSourceOnlyCdpEvidence(primaryResult, contract, runtime) {
  return {
    ...primaryResult,
    cleanup: contract.cleanup,
    cleanupAttempts: contract.attempts,
    cleanupCodes: contract.cleanupCodes,
    code: contract.primary.code,
    primary: contract.primary,
    runtime,
    status: contract.status === 'failed'
      ? 'failed'
      : primaryResult.status
  };
}
