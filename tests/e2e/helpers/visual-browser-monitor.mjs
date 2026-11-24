const monitors = new WeakMap();
const historyObservers = new WeakMap();

const REJECTION_BINDING = '__easymdeVisualBrowserMonitorUnhandledRejection';
const REJECTION_BRIDGE = '__easymdeVisualBrowserMonitorRejectionBridge';
const HISTORY_BINDING = '__easymdeHistoryObservation';
const HISTORY_BRIDGE = '__easymdeHistoryObserverBridge';

const PATH_CLASSES = new Set([
  'admin-ajax',
  'easymde-api',
  'invalid',
  'other',
  'plugin-asset',
  'post-new',
  'preview',
  'wordpress-api',
  'wordpress-login',
  'wp-admin'
]);
const RESOURCE_TYPES = new Set([
  'document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack',
  'xhr', 'fetch', 'prefetch', 'eventsource', 'manifest', 'signedexchange',
  'ping', 'cspviolationreport', 'preflight', 'fedcm', 'other'
]);
const DIALOG_TYPES = new Set(['alert', 'confirm', 'prompt', 'beforeunload']);
const HISTORY_STATE_CLASSES = new Set(['null', 'router-only-idx0', 'other']);
const WITHIN_NAVIGATION_TYPES = new Set(['fragment', 'historyApi', 'other']);
const ERROR_NAMES = new Set([
  'AggregateError', 'AssertionError', 'DOMException', 'Error', 'EvalError',
  'RangeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'TypeError',
  'URIError'
]);

function safeAction(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/u.test(value)
    ? value
    : null;
}

function safePathClass(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview') return 'preview';
    if (url.pathname.includes('/easymde/v1/')
      || url.searchParams.get('rest_route')?.startsWith('/easymde/v1/')) return 'easymde-api';
    if (url.pathname.endsWith('/admin-ajax.php')) return 'admin-ajax';
    if (url.pathname.endsWith('/wp-login.php')) return 'wordpress-login';
    if (url.pathname.endsWith('/wp-admin/post-new.php')) return 'post-new';
    if (url.pathname.includes('/wp-content/plugins/')) return 'plugin-asset';
    if (url.pathname.includes('/wp-admin/')) return 'wp-admin';
    if (url.pathname.includes('/wp-json/')) return 'wordpress-api';
    return 'other';
  } catch {
    return 'invalid';
  }
}

function safeResourceType(value) {
  return RESOURCE_TYPES.has(value) ? value : 'other';
}

function safeDialogType(value) {
  return DIALOG_TYPES.has(value) ? value : 'unknown';
}

function safeErrorName(error) {
  try {
    return ERROR_NAMES.has(error?.name) ? error.name : 'Error';
  } catch {
    return 'Error';
  }
}

function safeFailureClass(errorText) {
  const code = typeof errorText === 'string'
    ? errorText.match(/(?:^|::)(ERR_[A-Z0-9_]+)$/u)?.[1]
    : null;
  if (code === 'ERR_ABORTED') return 'aborted';
  if (code?.startsWith('ERR_CONNECTION_')) return 'connection';
  if (code === 'ERR_NAME_NOT_RESOLVED') return 'dns';
  if (code?.includes('TIMED_OUT')) return 'timeout';
  if (code?.startsWith('ERR_CERT_')) return 'tls';
  if (code === 'ERR_FAILED') return 'failed';
  return 'other';
}

function previewReadEndpointClass(rawUrl, origin) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== origin) return 'none';
    const route = url.searchParams.get('rest_route');
    if (route !== null) {
      if (route === '/easymde/v1/preview') return 'preview';
      if (route.startsWith('/easymde/v1/')) return 'api';
      return 'none';
    }
    if (url.pathname.endsWith('/wp-json/easymde/v1/preview')) return 'preview';
    if (url.pathname.includes('/wp-json/easymde/v1/')) return 'api';
    return 'none';
  } catch {
    return 'none';
  }
}

function previewReadRequestBody(request) {
  try {
    const body = typeof request.postDataJSON === 'function'
      ? request.postDataJSON()
      : JSON.parse(request.postData() ?? '');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

const PREVIEW_RENDER_PARAM_KEYS = ['markdown_theme', 'code_theme', 'custom_css_id'];
const PREVIEW_RENDER_PARAM_KEYS_SORTED = [...PREVIEW_RENDER_PARAM_KEYS].sort();
const PREVIEW_REQUEST_BODY_KEYS = ['post_id', 'markdown', ...PREVIEW_RENDER_PARAM_KEYS].sort();

function copyPreviewRenderParams(value) {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== PREVIEW_RENDER_PARAM_KEYS.length
    || keys.some((key, index) => key !== PREVIEW_RENDER_PARAM_KEYS_SORTED[index])
    || PREVIEW_RENDER_PARAM_KEYS.some((key) => typeof value[key] !== 'string')) return null;
  return Object.fromEntries(PREVIEW_RENDER_PARAM_KEYS.map((key) => [key, value[key]]));
}

function copyPreviewPhases(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set();
  const phases = [];
  for (const phase of value) {
    if (!isPlainRecord(phase)
      || Object.keys(phase).length !== 2
      || !Object.hasOwn(phase, 'id')
      || !Object.hasOwn(phase, 'groups')
      || typeof phase.id !== 'string'
      || phase.id.length === 0
      || ids.has(phase.id)
      || !Array.isArray(phase.groups)) return null;
    const groups = [];
    for (const group of phase.groups) {
      if (!Array.isArray(group) || group.some((source) => typeof source !== 'string')) return null;
      groups.push([...group]);
    }
    ids.add(phase.id);
    phases.push({ id: phase.id, groups });
  }
  return phases;
}

export function createPreviewReadOperationLedger({
  origin,
  record,
  deferredAbortCode,
  onApprovedAborts = () => {}
}) {
  if (typeof origin !== 'string'
    || typeof record !== 'function'
    || typeof deferredAbortCode !== 'function'
    || typeof onApprovedAborts !== 'function') {
    throw new Error('preview-read-operation-invalid-monitor');
  }
  const operations = new Map();
  const requestOwners = new Map();
  let active = null;
  let nextOperationId = 1;

  const rejectDeclaration = () => {
    throw new Error('preview-read-operation-invalid-declaration');
  };
  const markInvalid = (operation, code, { recordCode = true } = {}) => {
    operation.invalid = true;
    if (!operation.invalidCode) operation.invalidCode = code;
    if (recordCode && operation.invalidCode === code) record(code);
  };
  const finishWithFailure = (operation, code, { recordCode = true } = {}) => {
    if (operation.proofResult) return { ...operation.proofResult };
    if (recordCode) record(code);
    operation.approved = false;
    operation.closed = true;
    operation.invalid = true;
    operation.proofResult = { approved: false, approvedAbortCount: 0, code };
    return { ...operation.proofResult };
  };
  const ownerFor = (request) => requestOwners.get(request) ?? null;

  return {
    begin({ postId, sources } = {}) {
      if (active && !active.closed) throw new Error('preview-read-operation-active');
      if (!Number.isSafeInteger(postId) || postId <= 0
        || !Array.isArray(sources) || sources.length < 2
        || sources.some((source) => typeof source !== 'string')
        || new Set(sources).size !== sources.length) rejectDeclaration();
      const operation = {
        approved: false,
        closed: false,
        entries: [],
        finalized: false,
        id: nextOperationId,
        invalid: false,
        invalidCode: null,
        mode: 'unique',
        postId,
        proofResult: null,
        sources: [...sources]
      };
      nextOperationId += 1;
      operations.set(operation.id, operation);
      active = operation;
      return operation.id;
    },
    beginPhased({ postId, renderParams, phases } = {}) {
      if (active && !active.closed) throw new Error('preview-read-operation-active');
      const copiedRenderParams = copyPreviewRenderParams(renderParams);
      const copiedPhases = copyPreviewPhases(phases);
      if (!Number.isSafeInteger(postId) || postId <= 0 || !copiedRenderParams || !copiedPhases) {
        rejectDeclaration();
      }
      const operation = {
        approved: false,
        closed: false,
        currentPhaseIndex: 0,
        entries: [],
        finalized: false,
        id: nextOperationId,
        invalid: false,
        invalidCode: null,
        mode: 'phased',
        phaseCandidates: copiedPhases.map(() => null),
        phases: copiedPhases,
        postId,
        proofResult: null,
        renderParams: copiedRenderParams
      };
      nextOperationId += 1;
      operations.set(operation.id, operation);
      active = operation;
      return operation.id;
    },
    enterPhase(operationId, phaseId) {
      const operation = operations.get(operationId);
      const invalidTransition = () => {
        if (operation) markInvalid(operation, 'preview-read-operation-phase-transition-invalid');
        throw new Error('preview-read-operation-phase-transition-invalid');
      };
      if (!operation
        || operation !== active
        || operation.mode !== 'phased'
        || operation.closed
        || operation.finalized
        || typeof phaseId !== 'string') return invalidTransition();
      const nextPhaseIndex = operation.currentPhaseIndex + 1;
      if (nextPhaseIndex >= operation.phases.length
        || operation.phases[nextPhaseIndex].id !== phaseId) return invalidTransition();
      operation.currentPhaseIndex = nextPhaseIndex;
      operation.phaseCandidates[nextPhaseIndex] = null;
      return true;
    },
    observeRequest(request) {
      const operation = active;
      if (!operation || operation.closed) return;
      const endpointClass = previewReadEndpointClass(request.url(), origin);
      if (endpointClass === 'none') return;
      if (endpointClass !== 'preview' || request.method() !== 'POST') {
        markInvalid(operation, 'preview-read-operation-unexpected-endpoint');
        return;
      }
      const body = previewReadRequestBody(request);
      if (operation.mode === 'phased') {
        if (!body) {
          markInvalid(operation, 'preview-read-operation-request-fields-invalid');
          return;
        }
        const bodyKeys = Object.keys(body).sort();
        if (bodyKeys.length !== PREVIEW_REQUEST_BODY_KEYS.length
          || bodyKeys.some((key, index) => key !== PREVIEW_REQUEST_BODY_KEYS[index])) {
          markInvalid(operation, 'preview-read-operation-request-fields-invalid');
          return;
        }
        if (body.post_id !== operation.postId) {
          markInvalid(operation, 'preview-read-operation-other-post');
          return;
        }
        if (PREVIEW_RENDER_PARAM_KEYS.some(
          (key) => body[key] !== operation.renderParams[key]
        )) {
          markInvalid(operation, 'preview-read-operation-request-params-invalid');
          return;
        }
        const phase = operation.phases[operation.currentPhaseIndex];
        const matchingGroups = [];
        for (const [groupIndex, group] of phase.groups.entries()) {
          if (group.includes(body.markdown)) matchingGroups.push(groupIndex);
        }
        if (matchingGroups.length === 0) {
          markInvalid(operation, 'preview-read-operation-other-source');
          return;
        }
        if (requestOwners.has(request)) {
          markInvalid(operation, 'preview-read-operation-duplicate-stage');
          return;
        }
        const previousCandidates = operation.phaseCandidates[operation.currentPhaseIndex];
        const groupCandidates = matchingGroups.filter((groupIndex) => previousCandidates === null
          || previousCandidates.some((candidate) => groupIndex >= candidate));
        if (groupCandidates.length === 0) {
          markInvalid(operation, 'preview-read-operation-group-order-invalid');
        }
        operation.phaseCandidates[operation.currentPhaseIndex] = groupCandidates;
        const entry = {
          aborted: false,
          abortFailureSettled: false,
          deferredAbort: false,
          failed: false,
          finished: false,
          groupCandidates,
          phaseIndex: operation.currentPhaseIndex,
          request,
          responseStatus: null,
          stageIndex: null
        };
        operation.entries.push(entry);
        requestOwners.set(request, { entry, operation });
        return;
      }
      if (!body || body.post_id !== operation.postId) {
        markInvalid(operation, 'preview-read-operation-other-post');
        return;
      }
      const stageIndex = operation.sources.indexOf(body.markdown);
      if (stageIndex < 0) {
        markInvalid(operation, 'preview-read-operation-other-source');
        return;
      }
      if (requestOwners.has(request)
        || operation.entries.some((entry) => entry.stageIndex === stageIndex)) {
        markInvalid(operation, 'preview-read-operation-duplicate-stage');
      }
      const previous = operation.entries[operation.entries.length - 1];
      if (previous && stageIndex <= previous.stageIndex) {
        markInvalid(operation, 'preview-read-operation-order-invalid');
      }
      const entry = {
        aborted: false,
        abortFailureSettled: false,
        deferredAbort: false,
        failed: false,
        finished: false,
        request,
        responseStatus: null,
        stageIndex
      };
      operation.entries.push(entry);
      requestOwners.set(request, { entry, operation });
    },
    observeResponse(request, status) {
      const owner = ownerFor(request);
      if (!owner) return;
      owner.entry.responseStatus = Number.isInteger(status) ? status : null;
      if (owner.entry.responseStatus >= 400) {
        markInvalid(owner.operation, 'preview-read-operation-http-failed', { recordCode: false });
      }
    },
    observeFinished(request) {
      const owner = ownerFor(request);
      if (owner) owner.entry.finished = true;
    },
    observeFailure(request) {
      const owner = ownerFor(request);
      if (!owner) return false;
      const failureClass = safeFailureClass(request.failure()?.errorText);
      if (failureClass === 'aborted') {
        owner.entry.aborted = true;
        owner.entry.deferredAbort = !owner.operation.invalid;
      }
      else {
        owner.entry.failed = true;
        markInvalid(owner.operation, 'preview-read-operation-invalid', { recordCode: false });
      }
      return owner.entry.deferredAbort;
    },
    prove(operationId, { finalUiVerified } = {}) {
      const operation = operations.get(operationId);
      if (!operation) {
        record('preview-read-operation-invalid-proof');
        return { approved: false, approvedAbortCount: 0, code: 'preview-read-operation-invalid-proof' };
      }
      if (operation.proofResult) return { ...operation.proofResult };
      if (finalUiVerified !== true) return finishWithFailure(operation, 'preview-read-operation-final-ui-unverified');
      if (operation.invalid) return finishWithFailure(
        operation,
        operation.invalidCode ?? 'preview-read-operation-invalid',
        { recordCode: false }
      );
      if (operation.mode === 'phased'
        && operation.currentPhaseIndex !== operation.phases.length - 1) {
        return finishWithFailure(operation, 'preview-read-operation-phases-incomplete');
      }
      const entries = operation.entries;
      if (entries.some((entry) => entry.failed || entry.responseStatus >= 400)) {
        return finishWithFailure(operation, 'preview-read-operation-invalid', { recordCode: false });
      }
      if (entries.some((entry) => !entry.aborted
        && (!entry.finished || !(entry.responseStatus >= 200 && entry.responseStatus < 300)))) {
        return finishWithFailure(operation, 'preview-read-operation-successor-unverified');
      }
      for (const [index, entry] of entries.entries()) {
        if (!entry.aborted) continue;
        const laterEntries = entries.slice(index + 1);
        if (laterEntries.length === 0) {
          return finishWithFailure(operation, 'preview-read-operation-successor-missing');
        }
        const hasLaterSuccess = laterEntries.some((later) => (operation.mode === 'phased'
          || later.stageIndex > entry.stageIndex)
          && !later.aborted && !later.failed && later.finished
          && later.responseStatus >= 200 && later.responseStatus < 300);
        if (!hasLaterSuccess) {
          return finishWithFailure(operation, 'preview-read-operation-successor-unverified');
        }
      }
      const approvedAbortCount = entries.filter((entry) => entry.aborted).length;
      operation.approved = true;
      operation.closed = true;
      operation.proofResult = {
        approved: true,
        approvedAbortCount,
        code: 'preview-read-operation-approved'
      };
      if (approvedAbortCount > 0) onApprovedAborts(approvedAbortCount);
      return { ...operation.proofResult };
    },
    finalize() {
      for (const operation of operations.values()) {
        if (operation.finalized) continue;
        if (!operation.approved) {
          for (const entry of operation.entries) {
            if (!entry.deferredAbort || entry.abortFailureSettled) continue;
            record(deferredAbortCode(entry.request));
            entry.abortFailureSettled = true;
          }
          if (!operation.closed) {
            record('preview-read-operation-unproven');
            operation.closed = true;
            operation.proofResult = {
              approved: false,
              approvedAbortCount: 0,
              code: 'preview-read-operation-unproven'
            };
          }
        }
        operation.finalized = true;
        if (active === operation) active = null;
      }
    }
  };
}

function historyStateClass(value) {
  if (value === null) return 'null';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === 'idx' && value.idx === 0) return 'router-only-idx0';
    } catch {}
  }
  return 'other';
}

export async function installHistoryObserver(page, {
  onDocumentNavigation = () => {},
  recordIssue = () => {}
} = {}) {
  const existing = historyObservers.get(page);
  if (existing) return existing;
  const counts = {
    documents: 0,
    replaceState: 0,
    pushState: 0,
    methodThrows: 0,
    replaceStateSameUrlStableLength: 0,
    canonicalNullToNull: 0,
    routerInitNullToIdx0: 0,
    withinHistoryApi: 0,
    withinOther: 0,
    pairedObservations: 0
  };
  const issues = [];
  const documentsByToken = new Map();
  const documentsByLoader = new Map();
  const documentTokensSeen = new Set();
  const pendingDocumentTokens = [];
  const seenFullDocumentUrls = new Set();
  const eventWaiters = new Set();
  let activeDocument = null;
  let documentOrdinal = 0;
  let stopped = false;
  let detached = false;
  let cdp = null;
  let mainFrameId = null;

  const record = (code) => {
    if (issues.length < 128 && !issues.includes(code)) issues.push(code);
    recordIssue(code);
  };
  const signal = () => {
    const waiters = [...eventWaiters];
    eventWaiters.clear();
    for (const wake of waiters) wake();
  };
  const allDocuments = () => new Set([...documentsByLoader.values(), ...documentsByToken.values()]);
  const pairDocument = (documentState) => {
    if (!documentState) return;
    while (true) {
      const observation = documentState.observations.find((entry) => !entry.paired && entry.success);
      const within = documentState.within.find((entry) => !entry.paired && entry.navigationType === 'historyApi');
      if (!observation || !within) return;
      observation.paired = true;
      within.paired = true;
      counts.pairedObservations += 1;
    }
  };
  const attachDocumentToken = (token) => {
    if (documentTokensSeen.has(token) || documentsByToken.has(token)) {
      record('history-document-token-duplicate');
      return;
    }
    documentTokensSeen.add(token);
    if (!activeDocument) {
      if (pendingDocumentTokens.length > 0) record('history-document-token-ambiguous');
      pendingDocumentTokens.push(token);
      signal();
      return;
    }
    if (activeDocument.token === null) {
      activeDocument.token = token;
      documentsByToken.set(token, activeDocument);
      signal();
      return;
    }
    // A different token arriving while a document is active can be the next
    // document's init script racing its frame notification. Keep it queued but
    // never attach it to the old document.
    if (pendingDocumentTokens.length > 0) record('history-document-token-ambiguous');
    pendingDocumentTokens.push(token);
    signal();
  };
  const onFrameNavigated = (event) => {
    if (stopped || event.frame.id !== mainFrameId) return;
    const url = event.frame.url + (event.frame.urlFragment ?? '');
    const seenBefore = seenFullDocumentUrls.has(url);
    let approved = false;
    try {
      approved = onDocumentNavigation(url) === true;
    } catch {
      record('history-document-navigation-handler-failed');
    }
    if (seenBefore && !approved) record('history-duplicate-document-navigation');
    seenFullDocumentUrls.add(url);
    if (activeDocument) activeDocument.closed = true;
    const documentState = {
      closed: false,
      loaderId: event.frame.loaderId,
      observations: [],
      ordinal: ++documentOrdinal,
      seenSequences: new Set(),
      token: null,
      within: []
    };
    counts.documents += 1;
    activeDocument = documentState;
    if (documentsByLoader.has(event.frame.loaderId)) record('history-document-loader-duplicate');
    documentsByLoader.set(event.frame.loaderId, documentState);
    if (pendingDocumentTokens.length === 1) {
      const token = pendingDocumentTokens.shift();
      documentState.token = token;
      documentsByToken.set(token, documentState);
    } else if (pendingDocumentTokens.length > 1) {
      record('history-document-token-ambiguous');
      pendingDocumentTokens.length = 0;
    }
    signal();
  };
  const onNavigatedWithinDocument = (event) => {
    if (stopped || event.frameId !== mainFrameId) return;
    if (!activeDocument || activeDocument.closed) {
      record('history-within-document-unassociated');
      return;
    }
    const within = {
      navigationType: event.navigationType,
      paired: false,
      sequence: activeDocument.within.length + 1
    };
    activeDocument.within.push(within);
    if (event.navigationType === 'historyApi') counts.withinHistoryApi += 1;
    else {
      const navigationType = WITHIN_NAVIGATION_TYPES.has(event.navigationType)
        ? event.navigationType
        : 'other';
      counts.withinOther += 1;
      record(`history-within-navigation-unexpected:${navigationType}`);
    }
    pairDocument(activeDocument);
    signal();
  };

  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    const frameTree = await cdp.send('Page.getFrameTree');
    mainFrameId = frameTree.frameTree.frame.id;
  } catch {
    await cdp?.detach().catch(() => {});
    throw new Error('history-observer-cdp-unavailable');
  }
  cdp.on('Page.frameNavigated', onFrameNavigated);
  cdp.on('Page.navigatedWithinDocument', onNavigatedWithinDocument);

  try {
    await page.exposeFunction(HISTORY_BINDING, (payload) => {
      if (!payload || typeof payload !== 'object') {
        record('history-observation-invalid');
        throw new Error('history-observation-invalid');
      }
      if (payload.kind === 'document') {
        if (typeof payload.token !== 'string' || payload.token.length === 0 || payload.token.length > 160) {
          record('history-observation-invalid');
          throw new Error('history-observation-invalid');
        }
        attachDocumentToken(payload.token);
        return true;
      }
      if (payload.kind !== 'history'
        || typeof payload.token !== 'string'
        || !Number.isInteger(payload.sequence)
        || payload.sequence < 1
        || !['replaceState', 'pushState'].includes(payload.method)
        || typeof payload.success !== 'boolean'
        || typeof payload.threw !== 'boolean'
        || typeof payload.sameUrl !== 'boolean'
        || !Number.isInteger(payload.beforeLength)
        || !Number.isInteger(payload.afterLength)
        || !HISTORY_STATE_CLASSES.has(payload.beforeState)
        || !HISTORY_STATE_CLASSES.has(payload.afterState)) {
        record('history-observation-invalid');
        throw new Error('history-observation-invalid');
      }
      const documentState = documentsByToken.get(payload.token);
      if (!documentState) {
        record('history-observation-document-unavailable');
        throw new Error('history-observation-document-unavailable');
      }
      if (documentState.closed) {
        record('history-observation-document-lost');
        throw new Error('history-observation-document-lost');
      }
      if (documentState.seenSequences.has(payload.sequence)) {
        record('history-observation-duplicate');
        throw new Error('history-observation-duplicate');
      }
      documentState.seenSequences.add(payload.sequence);
      if (payload.method === 'replaceState') counts.replaceState += 1;
      else counts.pushState += 1;
      if (!payload.success) {
        counts.methodThrows += 1;
        record(`history-method-threw:${payload.method}`);
        signal();
        return true;
      }
      if (payload.sameUrl && payload.beforeLength === payload.afterLength && payload.method === 'replaceState') {
        counts.replaceStateSameUrlStableLength += 1;
      }
      if (payload.method === 'pushState') record('history-push-state');
      if (!payload.sameUrl) record('history-url-changed');
      if (payload.beforeLength !== payload.afterLength) record('history-length-changed');
      const canonical = payload.beforeState === 'null' && payload.afterState === 'null';
      const routerInit = payload.beforeState === 'null' && payload.afterState === 'router-only-idx0';
      if (payload.method === 'replaceState' && payload.sameUrl
        && payload.beforeLength === payload.afterLength && canonical) counts.canonicalNullToNull += 1;
      if (payload.method === 'replaceState' && payload.sameUrl
        && payload.beforeLength === payload.afterLength && routerInit) counts.routerInitNullToIdx0 += 1;
      if (!(payload.method === 'replaceState' && payload.sameUrl
        && payload.beforeLength === payload.afterLength && (canonical || routerInit))) {
        record('history-observation-unapproved');
      }
      documentState.observations.push({
        paired: false,
        sequence: payload.sequence,
        success: true
      });
      pairDocument(documentState);
      signal();
      return true;
    });
    await page.addInitScript(({ binding, bridge }) => {
      let top = false;
      try { top = window.top === window; } catch { top = false; }
      if (!top) return;
      const documentToken = [
        Date.now().toString(36),
        Math.floor(performance.timeOrigin).toString(36),
        Math.random().toString(36).slice(2, 12)
      ].join('-');
      const pending = new Map();
      let sequence = 0;
      let confirmed = 0;
      let failed = 0;
      let historySent = 0;
      let historySuccessSent = 0;
      let accepting = true;
      const stateClass = (value) => {
        if (value === null) return 'null';
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          try {
            const keys = Object.keys(value);
            if (keys.length === 1 && keys[0] === 'idx' && value.idx === 0) return 'router-only-idx0';
          } catch {}
        }
        return 'other';
      };
      const send = (payload) => {
        if (!accepting) return;
        const id = ++sequence;
        if (payload.kind === 'history') {
          historySent += 1;
          if (payload.success) historySuccessSent += 1;
        }
        let operation;
        try {
          const notify = window[binding];
          if (typeof notify !== 'function') {
            failed += 1;
            return;
          }
          operation = Promise.resolve(notify({ ...payload, sequence: id, token: documentToken }));
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
        let boundary = sequence;
        do {
          await Promise.allSettled([...pending.values()]);
          if (boundary === sequence && pending.size === 0) break;
          boundary = sequence;
        } while (accepting);
        return { confirmed, failed, historySent, historySuccessSent, pending: pending.size };
      };
      window[bridge] = {
        get confirmed() { return confirmed; },
        get failed() { return failed; },
        get historySent() { return historySent; },
        get historySuccessSent() { return historySuccessSent; },
        get pending() { return pending.size; },
        async flush() { return flush(); },
        async stop() {
          accepting = false;
          await flush();
          return { confirmed, failed, historySent, historySuccessSent, pending: pending.size };
        }
      };
      for (const method of ['replaceState', 'pushState']) {
        const original = history[method];
        history[method] = function observedHistoryMethod(...args) {
          const beforeLength = history.length;
          const beforeUrl = location.href;
          const beforeState = stateClass(history.state);
          let result;
          try {
            result = Reflect.apply(original, this, args);
          } catch (error) {
            send({
              kind: 'history',
              method,
              success: false,
              threw: true,
              sameUrl: false,
              beforeLength,
              afterLength: history.length,
              beforeState,
              afterState: stateClass(history.state)
            });
            throw error;
          }
          send({
            kind: 'history',
            method,
            success: true,
            threw: false,
            sameUrl: beforeUrl === location.href,
            beforeLength,
            afterLength: history.length,
            beforeState,
            afterState: stateClass(history.state)
          });
          return result;
        };
      }
      send({ kind: 'document' });
    }, { binding: HISTORY_BINDING, bridge: HISTORY_BRIDGE });
  } catch {
    cdp.off('Page.frameNavigated', onFrameNavigated);
    cdp.off('Page.navigatedWithinDocument', onNavigatedWithinDocument);
    await cdp.detach().catch(() => {});
    throw new Error('history-observer-install-failed');
  }

  const documentSettlementPending = () => {
    if (pendingDocumentTokens.length > 0) return true;
    for (const documentState of allDocuments()) {
      pairDocument(documentState);
      if (!documentState.token) return true;
      if (documentState.observations.some((entry) => !entry.paired)) return true;
      if (documentState.within.some((entry) => !entry.paired && entry.navigationType === 'historyApi')) return true;
    }
    return false;
  };
  const waitForSettlement = async (timeoutMs = 2_000) => {
    if (!documentSettlementPending()) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        record('history-observation-barrier-page-closed');
        return false;
      }
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          eventWaiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(100, Math.max(1, deadline - Date.now())));
        eventWaiters.add(finish);
      });
      if (!documentSettlementPending()) return true;
    }
    record('history-observation-barrier-timeout');
    return false;
  };
  const finalizeDocuments = () => {
    let clean = true;
    if (pendingDocumentTokens.length > 0) {
      record('history-document-token-pending');
      clean = false;
      pendingDocumentTokens.length = 0;
    }
    for (const documentState of allDocuments()) {
      pairDocument(documentState);
      if (!documentState.token) {
        record('history-document-token-missing');
        clean = false;
      }
      if (documentState.observations.some((entry) => !entry.paired && entry.success)) {
        record('history-observation-unpaired');
        clean = false;
      }
      if (documentState.within.some((entry) => !entry.paired && entry.navigationType === 'historyApi')) {
        record('history-within-event-unpaired');
        clean = false;
      }
    }
    return clean;
  };
  const inspect = async (method) => {
    if (page.isClosed()) {
      record('history-observation-barrier-page-closed');
      return false;
    }
    if (!activeDocument && pendingDocumentTokens.length === 0) return true;
    let timeoutTimer;
    try {
      const timeout = new Promise((resolve) => { timeoutTimer = setTimeout(resolve, 2_000); });
      const result = await Promise.race([
        page.mainFrame().evaluate(({ bridge, operation }) => {
          const observer = window[bridge];
          return observer && typeof observer[operation] === 'function'
            ? observer[operation]()
            : null;
        }, { bridge: HISTORY_BRIDGE, operation: method }).catch(() => null),
        timeout
      ]);
      if (!result) {
        record('history-observation-barrier-unavailable');
        return false;
      }
      if (!Number.isInteger(result.historySent)
        || !Number.isInteger(result.historySuccessSent)
        || !Number.isInteger(result.confirmed)
        || !Number.isInteger(result.failed)
        || !Number.isInteger(result.pending)) {
        record('history-observation-barrier-invalid');
        return false;
      }
      if (result.failed > 0) record('history-observation-transport-failed');
      if (result.pending > 0) record('history-observation-barrier-pending');
      if (activeDocument && result.historySent > activeDocument.seenSequences.size) {
        record('history-observation-lost');
      }
      const settled = await waitForSettlement();
      return settled
        && result.failed === 0
        && result.pending === 0
        && !(activeDocument && result.historySent > activeDocument.seenSequences.size);
    } catch {
      record('history-observation-barrier-unavailable');
      return false;
    } finally {
      clearTimeout(timeoutTimer);
    }
  };
  const detachCdp = async () => {
    if (detached) return true;
    detached = true;
    cdp.off('Page.frameNavigated', onFrameNavigated);
    cdp.off('Page.navigatedWithinDocument', onNavigatedWithinDocument);
    try {
      await cdp.detach();
      return true;
    } catch {
      record('history-observer-detach-failed');
      return false;
    }
  };
  const observer = {
    async flush() { return inspect('flush'); },
    async stop() {
      if (stopped) return false;
      const barrierClean = await inspect('stop');
      stopped = true;
      const finalizeClean = finalizeDocuments();
      const detachClean = await detachCdp();
      return barrierClean && finalizeClean && detachClean && issues.length === 0;
    },
    async detach() {
      stopped = true;
      return detachCdp();
    },
    snapshot() {
      return { counts: { ...counts }, issues: [...issues] };
    }
  };
  historyObservers.set(page, observer);
  return observer;
}

export function getHistoryObserver(page) {
  return historyObservers.get(page);
}

function monitorError(summaryIssues) {
  return `visual-browser-monitor-unapproved:${summaryIssues.join(',')}`;
}

export function getVisualBrowserMonitor(page) {
  return monitors.get(page);
}

export async function installVisualBrowserMonitor(page, { baseURL } = {}) {
  const existing = monitors.get(page);
  if (existing) return existing;

  const state = {
    counts: {
      consoleWarnings: 0,
      consoleErrors: 0,
      pageErrors: 0,
      unhandledRejections: 0,
      dialogs: 0,
      popups: 0,
      navigations: 0,
      requestFailures: 0,
      httpErrors: 0
    },
    approved: {
      navigations: 0,
      dialogs: 0,
      popups: 0,
      requestCancellations: 0
    },
    issues: [],
    sealed: false,
    rejectionIngressClosed: false,
    detached: false
  };
  const navigationExpectations = [];
  const dialogExpectations = [];
  const popupExpectations = [];
  const cancellationExpectations = [];
  const cancellationByRequest = new WeakMap();
  const pendingHandlers = new Set();
  const inFlightRequests = new Set();
  let historyObserver = null;
  let eventOrdinal = 0;
  let sessionOrigin = null;
  try {
    if (typeof baseURL !== 'string' || baseURL.length === 0) throw new Error();
    const configuredBase = new URL(baseURL);
    if (configuredBase.protocol !== 'http:' && configuredBase.protocol !== 'https:') throw new Error();
    sessionOrigin = configuredBase.origin;
  } catch {
    throw new Error('visual-browser-monitor-invalid-base-url');
  }

  const noteEvent = () => { eventOrdinal += 1; };
  const record = (code) => {
    if (state.issues.length < 128 && !state.issues.includes(code)) state.issues.push(code);
  };
  const previewReadLedger = createPreviewReadOperationLedger({
    origin: sessionOrigin,
    record,
    deferredAbortCode: (request) => `request-failed:aborted:${safePathClass(request.url())}:${safeResourceType(request.resourceType())}`,
    onApprovedAborts: (count) => { state.approved.requestCancellations += count; }
  });
  const track = (promise) => {
    const tracked = Promise.resolve(promise);
    pendingHandlers.add(tracked);
    void tracked.then(
      () => pendingHandlers.delete(tracked),
      () => pendingHandlers.delete(tracked)
    );
    return tracked;
  };
  const onRequest = (request) => {
    noteEvent();
    inFlightRequests.add(request);
    previewReadLedger.observeRequest(request);
  };
  const onRequestFinished = (request) => {
    noteEvent();
    inFlightRequests.delete(request);
    previewReadLedger.observeFinished(request);
  };
  const onRequestFailed = (request) => {
    noteEvent();
    inFlightRequests.delete(request);
    state.counts.requestFailures += 1;
    const expected = cancellationByRequest.get(request);
    const failureClass = safeFailureClass(request.failure()?.errorText);
    if (expected && failureClass === 'aborted') {
      expected.claimed = true;
      state.approved.requestCancellations += 1;
      return;
    }
    if (previewReadLedger.observeFailure(request)) return;
    record(`request-failed:${failureClass}:${safePathClass(request.url())}:${safeResourceType(request.resourceType())}`);
  };
  const onResponse = (response) => {
    noteEvent();
    previewReadLedger.observeResponse(response.request(), response.status());
    if (response.status() < 400) return;
    state.counts.httpErrors += 1;
    record(`http-${response.status()}:${safePathClass(response.url())}:${safeResourceType(response.request().resourceType())}`);
  };
  const onConsole = (message) => {
    noteEvent();
    if (message.type() === 'warning') {
      state.counts.consoleWarnings += 1;
      record('console-warning');
    } else if (message.type() === 'error') {
      state.counts.consoleErrors += 1;
      record('console-error');
    }
  };
  const onPageError = (error) => {
    noteEvent();
    state.counts.pageErrors += 1;
    record(`page-error:${safeErrorName(error)}`);
  };
  const onDialog = (dialog) => {
    noteEvent();
    state.counts.dialogs += 1;
    const type = safeDialogType(dialog.type());
    const expected = dialogExpectations.find(
      (entry) => !entry.claimed && entry.type === type
    );
    const action = expected?.action ?? 'dismiss';
    if (expected) expected.claimed = true;
    else record(`dialog-unexpected:${type}`);
    const operation = action === 'accept' ? dialog.accept() : dialog.dismiss();
    track(operation.then(
      () => {
        if (expected) state.approved.dialogs += 1;
      },
      () => record(`dialog-action-failed:${type}`)
    ));
  };
  const onPopup = (popup) => {
    noteEvent();
    state.counts.popups += 1;
    const pathClass = safePathClass(popup.url());
    const expected = popupExpectations.find(
      (entry) => !entry.claimed && entry.pathClass === pathClass && entry.action === 'close'
    );
    if (expected) expected.claimed = true;
    else record(`popup-unexpected:${pathClass}`);
    track(popup.close().then(
      () => {
        if (expected) state.approved.popups += 1;
      },
      () => record(`popup-close-failed:${pathClass}`)
    ));
  };
  const normalizeNavigationDestination = (destination) => {
    if (typeof destination !== 'string' || destination.length === 0) {
      throw new Error('visual-browser-monitor-invalid-navigation-destination');
    }
    let parsed;
    let origin = null;
    let absolute = true;
    try {
      parsed = new URL(destination);
    } catch {
      absolute = false;
      const syntheticBase = new URL('http://monitor.invalid/');
      let currentBase = null;
      try {
        const current = new URL(page.url());
        if (current.protocol === 'http:' || current.protocol === 'https:') currentBase = current;
      } catch {
        currentBase = null;
      }
      const configuredBase = sessionOrigin ? new URL(sessionOrigin) : null;
      const base = currentBase ?? configuredBase ?? syntheticBase;
      try {
        parsed = new URL(destination, base);
      } catch {
        throw new Error('visual-browser-monitor-invalid-navigation-destination');
      }
      origin = currentBase?.origin ?? configuredBase?.origin ?? null;
      if (origin !== null && parsed.origin !== origin) {
        throw new Error('visual-browser-monitor-invalid-navigation-destination');
      }
      if (origin === null && parsed.origin !== syntheticBase.origin) {
        throw new Error('visual-browser-monitor-invalid-navigation-destination');
      }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('visual-browser-monitor-invalid-navigation-destination');
    }
    if (absolute) {
      origin = parsed.origin;
      if (sessionOrigin !== null && origin !== sessionOrigin) {
        throw new Error('visual-browser-monitor-invalid-navigation-destination');
      }
    }
    return {
      hash: parsed.hash,
      origin,
      pathClass: safePathClass(parsed.href),
      pathname: parsed.pathname,
      search: parsed.search
    };
  };
  const handleDocumentNavigation = (url) => {
    noteEvent();
    state.counts.navigations += 1;
    let observed;
    try {
      observed = new URL(url);
    } catch {
      record('main-frame-navigation:invalid');
      return false;
    }
    if (observed.protocol !== 'http:' && observed.protocol !== 'https:') {
      record('main-frame-navigation:invalid');
      return false;
    }
    if (sessionOrigin === null) sessionOrigin = observed.origin;
    const pathClass = safePathClass(observed.href);
    if (observed.origin !== sessionOrigin) {
      record(`main-frame-navigation:cross-origin:${pathClass}`);
      return false;
    }
    const expected = navigationExpectations.find(
      (entry) => !entry.claimed
        && (entry.origin === null || entry.origin === observed.origin)
        && entry.pathname === observed.pathname
        && entry.search === observed.search
        && entry.hash === observed.hash
    );
    if (expected) {
      expected.claimed = true;
      state.approved.navigations += 1;
      return true;
    }
    record(`main-frame-navigation:${pathClass}`);
    return false;
  };

  page.on('request', onRequest);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('dialog', onDialog);
  page.on('popup', onPopup);

  try {
    historyObserver = await installHistoryObserver(page, {
      onDocumentNavigation: handleDocumentNavigation,
      recordIssue: record
    });
    await page.exposeFunction(REJECTION_BINDING, (kind) => {
      if (state.detached || kind !== 'unhandled') return;
      noteEvent();
      state.counts.unhandledRejections += 1;
      record('unhandled-rejection');
    });
    await page.addInitScript(({ binding, bridge }) => {
      const pendingNotifications = new Set();
      let failureCount = 0;
      let shutdownPromise = null;
      const observer = {
        enabled: true,
        mark() {
          if (!observer.enabled) return;
          const notify = window[binding];
          if (typeof notify !== 'function') {
            failureCount += 1;
            return;
          }
          let result;
          try {
            result = notify('unhandled');
          } catch {
            failureCount += 1;
            return;
          }
          const pending = Promise.resolve(result);
          pendingNotifications.add(pending);
          void pending.then(
            () => pendingNotifications.delete(pending),
            () => {
              failureCount += 1;
              pendingNotifications.delete(pending);
            }
          );
        },
        detach() {
          observer.enabled = false;
          window.removeEventListener('unhandledrejection', observer.mark);
        },
        shutdown() {
          if (shutdownPromise) return shutdownPromise;
          observer.detach();
          shutdownPromise = (async () => {
            await Promise.allSettled([...pendingNotifications]);
            return {
              available: true,
              failureCount,
              pendingCount: pendingNotifications.size
            };
          })();
          return shutdownPromise;
        }
      };
      Object.defineProperty(window, bridge, {
        configurable: true,
        value: observer
      });
      window.addEventListener('unhandledrejection', observer.mark);
    }, { binding: REJECTION_BINDING, bridge: REJECTION_BRIDGE });
  } catch {
    page.off('request', onRequest);
    page.off('requestfinished', onRequestFinished);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
    await historyObserver?.detach?.();
    throw new Error('visual-browser-monitor-install-failed');
  }

  Object.assign(state, {
    snapshot() {
      return {
        counts: { ...state.counts },
        approved: { ...state.approved },
        issues: [...state.issues],
        history: historyObserver?.snapshot() ?? null
      };
    },
    expectNavigation(destination, action) {
      const safe = safeAction(action);
      if (!safe) throw new Error('visual-browser-monitor-invalid-navigation-action');
      const normalized = normalizeNavigationDestination(destination);
      navigationExpectations.push({ ...normalized, action: safe, claimed: false });
    },
    async flushHistory() {
      return historyObserver?.flush() ?? false;
    },
    async stopHistory() {
      return historyObserver?.stop() ?? false;
    },
    expectDialog(type, action = 'dismiss') {
      if (!DIALOG_TYPES.has(type) || !['accept', 'dismiss'].includes(action)) {
        throw new Error('visual-browser-monitor-invalid-dialog-expectation');
      }
      dialogExpectations.push({ type, action, claimed: false });
    },
    expectPopup(pathClass = 'other', action = 'close') {
      if (!PATH_CLASSES.has(pathClass) || action !== 'close') {
        throw new Error('visual-browser-monitor-invalid-popup-expectation');
      }
      popupExpectations.push({ pathClass, action, claimed: false });
    },
    expectRequestCancellation(request, action) {
      const safe = safeAction(action);
      if (!safe || typeof request?.url !== 'function' || typeof request?.failure !== 'function') {
        throw new Error('visual-browser-monitor-invalid-request-cancellation-expectation');
      }
      const expectation = { request, action: safe, claimed: false };
      cancellationExpectations.push(expectation);
      cancellationByRequest.set(request, expectation);
    },
    beginPreviewReadOperation(declaration) {
      return previewReadLedger.begin(declaration);
    },
    provePreviewReadOperation(operationId, evidence) {
      return previewReadLedger.prove(operationId, evidence);
    },
    async drain({ timeoutMs = 8_000, quietMs = 250 } = {}) {
      if (page.isClosed()) {
        record('monitor-drain-page-closed');
        return false;
      }
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
      record('monitor-drain-timeout');
      return false;
    },
    finalize() {
      if (state.sealed) return;
      state.sealed = true;
      previewReadLedger.finalize();
      for (const expected of navigationExpectations) {
        if (!expected.claimed) record(`navigation-expected-missing:${expected.pathClass}:${expected.action}`);
      }
      for (const expected of dialogExpectations) {
        if (!expected.claimed) record(`dialog-expected-missing:${expected.type}`);
      }
      for (const expected of popupExpectations) {
        if (!expected.claimed) record(`popup-expected-missing:${expected.pathClass}`);
      }
      for (const expected of cancellationExpectations) {
        if (!expected.claimed) record(`request-cancellation-expected-missing:${expected.action}`);
      }
      if (inFlightRequests.size > 0) record(`monitor-inflight-at-finalize:${inFlightRequests.size}`);
      if (pendingHandlers.size > 0) record(`monitor-handlers-at-finalize:${pendingHandlers.size}`);
    },
    recordFailure(code) {
      if (typeof code === 'string') record(code);
    },
    async closeRejectionIngress() {
      if (state.rejectionIngressClosed) return true;
      if (state.detached) {
        state.rejectionIngressClosed = true;
        return true;
      }
      if (page.isClosed()) {
        state.rejectionIngressClosed = true;
        record('monitor-rejection-barrier-page-closed');
        return false;
      }
      let timer;
      try {
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('visual-browser-monitor-rejection-barrier-timeout')), 2_000);
        });
        const results = await Promise.race([
          Promise.all(page.frames().map((frame) => frame.evaluate((bridge) => {
            const observer = window[bridge];
            if (!observer || typeof observer.shutdown !== 'function') {
              return { available: false };
            }
            return observer.shutdown();
          }, REJECTION_BRIDGE).then(
            (result) => ({ result }),
            () => ({ unavailable: true })
          ))),
          deadline
        ]);
        state.rejectionIngressClosed = true;
        let failureCount = 0;
        let pendingCount = 0;
        let unavailable = false;
        let invalid = false;
        for (const entry of results) {
          if (entry.unavailable || !entry.result?.available) {
            unavailable = true;
            continue;
          }
          if (!Number.isInteger(entry.result.failureCount)
            || !Number.isInteger(entry.result.pendingCount)) {
            invalid = true;
            continue;
          }
          failureCount += entry.result.failureCount;
          pendingCount += entry.result.pendingCount;
        }
        if (unavailable) record('monitor-rejection-barrier-unavailable');
        if (invalid) record('monitor-rejection-barrier-invalid');
        if (failureCount > 0) record('unhandled-rejection-bridge-failed');
        if (pendingCount > 0) record('monitor-rejection-barrier-pending');
        return !unavailable && !invalid && failureCount === 0 && pendingCount === 0;
      } catch {
        state.rejectionIngressClosed = true;
        record('monitor-rejection-barrier-unavailable');
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    async detach() {
      if (state.detached) return true;
      page.off('request', onRequest);
      page.off('requestfinished', onRequestFinished);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('dialog', onDialog);
      page.off('popup', onPopup);
      const historyDetached = await historyObserver?.detach?.() ?? true;
      state.detached = true;
      if (historyDetached === false) record('monitor-history-detach-failed');
      return historyDetached !== false;
    }
  });

  monitors.set(page, state);
  return state;
}

export async function finishVisualBrowserMonitor(page, options = {}) {
  const monitor = monitors.get(page);
  if (!monitor) return null;
  try {
    await monitor.drain(options);
  } catch {
    monitor.recordFailure('monitor-drain-failed');
  }
  try {
    await monitor.stopHistory();
  } catch {
    monitor.recordFailure('monitor-history-stop-failed');
  }
  try {
    await monitor.drain(options);
  } catch {
    monitor.recordFailure('monitor-final-drain-failed');
  }
  try {
    await monitor.closeRejectionIngress();
  } catch {
    monitor.recordFailure('monitor-rejection-shutdown-failed');
  }
  try {
    monitor.finalize();
  } catch {
    monitor.recordFailure('monitor-finalize-failed');
  }
  try {
    await monitor.detach();
  } catch {
    monitor.recordFailure('monitor-detach-failed');
  }
  return monitor.snapshot();
}

export { monitorError };
