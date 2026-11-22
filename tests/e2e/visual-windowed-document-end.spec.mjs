import { expect, test } from '@playwright/test';

import {
  finishVisualBrowserMonitor,
  getVisualBrowserMonitor,
  installVisualBrowserMonitor,
  monitorError
} from './helpers/visual-browser-monitor.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Trace, video and failure screenshots snapshot the article DOM. This spec
// reads scalar state only: attributes, node counts, offsets, lengths and the
// synthetic fixture it authored itself.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const SURFACE_SELECTOR = '[data-easymde-preview-html-sink][role="textbox"]';
const FAILURE_ATTRIBUTE = 'data-easymde-visual-failure';
const PROBE_KEY = '__easymdeDocumentEndKeyProbe';
const PROOF_KEY = '__easymdeDocumentEndProof';
const LOGIN_PROBE_KEY = '__easymdeLoginObservation';
const LOGIN_OBSERVATION_ATTACHMENT = 'login-observation';
const OWNED_POST_ANNOTATION = 'easymde-e2e-owned-post';
const AUTHORED_TERMINAL_TEXT = 'Tail.';

let monitoredPage = null;
let documentEndObservations = [];
let loginObservation = null;

test.afterEach(async ({}, testInfo) => {
  const observations = documentEndObservations;
  const pendingLoginObservation = loginObservation;
  const page = monitoredPage;
  documentEndObservations = [];
  loginObservation = null;
  monitoredPage = null;
  const diagnosticErrors = [];
  let summary = null;

  // The monitor must finish before any attachment attempt, so an attachment
  // failure cannot leave its event listeners or history bridge alive.
  if (page) {
    try {
      summary = await finishVisualBrowserMonitor(page);
      if (summary === null) diagnosticErrors.push('monitor-summary-missing');
    } catch {
      diagnosticErrors.push('visual-browser-monitor-finish-failed');
    }
  }

  let loginEvidence = null;
  if (page && pendingLoginObservation) {
    try {
      loginEvidence = await pendingLoginObservation.finalize();
    } catch {
      diagnosticErrors.push('login-observation-finalize-failed');
    }
    try {
      if (!(await pendingLoginObservation.detach())) {
        diagnosticErrors.push('login-observation-detach-failed');
      }
    } catch {
      diagnosticErrors.push('login-observation-detach-failed');
    }
  }

  const attach = async (name, body) => {
    try {
      await testInfo.attach(name, {
        body: JSON.stringify(body),
        contentType: 'application/json'
      });
    } catch {
      diagnosticErrors.push(`${name}-attachment-failed`);
    }
  };

  if (observations.length > 0) await attach('document-end-observation', observations);
  if (loginEvidence) await attach(LOGIN_OBSERVATION_ATTACHMENT, loginEvidence);
  if (summary) {
    await attach('visual-browser-monitor', summary);
    if (summary.issues.length > 0) diagnosticErrors.push(monitorError(summary.issues));
  }

  const uniqueDiagnosticErrors = [...new Set(diagnosticErrors)];
  for (const code of uniqueDiagnosticErrors) {
    testInfo.annotations.push({ type: 'easymde-e2e-diagnostic-error', description: code });
  }
  if (testInfo.status === testInfo.expectedStatus && uniqueDiagnosticErrors.length > 0) {
    throw new Error(uniqueDiagnosticErrors.join(','));
  }
});

function environment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test environment: ${name}`);
  return value;
}

// The credential is only ever supplied through the environment. The repo-wide
// Playwright environment names it WORDPRESS_ADMIN_PASSWORD; the focused
// browser task names it EASYMDE_ADMIN_PASSWORD. Either is accepted, and
// neither is ever written to a file, a log or an artifact.
function adminPassword() {
  const value = process.env.EASYMDE_ADMIN_PASSWORD ?? process.env.WORDPRESS_ADMIN_PASSWORD;
  if (!value) throw new Error('Missing test environment: EASYMDE_ADMIN_PASSWORD');
  return value;
}

async function loginRedirectDestination(page) {
  const destination = await page.evaluate(() => {
    const redirect = document.querySelector('#loginform input[name="redirect_to"]');
    return redirect instanceof HTMLInputElement ? redirect.value : null;
  });
  if (!destination) throw new Error('wordpress-login-redirect-target-unavailable');
  return destination;
}

const LOGIN_ROUTE_CLASSES = new Set([
  'wordpress-login', 'wp-admin', 'post-new', 'other', 'invalid'
]);
const LOGIN_NETWORK_CODES = new Set([
  'ERR_ABORTED', 'ERR_CONNECTION_ABORTED', 'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET', 'ERR_FAILED', 'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_HTTP_RESPONSE_CODE_FAILURE', 'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED', 'ERR_TIMED_OUT'
]);

function loginRouteClass(raw, baseURL) {
  try {
    const value = new URL(String(raw), baseURL);
    if (value.pathname.endsWith('/wp-login.php')) return 'wordpress-login';
    if (value.pathname.endsWith('/wp-admin/post-new.php')) return 'post-new';
    if (value.pathname.includes('/wp-admin/')) return 'wp-admin';
    return 'other';
  } catch {
    return 'invalid';
  }
}

function loginNetworkFailureCode(errorText) {
  const code = typeof errorText === 'string'
    ? errorText.match(/(?:^|::)(ERR_[A-Z0-9_]+)$/u)?.[1] ?? null
    : null;
  return code && LOGIN_NETWORK_CODES.has(code) ? code : null;
}

async function installLoginObservation(page, baseURL) {
  const events = [];
  const pendingNotifications = new Set();
  const collectionHealth = {
    invalidPayloadCount: 0,
    eventOverflowCount: 0,
    bindingFailureCount: 0,
    pendingNotificationCountAtCutoff: 0,
    pendingNotificationCount: 0,
    failedNotificationCount: 0,
    barrierTimedOut: false
  };
  const requestState = {
    loginPostCount: 0,
    statuses: new Set(),
    redirectRouteClass: null,
    failureCodes: new Set()
  };

  const onRequest = (request) => {
    if (request.frame() !== page.mainFrame()
      || request.method() !== 'POST'
      || loginRouteClass(request.url(), baseURL) !== 'wordpress-login') return;
    requestState.loginPostCount = Math.min(64, requestState.loginPostCount + 1);
  };
  const onResponse = (response) => {
    const request = response.request();
    if (request.frame() !== page.mainFrame()
      || request.method() !== 'POST'
      || loginRouteClass(response.url(), baseURL) !== 'wordpress-login') return;
    if (requestState.statuses.size < 4) requestState.statuses.add(response.status());
    const location = response.headers().location;
    if (typeof location === 'string' && location.length > 0) {
      requestState.redirectRouteClass = loginRouteClass(location, baseURL);
    }
  };
  const onRequestFailed = (request) => {
    if (request.frame() !== page.mainFrame()
      || request.method() !== 'POST'
      || loginRouteClass(request.url(), baseURL) !== 'wordpress-login') return;
    const code = loginNetworkFailureCode(request.failure()?.errorText);
    if (code && requestState.failureCodes.size < 4) requestState.failureCodes.add(code);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  await page.exposeFunction('__easymdeLoginObservationEvent', (payload) => {
    const operation = Promise.resolve().then(() => {
      if (!payload || typeof payload !== 'object'
        || !['click', 'submit'].includes(payload.type)
        || !['capture', 'bubble', 'microtask'].includes(payload.observationPhase)
      || typeof payload.defaultPrevented !== 'boolean'
      || typeof payload.formValid !== 'boolean'
      || typeof payload.userNonEmpty !== 'boolean'
        || typeof payload.passwordNonEmpty !== 'boolean') {
        collectionHealth.invalidPayloadCount = Math.min(64, collectionHealth.invalidPayloadCount + 1);
        return;
      }
      if (events.length >= 16) {
        collectionHealth.eventOverflowCount = Math.min(64, collectionHealth.eventOverflowCount + 1);
        return;
      }
      events.push({
        type: payload.type,
        observationPhase: payload.observationPhase,
        defaultPrevented: payload.defaultPrevented,
        formValid: payload.formValid,
        userNonEmpty: payload.userNonEmpty,
        passwordNonEmpty: payload.passwordNonEmpty
      });
    });
    pendingNotifications.add(operation);
    collectionHealth.pendingNotificationCount = pendingNotifications.size;
    void operation.then(
      () => {
        pendingNotifications.delete(operation);
        collectionHealth.pendingNotificationCount = pendingNotifications.size;
      },
      () => {
        pendingNotifications.delete(operation);
        collectionHealth.failedNotificationCount = Math.min(64, collectionHealth.failedNotificationCount + 1);
        collectionHealth.pendingNotificationCount = pendingNotifications.size;
      }
    );
    return operation;
  });

  await page.exposeFunction('__easymdeLoginObservationFailure', (code) => {
    if (code !== 'login-observation-collector-binding-rejected') return;
    collectionHealth.bindingFailureCount = Math.min(64, collectionHealth.bindingFailureCount + 1);
  });

  await page.addInitScript(({ key }) => {
    let top = false;
    try { top = window.top === window; } catch { top = false; }
    if (!top) return;
    const previous = window[key];
    if (previous && typeof previous.stop === 'function') {
      try { previous.stop(); } catch {}
    }
    const listeners = [];
    // These are sampled observation phases, not final event outcomes. In
    // particular, a microtask can run between click and submit listeners.
    const snapshot = (type, phase, event) => {
      const form = document.querySelector('#loginform');
      const user = document.querySelector('#user_login');
      const password = document.querySelector('#user_pass');
      let formValid = null;
      try {
        formValid = form instanceof HTMLFormElement
          ? [...form.elements].every((control) => (
            !('willValidate' in control)
              || control.willValidate !== true
              || control.validity?.valid === true
          ))
          : null;
      } catch {}
      const payload = {
        type,
        observationPhase: phase,
        defaultPrevented: event.defaultPrevented === true,
        formValid,
        userNonEmpty: user instanceof HTMLInputElement ? user.value.length > 0 : null,
        passwordNonEmpty: password instanceof HTMLInputElement ? password.value.length > 0 : null
      };
      try {
        const operation = window.__easymdeLoginObservationEvent(payload);
        if (operation && typeof operation.catch === 'function') {
          void operation.catch(() => {
            try {
              void window.__easymdeLoginObservationFailure(
                'login-observation-collector-binding-rejected'
              ).catch(() => {});
            } catch {}
          });
        }
      } catch {
        try {
          void window.__easymdeLoginObservationFailure(
            'login-observation-collector-binding-rejected'
          ).catch(() => {});
        } catch {}
      }
    };
    const watch = (type, selector) => {
      const capture = (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(selector)) return;
        snapshot(type, 'capture', event);
        queueMicrotask(() => snapshot(type, 'microtask', event));
      };
      const bubble = (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(selector)) return;
        snapshot(type, 'bubble', event);
      };
      document.addEventListener(type, capture, true);
      document.addEventListener(type, bubble, false);
      listeners.push([type, capture, true], [type, bubble, false]);
    };
    watch('click', '#wp-submit');
    watch('submit', '#loginform');
    Object.defineProperty(window, key, {
      configurable: true,
      value: {
        stop() {
          for (const [type, listener, capture] of listeners) {
            document.removeEventListener(type, listener, capture);
          }
          listeners.length = 0;
        }
      }
    });
  }, { key: LOGIN_PROBE_KEY });

  return {
    async finalize() {
      const pendingAtCutoff = [...pendingNotifications];
      collectionHealth.pendingNotificationCountAtCutoff = pendingAtCutoff.length;
      if (pendingAtCutoff.length > 0) {
        const timeoutToken = Symbol('login-observation-barrier-timeout');
        const barrierResult = await Promise.race([
          Promise.allSettled(pendingAtCutoff).then(() => null),
          new Promise((resolve) => setTimeout(() => resolve(timeoutToken), 1_000))
        ]);
        if (barrierResult === timeoutToken) collectionHealth.barrierTimedOut = true;
      }
      collectionHealth.pendingNotificationCount = pendingNotifications.size;
      let final = null;
      try {
        const state = await page.evaluate(() => ({
          adminbarPresent: !!document.querySelector('#wpadminbar'),
          loginErrorPresent: !!document.querySelector('#login_error')
        }));
        final = {
          routeClass: loginRouteClass(page.url(), baseURL),
          adminbarPresent: state.adminbarPresent,
          loginErrorPresent: state.loginErrorPresent
        };
      } catch {}
      return {
        schemaVersion: 1,
        eventCount: events.length,
        events: events.slice(),
        loginPostCount: requestState.loginPostCount,
        loginPostStatuses: [...requestState.statuses].sort((a, b) => a - b),
        redirectRouteClass: requestState.redirectRouteClass,
        requestFailureCodes: [...requestState.failureCodes].sort(),
        collectionHealth: {
          ...collectionHealth,
          collectorFailureCode: collectionHealth.bindingFailureCount > 0
            ? 'login-observation-collector-binding-rejected'
            : null,
          barrierFailureCode: collectionHealth.barrierTimedOut
            ? 'login-observation-notification-barrier-timeout'
            : null
        },
        final
      };
    },
    async detach() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      try {
        return await page.evaluate((key) => {
          const observer = window[key];
          if (!observer || typeof observer.stop !== 'function') return false;
          observer.stop();
          return true;
        }, LOGIN_PROBE_KEY);
      } catch {
        return false;
      }
    }
  };
}

// More than 160 blocks: the Preview mounts a window with spacers instead of the
// whole document, so `Control+End` lands on the editing host while the
// document-end Block is still unmounted.
function windowedMarkdown() {
  const filler = Array.from(
    { length: 170 },
    (_, index) => `Filler ${index + 1}.`
  ).join('\n\n');
  return `Head.\n\n${filler}\n\n${AUTHORED_TERMINAL_TEXT}`;
}

const AUTHORED_SOURCE = windowedMarkdown();

// The canonical document-end Enter opens one terminal line: the owner splices
// only the line endings the source is missing, because two terminal endings
// already separate a new block.
function terminalSeparator(source) {
  const trailing = source.match(/(?:\r\n|\r|\n)+$/u)?.[0] ?? '';
  const endings = (trailing.match(/\r\n|\r|\n/gu) ?? []).length;
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  return lineEnding.repeat(Math.max(0, 2 - endings));
}

// The operation may observe any ordered subset of these exact source states.
// Each state is the canonical source at the point of a possible preview read.
function previewReadSources(before, separator) {
  const entered = before + separator;
  return [entered, `${entered}a`, `${entered}ab`, `${entered}abc`];
}

async function expectSource(source, expected) {
  await expect.poll(async () => await source.inputValue() === expected, {
    message: 'Canonical Markdown must match exactly; document content is not logged'
  }).toBe(true);
}

// The proof reader returns only a fixed schema of booleans, counts, finite node
// categories, and the authored fixture identity. It never returns article text.
async function installDocumentEndProofReader(page) {
  await page.addInitScript(({ key, authoredSource, authoredTerminalText }) => {
    const reader = () => {
      const surface = document.querySelector('[data-easymde-preview-html-sink]');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const source = document.querySelector('#easymde-source');
      const sourceValue = typeof source?.value === 'string' ? source.value : null;
      const last = surface?.lastChild ?? null;
      const isSpacer = (node) => !!node && node.nodeType === 1
        && node.hasAttribute('data-easymde-preview-window-spacer');
      const anchorNodeKind = anchor === null
        ? 'none'
        : anchor === surface
          ? 'surface'
          : anchor.nodeType === Node.TEXT_NODE
            ? 'text'
            : anchor.nodeType === Node.ELEMENT_NODE
              ? 'element'
              : 'other';
      const inside = !!surface && !!anchor && surface.contains(anchor);
      const element = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      let block = element;
      while (block && block.parentNode !== surface) block = block.parentElement;
      const realChildren = surface
        ? [...surface.childNodes].filter((node) => !isSpacer(node)
          && !(node.nodeType === Node.TEXT_NODE && node.textContent.trim() === ''))
        : [];
      const authoredTerminalRows = realChildren.filter((node) => node.nodeType === Node.ELEMENT_NODE
        && node.tagName === 'P'
        && node.textContent === authoredTerminalText);
      const lastRealChild = realChildren.at(-1) ?? null;
      const lastNodeIsAuthoredTerminal = sourceValue === authoredSource
        && authoredTerminalRows.length === 1
        && lastRealChild === authoredTerminalRows[0];
      const caretInsideSpacer = !!surface && !!element && surface.contains(element)
        && !!element.closest('[data-easymde-preview-window-spacer]');
      let anchorTextOffset = null;
      if (inside && block) {
        try {
          const range = document.createRange();
          range.setStart(block, 0);
          range.setEnd(anchor, selection.anchorOffset);
          anchorTextOffset = range.toString().length;
        } catch {
          anchorTextOffset = null;
        }
      }
      return {
        present: !!surface,
        collapsed: selection?.isCollapsed ?? null,
        rangeCount: selection?.rangeCount ?? null,
        focused: !!surface && document.activeElement === surface,
        anchorNodeKind,
        anchorIsSurface: !!surface && anchor === surface,
        anchorOffset: selection?.anchorOffset ?? null,
        childCount: surface ? surface.childNodes.length : null,
        lastChildIsSpacer: surface ? isSpacer(last) : null,
        lastNodeIsAuthoredTerminal,
        caretInsideSpacer,
        sourceLength: sourceValue?.length ?? null,
        sourceEqualsExpected: sourceValue === null ? null : sourceValue === authoredSource,
        sourceEndsWithAuthoredTerminal: sourceValue === null
          ? null
          : sourceValue.endsWith(authoredTerminalText),
        caretInside: inside,
        anchorBlockTag: block?.tagName ?? null,
        anchorBlockIsDirectChild: !!block && block.parentNode === surface,
        anchorBlockIsLastChild: !!block && block === surface.lastChild,
        anchorBlockTextLength: block ? block.textContent.length : null,
        anchorBlockEqualsAuthoredTerminal: block
          ? block.textContent === authoredTerminalText
          : null,
        anchorTextOffset
      };
    };
    Object.defineProperty(window, key, { value: reader, configurable: true });
  }, {
    key: PROOF_KEY,
    authoredSource: AUTHORED_SOURCE,
    authoredTerminalText: AUTHORED_TERMINAL_TEXT
  });
}

// Scalar reader. It never returns rendered text of the authored document except
// the fixture rows this spec wrote itself.
function readSurfaceState() {
  const surface = document.querySelector('[data-easymde-preview-html-sink]');
  const failureOwner = document.querySelector('[data-easymde-visual-failure]');
  const selection = document.getSelection();
  const anchor = selection?.anchorNode ?? null;
  const source = document.querySelector('#easymde-source');
  const last = surface?.lastChild ?? null;
  const isSpacer = (node) => !!node && node.nodeType === 1
    && node.hasAttribute('data-easymde-preview-window-spacer');
  const documentEnd = typeof window.__easymdeDocumentEndProof === 'function'
    ? window.__easymdeDocumentEndProof()
    : null;
  const state = {
    present: !!surface,
    role: surface?.getAttribute('role') ?? null,
    editable: surface?.getAttribute('contenteditable') ?? null,
    phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
    busy: surface?.getAttribute('aria-busy') ?? null,
    failure: surface?.getAttribute('data-easymde-visual-failure')
      ?? failureOwner?.getAttribute('data-easymde-visual-failure') ?? null,
    lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
    focused: !!surface && document.activeElement === surface,
    childCount: surface ? surface.childNodes.length : null,
    spacerCount: surface ? surface.querySelectorAll('[data-easymde-preview-window-spacer]').length : null,
    lastChildIsSpacer: isSpacer(last),
    sourceLength: typeof source?.value === 'string' ? source.value.length : null,
    collapsed: selection?.isCollapsed ?? null,
    rangeCount: selection?.rangeCount ?? null,
    anchorIsSurface: !!surface && anchor === surface,
    anchorOffset: selection?.anchorOffset ?? null,
    documentEnd,
    caret: null
  };
  if (surface && anchor) {
    const inside = surface.contains(anchor);
    const element = anchor instanceof Element ? anchor : anchor.parentElement ?? null;
    let block = element;
    while (block && block.parentNode !== surface) block = block.parentElement;
    let textOffset = null;
    if (inside && block) {
      try {
        const range = document.createRange();
        range.setStart(block, 0);
        range.setEnd(anchor, selection.anchorOffset);
        textOffset = range.toString().length;
      } catch {
        textOffset = null;
      }
    }
    state.caret = {
      inside,
      blockTag: block?.tagName ?? null,
      blockText: block?.textContent ?? null,
      blockTextLength: block ? block.textContent.length : null,
      blockIsDirectChild: !!block && block.parentNode === surface,
      blockIsLastChild: !!block && block === surface.lastChild,
      textOffset
    };
  }
  return state;
}

async function readSurfaceStateOf(page) {
  return page.evaluate(readSurfaceState);
}

const SAFE_PREVIEW_PHASES = new Set([
  'committing', 'enhancing', 'failed', 'loading', 'ready', 'retained'
]);
const SAFE_BLOCK_TAGS = new Set([
  'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'H1', 'H2',
  'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE', 'TABLE', 'TBODY',
  'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
]);

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeFailureCode(value) {
  if (value === null) return null;
  return typeof value === 'string'
    && /^[a-z0-9]+(?:[:_-][a-z0-9]+)*$/u.test(value)
    && value.length <= 128
    ? value
    : 'unclassified';
}

// Persist only the scalar shape needed to distinguish the host and mounted-row
// caret contracts. Article text and rendered HTML never enter this record.
function recordDocumentEndObservation(stage, state) {
  documentEndObservations.push({
    stage,
    present: safeBoolean(state.present),
    collapsed: safeBoolean(state.collapsed),
    rangeCount: safeCount(state.rangeCount),
    focused: safeBoolean(state.focused),
    anchorIsSurface: safeBoolean(state.anchorIsSurface),
    anchorOffset: safeCount(state.anchorOffset),
    childCount: safeCount(state.childCount),
    sourceLength: safeCount(state.sourceLength),
    phase: SAFE_PREVIEW_PHASES.has(state.phase) ? state.phase : null,
    failure: safeFailureCode(state.failure),
    lastSpacer: safeBoolean(state.lastChildIsSpacer),
    caretInside: safeBoolean(state.caret?.inside),
    caretTag: SAFE_BLOCK_TAGS.has(state.caret?.blockTag) ? state.caret.blockTag : null,
    caretDirectChild: safeBoolean(state.caret?.blockIsDirectChild),
    caretLastChild: safeBoolean(state.caret?.blockIsLastChild),
    textLength: safeCount(state.caret?.blockTextLength),
    textOffset: safeCount(state.caret?.textOffset)
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
        status: 'unidentified', code: 'windowed-owned-post-id-missing',
        beforeFixture: true, route: 'new-post'
      };
    }
    if (values.length !== 1 || !/^[1-9][0-9]*$/u.test(values[0])) {
      return {
        status: 'unidentified', code: 'windowed-owned-post-id-ambiguous',
        beforeFixture: true, route: 'new-post'
      };
    }
    const postId = Number(values[0]);
    if (!Number.isSafeInteger(postId) || String(postId) !== values[0]) {
      return {
        status: 'unidentified', code: 'windowed-owned-post-id-unsafe',
        beforeFixture: true, route: 'new-post'
      };
    }
    return { status: 'identified', postId, beforeFixture: true, route: 'new-post' };
  });
  test.info().annotations.push({
    type: OWNED_POST_ANNOTATION,
    description: JSON.stringify(capture)
  });
  if (capture.status !== 'identified') throw new Error(capture.code);
  return capture;
}

// Waits until the windowed surface is ready AND its shape, caret and canonical
// length have been identical for three consecutive reads, so the recorded
// caret is the one the next key acts on.
async function settleWindow(page, timeoutMs = 20_000) {
  const started = Date.now();
  let previous = null;
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await readSurfaceStateOf(page);
    const identity = JSON.stringify([
      state.phase,
      state.busy,
      state.editable,
      state.childCount,
      state.spacerCount,
      state.sourceLength,
      state.anchorIsSurface,
      state.anchorOffset,
      state.caret?.blockTextLength ?? null,
      state.caret?.textOffset ?? null
    ]);
    if (state.present && state.phase === 'ready' && state.busy !== 'true'
      && state.editable === 'true' && identity === previous) {
      stable += 1;
      if (stable >= 3) return state;
    } else {
      stable = 0;
    }
    previous = identity;
    await page.waitForTimeout(120);
  }
  throw new Error('visual-windowed-document-end-surface-did-not-settle');
}

// Records every key the immersive surface receives. The capture listener runs
// before the editor's own handlers, so it reports the caret the gesture
// actually addressed; the bubble listener runs after them, so it reports
// whether the editor consumed the event instead of letting native editing run.
async function installKeyProbe(page) {
  await page.addInitScript((key) => {
    const events = [];
    Object.defineProperty(window, key, { value: events, configurable: true });
    const snapshot = () => {
      const surface = document.querySelector('[data-easymde-preview-html-sink]');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const last = surface?.lastChild ?? null;
      return {
        collapsed: selection?.isCollapsed ?? null,
        anchorIsSurface: !!surface && anchor === surface,
        anchorOffset: selection?.anchorOffset ?? null,
        childCount: surface ? surface.childNodes.length : null,
        lastChildIsSpacer: !!last && last.nodeType === 1
          && last.hasAttribute('data-easymde-preview-window-spacer'),
        focused: !!surface && document.activeElement === surface,
        documentEnd: typeof window.__easymdeDocumentEndProof === 'function'
          ? window.__easymdeDocumentEndProof()
          : null
      };
    };
    const record = (phase) => (event) => {
      if (event.type !== 'keydown' && event.type !== 'beforeinput') return;
      if (events.length >= 64) return;
      const surface = document.querySelector('[data-easymde-preview-html-sink]');
      const target = event.target;
      if (!surface || !(target === surface || surface.contains(target))) return;
      events.push({
        phase,
        type: event.type,
        key: typeof event.key === 'string' ? event.key : null,
        inputType: typeof event.inputType === 'string' ? event.inputType : null,
        dataLength: typeof event.data === 'string' ? event.data.length : null,
        prevented: !!event.defaultPrevented,
        ...snapshot()
      });
    };
    document.addEventListener('keydown', record('before'), true);
    document.addEventListener('beforeinput', record('before'), true);
    document.addEventListener('keydown', record('after'), false);
    document.addEventListener('beforeinput', record('after'), false);
  }, PROBE_KEY);
}

async function drainKeys(page) {
  return page.evaluate((key) => (Array.isArray(window[key]) ? window[key].splice(0) : []), PROBE_KEY);
}

// Puts the caret in a windowed row with real mouse input. A fully visible row
// is preferred so the click cannot scroll the Preview and move the window.
async function clickVisibleRow(visual) {
  const index = await visual.evaluate((surface) => {
    const rows = [...surface.querySelectorAll('p')];
    const box = surface.getBoundingClientRect();
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, window.innerHeight);
    let fullyVisible = -1;
    let intersecting = -1;
    rows.forEach((row, position) => {
      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) return;
      if (rect.top >= top - 1 && rect.bottom <= bottom + 1) fullyVisible = position;
      if (rect.top < bottom && rect.bottom > top) intersecting = position;
    });
    return fullyVisible >= 0 ? fullyVisible : intersecting;
  });
  expect(index, 'A mounted windowed row must be visible to receive the caret').toBeGreaterThanOrEqual(0);
  await visual.locator('p').nth(index).click();
}

const safeErrorNames = new Set([
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

function safeCaughtErrorType(error) {
  try {
    if (error instanceof Error) {
      return safeErrorNames.has(error.name) ? error.name : 'Error';
    }
  } catch {}
  return typeof error;
}

function createSafeLoginStageError(failureCode, caughtError) {
  const safeCauseType = safeCaughtErrorType(caughtError);
  const error = new Error(`${failureCode} (${safeCauseType})`);
  error.name = 'WordPressLoginStageError';
  error.code = failureCode;
  error.safeCauseType = safeCauseType;
  return error;
}

function createSafeSetupStageError(caughtError) {
  const safeCauseType = safeCaughtErrorType(caughtError);
  const error = new Error(`dashboard-setup-not-ready (${safeCauseType})`);
  error.name = 'EditorSetupStageError';
  error.code = 'dashboard-setup-not-ready';
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

async function waitForDashboardSetupReadiness(page, monitor) {
  let caughtError = null;
  let drainCompleted = false;
  let historyFlushed = false;
  try {
    await page.waitForLoadState('load', { timeout: 8_000 });
    drainCompleted = await monitor.drain({ timeoutMs: 8_000, quietMs: 300 });
    historyFlushed = await monitor.flushHistory();
  } catch (error) {
    caughtError = error;
  }
  const issues = monitor.snapshot().issues;
  if (caughtError !== null || drainCompleted !== true || historyFlushed !== true || issues.length > 0) {
    throw createSafeSetupStageError(caughtError ?? new Error('dashboard-setup-not-ready'));
  }
}

async function login(page, monitor = null) {
  const adminUser = environment('WORDPRESS_ADMIN_USER');
  const passwordValue = adminPassword();
  let failureCode = 'wordpress-login-page-unavailable';
  try {
    monitor?.expectNavigation('/wp-login.php', 'open-login');
    await monitor?.flushHistory();
    await page.goto('/wp-login.php');
    failureCode = 'wordpress-login-focus-did-not-settle';
    await waitForLoginFocusQuiescence(page);
    failureCode = 'wordpress-login-credential-entry-failed';
    await page.locator('#user_login').fill(adminUser);
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
    await page.keyboard.type(passwordValue);
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
    if (monitor) {
      monitor.expectNavigation(await loginRedirectDestination(page), 'login-submit');
      await monitor.flushHistory();
    }
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

async function openWindowedVisual(page) {
  const monitor = await installVisualBrowserMonitor(page, {
    baseURL: test.info().project.use.baseURL
  });
  monitoredPage = page;
  await installDocumentEndProofReader(page);
  await installKeyProbe(page);
  loginObservation = await installLoginObservation(page, test.info().project.use.baseURL);

  await login(page, monitor);
  await waitForDashboardSetupReadiness(page, monitor);

  monitor.expectNavigation('/wp-admin/post-new.php', 'open-new-post');
  await page.goto('/wp-admin/post-new.php');
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  await expect(sourceEditor).toBeVisible();
  const ownedPost = await captureOwnedPost(page);
  const runtimeBuilds = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname.split('/').at(-1))
    .filter((name) => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
  console.log(JSON.stringify({ phase: 'loaded-editor-build', files: runtimeBuilds }));
  const expectedBuild = process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD;
  if (expectedBuild) expect(runtimeBuilds, 'The browser must load the frozen production build').toEqual([expectedBuild]);

  // Fixture preparation only. Every edit under test is real keyboard/mouse input.
  await sourceEditor.click();
  await page.keyboard.insertText(AUTHORED_SOURCE);
  const source = page.locator('#easymde-source');
  await expectSource(source, AUTHORED_SOURCE);

  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();

  const visual = page.locator(SURFACE_SELECTOR);
  await expect(visual).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 });
  // More than 160 blocks: the surface must really be windowed.
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  return { source, visual, nativePostId: ownedPost.postId };
}

async function expectNoEditorFailure(page) {
  const summary = getVisualBrowserMonitor(page)?.snapshot();
  expect(summary?.counts.consoleErrors,
    'No uncategorized console error may be emitted').toBe(0);
  expect(summary?.counts.pageErrors,
    'No page error may be emitted').toBe(0);
  expect(summary?.counts.unhandledRejections,
    'No unhandled rejection may be emitted').toBe(0);
  expect(await page.locator(`[${FAILURE_ATTRIBUTE}]`).count(),
    'The surface must not carry a visual failure attribute').toBe(0);
}

async function expectSurfaceUsable(state) {
  expect(state).toMatchObject({
    present: true,
    role: 'textbox',
    editable: 'true',
    lock: 'false',
    failure: null,
    focused: true
  });
}

async function expectFinalEditableWindowState(state) {
  await expectSurfaceUsable(state);
  expect(state.phase).toBe('ready');
  expect(state.busy).not.toBe('true');
  expect(state).toMatchObject({ collapsed: true, rangeCount: 1 });
}

// `Control+End` may resolve to the editing-host boundary, or the product may
// migrate that intent to the authenticated terminal row. A settled proof needs
// the unique authored terminal row even when the caret is on the host. Only a
// transient host boundary may coexist with the window spacer; a caret inside a
// spacer, an arbitrary tail row, or source drift is never document-end proof.
function isSemanticDocumentEndCaret(snapshot, {
  expectedSource = AUTHORED_SOURCE,
  authoredTerminalText = AUTHORED_TERMINAL_TEXT,
  mode = 'settled'
} = {}) {
  const proof = snapshot?.documentEnd;
  if (!proof || typeof expectedSource !== 'string'
    || !['settled', 'transient'].includes(mode)
    || !expectedSource.endsWith(authoredTerminalText)
    || proof.present !== true
    || proof.collapsed !== true
    || proof.rangeCount !== 1
    || proof.focused !== true
    || typeof proof.lastChildIsSpacer !== 'boolean'
    || typeof proof.lastNodeIsAuthoredTerminal !== 'boolean'
    || proof.caretInsideSpacer !== false
    || proof.sourceEqualsExpected !== true
    || proof.sourceEndsWithAuthoredTerminal !== true
    || proof.sourceLength !== expectedSource.length) return false;

  if (mode === 'settled') {
    if (proof.lastChildIsSpacer !== false || proof.lastNodeIsAuthoredTerminal !== true) return false;
  } else if (proof.lastChildIsSpacer === false && proof.lastNodeIsAuthoredTerminal !== true) {
    return false;
  }

  if (proof.anchorIsSurface === true) {
    return proof.anchorNodeKind === 'surface'
      && proof.anchorOffset === proof.childCount;
  }
  if (proof.anchorIsSurface !== false
    || proof.lastChildIsSpacer !== false
    || proof.lastNodeIsAuthoredTerminal !== true
    || !['text', 'element'].includes(proof.anchorNodeKind)
    || proof.caretInside !== true
    || proof.anchorBlockTag !== 'P'
    || proof.anchorBlockIsDirectChild !== true
    || proof.anchorBlockIsLastChild !== true
    || proof.anchorBlockEqualsAuthoredTerminal !== true
    || proof.anchorBlockTextLength !== authoredTerminalText.length
    || proof.anchorTextOffset !== authoredTerminalText.length) return false;
  return true;
}

function expectSemanticDocumentEndCaret(snapshot, options = {}) {
  const expectedSource = options.expectedSource ?? AUTHORED_SOURCE;
  const proof = snapshot?.documentEnd;
  expect(proof, 'Control+End must leave a readable semantic caret proof').not.toBeNull();
  expect(proof).toMatchObject({
    present: true,
    collapsed: true,
    rangeCount: 1,
    focused: true,
    sourceEqualsExpected: true,
    sourceEndsWithAuthoredTerminal: true,
    caretInsideSpacer: false
  });
  expect(proof.sourceLength, 'Canonical source must remain the authored fixture').toBe(expectedSource.length);
  expect(isSemanticDocumentEndCaret(snapshot, { ...options, expectedSource }),
    'Control+End must land on the host boundary or the exact authored terminal row').toBe(true);
}

function oracleDocumentEndProof(overrides = {}) {
  return {
    documentEnd: {
      present: true,
      collapsed: true,
      rangeCount: 1,
      focused: true,
      anchorNodeKind: 'element',
      anchorIsSurface: false,
      anchorOffset: 1,
      childCount: 88,
      lastChildIsSpacer: false,
      lastNodeIsAuthoredTerminal: true,
      caretInsideSpacer: false,
      sourceLength: AUTHORED_SOURCE.length,
      sourceEqualsExpected: true,
      sourceEndsWithAuthoredTerminal: true,
      caretInside: true,
      anchorBlockTag: 'P',
      anchorBlockIsDirectChild: true,
      anchorBlockIsLastChild: true,
      anchorBlockTextLength: AUTHORED_TERMINAL_TEXT.length,
      anchorBlockEqualsAuthoredTerminal: true,
      anchorTextOffset: AUTHORED_TERMINAL_TEXT.length,
      ...overrides
    }
  };
}

test.describe('[oracle-contract] windowed document-end caret', () => {
  test('accepts the editing-host child boundary', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'surface',
      anchorIsSurface: true,
      anchorOffset: 88,
      childCount: 88,
      caretInside: true,
      anchorBlockTag: null,
      anchorBlockIsDirectChild: false,
      anchorBlockIsLastChild: false,
      anchorBlockTextLength: null,
      anchorBlockEqualsAuthoredTerminal: null,
      anchorTextOffset: null
    }))).toBe(true);
  });

  test('accepts an authored terminal-row element anchor', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof())).toBe(true);
  });

  test('accepts an authored terminal-row text anchor', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'text',
      anchorOffset: AUTHORED_TERMINAL_TEXT.length
    }))).toBe(true);
  });

  test('rejects a host anchor before the child boundary', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'surface',
      anchorIsSurface: true,
      anchorOffset: 0,
      childCount: 88
    }))).toBe(false);
  });

  test('rejects a mounted nonterminal row at the visible tail', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorBlockEqualsAuthoredTerminal: false
    }))).toBe(false);
  });

  test('rejects a trailing spacer', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      lastChildIsSpacer: true
    }))).toBe(false);
  });

  test('rejects an unknown anchor kind or source mismatch', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'other'
    }))).toBe(false);
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      sourceEqualsExpected: false
    }))).toBe(false);
  });

  test('rejects a settled host without the authored terminal as the last real node', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'surface',
      anchorIsSurface: true,
      anchorOffset: 88,
      childCount: 88,
      lastNodeIsAuthoredTerminal: false
    }))).toBe(false);
  });

  test('accepts a transient host boundary with a trailing spacer', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'surface',
      anchorIsSurface: true,
      anchorOffset: 88,
      childCount: 88,
      lastChildIsSpacer: true,
      lastNodeIsAuthoredTerminal: false
    }), { mode: 'transient' })).toBe(true);
  });

  test('rejects a caret inside a trailing spacer', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'element',
      anchorIsSurface: false,
      anchorOffset: 0,
      lastChildIsSpacer: true,
      lastNodeIsAuthoredTerminal: false,
      caretInsideSpacer: true,
      anchorBlockTag: 'DIV',
      anchorBlockIsDirectChild: true,
      anchorBlockIsLastChild: true,
      anchorBlockTextLength: 0,
      anchorBlockEqualsAuthoredTerminal: false,
      anchorTextOffset: 0
    }), { mode: 'transient' })).toBe(false);
  });

  test('rejects a settled host with a trailing spacer', () => {
    expect(isSemanticDocumentEndCaret(oracleDocumentEndProof({
      anchorNodeKind: 'surface',
      anchorIsSurface: true,
      anchorOffset: 88,
      childCount: 88,
      lastChildIsSpacer: true,
      lastNodeIsAuthoredTerminal: true
    }))).toBe(false);
  });
});

test('windowed document end: Enter after the window settles opens the terminal line and keeps editing', async ({ page }) => {
  test.setTimeout(180_000);
  const { source, visual, nativePostId } = await openWindowedVisual(page);
  const monitor = getVisualBrowserMonitor(page);
  await clickVisibleRow(visual);
  await settleWindow(page);

  const before = await source.inputValue();
  const separator = terminalSeparator(before);
  const enteredExpected = before + separator;

  await page.keyboard.press('Control+End');
  const reached = await settleWindow(page);
  recordDocumentEndObservation('reached', reached);
  expectSemanticDocumentEndCaret(reached, { expectedSource: before, mode: 'settled' });
  // The settled shape: the window has mounted the document-end Block, so this
  // caret is the fixed path's own subject, not a transient.
  expect(reached.lastChildIsSpacer, 'The settled window must have mounted the document-end Block').toBe(false);

  const previewReadOperationId = monitor.beginPreviewReadOperation({
    postId: nativePostId,
    sources: previewReadSources(before, separator)
  });
  await drainKeys(page);
  await page.keyboard.press('Enter');
  await expectSource(source, enteredExpected);
  const entered = await settleWindow(page);
  recordDocumentEndObservation('entered', entered);

  const keys = await drainKeys(page);
  const enterBefore = keys.find((entry) => entry.phase === 'before'
    && entry.type === 'keydown' && entry.key === 'Enter');
  const enterAfter = keys.find((entry) => entry.phase === 'after'
    && entry.type === 'keydown' && entry.key === 'Enter');
  expectSemanticDocumentEndCaret(enterBefore, { expectedSource: before, mode: 'settled' });
  expect(enterAfter, 'The editor must consume Enter instead of native editing').toMatchObject({
    prevented: true
  });

  // The caret now lives in the terminal paragraph the owner mounted: an empty
  // direct child at the reading-order end of the surface.
  await expectSurfaceUsable(entered);
  expect(entered.caret, 'The caret must be inside the new terminal paragraph').toMatchObject({
    inside: true,
    blockTag: 'P',
    blockIsDirectChild: true,
    blockIsLastChild: true,
    blockText: '',
    blockTextLength: 0,
    textOffset: 0
  });

  // The same paragraph admits the next typed characters instead of losing them
  // while the formal Preview that mounts the new terminal row is outstanding.
  await drainKeys(page);
  await page.keyboard.type('abc', { delay: 40 });
  await expectSource(source, enteredExpected + 'abc');
  const typed = await settleWindow(page);
  recordDocumentEndObservation('typed', typed);

  await expectFinalEditableWindowState(typed);
  expect(typed.caret, 'The typed characters must be the terminal paragraph').toMatchObject({
    inside: true,
    blockTag: 'P',
    blockIsDirectChild: true,
    blockIsLastChild: true,
    blockText: 'abc',
    blockTextLength: 3,
    textOffset: 3
  });

  const typedKeys = await drainKeys(page);
  const consumedText = typedKeys.filter((entry) => entry.phase === 'after'
    && entry.type === 'beforeinput' && entry.inputType === 'insertText');
  expect(consumedText.map((entry) => entry.dataLength), 'Each typed character must be consumed once')
    .toEqual([1, 1, 1]);
  expect(consumedText.every((entry) => entry.prevented)).toBe(true);

  await expectNoEditorFailure(page);
  const previewReadProof = monitor.provePreviewReadOperation(previewReadOperationId, {
    finalUiVerified: true
  });
  expect(previewReadProof.approved).toBe(true);
});

test('windowed document end: Enter and typing with no pause keep every character in canonical source', async ({ page }) => {
  test.setTimeout(180_000);
  const { source, visual, nativePostId } = await openWindowedVisual(page);
  const monitor = getVisualBrowserMonitor(page);
  await clickVisibleRow(visual);
  await settleWindow(page);

  const before = await source.inputValue();
  const separator = terminalSeparator(before);
  const enteredExpected = before + separator;
  const previewReadOperationId = monitor.beginPreviewReadOperation({
    postId: nativePostId,
    sources: previewReadSources(before, separator)
  });

  await drainKeys(page);
  // No wait, no read, no settle between these three gestures: the whole point
  // is that the fixed path owns the caret before the window catches up.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('abc');

  await expectSource(source, enteredExpected + 'abc');
  const typed = await settleWindow(page);
  recordDocumentEndObservation('typed', typed);

  const keys = await drainKeys(page);
  const enterBefore = keys.find((entry) => entry.phase === 'before'
    && entry.type === 'keydown' && entry.key === 'Enter');
  const enterAfter = keys.find((entry) => entry.phase === 'after'
    && entry.type === 'keydown' && entry.key === 'Enter');
  // Whether the window had already advanced or not, Enter must address the
  // editing-host boundary or the exact authored terminal row.
  expectSemanticDocumentEndCaret(enterBefore, { expectedSource: before, mode: 'transient' });
  expect(enterAfter, 'The editor must consume Enter instead of native editing').toMatchObject({
    prevented: true
  });

  const consumedText = keys.filter((entry) => entry.phase === 'after'
    && entry.type === 'beforeinput' && entry.inputType === 'insertText');
  expect(consumedText.map((entry) => entry.dataLength), 'Each typed character must be consumed once')
    .toEqual([1, 1, 1]);
  expect(consumedText.every((entry) => entry.prevented)).toBe(true);

  // The typed characters opened their own terminal paragraph; the authored
  // last row keeps its bytes, which the exact source equality above proves.
  await expectFinalEditableWindowState(typed);
  expect(typed.caret, 'The caret must be inside the new terminal paragraph').toMatchObject({
    inside: true,
    blockTag: 'P',
    blockIsDirectChild: true,
    blockIsLastChild: true,
    blockText: 'abc',
    blockTextLength: 3,
    textOffset: 3
  });

  await expectNoEditorFailure(page);
  const previewReadProof = monitor.provePreviewReadOperation(previewReadOperationId, {
    finalUiVerified: true
  });
  expect(previewReadProof.approved).toBe(true);
});

// No browser negative case here, on purpose. The rule it would assert -
// `visual-editor-selection-map-failed` for plain text at a root-end caret while
// the document-end Block is unmounted - is owned by
// WindowedImmersiveVisualEditor.test.tsx ("rejects a root-end input while the
// document-end Block is unmounted"). In the browser that shape exists only
// between `Control+End` and the scroll-driven window advance that mounts the
// caret's own row, so a case here would race the window scheduler; see the
// accompanying report for the measurements.
