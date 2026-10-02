import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// DevTools snapshots can add browser tasks inside the click-to-pending window.
test.use({ trace: 'off', video: 'off' });

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
const fullCapabilityMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fullCapabilityImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
const fullCapabilityImageSource =
  'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
const mediumMarkdown = [
  '# Medium WeChat copy fixture',
  '',
  'This synthetic document checks **rich text**, `inline code`, and a stable table.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| medium | ready |',
  '',
  '```js',
  'const copied = true;',
  '```',
  '',
  '- [x] copied from the rendered Preview'
].join('\n');
const readonlyProjectionMarkdown = [
  'Inline math: $x$ and $y$.',
  '',
  'Display math: \\[\\frac{1}{n}\\].',
  '',
  'Ordinary editable paragraph.'
].join('\n');
const readonlyProjectionUpdatedMarkdown = [
  'Inline math: $x$ and $y$.',
  '',
  'Display math: \\[\\frac{1}{n}\\].',
  '',
  'Updated ordinary editable paragraph.'
].join('\n');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}

function runWp(args) {
  if (!wpPath) {
    throw new Error('EASYMDE_E2E_WP_PATH must point to the WordPress install under test.');
  }

  const result = spawnSync(
    wpCli,
    [...args, `--path=${wpPath}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      }
    }
  );

  if (result.status !== 0) {
    throw new Error(`wp-command-failed:${args.slice(0, 2).join(':')}:${result.status ?? 'unknown'}`);
  }

  return result.stdout.trim();
}

function testSlug(testInfo) {
  return `wechat-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function createUser(slug) {
  const username = `${adminUser}-${slug}-user`;
  const email = `${slug}@example.test`;
  const id = runWp([
    'user',
    'create',
    username,
    email,
    '--role=administrator',
    `--user_pass=${adminPassword}`,
    '--porcelain'
  ]);

  return { id, password: adminPassword, username };
}

function deleteUserContent(userId) {
  const postIds = runWp([
    'post',
    'list',
    `--author=${userId}`,
    '--post_type=post,page,attachment',
    '--post_status=any',
    '--format=ids'
  ]);
  if (postIds) runWp(['post', 'delete', ...postIds.split(/\s+/u), '--force']);
  runWp(['user', 'delete', userId, '--yes', '--reassign=1']);
}

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#loginform').evaluate((form, credentials) => {
    const username = form.elements.namedItem('log');
    const password = form.elements.namedItem('pwd');
    const submit = form.elements.namedItem('wp-submit');
    if (
      !(username instanceof HTMLInputElement)
      || !(password instanceof HTMLInputElement)
      || !(submit instanceof HTMLInputElement)
    ) {
      throw new Error('wordpress-login-fields-unavailable');
    }
    username.value = credentials.username;
    password.value = credentials.password;
    form.requestSubmit(submit);
  }, user);
  await waitForVisibleSelector(page, '#wpadminbar', 'wordpress-admin-bar-unavailable');
}

async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await waitForVisibleSelector(page, '#easymde-editor', 'easymde-editor-unavailable');
}

async function waitForVisibleSelector(page, selector, failureCode) {
  try {
    await page.waitForFunction((candidate) => {
      const element = document.querySelector(candidate);
      return element instanceof HTMLElement && element.getClientRects().length > 0;
    }, selector, { timeout: 15_000 });
  } catch {
    throw new Error(failureCode);
  }
}

async function waitForWechatStatusEvent(page, code) {
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

async function assertPngConversionDisabled(page) {
  await expect.poll(() => page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.wechatExport.pngConversionEnabled
  )).toBe(false);
}

async function installClipboardInstrumentation(page) {
  await page.addInitScript(() => {
    const clipboard = navigator.clipboard;
    const nativeWrite = clipboard?.write?.bind(clipboard);
    const trace = {
      clicks: [],
      lastItems: null,
      mode: 'success',
      pendingFrameAt: null,
      release: null,
      reject: null,
      statusObserverInstalled: false,
      statusEventCountAtStart: 0,
      statusEvents: [],
      startedWriteCount: 0,
      writes: []
    };

    if (!clipboard || !nativeWrite) {
      throw new Error('native-clipboard-write-unavailable');
    }

    const inspectPending = (control) => {
      const busy = control.getAttribute('aria-busy') === 'true'
        || control.getAttribute('aria-disabled') === 'true'
        || control.matches(':disabled')
        || control.dataset.easymdeWechatState === 'pending';
      return {
        busy,
        pending: busy
      };
    };
    const stableErrorCode = (error) => {
      const message = error instanceof Error ? error.message : '';
      return /^wechat-[a-z0-9-]+$/u.test(message) ? message : 'unknown';
    };
    let lastStatusCode = '';

    trace.begin = (mode) => {
      trace.clicks = [];
      trace.lastItems = null;
      trace.mode = mode;
      trace.pendingFrameAt = null;
      trace.release = null;
      trace.reject = null;
      trace.statusEventCountAtStart = trace.statusEvents.length;
      lastStatusCode = '';
      trace.startedAt = performance.now();
      trace.startedWriteCount = trace.writes.length;
    };
    trace.metrics = () => {
      const click = trace.clicks[0];
      const write = trace.writes[trace.startedWriteCount];
      if (!click || !write) throw new Error('wechat-copy-timing-sample-missing');
      return {
        clickCount: trace.clicks.length,
        clickToPendingFrameMs: trace.pendingFrameAt === null
          ? null
          : trace.pendingFrameAt - click.at,
        clickToWriteMs: write.at - click.at,
        writeActivation: write.activation,
        writeCount: trace.writes.length - trace.startedWriteCount,
        writeIndex: trace.startedWriteCount,
        writeNativeState: write.nativeState
      };
    };
    trace.diagnostics = () => ({
      clickActivations: trace.clicks.map(({ active }) => active),
      clickCount: trace.clicks.length,
      mode: trace.mode,
      pendingFrameObserved: trace.pendingFrameAt !== null,
      pendingState: trace.pendingState ?? null,
      statusObserverInstalled: trace.statusObserverInstalled,
      statusCodes: trace.statusEvents.slice(trace.statusEventCountAtStart),
      startedWriteCount: trace.startedWriteCount,
      writeCount: trace.writes.length,
      writeStates: trace.writes.map(({
        activation,
        documentHasFocus,
        htmlBlobDurationMs,
        htmlBlobFailureCode,
        htmlBlobState,
        itemCount,
        nativeState,
        visibilityState
      }) => ({
        activation,
        documentHasFocus,
        htmlBlobDurationMs,
        htmlBlobFailureCode,
        htmlBlobState,
        itemCount,
        nativeState,
        visibilityState
      }))
    });
    trace.releaseCopy = () => {
      if (!trace.release) throw new Error('wechat-copy-release-unavailable');
      trace.release();
      trace.release = null;
    };
    trace.rejectCopy = () => {
      if (!trace.reject) throw new Error('wechat-copy-reject-unavailable');
      trace.reject(new DOMException('Synthetic clipboard rejection', 'NotAllowedError'));
      trace.reject = null;
    };
    trace.readPayload = async () => {
      const item = trace.lastItems?.[0];
      if (!item || typeof item.getType !== 'function') {
        throw new Error('clipboard-item-payload-unavailable');
      }
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const normalized = html.toLowerCase();
      return {
        hasCode: normalized.includes('<pre'),
        hasEditorChrome: normalized.includes('easymde-toolbar')
          || normalized.includes('cm-content'),
        hasFormula: normalized.includes('katex'),
        hasMermaid: normalized.includes('easymde-mermaid'),
        hasScript: normalized.includes('<script'),
        hasTable: normalized.includes('<table')
      };
    };

    globalThis.__easymdeWechatCopyTrace = trace;
    const observeStatus = () => {
      const host = document.querySelector(
        '.easymde-editor > .easymde-editor-message-alert-host'
      );
      const node = host?.querySelector('[role="status"], [role="alert"]');
      if (!(node instanceof HTMLElement)) return;
      const bootstrap = globalThis.EasyMDEEditorRootBootstrap;
      const success = bootstrap?.wechatExport?.strings?.success;
      const failed = bootstrap?.wechatExport?.strings?.failed;
      const text = node.textContent ?? '';
      const code = text === success
        ? 'wechat-success'
        : text === failed
          ? 'wechat-failed'
          : 'other';
      const eventCode = `${node.getAttribute('role') ?? 'unknown'}:${code}`;
      if (eventCode === lastStatusCode) return;
      lastStatusCode = eventCode;
      trace.statusEvents.push(code);
    };
    const installStatusObserver = () => {
      if (trace.statusObserverInstalled) return true;
      if (!document.documentElement) return false;
      const statusObserver = new MutationObserver(observeStatus);
      statusObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'role'],
        characterData: true,
        childList: true,
        subtree: true
      });
      trace.statusObserverInstalled = true;
      return true;
    };
    if (!installStatusObserver()) {
      document.addEventListener('DOMContentLoaded', installStatusObserver, { once: true });
    }
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('.easymde-toolbar-copy-action, .easymde-immersive-wechat')
        : null;
      if (!(target instanceof HTMLElement)) return;

      const clickAt = performance.now();
      trace.clicks.push({
        active: navigator.userActivation?.isActive === true,
        at: clickAt
      });
      const samplePendingFrame = () => {
        if (trace.pendingFrameAt === null && inspectPending(target).pending) {
          trace.pendingFrameAt = performance.now();
          trace.pendingState = inspectPending(target);
          return;
        }
        if (performance.now() - clickAt < 500) requestAnimationFrame(samplePendingFrame);
      };
      requestAnimationFrame(samplePendingFrame);
    }, true);

    Object.defineProperty(clipboard, 'write', {
      configurable: true,
      writable: true,
      value: (items) => {
        const record = {
          activation: navigator.userActivation?.isActive === true,
          at: performance.now(),
          documentHasFocus: document.hasFocus(),
          htmlBlobDurationMs: null,
          htmlBlobFailureCode: null,
          htmlBlobState: 'unavailable',
          itemCount: items?.length ?? null,
          nativeState: 'pending',
          visibilityState: document.visibilityState
        };
        trace.lastItems = items;
        trace.writes.push(record);
        if (trace.mode === 'reject') {
          record.htmlBlobState = 'synthetic-reject';
          record.nativeState = 'rejected';
          return Promise.reject(new DOMException('Synthetic clipboard rejection', 'NotAllowedError'));
        }

        const nativeResult = Promise.resolve(nativeWrite(items));
        const htmlItem = items?.[0];
        if (htmlItem && typeof htmlItem.getType === 'function') {
          const startedAt = performance.now();
          record.htmlBlobState = 'pending';
          try {
            Promise.resolve(htmlItem.getType('text/html')).then(
              () => {
                record.htmlBlobState = 'fulfilled';
                record.htmlBlobDurationMs = performance.now() - startedAt;
              },
              (error) => {
                record.htmlBlobState = 'rejected';
                record.htmlBlobDurationMs = performance.now() - startedAt;
                record.htmlBlobFailureCode = stableErrorCode(error);
              }
            );
          } catch (error) {
            record.htmlBlobState = 'rejected';
            record.htmlBlobDurationMs = performance.now() - startedAt;
            record.htmlBlobFailureCode = stableErrorCode(error);
          }
        }
        nativeResult.then(
          () => { record.nativeState = 'fulfilled'; },
          () => { record.nativeState = 'rejected'; }
        );
        if (trace.mode !== 'deferred') return nativeResult;

        const gate = new Promise((resolve, reject) => {
          trace.release = resolve;
          trace.reject = reject;
        });
        return Promise.all([nativeResult, gate]).then(([result]) => result);
      }
    });
  });
}

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  const preview = page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  );
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect.poll(() => preview.evaluate((root) => (
    typeof root.easymdePreviewSignature === 'string'
      ? root.easymdePreviewSignature
      : ''
  ))).toMatch(new RegExp(`:${markdown.length}$`, 'u'));
  if (expectedText) await expect(preview).toContainText(expectedText);
  await waitForPreviewVisualReadiness(page);
}

async function waitForPreviewVisualReadiness(page) {
  await page.evaluate(async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch {
      throw new Error('wechat-preview-font-readiness-failed');
    }
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-sink-unavailable');
    }
    const images = Array.from(preview.querySelectorAll('img'));
    await Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            reject(new Error('wechat-preview-image-load-failed'));
          };
          image.addEventListener('load', onLoad, { once: true });
          image.addEventListener('error', onError, { once: true });
        });
      }
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch {
          throw new Error('wechat-preview-image-decode-failed');
        }
      }
    }));
    globalThis.__easymdeWechatReadiness = {
      fontsReady: true,
      imageCount: images.length,
      imagesComplete: images.every((image) => image.complete),
      imagesDecoded: true
    };
  });
}

function previewResponseForMarkdown(page, markdown) {
  return page.waitForResponse((response) => {
    const request = response.request();
    if (
      request.method() !== 'POST'
      || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
    ) return false;
    try {
      return request.postDataJSON()?.markdown === markdown;
    } catch {
      return false;
    }
  });
}

async function assertAcceptedMathPreview(page, response) {
  expect(response.status()).toBe(200);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  if (typeof payload.html !== 'string') {
    throw new Error('wechat-preview-response-html-unavailable');
  }
  const responseRoots = await page.evaluate((html) => {
    const preview = new DOMParser().parseFromString(html, 'text/html');
    return {
      block: preview.querySelectorAll('.easymde-math-block').length,
      inline: preview.querySelectorAll('.easymde-math-inline').length,
      total: preview.querySelectorAll('.easymde-math').length
    };
  }, payload.html);
  expect(responseRoots).toEqual({ block: 1, inline: 2, total: 3 });
}

async function assertReadonlyMathProjection(
  surface,
  { editable, nonwindowed, ordinaryParagraphText }
) {
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  await expect(surface).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect(surface.locator('.easymde-math')).toHaveCount(3);
  await expect(surface.locator('.easymde-math-inline')).toHaveCount(2);
  await expect(surface.locator('.easymde-math-block')).toHaveCount(1);
  await expect(surface.locator('.katex')).toHaveCount(3);
  const readOnlyTopLevelCount = await surface.evaluate((root) => (
    [...root.children].filter(
      (child) => child.getAttribute('contenteditable') === 'false'
    ).length
  ));
  expect(readOnlyTopLevelCount).toBe(3);
  if (editable) {
    for (const root of await surface.locator('.easymde-math').all()) {
      await expect(root).toHaveAttribute('contenteditable', 'false');
    }
  } else {
    await expect(surface.locator('.easymde-math-block')).toHaveAttribute(
      'contenteditable',
      'false'
    );
    for (const root of await surface.locator('.easymde-math-inline').all()) {
      await expect(root).not.toHaveAttribute('contenteditable', 'false');
    }
  }
  const ordinaryParagraph = surface.locator('[data-easymde-visual-block-id]').filter({
    hasText: ordinaryParagraphText
  });
  await expect(ordinaryParagraph).toHaveCount(1);
  await expect(ordinaryParagraph).not.toHaveAttribute('contenteditable', 'false');
  if (editable) await expect(surface).toHaveAttribute('contenteditable', 'true');
  if (nonwindowed) {
    await expect(surface.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  }
}

async function collectFailureDiagnostics(page) {
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
      const trace = globalThis.__easymdeWechatCopyTrace;
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
        readiness: globalThis.__easymdeWechatReadiness ?? {
          code: 'preview-visual-readiness-unavailable'
        }
      };
    });
  } catch {
    return { code: 'diagnostics-unavailable' };
  }
}

async function setupZeroWriteProbe(page) {
  await page.evaluate(() => {
    const source = document.querySelector('#easymde-source');
    const compatibility = document.querySelector('#content');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(source instanceof HTMLTextAreaElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-zero-write-surfaces-unavailable');
    }
    const baseline = {
      compatibility: compatibility instanceof HTMLTextAreaElement ? compatibility.value : null,
      preview: preview.innerHTML,
      source: source.value
    };
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
      disconnect() {
        sourceObserver.disconnect();
        previewObserver.disconnect();
      },
      async read() {
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
  });
}

async function readZeroWriteProbe(page) {
  return page.evaluate(() => globalThis.__easymdeWechatZeroWrite.read());
}

async function stopZeroWriteProbe(page) {
  await page.evaluate(() => globalThis.__easymdeWechatZeroWrite.disconnect());
}

async function readRect(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width
    };
  });
}

function expectRectStable(before, after, label) {
  for (const key of ['height', 'left', 'top', 'width']) {
    expect(
      Math.abs(before[key] - after[key]),
      `${label} ${key} changed`
    ).toBeLessThanOrEqual(0.5);
  }
}

async function beginCopy(page, mode) {
  await page.evaluate((nextMode) => {
    const trace = globalThis.__easymdeWechatCopyTrace;
    if (!trace) throw new Error('wechat-copy-trace-unavailable');
    trace.begin(nextMode);
  }, mode);
}

async function focusPageForCopy(page) {
  await page.bringToFront();
  await page.evaluate(() => window.focus());
}

async function movePointerNeutral(page) {
  await page.mouse.move(0, 0);
}

function inspectHeartbeatRequest(request) {
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

async function copyTrace(page) {
  return page.evaluate(() => globalThis.__easymdeWechatCopyTrace.metrics());
}

async function waitForPendingMeasurement(page) {
  await page.waitForFunction(() => (
    globalThis.__easymdeWechatCopyTrace?.pendingFrameAt !== null
  ), undefined, { timeout: 5_000 });
}

async function dismissEditorStatus(page) {
  const host = page.locator('.easymde-editor > .easymde-editor-message-alert-host');
  await waitForVisibleSelector(
    page,
    '.easymde-editor > .easymde-editor-message-alert-host',
    'wechat-editor-status-host-unavailable'
  );
  await host.locator('.easymde-editor-message-alert__close').click();
  await expect(host).toHaveCount(0);
}

test.describe('WeChat copy browser regressions', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.wechatUser = createUser(testSlug(testInfo));
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    if (testInfo.errors.length > 0 || testInfo.status !== testInfo.expectedStatus) {
      const diagnosticsPath = testInfo.outputPath('wechat-copy-failure-diagnostics.json');
      await writeFile(
        diagnosticsPath,
        JSON.stringify({
          ...(await collectFailureDiagnostics(_page)),
          heartbeatRequests: testInfo.wechatHeartbeatRequests ?? []
        }, null, 2),
        'utf8'
      );
      await testInfo.attach('wechat-copy-failure-diagnostics.json', {
        contentType: 'application/json',
        path: diagnosticsPath
      });
    }
    if (testInfo.wechatUser) deleteUserContent(testInfo.wechatUser.id);
  });

  test('keeps split math roots read-only across ordinary and nonwindowed immersive Preview', async ({
    page
  }, testInfo) => {
    await login(page, testInfo.wechatUser);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);

    const initialPreviewResponse = previewResponseForMarkdown(
      page,
      readonlyProjectionMarkdown
    );
    await fillMarkdownAndWaitForPreview(page, readonlyProjectionMarkdown);
    await assertAcceptedMathPreview(page, await initialPreviewResponse);

    const ordinaryPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(ordinaryPreview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await assertReadonlyMathProjection(ordinaryPreview, {
      editable: false,
      nonwindowed: false,
      ordinaryParagraphText: 'Ordinary editable paragraph.'
    });

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', {
      name: immersiveLabels.previewMode,
      exact: true
    }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    await assertReadonlyMathProjection(visualEditor, {
      editable: true,
      nonwindowed: true,
      ordinaryParagraphText: 'Ordinary editable paragraph.'
    });
    const initialSignature = await visualEditor.evaluate(
      (surface) => surface.easymdePreviewSignature ?? ''
    );
    if (!initialSignature) throw new Error('wechat-immersive-preview-signature-unavailable');

    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(sourceEditor).toBeVisible();
    const updatedPreviewResponse = previewResponseForMarkdown(
      page,
      readonlyProjectionUpdatedMarkdown
    );
    await sourceEditor.fill(readonlyProjectionUpdatedMarkdown);
    await expect(page.locator('#easymde-source')).toHaveValue(
      readonlyProjectionUpdatedMarkdown
    );
    await assertAcceptedMathPreview(page, await updatedPreviewResponse);

    await page.getByRole('button', {
      name: immersiveLabels.previewMode,
      exact: true
    }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    const refreshedPreview = page.locator(
      '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
    );
    await expect.poll(() => refreshedPreview.evaluate(
      (surface) => surface.easymdePreviewSignature ?? ''
    )).not.toBe(initialSignature);
    await assertReadonlyMathProjection(refreshedPreview, {
      editable: false,
      nonwindowed: true,
      ordinaryParagraphText: 'Updated ordinary editable paragraph.'
    });
  });

  test('cold medium copy shows pending feedback, coalesces clicks, and preserves the source and Preview', async ({
    context,
    page
  }, testInfo) => {
    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await expect.poll(() => page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.wechatExport.enabled
    )).toBe(true);
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const editorStatus = page.locator('.easymde-editor > .easymde-editor-message-alert-host');
    await expect(copyButton).toHaveCount(1);
    await expect(editorStatus).toHaveCount(0);
    await movePointerNeutral(page);
    const initialRect = await readRect(copyButton);
    await setupZeroWriteProbe(page);

    const postRequests = [];
    page.on('request', (request) => {
      const heartbeat = inspectHeartbeatRequest(request);
      if (heartbeat?.isHeartbeat) {
        testInfo.wechatHeartbeatRequests.push({
          keyNames: heartbeat.keyNames,
          wpAutosave: heartbeat.wpAutosave
        });
        return;
      }
      if (request.method() !== 'POST') return;
      postRequests.push(new URL(request.url()).pathname);
    });
    const copyRequestStart = postRequests.length;
    await beginCopy(page, 'deferred');
    const box = await copyButton.boundingBox();
    if (!box) throw new Error('wechat-copy-button-bounds-unavailable');

    // The timing sample is collected entirely in the page. Playwright only
    // inspects it after the first pending frame, so DOM snapshots cannot add
    // tasks to the measured click-to-write window.
    await Promise.all([
      page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
      page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    ]);
    await waitForPendingMeasurement(page);
    const pendingMetrics = await copyTrace(page);
    await movePointerNeutral(page);
    expect(pendingMetrics.writeCount).toBe(1);
    expect(pendingMetrics.writeActivation).toBe(true);
    expect(pendingMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(pendingMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(copyButton).toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).toHaveAttribute('aria-disabled', 'true');
    await expect(copyButton).toHaveJSProperty('disabled', false);
    await expect(copyButton).toHaveClass(/\bis-pending\b/u);
    expectRectStable(initialRect, await readRect(copyButton), 'pending copy button');

    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[0]?.nativeState
    )).toBe('fulfilled');
    await movePointerNeutral(page);
    expectRectStable(initialRect, await readRect(copyButton), 'successful copy button');
    const successZeroWrite = await readZeroWriteProbe(page);
    expect(successZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    expect(postRequests.slice(copyRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);
    await dismissEditorStatus(page);

    await beginCopy(page, 'deferred');
    await focusPageForCopy(page);
    await copyButton.focus();
    await expect(copyButton).toBeFocused();
    await copyButton.press('Enter');
    await copyButton.press('Enter');
    await waitForPendingMeasurement(page);
    const keyboardSuccessMetrics = await copyTrace(page);
    expect(keyboardSuccessMetrics.clickCount).toBe(2);
    expect(keyboardSuccessMetrics.writeCount).toBe(1);
    expect(keyboardSuccessMetrics.writeActivation).toBe(true);
    expect(keyboardSuccessMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(keyboardSuccessMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(copyButton).toBeFocused();
    await expect(copyButton).toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).toHaveAttribute('aria-disabled', 'true');
    await expect(copyButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), keyboardSuccessMetrics.writeIndex)).toBe('fulfilled');
    await expect(copyButton).toBeFocused();
    await expect(copyButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).not.toBeDisabled();
    expectRectStable(initialRect, await readRect(copyButton), 'keyboard successful copy button');
    await dismissEditorStatus(page);

    await beginCopy(page, 'reject');
    await focusPageForCopy(page);
    await copyButton.focus();
    await expect(copyButton).toBeFocused();
    await copyButton.press('Enter');
    await waitForWechatStatusEvent(page, 'wechat-failed');
    const failureMetrics = await copyTrace(page);
    expect(failureMetrics.clickCount).toBe(1);
    expect(failureMetrics.writeCount).toBe(1);
    expect(failureMetrics.writeActivation).toBe(true);
    expect(failureMetrics.writeNativeState).toBe('rejected');
    await expect(copyButton).toBeFocused();
    await expect(copyButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).not.toBeDisabled();
    await movePointerNeutral(page);
    expectRectStable(initialRect, await readRect(copyButton), 'failed copy button');
    const failureZeroWrite = await readZeroWriteProbe(page);
    expect(failureZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewUnchanged: true,
      sourceUnchanged: true
    });
    expect(postRequests.slice(copyRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);

    await stopZeroWriteProbe(page);
    await testInfo.attach('wechat-copy-cold-medium-timing.json', {
      body: JSON.stringify({
        clickToPendingFrameMs: pendingMetrics.clickToPendingFrameMs,
        clickToWriteMs: pendingMetrics.clickToWriteMs,
        duplicateWriteCount: pendingMetrics.writeCount,
        failureWriteCount: failureMetrics.writeCount,
        fixture: 'medium',
        heartbeatRequests: testInfo.wechatHeartbeatRequests,
        mode: 'cold'
      }, null, 2),
      contentType: 'application/json'
    });
  });

  test('warm full-capability copy keeps rich output and ordinary/immersive feedback stable', async ({
    context,
    page
  }, testInfo) => {
    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));

    // The medium document primes the browser and plugin runtime. The full
    // canonical document below is therefore a warm-cache copy while retaining
    // a real installed-ZIP production path for every request.
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');
    const copyButton = page.locator('.easymde-toolbar-copy-action');
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await copyButton.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(1);
    await waitForWechatStatusEvent(page, 'wechat-success');
    await dismissEditorStatus(page);

    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(preview.locator('table').first()).toBeVisible();
    await expect(preview.locator('pre code').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expect(preview.locator('input[type="checkbox"]:checked').first()).toBeVisible();

    await movePointerNeutral(page);
    const ordinaryRect = await readRect(copyButton);
    await setupZeroWriteProbe(page);
    const postRequests = [];
    page.on('request', (request) => {
      const heartbeat = inspectHeartbeatRequest(request);
      if (heartbeat?.isHeartbeat) {
        testInfo.wechatHeartbeatRequests.push({
          keyNames: heartbeat.keyNames,
          wpAutosave: heartbeat.wpAutosave
        });
        return;
      }
      if (request.method() === 'POST') postRequests.push(new URL(request.url()).pathname);
    });
    const ordinaryRequestStart = postRequests.length;
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await copyButton.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(2);
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[1]?.nativeState
    )).toBe('fulfilled');
    const payload = await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.readPayload());
    expect(payload).toMatchObject({
      hasCode: true,
      hasEditorChrome: false,
      hasFormula: true,
      hasMermaid: true,
      hasScript: false,
      hasTable: true
    });
    expectRectStable(ordinaryRect, await readRect(copyButton), 'warm ordinary copy button');
    const ordinaryZeroWrite = await readZeroWriteProbe(page);
    expect(ordinaryZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    expect(postRequests.slice(ordinaryRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);
    await dismissEditorStatus(page);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    const immersiveButton = page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechat
    });
    await movePointerNeutral(page);
    const immersiveRect = await readRect(immersiveButton);
    const sourceBeforeImmersiveCopy = await page.locator('#easymde-source').inputValue();
    const immersiveRequestStart = postRequests.length;
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    const immersivePendingMetrics = await copyTrace(page);
    await movePointerNeutral(page);
    expect(immersivePendingMetrics.clickCount).toBe(2);
    expect(immersivePendingMetrics.writeCount).toBe(1);
    expect(immersivePendingMetrics.writeActivation).toBe(true);
    expect(immersivePendingMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(immersivePendingMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await expect(immersiveButton).toHaveClass(/\bis-pending\b/u);
    expectRectStable(immersiveRect, await readRect(immersiveButton), 'pending immersive copy button');
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await expect(page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechatCopied
    })).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[2]?.nativeState
    )).toBe('fulfilled');
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    await movePointerNeutral(page);
    expectRectStable(immersiveRect, await readRect(immersiveButton), 'warm immersive copy button');
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeImmersiveCopy);
    expect(postRequests.slice(immersiveRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);

    await stopZeroWriteProbe(page);
    await testInfo.attach('wechat-copy-warm-full-fidelity.json', {
      body: JSON.stringify({
        fixture: 'full-capability',
        ordinary: 'success',
        ordinaryPayload: payload,
        immersive: 'success-after-pending',
        immersiveClickToPendingFrameMs: immersivePendingMetrics.clickToPendingFrameMs,
        immersiveClickToWriteMs: immersivePendingMetrics.clickToWriteMs,
        heartbeatRequests: testInfo.wechatHeartbeatRequests,
        mode: 'warm'
      }, null, 2),
      contentType: 'application/json'
    });
    await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
  });
});
