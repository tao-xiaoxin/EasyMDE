import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createPhasedPreviewOperationTracker,
  expectLiveSelection,
  expectNativeTail,
  expectSource,
  holdFormalPreview,
  openVisual,
  readFullCrossBlockState,
  readPublicEditorState,
  registerVisualEditingHooks,
  safeFullCrossBlockState,
  safePublicState
} from '../helpers/visual-editing-helpers.mjs';
import { shortStagePhaseModel } from '../helpers/visual-short-stage-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

registerVisualEditingHooks();

test('nonempty paragraph join keeps source, selection and immediate undo editing consistent', async ({ page }) => {
  const initial = 'alpha\n\nbeta';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').last().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  // Force the normal history owner to flush pending input without a preview wait.
  await page.keyboard.press('Control+z');
  expect(failures).toEqual([]);
  await expectSource(source, initial);
  await expectLiveSelection(visual);
  await page.keyboard.type('X');
  await expectSource(source, 'alpha\n\nXbeta');
  expect(failures).toEqual([]);
});

for (const boundary of [
  { paragraphs: 2, text: 'Second.', source: 'Before.\n\nSecond' },
  { paragraphs: 1, text: 'Before.', source: 'Before' }
]) {
test(`first character deletion after empty join ${boundary.paragraphs} reaches canonical source`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'Before.\n\nSecond.\n\nTailXX');
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  let joined = false;
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures).toEqual([]);
    if (await visual.locator('p').count() === boundary.paragraphs
      && await visual.locator('p').last().textContent() === boundary.text) {
      joined = true;
      break;
    }
  }
  expect(joined).toBe(true);
  expect(await visual.locator('p').last().evaluate((paragraph) => {
    const selection = getSelection();
    if (!selection?.isCollapsed || !paragraph.contains(selection.anchorNode)) return false;
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    return prefix.toString().length === paragraph.textContent.length;
  })).toBe(true);
  // The native end caret is already correct. No click, focus repair or Preview wait.
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expect(visual.locator('p').last()).toHaveText(boundary.text.slice(0, -1));
  await expect.poll(async () => (await source.inputValue()).trimEnd() === boundary.source).toBe(true);
  await expectLiveSelection(visual);
});
}

test('short mixed document can be deleted characterwise and restored by keyboard history', async ({ page }) => {
  const initial = '中文 abc aaa \\*文字\\*\n\n# Heading\n\nTarget paragraph here.\n\n~~~bash\necho hi\n~~~\n\nEnd.';
  const phaseModel = shortStagePhaseModel('full');
  const deletionForward = phaseModel.deletionForwardGroups;
  const deletionReverse = deletionForward.slice().reverse().map((group) => [...group]);
  const emptyGroup = ['', ' ', '  ', '\n', '\n\n'];
  const typedXGroup = ['X', 'X ', 'X  ', 'X\n', 'X\n\n', ' X', '  X', '\nX', '\n\nX'];
  const middleX = initial.replace('Target paragraph here.', 'XTarget paragraph here.');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'fixture', groups: [[''], [initial]] },
    { id: 'delete', groups: deletionForward },
    { id: 'undo-restore', groups: deletionReverse },
    { id: 'redo-empty', groups: deletionForward },
    { id: 'empty-type-x', groups: [emptyGroup, typedXGroup, emptyGroup] },
    { id: 'undo-restore-2', groups: deletionReverse },
    { id: 'middle-x', groups: [[initial], [middleX]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  previewRead.enterPhase('delete');
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Backspace');
    expect(failures, `delete operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expect(visual).toHaveText('');
  await expect.poll(async () => (await source.inputValue()).trim().length).toBe(0);
  const emptySource = await source.inputValue();
  previewRead.enterPhase('undo-restore');
  let restored = false;
  let undoSteps = 0;
  for (let step = 0; step < initial.length + 8; step += 1) {
    await page.keyboard.press('Control+z');
    undoSteps += 1;
    expect(failures, `undo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
    if (await source.inputValue() === initial) {
      restored = true;
      break;
    }
  }
  expect(restored).toBe(true);
  previewRead.enterPhase('redo-empty');
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+Shift+z');
    expect(failures, `redo operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, emptySource);
  previewRead.enterPhase('empty-type-x');
  await page.keyboard.type('X');
  await expect.poll(async () => (await source.inputValue()).trim()).toBe('X');
  await page.keyboard.press('Control+z');
  await expectSource(source, emptySource);
  previewRead.enterPhase('undo-restore-2');
  for (let step = 0; step < undoSteps; step += 1) {
    await page.keyboard.press('Control+z');
    expect(failures, `restoration operation ${step}`).toEqual([]);
    await expectLiveSelection(visual);
  }
  await expectSource(source, initial);
  previewRead.enterPhase('middle-x');
  await visual.locator('p').filter({ hasText: 'Target paragraph here.' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('X');
  await expectSource(source, middleX);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

test('deleted-to-empty document accepts Enter continuation and restores exact history', async ({ page }) => {
  const initial = 'abc\n\n';
  const legalEmpty = '\n\n';
  const emptyGroup = [legalEmpty, ''];
  const zGroup = ['Z', `Z${legalEmpty}`];
  const enterGroup = ['Z\n\n  ', `Z\n\n  ${legalEmpty}`];
  const xGroup = ['Z\n\nX', `Z\n\nX${legalEmpty}`];
  const xyGroup = ['Z\n\nXY', `Z\n\nXY${legalEmpty}`];
  const xybGroup = ['Z\n\nXYB', `Z\n\nXYB${legalEmpty}`];
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], ['ab\n\n'], ['a\n\n'], emptyGroup,
        zGroup, enterGroup, xGroup, xyGroup, xGroup, xyGroup, xGroup, xyGroup, xybGroup,
        xyGroup, xGroup, enterGroup, zGroup, emptyGroup, ['a\n\n'], ['ab\n\n'], [initial],
        ['aMbc\n\n']
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let operationStage = 'delete-to-empty'; let latestAtom = null;
  const checkpoint = async (expected, caret, paragraphIndex, bodyOffset, bodyLength, ready = false) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: expected });
    latestAtom = { operationStage, expectedLength: expected.length, expectedCaret: caret,
      state: safeFullCrossBlockState(state) };
    console.log(JSON.stringify({ phase: 'empty-Enter-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (ready || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready', collapsed: true,
      nativeParagraph: { index: paragraphIndex, bodyOffset, bodyLength } });
    else expect(state).toMatchObject({ collapsed: true });
    expect(failures).toEqual([]); return state;
  };
  const acceptedEmptyRepresentation = (value) => value === '' || value === legalEmpty;
  const readAcceptedEmpty = async () => {
    await expect.poll(async () => acceptedEmptyRepresentation(await source.inputValue())).toBe(true);
    const canonical = await source.inputValue();
    expect(canonical.trim().length, 'Empty representation must contain no document text').toBe(0);
    const owner = await readPublicEditorState(page);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: canonical });
    latestAtom = { operationStage, canonicalLength: canonical.length,
      state: safeFullCrossBlockState(state), owner: safePublicState(owner) };
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, collapsed: true,
      focused: true, editable: true, lock: 'false', session: 'ready', previewPhase: 'ready', busy: 'false' });
    expect(state.nativeEndpoints.anchor.nodeType, 'A valid native caret must have a connected anchor').not.toBeNull();
    expect(state.nativeEndpoints.focus.nodeType, 'A valid native caret must have a connected focus').not.toBeNull();
    if (state.nativeParagraph) expect(state.nativeParagraph.bodyOffset).toBe(state.nativeParagraph.bodyLength);
    expect(owner.editable).toBe(true);
    await expect(visual).toHaveAttribute('contenteditable', 'true');
    expect(failures).toEqual([]);
    return { canonical, owner, state };
  };
  try {
    await visual.locator('p').last().click(); await page.keyboard.press('Control+End');
    for (const [remaining, caret] of [['ab\n\n', 2], ['a\n\n', 1], [legalEmpty, 0]]) {
      await page.keyboard.press('Backspace'); await checkpoint(remaining, caret, 0, caret, caret);
    }
    operationStage = 'extra-empty-Backspace';
    const beforeExtraCanonical = await source.inputValue();
    const beforeExtraOwner = await readPublicEditorState(page);
    expect(beforeExtraCanonical === legalEmpty).toBe(true);
    await page.keyboard.press('Backspace');
    let acceptedEmpty = await readAcceptedEmpty();
    console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'first-extra-Backspace',
      beforeLength: beforeExtraCanonical.length, afterLength: acceptedEmpty.canonical.length,
      nativeConnected: acceptedEmpty.owner.nativeConnected, statePhase: acceptedEmpty.state.phase }));
    const zeroLengthBackspaceIssued = acceptedEmpty.canonical === '';
    if (zeroLengthBackspaceIssued) {
      operationStage = 'extra-empty-at-zero-Backspace';
      const beforeZeroOwner = acceptedEmpty.owner;
      const beforeZeroDom = await page.evaluateHandle(() => {
        const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
        const p0 = surface?.firstElementChild ?? null;
        return { surface, children: surface ? Array.from(surface.childNodes) : [],
          p0Tag: p0?.tagName ?? null, p0Children: p0 ? Array.from(p0.childNodes) : [] };
      });
      try {
        await page.keyboard.press('Backspace');
        const afterZero = await readAcceptedEmpty();
        expect(afterZero.canonical, 'Backspace at the zero-length empty representation must be an exact no-op').toBe('');
        expect(afterZero.owner.nativeAnchor, 'Backspace at zero length must not move the native anchor')
          .toEqual(beforeZeroOwner.nativeAnchor);
        expect(afterZero.owner.nativeFocus, 'Backspace at zero length must not move the native focus')
          .toEqual(beforeZeroOwner.nativeFocus);
        expect(failures, 'Backspace at zero length must not emit a pageerror').toEqual([]);
        const sameDom = await page.evaluate((before) => {
          const surface = document.querySelector('[data-easymde-preview-html-sink][role="textbox"]');
          const p0 = surface?.firstElementChild ?? null;
          return { surface: !!surface && surface === before.surface && surface.isConnected,
            children: !!surface && surface.childNodes.length === before.children.length
              && Array.from(surface.childNodes).every((node, index) => node === before.children[index]),
            p0Tag: before.p0Tag === 'P' && p0?.tagName === 'P',
            p0Children: !!p0 && p0.childNodes.length === before.p0Children.length
              && Array.from(p0.childNodes).every((node, index) => node === before.p0Children[index]) };
        }, beforeZeroDom);
        expect(sameDom, 'Backspace at zero length must preserve the accepted P/BR DOM identities').toEqual({
          surface: true, children: true, p0Tag: true, p0Children: true
        });
        console.log(JSON.stringify({ phase: 'empty-representation-contract', press: 'zero-length-Backspace',
          beforeLength: acceptedEmpty.canonical.length, afterLength: afterZero.canonical.length,
          domIdentity: sameDom, nativeConnected: afterZero.owner.nativeConnected, statePhase: afterZero.state.phase }));
        acceptedEmpty = afterZero;
      } finally {
        await beforeZeroDom.dispose();
      }
    }
    const emptyRepresentation = acceptedEmpty.canonical;
    const typed = `Z${emptyRepresentation}`;
    const entered = `Z\n\n  ${emptyRepresentation}`;
    const continued = `Z\n\nXY${emptyRepresentation}`;
    const shortened = `Z\n\nX${emptyRepresentation}`;
    const branch = `Z\n\nXYB${emptyRepresentation}`;
    operationStage = 'empty-input-Z'; await page.keyboard.type('Z'); await checkpoint(typed, 1, 0, 1, 1);
    operationStage = 'Enter-after-Z'; await page.keyboard.press('Enter'); await checkpoint(entered, 3, 1, 0, 0);
    operationStage = 'immediate-XY'; await page.keyboard.type('XY'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Backspace-Y'; await page.keyboard.press('Backspace'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'EOF-Delete-noop';
    const beforeNoop = await readPublicEditorState(page);
    await page.keyboard.press('Delete'); await checkpoint(shortened, 4, 1, 1, 1);
    const afterNoop = await readPublicEditorState(page);
    expect(afterNoop.source === beforeNoop.source, 'EOF Delete must preserve the exact source').toBe(true);
    expect(afterNoop.nativeAnchor, 'EOF Delete must preserve the native anchor').toEqual(beforeNoop.nativeAnchor);
    expect(afterNoop.nativeFocus, 'EOF Delete must preserve the native focus').toEqual(beforeNoop.nativeFocus);
    operationStage = 'Undo-Backspace-Y'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'Redo-Backspace-Y'; await page.keyboard.press('Control+Shift+z'); await checkpoint(shortened, 4, 1, 1, 1);
    operationStage = 'Undo-before-branch'; await page.keyboard.press('Control+z'); await checkpoint(continued, 5, 1, 2, 2);
    operationStage = 'branch-B'; await page.keyboard.type('B');
    await checkpoint(branch, 6, 1, 3, 3);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, branch);
    await expectLiveSelection(visual);
    operationStage = 'restore-original-history';
    let restored = false;
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press('Control+z'); expect(failures).toEqual([]); await expectLiveSelection(visual);
      if (await source.inputValue() === initial) { restored = true; break; }
    }
    expect(restored, 'Normal bounded history must restore the exact original Markdown').toBe(true);
    await expectSource(source, initial);
    operationStage = 'middle-continue-M'; await visual.locator('p').first().click();
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('M');
    await checkpoint('aMbc\n\n', 2, 0, 2, 4);
    await expect(visual).toHaveAttribute('aria-busy', 'false'); await checkpoint('aMbc\n\n', 2, 0, 2, 4, true);
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'empty-Enter-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  }
});

test('explicit Preview lock rejects real keys across formal response and unlock resumes history', async ({ page }) => {
  const initial = 'Alpha.\n\nTarget.\n\nAfter.';
  const typed = 'Alpha.V\n\nTarget.\n\nAfter.';
  const resumed = 'Alpha.VX\n\nTarget.\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [resumed], [typed], [resumed], [typed]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  let held = null; let operationStage = 'unlocked-input'; let latestAtom = null;
  const lockedCheckpoint = async () => {
    const state = await sink.evaluate((surface) => {
      const active = surface.ownerDocument.activeElement;
      return {
        contenteditable: surface.getAttribute('contenteditable'), effectiveEditable: surface.isContentEditable,
        activeElementEditable: !!active?.isContentEditable,
        activeElementIsInput: !!active && ['INPUT','TEXTAREA'].includes(active.tagName),
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
        previewPhase: surface.getAttribute('data-easymde-preview-phase'), busy: surface.getAttribute('aria-busy')
      };
    });
    const owner = await readPublicEditorState(page);
    latestAtom = { operationStage, state, owner: { sourceLength: owner.sourceLength,
      nativeConnected: owner.nativeConnected, effectiveEditable: owner.effectiveEditable } };
    console.log(JSON.stringify({ phase: 'user-lock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ effectiveEditable: false, lock: 'true' });
    expect(state.contenteditable).not.toBe('true');
    expect(owner.sourceInputConnected, 'Source edit surface remains independently connected').toBe(true);
    expect(owner.nativeConnected, 'A real native selection remains observable while Preview is locked').toBe(true);
    expect(failures).toEqual([]); await expectSource(source, typed); return state;
  };
  const unlockedCheckpoint = async (expected, caret) => {
    expect(failures).toEqual([]); await expectSource(source, expected);
    const state = await readFullCrossBlockState(visual, { paragraph: true, expectedSource: expected });
    latestAtom = { operationStage, state: { sourceLength: state.sourceLength, phase: state.phase,
      nativeConnected: state.nativeConnected, focused: state.focused, editable: state.editable,
      lock: state.lock, session: state.session, nativeParagraph: state.nativeParagraph } };
    console.log(JSON.stringify({ phase: 'user-unlock-first-atom', ...latestAtom }));
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (state.phase === 'ready') expect(state).toMatchObject({ collapsed: true,
      nativeParagraph: { index: 0, bodyOffset: caret, bodyLength: caret } });
    else expect(state).toMatchObject({ collapsed: true });
    return state;
  };
  try {
    await visual.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.type('V');
    await unlockedCheckpoint(typed, 7);
    held = await holdFormalPreview(page); operationStage = 'user-click-lock'; await lock.click();
    await held.waitFor(typed); await lockedCheckpoint();
    operationStage = 'readonly-body-click'; await sink.locator('p').first().click();
    const readonly = await lockedCheckpoint();
    expect(readonly).toMatchObject({ activeElementEditable: false, activeElementIsInput: false });
    for (const [stage, key] of [['readonly-Q','Q'],['readonly-Backspace','Backspace'],['readonly-Enter','Enter']]) {
      operationStage = stage;
      if (key === 'Q') await page.keyboard.type('Q'); else await page.keyboard.press(key);
      await lockedCheckpoint();
    }
    operationStage = 'formal-response-while-locked'; await held.close(); held = null;
    await expect(sink).toHaveAttribute('aria-busy', 'false'); await lockedCheckpoint();
    operationStage = 'user-unlock-direct-X'; await lock.click(); await expect(visual).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.type('X'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Backspace-X'; await page.keyboard.press('Backspace'); await unlockedCheckpoint(typed, 7);
    operationStage = 'Undo-Backspace-X'; await page.keyboard.press('Control+z'); await unlockedCheckpoint(resumed, 8);
    operationStage = 'Redo-Backspace-X'; await page.keyboard.press('Control+Shift+z'); await unlockedCheckpoint(typed, 7);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    const final = await unlockedCheckpoint(typed, 7); expect(final.phase).toBe('ready');
    await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'user-lock-first-failure', operationStage, latestAtom, errors: failures }));
    throw error;
  } finally { if (held) await held.close(); }
});

test('cross-paragraph keyboard selection replaces exactly the selected source', async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, 'alpha\n\nbeta');
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'alX');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await page.keyboard.press('Control+z');
  await expectSource(source, 'alpha\n\nbeta');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const reverse of [false, true]) {
  test(`${reverse ? 'reverse' : 'forward'} mouse range preserves both unselected ends`, async ({ page }) => {
    const initial = 'Before.\n\nalpha\n\nbeta\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    const point = async (paragraph) => visual.locator('p').nth(paragraph).evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error('synthetic-text-node-missing');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    const first = await point(reverse ? 2 : 1);
    const last = await point(reverse ? 1 : 2);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.type('X');
    expect(failures).toEqual([]);
    await expectSource(source, 'Before.\n\nalXta\n\nAfter.');
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  });
}

test('full cross-block forward mouse replacement preserves P-H2-P history and branching', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const branched = 'Before.\n\nalphaNzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaNQzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [replaced], [initial], [replaced], [initial], [branched], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let operationStage = 'select-forward-mouse';
  let expectedSource = initial;
  const point = async (index, offset) => visual.locator(':scope > p').nth(index).evaluate((row, position) => {
    if (!(row.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = row.ownerDocument.createRange();
    range.setStart(row.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  let latestAtomicState = null;
  let firstAtomicFailure = null;
  const expectNative = async (rangeSelected, offset = 5, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { selected: rangeSelected, offset,
      direction: 'forward', expectedSource });
    latestAtomicState = { operationStage, state: { sourceLength: state.sourceLength, phase: state.phase,
      nativeConnected: state.nativeConnected, focused: state.focused, editable: state.editable,
      lock: state.lock, session: state.session } };
    console.log(JSON.stringify({ phase: 'PH2-assertion-first-atom', ...latestAtomicState }));
    try {
      expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
        editable: true, lock: 'false', session: 'ready' });
      if (requireReady || state.phase === 'ready') {
        expect(state, 'Ready native endpoints must retain their declared source-side meaning').toMatchObject({
          phase: 'ready', anchorMatches: true, focusMatches: true,
          direction: rangeSelected ? 'forward' : 'none', collapsed: !rangeSelected
        });
      } else {
        expect(state, 'A pending Preview must retain a connected native selection').toMatchObject({
          nativeConnected: true
        });
      }
      expect(failures).toEqual([]);
    } catch (error) {
      firstAtomicFailure ??= latestAtomicState;
      throw error;
    }
  };
  const expectCommittedSelection = async () => {
    const owner = await readPublicEditorState(page);
    expect(owner.source === expectedSource, 'The source bridge must retain the exact committed Markdown').toBe(true);
    expect(owner.editable).toBe(true);
    expect(owner.nativeConnected, 'The committed caret stays a real connected native Selection').toBe(true);
    return owner;
  };
  try {
  const first = await point(1, 5);
  const last = await point(2, 1);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 8 });
  await page.mouse.up();
  await expectNative(true, 5);
  // Selection-only native intent is not a canonical transaction. Read its
  // current owner separately; the first committed insertion is asserted below.
  const nativeIntentOwner = await readPublicEditorState(page);
  console.log(JSON.stringify({ phase: 'cross-block-native-intent',
    nativeConnected: nativeIntentOwner.nativeConnected,
    nativeDirection: nativeIntentOwner.nativeDirection,
    selectionTextLength: nativeIntentOwner.selectionTextLength }));
  operationStage = 'replace-M';
  expectedSource = replaced;
  await page.keyboard.type('M');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection();
  operationStage = 'undo-range';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection();
  operationStage = 'redo-M';
  expectedSource = replaced;
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, replaced);
  await expectNative(false, 6);
  await expectCommittedSelection();
  operationStage = 'undo-before-branch';
  expectedSource = initial;
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await expectNative(true);
  await expectCommittedSelection();
  operationStage = 'branch-N';
  expectedSource = branched;
  await page.keyboard.type('N');
  await expectSource(source, branched);
  await expectNative(false, 6);
  await expectCommittedSelection();
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, branched);
  operationStage = 'continue-Q';
  expectedSource = continued;
  await page.keyboard.type('Q');
  await expectSource(source, continued);
  await expectNative(false, 7);
  await expectCommittedSelection();
  await expect(visual.locator('h2')).toHaveCount(0);
  await expect(visual.locator(':scope > p').nth(1)).toHaveText('alphaNQzeta');
  await expectNative(false, 7, true);
  await previewRead.prove({ visual });
  } catch (error) {
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', operationStage,
      expectedLength: expectedSource.length, firstAtomicFailure, latestAtomicState, errors: failures }));
    throw error;
  }
});

for (const crossBlock of [
  {
    name: 'reverse mouse through nested quotes and ordered task lists',
    action: 'reverse-mouse',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n> outer quote\n> > inVner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    positionSelector: 'blockquote blockquote p',
    position: 'middle', positionOffset: 2, positionSourceOffset: 37,
    selectionEnd: 89,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  },
  {
    name: 'keyboard Shift through nested lists and a quote',
    action: 'keyboard',
    initial: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> quote\n\nYz',
    positionEdited: 'Before.\n\nalphaX\n\n- item\n  - nested\n\n> Vquote\n\nYz',
    positionSelector: 'blockquote p',
    position: 'start', positionOffset: 0, positionSourceOffset: 38,
    selectionEnd: 46,
    replaced: 'Before.\n\nalphaMz',
    branched: 'Before.\n\nalphaNz',
    continued: 'Before.\n\nalphaNQz'
  },
  {
    name: 'forward mouse through a heading and code',
    action: 'forward-mouse',
    initial: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;\n~~~\n\nYzeta\n\nAfter.',
    positionEdited: 'Before.\n\nalphaX\n\n### Bridge\n\n~~~js\nlet n = 1;V\n~~~\n\nYzeta\n\nAfter.',
    positionSelector: 'pre code',
    position: 'end', positionOffset: 10, positionSourceOffset: 45,
    selectionEnd: 52,
    replaced: 'Before.\n\nalphaMzeta\n\nAfter.',
    branched: 'Before.\n\nalphaNzeta\n\nAfter.',
    continued: 'Before.\n\nalphaNQzeta\n\nAfter.'
  }
]) {
for (const transferTiming of crossBlock.action === 'reverse-mouse' ? ['normal', 'held-redo'] : ['normal']) {
test(`full cross-block ${crossBlock.name} preserves exact history and branching${transferTiming === 'held-redo' ? ' with held Redo response' : ''}`, async ({ page }) => {
  const heldRedoContinued = 'Before.\n\nalphaMRzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: transferTiming === 'held-redo'
        ? [[''], [crossBlock.initial], [crossBlock.positionEdited], [crossBlock.initial],
          [crossBlock.replaced], [crossBlock.initial], [crossBlock.replaced], [heldRedoContinued]]
        : [[''], [crossBlock.initial], [crossBlock.positionEdited], [crossBlock.initial],
          [crossBlock.replaced], [crossBlock.initial], [crossBlock.replaced], [crossBlock.initial],
          [crossBlock.branched], [crossBlock.continued]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, crossBlock.initial, undefined, previewRead.beforeFixture);
  let operationStage = `position-${crossBlock.position}`;
  let expectedSource = crossBlock.initial;
  let heldRedo;
  const direction = crossBlock.action === 'reverse-mouse' ? 'backward' : 'forward';
  const expectOwner = async () => {
    const owner = await readPublicEditorState(page);
    expect(owner.source === expectedSource, 'The source bridge must retain the exact committed Markdown').toBe(true);
    expect(owner.editable).toBe(true);
    expect(owner.nativeConnected, 'Committed edits must retain a connected native Selection').toBe(true);
    expect(failures).toEqual([]);
    return owner;
  };
  const expectNative = async (selected, offset = 5, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { selected, offset, direction, expectedSource });
    expect(state, `Active owner and native permission at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, focused: true, editable: true, lock: 'false', session: 'ready', nativeConnected: true
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready native semantic endpoints at ${operationStage}`).toMatchObject({
        phase: 'ready', anchorMatches: true, focusMatches: true,
        direction: selected ? direction : 'none', collapsed: !selected
      });
    } else {
      console.log(JSON.stringify({ phase: 'cross-block-retained-presentation', operationStage,
        phase: state.phase, sourceLength: state.sourceLength, nativeConnected: state.nativeConnected }));
      expect(state, `A pending Preview still requires a connected native selection at ${operationStage}`).toMatchObject({
        nativeConnected: true
      });
    }
    expect(failures).toEqual([]);
    return state;
  };
  const point = async (row, offset) => row.evaluate((element, position) => {
    if (!(element.firstChild instanceof Text)) throw new Error('cross-block-native-text-missing');
    const range = element.ownerDocument.createRange();
    range.setStart(element.firstChild, position);
    range.collapse(true);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  }, offset);
  try {
    await expect(visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
    const positionRow = visual.locator(crossBlock.positionSelector);
    await positionRow.click();
    await page.keyboard.press(crossBlock.position === 'end' ? 'End' : 'Home');
    if (crossBlock.position === 'middle') {
      for (let index = 0; index < crossBlock.positionOffset; index += 1) await page.keyboard.press('ArrowRight');
    }
    expectedSource = crossBlock.positionEdited;
    await page.keyboard.type('V');
    await expectSource(source, expectedSource);
    await expectOwner();
    await page.keyboard.press('Control+z');
    expectedSource = crossBlock.initial;
    await expectSource(source, expectedSource);
    await expectOwner();

    operationStage = 'select-cross-block';
    const firstRow = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const lastRow = visual.locator(':scope > p').filter({ hasText: /^Yz(?:eta)?$/u });
    if (crossBlock.action === 'keyboard') {
      await firstRow.click();
      await page.keyboard.press('Home');
      for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Control+Shift+End');
      await page.keyboard.press('Shift+ArrowLeft');
    } else {
      const first = await point(firstRow, 5);
      const last = await point(lastRow, 1);
      const start = direction === 'backward' ? last : first;
      const end = direction === 'backward' ? first : last;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    }
    await expectNative(true, 5);
    const nativeIntentOwner = await readPublicEditorState(page);
    console.log(JSON.stringify({ phase: 'cross-block-native-intent',
      nativeConnected: nativeIntentOwner.nativeConnected,
      nativeDirection: nativeIntentOwner.nativeDirection,
      selectionTextLength: nativeIntentOwner.selectionTextLength }));
    operationStage = 'replace-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.type('M');
    await expectSource(source, expectedSource);
    await expectNative(false, 6); await expectOwner();
    operationStage = 'undo-range'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner();
    if (transferTiming === 'held-redo') heldRedo = await holdFormalPreview(page);
    operationStage = 'redo-M'; expectedSource = crossBlock.replaced;
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    if (transferTiming === 'held-redo') {
      await expectOwner();
      await heldRedo.waitFor(expectedSource);
      const state = await expectNative(false, 6);
      expect(state).toMatchObject({ nativeConnected: true });
      operationStage = 'held-redo-direct-R';
      expectedSource = 'Before.\n\nalphaMRzeta\n\nAfter.';
      await page.keyboard.type('R');
      expect(failures).toEqual([]);
      await expectSource(source, expectedSource); await expectOwner();
      await heldRedo.close(); heldRedo = null;
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expect(visual.locator(':scope > p').filter({ hasText: /^alphaMRzeta$/u })).toHaveCount(1);
      await expectNative(false, 7, true);
      await expectSource(source, expectedSource); await expectOwner();
      await previewRead.prove({ visual });
      console.log(JSON.stringify({ phase: 'permanent-held-redo-completed', exactSource: true,
        sourceLength: expectedSource.length, finalNativeOffset: 7 }));
      return;
    }
    await expectNative(false, 6); await expectOwner();
    operationStage = 'undo-before-branch'; expectedSource = crossBlock.initial;
    await page.keyboard.press('Control+z');
    await expectSource(source, expectedSource);
    await expectNative(true); await expectOwner();
    operationStage = 'branch-N'; expectedSource = crossBlock.branched;
    await page.keyboard.type('N');
    await expectSource(source, expectedSource);
    await expectNative(false, 6);
    await expectOwner();
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    operationStage = 'continue-Q'; expectedSource = crossBlock.continued;
    await page.keyboard.type('Q');
    await expectSource(source, expectedSource);
    await expectNative(false, 7); await expectOwner();
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expect(visual.locator('h1,h2,h3,pre,blockquote,ul,ol')).toHaveCount(0);
    await expect(visual.locator(':scope > p').filter({ hasText: /^alphaNQz(?:eta)?$/u })).toHaveCount(1);
    await expectNative(false, 7, true);
    await previewRead.prove({ visual });
  } catch (error) {
    const actual = await source.inputValue();
    let firstMismatch = 0;
    while (firstMismatch < Math.min(actual.length, expectedSource.length)
      && actual[firstMismatch] === expectedSource[firstMismatch]) firstMismatch += 1;
    const owner = await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
      editable: state.effectiveEditable, nativeConnected: state.nativeConnected }))
      .catch(() => ({ unavailable: 'public-state-read-failed' }));
    console.log(JSON.stringify({ phase: 'cross-block-first-failure', caseName: crossBlock.name, operationStage,
      actualLength: actual.length, expectedLength: expectedSource.length,
      exactSource: actual === expectedSource, firstMismatch: actual === expectedSource ? null : firstMismatch, owner }));
    throw error;
  } finally { if (heldRedo) await heldRedo.close(); }
});
}
}

for (const listCase of [
  { name: 'star-list', initial: '* a\n* b\n', emptied: '* a\n* \n', removed: '* a\n', continued: '* aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'dash-list', initial: '- a\n- b\n', emptied: '- a\n- \n', removed: '- a\n', continued: '- aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'plus-list', initial: '+ a\n+ b\n', emptied: '+ a\n+ \n', removed: '+ a\n', continued: '+ aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'middle-space-list', initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n',
    removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0 },
  // A CRLF-authored document (Windows line endings) cannot keep its CRLF once it
  // reaches the browser: the HTML input stream and the textarea API value both
  // transform \r\n to \n, and clipboard text/plain is normalised the same way on
  // paste. `pasteFrom` is real CRLF written to the clipboard; `openVisual` pastes
  // it and then asserts the LF form the editor actually receives, so this case
  // verifies the CRLF *input* route plus the empty-row behaviour of the LF
  // document it delivers. No user route can leave CRLF in #easymde-source.
  { name: 'pasted-CRLF-middle-space-list', pasteFrom: '- a\r\n-   \r\n- c\r\n',
    initial: '- a\n-   \n- c\n', emptied: '- a\n-   \n- c\n', removed: '- a\n- c\n', continued: '- aZ\n- c\n',
    deleteCharacter: false, itemIndex: 1, itemCount: 3, removedItemCount: 2, precedingItemIndex: 0 },
  { name: 'quoted-list', initial: '> - a\n> - b\n', emptied: '> - a\n> - \n',
    removed: '> - a\n', continued: '> - aZ\n',
    deleteCharacter: true, itemIndex: 1, itemCount: 2, removedItemCount: 1, precedingItemIndex: 0 },
  { name: 'nested-list', initial: '- outer\n  - a\n  - b\n', emptied: '- outer\n  - a\n  - \n',
    removed: '- outer\n  - a\n', continued: '- outer\n  - aZ\n',
    deleteCharacter: true, itemIndex: 2, itemCount: 3, removedItemCount: 2, precedingItemIndex: 1 }
]) {
test(`full ${listCase.name} Backspace preserves its empty body boundary and preceding caret`, async ({ page }) => {
  const { failures, source, visual } = await openVisual(page, listCase.initial, listCase.pasteFrom);
  let operationStage = 'select-list-body';
  let expectedSource = listCase.initial;
  const traceStage = (stage) => {
    operationStage = stage;
    if (listCase.name === 'middle-space-list') console.log(JSON.stringify({ phase: 'list-await-stage', stage }));
  };
  const boundedRead = async (operation) => {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('test-list-observation-timeout')), 3000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const sample = async (phase) => {
    const state = await boundedRead(() => readFullCrossBlockState(visual, { list: true, expectedSource: expectedSource }));
    console.log(JSON.stringify({ phase, caseName: listCase.name, operationStage,
      sourceLength: (await source.inputValue()).length, state: safeFullCrossBlockState(state) }));
    return state;
  };
  const expectListState = async (phase, itemCount, itemIndex, bodyOffset, requireReady = false) => {
    const state = await sample(phase);
    expect(state, `List permission and native selection at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, nativeConnected: true, focused: true, editable: true, lock: 'false', session: 'ready' });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Ready list body at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeList: { itemCount, itemIndex, bodyOffset } });
    } else {
      expect(state, `A pending list Preview keeps the real native selection at ${operationStage}`).toMatchObject({
        nativeConnected: true, collapsed: true });
    }
    expect(failures).toEqual([]);
  };
  const expectSourceOrRefusal = async () => {
    await expect.poll(async () => failures.length ? 'refused'
      : await source.inputValue() === expectedSource ? 'matched' : 'pending').not.toBe('pending');
    expect(failures, 'The first list refusal ends this chain').toEqual([]);
    await expectSource(source, expectedSource);
  };
  try {
    // openVisual checks the complete literal fixture (and, for the pasted-CRLF
    // case, the normalised LF the paste route delivers) before any formal edit.
    // The mouse and End key select its real rendered body.
    traceStage('before-list-click');
    await visual.locator('li').nth(listCase.itemIndex).click({ timeout: 5000 });
    traceStage('after-list-click');
    traceStage('before-list-End');
    await page.keyboard.press('End');
    traceStage('after-list-End');
    if (listCase.deleteCharacter) {
      operationStage = 'delete-list-body-character'; expectedSource = listCase.emptied;
      await page.keyboard.press('Backspace');
      await expectSourceOrRefusal();
      await expectListState('list-body-emptied',
        listCase.itemCount, listCase.itemIndex, 0);
    } else {
      traceStage('before-empty-native-sample');
      const intent = await sample('list-empty-native-intent');
      traceStage('after-empty-native-sample');
      expect(intent).toMatchObject({ phase: 'ready', collapsed: true, nativeConnected: true,
        editable: true, lock: 'false', session: 'ready',
        nativeList: { itemCount: listCase.itemCount, itemIndex: listCase.itemIndex, bodyOffset: 0 } });
      // Selection-only intent does not commit the canonical caret. This source
      // boundary is the declared row the following Backspace must remove.
      console.log(JSON.stringify({ phase: 'list-empty-intended-source-boundary', caseName: listCase.name,
        expectedSourceLength: expectedSource.length }));
    }
    operationStage = 'remove-empty-list-row'; expectedSource = listCase.removed;
    await page.keyboard.press('Backspace');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed',
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'undo-empty-row-removal'; expectedSource = listCase.emptied;
    await page.keyboard.press('Control+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-restored',
      listCase.itemCount, listCase.itemIndex, 0);
    operationStage = 'redo-empty-row-removal'; expectedSource = listCase.removed;
    await page.keyboard.press('Control+Shift+z');
    await expectSourceOrRefusal();
    await expectListState('list-empty-row-removed-again',
      listCase.removedItemCount, listCase.precedingItemIndex, 1);
    operationStage = 'continue-at-preceding-row'; expectedSource = listCase.continued;
    await page.keyboard.type('Z');
    await expectSourceOrRefusal();
    await expectListState('list-continued-at-logical-caret',
      listCase.removedItemCount, listCase.precedingItemIndex, 2);
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await expectListState('list-final-ready-caret',
      listCase.removedItemCount, listCase.precedingItemIndex, 2, true);
  } catch (error) {
    console.log(JSON.stringify({ phase: 'list-original-first-error', caseName: listCase.name, operationStage,
      errorName: error.name, pageClosed: page.isClosed() }));
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        await sample('list-first-failure');
        console.log(JSON.stringify({ phase: 'list-first-source-result', caseName: listCase.name, operationStage,
          exactExpected: actual === expectedSource, actualLength: actual.length, expectedLength: expectedSource.length,
          retainedInitial: actual === listCase.initial, retainedEmptyItem: actual === listCase.emptied }));
      } catch {
        console.log(JSON.stringify({ phase: 'list-first-error-observation-unavailable', operationStage }));
      }
    }
    throw error;
  }
});
}

for (const inlineCase of [
  { name: 'single delimiter', initial: 'Before.\n\nLead `\\*` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead `\\X*` tail.\n\nAfter.', deleted: 'Before.\n\nLead `\\` tail.\n\nAfter.',
    continued: 'Before.\n\nLead `\\Q*` tail.\n\nAfter.', initialBodyLength: 2 },
  { name: 'double delimiter', initial: 'Before.\n\nLead ``\\`*`` tail.\n\nAfter.',
    inserted: 'Before.\n\nLead ``\\X`*`` tail.\n\nAfter.', deleted: 'Before.\n\nLead ``\\*`` tail.\n\nAfter.',
    continued: 'Before.\n\nLead ``\\Q`*`` tail.\n\nAfter.', initialBodyLength: 3 }
]) {
for (const timing of inlineCase.name === 'single delimiter' ? ['held', 'normal'] : ['normal']) {
test(`full inline literal backslash ${inlineCase.name} preserves body input deletion and history${timing === 'held' ? ' held PHP Undo' : ''}`, async ({ page }) => {
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: timing === 'normal'
        ? [[''], [inlineCase.initial], [inlineCase.inserted], [inlineCase.initial],
          [inlineCase.deleted], [inlineCase.initial], [inlineCase.deleted], [inlineCase.initial], [inlineCase.continued]]
        : [[''], [inlineCase.initial], [inlineCase.inserted], [inlineCase.initial],
          [inlineCase.deleted], [inlineCase.initial], [inlineCase.continued]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, inlineCase.initial, undefined, previewRead.beforeFixture);
  let heldPreview = null;
  let operationStage = 'initial-inline-pointer';
  let expectedSource = inlineCase.initial;
  const assertPoint = async (bodyOffset, bodyLength, requireReady = false) => {
    const state = await readFullCrossBlockState(visual, { inlineCode: true, expectedSource });
    if (state.phase !== 'ready') console.log(JSON.stringify({ phase: 'inline-pending-checkpoint',
      caseName: inlineCase.name, timing, operationStage, state: safeFullCrossBlockState(state) }));
    expect(state, `Inline permission and native selection at ${operationStage}`).toMatchObject({
      sourceMatchesExpected: true, nativeConnected: true, focused: true, editable: true,
      lock: 'false', session: 'ready'
    });
    if (requireReady || state.phase === 'ready') {
      expect(state, `Inline body caret at ${operationStage}`).toMatchObject({ phase: 'ready', collapsed: true,
        nativeInlineCode: { anchor: { codeIndex: 0, bodyOffset, bodyLength }, focus: { codeIndex: 0, bodyOffset, bodyLength } } });
    } else {
      expect(state, `A pending inline Preview keeps the real native caret at ${operationStage}`).toMatchObject({
        nativeConnected: true, collapsed: true });
    }
    expect(failures).toEqual([]);
    return state;
  };
  try {
    const code = visual.locator('p code');
    await expect(code).toHaveCount(1);
    const point = await code.evaluate((element) => {
      if (!(element.firstChild instanceof Text) || element.firstChild.length < 2) throw new Error('inline-backslash-native-body-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, 1); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    const intent = await assertPoint(1, inlineCase.initialBodyLength);
    console.log(JSON.stringify({ phase: 'inline-backslash-native-intent', caseName: inlineCase.name,
      nativeAnchor: intent.nativeAnchor, nativeFocus: intent.nativeFocus }));
    operationStage = 'insert-X'; expectedSource = inlineCase.inserted;
    await page.keyboard.type('X'); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1);
    operationStage = 'Backspace-X'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Backspace'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength);
    operationStage = 'Delete-following-body-character'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Delete'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1);
    if (timing === 'held') heldPreview = await holdFormalPreview(page);
    operationStage = 'undo-Delete'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    if (heldPreview) {
      await heldPreview.waitFor(inlineCase.initial);
      console.log(JSON.stringify({ phase: 'inline-real-php-200-withheld', sourceLength: inlineCase.initial.length }));
    }
    await assertPoint(1, inlineCase.initialBodyLength);
    if (timing === 'normal') {
    operationStage = 'redo-Delete'; expectedSource = inlineCase.deleted;
    await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength - 1);
    operationStage = 'undo-before-continuing'; expectedSource = inlineCase.initial;
    await page.keyboard.press('Control+z'); await expectSource(source, expectedSource);
    await assertPoint(1, inlineCase.initialBodyLength);
    }
    operationStage = 'continue-Q'; expectedSource = inlineCase.continued;
    await page.keyboard.type('Q'); expect(failures).toEqual([]); await expectSource(source, expectedSource);
    await assertPoint(2, inlineCase.initialBodyLength + 1);
    if (heldPreview) { await heldPreview.close(); heldPreview = null; }
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertPoint(2, inlineCase.initialBodyLength + 1, true);
    await expectSource(source, expectedSource);
    await previewRead.prove({ visual });
    console.log(JSON.stringify({ phase: 'inline-final-ready', caseName: inlineCase.name, timing,
      sourceLength: expectedSource.length,
      codeBodyOffset: 2, codeBodyLength: inlineCase.initialBodyLength + 1, errors: failures.length }));
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 });
        const state = await readFullCrossBlockState(visual, { inlineCode: true });
        console.log(JSON.stringify({ phase: 'inline-backslash-first-failure', caseName: inlineCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource,
          state: safeFullCrossBlockState(state) }));
      } catch { console.log(JSON.stringify({ phase: 'inline-backslash-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally { if (heldPreview) await heldPreview.close(); }
});
}
}

for (const rapidCase of [
  { name: 'nested reverse range', direction: 'backward',
    initial: 'Before.\n\nalphaX\n\n> outer quote\n> > inner quote\n\n1. ordered\n   - [ ] task\n     - nested\n\nYzeta\n\nAfter.',
    initialLength: 101, selectionEnd: 89,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' },
  { name: 'P-H2-P forward range', direction: 'forward',
    initial: 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.', initialLength: 42, selectionEnd: 30,
    afterM: 'Before.\n\nalphaMzeta\n\nAfter.', afterMQ: 'Before.\n\nalphaMQzeta\n\nAfter.',
    afterB: 'Before.\n\nalphaBzeta\n\nAfter.', afterBC: 'Before.\n\nalphaBCzeta\n\nAfter.' }
]) {
test(`full rapid MQ ${rapidCase.name} preserves pending history and branching`, async ({ page }) => {
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [rapidCase.initial], [rapidCase.afterM], [rapidCase.afterMQ],
        [rapidCase.afterM], [rapidCase.initial],
        [rapidCase.afterM], [rapidCase.afterMQ],
        [rapidCase.afterM], [rapidCase.initial],
        [rapidCase.afterB], [rapidCase.afterBC]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, rapidCase.initial, undefined, previewRead.beforeFixture);
  let operationStage = 'initial-range-pointer';
  let expectedSource = rapidCase.initial;
  let held;
  let eventsActive = false;
  const sourceForKind = (kind) => {
    if (kind === 'initial') return rapidCase.initial;
    if (kind === 'M') return rapidCase.afterM;
    if (kind === 'MQ') return rapidCase.afterMQ;
    if (kind === 'B') return rapidCase.afterB;
    if (kind === 'BC') return rapidCase.afterBC;
    throw new Error(`rapid-MQ-unknown-kind:${kind}`);
  };
  const assertState = async (kind, requireReady = false) => {
    const selected = kind === 'initial';
    const offset = kind === 'M' || kind === 'B' ? 6 : 7;
    const expected = sourceForKind(kind);
    expectedSource = expected;
    const state = await readFullCrossBlockState(visual, { selected, offset: selected ? 5 : offset,
      direction: rapidCase.direction, expectedSource: expected });
    expect(state).toMatchObject({ sourceMatchesExpected: true, nativeConnected: true, focused: true,
      editable: true, lock: 'false', session: 'ready' });
    if (requireReady || state.phase === 'ready') expect(state).toMatchObject({ phase: 'ready',
      anchorMatches: true, focusMatches: true, direction: selected ? rapidCase.direction : 'none', collapsed: !selected });
    else expect(state).toMatchObject({ nativeConnected: true });
    expect(failures).toEqual([]);
    return state;
  };
  const undoToInitial = async () => {
    const receipts = [];
    for (let step = 0; step < 2; step += 1) {
      await page.keyboard.press('Control+z');
      await expect.poll(async () => {
        if (failures.length) return 'refused';
        const value = await source.inputValue();
        return value === rapidCase.initial ? 'initial' : value === rapidCase.afterM ? 'M' : 'pending';
      }).not.toBe('pending');
      expect(failures).toEqual([]);
      const value = await source.inputValue();
      expect(value === rapidCase.initial || value === rapidCase.afterM).toBe(true);
      const kind = value === rapidCase.initial ? 'initial' : 'M'; receipts.push(kind);
      await assertState(kind);
      if (kind === 'initial') return receipts;
    }
    throw new Error('rapid-MQ-history-did-not-restore-initial');
  };
  try {
    expect(rapidCase.initial.length).toBe(rapidCase.initialLength);
    const first = visual.locator(':scope > p').filter({ hasText: /^alphaX$/u });
    const last = visual.locator(':scope > p').filter({ hasText: /^Yzeta$/u });
    const point = (row, offset) => row.evaluate((element, position) => {
      if (!(element.firstChild instanceof Text)) throw new Error('rapid-MQ-native-text-unavailable');
      const range = element.ownerDocument.createRange(); range.setStart(element.firstChild, position); range.collapse(true);
      const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
    }, offset);
    const head = await point(first, 5), tail = await point(last, 1);
    const start = rapidCase.direction === 'backward' ? tail : head;
    const end = rapidCase.direction === 'backward' ? head : tail;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
    await assertState('initial');
    await visual.evaluate((surface) => {
      const events = [];
      const observe = (event) => {
        if (events.length < 4 && event.inputType === 'insertText') events.push({ type: event.type,
          trusted: event.isTrusted, dataLength: event.data?.length ?? 0 });
      };
      surface.addEventListener('beforeinput', observe, true); surface.addEventListener('input', observe, true);
      window.__rapidMQEvents = { events, dispose: () => {
        surface.removeEventListener('beforeinput', observe, true); surface.removeEventListener('input', observe, true);
      } };
    });
    eventsActive = true;
    operationStage = 'uninterrupted-MQ'; expectedSource = rapidCase.afterMQ;
    // One real keyboard call: no source/Preview read, timer or await between M and Q.
    await page.keyboard.type('MQ');
    await expectSource(source, expectedSource);
    await assertState('MQ');
    const events = await page.evaluate(() => window.__rapidMQEvents.events);
    expect(events.filter((event) => event.type === 'beforeinput')).toEqual([
      { type: 'beforeinput', trusted: true, dataLength: 1 }, { type: 'beforeinput', trusted: true, dataLength: 1 }
    ]);
    console.log(JSON.stringify({ phase: 'rapid-MQ-native-receipt', caseName: rapidCase.name,
      events, exactSource: true, sourceLength: rapidCase.afterMQ.length }));
    await page.evaluate(() => { window.__rapidMQEvents.dispose(); delete window.__rapidMQEvents; }); eventsActive = false;
    operationStage = 'undo-MQ';
    const undo = await undoToInitial(); expectedSource = rapidCase.initial;
    const redo = [...undo.slice(0, -1).reverse(), 'MQ'];
    for (const kind of redo) {
      if (kind === 'MQ') held = await holdFormalPreview(page);
      operationStage = `redo-${kind}`; expectedSource = kind === 'M' ? rapidCase.afterM : rapidCase.afterMQ;
      await page.keyboard.press('Control+Shift+z'); await expectSource(source, expectedSource); await assertState(kind);
    }
    await held.waitFor(rapidCase.afterMQ);
    const pendingState = await assertState('MQ');
    expect(pendingState).toMatchObject({ nativeConnected: true });
    console.log(JSON.stringify({ phase: 'rapid-MQ-real-held-history', caseName: rapidCase.name, undoKeys: undo.length, state: pendingState }));
    operationStage = 'undo-before-branch'; await undoToInitial(); expectedSource = rapidCase.initial;
    operationStage = 'branch-B'; expectedSource = rapidCase.afterB;
    await page.keyboard.type('B'); await expectSource(source, expectedSource);
    await assertState('B');
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expectedSource);
    operationStage = 'continue-C'; expectedSource = rapidCase.afterBC;
    await page.keyboard.type('C'); await expectSource(source, expectedSource); await assertState('BC');
    await held.close(); held = null;
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await assertState('BC', true); await expectSource(source, expectedSource);
    await previewRead.prove({ visual });
  } catch (error) {
    if (!page.isClosed()) {
      try {
        const actual = await source.inputValue({ timeout: 1000 }); const state = await readFullCrossBlockState(visual);
        console.log(JSON.stringify({ phase: 'rapid-MQ-first-failure', caseName: rapidCase.name, operationStage,
          actualLength: actual.length, expectedLength: expectedSource.length, exactExpected: actual === expectedSource,
          state: safeFullCrossBlockState(state) }));
      } catch { console.log(JSON.stringify({ phase: 'rapid-MQ-observation-unavailable', operationStage })); }
    }
    throw error;
  } finally {
    if (eventsActive && !page.isClosed()) await page.evaluate(() => { window.__rapidMQEvents?.dispose(); delete window.__rapidMQEvents; });
    if (held) await held.close();
  }
});
}

for (const wrapper of [
  { name: 'code', source: '`x`', selector: 'code' },
  { name: 'emphasis', source: '*x*', selector: 'em' },
  { name: 'strong', source: '**x**', selector: 'strong' },
  { name: 'strike', source: '~~x~~', selector: 'del' },
  { name: 'link', source: '[x](https://example.com)', selector: 'a' },
  { name: 'escaped emphasis', source: '*\\**', selector: 'em' },
  { name: 'entity strong', source: '**&amp;**', selector: 'strong' },
  { name: 'entity link', source: '[&amp;](https://example.com)', selector: 'a' },
  { name: 'space normalized code', source: '` Z `', selector: 'code' },
  { name: 'multi delimiter code', source: '`` ` ``', selector: 'code' }
]) {
for (const key of ['Backspace', 'Delete']) {
for (const position of ['end', 'middle']) {
  test(`deleting the final ${wrapper.name} character with ${key} retires only its inline syntax at ${position}`, async ({ page }) => {
    const initial = `Before.\n\n- Head.\n- Tail ${wrapper.source}${position === 'middle' ? '.suffix.' : ''}\n\nAfter.`;
    const expected = initial.replace(wrapper.source, '');
    const continued = expected.replace('- Tail ', '- Tail Y');
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'lifecycle', groups: [[''], [initial], [expected], [initial], [expected], [continued]] }
    ]);
    const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
    await visual.locator(`li ${wrapper.selector}`).click();
    if (position === 'end') {
      await page.keyboard.press('End');
    } else {
      await page.keyboard.press('Home');
      for (let index = 0; index < 'Tail '.length + 1; index += 1) await page.keyboard.press('ArrowRight');
    }
    if (key === 'Delete') await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(key);
    expect(failures).toEqual([]);
    await expectSource(source, expected);
    await expect(visual.locator(`li ${wrapper.selector}`)).toHaveCount(0);
    await expectLiveSelection(visual);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, expected);
    await page.keyboard.type('Y');
    await expectSource(source, continued);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  });
}
}
}

test('native keyboard selections edit all-space inline code without changing adjacent text', async ({ page }) => {
  const initial = 'Lead` `tail.\n\nAfter.';
  const withoutCode = initial.replace('` `', '');
  const continued = withoutCode.replace('Leadtail.', 'LeadXtail.');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withoutCode], [initial], [withoutCode], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const selectSpaces = async (count) => {
    await visual.locator('p').first().click();
    await page.keyboard.press('Home');
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowRight');
    for (let index = 0; index < count; index += 1) await page.keyboard.press('Shift+ArrowRight');
  };
  await selectSpaces(1);
  expect(await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return range.startContainer === range.endContainer
      && range.startContainer.parentElement?.tagName === 'CODE'
      && range.startOffset === 0 && range.endOffset === 1
      && surface.contains(range.startContainer);
  }), 'native keys select exactly the blank code body').toBe(true);
  await page.keyboard.press('Backspace');
  expect(failures).toEqual([]);
  await expectSource(source, withoutCode);
  await expectLiveSelection(visual);
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+Z');
  await expectSource(source, withoutCode);
  await page.keyboard.type('X');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
});

for (const timing of ['normal', 'held']) {
test(`context formatting preserves an unrelated terminal source space through undo and immediate input (${timing} Preview)`, async ({ page }) => {
  const initial = 'Para\n\n---\n\nfoo\n';
  const withSpace = initial.replace('foo\n', 'foo \n');
  const bolded = withSpace.replace('Para', 'P**ar**a');
  const continued = withSpace.replace('Para', 'PZa');
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [withSpace], [bolded], [withSpace], [continued]] }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  let release = () => {};
  let fetched = false;
  let first = true;
  const gate = new Promise((resolve) => { release = resolve; });
  if (timing === 'held') {
    await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
      || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      fetched = true;
      await gate;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
      }
    });
  }
  try {
  await visual.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const point = await visual.evaluate((surface) => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !surface.contains(selection.anchorNode)) {
      throw new Error('context-range-unavailable');
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  // A trailing-space-only edit can reuse Preview until context preparation
  // requests fresh mapping, so wait for that actual request after the gesture.
  if (timing === 'held') await expect.poll(() => fetched).toBe(true);
  release();
  const bold = page.locator('[data-easymde-context-menu-item="bold"]').last();
  await expect(bold).toBeEnabled();
  await expectSource(source, withSpace);
  await bold.click();
  expect(failures).toEqual([]);
  await expectSource(source, withSpace.replace('Para', 'P**ar**a'));
  await page.keyboard.press('Control+z');
  await expectSource(source, withSpace);
  await page.keyboard.type('Z');
  await expectSource(source, continued);
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
  await previewRead.prove({ visual });
  } finally {
    release();
    if (timing === 'held') await page.unrouteAll({ behavior: 'wait' });
  }
});
}

for (const fence of ['~~~', '```']) {
test(`ordinary and immersive split source preserve literal ${fence} fence edits and history`, async ({ page }) => {
  const initial = `${fence}bash\necho 1\n${fence}\n\nAfter.`;
  const { failures, source } = await openVisual(page, initial);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  for (const mode of ['immersive-split', 'ordinary']) {
    if (mode === 'ordinary') {
      await page.getByRole('button', { name: strings.exit, exact: true }).click();
    }
    const editor = page.locator('.easymde-source-react .cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Delete');
    await expectSource(source, initial.slice(1));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    // Shifted character spelling emits the physical shortcut's uppercase key.
    // A lowercase Playwright chord can dispatch Ctrl+z to CodeMirror first.
    await page.keyboard.press('Control+Shift+Z');
    await expectSource(source, initial.slice(1));
    await page.keyboard.type(fence[0]);
    await expectSource(source, initial);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Q');
    await expectSource(source, initial + '\nQ');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
  }
});
}

test('a rejected secondary image gesture keeps the authored text range and the generic menu', async ({ page }) => {
  const image = '![test image](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const initial = `Para\n\n${image}\n\nfoo\n`;
  const { failures, source, visual } = await openVisual(page, initial);
  await expect.poll(() => visual.locator('img').evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await visual.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  const withSpace = initial.replace('foo\n', 'foo \n');
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const point = await visual.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) throw new Error('authored-range-unavailable');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  await expectSource(source, withSpace);
  await visual.locator('img').click({ button: 'right' });
  await expect(page.locator('[data-easymde-context-menu-item="bold"]').last()).toBeEnabled();
  expect(await visual.evaluate(() => getSelection()?.toString() === 'ar')).toBe(true);
  expect(failures).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-easymde-context-menu="true"]')).toHaveCount(0);
  await expectSource(source, withSpace);
  await visual.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.type('Z');
  await expectSource(source, withSpace.replace('Para', 'PZa'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

for (const size of ['full', 'windowed']) {
  test(`${size} rapid input preserves neighboring layout and captured compositor frames`, async ({ page, context }) => {
    const initial = '# Layout reference\n\nTarget paragraph here.\n\nNeighbor paragraph.\n\nAfter paragraph.'
      + (size === 'windowed' ? '\n\n' + Array.from({ length: 170 }, (_, index) => `Filler ${index}.`).join('\n\n') : '');
    const { failures, source, visual } = await openVisual(page, initial);
    expect(await visual.locator('[data-easymde-preview-window-spacer]').count() > 0).toBe(size === 'windowed');
    const target = visual.locator('p').filter({ hasText: /^Target paragraph here\.$/u });
    await target.click();
    await page.keyboard.press('End');
    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', (event) => {
      if (frames.length < 32) frames.push(event.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await visual.evaluate((surface) => {
      const heading = surface.querySelector('h1');
      const neighbor = [...surface.querySelectorAll('p')].find((node) => node.textContent === 'Neighbor paragraph.');
      const samples = [];
      let active = true;
      window.__visualLayoutSample = { samples, stop: () => { active = false; } };
      const sample = () => {
        const box = neighbor?.getBoundingClientRect();
        samples.push({
          connected: !!heading?.isConnected && !!neighbor?.isConnected,
          top: box?.top ?? null, height: box?.height ?? null,
          editable: surface.isContentEditable,
          selectionInside: surface.contains(getSelection()?.anchorNode)
        });
        if (active && samples.length < 180) requestAnimationFrame(sample);
      };
      sample();
    });
    try {
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
      await page.keyboard.type('0123456789XYZ');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      const edited = initial.replace('Target paragraph here.', 'Target paragraph here.0123456789');
      await expectSource(source, edited);
      await expectLiveSelection(visual);
      // Include the settled surface and its next painted frames in the observation.
      await expect(visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally {
      await cdp.send('Page.stopScreencast');
      await page.evaluate(() => window.__visualLayoutSample.stop());
    }
    const samples = await page.evaluate(() => window.__visualLayoutSample.samples);
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((sample) => sample.connected && sample.editable && sample.selectionInside)).toBe(true);
    expect(Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height))).toBeLessThanOrEqual(1);
    expect(frames.length, 'actual compositor frames must be available for visual inspection').toBeGreaterThan(1);
    for (let index = 0; index < frames.length; index += 1) {
      const framePath = test.info().outputPath(`compositor-${index}.png`);
      await writeFile(framePath, Buffer.from(frames[index], 'base64'));
      await test.info().attach(`compositor-${index}`, { path: framePath, contentType: 'image/png' });
    }
    await test.info().attach('neighbor-layout-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    console.log(JSON.stringify({ phase: 'bounded-layout-evidence', size,
      frameCount: frames.length, sampleCount: samples.length,
      topSpan: Math.max(...samples.map((sample) => sample.top)) - Math.min(...samples.map((sample) => sample.top)),
      heightSpan: Math.max(...samples.map((sample) => sample.height)) - Math.min(...samples.map((sample) => sample.height)) }));
    expect(failures).toEqual([]);
    await cdp.detach();
  });
}

test('paragraph Enter commits a split and accepts immediate input', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  expect(failures).toEqual([]);
  await expectSource(source, 'Before.\n\nab\n\nXcdef\n\nAfter.');
  await expectLiveSelection(visual);
});

for (const command of ['delete', 'cut']) {
for (const timing of ['pending', 'settled']) {
  test(`code menu undo restores the input caret with ${timing} Preview (${command})`, async ({ page }) => {
    const initial = 'Before paragraph.\n\n~~~bash\necho one\n~~~\n\nAfter paragraph.';
    const fence = '~~~bash\necho one\n~~~';
    const removed = initial.replace(fence, '');
    const continued = initial.replace('echo one', 'echo oneX');
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'lifecycle', groups: [[''], [initial], [`${fence}\n`, fence], [removed], [initial], [continued]] }
    ]);
    const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
    await visual.locator('pre code').click();
    await page.keyboard.press('End');
    const caret = await page.evaluate(() => {
      const selection = getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { x: rect.x - 1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(caret.x, caret.y, { button: 'right' });
    if (command === 'delete') {
      await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
      await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
    } else {
      await page.locator('[data-easymde-context-menu-item="cut"]').last().click();
    }
    await expectSource(source, initial.replace(fence, ''));
    await expect(visual.locator('pre')).toHaveCount(0);
    await expect(visual).toHaveAttribute('aria-busy', 'false');

    let release;
    let blocked = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    if (timing === 'pending') {
      await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
        || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
        blocked += 1;
        await gate;
        try {
          await route.continue();
        } catch (error) {
          // A superseding edit may abort the held obsolete Preview request.
          if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
        }
      });
    }
    try {
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      if (timing === 'pending') {
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await expect(visual).toHaveAttribute('aria-busy', 'true');
      } else {
        await expect(visual.locator('pre')).toHaveCount(1);
        await expect(visual).toHaveAttribute('aria-busy', 'false');
      }
      // Do not click or restore the caret after Undo: history owns this position.
      await page.keyboard.type('X');
      expect(failures).toEqual([]);
      release();
      await expectSource(source, continued);
      await expect(visual).toHaveAttribute('aria-busy', 'false');
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
      await previewRead.prove({ visual });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
}

for (const block of [
  { name: 'paragraph', selector: 'p', markdown: 'abcdef\n\nAfter.' },
  { name: 'heading', selector: 'h1', markdown: '# abcdef\n\nAfter.' },
  { name: 'code body', selector: 'pre code', markdown: 'Before.\n\n~~~bash\nabcdef\n~~~\n\nAfter.' }
]) {
  test(`mixed character edits preserve untouched syntax in ${block.name}`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, block.markdown);
    await visual.locator(block.selector).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('中A7!');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.type('Q');
    await expectSource(source, block.markdown.replace('abcdef', 'ab中Qdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('Chromium composition commits once and remains editable after history', async ({ page, context }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await visual.evaluate((surface) => {
    window.__easymdeTestCompositionEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      surface.addEventListener(type, () => window.__easymdeTestCompositionEvents.push(type));
    }
  });
  const input = await context.newCDPSession(page);
  try {
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    await input.send('Input.insertText', { text: '你' });
    await expectSource(source, initial.replace('abcdef', 'ab你cdef'));
    const events = await page.evaluate(() => window.__easymdeTestCompositionEvents);
    expect(events.filter((event) => event === 'compositionstart')).toHaveLength(1);
    expect(events.filter((event) => event === 'compositionend')).toHaveLength(1);
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.type('X');
    await expectSource(source, initial.replace('abcdef', 'abXcdef'));
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  } finally {
    await input.detach();
  }
});

test('plain paragraph middle input undo preserves its original visual caret', async ({ page }) => {
  const initial = 'Before.\n\nabcdef\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X');
  await expectSource(source, initial.replace('abcdef', 'abXcdef'));
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.type('Y');
  await expectSource(source, initial.replace('abcdef', 'abYcdef'));
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('incoming formal Preview preserves newer keyboard input during history transfer', async ({ page }) => {
  const initial = 'Before.\n\n~~~bash\necho one\n~~~\n\nAfter.';
  const fence = '~~~bash\necho one\n~~~';
  const removed = initial.replace(fence, '');
  const withB = initial.replace('echo one', 'echo oneB');
  const withBC = initial.replace('echo one', 'echo oneBC');
  const withBCD = initial.replace('echo one', 'echo oneBCD');
  const withBCDE = initial.replace('echo one', 'echo oneBCDE');
  const withBCDEF = initial.replace('echo one', 'echo oneBCDEF');
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [`${fence}\n`, fence], [removed], [initial],
        [withB], [withBC], [withBCD], [withBCDE], [withBCDEF],
        [withBCDE], [withBCD], [withBC], [withB], [initial],
        [withB], [withBC], [withBCD], [withBCDE], [withBCDEF]
      ]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  await visual.locator('pre code').click();
  await page.keyboard.press('End');
  const caret = await page.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) throw new Error('code-caret-unavailable');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x - 1, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(caret.x, caret.y, { button: 'right' });
  await page.locator('[data-easymde-context-menu-item="code-block"]').hover();
  await page.locator('[data-easymde-context-menu-item="delete-code-block"]').last().click();
  await expectSource(source, initial.replace('~~~bash\necho one\n~~~', ''));
  await expect(visual.locator('pre')).toHaveCount(0);
  await expect(visual).toHaveAttribute('aria-busy', 'false');
  let fetched = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  await page.route((url) => url.pathname.endsWith('/easymde/v1/preview')
    || url.searchParams.get('rest_route') === '/easymde/v1/preview', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    fetched = true;
    try {
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      if (route.request().failure()?.errorText !== 'net::ERR_ABORTED') throw error;
    } finally {
      await response.dispose();
    }
  });
  try {
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expect.poll(() => fetched).toBe(true);
    await page.keyboard.type('BC');
    // Deliver the actual older PHP response during newer keyboard input.
    release();
    await page.keyboard.type('DE');
    expect(failures).toEqual([]);
    await expectSource(source, initial.replace('echo one', 'echo oneBCDE'));
    await expect(visual).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.type('F');
    await expectSource(source, initial.replace('echo one', 'echo oneBCDEF'));
    await expectLiveSelection(visual);
    const completed = await source.inputValue();
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 12) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) await page.keyboard.press('Control+Shift+z');
    await expectSource(source, completed);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
    await previewRead.prove({ visual });
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const character of ['👩🏽‍💻', 'e\u0301']) {
  test(`native character selection preserves Unicode ${character}`, async ({ page }) => {
    const initial = `Before.\n\nA${character}Z\n\nAfter.`;
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(character);
    await page.keyboard.press('Backspace');
    await expectSource(source, 'Before.\n\nAZ\n\nAfter.');
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

test('native EOF Delete remains a no-op and preserves subsequent input and history', async ({ page }) => {
  const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
  const { failures, source, visual } = await openVisual(page, initial);
  await visual.evaluate((surface) => {
    window.__nativeNoopEvents = [];
    for (const type of ['beforeinput', 'input']) surface.addEventListener(type, (event) => {
      if (event.inputType !== 'deleteContentForward') return;
      const ranges = event.getTargetRanges?.() ?? [];
      const target = ranges[0];
      window.__nativeNoopEvents.push({ type: event.type, prevented: event.defaultPrevented,
        trusted: event.isTrusted, targetCount: ranges.length,
        targetCollapsed: !!target && target.startContainer === target.endContainer && target.startOffset === target.endOffset });
    });
  });
  await visual.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Delete');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const events = await page.evaluate(() => window.__nativeNoopEvents);
  expect(events, 'The proved zero-length deletion must complete without leaving a native input transaction open').toEqual([
    { type: 'beforeinput', prevented: true, trusted: true, targetCount: 1, targetCollapsed: true }
  ]);
  await expectSource(source, initial);
  await expectNativeTail(visual.locator('p').last(), 'After.');
  await page.keyboard.type('X');
  await expectSource(source, initial + 'X');
  await page.keyboard.press('Control+z');
  await expectSource(source, initial);
  await page.keyboard.press('Control+Shift+z');
  await expectSource(source, initial + 'X');
  await expectLiveSelection(visual);
  expect(failures).toEqual([]);
});

test('held same-source formal Preview preserves active Chromium composition and history', async ({ page, context }) => {
  test.setTimeout(60_000);
  const definition = '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png\n\n';
  const paragraph = 'Opening ![dot][pic] tail.';
  const initial = definition + paragraph + '\n\n';
  const withX = initial.replace(paragraph, paragraph + 'X');
  const committed = initial.replace(paragraph, paragraph + '你');
  const withQ = initial.replace(paragraph, paragraph + 'Q');
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [[''], [initial], [withX], [initial], [withX], [initial], [committed], [initial], [withQ]]
    }
  ]);
  const { failures, source, visual } = await openVisual(page, initial, undefined, previewRead.beforeFixture);
  const gate = await holdFormalPreview(page);
  const input = await context.newCDPSession(page);
  let gateClosed = false;
  try {
    const row = visual.locator('p').filter({ has: page.locator('img[alt="dot"]') });
    await row.click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Control+z');
    await expectSource(source, initial);
    await page.keyboard.press('Control+Shift+z');
    await expectSource(source, initial.replace(paragraph, paragraph + 'X'));
    await page.keyboard.press('Backspace');
    await expectSource(source, initial);
    expect(failures).toEqual([]);
    await gate.waitFor(initial);
    await input.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await input.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    expect(failures, 'Active browser composition must remain accepted').toEqual([]);
    await expectSource(source, initial);
    const draft = await visual.evaluateHandle((surface) => {
      const native = surface.ownerDocument.getSelection();
      if (!(native?.anchorNode instanceof Text) || !surface.contains(native.anchorNode)) throw new Error('composition-native-draft-missing');
      return native.anchorNode;
    });
    try {
      const delivered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (url.pathname.endsWith('/easymde/v1/preview') || url.searchParams.get('rest_route') === '/easymde/v1/preview')
          && response.request().postDataJSON()?.markdown === initial && response.status() === 200;
      });
      await gate.close();
      gateClosed = true;
      await delivered;
      await expect.poll(() => visual.getAttribute('data-easymde-preview-phase')).not.toBe('loading');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const retained = await visual.evaluate((surface, node) => {
        const native = surface.ownerDocument.getSelection();
        return { connected: node.isConnected && surface.contains(node),
          draftRetained: node instanceof Text && node.data.endsWith('你'),
          nativeRetained: native?.anchorNode === node && native.focusNode === node,
          focused: surface.ownerDocument.activeElement === surface, editable: surface.isContentEditable };
      }, draft);
      expect(retained, 'The actual same-source PHP response must not replace an active native composition').toEqual({
        connected: true, draftRetained: true, nativeRetained: true, focused: true, editable: true
      });
      expect(failures).toEqual([]);
      await input.send('Input.insertText', { text: '你' });
      await expectSource(source, committed);
      await page.keyboard.press('Control+z');
      await expectSource(source, initial);
      await page.keyboard.type('Q');
      await expectSource(source, withQ);
      await expectLiveSelection(visual);
      expect(failures).toEqual([]);
      await previewRead.prove({ visual });
    } finally { await draft.dispose(); }
  } finally {
    if (!gateClosed) await gate.close();
    await input.detach();
  }
});
