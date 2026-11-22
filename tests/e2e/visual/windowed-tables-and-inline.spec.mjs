import { expect, test } from '@playwright/test';
import {
  createPhasedPreviewOperationTracker,
  expectSource,
  expectWindowedSmokeCheckpoint,
  holdFormalPreview,
  openVisual,
  readPublicEditorState,
  readWindowedSmokeState,
  registerVisualEditingHooks,
  safePublicState
} from '../helpers/visual-editing-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

registerVisualEditingHooks();

for (const key of ['Backspace', 'Delete']) {
test(`windowed inline code retirement keeps source and history usable with ${key}`, async ({ page }) => {
  const initial = 'Before.\n\nTail `x`.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const withoutCode = initial.replace('`x`', '');
  const continued = withoutCode.replace('Tail ', 'Tail Y');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withoutCode], [initial], [withoutCode], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  expect(await visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  await visual.locator('p code').click();
  await page.keyboard.press('Home');
  for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
  if (key === 'Delete') await page.keyboard.press('ArrowLeft');
  if (key === 'Delete') {
    // This exact keyboard navigation reaches the Text outside the opening
    // code mark, as the independent beforeinput/Undo contract probe proved.
    const outside = await expectWindowedSmokeCheckpoint(visual, failures, 'inline-Delete-outside-initial-intent',
      { selector: ':scope > p', index: 1, codeBoundary: true }, 5);
    expect(outside).toMatchObject({ previewLoading: false,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  }
  await page.keyboard.press(key);
  expect(failures).toEqual([]);
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-retired`,
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  const originalCaret = key === 'Backspace' ? 16 : 14;
  const undone = await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Undo`,
    key === 'Backspace' ? { selector: 'p code' } : { selector: ':scope > p', index: 1, codeBoundary: true },
    key === 'Backspace' ? 1 : 5);
  if (key === 'Delete' && !undone.previewLoading) expect(undone).toMatchObject({
    nativeAnchor: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } },
    nativeFocus: { inlineCode: { insideCode: false, isBeforeCodeText: true, beforeCodeTextOffset: 5 } } });
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-Redo`,
    { selector: ':scope > p', index: 1 }, 5);
  await page.keyboard.type('Y');
  await expectSource(source, continued);
  await expectWindowedSmokeCheckpoint(visual, failures, `inline-${key}-continue-Y`,
    { selector: ':scope > p', index: 1 }, 6);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});
}

test('windowed inside CODE body-zero Delete restores its history and immediate code input', async ({ page }) => {
  // The inline code is the paragraph's first inline content. When a Text node
  // precedes the code, Chromium resolves the start-of-code boundary to that Text
  // node: a mouse click on the left part of the glyph, the ArrowLeft collapse of
  // a backward selection inside the code, and the same navigation in a plain
  // contenteditable host all land BEFORE the code (verified natively, without
  // this editor). Only a paragraph-initial code exposes a collapsed caret
  // genuinely inside the code body at offset 0, which is the state under test.
  const initial = 'Before.\n\n`x`Tail.suffix.\n\nAfter.\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n');
  const retired = initial.replace('`x`', '');
  const continued = initial.replace('`x`', '`Yx`');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [retired], [initial], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const code = visual.locator('p code');
  const originalText = await code.evaluateHandle(element => {
    if (!(element.firstChild instanceof Text) || element.firstChild.length !== 1) throw new Error('test-windowed-code-zero-original-text-missing');
    return element.firstChild;
  });
  const beforeNavigation = await readPublicEditorState(page);
  const target = { selector: 'p code', codeBoundary: true, originalCodeText: originalText, expectedSource: initial };
  const unchangedSetup = state => {
    expect(state.sourceLength).toBe(initial.length);
    expect(state).toMatchObject({ sourceMatchesExpected: true,
      nativeAnchor: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } },
      nativeFocus: { inlineCode: { codePresent: true, insideCode: true, sameOriginalCodeText: true } } });
    expect(beforeNavigation.nativeConnected).toBe(true);
  };
  try {
  // Home from inside a paragraph-initial code lands inside the code body at
  // offset 0; one ArrowRight steps to offset 1 (body-one) so the selection stage
  // below still starts inside the code.
  await code.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  const atOne = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-body-one', target, 1);
  unchangedSetup(atOne);
  await page.keyboard.press('Shift+ArrowLeft');
  const selected = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-selected-x',
    { ...target, focusOffset: 0 }, 1, 'backward');
  unchangedSetup(selected);
  await page.keyboard.press('ArrowLeft');
  const initialNative = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-keyboard-collapse-zero', target, 0);
  unchangedSetup(initialNative);
  // Pure navigation keeps the exact source and the real native caret inside
  // the code; Delete is gated on that observed DOM position.
  expect(initialNative.sourceMatchesExpected).toBe(true);
  await page.keyboard.press('Delete'); expect(failures).toEqual([]); await expectSource(source, retired);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-retired',
    { selector: ':scope > p', index: 1 }, 0);
  await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectSource(source, initial);
  await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-Undo',
    { selector: 'p code', codeBoundary: true }, 0);
  // No click, selection assignment or Preview wait follows Undo.
  await page.keyboard.type('Y'); expect(failures).toEqual([]); await expectSource(source, continued);
  const typed = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-immediate-Y',
    { selector: 'p code', codeBoundary: true }, 1);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, continued);
  await expect(visual).toHaveAttribute('aria-busy', 'false'); await expectSource(source, continued);
  const ready = await expectWindowedSmokeCheckpoint(visual, failures, 'inside-code-zero-final-ready',
    { selector: 'p code', codeBoundary: true }, 1);
  expect(ready).toMatchObject({ previewLoading: false,
    nativeAnchor: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } },
    nativeFocus: { bodyLength: 2, inlineCode: { codePresent: true, insideCode: true, codeBodyOffset: 1 } } });
  expect(await code.evaluate(element => element.textContent === 'Yx')).toBe(true);
  await previewRead.prove({ visual });
  } finally { await originalText.dispose(); }
});

test('windowed cross-row replacement keeps history and immediate pending input usable', async ({ page }) => {
  const initial = 'Alpha.\n\nBeta.\n\n~~~js\nvalue = 1;\n~~~\n\n'
    + Array.from({ length: 170 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const edited = initial.replace('Alpha.\n\nBeta.', 'AlQta.');
  const continued = edited.replace('AlQta.', 'AlQZta.');
  const continuedCode = continued.replace('value = 1;', 'vXalue = 1;');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [edited], [initial], [edited], [continued], [continuedCode]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect.poll(() => visual.locator('[data-easymde-preview-window-spacer]').count()).toBeGreaterThan(0);
  let release;
  let fetched = 0;
  const responsesSettled = [];
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    let done;
    responsesSettled.push(new Promise((resolve) => { done = resolve; }));
    let response;
    try {
      response = await route.fetch();
      fetched += 1;
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response?.dispose();
      done();
    }
  });
  try {
    const point = async (index) => visual.locator('p').nth(index).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(0);
    const last = await point(1);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-forward-native-intent',
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.type('Q');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Q', { selector: 'p' }, 3);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Undo',
      { selector: 'p', index: 0, focusIndex: 1, focusOffset: 2 }, 2, 'forward');
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, edited);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-Redo', { selector: 'p' }, 3);
    await page.keyboard.type('Z');
    expect(failures, 'immediate input after cross-row redo').toEqual([]);
    await expectSource(source, continued);
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-direct-Z', { selector: 'p' }, 4);
    await expect.poll(() => fetched).toBeGreaterThan(0);
    release();
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await visual.locator('pre code').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('X');
    await expectSource(source, continuedCode);
    const codeCaret = continuedCode.indexOf('vXalue = 1;') + 2;
    await expectWindowedSmokeCheckpoint(visual, failures, 'cross-row-code-direct-X',
      { selector: 'pre code' }, 2);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } finally {
    release();
    await Promise.all(responsesSettled);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('windowed held PHP history keeps complete math range through release and replacement Undo', async ({ page }) => {
  // Same-P complete-math selection: fixed source [1,14], not a three-block range.
  const tail = '\n\nTarget.\n\nAfter.';
  const initial = 'Before\n$x$\nAfter' + tail + '\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const typed = initial.replace(tail, '\n\nTarget.V\n\nAfter.');
  const selection = { start: 1, end: 14, direction: 'forward' };
  const replaced = initial.slice(0, selection.start) + 'X' + initial.slice(selection.end);
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [initial], [replaced], [initial]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await expect(visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, phase = 'initial-formal-window', lastAtom = null;
  const checkpoint = async (expected, pending = false) => {
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected });
      return lastAtom.sourceMatchesExpected && lastAtom.previewLoading === pending
        && (pending || lastAtom.phase === 'ready');
    }).toBe(true);
    expect(failures).toEqual([]);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    return lastAtom;
  };
  const unchangedOwner = async (before, { locked = false } = {}) => {
    const after = await readPublicEditorState(page);
    expect({
      sourceExact: after.source === before.source,
      sourceEditable: after.sourceEditable,
      visualEditable: after.visualEditable,
      nativeConnected: after.nativeConnected
    }).toEqual({
      sourceExact: true,
      sourceEditable: true,
      visualEditable: !locked,
      nativeConnected: true
    });
  };
  const nativeRange = async (measure = false) => visual.evaluate((surface, measure) => {
    const paragraphs = [...surface.querySelectorAll('p')].filter((p) => p.textContent.includes('Before') && p.textContent.includes('After'));
    if (paragraphs.length !== 1) throw new Error('test-windowed-math-paragraph-not-unique');
    const paragraph = paragraphs[0], maths = paragraph.querySelectorAll('.easymde-math[data-easymde-rendered]');
    if (maths.length !== 1) throw new Error('test-windowed-math-object-not-unique');
    const math = maths[0];
    const boundary = (needle, delta) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.easymde-math')) continue;
        const at = node.textContent.indexOf(needle);
        if (at >= 0) matches.push({ node, offset: at + delta });
      }
      if (matches.length !== 1) throw new Error('test-windowed-math-boundary-not-unique');
      return matches[0];
    };
    const start = boundary('Before', 1), end = boundary('After', 3);
    const point = ({ node, offset }) => {
      const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('test-windowed-math-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    };
    const native = getSelection(), range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
    const atom = document.createRange(); atom.selectNode(math);
    return { points: measure ? { start: point(start), end: point(end) } : null,
      proof: { anchorExact: native?.anchorNode === start.node && native.anchorOffset === start.offset,
        focusExact: native?.focusNode === end.node && native.focusOffset === end.offset,
        anchorOffset: native?.anchorOffset ?? null, focusOffset: native?.focusOffset ?? null,
        connected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        focused: document.activeElement === surface,
        forward: !!range && !native.isCollapsed && range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset,
        wholeMath: !!range && range.compareBoundaryPoints(Range.START_TO_START, atom) <= 0
          && range.compareBoundaryPoints(Range.END_TO_END, atom) >= 0
          && !math.contains(native.anchorNode) && !math.contains(native.focusNode) } };
  }, measure);
  const expectNativeRange = async () => {
    expect((await nativeRange()).proof).toEqual({ anchorExact: true, focusExact: true, anchorOffset: 1, focusOffset: 4,
      connected: true, focused: true, forward: true, wholeMath: true });
  };
  try {
    const baseline = await checkpoint(initial);
    phase = 'real-V-input'; await visual.locator('p').filter({ hasText: 'Target.' }).first().click();
    await page.keyboard.press('End'); await page.keyboard.type('V'); await expectSource(source, typed);
    expect(failures).toEqual([]);
    const beforeLock = await readPublicEditorState(page);
    expect(beforeLock.source === typed).toBe(true);
    // Explicit user preparation: a newly accepted V Preview makes the later
    // real Undo use a formal history transfer, not an ordinary input debounce.
    const formalV = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === typed; } catch { return false; }
    }).then((response) => response, () => null);
    phase = 'explicit-user-lock-and-formal-V'; await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(await sink.evaluate((surface) => surface.isContentEditable)).toBe(false);
    await unchangedOwner(beforeLock, { locked: true }); await expectSource(source, typed); expect(failures).toEqual([]);
    const response = await formalV; expect(response, 'The explicit lock must receive the real V PHP response').not.toBeNull();
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await unchangedOwner(beforeLock, { locked: true }); await expectSource(source, typed);
    phase = 'explicit-user-unlock'; await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint(typed); await unchangedOwner(beforeLock);
    phase = 'real-Undo-base-held-PHP'; held = await holdFormalPreview(page);
    await visual.locator('p').filter({ hasText: 'Target.V' }).first().click(); await page.keyboard.press('End');
    await page.keyboard.press('Control+z'); await expectSource(source, initial);
    await held.waitFor(initial); // Exact request, real PHP200 fetched, fulfillment still gated.
    const beforeDrag = await checkpoint(initial, true);
    expect(beforeDrag.sourceMatchesExpected).toBe(true);
    phase = 'real-complete-math-pointer-drag'; const { points } = await nativeRange(true);
    await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
    try { await page.mouse.move(points.end.x, points.end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    expect(failures).toEqual([]); await expectNativeRange();
    const dragged = await checkpoint(initial, true);
    expect(dragged.sourceMatchesExpected).toBe(true);
    // Pending canonical publication is observed, not forced. The completed
    // accepted tree must preserve the original fixed native/source range.
    phase = 'release-real-PHP-and-preserve-range'; await held.close(); held = null;
    const accepted = await checkpoint(initial); await expectNativeRange();
    expect(accepted.sourceMatchesExpected).toBe(true);
    phase = 'real-X-replacement'; await page.keyboard.type('X');
    const changed = await checkpoint(replaced);
    expect(changed.sourceMatchesExpected).toBe(true);
    expect(changed).toMatchObject({ nativeCollapsed: true, nativeAnchor: { connected: true, inside: true, parentTag: 'P', offset: 2 },
      nativeFocus: { connected: true, inside: true, parentTag: 'P', offset: 2 } });
    phase = 'real-Undo-replacement'; await page.keyboard.press('Control+z');
    const restored = await checkpoint(initial); await expectNativeRange();
    expect(restored.sourceMatchesExpected).toBe(true);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'windowed-held-math-first-failure', operation: phase,
      state: lastAtom ? { sourceLength: lastAtom.sourceLength, phase: lastAtom.phase,
        nativeCollapsed: lastAtom.nativeCollapsed } : null, failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

for (const timing of ['held', 'accepted']) {
test(`windowed nested table ${timing} PHP history keeps Enter and atomic Backspace exact`, async ({ page }) => {
  const padding = '\n\n' + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  const tableHead = '>   | Left | Right |\n>   | --- | --- |\n';
  const plainTable = tableHead + '>   | AB | CD |' + padding;
  const breakTable = tableHead + '>   | A<br>B | CD |' + padding;
  const baselineHead = '> - Before.\n>\n>   ```js\n>   retained();\n>   ```\n>\n>   After.\n>\n';
  const replacedHead = '> - BRfter.\n>\n';
  // Independent source fixtures, never derived from the current document or an edit map.
  const SourceFixture = { baseline: baselineHead + plainTable, replaced: replacedHead + plainTable,
    withBreak: replacedHead + breakTable };
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [SourceFixture.baseline], [SourceFixture.replaced], [SourceFixture.baseline],
        [SourceFixture.replaced], [SourceFixture.withBreak], [SourceFixture.replaced],
        [SourceFixture.withBreak], [SourceFixture.replaced]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, SourceFixture.baseline, undefined, previewRead.beforeFixture);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const cell = visual.locator('blockquote li table tbody td').first();
  let held = null, retainedNodes = null, receipts = null, phase = 'formal-code-baseline', lastAtom = null;
  let expectedSource = SourceFixture.baseline;
  let firstMergeDiagnostic = null;
  let firstCaseError = null;
  const cleanupResults = [];
  const tableDiagnostics = { pendingInput: null, sourceNavigation: null, tableNative: null, tableAdmission: null };
  let diagnosticOrdinal = 0;
  const captureTableDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.length > 16384) return;
    diagnosticOrdinal++;
    const parse = (json) => {
      try { const data = JSON.parse(json); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
      catch { return null; }
    };
    const observe = () => ({ operation: phase, consoleOrdinal: diagnosticOrdinal, parsed: false });
    const pick = (observation, data, integers, booleans, enums = {}, nullable = false) => {
      if (!data) return;
      observation.parsed = true;
      let invalidFieldCount = 0;
      for (const field of integers) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (Number.isSafeInteger(data[field]) && data[field] >= -1) observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const field of booleans) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        if (typeof data[field] === 'boolean') observation[field] = data[field];
        else invalidFieldCount++;
      }
      for (const [field, values] of Object.entries(enums)) {
        if (!Object.hasOwn(data, field)) continue;
        if (nullable && data[field] === null) { observation[field] = null; continue; }
        observation[field] = values.includes(data[field]) ? data[field] : 'unrecognized';
        if (observation[field] === 'unrecognized') invalidFieldCount++;
      }
      observation.invalidFieldCount = invalidFieldCount;
    };
    const inputTypes = ['insertText', 'insertReplacementText', 'insertLineBreak', 'insertParagraph', 'deleteByCut',
      'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'other'];
    const navigation = text.match(/visual-editor-window-source-navigation-dom-stale:([a-z0-9-]+)(?:$|;)/u);
    if (navigation) {
      if (tableDiagnostics.sourceNavigation) return;
      const reasons = ['capture-missing-row', 'capture-duplicate-row', 'capture-prior-binding',
        'mount-child-identity', 'mount-block-binding', 'mount-serialization', 'commit-block-binding',
        'commit-child-identity', 'commit-surrounding-block-stale', 'native-deletion-identity',
        'history-gap-child-identity', 'history-gap-presentation', 'history-gap-anchor',
        'pending-native-surrounding-stale', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
        'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
        'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
        'pending-table-surrounding-stale', 'composition-block-identity', 'history-text-replay', 'history-text-source',
        'history-text-block-binding', 'history-text-spelling', 'history-text-path'];
      tableDiagnostics.sourceNavigation = { operation: phase, consoleOrdinal: diagnosticOrdinal,
        reason: reasons.includes(navigation[1]) ? navigation[1] : 'unrecognized', reasonRecognized: reasons.includes(navigation[1]) };
      return;
    }
    const admission = text.match(/visual-editor-window-table-admission;(\{.*\})$/u);
    if (admission) {
      if (tableDiagnostics.tableAdmission) return;
      const observation = observe(), data = parse(admission[1]);
      tableDiagnostics.tableAdmission = observation;
      const tags = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'];
      pick(observation, data,
        ['row', 'column', 'caret', 'tableFrom', 'tableTo', 'sourceCellFrom', 'sourceCellTo', 'local', 'absolute',
          'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo', 'baselineLength', 'tableSourceLength'],
        ['nested', 'mapperReturned', 'projectionPresent'],
        { stage: ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
          'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner',
          'table-in-owner', 'cell-projection', 'cell-projection-bounds', 'nested-range'],
        ownerBlockTag: tags, tableRootTag: tags,
        errorCode: ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'] }, true);
      return;
    }
    const native = text.match(/visual-editor-window-table-native;(\{.*\})$/u);
    if (native) {
      if (tableDiagnostics.tableNative) return;
      const observation = observe(), data = parse(native[1]);
      tableDiagnostics.tableNative = observation;
      pick(observation, data,
        ['canonicalLength', 'sourceLength', 'liveCount', 'retainedCount', 'retainedMismatch', 'adjacentTexts',
          'expectedTexts', 'nativeRangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'proofIndex'],
        ['active', 'externalChange', 'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches',
          'historyMatches', 'rootEqual', 'removedConnected', 'nativeCollapsed', 'anchorConnected', 'anchorEquivalent',
          'focusEquivalent', 'rejectedBeforeInput', 'pendingComposition', 'composing', 'isComposing', 'inputTypeMatches', 'restored'],
        { stage: ['input-context-rejected', 'epoch-rejected', 'outcome-root', 'outcome-retained-count', 'outcome-retained-identity',
          'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus', 'rollback-source-diverged', 'rollback-restored'],
        capturedInputType: inputTypes, eventInputType: inputTypes });
      if (data && Object.hasOwn(data, 'adjacentTextIndexes')) {
        if (Array.isArray(data.adjacentTextIndexes) && data.adjacentTextIndexes.every((value) => Number.isSafeInteger(value) && value >= 0)) {
          observation.adjacentTextIndexCount = data.adjacentTextIndexes.length;
          observation.adjacentTextIndexes = data.adjacentTextIndexes.slice(0, 32);
          observation.adjacentTextIndexesTruncated = data.adjacentTextIndexes.length > 32;
        } else observation.invalidFieldCount++;
      }
      return;
    }
    const match = text.match(/visual-editor-window-(merge|pending-input):reason=([a-z0-9-]+);(\{.*\})$/u);
    if (!match || (match[1] === 'merge' ? firstMergeDiagnostic : tableDiagnostics.pendingInput)) return;
    const observation = observe(), data = parse(match[3]);
    if (match[1] === 'pending-input') {
      const reasons = ['lease-source', 'selection-bounds', 'canonical-deletion-unavailable', 'selection-deletion-not-cancelable',
        'canonical-lease-rejected', 'lease-selection-stale', 'lease-read-only', 'lease-gate-rejected',
        'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
        'lease-dom-read-only-snapshot-missing', 'lease-dom-read-only-region-mutated', 'lease-dom-unclassified',
        'pending-table-cell-unproved', 'row-serialization-failed', 'pending-table-source-epoch', 'pending-table-row-binding',
        'image-target-unproved', 'image-source-map-failed', 'target-probe-unavailable', 'restored-code-target-stale',
        'multiple-targets', 'target-range-mismatch', 'replacement-range-unsupported', 'restored-range-unowned',
        'shortcut-pre-root-missing', 'shortcut-serialization-empty', 'pending-code-deletion-rejected', 'unsupported-pending-input'];
      observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
      observation.reasonRecognized = reasons.includes(match[2]);
      tableDiagnostics.pendingInput = observation;
      pick(observation, data,
        ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'selectionStart', 'selectionEnd',
          'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth', 'rangeCount', 'anchorType',
          'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset', 'targetEndType',
          'targetEndOffset', 'liveChildren', 'acceptedChildren'],
        ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
          'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
          'targetStartConnected', 'targetEndConnected', 'childrenMatch'],
        { selectionDirection: ['none', 'forward', 'backward'], leaseDirection: ['none', 'forward', 'backward'], inputType: inputTypes });
      return;
    }
    const reasons = ['map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch',
      'unmapped-original-boundary', 'unclassified'];
    observation.reason = reasons.includes(match[2]) ? match[2] : 'unrecognized';
    firstMergeDiagnostic = observation;
    pick(observation, data,
      ['sourceStart', 'sourceEnd', 'baselineLength', 'editedLength', 'blockCount', 'canonicalLength', 'sourceLength',
        'mountedLength', 'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset'],
      ['structural', 'bodyInput', 'deletion', 'canonicalMatchesSource', 'mountedMatchesSource', 'leaseMatchesSource', 'focused'],
      { phase: ['unclassified', 'beforeinput-selection', 'commit-setup', 'commit-native-deletion-selection', 'commit-merge',
        'commit-selection', 'pending-code-merge', 'pending-code-selection', 'pending-native-serialization', 'pending-native-merge', 'pending-native-selection'] });
    if (data?.merge && typeof data.merge === 'object' && !Array.isArray(data.merge)) {
      observation.merge = {};
      for (const key of ['sourceLength', 'baselineLength', 'editedLength', 'visualStart', 'visualEnd', 'sourceStart', 'sourceEnd']) {
        if (Number.isSafeInteger(data.merge[key])) observation.merge[key] = data.merge[key];
      }
    }
  };
  const checkpoint = async (expected, pending, formal = false) => {
    expectedSource = expected;
    await expectSource(source, expected);
    await expect.poll(async () => {
      lastAtom = await readWindowedSmokeState(visual, { expectedSource: expected });
      return lastAtom.sourceMatchesExpected && (pending === undefined || lastAtom.previewLoading === pending)
        && (!formal || lastAtom.phase === 'ready');
    }).toBe(true);
    expect(lastAtom).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(lastAtom.spacers).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    return lastAtom;
  };
  const point = async (locator, text, offset) => locator.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
    if (matches.length !== 1) throw new Error('test-table-text-boundary-not-unique');
    const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.height <= 0) throw new Error('test-table-text-boundary-not-visible');
    return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
  }, { text, offset });
  const nativeCell = async () => cell.evaluate((element) => {
    const native = getSelection(), inside = !!native?.anchorNode && element.contains(native.anchorNode)
      && !!native.focusNode && element.contains(native.focusNode);
    const prefix = document.createRange(); prefix.selectNodeContents(element);
    if (inside) prefix.setEnd(native.anchorNode, native.anchorOffset); else prefix.collapse(true);
    return { connected: element.isConnected, inside, collapsed: native?.isCollapsed === true,
      prefixText: prefix.toString(), prefixBreaks: prefix.cloneContents().querySelectorAll('br').length,
      breaks: element.querySelectorAll('br').length, atB0: native?.anchorNode instanceof Text
        && native.anchorNode.data === 'B' && native.anchorOffset === 0 && native.focusNode === native.anchorNode && native.focusOffset === 0 };
  });
  const acceptThroughUserLock = async (expected) => {
    const before = await readPublicEditorState(page);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === expected; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise;
    expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(sink).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint(expected, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
    await expectSource(source, expected);
  };
  const expectEdit = async (expected) => {
    const state = await checkpoint(expected, timing === 'held' ? true : undefined);
    expect(await nativeCell()).toMatchObject({ inside: true, collapsed: true });
    return state;
  };
  // The shared observer retains refusal codes only; keep the first scalar payload locally, never raw console text.
  page.on('console', captureTableDiagnostic);
  try {
    await checkpoint(SourceFixture.baseline, false, true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(cell).toHaveText('AB');
    const before = visual.locator('blockquote li p').filter({ hasText: /^Before\.$/u });
    const after = visual.locator('blockquote li p').filter({ hasText: /^After\.$/u });
    const start = await point(before, 'Before.', 1), end = await point(after, 'After.', 1);
    phase = 'real-P-code-P-drag';
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    try { await page.mouse.move(end.x, end.y, { steps: 16 }); } finally { await page.mouse.up(); }
    const intent = await readWindowedSmokeState(visual, { selector: 'blockquote li p', index: 0, focusIndex: 1 });
    expect(intent).toMatchObject({ nativeCollapsed: false, nativeDirection: 'forward',
      nativeAnchor: { targetContains: true, bodyOffset: 1 }, nativeFocus: { targetContains: true, bodyOffset: 1 } });
    phase = 'real-R-cross-replacement';
    await page.keyboard.type('R');
    await expectSource(source, SourceFixture.replaced);
    const replacement = await readPublicEditorState(page);
    expect({ sourceExact: replacement.source === SourceFixture.replaced, nativeConnected: replacement.nativeConnected,
      nativeCollapsed: replacement.nativeCollapsed, editable: replacement.editable }).toEqual({
      sourceExact: true, nativeConnected: true, nativeCollapsed: true, editable: true });
    phase = 'formal-R-user-lock'; await acceptThroughUserLock(SourceFixture.replaced);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    phase = 'real-Undo-formal-code-baseline'; await page.keyboard.press('Control+z');
    await checkpoint(SourceFixture.baseline, false, true);
    expect(await source.inputValue() === SourceFixture.baseline).toBe(true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    retainedNodes = await visual.evaluateHandle((surface) => [...surface.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Redo-R-held-PHP'; await page.keyboard.press('Control+Shift+z');
    await expectSource(source, SourceFixture.replaced); await held.waitFor(SourceFixture.replaced);
    const pending = await checkpoint(SourceFixture.replaced, true);
    expect(pending.sourceMatchesExpected).toBe(true);
    expect(await visual.evaluate((surface, nodes) => nodes.length === surface.childNodes.length
      && nodes.every((node, index) => node === surface.childNodes[index]), retainedNodes)).toBe(true);
    await expect(visual.locator('blockquote li pre code')).toHaveCount(1);
    if (timing === 'accepted') {
      phase = 'accept-real-Redo-R'; await held.close(); held = null;
      await checkpoint(SourceFixture.replaced, false, true);
      await expect(visual.locator('blockquote li pre code')).toHaveCount(0);
    }
    receipts = await visual.evaluateHandle((surface) => {
      const events = [];
      const observe = (event) => {
        const native = getSelection(), element = native?.anchorNode?.parentElement?.closest('td');
        events.push({ trusted: event.isTrusted, inputType: event.inputType, collapsed: native?.isCollapsed === true,
          row: element?.parentElement?.rowIndex ?? null, column: element?.cellIndex ?? null,
          offset: native?.anchorOffset ?? null, ranges: event.getTargetRanges().length });
      };
      surface.addEventListener('beforeinput', observe, true);
      return { events, dispose: () => surface.removeEventListener('beforeinput', observe, true) };
    });
    phase = 'real-TD1-pointer'; const tdPoint = await point(cell, 'AB', 1);
    await page.mouse.click(tdPoint.x, tdPoint.y);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-table-Enter'; await page.keyboard.press('Enter');
    await expectEdit(SourceFixture.withBreak);
    expect(await receipts.evaluate((observer) => observer.events.find((event) => event.inputType === 'insertParagraph')))
      .toEqual({ trusted: true, inputType: 'insertParagraph', collapsed: true, row: 1, column: 0, offset: 1, ranges: 1 });
    if (timing === 'held') {
      phase = 'real-break-PHP200-still-withheld'; await held.waitFor(SourceFixture.withBreak);
      await checkpoint(SourceFixture.withBreak, true);
    } else {
      phase = 'formal-break-user-lock'; await acceptThroughUserLock(SourceFixture.withBreak);
      // A toolbar lock can move native focus. Restore the legal point with a real B0 click.
      phase = 'real-accepted-B0-pointer'; const b0 = await point(cell, 'B', 0);
      await page.mouse.click(b0.x, b0.y);
      expect(await nativeCell()).toMatchObject({ atB0: true });
      await checkpoint(SourceFixture.withBreak, false, true);
    }
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 1, breaks: 1 });
    phase = 'real-atomic-marker-Backspace'; await page.keyboard.press('Backspace');
    await expectEdit(SourceFixture.replaced);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true,
      prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    phase = 'real-Undo-marker-Backspace'; await page.keyboard.press('Control+z');
    await expectEdit(SourceFixture.withBreak);
    phase = 'real-Redo-marker-Backspace'; await page.keyboard.press('Control+Shift+z');
    await expectEdit(SourceFixture.replaced);
    if (held) { phase = 'release-final-table-PHP'; await held.close(); held = null; }
    await checkpoint(SourceFixture.replaced, false, true);
    expect(await nativeCell()).toMatchObject({ connected: true, inside: true, collapsed: true, prefixText: 'A', prefixBreaks: 0, breaks: 0 });
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } catch (error) {
    firstCaseError = error;
    // Direct page/owner reads never wait for a visual locator that failure teardown removed.
    const documentOwner = await readPublicEditorState(page)
      .then((owner) => ({ available: true, ...safePublicState(owner) }), () => ({ available: false }));
    const snapshot = await page.evaluate((expected) => {
      const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      const field = document.querySelector('#easymde-source');
      const native = document.getSelection();
      const tags = ['P', 'TD', 'TH', 'SPAN', 'CODE', 'EM', 'STRONG', 'DEL', 'A', 'ARTICLE', 'DIV', 'SECTION', 'LI', 'BLOCKQUOTE'];
      const point = (node, offset) => ({ connected: !!node?.isConnected,
        inside: !!surface && !!node && surface.contains(node), nodeType: node?.nodeType ?? null, offset,
        parentTag: tags.includes(node?.parentElement?.tagName) ? node.parentElement.tagName : 'unrecognized',
        textLength: node instanceof Text ? node.length : null });
      const rect = surface?.getBoundingClientRect();
      const x = Math.max(0, rect?.left ?? 0), y = Math.max(0, rect?.top ?? 0);
      const right = Math.min(innerWidth, rect?.right ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? 0);
      return { available: true, visualOwnerPresent: !!surface,
        sourceLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        sourceMatchesExpected: field instanceof HTMLTextAreaElement ? field.value === expected : null,
        expectedLength: expected.length, nativeCollapsed: native?.isCollapsed ?? null,
        nativeAnchor: point(native?.anchorNode, native?.anchorOffset ?? null),
        nativeFocus: point(native?.focusNode, native?.focusOffset ?? null),
        editable: surface?.getAttribute('contenteditable') ?? null,
        effectiveEditable: surface?.isContentEditable ?? null,
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        session: document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') ?? null,
        previewPhase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null,
        screenshotClip: right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null };
    }, expectedSource).catch(() => ({ available: false }));
    const screenshot = { available: false, attached: false };
    if (snapshot.available && snapshot.visualOwnerPresent && snapshot.screenshotClip) {
      try {
        const body = await page.screenshot({ clip: snapshot.screenshotClip, timeout: 2000 });
        await test.info().attach('table-history-first-failure', { body, contentType: 'image/png' });
        screenshot.available = true; screenshot.attached = true;
      } catch { screenshot.step = 'failure-screenshot'; }
    }
    console.log(JSON.stringify({ phase: 'windowed-table-first-failure', timing, operation: phase,
      state: { observedAfterFailure: true, documentOwner, snapshot }, preErrorCheckpoint: lastAtom,
      failures, mergeDiagnostic: firstMergeDiagnostic, pendingInputDiagnostic: tableDiagnostics.pendingInput,
      sourceNavigationDiagnostic: tableDiagnostics.sourceNavigation, tableNativeDiagnostic: tableDiagnostics.tableNative,
      tableAdmissionDiagnostic: tableDiagnostics.tableAdmission, failureScreenshot: screenshot }));
    throw error;
  } finally {
    const cleanup = async (step, operation) => {
      try { await operation(); cleanupResults.push({ step, completed: true }); }
      catch { cleanupResults.push({ step, completed: false }); }
    };
    // Release real withheld responses before any receipt/DOM-handle operation can fail.
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('console-listener-remove', () => page.off('console', captureTableDiagnostic));
    if (receipts) {
      await cleanup('receipt-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('receipt-handle-dispose', () => receipts.dispose());
    }
    if (retainedNodes) await cleanup('retained-handle-dispose', () => retainedNodes.dispose());
    const cleanupFailed = cleanupResults.some((result) => !result.completed);
    console.log(JSON.stringify({ phase: 'windowed-table-cleanup', timing, operation: phase,
      primaryErrorPresent: firstCaseError !== null, cleanupFailed, resources: cleanupResults }));
    if (cleanupFailed && firstCaseError === null) throw new Error('windowed-table-cleanup-failed');
  }
});
}

// Opt-in rich CODE acceptance; excluded from default registration and [short-stage].
if (process.env.EASYMDE_E2E_RICH_TABLE_CODE === 'complete') {
for (const timing of ['ready', 'held']) {
test(`[rich-table-code] windowed ${timing} fixed CODE Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\nAfter.\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Each real-BR-separated segment uses inherited Turndown code spelling. A/B need one backtick each.
  const SourceFixture = { S0: prefix + 'L `AB` R' + suffix, S1: prefix + 'L `A`<br>`B` R' + suffix,
    S1T: prefix + 'L `A`<br>`TB` R' + suffix, ST: prefix + 'L `ATB` R' + suffix,
    SV: prefix.replace(/^Lead\./u, 'Lead.V') + 'L `AB` R' + suffix };
  // Independent diagnostic candidates only; none can replace an edit oracle.
  const sourceCandidates = { joinedS0: 'L `AB` R', adjacentOriginalCodeSpansWithoutBR: 'L `A``B` R',
    sameGlyphWiderDelimiter: 'L ``AB`` R', spacedSpans: 'L `A` `B` R' };
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-code-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null, receipts = null, retainedNodes = null, phase = 'formal-S0', expectedKey = 'S0';
  let primaryError = null, lastObservation = null;
  const diagnostics = { merge: null, pending: null, admission: null, native: null, navigation: null };
  const observeDiagnostic = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text(); if (text.length > 16384) return;
    const match = text.match(/visual-editor-window-(merge|pending-input|table-admission|table-native|source-navigation-dom-stale)(?::reason=([a-z0-9-]+);|:([a-z0-9-]+)|;)(\{.*\})?$/u);
    if (!match) return;
    const family = { merge: 'merge', 'pending-input': 'pending', 'table-admission': 'admission',
      'table-native': 'native', 'source-navigation-dom-stale': 'navigation' }[match[1]];
    if (diagnostics[family]) return;
    const observation = { operation: phase, parsed: false };
    diagnostics[family] = observation;
    const reasons = ['pending-table-cell-unproved', 'pending-table-cell-proof-missing', 'pending-table-cell-snapshot-missing',
      'pending-table-wrapper-stale', 'pending-table-structure-stale', 'pending-table-target-cell-stale',
      'pending-table-protected-placement-stale', 'pending-table-retained-detached', 'pending-table-retained-binding',
      'pending-table-surrounding-stale', 'lease-source', 'selection-bounds', 'lease-selection-stale', 'lease-read-only',
      'lease-gate-rejected', 'lease-dom-mount-child-identity', 'lease-dom-mount-block-binding', 'lease-dom-mount-serialization',
      'map-snapshot-mismatch', 'unmapped-normalized-boundary', 'source-visual-slice-mismatch', 'unmapped-original-boundary', 'unclassified'];
    const reason = match[2] ?? match[3];
    if (reason) observation.reason = reasons.includes(reason) ? reason : 'unrecognized';
    if (!match[4]) return;
    let data; try { data = JSON.parse(match[4]); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    observation.parsed = true;
    for (const key of ['sourceLength', 'canonicalLength', 'mountedLength', 'leaseLength', 'transferLength', 'sourceStart', 'sourceEnd',
      'selectionStart', 'selectionEnd', 'leaseStart', 'leaseEnd', 'undoDepth', 'redoDepth', 'leaseUndoDepth', 'leaseRedoDepth',
      'rangeCount', 'anchorType', 'anchorOffset', 'focusType', 'focusOffset', 'targetCount', 'targetStartType', 'targetStartOffset',
      'targetEndType', 'targetEndOffset', 'liveChildren', 'acceptedChildren', 'row', 'column', 'caret', 'tableFrom', 'tableTo',
      'sourceCellFrom', 'sourceCellTo', 'local', 'absolute', 'ownerStart', 'ownerEnd', 'projectionFrom', 'projectionTo',
      'baselineLength', 'editedLength', 'blockCount', 'tableSourceLength']) {
      if (data[key] === null || Number.isSafeInteger(data[key])) observation[key] = data[key];
    }
    for (const key of ['eventAvailable', 'sourceMatchesLease', 'canonicalMatchesSource', 'canonicalMatchesLease', 'transferMatchesLease',
      'signatureMatches', 'focused', 'active', 'externalChange', 'pendingProp', 'anchorConnected', 'focusConnected',
      'targetStartConnected', 'targetEndConnected', 'childrenMatch', 'nested', 'mapperReturned', 'projectionPresent',
      'canonicalMatches', 'sourceMatches', 'revisionMatches', 'selectionMatches', 'historyMatches', 'nativeCollapsed']) {
      if (data[key] === null || typeof data[key] === 'boolean') observation[key] = data[key];
    }
    const nativeStageSchemas = {
      'target-shape': { numbers: ['startOffset', 'endOffset', 'startChildCount', 'endChildCount'],
        booleans: ['sameContainer'], tags: ['targetStartTag', 'targetEndTag'] },
      'target-content-certified': { booleans: ['certified'] },
      'target-facing-certified': { booleans: ['certified'] },
      'clone-target-path': { booleans: ['startResolved', 'endResolved'] },
      'merge-single-delete': { numbers: ['editCount', 'from', 'to', 'insertLength'] },
      'canonical-facing': { numbers: ['caret', 'caretFacing'], booleans: ['facingMatches'] },
      'removed-resolution': { numbers: ['resolvedIndex'], tags: ['startTag', 'endTag'] },
      'removed-parent': { booleans: ['removedIsBR', 'removedParentIsCell', 'removedParentIsContainer'], tags: ['removedParentTag'] }
    };
    const stages = ['lease', 'selection-bounds', 'parser-table', 'dom-cell-ordinal', 'source-cell', 'caret-in-cell',
      'table-caret-map-mismatch', 'capture', 'structure-target', 'owner-binding', 'caret-in-owner', 'table-in-owner',
      'cell-projection', 'cell-projection-bounds', 'nested-range', 'input-context-rejected', 'epoch-rejected', 'outcome-root',
      'outcome-retained-count', 'outcome-retained-identity', 'outcome-range', 'outcome-collapsed', 'outcome-anchor', 'outcome-focus',
      'rollback-source-diverged', 'rollback-restored', ...Object.keys(nativeStageSchemas)];
    if (Object.hasOwn(data, 'stage')) observation.stage = data.stage === null ? null : stages.includes(data.stage) ? data.stage : 'unrecognized';
    if (Object.hasOwn(data, 'stageEvidence')) {
      const schema = Object.hasOwn(nativeStageSchemas, data.stage) ? nativeStageSchemas[data.stage] : null;
      const evidence = data.stageEvidence;
      if (evidence === null) observation.stageEvidence = null;
      else {
        observation.stageEvidenceSchemaKnown = !!schema && !!evidence && typeof evidence === 'object' && !Array.isArray(evidence);
        if (observation.stageEvidenceSchemaKnown) {
          const safe = {};
          for (const key of schema.numbers ?? []) if (Number.isSafeInteger(evidence[key])) safe[key] = evidence[key];
          for (const key of schema.booleans ?? []) if (typeof evidence[key] === 'boolean') safe[key] = evidence[key];
          for (const key of schema.tags ?? []) if (Object.hasOwn(evidence, key)) {
            safe[key] = evidence[key] === null ? null
              : ['TD', 'TH', 'CODE', 'BR', 'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'MARK', 'SUB', 'SUP', 'P', 'DIV'].includes(evidence[key])
                ? evidence[key] : 'unrecognized';
          }
          observation.stageEvidence = safe;
        }
      }
    }
    if (Object.hasOwn(data, 'inputType')) observation.inputType = ['insertText', 'insertParagraph', 'insertLineBreak',
      'deleteContentBackward', 'deleteContentForward', 'other'].includes(data.inputType) ? data.inputType : 'unrecognized';
    for (const key of ['selectionDirection', 'leaseDirection']) if (Object.hasOwn(data, key)) {
      observation[key] = ['none', 'forward', 'backward'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    for (const key of ['ownerBlockTag', 'tableRootTag']) if (Object.hasOwn(data, key)) {
      observation[key] = ['BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'SECTION', 'DIV', 'ARTICLE'].includes(data[key]) ? data[key] : 'unrecognized';
    }
    if (Object.hasOwn(data, 'errorCode')) observation.errorCode = ['visual-editor-selection-map-failed', 'visual-editor-markdown-merge-ambiguous', 'other'].includes(data.errorCode) ? data.errorCode : 'unrecognized';
  };
  page.on('console', observeDiagnostic);
  const runtimeState = (key) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key] });
  const checkpoint = async (stage, key, pending, formal = false, point = null, renderRequired = true) => {
    phase = stage; expectedKey = key;
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      expect(failures).toEqual([]);
      const state = await runtimeState(key);
      return state.sourceMatchesExpected && (pending === undefined || state.previewLoading === pending)
        && (!formal || state.phase === 'ready');
    }).toBe(true);
    const state = await runtimeState(key), owner = await readPublicEditorState(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, expectedLength: SourceFixture[key].length, sourceDocLength: state.sourceLength,
      owner: { sourceLength: owner.sourceLength, editable: owner.effectiveEditable, nativeConnected: owner.nativeConnected },
      previewLoading: state.previewLoading, phase: state.phase, render,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled' };
    console.log(JSON.stringify({ event: 'rich-code-checkpoint', timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true,
      contenteditable: 'true', lock: 'false', session: 'ready' });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current.guardCellsExact).toBe(true);
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (renderRequired) expect(render.current).toMatchObject({ matchesExpectedText: true, matchesExpectedCodeGlyphs: true,
        expectedBreakCount: true, literalBrVisible: false });
      if (formal) expect(render.current.codeCount).toBe(key === 'S1' || key === 'S1T' ? 2 : 1);
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true,
        nativeInsideCode: true, codeGlyphOffset: point === 'right-T' || point === 'middle-T' ? 2 : 1,
        prefixBreaks: point === 'middle' || point === 'middle-T' ? 0 : 1,
        ...(point === 'right' ? { atRightB0: true } : {}) });
    }
    expect(failures).toEqual([]);
    return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readPublicEditorState(page);
    await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
  };
  const clickCode = async (text, offset) => {
    const code = cell.locator('code').filter({ hasText: new RegExp('^' + text + '$', 'u') });
    const point = await code.evaluate((element, target) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === target.text) matches.push(node);
      if (matches.length !== 1) throw new Error('rich-code-boundary-unproved');
      const range = document.createRange(); range.setStart(matches[0], target.offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-code-boundary-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, { text, offset });
    await page.mouse.click(point.x, point.y);
  };
  try {
    const loaded = await checkpoint('initial-formal-S0', 'S0', false, true);
    phase = 'loaded-unique-CODE-target';
    expect(SourceFixture.S0.length).toBe(2153);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    const loadedTarget = await cell.evaluate((target) => {
      const table = target.closest('table'), rows = [...(table?.tBodies[0]?.rows ?? [])];
      const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
      const codes = target.querySelectorAll('code');
      return { targetOrdinalExact: rows[1]?.cells[1] === target,
        headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
        guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
          && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
        targetTextExact: target.innerText === 'L AB R', codeCount: codes.length,
        codeGlyphsExact: codes.length === 1 && codes[0].textContent === 'AB',
        noBreaks: target.querySelectorAll('br').length === 0 };
    });
    console.log(JSON.stringify({ event: 'rich-code-loaded-prerequisite', timing, sourceExact: loaded.state.sourceMatchesExpected,
      sourceLength: loaded.state.sourceLength, ...loadedTarget }));
    expect(loaded.state.sourceMatchesExpected).toBe(true);
    expect(loadedTarget).toEqual({ targetOrdinalExact: true, headersExact: true, guardCellsExact: true,
      targetTextExact: true, codeCount: 1, codeGlyphsExact: true, noBreaks: true });
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click();
    await page.keyboard.press('End'); phase = 'real-Lead-V'; await page.keyboard.type('V');
    await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]);
    held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    receipts = await surface.evaluateHandle((root) => {
      let nativeEnter = null, nativeText = null, nativeBackspace = null;
      const events = [];
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const privateShape = () => {
        const cell = target(), rows = [...(root.querySelector('blockquote li table')?.tBodies[0]?.rows ?? [])];
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, text: cell?.innerText ?? '', codeText: [...(cell?.querySelectorAll('code') ?? [])].map((node) => node.textContent).join(''),
          breaks: cell?.querySelectorAll('br').length ?? 0, codeCount: cell?.querySelectorAll('code').length ?? 0,
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])) };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        const inputTypes = ['insertParagraph', 'insertLineBreak', 'insertText', 'deleteContentBackward', 'historyUndo', 'historyRedo'];
        if (events.length < 32) events.push({ type: event.type, inputType: inputTypes.includes(event.inputType) ? event.inputType : 'unrecognized', trusted: event.isTrusted });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...privateShape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText' && target()?.contains(getSelection()?.anchorNode)) nativeText = { ...privateShape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true);
      return { safe: (kind) => {
        const current = privateShape(), cell = target(), native = getSelection(), anchor = native?.anchorNode;
        const expected = kind === 'S1T' ? { text: 'L A\nTB R', glyphs: 'ATB', breaks: 1 }
          : kind === 'S1' ? { text: 'L A\nB R', glyphs: 'AB', breaks: 1 }
          : kind === 'ST' ? { text: 'L ATB R', glyphs: 'ATB', breaks: 0 } : { text: 'L AB R', glyphs: 'AB', breaks: 0 };
        const scalar = (shape) => ({ available: shape.available, textLength: shape.text.length, codeTextLength: shape.codeText.length,
          breaks: shape.breaks, codeCount: shape.codeCount, matchesExpectedText: shape.text === expected.text,
          matchesExpectedCodeGlyphs: shape.codeText === expected.glyphs, expectedBreakCount: shape.breaks === expected.breaks,
          literalBrVisible: shape.text.includes('<br>'), guardCellsExact: shape.guardCellsExact });
        const inside = !!cell && !!anchor && cell.contains(anchor) && !!native?.focusNode && cell.contains(native.focusNode);
        let codeGlyphOffset = null, prefixBreaks = null;
        if (inside) {
          const range = document.createRange(); range.selectNodeContents(cell); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents();
          codeGlyphOffset = [...fragment.querySelectorAll('code')].reduce((sum, node) => sum + node.textContent.length, 0);
          prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        const codeOf = (node) => (node instanceof Element ? node : node?.parentElement)?.closest('code') ?? null;
        const anchorCode = codeOf(anchor), focusCode = codeOf(native?.focusNode);
        const nativeInsideCode = !!anchorCode && !!cell?.contains(anchorCode) && anchorCode === focusCode;
        const sameCollapsedPoint = native?.isCollapsed === true && native.anchorNode === native.focusNode
          && native.anchorOffset === native.focusOffset;
        const domMatchesDeclaredS1 = kind === 'S1' && current.text === 'L A\nB R' && current.codeText === 'AB'
          && current.breaks === 1 && codeGlyphOffset === 1 && prefixBreaks === 1;
        const rightCodes = [...(cell?.querySelectorAll('code') ?? [])].filter((node) => node.parentElement === cell
          && node.textContent === 'B' && !node.querySelector('br'));
        const rightCode = rightCodes.length === 1 ? rightCodes[0] : null;
        const rightTexts = [];
        if (rightCode) {
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data === 'B') rightTexts.push(node);
        }
        const rightText = rightTexts.length === 1 ? rightTexts[0] : null;
        const transparent = (node) => node instanceof Element && ['SPAN', 'EM', 'STRONG', 'B', 'I', 'S', 'DEL', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        const proveRightStart = (node, offset) => {
          const proof = { kind: 'none', equivalent: false, withinRightCode: false, corridorForward: false,
            corridorNoText: false, corridorNoComment: false, corridorNoOpaque: false, rightTextReached: false };
          if (node instanceof Text && node.data === 'B' && offset === 0 && nativeInsideCode && inside) {
            return { ...proof, kind: 'text-zero', equivalent: true, withinRightCode: !!rightCode?.contains(node),
              corridorForward: true, corridorNoText: true, corridorNoComment: true, corridorNoOpaque: true,
              rightTextReached: node === rightText };
          }
          if (!rightCode || !rightText || !(node instanceof Element) || !rightCode.contains(node)
            || codeOf(node) !== rightCode || (node === rightCode ? offset !== 0 : !transparent(node))
            || rightCode.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]')) return proof;
          proof.withinRightCode = true;
          const point = document.createRange(), textStart = document.createRange();
          point.setStart(node, offset); point.collapse(true); textStart.setStart(rightText, 0); textStart.collapse(true);
          proof.corridorForward = point.compareBoundaryPoints(Range.START_TO_START, textStart) <= 0;
          proof.corridorNoText = true; proof.corridorNoComment = true; proof.corridorNoOpaque = true;
          // Inspect original nodes, not cloneContents' artificial empty Text at the B0 endpoint.
          // Requiring the entire CODE-start corridor also excludes hidden/protected ancestors before the point.
          const walker = document.createTreeWalker(rightCode, NodeFilter.SHOW_ALL);
          for (let part = walker.nextNode(); part; part = walker.nextNode()) {
            if (part === rightText) { proof.rightTextReached = true; break; }
            if (part.nodeType === Node.TEXT_NODE) proof.corridorNoText = false;
            else if (part.nodeType === Node.COMMENT_NODE) proof.corridorNoComment = false;
            else if (!transparent(part)) proof.corridorNoOpaque = false;
          }
          proof.equivalent = proof.corridorForward && proof.corridorNoText && proof.corridorNoComment
            && proof.corridorNoOpaque && proof.rightTextReached;
          proof.kind = proof.equivalent ? node === rightCode ? 'right-code-zero' : 'empty-phrasing-corridor' : 'none';
          return proof;
        };
        const anchorProof = proveRightStart(anchor, native?.anchorOffset ?? 0);
        const focusProof = proveRightStart(native?.focusNode, native?.focusOffset ?? 0);
        const semanticEquivalentRightStart = domMatchesDeclaredS1 && inside && nativeInsideCode && sameCollapsedPoint
          && anchorProof.equivalent && focusProof.equivalent;
        const rawPoint = (node, offset) => ({ nodeType: node?.nodeType ?? null,
          ownTag: node instanceof Element ? node.tagName : null, parentTag: node?.parentElement?.tagName ?? null,
          offset, connected: !!node?.isConnected });
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          currentTextEqualsNative: comparison ? current.text === comparison.text : null,
          currentCodeGlyphsEqualNative: comparison ? current.codeText === comparison.codeText : null,
          nativeConnected: !!anchor?.isConnected && !!native?.focusNode?.isConnected,
          nativeInsideCell: inside, nativeCollapsed: native?.isCollapsed === true,
          nativeInsideCode,
          codeGlyphOffset, prefixBreaks,
          nativeAnchor: rawPoint(anchor, native?.anchorOffset ?? 0), nativeFocus: rawPoint(native?.focusNode, native?.focusOffset ?? 0),
          atRightB0: semanticEquivalentRightStart, semanticEquivalentRightStart,
          rightStartProof: { sameCollapsedPoint, domMatchesDeclaredS1, rightCodeCandidateCount: rightCodes.length,
            rawTextB0: anchor instanceof Text && anchor.data === 'B' && native.anchorOffset === 0,
            anchor: anchorProof, focus: focusProof }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true); } };
    });
    await checkpoint('before-CODE-Enter', 'S0', timing === 'held');
    await clickCode('AB', 1);
    expect(await receipts.evaluate((observer) => observer.safe('S0'))).toMatchObject({ nativeConnected: true,
      nativeInsideCell: true, nativeCollapsed: true, nativeInsideCode: true, codeGlyphOffset: 1, prefixBreaks: 0 });
    const edit = async (stage, key, pending, formal = false, point = null, renderRequired = true) =>
      checkpoint(stage, key, pending, formal, point, renderRequired);
    phase = 'real-CODE-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('CODE-Enter', 'S1', timing === 'held' ? true : undefined, false, 'right', true);
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, matchesExpectedText: true,
      matchesExpectedCodeGlyphs: true, expectedBreakCount: true, literalBrVisible: false });
    if (timing === 'held') {
      await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, 'right');
    } else {
      await acceptFixed('S1'); await clickCode('B', 0);
      await edit('formal-S1-real-B0', 'S1', false, true, 'right', true);
    }
    phase = 'real-CODE-immediate-Backspace'; await page.keyboard.press('Backspace');
    await edit('CODE-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, 'middle', true);
    phase = 'real-Undo-CODE-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-CODE-Backspace-fixed-S1', 'S1', timing === 'held' ? true : undefined, false, null, false);
    phase = 'real-Redo-CODE-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-CODE-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, null, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', false, true, 'middle', true);
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-right-point', 'S1', false, true, 'right', true);
    phase = 'real-Undo-CODE-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', false, true, 'middle', true);
    phase = 'real-Redo-CODE-Enter'; await page.keyboard.press('Control+Shift+z');
    // No click/selection repair here: exercise the previously unverified Redo S1 native CODE boundary.
    await edit('Redo-Enter-formal-S1-right-point', 'S1', false, true, 'right', true);
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    await edit('right-span-fixed-S1T', 'S1T', undefined, false, 'right-T', true);
    await acceptFixed('S1T'); await clickCode('TB', 1);
    await edit('formal-S1T-real-TB-point', 'S1T', false, true, 'right-T', true);
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', false, true, 'right', true);
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', false, true, 'middle', true);
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    await edit('original-span-fixed-ST', 'ST', undefined, false, 'middle-T', true);
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', false, true, 'middle', true);
    expect(failures).toEqual([]);
  } catch (error) {
    primaryError = error;
    const owner = await readPublicEditorState(page)
      .then((value) => ({ available: true, ...safePublicState(value) }), () => ({ available: false }));
    const current = await page.evaluate(({ expected, prefix, suffix, candidates }) => {
      const field = document.querySelector('#easymde-source'), active = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
      // Actual strings stay private in this evaluation; emit exact-match booleans and a bounded enum only.
      const value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length
        && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      const candidateExact = Object.fromEntries(Object.entries(candidates).map(([kind, candidate]) => [kind, target !== null && target === candidate]));
      const classification = Object.keys(candidates).find((kind) => candidateExact[kind]) ?? 'other';
      return { available: true, sourceLength: value?.length ?? null,
        sourceExact: value === null ? null : value === expected, visualOwnerPresent: !!active,
        sourceClassification: { available: value !== null, outsideCellExact, targetExtractable: target !== null,
          classification, candidateExact },
        locked: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null };
    }, { expected: SourceFixture[expectedKey], prefix, suffix, candidates: sourceCandidates }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), expectedKey)
      .then((value) => ({ available: true, ...value }), () => ({ available: false })) : { available: false };
    // Read once at failure: do not wait for Preview publication or repair the native caret.
    const finalFormal = await runtimeState(expectedKey).then((state) => ({ available: true,
      phase: state.phase, previewLoading: state.previewLoading, sourceLength: state.sourceLength,
      sourceMatchesFixedOracle: state.sourceMatchesExpected }), () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-code-first-failure', timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, diagnostics }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-console-remove', () => page.off('console', observeDiagnostic));
    if (receipts) { await cleanup('rich-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-code-cleanup', timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-code-cleanup-failed');
  }
});
}
}

// Opt-in non-CODE rich cells. Keep the separately frozen CODE acceptance unchanged.
if (process.env.EASYMDE_E2E_RICH_TABLE_INLINE === 'complete') {
const richInlineHref = 'https://example.com/rich?q=1&v=2';
const richInlineCases = [
  { kind: 'A', selector: 'a', chain: ['A'], before: 'L [', after: `](${richInlineHref} "Keep") R`, linked: true },
  { kind: 'EM', selector: 'em', chain: ['EM'], before: 'L *', after: '* R', linked: false },
  { kind: 'STRONG', selector: 'strong', chain: ['STRONG'], before: 'L **', after: '** R', linked: false },
  { kind: 'DEL', selector: 'del, s, strike', chain: ['DEL'], before: 'L ~~', after: '~~ R', linked: false },
  { kind: 'NESTED', selector: 'em', chain: ['STRONG', 'A', 'DEL', 'EM'], before: 'L **[~~*',
    after: `*~~](${richInlineHref} "Keep")** R`, linked: true }
];
for (const inline of richInlineCases) {
for (const timing of ['ready', 'held']) {
test(`[rich-table-inline] windowed ${timing} fixed ${inline.kind} Enter Backspace history and right-span continuation`, async ({ page }) => {
  const prefix = 'Lead.\n\n> - Keep.\n>\n>   | Left | Target | Right |\n>   | :--- | :---: | ---: |\n'
    + '>   | up | guard | end |\n>   | left | ';
  const suffix = ' | right |\n>   | down | guard | end |\n\n'
    + 'After \\*literal\\* **outside** *emphasis* [keep](https://example.com/keep?q=1&v=2 "Guard").\n\n'
    + Array.from({ length: 161 }, (_, index) => `Filler ${index + 1}.`).join('\n\n');
  // Fixed semantic contract: unlike CODE, these wrappers contain the real BR without splitting/normalizing tags.
  // Every oracle is built only from these declared fragments, never from native DOM or a PHP response.
  const bodies = { S0: 'AB', S1: 'A<br>B', S1T: 'A<br>TB', ST: 'ATB' };
  const targetSource = Object.fromEntries(Object.entries(bodies).map(([key, body]) => [key, inline.before + body + inline.after]));
  const SourceFixture = Object.fromEntries(Object.entries(targetSource).map(([key, value]) => [key, prefix + value + suffix]));
  SourceFixture.SV = prefix.replace(/^Lead\./u, 'Lead.V') + targetSource.S0 + suffix;
  const { failures, source, visual } = await openVisual(page, SourceFixture.S0);
  const surface = await visual.elementHandle();
  if (!surface) throw new Error('rich-inline-surface-unavailable');
  const cell = visual.locator('blockquote li table tbody tr').nth(1).locator('td').nth(1);
  const lock = page.locator('.easymde-immersive-preview-lock');
  const browserErrors = { pageErrors: 0, popups: 0, dialogs: 0 };
  const onPageError = () => { browserErrors.pageErrors++; };
  const onPopup = () => { browserErrors.popups++; };
  const onDialog = (dialog) => { browserErrors.dialogs++; void dialog.dismiss().catch(() => {}); };
  page.on('pageerror', onPageError); page.on('popup', onPopup); page.on('dialog', onDialog);
  let phase = 'initial-formal-S0', expectedKey = 'S0', held = null, retainedNodes = null, receipts = null;
  let primaryError = null, lastObservation = null;
  const healthy = () => { expect(failures).toEqual([]); expect(browserErrors).toEqual({ pageErrors: 0, popups: 0, dialogs: 0 }); };
  const runtimeState = (key) => readWindowedSmokeState(surface, { expectedSource: SourceFixture[key] });
  const checkpoint = async (stage, key, pending, formal = false, point = false, renderRequired = true) => {
    phase = stage; expectedKey = key; healthy();
    await expectSource(source, SourceFixture[key]);
    await expect.poll(async () => {
      healthy(); const state = await runtimeState(key);
      return state.sourceMatchesExpected && (pending === undefined || state.previewLoading === pending)
        && (!formal || state.phase === 'ready');
    }).toBe(true);
    const state = await runtimeState(key), owner = await readPublicEditorState(page);
    const render = receipts ? await receipts.evaluate((observer, kind) => observer.safe(kind), key === 'SV' ? 'S0' : key) : null;
    lastObservation = { stage, fixedOracle: key, sourceExact: state.sourceMatchesExpected, sourceLength: state.sourceLength,
      owner: { sourceLength: owner.sourceLength, editable: owner.effectiveEditable, nativeConnected: owner.nativeConnected },
      phase: state.phase, previewLoading: state.previewLoading,
      presentation: renderRequired ? 'render-checked' : 'history-presentation-observed-not-oracled', render, browserErrors: { ...browserErrors } };
    console.log(JSON.stringify({ event: 'rich-inline-checkpoint', kind: inline.kind, timing, ...lastObservation }));
    expect(state).toMatchObject({ runtimeEditable: true, documentEditable: true, effectiveEditable: true, contenteditable: 'true',
      lock: 'false', session: 'ready' });
    expect(state.spacers).toBeGreaterThan(0);
    if (render) {
      expect(render.current).toMatchObject({ available: true, tableUnique: true, targetUnique: true, headersExact: true,
        guardCellsExact: true, leafCount: 1, chainExact: true, linkAttributesExact: true, leafEditable: true, codeCount: 0 });
      if (renderRequired) expect(render.current).toMatchObject({ textExact: true, glyphsExact: true, breakCountExact: true,
        breakInsideLeaf: true, literalBrVisible: false });
      if (!renderRequired) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeCollapsed: true });
      if (point) expect(render).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: key === 'S1T' || key === 'ST' ? 2 : 1,
        prefixBreaks: key === 'S1' || key === 'S1T' ? 1 : 0 });
    }
    healthy(); return { state, owner, render };
  };
  const acceptFixed = async (key) => {
    const before = await readPublicEditorState(page); await expectSource(source, SourceFixture[key]);
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (!(url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')) return false;
      try { return response.request().postDataJSON()?.markdown === SourceFixture[key]; } catch { return false; }
    });
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const response = await responsePromise; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
    await expect(page.locator('[data-easymde-preview-html-sink]')).toHaveAttribute('aria-busy', 'false');
    await lock.click(); await expect(lock).toHaveAttribute('aria-pressed', 'false');
    await checkpoint('formal-' + key, key, false, true);
    const after = await readPublicEditorState(page);
    expect({ sourceExact: after.source === before.source, nativeConnected: after.nativeConnected,
      effectiveEditable: after.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, effectiveEditable: true });
  };
  const clickBeforeB = async () => {
    const point = await cell.evaluate((target, selector) => {
      const leaves = target.querySelectorAll(selector);
      if (leaves.length !== 1) throw new Error('rich-inline-pointer-leaf-not-unique');
      const walker = document.createTreeWalker(leaves[0], NodeFilter.SHOW_TEXT), matches = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let index = 0; index < node.data.length; index++) if (node.data[index] === 'B') matches.push({ node, offset: index });
      }
      if (matches.length !== 1) throw new Error('rich-inline-pointer-B-not-unique');
      const range = document.createRange(); range.setStart(matches[0].node, matches[0].offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0) throw new Error('rich-inline-pointer-not-visible');
      return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
    }, inline.selector);
    await page.mouse.click(point.x, point.y);
  };
  try {
    await checkpoint('initial-formal-S0', 'S0', false, true);
    await expect(visual.locator('blockquote li table')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody')).toHaveCount(1);
    await expect(visual.locator('blockquote li table tbody tr')).toHaveCount(3);
    await expect(cell).toHaveCount(1);
    receipts = await surface.evaluateHandle((root, spec) => {
      const events = []; let nativeEnter = null, nativeText = null, nativeBackspace = null;
      let readyNavigationBaseline = null, rootInputEvents = 0, rootHistoryKeys = 0;
      const readReadyIdentity = () => {
        const container = document.querySelector('#easymde-editor-root');
        const field = document.querySelector('#easymde-source');
        const native = getSelection();
        const point = (node, offset) => ({
          connected: !!node?.isConnected,
          nodeType: node?.nodeType ?? null,
          parentTag: node?.parentElement?.tagName ?? null,
          offset
        });
        const value = field instanceof HTMLTextAreaElement ? field.value : null;
        return { container, surface: root, field, value, nodes: [...root.childNodes],
          ready: root.getAttribute('data-easymde-preview-phase') === 'ready'
            && document.querySelector('[data-easymde-session-status]')?.getAttribute('data-easymde-session-status') === 'ready'
            && root.isConnected && root.isContentEditable,
          nativeConnected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
            && root.contains(native.anchorNode) && root.contains(native.focusNode),
          nativeCollapsed: native?.isCollapsed === true,
          selectionJSON: JSON.stringify({ anchor: point(native?.anchorNode, native?.anchorOffset ?? 0),
            focus: point(native?.focusNode, native?.focusOffset ?? 0) }),
          rootInputEvents, rootHistoryKeys };
      };
      const target = () => root.querySelector('blockquote li table tbody')?.rows[1]?.cells[1] ?? null;
      const shape = () => {
        const cell = target(), tables = root.querySelectorAll('blockquote li table'), table = tables.length === 1 ? tables[0] : null;
        const rows = [...(table?.tBodies[0]?.rows ?? [])], leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])];
        const leaf = leaves.length === 1 ? leaves[0] : null, chain = [], links = [...(cell?.querySelectorAll('a') ?? [])];
        for (let node = leaf; node && node !== cell; node = node.parentElement) {
          if (node.tagName !== 'SPAN') chain.unshift(['S', 'STRIKE'].includes(node.tagName) ? 'DEL' : node.tagName);
        }
        const guards = [['up', 'guard', 'end'], ['left', null, 'right'], ['down', 'guard', 'end']];
        return { available: !!cell, tableUnique: tables.length === 1, targetUnique: rows[1]?.cells[1] === cell,
          headersExact: [...(table?.tHead?.rows[0]?.cells ?? [])].map((node) => node.textContent).join('|') === 'Left|Target|Right',
          guardCellsExact: rows.length === 3 && rows.every((row, index) => row.cells.length === 3
            && [...row.cells].every((node, column) => guards[index][column] === null || node.textContent === guards[index][column])),
          text: cell?.innerText ?? '', glyphs: leaf?.textContent ?? '', breaks: cell?.querySelectorAll('br').length ?? 0,
          leafBreaks: leaf?.querySelectorAll('br').length ?? 0, leafCount: leaves.length,
          chainExact: chain.length === spec.chain.length && chain.every((tag, index) => tag === spec.chain[index]),
          linkAttributesExact: spec.linked ? links.length === 1 && links[0].getAttribute('href') === spec.href
            && links[0].getAttribute('title') === 'Keep' : links.length === 0,
          leafEditable: leaf?.isContentEditable === true, codeCount: cell?.querySelectorAll('code').length ?? 0 };
      };
      const observe = (event) => {
        if (!(event.target instanceof Node) || !root.contains(event.target)) return;
        if (event.type === 'keydown') {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) rootHistoryKeys++;
          return;
        }
        rootInputEvents++;
        const cell = target(), selection = getSelection();
        if (!cell?.contains(selection?.anchorNode)) return;
        const types = ['insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'insertText', 'historyUndo', 'historyRedo'];
        if (events.length < 40) events.push({ type: event.type, inputType: types.includes(event.inputType) ? event.inputType : 'unrecognized',
          trusted: event.isTrusted, collapsed: selection?.isCollapsed === true });
        if (event.type !== 'input') return;
        if ((event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') && !nativeEnter) nativeEnter = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'deleteContentBackward') nativeBackspace = { ...shape(), trusted: event.isTrusted };
        if (event.inputType === 'insertText') nativeText = { ...shape(), trusted: event.isTrusted };
      };
      document.addEventListener('beforeinput', observe, true); document.addEventListener('input', observe, true); document.addEventListener('keydown', observe, true);
      return {
        captureReadyNavigation: (expectedSource) => {
          const before = readReadyIdentity(); readyNavigationBaseline = { ...before, expectedSource };
          return { ready: before.ready, sourceExact: before.value === expectedSource,
            nativeConnected: before.nativeConnected, nativeCollapsed: before.nativeCollapsed,
            nodesCurrent: before.nodes.every((node) => node.isConnected) };
        },
        checkReadyNavigation: () => {
          if (!readyNavigationBaseline) throw new Error('rich-inline-ready-baseline-unavailable');
          const before = readyNavigationBaseline, after = readReadyIdentity();
          return { readyBeforeAndAfter: before.ready && after.ready,
            sameSurface: after.surface === before.surface && after.container === before.container,
            sourceExact: before.value === before.expectedSource && after.value === before.expectedSource,
            fieldMatchesOwner: after.field === before.field && after.value === before.value,
            nativeConnected: before.nativeConnected && after.nativeConnected,
            nativeCollapsed: before.nativeCollapsed && after.nativeCollapsed,
            selectionRetained: after.selectionJSON === before.selectionJSON,
            nodesUnchanged: after.nodes.length === before.nodes.length && after.nodes.every((node, index) => node === before.nodes[index]),
            noInputEvents: after.rootInputEvents === before.rootInputEvents, noHistoryKeys: after.rootHistoryKeys === before.rootHistoryKeys };
        },
        safe: (kind) => {
        const current = shape(), cell = target(), leaves = [...(cell?.querySelectorAll(spec.selector) ?? [])], leaf = leaves.length === 1 ? leaves[0] : null;
        const native = getSelection(), anchor = native?.anchorNode, focus = native?.focusNode;
        const glyphs = kind === 'S1T' || kind === 'ST' ? 'ATB' : 'AB';
        const breaks = kind === 'S1' || kind === 'S1T' ? 1 : 0;
        const expectedText = kind === 'S1T' ? 'L A\nTB R' : kind === 'S1' ? 'L A\nB R' : kind === 'ST' ? 'L ATB R' : 'L AB R';
        const scalar = (value) => ({ available: value.available, tableUnique: value.tableUnique, targetUnique: value.targetUnique,
          headersExact: value.headersExact, guardCellsExact: value.guardCellsExact, leafCount: value.leafCount, chainExact: value.chainExact,
          linkAttributesExact: value.linkAttributesExact, leafEditable: value.leafEditable, codeCount: value.codeCount,
          textLength: value.text.length, glyphLength: value.glyphs.length, breaks: value.breaks,
          textExact: value.text === expectedText, glyphsExact: value.glyphs === glyphs, breakCountExact: value.breaks === breaks,
          breakInsideLeaf: value.leafBreaks === value.breaks, literalBrVisible: value.text.includes('<br>') });
        const insideCell = !!cell && !!anchor && !!focus && cell.contains(anchor) && cell.contains(focus);
        const insideLeaf = !!leaf && !!anchor && !!focus && leaf.contains(anchor) && leaf.contains(focus);
        const sameCollapsedPoint = native?.isCollapsed === true && anchor === focus && native.anchorOffset === native.focusOffset;
        const bPoints = [];
        if (leaf) {
          const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (let offset = 0; offset < node.data.length; offset++) if (node.data[offset] === 'B') bPoints.push({ node, offset });
          }
        }
        const targetPoint = bPoints.length === 1 ? bPoints[0] : null;
        const transparent = (node) => node instanceof Element
          && ['A', 'EM', 'STRONG', 'B', 'I', 'DEL', 'S', 'STRIKE', 'SPAN', 'MARK', 'SUB', 'SUP'].includes(node.tagName)
          && !node.matches('[contenteditable], [hidden], [inert], [aria-hidden="true"], [role], [tabindex]');
        let rank = 0, targetRank = null, anchorRank = null, focusRank = null;
        const record = (node, offset, value) => {
          if (targetPoint?.node === node && targetPoint.offset === offset) targetRank = value;
          if (anchor === node && native.anchorOffset === offset) anchorRank = value;
          if (focus === node && native.focusOffset === offset) focusRank = value;
        };
        const visit = (node) => {
          if (node instanceof Text) {
            for (let offset = 0; offset <= node.data.length; offset++) record(node, offset, rank + offset);
            rank += Math.max(1, node.data.length); return;
          }
          // BR/comment/opaque nodes carry a nonzero token: equivalence cannot cross any of them.
          if (!transparent(node)) { rank++; return; }
          record(node, 0, rank);
          [...node.childNodes].forEach((child, index) => { visit(child); record(node, index + 1, rank); });
        };
        if (leaf) visit(leaf);
        const forward = (node, offset) => {
          if (!targetPoint || !node || !leaf?.contains(node)) return false;
          const actual = document.createRange(), expected = document.createRange();
          actual.setStart(node, offset); actual.collapse(true); expected.setStart(targetPoint.node, targetPoint.offset); expected.collapse(true);
          return actual.compareBoundaryPoints(Range.START_TO_START, expected) <= 0;
        };
        const anchorForward = forward(anchor, native?.anchorOffset ?? 0), focusForward = forward(focus, native?.focusOffset ?? 0);
        const noObservableTokenBetween = targetRank !== null && anchorRank === targetRank && focusRank === targetRank;
        const semanticBeforeB = insideLeaf && sameCollapsedPoint && bPoints.length === 1 && anchorForward && focusForward && noObservableTokenBetween;
        let bodyGlyphPrefix = null, prefixBreaks = null;
        if (insideLeaf) {
          const range = document.createRange(); range.selectNodeContents(leaf); range.setEnd(anchor, native.anchorOffset);
          const fragment = range.cloneContents(); bodyGlyphPrefix = fragment.textContent.length; prefixBreaks = fragment.querySelectorAll('br').length;
        }
        const raw = (node, offset) => ({ nodeType: node?.nodeType ?? null, ownTag: node instanceof Element ? node.tagName : null,
          parentTag: node?.parentElement?.tagName ?? null, offset, connected: !!node?.isConnected });
        const comparison = kind === 'S1' ? nativeEnter : kind === 'S1T' || kind === 'ST' ? nativeText : nativeBackspace;
        return { current: scalar(current), nativeEnter: nativeEnter ? { ...scalar(nativeEnter), trusted: nativeEnter.trusted } : null,
          nativeText: nativeText ? { ...scalar(nativeText), trusted: nativeText.trusted } : null,
          nativeBackspace: nativeBackspace ? { ...scalar(nativeBackspace), trusted: nativeBackspace.trusted } : null,
          matchesNativeText: comparison ? current.text === comparison.text : null, matchesNativeGlyphs: comparison ? current.glyphs === comparison.glyphs : null,
          nativeConnected: !!anchor?.isConnected && !!focus?.isConnected, nativeInsideCell: insideCell, nativeInsideLeaf: insideLeaf,
          nativeCollapsed: native?.isCollapsed === true, nativeAnchor: raw(anchor, native?.anchorOffset ?? 0), nativeFocus: raw(focus, native?.focusOffset ?? 0),
          bodyGlyphPrefix, prefixBreaks, semanticBeforeB,
          boundaryProof: { leafUnique: leaves.length === 1, bTextUnique: bPoints.length === 1, sameCollapsedPoint,
            targetRank, anchorRank, focusRank, anchorForward, focusForward, noObservableTokenBetween,
            rawTextBeforeB: !!targetPoint && anchor === targetPoint.node && native.anchorOffset === targetPoint.offset }, events: events.slice() };
      }, dispose: () => { document.removeEventListener('beforeinput', observe, true); document.removeEventListener('input', observe, true);
        document.removeEventListener('keydown', observe, true); readyNavigationBaseline = null; } };
    }, { selector: inline.selector, chain: inline.chain, linked: inline.linked, href: richInlineHref });
    await checkpoint('loaded-unique-rich-target', 'S0', false, true);
    await visual.locator('p').filter({ hasText: /^Lead\.$/u }).first().click(); await page.keyboard.press('End');
    phase = 'real-Lead-V'; await page.keyboard.type('V'); await expectSource(source, SourceFixture.SV); await acceptFixed('SV');
    await visual.locator('p').filter({ hasText: /^Lead\.V$/u }).first().click(); await page.keyboard.press('End');
    retainedNodes = await surface.evaluateHandle((root) => [...root.childNodes]); held = await holdFormalPreview(page);
    phase = 'real-Undo-V-held-S0'; await page.keyboard.press('Control+z');
    await expectSource(source, SourceFixture.S0); await held.waitFor(SourceFixture.S0);
    await checkpoint('real-S0-PHP200-withheld', 'S0', true);
    expect(await surface.evaluate((root, nodes) => root.childNodes.length === nodes.length
      && nodes.every((node, index) => root.childNodes[index] === node), retainedNodes)).toBe(true);
    if (timing === 'ready') { await held.close(); held = null; await checkpoint('released-formal-S0', 'S0', false, true); }
    await checkpoint('before-rich-Enter', 'S0', timing === 'held');
    if (timing === 'ready') {
      phase = 'capture-ready-pre-navigation';
      const before = await receipts.evaluate((observer, expected) => observer.captureReadyNavigation(expected), SourceFixture.S0);
      console.log(JSON.stringify({ event: 'rich-inline-ready-pre-navigation', kind: inline.kind, timing, before }));
      expect(before).toMatchObject({ ready: true, sourceExact: true, nativeConnected: true,
        nativeCollapsed: true, nodesCurrent: true });
    }
    await clickBeforeB();
    await checkpoint('real-initial-before-B', 'S0', timing === 'held', timing === 'ready', true);
    const beforeB = await readPublicEditorState(page);
    expect({ sourceExact: beforeB.source === SourceFixture.S0, nativeConnected: beforeB.nativeConnected,
      nativeCollapsed: beforeB.nativeCollapsed, effectiveEditable: beforeB.effectiveEditable }).toEqual({
      sourceExact: true, nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
    if (timing === 'ready') {
      const evidence = await receipts.evaluate((observer) => ({ certificate: observer.checkReadyNavigation(),
        native: observer.safe('S0') }));
      console.log(JSON.stringify({ event: 'rich-inline-ready-native-first', kind: inline.kind, timing, ...evidence }));
      expect(evidence.certificate).toMatchObject({ readyBeforeAndAfter: true, sameSurface: true,
        sourceExact: true, fieldMatchesOwner: true, nativeConnected: true, nativeCollapsed: true,
        selectionRetained: true, nodesUnchanged: true, noInputEvents: true, noHistoryKeys: true });
      expect(evidence.native).toMatchObject({ nativeConnected: true, nativeInsideCell: true, nativeInsideLeaf: true,
        nativeCollapsed: true, semanticBeforeB: true, bodyGlyphPrefix: 1, prefixBreaks: 0,
        current: { tableUnique: true, targetUnique: true, leafCount: 1, chainExact: true, linkAttributesExact: true,
          leafEditable: true, textExact: true, glyphsExact: true, breakCountExact: true, guardCellsExact: true } });
    } else {
      const heldBeforeB = await readPublicEditorState(page);
      expect({ sourceExact: heldBeforeB.source === SourceFixture.S0, nativeConnected: heldBeforeB.nativeConnected,
        nativeCollapsed: heldBeforeB.nativeCollapsed }).toEqual({
        sourceExact: true, nativeConnected: true, nativeCollapsed: true });
    }
    const edit = async (stage, key, pending, formal = false, point = true, renderRequired = true) =>
      checkpoint(stage, key, pending, formal, point, renderRequired);
    phase = 'real-rich-Enter'; await page.keyboard.press('Enter');
    const entered = await edit('rich-Enter-fixed-S1', 'S1', timing === 'held' ? true : undefined);
    expect(entered.render.nativeEnter).toMatchObject({ trusted: true, textExact: true, glyphsExact: true, breakCountExact: true,
      breakInsideLeaf: true, chainExact: true, linkAttributesExact: true });
    if (timing === 'held') { await held.waitFor(SourceFixture.S1); await checkpoint('real-S1-PHP200-still-withheld', 'S1', true, false, true); }
    else { await acceptFixed('S1'); await clickBeforeB(); await edit('formal-S1-real-before-B', 'S1', false, true); }
    phase = 'real-rich-Backspace'; await page.keyboard.press('Backspace');
    const deleted = await edit('rich-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined);
    expect(deleted.render.nativeBackspace).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      breakCountExact: true, chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-rich-Backspace'; await page.keyboard.press('Control+z');
    await edit('Undo-rich-Backspace-fixed-S1', 'S1', timing === 'held' ? true : undefined, false, false, false);
    phase = 'real-Redo-rich-Backspace'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-rich-Backspace-fixed-S0', 'S0', timing === 'held' ? true : undefined, false, false, false);
    if (held) { await held.close(); held = null; }
    await edit('released-formal-S0', 'S0', false, true);
    phase = 'real-Undo-BS-to-S1'; await page.keyboard.press('Control+z');
    await edit('Undo-BS-formal-S1-before-B', 'S1', false, true);
    phase = 'real-Undo-rich-Enter'; await page.keyboard.press('Control+z');
    await edit('Undo-Enter-formal-S0', 'S0', false, true);
    phase = 'real-Redo-rich-Enter'; await page.keyboard.press('Control+Shift+z');
    await edit('Redo-Enter-formal-S1-before-B', 'S1', false, true);
    // No pointer/selection repair between the proven history-restored point and this real input.
    phase = 'real-right-span-T'; await page.keyboard.type('T');
    const rightTyped = await edit('right-span-fixed-S1T', 'S1T', undefined);
    expect(rightTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    await acceptFixed('S1T'); await clickBeforeB(); await edit('formal-S1T-real-before-B', 'S1T', false, true);
    phase = 'real-Undo-right-span-T'; await page.keyboard.press('Control+z');
    await edit('Undo-right-T-formal-S1', 'S1', false, true);
    phase = 'real-Undo-Enter-for-ST'; await page.keyboard.press('Control+z');
    await edit('restored-formal-S0-for-ST', 'S0', false, true);
    phase = 'real-original-span-T'; await page.keyboard.type('T');
    const originalTyped = await edit('original-span-fixed-ST', 'ST', undefined);
    expect(originalTyped.render.nativeText).toMatchObject({ trusted: true, textExact: true, glyphsExact: true,
      chainExact: true, linkAttributesExact: true });
    phase = 'real-Undo-original-span-T'; await page.keyboard.press('Control+z');
    await edit('final-formal-S0', 'S0', false, true); healthy();
  } catch (error) {
    primaryError = error;
    const owner = await readPublicEditorState(page)
      .then((value) => ({ available: true, ...safePublicState(value) }), () => ({ available: false }));
    const current = await page.evaluate(({ prefix, suffix, expected, variants }) => {
      const field = document.querySelector('#easymde-source'), value = field instanceof HTMLTextAreaElement ? field.value : null;
      const outsideCellExact = value !== null && value.length >= prefix.length + suffix.length && value.startsWith(prefix) && value.endsWith(suffix);
      const target = outsideCellExact ? value.slice(prefix.length, value.length - suffix.length) : null;
      return { available: value !== null, sourceLength: value?.length ?? null, sourceExact: value === expected, outsideCellExact,
        targetMatchesDeclared: Object.fromEntries(Object.entries(variants).map(([key, candidate]) => [key, target !== null && target === candidate])) };
    }, { prefix, suffix, expected: SourceFixture[expectedKey], variants: targetSource }).catch(() => ({ available: false }));
    const native = receipts ? await receipts.evaluate((observer, key) => observer.safe(key), expectedKey).catch(() => ({ available: false })) : null;
    const finalFormal = await runtimeState(expectedKey).then((state) => ({ available: true, phase: state.phase,
      previewLoading: state.previewLoading, sourceLength: state.sourceLength, sourceMatchesExpected: state.sourceMatchesExpected }),
      () => ({ available: false }));
    console.log(JSON.stringify({ event: 'rich-inline-first-failure', kind: inline.kind, timing, operation: phase, fixedOracle: expectedKey,
      owner, current, native, finalFormal, preErrorCheckpoint: lastObservation, failures, browserErrors }));
    throw error;
  } finally {
    const resources = [];
    const cleanup = async (step, action) => { try { await action(); resources.push({ step, completed: true }); }
      catch { resources.push({ step, completed: false }); } };
    if (held) await cleanup('held-preview-close', () => held.close());
    await cleanup('rich-inline-page-listeners-remove', () => { page.off('pageerror', onPageError); page.off('popup', onPopup); page.off('dialog', onDialog); });
    if (receipts) { await cleanup('rich-inline-observer-remove', () => receipts.evaluate((observer) => observer.dispose()));
      await cleanup('rich-inline-receipt-dispose', () => receipts.dispose()); }
    if (retainedNodes) await cleanup('rich-inline-retained-dispose', () => retainedNodes.dispose());
    await cleanup('rich-inline-surface-dispose', () => surface.dispose());
    const cleanupFailed = resources.some((value) => !value.completed);
    console.log(JSON.stringify({ event: 'rich-inline-cleanup', kind: inline.kind, timing, cleanupFailed, resources }));
    if (cleanupFailed && primaryError === null) throw new Error('rich-inline-cleanup-failed');
  }
});
}
}
}
