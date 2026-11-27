import { expect } from '@playwright/test';
import { pngWorkerResourcePattern } from "./environment.mjs";

export const visibleSelectorDiagnosticsByPage = new WeakMap();

export function visibleSelectorRole(selector) {
  if (selector === '#wpadminbar') return 'adminbar';
  if (selector === '#easymde-editor') return 'editor';
  if (selector === '.easymde-editor > .easymde-editor-message-alert-host') return 'status';
  return 'unknown';
}

export function visibleSelectorFailureKind(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (name === 'TimeoutError' || message.includes('timeout')) return 'timeout';
  if (
    message.includes('target page, context or browser has been closed')
    || message.includes('target closed')
    || message.includes('page closed')
  ) return 'targetclosed';
  if (message.includes('execution context was destroyed') || message.includes('context destroyed')) {
    return 'contextdestroyed';
  }
  if (
    message.includes('evaluation failed')
    || message.includes('javascript error')
    || message.includes('execution context')
  ) return 'js-evaluate';
  if (message.includes('content security policy') || message.includes('csp')) return 'csp';
  return 'unknown';
}

export function visibleSelectorExceptionType(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  return ['Error', 'ReferenceError', 'TimeoutError', 'TypeError'].includes(name)
    ? name
    : 'unknown';
}

export async function readVisibleSelectorFailureSnapshot(page, selector, role) {
  try {
    return await page.evaluate(({ candidate, candidateRole }) => {
      const readyState = ['loading', 'interactive', 'complete'].includes(document.readyState)
        ? document.readyState
        : 'unknown';
      const path = window.location.pathname;
      const pathPhase = path === '/wp-login.php'
        ? 'login'
        : path.startsWith('/wp-admin/post-new.php')
          ? 'editor'
          : 'dashboard';
      const element = document.querySelector(candidate);
      const rects = element ? [...element.getClientRects()] : [];
      const rect = rects[0] ?? null;
      return {
        element: element
          ? {
              connected: element.isConnected,
              height: rect ? Math.round(rect.height * 100) / 100 : 0,
              instanceofElement: element instanceof Element,
              instanceofHTMLElement: element instanceof HTMLElement,
              rectCount: rects.length,
              tag: element.tagName.toLowerCase(),
              width: rect ? Math.round(rect.width * 100) / 100 : 0
            }
          : null,
        pathPhase,
        readyState,
        role: candidateRole
      };
    }, { candidate: selector, candidateRole: role });
  } catch (error) {
    return {
      element: null,
      pathPhase: 'dashboard',
      readyState: 'unknown',
      role,
      snapshotFailure: visibleSelectorFailureKind(error)
    };
  }
}

export async function waitForVisibleSelector(page, selector, failureCode) {
  const startedAt = Date.now();
  try {
    await page.waitForFunction((candidate) => {
      const element = document.querySelector(candidate);
      return element instanceof HTMLElement && element.getClientRects().length > 0;
    }, selector, { timeout: 15_000 });
  } catch (error) {
    const role = visibleSelectorRole(selector);
    const snapshot = await readVisibleSelectorFailureSnapshot(page, selector, role);
    const testInfo = visibleSelectorDiagnosticsByPage.get(page);
    if (testInfo) {
      testInfo.wechatVisibleSelectorDiagnostics ??= [];
      testInfo.wechatVisibleSelectorDiagnostics.push({
        elapsedMs: Date.now() - startedAt,
        exceptionType: visibleSelectorExceptionType(error),
        failureCode,
        failureKind: visibleSelectorFailureKind(error),
        phase: snapshot.pathPhase,
        role,
        snapshot
      });
    }
    throw new Error(failureCode);
  }
}

export async function waitForWechatStatusEvent(page, code) {
  try {
    await page.waitForFunction((expected) => {
      const trace = globalThis.__easymdeWechatCopyTrace;
      if (!trace) return false;
      return trace.statusEvents
        .slice(trace.statusEventCountAtStart)
        .includes(expected);
    }, code, { timeout: 15_000 });
  } catch {
    throw new Error(`wechat-${code}-status-event-unavailable`);
  }
}

export async function assertPngConversionDisabled(page) {
  await expect.poll(() => page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.wechatExport.pngConversionEnabled
  )).toBe(false);
}

export async function assertPngConversionEnabled(page) {
  await expect.poll(() => page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.wechatExport.pngConversionEnabled
  )).toBe(true);
}

export async function installWechatConsoleDiagnostics(page) {
  await page.addInitScript(() => {
    const allowedCodes = new Set([
      'wechat-clipboard-unsupported',
      'wechat-copy-cancelled',
      'wechat-copy-failed',
      'wechat-copy-stale',
      'wechat-export-cancelled-theme-change',
      'wechat-export-completed-after-teardown',
      'wechat-png-baseline-failed',
      'wechat-png-clipboard-failed',
      'wechat-png-decode-failed',
      'wechat-png-encode-failed',
      'wechat-png-font-failed',
      'wechat-png-image-failed',
      'wechat-png-limit-exceeded',
      'wechat-png-rasterization-cancelled',
      'wechat-png-rasterization-failed',
      'wechat-png-rasterization-timeout',
      'wechat-png-rasterization-unavailable',
      'wechat-png-transaction-timeout',
      'wechat-png-upload-failed'
    ]);
    const allowedDiagnosticStages = new Set([
      'capture',
      'inline-validation',
      'intrinsic-gate',
      'layout',
      'rasterization',
      'result-validation'
    ]);
    const allowedDiagnosticKeys = new Set([
      'candidate',
      'height',
      'kind',
      'originalCode',
      'stage',
      'width'
    ]);
    const readPngDiagnostic = (value) => {
      if (!value || 'object' !== typeof value || Array.isArray(value)) return null;
      try {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && null !== prototype) return null;
        const keys = Reflect.ownKeys(value);
        if (
          keys.length !== allowedDiagnosticKeys.size
          || keys.some((key) => 'string' !== typeof key || !allowedDiagnosticKeys.has(key))
        ) return null;
        const descriptors = Object.fromEntries(keys.map((key) => [
          key,
          Object.getOwnPropertyDescriptor(value, key)
        ]));
        if (keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))) return null;
        const candidate = value.candidate;
        const height = value.height;
        const kind = value.kind;
        const originalCode = value.originalCode;
        const stage = value.stage;
        const width = value.width;
        if (
          !Number.isInteger(candidate)
          || candidate < 0
          || !['math', 'mermaid'].includes(kind)
          || !allowedDiagnosticStages.has(stage)
          || !(
            'string' === typeof originalCode
            && (/^(?:wechat-png-[a-z0-9-]+|unknown)$/u).test(originalCode)
          )
          || ![height, width].every((dimension) => null === dimension || Number.isFinite(dimension))
        ) return null;
        return { candidate, height, kind, originalCode, stage, width };
      } catch {
        return null;
      }
    };
    const events = [];
    const methods = ['error', 'info', 'warn'];
    for (const level of methods) {
      const original = console[level];
      console[level] = (...args) => {
        const text = args.length >= 1 && 'string' === typeof args[0] ? args[0] : '';
        const match = text.match(/^\[EasyMDE\] (wechat-[a-z0-9-]+)$/u);
        const startedAt = globalThis.__easymdeWechatCopyTrace?.startedAt;
        if (match && allowedCodes.has(match[1]) && Number.isFinite(startedAt)) {
          const at = performance.now();
          const durationMs = at - startedAt;
          if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new Error('wechat-console-diagnostic-duration-invalid');
          }
          events.push({
            code: match[1],
            diagnostic: 2 === args.length ? readPngDiagnostic(args[1]) : null,
            durationMs,
            level
          });
        }
        return original.apply(console, args);
      };
    }
    globalThis.__easymdeWechatConsoleDiagnostics = {
      read() {
        return events.slice();
      }
    };
  });
}

export async function installPngWorkerLifecycleProbe(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    if ('function' !== typeof NativeWorker) {
      throw new Error('native-png-worker-unavailable');
    }
    const state = {
      created: [],
      terminateCount: 0
    };
    function CountingWorker(scriptURL, options) {
      const worker = new NativeWorker(scriptURL, options);
      state.created.push({
        sameOrigin: (() => {
          try {
            return new URL(String(scriptURL), window.location.href).origin
              === window.location.origin;
          } catch {
            return false;
          }
        })(),
        type: options?.type ?? null,
        url: String(scriptURL)
      });
      const terminate = worker.terminate.bind(worker);
      Object.defineProperty(worker, 'terminate', {
        configurable: true,
        value() {
          state.terminateCount += 1;
          return terminate();
        },
        writable: true
      });
      return worker;
    }
    CountingWorker.prototype = NativeWorker.prototype;
    Object.setPrototypeOf(CountingWorker, NativeWorker);
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: CountingWorker,
      writable: true
    });
    globalThis.__easymdePngWorkerLifecycle = {
      read() {
        return {
          created: state.created.slice(),
          terminateCount: state.terminateCount
        };
      },
      reset() {
        state.created.length = 0;
        state.terminateCount = 0;
      }
    };
  });
}

export async function installNoReplyPngWorkerRoute(page) {
  const origin = new URL(page.url()).origin;
  const requests = [];
  const matcher = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && pngWorkerResourcePattern.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  await page.route(matcher, async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url()
    });
    await route.fulfill({
      body: "globalThis.addEventListener('message', () => {});",
      contentType: 'text/javascript',
      status: 200
    });
  });
  return { matcher, requests };
}

export async function capturePreviewStructureDiagnostics(page, failureCode) {
  await page.evaluate((code) => {
    const markerAttributes = [
      'data-easymde-editor-owner',
      'data-easymde-document-owner',
      'data-easymde-layout-owner',
      'data-easymde-preview-html-sink',
      'data-easymde-preview-accepted',
      'data-easymde-preview-refreshing'
    ];
    const round = (value) => Math.round(value * 100) / 100;
    const geometry = (element) => ({
      connected: element.isConnected,
      display: getComputedStyle(element).display,
      rectCount: element.getClientRects().length,
      rects: [...element.getClientRects()].slice(0, 4).map((rect) => ({
        height: round(rect.height),
        left: round(rect.left),
        top: round(rect.top),
        width: round(rect.width)
      })),
      visibility: getComputedStyle(element).visibility
    });
    const markers = (element) => Object.fromEntries(
      markerAttributes
        .filter((attribute) => element.hasAttribute(attribute))
        .map((attribute) => [attribute, element.getAttribute(attribute)])
    );
    const describeElement = (element) => ({
      className: element.getAttribute('class') ?? '',
      geometry: geometry(element),
      id: element.id || null,
      markers: markers(element),
      tag: element.tagName
    });
    const ancestors = (element) => {
      const result = [];
      let current = element.parentElement;
      while (current && result.length < 8) {
        result.push({
          className: current.getAttribute('class') ?? '',
          connected: current.isConnected,
          id: current.id || null,
          tag: current.tagName
        });
        current = current.parentElement;
      }
      return result;
    };
    const hostSummary = (selector) => [...document.querySelectorAll(selector)]
      .slice(0, 8)
      .map((element) => ({
        ...describeElement(element),
        ancestors: ancestors(element)
      }));
    const sinks = [...document.querySelectorAll(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    )].slice(0, 8).map((element) => ({
      ...describeElement(element),
      ancestors: ancestors(element),
      signatureReady: typeof element.easymdePreviewSignature === 'string'
    }));
    const roots = [...document.querySelectorAll('#easymde-editor-root')]
      .slice(0, 8)
      .map((element) => ({
        ...describeElement(element),
        ancestors: ancestors(element),
        childCount: element.childElementCount
      }));
    globalThis.__easymdePreviewStructureDiagnostics = {
      code,
      editorRootCount: document.querySelectorAll('#easymde-editor-root').length,
      markerOwners: [...document.querySelectorAll(
        '[data-easymde-editor-owner], [data-easymde-document-owner], [data-easymde-preview-html-sink]'
      )].slice(0, 16).map(describeElement),
      measurementHosts: hostSummary('.easymde-wechat-preview-measurement'),
      rawDimensionHosts: hostSummary('.easymde-wechat-raw-dimension-context'),
      sinkCount: document.querySelectorAll(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      ).length,
      sinks,
      roots
    };
  }, failureCode);
}

export async function collectFailureDiagnostics(page) {
  if (page.isClosed()) return { code: 'page-closed' };
  try {
    return await page.evaluate(() => {
      const root = document.querySelector('#easymde-editor-root');
      const editor = document.querySelector('#easymde-editor');
      const preview = document.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      const alertHost = document.querySelector(
        '.easymde-editor > .easymde-editor-message-alert-host'
      );
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const loaderBootstrap = window.EasyMDEAdminEditorLoaderBootstrap;
      const trace = globalThis.__easymdeWechatCopyTrace;
      let buildId = null;
      try {
        const mainScriptUrl = 'string' === typeof loaderBootstrap?.mainScriptUrl
          ? new URL(loaderBootstrap.mainScriptUrl, window.location.href)
          : null;
        const mainScriptPath = mainScriptUrl?.pathname.split('/').pop() ?? '';
        const match = /^admin-editor-(?!loader-)([a-z0-9_-]+)\.js$/iu.exec(mainScriptPath);
        const mainScript = mainScriptUrl && mainScriptUrl.origin === window.location.origin
          ? [...document.scripts].find((script) => {
            try {
              return new URL(script.src, window.location.href).href === mainScriptUrl.href;
            } catch {
              return false;
            }
          })
          : null;
        if (match && mainScript) buildId = match[1];
      } catch {
        buildId = null;
      }
      return {
        bootstrap: {
          available: Boolean(bootstrap),
          pngConversionEnabled: bootstrap?.wechatExport?.pngConversionEnabled ?? null,
          wechatEnabled: bootstrap?.wechatExport?.enabled ?? null
        },
        clipboard: typeof trace?.diagnostics === 'function'
          ? trace.diagnostics()
          : { code: 'clipboard-trace-unavailable' },
        editor: {
          editorPresent: Boolean(editor),
          buildId,
          rootPresent: Boolean(root),
          sessionStatus: root?.getAttribute('data-easymde-session-status') ?? null,
          sourcePresent: Boolean(document.querySelector('#easymde-source'))
        },
        notifications: {
          alertCount: alertHost?.querySelectorAll('[role="alert"]').length ?? 0,
          statusCount: alertHost?.querySelectorAll('[role="status"]').length ?? 0
        },
        preview: {
          accepted: preview?.getAttribute('data-easymde-preview-accepted') ?? null,
          ariaBusy: preview?.getAttribute('aria-busy') ?? null,
          error: preview?.getAttribute('data-easymde-preview-error') ?? null,
          signatureReady: typeof preview?.easymdePreviewSignature === 'string'
        },
        previewFreshness: typeof globalThis.__easymdePreviewFreshnessProbe?.read === 'function'
          ? globalThis.__easymdePreviewFreshnessProbe.read()
          : { code: 'not-installed' },
        previewStructure: globalThis.__easymdePreviewStructureDiagnostics ?? {
          code: 'not-captured'
        },
        readiness: globalThis.__easymdeWechatReadiness ?? {
          code: 'preview-visual-readiness-unavailable'
        },
        pngMeasurement: typeof globalThis.__easymdePngMeasurementProbe?.read === 'function'
          ? globalThis.__easymdePngMeasurementProbe.read()
          : { code: 'not-installed' },
        pngWorkerLifecycle: typeof globalThis.__easymdePngWorkerLifecycle?.read === 'function'
          ? globalThis.__easymdePngWorkerLifecycle.read()
          : { code: 'not-installed' },
        consoleDiagnostics: typeof globalThis.__easymdeWechatConsoleDiagnostics?.read === 'function'
          ? globalThis.__easymdeWechatConsoleDiagnostics.read()
          : { code: 'not-installed' },
        matrixStage: globalThis.__easymdeWechatMatrixStage ?? {
          code: 'not-installed'
        }
      };
    });
  } catch {
    return { code: 'diagnostics-unavailable' };
  }
}

export async function setupZeroWriteProbe(page, { baselineAtClick = false } = {}) {
  await page.evaluate(({ baselineAtClick }) => {
    const source = document.querySelector('#easymde-source');
    const compatibility = document.querySelector('#content');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(source instanceof HTMLTextAreaElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-zero-write-surfaces-unavailable');
    }
    const readSnapshot = () => ({
      compatibility: compatibility instanceof HTMLTextAreaElement ? compatibility.value : null,
      preview: preview.innerHTML,
      source: source.value
    });
    let baseline = baselineAtClick ? null : readSnapshot();
    let sourceMutations = 0;
    let previewMutations = 0;
    const sourceObserver = new MutationObserver(() => { sourceMutations += 1; });
    const previewObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        if (
          record.type === 'attributes'
          && record.target === preview
          && ['aria-busy', 'data-easymde-preview-accepted', 'data-easymde-preview-refreshing']
            .includes(record.attributeName)
        ) return;
        previewMutations += 1;
      });
    });
    sourceObserver.observe(source, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    previewObserver.observe(preview, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    globalThis.__easymdeWechatZeroWrite = {
      captureAtClick() {
        if (!baseline) baseline = readSnapshot();
      },
      disconnect() {
        sourceObserver.disconnect();
        previewObserver.disconnect();
      },
      async read() {
        if (!baseline) throw new Error('wechat-zero-write-baseline-unavailable');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          compatibilityUnchanged: baseline.compatibility === (
            compatibility instanceof HTMLTextAreaElement ? compatibility.value : null
          ),
          previewMutations,
          previewUnchanged: baseline.preview === preview.innerHTML,
          sourceMutations,
          sourceUnchanged: baseline.source === source.value
        };
      }
    };
  }, { baselineAtClick });
}

export async function readZeroWriteProbe(page) {
  return page.evaluate(() => globalThis.__easymdeWechatZeroWrite.read());
}

export async function stopZeroWriteProbe(page) {
  await page.evaluate(() => globalThis.__easymdeWechatZeroWrite.disconnect());
}

export function inspectHeartbeatRequest(request) {
  if (request.method() !== 'POST') return false;
  const url = new URL(request.url());
  if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return null;
  const body = request.postData() ?? '';
  const parameters = new URLSearchParams(body);
  const safeKey = (key) => !/(?:content|cookie|nonce|password|token)/iu.test(key);
  const parameterKeys = [...parameters.keys()];
  const knownDataKeys = new Set([
    'nonces_expired',
    'rest_nonce',
    'wp-auth-check',
    'wp-refresh-post-lock'
  ]);
  const bracketDataKeys = [];
  parameterKeys.forEach((key) => {
    if (!key.startsWith('data[')) return;
    const end = key.indexOf(']', 5);
    bracketDataKeys.push(end > 5 ? key.slice(5, end) : '');
  });
  const dataKeys = [];
  const bracketDataUnknown = bracketDataKeys.some(
    (key) => !knownDataKeys.has(key) && key !== 'wp_autosave'
  );
  let dataState = bracketDataKeys.length > 0
    ? bracketDataUnknown ? 'unknown' : 'known'
    : 'absent';
  let wpAutosave = parameterKeys.some((key) => key.includes('wp_autosave'));
  const dataValue = parameters.get('data');
  if (dataValue !== null) {
    dataState = 'invalid';
    try {
      const parsed = JSON.parse(dataValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedKeys = Object.keys(parsed);
        dataKeys.push(...parsedKeys.filter(safeKey));
        wpAutosave ||= parsedKeys.includes('wp_autosave');
        if (wpAutosave) {
          dataState = 'autosave';
        } else if (parsedKeys.every((key) => knownDataKeys.has(key))) {
          dataState = 'known';
        } else {
          dataState = 'unknown';
        }
      }
    } catch {
      dataState = 'invalid';
    }
  }
  const keyNames = [...new Set([...parameterKeys, ...dataKeys].filter(safeKey))].sort();
  const action = url.searchParams.get('action') ?? parameters.get('action');
  return {
    isHeartbeat: action === 'heartbeat'
      && (body === '' || body.includes('='))
      && ['absent', 'known'].includes(dataState)
      && !wpAutosave,
    keyNames,
    wpAutosave
  };
}
