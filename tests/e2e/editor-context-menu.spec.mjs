import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  trace: 'off',
  video: 'off'
});

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
const fixtureMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fixtureImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
const imageSourceAlt = '占位测试图片';
const menuSelector = '[data-easymde-context-menu="true"]';
const menuViewportSelector = '[data-easymde-context-menu-viewport="true"]';
const sourceDocumentStartKey = process.platform === 'darwin'
  ? 'Meta+ArrowUp'
  : 'Control+Home';
const sourceLineEndKey = process.platform === 'darwin'
  ? 'Meta+ArrowRight'
  : 'End';
const contextMenuDiagnosticKey = '__easymdeContextMenuDiagnostic';
const visualHistoryDiagnosticKey = '__easymdeVisualHistoryDiagnostic';
const contextMenuDiagnosticEventLimit = 24;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}

function privacySafeFailureCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /\b((?:editor-context-menu|fixture|source|table-menu|visual)(?:-[a-z0-9]+)*)\b/iu
  );
  return match?.[1] ?? 'assertion-failed';
}

function createImageRequestGate() {
  let releasePromise;
  const promise = new Promise((resolve) => {
    releasePromise = resolve;
  });
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      releasePromise();
    },
    wait() {
      return promise;
    }
  };
}

function occurrenceOffset(source, value, occurrence = 0) {
  let offset = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(value, from);
    if (offset < 0) throw new Error(`fixture-text-missing:${value}`);
    from = offset + Math.max(1, value.length);
  }
  return offset;
}

async function login(page) {
  await page.goto('/wp-login.php');
  await page.locator('#loginform').evaluate((form, credentials) => {
    const username = form.elements.namedItem('log');
    const password = form.elements.namedItem('pwd');
    const submit = form.elements.namedItem('wp-submit');
    if (!(username instanceof HTMLInputElement)
      || !(password instanceof HTMLInputElement)
      || !(submit instanceof HTMLInputElement)) {
      throw new Error('wordpress-login-fields-unavailable');
    }
    username.value = credentials.username;
    password.value = credentials.password;
    form.requestSubmit(submit);
  }, { password: adminPassword, username: adminUser });
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

async function loadCanonicalFixture(page, copies = 1, options = {}) {
  const imageGate = options.imageGate ?? null;
  const fixtureImageUrl = new URL(
    '/easymde-e2e-fixtures/markdown-full-capability-image.png',
    page.url()
  ).href;
  await page.route(fixtureImageUrl, async (route) => {
    if (imageGate) await imageGate.wait();
    await route.fulfill({
      body: fixtureImage,
      contentType: 'image/png',
      status: 200
    });
  });

  const single = fixtureMarkdown.replace(
    /https:\/\/raw\.githubusercontent\.com\/tao-xiaoxin\/EasyMDE\/main\/docs\/assets\/easymde-logo-rounded\.png/gu,
    fixtureImageUrl
  );
  const markdown = 1 === copies ? single : `${single}\n${single}`;
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  const source = page.locator('#easymde-source');
  const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');

  if (options.nativeInput) {
    await replaceSourceWithNativeInput(
      page,
      sourceEditor,
      source,
      markdown,
      'canonical-fixture-native-input'
    );
  } else {
    await sourceEditor.fill(markdown);
  }
  await expect(source).toHaveValue(markdown);
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect(preview).toContainText('Markdown 全量能力测试文档');
  return { fixtureImageUrl, markdown, preview, source, sourceEditor };
}

async function waitForRealImageLoad(image) {
  await image.evaluate((element) => new Promise((resolve, reject) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('fixture-image-element-unavailable');
    }
    const cleanup = () => {
      element.removeEventListener('load', onLoad);
      element.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('fixture-image-load-failed'));
    };
    if (element.complete) {
      if (element.naturalWidth > 0) resolve();
      else reject(new Error('fixture-image-complete-without-pixels'));
      return;
    }
    element.addEventListener('load', onLoad, { once: true });
    element.addEventListener('error', onError, { once: true });
  }));
}

function imageScaleSource(markdown, imageMarkdown, percentage, occurrence = 0) {
  const start = occurrenceOffset(markdown, imageMarkdown, occurrence);
  if (start < 0) throw new Error('fixture-image-source-missing');
  const altEnd = imageMarkdown.indexOf('](');
  if (!imageMarkdown.startsWith('![') || altEnd < 0 || !imageMarkdown.endsWith(')')) {
    throw new Error('fixture-image-syntax-unavailable');
  }

  const alt = imageMarkdown.slice(2, altEnd);
  const body = imageMarkdown.slice(altEnd + 2, -1);
  const marker = `{width=${percentage}%}`;
  const titleMatch = body.match(/(\s+)(?:"[^"]*"|'[^']*'|\([^)]*\))$/u);
  let scaledBody;
  if (!titleMatch) {
    scaledBody = `${body} "${marker}"`;
  } else {
    const titleStart = titleMatch.index;
    const spacing = titleMatch[1];
    const titleToken = titleMatch[0].slice(spacing.length);
    const quote = titleToken[0];
    const closingQuote = titleToken[titleToken.length - 1];
    const title = titleToken.slice(1, -1);
    const combinedTitle = title ? `${title} ${marker}` : marker;
    scaledBody = `${body.slice(0, titleStart)}${spacing}${quote}${combinedTitle}${closingQuote}`;
  }

  const scaledImage = `![${alt}](${scaledBody})`;
  return `${markdown.slice(0, start)}${scaledImage}${markdown.slice(start + imageMarkdown.length)}`;
}

async function readPreviewImageGeometry(image) {
  return image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('fixture-preview-image-unavailable');
    }
    const imageStyles = getComputedStyle(element);
    const containingBlock = element.parentElement;
    if (!(containingBlock instanceof Element)) {
      throw new Error('fixture-preview-image-containing-block-unavailable');
    }
    const blockStyles = getComputedStyle(containingBlock);
    const contentWidth = containingBlock.clientWidth
      - Number.parseFloat(blockStyles.paddingLeft || '0')
      - Number.parseFloat(blockStyles.paddingRight || '0');
    const rect = element.getBoundingClientRect();
    return {
      contentWidth,
      dataScale: element.getAttribute('data-easymde-image-scale'),
      height: rect.height,
      maxWidth: imageStyles.maxWidth,
      naturalHeight: element.naturalHeight,
      naturalWidth: element.naturalWidth,
      renderedHeight: Number.parseFloat(imageStyles.height),
      renderedWidth: Number.parseFloat(imageStyles.width),
      widthAttribute: element.getAttribute('width')
    };
  });
}

async function assertPreviewImageScale(image, percentage, phase) {
  await expect.poll(
    () => image.getAttribute('data-easymde-image-scale')
  ).toBe(String(percentage));
  await expect.poll(
    () => image.getAttribute('width')
  ).toBe(`${percentage}%`);
  const geometry = await readPreviewImageGeometry(image);
  const expectedWidth = geometry.contentWidth * percentage / 100;
  const expectedHeight = geometry.naturalWidth > 0
    ? expectedWidth * geometry.naturalHeight / geometry.naturalWidth
    : NaN;
  const valid = geometry.contentWidth > 0
    && geometry.naturalWidth > 0
    && geometry.naturalHeight > 0
    && geometry.maxWidth === 'none'
    && Math.abs(geometry.renderedWidth - expectedWidth) <= 1.5
    && Math.abs(geometry.renderedHeight - expectedHeight) <= 1.5;
  if (!valid) {
    throw new Error(
      `editor-context-menu-image-scale-geometry-failed:${phase}:${percentage}:` +
      `${JSON.stringify(geometry)}`
    );
  }
}

async function assertSourceExactValue(source, expected, phase) {
  const exact = await source.evaluate(
    (field, expectedValue) => 'value' in field && field.value === expectedValue,
    expected
  );
  if (!exact) throw new Error(`editor-context-menu-image-scale-source-drift:${phase}`);
}

function fencedBlockSource(markdown, language, occurrence = 0) {
  const pattern = new RegExp(
    '^```' + language + '\\r?\\n([\\s\\S]*?)\\r?\\n```',
    'gmu'
  );
  const matches = [...markdown.matchAll(pattern)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-fenced-block-missing:${language}:${occurrence}`);
  return match[1];
}

function fencedBlockMarkdown(markdown, language, occurrence = 0) {
  const pattern = new RegExp(
    '^```' + language + '\\r?\\n([\\s\\S]*?)\\r?\\n```',
    'gmu'
  );
  const matches = [...markdown.matchAll(pattern)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-fenced-block-missing:${language}:${occurrence}`);
  return match[0];
}

function displayMathSource(markdown, occurrence = 0) {
  const matches = [...markdown.matchAll(/^\$\$\r?\n([\s\S]*?)\r?\n\$\$/gmu)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-display-math-missing:${occurrence}`);
  return match[1];
}

function displayMathMarkdown(markdown, occurrence = 0) {
  const pattern = /^\$\$\r?\n([\s\S]*?)\r?\n\$\$/gmu;
  const matches = [...markdown.matchAll(pattern)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-display-math-missing:${occurrence}`);
  return match[0];
}

function privacySafeTextEvidence(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { hash: (hash >>> 0).toString(16), length: value.length };
}

async function readGeneratedExportSnapshot(page) {
  return page.evaluate(() => {
    const digest = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    const sourceField = document.querySelector('#easymde-source');
    const sourceEditor = document.querySelector('.easymde-source-react .cm-content');
    const preview = document.querySelector(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!(sourceField instanceof HTMLTextAreaElement)
      || !(sourceEditor instanceof Element)
      || !(preview instanceof Element)) {
      throw new Error('generated-export-dom-snapshot-unavailable');
    }
    return {
      previewDom: [digest(preview.innerHTML), preview.innerHTML.length],
      sourceDom: [digest(sourceEditor.innerHTML), sourceEditor.innerHTML.length],
      sourceValue: [digest(sourceField.value), sourceField.value.length]
    };
  });
}

async function decodeGeneratedPng(page, bytes, phase) {
  const evidence = await page.evaluate(async (serializedBytes) => {
    if ('function' !== typeof globalThis.createImageBitmap) {
      throw new Error('generated-export-png-decode-unavailable');
    }
    const blob = new Blob([new Uint8Array(serializedBytes)], { type: 'image/png' });
    const bitmap = await globalThis.createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('generated-export-png-canvas-unavailable');
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const width = bitmap.width;
    const height = bitmap.height;
    let nonBlankPixels = 0;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha === 0) continue;
        nonBlankPixels += 1;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    bitmap.close();
    return {
      bounds: { bottom, left, right, top },
      height,
      nonBlankPixels,
      width
    };
  }, [...bytes]);
  const valid = evidence.width > 0
    && evidence.height > 0
    && evidence.nonBlankPixels > 0
    && evidence.bounds.left >= 0
    && evidence.bounds.top >= 0
    && evidence.bounds.right < evidence.width
    && evidence.bounds.bottom < evidence.height;
  if (!valid) {
    throw new Error(
      `editor-context-menu-generated-png-invalid:${phase}:${JSON.stringify(evidence)}`
    );
  }
  return evidence;
}

async function readClipboardPng(page, phase) {
  const readClipboardState = () => page.evaluate(async () => {
    if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.read) {
      throw new Error('native-clipboard-read-unavailable');
    }
    const items = await navigator.clipboard.read();
    return {
      hasPng: items.some((item) => item.types.includes('image/png')),
      itemCount: items.length,
      types: items.flatMap((item) => item.types)
    };
  });
  await expect.poll(
    readClipboardState,
    { message: `native clipboard PNG should settle for ${phase}` }
  ).toEqual(expect.objectContaining({ hasPng: true }));
  const bytes = await page.evaluate(async () => {
    if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.read) {
      throw new Error('native-clipboard-read-unavailable');
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes('image/png')) continue;
      const blob = await item.getType('image/png');
      return [...new Uint8Array(await blob.arrayBuffer())];
    }
    return null;
  });
  if (!bytes) throw new Error(`native-clipboard-png-unavailable:${phase}`);
  return decodeGeneratedPng(page, bytes, phase);
}

function startGeneratedExportMutationProbe(page) {
  const writes = [];
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const body = request.postData() ?? '';
    const action = url.searchParams.get('action')
      ?? new URLSearchParams(body).get('action');
    const isPreview = url.pathname.endsWith('/wp-json/easymde/v1/preview');
    const isHeartbeat = url.pathname.endsWith('/wp-admin/admin-ajax.php')
      && 'heartbeat' === action;
    const isPostLockRelease = 'wp-remove-post-lock' === action;
    if (!isPreview && !isHeartbeat && !isPostLockRelease) {
      writes.push(
        url.pathname.endsWith('/wp-admin/post.php')
          ? 'post-form'
          : url.pathname.endsWith('/wp-admin/admin-ajax.php')
            ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
            : url.pathname.includes('/wp-json/')
              ? 'rest'
              : 'other'
      );
    }
  };
  page.on('request', onRequest);
  return {
    assertEmpty(phase) {
      if (writes.length > 0) {
        throw new Error(
          `editor-context-menu-generated-export-state-write:${phase}:` +
          `${[...new Set(writes)].join(',')}`
        );
      }
    },
    stop() {
      page.off('request', onRequest);
    }
  };
}

async function runGeneratedExportAction(
  page,
  { action, expectedSource, label, markdown, preview, source, sourceEditor, selectText, mutationProbe }
) {
  await assertSourceExactValue(source, markdown, `${label}-before`);
  await selectSourceText(page, sourceEditor, markdown, selectText);
  await openSourceMenu(page, sourceEditor);
  await openRootSubmenu(page, 'generated-content');
  if ('save-generated-image' !== action && 'copy-code-block' !== action) {
    await openVisibleSubmenu(page, 'copy-generated');
  } else if ('copy-code-block' === action) {
    await openVisibleSubmenu(page, 'code-block');
  }
  const before = await readGeneratedExportSnapshot(page);
  const actionItem = anyMenuItem(page, action);
  if ('save-generated-image' === action) {
    const downloadPromise = page.waitForEvent('download');
    await actionItem.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error(`generated-export-download-path-unavailable:${label}`);
    if (!/\.png$/iu.test(download.suggestedFilename())) {
      throw new Error(`generated-export-download-type-invalid:${label}`);
    }
    await decodeGeneratedPng(page, readFileSync(path), `${label}-download`);
  } else if ('copy-generated-image' === action) {
    await actionItem.click();
    await readClipboardPng(page, `${label}-clipboard`);
  } else if ('copy-generated-mathml' === action) {
    await actionItem.click();
    const mathMl = await page.evaluate(async () => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.readText) {
        throw new Error('native-clipboard-read-unavailable');
      }
      return navigator.clipboard.readText();
    });
    const semanticMathMl = await page.evaluate((value) => {
      const documentValue = new DOMParser().parseFromString(value, 'application/xml');
      const root = documentValue.documentElement;
      return {
        hasMathNamespace: root?.namespaceURI === 'http://www.w3.org/1998/Math/MathML',
        isMathRoot: root?.localName === 'math',
        textLength: root?.textContent?.length ?? 0
      };
    }, mathMl);
    if (!semanticMathMl.isMathRoot
      || !semanticMathMl.hasMathNamespace
      || semanticMathMl.textLength === 0) {
      throw new Error(`generated-export-mathml-invalid:${label}`);
    }
  } else if ('copy-generated-source' === action) {
    await actionItem.click();
    const copiedSource = await page.evaluate(async () => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.readText) {
        throw new Error('native-clipboard-read-unavailable');
      }
      return navigator.clipboard.readText();
    });
    if (copiedSource !== expectedSource) {
      throw new Error(
        `generated-export-source-clipboard-drift:${label}:` +
        `${JSON.stringify({
          actual: privacySafeTextEvidence(copiedSource),
          expected: privacySafeTextEvidence(expectedSource)
        })}`
      );
    }
  } else if ('copy-code-block' === action) {
    await actionItem.click();
    const copiedCodeBlock = await page.evaluate(async () => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.readText) {
        throw new Error('native-clipboard-read-unavailable');
      }
      return navigator.clipboard.readText();
    });
    if (copiedCodeBlock !== expectedSource) {
      throw new Error(
        `generated-code-block-clipboard-drift:${label}:` +
        `${JSON.stringify({
          actual: privacySafeTextEvidence(copiedCodeBlock),
          expected: privacySafeTextEvidence(expectedSource)
        })}`
      );
    }
  } else {
    throw new Error(`generated-export-action-unsupported:${label}`);
  }
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await assertSourceExactValue(source, markdown, `${label}-after`);
  const after = await readGeneratedExportSnapshot(page);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `generated-export-dom-drift:${label}:` +
      `${JSON.stringify({ after, before })}`
    );
  }
  mutationProbe.assertEmpty(label);
  await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
}

async function waitForSourceExactValue(source, expected, phase) {
  await expect.poll(
    () => source.evaluate(
      (field, expectedValue) => 'value' in field && field.value === expectedValue,
      expected
    ),
    { message: `source should reach the expected state: ${phase}` }
  ).toBe(true);
}

async function readNativeClipboardText(page) {
  return page.evaluate(async () => {
    if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.readText) {
      throw new Error('native-clipboard-read-unavailable');
    }
    return navigator.clipboard.readText();
  });
}

async function readNativeClipboardMarkup(page, phase) {
  await expect.poll(
    () => readNativeClipboardText(page),
    { message: `native clipboard HTML should settle for ${phase}` }
  ).toMatch(/<p\b[\s\S]*<\/p>/iu);
  return readNativeClipboardText(page);
}

function startSourceMediaConsoleProbe(page) {
  const codes = new Set();
  const onConsole = (message) => {
    if ('error' !== message.type()) return;
    const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
    if (match) codes.add(match[1]);
  };
  page.on('console', onConsole);
  return {
    codes: () => [...codes].sort(),
    stop() {
      page.off('console', onConsole);
    }
  };
}

function startSourceMediaMutationProbe(page) {
  const articleWrites = new Set();
  const mediaActions = new Set([
    'query-attachments',
    'save-attachment',
    'save-attachment-compat'
  ]);
  let uploadCount = 0;
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const body = request.postData() ?? '';
    const action = url.searchParams.get('action')
      ?? new URLSearchParams(body).get('action');
    const path = url.pathname;
    const isPreview = path.endsWith('/wp-json/easymde/v1/preview');
    const isHeartbeat = path.endsWith('/wp-admin/admin-ajax.php')
      && 'heartbeat' === action;
    const isPostLockRelease = 'wp-remove-post-lock' === action;
    const isMediaUpload = path.endsWith('/wp-admin/async-upload.php');
    const isMediaAction = path.endsWith('/wp-admin/admin-ajax.php')
      && mediaActions.has(action);
    if (isMediaUpload) {
      uploadCount += 1;
      return;
    }
    if (isPreview || isHeartbeat || isPostLockRelease || isMediaAction) return;
    articleWrites.add(
      path.endsWith('/wp-admin/post.php')
        ? 'post-form'
        : path.endsWith('/wp-admin/admin-ajax.php')
          ? 'admin-ajax'
          : path.includes('/wp-json/')
            ? 'rest'
            : 'other'
    );
  };
  page.on('request', onRequest);
  return {
    assertNoArticleWrites(phase) {
      if (articleWrites.size > 0) {
        throw new Error(
          `editor-context-menu-source-media-article-write:${phase}:` +
          `${[...articleWrites].sort().join(',')}`
        );
      }
    },
    assertUpload(phase) {
      if (uploadCount < 1) {
        throw new Error(`editor-context-menu-source-media-upload-missing:${phase}`);
      }
    },
    uploadCount() {
      return uploadCount;
    },
    stop() {
      page.off('request', onRequest);
    }
  };
}

async function openSourceInsertImagePicker(page, sourceEditor, markdown) {
  await placeSourceCaret(page, sourceEditor, markdown, '普通文本');
  const sourceState = await readSourceMediaBridgeState(sourceEditor);
  await openSourceMenu(page, sourceEditor);
  await openRootSubmenu(page, 'insert');
  await expectMenuItemState(page, 'insert-image', 'enabled');
  await anyMenuItem(page, 'insert-image').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);

  const dialog = page.locator('.easymde-media-picker-dialog');
  await expect(dialog).toBeVisible();
  const mediaFrame = page.frameLocator('.easymde-media-picker-frame');
  const mediaModal = mediaFrame.locator('.media-modal:visible');
  await expect(mediaModal).toBeVisible();
  return { dialog, mediaFrame, mediaModal, sourceState };
}

async function readSourceMediaBridgeState(sourceEditor) {
  return sourceEditor.evaluate((surface) => {
    const field = document.querySelector('#easymde-source');
    const active = document.activeElement;
    return {
      activeClass: active instanceof Element && 'string' === typeof active.className
        ? active.className.slice(0, 120)
        : '',
      activeTag: active?.tagName ?? '',
      fieldConnected: field instanceof HTMLTextAreaElement && field.isConnected,
      selectionEnd: field instanceof HTMLTextAreaElement ? field.selectionEnd : null,
      selectionStart: field instanceof HTMLTextAreaElement ? field.selectionStart : null,
      sourceEditorConnected: surface.isConnected,
      valueLength: field instanceof HTMLTextAreaElement ? field.value.length : null
    };
  });
}

async function uploadAndSelectSourceImage(page, mediaFrame, mediaModal) {
  await mediaModal.getByRole('tab', { name: /上传文件|Upload files/u }).click();
  const uploadResponse = page.waitForResponse((response) => (
    'POST' === response.request().method()
    && new URL(response.url()).pathname.endsWith('/wp-admin/async-upload.php')
  ));
  await mediaFrame.locator('input[type="file"]').last().setInputFiles({
    name: 'easymde-context-menu-logo.png',
    mimeType: 'image/png',
    buffer: fixtureImage
  });
  const response = await uploadResponse;
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('editor-context-menu-source-media-upload-response-invalid', { cause: error });
  }
  const attachmentId = Number(payload?.data?.id);
  if (!response.ok() || true !== payload?.success || !Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
    throw new Error('editor-context-menu-source-media-upload-failed');
  }

  await mediaModal.getByRole('tab', { name: /媒体库|Media Library/u }).click();
  const attachment = mediaFrame.locator(`.attachment[data-id="${attachmentId}"]`);
  await expect(attachment).toHaveCount(1);
  await attachment.check();
  await expect(attachment).toHaveClass(/\bselected\b/u);
  const selectButton = mediaModal.locator(
    'button.media-button-select:visible, button.media-button-insert:visible'
  );
  await expect(selectButton).toHaveCount(1);
  await expect(selectButton).toBeEnabled();
  const attachmentState = await attachment.evaluate((element) => ({
    ariaChecked: element.getAttribute('aria-checked'),
    className: element.className,
    connected: element.isConnected
  }));
  await selectButton.click();
  return { attachmentState };
}

async function waitForSourceMediaInsertion(
  source,
  markdown,
  insertionOffset,
  phase,
  codes,
  readBridgeState,
  diagnosticContext = null
) {
  try {
    await expect.poll(
      () => source.evaluate((field, expected) => (
        'value' in field && field.value !== expected
      ), markdown),
      { message: `Source media insertion should change the document: ${phase}` }
    ).toBe(true);
  } catch (error) {
    const stableCodes = codes();
    const bridgeState = await readBridgeState();
    throw new Error(
      `editor-context-menu-source-media-source-unchanged:${phase}:` +
      `${JSON.stringify({
        bridgeState,
        codes: stableCodes.length > 0 ? stableCodes : ['no-stable-code'],
        context: diagnosticContext
      })}`,
      { cause: error }
    );
  }

  const actual = await source.inputValue();
  const prefix = markdown.slice(0, insertionOffset);
  const suffix = markdown.slice(insertionOffset);
  if (!actual.startsWith(prefix) || !actual.endsWith(suffix)) {
    throw new Error(`editor-context-menu-source-media-outside-bytes-drift:${phase}`);
  }
  const inserted = actual.slice(prefix.length, actual.length - suffix.length);
  if (!/^!\[[^\]\r\n]+\]\(https?:\/\/[^\r\n]+(?: "[^"\r\n]+")?\)$/u.test(inserted)) {
    throw new Error(`editor-context-menu-source-media-insertion-invalid:${phase}`);
  }
  if (!inserted.includes('easymde context menu logo')) {
    throw new Error(`editor-context-menu-source-media-alt-invalid:${phase}`);
  }
}

function assertClipboardTextExact(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `editor-context-menu-source-clipboard-drift:${label}:` +
      `${JSON.stringify({ actual: privacySafeTextEvidence(actual), expected: privacySafeTextEvidence(expected) })}`
    );
  }
}

async function prepareSourceContextAction(page, sourceEditor, markdown, selectionText, submenu = null) {
  await selectSourceText(page, sourceEditor, markdown, selectionText);
  await openSourceMenu(page, sourceEditor);
  if (submenu) await openRootSubmenu(page, submenu);
}

async function exerciseMissingSourceActions(page, { markdown, source, sourceEditor, mode }) {
  const mutationProbe = startGeneratedExportMutationProbe(page);
  const selectedText = '普通文本';
  const replacementText = 'E2E paste replacement';
  const linkMarkdown = '[OpenAI 官网](https://openai.com)';
  const codeBody = fencedBlockSource(markdown, 'bash');
  const codeFence = `\`\`\`bash\n${codeBody}\n\`\`\``;
  try {
    for (const action of ['copy-as-markdown', 'copy-as-html']) {
      await assertSourceExactValue(source, markdown, `${mode}-${action}-before`);
      await prepareSourceContextAction(page, sourceEditor, markdown, selectedText, 'copy-paste-as');
      const before = await readGeneratedExportSnapshot(page);
      await anyMenuItem(page, action).click();
      const copied = await readNativeClipboardText(page);
      if ('copy-as-markdown' === action) {
        assertClipboardTextExact(copied, selectedText, `${mode}-${action}`);
      } else {
        const htmlEvidence = await page.evaluate((value) => {
          const documentValue = new DOMParser().parseFromString(value, 'text/html');
          return {
            paragraphCount: documentValue.querySelectorAll('p').length,
            textLength: documentValue.body?.textContent?.length ?? 0
          };
        }, await readNativeClipboardMarkup(page, `${mode}-${action}`));
        if (htmlEvidence.paragraphCount < 1 || htmlEvidence.textLength === 0) {
          throw new Error(`editor-context-menu-source-html-clipboard-invalid:${mode}`);
        }
      }
      await expect(page.locator(menuSelector)).toHaveCount(0);
      await assertSourceExactValue(source, markdown, `${mode}-${action}-after`);
      const after = await readGeneratedExportSnapshot(page);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`editor-context-menu-source-copy-dom-drift:${mode}-${action}`);
      }
      mutationProbe.assertEmpty(`${mode}-${action}`);
    }

    await assertSourceExactValue(source, markdown, `${mode}-cut-before`);
    await prepareSourceContextAction(page, sourceEditor, markdown, selectedText);
    await rootItem(page, 'cut').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await waitForSourceExactValue(
      source,
      markdown.replace(selectedText, ''),
      `${mode}-cut-applied`
    );
    assertClipboardTextExact(await readNativeClipboardText(page), selectedText, `${mode}-cut`);
    await sourceEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, `${mode}-cut-undo`);
    mutationProbe.assertEmpty(`${mode}-cut`);

    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, replacementText);
    await assertSourceExactValue(source, markdown, `${mode}-paste-before`);
    await prepareSourceContextAction(page, sourceEditor, markdown, selectedText, 'copy-paste-as');
    await anyMenuItem(page, 'paste-plain-text').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    const pastedMarkdown = markdown.replace(selectedText, replacementText);
    await waitForSourceExactValue(source, pastedMarkdown, `${mode}-paste-applied`);
    await sourceEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, `${mode}-paste-undo`);
    mutationProbe.assertEmpty(`${mode}-paste`);

    await assertSourceExactValue(source, markdown, `${mode}-link-before`);
    await prepareSourceContextAction(page, sourceEditor, markdown, linkMarkdown);
    await rootItem(page, 'copy-link-address').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      'https://openai.com',
      `${mode}-copy-link-address`
    );
    await assertSourceExactValue(source, markdown, `${mode}-link-after`);
    mutationProbe.assertEmpty(`${mode}-copy-link-address`);

    await assertSourceExactValue(source, markdown, `${mode}-code-before`);
    await prepareSourceContextAction(page, sourceEditor, markdown, 'echo "Hello, Markdown!"', 'code-block');
    await anyMenuItem(page, 'copy-code-block').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      codeFence,
      `${mode}-copy-code-block`
    );
    await assertSourceExactValue(source, markdown, `${mode}-code-after`);
    mutationProbe.assertEmpty(`${mode}-copy-code-block`);
  } finally {
    mutationProbe.stop();
  }
}

async function applyImageScaleFromSource(
  page,
  source,
  sourceEditor,
  markdown,
  imageMarkdown,
  percentage,
  expected
) {
  await assertSourceExactValue(source, markdown, `before-${percentage}`);
  await selectSourceText(page, sourceEditor, markdown, imageMarkdown);
  await openSourceMenu(page, sourceEditor);
  await openRootSubmenu(page, 'image-scale');
  await expectMenuItemState(page, `image-scale-${percentage}`, 'enabled');
  await anyMenuItem(page, `image-scale-${percentage}`).click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await assertSourceExactValue(source, expected, `after-${percentage}`);
}

async function exerciseImageScaleMatrix(
  page,
  { markdown, imageMarkdown, preview, source, sourceEditor, mode }
) {
  const percentages = [25, 33, 50, 67, 100, 150, 200];
  const image = preview.getByAltText(imageSourceAlt, { exact: true });
  await expect(image).toHaveCount(1);
  await waitForRealImageLoad(image);

  for (const percentage of percentages) {
    const expected = imageScaleSource(markdown, imageMarkdown, percentage);
    await applyImageScaleFromSource(
      page,
      source,
      sourceEditor,
      markdown,
      imageMarkdown,
      percentage,
      expected
    );
    await assertPreviewImageScale(image, percentage, `${mode}-apply`);

    await sourceEditor.press('ControlOrMeta+z');
    await assertSourceExactValue(source, markdown, `undo-${percentage}`);
    await expect.poll(
      () => image.getAttribute('data-easymde-image-scale')
    ).toBeNull();
  }
}

async function saveAndReloadImageScale(page, source, expected) {
  const savePost = page.locator('#save-post');
  await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
  const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
  await savePost.click();
  await savedNavigation;
  await expect(page.locator('#easymde-editor')).toBeVisible();

  const openingWrites = [];
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const body = request.postData() ?? '';
    const parameters = new URLSearchParams(body);
    let action = parameters.get('action');
    const multipartValue = (name) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const match = body.match(
        new RegExp(`name="${escapedName}"[^\\r\\n]*\\r?\\n\\r?\\n([^\\r\\n]*)`, 'u')
      );
      return match?.[1]?.trim() ?? null;
    };
    action ??= multipartValue('action');
    if (!action && body.trim().startsWith('{')) {
      try {
        const payload = JSON.parse(body);
        action = 'object' === typeof payload && payload && 'string' === typeof payload.action
          ? payload.action
          : null;
      } catch {
        action = null;
      }
    }
    const isPreview = url.pathname.endsWith('/wp-json/easymde/v1/preview');
    const isHeartbeat = url.pathname.endsWith('/wp-admin/admin-ajax.php')
      && ('heartbeat' === url.searchParams.get('action')
        || /(?:^|&)action=heartbeat(?:&|$)/u.test(body)
        || 'heartbeat' === action);
    const isPostLockRelease = 'wp-remove-post-lock' === action;
    if (!isPreview && !isHeartbeat && !isPostLockRelease) {
      openingWrites.push(
        url.pathname.endsWith('/wp-admin/post.php')
          ? 'post-form'
          : url.pathname.endsWith('/wp-admin/admin-ajax.php')
            ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
            : url.pathname.includes('/wp-json/')
              ? 'rest'
              : 'other'
      );
    }
  };
  page.on('request', onRequest);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, expected, 'after-reload');
    const reloadedPreview = page.locator('[data-easymde-preview-html-sink="1"]').last();
    const reloadedImage = reloadedPreview.getByAltText(imageSourceAlt, { exact: true });
    await expect(reloadedImage).toHaveCount(1);
    await waitForRealImageLoad(reloadedImage);
    await assertPreviewImageScale(reloadedImage, 200, 'after-reload');
  } finally {
    page.off('request', onRequest);
  }
  if (openingWrites.length > 0) {
    throw new Error(
      `editor-context-menu-image-scale-opening-write:${openingWrites.length}:` +
      `${[...new Set(openingWrites)].join(',')}`
    );
  }
}

function sourceLineMetrics(markdown, offset) {
  const prefix = markdown.slice(0, offset);
  const lineBreaks = prefix.match(/\r\n|\r|\n/gu) ?? [];
  const lastBreak = Math.max(
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('\r')
  );
  return {
    column: offset - (lastBreak < 0 ? 0 : lastBreak + 1),
    line: lineBreaks.length
  };
}

function sourceLineBoundary(markdown, start) {
  const newline = markdown.indexOf('\n', start);
  if (newline < 0) {
    return { end: markdown.length, nextStart: markdown.length };
  }
  return {
    end: newline > start && '\r' === markdown[newline - 1]
      ? newline - 1
      : newline,
    nextStart: newline + 1
  };
}

async function expectSourceSelection(page, start, end) {
  await expect.poll(
    () => page.locator('#easymde-source').evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }))
  ).toEqual({ end, start });
}

async function sourceSelectionStart(page) {
  const value = await page.locator('#easymde-source').evaluate((field) => field.selectionStart);
  if (!Number.isInteger(value)) throw new Error('source-selection-start-unavailable');
  return value;
}

async function moveToSourceLineEnd(page, source, expectedEnd) {
  let current = await sourceSelectionStart(page);
  while (current < expectedEnd) {
    await source.press(sourceLineEndKey);
    const next = await sourceSelectionStart(page);
    if (next <= current) {
      throw new Error('source-logical-line-end-navigation-stalled');
    }
    current = next;
  }
  if (current > expectedEnd) {
    throw new Error('source-logical-line-end-navigation-overran');
  }
}

async function moveSourceCaret(page, source, markdown, offset) {
  const { column, line } = sourceLineMetrics(markdown, offset);
  await source.focus();
  await source.press(sourceDocumentStartKey);
  await expectSourceSelection(page, 0, 0);
  let lineStart = 0;
  for (let index = 0; index < line; index += 1) {
    const boundary = sourceLineBoundary(markdown, lineStart);
    await moveToSourceLineEnd(page, source, boundary.end);
    await page.keyboard.press('ArrowRight');
    lineStart = boundary.nextStart;
    await expectSourceSelection(page, lineStart, lineStart);
  }
  for (let index = 0; index < column; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expectSourceSelection(page, offset, offset);
}

async function selectSourceText(page, source, markdown, value, occurrence = 0) {
  const start = occurrenceOffset(markdown, value, occurrence);
  await moveSourceCaret(page, source, markdown, start);
  await page.keyboard.down('Shift');
  for (let index = 0; index < value.length; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await expectSourceSelection(page, start, start + value.length);
}

async function selectSourceRange(page, source, markdown, start, end) {
  if (!Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || end > markdown.length) {
    throw new Error('source-selection-range-invalid');
  }
  await moveSourceCaret(page, source, markdown, start);
  await page.keyboard.down('Shift');
  for (let index = 0; index < end - start; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await expectSourceSelection(page, start, end);
}

async function replaceSourceWithNativeInput(page, sourceEditor, source, value, phase) {
  await sourceEditor.focus();
  await sourceEditor.press('ControlOrMeta+a');
  await sourceEditor.press('Backspace');
  await page.keyboard.insertText(value);
  await waitForSourceExactValue(source, value, phase);
}

async function placeSourceCaret(page, source, markdown, value, occurrence = 0) {
  await moveSourceCaret(
    page,
    source,
    markdown,
    occurrenceOffset(markdown, value, occurrence)
  );
}

async function assertSourceFixtureExact(source, markdown, categoryId, phase) {
  const exact = await source.evaluate(
    (field, expected) => 'value' in field && field.value === expected,
    markdown
  );
  if (!exact) {
    throw new Error(`editor-context-menu-source-drift:${categoryId}:${phase}`);
  }
}

function rootMenu(page) {
  return page.locator(`${menuSelector} [data-easymde-context-menu-layer="root"]`);
}

function rootItem(page, id) {
  return rootMenu(page).locator(`[data-easymde-context-menu-item="${id}"]`);
}

function anyMenuItem(page, id) {
  return page.locator(`${menuViewportSelector} [data-easymde-context-menu-item="${id}"]`);
}

async function openSourceMenu(page, source) {
  await source.press('Shift+F10');
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
}

async function visibleSourceSelectionPoint(sourceEditor, expectedText) {
  return sourceEditor.evaluate((surface, text) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.toString() !== text) {
      throw new Error('source-text-selection-not-preserved');
    }
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((candidate) =>
      candidate.width > 0
      && candidate.height > 0
      && candidate.bottom > 0
      && candidate.top < (surface.ownerDocument.defaultView?.innerHeight ?? 0)
    );
    if (!rect) throw new Error('source-text-selection-rect-unavailable');
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, expectedText);
}

async function openSourceNativeMenu(page, sourceEditor, expectedText) {
  const point = await visibleSourceSelectionPoint(sourceEditor, expectedText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
}

async function runSourceThematicBreakDelete(
  page,
  { expected, label, markdown, source, sourceEditor }
) {
  await selectSourceText(page, sourceEditor, markdown, '---');
  await openSourceNativeMenu(page, sourceEditor, '---');
  await expectMenuItemState(page, 'delete-thematic-break', 'enabled');
  await anyMenuItem(page, 'delete-thematic-break').click();
  await waitForSourceExactValue(source, expected, `${label}-delete`);
  await expect(page.locator(menuSelector)).toHaveCount(0);

  await sourceEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${label}-undo`);
}

async function startSourceTransactionProbe(page) {
  const key = '__easymdeSourceTransactionProbe';
  await page.evaluate((probeKey) => {
    const previous = globalThis[probeKey];
    previous?.stop?.();
    const events = [];
    const isSourceTarget = (target) => target instanceof Element
      && (target.id === 'easymde-source' || Boolean(target.closest('.easymde-source-react')));
    const onEvent = (event) => {
      if (!isSourceTarget(event.target)) return;
      events.push({
        tag: event.target instanceof Element ? event.target.tagName : null,
        type: event.type
      });
    };
    for (const type of ['beforeinput', 'input', 'change']) {
      document.addEventListener(type, onEvent, true);
    }
    globalThis[probeKey] = {
      snapshot() {
        return { events: [...events], count: events.length };
      },
      stop() {
        for (const type of ['beforeinput', 'input', 'change']) {
          document.removeEventListener(type, onEvent, true);
        }
        delete globalThis[probeKey];
      }
    };
  }, key);
  return {
    async snapshot() {
      return page.evaluate((probeKey) => globalThis[probeKey]?.snapshot?.() ?? null, key);
    },
    async stop() {
      await page.evaluate((probeKey) => globalThis[probeKey]?.stop?.(), key);
    }
  };
}

async function readPrivacySafeSourceState(source, expected) {
  return source.evaluate((field, expectedValue) => {
    const value = 'value' in field && 'string' === typeof field.value ? field.value : '';
    const digest = (input) => {
      let hash = 2166136261;
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    return {
      changed: value !== expectedValue,
      expectedHash: digest(expectedValue),
      expectedLength: expectedValue.length,
      hash: digest(value),
      length: value.length,
      selectionEnd: field instanceof HTMLTextAreaElement ? field.selectionEnd : null,
      selectionStart: field instanceof HTMLTextAreaElement ? field.selectionStart : null
    };
  }, expected);
}

async function startSettingsShortcutProbe(page) {
  const key = '__easymdeSettingsShortcutProbe';
  await page.evaluate((probeKey) => {
    const previous = globalThis[probeKey];
    previous?.stop?.();
    const events = [];
    const digest = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    const record = (phase, event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== '9') return;
      const target = event.target instanceof Element ? event.target : null;
      const selection = target?.ownerDocument.defaultView?.getSelection();
      const source = document.querySelector('#easymde-source');
      const visual = document.querySelector(
        '[data-easymde-preview-html-sink="1"][contenteditable="true"]'
      );
      const sourceValue = source instanceof HTMLTextAreaElement ? source.value : '';
      events.push({
        activeTag: document.activeElement?.tagName ?? '',
        defaultPrevented: event.defaultPrevented,
        editorRootContains: Boolean(document.querySelector('#easymde-editor')?.contains(target)),
        phase,
        sourceHash: digest(sourceValue),
        sourceLength: sourceValue.length,
        selectedTextLength: selection?.toString().length ?? 0,
        targetClass: target && 'string' === typeof target.className
          ? target.className.slice(0, 120)
          : '',
        targetTag: target?.tagName ?? '',
        visualSurfaceTarget: Boolean(visual?.contains(target))
      });
    };
    const onCapture = (event) => record('capture', event);
    const onBubble = (event) => record('bubble', event);
    document.addEventListener('keydown', onCapture, true);
    document.addEventListener('keydown', onBubble);
    globalThis[probeKey] = {
      snapshot() {
        return [...events];
      },
      stop() {
        document.removeEventListener('keydown', onCapture, true);
        document.removeEventListener('keydown', onBubble);
        delete globalThis[probeKey];
      }
    };
  }, key);
  return {
    async snapshot() {
      return page.evaluate((probeKey) => globalThis[probeKey]?.snapshot?.() ?? [], key);
    },
    async stop() {
      await page.evaluate((probeKey) => globalThis[probeKey]?.stop?.(), key);
    }
  };
}

async function startSettingsFormatBoldProbe(page) {
  const key = '__easymdeSettingsFormatBoldProbe';
  await page.evaluate((probeKey) => {
    const previous = globalThis[probeKey];
    previous?.stop?.();
    const events = [];
    const describeAncestor = (node) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return {
        bAncestor: Boolean(element?.closest('b')),
        strongAncestor: Boolean(element?.closest('strong')),
        tag: element?.tagName ?? ''
      };
    };
    const onEvent = (event) => {
      if (!['beforeinput', 'input'].includes(event.type)) return;
      if (!(event instanceof InputEvent) || event.inputType !== 'formatBold') return;
      const selection = document.defaultView?.getSelection();
      events.push({
        anchor: describeAncestor(selection?.anchorNode),
        focus: describeAncestor(selection?.focusNode),
        inputType: event.inputType,
        targetTag: event.target instanceof Element ? event.target.tagName : '',
        type: event.type
      });
    };
    document.addEventListener('beforeinput', onEvent, true);
    document.addEventListener('input', onEvent, true);
    globalThis[probeKey] = {
      snapshot() {
        return [...events];
      },
      stop() {
        document.removeEventListener('beforeinput', onEvent, true);
        document.removeEventListener('input', onEvent, true);
        delete globalThis[probeKey];
      }
    };
  }, key);
  return {
    async snapshot() {
      return page.evaluate((probeKey) => globalThis[probeKey]?.snapshot?.() ?? [], key);
    },
    async stop() {
      await page.evaluate((probeKey) => globalThis[probeKey]?.stop?.(), key);
    }
  };
}

async function startContextMenuDiagnostics(page, categoryId, targetMetadata = null) {
  await page.evaluate(({
    categoryId: currentCategoryId,
    eventLimit,
    key,
    targetMetadata: currentTargetMetadata
  }) => {
    const previous = globalThis[key];
    previous?.stop?.();
    const events = [];
    const nativeEvents = [];
    const selectionApiEvents = [];
    const windowEvents = [];
    const startedAt = performance.now();
    const sourceField = document.querySelector('#easymde-source');
    const visualSurface = document.querySelector(
      '[data-easymde-preview-html-sink="1"][contenteditable="true"]'
    );
    const describeTarget = (target) => {
      if (target === globalThis) return { className: '', tag: 'WINDOW' };
      if (target === document) return { className: '', tag: 'DOCUMENT' };
      if (!(target instanceof Element)) {
        return { className: '', tag: target?.constructor?.name ?? 'UNKNOWN' };
      }
      const className = 'string' === typeof target.className
        ? target.className.slice(0, 160)
        : '';
      return { className, tag: target.tagName };
    };
    const boundsOf = (element) => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        width: Math.round(rect.width * 100) / 100
      };
    };
    const describeElement = (element) => element instanceof Element
      ? { ...describeTarget(element), bounds: boundsOf(element), connected: element.isConnected }
      : null;
    const selectionState = () => {
      const selection = globalThis.getSelection?.();
      return {
        collapsed: selection?.isCollapsed ?? null,
        length: selection ? selection.toString().length : null
      };
    };
    const sourceSelectionState = () => {
      if (!(sourceField instanceof HTMLTextAreaElement)) return null;
      return {
        end: sourceField.selectionEnd,
        start: sourceField.selectionStart
      };
    };
    const selectionApiState = () => {
      const selection = globalThis.getSelection?.();
      const anchor = selection?.anchorNode;
      const focus = selection?.focusNode;
      const describeNode = (node) => {
        const element = node instanceof Element ? node : node?.parentElement;
        return element instanceof Element
          ? describeElement(element)
          : null;
      };
      return {
        anchor: describeNode(anchor),
        collapsed: selection?.isCollapsed ?? null,
        focus: describeNode(focus),
        length: selection ? selection.toString().length : null,
        rangeCount: selection?.rangeCount ?? null
      };
    };
    const appendSelectionApiEvent = (event) => {
      selectionApiEvents.push({
        elapsedMs: Math.round(performance.now() - startedAt),
        ...event,
        selection: selectionApiState()
      });
      if (selectionApiEvents.length > 64) selectionApiEvents.shift();
    };
    const canvasScrollState = () => {
      const canvas = document.querySelector('.easymde-immersive-preview-canvas');
      return canvas
        ? { left: canvas.scrollLeft, top: canvas.scrollTop }
        : null;
    };
    const geometryState = (element) => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        bounds: {
          bottom: Math.round(rect.bottom * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100
        },
        className: 'string' === typeof element.className
          ? element.className.slice(0, 160)
          : '',
        connected: element.isConnected,
        marginBottom: styles.marginBottom,
        marginTop: styles.marginTop,
        tag: element.tagName
      };
    };
    const windowGeometryState = () => {
      const canvas = document.querySelector('.easymde-immersive-preview-canvas');
      if (!canvas) return null;
      const scrollTop = canvas.scrollTop;
      const blocks = Array.from(canvas.querySelectorAll('[data-easymde-visual-block-id]'));
      const spacers = Array.from(canvas.querySelectorAll('[data-easymde-preview-window-spacer]'));
      const table = canvas.querySelector('table');
      return {
        canvas: { left: canvas.scrollLeft, top: scrollTop },
        firstMounted: geometryState(blocks[0] ?? null),
        lastMounted: geometryState(blocks[blocks.length - 1] ?? null),
        mountedBlockRange: {
          count: blocks.length,
          first: blocks[0]?.getAttribute('data-easymde-visual-block-id') ?? null,
          last: blocks[blocks.length - 1]?.getAttribute('data-easymde-visual-block-id') ?? null
        },
        spacers: spacers.map((spacer) => ({
          bounds: geometryState(spacer)?.bounds ?? null,
          end: spacer.getAttribute('data-easymde-preview-window-end'),
          height: spacer.getBoundingClientRect().height,
          marginBottom: getComputedStyle(spacer).marginBottom,
          start: spacer.getAttribute('data-easymde-preview-window-start'),
          top: spacer.getBoundingClientRect().top
        })),
        table: table
          ? {
              documentTop: table.getBoundingClientRect().top + scrollTop,
              geometry: geometryState(table)
            }
          : null
      };
    };
    const appendWindowEvent = (event) => {
      windowEvents.push({ elapsedMs: Math.round(performance.now() - startedAt), ...event });
      if (windowEvents.length > 64) windowEvents.shift();
    };
    const hitTestState = (event) => {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      return {
        element: describeElement(hit),
        list: describeElement(hit?.closest?.('ul,ol')),
        listItem: describeElement(hit?.closest?.('li'))
      };
    };
    const nativeEventState = (event) => ({
      button: 'button' in event ? event.button : null,
      canvasScroll: canvasScrollState(),
      client: Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? { x: event.clientX, y: event.clientY }
        : null,
      hit: hitTestState(event),
      isTrusted: Boolean(event.isTrusted),
      selection: selectionState(),
      sourceSelection: sourceSelectionState()
    });
    const appendEvent = (event) => {
      events.push({ elapsedMs: Math.round(performance.now() - startedAt), ...event });
      if (events.length > eventLimit) events.shift();
      if (['contextmenu', 'mousedown', 'pointerdown'].includes(event.type)) {
        nativeEvents.push({ elapsedMs: Math.round(performance.now() - startedAt), ...event });
      }
    };
    const onScroll = (event) => {
      const windowGeometry = windowGeometryState();
      appendWindowEvent({ state: windowGeometry, type: 'scroll' });
      appendEvent({
        canvasScroll: canvasScrollState(),
        isTrusted: Boolean(event.isTrusted),
        windowGeometry,
        target: describeTarget(event.target),
        type: 'scroll'
      });
    };
    const onResize = (event) => {
      appendEvent({
        isTrusted: Boolean(event.isTrusted),
        target: describeTarget(event.target),
        type: 'resize',
        viewport: { height: globalThis.innerHeight, width: globalThis.innerWidth }
      });
    };
    const onInput = (category) => (event) => {
      appendEvent({
        input: category,
        isTrusted: Boolean(event.isTrusted),
        target: describeTarget(event.target),
        type: 'input'
      });
    };
    const onScrollKey = (event) => {
      if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        return;
      }
      onInput('scroll-key')(event);
    };
    const onPointerDown = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      onInput(target?.closest('.cm-scroller') ? 'scrollbar-pointer' : 'pointer')(event);
      appendEvent({ ...nativeEventState(event), type: 'pointerdown' });
    };
    const onMouseDown = (event) => {
      appendEvent({ ...nativeEventState(event), type: 'mousedown' });
    };
    const onContextMenu = (event) => {
      appendEvent({
        ...nativeEventState(event),
        defaultPrevented: event.defaultPrevented,
        type: 'contextmenu'
      });
    };
    const onContextMenuBubble = (event) => {
      appendEvent({
        ...nativeEventState(event),
        defaultPrevented: event.defaultPrevented,
        phase: 'surface-bubble',
        type: 'contextmenu-bubble'
      });
    };
    const onSelectionChange = () => {
      appendEvent({
        canvasScroll: canvasScrollState(),
        selection: selectionState(),
        sourceSelection: sourceSelectionState(),
        type: 'selectionchange'
      });
    };
    const originalSetSelectionRange = HTMLTextAreaElement.prototype.setSelectionRange;
    const onSourceSelectionRange = function(start, end, direction) {
      if (this.id === 'easymde-source') {
        appendEvent({
          direction: direction ?? 'none',
          end,
          start,
          type: 'source-selection-range'
        });
      }
      return originalSetSelectionRange.call(this, start, end, direction);
    };
    HTMLTextAreaElement.prototype.setSelectionRange = onSourceSelectionRange;
    const selectionPrototype = globalThis.Selection?.prototype ?? null;
    const selectionMethods = ['addRange', 'collapse', 'removeAllRanges', 'setBaseAndExtent']
      .map((name) => ({
        descriptor: selectionPrototype
          ? Object.getOwnPropertyDescriptor(selectionPrototype, name)
          : null,
        name
      }))
      .filter(({ descriptor }) => descriptor?.value);
    for (const { descriptor, name } of selectionMethods) {
      Object.defineProperty(selectionPrototype, name, {
        ...descriptor,
        value(...args) {
          const result = descriptor.value.apply(this, args);
          appendSelectionApiEvent({ method: name });
          return result;
        }
      });
    }
    const focusPrototype = HTMLElement.prototype;
    const focusDescriptor = Object.getOwnPropertyDescriptor(focusPrototype, 'focus');
    if (focusDescriptor?.value) {
      Object.defineProperty(focusPrototype, 'focus', {
        ...focusDescriptor,
        value(...args) {
          const result = focusDescriptor.value.apply(this, args);
          appendSelectionApiEvent({
            method: 'focus',
            target: describeElement(this)
          });
          return result;
        }
      });
    }
    const onWheel = onInput('wheel');
    const onTouchMove = onInput('touchmove');
    const rootMenuForNode = (node) => {
      if (!(node instanceof Element)) return null;
      return node.matches('[data-easymde-context-menu="true"]')
        ? node
        : node.querySelector('[data-easymde-context-menu="true"]');
    };
    const editorRootForNode = (node) => {
      if (!(node instanceof Element)) return null;
      return node.matches('[data-easymde-editor-owner="react"]')
        ? node
        : node.querySelector('[data-easymde-editor-owner="react"]');
    };
    const state = {
      categoryId: currentCategoryId,
      events,
      interactionSteps: [],
      menuAttachCount: 0,
      menuDetachCount: 0,
      rootAttachCount: 0,
      rootDetachCount: 0,
      rootElement: document.querySelector('[data-easymde-editor-owner="react"]'),
      nativeEvents,
      preparationObserver: null,
      selectionApiEvents,
      sourceElement: document.querySelector('.easymde-source-react .cm-content'),
      startedAt,
      stop: null,
      targetMetadata: currentTargetMetadata,
      windowEvents,
      workspaceElement: document.querySelector('.easymde-workspace')
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          const editorRoot = editorRootForNode(node);
          if (editorRoot) {
            state.rootAttachCount += 1;
            appendEvent({
              isTrusted: null,
              target: describeTarget(editorRoot),
              type: 'root-attach'
            });
          }
          const root = rootMenuForNode(node);
          if (!root) continue;
          state.menuAttachCount += 1;
          appendEvent({ isTrusted: null, target: describeTarget(root), type: 'menu-attach' });
        }
        for (const node of mutation.removedNodes) {
          const editorRoot = editorRootForNode(node);
          if (editorRoot) {
            state.rootDetachCount += 1;
            appendEvent({
              isTrusted: null,
              target: describeTarget(editorRoot),
              type: 'root-detach'
            });
          }
          const root = rootMenuForNode(node);
          if (!root) continue;
          state.menuDetachCount += 1;
          appendEvent({ isTrusted: null, target: describeTarget(root), type: 'menu-detach' });
        }
      }
    });
    const preparationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if ('attributes' !== mutation.type) continue;
        appendEvent({
          attribute: mutation.attributeName,
          preview: {
            accepted: document.querySelector('[data-easymde-preview-html-sink="1"]')
              ?.getAttribute('data-easymde-preview-accepted') ?? null,
            busy: document.querySelector('[data-easymde-preview-html-sink="1"]')
              ?.getAttribute('aria-busy') ?? null,
            error: document.querySelector('[data-easymde-preview-html-sink="1"]')
              ?.getAttribute('data-easymde-preview-error') ?? null,
            refreshing: document.querySelector('[data-easymde-preview-html-sink="1"]')
              ?.getAttribute('data-easymde-preview-refreshing') ?? null
          },
          sessionStatus: document.querySelector('[data-easymde-editor-owner="react"]')
            ?.getAttribute('data-easymde-session-status') ?? null,
          type: 'preparation'
        });
      }
    });
    const root = document.querySelector('[data-easymde-editor-owner="react"]');
    const preview = document.querySelector('[data-easymde-preview-html-sink="1"]');
    if (root) {
      preparationObserver.observe(root, {
        attributeFilter: ['data-easymde-session-status'],
        attributes: true
      });
    }
    if (preview) {
      preparationObserver.observe(preview, {
        attributeFilter: [
          'aria-busy',
          'data-easymde-preview-accepted',
          'data-easymde-preview-error',
          'data-easymde-preview-refreshing'
        ],
        attributes: true
      });
    }
    state.preparationObserver = preparationObserver;
    const canvas = document.querySelector('.easymde-immersive-preview-canvas');
    const canvasObserver = canvas
      ? new MutationObserver(() => {
          appendWindowEvent({ state: windowGeometryState(), type: 'canvas-child-list' });
        })
      : null;
    canvasObserver?.observe(canvas, { childList: true, subtree: true });
    const scrollTopPrototype = [Element.prototype, HTMLElement.prototype]
      .find((prototype) => Object.prototype.hasOwnProperty.call(prototype, 'scrollTop'));
    const scrollTopDescriptor = scrollTopPrototype
      ? Object.getOwnPropertyDescriptor(scrollTopPrototype, 'scrollTop')
      : null;
    let scrollTopSetterInstalled = false;
    if (canvas && scrollTopPrototype && scrollTopDescriptor?.set && scrollTopDescriptor.configurable) {
      Object.defineProperty(scrollTopPrototype, 'scrollTop', {
        configurable: scrollTopDescriptor.configurable,
        enumerable: scrollTopDescriptor.enumerable,
        get: scrollTopDescriptor.get,
        set(value) {
          if (this === canvas) {
            appendWindowEvent({
              caller: 'canvas-scrollTop-setter',
              type: 'scrollTop-setter',
              value
            });
          }
          scrollTopDescriptor.set.call(this, value);
        }
      });
      scrollTopSetterInstalled = true;
    }
    state.canvasObserver = canvasObserver;
    state.scrollTopPrototype = scrollTopPrototype;
    state.scrollTopDescriptor = scrollTopDescriptor;
    state.scrollTopSetterInstalled = scrollTopSetterInstalled;
    visualSurface?.addEventListener('contextmenu', onContextMenuBubble);
    document.addEventListener('selectionchange', onSelectionChange, true);
    globalThis.addEventListener('scroll', onScroll, true);
    globalThis.addEventListener('resize', onResize, true);
    globalThis.addEventListener('keydown', onScrollKey, true);
    globalThis.addEventListener('pointerdown', onPointerDown, true);
    globalThis.addEventListener('mousedown', onMouseDown, true);
    globalThis.addEventListener('contextmenu', onContextMenu, true);
    globalThis.addEventListener('touchmove', onTouchMove, true);
    globalThis.addEventListener('wheel', onWheel, true);
    observer.observe(document.body, { childList: true, subtree: true });
    state.stop = () => {
      observer.disconnect();
      preparationObserver.disconnect();
      canvasObserver?.disconnect();
      if (scrollTopSetterInstalled && scrollTopPrototype && scrollTopDescriptor) {
        Object.defineProperty(scrollTopPrototype, 'scrollTop', scrollTopDescriptor);
      }
      visualSurface?.removeEventListener('contextmenu', onContextMenuBubble);
      document.removeEventListener('selectionchange', onSelectionChange, true);
      HTMLTextAreaElement.prototype.setSelectionRange = originalSetSelectionRange;
      for (const { descriptor, name } of selectionMethods) {
        Object.defineProperty(selectionPrototype, name, descriptor);
      }
      if (focusDescriptor) Object.defineProperty(focusPrototype, 'focus', focusDescriptor);
      globalThis.removeEventListener('keydown', onScrollKey, true);
      globalThis.removeEventListener('pointerdown', onPointerDown, true);
      globalThis.removeEventListener('mousedown', onMouseDown, true);
      globalThis.removeEventListener('contextmenu', onContextMenu, true);
      globalThis.removeEventListener('scroll', onScroll, true);
      globalThis.removeEventListener('resize', onResize, true);
      globalThis.removeEventListener('touchmove', onTouchMove, true);
      globalThis.removeEventListener('wheel', onWheel, true);
    };
    globalThis[key] = state;
  }, {
    categoryId,
    eventLimit: contextMenuDiagnosticEventLimit,
    key: contextMenuDiagnosticKey,
    targetMetadata
  });
}

async function readContextMenuDiagnostics(
  page,
  categoryId,
  phase,
  failedStep,
  steps,
  { expectedSource = null } = {}
) {
  return page.evaluate(({
    categoryId: currentCategoryId,
    currentPhase,
    expectedSource: currentExpectedSource,
    failedStep: currentStep,
    key,
    stepStates
  }) => {
    const viewport = document.querySelector('[data-easymde-context-menu-viewport="true"]');
    const active = document.activeElement;
    const activeClassName = active instanceof Element && 'string' === typeof active.className
      ? active.className.slice(0, 160)
      : '';
    const state = globalThis[key];
    const alerts = Array.from(document.querySelectorAll(
      '.easymde-editor-message-alert-host [role="alert"]'
    ));
    const alertTypes = alerts.flatMap((alert) =>
      Array.from(alert.classList).filter((className) => ['is-error', 'is-warning'].includes(className))
    );
    const alertErrorCodes = alerts
      .map((alert) => alert.getAttribute('data-error-code')
        ?? alert.getAttribute('data-easymde-error-code'))
      .filter((code) => Boolean(code));
    const scrollState = (element) => element
      ? {
          left: element.scrollLeft,
          top: element.scrollTop
        }
      : null;
    const rectState = (element) => element
      ? (() => {
          const rect = element.getBoundingClientRect();
          return {
            bottom: Math.round(rect.bottom * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100
          };
        })()
      : null;
    const currentSourceElement = document.querySelector('.easymde-source-react .cm-content');
    const sourceValueElement = document.querySelector('#easymde-source');
    const currentWorkspaceElement = document.querySelector('.easymde-workspace');
    const editorRoot = document.querySelector('[data-easymde-editor-owner="react"]');
    const previewSurface = document.querySelector('[data-easymde-preview-html-sink="1"]');
    const previewError = previewSurface?.getAttribute('data-easymde-preview-error');
    const errorStableCode = alertErrorCodes[0] ?? previewError ?? null;
    const sourceExact = null === currentExpectedSource
      ? null
      : Boolean(
        sourceValueElement
        && 'value' in sourceValueElement
        && sourceValueElement.value === currentExpectedSource
      );
    return {
      activeElement: {
        className: activeClassName,
        tag: active?.tagName ?? active?.constructor?.name ?? 'UNKNOWN'
      },
      afterContextMenu: {
        ariaEditable: previewSurface?.getAttribute('contenteditable') ?? null,
        className: document.querySelector('[data-easymde-context-menu="true"]')
          ?.className?.slice?.(0, 160) ?? '',
        errorStableCode,
        owner: editorRoot?.getAttribute('data-easymde-editor-owner') ?? null
      },
      categoryId: currentCategoryId,
      currentLayers: viewport
        ? viewport.querySelectorAll('[data-easymde-context-menu-layer][role="menu"]').length
        : 0,
      failedStep: currentStep,
      phase: currentPhase,
      editorAlerts: {
        count: alerts.length,
        errorCodes: alertErrorCodes,
        types: alertTypes
      },
      elapsedMs: state?.startedAt ? Math.round(performance.now() - state.startedAt) : null,
      interactionSteps: Array.isArray(state?.interactionSteps)
        ? state.interactionSteps.slice()
        : [],
      menuAttachCount: state?.menuAttachCount ?? 0,
      menuDetachCount: state?.menuDetachCount ?? 0,
      menuCount: document.querySelectorAll('[data-easymde-context-menu="true"]').length,
      menuItems: Array.from(document.querySelectorAll(
        '[data-easymde-context-menu="true"] [role="menuitem"]'
      )).map((item) => ({
        disabled: item.getAttribute('aria-disabled'),
        id: item.getAttribute('data-easymde-context-menu-item'),
        label: item.textContent?.trim().slice(0, 80) ?? ''
      })),
      nativeEvents: Array.isArray(state?.nativeEvents)
        ? state.nativeEvents.slice()
        : [],
      preparation: {
        editorOwner: editorRoot?.getAttribute('data-easymde-editor-owner') ?? null,
        previewAccepted: previewSurface?.getAttribute('data-easymde-preview-accepted') ?? null,
        previewBusy: previewSurface?.getAttribute('aria-busy') ?? null,
        previewError,
        previewRefreshing: previewSurface?.getAttribute('data-easymde-preview-refreshing') ?? null,
        previewSessionReady: document.querySelectorAll(
          '[data-easymde-react-preview-session="ready"]'
        ).length,
        sessionStatus: editorRoot?.getAttribute('data-easymde-session-status') ?? null,
        visualBlockCount: document.querySelectorAll('[data-easymde-visual-block-id]').length,
        windowSpacerCount: document.querySelectorAll('[data-easymde-preview-window-spacer]').length
      },
      rootAttachCount: state?.rootAttachCount ?? 0,
      rootDetachCount: state?.rootDetachCount ?? 0,
      rootElement: {
        connected: Boolean(state?.rootElement?.isConnected),
        count: document.querySelectorAll('[data-easymde-editor-owner="react"]').length,
        bounds: rectState(editorRoot)
      },
      selection: (() => {
        const selection = globalThis.getSelection?.();
        return {
          collapsed: selection?.isCollapsed ?? null,
          length: selection ? selection.toString().length : null
        };
      })(),
      source: {
        bounds: rectState(currentSourceElement),
        connected: Boolean(state?.sourceElement?.isConnected),
        count: document.querySelectorAll('.easymde-source-react .cm-content').length
      },
      sourceExact,
      sourceElement: {
        connected: Boolean(state?.sourceElement?.isConnected),
        rect: rectState(currentSourceElement),
        sameNode: Boolean(state?.sourceElement && state.sourceElement === currentSourceElement)
      },
      selectionApiEvents: Array.isArray(state?.selectionApiEvents)
        ? state.selectionApiEvents.slice()
        : [],
      target: state?.targetMetadata ?? null,
      scrollOffsets: {
        canvas: scrollState(document.querySelector('.easymde-immersive-preview-canvas')),
        cmScroller: scrollState(document.querySelector('.cm-scroller')),
        document: {
          left: document.documentElement.scrollLeft,
          top: document.documentElement.scrollTop
        },
        preview: scrollState(document.querySelector('.easymde-pane-preview')),
        window: {
          left: globalThis.scrollX,
          top: globalThis.scrollY
        },
        workspace: scrollState(document.querySelector('.easymde-workspace'))
      },
      scrollEvents: Array.isArray(state?.events) ? state.events.slice() : [],
      steps: stepStates,
      viewport: {
        documentClientHeight: document.documentElement.clientHeight,
        documentClientWidth: document.documentElement.clientWidth,
        innerHeight: globalThis.innerHeight,
        innerWidth: globalThis.innerWidth
      },
      viewportCount: document.querySelectorAll('[data-easymde-context-menu-viewport="true"]').length,
      workspaceElement: {
        connected: Boolean(state?.workspaceElement?.isConnected),
        rect: rectState(currentWorkspaceElement),
        sameNode: Boolean(state?.workspaceElement && state.workspaceElement === currentWorkspaceElement)
      },
      windowEvents: Array.isArray(state?.windowEvents)
        ? state.windowEvents.slice()
        : []
    };
  }, {
    categoryId,
    currentPhase: phase,
    expectedSource,
    failedStep,
    key: contextMenuDiagnosticKey,
    stepStates: steps
  });
}

async function stopContextMenuDiagnostics(page) {
  await page.evaluate((key) => {
    const state = globalThis[key];
    state?.stop?.();
    delete globalThis[key];
  }, contextMenuDiagnosticKey);
}

async function recordVisualInteractionDiagnostic(page, phase, target, point = null) {
  const targetMetadata = await readVisualTargetMetadata(target);
  const selection = await page.evaluate(() => {
    const current = globalThis.getSelection?.();
    const canvas = document.querySelector('.easymde-immersive-preview-canvas');
    return {
      collapsed: current?.isCollapsed ?? null,
      length: current ? current.toString().length : null,
      scrollTop: canvas?.scrollTop ?? null
    };
  });
  const pointHit = point
    ? await page.evaluate(({ x, y }) => {
      const boundsOf = (element) => {
        if (!(element instanceof Element)) return null;
        const rect = element.getBoundingClientRect();
        return {
          bottom: Math.round(rect.bottom * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100
        };
      };
      const describe = (element) => element instanceof Element
        ? {
            bounds: boundsOf(element),
            className: 'string' === typeof element.className
              ? element.className.slice(0, 160)
              : '',
            connected: element.isConnected,
            tag: element.tagName
          }
        : null;
      const hit = document.elementFromPoint(x, y);
      return {
        element: describe(hit),
        list: describe(hit?.closest?.('ul,ol')),
        listItem: describe(hit?.closest?.('li'))
      };
    }, point)
    : null;
  await page.evaluate(({
    key,
    currentPhase,
    currentPoint,
    currentPointHit,
    currentSelection,
    currentTarget
  }) => {
    const state = globalThis[key];
    if (!state) return;
    state.targetMetadata = currentTarget;
    state.interactionSteps.push({
      phase: currentPhase,
      point: currentPoint,
      pointHit: currentPointHit,
      selection: currentSelection,
      target: currentTarget
    });
  }, {
    currentPhase: phase,
    currentPoint: point,
    currentPointHit: pointHit,
    currentSelection: selection,
    currentTarget: targetMetadata,
    key: contextMenuDiagnosticKey
  });
}

async function openSourceMenuWithDiagnostics(
  page,
  source,
  categoryId,
  expectedSource = null
) {
  try {
    await openSourceMenu(page, source);
  } catch (error) {
    const diagnostic = await readContextMenuDiagnostics(
      page,
      categoryId,
      'open',
      null,
      [],
      { expectedSource }
    );
    await stopContextMenuDiagnostics(page);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  }
}

async function closeMenu(
  page,
  categoryId = 'unlabelled',
  { expectedSource = null, keepDiagnostics = false } = {}
) {
  const layers = page.locator(
    `${menuViewportSelector} [data-easymde-context-menu-layer][role="menu"]`
  );
  const steps = [];
  let failedStep = null;
  try {
    await expect(layers).not.toHaveCount(0);
    const initialLayerLimit = await layers.count();
    for (let step = 0; step < initialLayerLimit; step += 1) {
      failedStep = step;
      const before = await layers.count();
      if (0 === before) break;
      const state = { beforeLayers: before, step };
      steps.push(state);
      await expect(page.locator(menuSelector)).toHaveCount(1);
      await expect(page.locator(menuSelector)).toBeVisible();
      await expect.poll(
        () => page.evaluate((viewportSelector) => {
          const viewport = document.querySelector(viewportSelector);
          return Boolean(viewport && viewport.contains(document.activeElement));
        }, menuViewportSelector)
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => layers.count()).toBeLessThan(before);
      state.currentLayers = await layers.count();
    }
    await expect(page.locator(menuSelector)).toHaveCount(0);
  } catch (error) {
    const diagnostic = await readContextMenuDiagnostics(
      page,
      categoryId,
      'close',
      failedStep,
      steps,
      { expectedSource }
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  } finally {
    if (!keepDiagnostics) await stopContextMenuDiagnostics(page);
  }
}

async function readRootSubmenuGeometry(page, itemId) {
  return page.evaluate((currentItemId) => {
    const round = (value) => Number.isFinite(value)
      ? Number(value.toFixed(2))
      : null;
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        bottom: round(rect.bottom),
        height: round(rect.height),
        left: round(rect.left),
        right: round(rect.right),
        top: round(rect.top),
        width: round(rect.width),
        x: round(rect.x),
        y: round(rect.y)
      };
    };
    const describe = (element) => {
      if (!element) return null;
      return {
        className: 'string' === typeof element.className
          ? element.className.slice(0, 160)
          : '',
        clipPath: getComputedStyle(element).clipPath,
        rect: rectOf(element),
        tag: element.tagName
      };
    };
    const root = document.querySelector('[data-easymde-context-menu="true"]');
    const item = root
      ? Array.from(root.querySelectorAll('[data-easymde-context-menu-item]'))
        .find((candidate) => candidate.getAttribute('data-easymde-context-menu-item') === currentItemId)
      : null;
    const itemRect = rectOf(item);
    const point = itemRect && itemRect.width > 0 && itemRect.height > 0
      ? { x: itemRect.left + itemRect.width / 2, y: itemRect.top + itemRect.height / 2 }
      : null;
    const hit = point ? document.elementFromPoint(point.x, point.y) : null;
    return {
      elementFromPoint: hit
        ? {
            className: 'string' === typeof hit.className ? hit.className.slice(0, 160) : '',
            tag: hit.tagName
          }
        : null,
      elementFromPointIsItemOrDescendant: Boolean(
        hit && item && (hit === item || item.contains(hit))
      ),
      itemId: currentItemId,
      itemPoint: point,
      item: describe(item),
      root: describe(root),
      viewport: describe(document.querySelector('[data-easymde-context-menu-viewport="true"]')),
      workspace: describe(document.querySelector('.easymde-workspace'))
    };
  }, itemId);
}

async function openRootSubmenu(page, id) {
  const trigger = rootItem(page, id);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  const before = await readRootSubmenuGeometry(page, id);
  try {
    await trigger.click({ timeout: 10_000 });
  } catch (error) {
    let after = null;
    let afterGeometryCode = null;
    if (page.isClosed()) {
      afterGeometryCode = 'editor-context-menu-geometry-after-page-closed';
    } else {
      try {
        after = await readRootSubmenuGeometry(page, id);
      } catch {
        afterGeometryCode = 'editor-context-menu-geometry-after-read-failed';
      }
    }
    const diagnostic = { after, afterGeometryCode, before, itemId: id };
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-geometry] ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  }
}

async function expandOpenTableMenuViewport(page) {
  let beforeGeometry = null;
  let afterGeometry = null;
  try {
    const initialViewport = page.viewportSize();
    if (!initialViewport) throw new Error('table-menu-initial-viewport-unavailable');
    if (720 !== initialViewport.height) {
      throw new Error(`table-menu-initial-viewport-height-unexpected:${initialViewport.height}`);
    }
    await expect(page.locator(menuSelector)).toHaveCount(1);
    const tableItem = rootItem(page, 'table');
    await expect(tableItem).toHaveCount(1);
    await expect(tableItem).toBeVisible();
    beforeGeometry = await readRootSubmenuGeometry(page, 'table');
    if (!beforeGeometry.root?.rect) throw new Error('table-menu-root-geometry-missing-before-resize');

    await page.setViewportSize({ height: 900, width: initialViewport.width });
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(900);
    await expect(page.locator(menuSelector)).toHaveCount(1);
    afterGeometry = await readRootSubmenuGeometry(page, 'table');
    if (!afterGeometry.root?.rect || !afterGeometry.itemPoint) {
      throw new Error('table-menu-geometry-missing-after-resize');
    }
    expect(afterGeometry.root.rect.left).toBe(beforeGeometry.root.rect.left);
    expect(afterGeometry.root.rect.top).toBe(beforeGeometry.root.rect.top);
    expect(afterGeometry.itemPoint.x).toBeGreaterThanOrEqual(0);
    expect(afterGeometry.itemPoint.x).toBeLessThan(initialViewport.width);
    expect(afterGeometry.itemPoint.y).toBeGreaterThanOrEqual(0);
    expect(afterGeometry.itemPoint.y).toBeLessThan(900);
    expect(afterGeometry.elementFromPointIsItemOrDescendant).toBe(true);
  } catch (error) {
    let diagnostic = null;
    let diagnosticCode = null;
    if (page.isClosed()) {
      diagnosticCode = 'table-menu-resize-diagnostic-page-closed';
    } else {
      try {
        diagnostic = await readContextMenuDiagnostics(
          page,
          'table-alignment-window-expand',
          'resize',
          null,
          []
        );
      } catch {
        diagnosticCode = 'table-menu-resize-diagnostic-read-failed';
      }
    }
    if (!page.isClosed() && !afterGeometry) {
      try {
        afterGeometry = await readRootSubmenuGeometry(page, 'table');
      } catch {
        diagnosticCode ??= 'table-menu-resize-after-geometry-read-failed';
      }
    }
    const resizeDiagnostic = {
      afterGeometry,
      beforeGeometry,
      diagnostic,
      diagnosticCode
    };
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-resize-diagnostic] ${JSON.stringify(resizeDiagnostic)}`,
      { cause: error }
    );
  }
}

async function openVisibleSubmenu(page, id) {
  const trigger = anyMenuItem(page, id).last();
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click();
}

async function expectMenuItemState(page, id, state) {
  const item = anyMenuItem(page, id).last();
  await expect(item).toBeVisible();
  if ('enabled' === state) await expect(item).toBeEnabled();
  else if ('disabled' === state) await expect(item).toBeDisabled();
}

async function getImmersiveStrings(page) {
  return page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
}

async function enterImmersive(page) {
  const strings = await getImmersiveStrings(page);
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await expect(page.locator('.easymde-editor.is-immersive')).toBeVisible();
  return strings;
}

async function enterFullVisual(page) {
  const strings = await enterImmersive(page);
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible();
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();
  const visualEditor = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
  return { strings, visualEditor };
}

async function selectVisualText(visualEditor, value, occurrence = 0) {
  await visualEditor.evaluate((surface, selectionTarget) => {
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let seen = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      let from = 0;
      while (from <= node.data.length) {
        const match = node.data.indexOf(selectionTarget.value, from);
        if (match < 0) break;
        if (seen === selectionTarget.occurrence) {
          const range = surface.ownerDocument.createRange();
          range.setStart(node, match);
          range.setEnd(node, match + selectionTarget.value.length);
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (!selection) throw new Error('visual-selection-unavailable');
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        seen += 1;
        from = match + Math.max(1, selectionTarget.value.length);
      }
    }
    throw new Error('visual-text-missing');
  }, { occurrence, value });
}

async function selectVisualElement(element) {
  await element.evaluate((target) => {
    const range = target instanceof HTMLImageElement
      ? (() => {
          const next = target.ownerDocument.createRange();
          next.selectNode(target);
          return next;
        })()
      : (() => {
          const next = target.ownerDocument.createRange();
          next.selectNodeContents(target);
          return next;
        })();
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function placeVisualCaret(element) {
  await element.evaluate((target) => {
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function prepareVisualTarget(visualEditor, element) {
  await element.scrollIntoViewIfNeeded();
  await expect(element).toBeVisible();
  await expect.poll(
    () => element.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < (target.ownerDocument.defaultView?.innerHeight ?? 0);
    })
  ).toBe(true);
  await visualEditor.focus();
  await expect.poll(
    () => visualEditor.evaluate((surface) => surface.ownerDocument.activeElement === surface)
  ).toBe(true);
}

async function visibleVisualSelectionPoint(visualEditor, expectedText) {
  return visualEditor.evaluate((surface, text) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.toString() !== text) {
      throw new Error('visual-text-selection-not-preserved');
    }
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((candidate) =>
      candidate.width > 0
      && candidate.height > 0
      && candidate.bottom > 0
      && candidate.top < (surface.ownerDocument.defaultView?.innerHeight ?? 0)
    );
    if (!rect) throw new Error('visual-text-selection-rect-unavailable');
    return {
      bounds: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, expectedText);
}

async function visibleVisualRangePoint(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
      throw new Error('visual-range-selection-not-preserved');
    }
    const rect = Array.from(selection.getRangeAt(0).getClientRects()).find((candidate) =>
      candidate.width > 0
      && candidate.height > 0
      && candidate.bottom > 0
      && candidate.top < (surface.ownerDocument.defaultView?.innerHeight ?? 0)
    );
    if (!rect) throw new Error('visual-range-selection-rect-unavailable');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function selectVisualCrossBlockRange(visualEditor, startText, endText) {
  await visualEditor.evaluate((surface, target) => {
    const textNodes = [];
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const find = (value, from = 0) => {
      for (let index = from; index < textNodes.length; index += 1) {
        const node = textNodes[index];
        const offset = node.data.indexOf(value);
        if (offset >= 0) return { index, node, offset };
      }
      return null;
    };
    const start = find(target.start);
    const end = find(target.end, (start?.index ?? 0) + 1);
    if (!start || !end) throw new Error('visual-cross-block-selection-text-missing');
    const range = surface.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + target.end.length);
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  }, { end: endText, start: startText });
}

async function readVisualActionState(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const inside = (node) => Boolean(node && surface.contains(node));
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement ?? null;
    return {
      activeElementIsSurface: surface.ownerDocument.activeElement === surface,
      anchorConnected: Boolean(selection?.anchorNode?.isConnected),
      anchorInsideSurface: inside(selection?.anchorNode),
      selectionInsideCodeBlock: Boolean(
        selectionElement?.closest('pre')
        && surface.contains(selectionElement.closest('pre'))
      ),
      contentEditable: surface.getAttribute('contenteditable'),
      errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
      focusConnected: Boolean(selection?.focusNode?.isConnected),
      focusInsideSurface: inside(selection?.focusNode),
      nativeRangeCount: selection?.rangeCount ?? 0,
      selectedTextLength: selection ? selection.toString().length : 0,
      selectionCollapsed: Boolean(selection?.isCollapsed),
      surfaceConnected: surface.isConnected,
      rangeCollapsed: Boolean(range?.collapsed)
    };
  });
}

function assertVisualActionState(state, phase) {
  if (!state.activeElementIsSurface
    || state.contentEditable !== 'true'
    || state.errorCode !== null
    || !state.surfaceConnected
    || !state.anchorConnected
    || !state.focusConnected
    || !state.anchorInsideSurface
    || !state.focusInsideSurface
    || state.nativeRangeCount !== 1) {
    throw new Error(`editor-context-menu-visual-action-selection-failed:${phase}`);
  }
}

async function readVisualPreviewAcceptanceState(visualEditor) {
  if (0 === await visualEditor.count()) {
    return {
      accepted: null,
      ariaBusy: null,
      domHash: null,
      domLength: null,
      error: null,
      phase: null,
      refreshing: null
    };
  }
  return visualEditor.evaluate((surface) => {
    let hash = 2166136261;
    const html = surface.innerHTML;
    for (let index = 0; index < html.length; index += 1) {
      hash ^= html.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return {
      accepted: surface.getAttribute('data-easymde-preview-accepted'),
      ariaBusy: surface.getAttribute('aria-busy'),
      domHash: (hash >>> 0).toString(16),
      domLength: html.length,
      error: surface.getAttribute('data-easymde-preview-error'),
      phase: surface.getAttribute('data-easymde-preview-phase'),
      refreshing: surface.getAttribute('data-easymde-preview-refreshing')
    };
  });
}

async function readSourcePreviewAcceptanceState(preview) {
  return preview.evaluate((surface) => {
    let hash = 2166136261;
    const html = surface.innerHTML;
    for (let index = 0; index < html.length; index += 1) {
      hash ^= html.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return {
      accepted: surface.getAttribute('data-easymde-preview-accepted'),
      ariaBusy: surface.getAttribute('aria-busy'),
      domHash: (hash >>> 0).toString(16),
      error: surface.getAttribute('data-easymde-preview-error'),
      refreshing: surface.getAttribute('data-easymde-preview-refreshing')
    };
  });
}

async function waitForSourcePreviewAccepted(preview, phase, previousDomHash = null) {
  await expect.poll(
    () => readSourcePreviewAcceptanceState(preview),
    { message: `Source Preview should be formally accepted: ${phase}` }
  ).toMatchObject({ accepted: '1', ariaBusy: 'false', error: null, refreshing: null });
  if (previousDomHash !== null) {
    await expect.poll(
      () => readSourcePreviewAcceptanceState(preview).then((state) => state.domHash),
      { message: `Source Preview DOM should advance: ${phase}` }
    ).not.toBe(previousDomHash);
  }
  return readSourcePreviewAcceptanceState(preview);
}

async function readSettingsFullShortcutState(page, visualEditor, source, phase) {
  const visual = await visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const describe = (node) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const top = element?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote');
      return {
        bAncestor: Boolean(element?.closest('b')),
        connected: Boolean(node?.isConnected),
        insideStrong: Boolean(element?.closest('strong')),
        protected: Boolean(element?.closest('.easymde-toc,.footnotes-sep,.footnotes,.easymde-math[data-easymde-rendered],.easymde-mermaid')),
        tag: top?.tagName ?? element?.tagName ?? null
      };
    };
    return {
      anchor: describe(selection?.anchorNode),
      focus: describe(selection?.focusNode),
      selectedTextLength: selection?.toString().length ?? 0,
      surfaceConnected: surface.isConnected
    };
  });
  const sourceState = await source.evaluate((field) => {
    let hash = 2166136261;
    const value = 'value' in field && 'string' === typeof field.value ? field.value : '';
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return { hash: (hash >>> 0).toString(16), length: value.length };
  });
  return {
    phase,
    source: sourceState,
    toolbarErrorPresent: await page.locator('#easymde-editor [role="alert"]').count() > 0,
    visual
  };
}

async function waitForVisualPreviewAccepted(
  visualEditor,
  phase,
  previousDomHash = null,
  diagnosticsPage = null
) {
  try {
    await expect.poll(
      () => readVisualPreviewAcceptanceState(visualEditor),
      { message: `Visual Preview should be formally accepted before history: ${phase}` }
    ).toMatchObject({ accepted: '1', ariaBusy: 'false', error: null, refreshing: null });
  } catch (error) {
    const state = await readVisualPreviewAcceptanceState(visualEditor);
    const visualFailure = diagnosticsPage
      ? await diagnosticsPage.locator('[data-easymde-visual-failure]').getAttribute('data-easymde-visual-failure')
      : null;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
      `[preview-acceptance-state] ${JSON.stringify({ phase, state, visualFailure })}`,
      { cause: error }
    );
  }
  if (previousDomHash !== null) {
    await expect.poll(
      () => readVisualPreviewAcceptanceState(visualEditor).then((state) => state.domHash),
      { message: `Visual Preview DOM should advance before history: ${phase}` }
    ).not.toBe(previousDomHash);
  }
  return readVisualPreviewAcceptanceState(visualEditor);
}

function replaceVisualSourceOccurrence(markdown, value, replacement, occurrence = 0) {
  const start = occurrenceOffset(markdown, value, occurrence);
  return `${markdown.slice(0, start)}${replacement}${markdown.slice(start + value.length)}`;
}

async function openVisualActionMenu(page, visualEditor, target, selectText, occurrence = 0) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualText(visualEditor, selectText, occurrence);
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'before-menu');
  const point = await visibleVisualSelectionPoint(visualEditor, selectText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

async function selectVisualTextAcrossNodes(surface, expectedText, occurrence = 0) {
  await surface.evaluate((target, selectionTarget) => {
    const nodes = [];
    const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      nodes.push({ end: text.length + node.data.length, node, start: text.length });
      text += node.data;
    }
    let from = 0;
    let matchStart = -1;
    for (let index = 0; index <= selectionTarget.occurrence; index += 1) {
      matchStart = text.indexOf(selectionTarget.value, from);
      if (matchStart < 0) throw new Error('visual-text-missing');
      from = matchStart + Math.max(1, selectionTarget.value.length);
    }
    const matchEnd = matchStart + selectionTarget.value.length;
    const startNode = nodes.find(({ end, start }) => matchStart >= start && matchStart < end);
    const endNode = nodes.find(({ end, start }) => matchEnd > start && matchEnd <= end);
    if (!startNode || !endNode) throw new Error('visual-text-range-node-missing');
    const range = target.ownerDocument.createRange();
    range.setStart(startNode.node, matchStart - startNode.start);
    range.setEnd(endNode.node, matchEnd - endNode.start);
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-selection-unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  }, { occurrence, value: expectedText });
}

async function openVisualCodeActionMenu(page, visualEditor, target, selectText) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualTextAcrossNodes(target, selectText);
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'before-code-menu');
  const point = await visibleVisualSelectionPoint(visualEditor, selectText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

function visualHistoryDigest(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function startVisualHistoryDiagnostics(page) {
  const previewRequests = [];
  const previewResponses = [];
  const consoleCodes = new Set();
  const readRevisionSignature = (request) => {
    const body = request.postData() ?? '';
    let payload = null;
    if (body.trim().startsWith('{')) {
      try {
        const value = JSON.parse(body);
        if (value && 'object' === typeof value && !Array.isArray(value)) payload = value;
      } catch {
        payload = null;
      }
    }
    if (!payload) {
      const parameters = new URLSearchParams(body);
      payload = {
        revision: parameters.get('revision'),
        signature: parameters.get('signature')
      };
    }
    const rawRevision = payload?.revision;
    const revision = Number(rawRevision);
    return {
      revision: rawRevision !== null
        && undefined !== rawRevision
        && '' !== rawRevision
        && Number.isSafeInteger(revision)
        ? revision
        : null,
      signature: 'string' === typeof payload?.signature
        ? { hash: visualHistoryDigest(payload.signature), length: payload.signature.length }
        : null
    };
  };
  const onRequest = (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.endsWith('/wp-json/easymde/v1/preview')) return;
    previewRequests.push({
      at: Math.round(performance.now() * 100) / 100,
      ...readRevisionSignature(request)
    });
  };
  const onResponse = (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.endsWith('/wp-json/easymde/v1/preview')) return;
    previewResponses.push({
      at: Math.round(performance.now() * 100) / 100,
      status: response.status()
    });
  };
  const onConsole = (message) => {
    if ('error' !== message.type()) return;
    const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
    if (match) consoleCodes.add(match[1]);
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('console', onConsole);
  await page.evaluate((key) => {
    const previous = globalThis[key];
    previous?.stop?.();
    const keyEvents = [];
    const timeline = [];
    const digest = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    };
    const previewState = () => {
      const preview = document.querySelector(
        '[data-easymde-preview-html-sink="1"][contenteditable="true"]'
      ) ?? document.querySelector('[data-easymde-preview-html-sink="1"]');
      if (!(preview instanceof Element)) return null;
      return {
        accepted: preview.getAttribute('data-easymde-preview-accepted'),
        ariaBusy: preview.getAttribute('aria-busy'),
        error: preview.getAttribute('data-easymde-preview-error'),
        refreshing: preview.getAttribute('data-easymde-preview-refreshing')
      };
    };
    const recordTimeline = () => {
      const state = previewState();
      if (!state) return;
      const previousState = timeline[timeline.length - 1]?.state;
      if (JSON.stringify(previousState) === JSON.stringify(state)) return;
      timeline.push({
        at: Math.round(performance.now() * 100) / 100,
        state
      });
    };
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey || ['Control', 'Meta', 'Shift', 'z', 'Z'].includes(event.key))) return;
      const target = event.target instanceof Element ? event.target : null;
      keyEvents.push({
        at: Math.round(performance.now() * 100) / 100,
        ctrl: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        key: event.key,
        meta: event.metaKey,
        shift: event.shiftKey,
        targetClass: target && 'string' === typeof target.className
          ? target.className.slice(0, 120)
          : '',
        targetTag: target?.tagName ?? ''
      });
    };
    const observer = new MutationObserver(recordTimeline);
    document.addEventListener('keydown', onKeyDown, true);
    observer.observe(document.documentElement, {
      attributeFilter: [
        'aria-busy',
        'data-easymde-preview-accepted',
        'data-easymde-preview-error',
        'data-easymde-preview-refreshing'
      ],
      attributes: true,
      subtree: true
    });
    recordTimeline();
    globalThis[key] = {
      snapshot() {
        const source = document.querySelector('#easymde-source');
        const visual = document.querySelector('[data-easymde-preview-html-sink="1"][contenteditable="true"]');
        const selection = visual?.ownerDocument.defaultView?.getSelection() ?? null;
        const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
        const selectionNode = (node) => {
          const element = node instanceof Element ? node : node?.parentElement;
          const block = element?.closest('[data-easymde-visual-block-id]');
          return {
            blockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
            connected: Boolean(node?.isConnected),
            tag: element?.tagName ?? null
          };
        };
        const sourceValue = source instanceof HTMLTextAreaElement ? source.value : '';
        return {
          source: {
            hash: digest(sourceValue),
            length: sourceValue.length,
            selectionEnd: source instanceof HTMLTextAreaElement ? source.selectionEnd : null,
            selectionStart: source instanceof HTMLTextAreaElement ? source.selectionStart : null
          },
          visual: visual instanceof Element ? {
            active: visual.ownerDocument.activeElement === visual,
            ariaBusy: visual.getAttribute('aria-busy'),
            ariaReadonly: visual.getAttribute('aria-readonly'),
            contentEditable: visual.getAttribute('contenteditable'),
            error: visual.getAttribute('data-easymde-preview-error'),
            focusNodeConnected: Boolean(selection?.focusNode?.isConnected),
            focusNode: selectionNode(selection?.focusNode),
            focusOffset: selection?.focusOffset ?? null,
            anchorNode: selectionNode(selection?.anchorNode),
            anchorOffset: selection?.anchorOffset ?? null,
            rangeCollapsed: Boolean(range?.collapsed),
            rangeCount: selection?.rangeCount ?? 0,
            selectedTextLength: selection?.toString().length ?? 0,
            selectionDirection: 'string' === typeof selection?.direction ? selection.direction : null
          } : null,
          preview: previewState(),
          keyEvents: [...keyEvents],
          timeline: [...timeline]
        };
      },
      stop() {
        observer.disconnect();
        document.removeEventListener('keydown', onKeyDown, true);
        delete globalThis[key];
      }
    };
  }, visualHistoryDiagnosticKey);
  return {
    async snapshot() {
      return page.evaluate((key) => globalThis[key]?.snapshot?.() ?? null, visualHistoryDiagnosticKey).then((dom) => ({
        dom,
        consoleCodes: [...consoleCodes].sort(),
        previewRequests: [...previewRequests],
        previewResponses: [...previewResponses]
      }));
    },
    async stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('console', onConsole);
      await page.evaluate((key) => globalThis[key]?.stop?.(), visualHistoryDiagnosticKey);
    }
  };
}

async function runVisualMutationAction(
  page,
  visualEditor,
  source,
  markdown,
  {
    action,
    expected,
    label,
    occurrence = 0,
    pasteText = null,
    submenu,
    target,
    selectText,
    verifyHistory = true,
    resetFixture = true
  }
) {
  await assertSourceExactValue(source, markdown, `${label}-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if (pasteText !== null) {
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, pasteText);
  }
  await openVisualActionMenu(page, visualEditor, target, selectText, occurrence);
  if (submenu) await openRootSubmenu(page, submenu);
  if (submenu === 'copy-paste-as') await expectMenuItemState(page, action, 'enabled');
  if (!submenu) await expectMenuItemState(page, action, 'enabled');
  if (submenu) await anyMenuItem(page, action).click();
  else await rootItem(page, action).click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${label}-applied`);
  await expect.poll(
    () => readVisualActionState(visualEditor).then((state) => state.activeElementIsSurface)
  ).toBe(true);
  assertVisualActionState(await readVisualActionState(visualEditor), `${label}-applied`);
  if (!verifyHistory) {
    await waitForVisualPreviewAccepted(visualEditor, `${label}-applied`, previewBefore.domHash);
    if (!resetFixture) return;
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${label}-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${label}-fixture-reset`);
    return;
  }

  const historyStages = [];
  const historyProbe = await startVisualHistoryDiagnostics(page);
  try {
    historyStages.push({ phase: 'after-action', ...(await historyProbe.snapshot()) });
    let actionPreview;
    try {
      actionPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-applied`,
        previewBefore.domHash
      );
    } catch (error) {
      const diagnostic = await historyProbe.snapshot();
      throw new Error(
        `editor-context-menu-visual-history-preview-failed:${label}:` +
        `${JSON.stringify({ diagnostic, historyStages })}`,
        { cause: error }
      );
    }
    historyStages.push({ phase: 'before-undo', ...(await historyProbe.snapshot()) });
    await visualEditor.press('ControlOrMeta+z');
    try {
      await waitForSourceExactValue(source, markdown, `${label}-undo`);
      const undoPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-undo`,
        actionPreview.domHash
      );
      historyStages.push({ phase: 'after-undo', ...(await historyProbe.snapshot()) });
      assertVisualActionState(await readVisualActionState(visualEditor), `${label}-undo`);
      await visualEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, expected, `${label}-redo`);
      const redoPreview = await waitForVisualPreviewAccepted(
        visualEditor,
        `${label}-redo`,
        undoPreview.domHash
      );
      historyStages.push({ phase: 'after-redo', ...(await historyProbe.snapshot()) });
      assertVisualActionState(await readVisualActionState(visualEditor), `${label}-redo`);
      await visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, `${label}-reset`);
      await waitForVisualPreviewAccepted(visualEditor, `${label}-reset`, redoPreview.domHash);
    } catch (error) {
      const diagnostic = await historyProbe.snapshot();
      throw new Error(
        `editor-context-menu-visual-history-undo-failed:${label}:` +
        `${JSON.stringify({ diagnostic, historyStages })}`,
        { cause: error }
      );
    }
  } finally {
    await historyProbe?.stop();
  }
}

async function readSourceSelectionRange(page) {
  return page.locator('#easymde-source').evaluate((field) => ({
    end: field.selectionEnd,
    start: field.selectionStart
  }));
}

async function openVisualCrossHeadingMenu(page, visualEditor, target) {
  await prepareVisualTarget(visualEditor, target);
  await selectVisualCrossBlockRange(
    visualEditor,
    '一级标题 Heading 1',
    '二级标题 Heading 2'
  );
  const before = await readVisualActionState(visualEditor);
  assertVisualActionState(before, 'cross-heading-before-menu');
  const point = await visibleVisualRangePoint(visualEditor);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
  return before;
}

async function runVisualCrossHeadingBold(page, visualEditor, source, markdown, suffix, verifyHistory = true) {
  await assertSourceExactValue(source, markdown, `${suffix}-cross-heading-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  await openVisualCrossHeadingMenu(
    page,
    visualEditor,
    visualEditor.locator('h1').first()
  );
  await expectMenuItemState(page, 'bold', 'enabled');
  const sourceSelection = await readSourceSelectionRange(page);
  if (!Number.isInteger(sourceSelection.start)
    || !Number.isInteger(sourceSelection.end)
    || sourceSelection.start < 0
    || sourceSelection.end <= sourceSelection.start
    || sourceSelection.end > markdown.length) {
    throw new Error(`${suffix}-cross-heading-source-selection-invalid`);
  }
  const boldCommand = await page.evaluate(() => {
    const command = window.EasyMDEEditorRootBootstrap.toolbar.commands.find(
      ({ id }) => id === 'bold'
    );
    if (!command || 'string' !== typeof command.prefix || 'string' !== typeof command.suffix) {
      throw new Error('visual-bold-toolbar-command-invalid');
    }
    return { prefix: command.prefix, suffix: command.suffix };
  });
  const expected = markdown.slice(0, sourceSelection.start)
    + boldCommand.prefix
    + markdown.slice(sourceSelection.start, sourceSelection.end)
    + boldCommand.suffix
    + markdown.slice(sourceSelection.end);
  await rootItem(page, 'bold').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${suffix}-cross-heading-bold-applied`);
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-applied`
  );
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-applied`,
    previewBefore.domHash,
    page
  );
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-cross-heading-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-bold-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-undo`,
    actionPreview.domHash,
    page
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-undo`
  );
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-cross-heading-bold-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-redo`,
    undoPreview.domHash,
    page
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-cross-heading-bold-redo`
  );
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-cross-heading-bold-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-cross-heading-bold-reset`,
    redoPreview.domHash,
    page
  );
}

async function runVisualImageScaleAction(
  page,
  visualEditor,
  source,
  markdown,
  occurrence,
  suffix,
  verifyHistory = true
) {
  const imageMarkdown = markdown.match(/!\[占位测试图片\]\([^\r\n]+\)/u)?.[0];
  if (!imageMarkdown) throw new Error(`${suffix}-visual-image-source-missing`);
  const expected = imageScaleSource(markdown, imageMarkdown, 50, occurrence);
  const image = visualEditor.getByAltText(imageSourceAlt, { exact: true }).nth(occurrence);
  await assertSourceExactValue(source, markdown, `${suffix}-visual-image-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, image, occurrence);
  }
  await openVisualMenu(page, visualEditor, image, true, null);
  await openRootSubmenu(page, 'image-scale');
  await expectMenuItemState(page, 'image-scale-50', 'enabled');
  await anyMenuItem(page, 'image-scale-50').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${suffix}-visual-image-applied`);
  await expect(
    visualEditor.getByAltText(imageSourceAlt, { exact: true }).nth(occurrence)
  ).toHaveAttribute('data-easymde-image-scale', '50');
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-applied`,
    previewBefore.domHash
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-visual-image-applied`
  );
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-visual-image-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-undo`,
    actionPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-visual-image-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-redo`,
    undoPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-image-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-image-reset`,
    redoPreview.domHash
  );
}

async function runVisualTableAlignmentAction(
  page,
  visualEditor,
  source,
  markdown,
  occurrence,
  suffix,
  verifyHistory = true
) {
  const tableSource = [
    '| 左对齐    |  居中 |    右对齐 |',
    '| :----- | :-: | -----: |',
    '| Apple  | 100 | $99.99 |',
    '| Banana | 200 | $12.50 |',
    '| Orange | 300 |  $8.88 |'
  ].join('\n');
  const tableStart = occurrenceOffset(markdown, tableSource, occurrence);
  const tableEnd = tableStart + tableSource.length;
  const target = visualEditor.locator('table').filter({ hasText: 'Apple' }).nth(occurrence);
  await assertSourceExactValue(source, markdown, `${suffix}-visual-table-before`);
  const previewBefore = await readVisualPreviewAcceptanceState(visualEditor);
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, target, occurrence);
  }
  await openVisualMenu(page, visualEditor, target, true, null);
  await openRootSubmenu(page, 'table');
  await openVisibleSubmenu(page, 'table-alignment');
  await expectMenuItemState(page, 'align-center', 'enabled');
  await anyMenuItem(page, 'align-center').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await expect.poll(
    () => source.evaluate((field, expected) => (
      'value' in field && field.value !== expected
    ), markdown),
    { message: `${suffix} Visual table alignment should change canonical Source` }
  ).toBe(true);
  const expected = await source.inputValue();
  if (!expected.startsWith(markdown.slice(0, tableStart))
    || !expected.endsWith(markdown.slice(tableEnd))
    || expected === markdown) {
    throw new Error(`${suffix}-visual-table-source-diff-invalid`);
  }
  const actionPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-applied`,
    previewBefore.domHash
  );
  assertVisualActionState(
    await readVisualActionState(visualEditor),
    `${suffix}-visual-table-applied`
  );
  if (!verifyHistory) {
    await source.evaluate((field, value) => {
      if (!('value' in field)) throw new Error('source-bridge-unavailable');
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, markdown);
    await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-fixture-reset`);
    await waitForVisualPreviewAccepted(visualEditor, `${suffix}-visual-table-fixture-reset`);
    return;
  }

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-undo`);
  const undoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-undo`,
    actionPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, expected, `${suffix}-visual-table-redo`);
  const redoPreview = await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-redo`,
    undoPreview.domHash
  );
  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${suffix}-visual-table-reset`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${suffix}-visual-table-reset`,
    redoPreview.domHash
  );
}

async function ensureWindowedVisualTargetMounted(page, target, occurrence) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  const startStep = occurrence > 0 ? 9 : 0;
  for (let step = startStep; step <= 20; step += 1) {
    if (await target.count() > 0) return;
    await canvas.evaluate((element, progress) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = maximum * progress;
      element.dispatchEvent(new Event('scroll'));
    }, Math.min(1, step / 20));
    await page.waitForTimeout(180);
  }
  await expect(target).toHaveCount(1);
}

async function repeatAfterFormalPreview(page, strings, source, markdown, occurrence = 0) {
  await page.getByRole('button', { name: strings.previewLockReadOnly, exact: true }).click();
  const visualEditor = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(visualEditor).toHaveCount(0);
  const unlock = page.getByRole('button', { name: strings.previewUnlockEdit, exact: true });
  await expect(unlock).toBeEnabled();
  await unlock.click();
  const reentered = page.getByRole('textbox', { name: strings.previewEditorLabel });
  await expect(reentered).toHaveAttribute('contenteditable', 'true');
  const expected = replaceVisualSourceOccurrence(markdown, '普通文本', '**普通文本**', occurrence);
  const target = reentered.locator('p').filter({ hasText: '普通文本' }).nth(occurrence);
  await runVisualMutationAction(page, reentered, source, markdown, {
    action: 'bold',
    expected,
    label: 'formal-preview-repeat-bold',
    occurrence,
    target,
    selectText: '普通文本'
  });
  return reentered;
}

async function runVisualActionMatrix(page, visualEditor, source, markdown, occurrence = 0, suffix = 'full') {
  const targetFor = (selector, text) => {
    const matches = visualEditor.locator(selector).filter({ hasText: text });
    return occurrence > 0 ? matches : matches.first();
  };
  const categories = [
    {
      id: 'text',
      target: targetFor('p', '普通文本'),
      value: '普通文本'
    },
    {
      id: 'list',
      target: targetFor('li', '前端开发'),
      value: '前端开发'
    },
    {
      id: 'link',
      target: targetFor('a', 'OpenAI 官网'),
      value: 'OpenAI 官网'
    }
  ];
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, visualEditor.locator('h1').first(), 0);
  }
  for (const category of categories) {
    const actions = 'windowed' === suffix
      ? ['bold']
      : ['bold', 'cut', 'paste-plain-text'];
    for (const action of actions) {
      const replacement = `E2E ${category.id} paste`;
      const expected = 'bold' === action
        ? replaceVisualSourceOccurrence(markdown, category.value, `**${category.value}**`, occurrence)
        : 'cut' === action
          ? replaceVisualSourceOccurrence(markdown, category.value, '', occurrence)
          : replaceVisualSourceOccurrence(markdown, category.value, replacement, occurrence);
      await ensureWindowedVisualTargetMounted(page, category.target, occurrence);
      await runVisualMutationAction(page, visualEditor, source, markdown, {
        action,
        expected,
        label: `${suffix}-${category.id}-${action}`,
        occurrence,
        pasteText: 'paste-plain-text' === action ? replacement : null,
        submenu: 'paste-plain-text' === action ? 'copy-paste-as' : null,
        target: category.target,
        selectText: category.value,
        verifyHistory: true,
        resetFixture: true
      });
    }
  }
  if ('windowed' === suffix) {
    await ensureWindowedVisualTargetMounted(page, visualEditor.locator('h1').first(), 0);
  }
  await runVisualCrossHeadingBold(page, visualEditor, source, markdown, suffix, true);
  await runVisualImageScaleAction(page, visualEditor, source, markdown, occurrence, suffix, true);
  await runVisualTableAlignmentAction(page, visualEditor, source, markdown, occurrence, suffix, true);
}

async function visualElementCenterPoint(element) {
  return element.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    return {
      bounds: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
}

async function readVisualTargetMetadata(target) {
  let count;
  try {
    count = await target.count();
  } catch {
    return {
      bounds: null,
      className: '',
      connected: false,
      count: null,
      tag: 'UNKNOWN'
    };
  }
  if (0 === count) {
    return {
      bounds: null,
      className: '',
      connected: false,
      count,
      tag: 'MISSING'
    };
  }
  try {
    return {
      count,
      ...(await target.first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          bounds: {
            bottom: Math.round(rect.bottom * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100
          },
          className: 'string' === typeof element.className
            ? element.className.slice(0, 160)
            : '',
          connected: element.isConnected,
          blockId: element.getAttribute('data-easymde-visual-block-id'),
          tag: element.tagName,
          text: (element.textContent ?? '').slice(0, 120)
        };
      }))
    };
  } catch {
    return {
      bounds: null,
      className: '',
      connected: false,
      count,
      tag: 'UNKNOWN'
    };
  }
}

async function openVisualMenu(
  page,
  visualEditor,
  element,
  select = true,
  selectedText = null
) {
  await prepareVisualTarget(visualEditor, element);
  await recordVisualInteractionDiagnostic(page, 'after-prepare', element);
  if ('function' === typeof select) await select();
  else if (select) await selectVisualElement(element);
  await recordVisualInteractionDiagnostic(page, 'after-select', element);
  if (selectedText) {
    const point = await visibleVisualSelectionPoint(visualEditor, selectedText);
    await recordVisualInteractionDiagnostic(page, 'before-right-click', element, point);
    await page.mouse.click(point.x, point.y, { button: 'right' });
  } else {
    const point = await visualElementCenterPoint(element);
    await recordVisualInteractionDiagnostic(page, 'before-right-click', element, point);
    await page.mouse.click(point.x, point.y, { button: 'right' });
  }
  await recordVisualInteractionDiagnostic(page, 'after-right-click', element);
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
}

async function runVisualThematicBreakDelete(
  page,
  { expected, label, markdown, select, source, target, visualEditor }
) {
  const before = await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-before`
  );
  await startContextMenuDiagnostics(page, label);
  try {
    await openVisualMenu(
      page,
      visualEditor,
      target,
      select ?? (() => target.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNode(element);
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('visual-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      }))
    );
  } catch (error) {
    const diagnostic = await readContextMenuDiagnostics(
      page,
      label,
      'open',
      null,
      [],
      { expectedSource: markdown }
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n[editor-context-menu-diagnostic] ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  } finally {
    await stopContextMenuDiagnostics(page);
  }
  await expectMenuItemState(page, 'delete-thematic-break', 'enabled');
  await rootItem(page, 'delete-thematic-break').click();
  await expect(page.locator(menuSelector)).toHaveCount(0);
  await waitForSourceExactValue(source, expected, `${label}-delete`);
  const after = await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-delete`,
    before.domHash
  );

  await visualEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${label}-undo`);
  await waitForVisualPreviewAccepted(
    visualEditor,
    `${label}-undo`,
    after.domHash
  );
}

async function assertVisualCategory(page, visualEditor, category) {
  const categoryId = category.id;
  if (!categoryId) throw new Error('visual-category-id-missing');
  const targetMetadata = await readVisualTargetMetadata(category.target);
  await startContextMenuDiagnostics(page, categoryId, targetMetadata);
  let failedStep = null;
  let phase = 'source-before';
  try {
    if (category.source && category.markdown) {
      await assertSourceFixtureExact(
        category.source,
        category.markdown,
        categoryId,
        'before'
      );
    }
    const select = category.selectText
      ? () => selectVisualText(visualEditor, category.selectText, category.occurrence ?? 0)
      : category.collapsed
        ? () => placeVisualCaret(category.target)
        : () => selectVisualElement(category.target);
    phase = 'open';
    if (await visualEditor.locator('[data-easymde-preview-window-spacer]').count() > 0) {
      await ensureWindowedVisualTargetMounted(page, category.target, category.occurrence ?? 0);
    }
    await openVisualMenu(
      page,
      visualEditor,
      category.target,
      select,
      category.selectText ?? null
    );
    phase = 'root-items';
    for (const [id, state] of Object.entries(category.items ?? {})) {
      failedStep = id;
      await expectMenuItemState(page, id, state);
    }
    if (category.submenu) {
      failedStep = category.submenu;
      phase = 'submenu';
      await openRootSubmenu(page, category.submenu);
      for (const [id, state] of Object.entries(category.children ?? {})) {
        failedStep = id;
        await expectMenuItemState(page, id, state);
      }
      if (category.nestedSubmenu) {
        failedStep = category.nestedSubmenu;
        phase = 'nested-submenu';
        await openVisibleSubmenu(page, category.nestedSubmenu);
        for (const [id, state] of Object.entries(category.nestedChildren ?? {})) {
          failedStep = id;
          await expectMenuItemState(page, id, state);
        }
        for (const id of category.nestedAbsent ?? []) {
          failedStep = id;
          await expect(anyMenuItem(page, id)).toHaveCount(0);
        }
      }
    }
    phase = 'close';
    await closeMenu(page, categoryId, {
      expectedSource: category.markdown ?? null,
      keepDiagnostics: true
    });
    phase = 'source-after';
    if (category.source && category.markdown) {
      await assertSourceFixtureExact(
        category.source,
        category.markdown,
        categoryId,
        'after'
      );
    }
  } catch (error) {
    let diagnostic = null;
    let diagnosticCode = null;
    if (page.isClosed()) {
      diagnosticCode = 'visual-context-menu-diagnostic-page-closed';
    } else {
      try {
        diagnostic = await readContextMenuDiagnostics(
          page,
          categoryId,
          phase,
          failedStep,
          [],
          { expectedSource: category.markdown ?? null }
        );
      } catch {
        diagnosticCode = 'visual-context-menu-diagnostic-read-failed';
      }
    }
    throw new Error(
      `editor-context-menu-visual-category-failed:${categoryId}\n` +
      `failureCode:${privacySafeFailureCode(error)}\n` +
      `[editor-context-menu-visual-diagnostic] ${JSON.stringify({ diagnostic, diagnosticCode })}`
    );
  } finally {
    if (!page.isClosed()) await stopContextMenuDiagnostics(page);
  }
}

function visualCategoryMatrix(visualEditor, occurrence = 'first') {
  const target = (selector, text = null) => () => {
    const base = visualEditor.locator(selector);
    const filtered = text ? base.filter({ hasText: text }) : base;
    return 'last' === occurrence ? filtered.last() : filtered.first();
  };
  return [
    {
      collapsed: true,
      id: 'body',
      items: { bold: 'disabled', copy: 'disabled', insert: 'enabled' },
      targetFactory: target('p', '普通文本')
    },
    {
      id: 'text',
      items: { bold: 'enabled', copy: 'enabled' },
      selectText: '普通文本',
      targetFactory: target('p', '普通文本')
    },
    {
      id: 'heading',
      items: { bold: 'enabled', copy: 'enabled' },
      selectText: '一级标题 Heading 1',
      targetFactory: target('h1')
    },
    {
      id: 'link',
      items: { 'copy-link-address': 'enabled', 'open-link': 'enabled' },
      targetFactory: target('a', 'OpenAI 官网')
    },
    {
      id: 'image',
      children: {
        'image-scale-25': 'enabled',
        'image-scale-33': 'enabled',
        'image-scale-50': 'enabled',
        'image-scale-67': 'enabled',
        'image-scale-100': 'enabled',
        'image-scale-150': 'enabled',
        'image-scale-200': 'enabled'
      },
      items: { 'delete-image': 'enabled' },
      submenu: 'image-scale',
      targetFactory: target('img')
    },
    {
      id: 'table',
      children: { 'copy-table': 'enabled', 'delete-table': 'enabled' },
      items: { table: 'enabled' },
      submenu: 'table',
      targetFactory: target('table')
    },
    {
      id: 'list',
      items: { insert: 'enabled' },
      selectText: '前端开发',
      targetFactory: target('ul')
    },
    {
      id: 'code',
      children: { 'copy-code-block': 'enabled', 'delete-code-block': 'enabled' },
      items: { 'code-block': 'enabled' },
      submenu: 'code-block',
      targetFactory: target('pre')
    },
    {
      id: 'math',
      items: { 'generated-content': 'enabled' },
      targetFactory: target('.easymde-math')
    },
    {
      id: 'mermaid',
      items: { 'generated-content': 'enabled' },
      targetFactory: target('.easymde-mermaid')
    }
  ];
}

async function assertVisualCategoryMatrix(
  page,
  visualEditor,
  occurrence = 'first',
  source = null,
  markdown = null
) {
  for (const category of visualCategoryMatrix(visualEditor, occurrence)) {
    const { targetFactory, ...rest } = category;
    await assertVisualCategory(page, visualEditor, {
      ...rest,
      markdown,
      source,
      target: targetFactory()
    });
  }
}

async function assertSourceCategoryMatrix(
  page,
  { fixtureImageUrl, markdown, source, sourceEditor }
) {
  const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
  const categories = [
    {
      collapsed: true,
      id: 'body',
      items: { bold: 'disabled', copy: 'disabled', cut: 'disabled', insert: 'enabled' },
      rootCount: 6,
      value: '普通文本'
    },
    {
      id: 'text',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '普通文本'
    },
    {
      id: 'heading',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '一级标题 Heading 1'
    },
    {
      id: 'link',
      items: { 'copy-link-address': 'enabled', 'open-link': 'enabled' },
      selectText: '[OpenAI 官网](https://openai.com)'
    },
    {
      children: {
        'image-scale-25': 'enabled',
        'image-scale-33': 'enabled',
        'image-scale-50': 'enabled',
        'image-scale-67': 'enabled',
        'image-scale-100': 'enabled',
        'image-scale-150': 'enabled',
        'image-scale-200': 'enabled'
      },
      id: 'image',
      items: {
        'copy-image': 'enabled',
        'delete-image': 'enabled',
        'image-scale': 'enabled'
      },
      selectText: imageMarkdown,
      submenu: 'image-scale'
    },
    {
      children: { 'copy-table': 'enabled', 'delete-table': 'enabled' },
      id: 'table',
      items: { table: 'enabled' },
      selectText: 'Apple',
      submenu: 'table'
    },
    {
      id: 'list',
      items: { bold: 'enabled', copy: 'enabled', insert: 'enabled' },
      selectText: '前端开发'
    },
    {
      children: { 'copy-code-block': 'enabled', 'delete-code-block': 'enabled' },
      id: 'code',
      items: { 'code-block': 'enabled' },
      selectText: 'echo "Hello, Markdown!"',
      submenu: 'code-block'
    },
    {
      children: {
        'copy-generated': 'enabled',
        'delete-generated-content': 'enabled',
        'edit-generated-content': 'enabled',
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled',
        'save-generated-image': 'enabled'
      },
      id: 'math',
      items: { 'generated-content': 'enabled' },
      nestedChildren: {
        'copy-generated-image': 'enabled',
        'copy-generated-mathml': 'enabled',
        'copy-generated-source': 'enabled'
      },
      nestedSubmenu: 'copy-generated',
      selectText: '\\int_a^b f(x)\\,dx = F(b) - F(a)',
      submenu: 'generated-content'
    },
    {
      children: {
        'copy-generated': 'enabled',
        'delete-generated-content': 'enabled',
        'edit-generated-content': 'enabled',
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled',
        'save-generated-image': 'enabled'
      },
      id: 'mermaid',
      items: { 'generated-content': 'enabled' },
      nestedAbsent: ['copy-generated-mathml'],
      nestedChildren: {
        'copy-generated-image': 'enabled',
        'copy-generated-source': 'enabled'
      },
      nestedSubmenu: 'copy-generated',
      selectText: 'flowchart TD',
      submenu: 'generated-content'
    }
  ];

  for (const category of categories) {
    await assertSourceFixtureExact(source, markdown, category.id, 'before');
    if (category.collapsed) {
      await placeSourceCaret(page, sourceEditor, markdown, category.value);
    } else if (category.selectText) {
      await selectSourceText(page, sourceEditor, markdown, category.selectText);
    } else {
      throw new Error(`source-category-selection-missing:${category.id}`);
    }
    await startContextMenuDiagnostics(page, category.id);
    await openSourceMenuWithDiagnostics(page, sourceEditor, category.id, markdown);
    if (category.rootCount) {
      await expect(rootMenu(page).locator('[data-easymde-context-menu-item]'))
        .toHaveCount(category.rootCount);
    }
    for (const [id, state] of Object.entries(category.items ?? {})) {
      await expectMenuItemState(page, id, state);
    }
    if (category.submenu) {
      await openRootSubmenu(page, category.submenu);
      for (const [id, state] of Object.entries(category.children ?? {})) {
        await expectMenuItemState(page, id, state);
      }
      if (category.nestedSubmenu) {
        await openVisibleSubmenu(page, category.nestedSubmenu);
        for (const [id, state] of Object.entries(category.nestedChildren ?? {})) {
          await expectMenuItemState(page, id, state);
        }
        for (const id of category.nestedAbsent ?? []) {
          await expect(anyMenuItem(page, id)).toHaveCount(0);
        }
      }
    }
    await assertSourceFixtureExact(source, markdown, category.id, 'before-close');
    await closeMenu(page, category.id, { expectedSource: markdown });
    await assertSourceFixtureExact(source, markdown, category.id, 'after');
  }
}

async function applySourceTableAlignment(
  page,
  { markdown, source, sourceEditor },
  selectionText,
  alignment,
  expected,
  { expandViewport = false } = {}
) {
  await selectSourceText(page, sourceEditor, markdown, selectionText);
  if (expandViewport) {
    await startContextMenuDiagnostics(page, 'table-alignment-window-expand');
  }
  try {
    if (expandViewport) await openSourceMenuWithDiagnostics(
      page,
      sourceEditor,
      'table-alignment-window-expand'
    );
    else await openSourceMenu(page, sourceEditor);
    if (expandViewport) await expandOpenTableMenuViewport(page);
    await openRootSubmenu(page, 'table');
    await openVisibleSubmenu(page, 'table-alignment');
    await expectMenuItemState(page, `align-${alignment}`, 'enabled');
    await anyMenuItem(page, `align-${alignment}`).last().click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(expected);
  } finally {
    if (expandViewport && !page.isClosed()) await stopContextMenuDiagnostics(page);
  }
}

test.describe('Editor context menu production surfaces', () => {
  test('keeps ordinary Source source-exact through inventory, copy/cancel, Bold Undo, table, and image actions', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    await assertSourceCategoryMatrix(page, {
      fixtureImageUrl,
      markdown,
      source,
      sourceEditor
    });

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await expectMenuItemState(page, 'bold', 'enabled');
    await expectMenuItemState(page, 'copy', 'enabled');
    await expect(source).toHaveValue(markdown);
    await rootItem(page, 'copy').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(markdown);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('普通文本');

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await closeMenu(page);
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await rootItem(page, 'bold').click();
    const boldMarkdown = markdown.replace('普通文本', '**普通文本**');
    await expect(source).toHaveValue(boldMarkdown);
    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, 'Apple');
    await openSourceMenu(page, sourceEditor);
    await openRootSubmenu(page, 'table');
    await expectMenuItemState(page, 'copy-table', 'enabled');
    await expectMenuItemState(page, 'delete-table', 'enabled');
    await openVisibleSubmenu(page, 'table-alignment');
    await expectMenuItemState(page, 'align-center', 'enabled');
    await anyMenuItem(page, 'align-center').last().click();
    const centeredTable = markdown.replace(
      '| :----- | :-: | -----: |',
      '| :-----: | :-: | -----: |'
    );
    await expect(source).toHaveValue(centeredTable);

    await sourceEditor.fill(markdown);
    await expect(source).toHaveValue(markdown);
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
    await selectSourceText(page, sourceEditor, markdown, imageMarkdown);
    await openSourceMenu(page, sourceEditor);
    await openRootSubmenu(page, 'image-scale');
    for (const percentage of [25, 33, 50, 67, 100, 150, 200]) {
      await expectMenuItemState(page, `image-scale-${percentage}`, 'enabled');
    }
    await anyMenuItem(page, 'image-scale-50').click();
    const scaledImageMarkdown = markdown.replace(
      imageMarkdown,
      `![${imageSourceAlt}](${fixtureImageUrl} "{width=50%}")`
    );
    await expect(source).toHaveValue(scaledImageMarkdown);

    await sourceEditor.fill(markdown);
    await expect(source).toHaveValue(markdown);
    await selectSourceText(page, sourceEditor, markdown, '[OpenAI 官网](https://openai.com)');
    await openSourceMenu(page, sourceEditor);
    await expectMenuItemState(page, 'open-link', 'enabled');
    await expectMenuItemState(page, 'copy-link-address', 'enabled');
    await closeMenu(page);
    await expect(source).toHaveValue(markdown);
  });

  test('covers missing Source copy, cut, paste, link, and code actions in ordinary and immersive split modes', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    await exerciseMissingSourceActions(page, {
      markdown,
      mode: 'ordinary-source',
      source,
      sourceEditor
    });
    await assertSourceExactValue(source, markdown, 'ordinary-source-actions-complete');

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    await exerciseMissingSourceActions(page, {
      markdown,
      mode: 'immersive-split-source',
      source,
      sourceEditor: page.locator('.easymde-source-react .cm-content')
    });
    await assertSourceExactValue(source, markdown, 'immersive-split-source-actions-complete');
  });

  test('inserts a real WordPress media attachment from Source without saving the article', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const insertionOffset = occurrenceOffset(markdown, '普通文本');
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = startSourceMediaMutationProbe(page);
    try {
      const cancelPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      await cancelPicker.mediaModal.locator('.media-modal-close').click();
      await expect(cancelPicker.dialog).toBeHidden();
      await assertSourceExactValue(source, markdown, 'source-media-cancel');
      mutationProbe.assertNoArticleWrites('source-media-cancel');

      const insertPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      const selectionEvidence = await uploadAndSelectSourceImage(
        page,
        insertPicker.mediaFrame,
        insertPicker.mediaModal
      );
      await expect(insertPicker.dialog).toBeHidden();
      await waitForSourceMediaInsertion(
        source,
        markdown,
        insertionOffset,
        'source-media-select',
        consoleProbe.codes,
        () => readSourceMediaBridgeState(sourceEditor),
        {
          attachmentState: selectionEvidence.attachmentState,
          beforePicker: insertPicker.sourceState,
          uploadCount: mutationProbe.uploadCount()
        }
      );
      mutationProbe.assertUpload('source-media-select');
      mutationProbe.assertNoArticleWrites('source-media-select');
      if (consoleProbe.codes().length > 0) {
        throw new Error(
          `editor-context-menu-source-media-stable-error:${consoleProbe.codes().join(',')}`
        );
      }

      if (!selectionEvidence.attachmentState.connected
        || selectionEvidence.attachmentState.ariaChecked !== 'true') {
        throw new Error('editor-context-menu-source-media-attachment-selection-invalid');
      }

      await sourceEditor.press('ControlOrMeta+z');
      await expect.poll(
        () => source.evaluate((field, expected) => (
          'value' in field && field.value === expected
        ), markdown),
        { message: 'Source media insertion Undo should restore the canonical fixture' }
      ).toBe(true);
      await assertSourceExactValue(source, markdown, 'source-media-undo');
      mutationProbe.assertNoArticleWrites('source-media-undo');
    } finally {
      consoleProbe.stop();
      mutationProbe.stop();
    }
  });

  test('copies canonical Bash code content without fences in Source and Full Visual', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const codeBody = `${fencedBlockSource(markdown, 'bash')}\n`;
    const selectedText = 'echo "Hello, Markdown!"';
    const selectedStart = occurrenceOffset(markdown, selectedText);
    const selectedEnd = selectedStart + selectedText.length;
    const mutationProbe = startGeneratedExportMutationProbe(page);
    const copyCodeContentLabel = await page.evaluate(() => (
      window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.copyCodeContent ?? ''
    ));
    if (!copyCodeContentLabel) throw new Error('bootstrap-copy-code-content-label-missing');

    try {
      await assertSourceExactValue(source, markdown, 'source-copy-code-content-before');
      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await expectSourceSelection(page, selectedStart, selectedEnd);
      const sourceProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, sourceEditor, selectedText);
        await openRootSubmenu(page, 'code-block');
        const sourceAction = anyMenuItem(page, 'copy-code-content').last();
        await expect(sourceAction).toContainText(copyCodeContentLabel);
        await expect(sourceAction).toBeEnabled();
        await sourceAction.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          codeBody,
          'source-copy-code-content'
        );
        await assertSourceExactValue(source, markdown, 'source-copy-code-content-after');
        await expectSourceSelection(page, selectedStart, selectedEnd);
        const sourceEvents = await sourceProbe.snapshot();
        if (sourceEvents?.count !== 0) {
          throw new Error(`editor-context-menu-copy-code-content-source-transaction:${sourceEvents.count}`);
        }
      } finally {
        await sourceProbe.stop();
      }

      const full = await enterFullVisual(page);
      await waitForVisualPreviewAccepted(full.visualEditor, 'full-copy-code-content-before');
      const visualTarget = full.visualEditor.locator('pre').filter({ hasText: selectedText }).first();
      const previewBefore = await readVisualPreviewAcceptanceState(full.visualEditor);
      const visualProbe = await startSourceTransactionProbe(page);
      try {
        const visualBefore = await openVisualCodeActionMenu(
          page,
          full.visualEditor,
          visualTarget,
          selectedText
        );
        await openRootSubmenu(page, 'code-block');
        const visualAction = anyMenuItem(page, 'copy-code-content').last();
        await expect(visualAction).toContainText(copyCodeContentLabel);
        await expect(visualAction).toBeEnabled();
        await visualAction.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          codeBody,
          'full-copy-code-content'
        );
        await assertSourceExactValue(source, markdown, 'full-copy-code-content-after');
        const visualAfter = await readVisualActionState(full.visualEditor);
        assertVisualActionState(visualAfter, 'full-copy-code-content-after');
        if (visualAfter.selectedTextLength !== visualBefore.selectedTextLength
          || visualAfter.nativeRangeCount !== visualBefore.nativeRangeCount) {
          throw new Error(
            `editor-context-menu-copy-code-content-visual-selection-drift:${JSON.stringify({
              after: {
                anchorConnected: visualAfter.anchorConnected,
                focusConnected: visualAfter.focusConnected,
                nativeRangeCount: visualAfter.nativeRangeCount,
                rangeCollapsed: visualAfter.rangeCollapsed,
                selectedTextLength: visualAfter.selectedTextLength,
                selectionCollapsed: visualAfter.selectionCollapsed
              },
              before: {
                anchorConnected: visualBefore.anchorConnected,
                focusConnected: visualBefore.focusConnected,
                nativeRangeCount: visualBefore.nativeRangeCount,
                rangeCollapsed: visualBefore.rangeCollapsed,
                selectedTextLength: visualBefore.selectedTextLength,
                selectionCollapsed: visualBefore.selectionCollapsed
              }
            })}`
          );
        }
        const previewAfter = await readVisualPreviewAcceptanceState(full.visualEditor);
        if (previewAfter.domHash !== previewBefore.domHash
          || previewAfter.domLength !== previewBefore.domLength) {
          throw new Error('editor-context-menu-copy-code-content-preview-drift');
        }
        const visualEvents = await visualProbe.snapshot();
        if (visualEvents?.count !== 0) {
          throw new Error(`editor-context-menu-copy-code-content-visual-transaction:${visualEvents.count}`);
        }
      } finally {
        await visualProbe.stop();
      }
      mutationProbe.assertEmpty('copy-code-content');
    } finally {
      mutationProbe.stop();
    }
  });

  test('copies explicit and reference Link addresses from partial Source captions in ordinary and immersive split modes', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const explicitLink = '[OpenAI 官网](https://openai.com)';
    const referenceLink = '[GitHub][github-link]';
    const explicitStart = occurrenceOffset(markdown, explicitLink) + 1;
    const referenceStart = occurrenceOffset(markdown, referenceLink) + 1;
    const linkCases = [
      {
        id: 'explicit',
        selectionEnd: explicitStart + 'OpenAI'.length,
        selectionStart: explicitStart,
        selectedText: 'OpenAI',
        url: 'https://openai.com'
      },
      {
        id: 'reference',
        selectionEnd: referenceStart + 'Git'.length,
        selectionStart: referenceStart,
        selectedText: 'Git',
        url: 'https://github.com'
      }
    ];
    const mutationProbe = startGeneratedExportMutationProbe(page);
    const runSourceLinkCase = async (mode, editor, linkCase) => {
      await assertSourceExactValue(source, markdown, `${mode}-${linkCase.id}-before`);
      await selectSourceRange(
        page,
        editor,
        markdown,
        linkCase.selectionStart,
        linkCase.selectionEnd
      );
      const before = await readGeneratedExportSnapshot(page);
      const sourceProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, editor, linkCase.selectedText);
        await expectMenuItemState(page, 'open-link', 'enabled');
        await expectMenuItemState(page, 'copy-link-address', 'enabled');
        await rootItem(page, 'copy-link-address').click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        assertClipboardTextExact(
          await readNativeClipboardText(page),
          linkCase.url,
          `${mode}-${linkCase.id}-copy-link-address`
        );
        await assertSourceExactValue(source, markdown, `${mode}-${linkCase.id}-after`);
        await expectSourceSelection(
          page,
          linkCase.selectionStart,
          linkCase.selectionEnd
        );
        const after = await readGeneratedExportSnapshot(page);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          throw new Error(`editor-context-menu-source-link-dom-drift:${mode}-${linkCase.id}`);
        }
        const sourceEvents = await sourceProbe.snapshot();
        if (sourceEvents?.count !== 0) {
          throw new Error(
            `editor-context-menu-source-link-transaction:${mode}-${linkCase.id}:${sourceEvents.count}`
          );
        }
      } finally {
        await sourceProbe.stop();
      }
      mutationProbe.assertEmpty(`${mode}-${linkCase.id}`);
    };

    try {
      for (const linkCase of linkCases) {
        await runSourceLinkCase('ordinary-source', sourceEditor, linkCase);
      }

      const strings = await enterImmersive(page);
      await page.getByRole('button', { name: strings.split, exact: true }).last().click();
      await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
      const splitSourceEditor = page.locator('.easymde-source-react .cm-content');
      for (const linkCase of linkCases) {
        await runSourceLinkCase('immersive-split-source', splitSourceEditor, linkCase);
      }
    } finally {
      mutationProbe.stop();
    }
  });

  test('repairs TS code indentation in Source and Full Visual while preserving code bytes and Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const originalTsBody = fencedBlockSource(markdown, 'ts');
    const misformattedTsBody = originalTsBody.replace(/^[ \t]+/gmu, '');
    if (misformattedTsBody === originalTsBody) throw new Error('fixture-ts-indentation-missing');
    const misformattedMarkdown = markdown.replace(originalTsBody, misformattedTsBody);
    const codeStart = markdown.indexOf(originalTsBody);
    const codeEnd = codeStart + originalTsBody.length;
    const beforeCode = codeStart >= 0 ? markdown.slice(0, codeStart) : '';
    const afterCode = codeStart >= 0 ? markdown.slice(codeEnd) : '';
    if (codeStart < 0
      || `${beforeCode}${misformattedTsBody}${afterCode}` !== misformattedMarkdown) {
      throw new Error('fixture-ts-indentation-boundary-invalid');
    }
    const responseText = 'const response = await fetch(`/api/users/${id}`);';
    const responseLine = originalTsBody.split('\n').find((line) => line.includes(responseText));
    const misformattedResponseLine = misformattedTsBody
      .split('\n')
      .find((line) => line.includes(responseText));
    if (!responseLine || !misformattedResponseLine) {
      throw new Error('fixture-ts-response-line-missing');
    }
    const responseStart = misformattedMarkdown.indexOf(responseText);
    const endpointStart = misformattedMarkdown.indexOf('if (!response.ok)', responseStart);
    if (responseStart < 0 || endpointStart <= responseStart) {
      throw new Error('fixture-ts-selected-range-missing');
    }
    const selectedSourceText = misformattedMarkdown.slice(responseStart, endpointStart);
    const selectedExpected = misformattedMarkdown.replace(
      misformattedResponseLine,
      responseLine
    );
    const indentationLabels = await page.evaluate(() => ({
      block: window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.indentCodeBlock ?? '',
      selected: window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.indentSelectedCode ?? ''
    }));
    if (!indentationLabels.block || !indentationLabels.selected) {
      throw new Error('bootstrap-code-indentation-labels-missing');
    }
    const mutationProbe = startGeneratedExportMutationProbe(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const assertIndentItems = async (mode, { selected }) => {
      const blockItem = anyMenuItem(page, 'indent-code-block').last();
      const selectedItem = anyMenuItem(page, 'indent-selected-code').last();
      await expect(blockItem).toContainText(indentationLabels.block);
      await expect(selectedItem).toContainText(indentationLabels.selected);
      if (selected) {
        await expect(blockItem).toBeEnabled();
        await expect(selectedItem).toBeEnabled();
      } else {
        await expect(blockItem).toBeDisabled();
        await expect(selectedItem).toBeDisabled();
      }
      await expect(anyMenuItem(page, 'copy-code-block').last()).toBeEnabled();
      if (mode.includes('bash')) {
        await closeMenu(page, `${mode}-indent-items`);
      }
    };
    const openCodeMenu = async (editor, selectedText) => {
      await openSourceNativeMenu(page, editor, selectedText);
      await openRootSubmenu(page, 'code-block');
    };
    const assertSourceSelectionLength = async (before, phase) => {
      const after = await readSourceSelectionRange(page);
      if (after.end <= after.start || after.end - after.start !== before.end - before.start) {
        throw new Error(`editor-context-menu-code-indent-selection-drift:${phase}`);
      }
      return after;
    };

    try {
      await assertSourceExactValue(source, markdown, 'code-indent-bash-before');
      await selectSourceText(page, sourceEditor, markdown, 'echo "Hello, Markdown!"');
      await openCodeMenu(sourceEditor, 'echo "Hello, Markdown!"');
      await assertIndentItems('ordinary-bash', { selected: false });
      await assertSourceExactValue(source, markdown, 'code-indent-bash-after');

      try {
        await replaceSourceWithNativeInput(
          page,
          sourceEditor,
          source,
          misformattedMarkdown,
          'code-indent-source-misformatted'
        );
      } catch (error) {
        throw new Error(
          `editor-context-menu-code-indent-preparation-failed:${JSON.stringify({
            consoleCodes: consoleProbe.codes(),
            source: await readPrivacySafeSourceState(source, misformattedMarkdown)
          })}`,
          { cause: error }
        );
      }
      await selectSourceRange(
        page,
        sourceEditor,
        misformattedMarkdown,
        responseStart,
        endpointStart
      );
      const selectedBefore = await readSourceSelectionRange(page);
      await openCodeMenu(sourceEditor, selectedSourceText);
      await assertIndentItems('ordinary-ts-selected', { selected: true });
      const selectedProbe = await startSourceTransactionProbe(page);
      try {
        await anyMenuItem(page, 'indent-selected-code').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await waitForSourceExactValue(source, selectedExpected, 'code-indent-selected-applied');
        await assertSourceSelectionLength(selectedBefore, 'selected-applied');
      } finally {
        const selectedEvents = await selectedProbe.snapshot();
        if (selectedEvents?.count !== 1) {
          throw new Error(`editor-context-menu-code-indent-selected-transactions:${selectedEvents?.count ?? -1}`);
        }
        await selectedProbe.stop();
      }
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-selected-undo');

      await replaceSourceWithNativeInput(
        page,
        sourceEditor,
        source,
        misformattedMarkdown,
        'code-indent-source-whole-before'
      );
      await selectSourceText(page, sourceEditor, misformattedMarkdown, responseText);
      const wholeBefore = await readSourceSelectionRange(page);
      await openCodeMenu(sourceEditor, responseText);
      await assertIndentItems('ordinary-ts-whole', { selected: true });
      const wholeProbe = await startSourceTransactionProbe(page);
      try {
        await anyMenuItem(page, 'indent-code-block').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await waitForSourceExactValue(source, markdown, 'code-indent-whole-applied');
        await assertSourceSelectionLength(wholeBefore, 'whole-applied');
      } finally {
        const wholeEvents = await wholeProbe.snapshot();
        if (wholeEvents?.count !== 1) {
          throw new Error(`editor-context-menu-code-indent-whole-transactions:${wholeEvents?.count ?? -1}`);
        }
        await wholeProbe.stop();
      }
      await selectSourceText(page, sourceEditor, markdown, responseText);
      const repeatProbe = await startSourceTransactionProbe(page);
      try {
        await openCodeMenu(sourceEditor, responseText);
        await assertIndentItems('ordinary-ts-repeat', { selected: true });
        await anyMenuItem(page, 'indent-code-block').last().click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await assertSourceExactValue(source, markdown, 'code-indent-whole-repeat');
        const repeatEvents = await repeatProbe.snapshot();
        if (repeatEvents?.count !== 0) {
          throw new Error(`editor-context-menu-code-indent-repeat-transactions:${repeatEvents.count}`);
        }
      } finally {
        await repeatProbe.stop();
      }
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-whole-undo');

      await replaceSourceWithNativeInput(
        page,
        sourceEditor,
        source,
        misformattedMarkdown,
        'code-indent-full-before'
      );
      const full = await enterFullVisual(page);
      const previewBefore = await waitForVisualPreviewAccepted(full.visualEditor, 'code-indent-full-before');
      const visualTarget = full.visualEditor.locator('pre').filter({ hasText: responseText }).first();
      const visualBefore = await openVisualCodeActionMenu(
        page,
        full.visualEditor,
        visualTarget,
        responseText
      );
      await openRootSubmenu(page, 'code-block');
      await assertIndentItems('full-ts-whole', { selected: true });
      await anyMenuItem(page, 'indent-code-block').last().click();
      await expect(page.locator(menuSelector)).toHaveCount(0);
      await waitForSourceExactValue(source, markdown, 'code-indent-full-applied');
      assertVisualActionState(visualBefore, 'code-indent-full-before');
      const fullAfter = await readVisualActionState(full.visualEditor);
      assertVisualActionState(fullAfter, 'code-indent-full-applied');
      const actionPreview = await waitForVisualPreviewAccepted(
        full.visualEditor,
        'code-indent-full-applied',
        previewBefore.domHash,
        page
      );
      await full.visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, misformattedMarkdown, 'code-indent-full-undo');
      await waitForVisualPreviewAccepted(full.visualEditor, 'code-indent-full-undo', actionPreview.domHash, page);
      assertVisualActionState(await readVisualActionState(full.visualEditor), 'code-indent-full-undo');

      const stableCodes = consoleProbe.codes();
      const unexpectedCodes = stableCodes.filter(
        (code) => code !== 'visual-editor-selection-restore-fallback'
      );
      if (unexpectedCodes.length > 0) {
        throw new Error(`editor-context-menu-code-indent-stable-error:${unexpectedCodes.join(',')}`);
      }
      expect(fullAfter.selectionInsideCodeBlock).toBe(true);
      mutationProbe.assertEmpty('code-indent');
    } finally {
      consoleProbe.stop();
      mutationProbe.stop();
    }
  });

  test('applies Source table row, column, and whole-table alignment with last-action and one-Undo semantics', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const tableSource = [
      '| 左对齐    |  居中 |    右对齐 |',
      '| :----- | :-: | -----: |',
      '| Apple  | 100 | $99.99 |',
      '| Banana | 200 | $12.50 |',
      '| Orange | 300 |  $8.88 |'
    ].join('\n');
    const tableStart = markdown.indexOf(tableSource);
    if (tableStart < 0) throw new Error('fixture-alignment-table-missing');
    const tableEnd = tableStart + tableSource.length;
    const beforeTable = markdown.slice(0, tableStart);
    const afterTable = markdown.slice(tableEnd);
    const appleRow = '| Apple  | 100 | $99.99 |';
    const columnCell = '100';
    const marker = (alignment) =>
      `<!-- easymde-table-align:v1 ${JSON.stringify([[1, alignment]])} -->\n`;
    const withTable = (table, prefix = '') => `${beforeTable}${prefix}${table}${afterTable}`;
    const rowState = (alignment) => withTable(tableSource, marker(alignment));

    const rowLeft = rowState('left');
    await applySourceTableAlignment(
      page,
      { markdown, source, sourceEditor },
      appleRow,
      'left',
      rowLeft,
      { expandViewport: true }
    );
    const rowCenter = rowState('center');
    await applySourceTableAlignment(
      page,
      { markdown: rowLeft, source, sourceEditor },
      appleRow,
      'center',
      rowCenter
    );
    const rowRight = rowState('right');
    await applySourceTableAlignment(
      page,
      { markdown: rowCenter, source, sourceEditor },
      appleRow,
      'right',
      rowRight
    );

    const columnRightTable = tableSource.replace(
      '| :----- | :-: | -----: |',
      '| :----- | -: | -----: |'
    );
    const columnRight = withTable(columnRightTable, marker('right'));
    await applySourceTableAlignment(
      page,
      { markdown: rowRight, source, sourceEditor },
      columnCell,
      'right',
      columnRight
    );

    const wholeLeftTable = columnRightTable.replace(
      '| :----- | -: | -----: |',
      '| :----- | :- | :----- |'
    );
    const wholeLeft = withTable(wholeLeftTable);
    await applySourceTableAlignment(
      page,
      { markdown: columnRight, source, sourceEditor },
      columnRightTable,
      'left',
      wholeLeft
    );
    const wholeCenterTable = wholeLeftTable.replace(
      '| :----- | :- | :----- |',
      '| :-----: | :-: | :-----: |'
    );
    const wholeCenter = withTable(wholeCenterTable);
    await applySourceTableAlignment(
      page,
      { markdown: wholeLeft, source, sourceEditor },
      wholeLeftTable,
      'center',
      wholeCenter
    );

    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(wholeLeft);
    const finalValue = await source.inputValue();
    for (const row of [appleRow, '| Banana | 200 | $12.50 |', '| Orange | 300 |  $8.88 |']) {
      expect(finalValue).toContain(row);
    }
  });

  test('formats one selected Source table cell through the native menu without changing surrounding Markdown', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const tableSource = [
      '| 服务           | 地址                        |   状态  |  响应时间 |',
      '| ------------ | ------------------------- | :---: | ----: |',
      '| API Gateway  | `https://api.example.com` |  ✅ 正常 |  82ms |',
      '| Redis Cache  | `redis://127.0.0.1:6379`  |  ✅ 正常 |   4ms |',
      '| PostgreSQL   | `postgres://db:5432`      |  ✅ 正常 |  12ms |',
      '| Worker Queue | `amqp://rabbitmq:5672`    |   延迟  | 420ms |'
    ].join('\n');
    const formattedTable = [
      '| 服务           | 地址                        | 状态    | 响应时间  |',
      '| ------------ | ------------------------- | :---: | ----: |',
      '| API Gateway  | `https://api.example.com` | ✅ 正常  | 82ms  |',
      '| Redis Cache  | `redis://127.0.0.1:6379`  | ✅ 正常  | 4ms   |',
      '| PostgreSQL   | `postgres://db:5432`      | ✅ 正常  | 12ms  |',
      '| Worker Queue | `amqp://rabbitmq:5672`    | 延迟    | 420ms |'
    ].join('\n');
    const tableStart = markdown.indexOf(tableSource);
    if (tableStart < 0) throw new Error('fixture-format-table-source-missing');
    const tableEnd = tableStart + tableSource.length;
    const beforeTable = markdown.slice(0, tableStart);
    const afterTable = markdown.slice(tableEnd);
    const expectedDocument = `${beforeTable}${formattedTable}${afterTable}`;
    const selectedCell = '`https://api.example.com`';
    const formatLabel = await page.evaluate(() => (
      window.EasyMDEEditorRootBootstrap?.strings?.contextMenu?.formatTableSource ?? ''
    ));
    if (!formatLabel) throw new Error('bootstrap-format-table-source-label-missing');
    const stableCodes = [];
    const onConsole = (message) => {
      if ('error' !== message.type()) return;
      const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
      if (match && !stableCodes.includes(match[1])) stableCodes.push(match[1]);
    };
    page.on('console', onConsole);

    const assertFormattedTable = async (expected, phase) => {
      const actual = await source.inputValue();
      const expectedOutside = `${beforeTable}${afterTable}`;
      if (!actual.startsWith(beforeTable)
        || !actual.endsWith(afterTable)
        || actual.slice(0, beforeTable.length) !== beforeTable
        || actual.slice(actual.length - afterTable.length) !== afterTable) {
        throw new Error(`editor-context-menu-format-table-outside-bytes-drift:${phase}`);
      }
      const actualTable = actual.slice(beforeTable.length, actual.length - afterTable.length);
      if (actualTable !== expected) {
        throw new Error(`editor-context-menu-format-table-value-drift:${phase}`);
      }
      if (actual.slice(0, beforeTable.length) + actual.slice(actual.length - afterTable.length)
        !== expectedOutside) {
        throw new Error(`editor-context-menu-format-table-outside-oracle-drift:${phase}`);
      }
      for (const cellMarkdown of [
        '`https://api.example.com`',
        '`redis://127.0.0.1:6379`',
        '`postgres://db:5432`',
        '`amqp://rabbitmq:5672`'
      ]) {
        if (!actualTable.includes(cellMarkdown)) {
          throw new Error(`editor-context-menu-format-table-cell-markdown-drift:${phase}`);
        }
      }
      if (!actualTable.includes('`https://api.example.com`')) {
        throw new Error(`editor-context-menu-format-table-escaped-cell-drift:${phase}`);
      }
      if ((actualTable.match(/\n/gu) ?? []).length !== (tableSource.match(/\n/gu) ?? []).length) {
        throw new Error(`editor-context-menu-format-table-separator-drift:${phase}`);
      }
    };

    try {
      await assertSourceExactValue(source, markdown, 'source-format-table-before');
      await selectSourceText(page, sourceEditor, markdown, selectedCell);
      await expectSourceSelection(
        page,
        markdown.indexOf(selectedCell),
        markdown.indexOf(selectedCell) + selectedCell.length
      );
      await openSourceNativeMenu(page, sourceEditor, selectedCell);
      await openRootSubmenu(page, 'table');
      const formatItem = anyMenuItem(page, 'format-table-source').last();
      await expect(formatItem).toContainText(formatLabel);
      await expect(formatItem).toBeEnabled();
      const firstTransactionProbe = await startSourceTransactionProbe(page);
      try {
        await formatItem.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        try {
          await waitForSourceExactValue(source, expectedDocument, 'source-format-table-applied');
        } catch (error) {
          const alerts = await page.locator(
            '.easymde-editor-message-alert-host [role="alert"]'
          ).evaluateAll((elements) => elements.map((element) => ({
            code: element.getAttribute('data-error-code')
              ?? element.getAttribute('data-easymde-error-code'),
            type: Array.from(element.classList)
              .find((className) => ['is-error', 'is-warning'].includes(className)) ?? null
          })));
          const preview = await page.locator('[data-easymde-preview-html-sink="1"]').last();
          const previewState = await preview.evaluate((element) => ({
            accepted: element.getAttribute('data-easymde-preview-accepted'),
            ariaBusy: element.getAttribute('aria-busy'),
            error: element.getAttribute('data-easymde-preview-error'),
            refreshing: element.getAttribute('data-easymde-preview-refreshing')
          }));
          throw new Error(
            `editor-context-menu-format-table-apply-failed:${JSON.stringify({
              alerts,
              menuCount: await page.locator(menuSelector).count(),
              preview: previewState,
              source: await readPrivacySafeSourceState(source, expectedDocument),
              stableCodes,
              transaction: await firstTransactionProbe.snapshot()
            })}`,
            { cause: error }
          );
        }
      } finally {
        await firstTransactionProbe.stop();
      }
      await assertFormattedTable(formattedTable, 'applied');
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);

      await selectSourceText(page, sourceEditor, expectedDocument, selectedCell);
      const transactionProbe = await startSourceTransactionProbe(page);
      try {
        await openSourceNativeMenu(page, sourceEditor, selectedCell);
        await openRootSubmenu(page, 'table');
        const repeatFormatItem = anyMenuItem(page, 'format-table-source').last();
        await expect(repeatFormatItem).toContainText(formatLabel);
        await expect(repeatFormatItem).toBeEnabled();
        await repeatFormatItem.click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await assertSourceExactValue(source, expectedDocument, 'source-format-table-repeat');
        const repeatEvents = await transactionProbe.snapshot();
        if (repeatEvents?.count !== 0) {
          throw new Error(`editor-context-menu-format-table-repeat-transaction:${repeatEvents.count}`);
        }
      } finally {
        await transactionProbe.stop();
      }
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);
      if (stableCodes.length > 0) {
        throw new Error(`editor-context-menu-format-table-stable-error:${stableCodes.join(',')}`);
      }

      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'source-format-table-undo');
      await assertSourceExactValue(source, markdown, 'source-format-table-undo-exact');
    } finally {
      page.off('console', onConsole);
    }
  });

  test('keeps Source image copying capability gated by the real local PNG load', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const imageGate = createImageRequestGate();
    const { fixtureImageUrl, markdown, source, sourceEditor } =
      await loadCanonicalFixture(page, 1, { imageGate });
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
    const imageStart = occurrenceOffset(markdown, imageMarkdown);
    const image = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"] img'
    ).first();
    const documentWrites = [];
    const dialogs = [];
    page.on('request', (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      const body = request.postData() ?? '';
      const isPreview = url.pathname.endsWith('/wp-json/easymde/v1/preview');
      const isHeartbeat = url.pathname.endsWith('/wp-admin/admin-ajax.php')
        && (url.searchParams.get('action') === 'heartbeat'
          || /(?:^|&)action=heartbeat(?:&|$)/u.test(body));
      if (!isPreview && !isHeartbeat) documentWrites.push(url.pathname);
    });
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });

    try {
      await expect(image).toHaveCount(1);
      await expect.poll(() => image.evaluate((element) => element.complete)).toBe(false);

      await selectSourceText(page, sourceEditor, markdown, imageMarkdown);
      await openSourceMenu(page, sourceEditor);
      await expectMenuItemState(page, 'copy-image', 'disabled');
      await expectSourceSelection(page, imageStart, imageStart + imageMarkdown.length);
      await expect(source).toHaveValue(markdown);

      imageGate.release();
      await waitForRealImageLoad(image);
      await expect(page.locator(menuSelector)).toBeVisible();
      await expectSourceSelection(page, imageStart, imageStart + imageMarkdown.length);
      await expectMenuItemState(page, 'copy-image', 'enabled');
      await expect(source).toHaveValue(markdown);
      await closeMenu(page);
      await expect(source).toHaveValue(markdown);
      await expect(page.locator('.easymde-editor-message-alert-host [role="alert"]'))
        .toHaveCount(0);
      expect(dialogs).toEqual([]);
      expect(documentWrites).toEqual([]);
    } finally {
      imageGate.release();
    }
  });

  test('applies every image scale through ordinary and immersive split Source, then saves 200% natively', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, preview, source, sourceEditor } =
      await loadCanonicalFixture(page);
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;

    await exerciseImageScaleMatrix(page, {
      imageMarkdown,
      markdown,
      mode: 'ordinary-source',
      preview,
      source,
      sourceEditor
    });
    await assertSourceExactValue(source, markdown, 'ordinary-source-complete');

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    const splitPreview = page.locator('[data-easymde-preview-html-sink="1"]').last();
    const splitSourceEditor = page.locator('.easymde-source-react .cm-content');
    await exerciseImageScaleMatrix(page, {
      imageMarkdown,
      markdown,
      mode: 'immersive-split-source',
      preview: splitPreview,
      source,
      sourceEditor: splitSourceEditor
    });
    await assertSourceExactValue(source, markdown, 'immersive-split-source-complete');

    await page.getByRole('button', { name: strings.exit, exact: true }).click();
    await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);

    const finalExpected = imageScaleSource(markdown, imageMarkdown, 200);
    const ordinarySourceEditor = page.locator('.easymde-source-react .cm-content');
    await applyImageScaleFromSource(
      page,
      source,
      ordinarySourceEditor,
      markdown,
      imageMarkdown,
      200,
      finalExpected
    );
    const finalPreview = page.locator('[data-easymde-preview-html-sink="1"]').last();
    const finalImage = finalPreview.getByAltText(imageSourceAlt, { exact: true });
    await expect(finalImage).toHaveCount(1);
    await waitForRealImageLoad(finalImage);
    await assertPreviewImageScale(finalImage, 200, 'before-save');
    await saveAndReloadImageScale(page, source, finalExpected);
  });

  test('exports canonical formula and Mermaid locally without changing Source or Preview', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    await expect(preview.locator('.easymde-math').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();

    const formulaSource = displayMathSource(markdown);
    const formulaCodeBlock = displayMathMarkdown(markdown);
    const mermaidSource = fencedBlockSource(markdown, 'mermaid');
    const mermaidCodeBlock = fencedBlockMarkdown(markdown, 'mermaid');
    const formulaExportSource = `\n${formulaSource}\n`;
    const mermaidExportSource = `${mermaidSource}\n`;
    const mutationProbe = startGeneratedExportMutationProbe(page);
    try {
      for (const [action, label] of [
        ['copy-generated-source', 'formula-copy-source'],
        ['copy-generated-mathml', 'formula-copy-mathml'],
        ['copy-generated-image', 'formula-copy-png'],
        ['save-generated-image', 'formula-save-png'],
        ['copy-code-block', 'formula-copy-code-block']
      ]) {
        await runGeneratedExportAction(page, {
          action,
          expectedSource: 'copy-code-block' === action
            ? formulaCodeBlock
            : formulaExportSource,
          label,
          markdown,
          mutationProbe,
          preview,
          selectText: formulaSource,
          source,
          sourceEditor
        });
      }
      for (const [action, label] of [
        ['copy-generated-source', 'mermaid-copy-source'],
        ['copy-generated-image', 'mermaid-copy-png'],
        ['save-generated-image', 'mermaid-save-png'],
        ['copy-code-block', 'mermaid-copy-code-block']
      ]) {
        await runGeneratedExportAction(page, {
          action,
          expectedSource: 'copy-code-block' === action
            ? mermaidCodeBlock
            : mermaidExportSource,
          label,
          markdown,
          mutationProbe,
          preview,
          selectText: 'flowchart TD',
          source,
          sourceEditor
        });
      }
    } finally {
      mutationProbe.stop();
    }
    await assertSourceExactValue(source, markdown, 'generated-export-complete');
  });

  test('accepts Full Visual list Cut through accepted Preview and native Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    const selectedText = '前端开发';
    const expected = replaceVisualSourceOccurrence(markdown, selectedText, '');
    const target = full.visualEditor.locator('li').filter({ hasText: selectedText }).first();

    await runVisualMutationAction(page, full.visualEditor, source, markdown, {
      action: 'cut',
      expected,
      label: 'focused-full-list-cut',
      target,
      selectText: selectedText
    });
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      selectedText,
      'focused-full-list-cut'
    );
    await assertSourceExactValue(source, markdown, 'focused-full-list-cut-reset');
  });

  test('accepts Full and Windowed Visual text/list/link/cross-heading/image/table actions through formal Preview re-entry', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    await runVisualActionMatrix(page, full.visualEditor, source, markdown, 0, 'full');
    await repeatAfterFormalPreview(page, full.strings, source, markdown, 0);
    await assertSourceExactValue(source, markdown, 'full-visual-actions-complete');

    await page.getByRole('button', { name: full.strings.exit, exact: true }).click();
    await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);

    const windowedMarkdown = `${markdown}\n${markdown}`;
    await sourceEditor.fill(windowedMarkdown);
    await waitForSourceExactValue(source, windowedMarkdown, 'windowed-fixture-applied');
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    const windowed = await enterFullVisual(page);
    await expect.poll(
      () => windowed.visualEditor.locator('[data-easymde-preview-window-spacer]').count()
    ).toBeGreaterThan(0);
    await runVisualActionMatrix(
      page,
      windowed.visualEditor,
      source,
      windowedMarkdown,
      0,
      'windowed'
    );
    await page.getByRole('button', { name: windowed.strings.exit, exact: true }).click();
    await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);
    await sourceEditor.fill(windowedMarkdown);
    await waitForSourceExactValue(source, windowedMarkdown, 'windowed-fixture-restored');
    await assertSourceExactValue(source, windowedMarkdown, 'windowed-visual-actions-complete');
  });

  test('opens image actions when directly right-clicking an unselected Full Visual image', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    const image = full.visualEditor.getByAltText(imageSourceAlt, { exact: true }).first();

    await openVisualMenu(
      page,
      full.visualEditor,
      image,
      async () => {
        await image.evaluate((target) => {
          target.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
        });
      }
    );

    await expectMenuItemState(page, 'image-scale', 'enabled');
    await expect(page.locator(menuSelector)).toBeVisible();
  });

  test('keeps immersive split Source interactive without changing the canonical source on dismissal', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    await expect(source).toHaveValue(markdown);
    await assertSourceCategoryMatrix(page, {
      fixtureImageUrl,
      markdown,
      source,
      sourceEditor
    });

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await rootItem(page, 'bold').click();
    await expect(source).toHaveValue(markdown.replace('普通文本', '**普通文本**'));
    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await page.locator('.easymde-immersive-header').click({ position: { x: 12, y: 12 } });
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(markdown);
  });

  test('accepts a Full Visual selection spanning text and an inline formula without exposing object actions', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 1, { nativeInput: true });
    const full = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(full.visualEditor, 'mixed-formula-before');

    const mixedMarkdown = '爱因斯坦质能方程：$E = mc^2$';
    if (!markdown.includes(mixedMarkdown)) throw new Error('mixed-formula-source-line-missing');
    const paragraph = full.visualEditor.locator('p').filter({ hasText: '爱因斯坦质能方程' }).first();
    const formula = paragraph.locator('.easymde-math').first();
    await expect(paragraph).toBeVisible();
    await expect(formula).toBeVisible();
    const selectMixedFormula = async () => {
      await paragraph.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('mixed-formula-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      });
    };

    await assertSourceExactValue(source, markdown, 'mixed-formula-before');
    await openVisualMenu(page, full.visualEditor, paragraph, selectMixedFormula);
    const mixedSelection = await full.visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const formulaElement = surface.querySelector('.easymde-math');
      return {
        containsFormula: Boolean(
          selection
          && selection.rangeCount === 1
          && formulaElement
          && selection.getRangeAt(0).intersectsNode(formulaElement)
        ),
        selectedTextLength: selection?.toString().length ?? 0
      };
    });
    if (!mixedSelection.containsFormula || mixedSelection.selectedTextLength === 0) {
      throw new Error(`mixed-formula-selection-invalid:${JSON.stringify(mixedSelection)}`);
    }
    await expect(anyMenuItem(page, 'generated-content')).toHaveCount(0);
    await openRootSubmenu(page, 'copy-paste-as');
    await expectMenuItemState(page, 'copy-as-markdown', 'enabled');
    await anyMenuItem(page, 'copy-as-markdown').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    if ((await readNativeClipboardText(page)) !== mixedMarkdown) {
      throw new Error('mixed-formula-markdown-clipboard-drift');
    }
    await assertSourceExactValue(source, markdown, 'mixed-formula-copy-after');
    await waitForVisualPreviewAccepted(full.visualEditor, 'mixed-formula-copy-after');
    await assertSourceExactValue(source, markdown, 'mixed-formula-complete');
  });

  test('inventories body, text, heading, link, image, table, list, code, math, and Mermaid in full Visual', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const { visualEditor } = await enterFullVisual(page);
    await expect(source).toHaveValue(markdown);
    await assertVisualCategoryMatrix(page, visualEditor, 'first', source, markdown);
    await expect(source).toHaveValue(markdown);
  });

  test('keeps the context menu usable on the Windowed Visual surface after two canonical fixtures', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    await expect(source).toHaveValue(markdown);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'two canonical fixtures should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-visual-block-id]').count()
    ).toBeLessThanOrEqual(160);

    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBe(0);
    await assertVisualCategoryMatrix(page, visualEditor, 'first', source, markdown);

    await canvas.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(
      () => canvas.evaluate((element) => element.scrollTop)
    ).toBeGreaterThan(0);
    const bottomMermaid = visualEditor.locator('.easymde-mermaid').last();
    await expect(bottomMermaid).toBeVisible();
    await assertVisualCategory(page, visualEditor, {
      id: 'mermaid-bottom',
      markdown,
      items: { 'generated-content': 'enabled' },
      source,
      target: bottomMermaid
    });
    await expect.poll(
      () => visualEditor.locator('[data-easymde-visual-block-id]').count()
    ).toBeLessThanOrEqual(160);
    await expect(source).toHaveValue(markdown);
  });

  test('inserts a paragraph above a standalone thematic break without changing its Markdown marker', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = '# prefix\n  ---  \nsuffix';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(
      page,
      sourceEditor,
      source,
      markdown,
      'thematic-break-menu-before'
    );

    await selectSourceText(page, sourceEditor, markdown, '---');
    await openSourceNativeMenu(page, sourceEditor, '---');
    await openRootSubmenu(page, 'insert');
    await expect(anyMenuItem(page, 'insert-paragraph-above')).toBeEnabled();
    await anyMenuItem(page, 'insert-paragraph-above').click();
    await waitForSourceExactValue(
      source,
      '# prefix\n\n\n  ---  \nsuffix',
      'thematic-break-menu-after'
    );
    await expect(page.locator(menuSelector)).toHaveCount(0);
  });

  test('inserts above a thematic break from Full Visual through the same source owner', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = '# prefix\n\n---\n\nsuffix';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(
      page,
      sourceEditor,
      source,
      markdown,
      'visual-thematic-break-before'
    );
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ).first();
    await waitForSourcePreviewAccepted(preview, 'visual-thematic-break-source-before');

    const full = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(full.visualEditor, 'visual-thematic-break-before');
    const thematicBreak = full.visualEditor.locator('hr').first();
    await expect(thematicBreak).toBeVisible();
    await openVisualMenu(
      page,
      full.visualEditor,
      thematicBreak,
      () => thematicBreak.evaluate((target) => {
        const range = target.ownerDocument.createRange();
        range.selectNode(target);
        const selection = target.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('visual-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      })
    );
    await openRootSubmenu(page, 'insert');
    await expect(anyMenuItem(page, 'insert-paragraph-above')).toBeEnabled();
    await anyMenuItem(page, 'insert-paragraph-above').click();
    await waitForSourceExactValue(
      source,
      '# prefix\n\n\n\n---\n\nsuffix',
      'visual-thematic-break-after'
    );
    await expect(page.locator(menuSelector)).toHaveCount(0);
  });

  test('deletes a standalone thematic break from ordinary and immersive split Source with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const source = page.locator('#easymde-source');
    let sourceEditor = page.locator('.easymde-source-react .cm-content');
    await sourceEditor.fill(markdown);
    await waitForSourceExactValue(source, markdown, 'source-thematic-break-before');
    await runSourceThematicBreakDelete(page, {
      expected,
      label: 'ordinary-source-thematic-break',
      markdown,
      source,
      sourceEditor
    });

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    sourceEditor = page.locator('.easymde-source-react .cm-content').last();
    await sourceEditor.fill(markdown);
    await waitForSourceExactValue(source, markdown, 'immersive-split-source-thematic-break-before');
    await runSourceThematicBreakDelete(page, {
      expected,
      label: 'immersive-split-source-thematic-break',
      markdown,
      source,
      sourceEditor
    });
  });

  test('deletes a standalone thematic break from Full Visual with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ).first();
    await sourceEditor.fill(markdown);
    await waitForSourceExactValue(source, markdown, 'full-thematic-break-before');
    await waitForSourcePreviewAccepted(preview, 'full-thematic-break-before');
    const full = await enterFullVisual(page);
    const thematicBreak = full.visualEditor.locator('hr').first();
    await expect(thematicBreak).toBeVisible();
    await runVisualThematicBreakDelete(page, {
      expected,
      label: 'full-visual-thematic-break',
      markdown,
      source,
      target: thematicBreak,
      visualEditor: full.visualEditor
    });
  });

  test('deletes a standalone thematic break from Windowed Visual with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const leading = Array.from(
      { length: 220 },
      (_, index) => `windowed paragraph ${index}`
    ).join('\n\n');
    const markdown = `${leading}\n\n  ---  \n\nwindowed tail`;
    const expected = `${leading}\n\n\nwindowed tail`;
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await sourceEditor.fill(markdown);
    await waitForSourceExactValue(source, markdown, 'windowed-thematic-break-before');
    const full = await enterFullVisual(page);
    await expect.poll(
      () => full.visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'synthetic long source should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const thematicBreak = full.visualEditor.locator('hr').last();
    await expect(thematicBreak).toBeVisible();
    await runVisualThematicBreakDelete(page, {
      expected,
      label: 'windowed-visual-thematic-break',
      markdown,
      source,
      target: thematicBreak,
      select: () => thematicBreak.evaluate((element) => {
        const surface = element.parentElement;
        if (!surface) throw new Error('windowed-hr-surface-unavailable');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-hr-selection-unavailable');
        const index = Array.prototype.indexOf.call(surface.children, element);
        if (index < 0) throw new Error('windowed-hr-index-unavailable');
        surface.focus();
        selection.removeAllRanges();
        selection.setBaseAndExtent(surface, index, surface, index + 1);
      }),
      visualEditor: full.visualEditor
    });
  });

  test('deletes a Windowed Visual thematic break through native Backspace and restores Undo/Redo selection', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const windowedMarkdown = `${markdown}\n${markdown}`;
    await sourceEditor.fill(windowedMarkdown);
    await waitForSourceExactValue(source, windowedMarkdown, 'windowed-hr-fixture-applied');
    await expect(preview).toHaveAttribute('aria-busy', 'false');

    const visual = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(visual.visualEditor, 'windowed-hr-before');
    await expect.poll(
      () => visual.visualEditor.locator('[data-easymde-preview-window-spacer]').count()
    ).toBeGreaterThan(0);
    await visual.visualEditor.evaluate((surface) => {
      for (let node = surface; node instanceof HTMLElement; node = node.parentElement) {
        node.scrollTop = 0;
        node.scrollLeft = 0;
      }
    });
    await page.waitForTimeout(700);
    const thematicBreak = visual.visualEditor.locator(':scope > hr').first();
    await expect(thematicBreak).toBeVisible();
    const markerStart = occurrenceOffset(windowedMarkdown, '\n---\n') + 1;
    if (markerStart < 1) throw new Error('windowed-hr-source-marker-missing');
    const deletedMarkdown =
      windowedMarkdown.slice(0, markerStart) + windowedMarkdown.slice(markerStart + 3);

    await thematicBreak.evaluate((element) => {
      const surface = element.parentElement;
      if (!surface) throw new Error('windowed-hr-surface-unavailable');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-hr-selection-unavailable');
      const index = Array.prototype.indexOf.call(surface.children, element);
      if (index < 0) throw new Error('windowed-hr-index-unavailable');
      surface.focus();
      selection.removeAllRanges();
      selection.setBaseAndExtent(surface, index, surface, index + 1);
    });
    await page.keyboard.press('Backspace');
    await waitForSourceExactValue(source, deletedMarkdown, 'windowed-hr-delete');
    const deletePreview = await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'windowed-hr-delete'
    );

    await visual.visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, windowedMarkdown, 'windowed-hr-undo');
    const undoPreview = await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'windowed-hr-undo',
      deletePreview.domHash
    );
    await visual.visualEditor.press('ControlOrMeta+Shift+z');
    await waitForSourceExactValue(source, deletedMarkdown, 'windowed-hr-redo');
    await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'windowed-hr-redo',
      undoPreview.domHash
    );
  });

  test('persists a custom Bold shortcut and keeps keyboard and context-menu behavior aligned in Source and Full Visual', async ({ page }) => {
    await login(page);
    const isMac = await page.evaluate(() => navigator.platform.startsWith('Mac'));
    const platformIndex = isMac ? 1 : 0;
    const customPress = isMac ? 'Meta+Alt+9' : 'Control+Alt+9';
    const customLabels = isMac ? ['Cmd', 'Option', '9'] : ['Ctrl', 'Alt', '9'];
    const customDisplay = customLabels.join('+');
    let originalLabels = null;
    let originalPress = null;
    let customSaved = false;
    let strings;

    const openShortcutSettings = async () => {
      await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      await page.locator('button[data-nav-id="shortcuts"]').click();
    };
    const shortcutRow = () => page.locator(
      `[data-settings-section="shortcuts"] [data-setting-label="${strings.bold}"]`
    );
    const shortcutRecorder = () => shortcutRow().locator(
      '.easymde-settings-center__shortcut-recorder'
    ).nth(platformIndex);
    const shortcutClear = () => shortcutRow().locator(
      '.easymde-settings-center__shortcut-clear'
    ).nth(platformIndex);
    const readShortcutLabels = async () => (
      shortcutRecorder().locator('kbd').allTextContents()
    );
    const playShortcutFromLabels = (labels) => labels.map((label) => ({
      Alt: 'Alt',
      Cmd: 'Meta',
      Ctrl: 'Control',
      Meta: 'Meta',
      Option: 'Alt',
      Shift: 'Shift'
    }[label] ?? label)).join('+');
    const recordShortcut = async (press) => {
      await shortcutRecorder().click();
      await expect(shortcutRecorder()).toHaveAttribute('data-recording', 'true');
      await page.keyboard.press(press);
      await expect(shortcutRecorder()).not.toHaveAttribute('data-recording', 'true');
    };
    const saveShortcutSettings = async () => {
      const saveButton = page.locator('.easymde-settings-center__save-bar > button');
      const saveStatus = page.locator('[data-save-status]');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute('data-save-status', /saved|idle/u);
      await expect(saveButton).toBeDisabled();
    };
    const assertBoldHint = async () => {
      const title = await page.locator('[data-easymde-command="bold"]').first().getAttribute('title');
      if (!title?.includes(customDisplay)) throw new Error('settings-bold-toolbar-hint-missing');
    };
    const assertContextBoldHint = async () => {
      await expect(
        anyMenuItem(page, 'bold').last().locator('.easymde-editor-context-menu__shortcut')
      ).toHaveText(customDisplay);
    };

    try {
      await openShortcutSettings();
      strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      originalLabels = await readShortcutLabels();
      if (originalLabels.length === 0) {
        throw new Error('settings-bold-original-binding-empty');
      }
      originalPress = playShortcutFromLabels(originalLabels);
      if (!originalPress || originalLabels.join('+') === customDisplay) {
        throw new Error('settings-bold-custom-binding-not-distinct');
      }

      await recordShortcut(customPress);
      await expect(shortcutRecorder().locator('kbd')).toHaveText(customLabels);
      if (await shortcutRecorder().getAttribute('aria-invalid') === 'true') {
        throw new Error('settings-bold-custom-binding-conflict');
      }
      await expect(shortcutRow().getByRole('alert')).toHaveCount(0);
      await saveShortcutSettings();
      customSaved = true;

      await page.reload();
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      await page.locator('button[data-nav-id="shortcuts"]').click();
      strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      await expect(shortcutRecorder().locator('kbd')).toHaveText(customLabels);

      await page.goto('/wp-admin/post-new.php');
      await expect(page.locator('#easymde-editor')).toBeVisible();
      const { markdown, source, sourceEditor } = await loadCanonicalFixture(
        page,
        1,
        { nativeInput: true }
      );
      const selectedText = '普通文本';
      const boldMarkdown = markdown.replace(selectedText, `**${selectedText}**`);
      const sourcePreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      ).first();
      await waitForSourcePreviewAccepted(sourcePreview, 'settings-bold-source-before');
      await assertBoldHint();

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await sourceEditor.press(originalPress);
      await assertSourceExactValue(source, markdown, 'settings-bold-original-source-key');
      await expect(page.locator(menuSelector)).toHaveCount(0);

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await sourceEditor.press(customPress);
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-custom-source-key');
      const sourceKeyPreview = await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-custom-source-key'
      );
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-custom-source-key-undo');
      await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-custom-source-key-undo',
        sourceKeyPreview.domHash
      );

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await openSourceNativeMenu(page, sourceEditor, selectedText);
      await assertContextBoldHint();
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-source-menu');
      const sourceMenuPreview = await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-source-menu'
      );
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-source-menu-undo');
      await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-source-menu-undo',
        sourceMenuPreview.domHash
      );

      const full = await enterFullVisual(page);
      await waitForVisualPreviewAccepted(full.visualEditor, 'settings-bold-full-before');
      const visualTarget = full.visualEditor.locator('p').filter({ hasText: selectedText }).first();
      await prepareVisualTarget(full.visualEditor, visualTarget);
      const fullShortcutProbe = await startSettingsShortcutProbe(page);
      const fullConsoleProbe = startSourceMediaConsoleProbe(page);
      const fullFormatBoldProbe = await startSettingsFormatBoldProbe(page);
      let keyActionPreview;
      let fullOldKeyBeforeState;
      let fullOldKeyState;
      let fullCustomBeforeState;
      try {
        await selectVisualText(full.visualEditor, selectedText);
        fullOldKeyBeforeState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-original-full-key-before'
        );
        await full.visualEditor.press(originalPress);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const formatBoldEvents = await fullFormatBoldProbe.snapshot();
        fullOldKeyState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-original-full-key-after'
        );
        fullOldKeyState.formatBoldEvents = formatBoldEvents;
        await waitForSourceExactValue(source, markdown, 'settings-bold-original-full-key');
        const oldKeyVisual = fullOldKeyState.visual;
        if (fullOldKeyState.source.hash !== fullOldKeyBeforeState.source.hash
          || fullOldKeyState.source.length !== fullOldKeyBeforeState.source.length
          || fullOldKeyState.visual.selectedTextLength !== selectedText.length
          || !oldKeyVisual.anchor.connected
          || !oldKeyVisual.focus.connected
          || oldKeyVisual.anchor.tag !== 'P'
          || oldKeyVisual.focus.tag !== 'P'
          || oldKeyVisual.anchor.insideStrong
          || oldKeyVisual.focus.insideStrong
          || oldKeyVisual.anchor.protected
          || oldKeyVisual.focus.protected
          || fullOldKeyState.toolbarErrorPresent) {
          throw new Error(
            `settings-bold-full-old-key-state:${JSON.stringify(fullOldKeyState)}`
          );
        }

        await selectVisualText(full.visualEditor, selectedText);
        fullCustomBeforeState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-full-custom-before'
        );
        if (fullCustomBeforeState.visual.selectedTextLength !== selectedText.length
          || !fullCustomBeforeState.visual.anchor.connected
          || !fullCustomBeforeState.visual.focus.connected) {
          throw new Error(
            `settings-bold-full-custom-before-state:${JSON.stringify(fullCustomBeforeState)}`
          );
        }
        const keyPreviewBefore = await readVisualPreviewAcceptanceState(full.visualEditor);
        await full.visualEditor.press(customPress);
        await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-custom-full-key');
        keyActionPreview = await waitForVisualPreviewAccepted(
          full.visualEditor,
          'settings-bold-custom-full-key',
          keyPreviewBefore.domHash
        );
        await full.visualEditor.press('ControlOrMeta+z');
        await waitForSourceExactValue(source, markdown, 'settings-bold-custom-full-key-undo');
        await waitForVisualPreviewAccepted(
          full.visualEditor,
          'settings-bold-custom-full-key-undo',
          keyActionPreview.domHash
        );
      } catch (error) {
        throw new Error(
          `settings-bold-full-key-diagnostic:${JSON.stringify({
            consoleCodes: fullConsoleProbe.codes(),
            events: await fullShortcutProbe.snapshot(),
            fullCustomBeforeState,
            fullOldKeyBeforeState,
            fullOldKeyState,
            formatBoldEvents: await fullFormatBoldProbe.snapshot()
          })}`,
          { cause: error }
        );
      } finally {
        await fullShortcutProbe.stop();
        fullConsoleProbe.stop();
        await fullFormatBoldProbe.stop();
      }

      await openVisualMenu(
        page,
        full.visualEditor,
        visualTarget,
        () => selectVisualText(full.visualEditor, selectedText),
        selectedText
      );
      await assertContextBoldHint();
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-full-menu');
      const menuActionPreview = await waitForVisualPreviewAccepted(
        full.visualEditor,
        'settings-bold-full-menu',
        keyActionPreview.domHash
      );
      await full.visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-full-menu-undo');
      await waitForVisualPreviewAccepted(
        full.visualEditor,
        'settings-bold-full-menu-undo',
        menuActionPreview.domHash
      );
    } finally {
      if (customSaved) {
        await openShortcutSettings();
        strings = await page.evaluate(
          () => window.EasyMDESettingsCenterBootstrap.strings
        );
        const currentLabels = await readShortcutLabels();
        if (currentLabels.join('+') !== customDisplay) {
          throw new Error('settings-bold-restore-concurrency');
        }
        if (originalLabels.length === 0) {
          await shortcutClear().click();
          await expect(shortcutRecorder().locator('kbd')).toHaveCount(0);
        } else {
          await recordShortcut(originalPress);
          await expect(shortcutRecorder().locator('kbd')).toHaveText(originalLabels);
        }
        await saveShortcutSettings();
        await page.reload();
        await expect(page.locator('.easymde-settings-center')).toBeVisible();
        await page.locator('button[data-nav-id="shortcuts"]').click();
        strings = await page.evaluate(
          () => window.EasyMDESettingsCenterBootstrap.strings
        );
        await expect(shortcutRecorder().locator('kbd')).toHaveText(originalLabels);
      }
    }
  });
});
