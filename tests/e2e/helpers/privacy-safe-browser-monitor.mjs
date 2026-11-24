import assert from 'node:assert/strict';

const SAFE_BROWSER_ERROR_NAMES = new Set([
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

const SAFE_BROWSER_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'fedcm',
  'other'
]);

const SAFE_DIALOG_TYPES = new Set([
  'alert',
  'beforeunload',
  'confirm',
  'prompt'
]);

const VALID_URL_CATEGORIES = new Set([
  'about-blank',
  'admin-ajax',
  'easymde-api',
  'external',
  'invalid',
  'non-http',
  'plugin-asset',
  'preview-rest',
  'same-origin',
  'unknown',
  'wp-admin',
  'wp-login',
  'wp-rest'
]);

export const DEFAULT_ALLOWED_NAVIGATION_CATEGORIES = Object.freeze([
  'wp-login',
  'wp-admin'
]);

const ASCII_CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u;

const READONLY_ADMIN_AJAX_GET_ACTIONS = new Set([
  'dashboard-widgets',
  'rest-nonce'
]);

const READONLY_ADMIN_AJAX_POST_CLASSIFICATIONS = new Set([
  'community-events-readonly',
  'heartbeat-readonly'
]);

function normalizeBasePath(rawPath) {
  if ('string' !== typeof rawPath || '' === rawPath) return '';
  const trimmed = rawPath.replace(/\/+$/u, '');
  if ('' === trimmed || '/' === trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function resolveBaseContext(input) {
  if (null === input || undefined === input || '' === input) {
    return { baseOrigin: null, basePath: '', invalidBase: false };
  }
  if ('object' === typeof input) {
    if (true === input.invalidBase) {
      return { baseOrigin: null, basePath: '', invalidBase: true };
    }
    if ('baseURL' in input && undefined !== input.baseURL && null !== input.baseURL && '' !== input.baseURL) {
      return resolveBaseContext(input.baseURL);
    }
    if ('baseOrigin' in input && undefined !== input.baseOrigin && null !== input.baseOrigin && '' !== input.baseOrigin) {
      const originContext = resolveBaseContext(input.baseOrigin);
      if (originContext.invalidBase) return originContext;
      const basePath = 'string' === typeof input.basePath
        ? normalizeBasePath(input.basePath)
        : originContext.basePath;
      return { baseOrigin: originContext.baseOrigin, basePath, invalidBase: false };
    }
    if ('string' === typeof input.basePath) {
      return { baseOrigin: null, basePath: normalizeBasePath(input.basePath), invalidBase: false };
    }
    return { baseOrigin: null, basePath: '', invalidBase: false };
  }
  if ('string' !== typeof input) {
    return { baseOrigin: null, basePath: '', invalidBase: true };
  }
  try {
    const parsed = new URL(input);
    if ('http:' !== parsed.protocol && 'https:' !== parsed.protocol) {
      return { baseOrigin: null, basePath: '', invalidBase: true };
    }
    return {
      baseOrigin: parsed.origin,
      basePath: normalizeBasePath(parsed.pathname),
      invalidBase: false
    };
  } catch {
    return { baseOrigin: null, basePath: '', invalidBase: true };
  }
}

function normalizeRestRouteParam(searchParams) {
  const values = searchParams.getAll('rest_route');
  if (1 !== values.length) return null;
  return values[0].trim().replace(/^\/+|\/+$/gu, '');
}

function isWordPressRestRootPathname(pathname, basePath = '') {
  if ('string' !== typeof pathname) return false;
  if ('' === basePath) {
    return '/' === pathname || '/index.php' === pathname;
  }
  return pathname === basePath
    || pathname === `${basePath}/`
    || pathname === `${basePath}/index.php`;
}

function isWpAdminPathname(pathname, basePath = '') {
  if ('string' !== typeof pathname) return false;
  const prefix = `${basePath}/wp-admin`;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isAdminAjaxPathname(pathname, basePath = '') {
  return pathname === `${basePath}/wp-admin/admin-ajax.php`;
}

function isWpLoginPathname(pathname, basePath = '') {
  return pathname === `${basePath}/wp-login.php`;
}

function isPluginAssetPathname(pathname, basePath = '') {
  return 'string' === typeof pathname
    && pathname.startsWith(`${basePath}/wp-content/plugins/`);
}

function isPreviewRestEndpoint(pathname, searchParams, basePath = '') {
  const expectedPretty = `${basePath}/wp-json/easymde/v1/preview`;
  if (pathname === expectedPretty || pathname === `${expectedPretty}/`) {
    return true;
  }
  return isWordPressRestRootPathname(pathname, basePath)
    && 'easymde/v1/preview' === normalizeRestRouteParam(searchParams);
}

function isEasyMdeRestEndpoint(pathname, searchParams, basePath = '') {
  const expectedPrefix = `${basePath}/wp-json/easymde/v1`;
  if (pathname === expectedPrefix || pathname.startsWith(`${expectedPrefix}/`)) {
    return true;
  }
  if (!isWordPressRestRootPathname(pathname, basePath)) return false;
  const route = normalizeRestRouteParam(searchParams);
  return null !== route && ('easymde/v1' === route || route.startsWith('easymde/v1/'));
}

function isAnyWordPressRestEndpoint(pathname, searchParams, basePath = '') {
  const expectedPrefix = `${basePath}/wp-json`;
  if (pathname === expectedPrefix || pathname.startsWith(`${expectedPrefix}/`)) {
    return true;
  }
  return isWordPressRestRootPathname(pathname, basePath) && searchParams.has('rest_route');
}

export function classifyBrowserUrlCategory(rawUrl, baseOriginOrUrl = null) {
  if ('string' !== typeof rawUrl || '' === rawUrl) return 'unknown';
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid';
  }
  if ('about:' === url.protocol && 'blank' === url.pathname) return 'about-blank';
  if ('http:' !== url.protocol && 'https:' !== url.protocol) return 'non-http';

  const { baseOrigin, basePath, invalidBase } = resolveBaseContext(baseOriginOrUrl);
  if (invalidBase) return 'external';
  if (baseOrigin && url.origin !== baseOrigin) return 'external';

  if (isPreviewRestEndpoint(url.pathname, url.searchParams, basePath)) return 'preview-rest';
  if (isEasyMdeRestEndpoint(url.pathname, url.searchParams, basePath)) return 'easymde-api';
  if (isPluginAssetPathname(url.pathname, basePath)) return 'plugin-asset';
  if (isAdminAjaxPathname(url.pathname, basePath)) return 'admin-ajax';
  if (isWpLoginPathname(url.pathname, basePath)) return 'wp-login';
  if (isWpAdminPathname(url.pathname, basePath)) return 'wp-admin';
  if (isAnyWordPressRestEndpoint(url.pathname, url.searchParams, basePath)) return 'wp-rest';
  if (baseOrigin && url.origin === baseOrigin) return 'same-origin';
  return 'external';
}

export function safeBrowserFailureClass(errorText) {
  const code = 'string' === typeof errorText
    ? errorText.match(/(?:^|::)(ERR_[A-Z0-9_]+|NS_BINDING_ABORTED)$/u)?.[1]
    : null;
  if ('ERR_ABORTED' === code || 'NS_BINDING_ABORTED' === code) return 'aborted';
  if (code?.startsWith('ERR_CONNECTION_')) return 'connection';
  if ('ERR_NAME_NOT_RESOLVED' === code) return 'dns';
  if (code?.includes('TIMED_OUT')) return 'timeout';
  if (code?.startsWith('ERR_CERT_')) return 'tls';
  if ('ERR_FAILED' === code) return 'failed';
  return 'other';
}

function readContentTypeHeader(headers) {
  if (!headers || 'object' !== typeof headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if ('content-type' === key.toLowerCase() && 'string' === typeof value) {
      return value;
    }
  }
  return '';
}

function normalizePostRequestInput(requestOrInput) {
  if (!requestOrInput || 'object' !== typeof requestOrInput) {
    return { invalidUrl: true };
  }
  if ('function' === typeof requestOrInput.url) {
    let url;
    try {
      url = new URL(requestOrInput.url());
    } catch {
      return { invalidUrl: true };
    }
    const headers = 'function' === typeof requestOrInput.headers
      ? requestOrInput.headers()
      : null;
    let postData = '';
    let unreadableBody = false;
    if ('function' === typeof requestOrInput.postData) {
      try {
        const rawPostData = requestOrInput.postData();
        if ('string' === typeof rawPostData) {
          postData = rawPostData;
        } else if (null === rawPostData && 'function' === typeof requestOrInput.postDataBuffer) {
          const rawBuffer = requestOrInput.postDataBuffer();
          if (rawBuffer && rawBuffer.length > 0) {
            unreadableBody = true;
          }
        }
      } catch {
        unreadableBody = true;
      }
    }
    return {
      invalidUrl: false,
      protocol: url.protocol,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      contentType: readContentTypeHeader(headers),
      postData,
      unreadableBody
    };
  }
  if ('string' === typeof requestOrInput.url && '' !== requestOrInput.url) {
    let url;
    try {
      url = new URL(requestOrInput.url);
    } catch {
      return { invalidUrl: true };
    }
    return {
      invalidUrl: false,
      protocol: url.protocol,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      contentType: 'string' === typeof requestOrInput.contentType ? requestOrInput.contentType : '',
      postData: 'string' === typeof requestOrInput.postData ? requestOrInput.postData : ''
    };
  }
  return {
    invalidUrl: false,
    protocol: null,
    origin: 'string' === typeof requestOrInput.origin ? requestOrInput.origin : '',
    pathname: 'string' === typeof requestOrInput.pathname ? requestOrInput.pathname : '',
    search: 'string' === typeof requestOrInput.search ? requestOrInput.search : '',
    contentType: 'string' === typeof requestOrInput.contentType ? requestOrInput.contentType : '',
    postData: 'string' === typeof requestOrInput.postData ? requestOrInput.postData : ''
  };
}

function hasControlCharacterKey(params) {
  for (const key of params.keys()) {
    if (ASCII_CONTROL_CHAR_PATTERN.test(key)) {
      return true;
    }
  }
  return false;
}

function hasAmbiguousActionKey(params) {
  for (const key of params.keys()) {
    if ('action' === key) continue;
    const nulTruncated = key.split('\u0000', 1)[0];
    const trimmedKey = nulTruncated.trim();
    if ('action' === trimmedKey || trimmedKey.startsWith('action[')) {
      return true;
    }
  }
  return false;
}

function isReadonlyAdminAjaxGetRequest(request, baseContext) {
  if (!request || 'object' !== typeof request || baseContext.invalidBase) {
    return false;
  }
  const rawUrl = 'function' === typeof request.url ? request.url() : request.url;
  if ('string' !== typeof rawUrl || '' === rawUrl) {
    return false;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if ('http:' !== url.protocol && 'https:' !== url.protocol) {
    return false;
  }
  if (baseContext.baseOrigin && url.origin !== baseContext.baseOrigin) {
    return false;
  }
  if (!isAdminAjaxPathname(url.pathname, baseContext.basePath)) {
    return false;
  }
  if (hasControlCharacterKey(url.searchParams) || hasAmbiguousActionKey(url.searchParams)) {
    return false;
  }
  const actions = url.searchParams.getAll('action');
  return 1 === actions.length && READONLY_ADMIN_AJAX_GET_ACTIONS.has(actions[0]);
}

function isExpectedReadonlyAdminAjaxRequest(request, baseContext) {
  const method = 'function' === typeof request?.method
    ? String(request.method()).toUpperCase()
    : '';
  if ('POST' === method) {
    const classified = classifyReadonlyPostRequest(request, baseContext);
    return READONLY_ADMIN_AJAX_POST_CLASSIFICATIONS.has(classified.classification);
  }
  if ('GET' === method) {
    return isReadonlyAdminAjaxGetRequest(request, baseContext);
  }
  return false;
}

export function classifyReadonlyPostRequest(requestOrInput, options = {}) {
  const normalized = normalizePostRequestInput(requestOrInput);
  if (normalized.invalidUrl) {
    return {
      category: 'invalid-url',
      classification: 'unexpected-write'
    };
  }

  const hasExplicitOptions = options && 'object' === typeof options
    && ('baseURL' in options || 'baseOrigin' in options || 'basePath' in options || 'invalidBase' in options);
  const baseContext = resolveBaseContext(hasExplicitOptions ? options : requestOrInput);
  if (baseContext.invalidBase) {
    return {
      category: 'external-post',
      classification: 'unexpected-write'
    };
  }
  if (
    null !== normalized.protocol
    && 'http:' !== normalized.protocol
    && 'https:' !== normalized.protocol
  ) {
    return {
      category: 'external-post',
      classification: 'unexpected-write'
    };
  }
  if (baseContext.baseOrigin && normalized.origin !== baseContext.baseOrigin) {
    return {
      category: 'external-post',
      classification: 'unexpected-write'
    };
  }

  const { pathname, search, contentType, postData } = normalized;
  const { basePath } = baseContext;
  const queryParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (isPreviewRestEndpoint(pathname, queryParams, basePath)) {
    return {
      category: 'preview-rest',
      classification: 'preview-readonly'
    };
  }
  if (!isAdminAjaxPathname(pathname, basePath)) {
    return {
      category: isAnyWordPressRestEndpoint(pathname, queryParams, basePath)
        ? 'other-rest'
        : 'other-post',
      classification: 'unexpected-write'
    };
  }
  const knownDataKeys = new Set([
    'nonces_expired',
    'rest_nonce',
    'wp-auth-check',
    'wp-refresh-post-lock'
  ]);
  const isRecord = (value) => (
    !!value && 'object' === typeof value && !Array.isArray(value)
  );
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (
    normalized.unreadableBody
    || 'application/x-www-form-urlencoded' !== mediaType
    || ('' !== postData && !postData.includes('='))
  ) {
    return {
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    };
  }
  const parameters = new URLSearchParams(postData);
  if (hasControlCharacterKey(queryParams) || hasControlCharacterKey(parameters)) {
    return {
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    };
  }
  const queryActions = queryParams.getAll('action');
  const bodyActions = parameters.getAll('action');
  const allActions = [...queryActions, ...bodyActions];
  if (
    1 !== allActions.length
    || hasAmbiguousActionKey(queryParams)
    || hasAmbiguousActionKey(parameters)
  ) {
    return {
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    };
  }
  const action = allActions[0];
  if ('get-community-events' === action) {
    return {
      category: 'community-events',
      classification: 'community-events-readonly'
    };
  }
  if ('heartbeat' !== action) {
    return {
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    };
  }
  const parameterKeys = [...parameters.keys()];
  const bracketDataKeys = [];
  const dataValues = [];
  for (const [key, value] of parameters.entries()) {
    const trimmedKey = key.trim();
    if ('data' === trimmedKey) {
      dataValues.push(value);
      continue;
    }
    if (!trimmedKey.startsWith('data[')) continue;
    const end = trimmedKey.indexOf(']', 5);
    bracketDataKeys.push(end > 5 ? trimmedKey.slice(5, end) : '');
  }
  const bracketDataUnknown = bracketDataKeys.some(
    (key) => !knownDataKeys.has(key) && key !== 'wp_autosave'
  );
  let dataState = bracketDataKeys.length > 0
    ? bracketDataUnknown ? 'unknown' : 'known'
    : 'absent';
  let wpAutosave = parameterKeys.some((key) => key.includes('wp_autosave'));
  const applyDataRecord = (record) => {
    const parsedKeys = Object.keys(record);
    wpAutosave = wpAutosave || parsedKeys.includes('wp_autosave');
    if (wpAutosave) {
      dataState = 'autosave';
    } else if (parsedKeys.every((key) => knownDataKeys.has(key))) {
      dataState = 'known';
    } else {
      dataState = 'unknown';
    }
  };
  if (dataValues.length > 1 || (dataValues.length > 0 && bracketDataKeys.length > 0)) {
    dataState = 'invalid';
  } else if (1 === dataValues.length) {
    dataState = 'invalid';
    try {
      const parsed = JSON.parse(dataValues[0]);
      if (isRecord(parsed)) applyDataRecord(parsed);
    } catch {
      // Keep invalid dataState without echoing request metadata.
    }
  }
  if (['absent', 'known'].includes(dataState) && !wpAutosave) {
    return {
      category: 'heartbeat',
      classification: 'heartbeat-readonly'
    };
  }
  return {
    category: 'other-admin-ajax',
    classification: 'unexpected-write'
  };
}

function resolveAllowedNavigationCategories(allowedNavigationCategories) {
  if (undefined === allowedNavigationCategories || null === allowedNavigationCategories) {
    return new Set(DEFAULT_ALLOWED_NAVIGATION_CATEGORIES);
  }
  const source = allowedNavigationCategories instanceof Set
    ? [...allowedNavigationCategories]
    : Array.isArray(allowedNavigationCategories)
      ? allowedNavigationCategories
      : [];
  return new Set(source.filter((category) => VALID_URL_CATEGORIES.has(category)));
}

export function attachPrivacySafeBrowserMonitor(
  page,
  { baseURL, allowedNavigationCategories, allowExpectedFailure } = {}
) {
  const baseContext = resolveBaseContext(baseURL);
  const allowedNavigations = resolveAllowedNavigationCategories(allowedNavigationCategories);
  const failures = [];
  const requestFailureSummaries = [];
  const httpErrorSummaries = [];
  const counts = {
    abortedAdminAjax: 0,
    cancelledPreview: 0,
    consoleErrors: 0,
    consoleWarnings: 0,
    dialogs: 0,
    httpErrors: 0,
    pageErrors: 0,
    popups: 0,
    requestFailures: 0,
    unexpectedNavigations: 0
  };
  const isExpectedFailure = (entry) => {
    if ('function' !== typeof allowExpectedFailure) return false;
    try {
      return true === allowExpectedFailure({ ...entry });
    } catch {
      return false;
    }
  };
  const record = (code) => {
    if (failures.length < 128 && !failures.includes(code)) {
      failures.push(code);
    }
  };
  const onPageError = (error) => {
    counts.pageErrors += 1;
    let rawName = null;
    try {
      rawName = error?.name;
    } catch {
      rawName = null;
    }
    const errorName = SAFE_BROWSER_ERROR_NAMES.has(rawName) ? rawName : 'Error';
    record(`pageerror:${errorName}`);
  };
  const onConsole = (message) => {
    const type = 'function' === typeof message?.type ? message.type() : null;
    if ('error' !== type && 'warning' !== type) return;
    const rawLocationUrl = 'function' === typeof message?.location
      ? (message.location()?.url ?? '')
      : '';
    const category = classifyBrowserUrlCategory(rawLocationUrl, baseContext);
    if ('warning' === type) {
      counts.consoleWarnings += 1;
      record(`console-warning:${category}`);
      return;
    }
    counts.consoleErrors += 1;
    record(`console-error:${category}`);
  };
  const onDialog = (dialog) => {
    counts.dialogs += 1;
    const rawType = 'function' === typeof dialog?.type ? dialog.type() : null;
    const dialogType = SAFE_DIALOG_TYPES.has(rawType) ? rawType : 'unknown';
    record(`dialog:${dialogType}`);
    if ('function' === typeof dialog?.dismiss) {
      try {
        Promise.resolve(dialog.dismiss()).catch(() => {
          record(`dialog-dismiss-failed:${dialogType}`);
        });
      } catch {
        record(`dialog-dismiss-failed:${dialogType}`);
      }
    }
  };
  const onPopup = (popup) => {
    counts.popups += 1;
    const popupUrl = 'function' === typeof popup?.url ? popup.url() : '';
    const category = classifyBrowserUrlCategory(popupUrl, baseContext);
    record(`popup:${category}`);
    if ('function' === typeof popup?.close) {
      try {
        Promise.resolve(popup.close()).catch(() => {
          record(`popup-close-failed:${category}`);
        });
      } catch {
        record(`popup-close-failed:${category}`);
      }
    }
  };
  const onFrameNavigated = (frame) => {
    if ('function' === typeof page.mainFrame && frame !== page.mainFrame()) {
      return;
    }
    const frameUrl = 'function' === typeof frame?.url ? frame.url() : '';
    const category = classifyBrowserUrlCategory(frameUrl, baseContext);
    if (allowedNavigations.has(category)) return;
    counts.unexpectedNavigations += 1;
    record(`navigation:${category}`);
  };
  const onRequestFailed = (request) => {
    const category = classifyBrowserUrlCategory(request.url(), baseContext);
    const failureClass = safeBrowserFailureClass(request.failure()?.errorText);
    const rawResourceType = request.resourceType();
    const resourceType = SAFE_BROWSER_RESOURCE_TYPES.has(rawResourceType)
      ? rawResourceType
      : 'other';
    const method = 'function' === typeof request?.method
      ? String(request.method()).toUpperCase()
      : '';
    if ('aborted' === failureClass && 'preview-rest' === category && 'POST' === method) {
      counts.cancelledPreview += 1;
      return;
    }
    if (
      'aborted' === failureClass
      && 'admin-ajax' === category
      && ('xhr' === resourceType || 'fetch' === resourceType)
      && isExpectedReadonlyAdminAjaxRequest(request, baseContext)
    ) {
      counts.abortedAdminAjax += 1;
      return;
    }
    const summary = {
      category,
      resourceType,
      failureClass
    };
    if (!baseContext.invalidBase && 'external' === category && isExpectedFailure({ type: 'requestfailed', ...summary })) {
      return;
    }
    counts.requestFailures += 1;
    if (requestFailureSummaries.length < 128) {
      requestFailureSummaries.push(summary);
    }
    record(`request-failed:${failureClass}:${category}:${resourceType}`);
  };
  const onResponse = (response) => {
    const status = response.status();
    if (!Number.isInteger(status) || status < 400) return;
    const category = classifyBrowserUrlCategory(response.url(), baseContext);
    const rawResourceType = response.request?.()?.resourceType?.();
    const resourceType = SAFE_BROWSER_RESOURCE_TYPES.has(rawResourceType)
      ? rawResourceType
      : 'other';
    const summary = {
      category,
      resourceType,
      status
    };
    if (!baseContext.invalidBase && 'external' === category && isExpectedFailure({ type: 'response', ...summary })) {
      return;
    }
    counts.httpErrors += 1;
    if (httpErrorSummaries.length < 128) {
      httpErrorSummaries.push(summary);
    }
    record(`http-${status}:${category}:${resourceType}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('dialog', onDialog);
  page.on('popup', onPopup);
  page.on('framenavigated', onFrameNavigated);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  let disposed = false;
  return {
    counts,
    failures,
    snapshot() {
      return {
        counts: { ...counts },
        failures: [...failures],
        httpErrors: httpErrorSummaries.map((entry) => ({ ...entry })),
        requestFailures: requestFailureSummaries.map((entry) => ({ ...entry }))
      };
    },
    assertClean() {
      assert.deepEqual(
        failures,
        [],
        `unexpected browser failures observed; pageErrors=${counts.pageErrors}; consoleErrors=${counts.consoleErrors}; consoleWarnings=${counts.consoleWarnings}; dialogs=${counts.dialogs}; popups=${counts.popups}; unexpectedNavigations=${counts.unexpectedNavigations}; requestFailures=${counts.requestFailures}; httpErrors=${counts.httpErrors}; failures=${failures.join(',')}`
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      page.off('dialog', onDialog);
      page.off('popup', onPopup);
      page.off('framenavigated', onFrameNavigated);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    }
  };
}
