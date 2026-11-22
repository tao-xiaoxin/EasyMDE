import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createPreviewReadOperationLedger,
  finishVisualBrowserMonitor as finishSharedVisualBrowserMonitor,
  installHistoryObserver,
  installVisualBrowserMonitor as installSharedVisualBrowserMonitor
} from './helpers/visual-browser-monitor.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });


const firstRuntimeFailureObservations = new WeakMap();
const browserMonitors = new WeakMap();
const OWNED_POST_ANNOTATION = 'easymde-e2e-owned-post';
let ownedPostCapture = null;

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

async function installBrowserMonitor(page, { baseURL = test.info().project.use.baseURL } = {}) {
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
    expectNavigation(destination, action, baseURL = test.info().project.use.baseURL) {
      if (typeof action !== 'string' || !/^[a-z0-9-]+$/u.test(action)) {
        throw new Error('browser-monitor-invalid-navigation-action');
      }
      let parsed;
      try {
        const base = new URL(baseURL);
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
    async assertInputReady() {
      const drained = await state.drain({ timeoutMs: 5_000, quietMs: 300 });
      const rejectionClean = await state.flushRejections();
      const historyClean = await state.flushHistory();
      if (!drained || !rejectionClean || !historyClean || state.issues.length > 0) {
        throw new Error('browser-monitor-not-clean-before-input');
      }
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

async function installMonitorRejectionBridge(page, browserMonitor, onUnhandled = () => {}) {
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

async function finalizeBasicMonitor(monitor) {
  try { await monitor.drain(); } catch { monitor.recordFailure('browser-monitor-drain-failed'); }
  try { await monitor.stopHistory(); } catch { monitor.recordFailure('browser-monitor-history-stop-failed'); }
  try { await monitor.drain(); } catch { monitor.recordFailure('browser-monitor-final-drain-failed'); }
  try { await monitor.stopRejections(); } catch { monitor.recordFailure('browser-monitor-rejection-shutdown-failed'); }
  try { monitor.finalize(); } catch { monitor.recordFailure('browser-monitor-finalize-failed'); }
  try { await monitor.detach(); } catch { monitor.recordFailure('browser-monitor-detach-failed'); }
  return monitor.summary();
}

test.afterEach(async ({ page }, result) => {
  const monitor = browserMonitors.get(page);
  const ownership = ownedPostCapture;
  ownedPostCapture = null;
  const primaryFailure = result.status !== result.expectedStatus;
  let monitorSummary = null;
  let monitorFailure = null;
  if (primaryFailure && !page.isClosed()) {
    try {
      const firstRuntimeFailure = firstRuntimeFailureObservations.get(page);
      if (firstRuntimeFailure) {
        const observation = await firstRuntimeFailure;
        const state = observation.state;
        console.log(JSON.stringify({ ...observation,
          state: state?.runtimeEditable === undefined ? safeFullCrossBlockState(state) : safeWindowedState(state) }));
      }
      const states = await page.evaluate(() => window.__easymdeTestEditabilityStates ?? []);
      await result.attach('editability-transitions', {
        body: JSON.stringify(states),
        contentType: 'application/json'
      });
      const firstFailure = await page.evaluate(() => {
        const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
        const native = document.getSelection();
        const point = (node, offset) => ({
          connected: !!node?.isConnected,
          inside: !!node && !!surface?.contains(node),
          nodeType: node?.nodeType ?? null,
          parentTag: node?.parentElement?.tagName ?? null,
          offset,
          textLength: node instanceof Text ? node.length : null
        });
        return {
          phase: 'first-browser-failure-state',
          sourceLength: document.querySelector('#easymde-source')?.value.length ?? null,
          nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? null),
          nativeFocus: point(native?.focusNode, native?.focusOffset ?? null),
          nativeCollapsed: native?.isCollapsed ?? null,
          editable: surface?.getAttribute('contenteditable') ?? null,
          effectiveEditable: surface?.isContentEditable ?? null,
          locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
          session: document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') ?? null,
          previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
          busy: surface?.getAttribute('aria-busy') ?? null
        };
      });
      console.log(JSON.stringify(firstFailure));
    } catch {
      console.log(JSON.stringify({ phase: 'after-each-evidence-unavailable' }));
    }
  }

  if (monitor) {
    try {
      monitorSummary = await finalizeBasicMonitor(monitor);
    } catch {
      try { monitor.recordFailure('browser-monitor-finalization-failed'); } catch { /* safe fallback below */ }
      try { await monitor.detach(); } catch { try { monitor.recordFailure('browser-monitor-detach-failed'); } catch { /* safe log below */ } }
      try {
        monitorSummary = monitor.summary();
      } catch {
        monitorSummary = {
          counts: {}, approved: {}, issues: ['browser-monitor-summary-unavailable'], history: null
        };
        console.log(JSON.stringify({ phase: 'browser-monitor-summary-unavailable' }));
      }
    }
  } else {
    monitorSummary = { available: false, counts: {}, approved: {}, issues: [], history: null };
  }

  if (ownership) {
    try {
      await result.attach(OWNED_POST_ANNOTATION, {
        body: JSON.stringify(ownership),
        contentType: 'application/json'
      });
    } catch {
      console.log(JSON.stringify({ phase: 'owned-post-attachment-unavailable' }));
      if (!primaryFailure) monitorFailure = new Error('easymde-e2e-owned-post-attachment-failed');
    }
  }

  try {
    await result.attach('browser-monitor', {
      body: JSON.stringify(monitorSummary),
      contentType: 'application/json'
    });
  } catch {
    try { monitor?.recordFailure?.('browser-monitor-attachment-failed'); } catch { /* safe log below */ }
    console.log(JSON.stringify({ phase: 'browser-monitor-attachment-unavailable' }));
    if (!primaryFailure) monitorFailure = new Error('browser-monitor-attachment-failed');
  }

  if (!primaryFailure && !monitorFailure && monitorSummary?.issues?.length > 0) {
    monitorFailure = new Error(`browser-monitor-unapproved:${monitorSummary.issues.join(',')}`);
  }
  if (monitorFailure && !primaryFailure) throw monitorFailure;
});

// The e2e origin is http:// (not a secure context), so Chromium exposes no
// navigator.clipboard and the product correctly answers
// `editor-clipboard-unsupported` rather than pretending a cut succeeded. This
// page-level stub fills only that missing platform API; the product's own
// clipboard adapter lookup, menu cut deletion and undo history still run
// against the real code. On a secure origin the real API is left untouched.
test.beforeEach(async ({ page }) => {
  ownedPostCapture = null;
  await page.addInitScript(() => {
    if (navigator.clipboard) return;
    let written = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text) {
          written = String(text);
          return Promise.resolve();
        },
        readText() {
          return Promise.resolve(written);
        },
        write(items) {
          const plain = Array.from(items ?? []).find((item) => item?.types?.includes('text/plain'));
          if (!plain) return Promise.resolve();
          return Promise.resolve(plain.getType('text/plain'))
            .then((blob) => blob.text())
            .then((text) => { written = text; });
        }
      }
    });
  });
});

function environment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}

async function expectSource(source, expected) {
  await expect.poll(async () => await source.inputValue() === expected, {
    message: 'Canonical Markdown must match exactly; document content is not logged'
  }).toBe(true);
}

function safePublicState(state) {
  return state ? { sourceLength: state.sourceLength, contenteditable: state.contenteditable,
    sourceInputConnected: state.sourceInputConnected,
    sourceEditable: state.sourceEditable, visualEditable: state.visualEditable,
    effectiveEditable: state.effectiveEditable, focused: state.focused, lock: state.lock,
    session: state.session, previewPhase: state.previewPhase, busy: state.busy,
    failure: state.failure, repairCount: state.repairCount, nativeConnected: state.nativeConnected,
    nativeCollapsed: state.nativeCollapsed, nativeDirection: state.nativeDirection } : null;
}

function safeFullCrossBlockState(state) {
  return state ? { sourceLength: state.sourceLength, phase: state.phase,
    effectiveEditable: state.effectiveEditable, focused: state.focused, lock: state.lock,
    session: state.session, busy: state.busy, failure: state.failure,
    nativeConnected: state.nativeConnected, collapsed: state.collapsed,
    direction: state.direction, spacerCount: state.spacerCount } : null;
}

function safeWindowedState(state) {
  return state ? { sourceLength: state.sourceLength, phase: state.phase,
    previewLoading: state.previewLoading, runtimeEditable: state.runtimeEditable,
    documentEditable: state.documentEditable, effectiveEditable: state.effectiveEditable,
    contenteditable: state.contenteditable, focused: state.focused, lock: state.lock,
    session: state.session, nativeCollapsed: state.nativeCollapsed,
    nativeDirection: state.nativeDirection, spacers: state.spacers } : null;
}

async function readPublicEditorState(page) {
  return page.evaluate(() => {
    const source = document.querySelector('#easymde-source');
    const visualSurface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]')
      ?? document.querySelector('[data-easymde-preview-html-sink]');
    const sourceSurface = document.querySelector('.easymde-source-react .cm-content');
    const native = document.getSelection();
    const surface = sourceSurface?.contains(native?.anchorNode) && sourceSurface?.contains(native?.focusNode)
      ? sourceSurface : visualSurface;
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const point = (node, offset) => {
      const element = node instanceof Element ? node : node?.parentElement ?? null;
      const line = element?.closest('.cm-line') ?? null;
      let linePrefix = null;
      if (line && node?.isConnected) {
        const prefix = line.ownerDocument.createRange();
        prefix.selectNodeContents(line);
        prefix.setEnd(node, offset);
        linePrefix = prefix.toString();
      }
      return {
        connected: !!node?.isConnected,
        nodeType: node?.nodeType ?? null,
        tag: node instanceof Element ? node.tagName : null,
        parentTag: node?.parentElement?.tagName ?? null,
        offset,
        textLength: node instanceof Text ? node.length : null,
        lineText: line?.textContent ?? null,
        linePrefix
      };
    };
    const anchor = point(native?.anchorNode, native?.anchorOffset ?? 0);
    const focus = point(native?.focusNode, native?.focusOffset ?? 0);
    const backward = !!native && !native.isCollapsed && !!range
      && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
    const active = surface?.ownerDocument.activeElement ?? null;
    const sourceEditable = sourceSurface?.isContentEditable === true
      || (source instanceof HTMLTextAreaElement && !source.readOnly && !source.disabled);
    const visualEditable = visualSurface?.isContentEditable === true;
    return {
      source: source instanceof HTMLTextAreaElement ? source.value : null,
      sourceLength: source instanceof HTMLTextAreaElement ? source.value.length : null,
      sourceInputConnected: !!source?.isConnected,
      sourceEditable,
      visualEditable,
      surfaceConnected: !!surface?.isConnected,
      effectiveEditable: surface?.isContentEditable === true,
      contenteditable: surface?.getAttribute('contenteditable') ?? null,
      editable: surface?.isContentEditable === true,
      activeEditable: active?.isContentEditable === true,
      focused: active === surface,
      lock: surface?.ownerDocument.querySelector('.easymde-immersive-preview-lock')
        ?.getAttribute('aria-pressed') ?? null,
      session: surface?.ownerDocument.querySelector('[data-easymde-session-status]')
        ?.getAttribute('data-easymde-session-status') ?? null,
      previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
      busy: surface?.getAttribute('aria-busy') ?? null,
      failure: surface?.ownerDocument.querySelector('[data-easymde-visual-failure]')
        ?.getAttribute('data-easymde-visual-failure') ?? null,
      repairCount: Number(surface?.ownerDocument.querySelector('[data-easymde-visual-deletion-repair]')
        ?.getAttribute('data-easymde-visual-deletion-repair') ?? 0),
      spacerCount: surface?.querySelectorAll('[data-easymde-preview-window-spacer]').length ?? 0,
      nativeConnected: !!native?.anchorNode?.isConnected && !!native.focusNode?.isConnected
        && !!surface?.contains(native.anchorNode) && !!surface?.contains(native.focusNode),
      nativeInside: !!native?.anchorNode && !!native?.focusNode
        && !!surface?.contains(native.anchorNode) && !!surface?.contains(native.focusNode),
      nativeCollapsed: native?.isCollapsed ?? null,
      nativeDirection: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
      nativeAnchor: anchor,
      nativeFocus: focus,
      selectionTextLength: native && !native.isCollapsed ? native.toString().length : 0
    };
  });
}

async function readShortStageFinalPreviewCertificate(page, expectedSource) {
  return page.evaluate((sourceValue) => {
    const source = document.querySelector('#easymde-source');
    const sinks = [...document.querySelectorAll('[data-easymde-preview-html-sink="1"]')];
    const sink = sinks.length === 1 ? sinks[0] : null;
    const blocks = sink ? [...sink.querySelectorAll('p, h1, pre')] : [];
    const paragraphs = blocks.filter((block) => block.tagName === 'P');
    const headings = blocks.filter((block) => block.tagName === 'H1');
    const pres = blocks.filter((block) => block.tagName === 'PRE');
    const codeNodes = pres.length === 1 ? [...pres[0].querySelectorAll('code')] : [];
    const codeText = codeNodes.length === 1 ? codeNodes[0].textContent : null;
    return {
      sourceExact: source instanceof HTMLTextAreaElement ? source.value === sourceValue : false,
      sinkCount: sinks.length,
      sinkConnected: !!sink?.isConnected,
      blockOrderExact: blocks.map((block) => block.tagName).join(',') === 'P,H1,P,PRE,P',
      paragraphCount: paragraphs.length,
      paragraphTextExact: paragraphs.length === 3
        && paragraphs[0].textContent === '中文 abc aaa *文字*'
        && paragraphs[1].textContent === 'Target paragraph here.'
        && paragraphs[2].textContent === 'End.',
      headingCount: headings.length,
      headingTextExact: headings.length === 1 && headings[0].textContent === 'Heading',
      preCount: pres.length,
      codeCount: codeNodes.length,
      codeTextExact: codeText === 'echo hi' || codeText === 'echo hi\n',
      phaseReady: sink?.getAttribute('data-easymde-preview-phase') === 'ready',
      acceptedOne: sink?.getAttribute('data-easymde-preview-accepted') === '1',
      busyFalse: sink?.getAttribute('aria-busy') === 'false',
      previewErrorAbsent: !!sink && !sink.hasAttribute('data-easymde-preview-error'),
      refreshingAbsent: !!sink && !sink.hasAttribute('data-easymde-preview-refreshing'),
      globalFailureAbsent: !document.querySelector('[data-easymde-visual-failure]')
    };
  }, expectedSource);
}

async function readFullCrossBlockState(visual, expected = {}) {
  return visual.evaluate((surface, target) => {
    const source = surface.ownerDocument.querySelector('#easymde-source');
    const native = surface.ownerDocument.getSelection();
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const path = (node) => {
      const result = [];
      for (let currentNode = node; currentNode && currentNode !== surface;) {
        const parent = currentNode.parentNode;
        if (!parent) return null;
        const index = [...parent.childNodes]
          .filter((child) => child === currentNode || !(child instanceof Text && child.data === ''))
          .indexOf(currentNode);
        if (index < 0) return null;
        result.unshift(index);
        currentNode = parent;
        if (currentNode === surface) return result;
      }
      return node === surface ? [] : null;
    };
    const backward = !!native && !native.isCollapsed && !!range
      && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
    const rows = [...surface.querySelectorAll(':scope > p')];
    const first = rows.find((row) => row.textContent?.startsWith('alpha'));
    const last = target.selected ? rows.find((row) => row.textContent?.startsWith('Yz')) : first;
    const endpoint = (node, offset, row, textOffset) => {
      if (!row?.contains(node) || !node?.isConnected) return false;
      const prefix = surface.ownerDocument.createRange();
      prefix.selectNodeContents(row);
      prefix.setEnd(node, offset);
      return prefix.toString().length === textOffset;
    };
    const reverse = target.selected && target.direction === 'backward';
    const listItems = target.list ? [...surface.querySelectorAll('li')] : [];
    const listElement = native?.anchorNode instanceof Element ? native.anchorNode : native?.anchorNode?.parentElement;
    const listItem = target.list ? listElement?.closest('li') : null;
    let listBodyOffset = null;
    if (listItem && surface.contains(listItem) && native?.anchorNode) {
      const prefix = surface.ownerDocument.createRange();
      prefix.selectNodeContents(listItem);
      prefix.setEnd(native.anchorNode, native.anchorOffset);
      listBodyOffset = prefix.toString().length;
    }
    const inlineCodePoint = (node, offset) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const code = element?.closest('code');
      if (!code || code.closest('pre') || !surface.contains(code) || !node?.isConnected) return null;
      const prefix = surface.ownerDocument.createRange();
      prefix.selectNodeContents(code);
      prefix.setEnd(node, offset);
      const codes = [...surface.querySelectorAll('code')].filter((candidate) => !candidate.closest('pre'));
      return { bodyOffset: prefix.toString().length, bodyLength: code.textContent.length, codeIndex: codes.indexOf(code) };
    };
    const phase = surface.getAttribute('data-easymde-preview-phase');
    const sourceValue = source instanceof HTMLTextAreaElement ? source.value : null;
    return {
      phase,
      sourceLength: sourceValue?.length ?? null,
      ...(target.expectedSource === undefined ? {} : { sourceMatchesExpected: sourceValue === target.expectedSource }),
      editable: surface.isContentEditable,
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable'),
      focused: surface.ownerDocument.activeElement === surface,
      nativeConnected: !!native?.anchorNode?.isConnected && !!native.focusNode?.isConnected
        && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
      nativeEndpoints: {
        anchor: { path: path(native?.anchorNode), offset: native?.anchorOffset ?? null,
          nodeType: native?.anchorNode?.nodeType ?? null, tag: native?.anchorNode?.parentElement?.tagName ?? null },
        focus: { path: path(native?.focusNode), offset: native?.focusOffset ?? null,
          nodeType: native?.focusNode?.nodeType ?? null, tag: native?.focusNode?.parentElement?.tagName ?? null }
      },
      ...(target.paragraph ? { nativeParagraph: (() => {
        const element = native?.anchorNode instanceof Element ? native.anchorNode : native?.anchorNode?.parentElement;
        const paragraph = element?.closest('p');
        if (!paragraph || !surface.contains(paragraph) || !native?.anchorNode) return null;
        const prefix = surface.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        return { index: [...surface.querySelectorAll('p')].indexOf(paragraph),
          bodyOffset: prefix.toString().length, bodyLength: paragraph.textContent.length };
      })() } : {}),
      ...(target.inlineCode ? { nativeInlineCode: {
        anchor: inlineCodePoint(native?.anchorNode, native?.anchorOffset),
        focus: inlineCodePoint(native?.focusNode, native?.focusOffset)
      } } : {}),
      ...(target.list ? { nativeList: {
        itemCount: listItems.length, itemIndex: listItem ? listItems.indexOf(listItem) : null,
        bodyOffset: listBodyOffset, itemChildCount: listItem?.childNodes.length ?? null,
        itemChildren: listItem ? [...listItem.childNodes].map((node) => ({ nodeType: node.nodeType,
          tag: node instanceof Element ? node.tagName : null, textLength: node instanceof Text ? node.length : null })) : []
      } } : {}),
      anchorMatches: endpoint(native?.anchorNode, native?.anchorOffset ?? -1, reverse ? last : first,
        reverse ? 1 : target.offset),
      focusMatches: endpoint(native?.focusNode, native?.focusOffset ?? -1, reverse ? first : last,
        target.selected ? reverse ? target.offset : 1 : target.offset),
      direction: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
      collapsed: native?.isCollapsed ?? null,
      lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
      session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
      previewPhase: phase, busy: surface.getAttribute('aria-busy'),
      failure: surface.ownerDocument.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null,
      spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length
    };
  }, expected);
}

async function readWindowedSmokeState(visual, target = {}) {
  return visual.evaluate((surface, expected) => {
    const source = surface.ownerDocument.querySelector('#easymde-source');
    const native = surface.ownerDocument.getSelection();
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const backward = !!native && !native.isCollapsed && !!range
      && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
    const point = (node, offset, selector, index) => {
      const target = selector ? surface.querySelectorAll(selector)[index ?? 0] : null;
      const code = expected.codeBoundary ? surface.querySelector('p code') : null;
      const previous = code?.previousSibling;
      let codeBodyOffset = null;
      if (node && code?.contains(node)) {
        const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(code); prefix.setEnd(node, offset);
        codeBodyOffset = prefix.toString().length;
      }
      let bodyOffset = null;
      if (node && target?.contains(node)) {
        const prefix = surface.ownerDocument.createRange(); prefix.selectNodeContents(target); prefix.setEnd(node, offset);
        bodyOffset = prefix.toString().length;
      }
      return { connected: !!node?.isConnected, inside: !!node && surface.contains(node), nodeType: node?.nodeType ?? null,
        parentTag: node?.parentElement?.tagName ?? null, offset, targetContains: !!node && !!target?.contains(node),
        targetTag: target?.tagName ?? null, bodyOffset, bodyLength: target?.textContent.length ?? null,
        ...(expected.codeBoundary ? { inlineCode: { codePresent: !!code?.isConnected,
          insideCode: !!node && !!code?.contains(node), codeBodyOffset,
          sameOriginalCodeText: expected.originalCodeText ? node === expected.originalCodeText : null,
          isBeforeCodeText: node instanceof Text && node === previous,
          beforeCodeTextOffset: node === previous ? offset : null } } : {}) };
    };
    const phase = surface.getAttribute('data-easymde-preview-phase');
    const busy = surface.getAttribute('aria-busy');
    const sourceValue = source instanceof HTMLTextAreaElement ? source.value : null;
    return { phase,
      previewLoading: phase === 'loading' || busy === 'true',
      runtimeEditable: surface.isContentEditable, documentEditable: surface.isContentEditable,
      ...(expected.expectedSource === undefined ? {} : { sourceMatchesExpected: sourceValue === expected.expectedSource }),
      sourceLength: sourceValue?.length ?? null,
      spacers: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
      effectiveEditable: surface.isContentEditable, contenteditable: surface.getAttribute('contenteditable'),
      lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
      session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
      focused: surface.ownerDocument.activeElement === surface,
      nativeCollapsed: native?.isCollapsed ?? null,
      nativeDirection: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
      nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? 0, expected.selector, expected.index),
      nativeFocus: point(native?.focusNode, native?.focusOffset ?? 0, expected.focusSelector ?? expected.selector, expected.focusIndex ?? expected.index)
    };
  }, target);
}

async function expectWindowedSmokeCheckpoint(visual, failures, stage, target, nativeOffset, direction = 'none') {
  const state = await readWindowedSmokeState(visual, target);
  console.log(JSON.stringify({ phase: 'windowed-smoke-first-atom', stage,
    state: { sourceLength: state.sourceLength, phase: state.phase, nativeCollapsed: state.nativeCollapsed,
      nativeDirection: state.nativeDirection } }));
  expect(failures).toEqual([]);
  expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
    contenteditable: 'true', lock: 'false', session: 'ready', focused: true,
    nativeAnchor: { connected: true, inside: true }, nativeFocus: { connected: true, inside: true } });
  expect(state.spacers).toBeGreaterThan(0);
  if (target.expectedSource !== undefined) expect(state.sourceMatchesExpected).toBe(true);
  if (!state.previewLoading) {
    expect(state).toMatchObject({ nativeDirection: direction, nativeCollapsed: direction === 'none',
      nativeAnchor: { targetContains: true, bodyOffset: nativeOffset },
      nativeFocus: { targetContains: true, bodyOffset: target.focusOffset ?? nativeOffset } });
  }
  return state;
}

async function holdFormalPreview(page) {
  const entries = [];
  const errors = [];
  let releasing = false;
  const aborted = (entry) => entry.request.failure()?.errorText === 'net::ERR_ABORTED';
  const onFailure = (request) => {
    const entry = entries.find((candidate) => candidate.request === request);
    if (entry && aborted(entry)) {
      browserMonitors.get(page)?.expectPreviewCancellation(request, 'supersede');
      entry.release();
    }
  };
  page.on('requestfailed', onFailure);
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (releasing) return route.continue();
    if (entries.length >= 8) {
      errors.push('held-history-preview-bound-exceeded');
      return route.abort('aborted');
    }
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const entry = { request: route.request(), markdown: route.request().postDataJSON().markdown, fetched: false, release };
    entries.push(entry);
    try {
      const response = await route.fetch({ timeout: 10_000, maxRetries: 0, maxRedirects: 0 });
      if (response.status() !== 200) throw new Error('held-history-php-preview-failed');
      entry.fetched = true;
      await gate;
      if (aborted(entry)) await route.abort('aborted');
      else await route.fulfill({ response });
    } catch {
      if (!aborted(entry)) errors.push('held-history-preview-handler-failed');
      try { await route.abort('aborted'); }
      catch { if (!aborted(entry)) errors.push('held-history-preview-abort-failed'); }
    }
  });
  return {
    waitFor: async (markdown) => expect.poll(() => entries.some((entry) => entry.fetched
      && !aborted(entry) && entry.markdown === markdown), {
      timeout: 12_000, message: 'The real current PHP response must remain withheld'
    }).toBe(true),
    close: async () => {
      releasing = true;
      for (const entry of entries) entry.release();
      await page.unrouteAll({ behavior: 'wait' });
      page.off('requestfailed', onFailure);
      expect(errors).toEqual([]);
    }
  };
}

async function expectNativeTail(row, expected) {
  const state = await row.evaluate((element, tailText) => {
    const tail = element.lastChild;
    const selection = element.ownerDocument.getSelection();
    let atEnd = false;
    if (tail instanceof Text && selection?.isCollapsed && selection.anchorNode
      && element.contains(selection.anchorNode)) {
      const end = element.ownerDocument.createRange();
      end.setStart(tail, tail.length);
      end.collapse(true);
      const caret = element.ownerDocument.createRange();
      caret.setStart(selection.anchorNode, selection.anchorOffset);
      caret.collapse(true);
      const corridor = element.ownerDocument.createRange();
      const first = end.compareBoundaryPoints(Range.START_TO_START, caret) <= 0 ? end : caret;
      const last = first === end ? caret : end;
      corridor.setStart(first.startContainer, first.startOffset);
      corridor.setEnd(last.startContainer, last.startOffset);
      const fragment = corridor.cloneContents();
      atEnd = corridor.toString().length === 0
        && !fragment.querySelector('img,br,pre,table,svg,math,[contenteditable="false"]');
    }
    return { tailMatches: tail instanceof Text && tail.data === tailText, atEnd,
      collapsed: selection?.isCollapsed ?? false,
      focused: element.ownerDocument.activeElement?.contains(element) ?? false };
  }, expected);
  expect(state, 'Visible text and the native caret must follow each completed deletion').toEqual({
    tailMatches: true, atEnd: true, collapsed: true, focused: true
  });
}

async function captureOwnedPost(page) {
  const capture = await page.evaluate(() => {
    const values = [...new Set(
      [...document.querySelectorAll('#post_ID, input[name="post_ID"]')]
        .map((input) => input instanceof HTMLInputElement ? input.value.trim() : null)
        .filter((value) => value !== null)
    )];
    if (values.length === 0) {
      return {
        status: 'unidentified', code: 'basic-owned-post-id-missing',
        beforeFixture: true, route: 'new-post'
      };
    }
    if (values.length !== 1 || !/^[1-9][0-9]*$/u.test(values[0])) {
      return {
        status: 'unidentified', code: 'basic-owned-post-id-ambiguous',
        beforeFixture: true, route: 'new-post'
      };
    }
    const postId = Number(values[0]);
    if (!Number.isSafeInteger(postId) || String(postId) !== values[0]) {
      return {
        status: 'unidentified', code: 'basic-owned-post-id-unsafe',
        beforeFixture: true, route: 'new-post'
      };
    }
    return { status: 'identified', postId, beforeFixture: true, route: 'new-post' };
  });
  ownedPostCapture = capture;
  test.info().annotations.push({
    type: OWNED_POST_ANNOTATION,
    description: JSON.stringify(capture)
  });
  if (capture.status !== 'identified') throw new Error(capture.code);
  return capture;
}

async function readBeforeFixturePreparation(page) {
  const capture = ownedPostCapture;
  if (!capture || capture.status !== 'identified'
    || !Number.isSafeInteger(capture.postId) || capture.postId <= 0) {
    throw new Error('basic-before-fixture-owned-post-invalid');
  }
  const state = await page.evaluate((expectedPostId) => {
    const readField = (selector) => {
      const fields = [...document.querySelectorAll(selector)];
      const field = fields.length === 1 ? fields[0] : null;
      return {
        unique: fields.length === 1,
        value: field instanceof HTMLInputElement
          || field instanceof HTMLTextAreaElement
          || field instanceof HTMLSelectElement
          ? field.value
          : null
      };
    };
    const postValues = [...new Set([...document.querySelectorAll('#post_ID, input[name="post_ID"]')]
      .map((field) => field instanceof HTMLInputElement ? field.value.trim() : null)
      .filter((value) => value !== null))];
    const markdownTheme = readField('#easymde-markdown-theme-field');
    const codeTheme = readField('#easymde-code-theme-field');
    const customCssId = readField('#easymde-custom-css-id-field');
    return {
      postMatches: postValues.length === 1 && postValues[0] === String(expectedPostId),
      fieldsPresent: markdownTheme.value !== null && codeTheme.value !== null && customCssId.value !== null,
      fieldsUnique: markdownTheme.unique && codeTheme.unique && customCssId.unique,
      renderParams: {
        markdown_theme: markdownTheme.value,
        code_theme: codeTheme.value,
        custom_css_id: customCssId.value
      }
    };
  }, capture.postId);
  if (!state.postMatches || !state.fieldsPresent || !state.fieldsUnique
    || Object.values(state.renderParams).some((value) => typeof value !== 'string')) {
    throw new Error('basic-before-fixture-render-params-invalid');
  }
  return { postId: capture.postId, renderParams: state.renderParams };
}

function createPhasedPreviewOperationTracker(phases) {
  let operationId = null;
  let browserMonitor = null;
  return {
    beforeFixture: ({ browserMonitor: monitor, postId, renderParams }) => {
      browserMonitor = monitor;
      operationId = monitor.beginPhased({ postId, renderParams, phases });
      expect(Number.isSafeInteger(operationId)).toBe(true);
    },
    enterPhase(phaseId) {
      if (browserMonitor && operationId !== null) {
        browserMonitor.enterPhase(operationId, phaseId);
      }
    },
    async prove({ visual = null, locked = false, drainTimeoutMs = 8_000, quietMs = 450 } = {}) {
      if (!browserMonitor || operationId === null) {
        throw new Error('preview-read-operation-tracker-not-started');
      }
      if (visual && !locked) {
        await expect(visual).not.toHaveAttribute('aria-busy', 'true');
      }
      const drained = await browserMonitor.drain({ timeoutMs: drainTimeoutMs, quietMs });
      expect(drained, 'final Preview drain must settle before read-operation proof').toBe(true);
      const proof = browserMonitor.provePreviewReadOperation(operationId, { finalUiVerified: true });
      expect(proof.approved, `declared Preview read operation must prove recoverable cancellation (${proof.code})`).toBe(true);
      expect(proof.code).toBe('preview-read-operation-approved');
      return proof;
    }
  };
}

const safeLoginErrorNames = new Set([
  'AggregateError',
  'AssertionError',
  'DOMException',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError'
]);

function safeCaughtLoginErrorType(error) {
  try {
    if (error instanceof Error) {
      return safeLoginErrorNames.has(error.name) ? error.name : 'Error';
    }
  } catch {}
  return typeof error;
}

function createSafeLoginStageError(failureCode, caughtError) {
  const safeCauseType = safeCaughtLoginErrorType(caughtError);
  const error = new Error(`${failureCode} (${safeCauseType})`);
  error.name = 'WordPressLoginStageError';
  error.code = failureCode;
  error.safeCauseType = safeCauseType;
  return error;
}

function createSafeLoginAggregateError(stageError, caughtCleanupError) {
  const cleanupError = createSafeLoginStageError(
    'wordpress-login-failure-state-cleanup-failed',
    caughtCleanupError
  );
  const error = new AggregateError(
    [stageError, cleanupError],
    'wordpress-login-failure-state-aggregate-failed'
  );
  error.code = 'wordpress-login-failure-state-aggregate-failed';
  return error;
}

async function loginRedirectDestination(page) {
  const destination = await page.evaluate(() => {
    const redirect = document.querySelector('#loginform input[name="redirect_to"]');
    return redirect instanceof HTMLInputElement ? redirect.value : null;
  });
  if (!destination) throw new Error('wordpress-login-redirect-target-unavailable');
  return destination;
}

async function waitForLoginFocusQuiescence(page) {
  const focusSettled = await page.evaluate(() => new Promise((resolve) => {
    const quietPeriodMs = 250;
    const timeoutMs = 2_000;
    let quietTimer;
    let timeoutTimer;

    const cleanup = () => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(timeoutTimer);
      document.removeEventListener('focusin', observeFocus, true);
    };
    const finish = (settled) => {
      cleanup();
      resolve(settled);
    };
    const observeFocus = () => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => finish(true), quietPeriodMs);
    };

    document.addEventListener('focusin', observeFocus, true);
    quietTimer = window.setTimeout(() => finish(true), quietPeriodMs);
    timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);
  }));
  if (!focusSettled) throw new Error('wordpress-login-focus-did-not-settle');
}

async function loginWordPressAdmin(page, browserMonitor) {
  let failureCode = 'wordpress-login-page-unavailable';
  try {
    browserMonitor.expectNavigation('/wp-login.php', 'open-login');
    await browserMonitor.flushHistory();
    await browserMonitor.flushRejections();
    await page.goto('/wp-login.php');
    failureCode = 'wordpress-login-focus-did-not-settle';
    await waitForLoginFocusQuiescence(page);
    failureCode = 'wordpress-login-credential-entry-failed';
    await page.locator('#user_login').fill(environment('WORDPRESS_ADMIN_USER'));
    failureCode = 'wordpress-login-state-monitor-unavailable';
    const usernameMonitorInstalled = await page.evaluate(() => {
      const username = document.querySelector('#user_login');
      if (!(username instanceof HTMLInputElement)) return false;

      const initialValue = username.value;
      let usernameChangedAfterFill = false;
      const inputListener = () => {
        if (username.value !== initialValue) usernameChangedAfterFill = true;
      };
      username.addEventListener('input', inputListener);
      window.__easymdeLoginEntryState = {
        isUsernameUnchanged: () => (
          !usernameChangedAfterFill
          && username.value === initialValue
          && document.querySelector('#user_login') === username
        ),
        cleanup: () => username.removeEventListener('input', inputListener)
      };
      return true;
    });
    if (!usernameMonitorInstalled) throw new Error('wordpress-login-state-monitor-unavailable');

    failureCode = 'wordpress-login-credential-entry-failed';
    const password = page.locator('#user_pass');
    await password.focus();
    await page.keyboard.type(environment('WORDPRESS_ADMIN_PASSWORD'));
    failureCode = 'wordpress-login-pre-submit-state-invalid';
    const loginStateIsValid = await page.evaluate(() => {
      const username = document.querySelector('#user_login');
      const passwordField = document.querySelector('#user_pass');
      const state = window.__easymdeLoginEntryState;
      try {
        return username instanceof HTMLInputElement
          && passwordField instanceof HTMLInputElement
          && state?.isUsernameUnchanged() === true
          && username.value.length > 0
          && passwordField.value.length > 0
          && document.activeElement === passwordField;
      } finally {
        try {
          state?.cleanup();
        } finally {
          delete window.__easymdeLoginEntryState;
        }
      }
    });
    if (!loginStateIsValid) throw new Error(failureCode);

    failureCode = 'wordpress-login-submit-failed';
    browserMonitor.expectNavigation(await loginRedirectDestination(page), 'login-submit');
    await browserMonitor.flushHistory();
    await browserMonitor.flushRejections();
    const submitRequested = await page.evaluate(() => {
      const form = document.querySelector('#loginform');
      const submit = document.querySelector('#wp-submit');
      if (!(form instanceof HTMLFormElement)
        || !(submit instanceof HTMLInputElement || submit instanceof HTMLButtonElement)) {
        return false;
      }
      form.requestSubmit(submit);
      return true;
    });
    if (!submitRequested) throw new Error(failureCode);

    failureCode = 'wordpress-login-session-not-established';
    await expect(page.locator('#wpadminbar')).toBeVisible();
  } catch (caughtOperationError) {
    const stageError = createSafeLoginStageError(failureCode, caughtOperationError);
    try {
      await page.evaluate(() => {
        const username = document.querySelector('#user_login');
        const password = document.querySelector('#user_pass');
        if (username instanceof HTMLInputElement) username.value = '';
        if (password instanceof HTMLInputElement) password.value = '';
        const state = window.__easymdeLoginEntryState;
        try {
          state?.cleanup();
        } finally {
          delete window.__easymdeLoginEntryState;
        }
      });
    } catch (caughtCleanupError) {
      throw createSafeLoginAggregateError(stageError, caughtCleanupError);
    }
    throw stageError;
  }
}

async function waitForBasicDashboardSetupReadiness(page, browserMonitor) {
  let drainCompleted = false;
  let issues = null;
  try {
    await page.waitForLoadState('load', { timeout: 8_000 });
    drainCompleted = await browserMonitor.drain({ timeoutMs: 8_000, quietMs: 300 });
    issues = browserMonitor.summary().issues;
  } catch {
    throw new Error('basic-dashboard-setup-not-ready');
  }
  if (drainCompleted !== true || !Array.isArray(issues) || issues.length > 0) {
    throw new Error('basic-dashboard-setup-not-ready');
  }
}

async function openVisual(page, markdown, pasteFrom, beforeFixture) {
  const failures = [];
  const browserMonitor = await installBrowserMonitor(page);
  const rejectionBridges = new Set();
  const recordFirstFailure = (code) => {
    if (firstRuntimeFailureObservations.has(page)) return;
    // Observe only the first runtime failure. This is the first Playwright
    // observation after the event, not a claim about an earlier DOM state.
    const observation = (async () => {
      const surface = await page.$('[data-easymde-preview-html-sink][role="textbox"]');
      if (!surface) throw new Error('test-first-refusal-surface-unavailable');
      try {
        const windowed = await surface.evaluate(node => !!node.querySelector('[data-easymde-preview-window-spacer]'));
        return windowed ? await readWindowedSmokeState(surface) : await readFullCrossBlockState(surface);
      }
      finally { await surface.dispose(); }
    })()
      .then(state => ({ phase: 'first-refusal-observation', code, state }))
      .catch(() => ({ phase: 'first-refusal-observation-unavailable', code }));
    firstRuntimeFailureObservations.set(page, observation);
  };
  await installMonitorRejectionBridge(page, browserMonitor, () => {
    recordFirstFailure('browser-unhandled-rejection');
    failures.push('browser-unhandled-rejection');
  });
  await page.addInitScript(() => {
    const states = [];
    window.__easymdeTestEditabilityStates = states;
    let previous = '';
    const sample = () => {
      const preview = document.querySelector('.easymde-pane-preview');
      if (!preview) return;
      const state = {
        editableSurfaces: preview.querySelectorAll('[contenteditable="true"]').length,
        locked: preview.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        failure: preview.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null
      };
      const identity = JSON.stringify(state);
      if (identity === previous) return;
      previous = identity;
      if (states.length === 256) states.shift();
      states.push({ ...state, elapsedMs: Math.round(performance.now()) });
    };
    const observer = new MutationObserver(sample);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'aria-pressed', 'data-easymde-visual-failure']
    });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  });
  await loginWordPressAdmin(page, browserMonitor);
  await waitForBasicDashboardSetupReadiness(page, browserMonitor);
  browserMonitor.expectNavigation('/wp-admin/post-new.php', 'open-new-post');
  await browserMonitor.flushHistory();
  await browserMonitor.flushRejections();
  await page.goto('/wp-admin/post-new.php');
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  await expect(sourceEditor).toBeVisible();
  await captureOwnedPost(page);
  const runtimeBuilds = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname.split('/').at(-1))
    .filter((name) => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
  await test.info().attach('loaded-editor-build', { body: JSON.stringify(runtimeBuilds), contentType: 'application/json' });
  console.log(JSON.stringify({ phase: 'loaded-editor-build', files: runtimeBuilds }));
  const expectedBuild = process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD;
  if (expectedBuild) expect(runtimeBuilds, 'The browser must load the frozen production build').toEqual([expectedBuild]);
  const fixturePreparation = beforeFixture ? await readBeforeFixturePreparation(page) : null;
  if (beforeFixture) await beforeFixture({ ...fixturePreparation, browserMonitor });
  await browserMonitor.assertInputReady();
  await sourceEditor.click();
  // Fixture preparation only. All subsequent edits use keyboard/mouse actions.
  if (pasteFrom === undefined) {
    await page.keyboard.insertText(markdown);
  } else {
    // Fixture preparation only, through the real paste route. Prefer the
    // Clipboard API when the origin is secure. Under an insecure origin that API
    // is unavailable, so dispatch a paste event carrying the original CRLF text;
    // this still exercises the editor's paste path and its CRLF-to-LF contract.
    // The insecure-origin stub installed above makes navigator.clipboard exist,
    // but Control+V reads the OS clipboard, not that stub, so the API route is
    // gated on window.isSecureContext rather than on the stub's presence.
    const usedClipboardApi = await page.evaluate(async (text) => {
      if (window.isSecureContext && typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true
      }));
      return false;
    }, pasteFrom);
    if (usedClipboardApi) await page.keyboard.press('Control+v');
  }
  const source = page.locator('#easymde-source');
  await expectSource(source, markdown);
  const strings = await page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.strings.immersive
  );
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible();
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();
  const visual = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  return { failures, source, visual, browserMonitor };
}

async function readSettledSource(source, stableReads = 6) {
  let value = await source.inputValue();
  let stable = 0;
  for (let attempt = 0; attempt < 200 && stable < stableReads; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await source.inputValue();
    if (next === value) {
      stable += 1;
    } else {
      value = next;
      stable = 0;
    }
  }
  if (stable < stableReads) throw new Error('canonical-source-did-not-settle');
  return value;
}

function isSubsequence(candidate, source) {
  let index = 0;
  for (const character of source) {
    if (character === candidate[index]) index += 1;
    if (index === candidate.length) return true;
  }
  return index === candidate.length;
}

async function expectLiveSelection(visual) {
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  expect(await visual.evaluate((surface) => {
    const selection = surface.ownerDocument.getSelection();
    return !!selection?.anchorNode?.isConnected
      && !!selection.focusNode?.isConnected
      && surface.contains(selection.anchorNode)
      && surface.contains(selection.focusNode);
  })).toBe(true);
}

async function expectCaretAfterImage(visual, alt, ordinal = 0) {
  const state = await visual.evaluate((surface, target) => {
    const image = Array.from(surface.querySelectorAll('img')).filter((candidate) => candidate.alt === target.alt)[target.ordinal];
    const native = surface.ownerDocument.getSelection();
    const root = (node) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element && element.parentElement !== surface) element = element.parentElement;
      return element;
    };
    const sameRow = !!image && root(image) === root(native?.anchorNode);
    let afterImage = false;
    if (image?.parentNode && native?.anchorNode && sameRow) {
      const edge = surface.ownerDocument.createRange();
      edge.setStart(image.parentNode, Array.from(image.parentNode.childNodes).indexOf(image) + 1);
      edge.collapse(true);
      const point = surface.ownerDocument.createRange();
      point.setStart(native.anchorNode, native.anchorOffset);
      point.collapse(true);
      const corridor = surface.ownerDocument.createRange();
      if (edge.compareBoundaryPoints(Range.START_TO_START, point) <= 0) {
        corridor.setStart(edge.startContainer, edge.startOffset);
        corridor.setEnd(point.startContainer, point.startOffset);
      } else {
        corridor.setStart(point.startContainer, point.startOffset);
        corridor.setEnd(edge.startContainer, edge.startOffset);
      }
      const fragment = corridor.cloneContents();
      afterImage = corridor.toString().length === 0
        && !fragment.querySelector('img,br,hr,pre,table,svg,math,[contenteditable="false"]');
    }
    return {
      imageMounted: !!image?.isConnected,
      sameRow,
      afterImage,
      nativeVoid: native?.anchorNode instanceof HTMLImageElement,
      collapsed: native?.isCollapsed ?? false,
      focused: surface.ownerDocument.activeElement === surface
    };
  }, { alt, ordinal });
  expect(state, 'native caret must remain at the canonical image-row end while Preview is pending').toEqual({
    imageMounted: true, sameRow: true, afterImage: true,
    nativeVoid: false, collapsed: true, focused: true
  });
}

const shortStageBlocks = [
  { kind: 'paragraph', source: '中文 abc aaa \\*文字\\*', body: [...'中文 abc aaa ', '\\*', '文', '字', '\\*'] },
  { kind: 'heading', source: '# Heading', body: [...'Heading'] },
  { kind: 'paragraph', source: 'Target paragraph here.', body: [...'Target paragraph here.'] },
  { kind: 'code', source: '~~~bash\necho hi\n~~~', body: [...'echo hi'] },
  { kind: 'paragraph', source: 'End.', body: [...'End.'] }
];
const shortStageInitial = shortStageBlocks.map((block) => block.source).join('\n\n');

function shortStageUniqueCodeDeclarations(declarations) {
  const grouped = new Map();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.source !== 'string'
      || !declaration.descriptor || typeof declaration.descriptor !== 'object') continue;
    if (!grouped.has(declaration.source)) grouped.set(declaration.source, []);
    grouped.get(declaration.source).push(declaration.descriptor);
  }
  const unique = new Map();
  for (const [source, descriptors] of grouped) {
    const distinct = new Map(descriptors.map((descriptor) => [JSON.stringify(descriptor), descriptor]));
    if (distinct.size === 1) unique.set(source, distinct.values().next().value);
  }
  return unique;
}

function shortStageBuildCodeDescriptors(blocks) {
  const declarations = [];
  let codeOrdinal = 0;
  for (let codeBlockOrdinal = 0; codeBlockOrdinal < blocks.length; codeBlockOrdinal += 1) {
    const codeBlock = blocks[codeBlockOrdinal];
    if (codeBlock.kind !== 'code') continue;
    const openingEnd = codeBlock.source.indexOf('\n');
    const closingStart = codeBlock.source.lastIndexOf('\n');
    if (openingEnd < 0 || closingStart <= openingEnd) {
      throw new Error('short-stage-code-declaration-invalid');
    }
    const opening = codeBlock.source.slice(0, openingEnd + 1);
    const closing = codeBlock.source.slice(closingStart + 1);
    const codePrefix = blocks.slice(0, codeBlockOrdinal).map((item) => item.source).join('\n\n')
      + (codeBlockOrdinal ? '\n\n' : '');
    const descriptorForBody = (body) => {
      const bodyStart = codePrefix.length + opening.length;
      const bodyEnd = bodyStart + body.length;
      const sourceBlockEnd = bodyEnd + 1 + closing.length;
      return Object.freeze({
        blockOrdinal: codeBlockOrdinal, codeOrdinal, body, bodyStart, bodyEnd,
        closingFenceLfStart: bodyEnd, closingFenceLfEnd: bodyEnd + 1,
        sourceBlockStart: codePrefix.length, sourceBlockEnd
      });
    };
    const fullDescriptor = descriptorForBody(codeBlock.body.join(''));
    for (let cursorOrdinal = codeBlockOrdinal; cursorOrdinal < blocks.length; cursorOrdinal += 1) {
      const cursorBlock = blocks[cursorOrdinal];
      const cursorPrefix = blocks.slice(0, cursorOrdinal).map((item) => item.source).join('\n\n')
        + (cursorOrdinal ? '\n\n' : '');
      const cursorOpeningEnd = cursorBlock.source.indexOf('\n');
      const cursorClosingStart = cursorBlock.source.lastIndexOf('\n');
      const cursorOpening = cursorOpeningEnd < 0 ? null : cursorBlock.source.slice(0, cursorOpeningEnd + 1);
      const cursorClosing = cursorClosingStart < 0 ? null : cursorBlock.source.slice(cursorClosingStart + 1);
      for (let remaining = cursorBlock.body.length; remaining >= 0; remaining -= 1) {
        const body = cursorBlock.body.slice(0, remaining).join('');
        const sourceBlock = cursorBlock.kind === 'code' ? `${cursorOpening}${body}\n${cursorClosing}`
          : cursorBlock.kind === 'heading' ? `# ${body}` : body;
        const descriptor = cursorOrdinal === codeBlockOrdinal ? descriptorForBody(body) : fullDescriptor;
        for (const ending of ['', '\n', '\n\n']) {
          declarations.push({ source: cursorPrefix + sourceBlock + ending, descriptor });
        }
      }
      const descriptor = cursorOrdinal === codeBlockOrdinal ? descriptorForBody('') : fullDescriptor;
      for (const empty of ['', ' ', '  ', '\n', '\n\n']) {
        declarations.push({ source: cursorPrefix + empty, descriptor });
      }
    }
    codeOrdinal += 1;
  }
  return shortStageUniqueCodeDeclarations(declarations);
}

const shortStageDeclaredCodeDescriptors = shortStageBuildCodeDescriptors(shortStageBlocks);

function createShortStageCodeCertifier() {
  return function certifyShortStageCode(evidence) {
    if (evidence?.codeCandidate !== true) return null;
    const safeInt = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
      ? value : null;
    const hashText = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const source = typeof evidence.source === 'string' ? evidence.source : null;
    const descriptor = evidence.descriptor && typeof evidence.descriptor === 'object'
      && typeof evidence.descriptor.body === 'string' ? evidence.descriptor : null;
    const body = descriptor?.body ?? null;
    const bodyStart = safeInt(descriptor?.bodyStart);
    const bodyEnd = safeInt(descriptor?.bodyEnd);
    const blockOrdinal = safeInt(descriptor?.blockOrdinal);
    const codeOrdinal = safeInt(descriptor?.codeOrdinal);
    const sourceBlockStart = safeInt(descriptor?.sourceBlockStart);
    const sourceBlockEnd = safeInt(descriptor?.sourceBlockEnd);
    const descriptorAvailable = evidence.sourceDeclared === true && !!descriptor && body !== null
      && bodyStart !== null && bodyEnd !== null && blockOrdinal !== null && codeOrdinal !== null
      && sourceBlockStart !== null && sourceBlockEnd !== null;
    const sourceBodyExact = descriptorAvailable && source !== null
      && bodyEnd === bodyStart + body.length && sourceBlockStart <= bodyStart
      && bodyEnd <= sourceBlockEnd && sourceBlockEnd <= source.length
      && source.slice(bodyStart, bodyEnd) === body;
    const domText = typeof evidence.domText === 'string' ? evidence.domText : null;
    const domBodyVariant = sourceBodyExact && domText === body ? 'literal'
      : sourceBodyExact && domText === `${body}\n` ? 'literal+closing-lf' : null;
    const observedBlockOrdinal = safeInt(evidence.observedBlockOrdinal);
    const observedCodeOrdinal = safeInt(evidence.observedCodeOrdinal);
    const prePresent = evidence.prePresent === true;
    const preChildCount = safeInt(evidence.preChildCount);
    const preOnlyCode = preChildCount === 1 && evidence.preDirectCode === true;
    const correctBlock = descriptorAvailable && observedBlockOrdinal === blockOrdinal;
    const correctCode = descriptorAvailable && observedCodeOrdinal === codeOrdinal;
    const blockConnected = evidence.blockConnected === true;
    const preConnected = evidence.preConnected === true;
    const codeConnected = evidence.codeConnected === true;
    const blockOwnsPre = evidence.blockOwnsPre === true;
    const preInsideSurface = evidence.preInsideSurface === true;
    const codeInsidePre = evidence.codeInsidePre === true;
    const anchorPrefix = typeof evidence.anchorPrefix === 'string' ? evidence.anchorPrefix : null;
    const focusPrefix = typeof evidence.focusPrefix === 'string' ? evidence.focusPrefix : null;
    const prefixValid = (prefix) => sourceBodyExact && prefix !== null
      && prefix.length <= body.length && prefix === body.slice(0, prefix.length);
    const anchorPrefixMatch = prefixValid(anchorPrefix);
    const focusPrefixMatch = prefixValid(focusPrefix);
    const anchorCumulative = anchorPrefix === null ? null : anchorPrefix.length;
    const focusCumulative = focusPrefix === null ? null : focusPrefix.length;
    const anchorInBody = anchorPrefixMatch;
    const focusInBody = focusPrefixMatch;
    const anchorSourceOffset = anchorPrefixMatch ? bodyStart + anchorCumulative : null;
    const focusSourceOffset = focusPrefixMatch ? bodyStart + focusCumulative : null;
    const nativeCollapsed = typeof evidence.nativeCollapsed === 'boolean'
      ? evidence.nativeCollapsed : null;
    const nativeDirection = ['none', 'forward', 'backward'].includes(evidence.nativeDirection)
      ? evidence.nativeDirection : null;
    const anchorLocal = safeInt(evidence.anchorLocal);
    const focusLocal = safeInt(evidence.focusLocal);
    const structuralValid = descriptorAvailable && sourceBodyExact && domBodyVariant !== null
      && prePresent && preOnlyCode && correctBlock && correctCode && blockConnected && preConnected
      && codeConnected && blockOwnsPre && preInsideSurface && codeInsidePre;
    const selectionOrderValid = anchorPrefixMatch && focusPrefixMatch && (
      nativeCollapsed === true
        ? nativeDirection === 'none'
          && anchorCumulative === focusCumulative && anchorSourceOffset === focusSourceOffset
        : nativeCollapsed === false && (
          (nativeDirection === 'forward'
            && anchorCumulative < focusCumulative && anchorSourceOffset < focusSourceOffset)
          || (nativeDirection === 'backward'
            && anchorCumulative > focusCumulative && anchorSourceOffset > focusSourceOffset)
        )
    );
    const nativeValid = anchorLocal !== null && focusLocal !== null && selectionOrderValid;
    return {
      codeCandidate: true,
      valid: structuralValid && nativeValid,
      descriptorAvailable,
      sourceBodyExact,
      bodyHash: body === null ? null : hashText(body),
      blockOrdinal,
      codeOrdinal,
      bodyStart,
      bodyEnd,
      bodyLength: body?.length ?? null,
      domTextLength: safeInt(domText?.length),
      domBodyVariant,
      prePresent,
      preOrdinal: safeInt(evidence.preOrdinal),
      observedBlockOrdinal,
      observedCodeOrdinal,
      preOnlyCode,
      correctBlock,
      correctCode,
      blockConnected,
      preConnected,
      codeConnected,
      blockOwnsPre,
      preInsideSurface,
      codeInsidePre,
      nativeCollapsed,
      nativeDirection,
      anchorLocal,
      focusLocal,
      anchorCumulative,
      focusCumulative,
      anchorPrefixMatch,
      focusPrefixMatch,
      anchorInBody,
      focusInBody,
      anchorSourceOffset,
      focusSourceOffset
    };
  };
}

function shortStageDeletionOracle(mode) {
  const values = new Map();
  const add = (value, rank) => values.set(value, Math.max(values.get(value) ?? -1, rank));
  if (mode !== 'full') {
    for (let end = shortStageInitial.length; end >= 0; end -= 1) add(shortStageInitial.slice(0, end), end);
  } else {
    // Independently declared EOF states: preceding blocks stay byte-for-byte
    // untouched. Only the current body's literal units and its empty-row
    // representation may disappear; arbitrary subsequences are not accepted.
    for (let index = shortStageBlocks.length - 1; index >= 0; index -= 1) {
      const block = shortStageBlocks[index];
      const prefix = shortStageBlocks.slice(0, index).map((item) => item.source).join('\n\n')
        + (index ? '\n\n' : '');
      for (let remaining = block.body.length; remaining >= 0; remaining -= 1) {
        const body = block.body.slice(0, remaining).join('');
        const source = block.kind === 'code' ? `~~~bash\n${body}\n~~~`
          : block.kind === 'heading' ? `# ${body}` : body;
        for (const ending of ['', '\n', '\n\n']) add(prefix + source + ending, index * 100 + remaining);
      }
      for (const empty of ['', ' ', '  ', '\n', '\n\n']) add(prefix + empty, index * 100);
    }
  }
  add('', 0);
  return values;
}

function shortStagePhaseModel(mode) {
  const initial = shortStageInitial;
  const positions = [
    { selector: 'p', index: 0, needle: shortStageBlocks[0].source, offset: 1 },
    { selector: 'h1', index: 0, needle: 'Heading', offset: 2 },
    { selector: 'p', index: 1, needle: 'Target paragraph here.', offset: 7 },
    { selector: 'pre code', index: 0, needle: 'echo hi', offset: 2 },
    { selector: 'p', index: 2, needle: 'End.', offset: 1 }
  ].map((position, phaseIndex) => {
    const sourceOffset = initial.indexOf(position.needle) + position.offset;
    return {
      ...position,
      phaseIndex,
      sourceOffset,
      insertedSource: initial.slice(0, sourceOffset) + 'V' + initial.slice(sourceOffset)
    };
  });
  const oracle = shortStageDeletionOracle(mode);
  const sourcesByRank = new Map();
  for (const [source, rank] of oracle) {
    if (!sourcesByRank.has(rank)) sourcesByRank.set(rank, []);
    sourcesByRank.get(rank).push(source);
  }
  const descendingRanks = [...sourcesByRank.keys()].sort((left, right) => right - left);
  const ascendingRanks = [...descendingRanks].reverse();
  const deletionForwardGroups = descendingRanks.map((rank) => [...sourcesByRank.get(rank)]);
  const deletionReverseGroups = ascendingRanks.map((rank) => [...sourcesByRank.get(rank)]);
  const entered = mode === 'full' ? 'Z\n\n  ' : 'Z\n';
  const continued = mode === 'full' ? 'Z\n\nXY' : 'Z\nXY';
  const shortened = mode === 'full' ? 'Z\n\nX' : 'Z\nX';
  const branchBase = 'Z';
  const branch = 'ZB';
  const reentrySources = ['', branchBase, entered, shortened, continued, shortened];
  const positionForwardGroups = positions.flatMap((position) => [
    [position.insertedSource],
    [initial]
  ]);
  const positionReverseGroups = positions.slice().reverse().flatMap((position) => [
    [initial],
    [position.insertedSource]
  ]);
  const forwardGraphGroups = [
    [initial],
    ...positionForwardGroups,
    ...deletionForwardGroups,
    ...reentrySources.slice(1).map((source) => [source])
  ];
  const fullUndoGroups = forwardGraphGroups.slice().reverse().map((group) => [...group]);
  const fullRedoGroups = forwardGraphGroups.map((group) => [...group]);
  const branchToZGroups = [shortened, continued, shortened, entered, branchBase].map((source) => [source]);
  const restoreInitialGroups = [
    [branchBase],
    ...deletionReverseGroups,
    ...positionReverseGroups,
    [initial]
  ];
  const middleOffset = initial.indexOf('Target paragraph here.') + 1;
  const middleQSource = initial.slice(0, middleOffset) + 'Q' + initial.slice(middleOffset);
  const phaseIds = {
    fixture: 'fixture',
    positions: positions.map((position) => `position-${position.phaseIndex}`),
    deletion: 'deletion',
    emptyExtraBackspace: 'empty-extra-backspace',
    reentry: 'empty-reentry',
    fullUndo: 'full-undo',
    fullRedo: 'full-redo',
    branchToZ: 'branch-to-z',
    branchInput: 'branch-input-b',
    invalidRedo: 'invalid-redo-at-zb',
    undoBranch: 'undo-b-to-z',
    redoBranch: 'redo-b-to-zb',
    undoBranchAgain: 'undo-b-again',
    restoreInitial: 'restore-initial',
    middleQ: 'middle-q',
    middleQUndo: 'middle-q-undo'
  };
  const phases = [
    { id: phaseIds.fixture, groups: [[''], [initial]] },
    ...positions.map((position) => ({
      id: phaseIds.positions[position.phaseIndex],
      groups: [[initial], [position.insertedSource], [initial]]
    })),
    { id: phaseIds.deletion, groups: deletionForwardGroups },
    { id: phaseIds.emptyExtraBackspace, groups: [['']] },
    { id: phaseIds.reentry, groups: reentrySources.map((source) => [source]) },
    { id: phaseIds.fullUndo, groups: fullUndoGroups },
    { id: phaseIds.fullRedo, groups: fullRedoGroups },
    { id: phaseIds.branchToZ, groups: branchToZGroups },
    { id: phaseIds.branchInput, groups: [[branchBase], [branch]] },
    { id: phaseIds.invalidRedo, groups: [[branch]] },
    { id: phaseIds.undoBranch, groups: [[branch], [branchBase]] },
    { id: phaseIds.redoBranch, groups: [[branchBase], [branch]] },
    { id: phaseIds.undoBranchAgain, groups: [[branch], [branchBase]] },
    { id: phaseIds.restoreInitial, groups: restoreInitialGroups },
    { id: phaseIds.middleQ, groups: [[initial], [middleQSource]] },
    { id: phaseIds.middleQUndo, groups: [[middleQSource], [initial]] }
  ];
  const allowed = new Set(phases.flatMap((item) => item.groups.flat()));
  return {
    allowed,
    branch,
    branchBase,
    continued,
    deletionForwardGroups,
    entered,
    initial,
    middleOffset,
    middleQSource,
    oracle,
    phaseIds,
    phases,
    positions,
    reentrySources,
    shortened
  };
}

async function openShortStage(page, mode, initial, beforeFixture) {
  const opened = await openVisual(page, initial, undefined, beforeFixture);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  if (mode === 'split') await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  if (mode === 'ordinary') await page.getByRole('button', { name: strings.exit, exact: true }).click();
  const surface = mode === 'full' ? opened.visual : page.locator('.easymde-source-react .cm-content');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('contenteditable', 'true');
  if (mode === 'full') await expect(opened.visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  if (mode !== 'full') await surface.click();
  return { ...opened, surface, mode };
}

async function installBackgroundProbe(page) {
  const readCapabilities = () => page.evaluate(() => ({
    hooks: typeof window.wp?.hooks?.addAction === 'function'
      && typeof window.wp.hooks.removeAction === 'function'
      && typeof window.wp.hooks.doAction === 'function',
    jquery: typeof window.jQuery === 'function',
    heartbeatInterval: typeof window.wp?.heartbeat?.interval === 'function',
    postChanged: typeof window.wp?.autosave?.server?.postChanged === 'function',
    autosaveInterval: Number(window.autosaveL10n?.autosaveInterval) > 0
  }));
  let capabilities = await readCapabilities();
  const deadline = Date.now() + 15_000;
  while (Object.values(capabilities).some((value) => !value) && Date.now() < deadline) {
    await page.waitForTimeout(100);
    capabilities = await readCapabilities();
  }
  const missing = Object.entries(capabilities)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`background-core-api-missing:${missing.join(',')}`);
  return page.evaluate(() => {
    const readInterval = () => {
      const heartbeat = window.wp?.heartbeat;
      if (!heartbeat || 'function' !== typeof heartbeat.interval) return null;
      try {
        const value = heartbeat.interval();
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    };
    const readMinimalInterval = () => {
      const value = Number(window.heartbeatSettings?.minimalInterval);
      return Number.isFinite(value) && value > 0 && value <= 600 ? value : 0;
    };
    const readHeartbeat = () => {
      const heartbeat = window.wp?.heartbeat;
      let coreHasFocus = null, connectionError = null;
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasFocus) {
          coreHasFocus = Boolean(heartbeat.hasFocus());
        }
      } catch { /* read-only observation */ }
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasConnectionError) {
          connectionError = Boolean(heartbeat.hasConnectionError());
        }
      } catch { /* read-only observation */ }
      return {
        interval: readInterval(),
        minimalInterval: readMinimalInterval(),
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        coreHasFocus,
        connectionError
      };
    };
    const hooks = window.wp?.hooks;
    if (!hooks || 'function' !== typeof hooks.addAction
      || 'function' !== typeof hooks.removeAction) {
      throw new Error('background-hook-api-unavailable');
    }
    if (!window.jQuery) throw new Error('background-jquery-unavailable');
    const send = [], tick = [], autosave = [], autosaveAttempts = [], visibility = [], focus = [];
    let pendingSend = null, pendingAutosaveAttempt = null;
    const onSend = () => {
      const heartbeat = readHeartbeat();
      const entry = { ordinal: send.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus };
      send.push(entry);
      pendingSend = entry;
    };
    const onTick = () => {
      const at = performance.now();
      const matched = pendingSend;
      tick.push({ ordinal: tick.length + 1, at,
        durationMs: matched === null ? null : Math.max(0, at - matched.at),
        sendOrdinal: matched?.ordinal ?? null,
        sendVisibility: matched?.visibility ?? null,
        sendDocumentHasFocus: matched?.documentHasFocus ?? null,
        sendCoreHasFocus: matched?.coreHasFocus ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingSend = null;
    };
    const onBeforeAutosave = (_event, data) => {
      const heartbeat = readHeartbeat();
      let postChanged = null, contentMatchesCurrent = null;
      try { postChanged = Boolean(window.wp?.autosave?.server?.postChanged?.()); }
      catch { /* read-only observation */ }
      try {
        const source = document.querySelector('#easymde-source')?.value ?? '';
        contentMatchesCurrent = typeof data?.content === 'string'
          && data.content === source;
      } catch { /* read-only observation */ }
      const entry = { ordinal: autosaveAttempts.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus, postChanged, contentMatchesCurrent };
      autosaveAttempts.push(entry);
      pendingAutosaveAttempt = entry;
    };
    const onAfterAutosave = (_event, data) => {
      const matched = pendingAutosaveAttempt;
      autosave.push({ ordinal: autosave.length + 1, at: performance.now(),
        success: data?.success === true,
        status: document.visibilityState,
        attemptOrdinal: matched?.ordinal ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingAutosaveAttempt = null;
    };
    const onVisibility = () => {
      const heartbeat = readHeartbeat();
      visibility.push({ ordinal: visibility.length + 1, at: performance.now(),
        state: document.visibilityState, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onFocus = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'focus',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onBlur = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'blur',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    hooks.addAction('heartbeat.send', 'easymde-background-probe', onSend);
    hooks.addAction('heartbeat.tick', 'easymde-background-probe', onTick);
    window.jQuery(document).on('before-autosave.easymdeBackgroundProbe', onBeforeAutosave);
    window.jQuery(document).on('after-autosave.easymdeBackgroundProbe', onAfterAutosave);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const localDraftPolicy = () => {
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const general = bootstrap?.settings?.general;
      const drafts = bootstrap?.localDrafts;
      const interval = Number(general?.autoSaveInterval);
      const exposed = Number.isFinite(interval) && interval > 0;
      return { applicable: Boolean(general?.autoSave && drafts?.enabled && exposed),
        exposed, intervalSeconds: exposed ? interval : null };
    };
    const localDraftObservation = () => {
      const policy = localDraftPolicy();
      if (!policy.applicable) return { ...policy, storage: null };
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const drafts = bootstrap?.localDrafts;
      const field = Number(document.querySelector('#post_ID')?.value);
      const postId = Number.isSafeInteger(field) && field >= 0 ? field : Number(drafts?.postId);
      const identity = `${drafts?.siteKey}:${drafts?.userId}:${postId || 'new'}`;
      const key = `easymde:draft:v${drafts?.schemaVersion}:${identity}`;
      const source = document.querySelector('#easymde-source')?.value ?? '';
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
          return { ...policy, storage: { present: false, updatedAt: null,
            contentMatchesCurrent: false, invalid: false } };
        }
        const parsed = JSON.parse(raw);
        const content = typeof parsed?.content === 'string' ? parsed.content : null;
        const updatedAt = Number(parsed?.updatedAt);
        return { ...policy, storage: {
          present: true,
          updatedAt: Number.isInteger(updatedAt) && updatedAt > 0 ? updatedAt : null,
          contentMatchesCurrent: content !== null && content === source,
          invalid: content === null
        } };
      } catch {
        return { ...policy, storage: { present: false, updatedAt: null,
          contentMatchesCurrent: false, invalid: true } };
      }
    };
    window.__easymdeBackgroundProbe = {
      read: () => {
        const surface = document.querySelector('[data-easymde-preview-html-sink]');
        return {
          intervals: { heartbeat: readInterval(),
            autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
            localDraft: localDraftPolicy() },
          heartbeat: readHeartbeat(),
          localDraft: localDraftObservation(),
          send: [...send], tick: [...tick], autosave: [...autosave],
          autosaveAttempts: [...autosaveAttempts], visibility: [...visibility],
          focus: [...focus],
          visibilityState: document.visibilityState,
          documentHasFocus: document.hasFocus(),
          postChanged: Boolean(window.wp?.autosave?.server?.postChanged?.()),
          sessionStatus: document.querySelector('[data-easymde-session-status]')
            ?.getAttribute('data-easymde-session-status') ?? null,
          surfaceEditable: Boolean(surface?.isContentEditable),
          lockPressed: document.querySelector('.easymde-immersive-preview-lock')
            ?.getAttribute('aria-pressed') ?? null
        };
      },
      cleanup: () => {
        hooks.removeAction('heartbeat.send', 'easymde-background-probe');
        hooks.removeAction('heartbeat.tick', 'easymde-background-probe');
        window.jQuery(document).off('before-autosave.easymdeBackgroundProbe');
        window.jQuery(document).off('after-autosave.easymdeBackgroundProbe');
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        delete window.__easymdeBackgroundProbe;
      }
    };
    return { heartbeat: readHeartbeat(),
      autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
      localDraft: localDraftObservation() };
  });
}

async function startShortStageProbe(page, stage, allowedValues, {
  backgroundObservation = false,
  allowLocked = false,
  frames = null,
  codeDescriptorsBySource = null
} = {}) {
  const healthFailures = [];
  let emptySeen = false;
  const allowedList = Array.from(allowedValues);
  const certifyCodeEnabled = stage.mode === 'full' && codeDescriptorsBySource instanceof Map;
  const codeDescriptors = certifyCodeEnabled
    ? allowedList.map((source) => codeDescriptorsBySource.get(source) ?? null)
    : [];
  let codeCertifierHandle = null;
  if (certifyCodeEnabled) {
    codeCertifierHandle = await page.evaluateHandle(createShortStageCodeCertifier);
    await page.evaluate((certifier) => { window.__shortStageCertifyCode = certifier; }, codeCertifierHandle);
    await codeCertifierHandle.dispose();
    codeCertifierHandle = null;
  }
  await page.exposeFunction('__shortStageSignal', (event) => {
    if (event.kind === 'empty') emptySeen = true;
    else if (event.kind === 'shortcut') console.log(JSON.stringify({ phase: 'short-stage-first-Redo-shortcut', ...event.shortcut }));
    else if (event.kind === 'visual-deviation') frames?.preserveFirstAnomaly(event.code);
    else { frames?.preserveFirstAnomaly(event.code); healthFailures.push(event.code); }
  });
  await page.evaluate(({ mode, allowed, backgroundObservation, allowLocked, certifyCodeEnabled, codeDescriptors }) => {
    const legal = new Set(allowed), rows = [], health = [];
    const codeDescriptorBySource = new Map();
    const certifyCode = certifyCodeEnabled ? window.__shortStageCertifyCode : null;
    if (certifyCodeEnabled && typeof certifyCode !== 'function') {
      throw new Error('short-stage-code-certifier-missing');
    }
    for (let index = 0; index < allowed.length; index += 1) {
      const descriptor = codeDescriptors[index];
      if (descriptor && typeof descriptor === 'object') codeDescriptorBySource.set(allowed[index], descriptor);
    }
    let recording = true, active = true, failure = null, ranks = null, previousRank = Infinity;
    const surfaceNow = () => mode === 'full'
      ? document.querySelector(allowLocked ? '[data-easymde-preview-html-sink]' : '[data-easymde-preview-html-sink][role="textbox"]')
      : document.querySelector('.easymde-source-react .cm-content');
    const sourceNow = () => document.querySelector('#easymde-source')?.value ?? '';
    const rect = node => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    const nativeSnapshot = () => {
      const native = getSelection();
      const point = (node, offset) => ({
        connected: !!node?.isConnected, nodeType: node?.nodeType ?? null,
        parentTag: node?.parentElement?.tagName ?? null, offset,
        textLength: node instanceof Text ? node.length : null
      });
      return { anchor: point(native?.anchorNode, native?.anchorOffset ?? null),
        focus: point(native?.focusNode, native?.focusOffset ?? null), collapsed: native?.isCollapsed ?? null };
    };
    const nativeWitness = () => {
      const surface = surfaceNow(), native = getSelection();
      const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
      const sourceSurface = document.querySelector('.easymde-source-react .cm-content');
      const witnessSurface = mode === 'full' ? surface : sourceSurface;
      const point = (node, offset) => {
        if (!witnessSurface || !node?.isConnected || !witnessSurface.contains(node)) {
          return { kind: 'outside', connected: false, inside: false, blockOrdinal: null,
            lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
        }
        if (node === witnessSurface) {
          return { kind: 'surface', connected: true, inside: true,
            blockOrdinal: null, lineIndex: null, column: null, blockLength: null, surfaceOffset: offset };
        }
        if (mode !== 'full') {
          const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
          if (!line || !sourceSurface?.contains(line)) {
            return { kind: 'outside', connected: false, inside: true, blockOrdinal: null,
              lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
          }
          const lines = [...sourceSurface.querySelectorAll('.cm-line')];
          const prefix = line.ownerDocument.createRange();
          prefix.selectNodeContents(line);
          prefix.setEnd(node, offset);
          return { kind: 'source', connected: line.isConnected, inside: true,
            blockOrdinal: null, lineIndex: lines.indexOf(line), column: prefix.toString().length,
            blockLength: line.textContent.length, surfaceOffset: null };
        }
        let block = node;
        while (block && block.parentNode !== witnessSurface) block = block.parentNode;
        if (!block || block.parentNode !== witnessSurface) {
          return { kind: 'outside', connected: false, inside: true, blockOrdinal: null,
            lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
        }
        const blocks = [...witnessSurface.children].filter((child) => !child.hasAttribute('data-easymde-preview-window-spacer'));
        const prefix = block.ownerDocument.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(node, offset);
        return { kind: 'visual', connected: block.isConnected, inside: true,
          blockOrdinal: blocks.indexOf(block), lineIndex: null, column: prefix.toString().length,
          blockLength: block.textContent.length, surfaceOffset: null };
      };
      const backward = !!native && !native.isCollapsed && !!range
        && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
      return { collapsed: native?.isCollapsed ?? null,
        direction: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
        anchor: point(native?.anchorNode, native?.anchorOffset ?? 0),
        focus: point(native?.focusNode, native?.focusOffset ?? 0) };
    };
    const codeCertificateFor = (source) => {
      if (!certifyCodeEnabled) return null;
      const surface = surfaceNow(), native = getSelection();
      const preList = surface ? [...surface.querySelectorAll('pre')] : [];
      const codePreList = preList.filter((pre) => pre.querySelector(':scope > code') instanceof HTMLElement);
      const preForNode = (node) => {
        const element = node instanceof Element ? node : node?.parentElement ?? null;
        const pre = element?.closest?.('pre') ?? null;
        return pre && surface?.contains(pre) ? pre : null;
      };
      const anchorPre = preForNode(native?.anchorNode);
      const focusPre = preForNode(native?.focusNode);
      const selectedPre = anchorPre && anchorPre === focusPre ? anchorPre : null;
      const descriptor = codeDescriptorBySource.get(source) ?? null;
      const codeCandidate = !!anchorPre || !!focusPre;
      if (!codeCandidate) return null;
      const code = selectedPre?.querySelector(':scope > code') ?? null;
      let block = selectedPre;
      while (block && block.parentNode !== surface) block = block.parentNode;
      if (block?.parentNode !== surface) block = null;
      const blockChildren = surface ? [...surface.children]
        .filter((child) => !child.hasAttribute('data-easymde-preview-window-spacer')) : [];
      const prefixText = (node, offset) => {
        if (!(code instanceof HTMLElement) || !node || !Number.isSafeInteger(offset)
          || !(node === code || code.contains(node))) return null;
        try {
          const prefix = code.ownerDocument.createRange();
          prefix.selectNodeContents(code);
          prefix.setEnd(node, offset);
          return prefix.toString();
        } catch { return null; }
      };
      const anchorPrefix = prefixText(native?.anchorNode, native?.anchorOffset);
      const focusPrefix = prefixText(native?.focusNode, native?.focusOffset);
      const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
      const backward = !!native && !native.isCollapsed && !!range
        && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
      return certifyCode({
        source,
        descriptor,
        sourceDeclared: !!descriptor,
        codeCandidate: true,
        domText: code instanceof HTMLElement && typeof code.textContent === 'string'
          ? code.textContent : null,
        prePresent: !!selectedPre,
        preOrdinal: selectedPre ? preList.indexOf(selectedPre) : null,
        observedBlockOrdinal: block ? blockChildren.indexOf(block) : null,
        observedCodeOrdinal: selectedPre ? codePreList.indexOf(selectedPre) : null,
        preChildCount: selectedPre?.childNodes.length ?? 0,
        preDirectCode: !!selectedPre && selectedPre.childNodes.length === 1
          && selectedPre.firstChild === code,
        codeInsidePre: !!(code instanceof HTMLElement && selectedPre
          && code.parentElement === selectedPre),
        blockConnected: !!block?.isConnected,
        preConnected: !!selectedPre?.isConnected,
        codeConnected: !!(code instanceof HTMLElement && code.isConnected),
        blockOwnsPre: !!(block && selectedPre && (block === selectedPre || block.contains(selectedPre))),
        preInsideSurface: !!(surface && selectedPre && surface.contains(selectedPre)),
        nativeCollapsed: native?.isCollapsed ?? null,
        nativeDirection: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
        anchorLocal: native?.anchorNode instanceof Text ? native.anchorOffset
          : native?.anchorNode === code ? native.anchorOffset : null,
        focusLocal: native?.focusNode instanceof Text ? native.focusOffset
          : native?.focusNode === code ? native.focusOffset : null,
        anchorPrefix,
        focusPrefix
      });
    };
    const refuse = (code) => {
      if (failure) return;
      failure = { code, sourceLength: sourceNow().length, native: nativeSnapshot(),
        surfaceConnected: !!surfaceNow()?.isConnected, editable: surfaceNow()?.isContentEditable === true,
        lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        failure: document.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null };
      void window.__shortStageSignal({ kind: 'failure', code });
    };
    let quiet = null, pauseBaseline = null, layoutObserver = null, firstDeviation = null;
    const periods = [];
    const keep = (first, last, value) => {
      if (first.length < 2) first.push(value);
      else { last.push(value); if (last.length > 30) last.shift(); }
    };
    const deviation = (code, sample) => {
      if (firstDeviation) return;
      firstDeviation = { code, period: quiet?.report.label ?? null, sample };
      void window.__shortStageSignal({ kind: 'visual-deviation', code });
    };
    const sampleQuiet = kind => {
      if (!quiet) {
        if (pauseBaseline && sourceNow() !== pauseBaseline.value) refuse('short-stage-quiet-document-mutated');
        return;
      }
      const { baseline, report } = quiet, surface = surfaceNow(), value = sourceNow();
      const sample = { kind, at: performance.now(), sourceLength: value.length,
        sourceUnchanged: value === baseline.value,
        surfaceSame: surface === baseline.surface, phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null, focused: document.hasFocus(),
        visible: document.visibilityState === 'visible', editable: surface?.isContentEditable === true,
        lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        nodes: baseline.nodes.map(({ selector, node, box }) => {
          const live = surface?.querySelector(selector), current = rect(live);
          return { same: live === node, connected: node.isConnected, visible: Boolean(current && current.width > 0 && current.height > 0
            && current.y < innerHeight && current.y + current.height > 0), box: current,
            delta: box && current ? Math.max(...Object.keys(box).map(key => Math.abs(current[key] - box[key]))) : null };
        }),
        windowScroll: { x: window.scrollX, y: window.scrollY },
        ancestorScroll: baseline.scroll.map(item => ({ top: item.node.scrollTop, left: item.node.scrollLeft })),
        scrollSame: window.scrollX === baseline.windowX && window.scrollY === baseline.windowY
          && baseline.scroll.every(item => item.node.scrollTop === item.top && item.node.scrollLeft === item.left) };
      report.samples++; if (kind === 'raf') report.rafSamples++;
      report.sourceUnchanged &&= sample.sourceUnchanged;
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected)) report.identityChangeSamples++;
      if (sample.nodes.some(node => node.delta === null || node.delta > 0)) report.geometryChangeSamples++;
      if (!sample.scrollSame) report.scrollChangeSamples++;
      report.maxGeometryDelta = Math.max(report.maxGeometryDelta, ...sample.nodes.map(node => node.delta ?? 0));
      keep(report.first, report.last, sample);
      if (!sample.sourceUnchanged) refuse('short-stage-quiet-document-mutated');
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected || node.delta === null || node.delta > 0) || !sample.scrollSame) {
        deviation('short-stage-quiet-visual-change', sample);
      }
    };
    const observeLayout = entries => {
      if (!quiet) return;
      for (const entry of entries) {
        if (entry.startTime < quiet.report.startedAt) continue;
        const sample = { at: entry.startTime, value: entry.value, recentInput: entry.hadRecentInput,
          editorSourceCount: (entry.sources ?? []).filter(source => source.node && (surfaceNow()?.contains(source.node) ?? false)).length };
        quiet.report.layoutShiftCount++; quiet.report.layoutShiftValue += entry.value;
        keep(quiet.report.layoutFirst, quiet.report.layoutLast, sample);
        if (sample.editorSourceCount) deviation('short-stage-editor-layout-shift', sample);
      }
    };
    const layoutShiftSupported = backgroundObservation && Boolean(window.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift'));
    if (layoutShiftSupported) {
      layoutObserver = new PerformanceObserver(list => observeLayout(list.getEntries()));
      layoutObserver.observe({ type: 'layout-shift', buffered: false });
    }
    const endQuiet = () => {
      observeLayout(layoutObserver?.takeRecords() ?? []); sampleQuiet('end');
      if (quiet) { quiet.report.endedAt = performance.now(); quiet = null; }
      return { failure, firstDeviation, layoutShiftSupported, periods };
    };
    const beginQuiet = label => {
      endQuiet();
      if (periods.length >= 16) return refuse('short-stage-quiet-period-bound');
      const surface = surfaceNow(), value = sourceNow();
      pauseBaseline ??= { value };
      const nodes = ['h1', 'p'].map(selector => ({ selector, node: surface?.querySelector(selector) }))
        .filter(item => item.node && (() => { const box = rect(item.node); return box && box.width > 0 && box.height > 0
          && box.y < innerHeight && box.y + box.height > 0; })())
        .map(item => ({ ...item, box: rect(item.node) }));
      const scroll = [];
      let ancestor = surface;
      for (; ancestor && scroll.length < 16; ancestor = ancestor.parentElement) scroll.push({ node: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
      const report = { label, startedAt: performance.now(), endedAt: null, samples: 0, rafSamples: 0,
        visibleUntouchedNodeCount: nodes.length, sourceUnchanged: true,
        baseline: { sourceLength: value.length }, scrollAncestorSamplingComplete: ancestor === null,
        identityChangeSamples: 0, geometryChangeSamples: 0, scrollChangeSamples: 0, maxGeometryDelta: 0,
        layoutShiftCount: 0, layoutShiftValue: 0, first: [], last: [], layoutFirst: [], layoutLast: [] };
      quiet = { baseline: { ...pauseBaseline, surface, nodes, scroll, windowX: window.scrollX, windowY: window.scrollY }, report };
      periods.push(report); sampleQuiet('begin');
    };
    let lastWitnessKeys = new Set();
    const witnessConnectedInside = (witness) => witness?.anchor?.connected === true
      && witness.anchor.inside === true
      && witness?.focus?.connected === true
      && witness.focus.inside === true;
    const observe = () => {
      if (!recording || failure) return;
      sampleQuiet('document');
      const value = sourceNow();
      if (!legal.has(value)) return refuse('short-stage-independent-source-oracle');
      if (ranks) {
        const rank = ranks.get(value);
        if (rank > previousRank) return refuse('short-stage-independent-deletion-order');
        previousRank = rank;
      }
      const witness = nativeWitness();
      const codeCertificate = codeCertificateFor(value);
      const entry = { witness, codeCertificate };
      const key = JSON.stringify(entry);
      const lastRow = rows.at(-1);
      if (lastRow?.value !== value) {
        if (rows.length === 1024) return refuse('short-stage-canonical-observation-bound');
        lastWitnessKeys = new Set([key]);
        rows.push({ value, witness, codeCertificate, witnesses: [entry] });
      } else if (witnessConnectedInside(witness) && !lastWitnessKeys.has(key) && lastRow.witnesses.length < 256) {
        lastWitnessKeys.add(key);
        lastRow.witnesses.push(entry);
      }
      if (value === '') void window.__shortStageSignal({ kind: 'empty' });
    };
    document.addEventListener('beforeinput', observe, true);
    document.addEventListener('input', observe, true);
    document.addEventListener('selectionchange', observe, true);
    observe();
    const sample = () => {
      if (!active) return;
      const surface = surfaceNow();
      const native = getSelection();
      const repairAttribute = document.querySelector('[data-easymde-visual-deletion-repair]')
        ?.getAttribute('data-easymde-visual-deletion-repair') ?? null;
      const repairCount = repairAttribute === null ? 0 : Number(repairAttribute);
      if (repairAttribute !== null && !/^(?:0|[1-9][0-9]*)$/u.test(repairAttribute)) {
        refuse('short-stage-visual-deletion-repair-count');
      }
      if (!Number.isInteger(repairCount) || repairCount !== 0) {
        refuse('short-stage-visual-deletion-repair-count');
      }
      const state = { editable: surface?.isContentEditable === true,
        lock: mode === 'full' ? document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') : null,
        nativeConnected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        nativeInside: !!surface && !!native?.anchorNode && !!native?.focusNode
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        failure: !!document.querySelector('[data-easymde-visual-failure]'), repairCount };
      const userLocked = allowLocked && state.lock === 'true';
      if ((!state.editable && !userLocked) || state.failure || mode === 'full' && state.lock !== 'false' && !userLocked) refuse('short-stage-lock-or-editability');
      if (!userLocked && (!state.nativeConnected || !state.nativeInside)) refuse('short-stage-native-selection-outside-owner');
      observe();
      sampleQuiet('raf');
      if (health.length < 128 && JSON.stringify(health.at(-1)) !== JSON.stringify(state)) health.push(state);
      requestAnimationFrame(sample);
    };
    sample();
    let firstRedo = null;
    const onShortcut = (event) => {
      if (firstRedo || !(event.ctrlKey || event.metaKey) || event.code !== 'KeyZ' || !event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      firstRedo = { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey,
        shift: event.shiftKey, alt: event.altKey, trusted: event.isTrusted,
        surface: target?.closest('.easymde-source-react .cm-content') ? 'Source'
          : target?.closest('[data-easymde-preview-html-sink][role="textbox"]') ? 'Visual' : 'outside' };
      void window.__shortStageSignal({ kind: 'shortcut', shortcut: firstRedo });
    };
    document.addEventListener('keydown', onShortcut, true);
    // Preview-commit epoch. Every keydown opens an operation; when a formal
    // Preview cycle (non-ready phase, busy, or refreshing) is observed after
    // it, that operation stays pending until the surface commits a new ready
    // Preview signature. This closes the window in which Undo/Redo has changed
    // the source but React has not yet flipped the surface to loading.
    const previewSignatureNow = () => {
      const signature = surfaceNow()?.easymdePreviewSignature;
      return typeof signature === 'string' ? signature : '';
    };
    const previewCycleActive = () => {
      const surface = surfaceNow();
      return !!surface && (surface.getAttribute('data-easymde-preview-phase') !== 'ready'
        || surface.getAttribute('aria-busy') === 'true'
        || surface.getAttribute('data-easymde-preview-refreshing') === '1');
    };
    let previewEpoch = { startSignature: previewSignatureNow(), cycleObserved: previewCycleActive() };
    const notePreviewCycle = () => { if (previewCycleActive()) previewEpoch.cycleObserved = true; };
    const onOperationKeydown = () => {
      previewEpoch = { startSignature: previewSignatureNow(), cycleObserved: previewCycleActive() };
    };
    document.addEventListener('keydown', onOperationKeydown, true);
    const previewCycleObserver = new MutationObserver(notePreviewCycle);
    previewCycleObserver.observe(document, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-easymde-preview-phase', 'aria-busy', 'data-easymde-preview-refreshing'] });
    const previewCommitPending = () => {
      const signature = previewSignatureNow();
      return previewEpoch.cycleObserved && (signature === '' || signature === previewEpoch.startSignature);
    };
    const settledSample = () => {
      const surface = surfaceNow();
      const native = getSelection();
      const source = sourceNow();
      const repairAttribute = document.querySelector('[data-easymde-visual-deletion-repair]')
        ?.getAttribute('data-easymde-visual-deletion-repair') ?? null;
      const repairCount = repairAttribute === null
        ? 0
        : /^(?:0|[1-9][0-9]*)$/u.test(repairAttribute) ? Number(repairAttribute) : null;
      return {
        source,
        witness: nativeWitness(),
        codeCertificate: codeCertificateFor(source),
        phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        accepted: surface?.getAttribute('data-easymde-preview-accepted') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null,
        session: document.querySelector('[data-easymde-session-status]')
          ?.getAttribute('data-easymde-session-status') ?? null,
        lock: document.querySelector('.easymde-immersive-preview-lock')
          ?.getAttribute('aria-pressed') ?? null,
        editable: surface?.isContentEditable === true,
        nativeConnected: !!surface && !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        failureAbsent: !document.querySelector('[data-easymde-visual-failure]')
          && !surface?.hasAttribute('data-easymde-preview-error'),
        repairCount,
        stickyFailure: !!failure,
        previewSignature: previewSignatureNow(),
        previewCommitPending: previewCommitPending()
      };
    };
    // A settled read is two complete samples separated by two animation frames;
    // any source, caret, Preview phase, or signature movement marks it unstable.
    const settledState = async () => {
      notePreviewCycle();
      const first = settledSample();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      notePreviewCycle();
      const second = settledSample();
      return { ...second, stable: JSON.stringify(first) === JSON.stringify(second) };
    };
    window.__shortStageProbe = {
      snapshot: () => ({
        rows: rows.map((row) => ({ ...row, witnesses: [...row.witnesses] })),
        health: [...health],
        failure,
        firstRedo
      }),
      witness: () => nativeWitness(),
      settledState,
      beginQuiet, endQuiet,
      resumeEditing: () => { const observation = endQuiet(); pauseBaseline = null; return observation; },
      beginDeletion: (entries) => {
        ranks = new Map(entries); previousRank = Infinity;
        legal.clear(); for (const value of ranks.keys()) legal.add(value);
        rows.length = 0; lastWitnessKeys = new Set(); observe();
      },
      allow: (values) => { ranks = null; legal.clear(); for (const value of values) legal.add(value); },
      stopRecording: () => { recording = false; },
      stop: () => {
        endQuiet(); layoutObserver?.disconnect(); active = false; recording = false;
        previewCycleObserver.disconnect();
        document.removeEventListener('beforeinput', observe, true);
        document.removeEventListener('input', observe, true);
        document.removeEventListener('selectionchange', observe, true);
        document.removeEventListener('keydown', onShortcut, true);
        document.removeEventListener('keydown', onOperationKeydown, true);
        delete window.__shortStageCertifyCode;
      }
    };
  }, { mode: stage.mode, allowed: allowedList, backgroundObservation, allowLocked, certifyCodeEnabled, codeDescriptors });
  const onPopup = () => healthFailures.push('short-stage-popup');
  page.on('popup', onPopup);
  const guard = () => {
    frames?.guard();
    expect(stage.failures, 'short-stage continuous editor errors').toEqual([]);
    expect(healthFailures, 'short-stage continuous health monitor').toEqual([]);
  };
  return {
    guard,
    async beginQuiet(label) {
      guard(); frames?.stage(label);
      await page.evaluate(label => window.__shortStageProbe.beginQuiet(label), label);
      guard();
    },
    async endQuiet() {
      const observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
      expect(observation.failure, 'quiet period preserves source and DOM invariants').toBeNull();
      guard();
    },
    async resumeEditing() {
      const observation = await page.evaluate(() => window.__shortStageProbe.resumeEditing());
      expect(observation.failure, 'quiet periods preserve document before resumed editing').toBeNull();
      guard();
    },
    empty: () => emptySeen,
    press: async (key) => {
      guard();
      await page.keyboard.press(key);
      if (key === 'Backspace' || key === 'Delete') await page.waitForTimeout(100);
      guard();
    },
    type: async (text) => {
      for (const character of text) {
        guard();
        await page.keyboard.type(character);
        await page.waitForTimeout(50);
        guard();
      }
    },
    snapshot: () => page.evaluate(() => window.__shortStageProbe.snapshot()),
    witness: () => page.evaluate(() => window.__shortStageProbe.witness()),
    settledState: () => page.evaluate(() => window.__shortStageProbe.settledState()),
    freeze: () => page.evaluate(() => window.__shortStageProbe.stopRecording()),
    beginDeletion: (oracle) => page.evaluate((entries) => window.__shortStageProbe.beginDeletion(entries), [...oracle]),
    allow: (values) => page.evaluate((allowed) => window.__shortStageProbe.allow(allowed), [...values]),
    async stop() {
      page.off('popup', onPopup);
      let observation = null;
      try {
        if (backgroundObservation) {
          observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
          console.log(JSON.stringify({ phase: 'short-stage-background-scalar-evidence',
            sampling: 'every-rAF-and-document-notification; max-16-periods; first-2-last-30-per-period', ...observation }));
        }
      } finally { await page.evaluate(() => window.__shortStageProbe?.stop()); }
      if (backgroundObservation) {
        expect(observation.failure, 'quiet period document invariants survive cleanup').toBeNull();
        guard();
      }
    }
  };
}
async function startShortStageFrames(page, surface, { retainStages = false } = {}) {
  const require = createRequire(import.meta.url);
  const { PNG } = require(join(dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
  const box = await surface.boundingBox(), viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('short-stage-private-frame-region-unavailable');
  const clip = { x: Math.max(0, Math.ceil(box.x)), y: Math.max(0, Math.ceil(box.y)),
    right: Math.min(viewport.width, Math.floor(box.x + box.width)),
    bottom: Math.min(viewport.height, Math.floor(box.y + box.height)) };
  if (clip.right <= clip.x || clip.bottom <= clip.y) throw new Error('short-stage-private-frame-region-empty');
  if (retainStages) {
    const configured = test.info().project.use;
    const assets = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
      .map(entry => new URL(entry.name).pathname.split('/').at(-1))
      .filter(name => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
    console.log(JSON.stringify({ phase: 'short-stage-background-runtime', browserVersion: page.context().browser()?.version() ?? null,
      headless: configured.headless ?? true, channel: configured.channel ?? null,
      configuredBinary: configured.launchOptions?.executablePath?.split(/[\\/]/u).at(-1) ?? null,
      expectedAsset: process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD ?? null, assets }));
  }
  const cdp = await page.context().newCDPSession(page), first = [], tail = [], pendingAcks = new Set(), failures = [];
  let operation = 'before-actions', lifecycle = 'running', acceptingFrames = true, ackTotal = 0, ackSucceeded = 0;
  const stages = new Map();
  let anomaly = null;
  const stage = label => {
    operation = label;
    if (!retainStages || stages.has(label)) return;
    if (stages.size === 16) { recordFailure('stage-bound', new Error('stage-bound')); return; }
    stages.set(label, { received: 0, first: [], last: [] });
  };
  const recordFailure = (stage, error, ackOrdinal = null) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    const code = message.includes('Target page, context or browser has been closed') ? 'cdp-target-closed'
      : /session closed/iu.test(message) ? 'cdp-session-closed' : 'frame-operation-rejected';
    const failure = { stage, lifecycle, operation, ackOrdinal, code,
      errorClass: typeof error?.name === 'string' && /^[A-Za-z]*Error$/u.test(error.name) ? error.name : 'UnknownError' };
    failures.push(failure);
    console.log(JSON.stringify({ phase: 'short-stage-frame-capture-failure', ...failure }));
  };
  stage(operation);
  const onFrame = (event) => {
    if (acceptingFrames) {
      const frame = { data: event.data, operation, timestamp: event.metadata.timestamp, ordinal: ackTotal + 1 };
      if (first.length < 2) first.push(frame);
      else { tail.push(frame); if (tail.length > 30) tail.shift(); }
      const period = stages.get(operation);
      if (period) {
        period.received++;
        if (!period.first.length) period.first.push(frame);
        else { period.last.push(frame); if (period.last.length > 2) period.last.shift(); }
      }
      if (anomaly?.awaitingAfter) { anomaly.after = frame; anomaly.awaitingAfter = false; }
    }
    const ordinal = ++ackTotal;
    let sending;
    try { sending = cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); }
    catch (error) { recordFailure('ack', error, ordinal); return; }
    const ack = sending.then(() => { ackSucceeded += 1; }, (error) => { recordFailure('ack', error, ordinal); });
    pendingAcks.add(ack);
    void ack.then(() => { pendingAcks.delete(ack); }, () => { pendingAcks.delete(ack); });
  };
  cdp.on('Page.screencastFrame', onFrame);
  try { await cdp.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 }); }
  catch (error) {
    lifecycle = 'setup-failed'; recordFailure('start-screencast', error);
    acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame);
    await Promise.allSettled([...pendingAcks]);
    try { await cdp.detach(); } catch (detachError) { recordFailure('detach', detachError); }
    throw new Error('short-stage-compositor-start-failed');
  }
  return {
    stage,
    guard() { if (failures.length) throw new Error('short-stage-compositor-capture-failed'); },
    preserveFirstAnomaly(code) {
      if (!anomaly) anomaly = { code, operation, before: tail.at(-1) ?? first.at(-1) ?? null,
        after: null, awaitingAfter: true };
    },
    async stop(label) {
      lifecycle = 'stopping';
      const pendingAtStop = pendingAcks.size;
      try { await cdp.send('Page.stopScreencast'); }
      catch (error) { recordFailure('stop-screencast', error); }
      finally { acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame); }
      await Promise.allSettled([...pendingAcks]);
      const pendingAtDetach = pendingAcks.size;
      try { await cdp.detach(); } catch (error) { recordFailure('detach', error); }
      lifecycle = 'stopped';
      const frames = [...new Set([...first, ...tail, ...[...stages.values()].flatMap(period => [...period.first, ...period.last]),
        ...[anomaly?.before, anomaly?.after].filter(Boolean)])].sort((left, right) => left.ordinal - right.ordinal), evidence = [];
      try {
        for (const [index, frame] of frames.entries()) {
          // Decode/crop only after actions and transport shutdown. Raw viewport frames never leave memory.
          const image = PNG.sync.read(Buffer.from(frame.data, 'base64'));
          const sx = image.width / viewport.width, sy = image.height / viewport.height;
          const x = Math.ceil(clip.x * sx), y = Math.ceil(clip.y * sy);
          const width = Math.floor(clip.right * sx) - x, height = Math.floor(clip.bottom * sy) - y;
          const cropped = new PNG({ width, height });
          PNG.bitblt(image, cropped, x, y, width, height, 0, 0);
          const path = test.info().outputPath(`${label}-article-frame-${index}.png`);
          await writeFile(path, PNG.sync.write(cropped));
          await test.info().attach(`${label}-article-frame-${index}`, { path, contentType: 'image/png' });
          evidence.push({ operation: frame.operation, ordinal: frame.ordinal, timestamp: frame.timestamp, width, height });
        }
      } catch (error) { recordFailure('crop-save-attach', error); }
      console.log(JSON.stringify({ phase: 'short-stage-private-compositor-evidence', label,
        sampling: retainStages ? 'continuous-ACK; first-2-last-30-global; max-16-stages-first-1-last-2; max-2-anomaly-neighbors; max-82-retained-frames'
          : 'first-2-last-30-limited-coverage', frameCount: frames.length, savedFrameCount: evidence.length,
        captureClip: clip,
        periods: [...stages].map(([label, period]) => ({ label, received: period.received,
          retained: period.first.length + period.last.length })),
        anomaly: anomaly ? { code: anomaly.code, operation: anomaly.operation, beforeOrdinal: anomaly.before?.ordinal ?? null,
          afterOrdinal: anomaly.after?.ordinal ?? null, capture: 'last-received-before-and-first-after-signal-not-onset-proof' } : null,
        ackAudit: { total: ackTotal, succeeded: ackSucceeded, rejected: failures.filter((failure) => failure.stage === 'ack').length,
          pendingAtStop, pendingAtDetach, pendingAfterCleanup: pendingAcks.size }, failures, frames: evidence }));
      if (failures.length) throw new Error('short-stage-compositor-capture-failed');
      expect(frames.length, 'bounded compositor evidence requires more than one real frame').toBeGreaterThan(1);
    }
  };
}

function shortStageHistoryLedger(rows, initial, allowed) {
  const states = [];
  for (const row of rows) {
    expect(allowed.has(row.value), 'each historical source was independently declared and verified').toBe(true);
    expect(!!row.witness, 'each historical operation retained a public native caret witness').toBe(true);
    const witnesses = Array.isArray(row.witnesses) && row.witnesses.length > 0
      ? row.witnesses.map((entry) => ({
        witness: entry.witness,
        codeCertificate: entry.codeCertificate ?? null
      }))
      : [{ witness: row.witness, codeCertificate: row.codeCertificate ?? null }];
    expect(witnesses.every((entry) => !!entry.witness),
      'each historical operation retained a public native caret witness').toBe(true);
    states.push({
      value: row.value,
      witness: row.witness,
      codeCertificate: row.codeCertificate ?? null,
      witnesses
    });
  }
  expect(states[0]?.value === initial, 'the first observed source is the declared initial document').toBe(true);
  expect(states.length, 'natural editing produced at least one observable history state').toBeGreaterThan(0);
  return { states, initial, latest: states.at(-1),
    cursor: { undo: new Set([states.length - 1]), redo: null } };
}
function shortStageWitnessMatchesCodeCertificate(witness, certificate) {
  if (!witness || !certificate?.valid || certificate.codeCandidate !== true) return false;
  if (typeof certificate.nativeCollapsed !== 'boolean'
    || !['none', 'forward', 'backward'].includes(certificate.nativeDirection)) return false;
  const pointMatches = (point, cumulative) => point?.kind === 'visual'
    && point.connected === true && point.inside === true
    && point.blockOrdinal === certificate.blockOrdinal
    && point.column === cumulative
    && point.blockLength === certificate.domTextLength;
  return pointMatches(witness.anchor, certificate.anchorCumulative)
    && pointMatches(witness.focus, certificate.focusCumulative)
    && witness.collapsed === certificate.nativeCollapsed
    && witness.direction === certificate.nativeDirection;
}

function shortStageCodeCertificateCoreMatches(left, right) {
  const integerKeys = [
    'blockOrdinal', 'codeOrdinal', 'bodyStart', 'bodyEnd', 'bodyLength', 'bodyHash',
    'preOrdinal', 'observedBlockOrdinal', 'observedCodeOrdinal',
    'anchorCumulative', 'focusCumulative', 'anchorSourceOffset', 'focusSourceOffset'
  ];
  const booleanKeys = [
    'valid', 'descriptorAvailable', 'sourceBodyExact', 'prePresent', 'preOnlyCode',
    'correctBlock', 'correctCode', 'blockConnected', 'preConnected', 'codeConnected',
    'blockOwnsPre', 'preInsideSurface', 'codeInsidePre',
    'anchorPrefixMatch', 'focusPrefixMatch', 'anchorInBody', 'focusInBody'
  ];
  if (left?.codeCandidate !== true || right?.codeCandidate !== true) return false;
  if (typeof left.nativeCollapsed !== 'boolean' || left.nativeCollapsed !== right.nativeCollapsed) return false;
  if (!['none', 'forward', 'backward'].includes(left.nativeDirection)
    || left.nativeDirection !== right.nativeDirection) return false;
  if (!booleanKeys.every((key) => left[key] === true && right[key] === true)) return false;
  if (!integerKeys.every((key) => Number.isSafeInteger(left[key]) && left[key] === right[key])) return false;
  return left.nativeCollapsed
    ? left.nativeDirection === 'none'
      && left.anchorCumulative === left.focusCumulative && left.anchorSourceOffset === left.focusSourceOffset
    : (left.nativeDirection === 'forward'
        && left.anchorCumulative < left.focusCumulative && left.anchorSourceOffset < left.focusSourceOffset)
      || (left.nativeDirection === 'backward'
        && left.anchorCumulative > left.focusCumulative && left.anchorSourceOffset > left.focusSourceOffset);
}

function shortStageWitnessMatches(left, right) {
  if (!left?.witness || !right?.witness) return false;
  const leftCertificate = left.codeCertificate;
  const rightCertificate = right.codeCertificate;
  if (leftCertificate?.codeCandidate !== true && rightCertificate?.codeCandidate !== true) {
    return JSON.stringify(left.witness) === JSON.stringify(right.witness);
  }
  if (!shortStageCodeCertificateCoreMatches(leftCertificate, rightCertificate)
    || !shortStageWitnessMatchesCodeCertificate(left.witness, leftCertificate)
    || !shortStageWitnessMatchesCodeCertificate(right.witness, rightCertificate)) return false;
  const variants = [leftCertificate.domBodyVariant, rightCertificate.domBodyVariant];
  if (variants[0] === variants[1]) {
    return JSON.stringify(left.witness) === JSON.stringify(right.witness);
  }
  if (!((variants[0] === 'literal' && variants[1] === 'literal+closing-lf')
    || (variants[0] === 'literal+closing-lf' && variants[1] === 'literal'))) return false;
  const literal = leftCertificate.domBodyVariant === 'literal' ? leftCertificate : rightCertificate;
  const withClosingLf = leftCertificate.domBodyVariant === 'literal+closing-lf'
    ? leftCertificate : rightCertificate;
  if (literal.domTextLength !== literal.bodyLength
    || withClosingLf.domTextLength !== withClosingLf.bodyLength + 1) return false;
  const withoutBlockLength = (witness) => ({
    ...witness,
    anchor: Object.fromEntries(Object.entries(witness.anchor)
      .filter(([key]) => key !== 'blockLength')),
    focus: Object.fromEntries(Object.entries(witness.focus)
      .filter(([key]) => key !== 'blockLength'))
  });
  return JSON.stringify(withoutBlockLength(left.witness))
    === JSON.stringify(withoutBlockLength(right.witness));
}

function shortStageWitnessEntries(state) {
  if (!state) return [];
  if (Array.isArray(state.witnesses)) return state.witnesses;
  return state.witness ? [{ witness: state.witness, codeCertificate: state.codeCertificate ?? null }] : [];
}

function shortStageStateMatches(left, right) {
  if (!left || !right || left.value !== right.value) return false;
  const leftEntries = shortStageWitnessEntries(left);
  const rightEntries = shortStageWitnessEntries(right);
  return leftEntries.some((leftEntry) => rightEntries.some((rightEntry) =>
    shortStageWitnessMatches(leftEntry, rightEntry)));
}

function shortStageObservedStateChanged(before, after) {
  return after?.source !== before?.value || !shortStageWitnessMatches(before, {
    value: after?.source, witness: after?.witness, codeCertificate: after?.codeCertificate
  });
}

function shortStageFullOperationReady(state) {
  return state?.phase === 'ready'
    && (state.accepted === '1' || state.source === '')
    && state.busy === 'false'
    && state.session === 'ready'
    && state.lock === 'false'
    && state.editable === true
    && state.nativeConnected === true
    && state.failureAbsent === true
    && state.stickyFailure === false
    && state.repairCount === 0
    && state.stable === true
    && state.previewCommitPending === false;
}

function shortStageFullOperationUnsafe(state) {
  return !state
    || state.failureAbsent !== true
    || state.stickyFailure !== false
    || !Number.isInteger(state.repairCount)
    || state.repairCount !== 0
    || state.lock !== 'false'
    || state.editable !== true
    || state.nativeConnected !== true;
}

function shortStageTargetMatches(state, target) {
  return !!state && !!target && state.value === target.value
    && (target.witness === null || target.witness === undefined || shortStageStateMatches(state, target));
}

function shortStageHistoryCursorSnapshot(history) {
  const cursor = history.cursor.redo ?? history.cursor.undo;
  if (!cursor?.size) throw new Error('short-stage-history-known-cursor-missing');
  return new Set(cursor);
}

function shortStageRestoreHistoryCursor(history, cursor) {
  history.cursor.undo = new Set(cursor);
  history.cursor.redo = null;
}

function shortStageNextHistoryCursor(states, cursor, after, direction) {
  const nextCursor = new Set();
  states.forEach((state, stateIndex) => {
    if (!shortStageStateMatches(state, after)) return;
    for (const cursorIndex of cursor) {
      if (direction === 'undo' ? stateIndex < cursorIndex : stateIndex > cursorIndex) {
        nextCursor.add(stateIndex); break;
      }
    }
  });
  return nextCursor;
}

function shortStageHistoryExit(states, cursor, target, direction, requireBoundary) {
  const matchesTarget = !!target && cursor?.size > 0
    && [...cursor].every((index) => shortStageTargetMatches(states[index], target));
  if (!matchesTarget) return { exit: false, uncovered: false };
  if (!requireBoundary) return { exit: true, uncovered: false };
  const boundary = direction === 'undo' ? 0 : states.length - 1;
  const targetHasWitness = !!target.witness && typeof target.witness === 'object'
    && Object.keys(target.witness).length > 0;
  const proven = targetHasWitness && cursor.has(boundary)
    && shortStageTargetMatches(states[boundary], target);
  return proven ? { exit: true, uncovered: false } : { exit: false, uncovered: true };
}

async function shortStageReplayHistory(page, stage, probe, history, direction, target = null, requireBoundary = target === null) {
  const key = direction === 'undo' ? 'Control+z' : 'Control+Shift+Z';
  const expectedTarget = target ?? (direction === 'undo' ? history.states[0] : history.latest);
  const bound = history.states.length * 3 + 16;
  let current;
  if (stage.mode === 'full') {
    const entry = await probe.settledState();
    if (shortStageFullOperationUnsafe(entry)) throw new Error('short-stage-history-full-operation-unsafe');
    current = { value: entry.source, witness: entry.witness,
      codeCertificate: entry.codeCertificate ?? null };
  } else {
    current = { value: await stage.source.inputValue(), witness: await probe.witness() };
  }
  let cursor = direction === 'undo' ? history.cursor.undo : history.cursor.redo;
  if (!cursor?.size) throw new Error('short-stage-history-known-cursor-missing');
  const currentAtKnownCursor = [...cursor].some((index) => shortStageStateMatches(history.states[index], current));
  if (!currentAtKnownCursor) throw new Error('short-stage-history-current-state-not-at-known-cursor');
  const initialExit = shortStageHistoryExit(history.states, cursor, expectedTarget, direction, requireBoundary);
  if (initialExit.uncovered) throw new Error('short-stage-history-target-occurrence-unproven');
  if (initialExit.exit) {
    if (direction === 'undo') history.cursor.redo = new Set(cursor);
    else history.cursor.undo = new Set(cursor);
    return new Set(cursor);
  }
  for (let step = 0; step < bound; step += 1) {
    const before = current;
    await probe.press(key);
    let after;
    if (stage.mode === 'full') {
      let unsafeSnapshot = null;
      let settledSnapshot = null;
      let lastSnapshot = null;
      let predicateError = null;
      const changed = snapshot => shortStageObservedStateChanged(before, snapshot);
      try {
        await expect.poll(async () => {
          let snapshot;
          try {
            snapshot = await probe.settledState();
          } catch (error) {
            predicateError = error;
            throw error;
          }
          lastSnapshot = snapshot;
          if (shortStageFullOperationUnsafe(snapshot)) {
            unsafeSnapshot = snapshot;
            return true;
          }
          if (!shortStageFullOperationReady(snapshot) || !changed(snapshot)) return false;
          settledSnapshot = snapshot;
          return true;
        }, { message: 'short-stage-history-full-operation-wait' }).toBe(true);
      } catch (error) {
        if (predicateError) throw predicateError;
        if (typeof error?.message !== 'string' || !error.message.includes('short-stage-history-full-operation-wait')) {
          throw error;
        }
        if (unsafeSnapshot) throw new Error('short-stage-history-full-operation-unsafe');
        if (lastSnapshot && shortStageFullOperationReady(lastSnapshot) && !changed(lastSnapshot)) {
          throw new Error('short-stage-history-full-operation-nochange');
        }
        throw new Error('short-stage-history-full-operation-pending');
      }
      if (unsafeSnapshot) throw new Error('short-stage-history-full-operation-unsafe');
      if (!settledSnapshot) throw new Error('short-stage-history-full-operation-pending');
      probe.guard();
      after = { value: settledSnapshot.source, witness: settledSnapshot.witness,
        codeCertificate: settledSnapshot.codeCertificate ?? null };
    } else {
      await expect.poll(async () => {
        const value = await stage.source.inputValue();
        const witness = await probe.witness();
        return value !== before.value || JSON.stringify(witness) !== JSON.stringify(before.witness);
      }, { message: `${direction} must produce a distinct observed native state` }).toBe(true);
      after = { value: await stage.source.inputValue(), witness: await probe.witness() };
    }
    // A real Undo may group several forward observations. Keep every duplicate
    // occurrence still reachable from the known cursor set; never infer depth.
    const nextCursor = shortStageNextHistoryCursor(history.states, cursor, after, direction);
    if (nextCursor.size === 0) throw new Error('short-stage-history-next-state-unobserved-under-cursor');
    cursor = nextCursor;
    current = after;
    history.cursor[direction] = new Set(cursor);
    const exit = shortStageHistoryExit(history.states, cursor, expectedTarget, direction, requireBoundary);
    if (exit.uncovered) throw new Error('short-stage-history-target-occurrence-unproven');
    if (exit.exit) {
      if (direction === 'undo') history.cursor.redo = new Set(cursor);
      else history.cursor.undo = new Set(cursor);
      return new Set(cursor);
    }
  }
  throw new Error('short-stage-natural-history-progress-bound');
}

async function finishShortStageObservation(probe, frames, label, failed) {
  let firstCleanupError = null;
  for (const cleanup of [() => probe.stop(), () => frames.stop(label)]) {
    try { await cleanup(); }
    catch (error) {
      firstCleanupError ??= error;
      console.log(JSON.stringify({ phase: 'short-stage-evidence-cleanup-failure', label, errorClass: error.name,
        code: /^short-stage-[a-z-]+$/u.test(error.message ?? '') ? error.message : 'cleanup-operation-rejected' }));
    }
  }
  if (!failed && firstCleanupError) throw firstCleanupError;
}

for (const mode of ['ordinary', 'split', 'full']) {
for (const pacing of ['normal', 'burst']) {
  test(`[short-stage] ${mode} ${pacing} mixed lifecycle reaches source zero and replays natural history`, async ({ page }) => {
    const phaseModel = shortStagePhaseModel(mode);
    let previewReadOperationId = null;
    const stage = await openShortStage(page, mode, shortStageInitial, ({ browserMonitor, postId, renderParams }) => {
      previewReadOperationId = browserMonitor.beginPhased({
        postId,
        renderParams,
        phases: phaseModel.phases
      });
    });
    expect(Number.isSafeInteger(previewReadOperationId)).toBe(true);
    const enterPreviewPhase = (phaseId) => {
      stage.browserMonitor.enterPhase(previewReadOperationId, phaseId);
    };
    const {
      allowed, branch, branchBase, continued, entered, middleOffset, middleQSource,
      oracle, phaseIds, positions, shortened
    } = phaseModel;
    const probe = await startShortStageProbe(page, stage, allowed, {
      codeDescriptorsBySource: shortStageDeclaredCodeDescriptors
    });
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'whole-document-Backspace', failed = true;
    try {
      phase = 'real-mouse-and-arrow-positions'; frames.stage(phase);
      for (const position of positions) {
        enterPreviewPhase(phaseIds.positions[position.phaseIndex]);
        const sourceOffset = shortStageInitial.indexOf(position.needle) + position.offset;
        probe.guard();
        if (mode === 'full') {
          await stage.visual.locator(position.selector).nth(position.index).click({ position: { x: 3, y: 3 } });
          await probe.press('Home');
          for (let index = 0; index < position.offset; index += 1) await probe.press('ArrowRight');
        } else {
          await stage.surface.click(); await probe.press('Control+Home');
          for (let index = 0; index < sourceOffset; index += 1) await probe.press('ArrowRight');
        }
        await probe.type('V');
        await expectSource(stage.source, shortStageInitial.slice(0, sourceOffset) + 'V' + shortStageInitial.slice(sourceOffset));
        await probe.press('Backspace'); await expectSource(stage.source, shortStageInitial);
      }
      await stage.surface.click(); await probe.press('Control+End');
      enterPreviewPhase(phaseIds.deletion);
      await probe.beginDeletion(oracle);
      phase = 'whole-document-Backspace';
      frames.stage(phase);
      let rank = Infinity, consumed = 0;
      const checkDeletionRows = async () => {
        const observation = await probe.snapshot();
        for (const row of observation.rows.slice(consumed)) {
          expect(oracle.has(row.value), 'EOF deletion must match a complete independently declared state').toBe(true);
          const next = oracle.get(row.value);
          expect(next, 'EOF deletion may not grow or reorder a preceding block').toBeLessThanOrEqual(rank);
          rank = next;
        }
        consumed = observation.rows.length;
        probe.guard();
      };
      for (let key = 0; key < shortStageInitial.length * 3 + 16 && !probe.empty(); key += 1) {
        await probe.press('Backspace');
        if (pacing === 'normal') await checkDeletionRows();
      }
      await expectSource(stage.source, '');
      await checkDeletionRows();
      phase = 'extra-Backspace-at-source-zero'; frames.stage(phase);
      enterPreviewPhase(phaseIds.emptyExtraBackspace);
      const zero = await readPublicEditorState(page);
      for (let key = 0; key < 3; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, '');
      const afterExtra = await readPublicEditorState(page);
      expect({ sourceEmpty: afterExtra.source === '', ...safePublicState(afterExtra) }).toMatchObject({
        sourceEmpty: true, sourceLength: 0, effectiveEditable: true,
        contenteditable: 'true', lock: mode === 'full' ? 'false' : null, session: 'ready', focused: true });
      expect(afterExtra.nativeAnchor, 'Backspace at source zero must not move the native anchor')
        .toEqual(zero.nativeAnchor);
      expect(afterExtra.nativeFocus, 'Backspace at source zero must not move the native focus')
        .toEqual(zero.nativeFocus);
      phase = 'empty-input-Enter-immediate-input'; frames.stage(phase);
      enterPreviewPhase(phaseIds.reentry);
      await probe.allow(new Set(['', branchBase, entered, continued, shortened, branch]));
      await probe.type('Z');
      if (pacing === 'normal') await expectSource(stage.source, 'Z');
      await probe.press('Enter');
      if (pacing === 'normal') await expectSource(stage.source, entered);
      await probe.type('XY');
      await expectSource(stage.source, continued);
      await probe.press('Backspace');
      await expectSource(stage.source, shortened);
      const forward = await probe.snapshot();
      const history = shortStageHistoryLedger(forward.rows, shortStageInitial, allowed);
      await probe.freeze();
      phase = 'groupwise-Undo-full-exact'; frames.stage(phase);
      enterPreviewPhase(phaseIds.fullUndo);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, shortStageInitial);
      phase = 'groupwise-Redo-full-exact'; frames.stage(phase);
      enterPreviewPhase(phaseIds.fullRedo);
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, shortened);
      phase = 'history-branch-and-continuation'; frames.stage(phase);
      enterPreviewPhase(phaseIds.branchToZ);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', { value: branchBase, witness: null });
      const branchCursor = shortStageHistoryCursorSnapshot(history);
      const branchBefore = await stage.source.inputValue();
      expect(branchBefore === branchBase, 'branch point must be the independently expected observed source state').toBe(true);
      const branchPoint = await readPublicEditorState(page);
      expect(branchPoint.nativeCollapsed, 'branch point keeps a real collapsed native caret').toBe(true);
      expect(branchPoint.nativeConnected, 'branch point keeps the native caret connected').toBe(true);
      const branchWitnessBefore = await probe.witness();
      const branchCaretBeforeExact = branchWitnessBefore.collapsed === true
        && branchWitnessBefore.anchor?.connected === true && branchWitnessBefore.focus?.connected === true
        && JSON.stringify(branchWitnessBefore.anchor) === JSON.stringify(branchWitnessBefore.focus)
        && branchWitnessBefore.anchor?.column === 1
        && branchWitnessBefore.anchor?.blockLength === 1
        && (mode === 'full'
          ? branchWitnessBefore.anchor?.kind === 'visual' && branchWitnessBefore.anchor?.blockOrdinal === 0
          : branchWitnessBefore.anchor?.kind === 'source' && branchWitnessBefore.anchor?.lineIndex === 0);
      expect(branchCaretBeforeExact, 'branch input begins at the independently expected native text end').toBe(true);
      enterPreviewPhase(phaseIds.branchInput);
      await probe.type('B');
      await expectSource(stage.source, branch);
      const branchWitnessAfter = await probe.witness();
      const branchCaretAfterExact = branchWitnessAfter.collapsed === true
        && branchWitnessAfter.anchor?.connected === true && branchWitnessAfter.focus?.connected === true
        && JSON.stringify(branchWitnessAfter.anchor) === JSON.stringify(branchWitnessAfter.focus)
        && branchWitnessAfter.anchor?.column === 2
        && branchWitnessAfter.anchor?.blockLength === 2
        && (mode === 'full'
          ? branchWitnessAfter.anchor?.kind === 'visual' && branchWitnessAfter.anchor?.blockOrdinal === 0
          : branchWitnessAfter.anchor?.kind === 'source' && branchWitnessAfter.anchor?.lineIndex === 0);
      expect(branchCaretAfterExact, 'branch input lands at the independently expected native text end').toBe(true);
      enterPreviewPhase(phaseIds.invalidRedo);
      await probe.press('Control+Shift+Z');
      await expectSource(stage.source, branch);
      enterPreviewPhase(phaseIds.undoBranch);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      enterPreviewPhase(phaseIds.redoBranch);
      await probe.press('Control+Shift+Z'); await expectSource(stage.source, branch);
      enterPreviewPhase(phaseIds.undoBranchAgain);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      shortStageRestoreHistoryCursor(history, branchCursor);
      enterPreviewPhase(phaseIds.restoreInitial);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, shortStageInitial);
      phase = 'restored-middle-direct-continuation'; frames.stage(phase);
      enterPreviewPhase(phaseIds.middleQ);
      if (mode === 'full') {
        await stage.visual.locator('p').nth(1).click({ position: { x: 3, y: 3 } });
        await probe.press('Home'); await probe.press('ArrowRight');
      } else {
        await stage.surface.click(); await probe.press('Control+Home');
        for (let index = 0; index < middleOffset; index += 1) await probe.press('ArrowRight');
      }
      await probe.type('Q');
      await expectSource(stage.source, middleQSource);
      enterPreviewPhase(phaseIds.middleQUndo);
      await probe.press('Control+z'); await expectSource(stage.source, shortStageInitial);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      const finalDrain = await stage.browserMonitor.drain({ timeoutMs: 8_000, quietMs: 300 });
      expect(finalDrain, 'final Preview drain must settle only after all phase actions').toBe(true);
      probe.guard();
      const finalState = await readPublicEditorState(page);
      const finalWitness = await probe.witness();
      const previewCertificate = await readShortStageFinalPreviewCertificate(page, shortStageInitial);
      const targetBlockLength = 'Target paragraph here.'.length;
      const expectedCaret = mode === 'full'
        ? { kind: 'visual', connected: true, inside: true, blockOrdinal: 2, lineIndex: null,
          column: 1, blockLength: targetBlockLength, surfaceOffset: null }
        : { kind: 'source', connected: true, inside: true, blockOrdinal: null, lineIndex: 4,
          column: 1, blockLength: targetBlockLength, surfaceOffset: null };
      expect({ sourceExact: finalState.source === shortStageInitial, ...safePublicState(finalState) }).toMatchObject({
        sourceExact: true, sourceInputConnected: true, effectiveEditable: true,
        contenteditable: 'true', focused: true,
        previewPhase: mode === 'full' ? 'ready' : null,
        busy: mode === 'full' ? 'false' : null,
        failure: null, session: 'ready', lock: mode === 'full' ? 'false' : null, repairCount: 0,
        nativeConnected: true, nativeCollapsed: true
      });
      expect(finalWitness).toMatchObject({ collapsed: true, direction: 'none',
        anchor: expectedCaret, focus: expectedCaret });
      expect(previewCertificate).toEqual({
        sourceExact: true, sinkCount: 1, sinkConnected: true, blockOrderExact: true,
        paragraphCount: 3, paragraphTextExact: true, headingCount: 1, headingTextExact: true,
        preCount: 1, codeCount: 1, codeTextExact: true, phaseReady: true, acceptedOne: true,
        busyFalse: true, previewErrorAbsent: true, refreshingAbsent: true,
        globalFailureAbsent: true
      });
      const proof = stage.browserMonitor.provePreviewReadOperation(previewReadOperationId, {
        finalUiVerified: true
      });
      const finalMonitor = stage.browserMonitor.summary();
      expect(proof.approved, 'declared phased Preview reads must prove recoverable cancellation').toBe(true);
      expect(proof.code).toBe('preview-read-operation-approved');
      expect(Number.isInteger(proof.approvedAbortCount) && proof.approvedAbortCount >= 0).toBe(true);
      expect(finalMonitor.issues).toEqual([]);
      expect(finalMonitor.approved.previewCancellations).toBe(proof.approvedAbortCount);
      expect(finalMonitor.counts.requestFailures).toBeGreaterThanOrEqual(proof.approvedAbortCount);
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-complete', mode, pacing,
        trueSourceZero: true, observedSourceTransitions: Math.max(0, history.states.length - 1),
        final: { sourceLength: finalState.sourceLength, editable: finalState.effectiveEditable,
          lock: finalState.lock, session: finalState.session, nativeConnected: finalState.nativeConnected,
          collapsed: finalState.nativeCollapsed, repairCount: finalState.repairCount },
        preview: { phaseReady: previewCertificate.phaseReady, acceptedOne: previewCertificate.acceptedOne,
          busyFalse: previewCertificate.busyFalse, semanticCounts: [previewCertificate.paragraphCount,
            previewCertificate.headingCount, previewCertificate.preCount, previewCertificate.codeCount] },
        phasedPreview: { approved: proof.approved, approvedAbortCount: proof.approvedAbortCount,
          requestFailures: finalMonitor.counts.requestFailures, issueCount: finalMonitor.issues.length },
        health: forward.health, realOSIME: false }));
      failed = false;
    } catch (error) {
      const failedState = await readPublicEditorState(page);
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-first-failure', mode, pacing, operation: phase,
        state: { sourceLength: failedState.sourceLength, editable: failedState.effectiveEditable,
          lock: failedState.lock, nativeConnected: failedState.nativeConnected },
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      await finishShortStageObservation(probe, frames, `short-${mode}-${pacing}`, failed);
    }
  });
}
}

test('nonempty paragraph join keeps source, selection and immediate undo editing consistent', async ({ page }) => {
  const initial = 'alpha\n\nbeta';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').last().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  // Force the normal history owner to flush pending input without a preview wait.
  await page.keyboard.press('Control+z');
  expect(failures).toEqual([]);
  await expectSource(source, initial);
  await expectLiveSelection(visual);
  await page.keyboard.type('X');
  await expectSource(source, 'alpha\n\nXbeta');
  expect(failures).toEqual([]);
});

for (const boundary of [
  { paragraphs: 2, text: 'Second.', source: 'Before.\n\nSecond' },
  { paragraphs: 1, text: 'Before.', source: 'Before' }
]) {
test(`first character deletion after empty join ${boundary.paragraphs} reaches canonical source`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'Before.\n\nSecond.\n\nTailXX');
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  let joined = false;
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    if (await visual.locator('p').count() === boundary.paragraphs
      && await visual.locator('p').last().textContent() === boundary.text) {
      joined = true;
      break;
    }
  }
  expect(joined).toBe(true);
  expect(await visual.locator('p').last().evaluate((paragraph) => {
    const selection = getSelection();
    if (!selection?.isCollapsed || !paragraph.contains(selection.anchorNode)) return false;
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    return prefix.toString().length === paragraph.textContent.length;
  })).toBe(true);
  // The native end caret is already correct. No click, focus repair or Preview wait.
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expect(visual.locator('p').last()).toHaveText(boundary.text.slice(0, -1));
  await expect.poll(async () => (await source.inputValue()).trimEnd() === boundary.source).toBe(true);
  await expectLiveSelection(visual);
});
}

test('short mixed document can be deleted characterwise and restored by keyboard history', async ({ page }) => {
  const initial = '中文 abc aaa \\*文字\\*\n\n# Heading\n\nTarget paragraph here.\n\n~~~bash\necho hi\n~~~\n\nEnd.';
  const phaseModel = shortStagePhaseModel('full');
  const deletionForward = phaseModel.deletionForwardGroups;
  const deletionReverse = deletionForward.slice().reverse().map((group) => [...group]);
  const emptyGroup = ['', ' ', '  ', '\n', '\n\n'];
  const typedXGroup = ['X', 'X ', 'X  ', 'X\n', 'X\n\n', ' X', '  X', '\nX', '\n\nX'];
  const middleX = initial.replace('Target paragraph here.', 'XTarget paragraph here.');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'delete', groups: deletionForward },
    { id: 'undo-restore', groups: deletionReverse },
    { id: 'redo-empty', groups: deletionForward },
    { id: 'empty-type-x', groups: [emptyGroup, typedXGroup, emptyGroup] },
    { id: 'undo-restore-2', groups: deletionReverse },
    { id: 'middle-x', groups: [[initial], [middleX]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  previewRead.enterPhase('delete');
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `delete operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expect(visual).toHaveText('');
  await expect.poll(async () => (await source.inputValue()).trim().length).toBe(0);
  const emptySource = await source.inputValue();
  previewRead.enterPhase('undo-restore');
  let restored = false;
  let undoSteps = 0;
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Control+z');
    undoSteps += 1;
    expect(failures, `undo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  previewRead.enterPhase('redo-empty');
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, emptySource);
  previewRead.enterPhase('empty-type-x');
  await page.keyboard.type('X');
  await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
  await page.keyboard.press('Control+z');
  await expectSource(source, emptySource);
  previewRead.enterPhase('undo-restore-2');
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `restoration operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, initial);
  previewRead.enterPhase('middle-x');
  await visual.locator('p').filter({ hasText: 'Target paragraph here.' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  await expectSource(source, middleX);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

test('deleted-to-empty document accepts Enter continuation and restores exact history', async ({ page }) => {
  const initial = 'abc\n\n';
  const legalEmpty = '\n\n';
  const emptyGroup = [legalEmpty, ''];
  const zGroup = ['Z', `Z${legalEmpty}`];
  const enterGroup = ['Z\n\n  ', `Z\n\n  ${legalEmpty}`];
  const xGroup = ['Z\n\nX', `Z\n\nX${legalEmpty}`];
  const xyGroup = ['Z\n\nXY', `Z\n\nXY${legalEmpty}`];
  const xybGroup = ['Z\n\nXYB', `Z\n\nXYB${legalEmpty}`];
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], ['ab\n\n'], ['a\n\n'], emptyGroup,
        zGroup, enterGroup, xGroup, xyGroup, xGroup, xyGroup, xGroup, xyGroup, xybGroup,
        xyGroup, xGroup, enterGroup, zGroup, emptyGroup, ['a\n\n'], ['ab\n\n'], [initial],
        ['aMbc\n\n']
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let operationStage = 'delete-to-empty'; let latestAtom = null;
  const checkpoint = async (expected, caret, paragraphIndex, bodyOffset, bodyLength, ready = false) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: expected });
    latestAtom = { operationStage, expectedLength: expected.length, expectedCaret: caret,
      state: safeFullCrossBlockState(state) };
    console.log(JSON.stringify({ phase: 'empty-Enter-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (ready || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready', collapsed: true,
      nativeParagraph: { index: paragraphIndex, bodyOffset, bodyLength } });
    else expect(state).toMatchObject({ collapsed: true });
    expect(failures).toEqual([]); return state;
  };
  const acceptedEmptyRepresentation = (value) => value === '' || value === legalEmpty;
  const readAcceptedEmpty = async () => {
    await expect.poll(async () => acceptedEmptyRepresentation(await source.inputValue())).toBe(true);
    const canonical = await source.inputValue();
    expect(canonical.trim().length, 'Empty representation must contain no document text').toBe(0);
    const owner = await readPublicEditorState(page);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: canonical });
    latestAtom = { operationStage, canonicalLength: canonical.length,
      state: safeFullCrossBlockState(state), owner: safePublicState(owner) };
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, collapsed: true,
      focused: true, editable: true, lock: 'false', session: 'ready', previewPhase: 'ready', busy: 'false' });
    expect(state.nativeEndpoints.anchor.nodeType, 'A valid native caret must have a connected anchor').not.toBeNull();
    expect(state.nativeEndpoints.focus.nodeType, 'A valid native caret must have a connected focus').not.toBeNull();
    if (state.nativeParagraph) expect(state.nativeParagraph.bodyOffset).toBe(state.nativeParagraph.bodyLength);
    expect(owner.editable).toBe(true);
    await expect(visual).toHaveAttribute('contenteditable', 'true');
    expect(failures).toEqual([]);
    return { canonical, owner, state };
  };
  try {
    await visual.locator('p').last().click(); await page.keyboard.press('Control+End');
    for (const [remaining, caret] of [['ab\n\n', 2], ['a\n\n', 1], [legalEmpty, 0]]) {
      await page.keyboard.press('Backspace'); await checkpoint(remaining, caret, 0, caret, caret);
    }
    operationStage = 'extra-empty-Backspace';
    const beforeExtraCanonical = await source.inputValue();
    const beforeExtraOwner = await readPublicEditorState(page);
    expect(beforeExtraCanonical === legalEmpty).toBe(true);
    await page.keyboard.press('Backspace');
    let acceptedEmpty = await readAcceptedEmpty();
    console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'first-extra-Backspace',
      beforeLength: beforeExtraCanonical.length, afterLength: acceptedEmpty.canonical.length,
      nativeConnected: acceptedEmpty.owner.nativeConnected, statePhase: acceptedEmpty.state.phase }));
    const zeroLengthBackspaceIssued = acceptedEmpty.canonical === '';
    if (zeroLengthBackspaceIssued) {
      operationStage = 'extra-empty-at-zero-Backspace';
      const beforeZeroOwner = acceptedEmpty.owner;
      const beforeZeroDom = await page.evaluateHandle(() => {
        const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
        const p0 = surface?.firstElementChild ?? null;
        return { surface, children: surface ? Array.from(surface.childNodes) : [],
          p0Tag: p0?.tagName ?? null, p0Children: p0 ? Array.from(p0.childNodes) : [] };
      });
      try {
        await page.keyboard.press('Backspace');
        const afterZero = await readAcceptedEmpty();
        expect(afterZero.canonical, 'Backspace at the zero-length empty representation must be an exact no-op').toBe('');
        expect(afterZero.owner.nativeAnchor, 'Backspace at zero length must not move the native anchor')
          .toEqual(beforeZeroOwner.nativeAnchor);
        expect(afterZero.owner.nativeFocus, 'Backspace at zero length must not move the native focus')
          .toEqual(beforeZeroOwner.nativeFocus);
        expect(failures, 'Backspace at zero length must not emit a pageerror').toEqual([]);
        const sameDom = await page.evaluate((before) => {
          const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
          const p0 = surface?.firstElementChild ?? null;
          return { surface: !!surface && surface === before.surface && surface.isConnected,
            children: !!surface && surface.childNodes.length === before.children.length
              && Array.from(surface.childNodes).every((node, index) => node === before.children[index]),
            p0Tag: before.p0Tag === 'P' && p0?.tagName === 'P',
            p0Children: !!p0 && p0.childNodes.length === before.p0Children.length
              && Array.from(p0.childNodes).every((node, index) => node === before.p0Children[index]) };
        }, beforeZeroDom);
        expect(sameDom, 'Backspace at zero length must preserve the accepted P/BR DOM identities').toEqual({
          surface: true, children: true, p0Tag: true, p0Children: true
        });
        console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'zero-length-Backspace',
          beforeLength: acceptedEmpty.canonical.length, afterLength: afterZero.canonical.length,
          domIdentity: sameDom, nativeConnected: afterZero.owner.nativeConnected, statePhase: afterZero.state.phase }));
        acceptedEmpty = afterZero;
      } finally {
        await beforeZeroDom.dispose();
      }
    }
    const emptyRepresentation = acceptedEmpty.canonical;
    const typed = `Z${emptyRepresentation}`;
    const entered = `Z\n\n  ${emptyRepresentation}`;
    const continued = `Z\n\nXY${emptyRepresentation}`;
    const shortened = `Z\n\nX${emptyRepresentation}`;
    const branch = `Z\n\nXYB${emptyRepresentation}`;
    operationStage = 'empty-input-Z'; await page.keyboard.type('Z'); await checkpoint(typed, 1, 0, 1, 1);
    operationStage = 'Enter-after-Z'; await page.keyboard.press('Enter'); await checkpoint(entered, 3, 1, 0, 0);
    operationStage = 'immediate-XY'; await page.keyboard.type('XY'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Backspace-Y'; await page.keyboard.press('Backspace'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'EOF-Delete-noop';
    const beforeNoop = await readPublicEditorState(page);
    await page.keyboard.press('Delete'); await checkpoint(shortened, 4, 1, 1, 1);
    const afterNoop = await readPublicEditorState(page);
    expect(afterNoop.source === beforeNoop.source, 'EOF Delete must preserve the exact source').toBe(true);
    expect(afterNoop.nativeAnchor, 'EOF Delete must preserve the native anchor').toEqual(beforeNoop.nativeAnchor);
    expect(afterNoop.nativeFocus, 'EOF Delete must preserve the native focus').toEqual(beforeNoop.nativeFocus);
    operationStage = 'Undo-Backspace-Y'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Redo-Backspace-Y'; await page.keyboard.press('Control+Shift+z'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'Undo-before-branch'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'branch-B'; await page.keyboard.type('B');
    await checkpoint(branch, 6, 1, 3, 3);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, branch);
    await expectLiveSelection(visual);
    operationStage = 'restore-original-history';
    let restored = false;
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectLiveSelection(visual);
      if (await source.inputValue() === initial) { restored = true; break; }
    }
    expect(restored, 'Normal bounded history must restore the exact original Markdown').toBe(true);
    await expectSource(source, initial);
    operationStage = 'middle-continue-M'; await visual.locator('p').first().click();
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('M');
    await checkpoint('aMbc\n\n', 2, 0, 2, 4);
    await expect(visual).toHaveAttribute('aria-busy', 'false'); await checkpoint('aMbc\n\n', 2, 0, 2, 4, true);
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'empty-Enter-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  }
});

test('explicit Preview lock rejects real keys across formal response and unlock resumes history', async ({ page }) => {
  const initial = 'Alpha.\n\nTarget.\n\nAfter.';
  const typed = 'Alpha.V\n\nTarget.\n\nAfter.';
  const resumed = 'Alpha.VX\n\nTarget.\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [resumed], [typed], [resumed], [typed]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null; let operationStage = 'unlocked-input'; let latestAtom = null;
  const lockedCheckpoint = async () => {
    const state = await sink.evaluate((surface) => {
      const active = surface.ownerDocument.activeElement;
      return {
        contenteditable: surface.getAttribute('contenteditable'), effectiveEditable: surface.isContentEditable,
        activeElementEditable: !!active?.isContentEditable,
        activeElementIsInput: !!active && ['INPUT','TEXTAREA'].includes(active.tagName),
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
        previewPhase: surface.getAttribute('data-easymde-preview-phase'), busy: surface.getAttribute('aria-busy')
      };
    });
    const owner = await readPublicEditorState(page);
    latestAtom = { operationStage, state, owner: { sourceLength: owner.sourceLength,
      nativeConnected: owner.nativeConnected, effectiveEditable: owner.effectiveEditable } };
    console.log(JSON.stringify({ phase: 'user-lock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ effectiveEditable: false, lock: 'true' });
    expect(state.contenteditable).not.toBe('true');
    expect(owner.sourceInputConnected, 'Source edit surface remains independently connected').toBe(true);
    expect(owner.nativeConnected, 'A real native selection remains observable while Preview is locked').toBe(true);
    expect(failures).toEqual([]); await expectSource(source, typed); return state;
  };
  const unlockedCheckpoint = async (expected, caret) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: expected });
    latestAtom = { operationStage, state: { sourceLength: state.sourceLength, phase: state.phase,
      nativeConnected: state.nativeConnected, focused: state.focused, editable: state.editable,
      lock: state.lock, session: state.session, nativeParagraph: state.nativeParagraph } };
    console.log(JSON.stringify({ phase: 'user-unlock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (state.phase === 'ready') expect(state).toMatchObject({ collapsed: true,
      nativeParagraph: { index: 0, bodyOffset: caret, bodyLength: caret } });
    else expect(state).toMatchObject({ collapsed: true });
    return state;
  };
  try {
    await visual.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.type('V');
    await unlockedCheckpoint(typed, 7);
    held = await holdFormalPreview(page); operationStage = 'user-click-lock'; await lock.click();
    await held.waitFor(typed); await lockedCheckpoint();
    operationStage = 'readonly-body-click'; await sink.locator('p').first().click();
    const readonly = await lockedCheckpoint();
    expect(readonly).toMatchObject({ activeElementEditable: false, activeElementIsInput: false });
    for (const [stage, key] of [['readonly-Q','Q'],['readonly-Backspace','Backspace'],['readonly-Enter','Enter']]) {
      operationStage = stage;
      if (key === 'Q') await page.keyboard.type('Q'); else await page.keyboard.press(key);
      await lockedCheckpoint();
    }
    operationStage = 'formal-response-while-locked'; await held.close(); held = null;
    await expect(sink).toHaveAttribute('aria-busy', 'false'); await lockedCheckpoint();
    operationStage = 'user-unlock-direct-X'; await lock.click(); await expect(visual).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.type('X'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Backspace-X'; await page.keyboard.press('Backspace'); await unlockedCheckpoint(typed, 7);
    operationStage = 'Undo-Backspace-X'; await page.keyboard.press('Control+z'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Redo-Backspace-X'; await page.keyboard.press('Control+Shift+z'); await unlockedCheckpoint(typed, 7);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    const final = await unlockedCheckpoint(typed, 7); expect(final.phase).toBe('ready');
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'user-lock-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

test('cross-paragraph keyboard selection replaces exactly the selected source', async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'alpha\n\nbeta');
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'alX');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await page.keyboard.press('Control+z');
  await expectSource(source, 'alpha\n\nbeta');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const reverse of [false, true]) {
  test(`${reverse ? 'reverse' : 'forward'} mouse range preserves both unselected ends`, async ({ page }) => {
    const initial = 'Before.\n\nalpha\n\nbeta\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    const point = async (paragraph) => visual.locator('p').nth(paragraph).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(reverse ? 2 : 1);
    const last = await point(reverse ? 1 : 2);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.type('X');
    expect(failures).toEqual([]);
    await expectSource(source, 'Before.\n\nalXta\n\nAfter.');
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  });
}

test('full cross-block forward mouse replacement preserves P-H2-P history and branching', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const branched = 'Before.\n\nalphaNzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaNQzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [replaced], [initial], [replaced], [initial], [branched], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let operationStage = 'select-forward-mouse';
  let expectedSource = initial;
  const point = async (index, offset) => visual.locator(':scope > p').nth(index).evaluate((row, position) => {
    if (!(row.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = row.ownerDocument.createRange();
    range.setStart(row.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  let latestAtomicState = null;
  let firstAtomicFailure = null;
  const expectNative = async (rangeSelected, offset = 5, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { selected: rangeSelected, offset,
      direction: 'forward', expectedSource });
    latestAtomicState = { operationStage, state: { sourceLength: state.sourceLength, phase: state.phase,
      nativeConnected: state.nativeConnected, focused: state.focused, editable: state.editable,
      lock: state.lock, session: state.session } };
    console.log(JSON.stringify({ phase: 'PH2-assertion-first-atom', ...latestAtomicState }));
    try {
      expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
        editable: true, lock: 'false', session: 'ready' });
      if (requireReady || state.phase === 'ready') {
        expect(state, 'Ready native endpoints must retain their declared source-side meaning').toMatchObject({
          phase: 'ready', anchorMatches: true, focusMatches: true,
          direction: rangeSelected ? 'forward' : 'none', collapsed: !rangeSelected
        });
      } else {
        expect(state, 'A pending Preview must retain a connected native selection').toMatchObject({
          nativeConnected: true
        });
      }
      expect(failures).toEqual([]);
    } catch (error) {
      firstAtomicFailure ??= latestAtomicState;
      throw error;
    }
  };
  const expectCommittedSelection = async () => {
    const owner = await readPublicEditorState(page);
    expect(owner.source === expectedSource, 'The source bridge must retain the exact committed Markdown').toBe(true);
    expect(owner.editable).toBe(true);
    expect(owner.nativeConnected, 'The committed caret stays a real connected native Selection').toBe(true);
    return owner;
  };
  try {
  const first = await point(1, 5);
  const last = await point(2, 1);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 8 });
  await page.mouse.up();
  await expectNative(true, 5);
  // Selection-only native intent is not a canonical transaction. Read its
  // current owner separately; the first committed insertion is asserted below.
  const nativeIntentOwner = await readPublicEditorState(page);
  console.log(JSON.stringify({ phase: 'cross-block-native-intent',
    nativeConnected: nativeIntentOwner.nativeConnected,
    nativeDirection: nativeIntentOwner.nativeDirection,
    selectionTextLength: nativeIntentOwner.selectionTextLength }));
  operationStage = 'replace-M';
  expectedSource = replaced;
  await page.keyboard.type('M');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection();
  operationStage = 'undo-range';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection();
  operationStage = 'redo-M';
  expectedSource = replaced;
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection();
  operationStage = 'undo-before-branch';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection();
  operationStage = 'branch-N';
  expectedSource = branched;
  await page.keyboard.type('N');
  await expectSource(source, branched);
  await expectNative(false, 6);
  await expectCommittedSelection();
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, branched);
  operationStage = 'continue-Q';
  expectedSource = continued;
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await expectNative(false, 7);
  await expectCommittedSelection();
  await expect(visual.locator('h2')).toHaveCount(0);
  await expect(visual.locator(':scope > p').nth(1)).toHaveText('alphaNQzeta');
  await expectNative(false, 7, true);
  await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', operationStage,
      expectedLength: expectedSource.length, firstAtomicFailure, latestAtomicState, errors: failures }));
    throw error;
  }
});

for (const crossBlock of [
  {
    name: 'reverse mouse through nested quotes and ordered task lists',
    action: 'reverse-mouse',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n> outer quote\n> > inVner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionSelector: 'blockquote blockquote p',
    position: 'middle', positionOffset: 2, positionSourceOffset: 37,
    selectionEnd: 89,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  },
  {
    name: 'keyboard Shift through nested lists and a quote',
    action: 'keyboard',
    initial: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> quote\n\nYz',
    positionEdited: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> Vquote\n\nYz',
    positionSelector: 'blockquote p',
    position: 'start', positionOffset: 0, positionSourceOffset: 38,
    selectionEnd: 46,
    replaced: 'Before.\n\nalphaMz',
    branched: 'Before.\n\nalphaNz',
    continued: 'Before.\n\nalphaNQz'
  },
  {
    name: 'forward mouse through a heading and code',
    action: 'forward-mouse',
    initial: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;\n~~~\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;V\n~~~\n\nYzeta\n\nAfter.',
    positionSelector: 'pre code',
    position: 'end', positionOffset: 10, positionSourceOffset: 45,
    selectionEnd: 52,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  }
]) {
for (const transferTiming of crossBlock.action === 'reverse-mouse' ? ['normal', 'held-redo'] : ['normal']) {
test(`full cross-block ${crossBlock.name} preserves exact history and branching${transferTiming === 'held-redo' ? ' with held Redo response' : ''}`, async ({ page }) => {
  const heldRedoContinued = 'Before.\n\nalphaMRzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: transferTiming === 'held-redo'
        ? [[''], [crossBlock.initial], [crossBlock.positionEdited], [crossBlock.initial],
          [crossBlock.replaced], [crossBlock.initial], [crossBlock.replaced], [heldRedoContinued]]
        : [[''], [crossBlock.initial], [crossBlock.positionEdited], [crossBlock.initial],
          [crossBlock.replaced], [crossBlock.initial], [crossBlock.replaced], [crossBlock.initial],
          [crossBlock.branched], [crossBlock.continued]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, crossBlock.initial, undefined, previewRead.beforeFixture);
  let operationStage = `position-${crossBlock.position}`;
  let expectedSource = crossBlock.initial;
  let heldRedo;
  const direction = crossBlock.action === 'reverse-mouse' ? 'backward' : 'forward';
  const expectOwner = async () => {
    const owner = await readPublicEditorState(page);
    expect(owner.source === expectedSource, 'The source bridge must retain the exact committed Markdown').toBe(true);
    expect(owner.editable).toBe(true);
    expect(owner.nativeConnected, 'Committed edits must retain a connected native Selection').toBe(true);
    expect(failures).toEqual([]);
    return owner;
  };
  const expectNative = async (selected, offset = 5, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { selected, offset, direction, expectedSource });
    expect(state, `Active owner and native permission at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, focused: true, editable: true, lock: 'false', session: 'ready', nativeConnected: true
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready native semantic endpoints at ${operationStage}`).toMatchObject({
        phase: 'ready', anchorMatches: true, focusMatches: true,
        direction: selected ? direction : 'none', collapsed: !selected
      });
    } else {
      console.log(JSON.stringify({ phase: 'cross-block-retained-presentation', operationStage,
        phase: state.phase, sourceLength: state.sourceLength, nativeConnected: state.nativeConnected }));
      expect(state, `A pending Preview still requires a connected native selection at ${operationStage}`).toMatchObject({
        nativeConnected: true
      });
    }
    expect(failures).toEqual([]);
    return state;
  };
  const point = async (row, offset) => row.evaluate((element, position) => {
    if (!(element.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = element.ownerDocument.createRange();
    range.setStart(element.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  try {
    await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
    const positionRow = visual.locator(crossBlock.positionSelector);
    await positionRow.click();
    await page.keyboard.press(crossBlock.position === 'end' ? 'End' : 'Home');
    if (crossBlock.position === 'middle') {
      for (let index = 0; index < crossBlock.positionOffset; index += 1) await page.keyboard.press('ArrowRight');
    }
    expectedSource = crossBlock.positionEdited;
    await page.keyboard.type('V');
    await expectSource(source, expectedSource);
    await expectOwner();
    await page.keyboard.press('Control+z');
    expectedSource = crossBlock.initial;
    await expectSource(source, expectedSource);
    await expectOwner();

    operationStage = 'select-cross-block';
    const firstRow = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const lastRow = visual.locator(':scope > p').filter({ hasText: /^Yz(?:eta)?$/u });
    if (crossBlock.action === 'keyboard') {
      await firstRow.click();
      await page.keyboard.press('Home');
      for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Control+Shift+End');
      await page.keyboard.press('Shift+ArrowLeft');
    } else {
      const first = await point(firstRow, 5);
      const last = await point(lastRow, 1);
      const start = direction === 'backward' ? last : first;
      const end = direction === 'backward' ? first : last;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    }
    await expectNative(true, 5);
    const nativeIntentOwner = await readPublicEditorState(page);
    console.log(JSON.stringify({ phase: 'cross-block-native-intent',
      nativeConnected: nativeIntentOwner.nativeConnected,
      nativeDirection: nativeIntentOwner.nativeDirection,
      selectionTextLength: nativeIntentOwner.selectionTextLength }));
    operationStage = 'replace-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.type('M');
    await expectSource(source, expectedSource);
    await expectNative(false, 6); await expectOwner();
    operationStage = 'undo-range'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner();
    if (transferTiming === 'held-redo') heldRedo = await holdFormalPreview(page);
    operationStage = 'redo-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    if (transferTiming === 'held-redo') {
      await expectOwner();
      await heldRedo.waitFor(expectedSource);
      const state = await expectNative(false, 6);
      expect(state).toMatchObject({ nativeConnected: true });
      operationStage = 'held-redo-direct-R';
      expectedSource = 'Before.\n\nalphaMRzeta\n\nAfter.';
      await page.keyboard.type('R');
      expect(failures).toEqual([]);
      await expectSource(source, expectedSource); await expectOwner();
      await heldRedo.close(); heldRedo = null;
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expect(visual.locator(':scope > p').filter({ hasText: /^alphaMRzeta$/u })).toHaveCount(1);
      await expectNative(false, 7, true);
      await expectSource(source, expectedSource); await expectOwner();
      await previewRead.prove({ visual });
      console.log(JSON.stringify({ phase: 'permanent-held-redo-completed', exactSource: true,
        sourceLength: expectedSource.length, finalNativeOffset: 7 }));
      return;
    }
    await expectNative(false, 6); await expectOwner();
    operationStage = 'undo-before-branch'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner();
    operationStage = 'branch-N'; expectedSource = crossBlock.branched;
    await page.keyboard.type('N');
    await expectSource(source, expectedSource);
    await expectNative(false, 6);
    await expectOwner();
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    operationStage = 'continue-Q'; expectedSource = crossBlock.continued;
    await page.keyboard.type('Q');
    await expectSource(source, expectedSource);
    await expectNative(false, 7); await expectOwner();
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expect(visual.locator('h1,h2,h3,pre,blockquote,ul,ol')).toHaveCount(0);
    await expect(visual.locator(':scope > p').filter({ hasText: /^alphaNQz(?:eta)?$/u })).toHaveCount(1);
    await expectNative(false, 7, true);
    await previewRead.prove({ visual });
  } catch (error) {
    const actual = await source.inputValue();
    let firstMismatch = 0;
    while (firstMismatch < Math.min(actual.length, expectedSource.length)
      && actual[firstMismatch] === expectedSource[firstMismatch]) firstMismatch += 1;
    const owner = await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
      editable: state.effectiveEditable, nativeConnected: state.nativeConnected }))
      .catch(() => ({ unavailable: 'public-state-read-failed' }));
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', caseName: crossBlock.name, operationStage,
      actualLength: actual.length, expectedLength: expectedSource.length,
      exactSource: actual === expectedSource, firstMismatch: actual === expectedSource ? null : firstMismatch, owner }));
    throw error;
  } finally { if (heldRedo) await heldRedo.close(); }
});
}
}

for (const listCase of [
  { name: 'star-list', initial: '* a\n* b\n', emptied: '* a\n* \n', removed: '* a\n', continued: '* aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'dash-list', initial: '- a\n- b\n', emptied: '- a\n- \n', removed: '- a\n', continued: '- aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'plus-list', initial: '+ a\n+ b\n', emptied: '+ a\n+ \n', removed: '+ a\n', continued: '+ aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'middle-space-list', initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n',
    removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0 },
  // A CRLF-authored document (Windows line endings) cannot keep its CRLF once it
  // reaches the browser: the HTML input stream and the textarea API value both
  // transform \r\n to \n, and clipboard text/plain is normalised the same way on
  // paste. `pasteFrom` is real CRLF written to the clipboard; `openVisual` pastes
  // it and then asserts the LF form the editor actually receives, so this case
  // verifies the CRLF *input* route plus the empty-row behaviour of the LF
  // document it delivers. No user route can leave CRLF in #easymde-source.
  { name: 'pasted-CRLF-middle-space-list', pasteFrom: '- a\r\n-   \r\n- c\r\n',
    initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n', removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0 },
  { name: 'quoted-list', initial: '> - a\n> - b\n', emptied: '> - a\n> - \n',
    removed: '> - a\n', continued: '> - aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'nested-list', initial: '- outer\n  - a\n  - b\n', emptied: '- outer\n  - a\n  - \n',
    removed: '- outer\n  - a\n', continued: '- outer\n  - aZ\n',
    deleteCharacter: true, itemIndex: 2, itemCount: 3, removedItemCount: 2, precedingItemIndex: 1 }
]) {
test(`full ${listCase.name} Backspace preserves its empty body boundary and preceding caret`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, listCase.initial, listCase.pasteFrom);
  let operationStage = 'select-list-body';
  let expectedSource = listCase.initial;
  const traceStage = (stage) => {
    operationStage = stage;
    if (listCase.name === 'middle-space-list') console.log(JSON.stringify({ phase: 'list-await-stage', stage }));
  };
  const boundedRead = async (operation) => {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('test-list-observation-timeout')), 3000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const sample = async (phase) => {
    const state = await boundedRead(() => readFullCrossBlockState(visual, { list: true, expectedSource: expectedSource }));
    console.log(JSON.stringify({ phase, caseName: listCase.name, operationStage,
      sourceLength: (await source.inputValue()).length, state: safeFullCrossBlockState(state) }));
    return state;
  };
  const expectListState = async (phase, itemCount, itemIndex, bodyOffset, requireReady = false) => {
    const state = await sample(phase);
    expect(state, `List permission and native selection at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, nativeConnected: true, focused: true, editable: true, lock: 'false', session: 'ready' });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready list body at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeList: { itemCount, itemIndex, bodyOffset } });
    } else {
      expect(state, `A pending list Preview keeps the real native selection at ${operationStage}`).toMatchObject({
        nativeConnected: true, collapsed: true });
    }
    expect(failures).toEqual([]);
  };
  const expectSourceOrRefusal = async () => {
    await expect.poll(async () => failures.length ? 'refused'
      : await source.inputValue() === expectedSource ? 'matched' : 'pending').not.toBe('pending');
    expect(failures, 'The first list refusal ends this chain').toEqual([]);
    await expectSource(source, expectedSource);
  };
  try {
    // openVisual checks the complete literal fixture (and, for the pasted-CRLF
    // case, the normalised LF the paste route delivers) before any formal edit.
    // The mouse and End key select its real rendered body.
    traceStage('before-list-click');
    await visual.locator('li').nth(listCase.itemIndex).click({ timeout: 5000 });
    traceStage('after-list-click');
    traceStage('before-list-End');
    await page.keyboard.press('End');
    traceStage('after-list-End');
    if (listCase.deleteCharacter) {
      operationStage = 'delete-list-body-character'; expectedSource = listCase.emptied;
      await page.keyboard.press('Backspace');
      await expectSourceOrRefusal();
      await expectListState('list-body-emptied',
        listCase.itemCount, listCase.itemIndex, 0);
    } else {
      traceStage('before-empty-native-sample');
      const intent = await sample('list-empty-native-intent');
      traceStage('after-empty-native-sample');
      expect(intent).toMatchObject({ phase: 'ready', collapsed: true, nativeConnected: true,
        editable: true, lock: 'false', session: 'ready',
        nativeList: { itemCount: listCase.itemCount, itemIndex: listCase.itemIndex, bodyOffset: 0 } });
      // Selection-only intent does not commit the canonical caret. This source
      // boundary is the declared row the following Backspace must remove.
      console.log(JSON.stringify({ phase: 'list-empty-intended-source-boundary', caseName: listCase.name,
        expectedSourceLength: expectedSource.length }));
    }
    operationStage = 'remove-empty-list-row'; expectedSource = listCase.removed;
    await page.keyboard.press('Backspace');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed',
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'undo-empty-row-removal'; expectedSource = listCase.emptied;
    await page.keyboard.press('Control+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-restored',
      listCase.itemCount, listCase.itemIndex, 0);
    operationStage = 'redo-empty-row-removal'; expectedSource = listCase.removed;
    await page.keyboard.press('Control+Shift+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed-again',
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'continue-at-preceding-row'; expectedSource = listCase.continued;
    await page.keyboard.type('Z');
    await expectSourceOrRefusal();
    await expectListState('list-continued-at-logical-caret',
      listCase.removedItemCount, listCase.precedingItemIndex, 2);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expectListState('list-final-ready-caret',
      listCase.removedItemCount, listCase.precedingItemIndex, 2, true);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'list-original-first-error', caseName: listCase.name, operationStage,
      errorName: error.name, pageClosed: page.isClosed() }));
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        await sample('list-first-failure');
        console.log(JSON.stringify({ phase: 'list-first-source-result', caseName: listCase.name, operationStage,
          exactExpected: actual === expectedSource, actualLength: actual.length, expectedLength: expectedSource.length,
          retainedInitial: actual === listCase.initial, retainedEmptyItem: actual === listCase.emptied }));
      } catch {
        console.log(JSON.stringify({ phase: 'list-first-error-observation-unavailable', operationStage }));
      }
    }
    throw error;
  }
});
}

for (const inlineCase of [
  { name: 'single delimiter', initial: 'Before.\n\nLead `\\*` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead `\\X*` tail.\n\nAfter.', deleted: 'Before.\n\nLead `\\` tail.\n\nAfter.',
    continued: 'Before.\n\nLead `\\Q*` tail.\n\nAfter.', initialBodyLength: 2 },
  { name: 'double delimiter', initial: 'Before.\n\nLead ``\\`*`` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead ``\\X`*`` tail.\n\nAfter.', deleted: 'Before.\n\nLead ``\\*`` tail.\n\nAfter.',
    continued: 'Before.\n\nLead ``\\Q`*`` tail.\n\nAfter.', initialBodyLength: 3 }
]) {
for (const timing of inlineCase.name === 'single delimiter' ? ['held', 'normal'] : ['normal']) {
test(`full inline literal backslash ${inlineCase.name} preserves body input deletion and history${timing === 'held' ? ' held PHP Undo' : ''}`, async ({ page }) => {
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: timing === 'normal'
        ? [[''], [inlineCase.initial], [inlineCase.inserted], [inlineCase.initial],
          [inlineCase.deleted], [inlineCase.initial], [inlineCase.deleted], [inlineCase.initial], [inlineCase.continued]]
        : [[''], [inlineCase.initial], [inlineCase.inserted], [inlineCase.initial],
          [inlineCase.deleted], [inlineCase.initial], [inlineCase.continued]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, inlineCase.initial, undefined, previewRead.beforeFixture);
  let heldPreview = null;
  let operationStage = 'initial-inline-pointer';
  let expectedSource = inlineCase.initial;
  const assertPoint = async (bodyOffset, bodyLength, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { inlineCode: true, expectedSource });
    if (state.phase !== 'ready') console.log(JSON.stringify({ phase: 'inline-pending-checkpoint',
      caseName: inlineCase.name, timing, operationStage, state: safeFullCrossBlockState(state) }));
    expect(state, `Inline permission and native selection at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, nativeConnected: true, focused: true, editable: true,
      lock: 'false', session: 'ready'
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Inline body caret at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeInlineCode: { anchor: { codeIndex: 0, bodyOffset, bodyLength }, focus: { codeIndex: 0, bodyOffset, bodyLength } } });
    } else {
      expect(state, `A pending inline Preview keeps the real native caret at ${operationStage}`).toMatchObject({
        nativeConnected: true, collapsed: true });
    }
    expect(failures).toEqual([]);
    return state;
  };
  try {
    const code = visual.locator('p code');
    await expect(code).toHaveCount(1);
    const point = await code.evaluate((element) => {
      if (!(element.firstChild instanceof Text) || element.firstChild.length < 2) throw new Error('inline-backslash-native-body-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, 1); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    const intent = await assertPoint(1, inlineCase.initialBodyLength);
    console.log(JSON.stringify({ phase: 'inline-backslash-native-intent', caseName: inlineCase.name,
      nativeAnchor: intent.nativeAnchor, nativeFocus: intent.nativeFocus }));
    operationStage = 'insert-X'; expectedSource = inlineCase.inserted;
    await page.keyboard.type('X'); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1);
    operationStage = 'Backspace-X'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Backspace'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength);
    operationStage = 'Delete-following-body-character'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Delete'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1);
    if (timing === 'held') heldPreview = await holdFormalPreview(page);
    operationStage = 'undo-Delete'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    if (heldPreview) {
      await heldPreview.waitFor(inlineCase.initial);
      console.log(JSON.stringify({ phase: 'inline-real-php-200-withheld', sourceLength: inlineCase.initial.length }));
    }
    await assertPoint(1, inlineCase.initialBodyLength);
    if (timing === 'normal') {
    operationStage = 'redo-Delete'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1);
    operationStage = 'undo-before-continuing'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength);
    }
    operationStage = 'continue-Q'; expectedSource = inlineCase.continued;
    await page.keyboard.type('Q'); expect(failures).toEqual([]); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1);
    if (heldPreview) { await heldPreview.close(); heldPreview = null; }
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertPoint(2, inlineCase.initialBodyLength + 1, true);
    await expectSource(source, expectedSource);
    await previewRead.prove({ visual });
    console.log(JSON.stringify({ phase: 'inline-final-ready', caseName: inlineCase.name, timing,
      sourceLength: expectedSource.length,
      codeBodyOffset: 2, codeBodyLength: inlineCase.initialBodyLength + 1, errors: failures.length }));
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        const state = await readFullCrossBlockState(visual, { inlineCode: true });
        console.log(JSON.stringify({ phase: 'inline-backslash-first-failure', caseName: inlineCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource,
          state: safeFullCrossBlockState(state) }));
      } catch { console.log(JSON.stringify({ phase: 'inline-backslash-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally { if (heldPreview) await heldPreview.close(); }
});
}
}

for (const rapidCase of [
  { name: 'nested reverse range', direction: 'backward',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    initialLength: 101, selectionEnd: 89,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' },
  { name: 'P-H2-P forward range', direction: 'forward',
    initial: 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.', initialLength: 42, selectionEnd: 30,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' }
]) {
test(`full rapid MQ ${rapidCase.name} preserves pending history and branching`, async ({ page }) => {
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [rapidCase.initial], [rapidCase.afterM], [rapidCase.afterMQ],
        [rapidCase.afterM], [rapidCase.initial],
        [rapidCase.afterM], [rapidCase.afterMQ],
        [rapidCase.afterM], [rapidCase.initial],
        [rapidCase.afterB], [rapidCase.afterBC]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, rapidCase.initial, undefined, previewRead.beforeFixture);
  let operationStage = 'initial-range-pointer';
  let expectedSource = rapidCase.initial;
  let held;
  let eventsActive = false;
  const sourceForKind = (kind) => {
    if (kind === 'initial') return rapidCase.initial;
    if (kind === 'M') return rapidCase.afterM;
    if (kind === 'MQ') return rapidCase.afterMQ;
    if (kind === 'B') return rapidCase.afterB;
    if (kind === 'BC') return rapidCase.afterBC;
    throw new Error(`rapid-MQ-unknown-kind:${kind}`);
  };
  const assertState = async (kind, requireReady = false) => {
    const selected = kind === 'initial';
    const offset = kind === 'M' || kind === 'B' ? 6 : 7;
    const expected = sourceForKind(kind);
    expectedSource = expected;
    const state = await readFullCrossBlockState(visual, { selected, offset: selected ? 5 : offset,
      direction: rapidCase.direction, expectedSource: expected });
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (requireReady || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready',
      anchorMatches: true, focusMatches: true, direction: selected ? rapidCase.direction : 'none', collapsed: !selected });
    else expect(state).toMatchObject({ nativeConnected: true });
    expect(failures).toEqual([]);
    return state;
  };
  const undoToInitial = async () => {
    const receipts = [];
    for (let step = 0; step < 2; step += 1) {
      await page.keyboard.press('Control+z');
      await expect.poll(async () => {
        if (failures.length) return 'refused';
        const value = await source.inputValue();
        return value === rapidCase.initial ? 'initial' : value === rapidCase.afterM ? 'M' : 'pending';
      }).not.toBe('pending');
      expect(failures).toEqual([]);
      const value = await source.inputValue();
      expect(value === rapidCase.initial || value === rapidCase.afterM).toBe(true);
      const kind = value === rapidCase.initial ? 'initial' : 'M'; receipts.push(kind);
      await assertState(kind);
      if (kind === 'initial') return receipts;
    }
    throw new Error('rapid-MQ-history-did-not-restore-initial');
  };
  try {
    expect(rapidCase.initial.length).toBe(rapidCase.initialLength);
    const first = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const last = visual.locator(':scope > p').filter({ hasText: /^Yzeta$/u });
    const point = (row, offset) => row.evaluate((element, position) => {
      if (!(element.firstChild instanceof Text)) throw new Error('rapid-MQ-native-text-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, position); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    }, offset);
    const head = await point(first, 5), tail = await point(last, 1);
    const start = rapidCase.direction === 'backward' ? tail : head;
    const end = rapidCase.direction === 'backward' ? head : tail;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
    await assertState('initial');
    await visual.evaluate((surface) => {
      const events = [];
      const observe = (event) => {
        if (events.length < 4 && event.inputType === 'insertText') events.push({ type: event.type,
          trusted: event.isTrusted, dataLength: event.data?.length ?? 0 });
      };
      surface.addEventListener('beforeinput', observe, true); surface.addEventListener('input', observe, true);
      window.__rapidMQEvents = { events, dispose: () => {
        surface.removeEventListener('beforeinput', observe, true); surface.removeEventListener('input', observe, true);
      } };
    });
    eventsActive = true;
    operationStage = 'uninterrupted-MQ'; expectedSource = rapidCase.afterMQ;
    // One real keyboard call: no source/Preview read, timer or await between M and Q.
    await page.keyboard.type('MQ');
    await expectSource(source, expectedSource);
    await assertState('MQ');
    const events = await page.evaluate(() => window.__rapidMQEvents.events);
    expect(events.filter((event) => event.type === 'beforeinput')).toEqual([
      { type: 'beforeinput', trusted: true, dataLength: 1 }, { type: 'beforeinput', trusted: true, dataLength: 1 }
    ]);
    console.log(JSON.stringify({ phase: 'rapid-MQ-native-receipt', caseName: rapidCase.name,
      events, exactSource: true, sourceLength: rapidCase.afterMQ.length }));
    await page.evaluate(() => { window.__rapidMQEvents.dispose(); delete window.__rapidMQEvents; }); eventsActive = false;
    operationStage = 'undo-MQ';
    const undo = await undoToInitial(); expectedSource = rapidCase.initial;
    const redo = [...undo.slice(0, -1).reverse(), 'MQ'];
    for (const kind of redo) {
      if (kind === 'MQ') held = await holdFormalPreview(page);
      operationStage = `redo-${kind}`; expectedSource = kind === 'M' ? rapidCase.afterM : rapidCase.afterMQ;
      await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource); await assertState(kind);
    }
    await held.waitFor(rapidCase.afterMQ);
    const pendingState = await assertState('MQ');
    expect(pendingState).toMatchObject({ nativeConnected: true });
    console.log(JSON.stringify({ phase: 'rapid-MQ-real-held-history', caseName: rapidCase.name, undoKeys: undo.length, state: pendingState }));
    operationStage = 'undo-before-branch'; await undoToInitial(); expectedSource = rapidCase.initial;
    operationStage = 'branch-B'; expectedSource = rapidCase.afterB;
    await page.keyboard.type('B'); await expectSource(source, expectedSource);
    await assertState('B');
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    operationStage = 'continue-C'; expectedSource = rapidCase.afterBC;
    await page.keyboard.type('C'); await expectSource(source, expectedSource); await assertState('BC');
    await held.close(); held = null;
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertState('BC', true); await expectSource(source, expectedSource);
    await previewRead.prove({ visual });
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 }); const state = await readFullCrossBlockState(visual);
        console.log(JSON.stringify({ phase: 'rapid-MQ-first-failure', caseName: rapidCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource,
          state: safeFullCrossBlockState(state) }));
      } catch { console.log(JSON.stringify({ phase: 'rapid-MQ-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally {
    if (eventsActive && !page.isClosed()) await page.evaluate(() => { window.__rapidMQEvents?.dispose(); delete window.__rapidMQEvents; });
    if (held) await held.close();
  }
});
}

for (const wrapper of [
  { name: 'code', source: '`x`', selector: 'code' },
  { name: 'emphasis', source: '*x*', selector: 'em' },
  { name: 'strong', source: '**x**', selector: 'strong' },
  { name: 'strike', source: '~~x~~', selector: 'del' },
  { name: 'link', source: '[x](https://example.com)', selector: 'a' },
  { name: 'escaped emphasis', source: '*\\**', selector: 'em' },
  { name: 'entity strong', source: '**&amp;**', selector: 'strong' },
  { name: 'entity link', source: '[&amp;](https://example.com)', selector: 'a' },
  { name: 'space normalized code', source: '` Z `', selector: 'code' },
  { name: 'multi delimiter code', source: '`` ` ``', selector: 'code' }
]) {
for (const key of ['Backspace', 'Delete']) {
for (const position of ['end', 'middle']) {
  test(`deleting the final ${wrapper.name} character with ${key} retires only its inline syntax at ${position}`, async ({ page }) => {
    const initial = `Before.\n\n- Head.\n- Tail ${wrapper.source}${position === 'middle' ? '.suffix.' : ''}\n\nAfter.`;
    const expected = initial.replace(wrapper.source, '');
    const continued = expected.replace('- Tail ', '- Tail Y');
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'lifecycle', groups: [[''], [initial], [expected], [initial], [expected], [continued]] }
    ]);
    const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
    await visual.locator(`li ${wrapper.selector}`).click();
    if (position === 'end') {
      await page.keyboard.press('End');
    } else {
      await page.keyboard.press('Home');
      for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
    }
    if (key === 'Delete') await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(key);
    expect(failures).toEqual([]);
    await expectSource(source, expected);
    await expect(visual.locator(`li ${wrapper.selector}`)).toHaveCount(0);
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expected);
    await page.keyboard.type('Y');
    await expectSource(source, continued);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  });
}
}
}

test('native keyboard selections edit all-space inline code without changing adjacent text', async ({ page }) => {
  const initial = 'Lead` `tail.\n\nAfter.';
  const withoutCode = initial.replace('` `', '');
  const continued = withoutCode.replace('Leadtail.', 'LeadXtail.');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withoutCode], [initial], [withoutCode], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const selectSpaces = async (count) => {
    await visual.locator('p').first().click();
    await page.keyboard.press('Home');
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowRight');
    for (let index = 0; index < count; index += 1) await page.keyboard.press('Shift+ArrowRight');
  };
  await selectSpaces(1);
  expect(await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return range.startContainer === range.endContainer
      && range.startContainer.parentElement?.tagName === 'CODE'
      && range.startOffset === 0 && range.endOffset === 1
      && surface.contains(range.startContainer);
  }), 'native keys select exactly the blank code body').toBe(true);
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, withoutCode);
  await expectLiveSelection(visual);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await page.keyboard.type('X');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

for (const timing of ['normal', 'held']) {
test(`context formatting preserves an unrelated terminal source space through undo and immediate input (${timing} Preview)`, async ({ page }) => {
  const initial = 'Para\n\n---\n\nfoo\n';
  const withSpace = initial.replace('foo\n', 'foo \n');
  const bolded = withSpace.replace('Para', 'P**ar**a');
  const continued = withSpace.replace('Para', 'PZa');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withSpace], [bolded], [withSpace], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let release = () => {};
  let fetched = false;
  let first = true;
  const gate = new Promise((resolve) => { release = resolve; });
  if (timing === 'held') {
    await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      fetched = true;
      await gate;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
      }
    });
  }
  try {
  await visual.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const point = await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !surface.contains(selection.anchorNode)) {
      throw new Error('context-range-unavailable');
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  // A trailing-space-only edit can reuse Preview until context preparation
  // requests fresh mapping, so wait for that actual request after the gesture.
  if (timing === 'held') await expect.poll(() => fetched).toBe(true);
  release();
  const bold = page.locator('[data-easymde-context-menu-item="bold"]').last();
  await expect(bold).toBeEnabled();
  await expectSource(source, withSpace);
  await bold.click();
  expect(failures).toEqual([]);
  await expectSource(source, withSpace.replace('Para', 'P**ar**a'));
  await page.keyboard.press('Control+z');
  await expectSource(source, withSpace);
  await page.keyboard.type('Z');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
  } finally {
    release();
    if (timing === 'held') await page.unrouteAll({ behavior: 'wait' });
  }
});
}

for (const fence of ['~~~', '```']) {
test(`ordinary and immersive split source preserve literal ${fence} fence edits and history`, async ({ page }) => {
  const initial = `${fence}bash\necho 1\n${fence}\n\nAfter.`;
  const { failures, source } = await openVisual(page, initial);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  for (const mode of ['immersive-split', 'ordinary']) {
    if (mode === 'ordinary') {
      await page.getByRole('button', { name: strings.exit, exact: true }).click();
    }
    const editor = page.locator('.easymde-source-react .cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Delete');
    await expectSource(source, initial.slice(1));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    // Shifted character spelling emits the physical shortcut's uppercase key.
    // A lowercase Playwright chord can dispatch Ctrl+z to CodeMirror first.
    await page.keyboard.press('Control+Shift+Z');
    await expectSource(source, initial.slice(1));
    await page.keyboard.type(fence[0]);
    await expectSource(source, initial);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Q');
    await expectSource(source, initial + '\nQ');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  }
});
}

test('a rejected secondary image gesture keeps the authored text range and the generic menu', async ({ page }) => {
  const image = '![test image](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const initial = `Para\n\n${image}\n\nfoo\n`;
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(() => visual.locator('img').evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await visual.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const withSpace = initial.replace('foo\n', 'foo \n');
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const point = await visual.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) throw new Error('authored-range-unavailable');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  await expectSource(source, withSpace);
  await visual.locator('img').click({ button: 'right' });
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.type('Z');
  await expectSource(source, withSpace.replace('Para', 'PZa'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const size of ['full', 'windowed']) {
  test(`${size} rapid input preserves neighboring layout and captured compositor frames`, async ({ page, context }) => {
    const initial = '# Layout reference\n\nTarget paragraph here.\n\nNeighbor paragraph.\n\nAfter paragraph.'
      + (size === 'windowed' ? '\n\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n') : '');
    const { failures, source, visual } = await openVisual(page, initial);
    expect(await visual.locator('[data-easymde-preview-window-spacer]').count() > 0).toBe(size === 'windowed');
    const target = visual.locator('p').filter({ hasText: /^Target paragraph here\.$/u });
    await target.click();
    await page.keyboard.press('End');
    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', (event) => {
      if (frames.length < 32) frames.push(event.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await visual.evaluate((surface) => {
      const heading = surface.querySelector('h1');
      const neighbor = [...surface.querySelectorAll('p')].find((node) => node.textContent === 'Neighbor paragraph.');
      const samples = [];
      let active = true;
      window.__visualLayoutSample = { samples, stop: () => { active = false; } };
      const sample = () => {
        const box = neighbor?.getBoundingClientRect();
        samples.push({
          connected: !!heading?.isConnected && !!neighbor?.isConnected,
          top: box?.top ?? null, height: box?.height ?? null,
          editable: surface.isContentEditable,
          selectionInside: surface.contains(getSelection()?.anchorNode)
        });
        if (active && samples.length < 180) requestAnimationFrame(sample);
      };
      sample();
    });
    try {
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
      await page.keyboard.type('0123456789XYZ');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      const edited = initial.replace('Target paragraph here.', 'Target paragraph here.0123456789');
      await expectSource(source, edited);
      await expectLiveSelection(visual);
      // Include the settled surface and its next painted frames in the observation.
      await expect(visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      await cdp.send('Page.stopScreencast');
      await page.evaluate(() => window.__visualLayoutSample.stop());
    }
    const samples = await page.evaluate(() => window.__visualLayoutSample.samples);
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((sample) => sample.connected && sample.editable && sample.selectionInside)).toBe(true);
    expect(Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height))).toBeLessThanOrEqual(1);
    expect(frames.length, 'actual compositor frames must be available for visual inspection').toBeGreaterThan(1);
    for (let index = 0; index < frames.length; index += 1) {
      const framePath = test.info().outputPath(`compositor-${index}.png`);
      await writeFile(framePath, Buffer.from(frames[index], 'base64'));
      await test.info().attach(`compositor-${index}`, { path: framePath, contentType: 'image/png' });
    }
    await test.info().attach('neighbor-layout-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    console.log(JSON.stringify({ phase: 'bounded-layout-evidence', size,
      frameCount: frames.length, sampleCount: samples.length,
      topSpan: Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top)),
      heightSpan: Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height)) }));
    expect(failures).toEqual([]);
    await cdp.detach();
  });
}

test('paragraph Enter commits a split and accepts immediate input', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'Before.\n\nab\n\nXcdef\n\nAfter.');
  await expectLiveSelection(visual);
});

for (const command of ['delete', 'cut']) {
for (const timing of ['pending', 'settled']) {
  test(`code menu undo restores the input caret with ${timing} Preview (${command})`, async ({ page }) => {
    const initial = 'Before paragraph.\n\n~~~bash\necho one\n~~~\n\nAfter paragraph.';
    const fence = '~~~bash\necho one\n~~~';
    const removed = initial.replace(fence, '');
    const continued = initial.replace('echo one', 'echo oneX');
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'lifecycle', groups: [[''], [initial], [`${fence}\n`, fence], [removed], [initial], [continued]] }
    ]);
    const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
    await visual.locator('pre code').click();
    await page.keyboard.press('End');
    const caret = await page.evaluate(() => {
      const selection = getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { x: rect.x - 1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(caret.x, caret.y, { button: 'right' });
    if (command === 'delete') {
      await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
      await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
    } else {
      await page.locator('[data-easymde-context-menu-item="cut"]').last().click();
    }
    await expectSource(source, initial.replace(fence, ''));
    await expect(visual.locator('pre')).toHaveCount(0);
    await expect(visual).toHaveAttribute('aria-busy', 'false');

    let release;
    let blocked = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    if (timing === 'pending') {
      await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
        || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
        blocked += 1;
        await gate;
        try {
          await route.continue();
        } catch (error) {
          // A superseding edit may abort the held obsolete Preview request.
          if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
        }
      });
    }
    try {
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      if (timing === 'pending') {
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await expect(visual).toHaveAttribute('aria-busy', 'true');
      } else {
        await expect(visual.locator('pre')).toHaveCount(1);
        await expect(visual).toHaveAttribute('aria-busy', 'false');
      }
      // Do not click or restore the caret after Undo: history owns this position.
      await page.keyboard.type('X');
      expect(failures).toEqual([]);
      release();
      await expectSource(source, continued);
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
      await previewRead.prove({ visual });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
}

for (const block of [
  { name: 'paragraph', selector: 'p', markdown: 'abcdef\n\nAfter.' },
  { name: 'heading', selector: 'h1', markdown: '# abcdef\n\nAfter.' },
  { name: 'code body', selector: 'pre code', markdown: 'Before.\n\n~~~bash\nabcdef\n~~~\n\nAfter.' }
]) {
  test(`mixed character edits preserve untouched syntax in ${block.name}`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, block.markdown);
    await visual.locator(block.selector).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('中A7!');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.type('Q');
    await expectSource(source, block.markdown.replace('abcdef', 'ab中Qdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('Chromium composition commits once and remains editable after history', async ({ page, context }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await visual.evaluate((surface) => {
    window.__easymdeTestCompositionEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      surface.addEventListener(type, () => window.__easymdeTestCompositionEvents.push(type));
    }
  });
  const input = await context.newCDPSession(page);
  try {
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    await input.send('Input.insertText', { text: '你' });
    await expectSource(source, initial.replace('abcdef', 'ab你cdef'));
    const events = await page.evaluate(() => window.__easymdeTestCompositionEvents);
    expect(events.filter((event) => event === 'compositionstart')).toHaveLength(1);
    expect(events.filter((event) => event === 'compositionend')).toHaveLength(1);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.type('X');
    await expectSource(source, initial.replace('abcdef', 'abXcdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  } finally {
    await input.detach();
  }
});

test('plain paragraph middle input undo preserves its original visual caret', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await expectSource(source, initial.replace('abcdef', 'abXcdef'));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.type('Y');
  await expectSource(source, initial.replace('abcdef', 'abYcdef'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('incoming formal Preview preserves newer keyboard input during history transfer', async ({ page }) => {
  const initial = 'Before.\n\n~~~bash\necho one\n~~~\n\nAfter.';
  const fence = '~~~bash\necho one\n~~~';
  const removed = initial.replace(fence, '');
  const withB = initial.replace('echo one', 'echo oneB');
  const withBC = initial.replace('echo one', 'echo oneBC');
  const withBCD = initial.replace('echo one', 'echo oneBCD');
  const withBCDE = initial.replace('echo one', 'echo oneBCDE');
  const withBCDEF = initial.replace('echo one', 'echo oneBCDEF');
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [`${fence}\n`, fence], [removed], [initial],
        [withB], [withBC], [withBCD], [withBCDE], [withBCDEF],
        [withBCDE], [withBCD], [withBC], [withB], [initial],
        [withB], [withBC], [withBCD], [withBCDE], [withBCDEF]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await visual.locator('pre code').click();
  await page.keyboard.press('End');
  const caret = await page.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x - 1, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(caret.x, caret.y, { button: 'right' });
  await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
  await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
  await expectSource(source, initial.replace('~~~bash\necho one\n~~~', ''));
  await expect(visual.locator('pre')).toHaveCount(0);
  await expect(visual).toHaveAttribute('aria-busy', 'false');
  let fetched = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    fetched = true;
    try {
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response.dispose();
    }
  });
  try {
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expect.poll(() => fetched).toBe(true);
    await page.keyboard.type('BC');
    // Deliver the actual older PHP response during newer keyboard input.
    release();
    await page.keyboard.type('DE');
    expect(failures).toEqual([]);
    await expectSource(source, initial.replace('echo one', 'echo oneBCDE'));
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.type('F');
    await expectSource(source, initial.replace('echo one', 'echo oneBCDEF'));
    await expectLiveSelection(visual);
    const completed = await source.inputValue();
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 12) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) await page.keyboard.press('Control+Shift+z');
    await expectSource(source, completed);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const character of ['👩🏽‍💻', 'e\u0301']) {
  test(`native character selection preserves Unicode ${character}`, async ({ page }) => {
    const initial = `Before.\n\nA${character}Z\n\nAfter.`;
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(character);
    await page.keyboard.press('Backspace');
    await expectSource(source, 'Before.\n\nAZ\n\nAfter.');
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

function windowedMarkdown(tail) {
  const filler = Array.from(
    { length: 170 },
    (_, index) => `Filler ${index + 1}.`
  ).join('\n\n');
  return `Head.\n\n${filler}\n\n${tail}`;
}

function createRichFixtureBuilder() {
  const parts = [];
  let sourceLength = 0, domIndex = 0;
  const add = (kind, text, metadata = {}) => {
    const part = { kind, text, sourceStart: sourceLength, sourceEnd: sourceLength + text.length, ...metadata };
    sourceLength = part.sourceEnd;
    parts.push(part);
    return part;
  };
  const separator = (text = '\n\n') => add('separator', text, { dom: null, deletion: 'held-policy' });
  const block = (kind, text, tag, metadata = {}) => add(kind, text, {
    contentStart: sourceLength,
    contentEnd: sourceLength + text.length,
    dom: { blockId: `b${domIndex++}`, tag },
    ...metadata
  });
  return {
    add,
    separator,
    block,
    build: (metadata = {}) => ({ initial: parts.map((part) => part.text).join(''), parts, ...metadata })
  };
}

function richWindowedFixture(imageKind = 'inline') {
  const inlineImage = '![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const image = imageKind === 'linked' ? `[${inlineImage}](https://example.com)`
    : imageKind === 'reference' ? '![dot][pic]' : inlineImage;
  const { add, separator, block, build } = createRichFixtureBuilder();
  if (imageKind === 'reference') {
    const definition = add('definition', '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png', {
      dom: null, deletion: 'held-policy'
    });
    definition.contentStart = definition.sourceStart;
    definition.contentEnd = definition.sourceEnd;
    separator();
  }
  block('heading', '# Head', 'H1', { deletion: 'known-heading', headingPrefix: '# ' });
  separator();
  for (let index = 0; index < 12; index += 1) {
    block('paragraph', 'Repeated paragraph.', 'P', { deletion: 'ascii-grapheme', plainText: true });
    separator();
  }
  for (let index = 0; index < 154; index += 1) {
    block('paragraph', `Paragraph ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    separator();
  }
  block('heading', '## Tail heading', 'H2', { deletion: 'known-heading', headingPrefix: '## ' });
  separator();
  block('list', '- outer\n  - inner\n  - inner two', 'UL', { deletion: 'known-list' });
  separator();
  block('quote', '> quoted tail line', 'BLOCKQUOTE', { deletion: 'known-quote', quotePrefix: '> ' });
  separator();
  block('code', '```python\nvalue = 1\n```', 'PRE', { deletion: 'known-code-fence' });
  separator();
  block('code', '~~~bash\necho one\n~~~', 'PRE', { deletion: 'known-code-fence' });
  separator();
  block('table', '| left | right |\n| --- | --- |\n| a | b |', 'TABLE', { deletion: 'known-table-menu' });
  separator();
  block('mixed-paragraph', 'Math $x^2$ and [link](https://example.com).', 'P', { deletion: 'known-mixed-paragraph' });
  separator();
  block('atom', image, 'P', { deletion: 'known-whole-atom', atom: 'image' });
  separator();
  block('atom', '```mermaid\ngraph TD\n  A --> B\n```', 'DIV', { deletion: 'known-whole-atom', atom: 'mermaid' });
  separator('\n');
  return build({ image });
}

function richPartDeletionStates(part) {
  if (part.deletion === 'known-whole-atom') {
    return [[part.text]];
  }
  if (part.deletion === 'ascii-grapheme' && part.plainText === true) {
    const states = [];
    for (let length = part.text.length; length >= 1; length -= 1) {
      states.push([part.text.slice(0, length)]);
    }
    return states;
  }
  if (part.deletion === 'known-heading') {
    const prefix = part.headingPrefix ?? part.text.match(/^#{1,6}\s+/u)?.[0] ?? '';
    const body = part.text.slice(prefix.length);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([prefix + body.slice(0, length)]);
    }
    states.push([prefix, prefix.trimEnd()]);
    return states;
  }
  if (part.deletion === 'known-quote') {
    const prefix = part.quotePrefix ?? '> ';
    const body = part.text.slice(prefix.length);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([prefix + body.slice(0, length)]);
    }
    states.push([prefix, prefix.trimEnd()]);
    return states;
  }
  if (part.deletion === 'known-code-fence') {
    const firstNewline = part.text.indexOf('\n');
    const lastNewline = part.text.lastIndexOf('\n');
    if (firstNewline < 0 || lastNewline <= firstNewline) {
      throw new Error('rich-deletion-oracle-uncovered:invalid-code-fence');
    }
    const opening = part.text.slice(0, firstNewline + 1);
    const body = part.text.slice(firstNewline + 1, lastNewline);
    const closing = part.text.slice(lastNewline + 1);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([`${opening}${body.slice(0, length)}\n${closing}`]);
    }
    states.push([`${opening}\n${closing}`, `${opening}${closing}`]);
    return states;
  }
  if (part.deletion === 'known-list') {
    const lines = part.text.split('\n');
    const states = [];
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const match = lines[lineIndex].match(/^(\s*[-*+]\s+)(.*)$/u);
      if (!match) throw new Error('rich-deletion-oracle-uncovered:invalid-list-line');
      const [, marker, body] = match;
      const linePrefix = lines.slice(0, lineIndex).join('\n') + (lineIndex > 0 ? '\n' : '');
      for (let length = body.length; length >= 1; length -= 1) {
        states.push([`${linePrefix}${marker}${body.slice(0, length)}`]);
      }
      states.push([`${linePrefix}${marker}`, `${linePrefix}${marker.trimEnd()}`]);
    }
    return states;
  }
  if (part.deletion === 'known-mixed-paragraph') {
    const text = part.text;
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const rest = text.slice(index);
      const imageMatch = rest.match(/^!\[[^\]]*\]\([^)]*\)/u);
      if (imageMatch) {
        tokens.push({ kind: 'atom', text: imageMatch[0] });
        index += imageMatch[0].length;
        continue;
      }
      const mathMatch = rest.match(/^\$[^$]+\$/u);
      if (mathMatch) {
        tokens.push({ kind: 'atom', text: mathMatch[0] });
        index += mathMatch[0].length;
        continue;
      }
      const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/u);
      if (linkMatch) {
        tokens.push({ kind: 'link', label: linkMatch[1], url: linkMatch[2], text: linkMatch[0] });
        index += linkMatch[0].length;
        continue;
      }
      tokens.push({ kind: 'char', text: text[index] });
      index += 1;
    }
    const states = [];
    for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
      const prefix = tokens.slice(0, tokenIndex).map((token) => token.text).join('');
      const token = tokens[tokenIndex];
      if (token.kind === 'link') {
        for (let length = token.label.length; length >= 1; length -= 1) {
          states.push([`${prefix}[${token.label.slice(0, length)}](${token.url})`]);
        }
      } else {
        states.push([prefix + token.text]);
      }
    }
    return states;
  }
  if (part.deletion === 'known-table-menu') {
    const lines = part.text.split('\n');
    if (lines.length !== 3) throw new Error('rich-deletion-oracle-uncovered:invalid-table');
    const parseRow = (line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
    const [h0, h1] = parseRow(lines[0]);
    const divider = lines[1];
    const [b0, b1] = parseRow(lines[2]);
    const cellVariants = (value) => (value === '' ? ['  ', ' ', ''] : [` ${value} `]);
    const rowVariants = (left, right) => {
      const rows = [];
      for (const l of cellVariants(left)) {
        for (const r of cellVariants(right)) rows.push(`|${l}|${r}|`);
      }
      return rows;
    };
    const tableVariants = (ch0, ch1, cb0, cb1) => {
      const variants = [];
      for (const head of rowVariants(ch0, ch1)) {
        for (const body of rowVariants(cb0, cb1)) variants.push(`${head}\n${divider}\n${body}`);
      }
      return variants;
    };
    const states = [tableVariants(h0, h1, b0, b1)];
    for (let length = b1.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1, b0, b1.slice(0, length)));
    }
    for (let length = b0.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1, b0.slice(0, length), ''));
    }
    for (let length = h1.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1.slice(0, length), '', ''));
    }
    for (let length = h0.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0.slice(0, length), '', '', ''));
    }
    return states;
  }
  throw new Error(`rich-deletion-oracle-uncovered:${part.deletion ?? part.kind}`);
}

const RICH_STRUCTURED_DELETION_POLICIES = new Set([
  'known-whole-atom',
  'known-mixed-paragraph',
  'known-table-menu',
  'known-code-fence',
  'known-quote',
  'known-list',
  'known-heading'
]);

const RICH_TRAILING_ENDINGS = ['', '\n', '\n\n', '\n\n\n', '\n\n\n\n'];
const RICH_EMPTY_ROWS = ['', ' ', '  ', '\n', '\n\n'];

function richPreviousBlockPartIndex(parts, partIndex) {
  for (let index = partIndex - 1; index >= 0; index -= 1) {
    if (parts[index]?.dom) return index;
  }
  return -1;
}

function richFixturePrefix(parts, partIndex) {
  return parts.slice(0, partIndex).map((part) => part.text).join('');
}

function richWindowedForwardGroups(fixture) {
  const groups = [];
  const blockIndexes = fixture.parts
    .map((part, index) => (part.dom ? index : -1))
    .filter((index) => index >= 0);
  for (let position = blockIndexes.length - 1; position >= 0; position -= 1) {
    const partIndex = blockIndexes[position];
    const part = fixture.parts[partIndex];
    const prefix = fixture.initial.slice(0, part.sourceStart);
    for (const variants of richPartDeletionStates(part)) {
      const group = [];
      for (const variant of variants) {
        for (const ending of RICH_TRAILING_ENDINGS) group.push(prefix + variant + ending);
      }
      groups.push(group);
    }
    groups.push(RICH_EMPTY_ROWS.map((empty) => prefix + empty));
  }
  groups.push([...RICH_EMPTY_ROWS]);
  return groups;
}

function createRichDeletionModel(fixture) {
  const cursorPartIndex = fixture.parts.findLastIndex((part) => part.dom
    || part.deletion === 'known-empty-structure' || part.deletion === 'known-whole-unit');
  const part = fixture.parts[cursorPartIndex];
  if (!part) throw new Error('rich-deletion-oracle-uncovered:empty-fixture');
  return {
    source: fixture.initial,
    parts: fixture.parts,
    cursor: { partIndex: cursorPartIndex,
      offset: part.dom ? part.contentEnd - part.contentStart : 0 }
  };
}

// The selected fixture unit, never the observed diff, owns the exact removal range.
// Ambiguous, distant-atom, and unresolved special-character cases remain uncovered.
function richCaretDescriptorMatches(actual, expected) {
  if (!actual || !expected) return false;
  if (expected.liveOnly === true) {
    return actual.connected === true && actual.collapsed === true
      && actual.focused === true && actual.editable === true;
  }
  return actual.connected === true && actual.collapsed === true && actual.focused === true
    && actual?.editable === true && actual?.blockId === expected.blockId
    && actual?.blockTag === expected.blockTag && actual?.textOffset === expected.textOffset
    && actual?.blockLength === expected.blockLength;
}

function richDeletionObservationMatches(step, observation, phase) {
  const before = phase === 'before';
  if (typeof step?.matchesSource === 'function') {
    return {
      sourceExact: !!observation && step.matchesSource(observation.source, phase),
      caretExact: richCaretDescriptorMatches(observation?.caret, before ? step?.beforeCaret : step?.afterCaret)
    };
  }
  return {
    sourceExact: !!observation && observation.source === (before ? step?.beforeSource : step?.afterSource),
    caretExact: richCaretDescriptorMatches(observation?.caret, before ? step?.beforeCaret : step?.afterCaret)
  };
}

function buildRichStructuredStep(model, part) {
  const partIndex = model.cursor.partIndex;
  const prefix = richFixturePrefix(model.parts, partIndex);
  const prevBlockIndex = richPreviousBlockPartIndex(model.parts, partIndex);
  const prevEndPrefix = prevBlockIndex >= 0 ? richFixturePrefix(model.parts, prevBlockIndex + 1) : '';
  const ranked = new Map();
  const addRank = (source, rank) => ranked.set(source, Math.max(ranked.get(source) ?? -1, rank));
  const states = richPartDeletionStates(part);
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const rank = (states.length - stateIndex) * 10 + 10;
    for (const variant of states[stateIndex]) {
      for (const ending of RICH_TRAILING_ENDINGS) addRank(prefix + variant + ending, rank);
    }
  }
  for (const empty of RICH_EMPTY_ROWS) addRank(prefix + empty, 5);
  const retiredSources = new Set();
  for (const ending of RICH_TRAILING_ENDINGS) {
    const retired = prevEndPrefix + ending;
    retiredSources.add(retired);
    addRank(retired, 1);
  }
  if (prevBlockIndex >= 0) {
    const prevPart = model.parts[prevBlockIndex];
    const prevPrefix = richFixturePrefix(model.parts, prevBlockIndex);
    const prevStates = richPartDeletionStates(prevPart);
    if (prevStates.length > 1) {
      for (const variant of prevStates[1]) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          const nextInPrev = prevPrefix + variant + ending;
          retiredSources.add(nextInPrev);
          addRank(nextInPrev, 0);
        }
      }
    }
  }
  const beforeRank = ranked.get(model.source) ?? -1;
  return {
    policy: part.deletion,
    removeStart: part.sourceStart,
    removeEnd: part.sourceEnd,
    beforeSource: model.source,
    afterSource: prevEndPrefix,
    beforeCaret: { liveOnly: true },
    afterCaret: { liveOnly: true },
    nextCursor: prevBlockIndex >= 0
      ? { partIndex: prevBlockIndex, offset: model.parts[prevBlockIndex].contentEnd - model.parts[prevBlockIndex].contentStart }
      : { partIndex: 0, offset: 0 },
    matchesSource: (observed, phase) => {
      if (typeof observed !== 'string') return false;
      if (phase === 'before') return observed === model.source && beforeRank >= 0;
      const afterRank = ranked.get(observed);
      return afterRank !== undefined && afterRank <= beforeRank;
    },
    resolveNextCursor: (observedAfterSource) => {
      if (prevBlockIndex >= 0 && retiredSources.has(observedAfterSource)) {
        const prevPart = model.parts[prevBlockIndex];
        const prevPrefix = richFixturePrefix(model.parts, prevBlockIndex);
        if (prevPart.deletion === 'ascii-grapheme' && prevPart.plainText === true) {
          const remainder = observedAfterSource.startsWith(prevPrefix)
            ? observedAfterSource.slice(prevPrefix.length).replace(/\n+$/u, '')
            : prevPart.text;
          return { partIndex: prevBlockIndex, offset: Math.min(remainder.length, prevPart.text.length) };
        }
        return { partIndex: prevBlockIndex, offset: prevPart.contentEnd - prevPart.contentStart };
      }
      return { partIndex, offset: model.cursor.offset };
    }
  };
}

function expectedRichDeletionStep(model) {
  const part = model.parts[model.cursor.partIndex];
  if (!part || part.sourceStart === undefined || part.sourceEnd === undefined) {
    throw new Error('rich-deletion-oracle-uncovered:missing-unit');
  }
  const beforeCaret = {
    blockId: part.dom?.blockId ?? null,
    blockTag: part.dom?.tag ?? null,
    textOffset: model.cursor.offset,
    blockLength: part.plainText ? model.cursor.offset : part.dom ? part.contentEnd - part.contentStart : null
  };
  if (part.deletion === 'ascii-grapheme' && part.plainText === true) {
    const prefix = richFixturePrefix(model.parts, model.cursor.partIndex);
    const exactNoTrailing = model.source === prefix + part.text.slice(0, model.cursor.offset);
    if (model.cursor.offset > 0 && exactNoTrailing && (model.cursor.offset > 1 || model.parts.length === 1)) {
      // The construction cursor fixes the removable byte range. For "aba" at
      // offset 3 it removes [2,3), producing "ab"; an observed "ba" cannot pass.
      const content = model.source.slice(part.contentStart, part.contentEnd);
      const textPrefix = content.slice(0, model.cursor.offset);
      const last = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(textPrefix)].at(-1)?.segment;
      if (!last || last.length !== 1 || last.codePointAt(0) > 0x7f) {
        throw new Error('rich-deletion-oracle-uncovered:special-character-policy');
      }
      const removeStart = part.contentStart + model.cursor.offset - last.length;
      const nextOffset = model.cursor.offset - last.length;
      return {
        removeStart,
        removeEnd: part.contentStart + model.cursor.offset,
        beforeSource: model.source,
        afterSource: model.source.slice(0, removeStart) + model.source.slice(part.contentStart + model.cursor.offset),
        beforeCaret,
        afterCaret: { ...beforeCaret, textOffset: nextOffset, blockLength: nextOffset },
        nextCursor: { partIndex: model.cursor.partIndex, offset: nextOffset }
      };
    }
    const structured = buildRichStructuredStep(model, part);
    return {
      ...structured,
      resolveNextCursor: (observedAfterSource) => {
        const next = structured.resolveNextCursor(observedAfterSource);
        if (next.partIndex !== model.cursor.partIndex) return next;
        if (observedAfterSource.startsWith(prefix)) {
          const tail = observedAfterSource.slice(prefix.length).replace(/\n+$/u, '');
          if (part.text.startsWith(tail)) return { partIndex: model.cursor.partIndex, offset: tail.length };
          return { partIndex: model.cursor.partIndex, offset: 0 };
        }
        return next;
      }
    };
  }
  if (part.deletion === 'known-whole-unit' || part.deletion === 'known-empty-structure') {
    return {
      removeStart: part.sourceStart,
      removeEnd: part.sourceEnd,
      beforeSource: model.source,
      afterSource: model.source.slice(0, part.sourceStart) + model.source.slice(part.sourceEnd),
      beforeCaret,
      afterCaret: part.afterCaret ?? null,
      nextCursor: part.nextCursor ?? null
    };
  }
  if (RICH_STRUCTURED_DELETION_POLICIES.has(part.deletion)) {
    return buildRichStructuredStep(model, part);
  }
  throw new Error(`rich-deletion-oracle-uncovered:${part.deletion ?? part.kind}`);
}

function commitRichDeletion(model, step, observedSource = null) {
  const nextSource = typeof observedSource === 'string' ? observedSource : step.afterSource;
  model.source = nextSource;
  const nextCursor = typeof step.resolveNextCursor === 'function'
    ? step.resolveNextCursor(nextSource)
    : step.nextCursor;
  if (!nextCursor) throw new Error('rich-deletion-oracle-uncovered:missing-next-caret');
  model.cursor = nextCursor;
}

function commitRichTableDeletion(model, afterTableSource) {
  const prevBlockIndex = richPreviousBlockPartIndex(model.parts, model.cursor.partIndex);
  model.source = afterTableSource;
  if (prevBlockIndex >= 0) {
    const prevPart = model.parts[prevBlockIndex];
    model.cursor = {
      partIndex: prevBlockIndex,
      offset: prevPart.contentEnd - prevPart.contentStart
    };
  }
}

function richCaretContractObservation(part, offset, blockLength = offset, overrides = {}) {
  return { connected: true, collapsed: true, focused: true, editable: true,
    blockId: part.dom.blockId, blockTag: part.dom.tag, textOffset: offset,
    blockLength, ...overrides };
}

test('[oracle-contract] rich fixture construction keeps inline and reference ranges declared', () => {
  for (const imageKind of ['inline', 'reference']) {
    const fixture = richWindowedFixture(imageKind);
    const contiguous = fixture.parts.every((part, index) => part.sourceStart === (fixture.parts[index - 1]?.sourceEnd ?? 0)
      && part.sourceEnd === part.sourceStart + part.text.length
      && fixture.initial.slice(part.sourceStart, part.sourceEnd) === part.text);
    expect(contiguous, `fixture parts must be contiguous for ${imageKind}`).toBe(true);
    if (imageKind === 'reference') {
      const definition = fixture.parts.find((part) => part.kind === 'definition');
      expect(definition?.contentStart === definition?.sourceStart
        && definition?.contentEnd === definition?.sourceEnd).toBe(true);
    }
  }
});

test('[oracle-contract] rich ASCII tail fixes the final byte and rejects a same-glyph wrong occurrence', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  fixtureBuilder.block('paragraph', 'aba', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build();
  const model = createRichDeletionModel(fixture);
  const step = expectedRichDeletionStep(model);
  expect(step.afterSource === 'ab').toBe(true);
  expect(step.afterCaret?.textOffset === 2).toBe(true);
  const correct = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(fixture.parts[0], 2) }, 'after');
  expect(correct).toEqual({ sourceExact: true, caretExact: true });
  const wrongOccurrence = richDeletionObservationMatches(step,
    { source: 'ba', caret: richCaretContractObservation(fixture.parts[0], 2) }, 'after');
  expect(wrongOccurrence).toEqual({ sourceExact: false, caretExact: true });
});

test('[oracle-contract] rich native proof rejects a wrong block, tag, length, or offset', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  fixtureBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build(), part = fixture.parts[0];
  const step = expectedRichDeletionStep(createRichDeletionModel(fixture));
  const correct = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1) }, 'after');
  expect(correct).toEqual({ sourceExact: true, caretExact: true });
  const wrongBlock = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 1, { blockId: 'b-other' }) }, 'after');
  const wrongOffset = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 0, 1) }, 'after');
  const wrongTag = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 1, { blockTag: 'DIV' }) }, 'after');
  const wrongLength = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 2) }, 'after');
  expect({ wrongBlock, wrongOffset, wrongTag, wrongLength }).toEqual({
    wrongBlock: { sourceExact: true, caretExact: false },
    wrongOffset: { sourceExact: true, caretExact: false },
    wrongTag: { sourceExact: true, caretExact: false },
    wrongLength: { sourceExact: true, caretExact: false }
  });
});

test('[oracle-contract] rich undeclared remote atom, earlier punctuation, and missing proof are rejected', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  const remoteAtom = fixtureBuilder.block('atom', '![dot](/remote.png)', 'P', { deletion: 'held-policy', atom: 'image' });
  const remoteMermaid = fixtureBuilder.block('atom', '```mermaid\ngraph TD\nA --> B\n```', 'DIV', {
    deletion: 'held-policy', atom: 'mermaid'
  });
  const earlierBlank = fixtureBuilder.separator('\n');
  const earlierPunctuation = fixtureBuilder.separator('!!');
  fixtureBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build(), tail = fixture.parts.at(-1);
  const step = expectedRichDeletionStep(createRichDeletionModel(fixture));
  const selectedTailRange = step.removeStart === tail.contentStart + 1 && step.removeEnd === tail.contentEnd;
  const remoteRangeRejected = remoteAtom.sourceEnd <= step.removeStart
    && remoteMermaid.sourceEnd <= step.removeStart
    && earlierBlank.sourceEnd <= step.removeStart
    && earlierPunctuation.sourceEnd <= step.removeStart
    && !(step.removeStart === remoteAtom.sourceStart && step.removeEnd === remoteAtom.sourceEnd);
  const correctCaret = richCaretContractObservation(tail, 1);
  const sourceWithoutRange = (range) => fixture.initial.slice(0, range.sourceStart) + fixture.initial.slice(range.sourceEnd);
  const wrongSourceResults = [earlierBlank, earlierPunctuation, remoteAtom, remoteMermaid].map((range) =>
    richDeletionObservationMatches(step, { source: sourceWithoutRange(range), caret: correctCaret }, 'after').sourceExact);
  const missingCaret = richDeletionObservationMatches(step, { source: step.afterSource, caret: null }, 'after');
  expect({ selectedTailRange, remoteRangeRejected,
    wrongSourcesRejected: wrongSourceResults.every((value) => value === false),
    missingCaretRejected: missingCaret.sourceExact === true && missingCaret.caretExact === false }).toEqual({
    selectedTailRange: true, remoteRangeRejected: true, wrongSourcesRejected: true, missingCaretRejected: true });

  const missingBuilder = createRichFixtureBuilder();
  missingBuilder.block('paragraph', 'ab', 'P', { plainText: true });
  let missingCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(missingBuilder.build())); }
  catch (error) { missingCode = error.message; }
  expect(missingCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);

  const missingRangeBuilder = createRichFixtureBuilder();
  missingRangeBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const missingRangeFixture = missingRangeBuilder.build();
  missingRangeFixture.parts[0].sourceStart = undefined;
  let missingRangeCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(missingRangeFixture)); }
  catch (error) { missingRangeCode = error.message; }
  expect(missingRangeCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);

  const atomBuilder = createRichFixtureBuilder();
  atomBuilder.block('atom', '![dot](/remote.png)', 'P', { deletion: 'held-policy', atom: 'image' });
  let atomCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(atomBuilder.build())); }
  catch (error) { atomCode = error.message; }
  expect(atomCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);
});

test('[oracle-contract] history cursor and exit predicate handle duplicate grouping without inventing depth', async () => {
  const witnessA = { collapsed: true, direction: 'none', anchor: { column: 1 }, focus: { column: 1 } };
  const witnessB = { collapsed: true, direction: 'none', anchor: { column: 2 }, focus: { column: 2 } };
  const witnessC = { collapsed: true, direction: 'none', anchor: { column: 3 }, focus: { column: 3 } };
  const states = [{ value: 'A', witness: witnessA }, { value: 'B', witness: witnessB },
    { value: 'A', witness: witnessA }, { value: 'C', witness: witnessC }];
  const first = shortStageNextHistoryCursor(states, new Set([3]), states[2], 'undo');
  const second = shortStageNextHistoryCursor(states, first, states[1], 'undo');
  const redoToDuplicate = shortStageNextHistoryCursor(states, new Set([1]), states[2], 'redo');
  const redoFinal = shortStageNextHistoryCursor(states, redoToDuplicate, states[3], 'redo');
  const unknownSource = shortStageNextHistoryCursor(states, new Set([3]), { value: 'X', witness: witnessA }, 'undo');
  const wrongWitness = shortStageNextHistoryCursor(states, new Set([3]), { value: 'A', witness: witnessC }, 'undo');
  const wrongDirection = shortStageNextHistoryCursor(states, new Set([3]), states[3], 'redo');
  const duplicateUndoCursor = new Set([0, 2]);
  const duplicateUndoCursorBefore = [...duplicateUndoCursor];
  const duplicateInitialExit = shortStageHistoryExit(states, duplicateUndoCursor, states[0], 'undo', true);
  const groupedIntermediateExit = shortStageHistoryExit(states, first, states[0], 'undo', false);
  const finalRedoExit = shortStageHistoryExit(states, redoFinal, states[3], 'redo', true);
  const redoAfterDuplicateUndo = shortStageNextHistoryCursor(states, duplicateUndoCursor, states[1], 'redo');
  const redoAfterDuplicateUndoFinal = shortStageNextHistoryCursor(states, redoAfterDuplicateUndo, states[3], 'redo');
  const redoDuplicateStates = [
    { value: 'A', witness: witnessA }, { value: 'B', witness: witnessB },
    { value: 'C', witness: witnessC }, { value: 'B', witness: witnessB }
  ];
  const redoDuplicateCursor = shortStageNextHistoryCursor(redoDuplicateStates, new Set([0]), redoDuplicateStates[3], 'redo');
  const redoDuplicateExit = shortStageHistoryExit(
    redoDuplicateStates, redoDuplicateCursor, redoDuplicateStates[3], 'redo', true
  );
  const missingBoundaryExit = shortStageHistoryExit(states, new Set([2]), states[0], 'undo', true);
  const mixedCursorExit = shortStageHistoryExit(states, new Set([0, 1]), states[0], 'undo', true);
  const wrongWitnessBoundaryExit = shortStageHistoryExit(
    states, new Set([0, 2]), { value: 'A', witness: witnessB }, 'undo', true
  );
  const unknownTargetExit = shortStageHistoryExit(
    states, duplicateUndoCursor, { value: 'X', witness: witnessA }, 'undo', true
  );
  const emptyCursorExit = shortStageHistoryExit(states, new Set(), states[0], 'undo', true);
  const outOfBoundsCursorExit = shortStageHistoryExit(states, new Set([4]), states[0], 'undo', true);
  const wrongDirectionExit = shortStageHistoryExit(states, new Set([3]), states[3], 'undo', true);
  const missingBoundaryWitnessExit = shortStageHistoryExit(
    states, new Set([0]), { value: 'A', witness: null }, 'undo', true
  );
  const phaseModel = shortStagePhaseModel('ordinary');
  const phaseSamples = new Map([[phaseModel.phaseIds.fixture, [phaseModel.initial]]]);
  phaseModel.positions.forEach((position, index) => phaseSamples.set(
    phaseModel.phaseIds.positions[index],
    [phaseModel.initial, position.insertedSource, phaseModel.initial]
  ));
  phaseSamples.set(phaseModel.phaseIds.deletion, [phaseModel.initial]);
  phaseSamples.set(phaseModel.phaseIds.emptyExtraBackspace, ['']);
  phaseSamples.set(phaseModel.phaseIds.reentry, [
    phaseModel.branchBase, phaseModel.entered, phaseModel.shortened,
    phaseModel.continued, phaseModel.shortened
  ]);
  phaseSamples.set(phaseModel.phaseIds.fullUndo, [phaseModel.initial, phaseModel.positions[0].insertedSource]);
  phaseSamples.set(phaseModel.phaseIds.fullRedo, [phaseModel.positions[0].insertedSource, phaseModel.initial]);
  phaseSamples.set(phaseModel.phaseIds.branchToZ, [phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.branchInput, [phaseModel.branchBase, phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.invalidRedo, [phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.undoBranch, [phaseModel.branch, phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.redoBranch, [phaseModel.branchBase, phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.undoBranchAgain, [phaseModel.branch, phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.restoreInitial, [
    phaseModel.branchBase, phaseModel.positions[0].insertedSource, phaseModel.initial
  ]);
  phaseSamples.set(phaseModel.phaseIds.middleQ, [phaseModel.initial, phaseModel.middleQSource]);
  phaseSamples.set(phaseModel.phaseIds.middleQUndo, [phaseModel.middleQSource, phaseModel.initial]);
  const runPhasedModel = (overrides = {}) => {
    const harness = createPreviewLedgerHarness();
    const operationId = harness.ledger.beginPhased({
      postId: PREVIEW_LEDGER_POST_ID,
      renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
      phases: phaseModel.phases
    });
    phaseModel.phases.forEach((phase, index) => {
      if (index > 0) harness.ledger.enterPhase(operationId, phase.id);
      for (const source of overrides[phase.id] ?? phaseSamples.get(phase.id)) {
        observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({
          source,
          renderParams: PREVIEW_LEDGER_RENDER_PARAMS
        }));
      }
    });
    return { harness, proof: harness.ledger.prove(operationId, { finalUiVerified: true }) };
  };
  const phasedValid = runPhasedModel();
  const phasedUndoToEmpty = runPhasedModel({ [phaseModel.phaseIds.fullUndo]: [phaseModel.initial, ''] });
  const phasedForeignPosition = runPhasedModel({
    [phaseModel.phaseIds.middleQ]: [phaseModel.positions[0].insertedSource]
  });
  const phasedBackwardRestore = runPhasedModel({
    [phaseModel.phaseIds.restoreInitial]: [
      phaseModel.branchBase,
      phaseModel.positions[0].insertedSource,
      phaseModel.positions[1].insertedSource
    ]
  });
  const replayWitness = (column) => ({
    collapsed: true,
    direction: 'none',
    anchor: { kind: 'visual', connected: true, blockOrdinal: 0, column, blockLength: 1 },
    focus: { kind: 'visual', connected: true, blockOrdinal: 0, column, blockLength: 1 }
  });
  const replayA = { value: 'history A', witness: replayWitness(1) };
  const replayB = { value: 'history B', witness: replayWitness(2) };
  const replayC = { value: 'history C', witness: replayWitness(3) };
  const replayState = (model, {
    accepted = '1', busy = 'false', editable = true, failureAbsent = true, lock = 'false',
    nativeConnected = true, phase = 'ready', repairCount = 0, session = 'ready', stickyFailure = false,
    codeCertificate = model.codeCertificate ?? null, previewCommitPending = false, stable = true
  } = {}) => ({
    source: model.value,
    witness: model.witness,
    codeCertificate,
    accepted,
    busy,
    editable,
    failureAbsent,
    lock,
    nativeConnected,
    phase,
    repairCount,
    session,
    stickyFailure,
    previewCommitPending,
    stable
  });
  const pendingReplayState = replayState({
    value: replayA.value,
    witness: replayWitness(0)
  }, { accepted: null, busy: 'true', phase: 'loading' });
  const pendingSafeEntryState = replayState(replayB, {
    accepted: null, busy: 'true', phase: 'loading'
  });
  const cancelledReplayState = replayState(replayA, {
    accepted: null, failureAbsent: false, phase: 'error', stickyFailure: true
  });
  const corruptReplayState = replayState({ value: 'history corrupt', witness: replayWitness(8) });
  const stickyFailureReplayState = replayState(replayA, { stickyFailure: true });
  const runReplayContract = async ({
    completionStates,
    cursor = { undo: new Set([1]), redo: null },
    direction = 'undo',
    historyStates = [replayA, replayB],
    unexpectedSettledError = null,
    entryState = null,
    trace = null
  }) => {
    const history = {
      states: historyStates.map((state) => ({ ...state })),
      initial: historyStates[0].value,
      latest: historyStates.at(-1),
      cursor: { undo: new Set(cursor.undo), redo: cursor.redo === null ? null : new Set(cursor.redo) }
    };
    const initialIndex = direction === 'undo' ? [...history.cursor.undo][0] : [...history.cursor.redo][0];
    let current = { value: historyStates[initialIndex].value, witness: historyStates[initialIndex].witness,
      codeCertificate: historyStates[initialIndex].codeCertificate ?? null };
    let pressCount = 0;
    let entryReads = 0;
    let postKeyReads = 0;
    let sourceReads = 0;
    let witnessReads = 0;
    let settledIndex = 0;
    const updateTrace = () => {
      if (trace) Object.assign(trace, { pressCount, entryReads, postKeyReads, sourceReads, witnessReads });
    };
    const stage = { mode: 'full', source: { inputValue: async () => {
      sourceReads += 1; updateTrace(); return current.value;
    } } };
    const probe = {
      guard: () => {},
      press: async () => {
        pressCount += 1;
        updateTrace();
        current = { value: completionStates[0].source, witness: completionStates[0].witness,
          codeCertificate: completionStates[0].codeCertificate ?? null };
      },
      settledState: async () => {
        if (pressCount === 0) {
          entryReads += 1;
          updateTrace();
          return entryState ?? replayState(current);
        }
        postKeyReads += 1;
        updateTrace();
        if (unexpectedSettledError) throw unexpectedSettledError;
        const state = completionStates[Math.min(settledIndex, completionStates.length - 1)];
        settledIndex += 1;
        current = { value: state.source, witness: state.witness,
          codeCertificate: state.codeCertificate ?? null };
        return state;
      },
      witness: async () => { witnessReads += 1; updateTrace(); return current.witness; }
    };
    try {
      const next = await shortStageReplayHistory({}, stage, probe, history, direction);
      return { cursor: [...next], resolved: true, pressCount, entryReads, postKeyReads, sourceReads, witnessReads };
    } catch (error) {
      if (typeof error?.message !== 'string' || !/^short-stage-[a-z-]+$/u.test(error.message)) throw error;
      return { code: error.message, resolved: false, pressCount, entryReads, postKeyReads, sourceReads, witnessReads };
    }
  };
  const replayPendingCorrect = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState]
  });
  const replayPendingSafeEntry = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState],
    entryState: pendingSafeEntryState
  });
  const replayCancelled = await runReplayContract({
    completionStates: [pendingReplayState, cancelledReplayState]
  });
  const replayPendingNeverCompletes = await runReplayContract({
    completionStates: [pendingReplayState]
  });
  const replayStaleReady = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayB), replayState(replayB)]
  });
  const replayWrongSource = await runReplayContract({
    completionStates: [
      pendingReplayState,
      replayState({ value: 'history X', witness: replayWitness(1) }),
      corruptReplayState
    ]
  });
  const replayWrongWitness = await runReplayContract({
    completionStates: [
      pendingReplayState,
      replayState({ value: replayA.value, witness: replayWitness(9) }),
      corruptReplayState
    ]
  });
  const replayWrongDirection = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState],
    cursor: { undo: new Set([2]), redo: new Set([1]) },
    direction: 'redo',
    historyStates: [replayA, replayB, replayC]
  });
  const replayFailureRecovery = await runReplayContract({
    completionStates: [
      replayState(replayA, { accepted: null, failureAbsent: false, phase: 'error', stickyFailure: true }),
      replayState(replayA),
      replayState(replayA)
    ]
  });
  const replayStickyFailure = await runReplayContract({
    completionStates: [stickyFailureReplayState, replayState(replayA)]
  });
  // A ready-looking read taken before the formal Preview commit (or while the
  // surface is still moving between frames) is pending, never a history step.
  const replayPreviewCommitPending = await runReplayContract({
    completionStates: [replayState(replayA, { previewCommitPending: true }), replayState(replayA), corruptReplayState]
  });
  const replayUnstableRead = await runReplayContract({
    completionStates: [replayState(replayA, { stable: false }), replayState(replayA), corruptReplayState]
  });
  const replayPreviewCommitNeverCompletes = await runReplayContract({
    completionStates: [replayState(replayA, { previewCommitPending: true })]
  });
  const unexpectedSettledError = new TypeError('synthetic replay fixture error');
  const unexpectedTrace = {};
  let unexpectedRethrown = false;
  let unexpectedIdentityPreserved = false;
  try {
    await runReplayContract({
      completionStates: [replayState(replayA), replayState(replayA)],
      unexpectedSettledError,
      trace: unexpectedTrace
    });
  } catch (error) {
    unexpectedRethrown = error instanceof TypeError;
    unexpectedIdentityPreserved = error === unexpectedSettledError;
  }
  const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
  expect({
    firstExact: sameSet(first, new Set([0, 2])),
    secondExact: sameSet(second, new Set([1])),
    redoDuplicateExact: sameSet(redoToDuplicate, new Set([2])),
    redoFinalExact: sameSet(redoFinal, new Set([3])),
    unknownSourceEmpty: unknownSource.size === 0,
    wrongWitnessEmpty: wrongWitness.size === 0,
    wrongDirectionEmpty: wrongDirection.size === 0,
    duplicateInitialAccepted: duplicateInitialExit.exit === true && duplicateInitialExit.uncovered === false,
    duplicateCursorPreserved: sameSet(duplicateUndoCursor, new Set([0, 2]))
      && JSON.stringify([...duplicateUndoCursor]) === JSON.stringify(duplicateUndoCursorBefore),
    redoAfterDuplicateUndoExact: sameSet(redoAfterDuplicateUndo, new Set([1])),
    redoAfterDuplicateUndoFinalExact: sameSet(redoAfterDuplicateUndoFinal, new Set([3])),
    redoDuplicateCursorExact: sameSet(redoDuplicateCursor, new Set([1, 3])),
    redoDuplicateAccepted: redoDuplicateExit.exit === true && redoDuplicateExit.uncovered === false,
    missingBoundaryUncovered: missingBoundaryExit.exit === false && missingBoundaryExit.uncovered === true,
    mixedCursorRejected: mixedCursorExit.exit === false,
    wrongWitnessBoundaryRejected: wrongWitnessBoundaryExit.exit === false,
    unknownTargetRejected: unknownTargetExit.exit === false,
    emptyCursorRejected: emptyCursorExit.exit === false,
    outOfBoundsCursorRejected: outOfBoundsCursorExit.exit === false,
    wrongDirectionUncovered: wrongDirectionExit.exit === false && wrongDirectionExit.uncovered === true,
    missingBoundaryWitnessRejected: missingBoundaryWitnessExit.exit === false,
    groupedIntermediateAccepted: groupedIntermediateExit.exit === true && groupedIntermediateExit.uncovered === false,
    finalRedoAccepted: finalRedoExit.exit === true && finalRedoExit.uncovered === false,
    phasedValidApproved: phasedValid.proof.approved,
    phasedValidCount: phasedValid.proof.approvedAbortCount,
    phasedValidIssues: phasedValid.harness.issues,
    positionSelectorIndexPairs: phaseModel.positions.map((position) => [position.selector, position.index]),
    positionPhaseIndexes: phaseModel.positions.map((position) => position.phaseIndex),
    phaseIdsUnique: new Set(phaseModel.phases.map((phase) => phase.id)).size === phaseModel.phases.length,
    phasedUndoToEmptyRejected: phasedUndoToEmpty.proof.approved === false
      && phasedUndoToEmpty.proof.code === 'preview-read-operation-group-order-invalid',
    phasedForeignPositionRejected: phasedForeignPosition.proof.approved === false
      && phasedForeignPosition.proof.code === 'preview-read-operation-other-source',
    phasedBackwardRestoreRejected: phasedBackwardRestore.proof.approved === false
      && phasedBackwardRestore.proof.code === 'preview-read-operation-group-order-invalid',
    replayPendingCorrectResolved: replayPendingCorrect.resolved,
    replayPendingCorrectCursor: replayPendingCorrect.cursor,
    replayPendingCorrectPresses: replayPendingCorrect.pressCount,
    replayPendingCorrectEntryReads: replayPendingCorrect.entryReads,
    replayPendingCorrectPostKeyReads: replayPendingCorrect.postKeyReads,
    replayPendingCorrectAtomicEntry: replayPendingCorrect.sourceReads === 0 && replayPendingCorrect.witnessReads === 0,
    replayPendingSafeEntry: replayPendingSafeEntry.resolved === true
      && JSON.stringify(replayPendingSafeEntry.cursor) === JSON.stringify([0])
      && replayPendingSafeEntry.pressCount === 1 && replayPendingSafeEntry.entryReads === 1
      && replayPendingSafeEntry.postKeyReads === 2,
    replayCancelledUnsafe: replayCancelled.resolved === false
      && replayCancelled.code === 'short-stage-history-full-operation-unsafe' && replayCancelled.pressCount === 1,
    replayPendingNeverCompletesPending: replayPendingNeverCompletes.resolved === false
      && replayPendingNeverCompletes.code === 'short-stage-history-full-operation-pending'
      && replayPendingNeverCompletes.pressCount === 1,
    replayStaleReadyNoChange: replayStaleReady.resolved === false
      && replayStaleReady.code === 'short-stage-history-full-operation-nochange'
      && replayStaleReady.pressCount === 1,
    replayWrongSourceUnobserved: replayWrongSource.resolved === false
      && replayWrongSource.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongSource.pressCount === 1
      && replayWrongSource.postKeyReads === 2,
    replayWrongWitnessUnobserved: replayWrongWitness.resolved === false
      && replayWrongWitness.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongWitness.pressCount === 1
      && replayWrongWitness.postKeyReads === 2,
    replayWrongDirectionUnobserved: replayWrongDirection.resolved === false
      && replayWrongDirection.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongDirection.pressCount === 1
      && replayWrongDirection.postKeyReads === 2,
    replayFailureRecoveryUnsafe: replayFailureRecovery.resolved === false
      && replayFailureRecovery.code === 'short-stage-history-full-operation-unsafe'
      && replayFailureRecovery.pressCount === 1,
    replayStickyFailureUnsafe: replayStickyFailure.resolved === false
      && replayStickyFailure.code === 'short-stage-history-full-operation-unsafe'
      && replayStickyFailure.pressCount === 1 && replayStickyFailure.postKeyReads === 1,
    replayPreviewCommitPendingWaits: replayPreviewCommitPending.resolved === true
      && JSON.stringify(replayPreviewCommitPending.cursor) === JSON.stringify([0])
      && replayPreviewCommitPending.pressCount === 1 && replayPreviewCommitPending.postKeyReads === 2,
    replayUnstableReadWaits: replayUnstableRead.resolved === true
      && JSON.stringify(replayUnstableRead.cursor) === JSON.stringify([0])
      && replayUnstableRead.pressCount === 1 && replayUnstableRead.postKeyReads === 2,
    replayPreviewCommitNeverCompletesPending: replayPreviewCommitNeverCompletes.resolved === false
      && replayPreviewCommitNeverCompletes.code === 'short-stage-history-full-operation-pending'
      && replayPreviewCommitNeverCompletes.pressCount === 1,
    replayUnexpectedRethrown: unexpectedRethrown,
    replayUnexpectedIdentityPreserved: unexpectedIdentityPreserved,
    replayUnexpectedSingleRead: unexpectedTrace.pressCount === 1 && unexpectedTrace.entryReads === 1
      && unexpectedTrace.postKeyReads === 1 && unexpectedTrace.sourceReads === 0 && unexpectedTrace.witnessReads === 0
  }).toEqual({
    firstExact: true, secondExact: true, redoDuplicateExact: true, redoFinalExact: true,
    unknownSourceEmpty: true, wrongWitnessEmpty: true, wrongDirectionEmpty: true,
    duplicateInitialAccepted: true, duplicateCursorPreserved: true,
    redoAfterDuplicateUndoExact: true, redoAfterDuplicateUndoFinalExact: true,
    redoDuplicateCursorExact: true, redoDuplicateAccepted: true,
    missingBoundaryUncovered: true, mixedCursorRejected: true, wrongWitnessBoundaryRejected: true,
    unknownTargetRejected: true, emptyCursorRejected: true, outOfBoundsCursorRejected: true,
    wrongDirectionUncovered: true, missingBoundaryWitnessRejected: true,
    groupedIntermediateAccepted: true, finalRedoAccepted: true,
    phasedValidApproved: true, phasedValidCount: 0, phasedValidIssues: [],
    positionSelectorIndexPairs: [['p', 0], ['h1', 0], ['p', 1], ['pre code', 0], ['p', 2]],
    positionPhaseIndexes: [0, 1, 2, 3, 4], phaseIdsUnique: true,
    phasedUndoToEmptyRejected: true, phasedForeignPositionRejected: true,
    phasedBackwardRestoreRejected: true,
    replayPendingCorrectResolved: true, replayPendingCorrectCursor: [0], replayPendingCorrectPresses: 1,
    replayPendingCorrectEntryReads: 1, replayPendingCorrectPostKeyReads: 2,
    replayPendingCorrectAtomicEntry: true, replayPendingSafeEntry: true, replayCancelledUnsafe: true,
    replayPendingNeverCompletesPending: true, replayStaleReadyNoChange: true,
    replayWrongSourceUnobserved: true, replayWrongWitnessUnobserved: true,
    replayWrongDirectionUnobserved: true, replayFailureRecoveryUnsafe: true,
    replayStickyFailureUnsafe: true, replayPreviewCommitPendingWaits: true, replayUnstableReadWaits: true,
    replayPreviewCommitNeverCompletesPending: true, replayUnexpectedRethrown: true,
    replayUnexpectedIdentityPreserved: true, replayUnexpectedSingleRead: true
  });
});

test('[oracle-contract] certified code history treats only the closing renderer LF as representation-only', () => {
  const codeBlockOrdinal = shortStageBlocks.findIndex((block) => block.kind === 'code');
  expect(codeBlockOrdinal, 'the declared fixture owns one code block').toBeGreaterThanOrEqual(0);
  const codeBlock = shortStageBlocks[codeBlockOrdinal];
  const body = codeBlock.body.join('');
  const prefix = shortStageBlocks.slice(0, codeBlockOrdinal)
    .map((block) => block.source).join('\n\n') + '\n\n';
  const source = `${prefix}${codeBlock.source}\n`;
  const descriptor = shortStageDeclaredCodeDescriptors.get(source);
  expect(descriptor?.body, 'the exact source has one declared code body').toBe(body);
  const point = (blockLength, column = body.length) => ({
    kind: 'visual', connected: true, inside: true, lineIndex: null,
    blockOrdinal: codeBlockOrdinal, column,
    blockLength, surfaceOffset: null
  });
  const witness = (blockLength, {
    collapsed = true, direction = 'none', anchorColumn = body.length, focusColumn = body.length
  } = {}) => ({
    collapsed, direction, anchor: point(blockLength, anchorColumn), focus: point(blockLength, focusColumn)
  });
  const certifyCode = createShortStageCodeCertifier();
  const certificate = (domText, overrides = {}) => certifyCode({
    source, descriptor, sourceDeclared: true, codeCandidate: true, domText,
    prePresent: true, preOrdinal: 0,
    observedBlockOrdinal: descriptor.blockOrdinal, observedCodeOrdinal: descriptor.codeOrdinal,
    preChildCount: 1, preDirectCode: true, codeInsidePre: true,
    blockConnected: true, preConnected: true, codeConnected: true,
    blockOwnsPre: true, preInsideSurface: true,
    nativeCollapsed: true, nativeDirection: 'none',
    anchorLocal: body.length, focusLocal: body.length,
    anchorPrefix: body, focusPrefix: body,
    ...overrides
  });
  const literalState = { value: source, witness: witness(body.length),
    codeCertificate: certificate(body) };
  const closingLfState = { value: source, witness: witness(body.length + 1),
    codeCertificate: certificate(`${body}\n`) };
  expect(literalState.codeCertificate?.valid, 'literal code representation is certified').toBe(true);
  expect(closingLfState.codeCertificate?.valid, 'literal plus the declared closing LF is certified').toBe(true);
  expect(JSON.stringify(literalState.witness) === JSON.stringify(closingLfState.witness)).toBe(false);
  expect(shortStageStateMatches(literalState, closingLfState)).toBe(true);
  expect(shortStageObservedStateChanged(literalState, {
    source: closingLfState.value, witness: closingLfState.witness,
    codeCertificate: closingLfState.codeCertificate
  }), 'representation-only LF is not source progress').toBe(false);
  const backwardOverrides = {
    nativeCollapsed: false, nativeDirection: 'backward',
    anchorLocal: body.length, focusLocal: 0,
    anchorPrefix: body, focusPrefix: ''
  };
  const backwardLiteralState = {
    value: source,
    witness: witness(body.length, { collapsed: false, direction: 'backward', anchorColumn: body.length, focusColumn: 0 }),
    codeCertificate: certificate(body, backwardOverrides)
  };
  const backwardClosingLfState = {
    value: source,
    witness: witness(body.length + 1, { collapsed: false, direction: 'backward', anchorColumn: body.length, focusColumn: 0 }),
    codeCertificate: certificate(`${body}\n`, backwardOverrides)
  };
  expect(backwardLiteralState.codeCertificate?.valid, 'backward range in literal code is certified').toBe(true);
  expect(backwardClosingLfState.codeCertificate?.valid, 'backward range in closing-LF code is certified').toBe(true);
  expect(shortStageStateMatches(backwardLiteralState, backwardClosingLfState),
    'identical backward range matches across literal and closing-LF representations').toBe(true);
  expect(shortStageObservedStateChanged(backwardLiteralState, {
    source: backwardClosingLfState.value, witness: backwardClosingLfState.witness,
    codeCertificate: backwardClosingLfState.codeCertificate
  }), 'representation-only LF under a backward range is not source progress').toBe(false);
  const forwardOverrides = {
    nativeCollapsed: false, nativeDirection: 'forward',
    anchorLocal: 0, focusLocal: body.length,
    anchorPrefix: '', focusPrefix: body
  };
  const forwardLiteralState = {
    value: source,
    witness: witness(body.length, { collapsed: false, direction: 'forward', anchorColumn: 0, focusColumn: body.length }),
    codeCertificate: certificate(body, forwardOverrides)
  };
  const forwardClosingLfState = {
    value: source,
    witness: witness(body.length + 1, { collapsed: false, direction: 'forward', anchorColumn: 0, focusColumn: body.length }),
    codeCertificate: certificate(`${body}\n`, forwardOverrides)
  };
  expect(forwardLiteralState.codeCertificate?.valid, 'forward range in literal code is certified').toBe(true);
  expect(forwardClosingLfState.codeCertificate?.valid, 'forward range in closing-LF code is certified').toBe(true);
  expect(shortStageStateMatches(forwardLiteralState, forwardClosingLfState),
    'identical forward range matches across literal and closing-LF representations').toBe(true);
  expect(shortStageStateMatches(backwardLiteralState, forwardClosingLfState),
    'backward and forward ranges cannot match').toBe(false);
  expect(shortStageStateMatches(backwardLiteralState, literalState),
    'ranged selection cannot match collapsed caret').toBe(false);
});

test('[oracle-contract] certified code observer rejects forged body, caret, structure, and provenance', () => {
  const certifyCode = createShortStageCodeCertifier();
  const descriptorFixture = (blocks) => {
    const blockOrdinal = blocks.findIndex((block) => block.kind === 'code');
    expect(blockOrdinal, 'declared model owns a code block').toBeGreaterThanOrEqual(0);
    const codeBlock = blocks[blockOrdinal];
    const prefix = blocks.slice(0, blockOrdinal).map((block) => block.source).join('\n\n')
      + (blockOrdinal ? '\n\n' : '');
    const source = `${prefix}${codeBlock.source}\n`;
    return { source, descriptor: shortStageBuildCodeDescriptors(blocks).get(source) };
  };
  const fixture = descriptorFixture(shortStageBlocks);
  const body = fixture.descriptor?.body;
  expect(typeof body, 'fixture code body is declared').toBe('string');
  const evidence = (overrides = {}) => ({
    source: fixture.source, descriptor: fixture.descriptor, sourceDeclared: true,
    codeCandidate: true, domText: body,
    prePresent: true, preOrdinal: 0,
    observedBlockOrdinal: fixture.descriptor.blockOrdinal,
    observedCodeOrdinal: fixture.descriptor.codeOrdinal,
    preChildCount: 1, preDirectCode: true, codeInsidePre: true,
    blockConnected: true, preConnected: true, codeConnected: true,
    blockOwnsPre: true, preInsideSurface: true,
    nativeCollapsed: true, nativeDirection: 'none',
    anchorLocal: body.length, focusLocal: body.length,
    anchorPrefix: body, focusPrefix: body,
    ...overrides
  });
  const validCertificate = certifyCode(evidence());
  expect(validCertificate?.valid, 'declared closed-code observation is certified').toBe(true);
  const replacement = `${body.slice(0, -1)}${body.at(-1) === 'x' ? 'y' : 'x'}`;
  const rawPoint = (blockLength = body.length) => ({
    kind: 'visual', connected: true, inside: true, lineIndex: null,
    blockOrdinal: fixture.descriptor.blockOrdinal, column: body.length,
    blockLength, surfaceOffset: null
  });
  const rawWitness = (blockLength = body.length) => ({
    collapsed: true, direction: 'none', anchor: rawPoint(blockLength), focus: rawPoint(blockLength)
  });
  const forgedReplacement = certifyCode(evidence({ domText: replacement, anchorPrefix: replacement,
    focusPrefix: replacement }));
  expect(forgedReplacement?.valid, 'same-length replacement is rejected').toBe(false);
  expect(shortStageStateMatches(
    { value: fixture.source, witness: rawWitness(), codeCertificate: validCertificate },
    { value: fixture.source, witness: rawWitness(), codeCertificate: forgedReplacement }
  ), 'invalid same-length code evidence cannot pass through equal raw lengths').toBe(false);
  const missingBody = certifyCode(evidence({ domText: body.slice(0, -1),
    anchorPrefix: body.slice(0, -1), focusPrefix: body.slice(0, -1) }));
  expect(missingBody?.valid, 'missing body byte is rejected').toBe(false);
  const twoLfs = certifyCode(evidence({ domText: `${body}\n\n` }));
  expect(twoLfs?.valid, 'two renderer LFs are rejected').toBe(false);
  const trailingSpace = certifyCode(evidence({ domText: `${body} ` }));
  expect(trailingSpace?.valid, 'arbitrary trailing whitespace is rejected').toBe(false);
  const afterRendererLf = certifyCode(evidence({ domText: `${body}\n`,
    anchorPrefix: `${body}\n`, focusPrefix: `${body}\n`, anchorLocal: body.length + 1,
    focusLocal: body.length + 1 }));
  expect(afterRendererLf?.valid, 'caret after the closing renderer LF is rejected').toBe(false);
  const reverse = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'backward',
    anchorPrefix: body.slice(0, -1), focusPrefix: body }));
  expect(reverse?.valid, 'contradictory backward range order is rejected').toBe(false);
  const contradictoryForward = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'forward',
    anchorPrefix: body, focusPrefix: body.slice(0, -1) }));
  expect(contradictoryForward?.valid, 'contradictory forward range order is rejected').toBe(false);
  const emptyUncollapsed = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'forward',
    anchorPrefix: body, focusPrefix: body }));
  expect(emptyUncollapsed?.valid, 'non-collapsed empty range is rejected').toBe(false);
  const collapsedWrongDirection = certifyCode(evidence({ nativeCollapsed: true, nativeDirection: 'backward',
    anchorPrefix: body, focusPrefix: body }));
  expect(collapsedWrongDirection?.valid, 'collapsed selection with non-none direction is rejected').toBe(false);
  const rangeAfterRendererLf = certifyCode(evidence({ domText: `${body}\n`,
    nativeCollapsed: false, nativeDirection: 'backward',
    anchorPrefix: `${body}\n`, focusPrefix: '', anchorLocal: body.length + 1, focusLocal: 0 }));
  expect(rangeAfterRendererLf?.valid, 'ranged endpoint after the closing renderer LF is rejected').toBe(false);
  const crossBlock = certifyCode(evidence({ prePresent: false, preChildCount: 0,
    preDirectCode: false, codeInsidePre: false, observedBlockOrdinal: null,
    observedCodeOrdinal: null, anchorPrefix: null, focusPrefix: null }));
  expect(crossBlock?.valid, 'cross-block or missing PRE evidence is rejected').toBe(false);
  const wrongBlock = certifyCode(evidence({
    observedBlockOrdinal: fixture.descriptor.blockOrdinal + 1
  }));
  expect(wrongBlock?.valid, 'same-text wrong block is rejected').toBe(false);
  const extraPreText = certifyCode(evidence({ preChildCount: 2, preDirectCode: false }));
  expect(extraPreText?.valid, 'extra PRE text or wrong tag is rejected').toBe(false);
  const differentSource = certifyCode(evidence({
    source: `${fixture.source.slice(0, -1)}${fixture.source.at(-1) === 'x' ? 'y' : 'x'}`,
    sourceDeclared: false
  }));
  expect(differentSource?.valid, 'non-declared source is rejected').toBe(false);
  const missingProof = certifyCode(evidence({ descriptor: null, sourceDeclared: false }));
  expect(missingProof?.valid, 'missing descriptor proof is rejected').toBe(false);
  const internalBlocks = [{
    kind: 'code', source: '~~~\nab\ncd\n~~~', body: [...'ab', '\n', ...'cd']
  }];
  const internalFixture = descriptorFixture(internalBlocks);
  const internalBody = internalFixture.descriptor?.body;
  expect(typeof internalBody, 'internal-LF fixture body is declared').toBe('string');
  const internalLoss = certifyCode({
    ...evidence({
      source: internalFixture.source, descriptor: internalFixture.descriptor,
      observedBlockOrdinal: internalFixture.descriptor.blockOrdinal,
      observedCodeOrdinal: internalFixture.descriptor.codeOrdinal
    }),
    domText: internalBody.replace('\n', ''), anchorPrefix: internalBody.replace('\n', ''),
    focusPrefix: internalBody.replace('\n', '')
  });
  expect(internalLoss?.valid, 'internal body LF loss is rejected').toBe(false);
  const terminalBodyLfBlocks = [{
    kind: 'code', source: '~~~\nline\n\n~~~', body: [...'line', '\n']
  }];
  const terminalBodyLfFixture = descriptorFixture(terminalBodyLfBlocks);
  expect(typeof terminalBodyLfFixture.descriptor?.body, 'terminal-LF fixture body is declared').toBe('string');
  const terminalBodyLfLoss = certifyCode({
    ...evidence({
      source: terminalBodyLfFixture.source, descriptor: terminalBodyLfFixture.descriptor,
      observedBlockOrdinal: terminalBodyLfFixture.descriptor.blockOrdinal,
      observedCodeOrdinal: terminalBodyLfFixture.descriptor.codeOrdinal
    }),
    domText: terminalBodyLfFixture.descriptor.body.slice(0, -1),
    anchorPrefix: terminalBodyLfFixture.descriptor.body.slice(0, -1),
    focusPrefix: terminalBodyLfFixture.descriptor.body.slice(0, -1)
  });
  expect(terminalBodyLfLoss?.valid, 'real terminal body LF loss is rejected').toBe(false);
  const ambiguous = shortStageUniqueCodeDeclarations([
    { source: 'ambiguous-source', descriptor: { body: 'one' } },
    { source: 'ambiguous-source', descriptor: { body: 'two' } }
  ]);
  expect(ambiguous.has('ambiguous-source'), 'ambiguous source declaration is not certifiable').toBe(false);
});

const MONITOR_CONTRACT_ORIGIN = 'http://monitor.synthetic.invalid';
const MONITOR_CONTRACT_HTML = '<!doctype html><html><body data-monitor-contract="synthetic">synthetic</body></html>';
const PREVIEW_LEDGER_POST_ID = 9717;
const PREVIEW_LEDGER_RENDER_PARAMS = Object.freeze({
  markdown_theme: 'monitor-contract-markdown-theme',
  code_theme: 'monitor-contract-code-theme',
  custom_css_id: ''
});

function previewLedgerRequest({
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

function createPreviewLedgerHarness() {
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

function observePreviewLedgerAbort(ledger, request) {
  ledger.observeRequest(request);
  return ledger.observeFailure(request);
}

function observePreviewLedgerSuccess(ledger, request, status = 200) {
  ledger.observeRequest(request);
  ledger.observeResponse(request, status);
  ledger.observeFinished(request);
}

test('[monitor-contract] preview-read ledger follows ordered abort chains and permits local completion', () => {
  const abortHarness = createPreviewLedgerHarness();
  const abortSources = ['draft a', 'draft ab', 'draft abc'];
  const abortOperation = abortHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: abortSources });
  const requestA = previewLedgerRequest({ source: abortSources[0], failureText: 'net::ERR_ABORTED' });
  const requestAB = previewLedgerRequest({ source: abortSources[1], failureText: 'net::ERR_ABORTED' });
  const requestABC = previewLedgerRequest({ source: abortSources[2] });
  const deferredA = observePreviewLedgerAbort(abortHarness.ledger, requestA);
  const deferredAB = observePreviewLedgerAbort(abortHarness.ledger, requestAB);
  observePreviewLedgerSuccess(abortHarness.ledger, requestABC);
  const abortProof = abortHarness.ledger.prove(abortOperation, { finalUiVerified: true });
  const repeatedProof = abortHarness.ledger.prove(abortOperation, { finalUiVerified: true });
  abortHarness.ledger.finalize();
  abortHarness.ledger.finalize();

  const finishedHarness = createPreviewLedgerHarness();
  const finishedSources = ['draft finished', 'draft finished ab', 'draft local only'];
  const finishedOperation = finishedHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: finishedSources });
  observePreviewLedgerSuccess(finishedHarness.ledger, previewLedgerRequest({ source: finishedSources[0] }));
  observePreviewLedgerSuccess(finishedHarness.ledger, previewLedgerRequest({ source: finishedSources[1] }));
  const finishedProof = finishedHarness.ledger.prove(finishedOperation, { finalUiVerified: true });
  finishedHarness.ledger.finalize();

  const localHarness = createPreviewLedgerHarness();
  const localOperation = localHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: ['local only', 'later local only']
  });
  const localProof = localHarness.ledger.prove(localOperation, { finalUiVerified: true });
  localHarness.ledger.finalize();

  const phasedHarness = createPreviewLedgerHarness();
  const phasedRenderParams = { ...PREVIEW_LEDGER_RENDER_PARAMS };
  const phasedDeclaration = [
    { id: 'phase-a', groups: [['A'], ['B'], ['A']] },
    { id: 'phase-b', groups: [['A'], ['V'], ['A']] }
  ];
  const phasedOperation = phasedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: phasedRenderParams,
    phases: phasedDeclaration
  });
  phasedRenderParams.code_theme = 'mutated-after-begin';
  phasedDeclaration[0].groups[0][0] = 'mutated-after-begin';
  phasedDeclaration[1].id = 'mutated-phase-b';
  phasedDeclaration[1].groups[0][0] = 'mutated-after-begin';
  const phasedRequestA1 = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  const phasedRequestA2 = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  const phasedRequestB = previewLedgerRequest({ source: 'B', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  const phasedRequestA3 = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  const phasedDeferredA1 = observePreviewLedgerAbort(phasedHarness.ledger, phasedRequestA1);
  const phasedDeferredA2 = observePreviewLedgerAbort(phasedHarness.ledger, phasedRequestA2);
  observePreviewLedgerSuccess(phasedHarness.ledger, phasedRequestB);
  const phaseEntered = phasedHarness.ledger.enterPhase(phasedOperation, 'phase-b');
  observePreviewLedgerSuccess(phasedHarness.ledger, phasedRequestA3);
  const phasedProof = phasedHarness.ledger.prove(phasedOperation, { finalUiVerified: true });
  const phasedRepeatedProof = phasedHarness.ledger.prove(phasedOperation, { finalUiVerified: true });
  phasedHarness.ledger.finalize();
  phasedHarness.ledger.finalize();

  const crossPhaseHarness = createPreviewLedgerHarness();
  const crossPhaseOperation = crossPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'before', groups: [['A']] },
      { id: 'after', groups: [['B']] }
    ]
  });
  const crossPhaseRequestA = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  crossPhaseHarness.ledger.observeRequest(crossPhaseRequestA);
  crossPhaseHarness.ledger.enterPhase(crossPhaseOperation, 'after');
  observePreviewLedgerSuccess(crossPhaseHarness.ledger, previewLedgerRequest({
    source: 'B', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const crossPhaseDeferredA = crossPhaseHarness.ledger.observeFailure(crossPhaseRequestA);
  const crossPhaseProof = crossPhaseHarness.ledger.prove(crossPhaseOperation, { finalUiVerified: true });
  crossPhaseHarness.ledger.finalize();

  const zeroPhasedHarness = createPreviewLedgerHarness();
  const zeroPhasedOperation = zeroPhasedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'zero-before', groups: [['A']] },
      { id: 'zero-after', groups: [['B']] }
    ]
  });
  zeroPhasedHarness.ledger.enterPhase(zeroPhasedOperation, 'zero-after');
  const zeroPhasedProof = zeroPhasedHarness.ledger.prove(zeroPhasedOperation, { finalUiVerified: true });
  zeroPhasedHarness.ledger.finalize();

  expect({
    deferredA,
    deferredAB,
    abortApproved: abortProof.approved,
    abortCode: abortProof.code,
    abortCount: abortProof.approvedAbortCount,
    repeatedApproved: repeatedProof.approved,
    repeatedCode: repeatedProof.code,
    repeatedCount: repeatedProof.approvedAbortCount,
    abortIssues: abortHarness.issues,
    approvedCalls: abortHarness.approvedAbortCounts,
    finishedApproved: finishedProof.approved,
    finishedCount: finishedProof.approvedAbortCount,
    finishedIssues: finishedHarness.issues,
    localApproved: localProof.approved,
    localCount: localProof.approvedAbortCount,
    localIssues: localHarness.issues,
    phasedDeferredA1,
    phasedDeferredA2,
    phaseEntered,
    phasedApproved: phasedProof.approved,
    phasedCount: phasedProof.approvedAbortCount,
    phasedRepeatedApproved: phasedRepeatedProof.approved,
    phasedRepeatedCount: phasedRepeatedProof.approvedAbortCount,
    phasedApprovedCalls: phasedHarness.approvedAbortCounts,
    phasedIssues: phasedHarness.issues,
    crossPhaseDeferredA,
    crossPhaseApproved: crossPhaseProof.approved,
    crossPhaseCount: crossPhaseProof.approvedAbortCount,
    crossPhaseIssues: crossPhaseHarness.issues,
    zeroPhasedApproved: zeroPhasedProof.approved,
    zeroPhasedCount: zeroPhasedProof.approvedAbortCount,
    zeroPhasedIssues: zeroPhasedHarness.issues
  }).toEqual({
    deferredA: true,
    deferredAB: true,
    abortApproved: true,
    abortCode: 'preview-read-operation-approved',
    abortCount: 2,
    repeatedApproved: true,
    repeatedCode: 'preview-read-operation-approved',
    repeatedCount: 2,
    abortIssues: [],
    approvedCalls: [2],
    finishedApproved: true,
    finishedCount: 0,
    finishedIssues: [],
    localApproved: true,
    localCount: 0,
    localIssues: [],
    phasedDeferredA1: true,
    phasedDeferredA2: true,
    phaseEntered: true,
    phasedApproved: true,
    phasedCount: 2,
    phasedRepeatedApproved: true,
    phasedRepeatedCount: 2,
    phasedApprovedCalls: [2],
    phasedIssues: [],
    crossPhaseDeferredA: true,
    crossPhaseApproved: true,
    crossPhaseCount: 1,
    crossPhaseIssues: [],
    zeroPhasedApproved: true,
    zeroPhasedCount: 0,
    zeroPhasedIssues: []
  });
});

test('[monitor-contract] preview-read ledger rejects actual order inversion and unverified latest reads', () => {
  const inversionHarness = createPreviewLedgerHarness();
  const inversionSources = ['order a', 'order ab'];
  const inversionOperation = inversionHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: inversionSources
  });
  observePreviewLedgerSuccess(inversionHarness.ledger, previewLedgerRequest({ source: inversionSources[1] }));
  observePreviewLedgerSuccess(inversionHarness.ledger, previewLedgerRequest({ source: inversionSources[0] }));
  const inversionProof = inversionHarness.ledger.prove(inversionOperation, { finalUiVerified: true });

  const pendingHarness = createPreviewLedgerHarness();
  const pendingSources = ['pending a', 'pending ab'];
  const pendingOperation = pendingHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: pendingSources });
  observePreviewLedgerSuccess(pendingHarness.ledger, previewLedgerRequest({ source: pendingSources[0] }));
  const pendingRequest = previewLedgerRequest({ source: pendingSources[1] });
  pendingHarness.ledger.observeRequest(pendingRequest);
  pendingHarness.ledger.observeResponse(pendingRequest, 200);
  const pendingProof = pendingHarness.ledger.prove(pendingOperation, { finalUiVerified: true });

  const latestAbortHarness = createPreviewLedgerHarness();
  const latestAbortSources = ['latest a', 'latest ab'];
  const latestAbortOperation = latestAbortHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: latestAbortSources
  });
  observePreviewLedgerSuccess(latestAbortHarness.ledger, previewLedgerRequest({ source: latestAbortSources[0] }));
  observePreviewLedgerAbort(latestAbortHarness.ledger, previewLedgerRequest({
    source: latestAbortSources[1],
    failureText: 'net::ERR_ABORTED'
  }));
  const latestAbortProof = latestAbortHarness.ledger.prove(latestAbortOperation, { finalUiVerified: true });

  const failedHarness = createPreviewLedgerHarness();
  const failedSources = ['failed a', 'failed ab'];
  const failedOperation = failedHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerSuccess(failedHarness.ledger, previewLedgerRequest({ source: failedSources[0] }));
  observePreviewLedgerAbort(failedHarness.ledger, previewLedgerRequest({
    source: failedSources[1],
    failureText: 'net::ERR_FAILED'
  }));
  const failedProof = failedHarness.ledger.prove(failedOperation, { finalUiVerified: true });

  const declarationHarness = createPreviewLedgerHarness();
  const safeErrorCode = (operation) => {
    try {
      operation();
      return null;
    } catch (error) {
      return typeof error?.message === 'string' ? error.message : 'unknown-error';
    }
  };
  const missingGroupsCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'missing-groups' }]
  }));
  const missingRenderParamCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: {
      markdown_theme: PREVIEW_LEDGER_RENDER_PARAMS.markdown_theme,
      code_theme: PREVIEW_LEDGER_RENDER_PARAMS.code_theme
    },
    phases: [{ id: 'missing-param', groups: [['A']] }]
  }));
  const extraRenderParamCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: { ...PREVIEW_LEDGER_RENDER_PARAMS, unexpected_param: 'ignored' },
    phases: [{ id: 'extra-param', groups: [['A']] }]
  }));
  const invalidPostIdCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: 0,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'invalid-post', groups: [['A']] }]
  }));

  const unknownSourceHarness = createPreviewLedgerHarness();
  const unknownSourceOperation = unknownSourceHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-source', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownSourceHarness.ledger, previewLedgerRequest({
    source: 'unknown', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const unknownSourceProof = unknownSourceHarness.ledger.prove(unknownSourceOperation, { finalUiVerified: true });

  const unknownPostHarness = createPreviewLedgerHarness();
  const unknownPostOperation = unknownPostHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-post', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownPostHarness.ledger, previewLedgerRequest({
    source: 'known', postId: PREVIEW_LEDGER_POST_ID + 1, renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const unknownPostProof = unknownPostHarness.ledger.prove(unknownPostOperation, { finalUiVerified: true });

  const unknownFieldHarness = createPreviewLedgerHarness();
  const unknownFieldOperation = unknownFieldHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-fields', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownFieldHarness.ledger, previewLedgerRequest({
    source: 'known', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, extraBody: { unexpected_field: 'ignored' }
  }));
  const unknownFieldProof = unknownFieldHarness.ledger.prove(unknownFieldOperation, { finalUiVerified: true });

  const changedParamsHarness = createPreviewLedgerHarness();
  const changedParamsOperation = changedParamsHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-params', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(changedParamsHarness.ledger, previewLedgerRequest({
    source: 'known',
    renderParams: { ...PREVIEW_LEDGER_RENDER_PARAMS, code_theme: 'wrong-code-theme' }
  }));
  const changedParamsProof = changedParamsHarness.ledger.prove(changedParamsOperation, { finalUiVerified: true });

  const missingBodyParamHarness = createPreviewLedgerHarness();
  const missingBodyParamOperation = missingBodyParamHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'missing-body-param', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(missingBodyParamHarness.ledger, previewLedgerRequest({
    source: 'known',
    renderParams: {
      markdown_theme: PREVIEW_LEDGER_RENDER_PARAMS.markdown_theme,
      code_theme: PREVIEW_LEDGER_RENDER_PARAMS.code_theme
    }
  }));
  const missingBodyParamProof = missingBodyParamHarness.ledger.prove(
    missingBodyParamOperation,
    { finalUiVerified: true }
  );

  const skipPhaseHarness = createPreviewLedgerHarness();
  const skipPhaseOperation = skipPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'skip-0', groups: [['A']] },
      { id: 'skip-1', groups: [['B']] },
      { id: 'skip-2', groups: [['C']] }
    ]
  });
  const skippedPhaseCode = safeErrorCode(() => skipPhaseHarness.ledger.enterPhase(skipPhaseOperation, 'skip-2'));
  const skipPhaseProof = skipPhaseHarness.ledger.prove(skipPhaseOperation, { finalUiVerified: true });

  const backPhaseHarness = createPreviewLedgerHarness();
  const backPhaseOperation = backPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'back-0', groups: [['A']] },
      { id: 'back-1', groups: [['B']] }
    ]
  });
  backPhaseHarness.ledger.enterPhase(backPhaseOperation, 'back-1');
  const backwardPhaseCode = safeErrorCode(() => backPhaseHarness.ledger.enterPhase(backPhaseOperation, 'back-0'));
  const backPhaseProof = backPhaseHarness.ledger.prove(backPhaseOperation, { finalUiVerified: true });

  const incompletePhaseHarness = createPreviewLedgerHarness();
  const incompletePhaseOperation = incompletePhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'incomplete-0', groups: [['A']] },
      { id: 'incomplete-1', groups: [['B']] }
    ]
  });
  const incompletePhaseProof = incompletePhaseHarness.ledger.prove(incompletePhaseOperation, { finalUiVerified: true });

  const backwardGroupHarness = createPreviewLedgerHarness();
  const backwardGroupOperation = backwardGroupHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'groups', groups: [['first'], ['second']] }]
  });
  observePreviewLedgerSuccess(backwardGroupHarness.ledger, previewLedgerRequest({
    source: 'second', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  observePreviewLedgerSuccess(backwardGroupHarness.ledger, previewLedgerRequest({
    source: 'first', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const backwardGroupProof = backwardGroupHarness.ledger.prove(backwardGroupOperation, { finalUiVerified: true });

  const lastAbortHarness = createPreviewLedgerHarness();
  const lastAbortOperation = lastAbortHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'last-abort', groups: [['A']] }]
  });
  observePreviewLedgerAbort(lastAbortHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  const lastAbortProof = lastAbortHarness.ledger.prove(lastAbortOperation, { finalUiVerified: true });

  const phasedPendingHarness = createPreviewLedgerHarness();
  const phasedPendingOperation = phasedPendingHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-pending', groups: [['A']] }]
  });
  const phasedPendingRequest = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  phasedPendingHarness.ledger.observeRequest(phasedPendingRequest);
  phasedPendingHarness.ledger.observeResponse(phasedPendingRequest, 200);
  const phasedPendingProof = phasedPendingHarness.ledger.prove(phasedPendingOperation, { finalUiVerified: true });

  const phasedFailedHarness = createPreviewLedgerHarness();
  const phasedFailedOperation = phasedFailedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-failed', groups: [['A']] }]
  });
  observePreviewLedgerAbort(phasedFailedHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_FAILED'
  }));
  const phasedFailedProof = phasedFailedHarness.ledger.prove(phasedFailedOperation, { finalUiVerified: true });

  const phasedHttpHarness = createPreviewLedgerHarness();
  const phasedHttpOperation = phasedHttpHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-http', groups: [['A']] }]
  });
  const phasedHttpRequest = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  phasedHttpHarness.ledger.observeRequest(phasedHttpRequest);
  phasedHttpHarness.ledger.observeResponse(phasedHttpRequest, 503);
  phasedHttpHarness.ledger.observeFinished(phasedHttpRequest);
  const phasedHttpProof = phasedHttpHarness.ledger.prove(phasedHttpOperation, { finalUiVerified: true });

  const phasedFinalUiHarness = createPreviewLedgerHarness();
  const phasedFinalUiOperation = phasedFinalUiHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-final-ui', groups: [['A']] }]
  });
  observePreviewLedgerSuccess(phasedFinalUiHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const phasedFinalUiProof = phasedFinalUiHarness.ledger.prove(phasedFinalUiOperation, { finalUiVerified: false });

  expect({
    inversion: [inversionProof.approved, inversionProof.code, inversionProof.approvedAbortCount],
    pending: [pendingProof.approved, pendingProof.code, pendingProof.approvedAbortCount],
    latestAbort: [latestAbortProof.approved, latestAbortProof.code, latestAbortProof.approvedAbortCount],
    failed: [failedProof.approved, failedProof.code, failedProof.approvedAbortCount],
    missingGroupsCode,
    missingRenderParamCode,
    extraRenderParamCode,
    invalidPostIdCode,
    unknownSource: [unknownSourceProof.approved, unknownSourceProof.code, unknownSourceProof.approvedAbortCount],
    unknownPost: [unknownPostProof.approved, unknownPostProof.code, unknownPostProof.approvedAbortCount],
    unknownField: [unknownFieldProof.approved, unknownFieldProof.code, unknownFieldProof.approvedAbortCount],
    changedParams: [changedParamsProof.approved, changedParamsProof.code, changedParamsProof.approvedAbortCount],
    missingBodyParam: [missingBodyParamProof.approved, missingBodyParamProof.code, missingBodyParamProof.approvedAbortCount],
    skippedPhaseCode,
    skipPhase: [skipPhaseProof.approved, skipPhaseProof.code, skipPhaseProof.approvedAbortCount],
    backwardPhaseCode,
    backPhase: [backPhaseProof.approved, backPhaseProof.code, backPhaseProof.approvedAbortCount],
    incompletePhase: [incompletePhaseProof.approved, incompletePhaseProof.code, incompletePhaseProof.approvedAbortCount],
    backwardGroup: [backwardGroupProof.approved, backwardGroupProof.code, backwardGroupProof.approvedAbortCount],
    lastAbort: [lastAbortProof.approved, lastAbortProof.code, lastAbortProof.approvedAbortCount],
    phasedPending: [phasedPendingProof.approved, phasedPendingProof.code, phasedPendingProof.approvedAbortCount],
    phasedFailed: [phasedFailedProof.approved, phasedFailedProof.code, phasedFailedProof.approvedAbortCount],
    phasedHttp: [phasedHttpProof.approved, phasedHttpProof.code, phasedHttpProof.approvedAbortCount],
    phasedFinalUi: [phasedFinalUiProof.approved, phasedFinalUiProof.code, phasedFinalUiProof.approvedAbortCount]
  }).toEqual({
    inversion: [false, 'preview-read-operation-order-invalid', 0],
    pending: [false, 'preview-read-operation-successor-unverified', 0],
    latestAbort: [false, 'preview-read-operation-successor-missing', 0],
    failed: [false, 'preview-read-operation-invalid', 0],
    missingGroupsCode: 'preview-read-operation-invalid-declaration',
    missingRenderParamCode: 'preview-read-operation-invalid-declaration',
    extraRenderParamCode: 'preview-read-operation-invalid-declaration',
    invalidPostIdCode: 'preview-read-operation-invalid-declaration',
    unknownSource: [false, 'preview-read-operation-other-source', 0],
    unknownPost: [false, 'preview-read-operation-other-post', 0],
    unknownField: [false, 'preview-read-operation-request-fields-invalid', 0],
    changedParams: [false, 'preview-read-operation-request-params-invalid', 0],
    missingBodyParam: [false, 'preview-read-operation-request-fields-invalid', 0],
    skippedPhaseCode: 'preview-read-operation-phase-transition-invalid',
    skipPhase: [false, 'preview-read-operation-phase-transition-invalid', 0],
    backwardPhaseCode: 'preview-read-operation-phase-transition-invalid',
    backPhase: [false, 'preview-read-operation-phase-transition-invalid', 0],
    incompletePhase: [false, 'preview-read-operation-phases-incomplete', 0],
    backwardGroup: [false, 'preview-read-operation-group-order-invalid', 0],
    lastAbort: [false, 'preview-read-operation-successor-missing', 0],
    phasedPending: [false, 'preview-read-operation-successor-unverified', 0],
    phasedFailed: [false, 'preview-read-operation-invalid', 0],
    phasedHttp: [false, 'preview-read-operation-http-failed', 0],
    phasedFinalUi: [false, 'preview-read-operation-final-ui-unverified', 0]
  });
});

test('[monitor-contract] preview-read ledger settles operations and counts approved aborts once', () => {
  const harness = createPreviewLedgerHarness();
  const failedSources = ['operation a', 'operation ab'];
  const failedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: failedSources[0],
    failureText: 'net::ERR_ABORTED'
  }));
  const failedProof = harness.ledger.prove(failedOperation, { finalUiVerified: true });

  const finishedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({ source: failedSources[0] }));
  const finishedProof = harness.ledger.prove(finishedOperation, { finalUiVerified: true });

  const approvedSources = ['approved a', 'approved ab', 'approved abc'];
  const approvedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: approvedSources });
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: approvedSources[0],
    failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: approvedSources[1],
    failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({ source: approvedSources[2] }));
  const approvedProof = harness.ledger.prove(approvedOperation, { finalUiVerified: true });
  const repeatedApprovedProof = harness.ledger.prove(approvedOperation, { finalUiVerified: true });
  harness.ledger.finalize();
  harness.ledger.finalize();
  const failedIssues = [...harness.issues];

  const phasedCountHarness = createPreviewLedgerHarness();
  const phasedCountOperation = phasedCountHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'count-phase', groups: [['repeat'], ['complete']] }]
  });
  observePreviewLedgerAbort(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'repeat', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerAbort(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'repeat', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerSuccess(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'complete', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const phasedCountProof = phasedCountHarness.ledger.prove(phasedCountOperation, { finalUiVerified: true });
  const phasedCountRepeatedProof = phasedCountHarness.ledger.prove(phasedCountOperation, { finalUiVerified: true });
  phasedCountHarness.ledger.finalize();
  phasedCountHarness.ledger.finalize();

  expect({
    failedApproved: failedProof.approved,
    failedCode: failedProof.code,
    failedIssuesRetained: failedIssues.includes('preview-request-cancellation-unapproved'),
    finishedApproved: finishedProof.approved,
    finishedCount: finishedProof.approvedAbortCount,
    approved: approvedProof.approved,
    approvedCount: approvedProof.approvedAbortCount,
    repeatedApproved: repeatedApprovedProof.approved,
    repeatedCount: repeatedApprovedProof.approvedAbortCount,
    approvedCalls: harness.approvedAbortCounts,
    finalDeferredCount: harness.issues.filter((code) => code === 'preview-request-cancellation-unapproved').length,
    phasedCountApproved: phasedCountProof.approved,
    phasedCount: phasedCountProof.approvedAbortCount,
    phasedCountRepeatedApproved: phasedCountRepeatedProof.approved,
    phasedCountRepeated: phasedCountRepeatedProof.approvedAbortCount,
    phasedCountCalls: phasedCountHarness.approvedAbortCounts,
    phasedCountIssues: phasedCountHarness.issues
  }).toEqual({
    failedApproved: false,
    failedCode: 'preview-read-operation-successor-missing',
    failedIssuesRetained: true,
    finishedApproved: true,
    finishedCount: 0,
    approved: true,
    approvedCount: 2,
    repeatedApproved: true,
    repeatedCount: 2,
    approvedCalls: [2],
    finalDeferredCount: 1,
    phasedCountApproved: true,
    phasedCount: 2,
    phasedCountRepeatedApproved: true,
    phasedCountRepeated: 2,
    phasedCountCalls: [2],
    phasedCountIssues: []
  });
});

async function finishSyntheticMonitor(monitor) {
  return finalizeBasicMonitor(monitor);
}

async function withSyntheticContext(browser, operation, { heldPath = null } = {}) {
  const context = await browser.newContext({
    baseURL: MONITOR_CONTRACT_ORIGIN,
    serviceWorkers: 'block'
  });
  let syntheticRequests = 0;
  let escapedRequests = 0;
  let releaseHeld;
  let markHeldStarted;
  const heldGate = new Promise((resolve) => { releaseHeld = resolve; });
  const heldStarted = new Promise((resolve) => { markHeldStarted = resolve; });
  await context.route('**/*', async (route) => {
    syntheticRequests += 1;
    if (!route.request().url().startsWith(`${MONITOR_CONTRACT_ORIGIN}/`)) {
      escapedRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    if (heldPath && new URL(route.request().url()).pathname === heldPath) {
      markHeldStarted();
      await heldGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{"held":true}'
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: MONITOR_CONTRACT_HTML
    });
  });
  const page = await context.newPage();
  try {
    const result = await operation({
      origin: MONITOR_CONTRACT_ORIGIN,
      page,
      waitForHeldRequest: () => heldStarted,
      releaseHeldRequest: () => releaseHeld()
    });
    if (escapedRequests !== 0 || syntheticRequests === 0) {
      throw new Error('monitor-contract-synthetic-transport-invalid');
    }
    return result;
  } finally {
    releaseHeld();
    await context.close();
  }
}

async function withSyntheticMonitorPage(browser, operation, options = {}) {
  return withSyntheticContext(browser, async ({ page }) => {
    const monitor = await installBrowserMonitor(page);
    await installMonitorRejectionBridge(page, monitor);
    try {
      return await operation({ page, monitor, baseURL: MONITOR_CONTRACT_ORIGIN });
    } finally {
      await monitor.detach();
    }
  }, options);
}

async function gotoSyntheticMonitorPath(page, path) {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
  } catch {
    throw new Error('monitor-contract-navigation-failed');
  }
}

async function openSyntheticMonitorPage(page, monitor, baseURL) {
  monitor.expectNavigation('/', 'open-synthetic', baseURL);
  await monitor.flushHistory();
  await monitor.flushRejections();
  await gotoSyntheticMonitorPath(page, '/');
}

async function dispatchMonitorContractRejection(page) {
  await page.evaluate(() => {
    const reason = new Error('synthetic-monitor-contract-rejection');
    const promise = Promise.reject(reason);
    promise.catch(() => {});
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise, reason }));
  });
}

async function withSyntheticSharedMonitorPage(browser, operation, options = {}) {
  return withSyntheticContext(browser, async ({ page }) => {
    const monitor = await installSharedVisualBrowserMonitor(page, { baseURL: MONITOR_CONTRACT_ORIGIN });
    try {
      return await operation({ page, monitor, baseURL: MONITOR_CONTRACT_ORIGIN });
    } finally {
      await monitor.detach();
    }
  }, options);
}

async function openContractHistoryPage(kind, page, monitor, baseURL) {
  if (kind === 'basic') return openSyntheticMonitorPage(page, monitor, baseURL);
  monitor.expectNavigation('/', 'open-synthetic');
  await gotoSyntheticMonitorPath(page, '/');
}

async function finishContractHistoryMonitor(kind, page, monitor) {
  if (kind === 'basic') return finishSyntheticMonitor(monitor);
  return finishSharedVisualBrowserMonitor(page, { timeoutMs: 2_000, quietMs: 50 });
}

async function flushContractNotifications(kind, monitor) {
  await monitor.flushHistory();
  if (kind === 'basic') await monitor.flushRejections();
}

function contractMonitorSnapshot(kind, monitor) {
  return kind === 'basic' ? monitor.summary() : monitor.snapshot();
}

async function expectAndNavigateContract(kind, page, monitor, baseURL, path, action) {
  if (kind === 'basic') monitor.expectNavigation(path, action, baseURL);
  else monitor.expectNavigation(path, action);
  await flushContractNotifications(kind, monitor);
  await gotoSyntheticMonitorPath(page, path);
}

async function withContractHistoryMonitor(browser, kind, operation) {
  if (kind === 'basic') return withSyntheticMonitorPage(browser, operation);
  return withSyntheticSharedMonitorPage(browser, operation);
}

async function installContractMonitor(page, kind, baseURL = MONITOR_CONTRACT_ORIGIN) {
  if (kind === 'basic') {
    const monitor = await installBrowserMonitor(page, { baseURL });
    await installMonitorRejectionBridge(page, monitor);
    return monitor;
  }
  return installSharedVisualBrowserMonitor(page, { baseURL });
}

async function runPreviewReadOperationCase(browser, kind, variant, {
  finalUiVerified = true
} = {}) {
  const run = async ({ page, origin }) => {
    const monitor = await installContractMonitor(page, kind, origin);
    const oldSource = 'Old preview source.';
    const middleSource = 'Middle preview source.';
    const newSource = 'New preview source.';
    const operationId = monitor.beginPreviewReadOperation({
      postId: 9717,
      sources: variant === 'positive-two-aborts'
        ? [oldSource, middleSource, newSource]
        : [oldSource, newSource]
    });
    let requestOrdinal = 0;
    await page.route('**/wp-json/easymde/v1/**', async (route) => {
      requestOrdinal += 1;
      if (((requestOrdinal === 1 && ['positive-abort', 'successor-failed', 'no-successor', 'ambiguous']
        .includes(variant)) || (variant === 'positive-two-aborts' && requestOrdinal <= 2))) {
        await route.abort('aborted');
        return;
      }
      if (requestOrdinal === 2 && variant === 'successor-failed') {
        await route.abort('failed');
        return;
      }
      if (requestOrdinal === 2 && variant === 'latest-abort') {
        await route.abort('aborted');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{"preview":true}'
      });
    });
    try {
      await openContractHistoryPage(kind, page, monitor, origin);
      const send = async ({ postId = 9717, source = oldSource, method = 'POST', path = '/wp-json/easymde/v1/preview' } = {}) => {
        await page.evaluate(async ({ requestPath, requestMethod, requestPostId, requestSource }) => {
          try {
            const response = await fetch(requestPath, {
              method: requestMethod,
              headers: requestMethod === 'POST' ? { 'content-type': 'application/json' } : undefined,
              body: requestMethod === 'POST'
                ? JSON.stringify({ post_id: requestPostId, markdown: requestSource })
                : undefined
            });
            await response.text();
          } catch {
            // The monitor is the owner of the synthetic request outcome.
          }
        }, { requestPath: path, requestMethod: method, requestPostId: postId, requestSource: source });
      };

      if (variant === 'other-endpoint') {
        await send({ path: '/wp-json/easymde/v1/not-preview' });
      } else if (variant === 'other-method') {
        await send({ method: 'GET' });
      } else {
        await send({ source: oldSource });
        if (variant === 'positive-two-aborts') {
          await send({ source: middleSource });
          await send({ source: newSource });
        } else if (variant !== 'no-successor') {
          if (variant === 'ambiguous') {
            await send({ source: oldSource });
          } else if (variant === 'other-post') {
            await send({ postId: 9718, source: newSource });
          } else if (variant === 'undeclared-source') {
            await send({ source: 'Undeclared preview source.' });
          } else {
            await send({ source: newSource });
          }
        }
      }
      await monitor.drain({ timeoutMs: 2_000, quietMs: 50 });
      const proof = monitor.provePreviewReadOperation(operationId, { finalUiVerified });
      const summary = await finishContractHistoryMonitor(kind, page, monitor);
      return { proof, summary };
    } finally {
      await monitor.detach().catch(() => {});
    }
  };
  return withSyntheticContext(browser, run);
}

async function installLifecycleRejectionProbe(page) {
  await page.evaluate(() => {
    const bridge = window.__easymdeHistoryObserverBridge;
    if (!bridge || typeof bridge.stop !== 'function') {
      throw new Error('monitor-contract-history-bridge-missing');
    }
    const originalStop = bridge.stop.bind(bridge);
    window.__monitorContractHistoryStopStarted = false;
    window.__monitorContractHistoryStopRelease = null;
    window.__monitorContractRejectionSeen = 0;
    bridge.stop = () => {
      window.__monitorContractHistoryStopStarted = true;
      return new Promise((resolve, reject) => {
        window.__monitorContractHistoryStopRelease = () => Promise.resolve(originalStop()).then(resolve, reject);
      });
    };
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      window.__monitorContractRejectionSeen += 1;
    }, { once: true });
  });
}

async function releaseLifecycleHistoryStop(page) {
  await page.evaluate(async () => {
    const release = window.__monitorContractHistoryStopRelease;
    if (typeof release !== 'function') {
      throw new Error('monitor-contract-history-stop-release-missing');
    }
    window.__monitorContractHistoryStopRelease = null;
    await release();
  });
}

async function triggerLifecycleRejection(page) {
  await page.evaluate(() => {
    void Promise.reject(new Error('monitor-contract-lifecycle-rejection'));
  });
  await page.waitForFunction(() => window.__monitorContractRejectionSeen >= 1, null, { timeout: 5_000 });
}

const MONITOR_CONTRACT_SCHEMA = 'easymde-monitor-contract-v1';
const REAL_MONITOR_CONTRACT_SCHEMA = 'easymde-monitor-real-dtos-v1';
const REAL_MONITOR_CONTRACT_PATH = '/tmp/easymde-monitor-real-dtos.json';
const MONITOR_COUNT_KEYS = [
  'consoleWarnings', 'consoleErrors', 'pageErrors', 'unhandledRejections', 'dialogs',
  'popups', 'navigations', 'requestFailures', 'httpErrors'
];
const MONITOR_APPROVED_KEYS = [
  'previewCancellations', 'setupNavigations', 'navigations', 'dialogs', 'popups',
  'requestCancellations'
];
const HISTORY_COUNT_KEYS = [
  'documents', 'replaceState', 'pushState', 'methodThrows', 'replaceStateSameUrlStableLength',
  'canonicalNullToNull', 'routerInitNullToIdx0', 'withinHistoryApi', 'withinOther',
  'pairedObservations'
];
const SAFE_MONITOR_CODE = /^[a-z0-9][a-z0-9:-]{0,127}$/u;

function readMonitorScalars(value, keys, { required = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  const result = {};
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      if (required) throw new Error('monitor-contract-dto-summary-invalid');
      continue;
    }
    const scalar = value[key];
    if (!Number.isSafeInteger(scalar) || scalar < 0) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    result[key] = scalar;
  }
  if (Object.keys(result).length === 0) throw new Error('monitor-contract-dto-summary-invalid');
  return result;
}

function readMonitorCodes(value) {
  if (!Array.isArray(value) || value.some((code) => typeof code !== 'string' || !SAFE_MONITOR_CODE.test(code))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  return [...value];
}

function completeMonitorSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  const keys = Object.keys(summary);
  if (keys.some((key) => !['counts', 'approved', 'issues', 'history'].includes(key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  if (!['counts', 'approved', 'issues', 'history'].every((key) => Object.hasOwn(summary, key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  let history = null;
  if (summary.history !== null) {
    if (!summary.history || typeof summary.history !== 'object' || Array.isArray(summary.history)) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    if (Object.keys(summary.history).some((key) => !['counts', 'issues'].includes(key))
      || !Object.hasOwn(summary.history, 'counts')
      || !Object.hasOwn(summary.history, 'issues')) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    history = {
      counts: readMonitorScalars(summary.history.counts, HISTORY_COUNT_KEYS, { required: true }),
      issues: readMonitorCodes(summary.history.issues)
    };
  }
  return {
    counts: readMonitorScalars(summary.counts, MONITOR_COUNT_KEYS, { required: true }),
    approved: readMonitorScalars(summary.approved, MONITOR_APPROVED_KEYS),
    issues: readMonitorCodes(summary.issues),
    history
  };
}

function safeLifecycleDto(windowName, cases) {
  return {
    schema: MONITOR_CONTRACT_SCHEMA,
    window: windowName,
    cases: cases.map(({ kind, rejectionSeen, summary }) => {
      const complete = completeMonitorSummary(summary);
      return {
        window: windowName,
        kind,
        rejectionSeen: rejectionSeen === true,
        clean: complete.issues.length === 0,
        unhandledRejections: complete.counts.unhandledRejections,
        pageErrors: complete.counts.pageErrors,
        issueCount: complete.issues.length,
        issueCodes: complete.issues.slice(0, 16),
        summary: complete
      };
    })
  };
}

async function readRealDtoCases() {
  try {
    const parsed = JSON.parse(await readFile(REAL_MONITOR_CONTRACT_PATH, 'utf8'));
    if (parsed?.schema !== REAL_MONITOR_CONTRACT_SCHEMA || !Array.isArray(parsed.cases)) return [];
    return parsed.cases.map((entry) => {
      if (!entry || !['basic', 'shared'].includes(entry.kind)
        || typeof entry.window !== 'string' || !/^[a-z0-9-]+$/u.test(entry.window)
        || typeof entry.rejectionSeen !== 'boolean') {
        throw new Error('monitor-contract-dto-summary-invalid');
      }
      const summary = completeMonitorSummary(entry.summary);
      return {
        window: entry.window,
        kind: entry.kind,
        rejectionSeen: entry.rejectionSeen,
        clean: summary.issues.length === 0,
        summary
      };
    });
  } catch {
    return [];
  }
}

async function publishLifecycleDto(windowName, cases) {
  const dto = safeLifecycleDto(windowName, cases);
  await test.info().attach(`monitor-contract-${windowName}-dto`, {
    body: JSON.stringify(dto),
    contentType: 'application/json'
  });
  await writeFile(`/tmp/easymde-monitor-contract-${windowName}-dto.json`, `${JSON.stringify(dto)}\n`, { mode: 0o600 });
  const existing = (await readRealDtoCases()).filter((entry) => entry.window !== windowName);
  const realDto = {
    schema: REAL_MONITOR_CONTRACT_SCHEMA,
    cases: [...existing, ...dto.cases.map((entry) => ({
      window: entry.window,
      kind: entry.kind,
      rejectionSeen: entry.rejectionSeen,
      clean: entry.clean,
      summary: entry.summary
    }))]
  };
  await writeFile(REAL_MONITOR_CONTRACT_PATH, `${JSON.stringify(realDto)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    phase: 'monitor-contract-dto',
    schema: dto.schema,
    window: dto.window,
    caseCount: dto.cases.length,
    cleanCount: dto.cases.filter((entry) => entry.clean).length,
    noncleanCount: dto.cases.filter((entry) => !entry.clean).length
  }));
}

test('[monitor-contract] preview read proof accepts old abort or old normal finish with a later 2xx request', async ({ browser }) => {
  for (const kind of ['basic', 'shared']) {
    for (const variant of ['positive-abort', 'positive-two-aborts', 'positive-finished']) {
      const result = await runPreviewReadOperationCase(browser, kind, variant);
      const expectedAborts = variant === 'positive-two-aborts' ? 2 : variant === 'positive-abort' ? 1 : 0;
      const approvedCancellations = kind === 'basic'
        ? result.summary.approved.previewCancellations
        : result.summary.approved.requestCancellations;
      expect({
        kind,
        variant,
        approved: result.proof?.approved,
        code: result.proof?.code,
        approvedAbortCount: result.proof?.approvedAbortCount,
        requestFailures: result.summary.counts.requestFailures,
        approvedCancellations,
        issues: result.summary.issues,
        unhandledRejections: result.summary.counts.unhandledRejections
      }).toEqual({
        kind,
        variant,
        approved: true,
        code: 'preview-read-operation-approved',
        approvedAbortCount: expectedAborts,
        requestFailures: expectedAborts,
        approvedCancellations: expectedAborts,
        issues: [],
        unhandledRejections: 0
      });
    }
  }
});

test('[monitor-contract] preview read proof rejects incomplete, mismatched, duplicate, and unverified outcomes', async ({ browser }) => {
  const expectedCodes = {
    'no-successor': 'preview-read-operation-successor-missing',
    'latest-abort': 'preview-read-operation-successor-missing',
    'successor-failed': 'preview-read-operation-invalid',
    'other-post': 'preview-read-operation-other-post',
    'undeclared-source': 'preview-read-operation-other-source',
    ambiguous: 'preview-read-operation-duplicate-stage',
    'other-endpoint': 'preview-read-operation-unexpected-endpoint',
    'other-method': 'preview-read-operation-unexpected-endpoint'
  };
  for (const kind of ['basic', 'shared']) {
    for (const variant of ['no-successor', 'latest-abort', 'successor-failed',
      'other-post', 'undeclared-source', 'ambiguous', 'other-endpoint', 'other-method']) {
      const result = await runPreviewReadOperationCase(browser, kind, variant);
      expect({
        kind,
        variant,
        approved: result.proof?.approved,
        code: result.proof?.code,
        nonclean: result.summary.issues.length > 0
      }).toEqual({
        kind, variant, approved: false, code: expectedCodes[variant], nonclean: true
      });
    }
    const unverified = await runPreviewReadOperationCase(browser, kind, 'positive-abort', { finalUiVerified: false });
    expect({
      kind,
      approved: unverified.proof?.approved,
      code: unverified.proof?.code,
      nonclean: unverified.summary.issues.length > 0
    }).toEqual({
      kind, approved: false, code: 'preview-read-operation-final-ui-unverified', nonclean: true
    });
  }
});

test('[monitor-contract] canonical and router history notifications are paired for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const summary = await withContractHistoryMonitor(browser, kind, async ({ page, monitor, baseURL }) => {
      await openContractHistoryPage(kind, page, monitor, baseURL);
      await page.evaluate(() => history.replaceState(null, '', location.href));
      await page.evaluate(() => history.replaceState({ idx: 0 }, '', location.href));
      const flushed = await monitor.flushHistory();
      if (!flushed) throw new Error(`history-contract-flush-failed:${kind}`);
      return finishContractHistoryMonitor(kind, page, monitor);
    });
    cases.push({ kind, rejectionSeen: false, summary });
    expect({ kind, issues: summary.issues, navigations: summary.counts?.navigations,
      canonical: summary.history?.counts?.canonicalNullToNull,
      router: summary.history?.counts?.routerInitNullToIdx0,
      within: summary.history?.counts?.withinHistoryApi,
      paired: summary.history?.counts?.pairedObservations }).toEqual({
      kind, issues: [], navigations: 1, canonical: 1, router: 1, within: 2, paired: 2
    });
  }
  await publishLifecycleDto('canonical-router', cases);
});

test('[monitor-contract] same-URL pushState is a nonclean history event', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => history.pushState(null, '', location.href));
    await monitor.flushHistory();
    return finishSyntheticMonitor(monitor);
  });
  expect({ nonclean: summary.issues.length > 0, push: summary.history?.counts?.pushState,
    approved: summary.approved.setupNavigations }).toEqual({ nonclean: true, push: 1, approved: 1 });
});

test('[monitor-contract] wrong history state and changed URL are nonclean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => history.replaceState({ other: 1 }, '', location.href));
    await monitor.flushHistory();
    await page.evaluate(() => history.replaceState(null, '', '/changed'));
    await monitor.flushHistory();
    return finishSyntheticMonitor(monitor);
  });
  expect({ wrongState: summary.issues.includes('history-observation-unapproved'),
    changedUrl: summary.issues.includes('history-url-changed'),
    replaceCount: summary.history?.counts?.replaceState }).toEqual({
    wrongState: true, changedUrl: true, replaceCount: 2
  });
});

test('[monitor-contract] declared same-URL reload passes once and unregistered repeat fails for basic and shared monitors', async ({ browser }) => {
  for (const kind of ['basic', 'shared']) {
    const result = await withContractHistoryMonitor(browser, kind, async ({ page, monitor, baseURL }) => {
      await openContractHistoryPage(kind, page, monitor, baseURL);
      await expectAndNavigateContract(kind, page, monitor, baseURL, '/reload.html', 'reload-initial');
      await flushContractNotifications(kind, monitor);
      const first = contractMonitorSnapshot(kind, monitor);
      await expectAndNavigateContract(kind, page, monitor, baseURL, '/reload.html', 'reload-declared');
      await flushContractNotifications(kind, monitor);
      const declared = contractMonitorSnapshot(kind, monitor);
      await flushContractNotifications(kind, monitor);
      await gotoSyntheticMonitorPath(page, '/reload.html');
      return { first, declared, summary: await finishContractHistoryMonitor(kind, page, monitor) };
    });
    const approvedCount = (snapshot) => kind === 'basic'
      ? snapshot.approved.setupNavigations
      : snapshot.approved.navigations;
    expect({
      kind,
      firstIssues: result.first.issues,
      firstDocuments: result.first.history?.counts?.documents,
      firstApproved: approvedCount(result.first),
      declaredIssues: result.declared.issues,
      declaredDocuments: result.declared.history?.counts?.documents,
      declaredApproved: approvedCount(result.declared),
      duplicate: result.summary.issues.includes('history-duplicate-document-navigation'),
      unregistered: result.summary.issues.includes('main-frame-navigation:other'),
      finalDocuments: result.summary.history?.counts?.documents,
      finalApproved: approvedCount(result.summary),
      nonclean: result.summary.issues.length > 0
    }).toEqual({
      kind,
      firstIssues: [],
      firstDocuments: 2,
      firstApproved: 2,
      declaredIssues: [],
      declaredDocuments: 3,
      declaredApproved: 3,
      duplicate: true,
      unregistered: true,
      finalDocuments: 4,
      finalApproved: 3,
      nonclean: true
    });
  }
});

test('[monitor-contract] original history method throw propagates and is nonclean', async ({ browser }) => {
  const result = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    const thrown = await page.evaluate(() => {
      try {
        history.replaceState(null, '', 'http://other.synthetic.invalid/');
        return 'none';
      } catch (error) {
        return error?.name === 'SecurityError' ? 'SecurityError' : 'other';
      }
    });
    await monitor.flushHistory();
    return { thrown, summary: await finishSyntheticMonitor(monitor) };
  });
  expect({ thrown: result.thrown, methodThrow: result.summary.issues.includes('history-method-threw:replaceState'),
    nonclean: result.summary.issues.length > 0 }).toEqual({
    thrown: 'SecurityError', methodThrow: true, nonclean: true
  });
});

test('[monitor-contract] lost or rejected history notifications cannot clean', async ({ browser }) => {
  const delayed = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeHistoryObservation;
      window.__easymdeHistoryObservation = () => new Promise(() => {
        void original;
      });
      history.replaceState(null, '', location.href);
    });
    const flushed = await monitor.flushHistory();
    return { flushed, summary: await finishSyntheticMonitor(monitor) };
  });
  const rejected = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      window.__easymdeHistoryObservation = () => Promise.reject(new Error('synthetic-history-transport'));
      history.replaceState(null, '', location.href);
    });
    const flushed = await monitor.flushHistory();
    return { flushed, summary: await finishSyntheticMonitor(monitor) };
  });
  expect({ delayedClean: delayed.flushed, delayedNonclean: delayed.summary.issues.length > 0,
    rejectedClean: rejected.flushed, rejectedNonclean: rejected.summary.issues.length > 0,
    transport: rejected.summary.issues.includes('history-observation-transport-failed') }).toEqual({
    delayedClean: false, delayedNonclean: true, rejectedClean: false, rejectedNonclean: true, transport: true
  });
});

test('[monitor-contract] exact synthetic setup chain finalizes clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    for (const [path, action] of [['/wp-login.php', 'open-login'], ['/wp-admin/', 'login-submit'],
      ['/wp-admin/post-new.php', 'open-editor']]) {
      monitor.expectNavigation(path, action, baseURL);
      await monitor.flushHistory();
      await monitor.flushRejections();
      await gotoSyntheticMonitorPath(page, path);
    }
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues).toEqual([]);
  expect(summary.approved.setupNavigations).toBe(3);
});

test('[monitor-contract] wrong same-category setup navigation cannot consume an exact declaration', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    monitor.expectNavigation('/wp-admin/allowed.php', 'login-submit', baseURL);
    await monitor.flushHistory();
    await monitor.flushRejections();
    await gotoSyntheticMonitorPath(page, '/wp-admin/wrong.php');
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.approved.setupNavigations).toBe(0);
  expect(summary.issues).toContain('main-frame-navigation:wp-admin');
  expect(summary.issues).toContain('navigation-expected-missing:wp-admin:login-submit');
});

test('[monitor-contract] native rejection immediately before finish is never clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => { Promise.reject(new Error('synthetic-native-monitor-rejection')); });
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues.length).toBeGreaterThan(0);
  expect(summary.counts.unhandledRejections).toBeGreaterThanOrEqual(1);
});

test('[monitor-contract] delayed notification is awaited beyond the former quiet window', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeReportRejection;
      window.__easymdeMonitorRelease = null;
      window.__easymdeReportRejection = (id) => new Promise((resolve, reject) => {
        window.__easymdeMonitorRelease = () => Promise.resolve(original(id)).then(resolve, reject);
      });
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => typeof window.__easymdeMonitorRelease === 'function');
    let finished = false;
    const finishing = finishSyntheticMonitor(monitor).then((result) => {
      finished = true;
      return result;
    });
    await page.waitForTimeout(120);
    expect(finished).toBe(false);
    await page.evaluate(() => window.__easymdeMonitorRelease());
    return finishing;
  });
  expect(summary.counts.unhandledRejections).toBe(1);
});

test('[monitor-contract] rejected notification transport is reported and never clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      window.__easymdeReportRejection = () => Promise.reject(new Error('synthetic-transport-rejection'));
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => window.__easymdeRejectionBridge.failed === 1);
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues).toContain('rejection-notification-transport-failed');
  expect(summary.issues).not.toEqual([]);
});

async function runHeldFetchFinishRegression({
  browser,
  installMonitor,
  finishMonitor
}) {
  return withSyntheticContext(browser, async ({
    page,
    waitForHeldRequest,
    releaseHeldRequest
  }) => {
    const monitor = await installMonitor(page);
    monitor.expectNavigation('/', 'open-synthetic', MONITOR_CONTRACT_ORIGIN);
    await monitor.flushRejections?.();
    await gotoSyntheticMonitorPath(page, '/');
    await page.evaluate(() => {
      const originalRemove = window.removeEventListener.bind(window);
      window.__monitorContractListenerRemoved = false;
      window.removeEventListener = (type, listener, options) => {
        const result = originalRemove(type, listener, options);
        if (type === 'unhandledrejection') window.__monitorContractListenerRemoved = true;
        return result;
      };
      window.__monitorContractCallbackRan = false;
      void fetch('/held.json').then(() => {
        window.__monitorContractCallbackRan = true;
        throw new Error('synthetic-held-fetch-callback');
      });
    });
    await waitForHeldRequest();
    const finishing = finishMonitor(page, monitor);
    await Promise.race([
      page.waitForFunction(() => window.__monitorContractListenerRemoved === true, { timeout: 250 }).catch(() => false),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    releaseHeldRequest();
    const summary = await finishing;
    const callbackRan = await page.evaluate(() => window.__monitorContractCallbackRan === true);
    const unavailable = summary.issues.some((code) => (
      /(?:monitor-rejection|rejection)-barrier-(?:unavailable|timeout|page-closed)/u.test(code)
      || code === 'rejection-notification-transport-failed'
      || code === 'unhandled-rejection-bridge-failed'
    ));
    return { callbackRan, summary, unhandled: summary.counts.unhandledRejections >= 1, unavailable };
  }, { heldPath: '/held.json' });
}

test('[monitor-contract] basic monitor keeps rejection collection through held-fetch drain', async ({ browser }) => {
  const result = await runHeldFetchFinishRegression({
    browser,
    installMonitor: async (page) => {
      const monitor = await installBrowserMonitor(page);
      await installMonitorRejectionBridge(page, monitor);
      return monitor;
    },
    finishMonitor: (_page, monitor) => finishSyntheticMonitor(monitor)
  });
  expect({
    callbackRan: result.callbackRan,
    rejectionObserved: result.unhandled || result.unavailable
  }).toEqual({ callbackRan: true, rejectionObserved: true });
});

test('[monitor-contract] shared monitor keeps rejection collection through held-fetch drain', async ({ browser }) => {
  const result = await runHeldFetchFinishRegression({
    browser,
    installMonitor: (page) => installSharedVisualBrowserMonitor(page, {
      baseURL: MONITOR_CONTRACT_ORIGIN
    }),
    finishMonitor: (page) => finishSharedVisualBrowserMonitor(page, {
      timeoutMs: 2_000,
      quietMs: 50
    })
  });
  expect({
    callbackRan: result.callbackRan,
    rejectionObserved: result.unhandled || result.unavailable
  }).toEqual({ callbackRan: true, rejectionObserved: true });
});


test('[monitor-contract] rejection during async history-stop survives for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const result = await withSyntheticContext(browser, async ({ page }) => {
      const monitor = await installContractMonitor(page, kind);
      try {
        await openContractHistoryPage(kind, page, monitor, MONITOR_CONTRACT_ORIGIN);
        await installLifecycleRejectionProbe(page);
        const finishing = finishContractHistoryMonitor(kind, page, monitor);
        await page.waitForFunction(() => window.__monitorContractHistoryStopStarted === true, null, { timeout: 5_000 });
        await triggerLifecycleRejection(page);
        await releaseLifecycleHistoryStop(page);
        const summary = await finishing;
        const rejectionSeen = await page.evaluate(() => window.__monitorContractRejectionSeen === 1);
        return { kind, rejectionSeen, summary };
      } finally {
        await monitor.detach().catch(() => {});
      }
    });
    cases.push(result);
  }
  await publishLifecycleDto('history-stop', cases);
  expect(cases.map(({ kind, rejectionSeen, summary }) => ({
    kind,
    rejectionSeen,
    unhandledRejections: summary.counts.unhandledRejections,
    pageErrors: summary.counts.pageErrors
  }))).toEqual([
    { kind: 'basic', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 },
    { kind: 'shared', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 }
  ]);
});

test('[monitor-contract] rejection during final drain survives for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const result = await withSyntheticContext(browser, async ({
      page,
      waitForHeldRequest,
      releaseHeldRequest
    }) => {
      const monitor = await installContractMonitor(page, kind);
      try {
        await openContractHistoryPage(kind, page, monitor, MONITOR_CONTRACT_ORIGIN);
        await installLifecycleRejectionProbe(page);
        const finishing = finishContractHistoryMonitor(kind, page, monitor);
        await page.waitForFunction(() => window.__monitorContractHistoryStopStarted === true, null, { timeout: 5_000 });
        await page.evaluate(() => {
          void fetch('/held.json').then(() => {
            window.__monitorContractFetchCallbackRan = true;
            void Promise.reject(new Error('monitor-contract-final-drain-rejection'));
          });
        });
        await waitForHeldRequest();
        await releaseLifecycleHistoryStop(page);
        releaseHeldRequest();
        await page.waitForFunction(() => window.__monitorContractFetchCallbackRan === true
          && window.__monitorContractRejectionSeen === 1, null, { timeout: 5_000 });
        const summary = await finishing;
        const rejectionSeen = await page.evaluate(() => window.__monitorContractRejectionSeen === 1);
        return { kind, rejectionSeen, summary };
      } finally {
        await monitor.detach().catch(() => {});
      }
    }, { heldPath: '/held.json' });
    cases.push(result);
  }
  await publishLifecycleDto('final-drain', cases);
  expect(cases.map(({ kind, rejectionSeen, summary }) => ({
    kind,
    rejectionSeen,
    unhandledRejections: summary.counts.unhandledRejections,
    pageErrors: summary.counts.pageErrors
  }))).toEqual([
    { kind: 'basic', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 },
    { kind: 'shared', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 }
  ]);
});

test('[monitor-contract] delayed old-document notification is preserved across an approved navigation boundary', async ({ browser }) => {
  const result = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeReportRejection;
      window.__easymdeOldDocumentRelease = null;
      window.__easymdeOldDocumentFlushStarted = false;
      window.__easymdeReportRejection = (id) => new Promise((resolve, reject) => {
        window.__easymdeOldDocumentRelease = () => Promise.resolve(original(id)).then(resolve, reject);
      });
      const bridge = window.__easymdeRejectionBridge;
      const originalFlush = bridge.flush.bind(bridge);
      bridge.flush = () => {
        window.__easymdeOldDocumentFlushStarted = true;
        return originalFlush();
      };
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => typeof window.__easymdeOldDocumentRelease === 'function');
    const flushing = monitor.flushRejections();
    await page.waitForFunction(() => window.__easymdeOldDocumentFlushStarted === true);
    await page.evaluate(() => window.__easymdeOldDocumentRelease());
    await flushing;
    const confirmedBeforeNavigation = await page.evaluate(() => window.__easymdeRejectionBridge.confirmed === 1);
    monitor.expectNavigation('/next.html', 'approved-navigation', baseURL);
    await monitor.flushHistory();
    await monitor.flushRejections();
    await gotoSyntheticMonitorPath(page, '/next.html');
    const summary = await finishSyntheticMonitor(monitor);
    const unavailable = summary.issues.some((code) => (
      /(?:monitor-rejection|rejection)-barrier-(?:unavailable|timeout|page-closed|pending)/u.test(code)
      || code === 'rejection-notification-transport-failed'
    ));
    return {
      confirmedBeforeNavigation,
      rejectionObserved: summary.counts.unhandledRejections >= 1 || unavailable,
      summary
    };
  });
  expect({
    confirmedBeforeNavigation: result.confirmedBeforeNavigation,
    rejectionObserved: result.rejectionObserved
  }).toEqual({ confirmedBeforeNavigation: true, rejectionObserved: true });
});

async function openWindowedVisual(page, tail, beforeFixture) {
  const opened = await openVisual(page, windowedMarkdown(tail), undefined, beforeFixture);
  // More than 160 blocks: the editor mounts a windowed surface with spacers.
  await expect(opened.visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  return opened;
}

for (const key of ['Backspace', 'Delete']) {
test(`windowed inline code retirement keeps source and history usable with ${key}`, async ({ page }) => {
  const initial = 'Before.\n\nTail `x`.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const withoutCode = initial.replace('`x`', '');
  const continued = withoutCode.replace('Tail ', 'Tail Y');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withoutCode], [initial], [withoutCode], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  expect(await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  await visual.locator('p code').click();
  await page.keyboard.press('Home');
  for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
  if (key === 'Delete') await page.keyboard.press('ArrowLeft');
  if (key === 'Delete') {
    // This exact keyboard navigation reaches the Text outside the opening
    // code mark, as the independent beforeinput/Undo contract probe proved.
    const outside = await expectWindowedSmokeCheckpoint(visual, failures, 'inline-Delete-outside-initial-intent',
      { selector: ':scope > p', index: 1, codeBoundary: true }, 5);
    expect(outside).toMatchObject({ previewLoading: false,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  }
  await page.keyboard.press(key);
  expect(failures).toEqual([]);
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-retired`,
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  const originalCaret = key === 'Backspace' ? 16 : 14;
  const undone = await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Undo`,
    key === 'Backspace' ? { selector: 'p code' } : { selector: ':scope > p', index: 1, codeBoundary: true },
    key === 'Backspace' ? 1 : 5);
  if (key === 'Delete' && !undone.previewLoading) expect(undone).toMatchObject({
    nativeAnchor: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
    nativeFocus: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Redo`,
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.type('Y');
  await expectSource(source, continued);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-continue-Y`,
    { selector: ':scope > p', index: 1 }, 6);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

test('windowed inside CODE body-zero Delete restores its history and immediate code input', async ({ page }) => {
  // The inline code is the paragraph's first inline content. When a Text node
  // precedes the code, Chromium resolves the start-of-code boundary to that Text
  // node: a mouse click on the left part of the glyph, the ArrowLeft collapse of
  // a backward selection inside the code, and the same navigation in a plain
  // contenteditable host all land BEFORE the code (verified natively, without
  // this editor). Only a paragraph-initial code exposes a collapsed caret
  // genuinely inside the code body at offset 0, which is the state under test.
  const initial = 'Before.\n\n`x`Tail.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const retired = initial.replace('`x`', '');
  const continued = initial.replace('`x`', '`Yx`');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [retired], [initial], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const code = visual.locator('p code');
  const originalText = await code.evaluateHandle(element => {
    if (!(element.firstChild instanceof Text) || element.firstChild.length !== 1) throw new Error('test-windowed-code-zero-original-text-missing');
    return element.firstChild;
  });
  const beforeNavigation = await readPublicEditorState(page);
  const target = { selector: 'p code', codeBoundary: true, originalCodeText: originalText, expectedSource: initial };
  const unchangedSetup = state => {
    expect(state.sourceLength).toBe(initial.length);
    expect(state).toMatchObject({ sourceMatchesExpected: true,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } } });
    expect(beforeNavigation.nativeConnected).toBe(true);
  };
  try {
  // Home from inside a paragraph-initial code lands inside the code body at
  // offset 0; one ArrowRight steps to offset 1 (body-one) so the selection stage
  // below still starts inside the code.
  await code.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  const atOne = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-body-one', target, 1);
  unchangedSetup(atOne);
  await page.keyboard.press('Shift+ArrowLeft');
  const selected = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-selected-x',
    { ...target, focusOffset: 0 }, 1, 'backward');
  unchangedSetup(selected);
  await page.keyboard.press('ArrowLeft');
  const initialNative = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-collapse-zero', target, 0);
  unchangedSetup(initialNative);
  // Pure navigation keeps the exact source and the real native caret inside
  // the code; Delete is gated on that observed DOM position.
  expect(initialNative.sourceMatchesExpected).toBe(true);
  await page.keyboard.press('Delete'); expect(failures).toEqual([]); await expectSource(source, retired);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-retired',
    { selector: ':scope > p', index: 1 }, 0);
  await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectSource(source, initial);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-Undo',
    { selector: 'p code', codeBoundary: true }, 0);
  // No click, selection assignment or Preview wait follows Undo.
  await page.keyboard.type('Y'); expect(failures).toEqual([]); await expectSource(source, continued);
  const typed = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-immediate-Y',
    { selector: 'p code', codeBoundary: true }, 1);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, continued);
  await expect(visual).toHaveAttribute('aria-busy', 'false'); await expectSource(source, continued);
  const ready = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-final-ready',
    { selector: 'p code', codeBoundary: true }, 1);
  expect(ready).toMatchObject({ previewLoading: false,
    nativeAnchor: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } },
    nativeFocus: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } } });
  expect(await code.evaluate(element => element.textContent === 'Yx')).toBe(true);
  await previewRead.prove({ visual });
  } finally { await originalText.dispose(); }
});

test('windowed cross-row replacement keeps history and immediate pending input usable', async ({ page }) => {
  const initial = 'Alpha.\n\nBeta.\n\n~~~js\nvalue = 1;\n~~~\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const edited = initial.replace('Alpha.\n\nBeta.', 'AlQta.');
  const continued = edited.replace('AlQta.', 'AlQZta.');
  const continuedCode = continued.replace('value = 1;', 'vXalue = 1;');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [edited], [initial], [edited], [continued], [continuedCode]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect.poll(() => visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  let release;
  let fetched = 0;
  const responsesSettled = [];
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    let done;
    responsesSettled.push(new Promise((resolve) => { done = resolve; }));
    let response;
    try {
      response = await route.fetch();
      fetched += 1;
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response?.dispose();
      done();
    }
  });
  try {
    const point = async (index) => visual.locator('p').nth(index).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(0);
    const last = await point(1);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-forward-native-intent',
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.type('Q');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Q', { selector: 'p' }, 3);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Undo',
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Redo', { selector: 'p' }, 3);
    await page.keyboard.type('Z');
    expect(failures, 'immediate input after cross-row redo').toEqual([]);
    await expectSource(source, continued);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-direct-Z', { selector: 'p' }, 4);
    await expect.poll(() => fetched).toBeGreaterThan(0);
    release();
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await visual.locator('pre code').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('X');
    await expectSource(source, continuedCode);
    const codeCaret = continuedCode.indexOf('vXalue = 1;') + 2;
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-code-direct-X',
      { selector: 'pre code' }, 2);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } finally {
    release();
    await Promise.all(responsesSettled);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('windowed held PHP history keeps complete math range through release and replacement Undo', async ({ page }) => {
  // Same-P complete-math selection: fixed source [1,14], not a three-block range.
  const tail = '\n\nTarget.\n\nAfter.';
  const initial = 'Before\n$x$\nAfter' + tail + '\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const typed = initial.replace(tail, '\n\nTarget.V\n\nAfter.');
  const selection = { start: 1, end: 14, direction: 'forward' };
  const replaced = initial.slice(0, selection.start) + 'X' + initial.slice(selection.end);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [initial], [replaced], [initial]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, phase = 'initial-formal-window', lastAtom = null;
  const checkpoint = async (expected, pending = false) => {
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected });
      return lastAtom.sourceMatchesExpected && lastAtom.previewLoading === pending
        && (pending || lastAtom.phase === 'ready');
    }).toBe(true);
    expect(failures).toEqual([]);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    return lastAtom;
  };
  const unchangedOwner = async (before, { locked = false } = {}) => {
    const after = await readPublicEditorState(page);
    expect({
      sourceExact: after.source === before.source,
      sourceEditable: after.sourceEditable,
      visualEditable: after.visualEditable,
      nativeConnected: after.nativeConnected
    }).toEqual({
      sourceExact: true,
      sourceEditable: true,
      visualEditable: !locked,
      nativeConnected: true
    });
  };
  const nativeRange = async (measure = false) => visual.evaluate((surface, measure) => {
    const paragraphs = [...surface.querySelectorAll('p')].filter((p) => p.textContent.includes('Before') && p.textContent.includes('After'));
    if (paragraphs.length !== 1) throw new Error('test-windowed-math-paragraph-not-unique');
    const paragraph = paragraphs[0], maths = paragraph.querySelectorAll('.easymde-math[data-easymde-rendered]');
    if (maths.length !== 1) throw new Error('test-windowed-math-object-not-unique');
    const math = maths[0];
    const boundary = (needle, delta) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.easymde-math')) continue;
        const at = node.textContent.indexOf(needle);
        if (at >= 0) matches.push({ node, offset: at + delta });
      }
      if (matches.length !== 1) throw new Error('test-windowed-math-boundary-not-unique');
      return matches[0];
    };
    const start = boundary('Before', 1), end = boundary('After', 3);
    const point = ({ node, offset }) => {
      const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('test-windowed-math-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    };
    const native = getSelection(), range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const atom = document.createRange(); atom.selectNode(math);
    return { points: measure ? { start: point(start), end: point(end) } : null,
      proof: { anchorExact: native?.anchorNode === start.node && native.anchorOffset === start.offset,
        focusExact: native?.focusNode === end.node && native.focusOffset === end.offset,
        anchorOffset: native?.anchorOffset ?? null, focusOffset: native?.focusOffset ?? null,
        connected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        focused: document.activeElement === surface,
        forward: !!range && !native.isCollapsed && range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset,
        wholeMath: !!range && range.compareBoundaryPoints(Range.START_TO_START, atom) <= 0
          && range.compareBoundaryPoints(Range.END_TO_END, atom) >= 0
          && !math.contains(native.anchorNode) && !math.contains(native.focusNode) } };
  }, measure);
  const expectNativeRange = async () => {
    expect((await nativeRange()).proof).toEqual({ anchorExact: true, focusExact: true, anchorOffset: 1, focusOffset: 4,
      connected: true, focused: true, forward: true, wholeMath: true });
  };
  try {
    const baseline = await checkpoint(initial);
    phase = 'real-V-input'; await visual.locator('p').filter({ hasText: 'Target.' }).first().click();
    await page.keyboard.press('End'); await page.keyboard.type('V'); await expectSource(source, typed);
    expect(failures).toEqual([]);
    const beforeLock = await readPublicEditorState(page);
    expect(beforeLock.source === typed).toBe(true);
    // Explicit user preparation: a newly accepted V Preview makes the later
    // real Undo use a formal history transfer, not an ordinary input debounce.
    const formalV = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === typed; } catch { return false; }
    }).then((response) => response, () => null);
    phase = 'explicit-user-lock-and-formal-V'; await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(await sink.evaluate((surface) => surface.isContentEditable)).toBe(false);
    await unchangedOwner(beforeLock, { locked: true }); await expectSource(source, typed); expect(failures).toEqual([]);
    const response = await formalV; expect(response, 'The explicit lock must receive the real V PHP response').not.toBeNull();
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await unchangedOwner(beforeLock, { locked: true }); await expectSource(source, typed);
    phase = 'explicit-user-unlock'; await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint(typed); await unchangedOwner(beforeLock);
    phase = 'real-Undo-base-held-PHP'; held = await holdFormalPreview(page);
    await visual.locator('p').filter({ hasText: 'Target.V' }).first().click(); await page.keyboard.press('End');
    await page.keyboard.press('Control+z'); await expectSource(source, initial);
    await held.waitFor(initial); // Exact request, real PHP200 fetched, fulfillment still gated.
    const beforeDrag = await checkpoint(initial, true);
    expect(beforeDrag.sourceMatchesExpected).toBe(true);
    phase = 'real-complete-math-pointer-drag'; const { points } = await nativeRange(true);
    await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
    try { await page.mouse.move(points.end.x, points.end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    expect(failures).toEqual([]); await expectNativeRange();
    const dragged = await checkpoint(initial, true);
    expect(dragged.sourceMatchesExpected).toBe(true);
    // Pending canonical publication is observed, not forced. The completed
    // accepted tree must preserve the original fixed native/source range.
    phase = 'release-real-PHP-and-preserve-range'; await held.close(); held = null;
    const accepted = await checkpoint(initial); await expectNativeRange();
    expect(accepted.sourceMatchesExpected).toBe(true);
    phase = 'real-X-replacement'; await page.keyboard.type('X');
    const changed = await checkpoint(replaced);
    expect(changed.sourceMatchesExpected).toBe(true);
    expect(changed).toMatchObject({ nativeCollapsed: true, nativeAnchor: { connected: true, inside: true, parentTag: 'P', offset: 2 },
      nativeFocus: { connected: true, inside: true, parentTag: 'P', offset: 2 } });
    phase = 'real-Undo-replacement'; await page.keyboard.press('Control+z');
    const restored = await checkpoint(initial); await expectNativeRange();
    expect(restored.sourceMatchesExpected).toBe(true);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'windowed-held-math-first-failure', operation: phase,
      state: lastAtom ? { sourceLength: lastAtom.sourceLength, phase: lastAtom.phase,
        nativeCollapsed: lastAtom.nativeCollapsed } : null, failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

for (const timing of ['held', 'accepted']) {
test(`windowed nested table ${timing} PHP history keeps Enter and atomic Backspace exact`, async ({ page }) => {
  const padding = '\n\n' + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const tableHead = '>   | Left | Right |\n>   | --- | --- |\n';
  const plainTable = tableHead + '>   | AB | CD |' + padding;
  const breakTable = tableHead + '>   | A<br>B | CD |' + padding;
  const baselineHead = '> - Before.\n>\n>   ```js\n>   retained();\n>   ```\n>\n>   After.\n>\n';
  const replacedHead = '> - BRfter.\n>\n';
  // Independent source fixtures, never derived from the current document or an edit map.
  const SourceFixture = { baseline: baselineHead + plainTable, replaced: replacedHead + plainTable,
    withBreak: replacedHead + breakTable };
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [SourceFixture.baseline], [SourceFixture.replaced], [SourceFixture.baseline],
        [SourceFixture.replaced], [SourceFixture.withBreak], [SourceFixture.replaced],
        [SourceFixture.withBreak], [SourceFixture.replaced]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, SourceFixture.baseline, undefined, previewRead.beforeFixture);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const cell = visual.locator('blockquote li table tbody td').first();
  let held = null, retainedNodes = null, receipts = null, phase = 'formal-code-baseline', lastAtom = null;
  let expectedSource = SourceFixture.baseline;
  let firstMergeDiagnostic = null;
  let firstCaseError = null;
  const cleanupResults = [];
  const tableDiagnostics = { pendingInput: null, sourceNavigation: null, tableNative: null, tableAdmission: null };
  let diagnosticOrdinal = 0;
  const captureTableDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.length > 16384) return;
    diagnosticOrdinal++;
    const parse = (json) => {
      try { const data = JSON.parse(json); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
      catch { return null; }
    };
    const observe = () => ({ operation: phase, consoleOrdinal: diagnosticOrdinal, parsed: false });
    const pick = (observation, data, integers, booleans, enums = {}, nullable = false) => {
      if (!data) return;
      observation.parsed = true;
      let invalidFieldCount = 0;
      for (const field of integers) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (Number.isSafeInteger(data[field]) && data[field] >= -1) observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const field of booleans) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (typeof data[field] === 'boolean') observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const [field, values] of Object.entries(enums)) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        observation[field] = values.includes(data[field]) ? data[field] : 'unrecognized';
        if (observation[field] === 'unrecognized') invalidFieldCount++;
      }
      observation.invalidFieldCount = invalidFieldCount;
    };
    const inputTypes = ['insertText', 'insertReplacementText', 'insertLineBreak', 'insertParagraph', 'deleteByCut',
      'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'other'];
    const navigation = text.match(/visual-editor-window-source-navigation-dom-stale:([a-z0-9-]+)(?:$|;)/u);
    if (navigation) {
      if (tableDiagnostics.sourceNavigation) return;
      const reasons = ['capture-missing-row', 'capture-duplicate-row', 'capture-prior-binding',
        'mount-child-identity', 'mount-block-binding', 'mount-serialization', 'commit-block-binding',
        'commit-child-identity', 'commit-surrounding-block-stale', 'native-deletion-identity',
        'history-gap-child-identity', 'history-gap-presentation', 'history-gap-anchor',
        'pending-native-surrounding-stale', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
        'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
        'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
        'pending-table-surrounding-stale', 'composition-block-identity', 'history-text-replay', 'history-text-source',
        'history-text-block-binding', 'history-text-spelling', 'history-text-path'];
      tableDiagnostics.sourceNavigation = { operation: phase, consoleOrdinal: diagnosticOrdinal,
        reason: reasons.includes(navigation[1]) ? navigation[1] : 'unrecognized', reasonRecognized: reasons.includes(navigation[1]) };
      return;
    }
    const admission = text.match(/visual-editor-window-table-admission;(\{.*\})$/u);
    if (admission) {
      if (tableDiagnostics.tableAdmission) return;
      const observation = observe(), data = parse(admission[1]);
      tableDiagnostics.tableAdmission = observation;
      const tags = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'];
      pick(observation, data,
        ['row', 'column', 'caret', 'tableFrom', 'tableTo', 'sourceCellFrom', 'sourceCellTo', 'local', 'absolute',
          'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo', 'baselineLength', 'tableSourceLength'],
        ['nested', 'mapperReturned', 'projectionPresent'],
        { stage: ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
          'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner',
          'table-in-owner', 'cell-projection', 'cell-projection-bounds', 'nested-range'],
        ownerBlockTag: tags, tableRootTag: tags,
        errorCode: ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'] }, true);
      return;
    }
    const native = text.match(/visual-editor-window-table-native;(\{.*\})$/u);
    if (native) {
      if (tableDiagnostics.tableNative) return;
      const observation = observe(), data = parse(native[1]);
      tableDiagnostics.tableNative = observation;
      pick(observation, data,
        ['canonicalLength', 'sourceLength', 'liveCount', 'retainedCount', 'retainedMismatch', 'adjacentTexts',
          'expectedTexts', 'nativeRangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'proofIndex'],
        ['active', 'externalChange', 'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches',
          'historyMatches', 'rootEqual', 'removedConnected', 'nativeCollapsed', 'anchorConnected', 'anchorEquivalent',
          'focusEquivalent', 'rejectedBeforeInput', 'pendingComposition', 'composing', 'isComposing', 'inputTypeMatches', 'restored'],
        { stage: ['input-context-rejected', 'epoch-rejected', 'outcome-root', 'outcome-retained-count', 'outcome-retained-identity',
          'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus', 'rollback-source-diverged', 'rollback-restored'],
        capturedInputType: inputTypes, eventInputType: inputTypes });
      if (data && Object.hasOwn(data, 'adjacentTextIndexes')) {
        if (Array.isArray(data.adjacentTextIndexes) && data.adjacentTextIndexes.every((value) => Number.isSafeInteger(value) && value >= 0)) {
          observation.adjacentTextIndexCount = data.adjacentTextIndexes.length;
          observation.adjacentTextIndexes = data.adjacentTextIndexes.slice(0, 32);
          observation.adjacentTextIndexesTruncated = data.adjacentTextIndexes.length > 32;
        } else observation.invalidFieldCount++;
      }
      return;
    }
    const match = text.match(/visual-editor-window-(merge|pending-input):reason=([a-z0-9-]+);(\{.*\})$/u);
    if (!match || (match[1] === 'merge' ? firstMergeDiagnostic : tableDiagnostics.pendingInput)) return;
    const observation = observe(), data = parse(match[3]);
    if (match[1] === 'pending-input') {
      const reasons = ['lease-source', 'selection-bounds', 'canonical-deletion-unavailable', 'selection-deletion-not-cancelable',
        'canonical-lease-rejected', 'lease-selection-stale', 'lease-read-only', 'lease-gate-rejected',
        'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
        'lease-dom-read-only-snapshot-missing', 'lease-dom-read-only-region-mutated', 'lease-dom-unclassified',
        'pending-table-cell-unproved', 'row-serialization-failed', 'pending-table-source-epoch', 'pending-table-row-binding',
        'image-target-unproved', 'image-source-map-failed', 'target-probe-unavailable', 'restored-code-target-stale',
        'multiple-targets', 'target-range-mismatch', 'replacement-range-unsupported', 'restored-range-unowned',
        'shortcut-pre-root-missing', 'shortcut-serialization-empty', 'pending-code-deletion-rejected', 'unsupported-pending-input'];
      observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
      observation.reasonRecognized = reasons.includes(match[2]);
      tableDiagnostics.pendingInput = observation;
      pick(observation, data,
        ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'selectionStart', 'selectionEnd',
          'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth', 'rangeCount', 'anchorType',
          'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset', 'targetEndType',
          'targetEndOffset', 'liveChildren', 'acceptedChildren'],
        ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
          'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
          'targetStartConnected', 'targetEndConnected', 'childrenMatch'],
        { selectionDirection: ['none', 'forward', 'backward'], leaseDirection: ['none', 'forward', 'backward'], inputType: inputTypes });
      return;
    }
    const reasons = ['map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch',
      'unmapped-original-boundary', 'unclassified'];
    observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
    firstMergeDiagnostic = observation;
    pick(observation, data,
      ['sourceStart', 'sourceEnd', 'baselineLength', 'editedLength', 'blockCount', 'canonicalLength', 'sourceLength',
        'mountedLength', 'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset'],
      ['structural', 'bodyInput', 'deletion', 'canonicalMatchesSource', 'mountedMatchesSource', 'leaseMatchesSource', 'focused'],
      { phase: ['unclassified', 'beforeinput-selection', 'commit-setup', 'commit-native-deletion-selection', 'commit-merge',
        'commit-selection', 'pending-code-merge', 'pending-code-selection', 'pending-native-serialization', 'pending-native-merge', 'pending-native-selection'] });
    if (data?.merge && typeof data.merge === 'object' && !Array.isArray(data.merge)) {
      observation.merge = {};
      for (const key of ['sourceLength', 'baselineLength', 'editedLength', 'visualStart', 'visualEnd', 'sourceStart', 'sourceEnd']) {
        if (Number.isSafeInteger(data.merge[key])) observation.merge[key] = data.merge[key];
      }
    }
  };
  const checkpoint = async (expected, pending, formal = false) => {
    expectedSource = expected;
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected });
      return lastAtom.sourceMatchesExpected && (pending === undefined || lastAtom.previewLoading === pending)
        && (!formal || lastAtom.phase === 'ready');
    }).toBe(true);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    return lastAtom;
  };
  const point = async (locator, text, offset) => locator.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
    if (matches.length !== 1) throw new Error('test-table-text-boundary-not-unique');
    const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.height <= 0) throw new Error('test-table-text-boundary-not-visible');
    return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
  }, { text, offset });
  const nativeCell = async () => cell.evaluate((element) => {
    const native = getSelection(), inside = !!native?.anchorNode && element.contains(native.anchorNode)
      && !!native.focusNode && element.contains(native.focusNode);
    const prefix = document.createRange(); prefix.selectNodeContents(element);
    if (inside) prefix.setEnd(native.anchorNode, native.anchorOffset); else prefix.collapse(true);
    return { connected: element.isConnected, inside, collapsed: native?.isCollapsed === true,
      prefixText: prefix.toString(), prefixBreaks: prefix.cloneContents().querySelectorAll('br').length,
      breaks: element.querySelectorAll('br').length, atB0: native?.anchorNode instanceof Text
        && native.anchorNode.data === 'B' && native.anchorOffset === 0 && native.focusNode === native.anchorNode && native.focusOffset === 0 };
  });
  const acceptThroughUserLock = async (expected) => {
    const before = await readPublicEditorState(page);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === expected; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise;
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint(expected, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
    await expectSource(source, expected);
  };
  const expectEdit = async (expected) => {
    const state = await checkpoint(expected, timing === 'held' ? true : undefined);
    expect(await nativeCell()).toMatchObject({ inside: true, collapsed: true });
    return state;
  };
  // The shared observer retains refusal codes only; keep the first scalar payload locally, never raw console text.
  page.on('console', captureTableDiagnostic);
  try {
    await checkpoint(SourceFixture.baseline, false, true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(cell).toHaveText('AB');
    const before = visual.locator('blockquote li p').filter({ hasText: /^Before\.$/u });
    const after = visual.locator('blockquote li p').filter({ hasText: /^After\.$/u });
    const start = await point(before, 'Before.', 1), end = await point(after, 'After.', 1);
    phase = 'real-P-code-P-drag';
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    try { await page.mouse.move(end.x, end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    const intent = await readWindowedSmokeState(visual, { selector: 'blockquote li p', index: 0, focusIndex: 1 });
    expect(intent).toMatchObject({ nativeCollapsed: false, nativeDirection: 'forward',
      nativeAnchor: { targetContains: true, bodyOffset: 1 }, nativeFocus: { targetContains: true, bodyOffset: 1 } });
    phase = 'real-R-cross-replacement';
    await page.keyboard.type('R');
    await expectSource(source, SourceFixture.replaced);
    const replacement = await readPublicEditorState(page);
    expect({ sourceExact: replacement.source === SourceFixture.replaced, nativeConnected: replacement.nativeConnected,
      nativeCollapsed: replacement.nativeCollapsed, editable: replacement.editable }).toEqual({
      sourceExact: true, nativeConnected: true, nativeCollapsed: true, editable: true });
    phase = 'formal-R-user-lock'; await acceptThroughUserLock(SourceFixture.replaced);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    phase = 'real-Undo-formal-code-baseline'; await page.keyboard.press('Control+z');
    await checkpoint(SourceFixture.baseline, false, true);
    expect(await source.inputValue() === SourceFixture.baseline).toBe(true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    retainedNodes = await visual.evaluateHandle((surface) => [...surface.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Redo-R-held-PHP'; await page.keyboard.press('Control+Shift+z');
    await expectSource(source, SourceFixture.replaced); await held.waitFor(SourceFixture.replaced);
    const pending = await checkpoint(SourceFixture.replaced, true);
    expect(pending.sourceMatchesExpected).toBe(true);
    expect(await visual.evaluate((surface, nodes) => nodes.length === surface.childNodes.length
      && nodes.every((node, index) => node === surface.childNodes[index]), retainedNodes)).toBe(true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    if (timing === 'accepted') {
      phase = 'accept-real-Redo-R'; await held.close(); held = null;
      await checkpoint(SourceFixture.replaced, false, true);
      await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    }
    receipts = await visual.evaluateHandle((surface) => {
      const events = [];
      const observe = (event) => {
        const native = getSelection(), element = native?.anchorNode?.parentElement?.closest('td');
        events.push({ trusted: event.isTrusted, inputType: event.inputType, collapsed: native?.isCollapsed === true,
          row: element?.parentElement?.rowIndex ?? null, column: element?.cellIndex ?? null,
          offset: native?.anchorOffset ?? null, ranges: event.getTargetRanges().length });
      };
      surface.addEventListener('beforeinput', observe, true);
      return { events, dispose: () => surface.removeEventListener('beforeinput', observe, true) };
    });
    phase = 'real-TD1-pointer'; const tdPoint = await point(cell, 'AB', 1);
    await page.mouse.click(tdPoint.x, tdPoint.y);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-table-Enter'; await page.keyboard.press('Enter');
    await expectEdit(SourceFixture.withBreak);
    expect(await receipts.evaluate((observer) => observer.events.find((event) => event.inputType === 'insertParagraph')))
      .toEqual({ trusted: true, inputType: 'insertParagraph', collapsed: true, row: 1, column: 0, offset: 1, ranges: 1 });
    if (timing === 'held') {
      phase = 'real-break-PHP200-still-withheld'; await held.waitFor(SourceFixture.withBreak);
      await checkpoint(SourceFixture.withBreak, true);
    } else {
      phase = 'formal-break-user-lock'; await acceptThroughUserLock(SourceFixture.withBreak);
      // A toolbar lock can move native focus. Restore the legal point with a real B0 click.
      phase = 'real-accepted-B0-pointer'; const b0 = await point(cell, 'B', 0);
      await page.mouse.click(b0.x, b0.y);
      expect(await nativeCell()).toMatchObject({ atB0: true });
      await checkpoint(SourceFixture.withBreak, false, true);
    }
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 1, breaks: 1 });
    phase = 'real-atomic-marker-Backspace'; await page.keyboard.press('Backspace');
    await expectEdit(SourceFixture.replaced);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-Undo-marker-Backspace'; await page.keyboard.press('Control+z');
    await expectEdit(SourceFixture.withBreak);
    phase = 'real-Redo-marker-Backspace'; await page.keyboard.press('Control+Shift+z');
    await expectEdit(SourceFixture.replaced);
    if (held) { phase = 'release-final-table-PHP'; await held.close(); held = null; }
    await checkpoint(SourceFixture.replaced, false, true);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } catch (error) {
    firstCaseError = error;
    // Direct page/owner reads never wait for a visual locator that failure teardown removed.
    const documentOwner = await readPublicEditorState(page)
      .then((owner) => ({ available: true, ...safePublicState(owner) }), () => ({ available: false }));
    const snapshot = await page.evaluate((expected) => {
      const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      const field = document.querySelector('#easymde-source');
      const native = document.getSelection();
      const tags = ['P', 'TD', 'TH', 'SPAN', 'CODE', 'EM', 'STRONG', 'DEL', 'A', 'ARTICLE', 'DIV', 'SECTION', 'LI', 'BLOCKQUOTE'];
      const point = (node, offset) => ({ connected: !!node?.isConnected,
        inside: !!surface && !!node && surface.contains(node), nodeType: node?.nodeType ?? null, offset,
        parentTag: tags.includes(node?.parentElement?.tagName) ? node.parentElement.tagName : 'unrecognized',
        textLength: node instanceof Text ? node.length : null });
      const rect = surface?.getBoundingClientRect();
      const x = Math.max(0, rect?.left ?? 0), y = Math.max(0, rect?.top ?? 0);
      const right = Math.min(innerWidth, rect?.right ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? 0);
      return { available: true, visualOwnerPresent: !!surface,
        sourceLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        sourceMatchesExpected: field instanceof HTMLTextAreaElement ? field.value === expected : null,
        expectedLength: expected.length, nativeCollapsed: native?.isCollapsed ?? null,
        nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? null),
        nativeFocus: point(native?.focusNode, native?.focusOffset ?? null),
        editable: surface?.getAttribute('contenteditable') ?? null,
        effectiveEditable: surface?.isContentEditable ?? null,
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        session: document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') ?? null,
        previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null,
        screenshotClip: right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null };
    }, expectedSource).catch(() => ({ available: false }));
    const screenshot = { available: false, attached: false };
    if (snapshot.available && snapshot.visualOwnerPresent && snapshot.screenshotClip) {
      try {
        const body = await page.screenshot({ clip: snapshot.screenshotClip, timeout: 2000 });
        await test.info().attach('table-history-first-failure', { body, contentType: 'image/png' });
        screenshot.available = true; screenshot.attached = true;
      } catch { screenshot.step = 'failure-screenshot'; }
    }
    console.log(JSON.stringify({ phase: 'windowed-table-first-failure', timing, operation: phase,
      state: { observedAfterFailure: true, documentOwner, snapshot }, preErrorCheckpoint: lastAtom,
      failures, mergeDiagnostic: firstMergeDiagnostic, pendingInputDiagnostic: tableDiagnostics.pendingInput,
      sourceNavigationDiagnostic: tableDiagnostics.sourceNavigation, tableNativeDiagnostic: tableDiagnostics.tableNative,
      tableAdmissionDiagnostic: tableDiagnostics.tableAdmission, failureScreenshot: screenshot }));
    throw error;
  } finally {
    const cleanup = async (step, operation) => {
      try { await operation(); cleanupResults.push({ step, completed: true }); }
      catch { cleanupResults.push({ step, completed: false }); }
    };
    // Release real withheld responses before any receipt/DOM-handle operation can fail.
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('console-listener-remove', () => page.off('console', captureTableDiagnostic));
    if (receipts) {
      await cleanup('receipt-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('receipt-handle-dispose', () => receipts.dispose());
    }
    if (retainedNodes) await cleanup('retained-handle-dispose', () => retainedNodes.dispose());
    const cleanupFailed = cleanupResults.some((result) => !result.completed);
    console.log(JSON.stringify({ phase: 'windowed-table-cleanup', timing, operation: phase,
      primaryErrorPresent: firstCaseError !== null, cleanupFailed, resources: cleanupResults }));
    if (cleanupFailed && firstCaseError === null) throw new Error('windowed-table-cleanup-failed');
  }
});
}

// Opt-in rich CODE acceptance; excluded from default registration and [short-stage].
if (process.env.EASYMDE_E2E_RICH_TABLE_CODE === 'complete') {
for (const timing of ['ready', 'held']) {
test(`[rich-table-code] windowed ${timing} fixed CODE Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\nAfter.\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Each real-BR-separated segment uses inherited Turndown code spelling. A/B need one backtick each.
  const SourceFixture = { S0: prefix + 'L `AB` R' + suffix, S1: prefix + 'L `A`<br>`B` R' + suffix,
    S1T: prefix + 'L `A`<br>`TB` R' + suffix, ST: prefix + 'L `ATB` R' + suffix,
    SV: prefix.replace(/^Lead\./u, 'Lead.V') + 'L `AB` R' + suffix };
  // Independent diagnostic candidates only; none can replace an edit oracle.
  const sourceCandidates = { joinedS0: 'L `AB` R', adjacentOriginalCodeSpansWithoutBR: 'L `A``B` R',
    sameGlyphWiderDelimiter: 'L ``AB`` R', spacedSpans: 'L `A` `B` R' };
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-code-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, receipts = null, retainedNodes = null, phase = 'formal-S0', expectedKey = 'S0';
  let primaryError = null, lastObservation = null;
  const diagnostics = { merge: null, pending: null, admission: null, native: null, navigation: null };
  const observeDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text(); if (text.length > 16384) return;
    const match = text.match(/visual-editor-window-(merge|pending-input|table-admission|table-native|source-navigation-dom-stale)(?::reason=([a-z0-9-]+);|:([a-z0-9-]+)|;)(\{.*\})?$/u);
    if (!match) return;
    const family = { merge: 'merge', 'pending-input': 'pending', 'table-admission': 'admission',
      'table-native': 'native', 'source-navigation-dom-stale': 'navigation' }[match[1]];
    if (diagnostics[family]) return;
    const observation = { operation: phase, parsed: false };
    diagnostics[family] = observation;
    const reasons = ['pending-table-cell-unproved', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
      'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
      'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
      'pending-table-surrounding-stale', 'lease-source', 'selection-bounds', 'lease-selection-stale', 'lease-read-only',
      'lease-gate-rejected', 'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
      'map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch', 'unmapped-original-boundary', 'unclassified'];
    const reason = match[2] ?? match[3];
    if (reason) observation.reason = reasons.includes(reason) ? reason : 'unrecognized';
    if (!match[4]) return;
    let data; try { data = JSON.parse(match[4]); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    observation.parsed = true;
    for (const key of ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'sourceStart', 'sourceEnd',
      'selectionStart', 'selectionEnd', 'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth',
      'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset',
      'targetEndType', 'targetEndOffset', 'liveChildren', 'acceptedChildren', 'row', 'column', 'caret', 'tableFrom', 'tableTo',
      'sourceCellFrom', 'sourceCellTo', 'local', 'absolute', 'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo',
      'baselineLength', 'editedLength', 'blockCount', 'tableSourceLength']) {
      if (data[key] === null || Number.isSafeInteger(data[key])) observation[key] = data[key];
    }
    for (const key of ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
      'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
      'targetStartConnected', 'targetEndConnected', 'childrenMatch', 'nested', 'mapperReturned', 'projectionPresent',
      'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches', 'historyMatches', 'nativeCollapsed']) {
      if (data[key] === null || typeof data[key] === 'boolean') observation[key] = data[key];
    }
    const nativeStageSchemas = {
      'target-shape': { numbers: ['startOffset', 'endOffset', 'startChildCount', 'endChildCount'],
        booleans: ['sameContainer'], tags: ['targetStartTag', 'targetEndTag'] },
      'target-content-certified': { booleans: ['certified'] },
      'target-facing-certified': { booleans: ['certified'] },
      'clone-target-path': { booleans: ['startResolved', 'endResolved'] },
      'merge-single-delete': { numbers: ['editCount', 'from', 'to', 'insertLength'] },
      'canonical-facing': { numbers: ['caret', 'caretFacing'], booleans: ['facingMatches'] },
      'removed-resolution': { numbers: ['resolvedIndex'], tags: ['startTag', 'endTag'] },
      'removed-parent': { booleans: ['removedIsBR', 'removedParentIsCell', 'removedParentIsContainer'], tags: ['removedParentTag'] }
    };
    const stages = ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
      'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner', 'table-in-owner',
      'cell-projection', 'cell-projection-bounds', 'nested-range', 'input-context-rejected', 'epoch-rejected', 'outcome-root',
      'outcome-retained-count', 'outcome-retained-identity', 'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus',
      'rollback-source-diverged', 'rollback-restored', ...Object.keys(nativeStageSchemas)];
    if (Object.hasOwn(data, 'stage')) observation.stage = data.stage === null ? null : stages.includes(data.stage) ? data.stage : 'unrecognized';
    if (Object.hasOwn(data, 'stageEvidence')) {
      const schema = Object.hasOwn(nativeStageSchemas, data.stage) ? nativeStageSchemas[data.stage] : null;
      const evidence = data.stageEvidence;
      if (evidence === null) observation.stageEvidence = null;
      else {
        observation.stageEvidenceSchemaKnown = !!schema && !!evidence && typeof evidence === 'object' && !Array.isArray(evidence);
        if (observation.stageEvidenceSchemaKnown) {
          const safe = {};
          for (const key of schema.numbers ?? []) if (Number.isSafeInteger(evidence[key])) safe[key] = evidence[key];
          for (const key of schema.booleans ?? []) if (typeof evidence[key] === 'boolean') safe[key] = evidence[key];
          for (const key of schema.tags ?? []) if (Object.hasOwn(evidence, key)) {
            safe[key] = evidence[key] === null ? null
              : ['TD', 'TH', 'CODE', 'BR', 'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'MARK', 'SUB', 'SUP', 'P', 'DIV'].includes(evidence[key])
                ? evidence[key] : 'unrecognized';
          }
          observation.stageEvidence = safe;
        }
      }
    }
    if (Object.hasOwn(data, 'inputType')) observation.inputType = ['insertText', 'insertParagraph', 'insertLineBreak',
      'deleteContentBackward', 'deleteContentForward', 'other'].includes(data.inputType) ? data.inputType : 'unrecognized';
    for (const key of ['selectionDirection', 'leaseDirection']) if (Object.hasOwn(data, key)) {
      observation[key] = ['none', 'forward', 'backward'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    for (const key of ['ownerBlockTag', 'tableRootTag']) if (Object.hasOwn(data, key)) {
      observation[key] = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    if (Object.hasOwn(data, 'errorCode')) observation.errorCode = ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'].includes(data.errorCode) ? data.errorCode : 'unrecognized';
  };
  page.on('console', observeDiagnostic);
  const runtimeState = (key) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key] });
  const checkpoint = async (stage, key, pending, formal = false, point = null, renderRequired = true) => {
    phase = stage; expectedKey = key;
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      expect(failures).toEqual([]);
      const state = await runtimeState(key);
      return state.sourceMatchesExpected && (pending === undefined || state.previewLoading === pending)
        && (!formal || state.phase === 'ready');
    }).toBe(true);
    const state = await runtimeState(key), owner = await readPublicEditorState(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, expectedLength: SourceFixture[key].length, sourceDocLength: state.sourceLength,
      owner: { sourceLength: owner.sourceLength, editable: owner.effectiveEditable, nativeConnected: owner.nativeConnected },
      previewLoading: state.previewLoading, phase: state.phase, render,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled' };
    console.log(JSON.stringify({ event: 'rich-code-checkpoint', timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current.guardCellsExact).toBe(true);
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (renderRequired) expect(render.current).toMatchObject({ matchesExpectedText: true, matchesExpectedCodeGlyphs: true,
        expectedBreakCount: true, literalBrVisible: false });
      if (formal) expect(render.current.codeCount).toBe(key === 'S1' || key === 'S1T' ? 2 : 1);
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true,
        nativeInsideCode: true, codeGlyphOffset: point === 'right-T' || point === 'middle-T' ? 2 : 1,
        prefixBreaks: point === 'middle' || point === 'middle-T' ? 0 : 1,
        ...(point === 'right' ? { atRightB0: true } : {}) });
    }
    expect(failures).toEqual([]);
    return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readPublicEditorState(page);
    await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
  };
  const clickCode = async (text, offset) => {
    const code = cell.locator('code').filter({ hasText: new RegExp('^' + text + '$', 'u') });
    const point = await code.evaluate((element, target) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
      if (matches.length !== 1) throw new Error('rich-code-boundary-unproved');
      const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-code-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, { text, offset });
    await page.mouse.click(point.x, point.y);
  };
  try {
    const loaded = await checkpoint('initial-formal-S0', 'S0', false, true);
    phase = 'loaded-unique-CODE-target';
    expect(SourceFixture.S0.length).toBe(2153);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    const loadedTarget = await cell.evaluate((target) => {
      const table = target.closest('table'), rows = [...(table?.tBodies[0]?.rows ?? [])];
      const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
      const codes = target.querySelectorAll('code');
      return { targetOrdinalExact: rows[1]?.cells[1] === target,
        headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
        guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
          && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
        targetTextExact: target.innerText === 'L AB R', codeCount: codes.length,
        codeGlyphsExact: codes.length === 1 && codes[0].textContent === 'AB',
        noBreaks: target.querySelectorAll('br').length === 0 };
    });
    console.log(JSON.stringify({ event: 'rich-code-loaded-prerequisite', timing, sourceExact: loaded.state.sourceMatchesExpected,
      sourceLength: loaded.state.sourceLength, ...loadedTarget }));
    expect(loaded.state.sourceMatchesExpected).toBe(true);
    expect(loadedTarget).toEqual({ targetOrdinalExact: true, headersExact: true, guardCellsExact: true,
      targetTextExact: true, codeCount: 1, codeGlyphsExact: true, noBreaks: true });
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click();
    await page.keyboard.press('End'); phase = 'real-Lead-V'; await page.keyboard.type('V');
    await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    receipts = await surface.evaluateHandle((root) => {
      let nativeEnter = null, nativeText = null, nativeBackspace = null;
      const events = [];
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const privateShape = () => {
        const cell = target(), rows = [...(root.querySelector('blockquote li table')?.tBodies[0]?.rows ?? [])];
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, text: cell?.innerText ?? '', codeText: [...(cell?.querySelectorAll('code') ?? [])].map((node) => node.textContent).join(''),
          breaks: cell?.querySelectorAll('br').length ?? 0, codeCount: cell?.querySelectorAll('code').length ?? 0,
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])) };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        const inputTypes = ['insertParagraph', 'insertLineBreak', 'insertText', 'deleteContentBackward', 'historyUndo', 'historyRedo'];
        if (events.length < 32) events.push({ type: event.type, inputType: inputTypes.includes(event.inputType) ? event.inputType : 'unrecognized', trusted: event.isTrusted });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText' && target()?.contains(getSelection()?.anchorNode)) nativeText = { ...privateShape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true);
      return { safe: (kind) => {
        const current = privateShape(), cell = target(), native = getSelection(), anchor = native?.anchorNode;
        const expected = kind === 'S1T' ? { text: 'L A\nTB R', glyphs: 'ATB', breaks: 1 }
          : kind === 'S1' ? { text: 'L A\nB R', glyphs: 'AB', breaks: 1 }
          : kind === 'ST' ? { text: 'L ATB R', glyphs: 'ATB', breaks: 0 } : { text: 'L AB R', glyphs: 'AB', breaks: 0 };
        const scalar = (shape) => ({ available: shape.available, textLength: shape.text.length, codeTextLength: shape.codeText.length,
          breaks: shape.breaks, codeCount: shape.codeCount, matchesExpectedText: shape.text === expected.text,
          matchesExpectedCodeGlyphs: shape.codeText === expected.glyphs, expectedBreakCount: shape.breaks === expected.breaks,
          literalBrVisible: shape.text.includes('<br>'), guardCellsExact: shape.guardCellsExact });
        const inside = !!cell && !!anchor && cell.contains(anchor) && !!native?.focusNode && cell.contains(native.focusNode);
        let codeGlyphOffset = null, prefixBreaks = null;
        if (inside) {
          const range = document.createRange(); range.selectNodeContents(cell); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents();
          codeGlyphOffset = [...fragment.querySelectorAll('code')].reduce((sum, node) => sum + node.textContent.length, 0);
          prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        const codeOf = (node) => (node instanceof Element ? node : node?.parentElement)?.closest('code') ?? null;
        const anchorCode = codeOf(anchor), focusCode = codeOf(native?.focusNode);
        const nativeInsideCode = !!anchorCode && !!cell?.contains(anchorCode) && anchorCode === focusCode;
        const sameCollapsedPoint = native?.isCollapsed === true && native.anchorNode === native.focusNode
          && native.anchorOffset === native.focusOffset;
        const domMatchesDeclaredS1 = kind === 'S1' && current.text === 'L A\nB R' && current.codeText === 'AB'
          && current.breaks === 1 && codeGlyphOffset === 1 && prefixBreaks === 1;
        const rightCodes = [...(cell?.querySelectorAll('code') ?? [])].filter((node) => node.parentElement === cell
          && node.textContent === 'B' && !node.querySelector('br'));
        const rightCode = rightCodes.length === 1 ? rightCodes[0] : null;
        const rightTexts = [];
        if (rightCode) {
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === 'B') rightTexts.push(node);
        }
        const rightText = rightTexts.length === 1 ? rightTexts[0] : null;
        const transparent = (node) => node instanceof Element && ['SPAN', 'EM', 'STRONG', 'B', 'I', 'S', 'DEL', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        const proveRightStart = (node, offset) => {
          const proof = { kind: 'none', equivalent: false, withinRightCode: false, corridorForward: false,
            corridorNoText: false, corridorNoComment: false, corridorNoOpaque: false, rightTextReached: false };
          if (node instanceof Text && node.data === 'B' && offset === 0 && nativeInsideCode && inside) {
            return { ...proof, kind: 'text-zero', equivalent: true, withinRightCode: !!rightCode?.contains(node),
              corridorForward: true, corridorNoText: true, corridorNoComment: true, corridorNoOpaque: true,
              rightTextReached: node === rightText };
          }
          if (!rightCode || !rightText || !(node instanceof Element) || !rightCode.contains(node)
            || codeOf(node) !== rightCode || (node === rightCode ? offset !== 0 : !transparent(node))
            || rightCode.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]')) return proof;
          proof.withinRightCode = true;
          const point = document.createRange(), textStart = document.createRange();
          point.setStart(node, offset); point.collapse(true); textStart.setStart(rightText, 0); textStart.collapse(true);
          proof.corridorForward = point.compareBoundaryPoints(Range.START_TO_START, textStart) <= 0;
          proof.corridorNoText = true; proof.corridorNoComment = true; proof.corridorNoOpaque = true;
          // Inspect original nodes, not cloneContents' artificial empty Text at the B0 endpoint.
          // Requiring the entire CODE-start corridor also excludes hidden/protected ancestors before the point.
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_ALL);
          for (let part = walker.nextNode(); part; part = walker.nextNode()) {
            if (part === rightText) { proof.rightTextReached = true; break; }
            if (part.nodeType === Node.TEXT_NODE) proof.corridorNoText = false;
            else if (part.nodeType === Node.COMMENT_NODE) proof.corridorNoComment = false;
            else if (!transparent(part)) proof.corridorNoOpaque = false;
          }
          proof.equivalent = proof.corridorForward && proof.corridorNoText && proof.corridorNoComment
            && proof.corridorNoOpaque && proof.rightTextReached;
          proof.kind = proof.equivalent ? node === rightCode ? 'right-code-zero' : 'empty-phrasing-corridor' : 'none';
          return proof;
        };
        const anchorProof = proveRightStart(anchor, native?.anchorOffset ?? 0);
        const focusProof = proveRightStart(native?.focusNode, native?.focusOffset ?? 0);
        const semanticEquivalentRightStart = domMatchesDeclaredS1 && inside && nativeInsideCode && sameCollapsedPoint
          && anchorProof.equivalent && focusProof.equivalent;
        const rawPoint = (node, offset) => ({ nodeType: node?.nodeType ?? null,
          ownTag: node instanceof Element ? node.tagName : null, parentTag: node?.parentElement?.tagName ?? null,
          offset, connected: !!node?.isConnected });
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          currentTextEqualsNative: comparison ? current.text === comparison.text : null,
          currentCodeGlyphsEqualNative: comparison ? current.codeText === comparison.codeText : null,
          nativeConnected: !!anchor?.isConnected && !!native?.focusNode?.isConnected,
          nativeInsideCell: inside, nativeCollapsed: native?.isCollapsed === true,
          nativeInsideCode,
          codeGlyphOffset, prefixBreaks,
          nativeAnchor: rawPoint(anchor, native?.anchorOffset ?? 0), nativeFocus: rawPoint(native?.focusNode, native?.focusOffset ?? 0),
          atRightB0: semanticEquivalentRightStart, semanticEquivalentRightStart,
          rightStartProof: { sameCollapsedPoint, domMatchesDeclaredS1, rightCodeCandidateCount: rightCodes.length,
            rawTextB0: anchor instanceof Text && anchor.data === 'B' && native.anchorOffset === 0,
            anchor: anchorProof, focus: focusProof }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true); } };
    });
    await checkpoint('before-CODE-Enter', 'S0', timing === 'held');
    await clickCode('AB', 1);
    expect(await receipts.evaluate((observer) => observer.safe('S0'))).toMatchObject({ nativeConnected: true,
      nativeInsideCell: true, nativeCollapsed: true, nativeInsideCode: true, codeGlyphOffset: 1, prefixBreaks: 0 });
    const edit = async (stage, key, pending, formal = false, point = null, renderRequired = true) =>
      checkpoint(stage, key, pending, formal, point, renderRequired);
    phase = 'real-CODE-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('CODE-Enter', 'S1', timing === 'held' ? true : undefined, false, 'right', true);
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, matchesExpectedText: true,
      matchesExpectedCodeGlyphs: true, expectedBreakCount: true, literalBrVisible: false });
    if (timing === 'held') {
      await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, 'right');
    } else {
      await acceptFixed('S1'); await clickCode('B', 0);
      await edit('formal-S1-real-B0', 'S1', false, true, 'right', true);
    }
    phase = 'real-CODE-immediate-Backspace'; await page.keyboard.press('Backspace');
    await edit('CODE-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, 'middle', true);
    phase = 'real-Undo-CODE-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-CODE-Backspace-fixed-S1', 'S1', timing === 'held' ? true : undefined, false, null, false);
    phase = 'real-Redo-CODE-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-CODE-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, null, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', false, true, 'middle', true);
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-right-point', 'S1', false, true, 'right', true);
    phase = 'real-Undo-CODE-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', false, true, 'middle', true);
    phase = 'real-Redo-CODE-Enter'; await page.keyboard.press('Control+Shift+z');
    // No click/selection repair here: exercise the previously unverified Redo S1 native CODE boundary.
    await edit('Redo-Enter-formal-S1-right-point', 'S1', false, true, 'right', true);
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    await edit('right-span-fixed-S1T', 'S1T', undefined, false, 'right-T', true);
    await acceptFixed('S1T'); await clickCode('TB', 1);
    await edit('formal-S1T-real-TB-point', 'S1T', false, true, 'right-T', true);
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', false, true, 'right', true);
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', false, true, 'middle', true);
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    await edit('original-span-fixed-ST', 'ST', undefined, false, 'middle-T', true);
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', false, true, 'middle', true);
    expect(failures).toEqual([]);
  } catch (error) {
    primaryError = error;
    const owner = await readPublicEditorState(page)
      .then((value) => ({ available: true, ...safePublicState(value) }), () => ({ available: false }));
    const current = await page.evaluate(({ expected, prefix, suffix, candidates }) => {
      const field = document.querySelector('#easymde-source'), active = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      // Actual strings stay private in this evaluation; emit exact-match booleans and a bounded enum only.
      const value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length
        && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      const candidateExact = Object.fromEntries(Object.entries(candidates).map(([kind, candidate]) => [kind, target !== null && target === candidate]));
      const classification = Object.keys(candidates).find((kind) => candidateExact[kind]) ?? 'other';
      return { available: true, sourceLength: value?.length ?? null,
        sourceExact: value === null ? null : value === expected, visualOwnerPresent: !!active,
        sourceClassification: { available: value !== null, outsideCellExact, targetExtractable: target !== null,
          classification, candidateExact },
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null };
    }, { expected: SourceFixture[expectedKey], prefix, suffix, candidates: sourceCandidates }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), expectedKey)
      .then((value) => ({ available: true, ...value }), () => ({ available: false })) : { available: false };
    // Read once at failure: do not wait for Preview publication or repair the native caret.
    const finalFormal = await runtimeState(expectedKey).then((state) => ({ available: true,
      phase: state.phase, previewLoading: state.previewLoading, sourceLength: state.sourceLength,
      sourceMatchesFixedOracle: state.sourceMatchesExpected }), () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-code-first-failure', timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, diagnostics }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-console-remove', () => page.off('console', observeDiagnostic));
    if (receipts) { await cleanup('rich-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-code-cleanup', timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-code-cleanup-failed');
  }
});
}
}

// Opt-in non-CODE rich cells. Keep the separately frozen CODE acceptance unchanged.
if (process.env.EASYMDE_E2E_RICH_TABLE_INLINE === 'complete') {
const richInlineHref = 'https://example.com/rich?q=1&v=2';
const richInlineCases = [
  { kind: 'A', selector: 'a', chain: ['A'], before: 'L [', after: `](${richInlineHref} "Keep") R`, linked: true },
  { kind: 'EM', selector: 'em', chain: ['EM'], before: 'L *', after: '* R', linked: false },
  { kind: 'STRONG', selector: 'strong', chain: ['STRONG'], before: 'L **', after: '** R', linked: false },
  { kind: 'DEL', selector: 'del, s, strike', chain: ['DEL'], before: 'L ~~', after: '~~ R', linked: false },
  { kind: 'NESTED', selector: 'em', chain: ['STRONG', 'A', 'DEL', 'EM'], before: 'L **[~~*',
    after: `*~~](${richInlineHref} "Keep")** R`, linked: true }
];
for (const inline of richInlineCases) {
for (const timing of ['ready', 'held']) {
test(`[rich-table-inline] windowed ${timing} fixed ${inline.kind} Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\n'
    + 'After \\*literal\\* **outside** *emphasis* [keep](https://example.com/keep?q=1&v=2 "Guard").\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Fixed semantic contract: unlike CODE, these wrappers contain the real BR without splitting/normalizing tags.
  // Every oracle is built only from these declared fragments, never from native DOM or a PHP response.
  const bodies = { S0: 'AB', S1: 'A<br>B', S1T: 'A<br>TB', ST: 'ATB' };
  const targetSource = Object.fromEntries(Object.entries(bodies).map(([key, body]) => [key, inline.before + body + inline.after]));
  const SourceFixture = Object.fromEntries(Object.entries(targetSource).map(([key, value]) => [key, prefix + value + suffix]));
  SourceFixture.SV = prefix.replace(/^Lead\./u, 'Lead.V') + targetSource.S0 + suffix;
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-inline-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const browserErrors = { pageErrors: 0, popups: 0, dialogs: 0 };
  const onPageError = () => { browserErrors.pageErrors++; };
  const onPopup = () => { browserErrors.popups++; };
  const onDialog = (dialog) => { browserErrors.dialogs++; void dialog.dismiss().catch(() => {}); };
  page.on('pageerror', onPageError); page.on('popup', onPopup); page.on('dialog', onDialog);
  let phase = 'initial-formal-S0', expectedKey = 'S0', held = null, retainedNodes = null, receipts = null;
  let primaryError = null, lastObservation = null;
  const healthy = () => { expect(failures).toEqual([]); expect(browserErrors).toEqual({ pageErrors: 0, popups: 0, dialogs: 0 }); };
  const runtimeState = (key) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key] });
  const checkpoint = async (stage, key, pending, formal = false, point = false, renderRequired = true) => {
    phase = stage; expectedKey = key; healthy();
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      healthy(); const state = await runtimeState(key);
      return state.sourceMatchesExpected && (pending === undefined || state.previewLoading === pending)
        && (!formal || state.phase === 'ready');
    }).toBe(true);
    const state = await runtimeState(key), owner = await readPublicEditorState(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, sourceExact: state.sourceMatchesExpected, sourceLength: state.sourceLength,
      owner: { sourceLength: owner.sourceLength, editable: owner.effectiveEditable, nativeConnected: owner.nativeConnected },
      phase: state.phase, previewLoading: state.previewLoading,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled', render, browserErrors: { ...browserErrors } };
    console.log(JSON.stringify({ event: 'rich-inline-checkpoint', kind: inline.kind, timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true, contenteditable: 'true',
      lock: 'false', session: 'ready' });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current).toMatchObject({ available: true, tableUnique: true, targetUnique: true, headersExact: true,
        guardCellsExact: true, leafCount: 1, chainExact: true, linkAttributesExact: true, leafEditable: true, codeCount: 0 });
      if (renderRequired) expect(render.current).toMatchObject({ textExact: true, glyphsExact: true, breakCountExact: true,
        breakInsideLeaf: true, literalBrVisible: false });
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: key === 'S1T' || key === 'ST' ? 2 : 1,
        prefixBreaks: key === 'S1' || key === 'S1T' ? 1 : 0 });
    }
    healthy(); return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readPublicEditorState(page); await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
  };
  const clickBeforeB = async () => {
    const point = await cell.evaluate((target, selector) => {
      const leaves = target.querySelectorAll(selector);
      if (leaves.length !== 1) throw new Error('rich-inline-pointer-leaf-not-unique');
      const walker = document.createTreeWalker(leaves[0], NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.data.length; index++) if (node.data[index] === 'B') matches.push({ node, offset: index });
      }
      if (matches.length !== 1) throw new Error('rich-inline-pointer-B-not-unique');
      const range = document.createRange(); range.setStart(matches[0].node, matches[0].offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-inline-pointer-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, inline.selector);
    await page.mouse.click(point.x, point.y);
  };
  try {
    await checkpoint('initial-formal-S0', 'S0', false, true);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    receipts = await surface.evaluateHandle((root, spec) => {
      const events = []; let nativeEnter = null, nativeText = null, nativeBackspace = null;
      let readyNavigationBaseline = null, rootInputEvents = 0, rootHistoryKeys = 0;
      const readReadyIdentity = () => {
        const container = document.querySelector('#easymde-editor-root');
        const field = document.querySelector('#easymde-source');
        const native = getSelection();
        const point = (node, offset) => ({
          connected: !!node?.isConnected,
          nodeType: node?.nodeType ?? null,
          parentTag: node?.parentElement?.tagName ?? null,
          offset
        });
        const value = field instanceof HTMLTextAreaElement ? field.value : null;
        return { container, surface: root, field, value, nodes: [...root.childNodes],
          ready: root.getAttribute('data-easymde-preview-phase') === 'ready'
            && document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') === 'ready'
            && root.isConnected && root.isContentEditable,
          nativeConnected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
            && root.contains(native.anchorNode) && root.contains(native.focusNode),
          nativeCollapsed: native?.isCollapsed === true,
          selectionJSON: JSON.stringify({ anchor: point(native?.anchorNode, native?.anchorOffset ?? 0),
            focus: point(native?.focusNode, native?.focusOffset ?? 0) }),
          rootInputEvents, rootHistoryKeys };
      };
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const shape = () => {
        const cell = target(), tables = root.querySelectorAll('blockquote li table'), table = tables.length === 1 ? tables[0] : null;
        const rows = [...(table?.tBodies[0]?.rows ?? [])], leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])];
        const leaf = leaves.length === 1 ? leaves[0] : null, chain = [], links = [...(cell?.querySelectorAll('a') ?? [])];
        for (let node = leaf; node && node !== cell; node = node.parentElement) {
          if (node.tagName !== 'SPAN') chain.unshift(['S', 'STRIKE'].includes(node.tagName) ? 'DEL' : node.tagName);
        }
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, tableUnique: tables.length === 1, targetUnique: rows[1]?.cells[1] === cell,
          headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
          text: cell?.innerText ?? '', glyphs: leaf?.textContent ?? '', breaks: cell?.querySelectorAll('br').length ?? 0,
          leafBreaks: leaf?.querySelectorAll('br').length ?? 0, leafCount: leaves.length,
          chainExact: chain.length === spec.chain.length && chain.every((tag, index) => tag === spec.chain[index]),
          linkAttributesExact: spec.linked ? links.length === 1 && links[0].getAttribute('href') === spec.href
            && links[0].getAttribute('title') === 'Keep' : links.length === 0,
          leafEditable: leaf?.isContentEditable === true, codeCount: cell?.querySelectorAll('code').length ?? 0 };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        if (event.type === 'keydown') {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) rootHistoryKeys++;
          return;
        }
        rootInputEvents++;
        const cell = target(), selection = getSelection();
        if (!cell?.contains(selection?.anchorNode)) return;
        const types = ['insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'insertText', 'historyUndo', 'historyRedo'];
        if (events.length < 40) events.push({ type: event.type, inputType: types.includes(event.inputType) ? event.inputType : 'unrecognized',
          trusted: event.isTrusted, collapsed: selection?.isCollapsed === true });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText') nativeText = { ...shape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true); document.addEventListener('keydown', observe, true);
      return {
        captureReadyNavigation: (expectedSource) => {
          const before = readReadyIdentity(); readyNavigationBaseline = { ...before, expectedSource };
          return { ready: before.ready, sourceExact: before.value === expectedSource,
            nativeConnected: before.nativeConnected, nativeCollapsed: before.nativeCollapsed,
            nodesCurrent: before.nodes.every((node) => node.isConnected) };
        },
        checkReadyNavigation: () => {
          if (!readyNavigationBaseline) throw new Error('rich-inline-ready-baseline-unavailable');
          const before = readyNavigationBaseline, after = readReadyIdentity();
          return { readyBeforeAndAfter: before.ready && after.ready,
            sameSurface: after.surface === before.surface && after.container === before.container,
            sourceExact: before.value === before.expectedSource && after.value === before.expectedSource,
            fieldMatchesOwner: after.field === before.field && after.value === before.value,
            nativeConnected: before.nativeConnected && after.nativeConnected,
            nativeCollapsed: before.nativeCollapsed && after.nativeCollapsed,
            selectionRetained: after.selectionJSON === before.selectionJSON,
            nodesUnchanged: after.nodes.length === before.nodes.length && after.nodes.every((node, index) => node === before.nodes[index]),
            noInputEvents: after.rootInputEvents === before.rootInputEvents, noHistoryKeys: after.rootHistoryKeys === before.rootHistoryKeys };
        },
        safe: (kind) => {
        const current = shape(), cell = target(), leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])], leaf = leaves.length === 1 ? leaves[0] : null;
        const native = getSelection(), anchor = native?.anchorNode, focus = native?.focusNode;
        const glyphs = kind === 'S1T' || kind === 'ST' ? 'ATB' : 'AB';
        const breaks = kind === 'S1' || kind === 'S1T' ? 1 : 0;
        const expectedText = kind === 'S1T' ? 'L A\nTB R' : kind === 'S1' ? 'L A\nB R' : kind === 'ST' ? 'L ATB R' : 'L AB R';
        const scalar = (value) => ({ available: value.available, tableUnique: value.tableUnique, targetUnique: value.targetUnique,
          headersExact: value.headersExact, guardCellsExact: value.guardCellsExact, leafCount: value.leafCount, chainExact: value.chainExact,
          linkAttributesExact: value.linkAttributesExact, leafEditable: value.leafEditable, codeCount: value.codeCount,
          textLength: value.text.length, glyphLength: value.glyphs.length, breaks: value.breaks,
          textExact: value.text === expectedText, glyphsExact: value.glyphs === glyphs, breakCountExact: value.breaks === breaks,
          breakInsideLeaf: value.leafBreaks === value.breaks, literalBrVisible: value.text.includes('<br>') });
        const insideCell = !!cell && !!anchor && !!focus && cell.contains(anchor) && cell.contains(focus);
        const insideLeaf = !!leaf && !!anchor && !!focus && leaf.contains(anchor) && leaf.contains(focus);
        const sameCollapsedPoint = native?.isCollapsed === true && anchor === focus && native.anchorOffset === native.focusOffset;
        const bPoints = [];
        if (leaf) {
          const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (let offset = 0; offset < node.data.length; offset++) if (node.data[offset] === 'B') bPoints.push({ node, offset });
          }
        }
        const targetPoint = bPoints.length === 1 ? bPoints[0] : null;
        const transparent = (node) => node instanceof Element
          && ['A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'SPAN', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        let rank = 0, targetRank = null, anchorRank = null, focusRank = null;
        const record = (node, offset, value) => {
          if (targetPoint?.node === node && targetPoint.offset === offset) targetRank = value;
          if (anchor === node && native.anchorOffset === offset) anchorRank = value;
          if (focus === node && native.focusOffset === offset) focusRank = value;
        };
        const visit = (node) => {
          if (node instanceof Text) {
            for (let offset = 0; offset <= node.data.length; offset++) record(node, offset, rank + offset);
            rank += Math.max(1, node.data.length); return;
          }
          // BR/comment/opaque nodes carry a nonzero token: equivalence cannot cross any of them.
          if (!transparent(node)) { rank++; return; }
          record(node, 0, rank);
          [...node.childNodes].forEach((child, index) => { visit(child); record(node, index + 1, rank); });
        };
        if (leaf) visit(leaf);
        const forward = (node, offset) => {
          if (!targetPoint || !node || !leaf?.contains(node)) return false;
          const actual = document.createRange(), expected = document.createRange();
          actual.setStart(node, offset); actual.collapse(true); expected.setStart(targetPoint.node, targetPoint.offset); expected.collapse(true);
          return actual.compareBoundaryPoints(Range.START_TO_START, expected) <= 0;
        };
        const anchorForward = forward(anchor, native?.anchorOffset ?? 0), focusForward = forward(focus, native?.focusOffset ?? 0);
        const noObservableTokenBetween = targetRank !== null && anchorRank === targetRank && focusRank === targetRank;
        const semanticBeforeB = insideLeaf && sameCollapsedPoint && bPoints.length === 1 && anchorForward && focusForward && noObservableTokenBetween;
        let bodyGlyphPrefix = null, prefixBreaks = null;
        if (insideLeaf) {
          const range = document.createRange(); range.selectNodeContents(leaf); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents(); bodyGlyphPrefix = fragment.textContent.length; prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const raw = (node, offset) => ({ nodeType: node?.nodeType ?? null, ownTag: node instanceof Element ? node.tagName : null,
          parentTag: node?.parentElement?.tagName ?? null, offset, connected: !!node?.isConnected });
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          nativeText: nativeText ? { ...scalar(nativeText), trusted: nativeText.trusted } : null,
          nativeBackspace: nativeBackspace ? { ...scalar(nativeBackspace), trusted: nativeBackspace.trusted } : null,
          matchesNativeText: comparison ? current.text === comparison.text : null, matchesNativeGlyphs: comparison ? current.glyphs === comparison.glyphs : null,
          nativeConnected: !!anchor?.isConnected && !!focus?.isConnected, nativeInsideCell: insideCell, nativeInsideLeaf: insideLeaf,
          nativeCollapsed: native?.isCollapsed === true, nativeAnchor: raw(anchor, native?.anchorOffset ?? 0), nativeFocus: raw(focus, native?.focusOffset ?? 0),
          bodyGlyphPrefix, prefixBreaks, semanticBeforeB,
          boundaryProof: { leafUnique: leaves.length === 1, bTextUnique: bPoints.length === 1, sameCollapsedPoint,
            targetRank, anchorRank, focusRank, anchorForward, focusForward, noObservableTokenBetween,
            rawTextBeforeB: !!targetPoint && anchor === targetPoint.node && native.anchorOffset === targetPoint.offset }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true);
        document.removeEventListener('keydown', observe, true); readyNavigationBaseline = null; } };
    }, { selector: inline.selector, chain: inline.chain, linked: inline.linked, href: richInlineHref });
    await checkpoint('loaded-unique-rich-target', 'S0', false, true);
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click(); await page.keyboard.press('End');
    phase = 'real-Lead-V'; await page.keyboard.type('V'); await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]); held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    await checkpoint('before-rich-Enter', 'S0', timing === 'held');
    if (timing === 'ready') {
      phase = 'capture-ready-pre-navigation';
      const before = await receipts.evaluate((observer, expected) => observer.captureReadyNavigation(expected), SourceFixture.S0);
      console.log(JSON.stringify({ event: 'rich-inline-ready-pre-navigation', kind: inline.kind, timing, before }));
      expect(before).toMatchObject({ ready: true, sourceExact: true, nativeConnected: true,
        nativeCollapsed: true, nodesCurrent: true });
    }
    await clickBeforeB();
    await checkpoint('real-initial-before-B', 'S0', timing === 'held', timing === 'ready', true);
    const beforeB = await readPublicEditorState(page);
    expect({ sourceExact: beforeB.source === SourceFixture.S0, nativeConnected: beforeB.nativeConnected,
      nativeCollapsed: beforeB.nativeCollapsed, effectiveEditable: beforeB.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
    if (timing === 'ready') {
      const evidence = await receipts.evaluate((observer) => ({ certificate: observer.checkReadyNavigation(),
        native: observer.safe('S0') }));
      console.log(JSON.stringify({ event: 'rich-inline-ready-native-first', kind: inline.kind, timing, ...evidence }));
      expect(evidence.certificate).toMatchObject({ readyBeforeAndAfter: true, sameSurface: true,
        sourceExact: true, fieldMatchesOwner: true, nativeConnected: true, nativeCollapsed: true,
        selectionRetained: true, nodesUnchanged: true, noInputEvents: true, noHistoryKeys: true });
      expect(evidence.native).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: 1, prefixBreaks: 0,
        current: { tableUnique: true, targetUnique: true, leafCount: 1, chainExact: true, linkAttributesExact: true,
          leafEditable: true, textExact: true, glyphsExact: true, breakCountExact: true, guardCellsExact: true } });
    } else {
      const heldBeforeB = await readPublicEditorState(page);
      expect({ sourceExact: heldBeforeB.source === SourceFixture.S0, nativeConnected: heldBeforeB.nativeConnected,
        nativeCollapsed: heldBeforeB.nativeCollapsed }).toEqual({
        sourceExact: true, nativeConnected: true, nativeCollapsed: true });
    }
    const edit = async (stage, key, pending, formal = false, point = true, renderRequired = true) =>
      checkpoint(stage, key, pending, formal, point, renderRequired);
    phase = 'real-rich-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('rich-Enter-fixed-S1', 'S1', timing === 'held' ? true : undefined);
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, textExact: true, glyphsExact: true, breakCountExact: true,
      breakInsideLeaf: true, chainExact: true, linkAttributesExact: true });
    if (timing === 'held') { await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, true); }
    else { await acceptFixed('S1'); await clickBeforeB(); await edit('formal-S1-real-before-B', 'S1', false, true); }
    phase = 'real-rich-Backspace'; await page.keyboard.press('Backspace');
    const deleted = await edit('rich-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined);
    expect(deleted.render.nativeBackspace).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      breakCountExact: true, chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-rich-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-rich-Backspace-fixed-S1', 'S1', timing === 'held' ? true : undefined, false, false, false);
    phase = 'real-Redo-rich-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-rich-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, false, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', false, true);
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-before-B', 'S1', false, true);
    phase = 'real-Undo-rich-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', false, true);
    phase = 'real-Redo-rich-Enter'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-Enter-formal-S1-before-B', 'S1', false, true);
    // No pointer/selection repair between the proven history-restored point and this real input.
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    const rightTyped = await edit('right-span-fixed-S1T', 'S1T', undefined);
    expect(rightTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    await acceptFixed('S1T'); await clickBeforeB(); await edit('formal-S1T-real-before-B', 'S1T', false, true);
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', false, true);
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', false, true);
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    const originalTyped = await edit('original-span-fixed-ST', 'ST', undefined);
    expect(originalTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', false, true); healthy();
  } catch (error) {
    primaryError = error;
    const owner = await readPublicEditorState(page)
      .then((value) => ({ available: true, ...safePublicState(value) }), () => ({ available: false }));
    const current = await page.evaluate(({ prefix, suffix, expected, variants }) => {
      const field = document.querySelector('#easymde-source'), value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      return { available: value !== null, sourceLength: value?.length ?? null, sourceExact: value === expected, outsideCellExact,
        targetMatchesDeclared: Object.fromEntries(Object.entries(variants).map(([key, candidate]) => [key, target !== null && target === candidate])) };
    }, { prefix, suffix, expected: SourceFixture[expectedKey], variants: targetSource }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, key) => observer.safe(key), expectedKey).catch(() => ({ available: false })) : null;
    const finalFormal = await runtimeState(expectedKey).then((state) => ({ available: true, phase: state.phase,
      previewLoading: state.previewLoading, sourceLength: state.sourceLength, sourceMatchesExpected: state.sourceMatchesExpected }),
      () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-inline-first-failure', kind: inline.kind, timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, browserErrors }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-inline-page-listeners-remove', () => { page.off('pageerror', onPageError); page.off('popup', onPopup); page.off('dialog', onDialog); });
    if (receipts) { await cleanup('rich-inline-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-inline-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-inline-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-inline-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-inline-cleanup', kind: inline.kind, timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-inline-cleanup-failed');
  }
});
}
}
}

test('windowed rich starting blocks retain exact source through mixed position history', async ({ page }) => {
  const blocks = [
    '# Heading', '', 'Opening paragraph.', '', '- outer item', '  - inner item', '',
    '> quoted paragraph', '', '[linked words](https://example.com)', '',
    '| left | right |', '| --- | --- |', '| cell | value |', '',
    '~~~python', 'value = 123', '~~~', ''
  ].join('\n');
  const initial = blocks + '\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const targets = [
    { selector: 'h1', needle: 'Heading' }, { selector: 'p', needle: 'Opening paragraph.' },
    { selector: 'ul > li', needle: 'outer item' }, { selector: 'blockquote p', needle: 'quoted paragraph' },
    { selector: 'a', needle: 'linked words' }, { selector: 'td', needle: 'cell' }, { selector: 'pre code', needle: 'value = 123' }
  ];
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''],
        [initial],
        ...targets.flatMap(({ needle }) => {
          const sourcePoint = initial.indexOf(needle) + 1;
          const edited = initial.slice(0, sourcePoint) + 'X' + initial.slice(sourcePoint);
          return [[edited], [initial], [edited], [initial]];
        })
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect.poll(async () => await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  for (const { selector, needle } of targets) {
    const target = visual.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const point = await target.evaluate(element => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text;
      while (walker.nextNode()) {
        if (walker.currentNode instanceof Text && walker.currentNode.data.trim()) { text = walker.currentNode; break; }
      }
      if (!text) throw new Error('windowed-rich-initial-body-missing');
      const range = element.ownerDocument.createRange(); range.setStart(text, 0); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    const sourcePoint = initial.indexOf(needle) + 1;
    expect(sourcePoint > 0 && initial.indexOf(needle, sourcePoint) === -1).toBe(true);
    const edited = initial.slice(0, sourcePoint) + 'X' + initial.slice(sourcePoint);
    await page.keyboard.type('X');
    expect(failures, `first input ${selector}`).toEqual([]);
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-X`, { selector }, 2);
    await page.keyboard.press('Control+z');
    expect(failures, `undo ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Undo`, { selector }, 1);
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo ${selector}`).toEqual([]);
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Redo`, { selector }, 2);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    expect(failures, `backspace ${selector}`).toEqual([]);
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, `rich-${selector}-Backspace`, { selector }, 1);
    expect(failures, `mixed history ${selector}`).toEqual([]);
  }
  await previewRead.prove({ visual });
});

test('rich windowed document crosses the rendering threshold, empties and restores exactly', async ({ page }) => {
  test.setTimeout(600_000);
  const fixture = richWindowedFixture();
  const { initial } = fixture;
  const deletionModel = createRichDeletionModel(fixture);
  const deletionForward = richWindowedForwardGroups(fixture);
  const deletionReverse = deletionForward.slice().reverse().map((group) => [...group]);
  const emptyGroup = [...RICH_EMPTY_ROWS];
  const typedXGroup = ['X', 'X ', 'X  ', 'X\n', 'X\n\n', ' X', '  X', '\nX', '\n\nX'];
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'delete', groups: deletionForward },
    { id: 'empty-continuation', groups: [emptyGroup, typedXGroup, emptyGroup] },
    { id: 'undo-restore', groups: deletionReverse }
  ]);
  const { failures, source, visual, browserMonitor } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  previewRead.enterPhase('delete');
  // Fail fast: a blocked Backspace must not spin the bounded loop for minutes.
  // Only classified monitor codes are reported; no console text or content.
  const RICH_ZERO_PROGRESS_BACKSPACE_LIMIT = 3;
  let consecutiveZeroProgressBackspaces = 0;
  const expectNoUnapprovedBrowserErrors = (label) => {
    const browserErrors = browserMonitor.summary().issues
      .filter((issue) => /^(?:console-error:|page-error$|unhandled-rejection$)/u.test(issue));
    if (browserErrors.length !== 0) {
      expect(browserErrors, `${label} must not record an unapproved console, page, or rejection error`).toEqual([]);
    }
  };
  let emptied = false;
  let deletionKeys = 0;
  let tableDeleted = false;
  let noSpacerObserved = false;
  let firstNoSpacerAt = null;
  let lastSpacerAt = null;
  let headerCellsEmptied = false;
  let emptyHeaderCellsObserved = false;
  let firstEmptyHeaderAt = null;
  const RICH_BACKSPACE_PACING_MS = 110;
  const pressBackspacePaced = async () => {
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(RICH_BACKSPACE_PACING_MS);
  };
  const readRichStepSnapshot = (checkSpacers, includeTable) => page.evaluate(({ checkSpacers: wantSpacers, includeTable: wantTable }) => {
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const field = document.querySelector('#easymde-source');
    const value = field instanceof HTMLTextAreaElement ? field.value : null;
    const native = getSelection();
    const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const liveSelection = !!surface
      && !!native?.anchorNode?.isConnected
      && !!native.focusNode?.isConnected
      && surface.contains(native.anchorNode)
      && surface.contains(native.focusNode);
    const contenteditable = surface?.getAttribute('contenteditable') ?? null;
    let position = null;
    if (surface && native && range) {
      let block = native.anchorNode;
      while (block && block.parentNode !== surface) block = block.parentNode;
      if (block && block.parentNode !== surface) block = null;
      let textOffset = native.anchorNode === surface ? 0 : null;
      if (block && native.anchorNode && block.contains(native.anchorNode)) {
        const prefix = surface.ownerDocument.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        textOffset = prefix.toString().length;
      }
      position = {
        connected: liveSelection,
        collapsed: native.isCollapsed === true,
        focused: surface.ownerDocument.activeElement === surface,
        editable: surface.isContentEditable,
        blockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        blockTag: block?.tagName ?? null,
        blockLength: block?.textContent.length ?? null,
        textOffset
      };
    }
    let table = null;
    if (wantTable && value !== null) {
      const tables = surface?.querySelectorAll('table') ?? [];
      if (tables.length === 1) {
        const tableNode = tables[0];
        const lines = [];
        let offset = 0;
        while (offset <= value.length) {
          const next = value.indexOf('\n', offset);
          const end = next < 0 ? value.length : next;
          lines.push({ start: offset, end, text: value.slice(offset, end).replace(/\r$/u, '') });
          if (next < 0) break;
          offset = next + 1;
        }
        const isTableLine = (line) => /^ {0,3}\|/u.test(line.text);
        const cells = (line) => {
          const text = line.text.trim();
          if (!text.startsWith('|') || !text.endsWith('|')) return null;
          return text.slice(1, -1).split('|').map((cell) => cell.trim());
        };
        const blocks = [];
        for (let index = 0; index < lines.length;) {
          if (!isTableLine(lines[index])) { index += 1; continue; }
          let end = index + 1;
          while (end < lines.length && isTableLine(lines[end])) end += 1;
          blocks.push(lines.slice(index, end)); index = end;
        }
        const valid = blocks.filter((block) => block.length >= 3
          && cells(block[0]) && cells(block[1])?.every((cell) => /^:?-+:?$/u.test(cell))
          && block.slice(2).every((line) => cells(line)));
        if (valid.length === 1) {
          const block = valid[0], header = cells(block[0]), dataRows = block.slice(2).map(cells);
          const sourceColumnCount = header.length;
          const sourceRowsValid = block.slice(2).every((line) => cells(line)?.length === sourceColumnCount);
          const sourceCellsAllEmpty = header.every((cell) => cell === '')
            && dataRows.every((row) => row.every((cell) => cell === ''));
          const rows = [...tableNode.rows];
          const headerRows = tableNode.tHead
            ? [...tableNode.tHead.rows]
            : rows.filter((row) => row.cells.length && row.cells[0] instanceof HTMLTableCellElement && row.cells[0].tagName === 'TH');
          const bodyRows = tableNode.tBodies.length
            ? [...tableNode.tBodies].flatMap((body) => [...body.rows])
            : rows.slice(headerRows.length);
          const headerCells = headerRows.flatMap((row) => [...row.cells]);
          const bodyCells = bodyRows.flatMap((row) => [...row.cells]);
          const rowCellCounts = rows.map((row) => row.cells.length);
          const domColumnCount = headerCells.length / Math.max(1, headerRows.length);
          const caretInsideTable = !!range && native?.isCollapsed === true && !!native.anchorNode
            && tableNode.contains(native.anchorNode) && tableNode.contains(native.focusNode);
          const emptyCell = (cell) => cell.textContent.trim() === '';
          table = {
            tableCount: tables.length,
            sourceStart: block[0].start,
            sourceEnd: block.at(-1).end,
            sourceRowCount: block.length,
            sourceColumnCount,
            sourceRowsValid,
            sourceCellsAllEmpty,
            domRowCount: headerRows.length + bodyRows.length,
            domColumnCount,
            domRowCellCounts: rowCellCounts,
            domShapeMatchesSource: headerRows.length === 1 && bodyRows.length === dataRows.length
              && Number.isSafeInteger(domColumnCount)
              && domColumnCount === sourceColumnCount && rowCellCounts.every((count) => count === sourceColumnCount),
            headerCellCount: headerCells.length,
            dataCellCount: bodyCells.length,
            emptyHeaderCellCount: headerCells.filter(emptyCell).length,
            emptyDataCellCount: bodyCells.filter(emptyCell).length,
            emptyHeaderCells: headerCells.length > 0 && headerCells.every(emptyCell),
            emptyDataCells: bodyCells.length > 0 && bodyCells.every(emptyCell),
            cellsAllEmpty: headerCells.length > 0 && bodyCells.length > 0
              && headerCells.every(emptyCell) && bodyCells.every(emptyCell),
            caretInsideTable
          };
        }
      }
    }
    const spacerCount = wantSpacers
      ? (surface?.querySelectorAll('[data-easymde-preview-window-spacer]').length ?? 0)
      : null;
    return { value, position, contenteditable, liveSelection, spacerCount, table };
  }, { checkSpacers, includeTable });
  let currentSnapshot = null;
  for (; deletionKeys < initial.length * 2 + 200; deletionKeys += 1) {
    const beforeSnapshot = currentSnapshot
      ?? await readRichStepSnapshot(false, !tableDeleted);
    const tableBefore = tableDeleted ? null : beforeSnapshot.table;
    if (tableBefore && !tableBefore.sourceRowsValid) throw new Error(`rich-deletion-table-source-invalid:${deletionKeys}`);
    if (tableBefore?.cellsAllEmpty) {
      expect({ sourceCellsAllEmpty: tableBefore.sourceCellsAllEmpty,
        domShapeMatchesSource: tableBefore.domShapeMatchesSource,
        emptyHeaderCells: tableBefore.emptyHeaderCells, emptyDataCells: tableBefore.emptyDataCells,
        caretInsideTable: tableBefore.caretInsideTable }).toEqual({ sourceCellsAllEmpty: true,
        domShapeMatchesSource: true, emptyHeaderCells: true, emptyDataCells: true, caretInsideTable: true });
      const beforeTableDelete = await source.inputValue();
      const tableLocator = visual.locator('table').first();
      await tableLocator.scrollIntoViewIfNeeded();
      await tableLocator.click({ button: 'right' });
      expect((await source.inputValue()) === beforeTableDelete,
        'opening the real table context menu must not change source').toBe(true);
      const tableSubmenu = page.locator('[data-easymde-context-menu-item="table"]').last();
      await expect(tableSubmenu).toBeVisible();
      await tableSubmenu.click();
      const deleteTable = page.locator('[data-easymde-context-menu-item="delete-table"]').last();
      await expect(deleteTable).toBeEnabled();
      await deleteTable.click();
      await page.waitForTimeout(RICH_BACKSPACE_PACING_MS);
      expect(failures, `rich deletion ${deletionKeys} table menu`).toEqual([]);
      expectNoUnapprovedBrowserErrors(`rich deletion ${deletionKeys} table menu`);
      consecutiveZeroProgressBackspaces = 0;
      const afterTableDelete = await source.inputValue();
      const expectedTableDelete = beforeTableDelete.slice(0, tableBefore.sourceStart)
        + beforeTableDelete.slice(tableBefore.sourceEnd);
      expect(afterTableDelete === expectedTableDelete,
        'delete-table must remove exactly the independently identified table interval').toBe(true);
      expect(beforeTableDelete.slice(0, tableBefore.sourceStart)
        === expectedTableDelete.slice(0, tableBefore.sourceStart),
      'delete-table must preserve every byte before the table').toBe(true);
      expect(beforeTableDelete.slice(tableBefore.sourceEnd)
        === expectedTableDelete.slice(tableBefore.sourceStart),
      'delete-table must preserve every byte after the table').toBe(true);
      expect(await visual.locator('table').count()).toBe(0);
      await expectLiveSelection(visual);
      commitRichTableDeletion(deletionModel, afterTableDelete);
      tableDeleted = true;
      currentSnapshot = null;
      continue;
    }
    const step = expectedRichDeletionStep(deletionModel);
    const before = beforeSnapshot.value ?? await source.inputValue();
    const beforePosition = beforeSnapshot.position;
    const beforeMatch = richDeletionObservationMatches(step, { source: before, caret: beforePosition }, 'before');
    if (!beforeMatch.sourceExact || !beforeMatch.caretExact) {
      expect(beforeMatch).toEqual({ sourceExact: true, caretExact: true });
    }
    await pressBackspacePaced();
    if (failures.length !== 0) {
      expect(failures, `rich deletion ${deletionKeys}`).toEqual([]);
    }
    expectNoUnapprovedBrowserErrors(`rich deletion ${deletionKeys}`);
    const checkSpacers = deletionKeys % 16 === 0;
    const afterSnapshot = await readRichStepSnapshot(checkSpacers, !tableDeleted);
    currentSnapshot = afterSnapshot;
    if (afterSnapshot.contenteditable !== 'true' || !afterSnapshot.liveSelection) {
      await expectLiveSelection(visual);
    }
    const value = afterSnapshot.value ?? await source.inputValue();
    const afterPosition = afterSnapshot.position;
    if (value === before) {
      consecutiveZeroProgressBackspaces += 1;
      if (consecutiveZeroProgressBackspaces >= RICH_ZERO_PROGRESS_BACKSPACE_LIMIT) {
        const caretMoved = JSON.stringify(afterPosition) !== JSON.stringify(beforePosition);
        throw new Error(`rich-deletion-zero-progress-backspace-bound:key=${deletionKeys}`
          + `:consecutive=${consecutiveZeroProgressBackspaces}:sourceLength=${value.length}`
          + `:caretMoved=${caretMoved}:blockTag=${afterPosition?.blockTag ?? 'none'}`);
      }
    } else {
      consecutiveZeroProgressBackspaces = 0;
    }
    const afterMatch = richDeletionObservationMatches(step, { source: value, caret: afterPosition }, 'after');
    if (!afterMatch.sourceExact || !afterMatch.caretExact) {
      expect(afterMatch).toEqual({ sourceExact: true, caretExact: true });
    }
    commitRichDeletion(deletionModel, step, value);
    const tableAfter = tableDeleted ? null : afterSnapshot.table;
    if (tableBefore) {
      if (tableAfter === null) {
        expect(tableAfter !== null, `rich deletion ${deletionKeys} must retain the translated table structure`).toBe(true);
      }
      if (tableAfter) {
        const rowsOk = tableAfter.domRowCount === tableBefore.domRowCount;
        const columnsOk = tableAfter.domColumnCount === tableBefore.domColumnCount;
        const rowCellsOk = tableAfter.domRowCellCounts.length === tableBefore.domRowCellCounts.length
          && tableAfter.domRowCellCounts.every((count, index) => count === tableBefore.domRowCellCounts[index]);
        const headerCellsOk = tableAfter.headerCellCount === tableBefore.headerCellCount;
        const dataCellsOk = tableAfter.dataCellCount === tableBefore.dataCellCount;
        const headerEmptinessMonotonic = tableAfter.emptyHeaderCellCount >= tableBefore.emptyHeaderCellCount;
        const dataEmptinessMonotonic = tableAfter.emptyDataCellCount >= tableBefore.emptyDataCellCount;
        const sourceShapeMatches = tableAfter.domShapeMatchesSource && tableAfter.sourceRowsValid;
        if (
          !rowsOk || !columnsOk || !rowCellsOk || !headerCellsOk || !dataCellsOk
          || !headerEmptinessMonotonic || !dataEmptinessMonotonic || !sourceShapeMatches
        ) {
          expect({
            rows: rowsOk, columns: columnsOk, rowCells: rowCellsOk,
            headerCells: headerCellsOk, dataCells: dataCellsOk,
            headerEmptinessMonotonic, dataEmptinessMonotonic, sourceShapeMatches
          }).toEqual({
            rows: true, columns: true, rowCells: true, headerCells: true, dataCells: true,
            headerEmptinessMonotonic: true, dataEmptinessMonotonic: true, sourceShapeMatches: true
          });
        }
        if ((tableBefore.caretInsideTable || tableAfter.cellsAllEmpty) && !tableAfter.caretInsideTable) {
          expect(tableAfter.caretInsideTable,
            `rich deletion ${deletionKeys} must keep the native caret inside the table until whole-table deletion`).toBe(true);
        }
        if (tableAfter.emptyHeaderCellCount > 0) {
          emptyHeaderCellsObserved = true;
          firstEmptyHeaderAt ??= deletionKeys;
        }
        if (tableAfter.emptyHeaderCells) {
          headerCellsEmptied = true;
        }
      }
    }
    if (checkSpacers) {
      const spacerCount = afterSnapshot.spacerCount ?? 0;
      if (spacerCount === 0) {
        noSpacerObserved = true;
        firstNoSpacerAt ??= deletionKeys;
      } else {
        lastSpacerAt = deletionKeys;
      }
    }
    if (/^[^\S\r\n]*\.[^\S\r\n]*$/mu.test(value)) {
      expect(/^[^\S\r\n]*\.[^\S\r\n]*$/mu.test(value),
        `rich deletion ${deletionKeys} must not leave an invisible punctuation row`).toBe(false);
    }
    if (value.trimEnd().length > 9 && !value.startsWith('# Head')) {
      expect(value.startsWith('# Head')).toBe(true);
    }
    if (value.trim() === '') {
      emptied = true;
      deletionKeys += 1;
      break;
    }
  }
  expect(tableDeleted, 'The terminal table is deleted through the real context-menu owner').toBe(true);
  expect(emptied, 'actual Backspace reaches empty document').toBe(true);
  await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const beforeExtraEmptySource = await source.inputValue();
  expect(beforeExtraEmptySource.trim(), 'Deletion must stop at a whitespace-empty representation').toBe('');
  const beforeExtraOwner = await readPublicEditorState(page);
  const beforeExtraEmptyDom = await page.evaluateHandle(() => {
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const p0 = surface?.firstElementChild ?? null;
    return { surface, children: surface ? Array.from(surface.childNodes) : [],
      p0, br: p0?.firstChild instanceof HTMLBRElement ? p0.firstChild : null,
      p0Children: p0 ? Array.from(p0.childNodes) : [] };
  });
  let afterExtraEmptySource;
  let emptyTransition = null;
  try {
    await pressBackspacePaced();
    afterExtraEmptySource = await source.inputValue();
    expect(afterExtraEmptySource.trim(), 'The extra Backspace must leave an empty representation').toBe('');
    expect(failures, 'The extra Backspace must not emit a pageerror').toEqual([]);
    const afterExtraOwner = await readPublicEditorState(page);
    const sourceChangingClear = beforeExtraEmptySource !== afterExtraEmptySource;
    if (sourceChangingClear) {
      expect(beforeExtraEmptySource !== '', 'A source-changing empty clear must start from a non-empty representation').toBe(true);
      expect(afterExtraEmptySource === '', 'A source-changing empty clear must finish at the canonical empty string').toBe(true);
    } else {
      expect(beforeExtraEmptySource === '', 'A source-neutral Backspace must be a true source-zero no-op').toBe(true);
      expect(afterExtraEmptySource === '').toBe(true);
      expect(afterExtraOwner.nativeAnchor, 'A source-zero no-op must not move the native anchor')
        .toEqual(beforeExtraOwner.nativeAnchor);
      expect(afterExtraOwner.nativeFocus, 'A source-zero no-op must not move the native focus')
        .toEqual(beforeExtraOwner.nativeFocus);
    }
    expect({ effectiveEditable: afterExtraOwner.effectiveEditable, nativeConnected: afterExtraOwner.nativeConnected,
      nativeCollapsed: afterExtraOwner.nativeCollapsed, lock: afterExtraOwner.lock,
      session: afterExtraOwner.session }).toMatchObject({ effectiveEditable: true, nativeConnected: true,
      nativeCollapsed: true, lock: 'false', session: 'ready' });
    const emptyState = await visual.evaluate((surface, before) => {
      const native = surface.ownerDocument.getSelection();
      const directChildren = Array.from(surface.childNodes);
      const directParagraphs = Array.from(surface.querySelectorAll(':scope > p'));
      const paragraph = directParagraphs[0] ?? null;
      const directBrs = paragraph ? Array.from(paragraph.querySelectorAll(':scope > br')) : [];
      const br = directBrs[0] ?? null;
      const extraNodeCount = directChildren.filter((node) => node !== paragraph).length
        + (paragraph ? Array.from(paragraph.childNodes).filter((node) => node !== br).length : 0);
      return {
        surfaceSame: surface === before.surface,
        surfaceConnected: surface.isConnected,
        directPCount: directParagraphs.length,
        directBrCount: directBrs.length,
        solePBr: directChildren.length === 1 && directParagraphs.length === 1
          && paragraph?.childNodes.length === 1 && directBrs.length === 1,
        extraNodeCount,
        spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
        p0Same: paragraph === before.p0,
        brSame: br === before.br,
        anchorConnected: !!native?.anchorNode?.isConnected,
        focusConnected: !!native?.focusNode?.isConnected,
        inside: !!native?.anchorNode && !!native.focusNode
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        collapsed: native?.isCollapsed ?? false,
        focused: surface.ownerDocument.activeElement === surface,
        contenteditable: surface.getAttribute('contenteditable'),
        effectiveEditable: surface.isContentEditable,
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
        session: surface.ownerDocument.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status'),
        failure: surface.ownerDocument.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null
      };
    }, beforeExtraEmptyDom);
    expect(emptyState).toMatchObject({ surfaceSame: true, surfaceConnected: true,
      directPCount: 1, directBrCount: 1, solePBr: true, extraNodeCount: 0, spacerCount: 0,
      anchorConnected: true, focusConnected: true, inside: true, collapsed: true,
      focused: true, contenteditable: 'true', effectiveEditable: true, lock: 'false', session: 'ready', failure: null });
    if (!sourceChangingClear) expect(emptyState).toMatchObject({ p0Same: true, brSame: true });
    emptyTransition = { sourceChangingClear,
      beforeLength: beforeExtraEmptySource.length, afterLength: afterExtraEmptySource.length,
      beforeWasEmptyString: beforeExtraEmptySource === '', afterWasEmptyString: afterExtraEmptySource === '',
      p0IdentityPreserved: emptyState.p0Same, brIdentityPreserved: emptyState.brSame,
      directPCount: emptyState.directPCount, directBrCount: emptyState.directBrCount,
      solePBr: emptyState.solePBr, extraNodeCount: emptyState.extraNodeCount, spacerCount: emptyState.spacerCount,
      nativeConnected: afterExtraOwner.nativeConnected, nativeCollapsed: afterExtraOwner.nativeCollapsed };
    previewRead.enterPhase('empty-continuation');
    await page.keyboard.type('X');
    await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
    await page.keyboard.press('Control+z');
    await expectSource(source, afterExtraEmptySource);
    expect(failures, 'Undo after the empty continuation must not emit an error').toEqual([]);
    await expectLiveSelection(visual);
  } finally {
    await beforeExtraEmptyDom.dispose();
  }
  previewRead.enterPhase('undo-restore');
  let restored = false;
  let undoKeys = 0;
  const readRichUndoSnapshot = () => page.evaluate(() => {
    const field = document.querySelector('#easymde-source');
    const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
    const native = surface?.ownerDocument.getSelection();
    const liveSelection = !!surface
      && !!native?.anchorNode?.isConnected
      && !!native.focusNode?.isConnected
      && surface.contains(native.anchorNode)
      && surface.contains(native.focusNode);
    return {
      value: field instanceof HTMLTextAreaElement ? field.value : null,
      editable: surface?.getAttribute('contenteditable') === 'true',
      liveSelection
    };
  });
  for (; undoKeys < initial.length * 2 + 200; undoKeys += 1) {
    await page.keyboard.press('Control+z');
    if (failures.length !== 0) {
      expect(failures, `rich restoration ${undoKeys}`).toEqual([]);
    }
    const undoSnapshot = await readRichUndoSnapshot();
    if (!undoSnapshot.editable || !undoSnapshot.liveSelection) {
      await expectLiveSelection(visual);
    }
    const undoValue = undoSnapshot.value ?? await source.inputValue();
    if (undoValue === initial) {
      restored = true;
      undoKeys += 1;
      break;
    }
  }
  expect(restored, 'all Markdown is restored without source assignment').toBe(true);
  await previewRead.prove({ visual });
  await test.info().attach('windowed-threshold-history', {
    body: JSON.stringify({ deletionKeys, undoKeys, noSpacerObserved, firstNoSpacerAt, lastSpacerAt,
      emptyHeaderCellsObserved, headerCellsEmptied, firstEmptyHeaderAt,
      emptyTransition, postExtraUndoExact: true, exactRestoration: restored }),
    contentType: 'application/json'
  });
});

for (const imageKind of ['inline', 'linked', 'reference']) {
for (const timing of imageKind === 'inline' ? ['ready', 'held', 'rapid'] : ['ready', 'held']) {
test(`windowed ${imageKind} image deletion after a terminal diagram preserves structural semantics (${timing} Preview)`, async ({ page }) => {
  test.setTimeout(45_000);
  const holdPreview = timing !== 'ready';
  const { initial, image } = richWindowedFixture(imageKind);
  const { failures, source, visual } = await openVisual(page, initial);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  const held = [];
  const handlerFailures = [];
  let releasingPreview = false;
  const isAborted = (entry) => entry.aborted || entry.request.failure()?.errorText === 'net::ERR_ABORTED';
  const onRequestFailed = (request) => {
    const entry = held.find((candidate) => candidate.request === request);
    if (entry && request.failure()?.errorText === 'net::ERR_ABORTED') {
      browserMonitors.get(page)?.expectPreviewCancellation(request, 'supersede');
      entry.aborted = true;
      entry.release();
    }
  };
  page.on('requestfailed', onRequestFailed);
  if (holdPreview) {
    await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
      if (releasingPreview) return route.continue();
      const request = route.request();
      const payload = request.postDataJSON();
      if (typeof payload.markdown !== 'string' || payload.markdown.includes('```mermaid')) return route.continue();
      if (held.length >= 4) {
        handlerFailures.push('image-preview-read-bound-exceeded');
        return route.abort('aborted');
      }
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const entry = { request, markdown: payload.markdown, ready: false, aborted: false, release };
      held.push(entry);
      try {
        const response = await route.fetch({ timeout: 10_000, maxRetries: 0, maxRedirects: 0 });
        if (response.status() !== 200) throw new Error('image-preview-php-failed');
        entry.ready = true;
        await gate;
        if (isAborted(entry)) await route.abort('aborted');
        else await route.fulfill({ response });
      } catch {
        if (!isAborted(entry)) handlerFailures.push('image-preview-handler-failed');
        try { await route.abort('aborted'); }
        catch { if (!isAborted(entry)) handlerFailures.push('image-preview-abort-failed'); }
      }
    });
  }
  if (timing === 'rapid') {
    await visual.evaluate((surface) => {
      let deletions = 0;
      surface.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'deleteContentBackward' || ++deletions !== 2) return;
        const image = surface.querySelector('img[alt="dot"]');
        const native = surface.ownerDocument.getSelection();
        window.__rapidImageCaret = {
          imageMounted: !!image?.isConnected,
          parentEnd: !!image?.parentNode && native?.anchorNode === image.parentNode
            && native.anchorOffset === Array.from(image.parentNode.childNodes).indexOf(image) + 1,
          collapsed: native?.isCollapsed ?? false,
          focused: surface.ownerDocument.activeElement === surface
        };
      }, { capture: true });
    });
  }
  try {
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    const afterDiagram = timing === 'rapid'
      ? initial.slice(0, initial.lastIndexOf('\n```mermaid\n'))
      : await source.inputValue();
    expect(initial.slice(0, afterDiagram.length) === afterDiagram).toBe(true);
    expect(!afterDiagram.includes('```mermaid') && afterDiagram.includes(image)).toBe(true);
    if (timing === 'held') {
      await expect.poll(() => held.some((entry) => entry.ready && !isAborted(entry)
        && entry.markdown === afterDiagram), { timeout: 12_000 }).toBe(true);
    } else if (timing === 'ready') {
      await expect(visual.locator('.easymde-mermaid')).toHaveCount(0);
      await expect(visual).toHaveAttribute('data-easymde-preview-phase', 'ready');
    }
    if (timing !== 'rapid') await expectCaretAfterImage(visual, 'dot');
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    if (timing === 'rapid') {
      expect(await page.evaluate(() => window.__rapidImageCaret ?? null),
        'the immediately following key must start at the correct mounted image edge').toEqual({
        imageMounted: true, parentEnd: true, collapsed: true, focused: true
      });
    }
    expect(await source.inputValue() === afterDiagram.replace(image, ''),
      'the image node must be removed as a whole without editing hidden syntax').toBe(true);
    await expectLiveSelection(visual);
  } finally {
    releasingPreview = true;
    for (const entry of held) entry.release();
    if (holdPreview) await page.unrouteAll({ behavior: 'wait' });
    page.off('requestfailed', onRequestFailed);
    expect(handlerFailures).toEqual([]);
  }
});
}
}

for (const size of ['full', 'windowed']) {
for (const timing of ['normal', 'held']) {
test(`${size} reference image preserves its source while neighboring text is edited (${timing} Preview)`, async ({ page }) => {
  test.setTimeout(60_000);
  const definition = '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n';
  const paragraph = 'Opening ![dot][pic] tail.';
  const initial = definition + paragraph + '\n\n'
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const withX = initial.replace(paragraph, `${paragraph}X`);
  const minus1 = initial.replace(paragraph, paragraph.slice(0, -1));
  const minus2 = initial.replace(paragraph, paragraph.slice(0, -2));
  const continued = initial.replace(paragraph, `${paragraph.slice(0, -2)}Q`);
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [withX], [initial], [withX], [initial],
        [minus1], [minus2], [continued], [minus2], [continued]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const previewGate = timing === 'held' ? await holdFormalPreview(page) : null;
  let previewGateClosed = false;
  try {
  const row = visual.locator('p').filter({ has: page.locator('img[alt="dot"]') });
  await row.click();
  expect(failures, 'reference-image pointer selection must succeed before editing').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'reference-image End selection must succeed before editing').toEqual([]);
  const nativeBeforeInput = await row.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    const trailing = element.lastChild;
    return {
      anchorIsRow: selection?.anchorNode === element,
      anchorIsTrailingText: selection?.anchorNode === trailing && trailing instanceof Text,
      anchorOffset: selection?.anchorOffset ?? -1,
      trailingLength: trailing instanceof Text ? trailing.length : -1,
      collapsed: selection?.isCollapsed ?? false,
      focused: element.ownerDocument.activeElement?.contains(element) ?? false
    };
  });
  await page.keyboard.type('X');
  if (failures.length) console.log(JSON.stringify({ phase: 'reference-neighbor-native-point', size, ...nativeBeforeInput }));
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(paragraph, `${paragraph}X`));
  await page.keyboard.press('Control+z');
  expect(failures, 'reference-neighbor Undo must remain usable').toEqual([]);
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+z');
  expect(failures, 'reference-neighbor Redo must remain usable').toEqual([]);
  await expectSource(source, initial.replace(paragraph, `${paragraph}X`));
  if (previewGate) {
    await previewGate.waitFor(initial.replace(paragraph, `${paragraph}X`));
    await expect(visual).toHaveAttribute('data-easymde-preview-phase', 'loading');
  }
  await page.keyboard.press('Backspace');
  expect(failures, 'reference-neighbor Backspace immediately after Redo must succeed').toEqual([]);
  await expectSource(source, initial);
  await expectNativeTail(row, ' tail.');
  for (const removed of [1, 2]) {
    await page.keyboard.press('Backspace');
    expect(failures, `continued reference-neighbor Backspace ${removed}`).toEqual([]);
    await expectSource(source, initial.replace(paragraph, paragraph.slice(0, -removed)));
    await expectNativeTail(row, ' tail.'.slice(0, -removed));
  }
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await page.keyboard.press('Control+z');
  await expectSource(source, minus2);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  if (previewGate) { await previewGate.close(); previewGateClosed = true; }
  await previewRead.prove({ visual });
  } finally { if (previewGate && !previewGateClosed) await previewGate.close(); }
});
}
}

for (const size of ['full', 'windowed']) {
test(`${size} Unicode reference resolution deletes only the formally rendered image and preserves history`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const image = '![y][Stra\u00dfe]';
  const initial = `[a\u00a0b]: ${asset}#ghost\n\n[STRASSE]: ${asset}\n\n![x][a b] ${image}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const removed = initial.replace(image, '');
  const expected = initial.replace(image, `${image}X`);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [removed], [initial], [expected]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('img')).toHaveCount(1);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  const row = visual.locator('p').filter({ has: page.locator('img[alt="y"]') });
  await row.click();
  expect(failures, 'Unicode reference-image pointer selection must succeed before editing').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'Unicode reference-image End selection must succeed before editing').toEqual([]);
  await expectCaretAfterImage(visual, 'y');
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(image, ''));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  // Full restores its DOM with the source; Windowed mounts the image again from
  // the pending Preview, so its caret proof is the immediate key's exact offset.
  if (size === 'full') await expectCaretAfterImage(visual, 'y');
  await page.keyboard.type('X');
  try { await expectSource(source, expected); }
  catch (error) {
    const actual = await source.inputValue();
    let firstMismatch = 0;
    while (firstMismatch < Math.min(actual.length, expected.length) && actual[firstMismatch] === expected[firstMismatch]) firstMismatch += 1;
    console.log(JSON.stringify({ phase: 'unicode-image-post-undo-input-mismatch', size,
      actualLength: actual.length, expectedLength: expected.length, firstMismatch,
      actualTypedOffset: actual.indexOf('X'), expectedTypedOffset: initial.indexOf(image) + image.length }));
    throw error;
  }
  await expect(visual.locator('img[alt="y"]')).toHaveCount(1);
  await expect(visual.locator('p').filter({ has: page.locator('img[alt="y"]') })).toContainText('X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

for (const size of ['full', 'windowed']) {
test(`${size} repeated rendered images delete the native target reference rather than an identical neighbor`, async ({ page }) => {
  const asset = '/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png';
  const target = '![dot][second]';
  const initial = `[first]: ${asset}\n\n[second]: ${asset}\n\n![dot][first] ${target}\n\n`
    + Array.from({ length: size === 'windowed' ? 170 : 0 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const removed = initial.replace(target, '');
  const continued = initial.replace(target, `${target}X`);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [removed], [initial], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('img')).toHaveCount(2);
  if (size === 'windowed') await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  else await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  await visual.locator('img').nth(1).click();
  expect(failures, 'second-image pointer selection must succeed').toEqual([]);
  await page.keyboard.press('End');
  expect(failures, 'second-image End selection must succeed').toEqual([]);
  await expectCaretAfterImage(visual, 'dot', 1);
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, initial.replace(target, ''));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  if (size === 'full') await expectCaretAfterImage(visual, 'dot', 1);
  // Do not click after Undo. The exact insertion proves history restored the
  // second reference's caret, including when its Windowed DOM is still pending.
  await page.keyboard.type('X');
  await expectSource(source, continued);
  await expect(visual.locator('img')).toHaveCount(2);
  await expect(visual.locator('p').filter({ has: page.locator('img') })).toContainText('X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

test('windowed document deletes rapidly at its end and keeps editing', async ({ page }) => {
  test.setTimeout(300_000);
  const tail = 'Tail one.\n\nTail two.\n\nTail three.\n\n';
  const initial = windowedMarkdown(tail);
  const rapidBuilder = createRichFixtureBuilder();
  rapidBuilder.block('paragraph', 'Head.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  for (let index = 0; index < 170; index += 1) {
    rapidBuilder.block('paragraph', `Filler ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    rapidBuilder.separator();
  }
  rapidBuilder.block('paragraph', 'Tail one.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  rapidBuilder.block('paragraph', 'Tail two.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  rapidBuilder.block('paragraph', 'Tail three.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  rapidBuilder.separator();
  const rapidFixture = rapidBuilder.build();
  const rapidForward = richWindowedForwardGroups(rapidFixture);
  const rapidReverse = rapidForward.slice().reverse().map((group) => [...group]);
  const rapidAllDeleteStates = [...new Set(rapidForward.flat())];
  const rapidWithZStates = [...new Set(rapidAllDeleteStates.flatMap((candidate) => {
    const trimmed = candidate.trimEnd();
    const withoutTrailingNewlines = candidate.replace(/\n+$/u, '');
    return [
      candidate + 'Z',
      ...RICH_TRAILING_ENDINGS.map((ending) => `${trimmed}Z${ending}`),
      ...RICH_TRAILING_ENDINGS.map((ending) => `${withoutTrailingNewlines}Z${ending}`)
    ];
  }))];
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'rapid-delete', groups: rapidForward },
    { id: 'type-z-and-undo', groups: [rapidAllDeleteStates, rapidWithZStates, rapidAllDeleteStates] },
    { id: 'undo-restore', groups: [rapidWithZStates, ...rapidReverse] }
  ]);
  const { failures, source, visual } = await openWindowedVisual(
    page,
    tail,
    previewRead.beforeFixture
  );
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  // Real state, not a timeout: the document end is now the mounted window.
  await expect(visual.locator('p').filter({ hasText: 'Tail three.' })).toBeVisible();
  previewRead.enterPhase('rapid-delete');
  for (let step = 0; step < 100; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `rapid deletion ${step}`).toEqual([]);
  }
  // Wait for the whole rapid burst to be translated into canonical Markdown.
  const after = await readSettledSource(source, 12);
  expect(failures, 'rapid end deletion').toEqual([]);
  // Deletions happen at the end of the last visible line; canonical trailing
  // blank lines and block separators are not content and may stay behind.
  expect(initial.trimEnd().startsWith(after.trimEnd())).toBe(true);
  const deleted = initial.trimEnd().length - after.trimEnd().length;
  expect(deleted).toBeGreaterThanOrEqual(90);
  await expectLiveSelection(visual);
  previewRead.enterPhase('type-z-and-undo');
  await page.keyboard.type('Z');
  await expect.poll(async () => (await source.inputValue()).trimEnd())
    .toBe(`${after.trimEnd()}Z`);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => await source.inputValue()).toBe(after);
  await expectLiveSelection(visual);
  previewRead.enterPhase('undo-restore');
  let restored = false;
  for (let step = 0; step < 140; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `rapid restoration ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      break;
    }
  }
  expect(restored, 'rapid windowed deletion restores exact source').toBe(true);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

test('windowed document deletes stepwise at its end with undo restoring it', async ({ page }) => {
  test.setTimeout(300_000);
  const initial = windowedMarkdown('Tail one.\n\nTail two.\n\nTail three.\n\n');
  const { failures, source, visual } = await openWindowedVisual(
    page,
    'Tail one.\n\nTail two.\n\nTail three.\n\n'
  );
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('p').filter({ hasText: 'Tail three.' })).toBeVisible();
  let previous = initial;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `windowed delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    const current = await readSettledSource(source);
    // Every deletion happens at the end of the visible line. Canonical
    // trailing blank lines and paragraph separators can stay behind, and a
    // renderer-only empty paragraph retires without source bytes, so compare
    // the content without its trailing blank lines. The document head must
    // stay intact: a caret jump would delete from the article start instead.
    expect(current.startsWith('Head.\n\nFiller 1.'), `windowed delete ${step}`).toBe(true);
    expect(previous.trimEnd().startsWith(current.trimEnd()), `windowed delete ${step}`).toBe(true);
    previous = current;
  }
  expect(initial.trimEnd().length - previous.trimEnd().length).toBeGreaterThanOrEqual(20);
  let restored = false;
  for (let step = 0; step < 50; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `windowed undo ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await readSettledSource(source) === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  await visual.locator('p').filter({ hasText: 'Tail three.' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Q');
  await expect.poll(async () => (await source.inputValue()).trimEnd(), { timeout: 15_000 })
    .toBe(`${initial.trimEnd()}Q`);
  expect(failures).toEqual([]);
});

test('windowed document deletes a trailing code fence and stays editable', async ({ page }) => {
  test.setTimeout(300_000);
  const tail = 'Tail.\n\n~~~bash\necho hi\n~~~\n\nEnd.\n\n';
  const initial = windowedMarkdown(tail);
  const { failures, source, visual } = await openWindowedVisual(page, tail);
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  await expect(visual.locator('p').filter({ hasText: 'End.' })).toBeVisible();
  let previous = initial;
  for (let step = 0; step < 26; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `fence delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    const current = await readSettledSource(source);
    // The caret leaves the raw document end while deleting a fence: the code
    // body's text is removed before its closing line. Every settled result is
    // still the previous Markdown with one contiguous range deleted.
    expect(isSubsequence(current, previous), `fence delete ${step}`).toBe(true);
    expect(current.startsWith('Head.\n\nFiller 1.'), `fence delete ${step}`).toBe(true);
    previous = current;
  }
  expect(previous.includes('echo hi')).toBe(false);
  // Settle the last translation fully before typing at the live caret.
  previous = await readSettledSource(source, 12);
  await page.keyboard.type('X');
  // The caret sits after the last visible character, which may itself be a
  // trailing space the Markdown line keeps. Exactly one character was
  // inserted, no existing content was rewritten.
  await expect.poll(async () => {
    const current = await source.inputValue();
    const before = previous.trimEnd();
    const after = current.trimEnd();
    return after.length === before.length + 1
      && after.includes('X')
      && isSubsequence(before, after)
      && isSubsequence(after.replace('X', ''), before);
  }).toBe(true);
  await expectLiveSelection(visual);
  let fenceRestored = false;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `fence undo ${step}`).toEqual([]);
    if (await readSettledSource(source) === initial) {
      fenceRestored = true;
      break;
    }
  }
  expect(fenceRestored).toBe(true);
  expect(failures).toEqual([]);
});

test('windowed mixed document crosses block boundaries while deleting and stays editable', async ({ page }) => {
  test.setTimeout(300_000);
  const mixedBuilder = createRichFixtureBuilder();
  mixedBuilder.block('paragraph', 'Head.', 'P', { deletion: 'ascii-grapheme', plainText: true });
  mixedBuilder.separator();
  for (let index = 0; index < 170; index += 1) {
    mixedBuilder.block('paragraph', `Filler ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    mixedBuilder.separator();
  }
  mixedBuilder.block('heading', '## Tail heading', 'H2', { deletion: 'known-heading', headingPrefix: '## ' });
  mixedBuilder.separator();
  mixedBuilder.block('list', '- outer\n  - inner\n  - inner two', 'UL', { deletion: 'known-list' });
  mixedBuilder.separator();
  mixedBuilder.block('quote', '> quoted tail line', 'BLOCKQUOTE', { deletion: 'known-quote', quotePrefix: '> ' });
  mixedBuilder.separator();
  mixedBuilder.block('code', '```js\nconst tailValue = 1;\n```', 'PRE', { deletion: 'known-code-fence' });
  mixedBuilder.separator();
  mixedBuilder.block('table', '| left | right |\n| --- | --- |\n| a | b |', 'TABLE', { deletion: 'known-table-menu' });
  mixedBuilder.separator();
  mixedBuilder.block('mixed-paragraph',
    'MATHMIX $x^2$ [link](https://example.com) ![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png).',
    'P', { deletion: 'known-mixed-paragraph' });
  mixedBuilder.separator();
  mixedBuilder.block('atom', '~~~mermaid\ngraph TD\n  A --> B\n~~~', 'DIV', { deletion: 'known-whole-atom', atom: 'mermaid' });
  mixedBuilder.separator('\n');
  const mixedFixture = mixedBuilder.build();
  const tail = [
    '## Tail heading',
    '',
    '- outer',
    '  - inner',
    '  - inner two',
    '',
    '> quoted tail line',
    '',
    '```js',
    'const tailValue = 1;',
    '```',
    '',
    '| left | right |',
    '| --- | --- |',
    '| a | b |',
    '',
    'MATHMIX $x^2$ [link](https://example.com) ![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png).',
    '',
    '~~~mermaid',
    'graph TD',
    '  A --> B',
    '~~~',
    ''
  ].join('\n');
  const initial = windowedMarkdown(tail);
  expect(mixedFixture.initial === initial).toBe(true);
  const mixedGroupsByLength = new Map();
  const addMixedState = (candidate) => {
    const key = candidate.trimEnd().length;
    let bucket = mixedGroupsByLength.get(key);
    if (!bucket) {
      bucket = new Set();
      mixedGroupsByLength.set(key, bucket);
    }
    bucket.add(candidate);
  };
  for (const group of richWindowedForwardGroups(mixedFixture)) {
    for (const candidate of group) addMixedState(candidate);
  }
  for (let length = initial.length; length >= 0; length -= 1) {
    const raw = initial.slice(0, length);
    for (const ending of RICH_TRAILING_ENDINGS) addMixedState(raw + ending);
  }
  const mixedForward = [...mixedGroupsByLength.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, bucket]) => [...bucket]);
  const mixedReverse = mixedForward.slice().reverse().map((group) => [...group]);
  const mixedDeleteStates = [...new Set(mixedForward.flat())];
  const mixedWithZStates = [...new Set(mixedDeleteStates.flatMap((candidate) => {
    const trimmed = candidate.trimEnd();
    const variants = [
      candidate + 'Z',
      ...RICH_TRAILING_ENDINGS.map((ending) => `${trimmed}Z${ending}`)
    ];
    const tableMatch = trimmed.match(/(\|[^\n]*\|\n\| --- \| --- \|\n\|[^\n]*\|)$/u);
    if (tableMatch) {
      const tablePrefix = trimmed.slice(0, trimmed.length - tableMatch[1].length);
      const [headLine, dividerLine, bodyLine] = tableMatch[1].split('\n');
      const withCellZ = (line) => {
        const cells = line.slice(1, -1).split('|');
        const nextLines = [];
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
          const value = cells[cellIndex].trim();
          const replacements = value === '' ? [' Z ', ' Z', 'Z ', 'Z'] : [` ${value}Z `];
          for (const replacement of replacements) {
            const updated = [...cells];
            updated[cellIndex] = replacement;
            nextLines.push(`|${updated.join('|')}|`);
          }
        }
        return nextLines;
      };
      for (const nextHead of withCellZ(headLine)) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          variants.push(`${tablePrefix}${nextHead}\n${dividerLine}\n${bodyLine}${ending}`);
        }
      }
      for (const nextBody of withCellZ(bodyLine)) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          variants.push(`${tablePrefix}${headLine}\n${dividerLine}\n${nextBody}${ending}`);
        }
      }
    }
    if (trimmed.endsWith('\n```')) {
      const bodyPrefix = trimmed.slice(0, -4);
      for (const ending of RICH_TRAILING_ENDINGS) {
        variants.push(`${bodyPrefix}Z\n\`\`\`${ending}`);
      }
    }
    return variants;
  }))];
  const headingQ = initial.replace('## Tail heading', '## Tail headingQ');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'mixed-delete', groups: mixedForward },
    { id: 'type-z', groups: [mixedDeleteStates, mixedWithZStates] },
    { id: 'undo-restore', groups: [mixedWithZStates, ...mixedReverse] },
    { id: 'heading-q', groups: [[initial], [headingQ]] }
  ]);
  const { failures, source, visual } = await openWindowedVisual(page, tail, previewRead.beforeFixture);
  await visual.locator('p').first().click();
  await page.keyboard.press('Control+End');
  // Real state, not a timeout: the document end is now the mounted window and
  // the owner has presented the caret after the trailing atomic block.
  await expect(visual.locator('.easymde-mermaid')).toBeVisible();
  await expect.poll(() => visual.evaluate((surface) => {
    const selection = surface.ownerDocument.getSelection();
    return surface.lastElementChild?.nodeName === 'P'
      && selection?.anchorNode === surface.lastElementChild;
  })).toBe(true);
  expect(failures, 'mixed document opened').toEqual([]);
  previewRead.enterPhase('mixed-delete');
  for (let step = 0; step < 150; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `mixed delete ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  const after = await readSettledSource(source, 12);
  expect(failures, 'mixed deletion settled').toEqual([]);
  expect(initial.trimEnd().startsWith(after.trimEnd())).toBe(true);
  expect(after.startsWith('Head.\n\nFiller 1.')).toBe(true);
  // The deletion crossed the mermaid fence and the paragraph after the table.
  expect(after.includes('A --> B')).toBe(false);
  expect(after.includes('MATHMIX')).toBe(false);
  await expectLiveSelection(visual);
  previewRead.enterPhase('type-z');
  await page.keyboard.type('Z');
  await expect.poll(async () => {
    const current = (await source.inputValue()).trimEnd();
    const before = after.trimEnd();
    return current.length === before.length + 1
      && current.includes('Z')
      && isSubsequence(before, current)
      && isSubsequence(current.replace('Z', ''), before);
  }, { timeout: 15_000 }).toBe(true);
  expect(failures, 'mixed typing').toEqual([]);
  previewRead.enterPhase('undo-restore');
  let restored = false;
  for (let step = 0; step < 200; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `mixed undo ${step}`).toEqual([]);
    if (await readSettledSource(source) === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  previewRead.enterPhase('heading-q');
  await visual.locator('h2').filter({ hasText: 'Tail heading' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('Q');
  await expect.poll(async () => (await source.inputValue()).includes('## Tail headingQ'),
    { timeout: 15_000 }).toBe(true);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

for (const shortcut of [
  { marker: '~~~', language: 'python', position: 'start' },
  { marker: '```', language: 'javascript', position: 'end' },
  { marker: '~~~~', language: 'bash', position: 'middle' },
  { marker: '````', language: '', position: 'start' },
  { marker: '~~~', language: '', position: 'end' },
  { marker: '```', language: 'python', position: 'middle' }
]) {
  test(`fence creation and history at ${shortcut.position}: ${shortcut.marker}${shortcut.language}`, async ({ page }) => {
    const initial = 'Before.\n\nMiddle.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    if (shortcut.position === 'start') {
      await visual.locator('p').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Home');
    } else {
      await visual.locator('p').nth(shortcut.position === 'middle' ? 1 : 2).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type(shortcut.marker + shortcut.language);
    await page.keyboard.press('Enter');
    await page.keyboard.type('x = 1');
    expect(failures).toEqual([]);
    await expect(visual.locator('pre code')).toHaveText('x = 1\n');
    await expect.poll(async () => (await source.inputValue()).includes('x = 1')).toBe(true);
    const created = await source.inputValue();
    expect(new RegExp('(?:^|\\n)(?:`{3,}|~{3,})' + shortcut.language + '\\n').test(created)).toBe(true);
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 40) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) {
      await page.keyboard.press('Control+Shift+z');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, created);
    await page.keyboard.type('Z');
    await expectSource(source, created.replace('x = 1', 'x = 1Z'));
    expect(failures).toEqual([]);
  });
}

for (const fence of ['~~~', '```']) {
  test(`${fence} unfinished language shortcut erases without losing selection`, async ({ page }) => {
    const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const shortcut = `${fence}python`;
    await page.keyboard.type(shortcut);
    for (let index = 0; index < shortcut.length; index += 1) {
      await page.keyboard.press('Backspace');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await page.keyboard.type('Replacement');
    await expect.poll(async () => (await source.inputValue()).includes('Replacement')).toBe(true);
    await expect(visual.locator('pre')).toHaveCount(0);
    expect(failures).toEqual([]);
  });

  test(`${fence} language shortcut creates code and accepts immediate typing`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, 'Before.\n\nTarget paragraph here.\n\nAfter.');
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${fence}bash`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo 123');
    await expect(visual.locator('pre code')).toContainText('echo 123');
    await expectLiveSelection(visual);
    await expect.poll(async () => /(?:`{3,}|~{3,})bash\n(?:[^\n]*\n)*?echo 123/u.test(await source.inputValue())).toBe(true);
    expect(failures).toEqual([]);
    await page.keyboard.press('Control+z');
    await page.keyboard.type('new');
    await expect.poll(async () => (await source.inputValue()).includes('new')).toBe(true);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('native EOF Delete remains a no-op and preserves subsequent input and history', async ({ page }) => {
  const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.evaluate((surface) => {
    window.__nativeNoopEvents = [];
    for (const type of ['beforeinput', 'input']) surface.addEventListener(type, (event) => {
      if (event.inputType !== 'deleteContentForward') return;
      const ranges = event.getTargetRanges?.() ?? [];
      const target = ranges[0];
      window.__nativeNoopEvents.push({ type: event.type, prevented: event.defaultPrevented,
        trusted: event.isTrusted, targetCount: ranges.length,
        targetCollapsed: !!target && target.startContainer === target.endContainer && target.startOffset === target.endOffset });
    });
  });
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Delete');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const events = await page.evaluate(() => window.__nativeNoopEvents);
  expect(events, 'The proved zero-length deletion must complete without leaving a native input transaction open').toEqual([
    { type: 'beforeinput', prevented: true, trusted: true, targetCount: 1, targetCollapsed: true }
  ]);
  await expectSource(source, initial);
  await expectNativeTail(visual.locator('p').last(), 'After.');
  await page.keyboard.type('X');
  await expectSource(source, initial + 'X');
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, initial + 'X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('held same-source formal Preview preserves active Chromium composition and history', async ({ page, context }) => {
  test.setTimeout(60_000);
  const definition = '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n';
  const paragraph = 'Opening ![dot][pic] tail.';
  const initial = definition + paragraph + '\n\n';
  const withX = initial.replace(paragraph, paragraph + 'X');
  const committed = initial.replace(paragraph, paragraph + '你');
  const withQ = initial.replace(paragraph, paragraph + 'Q');
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [[''], [initial], [withX], [initial], [withX], [initial], [committed], [initial], [withQ]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const gate = await holdFormalPreview(page);
  const input = await context.newCDPSession(page);
  let gateClosed = false;
  try {
    const row = visual.locator('p').filter({ has: page.locator('img[alt="dot"]') });
    await row.click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
    await gate.waitFor(initial);
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    expect(failures, 'Active browser composition must remain accepted').toEqual([]);
    await expectSource(source, initial);
    const draft = await visual.evaluateHandle((surface) => {
      const native = surface.ownerDocument.getSelection();
      if (!(native?.anchorNode instanceof Text) || !surface.contains(native.anchorNode)) throw new Error('composition-native-draft-missing');
      return native.anchorNode;
    });
    try {
      const delivered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')
          && response.request().postDataJSON()?.markdown === initial && response.status() === 200;
      });
      await gate.close();
      gateClosed = true;
      await delivered;
      await expect.poll(() => visual.getAttribute('data-easymde-preview-phase')).not.toBe('loading');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const retained = await visual.evaluate((surface, node) => {
        const native = surface.ownerDocument.getSelection();
        return { connected: node.isConnected && surface.contains(node),
          draftRetained: node instanceof Text && node.data.endsWith('你'),
          nativeRetained: native?.anchorNode === node && native.focusNode === node,
          focused: surface.ownerDocument.activeElement === surface, editable: surface.isContentEditable };
      }, draft);
      expect(retained, 'The actual same-source PHP response must not replace an active native composition').toEqual({
        connected: true, draftRetained: true, nativeRetained: true, focused: true, editable: true
      });
      expect(failures).toEqual([]);
      await input.send('Input.insertText', { text: '你' });
      await expectSource(source, committed);
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      await page.keyboard.type('Q');
      await expectSource(source, withQ);
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
      await previewRead.prove({ visual });
    } finally { await draft.dispose(); }
  } finally {
    if (!gateClosed) await gate.close();
    await input.detach();
  }
});

const shortFenceRepresentatives = [
  { marker: '```', language: 'bash', position: 'start', pacing: 'normal' },
  { marker: '````', language: '', position: 'start', pacing: 'burst' },
  { marker: '````', language: 'python', position: 'middle', pacing: 'normal' },
  { marker: '```', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '```', language: '', position: 'end', pacing: 'normal' },
  { marker: '````', language: 'bash', position: 'end', pacing: 'burst' },
  { marker: '~~~', language: 'python', position: 'start', pacing: 'normal' },
  { marker: '~~~~', language: '', position: 'start', pacing: 'burst' },
  { marker: '~~~~', language: 'bash', position: 'middle', pacing: 'normal' },
  { marker: '~~~', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '~~~', language: '', position: 'end', pacing: 'normal' },
  { marker: '~~~~', language: 'python', position: 'end', pacing: 'burst' }
];

function shortFenceFixture(position) {
  if (position === 'start') return 'Slot\n\n# Heading\n\nAfter.\n\n- keep item';
  if (position === 'middle') return '# Heading\n\nSlot\n\nAfter.\n\n- keep item';
  return '# Heading\n\nBefore.\n\n- keep item\n\nSlot\n\n';
}

for (const fence of shortFenceRepresentatives) {
  test(`[short-stage] full ${fence.pacing} ${fence.position} fence ${fence.marker}${fence.language || '(no-language)'} lifecycle`, async ({ page }) => {
    const initial = shortFenceFixture(fence.position), opener = fence.marker + fence.language;
    const emptySlot = initial.replace('Slot', '');
    const literal = (text) => initial.replace('Slot', text.replace(/[`~]/gu, '\\$&'));
    // Full's shortcut contract preserves the typed fence marker family (backticks or tildes).
    const marker = fence.marker;
    const code = (body) => initial.replace('Slot', `${marker}${fence.language}\n${body}\n${marker}`);
    // At absolute start, the new fence's row domain and its following two-LF
    // separator occupy this fixed fixture slot. Preserve the following source
    // byte-for-byte; other positions retain their unverified existing oracle.
    const startSlot = 'Slot\n\n';
    if (fence.position === 'start') expect(initial.startsWith(startSlot)).toBe(true);
    const exited = fence.position === 'start'
      ? initial.slice(startSlot.length)
      : fence.position === 'end'
        ? initial.slice(0, initial.indexOf('Slot'))
        : initial.replace('Slot', '  ');
    const continued = initial.replace('Slot', 'Z');
    const branched = initial.replace('Slot', 'ZB');
    const openerForward = Array.from({ length: opener.length }, (_, index) => [literal(opener.slice(0, index + 1))]);
    const openerReverse = openerForward.slice().reverse().map((group) => [...group]);
    const fenceForwardGroups = [
      [initial],
      [emptySlot],
      ...openerForward,
      ...openerReverse,
      [emptySlot],
      ...openerForward,
      [code('')], [code('a')], [code('ab')], [code('a')], [code('a\n')], [code('a\nx')],
      [code('a\nxy')], [code('a\nQ')], [code('')], [exited], [continued]
    ];
    const fenceReverseGroups = fenceForwardGroups.slice().reverse().map((group) => [...group]);
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'fixture', groups: [[''], [initial]] },
      { id: 'forward', groups: fenceForwardGroups },
      { id: 'undo-initial', groups: fenceReverseGroups },
      { id: 'redo-continued', groups: fenceForwardGroups },
      { id: 'branch-b', groups: [[continued], [branched], [continued]] },
      { id: 'final-undo', groups: fenceReverseGroups }
    ]);
    const stage = await openShortStage(page, 'full', initial, previewRead.beforeFixture);
    const allowed = new Set([initial, emptySlot, exited, continued]);
    for (let end = 1; end <= opener.length; end += 1) allowed.add(literal(opener.slice(0, end)));
    const codeBodies = ['', 'a', 'ab', 'a\n', 'a\nx', 'a\nxy', 'a\nQ'];
    for (const body of codeBodies) allowed.add(code(body));
    const slotStart = initial.indexOf('Slot');
    const codeBlockOrdinal = fence.position === 'start' ? 0 : fence.position === 'middle' ? 1 : 3;
    const openingFence = `${marker}${fence.language}\n`;
    const codeDescriptorsBySource = shortStageUniqueCodeDeclarations(codeBodies.map((body) => {
      const bodyStart = slotStart + openingFence.length;
      const bodyEnd = bodyStart + body.length;
      return {
        source: code(body),
        descriptor: Object.freeze({
          blockOrdinal: codeBlockOrdinal,
          codeOrdinal: 0,
          body,
          bodyStart,
          bodyEnd,
          closingFenceLfStart: bodyEnd,
          closingFenceLfEnd: bodyEnd + 1,
          sourceBlockStart: slotStart,
          sourceBlockEnd: bodyEnd + 1 + marker.length
        })
      };
    }));
    const probe = await startShortStageProbe(page, stage, allowed, { codeDescriptorsBySource });
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'real-slot-selection', failed = true;
    let exitOwnership = null;
    const readZState = async (text) => stage.visual.evaluate((surface, expected) => {
      const paragraphs = [...surface.querySelectorAll(':scope > p')].filter((p) => p.textContent === expected);
      const paragraph = paragraphs.length === 1 ? paragraphs[0] : null;
      const native = surface.ownerDocument.getSelection();
      let caretOffset = null;
      if (paragraph && native?.anchorNode && paragraph.contains(native.anchorNode)) {
        const prefix = surface.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        caretOffset = prefix.toString().length;
      }
      return { paragraphCount: paragraphs.length, paragraphConnected: !!paragraph?.isConnected,
        paragraphDirect: !!paragraph && paragraph.parentNode === surface,
        paragraphEditable: !!paragraph && paragraph.isContentEditable,
        bodyLength: paragraph?.textContent.length ?? null, caretOffset,
        collapsed: native?.isCollapsed === true,
        connected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
          && !!surface.contains(native.anchorNode) && !!surface.contains(native.focusNode),
        focused: surface.ownerDocument.activeElement === surface,
        surfaceConnected: surface.isConnected, editable: surface.isContentEditable,
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') };
    }, text);
    const assertContinuedCaret = async (point, expectedText) => {
      const state = await readZState(expectedText);
      expect(state, `${point}: native caret must follow the fixed fixture text`).toMatchObject({
        paragraphCount: 1, paragraphConnected: true, paragraphDirect: true, paragraphEditable: true,
        bodyLength: expectedText.length, caretOffset: expectedText.length, collapsed: true, connected: true,
        focused: true, surfaceConnected: true, editable: true, lock: 'false' });
      return state;
    };
    try {
      frames.stage(phase);
      await stage.visual.locator('p').filter({ hasText: /^Slot$/u }).click({ position: { x: 3, y: 3 } });
      await probe.press('Home'); await probe.press('Shift+End');
      previewRead.enterPhase('forward');
      phase = 'unfinished-opener-and-characterwise-clear'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      for (let key = 0; key < opener.length; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, emptySlot);
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      phase = 'Enter-immediate-body-delete-newline-replace'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      await probe.press('Enter'); await probe.type('ab');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('ab'));
      await probe.press('Backspace');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a'));
      await probe.press('Enter'); await probe.type('xy');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a\nxy'));
      await probe.press('Shift+ArrowLeft'); await probe.press('Shift+ArrowLeft');
      await probe.type('Q'); await expectSource(stage.source, code('a\nQ'));
      await expect.poll(() => stage.visual.locator('pre').evaluate((pre, language) => ({
        marker: pre.getAttribute('data-easymde-visual-fence'),
        language: pre.getAttribute('data-easymde-visual-fence-info'),
        body: pre.querySelector('code')?.textContent?.replace(/\n$/u, ''),
        languageClass: pre.querySelector('code')?.classList.contains(`language-${language}`)
      }), fence.language)).toMatchObject({ marker, language: fence.language, body: 'a\nQ', ...(fence.language ? { languageClass: true } : {}) });
      phase = 'clear-code-and-native-structure-exit'; frames.stage(phase);
      for (let key = 0; key < 3; key += 1) await probe.press('Shift+ArrowLeft');
      expect(await stage.visual.locator('pre code').evaluate((element) => {
        const native = getSelection();
        return !!native && element.contains(native.anchorNode) && element.contains(native.focusNode)
          && native.toString() === 'a\nQ';
      })).toBe(true);
      await probe.press('Backspace'); await expectSource(stage.source, code(''));
      if (fence.position === 'start' || fence.position === 'end') {
        exitOwnership = await stage.visual.evaluateHandle((surface) => {
          const pres = surface.querySelectorAll('pre');
          if (pres.length !== 1) throw new Error('short-stage-exit-pre-not-unique');
          const pre = pres[0]; let frame = pre;
          while (frame.parentNode && frame.parentNode !== surface) frame = frame.parentNode;
          if (frame.parentNode !== surface) throw new Error('short-stage-exit-frame-not-direct');
          const children = Array.from(surface.childNodes);
          const frameIndex = children.indexOf(frame);
          return { surface, pre, frame,
            prefix: children.slice(0, frameIndex),
            following: children.slice(frameIndex + 1),
            paragraphs: new Set(surface.querySelectorAll(':scope > p')), paragraph: null };
        });
      }
      await probe.press('Backspace'); await expectSource(stage.source, exited);
      if (exitOwnership) {
        const exitedState = await exitOwnership.evaluate((owned) => {
          const { surface } = owned, children = Array.from(surface.childNodes);
          const added = [...surface.querySelectorAll(':scope > p')].filter((p) => !owned.paragraphs.has(p));
          owned.paragraph = added.length === 1 ? added[0] : null;
          const p = owned.paragraph, native = surface.ownerDocument.getSelection();
          const prefixIndexes = owned.prefix.map((node) => children.indexOf(node));
          const indexes = owned.following.map((node) => children.indexOf(node));
          return { preRemoved: !surface.contains(owned.pre), frameRemoved: !surface.contains(owned.frame),
            preCount: surface.querySelectorAll('pre').length, newParagraphCount: added.length,
            soleBR: !!p && p.childNodes.length === 1 && p.firstChild instanceof HTMLBRElement,
            nativeP0: !!p && native?.isCollapsed === true && native.anchorNode === p && native.focusNode === p
              && native.anchorOffset === 0 && native.focusOffset === 0,
            editable: surface.isConnected && surface.isContentEditable,
            lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
            prefixIntact: owned.prefix.every((node, at) => node.isConnected && node.parentNode === surface
              && prefixIndexes[at] === at),
            followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === surface)
              && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
            followingTailIntact: owned.following.length > 0
              ? children.at(-1) === owned.following.at(-1)
              : children.at(-1) === p };
        });
        expect(exitedState).toEqual({ preRemoved: true, frameRemoved: true, preCount: 0, newParagraphCount: 1,
          soleBR: true, nativeP0: true, editable: true, lock: 'false', prefixIntact: true,
          followingIntact: true, followingTailIntact: true });
      }
      await probe.type('Z'); await expectSource(stage.source, continued);
      await assertContinuedCaret('after-Z', 'Z');
      if (exitOwnership) {
        const continuedState = await exitOwnership.evaluate((owned) => {
          const children = Array.from(owned.surface.childNodes);
          const indexes = owned.following.map((node) => children.indexOf(node));
          const p = owned.paragraph, native = owned.surface.ownerDocument.getSelection();
          return { sameParagraph: !!p && p.isConnected && p.parentNode === owned.surface,
            independentZParagraph: !!p && p.childNodes.length === 1 && p.firstChild instanceof Text
              && p.firstChild.data === 'Z',
            nativeTextEnd: !!p && native?.isCollapsed === true && native.anchorNode === p.firstChild
              && native.focusNode === p.firstChild && native.anchorOffset === 1 && native.focusOffset === 1,
            followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === owned.surface)
              && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
            followingTailIntact: owned.following.length > 0 && children.at(-1) === owned.following.at(-1) };
        });
        expect(continuedState).toEqual({ sameParagraph: true, independentZParagraph: true, nativeTextEnd: true,
          followingIntact: true, followingTailIntact: true });
      }
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'natural-group-Undo-Redo-and-continued-editing'; frames.stage(phase);
      previewRead.enterPhase('undo-initial');
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      previewRead.enterPhase('redo-continued');
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, continued);
      const forwardBranchCursor = shortStageHistoryCursorSnapshot(history);
      await assertContinuedCaret('after-final-Redo-before-B', 'Z');
      previewRead.enterPhase('branch-b');
      await probe.type('B'); await expectSource(stage.source, branched);
      await expect.poll(async () => {
        const branch = await readZState('ZB');
        return branch.paragraphCount === 1 && branch.paragraphConnected === true
          && branch.paragraphDirect === true && branch.paragraphEditable === true
          && branch.bodyLength === 2 && branch.caretOffset === 2 && branch.collapsed === true
          && branch.connected === true && branch.focused === true && branch.editable === true && branch.lock === 'false';
      }, { message: 'B must commit and settle at the exact native ZB caret', timeout: 15000 }).toBe(true);
      const accepted = await readZState('ZB');
      expect(accepted, 'after-B-accepted: the current DOM must be exactly one editable ZB paragraph').toMatchObject({
        paragraphCount: 1, paragraphConnected: true, paragraphDirect: true, paragraphEditable: true,
        bodyLength: 2, caretOffset: 2, collapsed: true, connected: true, focused: true,
        surfaceConnected: true, editable: true, lock: 'false'
      });
      await probe.press('Control+z'); await expectSource(stage.source, continued);
      shortStageRestoreHistoryCursor(history, forwardBranchCursor);
      previewRead.enterPhase('final-undo');
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      await previewRead.prove({ visual: stage.visual });
      console.log(JSON.stringify({ phase: 'short-stage-fence-complete', position: fence.position,
        pacing: fence.pacing, family: fence.marker[0] === '~' ? 'tilde' : 'backtick', markerLength: fence.marker.length,
        language: fence.language, observedSourceTransitions: Math.max(0, history.states.length - 1), sourceExact: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-fence-first-failure', operation: phase,
        position: fence.position, pacing: fence.pacing, markerLength: fence.marker.length,
        state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
          editable: state.effectiveEditable, nativeConnected: state.nativeConnected, lock: state.lock })),
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      try { await exitOwnership?.dispose(); } finally {
        await finishShortStageObservation(probe, frames,
          `short-fence-${fence.marker[0] === '~' ? 'tilde' : 'backtick'}-${fence.position}-${fence.pacing}`, failed);
      }
    }
  });
}

for (const sourceCase of [
  { mode: 'ordinary', marker: '````', language: 'bash' },
  { mode: 'ordinary', marker: '~~~', language: 'python' },
  { mode: 'split', marker: '```', language: 'javascript' },
  { mode: 'split', marker: '~~~~', language: '' }
]) {
  test(`[short-stage] ${sourceCase.mode} literal fence ${sourceCase.marker}${sourceCase.language || '(no-language)'} preserves syntax and natural history`, async ({ page }) => {
    const { mode, marker, language } = sourceCase;
    const initial = `  ${marker}${language}  \n  value = 1  \n  ${marker}\n\nAfter.\n\n- keep item\n`;
    const stage = await openShortStage(page, mode, initial);
    const point = initial.indexOf('value = 1');
    const typed = initial.slice(0, point) + 'X' + initial.slice(point);
    const closing = initial.indexOf(`  ${marker}`, initial.indexOf('\n') + 1) + 2;
    const shorterMarker = initial.slice(0, closing) + initial.slice(closing + 1);
    const newline = initial + '\n', unicode = newline + '中🙂';
    const allowed = new Set([initial, typed, shorterMarker, newline, newline + '中', unicode]);
    const probe = await startShortStageProbe(page, stage, allowed);
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'literal-fence-body-position', failed = true;
    try {
      frames.stage(phase);
      await stage.surface.click(); await probe.press('Control+Home');
      await probe.press('ArrowDown'); await probe.press('Home');
      const beforeX = await readPublicEditorState(page);
      expect({ nativeConnected: beforeX.nativeConnected, nativeCollapsed: beforeX.nativeCollapsed,
        effectiveEditable: beforeX.effectiveEditable }).toMatchObject({
        nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
      expect(beforeX.nativeAnchor, 'X: real keyboard caret must be the fixed source-body point').toMatchObject({
        connected: true, lineText: '  value = 1  ', linePrefix: '  '
      });
      await probe.type('X'); await expectSource(stage.source, typed);
      await probe.press('Backspace'); await expectSource(stage.source, initial);
      phase = 'literal-closing-marker-delete-and-retype'; frames.stage(phase);
      await probe.press('Control+Home'); await probe.press('ArrowDown'); await probe.press('ArrowDown');
      await probe.press('Home');
      const beforeClosingDelete = await readPublicEditorState(page);
      expect({ nativeConnected: beforeClosingDelete.nativeConnected, nativeCollapsed: beforeClosingDelete.nativeCollapsed,
        effectiveEditable: beforeClosingDelete.effectiveEditable }).toMatchObject({
        nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
      expect(beforeClosingDelete.nativeAnchor,
        'closing marker: real keyboard caret must be the fixed source-marker start').toMatchObject({
        connected: true, lineText: `  ${marker}`, linePrefix: '  '
      });
      await probe.press('Delete'); await expectSource(stage.source, shorterMarker);
      await probe.type(marker[0]); await expectSource(stage.source, initial);
      phase = 'source-newline-Unicode-and-delete'; frames.stage(phase);
      await probe.press('Control+End'); await probe.press('Enter');
      await probe.type('中🙂'); await expectSource(stage.source, unicode);
      await probe.press('Backspace'); await expectSource(stage.source, newline + '中');
      await probe.press('Backspace'); await expectSource(stage.source, newline);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'source-natural-group-Undo-Redo'; frames.stage(phase);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, newline);
      await probe.type('Q'); await expectSource(stage.source, newline + 'Q');
      await probe.press('Control+z'); await expectSource(stage.source, newline);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-complete', mode,
        family: marker[0] === '~' ? 'tilde' : 'backtick', markerLength: marker.length, language,
        literalSyntaxExact: true, sourceOwnerOnly: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-first-failure', mode, operation: phase,
        state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
          editable: state.effectiveEditable, nativeConnected: state.nativeConnected })),
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      await finishShortStageObservation(probe, frames, `short-source-${mode}-${marker[0] === '~' ? 'tilde' : 'backtick'}`, failed);
    }
  });
}

test('[short-stage] full reverse P-H2-P mouse range keeps unselected ends and natural history', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaMQzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [replaced], [continued], [replaced], [initial], [replaced], [continued]] }
  ]);
  const stage = await openShortStage(page, 'full', initial, previewRead.beforeFixture);
  const allowed = new Set([initial, replaced, continued]);
  const probe = await startShortStageProbe(page, stage, allowed);
  const frames = await startShortStageFrames(page, stage.surface);
  let phase = 'real-reverse-cross-block-drag', failed = true;
  try {
    frames.stage(phase);
    const point = (row, offset) => row.evaluate((paragraph, at) => {
      const text = paragraph.firstChild;
      if (!(text instanceof Text) || at >= text.length) throw new Error('short-stage-cross-block-point-unavailable');
      const range = paragraph.ownerDocument.createRange();
      range.setStart(text, at); range.setEnd(text, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 1, y: rect.y + rect.height / 2 };
    }, offset);
    const from = await point(stage.visual.locator('p').nth(2), 1);
    const to = await point(stage.visual.locator('p').nth(1), 5);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    probe.guard();
    const native = await stage.visual.evaluate((surface) => {
      const selection = getSelection(), paragraphs = surface.querySelectorAll('p');
      const offset = (paragraph, node, end) => {
        if (!node || !paragraph.contains(node)) return null;
        const prefix = paragraph.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph); prefix.setEnd(node, end);
        return prefix.toString().length;
      };
      const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      return { backward: !!range && !selection.isCollapsed && range.endContainer === selection.anchorNode
        && range.endOffset === selection.anchorOffset,
        anchorOffset: offset(paragraphs[2], selection?.anchorNode, selection?.anchorOffset),
        focusOffset: offset(paragraphs[1], selection?.focusNode, selection?.focusOffset) };
    });
    expect(native).toEqual({ backward: true, anchorOffset: 1, focusOffset: 5 });
    phase = 'cross-block-replace-and-immediate-continue'; frames.stage(phase);
    await probe.type('M'); await expectSource(stage.source, replaced);
    await probe.type('Q'); await expectSource(stage.source, continued);
    const observation = await probe.snapshot();
    const history = shortStageHistoryLedger(observation.rows, initial, allowed);
    await probe.freeze();
    phase = 'cross-block-natural-Undo-Redo'; frames.stage(phase);
    await shortStageReplayHistory(page, stage, probe, history, 'undo');
    await expectSource(stage.source, initial);
    await shortStageReplayHistory(page, stage, probe, history, 'redo');
    await expectSource(stage.source, continued);
    await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    probe.guard();
    await previewRead.prove({ visual: stage.visual });
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-complete', native,
      sourceExact: true, state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
        editable: state.effectiveEditable, nativeConnected: state.nativeConnected })) }));
    failed = false;
  } catch (error) {
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-first-failure', operation: phase,
      state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
        editable: state.effectiveEditable, nativeConnected: state.nativeConnected })),
      firstObservation: (await probe.snapshot()).failure }));
    throw error;
  } finally {
    await finishShortStageObservation(probe, frames, 'short-backward-cross-block', failed);
  }
});

test('[short-stage-background] dirty article survives focus loss and natural autosave', async ({ page }) => {
  test.setTimeout(780_000);
  const initial = '# 背景\n\nAlpha 开始。\n\nBeta 结束。';
  const afterJia = initial + '甲';
  const afterForeground = initial + '甲A';
  const afterReturn = afterForeground + '乙B';
  const afterDelete = afterForeground + '乙';
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [afterJia], [afterForeground],
        [afterDelete], [afterReturn], [afterDelete], [afterReturn], [afterDelete]
      ]
    }
  ]);
  const caseDeadline = Date.now() + 720_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('background-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  const coverage = {
    foregroundCycle: false, backgroundCycle: false, returnCycle: false,
    returnFocus: false, focusLost: false, autosaveSuccess: false,
    postChanged: null, sessionReady: false, intervals: null,
    localDraft: { applicable: null, intervalSeconds: null, saved: null,
      updatedAtAdvanced: false, contentMatchesCurrent: false }
  };
  const healthFailures = [];
  const onPopup = () => healthFailures.push('background-popup');
  page.on('popup', onPopup);
  let second = null;
  let stage = null;
  let stageProbe = null;
  let frames = null;
  let finalProbe = null;
  let primaryError = null;
  const disableFocusOverride = async (targetPage) => {
    const cdp = await targetPage.context().newCDPSession(targetPage);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    return cdp;
  };
  const focusOverrideSessions = [];
  const detachFocusOverrides = async () => {
    const failures = [];
    for (const cdp of focusOverrideSessions.splice(0)) {
      try { await cdp.detach(); }
      catch { failures.push('focus-override-detach'); }
    }
    if (failures.length) throw new Error(failures.join(','));
  };
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const throwUncovered = (codes) => {
    throw new Error(`background-stage-uncovered:${[...new Set(codes)].join(',')}`);
  };
  const reportSafeCoverage = () => {
    const safe = { ...coverage };
    if (finalProbe) {
      safe.sendCount = finalProbe.send.length;
      safe.tickCount = finalProbe.tick.length;
      safe.autosaveCount = finalProbe.autosave.length;
    }
    console.log(JSON.stringify({
      phase: 'short-stage-background-coverage-finally',
      coverage: safe
    }));
  };
  try {
    await page.bringToFront();
    focusOverrideSessions.push(await disableFocusOverride(page));
    stage = await openShortStage(page, 'full', initial, async (context) => {
      previewRead.beforeFixture(context);
      await installBackgroundProbe(page);
    });
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage,
      [initial, initial + '甲', afterForeground, afterReturn, afterDelete], { backgroundObservation: true, frames });
    let localDraftUpdatedAtBaseline = null;
    const waitUntil = async (predicate, { message, timeout }) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await predicate()) return true;
        await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
      }
      console.log(JSON.stringify({ phase: 'short-stage-background-wait-timeout', message }));
      return false;
    };
    const guard = async ({ focused = true } = {}) => {
      stageProbe.guard();
      if (healthFailures.length) throw new Error(`background-health:${healthFailures[0]}`);
      if (stage.failures.length) throw new Error(`background-stage-failure:${stage.failures[0]}`);
      const state = await readProbe();
      if (state.sessionStatus !== 'ready') {
        throw new Error(`background-session:${state.sessionStatus}`);
      }
      if (state.heartbeat.connectionError === true) {
        throw new Error('background-heartbeat-connection-error');
      }
      if (focused
        && (state.documentHasFocus !== true || state.heartbeat.coreHasFocus !== true)) {
        throw new Error('background-unexpected-focus-loss');
      }
      if (!focused
        && (state.documentHasFocus !== false || state.heartbeat.coreHasFocus !== false)) {
        throw new Error('background-expected-focus-loss-not-observed');
      }
      if (state.surfaceEditable !== true || state.lockPressed !== 'false') {
        throw new Error('background-unexpected-readonly-or-lock');
      }
      return state;
    };
    const installed = await guard();
    coverage.intervals = installed.intervals;
    coverage.localDraft = {
      applicable: installed.localDraft.applicable,
      intervalSeconds: installed.localDraft.intervalSeconds,
      saved: installed.localDraft.applicable ? false : null,
      updatedAtAdvanced: false,
      contentMatchesCurrent: false
    };
    localDraftUpdatedAtBaseline = installed.localDraft.storage?.updatedAt ?? null;
    const waitForCycle = async (phase, focused) => {
      const start = await guard({ focused });
      const interval = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0,
        focused ? 0 : 120);
      if (!(interval > 0)) return false;
      const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
      const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
      const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
      await stageProbe.beginQuiet(`${phase}-heartbeat`);
      const observed = await waitUntil(async () => {
        await guard({ focused });
        const current = await readProbe();
        return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
          && entry.durationMs !== null
          && entry.sendOrdinal !== null
          && entry.sendOrdinal > baselineSendOrdinal
          && entry.sendDocumentHasFocus === focused
          && entry.sendCoreHasFocus === focused);
      }, { message: `${phase} natural heartbeat send→tick`, timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForAutosave = async () => {
      const start = await guard();
      const autosaveSeconds = Number(start.intervals.autosave);
      const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0);
      if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) return false;
      const timeout = boundedTimeout(
        (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
      await stageProbe.beginQuiet('natural-autosave');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        return current.autosave.some((entry) => {
          if (entry.success !== true || entry.attemptOrdinal === null) return false;
          const attempt = current.autosaveAttempts.find(
            (candidate) => candidate.ordinal === entry.attemptOrdinal);
          return attempt?.postChanged === true
            && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
        });
      }, { message: 'natural Core autosave success after post-dirty attempt', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForLocalDraft = async () => {
      if (!coverage.localDraft.applicable) return true;
      const draftSeconds = Number(coverage.localDraft.intervalSeconds);
      if (!(draftSeconds > 0)) return false;
      const timeout = boundedTimeout(draftSeconds * 1000 + 20_000);
      await stageProbe.beginQuiet('local-draft-debounce');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        const storage = current.localDraft.storage;
        const advanced = storage?.present === true && storage.updatedAt !== null
          && (localDraftUpdatedAtBaseline === null
            || storage.updatedAt > localDraftUpdatedAtBaseline);
        coverage.localDraft.updatedAtAdvanced = advanced;
        coverage.localDraft.contentMatchesCurrent = storage?.contentMatchesCurrent === true;
        return advanced && coverage.localDraft.contentMatchesCurrent;
      }, { message: 'local draft debounce completion evidence', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    await guard();
    await stage.visual.locator('p').last().click();
    await stageProbe.press('End');
    await guard();
    await stageProbe.type('甲A');
    await guard();
    await expectSource(stage.source, afterForeground);
    const dirtyProbe = await readProbe();
    coverage.postChanged = dirtyProbe.postChanged;
    const dirtyAt = await page.evaluate(() => performance.now());
    if (coverage.localDraft.applicable) {
      coverage.localDraft.saved = await waitForLocalDraft();
    }
    coverage.foregroundCycle = await waitForCycle('foreground', true);
    coverage.autosaveSuccess = await waitForAutosave();
    await guard();
    const blurBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'blur').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-out');
    second = await page.context().newPage();
    focusOverrideSessions.push(await disableFocusOverride(second));
    await second.goto('about:blank');
    await second.bringToFront();
    coverage.focusLost = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === false
        && current.heartbeat.coreHasFocus === false
        && current.focus.some((entry) => entry.type === 'blur'
          && entry.ordinal > blurBaseline);
    }, { message: 'first page must lose real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.focusLost) throwUncovered(['focus-loss']);
    coverage.backgroundCycle = await waitForCycle('background', false);
    if (!coverage.backgroundCycle) throwUncovered(['background-heartbeat']);
    const focusBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'focus').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-return');
    await page.bringToFront();
    coverage.returnFocus = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === true
        && current.heartbeat.coreHasFocus === true
        && current.focus.some((entry) => entry.type === 'focus'
          && entry.ordinal > focusBaseline);
    }, { message: 'first page must regain real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.returnFocus) throwUncovered(['return-focus']);
    coverage.returnCycle = await waitForCycle('return', true);
    if (!coverage.returnCycle) throwUncovered(['return-heartbeat']);
    const inputUnmet = [];
    if (coverage.postChanged !== true) inputUnmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) inputUnmet.push('foreground-heartbeat');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      inputUnmet.push('local-draft-save');
    }
    if (!coverage.autosaveSuccess) inputUnmet.push('autosave-success');
    if (inputUnmet.length) throwUncovered(inputUnmet);
    await guard();
    frames.stage('post-cycle-native-editing');
    await stageProbe.resumeEditing();
    await stageProbe.type('乙B');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Backspace');
    await guard();
    await expectSource(stage.source, afterDelete);
    await guard();
    await stageProbe.press('Control+z');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, afterDelete);
    expect(stage.failures).toEqual([]);
    await previewRead.prove({ visual: stage.visual });
    finalProbe = await readProbe();
    coverage.sessionReady = finalProbe.sessionStatus === 'ready';
    const unmet = [];
    if (coverage.postChanged !== true) unmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) unmet.push('foreground-heartbeat');
    if (!coverage.focusLost) unmet.push('focus-loss');
    if (!coverage.backgroundCycle) unmet.push('background-heartbeat');
    if (!coverage.returnFocus) unmet.push('return-focus');
    if (!coverage.returnCycle) unmet.push('return-heartbeat');
    if (!coverage.autosaveSuccess) unmet.push('autosave-success');
    if (!coverage.sessionReady) unmet.push('session-ready');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      unmet.push('local-draft-save');
    }
    if (unmet.length) throwUncovered(unmet);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { reportSafeCoverage(); } catch { cleanupFailures.push('coverage-report'); }
    try { page.off('popup', onPopup); } catch { cleanupFailures.push('popup-listener-off'); }
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('background-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    try { await detachFocusOverrides(); }
    catch { cleanupFailures.push('focus-override-detach'); }
    if (second) {
      try { await second.close(); } catch { cleanupFailures.push('second-page-close'); }
    }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-background-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`background-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});

test('[short-stage-lock] active Preview lock survives natural cycles and resumes editing', async ({ page }) => {
  test.setTimeout(540_000);
  const initial = '# 锁\n\nAlpha 开始。\n\nBeta 结束。';
  const typed = initial + 'V';
  const resumed = typed + 'X';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [resumed], [typed], [resumed]] }
  ]);
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  const caseDeadline = Date.now() + 480_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('lock-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  let stage = null;
  let stageProbe = null, frames = null;
  let primaryError = null;
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const waitUntil = async (predicate, { message, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
    }
    console.log(JSON.stringify({ phase: 'short-stage-lock-wait-timeout', message }));
    return false;
  };
  const guard = async ({ locked = false } = {}) => {
    stageProbe?.guard();
    if (stage.failures.length) throw new Error(`lock-stage-failure:${stage.failures[0]}`);
    const state = await readProbe();
    if (state.visibilityState !== 'visible') {
      throw new Error(`lock-stage-visibility:${state.visibilityState}`);
    }
    if (state.sessionStatus !== 'ready') {
      throw new Error(`lock-stage-session:${state.sessionStatus}`);
    }
    if (state.heartbeat.connectionError === true) {
      throw new Error('lock-stage-heartbeat-connection-error');
    }
    if (state.lockPressed !== (locked ? 'true' : 'false')) {
      throw new Error(`lock-stage-lock:${state.lockPressed}`);
    }
    if (locked ? state.surfaceEditable !== false : state.surfaceEditable !== true) {
      throw new Error(locked ? 'lock-stage-unexpected-editable' : 'lock-stage-unexpected-readonly');
    }
    return state;
  };
  const waitForCycle = async (label, locked) => {
    const start = await guard({ locked });
    const interval = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(interval > 0)) throw new Error(`lock-stage-uncovered:${label}-interval`);
    const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
    const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
    const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
    await stageProbe.beginQuiet(`${label}-heartbeat`);
    const covered = await waitUntil(async () => {
      await guard({ locked });
      const current = await readProbe();
      return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
        && entry.durationMs !== null
        && entry.sendOrdinal !== null
        && entry.sendOrdinal > baselineSendOrdinal
        && entry.sendVisibility === 'visible');
    }, { message: `${label} natural heartbeat`, timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error(`lock-stage-uncovered:${label}-heartbeat`);
  };
  const waitForAutosave = async (dirtyAt) => {
    const start = await guard();
    const autosaveSeconds = Number(start.intervals.autosave);
    const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) {
      throw new Error('lock-stage-uncovered:pre-lock-autosave-interval');
    }
    const timeout = boundedTimeout(
      (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
    await stageProbe.beginQuiet('pre-lock-autosave');
    const covered = await waitUntil(async () => {
      await guard();
      const current = await readProbe();
      return current.autosave.some((entry) => {
        if (entry.success !== true || entry.attemptOrdinal === null) return false;
        const attempt = current.autosaveAttempts.find(
          (candidate) => candidate.ordinal === entry.attemptOrdinal);
        return attempt?.postChanged === true
          && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
      });
    }, { message: 'pre-lock natural autosave', timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error('lock-stage-uncovered:pre-lock-autosave');
  };
  try {
    await page.bringToFront();
    stage = await openShortStage(page, 'full', initial, async (context) => {
      previewRead.beforeFixture(context);
      await installBackgroundProbe(page);
    });
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage, [initial, typed, resumed],
      { backgroundObservation: true, allowLocked: true, frames });
    await guard();
    await sink.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type('V');
    await guard();
    await expectSource(stage.source, typed);
    const dirtyAt = await page.evaluate(() => performance.now());
    await waitForAutosave(dirtyAt);
    await waitForCycle('pre-lock', false);
    await expectSource(stage.source, typed);
    const beforeLock = await readPublicEditorState(page);
    await guard();
    await stageProbe.beginQuiet('user-lock-toggle');
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const lockedSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(lockedSink.effectiveEditable, 'locked sink must be effectively read-only').toBe(false);
    expect(lockedSink.contenteditable).not.toBe('true');
    await guard({ locked: true });
    await sink.locator('p').last().click();
    await guard({ locked: true });
    await stageProbe.endQuiet();
    await waitForCycle('locked', true);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const afterCycleSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(afterCycleSink.effectiveEditable, 'lock must survive a natural cycle').toBe(false);
    const afterCycle = await readPublicEditorState(page);
    expect(afterCycle.source === typed, 'natural cycle must not change the exact source while locked').toBe(true);
    expect({
      sourceInputConnected: afterCycle.sourceInputConnected,
      sourceEditable: afterCycle.sourceEditable,
      visualEditable: afterCycle.visualEditable,
      nativeConnected: afterCycle.nativeConnected
    }, 'natural cycle must retain a connected editable source owner').toMatchObject({
      sourceInputConnected: true, sourceEditable: true, visualEditable: false, nativeConnected: true
    });
    await expectSource(stage.source, typed);
    await stageProbe.beginQuiet('locked-negative-inputs');
    for (const key of ['Q', 'Backspace', 'Enter']) {
      await guard({ locked: true });
      if (key === 'Q') await page.keyboard.type('Q');
      else await page.keyboard.press(key);
      await expectSource(stage.source, typed);
      const lockedOwner = await readPublicEditorState(page);
      expect(lockedOwner.source === typed, `${key}: locked source must not change`).toBe(true);
      expect(lockedOwner.nativeConnected, `${key}: locked keys must not strand the native Selection`).toBe(true);
      await guard({ locked: true });
    }
    await stageProbe.endQuiet();
    expect(stage.failures).toEqual([]);
    await guard({ locked: true });
    await stageProbe.beginQuiet('user-unlock-toggle');
    await lock.click();
    await expect(sink).toHaveAttribute('contenteditable', 'true');
    await guard();
    await stageProbe.endQuiet();
    frames.stage('resumed-native-editing');
    await stageProbe.resumeEditing();
    await page.keyboard.type('X');
    await expectSource(stage.source, resumed);
    await guard();
    await page.keyboard.press('Control+z');
    await guard();
    await expectSource(stage.source, typed);
    await guard();
    await page.keyboard.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, resumed);
    await guard();
    expect(stage.failures).toEqual([]);
    await previewRead.prove({ visual: stage.visual });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('lock-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-lock-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`lock-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});
