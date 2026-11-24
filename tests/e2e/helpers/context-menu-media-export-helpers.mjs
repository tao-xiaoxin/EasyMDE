import { expect } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  expectMenuItemState,
  fixtureImage,
  imageScaleSource,
  imageSourceAlt,
  menuSelector,
  openRootSubmenu,
  openSourceMenu,
  openVisibleSubmenu,
  placeSourceCaret,
  readSourcePreviewAcceptanceState,
  readSourceSelection,
  replaceVisualSourceOccurrence,
  rootItem,
  selectSourceText,
  syntheticMediaAlt,
  waitForSourceExactValue,
  waitForSourcePreviewAccepted
} from './context-menu-helpers.mjs';

export async function waitForRealImageLoad(image) {
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

export async function assertPreviewImageScale(image, percentage, phase) {
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

export function fencedBlockSource(markdown, language, occurrence = 0) {
  const pattern = new RegExp(
    '^```' + language + '\\r?\\n([\\s\\S]*?)\\r?\\n```',
    'gmu'
  );
  const matches = [...markdown.matchAll(pattern)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-fenced-block-missing:${language}:${occurrence}`);
  return match[1];
}

export function displayMathSource(markdown, occurrence = 0) {
  const matches = [...markdown.matchAll(/^\$\$\r?\n([\s\S]*?)\r?\n\$\$/gmu)];
  const match = matches[occurrence];
  if (!match) throw new Error(`fixture-display-math-missing:${occurrence}`);
  return match[1];
}

export function privacySafeTextEvidence(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { hash: (hash >>> 0).toString(16), length: value.length };
}

export async function readGeneratedExportSnapshot(page) {
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
export function decodePostParameters(request) {
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

export async function readNativeWordPressIdentity(page) {
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

export function classifyNativeWordPressRead(identity, url, parameters, action, decoded = null) {
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

export async function nativeWordPressReadOwner(page) {
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

export async function startGeneratedExportMutationProbe(page) {
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

export async function seedTextClipboard(page, text, phase) {
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
export async function openClipboardWriteDenial(page, origin, phase) {
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

export async function runGeneratedExportAction(
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

export async function readNativeClipboardText(page) {
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

export function startSourceMediaConsoleProbe(page) {
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

export async function startSourceMediaMutationProbe(page) {
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

export async function openSourceInsertImagePicker(page, sourceEditor, markdown) {
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

export async function readSourceMediaBridgeState(sourceEditor) {
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
export async function uploadAndPrepareSourceImage(page, mediaFrame, mediaModal) {
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

export async function waitForSourceMediaInsertion(
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

export function assertClipboardTextExact(actual, expected, label) {
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

export async function exerciseMissingSourceActions(page, { markdown, source, sourceEditor, mode }) {
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

export async function applyImageScaleFromSource(
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

export async function exerciseImageScaleMatrix(
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

export async function saveAndReloadImageScale(page, source, expected) {
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

export const sourceMediaReadOnlyCode = 'media-picker-document-read-only';

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
export async function beginSourceMediaPermissionLoss(
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
export async function completeSourceMediaPermissionLoss(
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
