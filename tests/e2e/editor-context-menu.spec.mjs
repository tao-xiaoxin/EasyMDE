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
// Written through the real native Attachment Details save path before the
// picker is confirmed. The insert contract derives Alt from the attachment
// file name, so this proves the native write round-trip rather than a second
// Alt rule.
const syntheticMediaAlt = 'Synthetic native alt text';
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

  await replaceSourceWithNativeInput(
    page,
    sourceEditor,
    source,
    markdown,
    'canonical-fixture-native-input'
  );
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
  // The canonical marker keeps the requested percentage; only the rendering is
  // capped when the scale exceeds the container's content width.
  await expect.poll(
    () => image.getAttribute('width')
  ).toBe(`${percentage}%`);
  const geometry = await readPreviewImageGeometry(image);
  const capped = percentage > 100;
  const expectedWidth = geometry.contentWidth * Math.min(percentage, 100) / 100;
  const expectedHeight = geometry.naturalWidth > 0
    ? expectedWidth * geometry.naturalHeight / geometry.naturalWidth
    : NaN;
  const valid = geometry.contentWidth > 0
    && geometry.naturalWidth > 0
    && geometry.naturalHeight > 0
    && (capped ? 'none' !== geometry.maxWidth : 'none' === geometry.maxWidth)
    && geometry.renderedWidth <= geometry.contentWidth + 1.5
    && Math.abs(geometry.renderedWidth - expectedWidth) <= 1.5
    && Math.abs(geometry.renderedHeight - expectedHeight) <= 1.5;
  if (!valid) {
    throw new Error(
      `editor-context-menu-image-scale-geometry-failed:${phase}:${percentage}:` +
      `${JSON.stringify(geometry)}`
    );
  }
  if (!capped) return;
  // An enlarged image must not make the surface or its scroll container
  // horizontally scrollable.
  const overflow = await image.evaluate((element) => {
    const canvas = element.closest('.easymde-immersive-preview-canvas');
    const surface = element.closest('.easymde-preview');
    return {
      canvasScrollLeftMax: canvas
        ? canvas.scrollWidth - canvas.clientWidth
        : 0,
      surfaceHorizontalOverflow: surface
        ? surface.scrollWidth - surface.clientWidth
        : 0
    };
  });
  if (
    overflow.canvasScrollLeftMax > 1
    || overflow.surfaceHorizontalOverflow > 1
  ) {
    throw new Error(
      `editor-context-menu-image-scale-overflow-failed:${phase}:${percentage}:` +
      `${JSON.stringify(overflow)}`
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

function displayMathSource(markdown, occurrence = 0) {
  const matches = [...markdown.matchAll(/^\$\$\r?\n([\s\S]*?)\r?\n\$\$/gmu)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-display-math-missing:${occurrence}`);
  return match[1];
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
    let hash = 2166136261;
    for (const byte of serializedBytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return {
      bounds: { bottom, left, right, top },
      hash: (hash >>> 0).toString(16),
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

/**
 * Decodes a POST body by its declared content type. WordPress sends
 * urlencoded AJAX, JSON REST, and - for `navigator.sendBeacon` on pagehide - a
 * real `multipart/form-data` body, so a urlencoded-only decoder would report a
 * legitimate Core request as an unknown write. Parsing is strict and scalar
 * only: a part carrying a file is reported separately instead of having its
 * bytes scanned, and an unrecognized shape is an explicit failure rather than
 * a guess.
 */
function decodePostParameters(request) {
  // Only the media type is case-insensitive: a multipart boundary is
  // case-sensitive, so the raw header value is preserved for parsing.
  const rawContentType = request.headers()['content-type'] ?? '';
  const contentType = rawContentType.toLowerCase();
  const body = request.postData() ?? '';
  const parameters = new URLSearchParams();
  const shape = (extra = {}) => ({
    encoding: 'urlencoded',
    hasFilePart: false,
    parameters,
    unsupported: false,
    ...extra
  });
  if (contentType.includes('multipart/form-data')) {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(rawContentType);
    const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? '').trim();
    const delimiter = `--${boundary}`;
    if (!boundary || !body.includes(delimiter)) {
      return shape({ encoding: 'multipart', unsupported: true });
    }
    // Real multipart framing: an opening delimiter, CRLF-separated part
    // headers, a blank line, then the scalar value up to the next delimiter.
    let unsupported = false;
    let hasFilePart = false;
    let index = body.indexOf(delimiter);
    if (index < 0) return shape({ encoding: 'multipart', unsupported: true });
    for (;;) {
      const afterDelimiter = index + delimiter.length;
      if ('--' === body.slice(afterDelimiter, afterDelimiter + 2)) break;
      const headerStart = afterDelimiter + (body.startsWith('\r\n', afterDelimiter) ? 2
        : body.startsWith('\n', afterDelimiter) ? 1 : 0);
      const headerEnd = body.indexOf('\r\n\r\n', headerStart);
      const altHeaderEnd = body.indexOf('\n\n', headerStart);
      const split = headerEnd < 0 ? altHeaderEnd : headerEnd;
      if (split < 0) {
        unsupported = true;
        break;
      }
      const valueStart = split + (headerEnd >= 0 ? 4 : 2);
      const next = body.indexOf(delimiter, valueStart);
      if (next < 0) {
        unsupported = true;
        break;
      }
      const headerText = body.slice(headerStart, split);
      const value = body
        .slice(valueStart, next)
        .replace(/\r\n$/u, '')
        .replace(/\n$/u, '');
      const disposition = /content-disposition:([^\r\n]*)/iu.exec(headerText)?.[1] ?? '';
      const name = /name="([^"]*)"/iu.exec(disposition)?.[1];
      if (!name) {
        unsupported = true;
      } else if (/filename=/iu.test(disposition)) {
        hasFilePart = true;
      } else {
        parameters.append(name, value);
      }
      index = next;
    }
    return shape({ encoding: 'multipart', hasFilePart, unsupported });
  }
  if (contentType.includes('application/json') || body.trim().startsWith('{')) {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return shape({ encoding: 'json', unsupported: true });
    }
    if (!payload || 'object' !== typeof payload || Array.isArray(payload)) {
      return shape({ encoding: 'json', unsupported: true });
    }
    for (const [name, value] of Object.entries(payload)) {
      if ('string' === typeof value || 'number' === typeof value) {
        parameters.append(name, String(value));
      }
    }
    return shape({ encoding: 'json' });
  }
  for (const [name, value] of new URLSearchParams(body)) parameters.append(name, value);
  return shape();
}

async function readNativeWordPressIdentity(page) {
  return page.evaluate(() => ({
    postId: document.querySelector('#post_ID')?.value ?? '',
    title: document.querySelector('#title')?.value ?? '',
    slug: document.querySelector('#post_name')?.value ?? '',
    permalinkNonce: document.querySelector('#samplepermalinknonce')?.value ?? ''
  }));
}

/**
 * Classifies one POST as a Core native read or a write. The returned function
 * is deliberately strict: an unknown action, an unknown heartbeat payload
 * owner, or a heartbeat whose data names another post is a write. Only
 * Core-owned read/maintenance requests that address the current post are
 * exempt. `refresh()` re-reads the form identity after a save/navigation.
 */
/**
 * Every value registered for one parameter name. PHP parses a repeated name by
 * keeping the last value, so a classifier that reads only the first value can
 * be handed a benign duplicate followed by a foreign one; all values must be
 * inspected instead.
 */
function parameterValues(parameters, name) {
  const values = [];
  for (const [key, value] of parameters.entries()) {
    if (key === name) values.push(value);
  }
  return values;
}

function everyParameterValue(parameters, name, accepted) {
  const values = parameterValues(parameters, name);
  return values.length > 0 && values.every(accepted);
}

function classifyNativeWordPressRead(identity, url, parameters, action, decoded = null) {
  if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return false;
  // A body shape the decoder could not read, a multipart part carrying a file,
  // or any field outside the allowlist for these reads is a write.
  if (decoded && (decoded.unsupported || decoded.hasFilePart)) return false;
  // Only the exact fields Core sends for each read are allowed, and only the
  // two owners Core itself sends in a heartbeat payload. A duplicated or extra
  // field changes what PHP would execute, so it is a write.
  const shapes = {
    'sample-permalink': {
      fields: new Set(['action', 'post_id', 'samplepermalinknonce', 'new_title', 'new_slug']),
      owners: new Set()
    },
    'wp-remove-post-lock': {
      fields: new Set(['action', '_wpnonce', 'post_ID', 'active_post_lock']),
      owners: new Set()
    },
    heartbeat: {
      fields: new Set(['action', 'screen_id', '_nonce', 'interval', 'has_focus', 'data', 'wp_customize']),
      owners: new Set(['wp-refresh-post-lock', 'wp-refresh-post-nonces'])
    }
  }[action];
  if (!shapes) return false;
  for (const key of parameters.keys()) {
    // A repeated name keeps only its last value in PHP, so any duplicate is a
    // payload Core never sends.
    if (parameterValues(parameters, key).length > 1) return false;
    const owner = /^data\[([^\]]+)\]/u.exec(key)?.[1];
    if (owner) {
      if (!shapes.owners.has(owner)) return false;
      continue;
    }
    if (!shapes.fields.has(key)) return false;
  }
  const currentPost = (value) => value === identity.postId;
  if (action === 'sample-permalink') {
    return identity.postId !== '' && identity.permalinkNonce !== ''
      && everyParameterValue(parameters, 'post_id', currentPost)
      && everyParameterValue(parameters, 'samplepermalinknonce', (value) =>
        value === identity.permalinkNonce)
      && everyParameterValue(parameters, 'new_title', (value) => value === identity.title)
      // Core omits `new_slug` when it asks for a slug from the title
      // (wp-admin/js/post.js autosave path). Any slug it does send must still
      // describe this form.
      && parameterValues(parameters, 'new_slug')
        .every((value) => value === identity.slug);
  }
  if (action === 'wp-remove-post-lock') {
    return identity.postId !== '' && everyParameterValue(parameters, 'post_ID', currentPost)
      && everyParameterValue(parameters, '_wpnonce', (value) => value.length > 0);
  }
  if (action !== 'heartbeat'
    || !everyParameterValue(parameters, 'screen_id', (value) => 'post' === value)) {
    return false;
  }
  // Every real Core heartbeat carries its own nonce; a payload without one
  // is not a Core maintenance tick.
  if (!everyParameterValue(parameters, '_nonce', (value) => value.length > 0)) return false;
  // Core lock/nonce maintenance is not article persistence. These are the two
  // owners Core itself sends on a post screen (wp-admin/js/post.js). Heartbeat
  // autosave (`wp_autosave`) and extension payloads are writes, never exempt.
  const allowed = new Set(['wp-refresh-post-lock', 'wp-refresh-post-nonces']);
  const owners = new Map();
  const register = (owner, payload) => {
    if (!allowed.has(owner) || owners.has(owner)
      || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const fields = Object.keys(payload);
    if (!fields.includes('post_id') || !currentPost(String(payload.post_id))) return false;
    if (fields.some((field) => field !== 'post_id'
      && !(owner === 'wp-refresh-post-lock' && field === 'lock'))) return false;
    if ('lock' in payload && (typeof payload.lock !== 'string' || !payload.lock)) return false;
    owners.set(owner, payload);
    return true;
  };
  const bracketOwners = new Map();
  for (const [key, value] of parameters.entries()) {
    if (!key.startsWith('data[')) continue;
    const match = /^data\[([^\]]+)\]\[(post_id|lock)\]$/u.exec(key);
    if (!match || !allowed.has(match[1])) return false;
    const payload = bracketOwners.get(match[1]) ?? {};
    payload[match[2]] = value;
    bracketOwners.set(match[1], payload);
  }
  if (bracketOwners.size && parameters.has('data')) return false;
  for (const [owner, payload] of bracketOwners) {
    if (!register(owner, payload)) return false;
  }
  for (const value of parameterValues(parameters, 'data')) {
    let data;
    try { data = JSON.parse(value); } catch { return false; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    for (const [owner, payload] of Object.entries(data)) {
      if (!register(owner, payload)) return false;
    }
  }
  return true;
}

async function nativeWordPressReadOwner(page) {
  let identity = await readNativeWordPressIdentity(page);
  // `decoded` carries the body shape the probes already parsed; dropping it
  // here would bypass the unreadable/file-part guard for real requests.
  const classify = (url, parameters, action, decoded = null) =>
    classifyNativeWordPressRead(identity, url, parameters, action, decoded);
  classify.refresh = async () => {
    identity = await readNativeWordPressIdentity(page);
    return identity;
  };
  classify.identity = () => identity;
  return classify;
}

async function startGeneratedExportMutationProbe(page) {
  const nativeRead = await nativeWordPressReadOwner(page);
  const writes = [];
  // Every request the first pass rejected, with what the classifier needs to
  // re-judge it against a freshly read identity at assertion time.
  const rejected = [];
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const decoded = decodePostParameters(request);
    const parameters = decoded.parameters;
    const action = url.searchParams.get('action') ?? parameters.get('action');
    const isPreview = url.pathname.endsWith('/wp-json/easymde/v1/preview');
    if (!isPreview && !nativeRead(url, parameters, action, decoded)) {
      const label = url.pathname.endsWith('/wp-admin/post.php')
        ? 'post-form'
        : url.pathname.endsWith('/wp-admin/admin-ajax.php')
          ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
          : url.pathname.includes('/wp-json/')
            ? 'rest'
            : 'other';
      writes.push(label);
      rejected.push({ action, decoded, label, parameters, url });
    }
  };
  page.on('request', onRequest);
  return {
    async assertEmpty(phase) {
      if (0 === writes.length) return;
      // A heartbeat is judged against `#post_ID`, so a capture taken before
      // the form settled reports a Core maintenance tick as a state write.
      // Re-read the identity now and re-judge every rejected request against
      // it. The allowlist is unchanged, so a real autosave (`wp_autosave`),
      // an unknown owner, an extra field, or a heartbeat naming another post
      // still fails under any identity.
      const freshRead = await nativeWordPressReadOwner(page);
      const identity = freshRead.identity();
      const real = rejected.filter(
        (entry) => !freshRead(entry.url, entry.parameters, entry.action, entry.decoded)
      );
      if (real.length > 0) {
        throw new Error(
          `editor-context-menu-generated-export-state-write:${phase}:` +
          JSON.stringify(real.map((entry) => ({
            action: entry.action ?? null,
            dataOwners: [...new Set(
              [...entry.parameters.keys()].filter((key) => key.startsWith('data['))
            )],
            identityPostId: identity.postId,
            label: entry.label,
            lockPostId:
              entry.parameters.get('data[wp-refresh-post-lock][post_id]') ?? null,
            screenId: entry.parameters.get('screen_id') ?? null
          })))
        );
      }
    },
    writes() {
      return [...writes];
    },
    stop() {
      page.off('request', onRequest);
    }
  };
}

async function seedTextClipboard(page, text, phase) {
  await page.evaluate(async (value) => {
    if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
      throw new Error('native-clipboard-write-unavailable');
    }
    await navigator.clipboard.writeText(value);
  }, text);
  const state = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return {
      hasText: items.some((item) => item.types.includes('text/plain')),
      hasPng: items.some((item) => item.types.includes('image/png'))
    };
  });
  if (state.hasPng || !state.hasText) {
    throw new Error(`editor-context-menu-clipboard-seed-invalid:${phase}:${JSON.stringify(state)}`);
  }
}

/**
 * Denies native clipboard writes for the *actual* browser context this page
 * runs in. Playwright's own permissions are not Chromium's protocol state, and
 * the default browser context is not the one the test page uses, so the id is
 * derived from this page's target and required to be unique before any
 * permission is touched. Restoration is unconditional and verified.
 */
async function openClipboardWriteDenial(page, origin, phase) {
  const context = page.context();
  const browser = context.browser();
  if (!browser) throw new Error(`clipboard-denial-browser-unavailable:${phase}`);
  const pageSession = await context.newCDPSession(page);
  const browserSession = await browser.newBrowserCDPSession();
  let disposed = false;
  let restored = false;
  try {
    const { targetInfos } = await browserSession.send('Target.getTargets');
    let targetInfo = null;
    try {
      ({ targetInfo } = await pageSession.send('Target.getTargetInfo'));
    } catch {
      targetInfo = null;
    }
    // The page's identity comes from the protocol when the page session
    // exposes it, and otherwise from a unique URL match. Either way the
    // browserContextId is read off a real target, never assumed.
    const currentUrl = page.url();
    const candidates = targetInfos.filter((target) => (
      'page' === target.type
      && (targetInfo
        ? target.targetId === targetInfo.targetId
        : target.url === currentUrl)
    ));
    if (1 !== candidates.length) {
      throw new Error(
        `clipboard-denial-page-target-not-unique:${phase}:` +
        `${JSON.stringify(candidates.map((target) => target.targetId))}`
      );
    }
    const browserContextId = candidates[0].browserContextId;
    if (!browserContextId) {
      throw new Error(`clipboard-denial-context-unavailable:${phase}`);
    }
    const { browserContextIds } = await browserSession.send('Target.getBrowserContexts');
    if (!browserContextIds.includes(browserContextId)) {
      throw new Error(`clipboard-denial-context-unknown:${phase}`);
    }
    // The permission is context-scoped, so another page in the same context
    // would also be denied. Playwright runs one page per test context; anything
    // else is an explicit failure rather than a silent wider denial.
    const siblingPages = targetInfos.filter((target) => (
      'page' === target.type
      && target.browserContextId === browserContextId
      && target.targetId !== candidates[0].targetId
    ));
    if (siblingPages.length > 0) {
      throw new Error(
        `clipboard-denial-context-shared:${phase}:${JSON.stringify(
          siblingPages.map((target) => target.targetId)
        )}`
      );
    }
    return {
      browserContextId,
      async deny() {
        // Both sanitization variants: Chromium resolves the stricter one for
        // an unsanitized write and the other for a sanitized write.
        for (const allowWithoutSanitization of [false, true]) {
          await browserSession.send('Browser.setPermission', {
            browserContextId,
            origin,
            permission: { allowWithoutSanitization, name: 'clipboard-write' },
            setting: 'denied'
          });
        }
        const state = await page.evaluate(() => navigator.permissions
          .query({ name: 'clipboard-write' })
          .then((permission) => permission.state));
        if ('denied' !== state) {
          throw new Error(`clipboard-denial-not-applied:${phase}:${state}`);
        }
      },
      async restore() {
        // Idempotent: the success path restores before reading the seed and
        // `finally` restores unconditionally, including after a failure.
        if (restored) return;
        await browserSession.send('Browser.resetPermissions', { browserContextId });
        // Reproduce test.use's context-wide grant, not a narrower origin grant
        // layered over the origin-scoped CDP denial.
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const states = await page.evaluate(() => Promise.all(
          ['clipboard-read', 'clipboard-write'].map((name) => navigator.permissions
            .query({ name })
            .then((permission) => permission.state))
        ));
        if ('granted' !== states[0] || 'granted' !== states[1]) {
          throw new Error(`clipboard-denial-restore-failed:${phase}:${JSON.stringify(states)}`);
        }
        restored = true;
        // Restoration is non-mutating on purpose: the clipboard still holds
        // the text sentinel the denial must have preserved, and a write here
        // would destroy that evidence before it is asserted. The recovery
        // export afterwards proves write permission really works again.
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        await pageSession.detach().catch(() => {});
        await browserSession.detach().catch(() => {});
      }
    };
  } catch (error) {
    if (!disposed) {
      disposed = true;
      await pageSession.detach().catch(() => {});
      await browserSession.detach().catch(() => {});
    }
    throw error;
  }
}

/**
 * Reads the box the export actually rasterizes. The selected source is a
 * display `$$` block, so the inline `.easymde-math` fixture (E = mc²) is never
 * a valid target; the display block is the only admissible math root.
 */
async function readGeneratedExportTargetRect(page, kind, phase, expectedSource) {
  return page.evaluate(({ expectedKind, source }) => {
    const preview = document.querySelector('[data-easymde-preview-html-sink="1"]');
    if (!preview) throw new Error('generated-export-target-preview-missing');
    const selector = 'math' === expectedKind ? '.easymde-math' : '.easymde-mermaid';
    const roots = [...preview.querySelectorAll(selector)].filter(
      (root) => !root.parentElement?.closest(selector)
    );
    // Bind to the root the action will lease: a display formula is the only
    // admissible math root, and its TeX `annotation` is the rendered identity
    // of the selected source. A different formula, an inline formula, or an
    // unrelated block can therefore never supply the expected box.
    const normalized = source.trim();
    const candidates = 'math' === expectedKind
      ? roots.filter((root) => {
        if (!root.classList.contains('easymde-math-block')) return false;
        const annotation = root.querySelector(
          'annotation[encoding="application/x-tex"]'
        );
        return annotation?.textContent?.trim() === normalized;
      })
      // A Mermaid container keeps no selectable source text, so this fixed
      // case binds the explicit ordinal it selects: the first diagram. The
      // ordinal is stated here rather than inferred from "any root".
      : [roots[0]].filter(Boolean);
    const root = candidates[0];
    if (!root) throw new Error('generated-export-target-root-missing');
    if ('math' === expectedKind && candidates.length > 1) {
      throw new Error('generated-export-target-root-ambiguous');
    }
    const rect = root.getBoundingClientRect();
    return {
      displayKind: 'math' === expectedKind
        ? root.classList.contains('easymde-math-block')
        : root.classList.contains('easymde-mermaid'),
      height: rect.height,
      width: rect.width
    };
  }, { expectedKind: kind, source: expectedSource }).then((rect) => {
    if (!(rect.width > 0) || !(rect.height > 0)) {
      throw new Error(`generated-export-target-rect-invalid:${phase}`);
    }
    if (!rect.displayKind) {
      throw new Error(`generated-export-target-kind-mismatch:${phase}`);
    }
    return rect;
  });
}

async function readContextMenuLayerItemIds(page) {
  return page.evaluate(() => {
    const layers = [...document.querySelectorAll(
      '[data-easymde-context-menu-viewport="true"] [data-easymde-context-menu-layer]'
    )];
    const deepest = layers[layers.length - 1];
    return deepest
      ? [...deepest.querySelectorAll('[data-easymde-context-menu-item]')]
        .map((item) => item.getAttribute('data-easymde-context-menu-item'))
      : [];
  });
}

function expectedGeneratedRootIds(kind) {
  const copy = 'math' === kind
    ? ['copy-generated-image', 'copy-generated-source', 'copy-generated-mathml']
    : ['copy-generated-image', 'copy-generated-source'];
  return {
    copy,
    root: [
      'copy-generated',
      'insert-paragraph-above-generated',
      'insert-paragraph-below-generated',
      'delete-generated-content'
    ]
  };
}

async function runGeneratedExportAction(
  page,
  {
    action,
    expectedSource,
    kind,
    label,
    markdown,
    preview,
    source,
    sourceEditor,
    selectText,
    mutationProbe,
    previousPngHash
  }
) {
  await assertSourceExactValue(source, markdown, `${label}-before`);
  await selectSourceText(page, sourceEditor, markdown, selectText);
  await openSourceMenu(page, sourceEditor);
  await openRootSubmenu(page, 'generated-content');
  const ownership = expectedGeneratedRootIds(kind);
  const rootIds = await readContextMenuLayerItemIds(page);
  if (rootIds.includes('code-block')) {
    throw new Error(`generated-export-code-block-submenu-exposed:${label}`);
  }
  if (JSON.stringify(rootIds) !== JSON.stringify(ownership.root)) {
    throw new Error(
      `generated-export-root-actions-mismatch:${label}:` +
      `${JSON.stringify({ actual: rootIds, expected: ownership.root })}`
    );
  }
  await openVisibleSubmenu(page, 'copy-generated');
  const copyIds = await readContextMenuLayerItemIds(page);
  if (JSON.stringify(copyIds) !== JSON.stringify(ownership.copy)) {
    throw new Error(
      `generated-export-copy-actions-mismatch:${label}:` +
      `${JSON.stringify({ actual: copyIds, expected: ownership.copy })}`
    );
  }
  const before = await readGeneratedExportSnapshot(page);
  const actionItem = anyMenuItem(page, action);
  const targetRect = 'copy-generated-image' === action
    ? await readGeneratedExportTargetRect(page, kind, label, expectedSource.trim())
    : null;
  if ('copy-generated-image' === action) {
    // Fresh text seed: a PNG left from an earlier owner must never satisfy
    // the clipboard read below.
    await seedTextClipboard(page, `${label} clipboard seed`, label);
    await actionItem.click();
    const evidence = await readClipboardPng(page, `${label}-clipboard`);
    if (previousPngHash && evidence.hash === previousPngHash) {
      throw new Error(`generated-export-png-stale:${label}:${evidence.hash}`);
    }
    for (const [axis, dimension] of [['width', targetRect.width], ['height', targetRect.height]]) {
      if (Math.abs(evidence[axis] - Math.ceil(dimension)) > 1) {
        throw new Error(
          `generated-export-png-dimension-mismatch:${label}:` +
          `${JSON.stringify({ actual: evidence[axis], axis, css: dimension, hash: evidence.hash })}`
        );
      }
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
    await mutationProbe.assertEmpty(label);
    await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
    return evidence;
  }
  if ('copy-generated-mathml' === action) {
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
  await mutationProbe.assertEmpty(label);
  await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
  return null;
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
  // One entry per console event, in arrival order: a stable code that fires
  // twice is two failures, so a Set would erase a repeated rejection. The
  // helper only observes; the independent browser monitor keeps every level
  // and popup transition of the same page.
  const codes = [];
  const onConsole = (message) => {
    if ('error' !== message.type()) return;
    const match = message.text().match(/^\[EasyMDE\]\s+([a-z0-9-]+)$/u);
    if (match) codes.push(match[1]);
  };
  page.on('console', onConsole);
  return {
    codes: () => [...codes],
    stop() {
      page.off('console', onConsole);
    }
  };
}

async function startSourceMediaMutationProbe(page) {
  const nativeRead = await nativeWordPressReadOwner(page);
  const articleWrites = new Set();
  const mediaActionCounts = new Map();
  const mediaActions = new Set([
    'query-attachments',
    'save-attachment',
    'save-attachment-compat'
  ]);
  let uploadCount = 0;
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const decoded = decodePostParameters(request);
    const parameters = decoded.parameters;
    const action = url.searchParams.get('action') ?? parameters.get('action');
    const path = url.pathname;
    const isPreview = path.endsWith('/wp-json/easymde/v1/preview');
    const isMediaUpload = path.endsWith('/wp-admin/async-upload.php');
    const isMediaAction = path.endsWith('/wp-admin/admin-ajax.php')
      && mediaActions.has(action);
    if (isMediaUpload) {
      uploadCount += 1;
      return;
    }
    if (isMediaAction) {
      mediaActionCounts.set(action, (mediaActionCounts.get(action) ?? 0) + 1);
      return;
    }
    if (isPreview || nativeRead(url, parameters, action, decoded)) return;
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
    mediaActionCounts() {
      return new Map(mediaActionCounts);
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
  await expectMenuItemState(page, 'insert-image-above', 'enabled');
  await anyMenuItem(page, 'insert-image-above').click();
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

/**
 * Prepares a real own attachment while leaving the picker open: upload,
 * Media Library selection, native Attachment Details read and native Alt save.
 * The final native confirmation is the caller's step, so a test can change the
 * authoritative Source field exactly at that boundary without a product hook.
 */
async function uploadAndPrepareSourceImage(page, mediaFrame, mediaModal) {
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
  // The native Attachment Details view is the picker's real ownership
  // surface: the file name it displays is what the insert path derives Alt
  // from, so the expected Markdown is grounded in the native owner, not in a
  // hard-coded fixture string.
  const details = mediaFrame.locator('.attachment-details:visible');
  await expect(details).toHaveCount(1);
  const attachmentUrl = payload?.data?.url ?? '';
  if ('string' !== typeof attachmentUrl || '' === attachmentUrl) {
    throw new Error('editor-context-menu-source-media-attachment-url-missing');
  }
  const nativeAttachment = {
    alt: await details.locator('textarea[id$="-alt-text"]').inputValue(),
    filename: (await details.locator('.filename').innerText())
      .replace(/^[^:：]*[:：]\s*/u, '')
      .trim(),
    url: attachmentUrl
  };
  if (!nativeAttachment.filename) {
    throw new Error('editor-context-menu-source-media-attachment-filename-missing');
  }
  // Exercise the real Core Attachment Details write path: change Alt, let the
  // native view save it, and require the owner's own success response. The
  // inserted Markdown Alt stays filename-derived (see media-picker-session):
  // this proves the native owner round-trip without inventing a second rule.
  const altField = details.locator('textarea[id$="-alt-text"]');
  const savedAltResponse = page.waitForResponse((response) => (
    'POST' === response.request().method()
    && new URL(response.url()).pathname.endsWith('/wp-admin/admin-ajax.php')
    && new URLSearchParams(response.request().postData() ?? '').get('action')
      === 'save-attachment'
  ), { timeout: 15_000 });
  await altField.fill(syntheticMediaAlt);
  // Core binds its save to the native `change` event, so blur the field the
  // way a user does instead of synthesizing the event.
  await altField.press('Tab');
  const savedAlt = await savedAltResponse;
  let savedAltPayload;
  try {
    savedAltPayload = await savedAlt.json();
  } catch (error) {
    throw new Error('editor-context-menu-source-media-alt-response-invalid', { cause: error });
  }
  if (!savedAlt.ok() || true !== savedAltPayload?.success) {
    throw new Error('editor-context-menu-source-media-alt-save-failed');
  }
  await expect(details).toHaveClass(/save-(complete|ready|waiting)/u);
  await expect(altField).toHaveValue(syntheticMediaAlt);
  const savedAltValue = await altField.inputValue();
  if (savedAltValue !== syntheticMediaAlt) {
    throw new Error('editor-context-menu-source-media-alt-roundtrip-mismatch');
  }
  return {
    attachmentId,
    attachmentState,
    nativeAttachment,
    savedAlt: savedAltValue,
    selectButton
  };
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
  // `insertMarkdownBlockRelative` owns the block-safe separators: an "above"
  // insertion on this paragraph emits exactly two newlines after the image,
  // with no leading separator, so the block stays a parser-owned image block.
  const expectedFragment = `${imageFragmentFor(diagnosticContext.nativeAttachment)}\n\n`;
  if (inserted !== expectedFragment) {
    throw new Error(
      `editor-context-menu-source-media-insertion-invalid:${phase}:` +
      `${JSON.stringify({
        actual: privacySafeTextEvidence(inserted),
        expected: privacySafeTextEvidence(expectedFragment)
      })}`
    );
  }
}

function imageFragmentFor(nativeAttachment) {
  const { filename, url } = nativeAttachment;
  if (!filename || !url) {
    throw new Error('editor-context-menu-source-media-native-attachment-incomplete');
  }
  const alt = defaultImageAltFor(filename);
  return `![${alt}](${url})`;
}

// Mirrors the shipped insertion contract (image-insertion.ts): the attachment
// filename minus its suffix, with `-`/`_` collapsed to single spaces.
function defaultImageAltFor(fileName) {
  return fileName.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ');
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
  const mutationProbe = await startGeneratedExportMutationProbe(page);
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
      await mutationProbe.assertEmpty(`${mode}-${action}`);
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
    await mutationProbe.assertEmpty(`${mode}-cut`);

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
    await mutationProbe.assertEmpty(`${mode}-paste`);

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
    await mutationProbe.assertEmpty(`${mode}-copy-link-address`);

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
    await mutationProbe.assertEmpty(`${mode}-copy-code-block`);
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

  const nativeRead = await nativeWordPressReadOwner(page);
  const openingWrites = [];
  const onRequest = (request) => {
    if ('POST' !== request.method()) return;
    const url = new URL(request.url());
    const decoded = decodePostParameters(request);
    const parameters = decoded.parameters;
    const action = url.searchParams.get('action') ?? parameters.get('action');
    if (url.pathname.endsWith('/wp-json/easymde/v1/preview')) return;
    if (nativeRead(url, parameters, action, decoded)) return;
    openingWrites.push(
      url.pathname.endsWith('/wp-admin/post.php')
        ? 'post-form'
        : url.pathname.endsWith('/wp-admin/admin-ajax.php')
          ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
          : url.pathname.includes('/wp-json/')
            ? 'rest'
            : 'other'
    );
  };
  page.on('request', onRequest);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The reloaded document republishes its own nonce/post identity.
    await nativeRead.refresh();
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

async function readSourceSelection(page) {
  return page.locator('#easymde-source').evaluate((field) => ({
    end: field.selectionEnd,
    start: field.selectionStart,
    value: field.value
  }));
}

/**
 * A state-preserving fast path: when the native source field already owns the
 * exact selection this step wants for the same document, re-navigating the
 * whole document with the keyboard would only re-derive known state. The
 * exact-equality assertion still runs, and any mismatch keeps the existing
 * native navigation intact.
 */
async function nativeSourceSelectionAlreadyExact(page, markdown, start, end) {
  const state = await readSourceSelection(page);
  return state.value === markdown
    && state.start === start
    && state.end === end;
}

/**
 * The number of native caret steps in a string: arrow keys move one grapheme
 * cluster at a time, so a surrogate pair or a combining sequence must not be
 * counted as multiple presses.
 */
function graphemeCount(text) {
  if ('' === text) return 0;
  if ('function' === typeof Intl?.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
      .length;
  }
  return [...text].length;
}

async function moveSourceCaret(page, source, markdown, offset) {
  const state = await readSourceSelection(page);
  // Identity, not just length: a same-length replacement document must still
  // take the full native navigation.
  const sameDocument = state.value === markdown;
  if (sameDocument && state.start === offset && state.end === offset) {
    await expectSourceSelection(page, offset, offset);
    await source.focus();
    return;
  }
  const { column, line } = sourceLineMetrics(markdown, offset);
  const current = sameDocument && state.start === state.end
    ? sourceLineMetrics(markdown, state.start)
    : null;
  if (current && current.line === line && current.column !== column) {
    // The native caret already sits on the target line in the same document.
    // Walking the whole document again would only re-derive a known position,
    // so move along that line in the direction the sign of the delta gives,
    // pressing one key per real grapheme cluster (what an arrow key moves).
    // The exact UTF-16 equality assertion still runs afterwards.
    const forward = offset > state.start;
    const steps = graphemeCount(
      forward ? markdown.slice(state.start, offset) : markdown.slice(offset, state.start)
    );
    await source.focus();
    for (let index = 0; index < steps; index += 1) {
      await page.keyboard.press(forward ? 'ArrowRight' : 'ArrowLeft');
    }
    await expectSourceSelection(page, offset, offset);
    return;
  }
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
  // Column steps are grapheme clusters, not UTF-16 units: an arrow key moves
  // one cluster, so a surrogate pair inside the target line prefix must not
  // cost two presses.
  const columnSteps = graphemeCount(markdown.slice(lineStart, offset));
  for (let index = 0; index < columnSteps; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expectSourceSelection(page, offset, offset);
}

async function selectSourceText(page, source, markdown, value, occurrence = 0) {
  const start = occurrenceOffset(markdown, value, occurrence);
  const end = start + value.length;
  if (await nativeSourceSelectionAlreadyExact(page, markdown, start, end)) {
    await expectSourceSelection(page, start, end);
    await source.focus();
    return;
  }
  await moveSourceCaret(page, source, markdown, start);
  await page.keyboard.down('Shift');
  const steps = graphemeCount(markdown.slice(start, end));
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await expectSourceSelection(page, start, end);
}

async function selectSourceRange(page, source, markdown, start, end) {
  if (!Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || end > markdown.length) {
    throw new Error('source-selection-range-invalid');
  }
  if (await nativeSourceSelectionAlreadyExact(page, markdown, start, end)) {
    await expectSourceSelection(page, start, end);
    await source.focus();
    return;
  }
  await moveSourceCaret(page, source, markdown, start);
  await page.keyboard.down('Shift');
  const steps = graphemeCount(markdown.slice(start, end));
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await expectSourceSelection(page, start, end);
}

async function replaceSourceWithNativeInput(page, sourceEditor, source, value, phase) {
  await sourceEditor.focus();
  await sourceEditor.press('ControlOrMeta+a');
  // Let CodeMirror replace its complete selection in one native transaction.
  // Mutating the virtualized contenteditable DOM only replaces mounted text.
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

async function runVisualActionMatrix(page, visualEditor, source, markdown, occurrence, suffix, group) {
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
    if (category.id !== group) continue;
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
  if ('cross-heading' === group) {
    await runVisualCrossHeadingBold(page, visualEditor, source, markdown, suffix, true);
  }
  if ('image' === group) {
    await runVisualImageScaleAction(page, visualEditor, source, markdown, occurrence, suffix, true);
  }
  if ('table' === group) {
    await runVisualTableAlignmentAction(page, visualEditor, source, markdown, occurrence, suffix, true);
  }
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

async function scrollWindowedVisualToTop(page, visualEditor) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  await canvas.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(
    () => canvas.evaluate((element) => element.scrollTop)
  ).toBe(0);
  // The Windowed owner remounts its window asynchronously after a scroll, so
  // wait until the document head — and with it the first fixture image pair —
  // is the mounted window before a test addresses those images.
  await expect.poll(
    () => visualEditor.evaluate((surface) =>
      Array.from(surface.querySelectorAll('img'))
        .slice(0, 2)
        .map((image) => image.getAttribute('alt'))
    ),
    { message: 'the fixture head should be the mounted window' }
  ).toEqual(['占位测试图片', '风景占位图']);
}

async function visualImagePoint(image) {
  await expect.poll(
    () => image.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      const view = target.ownerDocument.defaultView;
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < (view?.innerHeight ?? 0);
    })
  ).toBe(true);
  return image.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const view = target.ownerDocument.defaultView;
    const candidates = [
      [rect.left + 18, rect.bottom - 24],
      [rect.right - 18, rect.bottom - 24],
      [rect.left + 18, rect.top + 24],
      [rect.right - 18, rect.top + 24],
      [rect.left + 18, rect.top + rect.height / 2]
    ];
    for (const [x, y] of candidates) {
      if (y < 4 || y > (view?.innerHeight ?? 0) - 4) continue;
      // A point that is covered by an open menu or by the immersive header
      // would retarget the wrong element, so only a point whose topmost hit is
      // the image itself is usable.
      if (target.ownerDocument.elementFromPoint(x, y) !== target) continue;
      return {
        block:
          target
            .closest('[data-easymde-visual-block-id]')
            ?.getAttribute('data-easymde-visual-block-id') ?? null,
        label: target.getAttribute('alt'),
        x,
        y
      };
    }
    throw new Error('visual-image-pointer-point-unavailable');
  });
}

async function readVisualTextPoint(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const view = surface.ownerDocument.defaultView;
    const paragraphs = Array.from(surface.querySelectorAll('p')).filter(
      (paragraph) =>
        !paragraph.querySelector('img')
        && (paragraph.textContent ?? '').trim().length > 8
    );
    for (const paragraph of paragraphs) {
      const rect = paragraph.getBoundingClientRect();
      for (const y of [
        rect.top + rect.height / 2,
        rect.top + 6,
        rect.bottom - 6
      ]) {
        // The immersive header owns the top of the viewport.
        if (y < 80 || y > (view?.innerHeight ?? 0) - 8) continue;
        for (let x = rect.left + 24; x < rect.right - 24; x += 40) {
          const hit = surface.ownerDocument.elementFromPoint(x, y);
          if (!hit || !surface.contains(hit) || hit.closest('img')) continue;
          return {
            block:
              hit
                .closest('[data-easymde-visual-block-id]')
                ?.getAttribute('data-easymde-visual-block-id') ?? null,
            x,
            y
          };
        }
      }
    }
    return null;
  });
}

async function clickVisualTextPoint(page, visualEditor) {
  const canvas = page.locator('.easymde-immersive-preview-canvas');
  // The images can fill the visible window; the user would scroll to reach a
  // passage, and no menu is open here, so a bounded scroll is safe.
  for (const delta of [0, 220, -220, 440, -440, 660, -660]) {
    if (0 !== delta) {
      await canvas.evaluate((element, offset) => {
        element.scrollTop += offset;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
      }, delta);
    }
    const point = await readVisualTextPoint(visualEditor);
    if (!point) continue;
    await page.mouse.click(point.x, point.y);
    return point;
  }
  throw new Error('visual-text-pointer-point-unavailable');
}

async function readVisibleBand(page) {
  return page
    .locator('.easymde-immersive-preview-canvas')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.min(rect.bottom, element.ownerDocument.defaultView?.innerHeight ?? 0),
        top: Math.max(rect.top, 0)
      };
    });
}

async function readMountedVisualImages(visualEditor) {
  return visualEditor.evaluate((surface) =>
    Array.from(surface.querySelectorAll('img')).map((image) => ({
      alt: image.getAttribute('alt'),
      block:
        image
          .closest('[data-easymde-visual-block-id]')
          ?.getAttribute('data-easymde-visual-block-id') ?? null
    }))
  );
}

async function readVisualImageTargetState(visualEditor) {
  return visualEditor.evaluate((surface) => {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const images = Array.from(surface.querySelectorAll('img'));
    const blockOf = (node) => {
      const element = node instanceof Element
        ? node
        : node?.parentElement ?? null;
      return element
        ?.closest('[data-easymde-visual-block-id]')
        ?.getAttribute('data-easymde-visual-block-id') ?? null;
    };
    const marker = surface.ownerDocument.querySelector(
      '.easymde-visual-image-selection-feedback'
    );
    const markerRect = marker?.getBoundingClientRect() ?? null;
    const markerHit = markerRect
      ? surface.ownerDocument.elementFromPoint(
          markerRect.left + markerRect.width / 2,
          markerRect.top + markerRect.height / 2
        )
      : null;
    return {
      anchorBlock: blockOf(selection?.anchorNode ?? null),
      collapsed: Boolean(selection?.isCollapsed),
      imageBlocks: images.map((image) => blockOf(image)),
      markerBlock: markerHit?.closest?.('[data-easymde-visual-block-id]')
        ?.getAttribute('data-easymde-visual-block-id') ?? null,
      markerRect: markerRect
        ? {
            height: Math.round(markerRect.height),
            left: Math.round(markerRect.left),
            top: Math.round(markerRect.top),
            width: Math.round(markerRect.width)
          }
        : null,
      markerTop: markerRect ? Math.round(markerRect.top) : null,
      overlaps: range ? images.map((image) => range.intersectsNode(image)) : [],
      rangeCount: selection?.rangeCount ?? 0
    };
  });
}

async function readMenuRect(page) {
  const menu = page.locator(menuSelector);
  if (0 === await menu.count()) return null;
  return menu.first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width)
    };
  });
}

async function revealWindowedVisualBlock(page, blockId) {
  await page
    .locator('.easymde-immersive-preview-canvas')
    .evaluate((canvas, id) => {
      const block = canvas.querySelector(
        `[data-easymde-visual-block-id="${id}"]`
      );
      if (!(block instanceof HTMLElement)) {
        throw new Error(`windowed-visual-block-unmounted:${id}`);
      }
      const offset =
        block.getBoundingClientRect().top - canvas.getBoundingClientRect().top;
      canvas.scrollTop += offset - 12;
      canvas.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, blockId);
}

async function openVisualImageMenu(page, image) {
  // The point is computed immediately before the click and never scrolls the
  // surface: an intervening scroll would dismiss an open menu, and a window
  // commit would move the image out from under stored coordinates while the
  // click stays where it was.
  const point = await visualImagePoint(image);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toHaveCount(1);
  await expect(rootMenu(page)).toBeVisible();
  return point;
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
      items: { 'copy-link-address': 'enabled' },
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
      items: { 'copy-link-address': 'enabled' },
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
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled'
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
        'insert-paragraph-above-generated': 'enabled',
        'insert-paragraph-below-generated': 'enabled'
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

const sourceMediaReadOnlyCode = 'media-picker-document-read-only';

/**
 * Opens the real formatted Source context-media insertion - context menu ->
 * Insert -> `insert-image-above` -> real WordPress picker - and completes the
 * real own upload, Media Library selection and native Alt save while the field
 * is still editable. The caller flips exactly one authoritative native flag and
 * clicks the real native confirmation itself, so the mutation-time race stays
 * inside the test body where the independent monitor annotates its phase.
 *
 * Returns the picker/preparation evidence plus the exact pre-flag source,
 * selection and the `finally`-safe permission restore closure.
 */
async function beginSourceMediaPermissionLoss(
  page,
  { flag, markdown, source, sourceEditor }
) {
  if ('readOnly' !== flag && 'disabled' !== flag) {
    throw new Error(`editor-context-menu-source-media-permission-flag-unsupported:${flag}`);
  }
  const otherFlag = 'readOnly' === flag ? 'disabled' : 'readOnly';
  const selectedText = '普通文本';
  const canaryMarkdown = replaceVisualSourceOccurrence(
    markdown,
    selectedText,
    `**${selectedText}**`
  );

  // 1. Independently reversible history canary through the real native Source
  // context Bold action: Bold, native Undo, native Redo, each exact.
  await selectSourceText(page, sourceEditor, markdown, selectedText);
  await openSourceMenu(page, sourceEditor);
  await expectMenuItemState(page, 'bold', 'enabled');
  await rootItem(page, 'bold').click();
  await waitForSourceExactValue(source, canaryMarkdown, `${flag}-canary-bold`);
  await sourceEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${flag}-canary-undo`);
  await sourceEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, canaryMarkdown, `${flag}-canary-redo`);
  const canarySelection = await readSourceSelection(page);
  if (canarySelection.value !== canaryMarkdown
    || !Number.isInteger(canarySelection.start)
    || !Number.isInteger(canarySelection.end)
    || canarySelection.start < 0
    || canarySelection.end < canarySelection.start
    || canarySelection.end > canaryMarkdown.length) {
    throw new Error(
      `editor-context-menu-source-media-canary-invalid:${flag}:` +
      `${JSON.stringify({
        end: canarySelection.end,
        start: canarySelection.start,
        valueLength: canarySelection.value.length
      })}`
    );
  }

  // Expected-negative contract for the independent strict phase gate: exactly
  // one stable `media-picker-document-read-only` error event, emitted between
  // the real native confirmation (step 5) and its asserted terminal rejection,
  // with no other code and no new failure popup during success/recovery. The
  // caller (inside the test body, where the monitor injects its phase) owns the
  // flag flip and the terminal assertion; this helper only drives the real
  // native flow and never suppresses evidence.
  let originalFlags = null;
  let restored = false;
  const restorePermission = async () => {
    if (restored || !originalFlags) return;
    await source.evaluate((field, flags) => {
      field.readOnly = flags.readOnly;
      field.disabled = flags.disabled;
    }, originalFlags);
    const current = await source.evaluate((field) => ({
      disabled: field.disabled,
      readOnly: field.readOnly
    }));
    if (current.readOnly !== originalFlags.readOnly
      || current.disabled !== originalFlags.disabled) {
      throw new Error(
        `editor-context-menu-source-media-permission-restore-failed:${flag}:` +
        `${JSON.stringify({ actual: current, expected: originalFlags })}`
      );
    }
    // Only a verified restoration retires the obligation, so a failed attempt
    // remains retryable by the caller's own `finally`.
    restored = true;
  };

  // 2. Real Source context menu -> Insert -> insert-image-above, i.e. Root's
  // insertionSelection + formatInsertion branch, not the toolbar Media path.
  const picker = await openSourceInsertImagePicker(page, sourceEditor, canaryMarkdown);
  await expect(picker.mediaModal).toBeVisible();
  originalFlags = await source.evaluate((field) => ({
    disabled: field.disabled,
    readOnly: field.readOnly
  }));
  if (originalFlags.readOnly || originalFlags.disabled) {
    throw new Error(
      `editor-context-menu-source-media-permission-initially-closed:${flag}`
    );
  }

  // 3. Real own upload, Media Library selection, native Attachment Details
  // read and native Alt save, all while the field is still editable.
  const prepared = await uploadAndPrepareSourceImage(
    page,
    picker.mediaFrame,
    picker.mediaModal
  );
  if (!Number.isSafeInteger(prepared.attachmentId) || prepared.attachmentId <= 0) {
    throw new Error(`editor-context-menu-source-media-own-attachment-missing:${flag}`);
  }
  await expect(picker.dialog).toBeVisible();
  await expect(prepared.selectButton).toBeEnabled();
  await assertSourceExactValue(source, canaryMarkdown, `${flag}-before-confirmation`);
  const beforeFlag = await readSourceSelection(page);
  if (beforeFlag.value !== canaryMarkdown) {
    throw new Error(`editor-context-menu-source-media-source-changed:${flag}-before-flag`);
  }

  // 4. Hand the mutation-time race to the caller: it flips exactly one
  // authoritative native flag, clicks the real native confirmation and
  // asserts the single expected rejection inside the monitored phase.
  const verifyPermission = async () => {
    const permission = await source.evaluate((field) => ({
      disabled: field.disabled,
      readOnly: field.readOnly,
      selectionEnd: field.selectionEnd,
      selectionStart: field.selectionStart,
      value: field.value
    }));
    if (true !== permission[flag] || false !== permission[otherFlag]) {
      throw new Error(
        `editor-context-menu-source-media-permission-flags-invalid:${flag}:` +
        `${JSON.stringify({ disabled: permission.disabled, readOnly: permission.readOnly })}`
      );
    }
    if (permission.value !== canaryMarkdown) {
      throw new Error(`editor-context-menu-source-media-source-changed:${flag}-at-flag`);
    }
    if (permission.selectionStart !== beforeFlag.start
      || permission.selectionEnd !== beforeFlag.end) {
      throw new Error(
        `editor-context-menu-source-media-selection-moved:${flag}-at-flag:` +
        `${JSON.stringify({
          actual: { end: permission.selectionEnd, start: permission.selectionStart },
          expected: { end: beforeFlag.end, start: beforeFlag.start }
        })}`
      );
    }
  };
  return {
    beforeFlag,
    canaryMarkdown,
    otherFlag,
    picker,
    prepared,
    restorePermission,
    verifyPermission
  };
}

/**
 * The post-rejection half of a formatted Source context-media permission-loss
 * case: unchanged canonical source and native selection, no article write, no
 * insertion before or after restoration, a genuine subsequent native character
 * with its accepted Preview, and untouched native history.
 */
async function completeSourceMediaPermissionLoss(
  page,
  {
    beforeFlag,
    canaryMarkdown,
    consoleProbe,
    flag,
    markdown,
    mutationProbe,
    preview,
    prepared,
    source,
    sourceEditor,
    restorePermission
  }
) {
  const insertedFragment = imageFragmentFor(prepared.nativeAttachment);

  // 5. Before permission returns: byte-identical canonical source and exactly
  // the same native selection as before confirmation, no article write and no
  // insertion of any kind. Checking the image DOM alone is insufficient.
  await assertSourceExactValue(source, canaryMarkdown, `${flag}-rejected-source`);
  const afterRejection = await readSourceSelection(page);
  if (afterRejection.value !== canaryMarkdown
    || afterRejection.start !== beforeFlag.start
    || afterRejection.end !== beforeFlag.end) {
    throw new Error(
      `editor-context-menu-source-media-rejected-state-drift:${flag}:` +
      `${JSON.stringify({
        actual: { end: afterRejection.end, start: afterRejection.start },
        expected: { end: beforeFlag.end, start: beforeFlag.start }
      })}`
    );
  }
  mutationProbe.assertNoArticleWrites(`${flag}-rejected`);
  if ((await source.inputValue()).includes(insertedFragment)) {
    throw new Error(
      `editor-context-menu-source-media-unexpected-insertion:${flag}-before-restore`
    );
  }

  // 6. Restore the exact original flags, settle, and re-prove the state: the
  // rejected media return must not defer an insertion past restoration.
  await restorePermission();
  await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await assertSourceExactValue(source, canaryMarkdown, `${flag}-after-restore`);
  const afterRestore = await readSourceSelection(page);
  if (afterRestore.value !== canaryMarkdown
    || afterRestore.start !== beforeFlag.start
    || afterRestore.end !== beforeFlag.end) {
    throw new Error(
      `editor-context-menu-source-media-no-restored-state:${flag}`
    );
  }
  await waitForSourcePreviewAccepted(preview, `${flag}-after-restore`);
  if ((await source.inputValue()).includes(insertedFragment)) {
    throw new Error(
      `editor-context-menu-source-media-unexpected-insertion:${flag}-after-restore`
    );
  }
  mutationProbe.assertNoArticleWrites(`${flag}-after-restore`);

  // 7. A genuine subsequent native Source character pumps the ordinary owner:
  // accepted Preview for it, then native Undo back to the canary document.
  const acceptanceBefore = await readSourcePreviewAcceptanceState(preview);
  await sourceEditor.focus();
  await sourceEditor.press('ControlOrMeta+End');
  await page.keyboard.type('Z');
  const typedMarkdown = `${canaryMarkdown}Z`;
  await waitForSourceExactValue(source, typedMarkdown, `${flag}-typed`);
  await waitForSourcePreviewAccepted(preview, `${flag}-typed`, acceptanceBefore.domHash);
  await sourceEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, canaryMarkdown, `${flag}-typed-undo`);
  if ((await source.inputValue()).includes(insertedFragment)) {
    throw new Error(
      `editor-context-menu-source-media-unexpected-insertion:${flag}-after-input`
    );
  }

  // 8. Native history over the surviving canonical transactions: Undo, Redo,
  // Undo. Every step lands on an exact real document state through the native
  // keyboard path - no direct fixture assignment stands in for a keyboard undo
  // - so the failed media return provably added no transaction and consumed
  // none of the canary pair.
  await sourceEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${flag}-history-undo`);
  await sourceEditor.press('ControlOrMeta+Shift+z');
  await waitForSourceExactValue(source, canaryMarkdown, `${flag}-history-redo`);
  await sourceEditor.press('ControlOrMeta+z');
  await waitForSourceExactValue(source, markdown, `${flag}-history-undo-final`);
  const finalCodes = consoleProbe.codes();
  if (1 !== finalCodes.length || sourceMediaReadOnlyCode !== finalCodes[0]) {
    throw new Error(
      `editor-context-menu-source-media-rejection-recurred:${flag}:` +
      `${JSON.stringify({ codes: finalCodes })}`
    );
  }
  // No transaction from the rejected return may materialise anywhere in the
  // history cycle, and the field stays genuinely editable when flags are clear.
  await assertSourceExactValue(source, markdown, `${flag}-complete`);
  if ((await source.inputValue()).includes(insertedFragment)) {
    throw new Error(
      `editor-context-menu-source-media-unexpected-insertion:${flag}-after-history`
    );
  }
  await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
  mutationProbe.assertNoArticleWrites(`${flag}-complete`);
}

test.describe('Editor context menu production surfaces', () => {
  test('moves the native Source caret relative and through the fallback to an exact UTF-16 offset', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const line = '普通文本、**粗体文本**、*斜体文本*、***粗斜体文本***。';
    const lineStart = occurrenceOffset(markdown, line);
    const target = lineStart + occurrenceOffset(line, '粗斜体文本');
    const assertCollapsedCaret = async (offset, phase) => {
      const state = await readSourceSelection(page);
      if (state.start !== offset || state.end !== offset) {
        throw new Error(
          `caret-not-collapsed:${phase}:${JSON.stringify({
            end: state.end,
            start: state.start,
            expected: offset
          })}`
        );
      }
    };

    // A non-collapsed selection first forces the document-start fallback, which
    // establishes a real collapsed caret on the target line.
    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await moveSourceCaret(page, sourceEditor, markdown, lineStart + 1);
    await assertCollapsedCaret(lineStart + 1, 'fallback-established');
    await assertSourceExactValue(source, markdown, 'caret-fallback-exact');

    // Forward relative step: the caret is already collapsed on this line after
    // the target, so this must move forward rather than do nothing.
    await moveSourceCaret(page, sourceEditor, markdown, target);
    await expectSourceSelection(page, target, target);
    await assertSourceExactValue(source, markdown, 'caret-forward-relative-exact');

    // Backward relative step from that same collapsed caret.
    await moveSourceCaret(page, sourceEditor, markdown, lineStart + 1);
    await expectSourceSelection(page, lineStart + 1, lineStart + 1);
    await assertSourceExactValue(source, markdown, 'caret-backward-relative-exact');

    // A surrogate pair is one native step in both paths. This target is on a
    // different line, so the fallback walks the target line prefix: two
    // surrogate pairs before the emoji must cost two presses, not four.
    const emojiLine = '支持 Emoji：😀 😎 🎉';
    const emojiStart = occurrenceOffset(markdown, emojiLine);
    const emojiTarget = emojiStart + occurrenceOffset(emojiLine, '🎉');
    await moveSourceCaret(page, sourceEditor, markdown, emojiTarget);
    await expectSourceSelection(page, emojiTarget, emojiTarget);
    await assertSourceExactValue(source, markdown, 'caret-fallback-emoji-exact');

    // The same unicode prefix reached from a collapsed caret on that line
    // exercises the relative branch with surrogate pairs.
    await moveSourceCaret(page, sourceEditor, markdown, emojiStart + 1);
    await assertCollapsedCaret(emojiStart + 1, 'emoji-line-caret');
    await moveSourceCaret(page, sourceEditor, markdown, emojiTarget);
    await expectSourceSelection(page, emojiTarget, emojiTarget);
    await assertSourceExactValue(source, markdown, 'caret-relative-emoji-exact');
  });

  test('opens the generic Source menu when the caret is after the final rendered block', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, sourceEditor } = await loadCanonicalFixture(page);

    await sourceEditor.focus();
    await sourceEditor.press(sourceLineEndKey);
    await sourceEditor.press('ControlOrMeta+End');
    await openSourceMenu(page, sourceEditor);

    await expect(rootItem(page, 'copy')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(rootItem(page, 'insert')).toHaveAttribute(
      'aria-disabled',
      'false'
    );
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  });

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

    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-image-reset');
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

    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-link-reset');
    await expect(source).toHaveValue(markdown);
    await selectSourceText(page, sourceEditor, markdown, '[OpenAI 官网](https://openai.com)');
    await openSourceMenu(page, sourceEditor);
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
    const mutationProbe = await startSourceMediaMutationProbe(page);
    try {
      const cancelPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      await cancelPicker.mediaModal.locator('.media-modal-close').click();
      await expect(cancelPicker.dialog).toBeHidden();
      await assertSourceExactValue(source, markdown, 'source-media-cancel');
      mutationProbe.assertNoArticleWrites('source-media-cancel');

      const insertPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      const selectionEvidence = await uploadAndPrepareSourceImage(
        page,
        insertPicker.mediaFrame,
        insertPicker.mediaModal
      );
      await selectionEvidence.selectButton.click();
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
          nativeAttachment: selectionEvidence.nativeAttachment,
          nativeAltBeforeSave: selectionEvidence.savedAlt === syntheticMediaAlt,
          uploadCount: mutationProbe.uploadCount()
        }
      );
      if (selectionEvidence.savedAlt !== syntheticMediaAlt) {
        throw new Error('editor-context-menu-source-media-alt-save-not-applied');
      }
      const savedAltCount = mutationProbe.mediaActionCounts().get('save-attachment') ?? 0;
      if (savedAltCount !== 1) {
        throw new Error(
          `editor-context-menu-source-media-alt-save-count:${savedAltCount}`
        );
      }
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

  test('rejects formatted Source context media insertion after readOnly permission loss without changing history', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = await startSourceMediaMutationProbe(page);
    const flag = 'readOnly';
    let loss = null;
    let primaryError = null;
    let bodyFailed = false;
    try {
      loss = await beginSourceMediaPermissionLoss(page, {
        flag,
        markdown,
        source,
        sourceEditor
      });
      await expect(loss.picker.dialog).toBeVisible();
      await expect(loss.prepared.selectButton).toBeEnabled();
      // Only now, immediately before the real native confirmation, does the
      // authoritative field lose its editability; the menu and picker had to
      // open while it was still editable for this to be the mutation race.
      await source.evaluate((field, key) => {
        field[key] = true;
      }, flag);
      await loss.verifyPermission();
      if (consoleProbe.codes().includes(sourceMediaReadOnlyCode)) {
        throw new Error(`editor-context-menu-source-media-rejection-early:${flag}`);
      }
      await loss.prepared.selectButton.click();
      await expect(loss.picker.dialog).toBeHidden();
      const failureMessage = await page.evaluate(() => (
        window.EasyMDEEditorRootBootstrap?.labels?.mediaPickerFailure ?? ''
      ));
      if (!failureMessage) {
        throw new Error(`editor-context-menu-source-media-failure-label-missing:${flag}`);
      }
      const failureAlert = page.locator(
        '.easymde-editor-message-alert-host [role="alert"]'
      ).first();
      await expect(failureAlert).toBeVisible();
      await expect(failureAlert).toContainText(failureMessage);
      await expect.poll(
        () => consoleProbe.codes().filter(
          (code) => code === 'media-picker-document-read-only'
        ).length,
        { message: `exactly one media-picker-document-read-only rejection: ${flag}` }
      ).toBe(1);
      // Event-counted equality: one event, this code, nothing else.
      const rejectionCodes = consoleProbe.codes();
      if (1 !== rejectionCodes.length
        || sourceMediaReadOnlyCode !== rejectionCodes[0]) {
        throw new Error(
          `editor-context-menu-source-media-rejection-codes:${flag}:` +
          `${JSON.stringify({ codes: rejectionCodes })}`
        );
      }
      await completeSourceMediaPermissionLoss(page, {
        ...loss,
        consoleProbe,
        flag,
        markdown,
        mutationProbe,
        preview,
        source,
        sourceEditor
      });
    } catch (error) {
      bodyFailed = true;
      primaryError = error;
    } finally {
      // Restoring the authoritative flags must never be skipped, including on
      // failure; the probes stay scoped to this test and no attachment is
      // deleted here. Every cleanup step is attempted even when an earlier one
      // throws, and no failure - primary or cleanup - is ever discarded.
      const failures = bodyFailed ? [primaryError] : [];
      try {
        await loss?.restorePermission();
      } catch (error) {
        failures.push(error);
      }
      try {
        consoleProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        mutationProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      const cleanupFailures = bodyFailed ? failures.slice(1) : failures;
      if (bodyFailed && cleanupFailures.length > 0) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-body-and-cleanup-failed:readOnly:${cleanupFailures.length}`
        );
      }
      if (bodyFailed) throw primaryError;
      if (cleanupFailures.length > 1) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-cleanup-failed:readOnly:${cleanupFailures.length}`
        );
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
    }
  });

  test('rejects formatted Source context media insertion after disabled permission loss without changing history', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = await startSourceMediaMutationProbe(page);
    const flag = 'disabled';
    let loss = null;
    let primaryError = null;
    let bodyFailed = false;
    try {
      loss = await beginSourceMediaPermissionLoss(page, {
        flag,
        markdown,
        source,
        sourceEditor
      });
      await expect(loss.picker.dialog).toBeVisible();
      await expect(loss.prepared.selectButton).toBeEnabled();
      // The same real mutation-time boundary as the readOnly case, exercised
      // through the other authoritative native flag.
      await source.evaluate((field, key) => {
        field[key] = true;
      }, flag);
      await loss.verifyPermission();
      if (consoleProbe.codes().includes(sourceMediaReadOnlyCode)) {
        throw new Error(`editor-context-menu-source-media-rejection-early:${flag}`);
      }
      await loss.prepared.selectButton.click();
      await expect(loss.picker.dialog).toBeHidden();
      const failureMessage = await page.evaluate(() => (
        window.EasyMDEEditorRootBootstrap?.labels?.mediaPickerFailure ?? ''
      ));
      if (!failureMessage) {
        throw new Error(`editor-context-menu-source-media-failure-label-missing:${flag}`);
      }
      const failureAlert = page.locator(
        '.easymde-editor-message-alert-host [role="alert"]'
      ).first();
      await expect(failureAlert).toBeVisible();
      await expect(failureAlert).toContainText(failureMessage);
      await expect.poll(
        () => consoleProbe.codes().filter(
          (code) => code === 'media-picker-document-read-only'
        ).length,
        { message: `exactly one media-picker-document-read-only rejection: ${flag}` }
      ).toBe(1);
      const rejectionCodes = consoleProbe.codes();
      if (1 !== rejectionCodes.length
        || sourceMediaReadOnlyCode !== rejectionCodes[0]) {
        throw new Error(
          `editor-context-menu-source-media-rejection-codes:${flag}:` +
          `${JSON.stringify({ codes: rejectionCodes })}`
        );
      }
      await completeSourceMediaPermissionLoss(page, {
        ...loss,
        consoleProbe,
        flag,
        markdown,
        mutationProbe,
        preview,
        source,
        sourceEditor
      });
    } catch (error) {
      bodyFailed = true;
      primaryError = error;
    } finally {
      // Same contract as the readOnly case: every cleanup step is attempted
      // even when an earlier one throws, and no failure is ever discarded.
      const failures = bodyFailed ? [primaryError] : [];
      try {
        await loss?.restorePermission();
      } catch (error) {
        failures.push(error);
      }
      try {
        consoleProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        mutationProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      const cleanupFailures = bodyFailed ? failures.slice(1) : failures;
      if (bodyFailed && cleanupFailures.length > 0) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-body-and-cleanup-failed:disabled:${cleanupFailures.length}`
        );
      }
      if (bodyFailed) throw primaryError;
      if (cleanupFailures.length > 1) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-cleanup-failed:disabled:${cleanupFailures.length}`
        );
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
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
    const mutationProbe = await startGeneratedExportMutationProbe(page);
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
      await mutationProbe.assertEmpty('copy-code-content');
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
    const mutationProbe = await startGeneratedExportMutationProbe(page);
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
      await mutationProbe.assertEmpty(`${mode}-${linkCase.id}`);
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
    const mutationProbe = await startGeneratedExportMutationProbe(page);
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
      await mutationProbe.assertEmpty('code-indent');
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

  test('keeps the real mutation probe behind the decoded-body guard for unreadable and file-bearing requests', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, markdown, 'probe-guard-saved');
    const identity = await readNativeWordPressIdentity(page);
    if (!identity.postId || '0' === identity.postId) {
      throw new Error('probe-guard-identity-unavailable');
    }

    // Integration path: these requests go through the REAL probe wrapper the
    // production assertions use, not the classifier called directly. A
    // legitimate multipart lock release must be exempt, while an unreadable
    // body and a file-bearing body carrying the same Action must be writes.
    const probe = await startGeneratedExportMutationProbe(page);
    const lockFields = [
      ['action', 'wp-remove-post-lock'],
      ['_wpnonce', await page.locator('#_wpnonce').inputValue()],
      ['post_ID', identity.postId],
      ['active_post_lock', await page.locator('#active_post_lock').inputValue()]
    ];
    const multipartBody = (entries, extraPart = '') => {
      let body = '';
      for (const [name, value] of entries) {
        body += `--B\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      }
      return `${body}${extraPart}--B--\r\n`;
    };
    const sendBody = async (body, contentType) => page.evaluate(async ({ payload, type }) => {
      const response = await fetch('/wp-admin/admin-ajax.php', {
        body: payload,
        headers: { 'content-type': type },
        method: 'POST'
      });
      return response.status;
    }, { payload: body, type: contentType });
    // Fulfilled locally: the point is what the probe observes, and these bodies
    // must not release a real lock or reach a real Action handler.
    await page.route('**/wp-admin/admin-ajax.php', (route) => route.fulfill({
      body: '{"success":true,"data":{}}',
      contentType: 'application/json',
      status: 200
    }));

    const filePart = '--B\r\nContent-Disposition: form-data; name="upload"; '
      + 'filename="x.png"\r\nContent-Type: image/png\r\n\r\nBINARY\r\n';
    try {
      // 1. real shape -> exempt
      await sendBody(
        multipartBody(lockFields),
        'multipart/form-data; boundary=B'
      );
      await probe.assertEmpty('probe-guard-multipart-own');

      // 2. unreadable multipart -> write; the Action cannot be read, so it is
      // recorded as an unknown owner rather than exempted by its URL.
      await sendBody('not-a-multipart-body', 'multipart/form-data; boundary=B');
      const afterBroken = probe.writes();
      if (!afterBroken.includes('admin-ajax:unknown')) {
        throw new Error(
          `probe-guard-unreadable-not-recorded:${JSON.stringify(afterBroken)}`
        );
      }

      // 3. file-bearing multipart -> write even though the Action decodes.
      await sendBody(
        multipartBody(lockFields, filePart),
        'multipart/form-data; boundary=B'
      );
      const afterFile = probe.writes();
      if (!afterFile.includes('admin-ajax:wp-remove-post-lock')) {
        throw new Error(
          `probe-guard-file-part-not-recorded:${JSON.stringify(afterFile)}`
        );
      }

      // 4. the same benign fields urlencoded stay exempt through the probe.
      const beforeUrlencoded = probe.writes().length;
      await sendBody(
        new URLSearchParams(lockFields).toString(),
        'application/x-www-form-urlencoded; charset=UTF-8'
      );
      if (probe.writes().length !== beforeUrlencoded) {
        throw new Error(
          `probe-guard-urlencoded-recorded:${JSON.stringify(probe.writes())}`
        );
      }
    } finally {
      probe.stop();
      await page.unroute('**/wp-admin/admin-ajax.php');
    }
    await assertSourceExactValue(source, markdown, 'probe-guard-complete');
  });

  test('decodes the real multipart Core lock release and denies foreign, duplicate, and autosave variants', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    // A saved draft is what gives Core a post id and an active post lock, the
    // two fields its pagehide release beacon actually reads.
    const { markdown, source } = await loadCanonicalFixture(page);
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, markdown, 'multipart-lock-saved');

    const identity = await readNativeWordPressIdentity(page);
    const activeLock = await page.locator('#active_post_lock').inputValue();
    const nonce = await page.locator('#_wpnonce').inputValue();
    if (!identity.postId || '0' === identity.postId || !activeLock || !nonce) {
      throw new Error('multipart-lock-identity-unavailable');
    }

    // These are the exact fields wp-admin/js/post.js appends to its
    // pagehide sendBeacon FormData.
    const fields = [
      ['action', 'wp-remove-post-lock'],
      ['_wpnonce', nonce],
      ['post_ID', identity.postId],
      ['active_post_lock', activeLock]
    ];
    const multipartRequest = (entries) => {
      let body = '';
      for (const [name, value] of entries) {
        body += `--B\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      }
      body += '--B--\r\n';
      return {
        headers: () => ({ 'content-type': 'multipart/form-data; boundary=B' }),
        postData: () => body
      };
    };
    const classifyMultipart = (entries) => {
      const decoded = decodePostParameters(multipartRequest(entries));
      return {
        decoded,
        accepted: classifyNativeWordPressRead(
          identity,
          new URL('/wp-admin/admin-ajax.php', page.url()),
          decoded.parameters,
          decoded.parameters.get('action'),
          decoded
        )
      };
    };

    const own = classifyMultipart(fields);
    if (own.decoded.unsupported || own.decoded.hasFilePart) {
      throw new Error(`multipart-lock-decode-invalid:${JSON.stringify({
        hasFilePart: own.decoded.hasFilePart,
        unsupported: own.decoded.unsupported
      })}`);
    }
    // The real shape must decode to the real scalars, not merely be exempt.
    if (JSON.stringify([...own.decoded.parameters.entries()]) !== JSON.stringify(fields)) {
      throw new Error(
        `multipart-lock-fields-mismatch:${JSON.stringify(
          [...own.decoded.parameters.entries()]
        )}`
      );
    }
    if (!own.accepted) {
      throw new Error('multipart-lock-own-post-denied');
    }

    const foreignId = String(Number(identity.postId) + 1000);
    const replaceField = (name, value) => fields.map(([key, current]) =>
      (key === name ? [key, value] : [key, current]));
    const variants = {
      // PHP keeps the last duplicate, so any repeated field is not this read.
      'duplicate-current-post-id': [...fields, ['post_ID', identity.postId]],
      'duplicate-current-then-foreign': [...fields, ['post_ID', foreignId]],
      'foreign-post': replaceField('post_ID', foreignId),
      // An autosave owner has no business in a lock release.
      'unknown-owner-field': [...fields, ['data[wp_autosave][post_id]', identity.postId]],
      'unknown-scalar-field': [...fields, ['_easymde_markdown', 'x']]
    };
    for (const [name, entries] of Object.entries(variants)) {
      const result = classifyMultipart(entries);
      if (result.accepted) {
        throw new Error(`multipart-lock-accepted-variant:${name}`);
      }
    }

    // A part carrying a file is never this read.
    let fileBody = '';
    for (const [partName, value] of fields) {
      fileBody += `--B\r\nContent-Disposition: form-data; name="${partName}"\r\n\r\n${value}\r\n`;
    }
    fileBody += '--B\r\nContent-Disposition: form-data; name="upload"; filename="x.png"'
      + '\r\nContent-Type: image/png\r\n\r\nBINARY\r\n--B--\r\n';
    const fileDecoded = decodePostParameters({
      headers: () => ({ 'content-type': 'multipart/form-data; boundary=B' }),
      postData: () => fileBody
    });
    if (!fileDecoded.hasFilePart) {
      throw new Error('multipart-lock-file-part-undetected');
    }
    if (classifyNativeWordPressRead(
      identity,
      new URL('/wp-admin/admin-ajax.php', page.url()),
      fileDecoded.parameters,
      fileDecoded.parameters.get('action'),
      fileDecoded
    )) {
      throw new Error('multipart-lock-accepted-file-part');
    }

    // An unreadable multipart body is an explicit failure, never a silent
    // exemption by action name.
    const broken = decodePostParameters({
      headers: () => ({ 'content-type': 'multipart/form-data; boundary=Z' }),
      postData: () => 'not-a-multipart-body'
    });
    if (!broken.unsupported) {
      throw new Error('multipart-lock-broken-body-accepted');
    }

    // The real defect: the production probe is attached before a reload, so
    // Core's pagehide multipart lock release must not be recorded as a write.
    const beacons = [];
    const reloadProbe = await startGeneratedExportMutationProbe(page);
    const onRequest = (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return;
      const decoded = decodePostParameters(request);
      const action = decoded.parameters.get('action');
      if ('wp-remove-post-lock' !== action) return;
      beacons.push({
        accepted: classifyNativeWordPressRead(
          identity,
          url,
          decoded.parameters,
          action,
          decoded
        ),
        contentType: request.headers()['content-type'] ?? ''
      });
    };
    page.on('request', onRequest);
    try {
      await page.reload({ waitUntil: 'load', timeout: 15_000 });
      await expect(page.locator('#easymde-editor')).toBeVisible();
    } finally {
      page.off('request', onRequest);
    }
    try {
      const recorded = reloadProbe.writes();
      if (recorded.length > 0) {
        throw new Error(
          `multipart-lock-release-recorded-as-write:${JSON.stringify(recorded)}`
        );
      }
    } finally {
      reloadProbe.stop();
    }
    // Core sends this release on pagehide through sendBeacon, so at least one
    // real multipart lock release must have been observed and accepted.
    if (0 === beacons.length) {
      throw new Error('multipart-lock-beacon-not-observed');
    }
    const denied = beacons.filter((beacon) => !beacon.accepted);
    if (denied.length > 0) {
      throw new Error(
        `multipart-lock-beacon-denied:${JSON.stringify(denied.map((beacon) => beacon.contentType))}`
      );
    }
    if (!beacons.some((beacon) => beacon.contentType.includes('multipart/form-data'))) {
      throw new Error(
        `multipart-lock-beacon-not-multipart:${JSON.stringify(
          beacons.map((beacon) => beacon.contentType)
        )}`
      );
    }
  });

  test('classifies real Core heartbeat reads and denies real autosave, unknown owners, and foreign posts', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    // Persist the disposable draft once through the real native save so the
    // page publishes a real post identity and Core lock maintenance engages;
    // a post-new.php screen has neither.
    const savePost = page.locator('#save-post');
    await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await assertSourceExactValue(source, markdown, 'native-read-probe-saved');
    const identity = await readNativeWordPressIdentity(page);
    if (!identity.postId || '0' === identity.postId) {
      throw new Error('native-read-identity-missing');
    }
    const heartbeatRequests = [];
    const onRequest = (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/wp-admin/admin-ajax.php')) return;
      const decoded = decodePostParameters(request);
      const parameters = decoded.parameters;
      if ('heartbeat' !== (url.searchParams.get('action') ?? parameters.get('action'))) return;
      heartbeatRequests.push([...parameters.entries()]);
    };
    page.on('request', onRequest);
    const classify = (entries) => {
      const parameters = new URLSearchParams(entries);
      return classifyNativeWordPressRead(
        identity,
        new URL('/wp-admin/admin-ajax.php', page.url()),
        parameters,
        parameters.get('action')
      );
    };
    const hasOwner = (entries, owner) =>
      entries.some(([key]) => key.startsWith(`data[${owner}]`));
    try {
      await page.evaluate(() => {
        if (!window.jQuery || !window.wp?.autosave?.server?.triggerSave) {
          throw new Error('native-autosave-owner-unavailable');
        }
        window.__easymdeCoreAutosaveProbe = { completed: 0, success: false };
        window.jQuery(document).on('after-autosave.easymdeClassifierProbe', (_event, data) => {
          window.__easymdeCoreAutosaveProbe.completed += 1;
          window.__easymdeCoreAutosaveProbe.success = data?.success === true;
        });
      });
      // A real Core maintenance heartbeat must be exempt: lock refresh,
      // auth check, and nonce refresh all address the current post.
      await page.evaluate(() => window.wp.heartbeat.connectNow());
      await expect.poll(() => heartbeatRequests.length).toBeGreaterThan(0);
      const maintenance = heartbeatRequests
        .filter((entries) => entries.some(([key]) => key.startsWith('data[')))
        .at(-1);
      if (!maintenance) throw new Error('native-read-real-heartbeat-payload-missing');
      if (!maintenance.some(([key]) => '_nonce' === key)) {
        throw new Error('native-read-real-heartbeat-nonce-missing');
      }
      if (!classify(maintenance)) {
        throw new Error(
          `native-read-real-heartbeat-rejected:${JSON.stringify(
            maintenance.map(([key]) => key)
          )}`
        );
      }

      // Derived from that exact real request: only the named mutations may
      // flip it to a write.
      const withoutNonce = maintenance.filter(([key]) => '_nonce' !== key);
      if (classify(withoutNonce)) {
        throw new Error('native-read-accepted-heartbeat-without-nonce');
      }
      const otherScreen = maintenance.map(
        ([key, value]) => ('screen_id' === key ? [key, 'dashboard'] : [key, value])
      );
      if (classify(otherScreen)) {
        throw new Error('native-read-accepted-other-screen-heartbeat');
      }
      const unknownOwner = [...maintenance, ['data[easymde_extension][post_id]', identity.postId]];
      if (classify(unknownOwner)) {
        throw new Error('native-read-accepted-unknown-owner');
      }
      const malformedOwners = {
        'missing-post': [['data[wp-refresh-post-lock][lock]', 'synthetic-lock']],
        'unknown-field': [['data[wp-refresh-post-lock][post_id]', identity.postId], ['data[wp-refresh-post-lock][content]', 'synthetic']],
        'nested-post': [['data[wp-refresh-post-lock][post_id][nested]', identity.postId]],
        'scalar-json': [['data', JSON.stringify({ 'wp-refresh-post-lock': true })]],
        'missing-json-post': [['data', JSON.stringify({ 'wp-refresh-post-nonces': {} })]],
        'foreign-json-post': [['data', JSON.stringify({ 'wp-refresh-post-lock': { post_id: String(Number(identity.postId) + 1000) } })]],
        'mixed-encoding': [['data', '{}'], ['data[wp-refresh-post-lock][post_id]', identity.postId]]
      };
      const maintenanceEnvelope = maintenance.filter(([key]) => key !== 'data' && !key.startsWith('data['));
      for (const [shape, fields] of Object.entries(malformedOwners)) {
        if (classify([...maintenanceEnvelope, ...fields])) {
          throw new Error(`native-read-accepted-malformed-owner:${shape}`);
        }
      }
      const foreignPostId = String(Number(identity.postId) + 1000);
      // Replace the real owner value: PHP keeps the last duplicate, so a
      // replaced (not appended) foreign post id is what the server would use.
      const replaceOwnerPostId = (entries, owner) => entries.map(([key, value]) =>
        key === `data[${owner}][post_id]` ? [key, foreignPostId] : [key, value]);
      let verifiedForeignOwners = 0;
      for (const owner of ['wp-refresh-post-lock', 'wp-refresh-post-nonces']) {
        if (!maintenance.some(([key]) => key === `data[${owner}][post_id]`)) continue;
        verifiedForeignOwners += 1;
        const foreignPost = replaceOwnerPostId(maintenance, owner);
        if (!foreignPost.some(([key, value]) => key === `data[${owner}][post_id]`
          && value === foreignPostId)) {
          throw new Error(`native-read-foreign-post-replacement-missing:${owner}`);
        }
        if (classify(foreignPost)) {
          throw new Error(`native-read-accepted-foreign-post:${owner}`);
        }
        // PHP keeps the last duplicate, so a current-then-foreign pair must
        // also be denied rather than exempted on its first value.
        const duplicate = [...maintenance, [`data[${owner}][post_id]`, foreignPostId]];
        if (classify(duplicate)) {
          throw new Error(`native-read-accepted-duplicate-foreign-post:${owner}`);
        }
      }
      if (0 === verifiedForeignOwners) {
        throw new Error(
          `native-read-foreign-post-control-unavailable:${JSON.stringify(
            maintenance.map(([key]) => key)
          )}`
        );
      }
      const autosaveOwner = [
        ...maintenance.filter(([key]) => !key.startsWith('data[wp_autosave]')),
        ['data[wp_autosave][post_id]', identity.postId],
        ['data[wp_autosave][content]', 'synthetic autosave probe']
      ];
      if (classify(autosaveOwner)) {
        throw new Error('native-read-accepted-autosave-owner');
      }

      // The real autosave path must also be denied, not only a derived shape.
      await replaceSourceWithNativeInput(page, sourceEditor, source, `${markdown}\n\nReal autosave probe.`, 'autosave-first-input');
      await expect(source).toHaveValue(`${markdown}\n\nReal autosave probe.`);
      // Core decides whether to create wp_autosave before EasyMDE's heartbeat
      // callback projects Markdown into #content. Change a real Core-owned
      // field as well: never fabricate an autosave payload or write #content.
      await page.locator('#title').fill('Synthetic Core autosave classifier first');
      const autosaveCount = heartbeatRequests.length;
      await page.evaluate(() => {
        if (!window.wp?.autosave?.server?.triggerSave
          || !window.wp.autosave.server.postChanged()) {
          throw new Error('native-autosave-owner-unavailable');
        }
        window.wp.autosave.server.triggerSave();
      });
      await expect.poll(
        async () => heartbeatRequests.slice(autosaveCount).some(
          (entries) => hasOwner(entries, 'wp_autosave')
        ) && await page.evaluate(() => window.__easymdeCoreAutosaveProbe.completed === 1
          && window.__easymdeCoreAutosaveProbe.success),
        { message: 'a real Core autosave heartbeat must be observed', timeout: 30_000 }
      ).toBe(true);
      const realAutosave = heartbeatRequests.slice(autosaveCount).find(
        (entries) => hasOwner(entries, 'wp_autosave')
      );
      if (classify(realAutosave)) {
        throw new Error(
          `native-read-accepted-real-autosave:${JSON.stringify(
            realAutosave.map(([key]) => key)
          )}`
        );
      }
      // The classifier denies it, so a write probe that used to exempt every
      // heartbeat must now record this real autosave instead of masking it.
      const generatedProbe = await startGeneratedExportMutationProbe(page);
      try {
        await replaceSourceWithNativeInput(page, sourceEditor, source, `${markdown}\n\nReal autosave probe 2.`, 'autosave-second-input');
        await expect(source).toHaveValue(`${markdown}\n\nReal autosave probe 2.`);
        await page.locator('#title').fill('Synthetic Core autosave classifier second');
        const autosaveBefore = heartbeatRequests.length;
        // Awaiting the actual first after-autosave callback above releases
        // Core's in-flight block. Its public trigger resets only nextRun;
        // the real native title supplies the second change-detection input.
        await page.evaluate(() => {
          if (!window.wp?.autosave?.server?.triggerSave
            || !window.wp.autosave.server.postChanged()) {
            throw new Error('native-autosave-owner-unavailable');
          }
          window.wp.autosave.server.triggerSave();
        });
        await expect.poll(
          async () => heartbeatRequests.slice(autosaveBefore).some(
            (entries) => hasOwner(entries, 'wp_autosave')
          ) && await page.evaluate(() => window.__easymdeCoreAutosaveProbe.completed === 2
            && window.__easymdeCoreAutosaveProbe.success),
          { message: 'a second real autosave heartbeat must be observed', timeout: 30_000 }
        ).toBe(true);
        const recorded = generatedProbe.writes();
        if (!recorded.includes('admin-ajax:heartbeat')) {
          throw new Error(
            `native-read-real-autosave-masked-by-probe:${JSON.stringify(recorded)}`
          );
        }
      } finally {
        generatedProbe.stop();
      }
    } finally {
      page.off('request', onRequest);
      await page.evaluate(() => {
        window.jQuery?.(document).off('.easymdeClassifierProbe');
        delete window.__easymdeCoreAutosaveProbe;
      });
    }
    await assertSourceExactValue(
      source,
      `${markdown}\n\nReal autosave probe 2.`,
      'native-read-probe-end'
    );
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
    const nativeRead = await nativeWordPressReadOwner(page);
    page.on('request', (request) => {
      if ('POST' !== request.method()) return;
      const url = new URL(request.url());
      const decoded = decodePostParameters(request);
      const parameters = decoded.parameters;
      const action = url.searchParams.get('action') ?? parameters.get('action');
      if (url.pathname.endsWith('/wp-json/easymde/v1/preview')) return;
      if (nativeRead(url, parameters, action, decoded)) return;
      documentWrites.push(
        url.pathname.endsWith('/wp-admin/post.php')
          ? 'post-form'
          : url.pathname.endsWith('/wp-admin/admin-ajax.php')
            ? `admin-ajax:${/^[a-z0-9_-]{1,40}$/iu.test(action ?? '') ? action : 'unknown'}`
            : url.pathname.includes('/wp-json/')
              ? 'rest'
              : 'other'
      );
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
    const mermaidSource = fencedBlockSource(markdown, 'mermaid');
    const formulaExportSource = `\n${formulaSource}\n`;
    const mermaidExportSource = `${mermaidSource}\n`;
    const mutationProbe = await startGeneratedExportMutationProbe(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const assertionCodes = new Set([
      'generated-content-export-clipboard-failed',
      'generated-content-export-clipboard-unsupported',
      'generated-content-export-rasterization-failed'
    ]);
    try {
      let formulaPng;
      for (const [action, label] of [
        ['copy-generated-source', 'formula-copy-source'],
        ['copy-generated-mathml', 'formula-copy-mathml'],
        ['copy-generated-image', 'formula-copy-png']
      ]) {
        const evidence = await runGeneratedExportAction(page, {
          action,
          expectedSource: formulaExportSource,
          kind: 'math',
          label,
          markdown,
          mutationProbe,
          preview,
          selectText: formulaSource,
          source,
          sourceEditor
        });
        if ('copy-generated-image' === action) formulaPng = evidence;
      }

      let mermaidPng;
      for (const [action, label] of [
        ['copy-generated-source', 'mermaid-copy-source'],
        ['copy-generated-image', 'mermaid-copy-png']
      ]) {
        const evidence = await runGeneratedExportAction(page, {
          action,
          expectedSource: mermaidExportSource,
          kind: 'mermaid',
          label,
          markdown,
          mutationProbe,
          preview,
          previousPngHash: formulaPng?.hash,
          selectText: 'flowchart TD',
          source,
          sourceEditor
        });
        if ('copy-generated-image' === action) mermaidPng = evidence;
      }

      if (!formulaPng || !mermaidPng) {
        throw new Error('generated-export-png-evidence-missing');
      }
      if (formulaPng.hash === mermaidPng.hash) {
        throw new Error('generated-export-png-hash-collision');
      }

      // Successful exports must not report any export/clipboard failure.
      const unexpected = consoleProbe.codes().filter((code) => assertionCodes.has(code));
      if (unexpected.length > 0) {
        throw new Error(`generated-export-unexpected-failure:${unexpected.join(',')}`);
      }

      // Negative control: a genuine browser-level denial of clipboard writes
      // must fail the second image export rather than silently accepting the
      // previous PNG. The permission is restored afterwards and a real export
      // must succeed again, proving the failure came from the denial.
      // Leave a real native redo entry across the denied export. Neither the
      // failure nor permission restoration may clear or consume that entry.
      const historyCanary = replaceVisualSourceOccurrence(markdown, '普通文本', '**普通文本**');
      await selectSourceText(page, sourceEditor, markdown, '普通文本');
      await openSourceMenu(page, sourceEditor);
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, historyCanary, 'export-history-canary-bold');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-history-canary-undo');
      await waitForSourcePreviewAccepted(preview, 'export-history-canary-ready');
      const origin = new URL(page.url()).origin;
      const denial = await openClipboardWriteDenial(page, origin, 'formula-copy-png-denied');
      const beforeDenialCodes = new Set(consoleProbe.codes());
      try {
        await seedTextClipboard(page, 'denied clipboard seed', 'formula-copy-png-denied');
        await denial.deny();
        await selectSourceText(page, sourceEditor, markdown, formulaSource);
        await openSourceMenu(page, sourceEditor);
        await openRootSubmenu(page, 'generated-content');
        await openVisibleSubmenu(page, 'copy-generated');
        await anyMenuItem(page, 'copy-generated-image').click();
        await expect(page.locator(menuSelector)).toHaveCount(0);
        await expect.poll(
          () => consoleProbe.codes().some(
            (code) => !beforeDenialCodes.has(code) && assertionCodes.has(code)
          ),
          { message: 'a denied clipboard write must report an export failure' }
        ).toBe(true);
        // The denial covers sanitized and unsanitized writes, which also
        // blocks clipboard reads; permissions are restored before the seed is
        // inspected. Restoration itself does not touch the clipboard.
        await denial.restore();
        const deniedState = await page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          return {
            hasPng: items.some((item) => item.types.includes('image/png')),
            text: items.flatMap((item) => item.types).includes('text/plain')
              ? await navigator.clipboard.readText()
              : null
          };
        });
        if (deniedState.hasPng) {
          throw new Error('generated-export-denied-write-stale-png-accepted');
        }
        if (deniedState.text !== 'denied clipboard seed') {
          throw new Error(
            'generated-export-denied-write-clipboard-mutated:' +
            JSON.stringify(privacySafeTextEvidence(deniedState.text ?? ''))
          );
        }
        await expect(
          page.locator('.easymde-editor-message-alert-host [role="alert"]').first()
        ).toBeVisible();
        await mutationProbe.assertEmpty('formula-copy-png-denied');
        await assertSourceExactValue(source, markdown, 'formula-copy-png-denied');
      } finally {
        await denial.restore();
        await denial.dispose();
      }
      await sourceEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, historyCanary, 'export-denied-history-redo');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-denied-history-undo');
      await waitForSourcePreviewAccepted(preview, 'export-denied-history-ready');
      const recoveryBefore = new Set(consoleProbe.codes());
      const recovered = await runGeneratedExportAction(page, {
        action: 'copy-generated-image',
        expectedSource: formulaExportSource,
        kind: 'math',
        label: 'formula-copy-png-recovered',
        markdown,
        mutationProbe,
        preview,
        selectText: formulaSource,
        source,
        sourceEditor
      });
      if (!recovered) {
        throw new Error('generated-export-png-recovery-missing');
      }
      const recoveryFailures = consoleProbe.codes().filter(
        (code) => !recoveryBefore.has(code) && assertionCodes.has(code)
      );
      if (recoveryFailures.length > 0) {
        throw new Error(`generated-export-png-recovery-failed:${recoveryFailures.join(',')}`);
      }
      // The same target at the same scale must rasterize to the same geometry.
      const geometry = (evidence) => `${evidence.width}x${evidence.height}:${evidence.nonBlankPixels}`;
      if (geometry(recovered) !== geometry(formulaPng)) {
        throw new Error(
          `generated-export-png-recovery-mismatch:${JSON.stringify({
            actual: geometry(recovered),
            expected: geometry(formulaPng)
          })}`
        );
      }
      await sourceEditor.press('ControlOrMeta+Shift+z');
      await waitForSourceExactValue(source, historyCanary, 'export-recovered-history-redo');
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'export-recovered-history-undo');
      await waitForSourcePreviewAccepted(preview, 'export-recovered-history-ready');
    } finally {
      consoleProbe.stop();
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

  test('accepts Windowed Visual list Cut through accepted Preview and native Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    // Two canonical fixtures are what the real document uses to reach the
    // Windowed owner; no threshold or fixture flag is forced here.
    const { visualEditor } = await enterFullVisual(page);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'two canonical fixtures should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    const selectedText = '前端开发';
    const expected = replaceVisualSourceOccurrence(markdown, selectedText, '');
    const target = visualEditor.locator('li').filter({ hasText: selectedText }).first();
    await ensureWindowedVisualTargetMounted(page, target, 0);
    await expect(target).toHaveCount(1);
    // The selected text has to exist in the mounted surface before the
    // gesture, otherwise the range below would be satisfied by unrelated DOM.
    await expect(target).toContainText(selectedText);
    const mountedBefore = await visualEditor.evaluate((surface) =>
      Array.from(surface.querySelectorAll('[data-easymde-visual-block-id]'))
        .map((element) => element.getAttribute('data-easymde-visual-block-id'))
    );
    if (mountedBefore.length === 0 || new Set(mountedBefore).size !== mountedBefore.length) {
      throw new Error(
        `focused-windowed-list-cut-mounted-identities-invalid:${JSON.stringify(mountedBefore)}`
      );
    }

    await runVisualMutationAction(page, visualEditor, source, markdown, {
      action: 'cut',
      expected,
      label: 'focused-windowed-list-cut',
      target,
      selectText: selectedText
    });
    // The Cut payload is the browser's own Clipboard entry, checked before any
    // fixture reset can stand in for the accepted action.
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      selectedText,
      'focused-windowed-list-cut'
    );
    await assertSourceExactValue(source, markdown, 'focused-windowed-list-cut-reset');
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'the Windowed owner keeps real spacers after Cut and history' }
    ).toBeGreaterThan(0);
    const mountedAfter = await visualEditor.evaluate((surface) =>
      Array.from(surface.querySelectorAll('[data-easymde-visual-block-id]'))
        .map((element) => element.getAttribute('data-easymde-visual-block-id'))
    );
    if (mountedAfter.length === 0
      || new Set(mountedAfter).size !== mountedAfter.length
      || mountedAfter.length > 160) {
      throw new Error(
        `focused-windowed-list-cut-mounted-window-invalid:${JSON.stringify({
          cap: 160,
          mountedAfter
        })}`
      );
    }
  });

  // Each real action/history group gets the unchanged case budget. Keep the
  // same-document owner transition separately rather than making the final
  // render inherit every preceding group's elapsed time.
  for (const owner of ['full', 'windowed']) {
    for (const group of ['text', 'list', 'link', 'cross-heading', 'image', 'table']) {
      test(`accepts ${owner} Visual ${group} actions and history through formal Preview re-entry`, async ({ page }) => {
        await login(page);
        await openNewPost(page);
        const { markdown, source } = await loadCanonicalFixture(page, 'full' === owner ? 1 : 2);
        const full = await enterFullVisual(page);
        if ('windowed' === owner) {
          await expect.poll(
            () => full.visualEditor.locator('[data-easymde-preview-window-spacer]').count()
          ).toBeGreaterThan(0);
        } else {
          await expect(full.visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
        }
        await runVisualActionMatrix(page, full.visualEditor, source, markdown, 0, owner, group);
        await repeatAfterFormalPreview(page, full.strings, source, markdown, 0);
        await assertSourceExactValue(source, markdown, `${owner}-${group}-actions-complete`);
      });
    }
  }

  test('retains the same document and root through Full-to-Windowed Visual transition and formal Preview re-entry', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const root = await page.locator('#easymde-editor-root').elementHandle();
    let nativeSource;
    try {
      nativeSource = await source.elementHandle();
      const full = await enterFullVisual(page);
      await expect(full.visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
      await repeatAfterFormalPreview(page, full.strings, source, markdown, 0);
      await assertSourceExactValue(source, markdown, 'full-visual-actions-complete');
      await page.getByRole('button', { name: full.strings.exit, exact: true }).click();
      await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);
      const windowedMarkdown = `${markdown}\n${markdown}`;
      await replaceSourceWithNativeInput(page, sourceEditor, source, windowedMarkdown, 'windowed-fixture-applied');
      await waitForSourcePreviewAccepted(preview, 'full-to-windowed-preview');
      const windowed = await enterFullVisual(page);
      await expect.poll(
        () => windowed.visualEditor.locator('[data-easymde-preview-window-spacer]').count()
      ).toBeGreaterThan(0);
      await repeatAfterFormalPreview(page, windowed.strings, source, windowedMarkdown, 0);
      await page.getByRole('button', { name: windowed.strings.exit, exact: true }).click();
      await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);
      await assertSourceExactValue(source, windowedMarkdown, 'windowed-visual-actions-complete');
      expect(await root.evaluate((element) => element === document.querySelector('#easymde-editor-root'))).toBe(true);
      expect(await nativeSource.evaluate((element) => element === document.querySelector('#easymde-source'))).toBe(true);
    } finally {
      await Promise.all([root?.dispose(), nativeSource?.dispose()]);
    }
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

  test('re-anchors Windowed Visual image menus and selection to the image under the pointer', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'two canonical fixtures should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    // The Windowed owner mounts the window that surrounds the caret, and the
    // fixture editor leaves its caret at the document end. Scroll to the top
    // so both fixture images of the first copy are mounted and clickable.
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (!firstBlock || !secondBlock || firstBlock === secondBlock) {
      throw new Error(
        `image-pointer-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    // Every demand below addresses its image by block identity, and both images
    // stay mounted and visible so no gesture has to scroll the surface.
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualEditor.locator(
      `[data-easymde-visual-block-id="${firstBlock}"] img`
    );
    const second = visualEditor.locator(
      `[data-easymde-visual-block-id="${secondBlock}"] img`
    );
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await assertSourceExactValue(source, markdown, 'image-pointer-before');

    // First image menu, dismissed with Escape. The native range and the DOM
    // both survive exactly as the browser left them.
    const firstPoint = await openVisualImageMenu(page, first);
    await expectMenuItemState(page, 'image-scale', 'enabled');
    let state = await readVisualImageTargetState(visualEditor);
    if (
      firstPoint.block !== firstBlock
      || !state.overlaps[0]
      || state.overlaps[1]
      || state.anchorBlock !== firstBlock
      || state.markerBlock !== firstBlock
    ) {
      throw new Error(`image-pointer-first-menu-invalid:${JSON.stringify(state)}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');

    // A -> B -> A repeats without any range being cleared in between. Each
    // demand keeps exactly one root menu and describes the pointed image.
    for (const [index, block] of [
      [1, secondBlock],
      [0, firstBlock],
      [1, secondBlock],
      [0, firstBlock]
    ]) {
      const image = 0 === index ? first : second;
      const stateBefore = await readVisualImageTargetState(visualEditor);
      const menuBefore = await readMenuRect(page);
      const point = await openVisualImageMenu(page, image);
      await expectMenuItemState(page, 'image-scale', 'enabled');
      state = await readVisualImageTargetState(visualEditor);
      const other = 0 === index ? 1 : 0;
      if (
        point.block !== block
        || !state.overlaps[index]
        || state.overlaps[other]
        || state.anchorBlock !== block
        || state.markerBlock !== block
      ) {
        throw new Error(
          `image-pointer-retarget-invalid:${index}:${JSON.stringify({
            menuAfter: await readMenuRect(page),
            menuBefore,
            point,
            state,
            stateBefore
          })}`
        );
      }
      await expect(
        page.locator(
          `${menuViewportSelector} [data-easymde-context-menu-layer]`
        )
      ).toHaveCount(1);
    }
    await assertSourceExactValue(source, markdown, 'image-pointer-after');
  });

  test('keeps image ownership on the image a replacing pointer demand selected', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'two canonical fixtures should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (
      !firstBlock
      || !secondBlock
      || firstBlock === secondBlock
      || mounted[0]?.alt !== '占位测试图片'
      || mounted[1]?.alt !== '风景占位图'
    ) {
      throw new Error(
        `image-pointer-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualEditor.locator(
      `[data-easymde-visual-block-id="${firstBlock}"] img`
    );
    const second = visualEditor.locator(
      `[data-easymde-visual-block-id="${secondBlock}"] img`
    );
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    const firstMarkdown = markdown.match(/!\[占位测试图片\]\([^\r\n]+\)/u)?.[0];
    const secondMarkdown = markdown.match(/!\[风景占位图\]\([^\r\n]+\)/u)?.[0];
    if (!firstMarkdown || !secondMarkdown) {
      throw new Error('image-pointer-source-unavailable');
    }
    await assertSourceExactValue(source, markdown, 'image-pointer-scale-before');

    // First image menu stays open; the second image demand replaces it, and
    // the surface must not be scrolled to reach that image.
    await openVisualImageMenu(page, first);
    await expectMenuItemState(page, 'image-scale', 'enabled');
    await openVisualImageMenu(page, second);
    const state = await readVisualImageTargetState(visualEditor);
    if (
      !state.overlaps[1]
      || state.overlaps[0]
      || state.collapsed
      || state.rangeCount !== 1
    ) {
      throw new Error(
        `image-pointer-open-menu-retarget-invalid:${JSON.stringify(state)}`
      );
    }

    await openRootSubmenu(page, 'image-scale');
    await expectMenuItemState(page, 'image-scale-50', 'enabled');
    await anyMenuItem(page, 'image-scale-50').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    const expected = imageScaleSource(markdown, secondMarkdown, 50, 0);
    await waitForSourceExactValue(source, expected, 'image-pointer-scale-applied');
    const scaled = await source.inputValue();
    // The first image keeps its source bytes: only the pointed image changed.
    if (scaled.includes(imageScaleSource(markdown, firstMarkdown, 50, 0))) {
      throw new Error('image-pointer-first-image-mutated');
    }
    if (!scaled.includes(firstMarkdown)) {
      throw new Error('image-pointer-first-image-source-missing');
    }
    await assertPreviewImageScale(
      visualEditor.getByAltText('风景占位图', { exact: true }).first(),
      50,
      'image-pointer-scale-applied'
    );

    await visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, 'image-pointer-scale-undo');
    await expect(
      visualEditor.getByAltText('风景占位图', { exact: true }).first()
    ).not.toHaveAttribute('data-easymde-image-scale');
    await assertSourceExactValue(source, markdown, 'image-pointer-scale-after');
  });

  test('selects the left-clicked image and moves its visible target state', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    await expect.poll(
      () => visualEditor.locator('[data-easymde-preview-window-spacer]').count(),
      { message: 'two canonical fixtures should activate the Windowed Visual owner' }
    ).toBeGreaterThan(0);
    await scrollWindowedVisualToTop(page, visualEditor);
    const mounted = await readMountedVisualImages(visualEditor);
    const firstBlock = mounted[0]?.block ?? null;
    const secondBlock = mounted[1]?.block ?? null;
    if (!firstBlock || !secondBlock || firstBlock === secondBlock) {
      throw new Error(
        `image-activation-blocks-unavailable:${JSON.stringify(mounted)}`
      );
    }
    // Both images stay mounted and visible, so no gesture has to scroll the
    // surface while it interacts with them.
    await revealWindowedVisualBlock(page, firstBlock);
    const first = visualEditor.locator(
      `[data-easymde-visual-block-id="${firstBlock}"] img`
    );
    const second = visualEditor.locator(
      `[data-easymde-visual-block-id="${secondBlock}"] img`
    );
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await assertSourceExactValue(source, markdown, 'image-activation-before');

    // The primary button on an image selects that image and marks it.
    let point = await visualImagePoint(first);
    await page.mouse.click(point.x, point.y);
    let state = await readVisualImageTargetState(visualEditor);
    if (
      state.collapsed
      || state.rangeCount !== 1
      || !state.overlaps[0]
      || state.overlaps[1]
      || state.anchorBlock !== firstBlock
      || state.markerBlock !== firstBlock
    ) {
      throw new Error(`image-activation-first-invalid:${JSON.stringify(state)}`);
    }

    // Activating the next image moves both the selection and the marker.
    point = await visualImagePoint(second);
    await page.mouse.click(point.x, point.y);
    state = await readVisualImageTargetState(visualEditor);
    if (
      state.collapsed
      || state.rangeCount !== 1
      || !state.overlaps[1]
      || state.overlaps[0]
      || state.anchorBlock !== secondBlock
      || state.markerBlock !== secondBlock
    ) {
      throw new Error(`image-activation-second-invalid:${JSON.stringify(state)}`);
    }

    // A layout change the image itself caused — no scroll, no window resize —
    // keeps the marker bound to the box it describes.
    const resizedRect = await second.evaluate((image) => {
      image.style.width = '60%';
      const rect = image.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width)
      };
    });
    await expect
      .poll(async () => (await readVisualImageTargetState(visualEditor)).markerRect)
      .toEqual(resizedRect);

    // Sliding the image out of the visible band must not paint the outline over
    // page chrome: every step keeps the outline inside the band and viewport.
    for (const step of [180, 180, 180, 180]) {
      await page
        .locator('.easymde-immersive-preview-canvas')
        .evaluate((element, offset) => {
          element.scrollTop += offset;
          element.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, step);
      await expect
        .poll(async () => {
          const band = await readVisibleBand(page);
          const state = await readVisualImageTargetState(visualEditor);
          if (!state.markerRect) return 'missing-outline';
          const markerBottom =
            state.markerRect.top + state.markerRect.height;
          const inside =
            state.markerRect.top >= band.top - 1
            && markerBottom <= band.bottom + 1
            && state.markerRect.top >= -1;
          return inside ? 'inside' : JSON.stringify({ band, marker: state.markerRect });
        })
        .toBe('inside');
    }

    // Clicking text clears the marker and leaves a caret inside that block.
    const text = await clickVisualTextPoint(page, visualEditor);
    state = await readVisualImageTargetState(visualEditor);
    if (
      !state.collapsed
      || state.rangeCount !== 1
      || state.markerTop !== null
      || state.markerBlock !== null
      || !text.block
      || state.anchorBlock !== text.block
    ) {
      throw new Error(
        `image-activation-text-invalid:${JSON.stringify({ state, text })}`
      );
    }

    // Selecting and marking an image never writes Markdown.
    await assertSourceExactValue(source, markdown, 'image-activation-after');
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
    const { markdown, source } = await loadCanonicalFixture(page);
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
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-thematic-break-input');
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
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'split-source-thematic-break-input');
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
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'full-thematic-break-input');
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
    const marker = '  ---  ';
    const markerStart = markdown.indexOf(marker);
    if (markerStart < 0 || markdown.indexOf(marker, markerStart + marker.length) >= 0) {
      throw new Error('windowed-thematic-break-marker-offset-unavailable');
    }
    // The parser-owned thematic-break range is the marker line's content only;
    // the structural owner never consumes the blank-line separators on either side.
    const expected = `${markdown.slice(0, markerStart)}${markdown.slice(markerStart + marker.length)}`;
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'windowed-thematic-break-input');
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

  test('windowed code deletion recovery', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const leading = Array.from(
      { length: 220 },
      (_, index) => `windowed paragraph ${index}`
    ).join('\n\n');
    const fence = '~~~bash\necho windowed\n~~~';
    const trailing = '~~~js\nconst windowed = 1;\n~~~';
    const markdown = `${leading}\n\n${fence}\n\nwindowed middle\n\n${trailing}\n\nwindowed tail`;
    const fenceStart = markdown.indexOf(fence);
    if (fenceStart < 0) throw new Error('windowed-code-recovery-fence-offset-unavailable');
    // The structural owner removes exactly the fenced block offsets and never
    // consumes the blank-line separators on either side.
    const expected = `${markdown.slice(0, fenceStart)}${markdown.slice(fenceStart + fence.length)}`;
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'windowed-code-recovery-input');
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-before');
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
    const before = await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-before'
    );
    // The deleted fence is selected exactly as a browser selects a whole
    // direct-child block, which is the shape the structural owner resolves.
    const selectFence = () => full.visualEditor.locator('pre').first().evaluate(
      (element) => {
        const surface = element.parentElement;
        if (!surface) throw new Error('windowed-code-surface-unavailable');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-code-selection-unavailable');
        const index = Array.prototype.indexOf.call(surface.children, element);
        if (index < 0) throw new Error('windowed-code-index-unavailable');
        surface.focus();
        selection.removeAllRanges();
        selection.setBaseAndExtent(surface, index, surface, index + 1);
      }
    );
    const deletedFence = full.visualEditor.locator('pre').first();
    await expect(deletedFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery');
    try {
      await openVisualMenu(page, full.visualEditor, deletedFence, selectFence);
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await anyMenuItem(page, 'delete-code-block').last().click();
      await expect(page.locator(menuSelector)).toHaveCount(0);
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery',
        'delete',
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
    await waitForSourceExactValue(source, expected, 'windowed-code-recovery-delete');
    const after = await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-delete',
      before.domHash
    );
    await full.visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-undo');
    await waitForVisualPreviewAccepted(
      full.visualEditor,
      'windowed-code-recovery-undo',
      after.domHash
    );
    // Recovery post-conditions: the owner stays editable, the mounted window
    // stays bounded, every visual block id stays unique, and the menu opens on
    // both the restored area and an unaffected surviving code block.
    const recovery = await full.visualEditor.evaluate((editor) => {
      const blocks = Array.from(
        editor.querySelectorAll('[data-easymde-visual-block-id]')
      );
      const ids = blocks.map((block) => block.getAttribute('data-easymde-visual-block-id'));
      const surface = 'true' === editor.getAttribute('contenteditable')
        ? editor
        : editor.querySelector('[contenteditable="true"]');
      return {
        blockCount: blocks.length,
        contentEditable: surface?.getAttribute('contenteditable') ?? null,
        idCount: ids.length,
        uniqueIds: new Set(ids).size,
        windowSpacers: editor.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ).length
      };
    });
    expect(recovery.contentEditable).toBe('true');
    expect(recovery.uniqueIds).toBe(recovery.idCount);
    expect(recovery.blockCount).toBeGreaterThan(1);
    expect(recovery.windowSpacers).toBeGreaterThan(0);
    const restoredFence = full.visualEditor.locator('pre').first();
    await expect(restoredFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery-restored');
    try {
      await openVisualMenu(page, full.visualEditor, restoredFence, selectFence);
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await closeMenu(
        page,
        'windowed-code-recovery-restored',
        { expectedSource: markdown, keepDiagnostics: true }
      );
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery-restored',
        'restored',
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
    const survivingFence = full.visualEditor.locator('pre').last();
    await expect(survivingFence).toBeVisible();
    await startContextMenuDiagnostics(page, 'windowed-code-recovery-surviving');
    try {
      await openVisualMenu(page, full.visualEditor, survivingFence, () => survivingFence.evaluate(
        (element) => {
          const surface = element.parentElement;
          if (!surface) throw new Error('windowed-code-surface-unavailable');
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (!selection) throw new Error('windowed-code-selection-unavailable');
          const index = Array.prototype.indexOf.call(surface.children, element);
          if (index < 0) throw new Error('windowed-code-index-unavailable');
          surface.focus();
          selection.removeAllRanges();
          selection.setBaseAndExtent(surface, index, surface, index + 1);
        }
      ));
      await openRootSubmenu(page, 'code-block');
      await expectMenuItemState(page, 'delete-code-block', 'enabled');
      await closeMenu(
        page,
        'windowed-code-recovery-surviving',
        { expectedSource: markdown, keepDiagnostics: true }
      );
    } catch (error) {
      const diagnostic = await readContextMenuDiagnostics(
        page,
        'windowed-code-recovery-surviving',
        'surviving',
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
    await waitForSourceExactValue(source, markdown, 'windowed-code-recovery-final');
  });

  test('deletes a Windowed Visual thematic break through native Backspace and restores Undo/Redo selection', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const windowedMarkdown = `${markdown}\n${markdown}`;
    await replaceSourceWithNativeInput(page, sourceEditor, source, windowedMarkdown, 'windowed-hr-fixture-input');
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
      const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
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
