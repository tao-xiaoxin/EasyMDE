import { expect, test } from '@playwright/test';
import { createPreviewReadOperationLedger, installHistoryObserver } from './visual-browser-monitor.mjs';

const firstRuntimeFailureObservations = new WeakMap();

export const browserMonitors = new WeakMap();

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

function environment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}

export async function expectSource(source, expected) {
  await expect.poll(async () => await source.inputValue() === expected, {
    message: 'Canonical Markdown must match exactly; document content is not logged'
  }).toBe(true);
}

export function safePublicState(state) {
  return state ? { sourceLength: state.sourceLength, contenteditable: state.contenteditable,
    sourceInputConnected: state.sourceInputConnected,
    sourceEditable: state.sourceEditable, visualEditable: state.visualEditable,
    effectiveEditable: state.effectiveEditable, focused: state.focused, lock: state.lock,
    session: state.session, previewPhase: state.previewPhase, busy: state.busy,
    failure: state.failure, repairCount: state.repairCount, nativeConnected: state.nativeConnected,
    nativeCollapsed: state.nativeCollapsed, nativeDirection: state.nativeDirection } : null;
}

export function safeFullCrossBlockState(state) {
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

export async function readPublicEditorState(page) {
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

export async function readShortStageFinalPreviewCertificate(page, expectedSource) {
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

export async function readFullCrossBlockState(visual, expected = {}) {
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

export async function readWindowedSmokeState(visual, target = {}) {
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

export async function expectWindowedSmokeCheckpoint(visual, failures, stage, target, nativeOffset, direction = 'none') {
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

export async function holdFormalPreview(page) {
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

export async function expectNativeTail(row, expected) {
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

export function createPhasedPreviewOperationTracker(phases) {
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

export async function openVisual(page, markdown, pasteFrom, beforeFixture) {
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

export async function readSettledSource(source, stableReads = 6) {
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

export function isSubsequence(candidate, source) {
  let index = 0;
  for (const character of source) {
    if (character === candidate[index]) index += 1;
    if (index === candidate.length) return true;
  }
  return index === candidate.length;
}

export async function expectLiveSelection(visual) {
  await expect(visual).toHaveAttribute('contenteditable', 'true');
  expect(await visual.evaluate((surface) => {
    const selection = surface.ownerDocument.getSelection();
    return !!selection?.anchorNode?.isConnected
      && !!selection.focusNode?.isConnected
      && surface.contains(selection.anchorNode)
      && surface.contains(selection.focusNode);
  })).toBe(true);
}

export async function expectCaretAfterImage(visual, alt, ordinal = 0) {
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

export function registerVisualEditingHooks() {
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
}
