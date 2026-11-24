import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');

const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');

const fixtureMarkdown = readFileSync(
  new URL('../../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);

export const fixtureImage = readFileSync(
  new URL('../../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);

export const imageSourceAlt = '占位测试图片';

// Written through the real native Attachment Details save path before the
// picker is confirmed. The insert contract derives Alt from the attachment
// file name, so this proves the native write round-trip rather than a second
// Alt rule.
export const syntheticMediaAlt = 'Synthetic native alt text';

export const menuSelector = '[data-easymde-context-menu="true"]';

export const menuViewportSelector = '[data-easymde-context-menu-viewport="true"]';

const sourceDocumentStartKey = process.platform === 'darwin'
  ? 'Meta+ArrowUp'
  : 'Control+Home';

const sourceDocumentEndKey = process.platform === 'darwin'
  ? 'Meta+ArrowDown'
  : 'Control+End';

export const sourceLineEndKey = process.platform === 'darwin'
  ? 'Meta+ArrowRight'
  : 'End';

const sourceLineStartKey = process.platform === 'darwin'
  ? 'Meta+ArrowLeft'
  : 'Home';

export const contextMenuDiagnosticKey = '__easymdeContextMenuDiagnostic';

export const visualHistoryDiagnosticKey = '__easymdeVisualHistoryDiagnostic';

const contextMenuDiagnosticEventLimit = 24;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or process environment.`);
  }
  return value;
}

export function privacySafeFailureCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /\b((?:editor-context-menu|fixture|source|table-menu|visual)(?:-[a-z0-9]+)*)\b/iu
  );
  return match?.[1] ?? 'assertion-failed';
}

export function createImageRequestGate() {
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

export function occurrenceOffset(source, value, occurrence = 0) {
  let offset = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(value, from);
    if (offset < 0) throw new Error(`fixture-text-missing:${value}`);
    from = offset + Math.max(1, value.length);
  }
  return offset;
}

export async function login(page) {
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

/**
 * WordPress Core renders `#post-lock-dialog` (and so sends real
 * `data[wp-refresh-post-lock]` heartbeats) only when the site has more than
 * one user. On a single-user test site this provisions one disposable
 * subscriber through the authenticated Core REST API of the logged-in
 * administrator; `remove()` deletes it again. Never weakens the lock owner.
 */
export async function ensureSecondWordPressUser(page) {
  // A REST nonce is bound to the current login session. Teardown may run after
  // the test re-authenticated or rotated its session, so every protected phase
  // reads a fresh nonce from the live session instead of reusing a stale one.
  async function fetchRestHeaders() {
    const nonceResponse = await page.request.get('/wp-admin/admin-ajax.php?action=rest-nonce');
    if (!nonceResponse.ok()) {
      throw new Error(`wordpress-rest-nonce-unavailable:${nonceResponse.status()}`);
    }
    return { 'X-WP-Nonce': (await nonceResponse.text()).trim() };
  }
  const headers = await fetchRestHeaders();
  const restUrl = (route, query = '') => `/?rest_route=${encodeURIComponent(route)}${query}`;
  const readJson = async (response, code) => {
    if (!response.ok()) throw new Error(`${code}:${response.status()}`);
    return response.json();
  };
  const users = await readJson(
    await page.request.get(restUrl('/wp/v2/users', '&context=edit&per_page=2'), { headers }),
    'wordpress-user-list-failed'
  );
  if (Array.isArray(users) && users.length >= 2) {
    return { created: false, userCount: users.length, remove: async () => {} };
  }
  const current = await readJson(
    await page.request.get(restUrl('/wp/v2/users/me'), { headers }),
    'wordpress-current-user-failed'
  );
  const suffix = randomUUID().slice(0, 8);
  const created = await readJson(
    await page.request.post(restUrl('/wp/v2/users'), {
      data: {
        email: `easymde-e2e-lock-${suffix}@example.test`,
        password: `${randomUUID()}Aa1!`,
        roles: ['subscriber'],
        username: `easymde-e2e-lock-${suffix}`
      },
      headers
    }),
    'wordpress-second-user-create-failed'
  );
  let removed = false;
  return {
    created: true,
    userCount: 2,
    async remove() {
      if (removed) return;
      removed = true;
      const deleteHeaders = await fetchRestHeaders();
      await readJson(
        await page.request.delete(
          restUrl(`/wp/v2/users/${created.id}`, `&force=true&reassign=${current.id}`),
          { headers: deleteHeaders }
        ),
        'wordpress-second-user-delete-failed'
      );
    }
  };
}

export async function openNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

export async function loadCanonicalFixture(page, copies = 1, options = {}) {
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

export function imageScaleSource(markdown, imageMarkdown, percentage, occurrence = 0) {
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

export async function assertSourceExactValue(source, expected, phase) {
  const exact = await source.evaluate(
    (field, expectedValue) => 'value' in field && field.value === expectedValue,
    expected
  );
  if (!exact) throw new Error(`editor-context-menu-image-scale-source-drift:${phase}`);
}

export async function waitForSourceExactValue(source, expected, phase) {
  await expect.poll(
    () => source.evaluate(
      (field, expectedValue) => 'value' in field && field.value === expectedValue,
      expected
    ),
    { message: `source should reach the expected state: ${phase}` }
  ).toBe(true);
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

export async function expectSourceSelection(page, start, end) {
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

export async function readSourceSelection(page) {
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

/**
 * The original exhaustive native walk: from the document start, press the
 * logical line end and one ArrowRight per line. Exact but linear in the line
 * count, so it is kept only as the fallback when native vertical navigation
 * cannot make progress.
 */
async function walkSourceCaretToLineStart(page, source, markdown, line) {
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
  return lineStart;
}

/**
 * Converges the native caret onto the target logical line with genuine
 * vertical keyboard navigation: PageUp/PageDown for large distances and
 * ArrowUp/ArrowDown for the remainder. Every step reads the real native
 * selection back, so soft-wrapped visual lines and real page sizes are
 * observed rather than assumed. Returns `false` when the native caret stalls,
 * so the caller can take the exhaustive walk instead.
 */
async function moveSourceCaretToLine(
  page,
  source,
  markdown,
  state,
  sameDocument,
  line,
  targetLineStart,
  targetLineEnd
) {
  const lastLine = sourceLineMetrics(markdown, markdown.length).line;
  const collapsed = state.start === state.end;
  const currentLine = sameDocument ? sourceLineMetrics(markdown, state.start).line : null;
  const toEnd = targetLineStart > markdown.length / 2;
  const boundaryDistance = toEnd ? lastLine - line : line;
  const currentDistance = null === currentLine ? Infinity : Math.abs(line - currentLine);
  if (!sameDocument || currentDistance > boundaryDistance) {
    await source.press(toEnd ? sourceDocumentEndKey : sourceDocumentStartKey);
    if (!toEnd) {
      await expectSourceSelection(page, 0, 0);
    } else if (sameDocument) {
      await expectSourceSelection(page, markdown.length, markdown.length);
    }
  } else if (!collapsed) {
    // Collapse a non-collapsed selection at its start, near the current line.
    await page.keyboard.press('ArrowLeft');
    await expectSourceSelection(page, state.start, state.start);
  }

  const maxSteps = markdown.split('\n').length + 64;
  // Paging is used only while the remaining distance exceeds the largest page
  // observed so far, so a page larger than the remaining distance cannot make
  // the convergence oscillate.
  let pageThreshold = 12;
  let pos = await sourceSelectionStart(page);
  for (let steps = 0; pos < targetLineStart || pos > targetLineEnd; steps += 1) {
    if (steps >= maxSteps) {
      throw new Error(
        `source-vertical-navigation-exhausted:${JSON.stringify({ line, pos, steps })}`
      );
    }
    const curLine = sourceLineMetrics(markdown, pos).line;
    const delta = line - curLine;
    if (0 === delta) return false;
    const arrowKey = delta > 0 ? 'ArrowDown' : 'ArrowUp';
    let nextPos;
    if (Math.abs(delta) >= pageThreshold) {
      await page.keyboard.press(delta > 0 ? 'PageDown' : 'PageUp');
      nextPos = await sourceSelectionStart(page);
      if (nextPos === pos) {
        // Paging is unavailable here (short viewport or boundary).
        pageThreshold = Infinity;
        await page.keyboard.press(arrowKey);
        nextPos = await sourceSelectionStart(page);
      } else {
        const moved = Math.abs(sourceLineMetrics(markdown, nextPos).line - curLine);
        pageThreshold = Math.max(pageThreshold, moved);
      }
    } else {
      await page.keyboard.press(arrowKey);
      nextPos = await sourceSelectionStart(page);
    }
    if (nextPos === pos) return false;
    pos = nextPos;
  }
  return true;
}

/**
 * Moves the native caret from inside the target logical line to its start
 * with the native line-start key, repeating it for soft-wrapped visual lines
 * and indentation-aware Home semantics (mirrors `moveToSourceLineEnd`).
 */
async function moveSourceCaretToLineStart(page, source, markdown, targetLineStart) {
  let current = await sourceSelectionStart(page);
  for (let guard = 0; current > targetLineStart; guard += 1) {
    if (guard >= 64) {
      throw new Error('source-logical-line-start-navigation-exhausted');
    }
    await source.press(sourceLineStartKey);
    const next = await sourceSelectionStart(page);
    if (next >= current) {
      // The native line-start key made no progress: step back one grapheme
      // cluster per press instead.
      const steps = graphemeCount(markdown.slice(targetLineStart, current));
      for (let index = 0; index < steps; index += 1) {
        await page.keyboard.press('ArrowLeft');
      }
      current = await sourceSelectionStart(page);
      break;
    }
    current = next;
  }
  if (current !== targetLineStart) {
    throw new Error(
      `source-logical-line-start-navigation-missed:${JSON.stringify({
        current,
        expected: targetLineStart
      })}`
    );
  }
}

export async function moveSourceCaret(page, source, markdown, offset) {
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
  const targetLineStart = offset - column;
  const targetLineEnd = sourceLineBoundary(markdown, targetLineStart).end;
  await source.focus();
  const reachedTargetLine = await moveSourceCaretToLine(
    page,
    source,
    markdown,
    state,
    sameDocument,
    line,
    targetLineStart,
    targetLineEnd
  );
  if (reachedTargetLine) {
    await moveSourceCaretToLineStart(page, source, markdown, targetLineStart);
  } else {
    await walkSourceCaretToLineStart(page, source, markdown, line);
  }
  await expectSourceSelection(page, targetLineStart, targetLineStart);
  // Column steps are grapheme clusters, not UTF-16 units: an arrow key moves
  // one cluster, so a surrogate pair inside the target line prefix must not
  // cost two presses.
  const columnSteps = graphemeCount(markdown.slice(targetLineStart, offset));
  for (let index = 0; index < columnSteps; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expectSourceSelection(page, offset, offset);
}

export async function selectSourceText(page, source, markdown, value, occurrence = 0) {
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

export async function selectSourceRange(page, source, markdown, start, end) {
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

export async function replaceSourceWithNativeInput(page, sourceEditor, source, value, phase) {
  await sourceEditor.focus();
  await sourceEditor.press('ControlOrMeta+a');
  // Let CodeMirror replace its complete selection in one native transaction.
  // CodeMirror renders only its viewport, so mutating its mounted DOM directly
  // would not replace the complete document.
  await page.keyboard.insertText(value);
  await waitForSourceExactValue(source, value, phase);
}

export async function placeSourceCaret(page, source, markdown, value, occurrence = 0) {
  await moveSourceCaret(
    page,
    source,
    markdown,
    occurrenceOffset(markdown, value, occurrence)
  );
}

export async function assertSourceFixtureExact(source, markdown, categoryId, phase) {
  const exact = await source.evaluate(
    (field, expected) => 'value' in field && field.value === expected,
    markdown
  );
  if (!exact) {
    throw new Error(`editor-context-menu-source-drift:${categoryId}:${phase}`);
  }
}

export function rootMenu(page) {
  return page.locator(`${menuSelector} [data-easymde-context-menu-layer="root"]`);
}

export function rootItem(page, id) {
  return rootMenu(page).locator(`[data-easymde-context-menu-item="${id}"]`);
}

export function anyMenuItem(page, id) {
  return page.locator(`${menuViewportSelector} [data-easymde-context-menu-item="${id}"]`);
}

export async function openSourceMenu(page, source) {
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

export async function openSourceNativeMenu(page, sourceEditor, expectedText) {
  const point = await visibleSourceSelectionPoint(sourceEditor, expectedText);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator(menuSelector)).toBeVisible();
  await expect(rootMenu(page)).toBeVisible();
}

export async function runSourceThematicBreakDelete(
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

export async function startSourceTransactionProbe(page) {
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

export async function readPrivacySafeSourceState(source, expected) {
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

export async function startSettingsShortcutProbe(page) {
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
        'article[data-easymde-prosemirror-host="1"][contenteditable="true"], [data-easymde-preview-html-sink="1"][contenteditable="true"]'
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

export async function startSettingsFormatBoldProbe(page) {
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

export async function startContextMenuDiagnostics(page, categoryId, targetMetadata = null) {
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
      'article[data-easymde-prosemirror-host="1"][contenteditable="true"], [data-easymde-preview-html-sink="1"][contenteditable="true"]'
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
      // ADR-002: every top-level ProseMirror block is live; the retired
      // Windowed spacers are reported only to prove they stay absent.
      const host = canvas.querySelector('[data-easymde-prosemirror-host="1"]');
      const blocks = host ? Array.from(host.children) : [];
      const spacers = Array.from(canvas.querySelectorAll('[data-easymde-preview-window-spacer]'));
      const table = canvas.querySelector('table');
      return {
        canvas: { left: canvas.scrollLeft, top: scrollTop },
        firstMounted: geometryState(blocks[0] ?? null),
        lastMounted: geometryState(blocks[blocks.length - 1] ?? null),
        mountedBlockRange: {
          count: blocks.length,
          first: blocks.length > 0 ? 'pm-block-0' : null,
          last: blocks.length > 0 ? `pm-block-${blocks.length - 1}` : null
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

export async function readContextMenuDiagnostics(
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
        visualBlockCount: document.querySelector('[data-easymde-prosemirror-host="1"]')?.children.length ?? 0,
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

export async function stopContextMenuDiagnostics(page) {
  await page.evaluate((key) => {
    const state = globalThis[key];
    state?.stop?.();
    delete globalThis[key];
  }, contextMenuDiagnosticKey);
}

export async function openSourceMenuWithDiagnostics(
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

export async function closeMenu(
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

export async function openRootSubmenu(page, id) {
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

export async function expandOpenTableMenuViewport(page) {
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

export async function openVisibleSubmenu(page, id) {
  const trigger = anyMenuItem(page, id).last();
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click();
}

export async function expectMenuItemState(page, id, state) {
  const item = anyMenuItem(page, id).last();
  await expect(item).toBeVisible();
  if ('enabled' === state) await expect(item).toBeEnabled();
  else if ('disabled' === state) await expect(item).toBeDisabled();
}

export async function getImmersiveStrings(page) {
  return page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
}

export async function readSourcePreviewAcceptanceState(preview) {
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

export async function waitForSourcePreviewAccepted(preview, phase, previousDomHash = null) {
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

export function replaceVisualSourceOccurrence(markdown, value, replacement, occurrence = 0) {
  const start = occurrenceOffset(markdown, value, occurrence);
  return `${markdown.slice(0, start)}${replacement}${markdown.slice(start + value.length)}`;
}
