import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
const copyDiagnosticsEnabled = '1' === process.env.EASYMDE_E2E_COPY_DIAGNOSTICS;
const finiteTransitionsProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_FINITE_TRANSITIONS;
const finitePreviewAnimationsProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_FINITE_PREVIEW_ANIMATIONS;
const positionStrippedFrameProbeEnabled = '1' === process.env.EASYMDE_E2E_PROBE_POSITION_STRIPPED_FRAME;
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
const codeThemeAuthoredFef = '\uFEFF';
const codeThemeFidelityMarkdown = [
  '# Code theme Clipboard fidelity',
  '',
  'This fixture keeps token roles and the final line stable while the code palette changes.',
  '',
  `Body authored FEFF ${codeThemeAuthoredFef} remains in body text, with \`inline${codeThemeAuthoredFef}FEFF\`.`,
  '',
  '```js',
  '// Stable comment token.',
  'const answer = 42;',
  'function greet(name) {',
  '  const message = `Hello ${name}`;',
  '  if (answer > 0) return message;',
  '  return null;',
  '}',
  `const longLastLine = "${'x'.repeat(220)}";`,
  '```',
  '',
  '```css',
  '.sample { color: #336699; margin: 0 auto; }',
  '```',
  '',
  '```html',
  '<section data-state="ready">Rendered code</section>',
  '```'
].join('\n');
const articleThemeFidelityMarkdown = [
  '# Article theme Clipboard fidelity',
  '',
  'A paragraph with **strong**, *emphasis*, ~~deletion~~, `inline code`, and [a link](https://example.test/article).',
  '',
  '> A quote remains part of the same rendered article.',
  '',
  '- first item',
  '- [x] completed item',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| article | stable |',
  '',
  'Inline math: $x^2 + y^2$.',
  '',
  '```js',
  'const articleThemeCode = true;',
  '```',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Finish]',
  '```'
].join('\n');
// Keep this original H1/math/Mermaid profile for the immediate Blue -> Animal
// transition regression. The ordinary article matrix uses the structural style
// profile below so a changed markup shape cannot hide that race.
const articleStyleMatrixMarkdown = [
  '# STYLE-H1 Article style matrix',
  '',
  'STYLE-BODY body text keeps **strong text**, *emphasis*, ~~deletion~~, `STYLE-INLINE-CODE`, and [STYLE-LINK](https://example.test/article-style).',
  '',
  '## STYLE-H2 A long bilingual heading for typography coverage 中文双语标题需要在窄宽度中保持稳定换行',
  '',
  '### STYLE-H3 Heading level three keeps a distinct article scale.',
  '',
  '> STYLE-QUOTE outer quote text remains stable across themes.',
  '>',
  '> > STYLE-NESTED-QUOTE nested quote text remains part of the same article.',
  '',
  '#### STYLE-H4 Heading level four follows the nested quote.',
  '',
  '- STYLE-LIST-OUTER outer list item',
  '  - STYLE-LIST-NESTED nested list item',
  '- [x] STYLE-TASK-DONE completed task item',
  '- [ ] STYLE-TASK-TODO pending task item',
  '',
  '##### STYLE-H5 Heading level five precedes the table.',
  '',
  '| STYLE-TABLE-A | STYLE-TABLE-B | STYLE-TABLE-C | STYLE-TABLE-D | STYLE-TABLE-E | STYLE-TABLE-F |',
  '| --- | --- | --- | --- | --- | --- |',
  '| alpha | beta | gamma | delta | epsilon | zeta |',
  '| one | two | three | four | five | six |',
  '',
  '###### STYLE-H6 Heading level six closes the article structure.',
  '',
  '```js',
  '// STYLE-FENCED-CODE',
  'const articleStyleMatrix = true;',
  '```'
].join('\n');
const articleStyleMatrixSentinels = [
  { id: 'h1', kind: 'heading', text: 'STYLE-H1' },
  { id: 'h2', kind: 'heading', text: 'STYLE-H2' },
  { id: 'h3', kind: 'heading', text: 'STYLE-H3' },
  { id: 'h4', kind: 'heading', text: 'STYLE-H4' },
  { id: 'h5', kind: 'heading', text: 'STYLE-H5' },
  { id: 'h6', kind: 'heading', text: 'STYLE-H6' },
  { id: 'body', kind: 'body', text: 'STYLE-BODY' },
  { id: 'quote', kind: 'quote', text: 'STYLE-QUOTE' },
  { id: 'nestedQuote', kind: 'quote', text: 'STYLE-NESTED-QUOTE' },
  { id: 'table', kind: 'table', text: 'STYLE-TABLE-A' },
  { id: 'link', kind: 'link', text: 'STYLE-LINK' }
];
const nativeClipboardSurfaceWidths = [375, 578, 760];
const widthRegressionMarkdown = [
  '# Width regression fixture',
  '',
  'WIDTH-FLUID alpha keeps a long paragraph inside its own content box while the destination changes width. This sentence deliberately wraps several times to exercise automatic height growth without overlapping the next paragraph.',
  '',
  'WIDTH-FLUID beta follows the first paragraph and keeps authored margins and padding independent from the outer destination width. The text remains readable at narrow and wide destinations.',
  '',
  '![Width regression image](https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png)',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| width-local-scroll-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | local scroll |',
  '| destination-independent-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | independent |',
  '',
  '```js',
  `const widthRegressionLongLine = "${'x'.repeat(240)}";`,
  '```'
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
const pngHiddenPreviewMarkdown = [
  '# Hidden Preview PNG fixture',
  '',
  '## Stable geometry',
  '',
  '> A quote keeps the hidden measurement tree in flow.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| table | stable |',
  '',
  '```js',
  'const hiddenPreview = true;',
  '```',
  '',
  'Inline parent **before** $x^2$ **after**.',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Finish]',
  '```'
].join('\n');
const pngHiddenPreviewUpdatedMarkdown = [
  '# Hidden Preview PNG fixture',
  '',
  'Updated after the hidden Preview refresh.',
  '',
  '## Stable geometry',
  '',
  '> The updated quote remains in the hidden measurement tree.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| table | refreshed |',
  '',
  '```js',
  'const hiddenPreview = false;',
  '```',
  '',
  'Inline parent **before** $x^2$ **after**.',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Updated finish]',
  '```'
].join('\n');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}

function nativePayloadExportDirectory() {
  const directory = process.env.EASYMDE_E2E_NATIVE_THEME_PAYLOAD_DIR?.trim() ?? '';
  if (!directory) return null;
  if (!isAbsolute(directory)) {
    throw new Error('EASYMDE_E2E_NATIVE_THEME_PAYLOAD_DIR must be absolute');
  }
  return directory;
}

function nativePayloadExportKey(kind, entry) {
  if ('code' === kind) return `${entry.codeThemeId}:${entry.mode}`;
  return `${entry.articleThemeId}:${entry.mode}`;
}

function nativePayloadSafeStem(value, label) {
  if ('string' !== typeof value || !/^[a-z0-9_-]+$/u.test(value)) {
    throw new Error(`wechat-native-payload-export-${label}-invalid`);
  }
  return value;
}

function nativeSurfaceFingerprint(surface) {
  return {
    blocks: surface.blocks.map((block) => ({
      characterCount: block.characters.length,
      codeBox: {
        height: block.code.box.height,
        width: block.code.box.width
      },
      frameBox: {
        height: block.frame.box.height,
        width: block.frame.box.width
      },
      frameMarkerCount: block.markers.length,
      lastLine: {
        lineCount: block.lastLine.lineCount,
        textHash: createHash('sha256').update(block.lastLine.text, 'utf8').digest('hex')
      },
      overflow: block.overflow,
      styleHash: createHash('sha256')
        .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
        .digest('hex'),
      tokenClassCount: block.tokenClassCount,
      textHash: createHash('sha256').update(block.text, 'utf8').digest('hex')
    })),
    elements: surface.elements,
    markers: surface.markers,
    root: {
      box: {
        height: surface.root.box.height,
        width: surface.root.box.width
      },
      overflow: surface.root.overflow,
      overflowNodes: surface.root.overflowNodes
    },
    visualSignatures: (surface.visualSignatures ?? []).map((signature) => ({
      id: signature.id,
      inlineStyle: signature.inlineStyle,
      kind: signature.kind,
      ownerHasAnchor: signature.ownerHasAnchor,
      ownerInlineStyle: signature.ownerInlineStyle,
      ownerStyle: signature.ownerStyle,
      ownerStyleHash: createHash('sha256')
        .update(JSON.stringify(signature.ownerStyle), 'utf8')
        .digest('hex'),
      ownerTag: signature.ownerTag,
      paint: signature.paint,
      style: signature.style,
      styleHash: createHash('sha256')
        .update(JSON.stringify(signature.style), 'utf8')
        .digest('hex'),
      textLength: signature.textLength
    }))
  };
}

async function readEditorBuildId(page) {
  const buildId = await page.evaluate(() => {
    const bootstrap = globalThis.EasyMDEAdminEditorLoaderBootstrap;
    const root = document.querySelector('#easymde-editor-root');
    const editor = document.querySelector('#easymde-editor');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (
      !bootstrap
      || 'string' !== typeof bootstrap.mainScriptUrl
      || !root
      || !editor
      || !preview
      || root.querySelector('.easymde-editor-startup-error')
    ) {
      throw new Error('wechat-native-payload-export-build-root-unhealthy');
    }
    let mainScriptUrl;
    try {
      mainScriptUrl = new URL(bootstrap.mainScriptUrl, window.location.href);
    } catch {
      throw new Error('wechat-native-payload-export-build-url-invalid');
    }
    if (mainScriptUrl.origin !== window.location.origin) {
      throw new Error('wechat-native-payload-export-build-url-origin-invalid');
    }
    const mainScriptPath = mainScriptUrl.pathname.split('/').pop() ?? '';
    const match = /^admin-editor-(?!loader-)([a-z0-9_-]+)\.js$/iu.exec(mainScriptPath);
    const mainScript = [...document.scripts].find((script) => {
      try {
        return new URL(script.src, window.location.href).href === mainScriptUrl.href;
      } catch {
        return false;
      }
    });
    if (!match || !mainScript) {
      throw new Error('wechat-native-payload-export-build-main-script-unavailable');
    }
    return match[1];
  });
  if (!buildId) throw new Error('wechat-native-payload-export-build-id-unavailable');
  return buildId;
}

async function createNativePayloadExportState(kind, expectedEntries) {
  const directory = nativePayloadExportDirectory();
  if (!directory) return null;
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const expected = new Set(expectedEntries.map((entry) => nativePayloadExportKey(kind, entry)));
  return {
    directory,
    entries: new Map(),
    expected,
    kind,
    runId: randomUUID()
  };
}

async function recordNativePayloadExport(state, {
  articleThemeId = null,
  buildId,
  codeThemeId = null,
  html,
  mode,
  sourceEvidence,
  width,
  widths
}) {
  if (!state) return;
  const entry = { articleThemeId, codeThemeId, mode };
  const key = nativePayloadExportKey(state.kind, entry);
  if (!state.expected.has(key)) throw new Error(`wechat-native-payload-export-unexpected:${state.kind}`);
  if (state.entries.has(key)) throw new Error(`wechat-native-payload-export-duplicate:${state.kind}`);
  const themeId = 'code' === state.kind ? codeThemeId : articleThemeId;
  const safeThemeId = nativePayloadSafeStem(themeId, 'theme-id');
  const safeMode = nativePayloadSafeStem(mode, 'mode');
  const fileStem = `${state.kind}-${safeThemeId}-${safeMode}`;
  const htmlFile = `${fileStem}.html`;
  const evidenceFile = `${fileStem}.json`;
  const htmlPath = join(state.directory, htmlFile);
  const evidencePath = join(state.directory, evidenceFile);
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const metadata = {
    articleId: articleThemeId,
    articleThemeId,
    buildId,
    codeId: codeThemeId,
    codeThemeId,
    evidenceFile,
    htmlFile,
    hash: htmlSha256,
    htmlSha256,
    id: themeId,
    mode,
    sourceEvidence: nativeSurfaceFingerprint(sourceEvidence),
    width,
    widths
  };
  await writeFile(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
  await chmod(htmlPath, 0o600);
  await writeFile(evidencePath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(evidencePath, 0o600);
  state.entries.set(key, metadata);
}

async function finalizeNativePayloadExport(state) {
  if (!state) return;
  const missing = [...state.expected].filter((key) => !state.entries.has(key));
  const unexpected = [...state.entries.keys()].filter((key) => !state.expected.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(`wechat-native-payload-export-manifest-incomplete:${state.kind}`);
  }
  const manifest = {
    entries: [...state.entries.values()],
    kind: state.kind,
    runId: state.runId,
    schemaVersion: 1,
    status: 'passed'
  };
  const manifestPath = join(state.directory, `${state.kind}-manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(manifestPath, 0o600);
}

function multipartFileDigest(request) {
  const contentType = request.headers()['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/iu);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  const body = request.postDataBuffer();
  if (!boundary || !body) throw new Error('wechat-png-upload-body-unavailable');
  const fileHeader = Buffer.from('Content-Disposition: form-data; name="file";');
  const fileHeaderStart = body.indexOf(fileHeader);
  const fileStartMarker = Buffer.from('\r\n\r\n');
  const fileStart = body.indexOf(fileStartMarker, fileHeaderStart);
  const fileEnd = body.indexOf(
    Buffer.from(`\r\n--${boundary}`),
    fileStart + fileStartMarker.length
  );
  if (fileHeaderStart < 0 || fileStart < 0 || fileEnd < 0) {
    throw new Error('wechat-png-upload-file-part-unavailable');
  }
  return createHash('sha256')
    .update(body.subarray(fileStart + fileStartMarker.length, fileEnd))
    .digest('hex');
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

async function assertPngConversionEnabled(page) {
  await expect.poll(() => page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.wechatExport.pngConversionEnabled
  )).toBe(true);
}

async function installWechatConsoleDiagnostics(page) {
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
    const events = [];
    const methods = ['error', 'info', 'warn'];
    for (const level of methods) {
      const original = console[level];
      console[level] = (...args) => {
        const text = args.length === 1 && 'string' === typeof args[0] ? args[0] : '';
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
    const readPreviewTransitionsAtWrite = () => {
      const preview = document.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      if (!(preview instanceof Element)) return { code: 'preview-unavailable', transitions: [] };
      const expectedThemeId = globalThis.__easymdeImmediateCopyExpectedArticleTheme ?? null;
      const themeField = document.querySelector('#easymde-markdown-theme-field');
      const previewClasses = [...preview.classList]
        .filter((className) => /^easymde-markdown-theme-[a-z0-9_-]+$/iu.test(className))
        .sort();
      const previewState = {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        expectedThemeId,
        refreshing: preview.getAttribute('data-easymde-preview-refreshing'),
        themeClassMatches: expectedThemeId
          ? preview.classList.contains(`easymde-markdown-theme-${expectedThemeId}`)
          : null,
        themeFieldValue: themeField instanceof HTMLInputElement ? themeField.value : null,
        themeClasses: previewClasses
      };
      const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
      const transitions = document.getAnimations()
        .filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          return target instanceof Element
            && previewNodes.has(target)
            && animation.constructor?.name === 'CSSTransition';
        })
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          const transitionProperty = animation.transitionProperty;
          const allowedProperties = new Set([
            'font-family',
            'font-size',
            'font-weight',
            'height',
            'line-height',
            'transform',
            'width'
          ]);
          return {
            currentTime: Number.isFinite(currentTime) ? currentTime : null,
            endTime: Number.isFinite(endTime) ? endTime : null,
            finite: Number.isFinite(currentTime)
              && Number.isFinite(endTime)
              && endTime > currentTime,
            playState: animation.playState,
            property: allowedProperties.has(transitionProperty) ? transitionProperty : 'other',
            targetIndex: target ? [...previewNodes].indexOf(target) : -1
          };
        });
      const animations = document.getAnimations()
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const owner = target instanceof Element
            ? target
            : target?.parentElement ?? target?.element ?? null;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const rawTiming = effect && typeof effect.getTiming === 'function'
            ? effect.getTiming()
            : null;
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          const duration = Number(rawTiming?.duration);
          const iterations = Number(rawTiming?.iterations);
          return {
            animation,
            currentTime,
            duration,
            endTime,
            finite: Number.isFinite(currentTime)
              && Number.isFinite(endTime)
              && Number.isFinite(duration)
              && Number.isFinite(iterations)
              && endTime > currentTime,
            iterations,
            owner,
            pseudoOwner: Boolean(target && !(target instanceof Element)),
            type: animation.constructor?.name ?? 'unknown'
          };
        })
        .filter(({ owner, finite, type }) => (
          owner instanceof Element
          && previewNodes.has(owner)
          && finite
          && type === 'CSSAnimation'
        ))
        .map(({ animation, currentTime, endTime, owner, pseudoOwner, type }) => ({
          currentTimeMs: currentTime,
          endTimeMs: endTime,
          nodeIndex: [...previewNodes].indexOf(owner),
          playState: animation.playState,
          pseudoOwner,
          type
        }));
      return { animations, code: null, preview: previewState, transitions };
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
      clickTransitionsAtClick: trace.clicks.map(({ previewTransitionsAtClick }) => (
        previewTransitionsAtClick ?? { code: 'not-captured', transitions: [] }
      )),
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
        previewTransitionsAtWrite,
        visibilityState
      }) => ({
        activation,
        documentHasFocus,
        htmlBlobDurationMs,
        htmlBlobFailureCode,
        htmlBlobState,
        itemCount,
        nativeState,
        previewTransitionsAtWrite,
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
        imageCount: (normalized.match(/<img\b/gu) ?? []).length,
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
      const failedWithUploads = bootstrap?.wechatExport?.strings?.failedWithUploads;
      const unsupported = bootstrap?.wechatExport?.strings?.unsupported;
      const text = node.textContent ?? '';
      const code = text === success
        ? 'wechat-success'
        : text === failed || text === failedWithUploads || text === unsupported
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
      globalThis.__easymdeImmediateCopySourceProbe?.markClick?.(clickAt);
      globalThis.__easymdeWechatZeroWrite?.captureAtClick?.();
      trace.clicks.push({
        active: navigator.userActivation?.isActive === true,
        at: clickAt,
        copyAvailabilityAtClick: {
          ariaBusy: target.getAttribute('aria-busy'),
          ariaDisabled: target.getAttribute('aria-disabled'),
          nativeDisabled: target instanceof HTMLButtonElement ? target.disabled : null
        },
        previewTransitionsAtClick: readPreviewTransitionsAtWrite()
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
          previewTransitionsAtWrite: { code: 'not-captured', transitions: [] },
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
        record.previewTransitionsAtWrite = readPreviewTransitionsAtWrite();
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

async function capturePreviewStructureDiagnostics(page, failureCode) {
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

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  try {
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
  } catch (error) {
    if (!page.isClosed()) {
      await capturePreviewStructureDiagnostics(
        page,
        'preview-fill-failed'
      );
    }
    throw error;
  }
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

async function setupZeroWriteProbe(page, { baselineAtClick = false } = {}) {
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

async function readZeroWriteProbe(page) {
  return page.evaluate(() => globalThis.__easymdeWechatZeroWrite.read());
}

async function stopZeroWriteProbe(page) {
  await page.evaluate(() => globalThis.__easymdeWechatZeroWrite.disconnect());
}

async function installImmediateCopySourceProbe(page) {
  await page.evaluate(() => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-immediate-copy-source-probe-surfaces-unavailable');
    }
    const stableHash = (value) => {
      let hash = 2166136261;
      for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const finite = (value) => Number.isFinite(value) ? value : null;
    const describe = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const style = {
        display: computed.display,
        fontSize: computed.fontSize,
        height: computed.height,
        lineHeight: computed.lineHeight,
        position: computed.position,
        transform: computed.transform,
        width: computed.width
      };
      return {
        className: element.className,
        connected: element.isConnected,
        id: element.id || null,
        childElementCount: element.childElementCount,
        childNodeCount: element.childNodes.length,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        rect: {
          height: finite(rect.height),
          left: finite(rect.left),
          top: finite(rect.top),
          width: finite(rect.width)
        },
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        styleHash: stableHash(JSON.stringify(style)),
        tag: element.tagName,
        valueLength: element instanceof HTMLTextAreaElement ? element.value.length : null
      };
    };
    const ownerState = () => {
      const root = document.querySelector('#easymde-editor-root');
      const stage = globalThis.__easymdeWechatMatrixStage ?? null;
      const stageShape = stage && typeof stage === 'object'
        ? {
          articleThemeId: stage.articleThemeId ?? null,
          caseId: stage.caseId ?? null,
          codeThemeId: stage.codeThemeId ?? null,
          codeThemeExplicit: stage.codeThemeExplicit ?? null,
          mode: stage.mode ?? null,
          stage: stage.stage ?? null
        }
        : null;
      const ownerShape = {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        previewClass: preview.className,
        refreshing: preview.getAttribute('data-easymde-preview-refreshing'),
        rootClass: root instanceof HTMLElement ? root.className : null,
        sourceClass: source.className
      };
      const anchor = preview.querySelector('a');
      return {
        anchorId: anchor ? nodeIdentity(anchor).id : null,
        ownerHash: stableHash(JSON.stringify(ownerShape)),
        preview: describe(preview),
        readiness: {
          accepted: ownerShape.accepted,
          ariaBusy: ownerShape.ariaBusy,
          error: ownerShape.error,
          refreshing: ownerShape.refreshing
        },
        root: describe(root),
        source: describe(source),
        stage: stageShape,
        stageHash: stableHash(JSON.stringify(stageShape))
      };
    };
    const nodeIds = new WeakMap();
    let nextNodeId = 1;
    const nodeIdentity = (element) => {
      let id = nodeIds.get(element);
      if (!id) {
        id = nextNodeId;
        nextNodeId += 1;
        nodeIds.set(element, id);
      }
      const path = [];
      let current = element;
      while (current && current !== preview && path.length < 12) {
        const parent = current.parentElement;
        path.unshift(parent ? [...parent.children].indexOf(current) : -1);
        current = parent;
      }
      return {
        classHash: stableHash(String(element.className ?? '')),
        id,
        path,
        tag: element.tagName
      };
    };
    const captureThemeCommit = () => {
      const expectedThemeId = globalThis.__easymdeImmediateCopyExpectedArticleTheme ?? null;
      const themeField = document.querySelector('#easymde-markdown-theme-field');
      const previewClasses = [...preview.classList]
        .filter((className) => /^easymde-markdown-theme-[a-z0-9_-]+$/iu.test(className))
        .sort();
      const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
      const allowedProperties = new Set([
        'font-family',
        'font-size',
        'font-weight',
        'height',
        'line-height',
        'transform',
        'width'
      ]);
      const transitions = document.getAnimations()
        .filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          return target instanceof Element
            && previewNodes.has(target)
            && animation.constructor?.name === 'CSSTransition';
        })
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const record = {
            currentTime: Number.isFinite(Number(animation.currentTime))
              ? Number(animation.currentTime)
              : null,
            endTime: Number.isFinite(Number(timing?.endTime))
              ? Number(timing.endTime)
              : null,
            node: target ? nodeIdentity(target) : null,
            playState: animation.playState,
            property: allowedProperties.has(animation.transitionProperty)
              ? animation.transitionProperty
              : 'other',
            startTime: Number.isFinite(Number(animation.startTime))
              ? Number(animation.startTime)
              : null,
            status: 'active'
          };
          animation.finished.then(
            () => {
              record.status = 'finished';
              record.finishedAtMs = finite(performance.now() - startedAt);
            },
            () => {
              record.status = 'cancelled';
              record.cancelledAtMs = finite(performance.now() - startedAt);
            }
          );
          return record;
        });
      return {
        atMs: finite(performance.now() - startedAt),
        expectedThemeId,
        previewClassNames: previewClasses,
        themeFieldValue: themeField instanceof HTMLInputElement ? themeField.value : null,
        transitions
      };
    };
    let themeCommit = null;
    const mutations = [];
    const startedAt = performance.now();
    let clickAtMs = null;
    let clickMutationIndex = null;
    let clickTransitions = null;
    const appendMutations = (records, phaseOverride = null) => {
      for (const record of records) {
        if (mutations.length >= 32) break;
        const target = record.target instanceof HTMLElement
          ? record.target
          : record.target.parentElement;
        const surface = target === source || source.contains(target)
          ? 'source'
          : target === preview || preview.contains(target)
            ? 'preview'
            : 'other';
        const phase = phaseOverride ?? (clickAtMs === null ? 'pre-click' : 'post-click');
        mutations.push({
          addedCount: record.addedNodes.length,
          atMs: finite(performance.now() - startedAt),
          attributeName: record.attributeName && [
            'aria-busy',
            'class',
            'data-easymde-preview-accepted',
            'data-easymde-preview-error',
            'data-easymde-preview-refreshing',
            'style'
          ].includes(record.attributeName)
            ? record.attributeName
            : record.attributeName ? 'other' : null,
          removedCount: record.removedNodes.length,
          phase,
          relativeAtMs: phase === 'post-click' && clickAtMs !== null
            ? finite(performance.now() - clickAtMs)
            : null,
          surface,
          target: describe(target),
          type: record.type
        });
      }
    };
    const observer = new MutationObserver((records) => {
      appendMutations(records);
    });
    observer.observe(source, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    observer.observe(preview, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    globalThis.__easymdeImmediateCopySourceProbe = {
      disconnect() {
        observer.disconnect();
      },
      markClick(at) {
        appendMutations(observer.takeRecords(), 'pre-click');
        clickAtMs = at;
        clickMutationIndex = mutations.length;
        clickTransitions = captureThemeCommit();
      },
      markThemeCommit() {
        if (themeCommit === null) themeCommit = captureThemeCommit();
      },
      read() {
        return {
          after: ownerState(),
          before: globalThis.__easymdeImmediateCopySourceProbe.before,
          clickAtMs,
          clickMutationIndex,
          clickTransitions,
          themeCommit,
          mutations: mutations.slice()
        };
      },
      before: ownerState()
    };
  });
}

async function readImmediateCopySourceProbe(page) {
  return page.evaluate(() => globalThis.__easymdeImmediateCopySourceProbe.read());
}

async function stopImmediateCopySourceProbe(page) {
  await page.evaluate(() => {
    globalThis.__easymdeImmediateCopySourceProbe?.disconnect();
    delete globalThis.__easymdeImmediateCopySourceProbe;
  });
}

async function installPngMeasurementProbe(page) {
  await page.evaluate(() => {
    const measurements = [];
    const fontEvents = [];
    const fontSet = document.fonts ?? null;
    const startedAt = performance.now();
    const fontStatusBeforeFirstLayout = fontSet?.status ?? 'unavailable';
    let firstLayout = null;
    const elapsedMs = (at) => {
      const durationMs = at - startedAt;
      if (!Number.isFinite(durationMs)) {
        throw new Error('wechat-png-measurement-duration-invalid');
      }
      return durationMs;
    };
    const currentFontStatus = () => fontSet?.status ?? 'unavailable';
    const onFontEvent = (event) => {
      if (!(event instanceof Event) || !['loading', 'loadingdone'].includes(event.type)) return;
      const at = performance.now();
      fontEvents.push({ atMs: elapsedMs(at), type: event.type });
    };
    fontSet?.addEventListener('loading', onFontEvent);
    fontSet?.addEventListener('loadingdone', onFontEvent);
    const recordMeasurement = () => {
      const host = document.querySelector('.easymde-wechat-preview-measurement');
      const root = host?.querySelector('article.easymde-preview');
      if (
        !(host instanceof HTMLElement)
        || !(root instanceof HTMLElement)
        || !host.isConnected
        || !root.isConnected
      ) return;
      const rootRect = root.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const at = performance.now();
      if (firstLayout === null) {
        firstLayout = {
          atMs: elapsedMs(at),
          fontStatus: currentFontStatus()
        };
      }
      measurements.push({
        hostWidth: hostRect.width,
        rootHeight: rootRect.height,
        rootWidth: rootRect.width
      });
    };
    const observer = new MutationObserver(() => {
      recordMeasurement();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    globalThis.__easymdePngMeasurementProbe = {
      disconnect() {
        observer.disconnect();
        fontSet?.removeEventListener('loading', onFontEvent);
        fontSet?.removeEventListener('loadingdone', onFontEvent);
      },
      read() {
        return {
          fontReadiness: {
            afterFirstLayout: firstLayout?.fontStatus ?? null,
            beforeFirstLayout: fontStatusBeforeFirstLayout,
            events: fontEvents.slice(),
            firstLayoutDurationMs: firstLayout?.atMs ?? null
          },
          measurements: measurements.slice()
        };
      }
    };
  });
}

async function installPreviewFreshnessProbe(page, { force = false } = {}) {
  if (!copyDiagnosticsEnabled && !force) return;
  await page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-freshness-probe-surface-unavailable');
    }
    const finiteNumber = (value) => Number.isFinite(value) ? value : null;
    const stringHash = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const describeElement = (element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const image = element instanceof HTMLImageElement ? element : null;
      return {
        computedHeight: style.height,
        computedWidth: style.width,
        display: style.display,
        imageComplete: image?.complete ?? null,
        imageNaturalHeight: image?.naturalHeight ?? null,
        imageNaturalWidth: image?.naturalWidth ?? null,
        index,
        numericStyle: {
          fontFamilyHash: stringHash(style.fontFamily),
          fontSize: finiteNumber(Number.parseFloat(style.fontSize)),
          fontWeight: style.fontWeight,
          height: finiteNumber(rect.height),
          lineHeight: finiteNumber(Number.parseFloat(style.lineHeight)),
          transform: style.transform,
          width: finiteNumber(rect.width)
        },
        rectHeight: rect.height,
        rectWidth: rect.width,
        tag: element.tagName,
        visibility: style.visibility
      };
    };
    const describeAnimations = () => {
      if (typeof document.getAnimations !== 'function') return { code: 'animations-unavailable' };
      const nodes = [preview, ...preview.querySelectorAll('*')];
      const allowedTransitionProperties = new Set([
        'font-family',
        'font-size',
        'font-weight',
        'height',
        'line-height',
        'transform',
        'width'
      ]);
      const animations = document.getAnimations()
        .map((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const targetNodeIndex = target instanceof Element ? nodes.indexOf(target) : -1;
          return { animation, effect, targetNodeIndex };
        })
        .filter(({ targetNodeIndex }) => targetNodeIndex >= 0);
      return {
        count: animations.length,
        items: animations.slice(0, 32).map(({ animation, effect, targetNodeIndex }) => {
          const target = effect && 'target' in effect ? effect.target : null;
          const targetStyle = target instanceof Element ? getComputedStyle(target) : null;
          const targetRect = target instanceof Element ? target.getBoundingClientRect() : null;
          const timing = effect?.getTiming?.() ?? {};
          const computedTiming = effect?.getComputedTiming?.() ?? {};
          const transitionProperty = 'transitionProperty' in animation
            && 'string' === typeof animation.transitionProperty
            && allowedTransitionProperties.has(animation.transitionProperty)
            ? animation.transitionProperty
            : 'other';
          return {
            constructorName: animation.constructor?.name ?? null,
            currentTimeMs: finiteNumber(
              'number' === typeof animation.currentTime ? animation.currentTime : null
            ),
            durationMs: finiteNumber(
              'number' === typeof timing.duration ? timing.duration : null
            ),
            effectType: effect?.constructor?.name ?? null,
            endTimeMs: finiteNumber(
              'number' === typeof computedTiming.endTime ? computedTiming.endTime : null
            ),
            playState: animation.playState,
            repeatCount: finiteNumber(
              'number' === typeof timing.iterations ? timing.iterations : null
            ),
            targetNodeIndex,
            transitionProperty,
            targetStyle: targetStyle && targetRect
              ? {
                fontFamilyHash: stringHash(targetStyle.fontFamily),
                fontSize: finiteNumber(Number.parseFloat(targetStyle.fontSize)),
                fontWeight: targetStyle.fontWeight,
                height: finiteNumber(targetRect.height),
                lineHeight: finiteNumber(Number.parseFloat(targetStyle.lineHeight)),
                transform: targetStyle.transform,
                width: finiteNumber(targetRect.width)
              }
              : null
          };
        })
      };
    };
    const describe = () => {
      const elements = [preview, ...preview.querySelectorAll('*')];
      const source = document.querySelector('#easymde-source');
      void preview.offsetHeight;
      void source?.offsetHeight;
      return {
        fontStatus: document.fonts?.status ?? 'unavailable',
        nodes: elements.map(describeElement),
        sourceHtmlHash: stringHash(preview.innerHTML),
        sourceHtmlLength: preview.innerHTML.length
      };
    };
    const baseline = describe();
    const baselineAnimations = describeAnimations();
    const cloneImageReadiness = [];
    const mutations = [];
    const nativeCloneNode = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function cloneNodeWithReadiness(deep) {
      const clone = nativeCloneNode.call(this, deep);
      const sourceImages = this instanceof Element
        ? [this, ...this.querySelectorAll('img')].filter(
          (element) => element instanceof HTMLImageElement
        )
        : [];
      const cloneImages = clone instanceof Element
        ? [clone, ...clone.querySelectorAll('img')].filter(
          (element) => element instanceof HTMLImageElement
        )
        : [];
      for (let index = 0; index < Math.min(sourceImages.length, cloneImages.length); index += 1) {
        const sourceImage = sourceImages[index];
        const cloneImage = cloneImages[index];
        if (cloneImageReadiness.length < 32) {
          cloneImageReadiness.push({
            cloneComplete: cloneImage.complete,
            cloneNaturalHeight: cloneImage.naturalHeight,
            cloneNaturalWidth: cloneImage.naturalWidth,
            sourceComplete: sourceImage.complete,
            sourceNaturalHeight: sourceImage.naturalHeight,
            sourceNaturalWidth: sourceImage.naturalWidth
          });
        }
      }
      return clone;
    };
    const nodeIndex = (element) => (
      element instanceof Element
        ? [preview, ...preview.querySelectorAll('*')].indexOf(element)
        : null
    );
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (mutations.length >= 32) break;
        const target = record.target instanceof Element
          ? record.target
          : record.target.parentElement;
        const targetIndex = nodeIndex(target);
        const targetDescription = target instanceof Element
          && targetIndex !== null
          ? describeElement(target, targetIndex)
          : null;
        mutations.push({
          addedCount: 'childList' === record.type ? record.addedNodes.length : 0,
          attributeName: 'attributes' === record.type ? record.attributeName : null,
          removedCount: 'childList' === record.type ? record.removedNodes.length : 0,
          target: targetDescription,
          type: record.type
        });
      }
    });
    observer.observe(preview, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    const sameNode = (before, after) => (
      before.tag === after.tag
      && Math.abs(before.rectWidth - after.rectWidth) <= 0.01
      && Math.abs(before.rectHeight - after.rectHeight) <= 0.01
      && before.computedWidth === after.computedWidth
      && before.computedHeight === after.computedHeight
      && before.display === after.display
      && before.visibility === after.visibility
      && before.imageComplete === after.imageComplete
      && before.imageNaturalWidth === after.imageNaturalWidth
      && before.imageNaturalHeight === after.imageNaturalHeight
    );
    const firstChangedStyle = (beforeNodes, afterNodes) => {
      const styleProperties = [
        'fontSize',
        'lineHeight',
        'fontWeight',
        'fontFamilyHash',
        'width',
        'height',
        'transform'
      ];
      const limit = Math.min(beforeNodes.length, afterNodes.length);
      for (let index = 0; index < limit; index += 1) {
        const before = beforeNodes[index]?.numericStyle;
        const after = afterNodes[index]?.numericStyle;
        if (!before || !after) continue;
        const changes = styleProperties
          .filter((property) => before[property] !== after[property])
          .map((property) => ({
            after: after[property],
            before: before[property],
            property
          }));
        if (changes.length) return { changes, index };
      }
      return null;
    };
    globalThis.__easymdePreviewFreshnessProbe = {
      awaitFiniteTransitions() {
        const nodes = [preview, ...preview.querySelectorAll('*')];
        const transitions = document.getAnimations().filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          return target instanceof Element
            && nodes.includes(target)
            && animation.constructor?.name === 'CSSTransition';
        });
        return Promise.all(transitions.map((animation) => animation.finished));
      },
      read() {
        const current = describe();
        const currentAnimations = describeAnimations();
        const limit = Math.max(baseline.nodes.length, current.nodes.length);
        let firstDifference = null;
        for (let index = 0; index < limit; index += 1) {
          const before = baseline.nodes[index] ?? null;
          const after = current.nodes[index] ?? null;
          if (before && after && sameNode(before, after)) continue;
          firstDifference = { after, before, index };
          break;
        }
        return {
          baselineFontStatus: baseline.fontStatus,
          baselineNodeCount: baseline.nodes.length,
          baselineAnimations,
          cloneImageReadiness: cloneImageReadiness.slice(),
          currentFontStatus: current.fontStatus,
          currentNodeCount: current.nodes.length,
          currentAnimations,
          firstDifference,
          firstChangedStyle: firstChangedStyle(baseline.nodes, current.nodes),
          mutations: mutations.slice(),
          sourceHtmlHash: current.sourceHtmlHash,
          sourceHtmlLength: current.sourceHtmlLength
        };
      },
      disconnect() {
        observer.disconnect();
        Node.prototype.cloneNode = nativeCloneNode;
      }
    };
  });
}

async function stopPreviewFreshnessProbe(page, { force = false } = {}) {
  if (!copyDiagnosticsEnabled && !force) return;
  await page.evaluate(() => {
    globalThis.__easymdePreviewFreshnessProbe?.disconnect();
    delete globalThis.__easymdePreviewFreshnessProbe;
  });
}

async function setWechatMatrixStage(page, stage) {
  await page.evaluate((nextStage) => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const signature = preview?.easymdePreviewSignature;
    globalThis.__easymdeWechatMatrixStage = {
      ...nextStage,
      previewThemeClasses: preview
        ? [...preview.classList]
          .filter((className) => /easymde-(?:markdown|code)-theme-[a-z0-9_-]+$/iu.test(className))
          .sort()
        : [],
      previewAccepted: preview?.getAttribute('data-easymde-preview-accepted') ?? null,
      previewBusy: preview?.getAttribute('aria-busy') ?? null,
      previewError: preview?.getAttribute('data-easymde-preview-error') ?? null,
      previewRefreshing: preview?.getAttribute('data-easymde-preview-refreshing') ?? null,
      previewSignatureTail: typeof signature === 'string'
        ? signature.match(/:\d+$/u)?.[0] ?? null
        : null,
      sourceLength: source instanceof HTMLTextAreaElement ? source.value.length : null
    };
  }, stage);
}

async function copyNativeMatrixPayload(page, button, stage) {
  await installPreviewFreshnessProbe(page, { force: true });
  await setWechatMatrixStage(page, { ...stage, stage: 'before-native-copy' });
  const payload = await copyNativePayload(page, button);
  await stopPreviewFreshnessProbe(page, { force: true });
  return payload;
}

function summarizeFiniteTransitionSnapshot(snapshot) {
  return {
    animations: snapshot.currentAnimations,
    firstChangedStyle: snapshot.firstChangedStyle,
    fontStatus: snapshot.currentFontStatus,
    nodeCount: snapshot.currentNodeCount,
    sourceHtmlHash: snapshot.sourceHtmlHash,
    sourceHtmlLength: snapshot.sourceHtmlLength
  };
}

async function probeFiniteTransitions(page, caseId) {
  if (!finiteTransitionsProbeEnabled) return null;
  await installPreviewFreshnessProbe(page, { force: true });
  const before = await page.evaluate(() => (
    globalThis.__easymdePreviewFreshnessProbe.read()
  ));
  await page.evaluate(() => globalThis.__easymdePreviewFreshnessProbe.awaitFiniteTransitions());
  const after = await page.evaluate(() => (
    globalThis.__easymdePreviewFreshnessProbe.read()
  ));
  await stopPreviewFreshnessProbe(page, { force: true });
  return {
    after: summarizeFiniteTransitionSnapshot(after),
    before: summarizeFiniteTransitionSnapshot(before),
    caseId,
    sourceHtmlStable: before.sourceHtmlHash === after.sourceHtmlHash
  };
}

async function settlePreviewFiniteTransitions(page) {
  await page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof Element)) throw new Error('wechat-preview-transition-root-unavailable');
    const previewNodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const transitions = document.getAnimations()
      .filter((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        return target instanceof Element
          && previewNodes.has(target)
          && animation.constructor?.name === 'CSSTransition'
          && Number.isFinite(currentTime)
          && Number.isFinite(endTime)
          && endTime > currentTime;
      });
    return Promise.all(transitions.map((animation) => animation.finished));
  });
}

async function readPreviewFiniteAnimationEvidence(page) {
  return page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-animation-evidence-root-unavailable');
    }
    const nodeIds = new WeakMap();
    let nextNodeId = 1;
    const nodeId = (element) => {
      if (!element) return null;
      let id = nodeIds.get(element);
      if (!id) {
        id = nextNodeId;
        nextNodeId += 1;
        nodeIds.set(element, id);
      }
      return id;
    };
    const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const finiteNumber = (value) => Number.isFinite(value) ? value : null;
    const items = document.getAnimations()
      .map((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const owner = target instanceof Element
          ? target
          : target?.parentElement ?? target?.element ?? null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const rawTiming = effect && typeof effect.getTiming === 'function'
          ? effect.getTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        const duration = Number(rawTiming?.duration);
        const iterations = Number(rawTiming?.iterations);
        const type = animation.constructor?.name ?? 'unknown';
        return {
          animation,
          currentTime,
          duration,
          endTime,
          finite: Number.isFinite(currentTime)
            && Number.isFinite(endTime)
            && Number.isFinite(duration)
            && Number.isFinite(iterations)
            && endTime > currentTime,
          iterations,
          owner,
          pseudoOwner: Boolean(target && !(target instanceof Element)),
          target,
          type
        };
      })
      .filter(({ owner, finite, type }) => (
        owner instanceof Element
        && nodes.has(owner)
        && finite
        && ['CSSAnimation', 'CSSTransition'].includes(type)
      ));
    return {
      count: items.length,
      items: items.map(({ animation, currentTime, duration, endTime, iterations, owner, pseudoOwner, type }) => ({
        currentTimeMs: finiteNumber(currentTime),
        endTimeMs: finiteNumber(endTime),
        nodeId: nodeId(owner),
        playState: animation.playState,
        pseudoOwner,
        type
      }))
    };
  });
}

async function settlePreviewFiniteAnimations(page) {
  if (!finitePreviewAnimationsProbeEnabled) return null;
  return page.evaluate(() => {
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-preview-animation-settle-root-unavailable');
    }
    const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
    const animations = document.getAnimations().filter((animation) => {
      const effect = animation.effect;
      const target = effect && 'target' in effect ? effect.target : null;
      const owner = target instanceof Element
        ? target
        : target?.parentElement ?? target?.element ?? null;
      const timing = effect && typeof effect.getComputedTiming === 'function'
        ? effect.getComputedTiming()
        : null;
      const rawTiming = effect && typeof effect.getTiming === 'function'
        ? effect.getTiming()
        : null;
      const currentTime = Number(animation.currentTime);
      const endTime = Number(timing?.endTime);
      const duration = Number(rawTiming?.duration);
      const iterations = Number(rawTiming?.iterations);
      return owner instanceof Element
        && nodes.has(owner)
        && animation.constructor?.name === 'CSSAnimation'
        && Number.isFinite(currentTime)
        && Number.isFinite(endTime)
        && Number.isFinite(duration)
        && Number.isFinite(iterations)
        && endTime > currentTime;
    });
    return Promise.all(animations.map((animation) => animation.finished));
  });
}

async function recordFiniteTransitionProbeCase(testInfo, probeCase, articleThemeId) {
  if (!finiteTransitionsProbeEnabled || !probeCase) return;
  testInfo.wechatFiniteTransitionProbeCases ??= [];
  testInfo.wechatFiniteTransitionProbeCases.push(probeCase);
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'finite-transition-theme-id');
  const path = join(directory, `finite-transition-${safeThemeId}.json`);
  await writeFile(path, `${JSON.stringify(probeCase, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(path, 0o600);
}

async function recordFiniteTransitionFailurePayload({
  articleThemeId,
  caseId,
  codeThemeId,
  html,
  isolated,
  sourceEvidence,
  width
}) {
  if (!finiteTransitionsProbeEnabled) return;
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'finite-transition-failure-theme-id');
  const htmlFile = `finite-transition-failure-${safeThemeId}.html`;
  const evidenceFile = `finite-transition-failure-${safeThemeId}.json`;
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  await writeFile(join(directory, htmlFile), html, { encoding: 'utf8', mode: 0o600 });
  await chmod(join(directory, htmlFile), 0o600);
  await writeFile(join(directory, evidenceFile), `${JSON.stringify({
    articleThemeId,
    caseId,
    codeThemeId,
    htmlFile,
    htmlSha256,
    isolated: isolated.payload.map(({ destinationWidth, surface }) => ({
      destinationWidth,
      surface: nativeSurfaceFingerprint(surface)
    })),
    source: nativeSurfaceFingerprint(sourceEvidence),
    status: 'failure-diagnostic',
    width
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(join(directory, evidenceFile), 0o600);
}

async function recordNativeVisualSignatureFailure({
  articleThemeId,
  destinationWidth,
  html,
  sourceEvidence,
  targetEvidence
}) {
  const directory = nativePayloadExportDirectory();
  if (!directory) return;
  if (!Number.isFinite(destinationWidth) || destinationWidth <= 0) {
    throw new Error('wechat-visual-signature-failure-width-invalid');
  }
  const safeThemeId = nativePayloadSafeStem(articleThemeId, 'visual-signature-failure-theme-id');
  const widthStem = String(Math.round(destinationWidth));
  const htmlFile = `article-visual-signature-failure-${safeThemeId}-${widthStem}.html`;
  const evidenceFile = `article-visual-signature-failure-${safeThemeId}-${widthStem}.json`;
  const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const signature = (surface) => {
    const candidate = (surface.visualSignatures ?? []).find(({ id }) => id === 'link');
    if (!candidate) return null;
    return {
      id: candidate.id,
      inlineStyle: candidate.inlineStyle,
      kind: candidate.kind,
      ownerHasAnchor: candidate.ownerHasAnchor,
      ownerInlineStyle: candidate.ownerInlineStyle,
      ownerStyle: candidate.ownerStyle,
      ownerStyleHash: createHash('sha256')
        .update(JSON.stringify(candidate.ownerStyle), 'utf8')
        .digest('hex'),
      ownerTag: candidate.ownerTag,
      paint: candidate.paint,
      style: candidate.style,
      styleHash: createHash('sha256')
        .update(JSON.stringify(candidate.style), 'utf8')
        .digest('hex'),
      textLength: candidate.textLength
    };
  };
  const htmlPath = join(directory, htmlFile);
  const evidencePath = join(directory, evidenceFile);
  await writeFile(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
  await chmod(htmlPath, 0o600);
  await writeFile(evidencePath, `${JSON.stringify({
    articleThemeId,
    destinationWidth,
    htmlFile,
    htmlSha256,
    source: signature(sourceEvidence),
    status: 'failure-diagnostic',
    target: signature(targetEvidence)
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(evidencePath, 0o600);
}

async function readPngMeasurements(page) {
  return page.evaluate(() => globalThis.__easymdePngMeasurementProbe.read().measurements);
}

async function stopPngMeasurementProbe(page) {
  await page.evaluate(() => globalThis.__easymdePngMeasurementProbe.disconnect());
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

function assertFiniteProjectionNumber(value, label) {
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
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

async function readClipboardPayload(page) {
  return page.evaluate(async () => {
    const item = globalThis.__easymdeWechatCopyTrace?.lastItems?.[0];
    if (!item || typeof item.getType !== 'function') {
      throw new Error('wechat-clipboard-payload-unavailable');
    }
    const readType = async (type) => {
      const blob = await item.getType(type);
      return blob.text();
    };
    return {
      html: await readType('text/html'),
      text: await readType('text/plain')
    };
  });
}

async function copyNativePayload(
  page,
  button,
  {
    baselineAtClick = false,
    keyboard = false,
    skipFocus = false,
    traceAlreadyBegun = false,
    zeroWriteProbeAlreadyArmed = false
  } = {}
) {
  if (!zeroWriteProbeAlreadyArmed) await setupZeroWriteProbe(page, { baselineAtClick });
  if (!skipFocus) {
    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
  }
  if (!traceAlreadyBegun) await beginCopy(page, 'success');
  if (keyboard) await button.press('Enter');
  else if (skipFocus) await button.click({ force: true });
  else await button.click();
  await waitForWechatStatusEvent(page, 'wechat-success');
  const metrics = await copyTrace(page);
  await expect.poll(() => page.evaluate((writeIndex) => (
    globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
  ), metrics.writeIndex)).toBe('fulfilled');
  const zeroWrite = await readZeroWriteProbe(page);
  expect(zeroWrite).toMatchObject({
    compatibilityUnchanged: true,
    previewUnchanged: true,
    sourceUnchanged: true,
    sourceMutations: 0
  });
  await stopZeroWriteProbe(page);
  const payload = await readClipboardPayload(page);
  await dismissEditorStatus(page);
  return { metrics, ...payload };
}

async function readNativeCodeSurfaceEvidence(
  page,
  html = null,
  { signatureSentinels = [], stripPosition = false } = {}
) {
  return page.evaluate(async ({ signatureSentinels, sourceHtml, stripPosition, widths }) => {
    const styleProperties = [
      'color',
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'letterSpacing',
      'lineHeight',
      'textDecorationLine'
    ];
    const frameProperties = [
      'backgroundColor',
      'borderRadius',
      'boxShadow',
      'boxSizing',
      'fontFamily',
      'fontSize',
      'lineHeight',
      'margin',
      'maxWidth',
      'overflowX',
      'overflowY',
      'padding',
      'paddingBottom',
      'paddingLeft',
      'paddingRight',
      'paddingTop',
      'opacity',
      'whiteSpace',
      'wordBreak'
    ];
    const finite = (value, label) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-native-${label}-invalid`);
      return value;
    };
    const normalizeText = (value) => value
      .replaceAll('\u2060', '')
      .replaceAll('\u00a0', ' ');
    const normalizeVisibleCodeText = (value) => normalizeText(value.replaceAll('\uFEFF', ''));
    const textWithBreaks = (node) => {
      if (node.nodeType === 3) return node.nodeValue ?? '';
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'BR') return '\n';
      return [...node.childNodes].map(textWithBreaks).join('');
    };
    const styleVector = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries(styleProperties.map((property) => [property, style[property]]));
    };
    const frameStyle = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries(frameProperties.map((property) => [property, style[property]]));
    };
    const shadowPaint = (element, view) => {
      const rect = element.getBoundingClientRect();
      const shadow = view.getComputedStyle(element).boxShadow;
      let left = rect.left;
      let right = rect.right;
      let top = rect.top;
      let bottom = rect.bottom;
      let shadowCount = 0;
      const pattern = /(-?(?:\d+|\d*\.\d+)px)\s+(-?(?:\d+|\d*\.\d+)px)(?:\s+(-?(?:\d+|\d*\.\d+)px))?(?:\s+(-?(?:\d+|\d*\.\d+)px))?/gu;
      for (const match of shadow.matchAll(pattern)) {
        shadowCount += 1;
        const offsetX = Number.parseFloat(match[1]);
        const offsetY = Number.parseFloat(match[2]);
        const blur = Math.abs(Number.parseFloat(match[3] ?? '0'));
        const spread = Math.abs(Number.parseFloat(match[4] ?? '0'));
        const extent = blur + spread;
        left = Math.min(left, rect.left + offsetX - extent);
        right = Math.max(right, rect.right + offsetX + extent);
        top = Math.min(top, rect.top + offsetY - extent);
        bottom = Math.max(bottom, rect.bottom + offsetY + extent);
      }
      return {
        bottom: finite(bottom, 'marker-paint-bottom'),
        left: finite(left, 'marker-paint-left'),
        right: finite(right, 'marker-paint-right'),
        shadowCount,
        top: finite(top, 'marker-paint-top')
      };
    };
    const box = (element, label) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: finite(rect.bottom, `${label}-bottom`),
        height: finite(rect.height, `${label}-height`),
        left: finite(rect.left, `${label}-left`),
        right: finite(rect.right, `${label}-right`),
        top: finite(rect.top, `${label}-top`),
        width: finite(rect.width, `${label}-width`)
      };
    };
    const readCharacters = (code, view, documentRef) => {
      const characters = [];
      const walker = documentRef.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement ?? code;
        const style = styleVector(parent, view);
        for (const character of node.nodeValue ?? '') {
          if (character === '\u2060' || /\s/u.test(character)) continue;
          characters.push({
            character: '\u00a0' === character ? ' ' : character,
            style
          });
        }
        node = walker.nextNode();
      }
      return characters;
    };
    const readPaintedLines = (code, documentRef) => {
      const lineTops = [];
      let lastRect = null;
      const walker = documentRef.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const value = node.nodeValue ?? '';
        for (let offset = 0; offset < value.length; offset += 1) {
          const character = value[offset];
          if (character === '\u2060' || /\s/u.test(character)) continue;
          const range = documentRef.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.height <= 0) continue;
          const top = finite(rect.top, 'painted-line-top');
          if (!lineTops.some((value) => Math.abs(value - top) <= 0.5)) lineTops.push(top);
          lastRect = rect;
        }
        node = walker.nextNode();
      }
      if (!lastRect) throw new Error('wechat-native-last-glyph-unavailable');
      return { lastRect, paintedLineCount: lineTops.length };
    };
    const signatureStyle = (element, view) => {
      const style = view.getComputedStyle(element);
      return Object.fromEntries([
        'color',
        'fontFamily',
        'fontSize',
        'fontStyle',
        'fontWeight',
        'letterSpacing',
        'lineHeight'
      ].map((property) => [property, style[property]]));
    };
    const inlineStyle = (element) => Object.fromEntries([
      'color',
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'letter-spacing',
      'line-height',
      'text-decoration-line'
    ].map((property) => [property, element.style.getPropertyValue(property)]));
    const findTextRange = (root, needle, documentRef, view) => {
      if ('string' !== typeof needle || !needle) return null;
      const nodes = [];
      const walker = documentRef.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let text = '';
      while (node) {
        const value = node.nodeValue ?? '';
        nodes.push({ end: text.length + value.length, node, start: text.length });
        text += value;
        node = walker.nextNode();
      }
      const start = text.indexOf(needle);
      if (start < 0) return null;
      const end = start + needle.length;
      const startNode = nodes.find(({ end: nodeEnd }) => start < nodeEnd);
      const endNode = nodes.find(({ end: nodeEnd }) => end <= nodeEnd);
      if (!startNode || !endNode) return null;
      const range = documentRef.createRange();
      range.setStart(startNode.node, start - startNode.start);
      range.setEnd(endNode.node, end - endNode.start);
      return { range, textLength: needle.length };
    };
    const readVisualSignatures = (root, view, documentRef) => signatureSentinels.map((sentinel) => {
      if (!sentinel || 'string' !== typeof sentinel.id || 'string' !== typeof sentinel.text) {
        throw new Error('wechat-native-visual-signature-invalid');
      }
      const match = findTextRange(root, sentinel.text, documentRef, view);
      if (!match) throw new Error(`wechat-native-visual-signature-${sentinel.id}-unavailable`);
      const firstElement = match.range.startContainer.parentElement ?? root;
      const candidateAnchor = firstElement.closest('a');
      const ownerHasAnchor = Boolean(
        candidateAnchor
        && root.contains(candidateAnchor)
        && candidateAnchor.contains(match.range.startContainer)
        && candidateAnchor.contains(match.range.endContainer)
      );
      const owner = ownerHasAnchor ? candidateAnchor : firstElement;
      const rects = [...match.range.getClientRects()];
      if (!rects.length) throw new Error(`wechat-native-visual-signature-${sentinel.id}-paint-unavailable`);
      const paint = rects.reduce((bounds, rect) => ({
        bottom: Math.max(bounds.bottom, finite(rect.bottom, `visual-${sentinel.id}-bottom`)),
        left: Math.min(bounds.left, finite(rect.left, `visual-${sentinel.id}-left`)),
        right: Math.max(bounds.right, finite(rect.right, `visual-${sentinel.id}-right`)),
        top: Math.min(bounds.top, finite(rect.top, `visual-${sentinel.id}-top`))
      }), {
        bottom: Number.NEGATIVE_INFINITY,
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        top: Number.POSITIVE_INFINITY
      });
      return {
        id: sentinel.id,
        kind: sentinel.kind,
        inlineStyle: inlineStyle(firstElement),
        ownerHasAnchor,
        ownerInlineStyle: inlineStyle(owner),
        ownerStyle: signatureStyle(owner, view),
        ownerTag: owner.tagName,
        paint: {
          bottom: paint.bottom,
          height: finite(paint.bottom - paint.top, `visual-${sentinel.id}-height`),
          left: paint.left,
          right: paint.right,
          top: paint.top,
          width: finite(paint.right - paint.left, `visual-${sentinel.id}-width`)
        },
        style: {
          ...signatureStyle(firstElement, view),
          textDecorationLine: view.getComputedStyle(owner).textDecorationLine
        },
        textLength: match.textLength
      };
    });
    const safeLength = (value) => {
      const normalized = value.trim();
      if (normalized === 'auto' || normalized === 'none' || normalized === 'max-content') {
        return normalized;
      }
      const parts = normalized.split(/\s+/u);
      if (!parts.length || parts.some((part) => !/^-?(?:\d+|\d*\.\d+)px$/u.test(part))) {
        return 'other';
      }
      return parts.map((part) => Number.parseFloat(part));
    };
    const safeEnum = (value, values) => values.has(value) ? value : 'other';
    const collect = (root, view, documentRef, label) => {
      if (!root || root.nodeType !== 1) throw new Error(`wechat-native-${label}-root-unavailable`);
      const rootBox = box(root, `${label}-root`);
      const rootStyle = frameStyle(root, view);
      const rootOverflow = {
        clientWidth: finite(root.clientWidth, `${label}-root-client-width`),
        scrollWidth: finite(root.scrollWidth, `${label}-root-scroll-width`),
        scrollHeight: finite(root.scrollHeight, `${label}-root-scroll-height`),
        clientHeight: finite(root.clientHeight, `${label}-root-client-height`)
      };
      const overflowNodes = rootOverflow.scrollWidth - rootOverflow.clientWidth > 1
        ? [root, ...root.querySelectorAll('*')]
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const style = view.getComputedStyle(element);
            const overflowDelta = finite(
              element.scrollWidth - element.clientWidth,
              `${label}-overflow-node-${index}`
            );
            const relativeLeft = finite(rect.left - rootBox.left, `${label}-overflow-left-${index}`);
            const relativeRight = finite(rect.right - rootBox.left, `${label}-overflow-right-${index}`);
            const width = finite(rect.width, `${label}-overflow-width-${index}`);
            const height = finite(rect.height, `${label}-overflow-height-${index}`);
            const outside = relativeLeft < -1 || relativeRight > rootBox.width + 1;
            return {
              candidate: overflowDelta > 1 || outside,
              geometry: {
                computedMaxWidth: safeLength(style.maxWidth),
                computedMinWidth: safeLength(style.minWidth),
                computedWidth: safeLength(style.width),
                display: safeEnum(style.display, new Set([
                  'block', 'contents', 'flex', 'grid', 'inline', 'inline-block', 'none', 'table'
                ])),
                height,
                margin: safeLength(style.margin),
                overflowDelta,
                overflowX: safeEnum(style.overflowX, new Set(['auto', 'clip', 'hidden', 'scroll', 'visible'])),
                overflowY: safeEnum(style.overflowY, new Set(['auto', 'clip', 'hidden', 'scroll', 'visible'])),
                padding: safeLength(style.padding),
                relativeLeft,
                relativeRight,
                width
              },
              index,
              score: Math.max(overflowDelta, outside ? Math.max(-relativeLeft, relativeRight - rootBox.width) : 0),
              tag: element.tagName
            };
          })
          .filter(({ candidate }) => candidate)
          .sort((first, second) => second.score - first.score)
          .slice(0, 10)
          .map(({ geometry, index, tag }) => ({ geometry, index, tag }))
        : [];
      const codeBlocks = [...root.querySelectorAll('pre > code')].map((code, index) => {
        const pre = code.parentElement;
        if (!pre || pre.nodeType !== 1) throw new Error(`wechat-native-${label}-frame-unavailable`);
        const codeBox = box(code, `${label}-code-${index}`);
        const preBox = box(pre, `${label}-pre-${index}`);
        const codeText = normalizeVisibleCodeText(textWithBreaks(code));
        const lineElements = [...code.children].filter(
          (element) => element.nodeType === 1 && element.tagName === 'NOBR'
        );
        const lastLine = [...lineElements].reverse().find(
          (element) => normalizeText(element.textContent ?? '').trim() !== ''
        ) ?? code;
        const paintedLines = readPaintedLines(code, documentRef);
        const headerElement = [...pre.children]
          .find((element) => element.nodeType === 1
            && element.tagName === 'DIV'
            && element.getAttribute('aria-hidden') === 'true') ?? null;
        const markerElements = headerElement
          ? [...headerElement.children]
            .filter((element) => element.nodeType === 1)
            .filter((element) => element.getAttribute('aria-hidden') === 'true')
          : [...pre.children]
            .filter((element) => element.nodeType === 1)
            .filter((element) => element.getAttribute('aria-hidden') === 'true');
        const markers = markerElements
          .map((element, markerIndex) => ({
            box: box(element, `${label}-marker-${index}-${markerIndex}`),
            paint: shadowPaint(element, view),
            style: frameStyle(element, view)
          }));
        const pseudo = view.getComputedStyle(pre, '::before');
        const pseudoMarker = documentRef.createElement('span');
        [
          'background-color',
          'border-radius',
          'box-shadow',
          'box-sizing',
          'bottom',
          'display',
          'height',
          'left',
          'margin',
          'opacity',
          'padding',
          'position',
          'right',
          'top',
          'visibility',
          'width'
        ].forEach((property) => {
          const value = pseudo.getPropertyValue(property);
          if (value) pseudoMarker.style.setProperty(property, value);
        });
        pre.append(pseudoMarker);
        const pseudoBox = box(pseudoMarker, `${label}-pseudo-${index}`);
        const pseudoPaint = shadowPaint(pseudoMarker, view);
        pseudoMarker.remove();
        return {
          code: {
            box: codeBox,
            style: frameStyle(code, view)
          },
          characters: readCharacters(code, view, documentRef),
          frame: {
            box: preBox,
            style: frameStyle(pre, view),
            pseudo: {
              backgroundColor: pseudo.backgroundColor,
              borderRadius: pseudo.borderRadius,
              boxShadow: pseudo.boxShadow,
              content: pseudo.content,
              height: pseudo.height,
              left: pseudo.left,
              opacity: pseudo.opacity,
              position: pseudo.position,
              top: pseudo.top,
              width: pseudo.width,
              box: pseudoBox,
              paint: pseudoPaint
            },
            header: headerElement
              ? {
                box: box(headerElement, `${label}-header-${index}`),
                style: frameStyle(headerElement, view)
              }
              : null
          },
          index,
          lastLine: {
            box: box(lastLine, `${label}-last-line-${index}`),
            lineCount: paintedLines.paintedLineCount,
            rect: {
              bottom: finite(paintedLines.lastRect.bottom, `${label}-last-line-bottom-${index}`),
              height: finite(paintedLines.lastRect.height, `${label}-last-line-height-${index}`),
              left: finite(paintedLines.lastRect.left, `${label}-last-line-left-${index}`),
              right: finite(paintedLines.lastRect.right, `${label}-last-line-right-${index}`),
              top: finite(paintedLines.lastRect.top, `${label}-last-line-top-${index}`),
              width: finite(paintedLines.lastRect.width, `${label}-last-line-width-${index}`)
            },
            text: [...codeText.split('\n')]
              .reverse()
              .find((line) => line.trim() !== '') ?? ''
          },
          markers,
          overflow: {
            code: finite(code.scrollWidth - code.clientWidth, `${label}-code-overflow-${index}`),
            frame: finite(pre.scrollWidth - pre.clientWidth, `${label}-frame-overflow-${index}`),
            owner: pre.scrollWidth > pre.clientWidth + 1
              ? 'pre'
              : code.scrollWidth > code.clientWidth + 1
                ? 'code'
                : 'none',
            root: finite(root.scrollWidth - root.clientWidth, `${label}-root-overflow-${index}`)
          },
          text: codeText,
          tokenClassCount: code.querySelectorAll('[class*="hljs-"]').length
        };
      });
      return {
        blocks: codeBlocks,
        elements: {
          anchors: root.querySelectorAll('a').length,
          codeBlocks: codeBlocks.length,
          headingLevels: Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [
            `h${level}`,
            root.querySelectorAll(`h${level}`).length
          ])),
          headings: root.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
          inlineCode: [...root.querySelectorAll('code')]
            .filter((element) => !element.closest('pre')).length,
          links: root.querySelectorAll('a').length,
          orderedLists: root.querySelectorAll('ol').length,
          quoteTextPresent: (
            root.textContent?.includes('A quote remains part of the same rendered article.')
            || root.textContent?.includes('STYLE-QUOTE')
          ) ?? false,
          svg: root.querySelectorAll('svg').length,
          tables: root.querySelectorAll('table').length,
          tableColumnCounts: [...root.querySelectorAll('table')].map(
            (table) => table.rows[0]?.cells.length ?? 0
          ),
          taskCheckboxes: root.querySelectorAll('input[type="checkbox"]').length,
          unorderedLists: root.querySelectorAll('ul').length
        },
        visualSignatures: readVisualSignatures(root, view, documentRef),
        markers: [
          'data-easymde-editor-owner',
          'data-easymde-document-owner',
          'data-easymde-layout-owner',
          'data-easymde-preview-html-sink'
        ].filter((attribute) => root.hasAttribute(attribute)),
        root: {
          box: rootBox,
          overflowNodes,
          overflow: rootOverflow,
          style: rootStyle
        }
      };
    };

    if (typeof sourceHtml !== 'string') {
      const root = document.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      if (!root || root.nodeType !== 1) throw new Error('wechat-native-source-root-unavailable');
      return { source: collect(root, window, document, 'source') };
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'height:2400px',
      'border:0',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    document.body.append(iframe);
    try {
      await new Promise((resolve, reject) => {
        iframe.addEventListener('load', resolve, { once: true });
        iframe.addEventListener('error', () => reject(new Error('wechat-native-isolated-frame-load-failed')), { once: true });
        iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
      });
      const documentRef = iframe.contentDocument;
      const view = iframe.contentWindow;
      if (!documentRef?.body || !view) throw new Error('wechat-native-isolated-frame-document-unavailable');
      documentRef.documentElement.style.cssText = 'margin:0;padding:0;width:100%;';
      documentRef.body.style.cssText = 'margin:0;padding:0;width:100%;';
      documentRef.body.innerHTML = sourceHtml;
      const root = documentRef.body.firstElementChild;
      if (!root || root.nodeType !== 1) throw new Error('wechat-native-payload-root-unavailable');
      if (stripPosition) {
        root.querySelectorAll('pre > [aria-hidden="true"], pre > [aria-hidden="true"] *')
          .forEach((element) => {
            if (element.nodeType !== 1) return;
            ['position', 'top', 'right', 'bottom', 'left'].forEach((property) => {
              element.style.removeProperty(property);
            });
          });
      }
      const payload = [];
      for (const width of widths) {
        if (!Number.isFinite(width) || width <= 0) throw new Error('wechat-native-destination-width-invalid');
        iframe.style.width = `${width}px`;
        documentRef.documentElement.style.width = `${width}px`;
        documentRef.body.style.width = `${width}px`;
        if (documentRef.fonts?.ready) await documentRef.fonts.ready;
        const images = [...documentRef.querySelectorAll('img')];
        await Promise.all(images.map(async (image) => {
          if (!image.complete) {
            await new Promise((resolve, reject) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', () => reject(new Error('wechat-native-payload-image-load-failed')), { once: true });
            });
          }
          if (typeof image.decode === 'function') await image.decode();
        }));
        await new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
        payload.push({
          destinationWidth: width,
          fontStatus: documentRef.fonts?.status ?? 'unavailable',
          surface: collect(root, view, documentRef, `payload-${width}`)
        });
      }
      return { payload };
    } finally {
      iframe.remove();
    }
  }, {
    signatureSentinels,
    sourceHtml: html,
    stripPosition,
    widths: nativeClipboardSurfaceWidths
  });
}

function assertNativeCodeSurface(sourceEvidence, targetEvidence, label, { requireLongLine = true } = {}) {
  const consumeOneTerminalBreak = (value) => value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n') || value.endsWith('\r')
      ? value.slice(0, -1)
      : value;
  const cssPixels = (value, property) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`wechat-native-${property}-not-finite`);
    return parsed;
  };
  const closeTo = (actual, expected, message) => {
    expect(
      Math.abs(actual - expected),
      message
    ).toBeLessThanOrEqual(0.5);
  };
  expect(targetEvidence.markers, `${label} payload ownership markers`).toEqual([]);
  expect(targetEvidence.blocks, `${label} code block count`)
    .toHaveLength(sourceEvidence.blocks.length);
  for (const sourceBlock of sourceEvidence.blocks) {
    const targetBlock = targetEvidence.blocks[sourceBlock.index];
    expect(targetBlock, `${label} code block ${sourceBlock.index}`).toBeDefined();
    expect(targetBlock.text, `${label} code text ${sourceBlock.index}`)
      .toBe(consumeOneTerminalBreak(sourceBlock.text));
    expect(sourceBlock.tokenClassCount, `${label} source token classes ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(targetBlock.characters, `${label} token style vectors ${sourceBlock.index}`)
      .toEqual(sourceBlock.characters);
    expect(targetBlock.frame.style.backgroundColor, `${label} frame background ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.backgroundColor);
    expect(targetBlock.frame.style.borderRadius, `${label} frame radius ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.borderRadius);
    expect(targetBlock.frame.style.boxShadow, `${label} frame shadow ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.boxShadow);
    expect(targetBlock.frame.style.paddingTop, `${label} frame top padding ${sourceBlock.index}`)
      .toBe('0px');
    for (const side of ['paddingRight', 'paddingBottom', 'paddingLeft']) {
      expect(targetBlock.frame.style[side], `${label} frame ${side} ${sourceBlock.index}`)
        .toBe(sourceBlock.frame.style[side]);
    }
    expect(targetBlock.frame.style.opacity, `${label} frame opacity ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.opacity);
    expect(
      Math.abs(targetBlock.frame.box.height - sourceBlock.frame.box.height),
      `${label} frame paint height ${sourceBlock.index}`
    ).toBeLessThanOrEqual(0.5);
    expect(targetBlock.code.style.fontFamily, `${label} code font family ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.fontFamily);
    expect(targetBlock.code.style.fontSize, `${label} code font size ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.fontSize);
    expect(targetBlock.code.style.lineHeight, `${label} code line height ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.lineHeight);
    expect(targetBlock.markers, `${label} frame markers ${sourceBlock.index}`)
      .toHaveLength(1);
    const marker = targetBlock.markers[0];
    expect(marker.style.backgroundColor, `${label} marker color ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.backgroundColor);
    expect(marker.style.borderRadius, `${label} marker radius ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.borderRadius);
    expect(marker.style.boxShadow, `${label} marker shadow ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.boxShadow);
    expect(marker.style.opacity, `${label} marker opacity ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.opacity);
    expect(marker.box.width, `${label} marker width ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(marker.box.height, `${label} marker height ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(marker.paint.shadowCount, `${label} marker dot shadows ${sourceBlock.index}`)
      .toBe(2);
    expect(marker.paint.left, `${label} marker paint left ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.frame.box.left - 1);
    expect(marker.paint.right, `${label} marker paint right ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.right + 1);
    expect(marker.paint.top, `${label} marker paint top ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.frame.box.top - 1);
    expect(marker.paint.bottom, `${label} marker paint bottom ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.bottom + 1);
    expect(targetBlock.frame.header, `${label} normal-flow frame header ${sourceBlock.index}`)
      .not.toBeNull();
    const header = targetBlock.frame.header;
    if (!header) throw new Error(`wechat-native-${label}-frame-header-unavailable`);
    closeTo(
      header.box.height,
      cssPixels(sourceBlock.frame.style.paddingTop, 'source-frame-padding-top'),
      `${label} header height ${sourceBlock.index}`
    );
    closeTo(
      targetBlock.code.box.top - targetBlock.frame.box.top,
      sourceBlock.code.box.top - sourceBlock.frame.box.top,
      `${label} code offset ${sourceBlock.index}`
    );
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const frameAnchor = edge === 'left' || edge === 'right' ? 'left' : 'top';
      closeTo(
        targetBlock.markers[0].paint[edge] - targetBlock.frame.box[frameAnchor],
        sourceBlock.frame.pseudo.paint[edge] - sourceBlock.frame.box[frameAnchor],
        `${label} marker paint ${edge} ${sourceBlock.index}`
      );
    }
    expect(targetBlock.lastLine.text, `${label} last line text ${sourceBlock.index}`)
      .toBe(sourceBlock.lastLine.text);
    expect(targetBlock.lastLine.lineCount, `${label} line count ${sourceBlock.index}`)
      .toBe(sourceBlock.lastLine.lineCount);
    expect(targetBlock.lastLine.rect.bottom, `${label} last line bottom ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.bottom + 1);
    expect(targetBlock.lastLine.rect.top, `${label} last line top ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.code.box.top - 1);
    const sourceLastGlyphGap = sourceBlock.frame.box.bottom - sourceBlock.lastLine.rect.bottom;
    const targetLastGlyphGap = targetBlock.frame.box.bottom - targetBlock.lastLine.rect.bottom;
    expect(
      Math.abs(targetLastGlyphGap - sourceLastGlyphGap),
      `${label} last glyph frame gap ${sourceBlock.index}`
    ).toBeLessThanOrEqual(0.5);
    expect(targetBlock.overflow.root, `${label} article overflow ${sourceBlock.index}`)
      .toBeLessThanOrEqual(1);
    if (requireLongLine && sourceBlock.index === 0) {
      expect(targetBlock.overflow.owner, `${label} long-line overflow owner`)
        .toMatch(/^(?:pre|code)$/u);
    }
  }
}

function assertNativeArticleSurface(sourceEvidence, targetEvidence, label) {
  for (const property of [
    'anchors',
    'codeBlocks',
    'headingLevels',
    'headings',
    'inlineCode',
    'links',
    'orderedLists',
    'svg',
    'tables',
    'tableColumnCounts',
    'taskCheckboxes',
    'unorderedLists'
  ]) {
    expect(targetEvidence.elements[property], `${label} ${property}`)
      .toEqual(sourceEvidence.elements[property]);
  }
  expect(sourceEvidence.elements.quoteTextPresent, `${label} source quote sentinel`)
    .toBe(true);
  expect(targetEvidence.elements.quoteTextPresent, `${label} payload quote sentinel`)
    .toBe(true);
  expect(targetEvidence.root.overflow.scrollWidth - targetEvidence.root.overflow.clientWidth,
    `${label} root horizontal overflow`).toBeLessThanOrEqual(1);
  expect(targetEvidence.root.box.width, `${label} root width`).toBeGreaterThan(0);
  assertNativeCodeSurface(sourceEvidence, targetEvidence, label, { requireLongLine: false });
}

function assertNativeVisualSignatures(sourceEvidence, targetEvidence, label) {
  const sourceSignatures = sourceEvidence.visualSignatures ?? [];
  const targetById = new Map(
    (targetEvidence.visualSignatures ?? []).map((signature) => [signature.id, signature])
  );
  expect(targetById.size, `${label} visual signature count`).toBe(sourceSignatures.length);
  for (const sourceSignature of sourceSignatures) {
    const targetSignature = targetById.get(sourceSignature.id);
    expect(targetSignature, `${label} visual signature ${sourceSignature.id}`).toBeDefined();
    if (!targetSignature) throw new Error(`wechat-native-${label}-visual-signature-unavailable`);
    expect(targetSignature.kind, `${label} visual kind ${sourceSignature.id}`)
      .toBe(sourceSignature.kind);
    expect(targetSignature.ownerHasAnchor, `${label} visual anchor owner ${sourceSignature.id}`)
      .toBe(sourceSignature.ownerHasAnchor);
    if (sourceSignature.ownerHasAnchor) {
      expect(targetSignature.ownerTag, `${label} visual owner tag ${sourceSignature.id}`)
        .toBe(sourceSignature.ownerTag);
    }
    expect(targetSignature.textLength, `${label} visual text length ${sourceSignature.id}`)
      .toBe(sourceSignature.textLength);
    expect(targetSignature.style, `${label} visual style ${sourceSignature.id}`)
      .toEqual(sourceSignature.style);
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      expect(
        Number.isFinite(targetSignature.paint[edge]),
        `${label} visual paint ${sourceSignature.id}/${edge}`
      ).toBe(true);
    }
  }
}

function assertPositionStrippedCodeSurface(normalEvidence, strippedEvidence, label) {
  expect(strippedEvidence.markers, `${label} stripped payload ownership markers`).toEqual([]);
  expect(strippedEvidence.blocks, `${label} stripped code block count`)
    .toHaveLength(normalEvidence.blocks.length);
  for (const normalBlock of normalEvidence.blocks) {
    const strippedBlock = strippedEvidence.blocks[normalBlock.index];
    expect(strippedBlock, `${label} stripped code block ${normalBlock.index}`).toBeDefined();
    if (!strippedBlock) throw new Error(`wechat-native-${label}-stripped-code-block-unavailable`);
    expect(strippedBlock.text, `${label} stripped code text ${normalBlock.index}`)
      .toBe(normalBlock.text);
    expect(strippedBlock.characters, `${label} stripped token style vectors ${normalBlock.index}`)
      .toEqual(normalBlock.characters);
    for (const part of ['frame', 'code']) {
      for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
        expect(
          Math.abs(strippedBlock[part].box[edge] - normalBlock[part].box[edge]),
          `${label} stripped ${part} ${edge} ${normalBlock.index}`
        ).toBeLessThanOrEqual(0.5);
      }
    }
    expect(strippedBlock.frame.header, `${label} stripped normal-flow header ${normalBlock.index}`)
      .not.toBeNull();
    expect(normalBlock.frame.header, `${label} normal-flow header ${normalBlock.index}`)
      .not.toBeNull();
    const normalHeader = normalBlock.frame.header;
    const strippedHeader = strippedBlock.frame.header;
    if (!normalHeader || !strippedHeader) {
      throw new Error(`wechat-native-${label}-stripped-frame-header-unavailable`);
    }
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      expect(
        Math.abs(strippedHeader.box[edge] - normalHeader.box[edge]),
        `${label} stripped header ${edge} ${normalBlock.index}`
      ).toBeLessThanOrEqual(0.5);
    }
    const normalMarker = normalBlock.markers[0];
    const strippedMarker = strippedBlock.markers[0];
    expect(strippedBlock.markers, `${label} stripped frame markers ${normalBlock.index}`)
      .toHaveLength(1);
    if (!normalMarker || !strippedMarker) {
      throw new Error(`wechat-native-${label}-stripped-marker-unavailable`);
    }
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      expect(
        Math.abs(
          (strippedMarker.paint[edge] - strippedBlock.frame.box[edge])
          - (normalMarker.paint[edge] - normalBlock.frame.box[edge])
        ),
        `${label} stripped marker paint ${edge} ${normalBlock.index}`
      ).toBeLessThanOrEqual(0.5);
    }
    expect(strippedBlock.frame.style.paddingTop, `${label} stripped frame top padding ${normalBlock.index}`)
      .toBe(normalBlock.frame.style.paddingTop);
  }
}

async function projectWidthPayload(page, html, widths) {
  return page.evaluate(async ({ sourceHtml, destinationWidths }) => {
    const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const sourceRoot = parsed.body.firstElementChild;
    if (!(sourceRoot instanceof HTMLElement)) {
      throw new Error('wechat-width-projection-root-unavailable');
    }
    const parsePixels = (value) => {
      const parsedValue = Number.parseFloat(value);
      return Number.isFinite(parsedValue) ? parsedValue : 0;
    };
    const overlap = (first, second) => (
      first.left < second.right - 0.5
      && second.left < first.right - 0.5
      && first.top < second.bottom - 0.5
      && second.top < first.bottom - 0.5
    );
    const readMetrics = (element) => {
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        computedHeight: computed.height,
        computedMaxWidth: computed.maxWidth,
        computedMinWidth: computed.minWidth,
        computedWidth: computed.width,
        height: rect.height,
        margin: computed.margin,
        padding: computed.padding,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        top: rect.top,
        width: rect.width
      };
    };
    const readRoot = (root, container, destinationWidth) => {
      const rootRect = root.getBoundingClientRect();
      const containerStyle = getComputedStyle(container);
      const containerAvailableWidth = container.clientWidth
        - parsePixels(containerStyle.paddingLeft)
        - parsePixels(containerStyle.paddingRight);
      const paragraphs = [...root.querySelectorAll('p')]
        .filter((paragraph) => paragraph.textContent?.includes('WIDTH-FLUID'))
        .map((paragraph) => {
          const rect = paragraph.getBoundingClientRect();
          const parent = paragraph.parentElement;
          const parentStyle = parent ? getComputedStyle(parent) : null;
          const paragraphStyle = getComputedStyle(paragraph);
          const available = parent && parentStyle
            ? parent.clientWidth
              - parsePixels(parentStyle.paddingLeft)
              - parsePixels(parentStyle.paddingRight)
              - parsePixels(paragraphStyle.marginLeft)
              - parsePixels(paragraphStyle.marginRight)
            : null;
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const textRects = [...range.getClientRects()].map((textRect) => ({
            bottom: textRect.bottom,
            left: textRect.left,
            right: textRect.right,
            top: textRect.top
          }));
          return {
            autoHeight: paragraph.scrollHeight <= paragraph.clientHeight + 1,
            contentFillDelta: null === available ? null : rect.width - available,
            height: rect.height,
            lineHeight: parsePixels(paragraphStyle.lineHeight),
            textRectCount: textRects.length,
            textRects
          };
        });
      let textRectOverlapCount = 0;
      for (let first = 0; first < paragraphs.length; first += 1) {
        for (let second = first + 1; second < paragraphs.length; second += 1) {
          for (const firstRect of paragraphs[first].textRects) {
            for (const secondRect of paragraphs[second].textRects) {
              if (overlap(firstRect, secondRect)) textRectOverlapCount += 1;
            }
          }
        }
      }
      const image = root.querySelector('img');
      const imageRect = image?.getBoundingClientRect();
      const imageRatio = image && image.naturalWidth > 0 && image.naturalHeight > 0
        && imageRect?.width && imageRect.height
        ? Math.abs(
          image.naturalWidth / image.naturalHeight
          - imageRect.width / imageRect.height
        )
        : null;
      const code = root.querySelector('pre code');
      const codeParent = code?.parentElement;
      const table = root.querySelector('table');
      const tableParent = table?.parentElement;
      return {
        destinationWidth,
        containerAvailableWidth,
        root: readMetrics(root),
        widthDelta: rootRect.width - containerAvailableWidth,
        rootOverflow: root.scrollWidth - root.clientWidth,
        paragraphs: paragraphs.map(({ textRects, ...paragraph }) => paragraph),
        textRectOverlapCount,
        image: image && imageRect
          ? {
              bottomWithinRoot: imageRect.bottom <= rootRect.bottom + 1,
              height: imageRect.height,
              naturalHeight: image.naturalHeight,
              naturalWidth: image.naturalWidth,
              ratioDelta: imageRatio,
              width: imageRect.width
            }
          : null,
        code: code && codeParent
          ? {
              owner: code.scrollWidth > code.clientWidth + 1 ? 'code' : 'none',
              parentOverflow: codeParent.scrollWidth - codeParent.clientWidth,
              scrollWidth: code.scrollWidth,
              width: code.getBoundingClientRect().width
            }
          : null,
        table: table && tableParent
          ? {
              parentOverflowX: getComputedStyle(tableParent).overflowX,
              parentOverflow: tableParent.scrollWidth - tableParent.clientWidth,
              scrollWidth: table.scrollWidth,
              width: table.getBoundingClientRect().width
            }
          : null
      };
    };
    const results = [];
    for (const destinationWidth of destinationWidths) {
      const destination = document.createElement('div');
      destination.dataset.easymdeWidthDestination = String(destinationWidth);
      destination.style.cssText = [
        'position:fixed',
        'left:-100000px',
        'top:0',
        `width:${destinationWidth}px`,
        `max-width:${destinationWidth}px`,
        'box-sizing:border-box',
        'overflow:visible'
      ].join(';');
      const boxes = [
        { authoredWidth: '300px', expectedWidth: 300 },
        { authoredWidth: '50%', expectedWidth: destinationWidth * 0.5 },
        { authoredWidth: 'calc', expectedWidth: Math.max(0, destinationWidth - 32) }
      ].map(({ authoredWidth, expectedWidth }) => {
        const box = document.createElement('div');
        box.dataset.easymdeAuthoredWidth = authoredWidth;
        box.style.cssText = [
          `width:${'calc' === authoredWidth ? 'calc(100% - 32px)' : authoredWidth}`,
          'box-sizing:border-box',
          'margin:0',
          'padding:0',
          'overflow:visible'
        ].join(';');
        const root = sourceRoot.cloneNode(true);
        box.append(root);
        destination.append(box);
        return { box, expectedWidth, authoredWidth, root };
      });
      document.body.append(destination);
      const images = [...destination.querySelectorAll('img')];
      await Promise.all(images.map(async (image) => {
        if (!image.complete) {
          await new Promise((resolve, reject) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', () => reject(new Error('wechat-width-image-load-failed')), { once: true });
          });
        }
        if (typeof image.decode === 'function') await image.decode();
      }));
      results.push({
        width: destinationWidth,
        boxes: boxes.map(({ box, expectedWidth, authoredWidth, root }) => {
          const measured = readRoot(root, box, destinationWidth);
          return {
            authoredWidth,
            expectedWidth,
            measuredWidth: box.getBoundingClientRect().width,
            containerWidthDelta: box.getBoundingClientRect().width - expectedWidth,
            ...measured
          };
        })
      });
      destination.remove();
    }
    return results;
  }, { destinationWidths: widths, sourceHtml: html });
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

async function installEditorBootstrapOverride(page, pngConversionEnabled) {
  await page.addInitScript(({ enabled }) => {
    let loaderBootstrap;
    Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
      configurable: true,
      get: () => loaderBootstrap,
      set: (value) => {
        const editorBootstrap = value
          && 'object' === typeof value
          && value.editorBootstrap
          && 'object' === typeof value.editorBootstrap
          ? value.editorBootstrap
          : null;
        if (!editorBootstrap) {
          loaderBootstrap = value;
          return;
        }
        const forceSource = '1' === window.sessionStorage.getItem(
          'easymde-e2e-source-presentation'
        );
        loaderBootstrap = {
          ...value,
          editorBootstrap: {
            ...editorBootstrap,
            settings: {
              ...editorBootstrap.settings,
              general: {
                ...editorBootstrap.settings?.general,
                ...(forceSource ? { editingMode: 'source' } : {})
              }
            },
            wechatExport: {
              ...editorBootstrap.wechatExport,
              pngConversionEnabled: enabled
            }
          }
        };
      }
    });
  }, { enabled: pngConversionEnabled });
}

async function installControlledPngUploadRoute(page) {
  const bootstrap = await page.evaluate(() => ({
    endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
    owner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
  }));
  if (!bootstrap.endpoint || !['image-hosting', 'media'].includes(bootstrap.owner)) {
    throw new Error('wechat-source-png-upload-bootstrap-unavailable');
  }
  const uploadPath = new URL(bootstrap.endpoint, page.url()).pathname;
  const uploads = [];
  const matcher = (url) => new URL(url).pathname === uploadPath;
  await page.route(matcher, async (route) => {
    const index = uploads.push(route.request().method()) - 1;
    const url = `https://images.example.test/e2e/source-png-${index}.png`;
    const response = bootstrap.owner === 'image-hosting'
      ? { alt: '', backup: { status: 'disabled' }, title: '', url }
      : { alt: '', filename: `source-png-${index}.png`, id: 12_000 + index, title: '', url };
    await route.fulfill({
      body: JSON.stringify(response),
      contentType: 'application/json',
      status: 200
    });
  });
  return { matcher, uploads };
}

async function assertSourcePresentation(page, preview, expectedPresentation = 'split') {
  const editor = page.locator('[data-easymde-editor-owner="react"]');
  await expect(editor).toHaveAttribute(
    'data-easymde-preview-presentation',
    expectedPresentation
  );
  await expect(preview).toHaveClass(
    new RegExp(`easymde-preview-presentation-${expectedPresentation}`)
  );
  await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
}

async function assertFullCapabilityPreview(preview) {
  const expectedMermaidCount = fullCapabilityMarkdown.match(/^```mermaid$/gmu)?.length ?? 0;
  await expect(preview.locator('table')).toHaveCount(4);
  await expect(preview.locator('pre code')).toHaveCount(8);
  await expect(preview.locator('.katex')).toHaveCount(14);
  await expect(preview.locator('.easymde-mermaid')).toHaveCount(expectedMermaidCount);
  await expect(preview.locator('img').first()).toBeAttached();
  await expect.poll(() => preview.evaluate((root) => ({
    accepted: root.getAttribute('data-easymde-preview-accepted'),
    busy: root.getAttribute('aria-busy'),
    horizontalOverflow: root.scrollWidth - root.clientWidth
  }))).toEqual({ accepted: '1', busy: 'false', horizontalOverflow: 0 });
}

async function copyFromSourceAndAssertZeroWrite(page, button, { png }) {
  await setupZeroWriteProbe(page);
  await focusPageForCopy(page);
  await button.focus();
  await expect(button).toBeFocused();
  await installPreviewFreshnessProbe(page);
  await beginCopy(page, 'deferred');
  await button.press('Enter');
  await waitForPendingMeasurement(page);
  const metrics = await copyTrace(page);
  expect(metrics.clickCount).toBe(1);
  expect(metrics.writeCount).toBe(1);
  expect(metrics.writeActivation).toBe(true);
  if (png) {
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
  } else {
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
  }
  await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
  await waitForWechatStatusEvent(page, 'wechat-success');
  await expect.poll(() => page.evaluate((writeIndex) => (
    globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
  ), metrics.writeIndex)).toBe('fulfilled');
  const zeroWrite = await readZeroWriteProbe(page);
  expect(zeroWrite).toMatchObject({
    compatibilityUnchanged: true,
    previewUnchanged: true,
    sourceUnchanged: true,
    sourceMutations: 0
  });
  await stopZeroWriteProbe(page);
  if (png) {
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
  }
  await stopPreviewFreshnessProbe(page);
  await expect(button).toBeFocused();
  await dismissEditorStatus(page);
  return metrics;
}

async function readAppearanceCatalog(page) {
  return page.evaluate(() => {
    const bootstrap = window.EasyMDEEditorRootBootstrap;
    const appearance = bootstrap.appearance;
    return {
      articleThemes: appearance.articleThemes.map(({ cssUrl, defaultCodeTheme, id, label }) => ({
        cssUrl,
        defaultCodeTheme,
        id,
        label
      })),
      codeThemes: appearance.codeThemes.map(({ cssUrl, id, label }) => ({
        cssUrl,
        id,
        label
      })),
      immersive: bootstrap.strings.immersive,
      labels: {
        articleTheme: appearance.strings.articleTheme,
        codeTheme: appearance.strings.codeTheme,
        editorSettings: bootstrap.strings.immersive.editorSettings
      },
      state: {
        codeTheme: document.querySelector('#easymde-code-theme-field')?.value ?? '',
        codeThemeExplicit: document.querySelector('#easymde-code-theme-explicit-field')?.value ?? '',
        markdownTheme: document.querySelector('#easymde-markdown-theme-field')?.value ?? ''
      }
    };
  });
}

async function openOrdinaryAppearanceDialog(page, editorSettingsLabel) {
  await page.locator('.easymde-toolbar-section-secondary')
    .getByRole('button', { name: editorSettingsLabel, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: editorSettingsLabel, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectOrdinaryAppearanceTheme(page, dialog, label, themeLabel) {
  const select = dialog.getByRole('combobox', { name: label, exact: true });
  await select.click();
  const listbox = page.getByRole('listbox', { name: label, exact: true });
  await listbox.getByRole('option', { name: themeLabel, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

async function openImmersiveAppearanceDialog(page, labels) {
  await page.getByRole('button', { name: labels.theme, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: labels.themeSettings, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectImmersiveAppearanceTheme(page, dialog, label, themeLabel) {
  await dialog.getByRole('button', { name: label, exact: true }).click();
  const listbox = page.getByRole('listbox', { name: label, exact: true });
  await listbox.getByRole('option', { name: themeLabel, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

async function readPreviewBoundary(page) {
  return page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root) => {
    if (!(root instanceof HTMLElement)) {
      throw new Error('wechat-preview-boundary-unavailable');
    }
    const computed = getComputedStyle(root);
    const finite = (value, name) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-preview-boundary-${name}-invalid`);
      return value;
    };
    const rect = root.getBoundingClientRect();
    return {
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      backgroundPosition: computed.backgroundPosition,
      backgroundRepeat: computed.backgroundRepeat,
      backgroundSize: computed.backgroundSize,
      borderRadius: computed.borderRadius,
      boxShadow: computed.boxShadow,
      connected: root.isConnected,
      display: computed.display,
      height: finite(rect.height, 'height'),
      margin: [
        computed.marginTop,
        computed.marginRight,
        computed.marginBottom,
        computed.marginLeft
      ],
      padding: [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft
      ],
      width: finite(rect.width, 'width')
    };
  });
}

async function readProjectedPreviewBoundary(page, destinationWidth = null) {
  return page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((sourceRoot, destinationWidth) => {
    if (!(sourceRoot instanceof HTMLElement)) {
      throw new Error('wechat-preview-projection-source-unavailable');
    }
    const document = sourceRoot.ownerDocument;
    const host = document.createElement('div');
    const identityAttributes = [
      'data-easymde-editor-owner',
      'data-easymde-document-owner',
      'data-easymde-layout-owner',
      'data-easymde-preview-accepted',
      'data-easymde-preview-error',
      'data-easymde-preview-html-sink',
      'data-easymde-preview-refreshing'
    ];
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'display:block',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    const width = Number.isFinite(destinationWidth) && destinationWidth > 0
      ? destinationWidth
      : sourceRoot.getBoundingClientRect().width;
    if (Number.isFinite(width) && width > 0) host.style.width = `${width}px`;
    const path = [];
    let current = sourceRoot;
    while (current && current !== document.body && current !== document.documentElement) {
      path.unshift(current);
      current = current.parentElement;
    }
    let parent = host;
    let projectedRoot = null;
    path.forEach((source) => {
      const clone = source.cloneNode(false);
      if (!(clone instanceof HTMLElement)) throw new Error('wechat-preview-projection-clone-invalid');
      identityAttributes.forEach((attribute) => clone.removeAttribute(attribute));
      clone.removeAttribute('id');
      clone.removeAttribute('aria-hidden');
      clone.removeAttribute('inert');
      if (source !== sourceRoot) {
        clone.style.setProperty('display', 'block', 'important');
        clone.style.setProperty('position', 'static', 'important');
        clone.style.setProperty('inset', 'auto', 'important');
        clone.style.setProperty('width', '100%', 'important');
        clone.style.setProperty('min-width', '0', 'important');
        clone.style.setProperty('max-width', 'none', 'important');
        clone.style.setProperty('height', 'auto', 'important');
        clone.style.setProperty('min-height', '0', 'important');
        clone.style.setProperty('max-height', 'none', 'important');
        clone.style.setProperty('margin', '0', 'important');
        clone.style.setProperty('padding', '0', 'important');
        clone.style.setProperty('border', '0', 'important');
        clone.style.setProperty('transform', 'none', 'important');
      } else {
        projectedRoot = clone;
      }
      parent.append(clone);
      parent = clone;
    });
    if (!(projectedRoot instanceof HTMLElement)) {
      throw new Error('wechat-preview-projection-root-unavailable');
    }
    projectedRoot.setAttribute('data-easymde-wechat-export-style-context', '1');
    document.body.append(host);
    try {
      const computed = getComputedStyle(projectedRoot);
      const rect = projectedRoot.getBoundingClientRect();
      const finite = (value, name) => {
        if (!Number.isFinite(value)) throw new Error(`wechat-preview-projection-${name}-invalid`);
        return value;
      };
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        backgroundSize: computed.backgroundSize,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        connected: projectedRoot.isConnected,
        display: computed.display,
        height: finite(rect.height, 'height'),
        margin: [
          computed.marginTop,
          computed.marginRight,
          computed.marginBottom,
          computed.marginLeft
        ],
        padding: [
          computed.paddingTop,
          computed.paddingRight,
          computed.paddingBottom,
          computed.paddingLeft
        ],
        marker: projectedRoot.getAttribute('data-easymde-wechat-export-style-context'),
        width: finite(rect.width, 'width')
      };
    } finally {
      host.remove();
    }
  }, destinationWidth);
}

async function readPayloadBoundary(page, html, destinationWidth = null) {
  return page.evaluate(({ sourceHtml, width }) => {
    const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('wechat-payload-boundary-root-unavailable');
    const host = document.createElement('div');
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'display:block',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    if (Number.isFinite(width) && width > 0) host.style.width = `${width}px`;
    else host.style.width = '100%';
    host.append(root);
    document.body.append(host);
    try {
      const computed = getComputedStyle(root);
      const rect = root.getBoundingClientRect();
      const finite = (value, name) => {
        if (!Number.isFinite(value)) throw new Error(`wechat-payload-boundary-${name}-invalid`);
        return value;
      };
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        backgroundSize: computed.backgroundSize,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        connected: root.isConnected,
        display: computed.display,
        height: finite(rect.height, 'height'),
        margin: [
          computed.marginTop,
          computed.marginRight,
          computed.marginBottom,
          computed.marginLeft
        ],
        padding: [
          computed.paddingTop,
          computed.paddingRight,
          computed.paddingBottom,
          computed.paddingLeft
        ],
        materializedImageCount: root.querySelectorAll('img').length,
        width: finite(rect.width, 'width')
      };
    } finally {
      host.remove();
    }
  }, { sourceHtml: html, width: destinationWidth });
}

function assertPreviewBoundary(boundary, label) {
  expect(boundary.connected, `${label} root should remain connected`).toBe(true);
  if ('marker' in boundary) {
    expect(boundary.marker, `${label} projection marker`).toBe('1');
  }
}

function assertLiveBoundaryStable(before, after, label) {
  expect(after.connected, `${label} live root should remain connected`).toBe(true);
  expect(after.display, `${label} live display`).toBe(before.display);
  expect(after.margin, `${label} live margin`).toEqual(before.margin);
  expect(after.padding, `${label} live padding`).toEqual(before.padding);
  expect(after.backgroundColor, `${label} live background color`).toBe(before.backgroundColor);
  expect(after.backgroundImage, `${label} live background image`).toBe(before.backgroundImage);
  expect(after.backgroundPosition, `${label} live background position`).toBe(before.backgroundPosition);
  expect(after.backgroundRepeat, `${label} live background repeat`).toBe(before.backgroundRepeat);
  expect(after.backgroundSize, `${label} live background size`).toBe(before.backgroundSize);
  expect(after.borderRadius, `${label} live border radius`).toBe(before.borderRadius);
  expect(after.boxShadow, `${label} live shadow`).toBe(before.boxShadow);
  expect(Math.abs(after.width - before.width), `${label} live width`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.height - before.height), `${label} live height`).toBeLessThanOrEqual(0.5);
}

function assertPayloadMatchesProjection(payload, projection, label) {
  expect(payload.connected, `${label} payload root should remain connected`).toBe(true);
  expect(payload.margin, `${label} payload margin`).toEqual(projection.margin);
  expect(payload.padding, `${label} payload padding`).toEqual(projection.padding);
  expect(payload.backgroundColor, `${label} payload background color`)
    .toEqual(projection.backgroundColor);
  expect(payload.backgroundPosition, `${label} payload background position`)
    .toEqual(projection.backgroundPosition);
  expect(payload.backgroundRepeat, `${label} payload background repeat`)
    .toEqual(projection.backgroundRepeat);
  expect(payload.backgroundSize, `${label} payload background size`)
    .toEqual(projection.backgroundSize);
  if (/url\(/iu.test(projection.backgroundImage)) {
    expect(
      payload.backgroundImage === projection.backgroundImage
      || payload.materializedImageCount > 0,
      `${label} payload should retain or materialize its background image`
    ).toBe(true);
  } else {
    expect(payload.backgroundImage, `${label} payload background image`)
      .toEqual(projection.backgroundImage);
  }
  expect(payload.borderRadius, `${label} payload border radius`).toEqual(projection.borderRadius);
  expect(payload.boxShadow, `${label} payload shadow`).toEqual(projection.boxShadow);
  assertPreviewBoundary(payload, label);
}

async function createCustomBoundaryTheme(page, immersiveLabels) {
  const customCss = await page.evaluate(() => ({
    canManage: window.EasyMDEEditorRootBootstrap.appearance.canManageCustomCss,
    dialog: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssDialog,
    theme: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssTheme
  }));
  if (!customCss.canManage) {
    throw new Error('wechat-custom-css-boundary-fixture-unsupported');
  }

  const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
  await dialog.getByRole('button', { name: customCss.theme, exact: true }).click();
  const customDialog = page.getByRole('dialog', { name: customCss.theme, exact: true });
  await expect(customDialog).toBeVisible();
  const suffix = randomUUID().slice(0, 8);
  await customDialog.getByLabel(customCss.dialog.articleThemeName)
    .fill(`E2E boundary ${suffix}`);
  await customDialog.getByLabel(customCss.dialog.codeThemeName)
    .fill(`E2E boundary code ${suffix}`);
  await customDialog.getByRole('button', { name: customCss.dialog.customCssCode }).click();
  await customDialog.getByLabel(customCss.dialog.customCssCodeTitle)
    .fill([
      ':root {',
      '  padding: 24px;',
      '  border-radius: 48px;',
      '  background-color: rgb(245, 248, 255);',
      '  background-image: linear-gradient(135deg, rgb(245, 248, 255), rgb(232, 240, 255));',
      '  background-position: 0% 0%;',
      '  background-repeat: no-repeat;',
      '  background-size: auto;',
      '}'
    ].join('\n'));
  const customCssResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
  );
  await customDialog.getByRole('button', {
    name: customCss.dialog.applyCustomTheme,
    exact: true
  }).click();
  expect((await customCssResponse).ok()).toBe(true);
  await expect(customDialog).toHaveCount(0);
  await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
  await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root) => root.classList.contains('easymde-custom-css-active'))).toBe(true);
  await waitForPreviewVisualReadiness(page);
  return {
    articleLabel: `E2E boundary ${suffix}`
  };
}

async function waitForArticleThemeStylesheet(page, theme) {
  await expect.poll(() => page.locator('#easymde-article-theme-css').evaluate(
    (link, expectedUrl) => (
      link instanceof HTMLLinkElement
      && link.href === expectedUrl
      && Boolean(link.sheet?.href)
    ),
    theme.cssUrl
  ), { message: `${theme.id} article stylesheet should finish loading` }).toBe(true);
  await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue(theme.id);
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root, id) => (
    root.classList.contains(`easymde-markdown-theme-${id}`)
    && root.getAttribute('data-easymde-preview-accepted') === '1'
    && root.getAttribute('aria-busy') === 'false'
    && root.getAttribute('data-easymde-preview-refreshing') !== '1'
    && root.getAttribute('data-easymde-preview-error') !== '1'
  ), theme.id), {
    message: `${theme.id} article identity should be committed to the Preview root`
  }).toBe(true);
  await waitForPreviewVisualReadiness(page);
}

async function waitForCodeThemeStylesheet(page, theme) {
  await expect.poll(() => page.locator('#easymde-highlight-theme-css').evaluate(
    (link, expectedUrl) => (
      link instanceof HTMLLinkElement
      && link.href === expectedUrl
      && Boolean(link.sheet?.href)
    ),
    theme.cssUrl
  ), { message: `${theme.id} code stylesheet should finish loading` }).toBe(true);
  await expect(page.locator('#easymde-code-theme-field')).toHaveValue(theme.id);
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root, id) => (
    root.classList.contains(`easymde-code-theme-${id}`)
    && root.getAttribute('data-easymde-preview-accepted') === '1'
    && root.getAttribute('aria-busy') === 'false'
    && root.getAttribute('data-easymde-preview-refreshing') !== '1'
    && root.getAttribute('data-easymde-preview-error') !== '1'
  ), theme.id), {
    message: `${theme.id} code identity should be committed to the Preview root`
  }).toBe(true);
  await waitForPreviewVisualReadiness(page);
}

async function waitForImmediateCopyThemeCommit(page, themeId) {
  await page.waitForFunction((expectedThemeId) => {
    const field = document.querySelector('#easymde-markdown-theme-field');
    const preview = document.querySelector(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const copy = document.querySelector('.easymde-toolbar-copy-action');
    const ready = field instanceof HTMLInputElement
      && field.value === expectedThemeId
      && preview instanceof HTMLElement
      && preview.classList.contains(`easymde-markdown-theme-${expectedThemeId}`)
      && preview.getAttribute('data-easymde-preview-accepted') === '1'
      && preview.getAttribute('aria-busy') === 'false'
      && preview.getAttribute('data-easymde-preview-refreshing') !== '1'
      && preview.getAttribute('data-easymde-preview-error') !== '1'
      && copy instanceof HTMLButtonElement
      && copy.disabled === false
      && copy.getAttribute('aria-disabled') !== 'true'
      && copy.getAttribute('aria-busy') !== 'true';
    if (ready) globalThis.__easymdeImmediateCopySourceProbe?.markThemeCommit?.();
    return ready;
  }, themeId, { polling: 50, timeout: 5_000 });
}

async function copyAndAssertThemeProjection(
  page,
  button,
  label,
  expectedPadding,
  destinationWidth = null
) {
  const liveBefore = await readPreviewBoundary(page);
  const projectionWidth = Number.isFinite(destinationWidth) && destinationWidth > 0
    ? destinationWidth
    : liveBefore.width;
  const projection = await readProjectedPreviewBoundary(page, projectionWidth);
  assertPreviewBoundary(projection, `${label} projection`);
  if (expectedPadding) {
    expect(projection.padding, `${label} projected padding`).toEqual(expectedPadding);
  }
  const payload = await copyNativePayload(page, button);
  const payloadBoundary = await readPayloadBoundary(page, payload.html, projectionWidth);
  assertPayloadMatchesProjection(payloadBoundary, projection, label);
  assertLiveBoundaryStable(liveBefore, await readPreviewBoundary(page), label);
  return { payloadBoundary, projection };
}

async function exerciseThemeBoundaryModes(page, catalog, theme, expectedPadding) {
  const ordinaryDialog = await openOrdinaryAppearanceDialog(
    page,
    catalog.labels.editorSettings
  );
  await selectOrdinaryAppearanceTheme(
    page,
    ordinaryDialog,
    catalog.labels.articleTheme,
    theme.label
  );
  if (theme.cssUrl) await waitForArticleThemeStylesheet(page, theme);
  else await waitForPreviewVisualReadiness(page);
  await page.keyboard.press('Escape');
  await expect(ordinaryDialog).toHaveCount(0);

  const ordinaryPreview = page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  );
  const ordinaryBoundary = await copyAndAssertThemeProjection(
    page,
    page.locator('.easymde-toolbar-copy-action'),
    `${theme.id} ordinary`,
    expectedPadding
  );

  await page.locator('.easymde-toolbar-immersive-toggle').click();
  const immersiveRegion = page.getByRole('region', {
    name: catalog.immersive.immersive
  });
  await expect(immersiveRegion).toBeVisible();
  await page.getByRole('button', {
    name: catalog.immersive.splitMode,
    exact: true
  }).click();
  await expect(ordinaryPreview).toBeVisible();
  await expect(ordinaryPreview).toHaveAttribute('data-easymde-preview-accepted', '1');
  const splitBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive split`,
    expectedPadding
  );

  await page.getByRole('button', {
    name: catalog.immersive.previewMode,
    exact: true
  }).click();
  await expect(page.getByText(catalog.immersive.previewContentLoaded)).toBeVisible();
  await expect(ordinaryPreview).toBeVisible();
  const purePreviewBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive pure preview`,
    expectedPadding
  );

  await page.getByRole('button', {
    name: catalog.immersive.editMode,
    exact: true
  }).click();
  await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
  await expect(ordinaryPreview).toBeHidden();
  const hiddenSourceBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive hidden source`,
    expectedPadding,
    purePreviewBoundary.projection.width
  );

  await page.getByRole('button', {
    name: catalog.immersive.exit,
    exact: true
  }).click();
  await expect(immersiveRegion).toHaveCount(0);

  for (const [mode, boundary] of [
    ['immersive split', splitBoundary],
    ['immersive pure preview', purePreviewBoundary],
    ['immersive hidden source', hiddenSourceBoundary]
  ]) {
    expect(boundary.projection.padding, `${theme.id} ${mode} projected padding`)
      .toEqual(ordinaryBoundary.projection.padding);
    expect(boundary.projection.margin, `${theme.id} ${mode} projected margin`)
      .toEqual(ordinaryBoundary.projection.margin);
    expect(boundary.projection.borderRadius, `${theme.id} ${mode} projected radius`)
      .toEqual(ordinaryBoundary.projection.borderRadius);
    expect(boundary.projection.boxShadow, `${theme.id} ${mode} projected shadow`)
      .toEqual(ordinaryBoundary.projection.boxShadow);
    expect(boundary.projection.backgroundColor, `${theme.id} ${mode} projected background color`)
      .toEqual(ordinaryBoundary.projection.backgroundColor);
    expect(boundary.projection.backgroundImage, `${theme.id} ${mode} projected background image`)
      .toEqual(ordinaryBoundary.projection.backgroundImage);
    expect(boundary.projection.backgroundPosition, `${theme.id} ${mode} projected background position`)
      .toEqual(ordinaryBoundary.projection.backgroundPosition);
    expect(boundary.projection.backgroundRepeat, `${theme.id} ${mode} projected background repeat`)
      .toEqual(ordinaryBoundary.projection.backgroundRepeat);
    expect(boundary.projection.backgroundSize, `${theme.id} ${mode} projected background size`)
      .toEqual(ordinaryBoundary.projection.backgroundSize);
  }
}

async function holdStylesheetRequest(page, expectedUrl) {
  const expected = new URL(expectedUrl);
  let release;
  let markSeen;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = new Promise((resolve) => { markSeen = resolve; });
  const observedRequests = [];
  const matcher = (url) => {
    try {
      const candidate = new URL(url);
      return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
    } catch {
      return false;
    }
  };
  const handler = async (route) => {
    const requestUrl = new URL(route.request().url());
    observedRequests.push({
      method: route.request().method(),
      pathname: requestUrl.pathname,
      queryKeys: [...requestUrl.searchParams.keys()].sort()
    });
    markSeen();
    await gate;
    await route.continue();
  };
  await page.route(matcher, handler);
  return {
    diagnostics: () => ({
      expectedPathname: expected.pathname,
      expectedQueryKeys: [...expected.searchParams.keys()].sort(),
      observedRequests: observedRequests.slice()
    }),
    dispose: () => page.unroute(matcher, handler),
    release: () => release(),
    waitForRequest: async (timeoutMs = 8_000) => {
      let timer;
      try {
        return await Promise.race([
          seen,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('wechat-theme-stylesheet-request-timeout')),
              timeoutMs
            );
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}

async function readStylesheetOwnerState(page, selector, expectedUrl) {
  return page.locator(selector).evaluate((element, url) => {
    if (!(element instanceof HTMLLinkElement)) {
      throw new Error('wechat-theme-stylesheet-link-unavailable');
    }
    const href = new URL(element.href);
    const expected = new URL(url);
    return {
      hrefMatches: element.href === expected.href,
      hrefPathname: href.pathname,
      hrefQueryKeys: [...href.searchParams.keys()].sort(),
      id: element.id,
      media: element.media,
      owner: element.dataset.easymdeStylesheetOwner ?? null,
      sheetReady: Boolean(element.sheet?.href)
    };
  }, expectedUrl);
}

async function exerciseThemeCancellation(
  page,
  {
    button,
    changeTheme,
    consoleEvents,
    expectedStylesheet,
    label,
    sourceBefore
  }
) {
  const baselinePayload = await copyNativePayload(page, button);
  const baselineHtmlDigest = createHash('sha256')
    .update(baselinePayload.html, 'utf8')
    .digest('hex');
  const consoleEventStart = consoleEvents.length;
  const heldStylesheet = await holdStylesheetRequest(page, expectedStylesheet.url);
  let metrics;
  try {
    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
    await beginCopy(page, 'deferred');
    await button.press('Enter');
    await waitForPendingMeasurement(page);
    metrics = await copyTrace(page);
    expect(metrics.writeCount, `${label} should activate one native write`).toBe(1);
    expect(metrics.writeActivation, `${label} should preserve activation`).toBe(true);

    await changeTheme();
    try {
      await heldStylesheet.waitForRequest();
    } catch (error) {
      const stylesheetState = await readStylesheetOwnerState(
        page,
        expectedStylesheet.selector,
        expectedStylesheet.url
      );
      throw new Error(`${label}:${error.message}:${JSON.stringify({
        route: heldStylesheet.diagnostics(),
        stylesheet: stylesheetState
      })}`);
    }
    expect(await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.writes.length))
      .toBe(metrics.writeIndex + 1);
    await expect(button, `${label} copy control should be unavailable while its theme loads`)
      .toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveJSProperty('disabled', false);
    await button.focus();
    await expect(button).toBeFocused();

    heldStylesheet.release();
    await expect.poll(() => page.locator(expectedStylesheet.selector).evaluate((element, url) => (
      element instanceof HTMLLinkElement
      && element.href === url
      && Boolean(element.sheet?.href)
    ), expectedStylesheet.url)).toBe(true);
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');

    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await expect.poll(() => page.evaluate((writeIndex) => {
      const write = globalThis.__easymdeWechatCopyTrace.writes[writeIndex];
      if (!write || 'pending' === write.nativeState || 'pending' === write.htmlBlobState) {
        return null;
      }
      return {
        htmlBlobFailureCode: write.htmlBlobFailureCode,
        htmlBlobState: write.htmlBlobState,
        nativeState: write.nativeState
      };
    }, metrics.writeIndex)).not.toBeNull();
    const supersededWrite = await page.evaluate((writeIndex) => {
      const write = globalThis.__easymdeWechatCopyTrace.writes[writeIndex];
      return {
        htmlBlobFailureCode: write?.htmlBlobFailureCode ?? null,
        htmlBlobState: write?.htmlBlobState ?? null,
        nativeState: write?.nativeState ?? null
      };
    }, metrics.writeIndex);
    const ownedCancellation = supersededWrite.nativeState === 'rejected'
      && supersededWrite.htmlBlobState === 'rejected'
      && supersededWrite.htmlBlobFailureCode === 'wechat-copy-cancelled';
    const completedBeforeCancellation = supersededWrite.nativeState === 'fulfilled'
      && supersededWrite.htmlBlobState === 'fulfilled'
      && supersededWrite.htmlBlobFailureCode === null;
    expect(
      ownedCancellation || completedBeforeCancellation,
      `${label} superseded native write must complete or report owned cancellation: ${JSON.stringify(supersededWrite)}`
    ).toBe(true);
    if (ownedCancellation) {
      expect(supersededWrite.nativeState).toBe('rejected');
    }
    await expect(page.locator('.easymde-editor-message-alert-host')).toHaveCount(0);
    expect(await page.locator('#easymde-source').inputValue(), `${label} source`).toBe(sourceBefore);
    const cancelledDiagnostics = await page.evaluate(() => {
      const trace = globalThis.__easymdeWechatCopyTrace;
      return trace.statusEvents.slice(trace.statusEventCountAtStart);
    });
    expect(cancelledDiagnostics).not.toContain('wechat-success');
    expect(cancelledDiagnostics).not.toContain('wechat-failed');
    const attemptConsoleEvents = consoleEvents.slice(consoleEventStart);
    expect(attemptConsoleEvents.some(({ level, text }) => (
      'error' === level && /wechat.*(?:cancelled|theme-change)/iu.test(text)
    )), `${label} cancellation must not be logged as an error`).toBe(false);
    expect(attemptConsoleEvents.some(({ level, text }) => (
      'info' === level && /wechat.*(?:cancelled|theme-change)/iu.test(text)
    )), `${label} cancellation should remain observable at info level`).toBe(true);
    expect(await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.writes.length))
      .toBe(metrics.writeIndex + 1);

    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
    await beginCopy(page, 'success');
    await button.press('Enter');
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.at(-1)?.nativeState
    ))).toBe('fulfilled');
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.length
    ))).toBe(metrics.writeIndex + 2);
    expect(await page.locator('#easymde-source').inputValue(), `${label} retry source`)
      .toBe(sourceBefore);
    const retryPayload = await readClipboardPayload(page);
    expect(createHash('sha256').update(retryPayload.html, 'utf8').digest('hex'))
      .not.toBe(baselineHtmlDigest);
    expect(retryPayload.text.length, `${label} retry text`).toBeGreaterThan(0);
    expect(retryPayload.text, `${label} retry text sentinel`)
      .toContain('Markdown 全量能力测试文档');
    await dismissEditorStatus(page);
  } finally {
    heldStylesheet.release();
    await heldStylesheet.dispose();
  }
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
          finiteTransitionProbe: testInfo.wechatFiniteTransitionProbeCases ?? [],
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
    await installEditorBootstrapOverride(page, false);
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

  test('preserves full-capability Preview presentation through portable Source and cold Source entry', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );

    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
      await openEasyMdeNewPost(page);
      await assertPngConversionDisabled(page);
      await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');

      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      const splitPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(splitPreview).toBeVisible();
      await assertSourcePresentation(page, splitPreview, 'split');
      await assertFullCapabilityPreview(splitPreview);

      await page.getByRole('button', { name: labels.editMode, exact: true }).click();
      await expect(splitPreview).toBeHidden();
      await assertSourcePresentation(page, splitPreview, 'split');
      const immersiveCopy = page.getByRole('button', {
        name: labels.wechat,
        exact: true
      });
      await copyFromSourceAndAssertZeroWrite(page, immersiveCopy, { png: false });
      await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown);
      await page.getByRole('button', { name: labels.exit, exact: true }).click();

      await page.evaluate(() => window.sessionStorage.setItem(
        'easymde-e2e-source-presentation',
        '1'
      ));
      await openEasyMdeNewPost(page);
      await assertPngConversionDisabled(page);
      await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
      const coldPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(coldPreview).toBeHidden();
      await assertSourcePresentation(page, coldPreview, 'split');
      await assertFullCapabilityPreview(coldPreview);
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.locator('.easymde-toolbar-copy-action'),
        { png: false }
      );
      await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown);
    }
    await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
  });

  test('keeps the PNG measurement lease through hidden Source appearance refresh', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, true);
    let upload;

    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
      await openEasyMdeNewPost(page);
      await assertPngConversionEnabled(page);
      if (!upload) upload = await installControlledPngUploadRoute(page);
      upload.uploads.length = 0;
      await fillMarkdownAndWaitForPreview(page, pngHiddenPreviewMarkdown, 'Inline parent');

      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      const preview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(preview).toBeVisible();
      await assertSourcePresentation(page, preview, 'split');
      await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
      await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);

      await page.getByRole('button', { name: labels.editMode, exact: true }).click();
      await expect(preview).toBeHidden();
      await assertSourcePresentation(page, preview, 'split');
      await installPngMeasurementProbe(page);
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.getByRole('button', { name: labels.wechat, exact: true }),
        { png: true }
      );
      const firstPayload = await page.evaluate(
        () => globalThis.__easymdeWechatCopyTrace.readPayload()
      );
      expect(firstPayload).toMatchObject({
        hasCode: true,
        hasFormula: false,
        hasMermaid: false,
        imageCount: 2,
        hasTable: true
      });
      expect(upload.uploads).toHaveLength(2);

      await fillMarkdownAndWaitForPreview(
        page,
        pngHiddenPreviewUpdatedMarkdown,
        'Updated after the hidden Preview refresh.'
      );
      await expect(preview).toBeHidden();
      await assertSourcePresentation(page, preview, 'split');
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.getByRole('button', { name: labels.wechat, exact: true }),
        { png: true }
      );
      expect(upload.uploads).toHaveLength(4);
      const updatedPayload = await page.evaluate(
        () => globalThis.__easymdeWechatCopyTrace.readPayload()
      );
      expect(updatedPayload).toMatchObject({
        hasFormula: false,
        hasMermaid: false,
        imageCount: 2
      });

      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('Updated after the hidden Preview refresh.');
      await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
      await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);
      await page.getByRole('button', { name: labels.exit, exact: true }).click();
      await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    }
    await page.unroute(upload.matcher);
  });

  test('keeps the native width projection fluid across independent destinations', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await page.setViewportSize({ width: 1329, height: 900 });
    await page.route('**/easymde-e2e-fixtures/width-regression-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const markdown = widthRegressionMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/width-regression-image.png'
    );
    await fillMarkdownAndWaitForPreview(page, markdown, 'WIDTH-FLUID alpha');
    const sourceBeforeOrdinary = await page.locator('#easymde-source').inputValue();
    const ordinaryCopy = await copyNativePayload(
      page,
      page.locator('.easymde-toolbar-copy-action')
    );
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeOrdinary);
    const ordinaryDigest = createHash('sha256')
      .update(ordinaryCopy.html, 'utf8')
      .digest('hex');
    const ordinaryTextDigest = createHash('sha256')
      .update(ordinaryCopy.text, 'utf8')
      .digest('hex');
    const ordinaryProjection = await projectWidthPayload(
      page,
      ordinaryCopy.html,
      [375, 578, 760]
    );

    const assertProjection = (projection, label) => {
      expect(projection, label).toHaveLength(3);
      for (const destination of projection) {
        expect(destination.boxes, `${label}/${destination.width}/boxes`).toHaveLength(3);
        for (const box of destination.boxes) {
          assertFiniteProjectionNumber(
            box.expectedWidth,
            `${label}/${destination.width}/${box.authoredWidth}/expected-width`
          );
          assertFiniteProjectionNumber(
            box.measuredWidth,
            `${label}/${destination.width}/${box.authoredWidth}/measured-width`
          );
          assertFiniteProjectionNumber(
            box.containerWidthDelta,
            `${label}/${destination.width}/${box.authoredWidth}/container-width-delta`
          );
          assertFiniteProjectionNumber(
            box.containerAvailableWidth,
            `${label}/${destination.width}/${box.authoredWidth}/container-available-width`
          );
          assertFiniteProjectionNumber(
            box.root.width,
            `${label}/${destination.width}/${box.authoredWidth}/root-width`
          );
          assertFiniteProjectionNumber(
            box.widthDelta,
            `${label}/${destination.width}/${box.authoredWidth}/root-width-delta`
          );
          expect(Math.abs(box.containerWidthDelta), `${label}/${destination.width}/${box.authoredWidth}/container-width`)
            .toBeLessThanOrEqual(1);
          expect(Math.abs(box.widthDelta), `${label}/${destination.width}/${box.authoredWidth}/width`)
            .toBeLessThanOrEqual(1);
          expect(box.rootOverflow, `${label}/${destination.width}/${box.authoredWidth}/root-overflow`)
            .toBeLessThanOrEqual(1);
          expect(box.paragraphs, `${label}/${destination.width}/${box.authoredWidth}/paragraph-count`)
            .toHaveLength(2);
          for (const paragraph of box.paragraphs) {
            expect(paragraph.autoHeight).toBe(true);
            expect(paragraph.height).toBeGreaterThanOrEqual(paragraph.lineHeight);
            expect(Math.abs(paragraph.contentFillDelta ?? Number.MAX_SAFE_INTEGER))
              .toBeLessThanOrEqual(1);
          }
          expect(box.textRectOverlapCount).toBe(0);
          expect(box.image).toMatchObject({
            bottomWithinRoot: true,
            naturalHeight: 475,
            naturalWidth: 1414
          });
          expect(box.image?.height ?? 0).toBeGreaterThan(0);
          expect(box.image?.ratioDelta ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(0.03);
          expect(box.code?.owner).toBe('code');
          expect(box.table?.parentOverflowX).toBe('auto');
        }
      }
    };
    assertProjection(ordinaryProjection, 'ordinary');

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
    await page.addStyleTag({
      content: [
        '.easymde-editor.is-immersive .easymde-immersive-preview-surface {',
        '  flex: 0 0 412.5px !important;',
        '  width: 412.5px !important;',
        '}',
        '.easymde-editor.is-immersive .easymde-immersive-preview-canvas {',
        '  flex: 0 0 412.5px !important;',
        '  width: 412.5px !important;',
        '}'
      ].join('\n')
    });
    await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
    const splitPreview = page.locator(
      '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
    );
    await expect(splitPreview).toBeVisible();
    const splitBox = await splitPreview.boundingBox();
    if (!splitBox) throw new Error('wechat-width-regression-split-preview-unavailable');
    expect(Math.abs(splitBox.width - 412.5)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: labels.editMode, exact: true }).click();
    await expect(splitPreview).toBeHidden();
    const sourceBeforeImmersive = await page.locator('#easymde-source').inputValue();
    const immersiveCopy = await copyNativePayload(
      page,
      page.getByRole('button', { name: labels.wechat, exact: true }),
      { keyboard: true }
    );
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeImmersive);
    const immersiveDigest = createHash('sha256')
      .update(immersiveCopy.html, 'utf8')
      .digest('hex');
    const immersiveTextDigest = createHash('sha256')
      .update(immersiveCopy.text, 'utf8')
      .digest('hex');
    expect(immersiveDigest).toBe(ordinaryDigest);
    expect(immersiveTextDigest).toBe(ordinaryTextDigest);
    const immersiveProjection = await projectWidthPayload(
      page,
      immersiveCopy.html,
      [375, 578, 760]
    );
    assertProjection(immersiveProjection, 'immersive-source');
    await page.getByRole('button', { name: labels.exit, exact: true }).click();
  });

  test('keeps theme-owned outer spacing across article/code projections and copy modes', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(15 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 1100, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');

    const catalog = await readAppearanceCatalog(page);
    if (catalog.articleThemes.length === 0 || catalog.codeThemes.length === 0) {
      throw new Error('wechat-theme-boundary-inventory-unavailable');
    }
    const articleProjection = new Map();
    const articleDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    for (const theme of catalog.articleThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        articleDialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await waitForArticleThemeStylesheet(page, theme);
      const projection = await readProjectedPreviewBoundary(page);
      articleProjection.set(theme.id, projection);
      assertPreviewBoundary(projection, `${theme.id} ordinary projection`);
    }
    await page.keyboard.press('Escape');
    await expect(articleDialog).toHaveCount(0);

    const defaultTheme = catalog.articleThemes.find(({ id }) => id === 'default');
    const orangeTheme = catalog.articleThemes.find(({ id }) => id === 'orange-heart');
    const fullstackTheme = catalog.articleThemes.find(({ id }) => id === 'fullstack-blue');
    if (!defaultTheme || !orangeTheme || !fullstackTheme) {
      throw new Error('wechat-theme-boundary-required-article-theme-unavailable');
    }
    expect(articleProjection.get('default')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('orange-heart')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('fullstack-blue')?.padding)
      .toEqual(['0px', '10px', '0px', '10px']);
    const defaultProjection = articleProjection.get('default');
    if (!defaultProjection) throw new Error('wechat-default-theme-projection-unavailable');

    const defaultDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      defaultDialog,
      catalog.labels.articleTheme,
      defaultTheme.label
    );
    await waitForArticleThemeStylesheet(page, defaultTheme);
    for (const codeTheme of catalog.codeThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        defaultDialog,
        catalog.labels.codeTheme,
        codeTheme.label
      );
      await waitForCodeThemeStylesheet(page, codeTheme);
      const projection = await readProjectedPreviewBoundary(page);
      assertPreviewBoundary(projection, `${codeTheme.id} code theme projection`);
      expect(projection.padding, `${codeTheme.id} code theme padding`)
        .toEqual(defaultProjection.padding);
      expect(projection.margin, `${codeTheme.id} code theme margin`)
        .toEqual(defaultProjection.margin);
      expect(projection.borderRadius, `${codeTheme.id} code theme radius`)
        .toEqual(defaultProjection.borderRadius);
      expect(projection.boxShadow, `${codeTheme.id} code theme shadow`)
        .toEqual(defaultProjection.boxShadow);
      expect(projection.backgroundColor, `${codeTheme.id} code theme background color`)
        .toEqual(defaultProjection.backgroundColor);
      expect(projection.backgroundImage, `${codeTheme.id} code theme background image`)
        .toEqual(defaultProjection.backgroundImage);
      expect(projection.backgroundPosition, `${codeTheme.id} code theme background position`)
        .toEqual(defaultProjection.backgroundPosition);
      expect(projection.backgroundRepeat, `${codeTheme.id} code theme background repeat`)
        .toEqual(defaultProjection.backgroundRepeat);
      expect(projection.backgroundSize, `${codeTheme.id} code theme background size`)
        .toEqual(defaultProjection.backgroundSize);
    }
    await page.keyboard.press('Escape');
    await expect(defaultDialog).toHaveCount(0);

    for (const theme of [defaultTheme, orangeTheme, fullstackTheme]) {
      await exerciseThemeBoundaryModes(
        page,
        catalog,
        theme,
        'fullstack-blue' === theme.id
          ? ['0px', '10px', '0px', '10px']
          : ['0px', '0px', '0px', '0px']
      );
    }

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toBeVisible();
    const customTheme = await createCustomBoundaryTheme(page, catalog.immersive);
    await page.getByRole('button', {
      name: catalog.immersive.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toHaveCount(0);
    await exerciseThemeBoundaryModes(
      page,
      catalog,
      { cssUrl: '', id: 'custom', label: customTheme.articleLabel },
      ['24px', '24px', '24px', '24px']
    );
  });

  test('verifies native Clipboard payload code fidelity across every registered code theme', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      codeThemeFidelityMarkdown,
      'Code theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    test.setTimeout((catalog.codeThemes.length * 30 + 180) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-code-fidelity-default-themes-unavailable');
    }
    const codePayloadExport = await createNativePayloadExportState(
      'code',
      catalog.codeThemes.map(({ id }) => ({
        codeThemeId: id,
        mode: 'ordinary'
      }))
    );
    const codeBuildId = codePayloadExport ? await readEditorBuildId(page) : null;
    const initialDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.articleTheme,
      defaultArticle.label
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.codeTheme,
      defaultCode.label
    );
    await page.keyboard.press('Escape');
    await expect(initialDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, defaultArticle);
    await waitForCodeThemeStylesheet(page, defaultCode);

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const payloadViewportWidth = await page.evaluate(() => window.innerWidth);
    const observedThemes = [];
    const matrixManifest = [];
    for (const theme of catalog.codeThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.codeTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForCodeThemeStylesheet(page, theme);
      await waitForPreviewVisualReadiness(page);

      const sourceEvidence = await readNativeCodeSurfaceEvidence(page);
      expect(sourceEvidence.source.blocks, `${theme.id} source code blocks`)
        .toHaveLength(3);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        articleThemeId: defaultArticle.id,
        caseId: `code:${theme.id}`,
        codeThemeId: theme.id,
        index: observedThemes.length,
        mode: 'ordinary'
      });
      const rawHashMarkerEvidence = await page.evaluate((html) => {
        const documentRef = new DOMParser().parseFromString(html, 'text/html');
        const codeBlocks = [...documentRef.querySelectorAll('pre > code')];
        const walker = documentRef.createTreeWalker(documentRef.body, NodeFilter.SHOW_TEXT);
        let codeFefCount = 0;
        let outsideCodeFefCount = 0;
        let node = walker.nextNode();
        while (node) {
          const inCode = Boolean(node.parentElement?.closest('pre > code'));
          for (const character of node.nodeValue ?? '') {
            if (character !== '\uFEFF') continue;
            if (inCode) codeFefCount += 1;
            else outsideCodeFefCount += 1;
          }
          node = walker.nextNode();
        }
        return {
          codeBlockCount: codeBlocks.length,
          codeFefCount,
          codeHashProtected: (codeBlocks[1]?.textContent ?? '').includes('#\uFEFF336699'),
          outsideCodeFefCount
        };
      }, payload.html);
      expect(rawHashMarkerEvidence, `${theme.id} raw code FEFF marker domain`).toEqual({
        codeBlockCount: 3,
        codeFefCount: 1,
        codeHashProtected: true,
        outsideCodeFefCount: 2
      });
      expect(payload.text, `${theme.id} plain CSS code segment`)
        .toContain('.sample { color: #336699; margin: 0 auto; }');
      expect(payload.text, `${theme.id} authored body FEFF`)
        .toContain(`Body authored FEFF ${codeThemeAuthoredFef} remains in body text`);
      expect(payload.text, `${theme.id} authored inline FEFF`)
        .toContain(`inline${codeThemeAuthoredFef}FEFF`);
      expect(payload.text, `${theme.id} plain CSS code has no exporter FEFF`)
        .not.toContain('#\uFEFF336699');
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        assertNativeCodeSurface(
          sourceEvidence.source,
          destination.surface,
          `${theme.id}/${destination.destinationWidth}`
        );
        if (positionStripped) {
          const strippedDestination = positionStripped.payload.find(
            ({ destinationWidth }) => destinationWidth === destination.destinationWidth
          );
          expect(strippedDestination, `${theme.id}/${destination.destinationWidth} stripped destination`)
            .toBeDefined();
          if (!strippedDestination) throw new Error('wechat-native-stripped-destination-unavailable');
          assertPositionStrippedCodeSurface(
            destination.surface,
            strippedDestination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
        }
      }
      await recordNativePayloadExport(codePayloadExport, {
        articleThemeId: defaultArticle.id,
        buildId: codeBuildId,
        codeThemeId: theme.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth,
          blocks: surface.blocks.map((block) => ({
            characterCount: block.characters.length,
            frameMarkerCount: block.markers.length,
            htmlOverflowOwner: block.overflow.owner,
            styleDigest: createHash('sha256')
              .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
              .digest('hex')
          }))
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        sourceBlocks: sourceEvidence.source.blocks.map((block) => ({
          characterCount: block.characters.length,
          tokenClassCount: block.tokenClassCount,
          styleDigest: createHash('sha256')
            .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
            .digest('hex')
        })),
        themeId: theme.id
      });
      observedThemes.push(theme.id);
    }
    expect(observedThemes).toEqual(catalog.codeThemes.map(({ id }) => id));
    await finalizeNativePayloadExport(codePayloadExport);
    await testInfo.attach('wechat-code-native-matrix-manifest.json', {
      body: JSON.stringify({ themes: matrixManifest }, null, 2),
      contentType: 'application/json'
    });
  });

  test('verifies native Clipboard payload article fidelity across registered themes and family surfaces', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    if (finiteTransitionsProbeEnabled) testInfo.wechatFiniteTransitionProbeCases = [];
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleStyleMatrixMarkdown,
      'STYLE-H1 Article style matrix'
    );

    const catalog = await readAppearanceCatalog(page);
    test.setTimeout(((catalog.articleThemes.length + 12) * 30 + 240) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-article-fidelity-default-themes-unavailable');
    }
    const articlePayloadExport = await createNativePayloadExportState(
      'article',
      catalog.articleThemes.map(({ id }) => ({
        articleThemeId: id,
        mode: 'ordinary'
      }))
    );
    const articleBuildId = articlePayloadExport ? await readEditorBuildId(page) : null;
    const initialDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.articleTheme,
      defaultArticle.label
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.codeTheme,
      defaultCode.label
    );
    await page.keyboard.press('Escape');
    await expect(initialDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, defaultArticle);
    await waitForCodeThemeStylesheet(page, defaultCode);

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const payloadViewportWidth = await page.evaluate(() => window.innerWidth);
    const observedArticleThemes = [];
    const matrixManifest = [];
    for (const theme of catalog.articleThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, theme);
      const selectedCatalog = await readAppearanceCatalog(page);
      const selectedCode = selectedCatalog.codeThemes.find(
        ({ id }) => id === selectedCatalog.state.codeTheme
      );
      if (!selectedCode) throw new Error(`wechat-article-fidelity-code-theme-unavailable:${theme.id}`);
      await waitForCodeThemeStylesheet(page, selectedCode);
      await waitForPreviewVisualReadiness(page);

      let sourceEvidence = null;
      const finiteProbeStage = {
        articleThemeId: theme.id,
        caseId: `article:${theme.id}`,
        codeThemeId: selectedCode.id,
        index: observedArticleThemes.length,
        mode: 'ordinary'
      };
      if (finiteTransitionsProbeEnabled) {
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'before-finite-transition-probe'
        });
        const finiteProbe = await probeFiniteTransitions(page, finiteProbeStage.caseId);
        expect(finiteProbe.sourceHtmlStable, `${theme.id} source HTML should remain stable after transitions`)
          .toBe(true);
        await recordFiniteTransitionProbeCase(testInfo, finiteProbe, theme.id);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'after-finite-transition-probe'
        });
      } else {
        await settlePreviewFiniteTransitions(page);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
      }
      if (!sourceEvidence) throw new Error(`wechat-article-source-evidence-unavailable:${theme.id}`);
      const sourceElements = sourceEvidence.source.elements;
      expect(sourceElements.codeBlocks, `${theme.id} source code blocks`).toBe(1);
      expect(sourceElements.tables, `${theme.id} source tables`).toBe(1);
      expect(sourceElements.tableColumnCounts, `${theme.id} source table columns`)
        .toEqual([6]);
      expect(sourceElements.inlineCode, `${theme.id} source inline code`).toBe(1);
      expect(sourceElements.taskCheckboxes, `${theme.id} source task checkboxes`).toBe(2);
      expect(sourceElements.headings, `${theme.id} source heading minimum`)
        .toBeGreaterThanOrEqual(6);
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(sourceElements.headingLevels[level], `${theme.id} source ${level}`)
          .toBeGreaterThan(0);
      }
      expect(sourceEvidence.source.visualSignatures, `${theme.id} source visual signatures`)
        .toHaveLength(articleStyleMatrixSentinels.length);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        ...finiteProbeStage
      });
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, {
        signatureSentinels: articleStyleMatrixSentinels
      });
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      if (finiteTransitionsProbeEnabled && isolated.payload.some(({ surface }) => (
        surface.root.overflow.scrollWidth - surface.root.overflow.clientWidth > 1
      ))) {
        await recordFiniteTransitionFailurePayload({
          articleThemeId: theme.id,
          caseId: finiteProbeStage.caseId,
          codeThemeId: selectedCode.id,
          html: payload.html,
          isolated,
          sourceEvidence: sourceEvidence.source,
          width: payloadViewportWidth
        });
      }
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        try {
          assertNativeArticleSurface(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          assertNativeVisualSignatures(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          if (positionStripped) {
            const strippedDestination = positionStripped.payload.find(
              ({ destinationWidth }) => destinationWidth === destination.destinationWidth
            );
            expect(strippedDestination, `${theme.id}/${destination.destinationWidth} stripped destination`)
              .toBeDefined();
            if (!strippedDestination) throw new Error('wechat-native-stripped-destination-unavailable');
            assertPositionStrippedCodeSurface(
              destination.surface,
              strippedDestination.surface,
              `${theme.id}/${destination.destinationWidth}`
            );
          }
        } catch (error) {
          await recordNativeVisualSignatureFailure({
            articleThemeId: theme.id,
            destinationWidth: destination.destinationWidth,
            html: payload.html,
            sourceEvidence: sourceEvidence.source,
            targetEvidence: destination.surface
          });
          throw error;
        }
      }
      await recordNativePayloadExport(articlePayloadExport, {
        articleThemeId: theme.id,
        buildId: articleBuildId,
        codeThemeId: selectedCode.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          elements: surface.elements,
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        themeId: theme.id
      });
      observedArticleThemes.push(theme.id);
    }
    expect(observedArticleThemes).toEqual(catalog.articleThemes.map(({ id }) => id));
    await finalizeNativePayloadExport(articlePayloadExport);
    if (finiteTransitionsProbeEnabled) {
      await testInfo.attach('wechat-finite-transition-probe.json', {
        body: JSON.stringify(testInfo.wechatFiniteTransitionProbeCases, null, 2),
        contentType: 'application/json'
      });
    }

    // The ordinary loop above visits every registered article theme, including
    // Orange, Cupid, Crimson, Rose, Ningye, Qingbi, Qinghe, Minimal, and Spring.
    // Immersive modes stay bounded to four representative family profiles.
    const familyIds = [
      'default',
      'fullstack-blue',
      'phycat-cherry',
      'bloom-petal'
    ].filter((id) => catalog.articleThemes.some((theme) => theme.id === id));
    if (familyIds.length < 3) throw new Error('wechat-article-fidelity-family-inventory-unavailable');
    const familyPayloadExport = await createNativePayloadExportState(
      'article-family',
      familyIds.flatMap((articleThemeId) => ['split', 'pure', 'source'].map((mode) => ({
        articleThemeId,
        mode
      })))
    );
    const familyManifest = [];
    const immersiveLabels = catalog.immersive;
    const familyModes = [
      { button: 'splitMode', name: 'split' },
      { button: 'previewMode', name: 'pure' },
      { button: 'editMode', name: 'source' }
    ];
    for (const familyId of familyIds) {
      const familyTheme = catalog.articleThemes.find(({ id }) => id === familyId);
      if (!familyTheme) throw new Error(`wechat-article-fidelity-family-theme-unavailable:${familyId}`);
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        familyTheme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, familyTheme);
      await waitForPreviewVisualReadiness(page);
      let visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);

      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toBeVisible();
      for (const mode of familyModes) {
        await page.getByRole('button', {
          name: immersiveLabels[mode.button],
          exact: true
        }).click();
        const immersivePreview = page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        if ('source' === mode.name) await expect(immersivePreview).toBeHidden();
        else {
          await expect(immersivePreview).toBeVisible();
          await settlePreviewFiniteTransitions(page);
          visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);
        }
        const payload = await copyNativeMatrixPayload(
          page,
          page.getByRole('button', {
            name: immersiveLabels.wechat,
            exact: true
          }),
          {
            articleThemeId: familyId,
            caseId: `article-family:${familyId}:${mode.name}`,
            codeThemeId: (await readAppearanceCatalog(page)).state.codeTheme,
            index: familyManifest.length,
            mode: mode.name
          }
        );
        const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
        for (const destination of isolated.payload) {
          assertNativeArticleSurface(
            visibleSourceEvidence.source,
            destination.surface,
            `${familyId}/${mode.name}/${destination.destinationWidth}`
          );
        }
        const familyCatalog = await readAppearanceCatalog(page);
        await recordNativePayloadExport(familyPayloadExport, {
          articleThemeId: familyId,
          buildId: articleBuildId,
          codeThemeId: familyCatalog.state.codeTheme,
          html: payload.html,
          mode: mode.name,
          sourceEvidence: visibleSourceEvidence.source,
          width: payloadViewportWidth,
          widths: nativeClipboardSurfaceWidths
        });
        familyManifest.push({
          destinationWidths: isolated.payload.map(({ destinationWidth }) => destinationWidth),
          htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
          mode: mode.name,
          themeId: familyId
        });
      }
      await page.getByRole('button', {
        name: immersiveLabels.exit,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toHaveCount(0);
    }
    await finalizeNativePayloadExport(familyPayloadExport);
    await testInfo.attach('wechat-article-native-matrix-manifest.json', {
      body: JSON.stringify({
        families: familyManifest,
        themes: matrixManifest
      }, null, 2),
      contentType: 'application/json'
    });
  });

  test('causally settles finite PHYcat Preview animations before one immersive Copy', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(5 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleStyleMatrixMarkdown,
      'STYLE-H1 Article style matrix'
    );

    const catalog = await readAppearanceCatalog(page);
    const fullstack = catalog.articleThemes.find(({ id }) => id === 'fullstack-blue');
    const phycat = catalog.articleThemes.find(({ id }) => id === 'phycat-cherry');
    if (!fullstack || !phycat) throw new Error('wechat-phycat-animation-fixture-unavailable');
    if (catalog.state.codeThemeExplicit !== '0') {
      throw new Error('wechat-phycat-animation-code-theme-explicit');
    }
    const immersiveLabels = catalog.immersive;
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const readSourcePurity = async () => ({
      checked: await preview.locator('input[type="checkbox"]').evaluateAll(
        (elements) => elements.map((element) => element instanceof HTMLInputElement
          ? { checked: element.checked }
          : { checked: null })
      ),
      htmlHash: createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex')
    });

    const predecessorDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      predecessorDialog,
      catalog.labels.articleTheme,
      fullstack.label
    );
    await page.keyboard.press('Escape');
    await expect(predecessorDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, fullstack);
    const fullstackCatalog = await readAppearanceCatalog(page);
    const fullstackCode = fullstackCatalog.codeThemes.find(
      ({ id }) => id === fullstack.defaultCodeTheme
    );
    if (!fullstackCode) throw new Error('wechat-phycat-animation-predecessor-code-unavailable');
    expect(fullstackCatalog.state.codeTheme).toBe(fullstack.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, fullstackCode);
    await expect(preview).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: fullstack.id,
      caseId: 'phycat-causal:fullstack-source-predecessor',
      codeThemeId: fullstackCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'predecessor-ready'
    });
    const predecessorPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const predecessorPurityAfter = await readSourcePurity();
    expect(predecessorPurityAfter, 'predecessor ordinary transition settle must preserve Source')
      .toEqual(predecessorPurityBefore);
    await focusPageForCopy(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    await expect(preview).toBeHidden();
    await page.getByRole('button', {
      name: immersiveLabels.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);

    const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      dialog,
      catalog.labels.articleTheme,
      phycat.label
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, phycat);
    const selectedPhycatCatalog = await readAppearanceCatalog(page);
    const phycatCode = selectedPhycatCatalog.codeThemes.find(
      ({ id }) => id === phycat.defaultCodeTheme
    );
    if (!phycatCode) throw new Error('wechat-phycat-animation-code-theme-unavailable');
    expect(selectedPhycatCatalog.state.codeTheme).toBe(phycat.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, phycatCode);

    await page.evaluate((themeId) => {
      globalThis.__easymdeImmediateCopyExpectedArticleTheme = themeId;
    }, phycat.id);
    await expect(preview).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: phycat.id,
      caseId: 'phycat-causal:phycat-source-reentry',
      codeThemeId: selectedPhycatCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'phycat-ordinary-ready'
    });
    const ordinaryPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const ordinaryPurityAfter = await readSourcePurity();
    expect(ordinaryPurityAfter, 'ordinary Source finite-transition settle must preserve Source')
      .toEqual(ordinaryPurityBefore);
    await focusPageForCopy(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: phycat.id,
      caseId: 'phycat-causal:phycat-source-reentry',
      codeThemeId: selectedPhycatCatalog.state.codeTheme,
      mode: 'source',
      stage: 'source-hidden-before-split'
    });
    await page.getByRole('button', {
      name: immersiveLabels.splitMode,
      exact: true
    }).click();
    await expect(preview).toBeVisible();
    const splitPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const splitPurityAfter = await readSourcePurity();
    expect(splitPurityAfter, 'immersive Split finite-transition settle must preserve Source')
      .toEqual(splitPurityBefore);
    let evidenceAttached = false;
    let animationBefore = null;
    let animationAfter = null;
    let clickEvidence = null;
    let payload = null;
    let previewHashBefore = null;
    let writeEvidence = null;
    const readCheckedState = () => preview.locator('input[type="checkbox"]').evaluateAll(
      (elements) => elements.map((element) => element instanceof HTMLInputElement
        ? { checked: element.checked }
        : { checked: null })
    );
    const attachEvidence = async () => {
      if (evidenceAttached) return;
      clickEvidence = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1)?.previewTransitionsAtClick ?? null
      ));
      const writeIndex = payload?.metrics.writeIndex ?? null;
      writeEvidence = await page.evaluate((index) => {
        const writes = globalThis.__easymdeWechatCopyTrace.writes;
        return Number.isInteger(index)
          ? writes[index]?.previewTransitionsAtWrite ?? null
          : writes.at(-1)?.previewTransitionsAtWrite ?? null;
      }, writeIndex);
      const evidencePath = testInfo.outputPath('wechat-phycat-animation-causal-evidence.json');
      await writeFile(evidencePath, `${JSON.stringify({
          animationAfter,
          animationBefore,
          clickEvidence,
          finitePreviewAnimationsProbeEnabled,
          sourceHash: previewHashBefore,
          themeId: phycat.id,
          writeEvidence
        }, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600
        });
      await chmod(evidencePath, 0o600);
      await testInfo.attach('wechat-phycat-animation-causal-evidence.json', {
        path: evidencePath,
        contentType: 'application/json'
      });
      evidenceAttached = true;
    };
    try {
      const checkedBefore = await readCheckedState();
      previewHashBefore = createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex');
      animationBefore = await readPreviewFiniteAnimationEvidence(page);
      expect(
        animationBefore.items.some(({ playState, type }) => (
          type === 'CSSAnimation' && playState === 'running'
        )),
        'PHYcat causal CSSAnimation should be active before Copy'
      ).toBe(true);
      if (finitePreviewAnimationsProbeEnabled) {
        await settlePreviewFiniteAnimations(page);
      }
      animationAfter = await readPreviewFiniteAnimationEvidence(page);
      if (finitePreviewAnimationsProbeEnabled) {
        expect(animationAfter.count, 'PHYcat finite animations should settle before Copy').toBe(0);
        expect(await readCheckedState(), 'PHYcat checkbox state after animation settle')
          .toEqual(checkedBefore);
        const settledHash = createHash('sha256')
          .update(await preview.innerHTML(), 'utf8')
          .digest('hex');
        expect(settledHash, 'PHYcat source hash after animation settle').toBe(previewHashBefore);
      }
      const sourceEvidence = await readNativeCodeSurfaceEvidence(
        page,
        null,
        { signatureSentinels: articleStyleMatrixSentinels }
      );
      payload = await copyNativePayload(
        page,
        page.getByRole('button', { name: immersiveLabels.wechat, exact: true })
      );
      expect(payload.metrics.clickCount).toBe(1);
      expect(payload.metrics.writeCount).toBe(1);
      expect(payload.metrics.writeActivation).toBe(true);
      const previewHashAfter = createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex');
      expect(previewHashAfter, 'PHYcat immersive Preview source hash').toBe(previewHashBefore);
      clickEvidence = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1)?.previewTransitionsAtClick ?? null
      ));
      writeEvidence = await page.evaluate((writeIndex) => (
        globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.previewTransitionsAtWrite ?? null
      ), payload.metrics.writeIndex);
      const assertReady = (evidence, label) => {
        expect(evidence?.preview, `${label} Preview readiness`).toMatchObject({
          accepted: '1',
          ariaBusy: 'false',
          expectedThemeId: phycat.id,
          themeClassMatches: true,
          themeFieldValue: phycat.id
        });
        expect(evidence?.preview.refreshing, `${label} Preview refresh`).not.toBe('1');
        expect(evidence?.preview.error, `${label} Preview error`).not.toBe('1');
      };
      assertReady(clickEvidence, 'PHYcat click');
      assertReady(writeEvidence, 'PHYcat nativeWrite');
      if (!finitePreviewAnimationsProbeEnabled) {
        for (const [label, evidence] of [
          ['PHYcat click', clickEvidence],
          ['PHYcat nativeWrite', writeEvidence]
        ]) {
          expect(
            evidence.transitions?.filter((transition) => (
              transition.finite
              && transition.playState === 'running'
              && transition.targetIndex >= 0
            )) ?? [],
            `${label} must have no active finite CSS transitions`
          ).toHaveLength(0);
          expect(
            evidence.animations.some(({ currentTimeMs, endTimeMs, nodeIndex, playState, type }) => (
              type === 'CSSAnimation'
              && playState === 'running'
              && nodeIndex >= 0
              && Number.isFinite(currentTimeMs)
              && Number.isFinite(endTimeMs)
              && endTimeMs > currentTimeMs
            )),
            `${label} finite CSSAnimation must remain active`
          ).toBe(true);
        }
      }
      await attachEvidence();
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, {
        signatureSentinels: articleStyleMatrixSentinels
      });
      for (const destination of isolated.payload) {
        assertNativeArticleSurface(
          sourceEvidence.source,
          destination.surface,
          `phycat/split/${destination.destinationWidth}`
        );
        assertNativeVisualSignatures(
          sourceEvidence.source,
          destination.surface,
          `phycat/split/${destination.destinationWidth}`
        );
      }
      await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
    } catch (error) {
      await attachEvidence();
      throw error;
    }
  });

  test('preserves immediate native Copy after the original Inkwell to Animal theme transition', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(4 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleThemeFidelityMarkdown,
      'Article theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    const inkwell = catalog.articleThemes.find(({ id }) => id === 'inkwell');
    const animal = catalog.articleThemes.find(({ id }) => id === 'animal-island');
    if (!inkwell || !animal) throw new Error('wechat-immediate-theme-transition-fixtures-unavailable');
    await page.evaluate((themeId) => {
      globalThis.__easymdeImmediateCopyExpectedArticleTheme = themeId;
    }, animal.id);

    const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      dialog,
      catalog.labels.articleTheme,
      inkwell.label
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, inkwell);
    const inkwellCatalog = await readAppearanceCatalog(page);
    const inkwellCode = inkwellCatalog.codeThemes.find(
      ({ id }) => id === inkwell.defaultCodeTheme
    );
    if (!inkwellCode) throw new Error('wechat-immediate-inkwell-code-theme-unavailable');
    if (inkwellCatalog.state.codeThemeExplicit !== '0') {
      throw new Error('wechat-immediate-inkwell-code-theme-not-associated');
    }
    expect(inkwellCatalog.state.codeTheme).toBe(inkwell.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, inkwellCode);
    await setWechatMatrixStage(page, {
      articleThemeId: inkwell.id,
      caseId: 'immediate:inkwell-animal',
      codeThemeExplicit: inkwellCatalog.state.codeThemeExplicit,
      codeThemeId: inkwellCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'predecessor-ready'
    });

    const immediateCopyButton = page.locator('.easymde-toolbar-copy-action');
    await installImmediateCopySourceProbe(page);
    await setupZeroWriteProbe(page, { baselineAtClick: true });
    await focusPageForCopy(page);
    await immediateCopyButton.focus();
    await expect(immediateCopyButton).toBeFocused();
    await beginCopy(page, 'success');
    const animalDialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      animalDialog,
      catalog.labels.articleTheme,
      animal.label
    );
    await page.keyboard.press('Escape');
    await waitForImmediateCopyThemeCommit(page, animal.id);

    // Deliberately copy in the transition window: this preserves the original
    // race stimulus instead of waiting for the next visual-readiness barrier.
    let payload;
    let sourceProbeActive = true;
    try {
      payload = await copyNativePayload(
        page,
        immediateCopyButton,
        {
          skipFocus: true,
          traceAlreadyBegun: true,
          zeroWriteProbeAlreadyArmed: true
        }
      );
      const clickCapture = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1) ?? null
      ));
      expect(clickCapture, 'immediate trusted click capture').not.toBeNull();
      if (!clickCapture) throw new Error('wechat-immediate-copy-click-capture-unavailable');
      const clickPreview = clickCapture.previewTransitionsAtClick?.preview;
      expect(clickPreview, 'immediate click Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(clickPreview.themeClasses)
        .toContain(`easymde-markdown-theme-${animal.id}`);
      expect(clickCapture.copyAvailabilityAtClick, 'immediate Copy availability').toMatchObject({
        nativeDisabled: false
      });
      expect(clickCapture.copyAvailabilityAtClick.ariaDisabled).not.toBe('true');
      expect(clickCapture.copyAvailabilityAtClick.ariaBusy).not.toBe('true');
      const transitionsAtClick = clickCapture.previewTransitionsAtClick;
      expect(transitionsAtClick?.code, 'immediate click transition probe').toBeNull();
      expect(
        transitionsAtClick?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at the trusted copy click'
      ).toBe(true);
      const transitionsAtWrite = await page.evaluate((writeIndex) => (
        globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.previewTransitionsAtWrite
      ), payload.metrics.writeIndex);
      expect(transitionsAtWrite?.code, 'immediate transition probe').toBeNull();
      expect(transitionsAtWrite?.preview, 'nativeWrite Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(
        transitionsAtWrite?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at nativeWrite invocation'
      ).toBe(true);
      expect(payload.text, 'immediate transition text').toContain('Article theme Clipboard fidelity');
      await expect(page.locator('#easymde-source')).toHaveValue(articleThemeFidelityMarkdown);
    } catch (error) {
      let diagnostic;
      try {
        diagnostic = await readImmediateCopySourceProbe(page);
      } catch (diagnosticError) {
        diagnostic = {
          code: 'wechat-immediate-copy-source-owner-diagnostic-read-failed',
          errorName: diagnosticError instanceof Error ? diagnosticError.name : 'unknown'
        };
      }
      await testInfo.attach('wechat-immediate-copy-source-owner-diagnostic.json', {
        body: `${JSON.stringify(diagnostic, null, 2)}\n`,
        contentType: 'application/json'
      });
      throw error;
    } finally {
      if (sourceProbeActive) {
        await stopImmediateCopySourceProbe(page);
        sourceProbeActive = false;
      }
      await stopZeroWriteProbe(page);
    }
  });

  test('cancels ordinary and immersive Copy across article and code theme transitions', async ({
    context,
    page
  }, testInfo) => {
    test.setTimeout(12 * 60_000);
    await login(page, testInfo.wechatUser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    const cacheSession = await context.newCDPSession(page);
    await cacheSession.send('Network.enable');
    await cacheSession.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const sourceBefore = await page.locator('#easymde-source').inputValue();
    const catalog = await readAppearanceCatalog(page);
    const consoleEvents = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/wechat|theme-change/iu.test(text)) {
        consoleEvents.push({ level: message.type(), text });
      }
    });
    const alternateArticle = catalog.articleThemes.find(
      ({ id }) => id !== catalog.state.markdownTheme
    );
    const alternateCode = catalog.codeThemes.find(
      ({ id }) => id !== catalog.state.codeTheme
    );
    if (!alternateArticle || !alternateCode) {
      throw new Error('wechat-theme-cancellation-alternates-unavailable');
    }
    const ordinaryButton = page.locator('.easymde-toolbar-copy-action');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          catalog.labels.articleTheme,
          alternateArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateArticle.cssUrl
      },
      label: 'ordinary article theme',
      sourceBefore
    });

    const afterArticleCatalog = await readAppearanceCatalog(page);
    const alternateCodeAfterArticle = afterArticleCatalog.codeThemes.find(
      ({ id }) => id !== afterArticleCatalog.state.codeTheme
    );
    if (!alternateCodeAfterArticle) throw new Error('wechat-code-theme-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(
          page,
          afterArticleCatalog.labels.editorSettings
        );
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          afterArticleCatalog.labels.codeTheme,
          alternateCodeAfterArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateCodeAfterArticle.cssUrl
      },
      label: 'ordinary code theme',
      sourceBefore
    });

    const immersiveLabels = (await readAppearanceCatalog(page)).immersive;
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.splitMode, exact: true }).click();
    const immersiveButton = page.getByRole('button', {
      name: immersiveLabels.wechat,
      exact: true
    });
    const immersiveArticleCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveArticle = immersiveArticleCatalog.articleThemes.find(
      ({ id }) => id !== immersiveArticleCatalog.state.markdownTheme
        && id !== alternateArticle.id
    );
    if (!alternateImmersiveArticle) throw new Error('wechat-immersive-article-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveArticleCatalog.labels.articleTheme,
          alternateImmersiveArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateImmersiveArticle.cssUrl
      },
      label: 'immersive split article theme',
      sourceBefore
    });

    await page.getByRole('button', { name: immersiveLabels.editMode, exact: true }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    const immersiveCodeCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveCode = immersiveCodeCatalog.codeThemes.find(
      ({ id }) => id !== immersiveCodeCatalog.state.codeTheme
        && id !== alternateCodeAfterArticle.id
    );
    if (!alternateImmersiveCode) throw new Error('wechat-immersive-code-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveCodeCatalog.labels.codeTheme,
          alternateImmersiveCode.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateImmersiveCode.cssUrl
      },
      label: 'immersive source code theme',
      sourceBefore
    });
    await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
  });


  test('rasterizes current visual roots after immersive Source hides Preview', async ({
    context,
    page
  }, testInfo) => {
    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installWechatConsoleDiagnostics(page);
    await page.addInitScript(() => {
      let loaderBootstrap;
      Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
        configurable: true,
        get: () => loaderBootstrap,
        set: (value) => {
          const editorBootstrap = value
            && 'object' === typeof value
            && value.editorBootstrap
            && 'object' === typeof value.editorBootstrap
            ? value.editorBootstrap
            : null;
          loaderBootstrap = editorBootstrap?.settings?.general
            ? {
                ...value,
                editorBootstrap: {
                  ...editorBootstrap,
                  settings: {
                    ...editorBootstrap.settings,
                    general: {
                      ...editorBootstrap.settings.general,
                      ...('1' === window.sessionStorage.getItem(
                        'easymde-e2e-hidden-png-source'
                      ) ? { editingMode: 'source' } : {})
                    }
                  },
                  wechatExport: {
                    ...editorBootstrap.wechatExport,
                    pngConversionEnabled: true
                  }
                }
              }
            : value;
        }
      });
    });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);

    const imageUploadBootstrap = await page.evaluate(() => ({
      endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
      owner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
    }));
    if (!imageUploadBootstrap.endpoint || !imageUploadBootstrap.owner) {
      throw new Error('wechat-png-image-upload-bootstrap-unavailable');
    }
    expect(['image-hosting', 'media']).toContain(imageUploadBootstrap.owner);
    const imageUploadPath = new URL(
      imageUploadBootstrap.endpoint,
      page.url()
    ).pathname;
    const uploadRequests = [];
    const uploadDigests = [];
    const imageUploadMatcher = (url) => new URL(url).pathname === imageUploadPath;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === imageUploadPath) {
        uploadRequests.push({ method: request.method() });
        uploadDigests.push(multipartFileDigest(request));
      }
    });
    await page.route(imageUploadMatcher, async (route) => {
      const index = uploadRequests.length;
      const response = imageUploadBootstrap.owner === 'image-hosting'
        ? {
            alt: '',
            backup: { status: 'disabled' },
            title: '',
            url: `https://images.example.test/e2e/wechat-png-${index}.png`
          }
        : {
            alt: '',
            filename: `wechat-png-${index}.png`,
            id: 9000 + index,
            title: '',
            url: `https://images.example.test/e2e/wechat-png-${index}.png`
          };
      await route.fulfill({
        body: JSON.stringify(response),
        contentType: 'application/json',
        status: 200
      });
    });

    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewMarkdown,
      'Inline parent'
    );
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);
    await expect(preview.locator('table')).toHaveCount(1);
    await expect(preview.locator('pre code')).toHaveCount(1);
    const initialGeometry = await preview.evaluate((root) => (
      [...root.querySelectorAll('.easymde-math-inline, .easymde-mermaid')].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parentRect = element.parentElement?.getBoundingClientRect();
        return {
          display: style.display,
          height: rect.height,
          parentHeight: parentRect?.height ?? 0,
          parentWidth: parentRect?.width ?? 0,
          visibility: style.visibility,
          width: rect.width
        };
      })
    ));
    expect(initialGeometry).toHaveLength(2);
    for (const geometry of initialGeometry) {
      expect(geometry.display).not.toBe('none');
      expect(geometry.visibility).not.toBe('hidden');
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.parentWidth).toBeGreaterThan(0);
      expect(geometry.parentHeight).toBeGreaterThan(0);
    }
    expect(uploadRequests).toHaveLength(0);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    const immersivePreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(immersivePreview).toBeVisible();
    const visibleSplitBox = await immersivePreview.boundingBox();
    if (!visibleSplitBox) throw new Error('wechat-png-visible-split-preview-unavailable');
    await installPngMeasurementProbe(page);

    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    await expect(immersivePreview).toBeHidden();
    const source = page.locator('#easymde-source');
    await expect(source).toHaveValue(pngHiddenPreviewMarkdown);
    await setupZeroWriteProbe(page);

    const immersiveButton = page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechat
    });
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    const copyMetrics = await copyTrace(page);
    expect(copyMetrics.clickCount).toBe(2);
    expect(copyMetrics.writeCount).toBe(1);
    expect(copyMetrics.writeActivation).toBe(true);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), copyMetrics.writeIndex)).toBe('fulfilled');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    const payload = await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.readPayload());
    expect(payload).toMatchObject({
      hasCode: true,
      hasEditorChrome: false,
      hasFormula: false,
      hasMermaid: false,
      hasScript: false,
      imageCount: 2,
      hasTable: true
    });
    expect(uploadRequests).toHaveLength(2);
    expect(uploadDigests).toHaveLength(2);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    const firstMeasurements = await readPngMeasurements(page);
    expect(firstMeasurements.length).toBeGreaterThan(0);
    expect(firstMeasurements[0].rootWidth).toBeGreaterThan(0);
    expect(Math.abs(firstMeasurements[0].rootWidth - visibleSplitBox.width))
      .toBeLessThanOrEqual(1);
    const firstMeasurementCount = firstMeasurements.length;
    const zeroWrite = await readZeroWriteProbe(page);
    expect(zeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await dismissEditorStatus(page);
    await expect(source).toHaveValue(pngHiddenPreviewMarkdown);

    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewUpdatedMarkdown,
      'Updated after the hidden Preview refresh.'
    );
    await expect(immersivePreview).toBeHidden();
    await expect(source).toHaveValue(pngHiddenPreviewUpdatedMarkdown);
    await setupZeroWriteProbe(page);
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    const updatedCopyMetrics = await copyTrace(page);
    expect(updatedCopyMetrics.clickCount).toBe(2);
    expect(updatedCopyMetrics.writeCount).toBe(1);
    expect(updatedCopyMetrics.writeActivation).toBe(true);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), updatedCopyMetrics.writeIndex)).toBe('fulfilled');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    const updatedPayload = await page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.readPayload()
    );
    expect(updatedPayload).toMatchObject({
      hasFormula: false,
      hasMermaid: false,
      imageCount: 2
    });
    expect(uploadRequests).toHaveLength(4);
    expect(uploadDigests).toHaveLength(4);
    expect(uploadDigests.slice(2).some(
      (digest, index) => digest !== uploadDigests[index]
    )).toBe(true);
    const updatedZeroWrite = await readZeroWriteProbe(page);
    expect(updatedZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    await dismissEditorStatus(page);
    const updatedMeasurements = await readPngMeasurements(page);
    expect(updatedMeasurements.length).toBeGreaterThan(firstMeasurementCount);
    const updatedMeasurement = updatedMeasurements.at(-1);
    expect(updatedMeasurement?.rootWidth ?? 0).toBeGreaterThan(0);
    expect(Math.abs((updatedMeasurement?.rootWidth ?? 0) - visibleSplitBox.width))
      .toBeLessThanOrEqual(1);
    await stopPngMeasurementProbe(page);
    await page.getByRole('button', {
      name: immersiveLabels.splitMode,
      exact: true
    }).click();
    await expect(immersivePreview).toBeVisible();
    const refreshedSplitBox = await immersivePreview.boundingBox();
    if (!refreshedSplitBox) throw new Error('wechat-png-refreshed-split-preview-unavailable');
    expect(Math.abs(refreshedSplitBox.width - visibleSplitBox.width)).toBeLessThanOrEqual(1);
    await expect(immersivePreview).toContainText('Updated after the hidden Preview refresh.');
    await expect(immersivePreview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(immersivePreview.locator('.easymde-mermaid')).toHaveCount(1);
    await expect(immersivePreview.locator('table')).toHaveCount(1);
    await expect(immersivePreview.locator('pre code')).toHaveCount(1);
    await page.getByRole('button', {
      name: immersiveLabels.exit,
      exact: true
    }).click();

    // Reuse the loader bootstrap seam to cover a genuinely first hidden
    // Preview without changing the site-wide editing mode setting.
    await page.evaluate(() => {
      window.sessionStorage.setItem('easymde-e2e-hidden-png-source', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    expect(await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.settings.general.editingMode
    )).toBe('source');
    await page.addStyleTag({
      content: [
        '.easymde-editor:not(.is-immersive) { max-width: 760px !important; }',
        '.easymde-editor:not(.is-immersive) > .easymde-workspace {',
        '  box-sizing: border-box !important;',
        '  width: 500px !important;',
        '  max-width: 760px !important;',
        '  padding-left: 18px !important;',
        '  padding-right: 18px !important;',
        '}'
      ].join('\n')
    });
    const availableSourceWidth = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const rect = workspace.getBoundingClientRect();
      const style = getComputedStyle(workspace);
      const horizontalEdges = [
        'padding-left',
        'padding-right',
        'border-left-width',
        'border-right-width'
      ].reduce((total, property) => total + Number.parseFloat(style.getPropertyValue(property) || '0'), 0);
      return rect.width - horizontalEdges;
    });
    expect(availableSourceWidth).toBeGreaterThan(0);
    expect(availableSourceWidth).toBeLessThanOrEqual(760);
    await installPngMeasurementProbe(page);
    const initialHiddenPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(initialHiddenPreview).toBeHidden();
    uploadRequests.length = 0;
    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewMarkdown,
      'Inline parent'
    );
    await expect(initialHiddenPreview).toBeHidden();
    await expect(initialHiddenPreview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(initialHiddenPreview.locator('.easymde-mermaid')).toHaveCount(1);
    expect(uploadRequests).toHaveLength(0);
    await setupZeroWriteProbe(page);
    const initialSourceCopy = page.locator('.easymde-toolbar-copy-action');
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await initialSourceCopy.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(1);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    await waitForWechatStatusEvent(page, 'wechat-success');
    const initialHiddenMetrics = await copyTrace(page);
    expect(initialHiddenMetrics.clickCount).toBe(1);
    expect(initialHiddenMetrics.writeCount).toBe(1);
    expect(initialHiddenMetrics.writeActivation).toBe(true);
    expect(initialHiddenMetrics.writeNativeState).toBe('fulfilled');
    const initialHiddenPayload = await page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.readPayload()
    );
    expect(initialHiddenPayload).toMatchObject({
      hasFormula: false,
      hasMermaid: false,
      imageCount: 2
    });
    expect(uploadRequests).toHaveLength(2);
    const initialHiddenZeroWrite = await readZeroWriteProbe(page);
    expect(initialHiddenZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    const initialSourceMeasurements = await readPngMeasurements(page);
    expect(initialSourceMeasurements.length).toBeGreaterThan(0);
    const initialSourceMeasurement = initialSourceMeasurements.at(-1);
    expect(initialSourceMeasurement?.rootWidth ?? 0).toBeGreaterThan(0);
    expect(initialSourceMeasurement?.rootWidth ?? Number.MAX_SAFE_INTEGER)
      .toBeLessThanOrEqual(availableSourceWidth + 1);
    await stopPngMeasurementProbe(page);
    await page.unroute(imageUploadMatcher);
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
    await installEditorBootstrapOverride(page, false);
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
    await installEditorBootstrapOverride(page, false);
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
