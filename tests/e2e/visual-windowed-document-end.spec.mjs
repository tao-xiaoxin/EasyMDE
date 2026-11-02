import { expect, test } from '@playwright/test';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Trace, video and failure screenshots snapshot the article DOM. This spec
// reads scalar state only: attributes, node counts, offsets, lengths and the
// synthetic fixture it authored itself.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const SURFACE_SELECTOR = '[data-easymde-preview-html-sink][role="textbox"]';
const FAILURE_ATTRIBUTE = 'data-easymde-visual-failure';
const PROBE_KEY = '__easymdeDocumentEndKeyProbe';

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

// More than 160 blocks: the Preview mounts a window with spacers instead of the
// whole document, so `Control+End` lands on the editing host while the
// document-end Block is still unmounted.
function windowedMarkdown() {
  const filler = Array.from(
    { length: 170 },
    (_, index) => `Filler ${index + 1}.`
  ).join('\n\n');
  return `Head.\n\n${filler}\n\nTail.`;
}

// The canonical document-end Enter opens one terminal line: the owner splices
// only the line endings the source is missing, because two terminal endings
// already separate a new block.
function terminalSeparator(source) {
  const trailing = source.match(/(?:\r\n|\r|\n)+$/u)?.[0] ?? '';
  const endings = (trailing.match(/\r\n|\r|\n/gu) ?? []).length;
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  return lineEnding.repeat(Math.max(0, 2 - endings));
}

async function expectSource(source, expected) {
  await expect.poll(async () => await source.inputValue() === expected, {
    message: 'Canonical Markdown must match exactly; document content is not logged'
  }).toBe(true);
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
        focused: !!surface && document.activeElement === surface
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

async function openWindowedVisual(page) {
  const failures = [];
  await page.exposeFunction('__easymdeDocumentEndRejection', () => {
    failures.push('browser-unhandled-rejection');
  });
  page.on('pageerror', () => { failures.push('browser-page-error'); });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const code = text.match(/\[EasyMDE\]\s+([a-z0-9-]+)/u)?.[1];
    if (code) {
      failures.push(code);
      return;
    }
    if (text.startsWith('Failed to load resource:')) {
      const location = message.location().url;
      if (location.includes('/easymde/v1/') || location.includes('rest_route=%2Feasymde')
        || location.includes('/wp-content/plugins/') || location.includes('/admin-ajax.php')) {
        failures.push('editor-resource-load-failed');
      }
      return;
    }
    failures.push('uncategorized-browser-console-error');
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', () => {
      void window.__easymdeDocumentEndRejection();
    });
  });
  await installKeyProbe(page);

  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(environment('WORDPRESS_ADMIN_USER'));
  await page.locator('#user_pass').fill(adminPassword());
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();

  await page.goto('/wp-admin/post-new.php');
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  await expect(sourceEditor).toBeVisible();
  const runtimeBuilds = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname.split('/').at(-1))
    .filter((name) => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
  console.log(JSON.stringify({ phase: 'loaded-editor-build', files: runtimeBuilds }));
  const expectedBuild = process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD;
  if (expectedBuild) expect(runtimeBuilds, 'The browser must load the frozen production build').toEqual([expectedBuild]);

  // Fixture preparation only. Every edit under test is real keyboard/mouse input.
  await sourceEditor.click();
  await page.keyboard.insertText(windowedMarkdown());
  const source = page.locator('#easymde-source');
  await expectSource(source, windowedMarkdown());

  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  await page.getByRole('button', { name: strings.enter, exact: true }).click();
  await page.getByRole('button', { name: strings.preview, exact: true }).last().click();
  await expect(page.getByText(strings.previewContentLoaded)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: strings.previewUnlockEdit, exact: true }).click();

  const visual = page.locator(SURFACE_SELECTOR);
  await expect(visual).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 });
  // More than 160 blocks: the surface must really be windowed.
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  return { failures, source, visual };
}

async function expectNoEditorFailure(page, failures) {
  expect(failures, 'No [EasyMDE] refusal or uncategorized console error may be emitted').toEqual([]);
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

// The windowed document end after `Control+End`: Chromium leaves the collapsed
// caret on the editing host itself, after every mounted node. Only the kind of
// the trailing node differs between the two shapes - a spacer while the window
// still hides the document-end Block, the Block itself once the window has
// settled - so the caret is the document end in both.
function expectDocumentEndCaret(state) {
  expect(state).toMatchObject({ present: true, collapsed: true, anchorIsSurface: true, focused: true });
  expect(state.anchorOffset, 'The caret must be the host end boundary').toBe(state.childCount);
}

test('windowed document end: Enter after the window settles opens the terminal line and keeps editing', async ({ page }) => {
  test.setTimeout(180_000);
  const { failures, source, visual } = await openWindowedVisual(page);
  await clickVisibleRow(visual);
  await settleWindow(page);

  const before = await source.inputValue();
  const separator = terminalSeparator(before);

  await page.keyboard.press('Control+End');
  const reached = await settleWindow(page);
  expectDocumentEndCaret(reached);
  // The settled shape: the window has mounted the document-end Block, so this
  // caret is the fixed path's own subject, not a transient.
  expect(reached.lastChildIsSpacer, 'The settled window must have mounted the document-end Block').toBe(false);

  await drainKeys(page);
  await page.keyboard.press('Enter');
  await expectSource(source, before + separator);
  const entered = await settleWindow(page);

  const keys = await drainKeys(page);
  const enterBefore = keys.find((entry) => entry.phase === 'before'
    && entry.type === 'keydown' && entry.key === 'Enter');
  const enterAfter = keys.find((entry) => entry.phase === 'after'
    && entry.type === 'keydown' && entry.key === 'Enter');
  expect(enterBefore, 'Enter must be dispatched at the host document end').toMatchObject({
    anchorIsSurface: true,
    collapsed: true
  });
  expect(enterBefore.anchorOffset).toBe(enterBefore.childCount);
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
  await expectSource(source, before + separator + 'abc');
  const typed = await settleWindow(page);

  await expectSurfaceUsable(typed);
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

  await expectNoEditorFailure(page, failures);
});

test('windowed document end: Enter and typing with no pause keep every character in canonical source', async ({ page }) => {
  test.setTimeout(180_000);
  const { failures, source, visual } = await openWindowedVisual(page);
  await clickVisibleRow(visual);
  await settleWindow(page);

  const before = await source.inputValue();
  const separator = terminalSeparator(before);

  await drainKeys(page);
  // No wait, no read, no settle between these three gestures: the whole point
  // is that the fixed path owns the caret before the window catches up.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('abc');

  await expectSource(source, before + separator + 'abc');
  const typed = await settleWindow(page);

  const keys = await drainKeys(page);
  const enterBefore = keys.find((entry) => entry.phase === 'before'
    && entry.type === 'keydown' && entry.key === 'Enter');
  const enterAfter = keys.find((entry) => entry.phase === 'after'
    && entry.type === 'keydown' && entry.key === 'Enter');
  // Whether the window had already advanced or not, the caret Enter addressed
  // is the host end boundary; only the proof in that position may consume it.
  expect(enterBefore, 'Enter must be dispatched at the host document end').toMatchObject({
    anchorIsSurface: true,
    collapsed: true
  });
  expect(enterBefore.anchorOffset).toBe(enterBefore.childCount);
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
  await expectSurfaceUsable(typed);
  expect(typed.caret, 'The caret must be inside the new terminal paragraph').toMatchObject({
    inside: true,
    blockTag: 'P',
    blockIsDirectChild: true,
    blockIsLastChild: true,
    blockText: 'abc',
    blockTextLength: 3,
    textOffset: 3
  });

  await expectNoEditorFailure(page, failures);
});

// No negative case here, on purpose. The rule it would assert -
// `visual-editor-selection-map-failed` for plain text at a root-end caret while
// the document-end Block is unmounted - is owned by
// WindowedImmersiveVisualEditor.test.tsx ("rejects a root-end input while the
// document-end Block is unmounted"). In the browser that shape exists only
// between `Control+End` and the scroll-driven window advance that mounts the
// caret's own row, so a case here would race the window scheduler; see the
// accompanying report for the measurements.
