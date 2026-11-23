import { test } from '@playwright/test';
import { createPreviewReadOperationLedger, installHistoryObserver } from './visual-browser-monitor.mjs';

const browserMonitors = new WeakMap();

function monitorPathClass(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview') return 'preview';
    if (url.pathname.includes('/easymde/v1/') || url.searchParams.get('rest_route')?.startsWith('/easymde/v1/')) return 'easymde-api';
    if (url.pathname.endsWith('/admin-ajax.php')) return 'admin-ajax';
    if (url.pathname.includes('/wp-content/plugins/')) return 'plugin-asset';
    if (url.pathname.includes('/wp-admin/')) return 'wp-admin';
    return 'other';
  } catch { return 'invalid'; }
}

export async function installBrowserMonitor(page, { baseURL = test.info().project.use.baseURL } = {}) {
  const existing = browserMonitors.get(page);
  if (existing) return existing;
  const state = {
    counts: { consoleWarnings: 0, consoleErrors: 0, pageErrors: 0, unhandledRejections: 0,
      dialogs: 0, requestFailures: 0, httpErrors: 0, navigations: 0, popups: 0 },
    approved: { previewCancellations: 0, setupNavigations: 0, dialogs: 0, popups: 0 },
    issues: [],
    rejectionIngressStopped: false,
    sealed: false,
    detached: false
  };
  const preview = {
    expectedAborts: new WeakMap(),
    failures: [],
    httpFailures: [],
    pendingConsoleFailures: [],
    approvedAborts: 0,
    eventOrdinal: 0
  };
  const navigationExpectations = [];
  const dialogExpectations = [];
  const popupExpectations = [];
  const pendingHandlers = new Set();
  const inFlightRequests = new Set();
  const previewReadLedger = createPreviewReadOperationLedger({
    origin: new URL(baseURL).origin,
    record: (code) => record(code),
    deferredAbortCode: () => 'preview-request-cancellation-unapproved',
    onApprovedAborts: (count) => {
      preview.approvedAborts += count;
      state.approved.previewCancellations += count;
    }
  });
  let historyObserver = null;
  let eventOrdinal = 0;
  const noteEvent = () => { eventOrdinal += 1; };
  const record = (code) => { if (state.issues.length < 128) state.issues.push(code); };
  const track = (promise) => {
    const tracked = Promise.resolve(promise);
    pendingHandlers.add(tracked);
    void tracked.finally(() => pendingHandlers.delete(tracked));
    return tracked;
  };
  const trackableRequest = (request) => !['eventsource', 'ping'].includes(request.resourceType());
  const notePreviewEvent = () => { preview.eventOrdinal += 1; return preview.eventOrdinal; };
  const pairPreviewConsoleFailure = (failure) => {
    const index = preview.pendingConsoleFailures.findIndex(
      (consoleFailure) => !consoleFailure.failurePaired && consoleFailure.pathClass === failure.pathClass
    );
    if (index < 0) return false;
    const [consoleFailure] = preview.pendingConsoleFailures.splice(index, 1);
    failure.consolePaired = true;
    consoleFailure.failurePaired = true;
    return true;
  };
  const onRequest = (request) => {
    noteEvent();
    if (trackableRequest(request)) inFlightRequests.add(request);
    previewReadLedger.observeRequest(request);
  };
  const onRequestFinished = (request) => {
    noteEvent();
    inFlightRequests.delete(request);
    previewReadLedger.observeFinished(request);
  };
  const onConsole = (message) => {
    noteEvent();
    if (message.type() === 'warning') {
      state.counts.consoleWarnings += 1;
      record('console-warning');
    } else if (message.type() === 'error') {
      state.counts.consoleErrors += 1;
      const text = message.text();
      const code = text.match(/\[EasyMDE\]\s+([a-z0-9-]+)/u)?.[1];
      if (!code && text.startsWith('Failed to load resource:')
        && monitorPathClass(message.location().url) === 'preview') {
        const previewOrdinal = notePreviewEvent();
        const httpFailure = preview.httpFailures.find((entry) => !entry.consolePaired);
        if (httpFailure) {
          httpFailure.consolePaired = true;
          return;
        }
        const candidate = preview.failures.find(
          (failure) => !failure.consolePaired && failure.pathClass === 'preview'
        );
        if (candidate) candidate.consolePaired = true;
        else preview.pendingConsoleFailures.push({ pathClass: 'preview', failurePaired: false, previewOrdinal });
      } else {
        record(code ? `console-error:${code}` : 'console-error:unclassified');
      }
    }
  };
  const onPageError = () => { noteEvent(); state.counts.pageErrors += 1; record('page-error'); };
  const onDialog = (dialog) => {
    noteEvent();
    state.counts.dialogs += 1;
    const type = ['alert', 'confirm', 'prompt', 'beforeunload'].includes(dialog.type()) ? dialog.type() : 'unknown';
    const index = dialogExpectations.findIndex((expected) => expected.type === type && !expected.claimed);
    const expected = index >= 0 ? dialogExpectations[index] : null;
    if (expected) expected.claimed = true;
    else record(`dialog:${type}`);
    const action = expected?.action ?? 'dismiss';
    const operation = action === 'accept' ? dialog.accept() : dialog.dismiss();
    track(operation.then(() => {
      if (expected) state.approved.dialogs += 1;
    }, () => record('dialog-action-failed')));
  };
  const onPopup = (popup) => {
    noteEvent();
    state.counts.popups += 1;
    const pathClass = monitorPathClass(popup.url());
    const index = popupExpectations.findIndex((expected) => expected.pathClass === pathClass && !expected.claimed);
    const expected = index >= 0 ? popupExpectations[index] : null;
    if (expected) expected.claimed = true;
    else record(`popup:${pathClass}`);
    track(popup.close().then(() => {
      if (expected) state.approved.popups += 1;
    }, () => record('popup-close-failed')));
  };
  const onRequestFailed = (request) => {
    noteEvent();
    inFlightRequests.delete(request);
    state.counts.requestFailures += 1;
    const ledgerDeferred = previewReadLedger.observeFailure(request);
    const pathClass = monitorPathClass(request.url());
    const resourceType = request.resourceType();
    if (pathClass === 'preview' && request.failure()?.errorText === 'net::ERR_ABORTED') {
      const failure = { request, pathClass: 'preview', consolePaired: false, approved: false,
        ledgerDeferred, previewOrdinal: notePreviewEvent() };
      preview.failures.push(failure);
      pairPreviewConsoleFailure(failure);
    } else {
      if (!ledgerDeferred) record(`request-failed:${pathClass}:${resourceType}`);
      if (pathClass === 'preview') {
        const failure = { request, pathClass: 'preview', consolePaired: false, approved: false,
          ledgerDeferred: true, previewOrdinal: notePreviewEvent() };
        preview.failures.push(failure);
        pairPreviewConsoleFailure(failure);
      }
    }
  };
  const onResponse = (response) => {
    noteEvent();
    previewReadLedger.observeResponse(response.request(), response.status());
    if (response.status() < 400) return;
    const pathClass = monitorPathClass(response.url());
    if (pathClass === 'preview') {
      const httpFailure = { pathClass: 'preview', consolePaired: false, previewOrdinal: notePreviewEvent() };
      if (!pairPreviewConsoleFailure(httpFailure)) preview.httpFailures.push(httpFailure);
    }
    const resourceType = response.request().resourceType();
    state.counts.httpErrors += 1;
    record(`http-${response.status()}:${pathClass}:${resourceType}`);
  };
  const handleDocumentNavigation = (url) => {
    noteEvent();
    state.counts.navigations += 1;
    let destination;
    try {
      destination = new URL(url);
    } catch {
      record('main-frame-navigation:invalid');
      return false;
    }
    const index = navigationExpectations.findIndex((expected) => !expected.claimed
      && expected.origin === destination.origin && expected.pathname === destination.pathname
      && expected.search === destination.search && expected.hash === destination.hash);
    if (index >= 0) {
      navigationExpectations[index].claimed = true;
      state.approved.setupNavigations += 1;
      return true;
    }
    record(`main-frame-navigation:${monitorPathClass(destination.href)}`);
    return false;
  };
  page.on('request', onRequest);
  page.on('requestfinished', onRequestFinished);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('dialog', onDialog);
  page.on('popup', onPopup);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  try {
    historyObserver = await installHistoryObserver(page, {
      onDocumentNavigation: handleDocumentNavigation,
      recordIssue: record
    });
  } catch {
    page.off('request', onRequest);
    page.off('requestfinished', onRequestFinished);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    throw new Error('browser-monitor-install-failed');
  }
  Object.assign(state, {
    expectNavigation(destination, action, navBaseURL = test.info().project.use.baseURL) {
      if (typeof action !== 'string' || !/^[a-z0-9-]+$/u.test(action)) {
        throw new Error('browser-monitor-invalid-navigation-action');
      }
      let parsed;
      try {
        const base = new URL(navBaseURL);
        parsed = new URL(destination, base);
        if (parsed.origin !== base.origin
          || !['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        throw new Error('browser-monitor-invalid-navigation-destination');
      }
      navigationExpectations.push({
        origin: parsed.origin, pathname: parsed.pathname, search: parsed.search,
        hash: parsed.hash, pathClass: monitorPathClass(parsed.href), action, claimed: false
      });
    },
    markUnhandledRejection() { state.counts.unhandledRejections += 1; record('unhandled-rejection'); },
    async flushHistory() {
      return historyObserver?.flush?.() ?? false;
    },
    async stopHistory() {
      return historyObserver?.stop?.() ?? false;
    },
    async flushRejections() {
      if (page.isClosed()) { record('rejection-barrier-page-closed'); return false; }
      try {
        const current = new URL(page.url());
        if (current.protocol === 'about:') return true;
      } catch {
        record('rejection-barrier-unavailable');
        return false;
      }
      let timer;
      try {
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, 2_000); });
        const results = await Promise.race([Promise.all(page.frames().map((frame) => frame.evaluate(
          (key) => window[key]?.flush?.() ?? null,
          '__easymdeRejectionBridge'
        ).catch(() => null))), timeout]);
        if (!Array.isArray(results)) { record('rejection-barrier-timeout'); return false; }
        let clean = true;
        for (const result of results) {
          if (!result) { record('rejection-barrier-unavailable'); clean = false; continue; }
          if (result.failed > 0) { record('rejection-notification-transport-failed'); clean = false; }
          if (result.pending > 0) { record('rejection-barrier-pending'); clean = false; }
        }
        return clean;
      } catch {
        record('rejection-barrier-unavailable');
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    async stopRejections() {
      if (state.rejectionIngressStopped) return;
      state.rejectionIngressStopped = true;
      if (page.isClosed()) { record('rejection-barrier-page-closed'); return; }
      let timer;
      try {
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, 2_000); });
        const results = await Promise.race([Promise.all(page.frames().map((frame) => frame.evaluate(
          (key) => window[key]?.stop?.() ?? null,
          '__easymdeRejectionBridge'
        ).catch(() => null))), timeout]);
        if (!Array.isArray(results)) { record('rejection-barrier-timeout'); return; }
        for (const result of results) {
          if (!result) { record('rejection-barrier-unavailable'); continue; }
          if (result.failed > 0) record('rejection-notification-transport-failed');
          if (result.pending > 0) record('rejection-barrier-pending');
        }
      } catch {
        record('rejection-barrier-unavailable');
      } finally {
        clearTimeout(timer);
      }
    },
    expectDialog(type, action = 'dismiss') {
      if (!['alert', 'confirm', 'prompt', 'beforeunload'].includes(type)
        || !['accept', 'dismiss'].includes(action)) throw new Error('browser-monitor-invalid-dialog-expectation');
      dialogExpectations.push({ type, action, claimed: false });
    },
    expectPopup(pathClass = 'other', action = 'close') {
      if (action !== 'close' || !['preview', 'easymde-api', 'admin-ajax', 'plugin-asset', 'wp-admin', 'other', 'invalid'].includes(pathClass)) {
        throw new Error('browser-monitor-invalid-popup-expectation');
      }
      popupExpectations.push({ pathClass, action, claimed: false });
    },
    expectPreviewCancellation(request, action = 'test-cancellation') {
      if (monitorPathClass(request.url()) !== 'preview' || !['test-cancellation', 'supersede', 'teardown'].includes(action)) {
        throw new Error('browser-monitor-invalid-preview-cancellation-expectation');
      }
      preview.expectedAborts.set(request, { action });
    },
    beginPreviewReadOperation(declaration) {
      return previewReadLedger.begin(declaration);
    },
    beginPhased(declaration) {
      return previewReadLedger.beginPhased(declaration);
    },
    enterPhase(operationId, phaseId) {
      return previewReadLedger.enterPhase(operationId, phaseId);
    },
    provePreviewReadOperation(operationId, evidence) {
      return previewReadLedger.prove(operationId, evidence);
    },
    async drain({ timeoutMs = 5_000, quietMs = 50 } = {}) {
      const deadline = Date.now() + timeoutMs;
      const settleHandlers = async (limitMs) => {
        if (pendingHandlers.size === 0) return true;
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), limitMs); });
        const settled = Promise.allSettled([...pendingHandlers]).then(() => true);
        const result = await Promise.race([settled, timeout]);
        clearTimeout(timer);
        return result;
      };
      while (Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        await settleHandlers(Math.min(remaining, 50));
        if (inFlightRequests.size === 0 && pendingHandlers.size === 0) {
          const observed = eventOrdinal;
          await new Promise((resolve) => setTimeout(resolve, Math.min(quietMs, Math.max(1, deadline - Date.now()))));
          if (observed === eventOrdinal && inFlightRequests.size === 0 && pendingHandlers.size === 0) return true;
        } else {
          await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
        }
      }
      record('browser-monitor-drain-timeout');
      return false;
    },
    finalize() {
      if (state.sealed) return;
      state.sealed = true;
      previewReadLedger.finalize();
      for (const failure of preview.failures) {
        if (failure.ledgerDeferred) continue;
        if (preview.expectedAborts.has(failure.request)) {
          failure.approved = true;
          preview.approvedAborts += 1;
          state.approved.previewCancellations += 1;
        } else {
          record('preview-request-cancellation-unapproved');
        }
      }
      for (const failure of preview.pendingConsoleFailures) if (!failure.failurePaired) record('preview-console-failure-unpaired');
      for (const expected of navigationExpectations) if (!expected.claimed) {
        record(`navigation-expected-missing:${expected.pathClass}:${expected.action}`);
      }
      for (const expected of dialogExpectations) if (!expected.claimed) record(`dialog-expected-missing:${expected.type}`);
      for (const expected of popupExpectations) if (!expected.claimed) record(`popup-expected-missing:${expected.pathClass}`);
    },
    recordFailure(code) {
      if (typeof code === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(code)) record(code);
    },
    summary() { return { counts: { ...state.counts }, approved: { ...state.approved },
      issues: [...new Set(state.issues)], history: historyObserver?.snapshot?.() ?? null }; },
    async detach() {
      if (state.detached) return true;
      page.off('request', onRequest);
      page.off('requestfinished', onRequestFinished);
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('dialog', onDialog);
      page.off('popup', onPopup);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      const historyDetached = await historyObserver?.detach?.() ?? true;
      state.detached = true;
      if (historyDetached === false) record('monitor-history-detach-failed');
      return historyDetached !== false;
    }
  });
  browserMonitors.set(page, state);
  return state;
}

export async function installMonitorRejectionBridge(page, browserMonitor, onUnhandled = () => {}) {
  await page.exposeFunction('__easymdeReportRejection', () => {
    browserMonitor.markUnhandledRejection();
    onUnhandled();
  });
  await page.addInitScript(() => {
    const pending = new Map();
    let observed = 0;
    let confirmed = 0;
    let failed = 0;
    let nextId = 1;
    let accepting = true;
    let notificationListener;
    const notify = () => {
      if (!accepting) return;
      observed += 1;
      const id = nextId;
      nextId += 1;
      let operation;
      try {
        if (typeof window.__easymdeReportRejection !== 'function') { failed += 1; return; }
        operation = Promise.resolve(window.__easymdeReportRejection(id));
      } catch {
        failed += 1;
        return;
      }
      const tracked = Promise.resolve(operation).then(
        () => { confirmed += 1; pending.delete(id); },
        () => { failed += 1; pending.delete(id); }
      );
      pending.set(id, tracked);
    };
    const flush = async () => {
      let boundary = observed;
      do {
        await Promise.allSettled([...pending.values()]);
        if (boundary === observed && pending.size === 0) break;
        boundary = observed;
      } while (accepting);
      return { observed, pending: pending.size, confirmed, failed };
    };
    window.__easymdeRejectionBridge = {
      get observed() { return observed; },
      get pending() { return pending.size; },
      get confirmed() { return confirmed; },
      get failed() { return failed; },
      async flush() { return flush(); },
      async stop() {
        accepting = false;
        window.removeEventListener('unhandledrejection', notificationListener);
        await flush();
        return { observed, pending: pending.size, confirmed, failed };
      }
    };
    notificationListener = () => { void notify(); };
    window.addEventListener('unhandledrejection', notificationListener);
  });
}

export async function finalizeBasicMonitor(monitor) {
  try { await monitor.drain(); } catch { monitor.recordFailure('browser-monitor-drain-failed'); }
  try { await monitor.stopHistory(); } catch { monitor.recordFailure('browser-monitor-history-stop-failed'); }
  try { await monitor.drain(); } catch { monitor.recordFailure('browser-monitor-final-drain-failed'); }
  try { await monitor.stopRejections(); } catch { monitor.recordFailure('browser-monitor-rejection-shutdown-failed'); }
  try { monitor.finalize(); } catch { monitor.recordFailure('browser-monitor-finalize-failed'); }
  try { await monitor.detach(); } catch { monitor.recordFailure('browser-monitor-detach-failed'); }
  return monitor.summary();
}

export const MONITOR_CONTRACT_ORIGIN = 'http://monitor.synthetic.invalid';

export const MONITOR_CONTRACT_HTML = '<!doctype html><html><body data-monitor-contract="synthetic">synthetic</body></html>';

export const PREVIEW_LEDGER_POST_ID = 9717;

export const PREVIEW_LEDGER_RENDER_PARAMS = Object.freeze({
  markdown_theme: 'monitor-contract-markdown-theme',
  code_theme: 'monitor-contract-code-theme',
  custom_css_id: ''
});

export function previewLedgerRequest({
  source,
  postId = PREVIEW_LEDGER_POST_ID,
  method = 'POST',
  path = '/wp-json/easymde/v1/preview',
  failureText = null,
  renderParams = null,
  extraBody = {}
}) {
  const body = {
    post_id: postId,
    markdown: source,
    ...(renderParams ?? {}),
    ...extraBody
  };
  return {
    failure: () => failureText === null ? null : { errorText: failureText },
    method: () => method,
    postData: () => JSON.stringify(body),
    postDataJSON: () => ({ ...body }),
    resourceType: () => 'fetch',
    url: () => `${MONITOR_CONTRACT_ORIGIN}${path}`
  };
}

export function createPreviewLedgerHarness() {
  const issues = [];
  const approvedAbortCounts = [];
  const ledger = createPreviewReadOperationLedger({
    origin: MONITOR_CONTRACT_ORIGIN,
    record: (code) => issues.push(code),
    deferredAbortCode: () => 'preview-request-cancellation-unapproved',
    onApprovedAborts: (count) => approvedAbortCounts.push(count)
  });
  return { approvedAbortCounts, issues, ledger };
}

export function observePreviewLedgerAbort(ledger, request) {
  ledger.observeRequest(request);
  return ledger.observeFailure(request);
}

export function observePreviewLedgerSuccess(ledger, request, status = 200) {
  ledger.observeRequest(request);
  ledger.observeResponse(request, status);
  ledger.observeFinished(request);
}
