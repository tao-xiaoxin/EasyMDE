import { expect, test } from '@playwright/test';
import {
  createPhasedPreviewOperationTracker,
  expectLiveSelection,
  expectSource,
  openVisual,
  readPublicEditorState,
  readShortStageFinalPreviewCertificate,
  registerVisualEditingHooks,
  safePublicState
} from '../helpers/visual-editing-helpers.mjs';
import {
  finishShortStageObservation,
  installBackgroundProbe,
  openShortStage,
  shortStageDeclaredCodeDescriptors,
  shortStageHistoryCursorSnapshot,
  shortStageHistoryLedger,
  shortStageInitial,
  shortStagePhaseModel,
  shortStageReplayHistory,
  shortStageRestoreHistoryCursor,
  shortStageUniqueCodeDeclarations,
  startShortStageFrames,
  startShortStageProbe
} from '../helpers/visual-short-stage-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

registerVisualEditingHooks();

for (const mode of ['ordinary', 'split', 'full']) {
for (const pacing of ['normal', 'burst']) {
  test(`[short-stage] ${mode} ${pacing} mixed lifecycle reaches source zero and replays natural history`, async ({ page }) => {
    const phaseModel = shortStagePhaseModel(mode);
    let previewReadOperationId = null;
    const stage = await openShortStage(page, mode, shortStageInitial, ({ browserMonitor, postId, renderParams }) => {
      previewReadOperationId = browserMonitor.beginPhased({
        postId,
        renderParams,
        phases: phaseModel.phases
      });
    });
    expect(Number.isSafeInteger(previewReadOperationId)).toBe(true);
    const enterPreviewPhase = (phaseId) => {
      stage.browserMonitor.enterPhase(previewReadOperationId, phaseId);
    };
    const {
      allowed, branch, branchBase, continued, entered, middleOffset, middleQSource,
      oracle, phaseIds, positions, shortened
    } = phaseModel;
    const probe = await startShortStageProbe(page, stage, allowed, {
      codeDescriptorsBySource: shortStageDeclaredCodeDescriptors
    });
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'whole-document-Backspace', failed = true;
    try {
      phase = 'real-mouse-and-arrow-positions'; frames.stage(phase);
      for (const position of positions) {
        enterPreviewPhase(phaseIds.positions[position.phaseIndex]);
        const sourceOffset = shortStageInitial.indexOf(position.needle) + position.offset;
        probe.guard();
        if (mode === 'full') {
          await stage.visual.locator(position.selector).nth(position.index).click({ position: { x: 3, y: 3 } });
          await probe.press('Home');
          for (let index = 0; index < position.offset; index += 1) await probe.press('ArrowRight');
        } else {
          await stage.surface.click(); await probe.press('Control+Home');
          for (let index = 0; index < sourceOffset; index += 1) await probe.press('ArrowRight');
        }
        await probe.type('V');
        await expectSource(stage.source, shortStageInitial.slice(0, sourceOffset) + 'V' + shortStageInitial.slice(sourceOffset));
        await probe.press('Backspace'); await expectSource(stage.source, shortStageInitial);
      }
      await stage.surface.click(); await probe.press('Control+End');
      enterPreviewPhase(phaseIds.deletion);
      await probe.beginDeletion(oracle);
      phase = 'whole-document-Backspace';
      frames.stage(phase);
      let rank = Infinity, consumed = 0;
      const checkDeletionRows = async () => {
        const observation = await probe.snapshot();
        for (const row of observation.rows.slice(consumed)) {
          expect(oracle.has(row.value), 'EOF deletion must match a complete independently declared state').toBe(true);
          const next = oracle.get(row.value);
          expect(next, 'EOF deletion may not grow or reorder a preceding block').toBeLessThanOrEqual(rank);
          rank = next;
        }
        consumed = observation.rows.length;
        probe.guard();
      };
      for (let key = 0; key < shortStageInitial.length * 3 + 16 && !probe.empty(); key += 1) {
        await probe.press('Backspace');
        if (pacing === 'normal') await checkDeletionRows();
      }
      await expectSource(stage.source, '');
      await checkDeletionRows();
      phase = 'extra-Backspace-at-source-zero'; frames.stage(phase);
      enterPreviewPhase(phaseIds.emptyExtraBackspace);
      const zero = await readPublicEditorState(page);
      for (let key = 0; key < 3; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, '');
      const afterExtra = await readPublicEditorState(page);
      expect({ sourceEmpty: afterExtra.source === '', ...safePublicState(afterExtra) }).toMatchObject({
        sourceEmpty: true, sourceLength: 0, effectiveEditable: true,
        contenteditable: 'true', lock: mode === 'full' ? 'false' : null, session: 'ready', focused: true });
      expect(afterExtra.nativeAnchor, 'Backspace at source zero must not move the native anchor')
        .toEqual(zero.nativeAnchor);
      expect(afterExtra.nativeFocus, 'Backspace at source zero must not move the native focus')
        .toEqual(zero.nativeFocus);
      phase = 'empty-input-Enter-immediate-input'; frames.stage(phase);
      enterPreviewPhase(phaseIds.reentry);
      await probe.allow(new Set(['', branchBase, entered, continued, shortened, branch]));
      await probe.type('Z');
      if (pacing === 'normal') await expectSource(stage.source, 'Z');
      await probe.press('Enter');
      if (pacing === 'normal') await expectSource(stage.source, entered);
      await probe.type('XY');
      await expectSource(stage.source, continued);
      await probe.press('Backspace');
      await expectSource(stage.source, shortened);
      const forward = await probe.snapshot();
      const history = shortStageHistoryLedger(forward.rows, shortStageInitial, allowed);
      await probe.freeze();
      phase = 'groupwise-Undo-full-exact'; frames.stage(phase);
      enterPreviewPhase(phaseIds.fullUndo);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, shortStageInitial);
      phase = 'groupwise-Redo-full-exact'; frames.stage(phase);
      enterPreviewPhase(phaseIds.fullRedo);
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, shortened);
      phase = 'history-branch-and-continuation'; frames.stage(phase);
      enterPreviewPhase(phaseIds.branchToZ);
      await shortStageReplayHistory(page, stage, probe, history, 'undo', { value: branchBase, witness: null });
      const branchCursor = shortStageHistoryCursorSnapshot(history);
      const branchBefore = await stage.source.inputValue();
      expect(branchBefore === branchBase, 'branch point must be the independently expected observed source state').toBe(true);
      const branchPoint = await readPublicEditorState(page);
      expect(branchPoint.nativeCollapsed, 'branch point keeps a real collapsed native caret').toBe(true);
      expect(branchPoint.nativeConnected, 'branch point keeps the native caret connected').toBe(true);
      const branchWitnessBefore = await probe.witness();
      const branchCaretBeforeExact = branchWitnessBefore.collapsed === true
        && branchWitnessBefore.anchor?.connected === true && branchWitnessBefore.focus?.connected === true
        && JSON.stringify(branchWitnessBefore.anchor) === JSON.stringify(branchWitnessBefore.focus)
        && branchWitnessBefore.anchor?.column === 1
        && branchWitnessBefore.anchor?.blockLength === 1
        && (mode === 'full'
          ? branchWitnessBefore.anchor?.kind === 'visual' && branchWitnessBefore.anchor?.blockOrdinal === 0
          : branchWitnessBefore.anchor?.kind === 'source' && branchWitnessBefore.anchor?.lineIndex === 0);
      expect(branchCaretBeforeExact, 'branch input begins at the independently expected native text end').toBe(true);
      enterPreviewPhase(phaseIds.branchInput);
      await probe.type('B');
      await expectSource(stage.source, branch);
      const branchWitnessAfter = await probe.witness();
      const branchCaretAfterExact = branchWitnessAfter.collapsed === true
        && branchWitnessAfter.anchor?.connected === true && branchWitnessAfter.focus?.connected === true
        && JSON.stringify(branchWitnessAfter.anchor) === JSON.stringify(branchWitnessAfter.focus)
        && branchWitnessAfter.anchor?.column === 2
        && branchWitnessAfter.anchor?.blockLength === 2
        && (mode === 'full'
          ? branchWitnessAfter.anchor?.kind === 'visual' && branchWitnessAfter.anchor?.blockOrdinal === 0
          : branchWitnessAfter.anchor?.kind === 'source' && branchWitnessAfter.anchor?.lineIndex === 0);
      expect(branchCaretAfterExact, 'branch input lands at the independently expected native text end').toBe(true);
      enterPreviewPhase(phaseIds.invalidRedo);
      await probe.press('Control+Shift+Z');
      await expectSource(stage.source, branch);
      enterPreviewPhase(phaseIds.undoBranch);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      enterPreviewPhase(phaseIds.redoBranch);
      await probe.press('Control+Shift+Z'); await expectSource(stage.source, branch);
      enterPreviewPhase(phaseIds.undoBranchAgain);
      await probe.press('Control+z'); await expectSource(stage.source, branchBefore);
      shortStageRestoreHistoryCursor(history, branchCursor);
      enterPreviewPhase(phaseIds.restoreInitial);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, shortStageInitial);
      phase = 'restored-middle-direct-continuation'; frames.stage(phase);
      enterPreviewPhase(phaseIds.middleQ);
      if (mode === 'full') {
        await stage.visual.locator('p').nth(1).click({ position: { x: 3, y: 3 } });
        await probe.press('Home'); await probe.press('ArrowRight');
      } else {
        await stage.surface.click(); await probe.press('Control+Home');
        for (let index = 0; index < middleOffset; index += 1) await probe.press('ArrowRight');
      }
      await probe.type('Q');
      await expectSource(stage.source, middleQSource);
      enterPreviewPhase(phaseIds.middleQUndo);
      await probe.press('Control+z'); await expectSource(stage.source, shortStageInitial);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      const finalDrain = await stage.browserMonitor.drain({ timeoutMs: 8_000, quietMs: 300 });
      expect(finalDrain, 'final Preview drain must settle only after all phase actions').toBe(true);
      probe.guard();
      const finalState = await readPublicEditorState(page);
      const finalWitness = await probe.witness();
      const previewCertificate = await readShortStageFinalPreviewCertificate(page, shortStageInitial);
      const targetBlockLength = 'Target paragraph here.'.length;
      const expectedCaret = mode === 'full'
        ? { kind: 'visual', connected: true, inside: true, blockOrdinal: 2, lineIndex: null,
          column: 1, blockLength: targetBlockLength, surfaceOffset: null }
        : { kind: 'source', connected: true, inside: true, blockOrdinal: null, lineIndex: 4,
          column: 1, blockLength: targetBlockLength, surfaceOffset: null };
      expect({ sourceExact: finalState.source === shortStageInitial, ...safePublicState(finalState) }).toMatchObject({
        sourceExact: true, sourceInputConnected: true, effectiveEditable: true,
        contenteditable: 'true', focused: true,
        previewPhase: mode === 'full' ? 'ready' : null,
        busy: mode === 'full' ? 'false' : null,
        failure: null, session: 'ready', lock: mode === 'full' ? 'false' : null, repairCount: 0,
        nativeConnected: true, nativeCollapsed: true
      });
      expect(finalWitness).toMatchObject({ collapsed: true, direction: 'none',
        anchor: expectedCaret, focus: expectedCaret });
      expect(previewCertificate).toEqual({
        sourceExact: true, sinkCount: 1, sinkConnected: true, blockOrderExact: true,
        paragraphCount: 3, paragraphTextExact: true, headingCount: 1, headingTextExact: true,
        preCount: 1, codeCount: 1, codeTextExact: true, phaseReady: true, acceptedOne: true,
        busyFalse: true, previewErrorAbsent: true, refreshingAbsent: true,
        globalFailureAbsent: true
      });
      const proof = stage.browserMonitor.provePreviewReadOperation(previewReadOperationId, {
        finalUiVerified: true
      });
      const finalMonitor = stage.browserMonitor.summary();
      expect(proof.approved, 'declared phased Preview reads must prove recoverable cancellation').toBe(true);
      expect(proof.code).toBe('preview-read-operation-approved');
      expect(Number.isInteger(proof.approvedAbortCount) && proof.approvedAbortCount >= 0).toBe(true);
      expect(finalMonitor.issues).toEqual([]);
      expect(finalMonitor.approved.previewCancellations).toBe(proof.approvedAbortCount);
      expect(finalMonitor.counts.requestFailures).toBeGreaterThanOrEqual(proof.approvedAbortCount);
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-complete', mode, pacing,
        trueSourceZero: true, observedSourceTransitions: Math.max(0, history.states.length - 1),
        final: { sourceLength: finalState.sourceLength, editable: finalState.effectiveEditable,
          lock: finalState.lock, session: finalState.session, nativeConnected: finalState.nativeConnected,
          collapsed: finalState.nativeCollapsed, repairCount: finalState.repairCount },
        preview: { phaseReady: previewCertificate.phaseReady, acceptedOne: previewCertificate.acceptedOne,
          busyFalse: previewCertificate.busyFalse, semanticCounts: [previewCertificate.paragraphCount,
            previewCertificate.headingCount, previewCertificate.preCount, previewCertificate.codeCount] },
        phasedPreview: { approved: proof.approved, approvedAbortCount: proof.approvedAbortCount,
          requestFailures: finalMonitor.counts.requestFailures, issueCount: finalMonitor.issues.length },
        health: forward.health, realOSIME: false }));
      failed = false;
    } catch (error) {
      const failedState = await readPublicEditorState(page);
      console.log(JSON.stringify({ phase: 'short-stage-lifecycle-first-failure', mode, pacing, operation: phase,
        state: { sourceLength: failedState.sourceLength, editable: failedState.effectiveEditable,
          lock: failedState.lock, nativeConnected: failedState.nativeConnected },
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      await finishShortStageObservation(probe, frames, `short-${mode}-${pacing}`, failed);
    }
  });
}
}

for (const shortcut of [
  { marker: '~~~', language: 'python', position: 'start' },
  { marker: '```', language: 'javascript', position: 'end' },
  { marker: '~~~~', language: 'bash', position: 'middle' },
  { marker: '````', language: '', position: 'start' },
  { marker: '~~~', language: '', position: 'end' },
  { marker: '```', language: 'python', position: 'middle' }
]) {
  test(`fence creation and history at ${shortcut.position}: ${shortcut.marker}${shortcut.language}`, async ({ page }) => {
    const initial = 'Before.\n\nMiddle.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    if (shortcut.position === 'start') {
      await visual.locator('p').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Home');
    } else {
      await visual.locator('p').nth(shortcut.position === 'middle' ? 1 : 2).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type(shortcut.marker + shortcut.language);
    await page.keyboard.press('Enter');
    await page.keyboard.type('x = 1');
    expect(failures).toEqual([]);
    await expect(visual.locator('pre code')).toHaveText('x = 1\n');
    await expect.poll(async () => (await source.inputValue()).includes('x = 1')).toBe(true);
    const created = await source.inputValue();
    expect(new RegExp('(?:^|\\n)(?:`{3,}|~{3,})' + shortcut.language + '\\n').test(created)).toBe(true);
    let undoSteps = 0;
    while (await source.inputValue() !== initial && undoSteps < 40) {
      await page.keyboard.press('Control+z');
      undoSteps += 1;
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, initial);
    for (let step = 0; step < undoSteps; step += 1) {
      await page.keyboard.press('Control+Shift+z');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await expectSource(source, created);
    await page.keyboard.type('Z');
    await expectSource(source, created.replace('x = 1', 'x = 1Z'));
    expect(failures).toEqual([]);
  });
}

for (const fence of ['~~~', '```']) {
  test(`${fence} unfinished language shortcut erases without losing selection`, async ({ page }) => {
    const initial = 'Before.\n\nTarget paragraph here.\n\nAfter.';
    const { failures, source, visual } = await openVisual(page, initial);
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const shortcut = `${fence}python`;
    await page.keyboard.type(shortcut);
    for (let index = 0; index < shortcut.length; index += 1) {
      await page.keyboard.press('Backspace');
      expect(failures).toEqual([]);
      await expectLiveSelection(visual);
    }
    await page.keyboard.type('Replacement');
    await expect.poll(async () => (await source.inputValue()).includes('Replacement')).toBe(true);
    await expect(visual.locator('pre')).toHaveCount(0);
    expect(failures).toEqual([]);
  });

  test(`${fence} language shortcut creates code and accepts immediate typing`, async ({ page }) => {
    const { failures, source, visual } = await openVisual(page, 'Before.\n\nTarget paragraph here.\n\nAfter.');
    await visual.locator('p').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${fence}bash`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('echo 123');
    await expect(visual.locator('pre code')).toContainText('echo 123');
    await expectLiveSelection(visual);
    await expect.poll(async () => /(?:`{3,}|~{3,})bash\n(?:[^\n]*\n)*?echo 123/u.test(await source.inputValue())).toBe(true);
    expect(failures).toEqual([]);
    await page.keyboard.press('Control+z');
    await page.keyboard.type('new');
    await expect.poll(async () => (await source.inputValue()).includes('new')).toBe(true);
    await expectLiveSelection(visual);
    expect(failures).toEqual([]);
  });
}

const shortFenceRepresentatives = [
  { marker: '```', language: 'bash', position: 'start', pacing: 'normal' },
  { marker: '````', language: '', position: 'start', pacing: 'burst' },
  { marker: '````', language: 'python', position: 'middle', pacing: 'normal' },
  { marker: '```', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '```', language: '', position: 'end', pacing: 'normal' },
  { marker: '````', language: 'bash', position: 'end', pacing: 'burst' },
  { marker: '~~~', language: 'python', position: 'start', pacing: 'normal' },
  { marker: '~~~~', language: '', position: 'start', pacing: 'burst' },
  { marker: '~~~~', language: 'bash', position: 'middle', pacing: 'normal' },
  { marker: '~~~', language: 'javascript', position: 'middle', pacing: 'burst' },
  { marker: '~~~', language: '', position: 'end', pacing: 'normal' },
  { marker: '~~~~', language: 'python', position: 'end', pacing: 'burst' }
];

function shortFenceFixture(position) {
  if (position === 'start') return 'Slot\n\n# Heading\n\nAfter.\n\n- keep item';
  if (position === 'middle') return '# Heading\n\nSlot\n\nAfter.\n\n- keep item';
  return '# Heading\n\nBefore.\n\n- keep item\n\nSlot\n\n';
}

for (const fence of shortFenceRepresentatives) {
  test(`[short-stage] full ${fence.pacing} ${fence.position} fence ${fence.marker}${fence.language || '(no-language)'} lifecycle`, async ({ page }) => {
    const initial = shortFenceFixture(fence.position), opener = fence.marker + fence.language;
    const emptySlot = initial.replace('Slot', '');
    const literal = (text) => initial.replace('Slot', text.replace(/[`~]/gu, '\\$&'));
    // Full's shortcut contract preserves the typed fence marker family (backticks or tildes).
    const marker = fence.marker;
    const code = (body) => initial.replace('Slot', `${marker}${fence.language}\n${body}\n${marker}`);
    // At absolute start, the new fence's row domain and its following two-LF
    // separator occupy this fixed fixture slot. Preserve the following source
    // byte-for-byte; other positions retain their unverified existing oracle.
    const startSlot = 'Slot\n\n';
    if (fence.position === 'start') expect(initial.startsWith(startSlot)).toBe(true);
    const exited = fence.position === 'start'
      ? initial.slice(startSlot.length)
      : fence.position === 'end'
        ? initial.slice(0, initial.indexOf('Slot'))
        : initial.replace('Slot', '  ');
    const continued = initial.replace('Slot', 'Z');
    const branched = initial.replace('Slot', 'ZB');
    const openerForward = Array.from({ length: opener.length }, (_, index) => [literal(opener.slice(0, index + 1))]);
    const openerReverse = openerForward.slice().reverse().map((group) => [...group]);
    const fenceForwardGroups = [
      [initial],
      [emptySlot],
      ...openerForward,
      ...openerReverse,
      [emptySlot],
      ...openerForward,
      [code('')], [code('a')], [code('ab')], [code('a')], [code('a\n')], [code('a\nx')],
      [code('a\nxy')], [code('a\nQ')], [code('')], [exited], [continued]
    ];
    const fenceReverseGroups = fenceForwardGroups.slice().reverse().map((group) => [...group]);
    const previewRead = createPhasedPreviewOperationTracker([
      { id: 'fixture', groups: [[''], [initial]] },
      { id: 'forward', groups: fenceForwardGroups },
      { id: 'undo-initial', groups: fenceReverseGroups },
      { id: 'redo-continued', groups: fenceForwardGroups },
      { id: 'branch-b', groups: [[continued], [branched], [continued]] },
      { id: 'final-undo', groups: fenceReverseGroups }
    ]);
    const stage = await openShortStage(page, 'full', initial, previewRead.beforeFixture);
    const allowed = new Set([initial, emptySlot, exited, continued]);
    for (let end = 1; end <= opener.length; end += 1) allowed.add(literal(opener.slice(0, end)));
    const codeBodies = ['', 'a', 'ab', 'a\n', 'a\nx', 'a\nxy', 'a\nQ'];
    for (const body of codeBodies) allowed.add(code(body));
    const slotStart = initial.indexOf('Slot');
    const codeBlockOrdinal = fence.position === 'start' ? 0 : fence.position === 'middle' ? 1 : 3;
    const openingFence = `${marker}${fence.language}\n`;
    const codeDescriptorsBySource = shortStageUniqueCodeDeclarations(codeBodies.map((body) => {
      const bodyStart = slotStart + openingFence.length;
      const bodyEnd = bodyStart + body.length;
      return {
        source: code(body),
        descriptor: Object.freeze({
          blockOrdinal: codeBlockOrdinal,
          codeOrdinal: 0,
          body,
          bodyStart,
          bodyEnd,
          closingFenceLfStart: bodyEnd,
          closingFenceLfEnd: bodyEnd + 1,
          sourceBlockStart: slotStart,
          sourceBlockEnd: bodyEnd + 1 + marker.length
        })
      };
    }));
    const probe = await startShortStageProbe(page, stage, allowed, { codeDescriptorsBySource });
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'real-slot-selection', failed = true;
    let exitOwnership = null;
    const readZState = async (text) => stage.visual.evaluate((surface, expected) => {
      const paragraphs = [...surface.querySelectorAll(':scope > p')].filter((p) => p.textContent === expected);
      const paragraph = paragraphs.length === 1 ? paragraphs[0] : null;
      const native = surface.ownerDocument.getSelection();
      let caretOffset = null;
      if (paragraph && native?.anchorNode && paragraph.contains(native.anchorNode)) {
        const prefix = surface.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        caretOffset = prefix.toString().length;
      }
      return { paragraphCount: paragraphs.length, paragraphConnected: !!paragraph?.isConnected,
        paragraphDirect: !!paragraph && paragraph.parentNode === surface,
        paragraphEditable: !!paragraph && paragraph.isContentEditable,
        bodyLength: paragraph?.textContent.length ?? null, caretOffset,
        collapsed: native?.isCollapsed === true,
        connected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
          && !!surface.contains(native.anchorNode) && !!surface.contains(native.focusNode),
        focused: surface.ownerDocument.activeElement === surface,
        surfaceConnected: surface.isConnected, editable: surface.isContentEditable,
        lock: surface.ownerDocument.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') };
    }, text);
    const assertContinuedCaret = async (point, expectedText) => {
      const state = await readZState(expectedText);
      expect(state, `${point}: native caret must follow the fixed fixture text`).toMatchObject({
        paragraphCount: 1, paragraphConnected: true, paragraphDirect: true, paragraphEditable: true,
        bodyLength: expectedText.length, caretOffset: expectedText.length, collapsed: true, connected: true,
        focused: true, surfaceConnected: true, editable: true, lock: 'false' });
      return state;
    };
    try {
      frames.stage(phase);
      await stage.visual.locator('p').filter({ hasText: /^Slot$/u }).click({ position: { x: 3, y: 3 } });
      await probe.press('Home'); await probe.press('Shift+End');
      previewRead.enterPhase('forward');
      phase = 'unfinished-opener-and-characterwise-clear'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      for (let key = 0; key < opener.length; key += 1) await probe.press('Backspace');
      await expectSource(stage.source, emptySlot);
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      phase = 'Enter-immediate-body-delete-newline-replace'; frames.stage(phase);
      await probe.type(opener);
      if (fence.pacing === 'normal') await expectSource(stage.source, literal(opener));
      await probe.press('Enter'); await probe.type('ab');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('ab'));
      await probe.press('Backspace');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a'));
      await probe.press('Enter'); await probe.type('xy');
      if (fence.pacing === 'normal') await expectSource(stage.source, code('a\nxy'));
      await probe.press('Shift+ArrowLeft'); await probe.press('Shift+ArrowLeft');
      await probe.type('Q'); await expectSource(stage.source, code('a\nQ'));
      await expect.poll(() => stage.visual.locator('pre').evaluate((pre, language) => ({
        marker: pre.getAttribute('data-easymde-visual-fence'),
        language: pre.getAttribute('data-easymde-visual-fence-info'),
        body: pre.querySelector('code')?.textContent?.replace(/\n$/u, ''),
        languageClass: pre.querySelector('code')?.classList.contains(`language-${language}`)
      }), fence.language)).toMatchObject({ marker, language: fence.language, body: 'a\nQ', ...(fence.language ? { languageClass: true } : {}) });
      phase = 'clear-code-and-native-structure-exit'; frames.stage(phase);
      for (let key = 0; key < 3; key += 1) await probe.press('Shift+ArrowLeft');
      expect(await stage.visual.locator('pre code').evaluate((element) => {
        const native = getSelection();
        return !!native && element.contains(native.anchorNode) && element.contains(native.focusNode)
          && native.toString() === 'a\nQ';
      })).toBe(true);
      await probe.press('Backspace'); await expectSource(stage.source, code(''));
      if (fence.position === 'start' || fence.position === 'end') {
        exitOwnership = await stage.visual.evaluateHandle((surface) => {
          const pres = surface.querySelectorAll('pre');
          if (pres.length !== 1) throw new Error('short-stage-exit-pre-not-unique');
          const pre = pres[0]; let frame = pre;
          while (frame.parentNode && frame.parentNode !== surface) frame = frame.parentNode;
          if (frame.parentNode !== surface) throw new Error('short-stage-exit-frame-not-direct');
          const children = Array.from(surface.childNodes);
          const frameIndex = children.indexOf(frame);
          return { surface, pre, frame,
            prefix: children.slice(0, frameIndex),
            following: children.slice(frameIndex + 1),
            paragraphs: new Set(surface.querySelectorAll(':scope > p')), paragraph: null };
        });
      }
      await probe.press('Backspace'); await expectSource(stage.source, exited);
      if (exitOwnership) {
        const exitedState = await exitOwnership.evaluate((owned) => {
          const { surface } = owned, children = Array.from(surface.childNodes);
          const added = [...surface.querySelectorAll(':scope > p')].filter((p) => !owned.paragraphs.has(p));
          owned.paragraph = added.length === 1 ? added[0] : null;
          const p = owned.paragraph, native = surface.ownerDocument.getSelection();
          const prefixIndexes = owned.prefix.map((node) => children.indexOf(node));
          const indexes = owned.following.map((node) => children.indexOf(node));
          return { preRemoved: !surface.contains(owned.pre), frameRemoved: !surface.contains(owned.frame),
            preCount: surface.querySelectorAll('pre').length, newParagraphCount: added.length,
            soleBR: !!p && p.childNodes.length === 1 && p.firstChild instanceof HTMLBRElement,
            nativeP0: !!p && native?.isCollapsed === true && native.anchorNode === p && native.focusNode === p
              && native.anchorOffset === 0 && native.focusOffset === 0,
            editable: surface.isConnected && surface.isContentEditable,
            lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed'),
            prefixIntact: owned.prefix.every((node, at) => node.isConnected && node.parentNode === surface
              && prefixIndexes[at] === at),
            followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === surface)
              && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
            followingTailIntact: owned.following.length > 0
              ? children.at(-1) === owned.following.at(-1)
              : children.at(-1) === p };
        });
        expect(exitedState).toEqual({ preRemoved: true, frameRemoved: true, preCount: 0, newParagraphCount: 1,
          soleBR: true, nativeP0: true, editable: true, lock: 'false', prefixIntact: true,
          followingIntact: true, followingTailIntact: true });
      }
      await probe.type('Z'); await expectSource(stage.source, continued);
      await assertContinuedCaret('after-Z', 'Z');
      if (exitOwnership) {
        const continuedState = await exitOwnership.evaluate((owned) => {
          const children = Array.from(owned.surface.childNodes);
          const indexes = owned.following.map((node) => children.indexOf(node));
          const p = owned.paragraph, native = owned.surface.ownerDocument.getSelection();
          return { sameParagraph: !!p && p.isConnected && p.parentNode === owned.surface,
            independentZParagraph: !!p && p.childNodes.length === 1 && p.firstChild instanceof Text
              && p.firstChild.data === 'Z',
            nativeTextEnd: !!p && native?.isCollapsed === true && native.anchorNode === p.firstChild
              && native.focusNode === p.firstChild && native.anchorOffset === 1 && native.focusOffset === 1,
            followingIntact: owned.following.every((node) => node.isConnected && node.parentNode === owned.surface)
              && indexes.every((index, at) => index >= 0 && (at === 0 || index > indexes[at - 1])),
            followingTailIntact: owned.following.length > 0 && children.at(-1) === owned.following.at(-1) };
        });
        expect(continuedState).toEqual({ sameParagraph: true, independentZParagraph: true, nativeTextEnd: true,
          followingIntact: true, followingTailIntact: true });
      }
      await expect(stage.visual.locator('pre')).toHaveCount(0);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'natural-group-Undo-Redo-and-continued-editing'; frames.stage(phase);
      previewRead.enterPhase('undo-initial');
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      previewRead.enterPhase('redo-continued');
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, continued);
      const forwardBranchCursor = shortStageHistoryCursorSnapshot(history);
      await assertContinuedCaret('after-final-Redo-before-B', 'Z');
      previewRead.enterPhase('branch-b');
      await probe.type('B'); await expectSource(stage.source, branched);
      await expect.poll(async () => {
        const branch = await readZState('ZB');
        return branch.paragraphCount === 1 && branch.paragraphConnected === true
          && branch.paragraphDirect === true && branch.paragraphEditable === true
          && branch.bodyLength === 2 && branch.caretOffset === 2 && branch.collapsed === true
          && branch.connected === true && branch.focused === true && branch.editable === true && branch.lock === 'false';
      }, { message: 'B must commit and settle at the exact native ZB caret', timeout: 15000 }).toBe(true);
      const accepted = await readZState('ZB');
      expect(accepted, 'after-B-accepted: the current DOM must be exactly one editable ZB paragraph').toMatchObject({
        paragraphCount: 1, paragraphConnected: true, paragraphDirect: true, paragraphEditable: true,
        bodyLength: 2, caretOffset: 2, collapsed: true, connected: true, focused: true,
        surfaceConnected: true, editable: true, lock: 'false'
      });
      await probe.press('Control+z'); await expectSource(stage.source, continued);
      shortStageRestoreHistoryCursor(history, forwardBranchCursor);
      previewRead.enterPhase('final-undo');
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      await previewRead.prove({ visual: stage.visual });
      console.log(JSON.stringify({ phase: 'short-stage-fence-complete', position: fence.position,
        pacing: fence.pacing, family: fence.marker[0] === '~' ? 'tilde' : 'backtick', markerLength: fence.marker.length,
        language: fence.language, observedSourceTransitions: Math.max(0, history.states.length - 1), sourceExact: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-fence-first-failure', operation: phase,
        position: fence.position, pacing: fence.pacing, markerLength: fence.marker.length,
        state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
          editable: state.effectiveEditable, nativeConnected: state.nativeConnected, lock: state.lock })),
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      try { await exitOwnership?.dispose(); } finally {
        await finishShortStageObservation(probe, frames,
          `short-fence-${fence.marker[0] === '~' ? 'tilde' : 'backtick'}-${fence.position}-${fence.pacing}`, failed);
      }
    }
  });
}

for (const sourceCase of [
  { mode: 'ordinary', marker: '````', language: 'bash' },
  { mode: 'ordinary', marker: '~~~', language: 'python' },
  { mode: 'split', marker: '```', language: 'javascript' },
  { mode: 'split', marker: '~~~~', language: '' }
]) {
  test(`[short-stage] ${sourceCase.mode} literal fence ${sourceCase.marker}${sourceCase.language || '(no-language)'} preserves syntax and natural history`, async ({ page }) => {
    const { mode, marker, language } = sourceCase;
    const initial = `  ${marker}${language}  \n  value = 1  \n  ${marker}\n\nAfter.\n\n- keep item\n`;
    const stage = await openShortStage(page, mode, initial);
    const point = initial.indexOf('value = 1');
    const typed = initial.slice(0, point) + 'X' + initial.slice(point);
    const closing = initial.indexOf(`  ${marker}`, initial.indexOf('\n') + 1) + 2;
    const shorterMarker = initial.slice(0, closing) + initial.slice(closing + 1);
    const newline = initial + '\n', unicode = newline + '中🙂';
    const allowed = new Set([initial, typed, shorterMarker, newline, newline + '中', unicode]);
    const probe = await startShortStageProbe(page, stage, allowed);
    const frames = await startShortStageFrames(page, stage.surface);
    let phase = 'literal-fence-body-position', failed = true;
    try {
      frames.stage(phase);
      await stage.surface.click(); await probe.press('Control+Home');
      await probe.press('ArrowDown'); await probe.press('Home');
      const beforeX = await readPublicEditorState(page);
      expect({ nativeConnected: beforeX.nativeConnected, nativeCollapsed: beforeX.nativeCollapsed,
        effectiveEditable: beforeX.effectiveEditable }).toMatchObject({
        nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
      expect(beforeX.nativeAnchor, 'X: real keyboard caret must be the fixed source-body point').toMatchObject({
        connected: true, lineText: '  value = 1  ', linePrefix: '  '
      });
      await probe.type('X'); await expectSource(stage.source, typed);
      await probe.press('Backspace'); await expectSource(stage.source, initial);
      phase = 'literal-closing-marker-delete-and-retype'; frames.stage(phase);
      await probe.press('Control+Home'); await probe.press('ArrowDown'); await probe.press('ArrowDown');
      await probe.press('Home');
      const beforeClosingDelete = await readPublicEditorState(page);
      expect({ nativeConnected: beforeClosingDelete.nativeConnected, nativeCollapsed: beforeClosingDelete.nativeCollapsed,
        effectiveEditable: beforeClosingDelete.effectiveEditable }).toMatchObject({
        nativeConnected: true, nativeCollapsed: true, effectiveEditable: true });
      expect(beforeClosingDelete.nativeAnchor,
        'closing marker: real keyboard caret must be the fixed source-marker start').toMatchObject({
        connected: true, lineText: `  ${marker}`, linePrefix: '  '
      });
      await probe.press('Delete'); await expectSource(stage.source, shorterMarker);
      await probe.type(marker[0]); await expectSource(stage.source, initial);
      phase = 'source-newline-Unicode-and-delete'; frames.stage(phase);
      await probe.press('Control+End'); await probe.press('Enter');
      await probe.type('中🙂'); await expectSource(stage.source, unicode);
      await probe.press('Backspace'); await expectSource(stage.source, newline + '中');
      await probe.press('Backspace'); await expectSource(stage.source, newline);
      const observation = await probe.snapshot();
      const history = shortStageHistoryLedger(observation.rows, initial, allowed);
      await probe.freeze();
      phase = 'source-natural-group-Undo-Redo'; frames.stage(phase);
      await shortStageReplayHistory(page, stage, probe, history, 'undo');
      await expectSource(stage.source, initial);
      await shortStageReplayHistory(page, stage, probe, history, 'redo');
      await expectSource(stage.source, newline);
      await probe.type('Q'); await expectSource(stage.source, newline + 'Q');
      await probe.press('Control+z'); await expectSource(stage.source, newline);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      probe.guard();
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-complete', mode,
        family: marker[0] === '~' ? 'tilde' : 'backtick', markerLength: marker.length, language,
        literalSyntaxExact: true, sourceOwnerOnly: true, realOSIME: false }));
      failed = false;
    } catch (error) {
      console.log(JSON.stringify({ phase: 'short-stage-literal-fence-first-failure', mode, operation: phase,
        state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
          editable: state.effectiveEditable, nativeConnected: state.nativeConnected })),
        failures: stage.failures, firstObservation: (await probe.snapshot()).failure }));
      throw error;
    } finally {
      await finishShortStageObservation(probe, frames, `short-source-${mode}-${marker[0] === '~' ? 'tilde' : 'backtick'}`, failed);
    }
  });
}

test('[short-stage] full reverse P-H2-P mouse range keeps unselected ends and natural history', async ({ page }) => {
  const initial = 'Before.\n\nalphaX\n\n## Heading\n\nYzeta\n\nAfter.';
  const replaced = 'Before.\n\nalphaMzeta\n\nAfter.';
  const continued = 'Before.\n\nalphaMQzeta\n\nAfter.';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [replaced], [continued], [replaced], [initial], [replaced], [continued]] }
  ]);
  const stage = await openShortStage(page, 'full', initial, previewRead.beforeFixture);
  const allowed = new Set([initial, replaced, continued]);
  const probe = await startShortStageProbe(page, stage, allowed);
  const frames = await startShortStageFrames(page, stage.surface);
  let phase = 'real-reverse-cross-block-drag', failed = true;
  try {
    frames.stage(phase);
    const point = (row, offset) => row.evaluate((paragraph, at) => {
      const text = paragraph.firstChild;
      if (!(text instanceof Text) || at >= text.length) throw new Error('short-stage-cross-block-point-unavailable');
      const range = paragraph.ownerDocument.createRange();
      range.setStart(text, at); range.setEnd(text, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 1, y: rect.y + rect.height / 2 };
    }, offset);
    const from = await point(stage.visual.locator('p').nth(2), 1);
    const to = await point(stage.visual.locator('p').nth(1), 5);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    probe.guard();
    const native = await stage.visual.evaluate((surface) => {
      const selection = getSelection(), paragraphs = surface.querySelectorAll('p');
      const offset = (paragraph, node, end) => {
        if (!node || !paragraph.contains(node)) return null;
        const prefix = paragraph.ownerDocument.createRange();
        prefix.selectNodeContents(paragraph); prefix.setEnd(node, end);
        return prefix.toString().length;
      };
      const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      return { backward: !!range && !selection.isCollapsed && range.endContainer === selection.anchorNode
        && range.endOffset === selection.anchorOffset,
        anchorOffset: offset(paragraphs[2], selection?.anchorNode, selection?.anchorOffset),
        focusOffset: offset(paragraphs[1], selection?.focusNode, selection?.focusOffset) };
    });
    expect(native).toEqual({ backward: true, anchorOffset: 1, focusOffset: 5 });
    phase = 'cross-block-replace-and-immediate-continue'; frames.stage(phase);
    await probe.type('M'); await expectSource(stage.source, replaced);
    await probe.type('Q'); await expectSource(stage.source, continued);
    const observation = await probe.snapshot();
    const history = shortStageHistoryLedger(observation.rows, initial, allowed);
    await probe.freeze();
    phase = 'cross-block-natural-Undo-Redo'; frames.stage(phase);
    await shortStageReplayHistory(page, stage, probe, history, 'undo');
    await expectSource(stage.source, initial);
    await shortStageReplayHistory(page, stage, probe, history, 'redo');
    await expectSource(stage.source, continued);
    await expect(stage.visual).not.toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    probe.guard();
    await previewRead.prove({ visual: stage.visual });
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-complete', native,
      sourceExact: true, state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
        editable: state.effectiveEditable, nativeConnected: state.nativeConnected })) }));
    failed = false;
  } catch (error) {
    console.log(JSON.stringify({ phase: 'short-stage-backward-cross-block-first-failure', operation: phase,
      state: await readPublicEditorState(page).then((state) => ({ sourceLength: state.sourceLength,
        editable: state.effectiveEditable, nativeConnected: state.nativeConnected })),
      firstObservation: (await probe.snapshot()).failure }));
    throw error;
  } finally {
    await finishShortStageObservation(probe, frames, 'short-backward-cross-block', failed);
  }
});

test('[short-stage-background] dirty article survives focus loss and natural autosave', async ({ page }) => {
  test.setTimeout(780_000);
  const initial = '# 背景\n\nAlpha 开始。\n\nBeta 结束。';
  const afterJia = initial + '甲';
  const afterForeground = initial + '甲A';
  const afterReturn = afterForeground + '乙B';
  const afterDelete = afterForeground + '乙';
  const previewRead = createPhasedPreviewOperationTracker([
    {
      id: 'lifecycle',
      groups: [
        [''], [initial], [afterJia], [afterForeground],
        [afterDelete], [afterReturn], [afterDelete], [afterReturn], [afterDelete]
      ]
    }
  ]);
  const caseDeadline = Date.now() + 720_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('background-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  const coverage = {
    foregroundCycle: false, backgroundCycle: false, returnCycle: false,
    returnFocus: false, focusLost: false, autosaveSuccess: false,
    postChanged: null, sessionReady: false, intervals: null,
    localDraft: { applicable: null, intervalSeconds: null, saved: null,
      updatedAtAdvanced: false, contentMatchesCurrent: false }
  };
  const healthFailures = [];
  const onPopup = () => healthFailures.push('background-popup');
  page.on('popup', onPopup);
  let second = null;
  let stage = null;
  let stageProbe = null;
  let frames = null;
  let finalProbe = null;
  let primaryError = null;
  const disableFocusOverride = async (targetPage) => {
    const cdp = await targetPage.context().newCDPSession(targetPage);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    return cdp;
  };
  const focusOverrideSessions = [];
  const detachFocusOverrides = async () => {
    const failures = [];
    for (const cdp of focusOverrideSessions.splice(0)) {
      try { await cdp.detach(); }
      catch { failures.push('focus-override-detach'); }
    }
    if (failures.length) throw new Error(failures.join(','));
  };
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const throwUncovered = (codes) => {
    throw new Error(`background-stage-uncovered:${[...new Set(codes)].join(',')}`);
  };
  const reportSafeCoverage = () => {
    const safe = { ...coverage };
    if (finalProbe) {
      safe.sendCount = finalProbe.send.length;
      safe.tickCount = finalProbe.tick.length;
      safe.autosaveCount = finalProbe.autosave.length;
    }
    console.log(JSON.stringify({
      phase: 'short-stage-background-coverage-finally',
      coverage: safe
    }));
  };
  try {
    await page.bringToFront();
    focusOverrideSessions.push(await disableFocusOverride(page));
    stage = await openShortStage(page, 'full', initial, async (context) => {
      previewRead.beforeFixture(context);
      await installBackgroundProbe(page);
    });
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage,
      [initial, initial + '甲', afterForeground, afterReturn, afterDelete], { backgroundObservation: true, frames });
    let localDraftUpdatedAtBaseline = null;
    const waitUntil = async (predicate, { message, timeout }) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await predicate()) return true;
        await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
      }
      console.log(JSON.stringify({ phase: 'short-stage-background-wait-timeout', message }));
      return false;
    };
    const guard = async ({ focused = true } = {}) => {
      stageProbe.guard();
      if (healthFailures.length) throw new Error(`background-health:${healthFailures[0]}`);
      if (stage.failures.length) throw new Error(`background-stage-failure:${stage.failures[0]}`);
      const state = await readProbe();
      if (state.sessionStatus !== 'ready') {
        throw new Error(`background-session:${state.sessionStatus}`);
      }
      if (state.heartbeat.connectionError === true) {
        throw new Error('background-heartbeat-connection-error');
      }
      if (focused
        && (state.documentHasFocus !== true || state.heartbeat.coreHasFocus !== true)) {
        throw new Error('background-unexpected-focus-loss');
      }
      if (!focused
        && (state.documentHasFocus !== false || state.heartbeat.coreHasFocus !== false)) {
        throw new Error('background-expected-focus-loss-not-observed');
      }
      if (state.surfaceEditable !== true || state.lockPressed !== 'false') {
        throw new Error('background-unexpected-readonly-or-lock');
      }
      return state;
    };
    const installed = await guard();
    coverage.intervals = installed.intervals;
    coverage.localDraft = {
      applicable: installed.localDraft.applicable,
      intervalSeconds: installed.localDraft.intervalSeconds,
      saved: installed.localDraft.applicable ? false : null,
      updatedAtAdvanced: false,
      contentMatchesCurrent: false
    };
    localDraftUpdatedAtBaseline = installed.localDraft.storage?.updatedAt ?? null;
    const waitForCycle = async (phase, focused) => {
      const start = await guard({ focused });
      const interval = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0,
        focused ? 0 : 120);
      if (!(interval > 0)) return false;
      const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
      const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
      const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
      await stageProbe.beginQuiet(`${phase}-heartbeat`);
      const observed = await waitUntil(async () => {
        await guard({ focused });
        const current = await readProbe();
        return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
          && entry.durationMs !== null
          && entry.sendOrdinal !== null
          && entry.sendOrdinal > baselineSendOrdinal
          && entry.sendDocumentHasFocus === focused
          && entry.sendCoreHasFocus === focused);
      }, { message: `${phase} natural heartbeat send→tick`, timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForAutosave = async () => {
      const start = await guard();
      const autosaveSeconds = Number(start.intervals.autosave);
      const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
        Number(start.heartbeat.minimalInterval) || 0);
      if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) return false;
      const timeout = boundedTimeout(
        (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
      await stageProbe.beginQuiet('natural-autosave');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        return current.autosave.some((entry) => {
          if (entry.success !== true || entry.attemptOrdinal === null) return false;
          const attempt = current.autosaveAttempts.find(
            (candidate) => candidate.ordinal === entry.attemptOrdinal);
          return attempt?.postChanged === true
            && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
        });
      }, { message: 'natural Core autosave success after post-dirty attempt', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    const waitForLocalDraft = async () => {
      if (!coverage.localDraft.applicable) return true;
      const draftSeconds = Number(coverage.localDraft.intervalSeconds);
      if (!(draftSeconds > 0)) return false;
      const timeout = boundedTimeout(draftSeconds * 1000 + 20_000);
      await stageProbe.beginQuiet('local-draft-debounce');
      const observed = await waitUntil(async () => {
        await guard();
        const current = await readProbe();
        const storage = current.localDraft.storage;
        const advanced = storage?.present === true && storage.updatedAt !== null
          && (localDraftUpdatedAtBaseline === null
            || storage.updatedAt > localDraftUpdatedAtBaseline);
        coverage.localDraft.updatedAtAdvanced = advanced;
        coverage.localDraft.contentMatchesCurrent = storage?.contentMatchesCurrent === true;
        return advanced && coverage.localDraft.contentMatchesCurrent;
      }, { message: 'local draft debounce completion evidence', timeout });
      await stageProbe.endQuiet();
      return observed;
    };
    await guard();
    await stage.visual.locator('p').last().click();
    await stageProbe.press('End');
    await guard();
    await stageProbe.type('甲A');
    await guard();
    await expectSource(stage.source, afterForeground);
    const dirtyProbe = await readProbe();
    coverage.postChanged = dirtyProbe.postChanged;
    const dirtyAt = await page.evaluate(() => performance.now());
    if (coverage.localDraft.applicable) {
      coverage.localDraft.saved = await waitForLocalDraft();
    }
    coverage.foregroundCycle = await waitForCycle('foreground', true);
    coverage.autosaveSuccess = await waitForAutosave();
    await guard();
    const blurBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'blur').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-out');
    second = await page.context().newPage();
    focusOverrideSessions.push(await disableFocusOverride(second));
    await second.goto('about:blank');
    await second.bringToFront();
    coverage.focusLost = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === false
        && current.heartbeat.coreHasFocus === false
        && current.focus.some((entry) => entry.type === 'blur'
          && entry.ordinal > blurBaseline);
    }, { message: 'first page must lose real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.focusLost) throwUncovered(['focus-loss']);
    coverage.backgroundCycle = await waitForCycle('background', false);
    if (!coverage.backgroundCycle) throwUncovered(['background-heartbeat']);
    const focusBaseline = (await readProbe()).focus.filter(
      (entry) => entry.type === 'focus').at(-1)?.ordinal ?? 0;
    await stageProbe.beginQuiet('focus-return');
    await page.bringToFront();
    coverage.returnFocus = await waitUntil(async () => {
      const current = await readProbe();
      return current.documentHasFocus === true
        && current.heartbeat.coreHasFocus === true
        && current.focus.some((entry) => entry.type === 'focus'
          && entry.ordinal > focusBaseline);
    }, { message: 'first page must regain real focus', timeout: boundedTimeout(15_000) });
    await stageProbe.endQuiet();
    if (!coverage.returnFocus) throwUncovered(['return-focus']);
    coverage.returnCycle = await waitForCycle('return', true);
    if (!coverage.returnCycle) throwUncovered(['return-heartbeat']);
    const inputUnmet = [];
    if (coverage.postChanged !== true) inputUnmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) inputUnmet.push('foreground-heartbeat');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      inputUnmet.push('local-draft-save');
    }
    if (!coverage.autosaveSuccess) inputUnmet.push('autosave-success');
    if (inputUnmet.length) throwUncovered(inputUnmet);
    await guard();
    frames.stage('post-cycle-native-editing');
    await stageProbe.resumeEditing();
    await stageProbe.type('乙B');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Backspace');
    await guard();
    await expectSource(stage.source, afterDelete);
    await guard();
    await stageProbe.press('Control+z');
    await guard();
    await expectSource(stage.source, afterReturn);
    await guard();
    await stageProbe.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, afterDelete);
    expect(stage.failures).toEqual([]);
    await previewRead.prove({ visual: stage.visual });
    finalProbe = await readProbe();
    coverage.sessionReady = finalProbe.sessionStatus === 'ready';
    const unmet = [];
    if (coverage.postChanged !== true) unmet.push('pre-save-dirty');
    if (!coverage.foregroundCycle) unmet.push('foreground-heartbeat');
    if (!coverage.focusLost) unmet.push('focus-loss');
    if (!coverage.backgroundCycle) unmet.push('background-heartbeat');
    if (!coverage.returnFocus) unmet.push('return-focus');
    if (!coverage.returnCycle) unmet.push('return-heartbeat');
    if (!coverage.autosaveSuccess) unmet.push('autosave-success');
    if (!coverage.sessionReady) unmet.push('session-ready');
    if (coverage.localDraft.applicable === true && coverage.localDraft.saved !== true) {
      unmet.push('local-draft-save');
    }
    if (unmet.length) throwUncovered(unmet);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { reportSafeCoverage(); } catch { cleanupFailures.push('coverage-report'); }
    try { page.off('popup', onPopup); } catch { cleanupFailures.push('popup-listener-off'); }
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('background-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    try { await detachFocusOverrides(); }
    catch { cleanupFailures.push('focus-override-detach'); }
    if (second) {
      try { await second.close(); } catch { cleanupFailures.push('second-page-close'); }
    }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-background-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`background-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});

test('[short-stage-lock] active Preview lock survives natural cycles and resumes editing', async ({ page }) => {
  test.setTimeout(540_000);
  const initial = '# 锁\n\nAlpha 开始。\n\nBeta 结束。';
  const typed = initial + 'V';
  const resumed = typed + 'X';
  const previewRead = createPhasedPreviewOperationTracker([
    { id: 'lifecycle', groups: [[''], [initial], [typed], [resumed], [typed], [resumed]] }
  ]);
  const sink = page.locator('[data-easymde-preview-html-sink]');
  const lock = page.locator('.easymde-immersive-preview-lock');
  const caseDeadline = Date.now() + 480_000;
  const boundedTimeout = (desired) => {
    const remaining = caseDeadline - Date.now();
    if (remaining <= 0) throw new Error('lock-case-budget-exhausted');
    return Math.min(desired, remaining);
  };
  let stage = null;
  let stageProbe = null, frames = null;
  let primaryError = null;
  const readProbe = () => page.evaluate(() => window.__easymdeBackgroundProbe.read());
  const waitUntil = async (predicate, { message, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await page.waitForTimeout(Math.max(1, Math.min(250, deadline - Date.now())));
    }
    console.log(JSON.stringify({ phase: 'short-stage-lock-wait-timeout', message }));
    return false;
  };
  const guard = async ({ locked = false } = {}) => {
    stageProbe?.guard();
    if (stage.failures.length) throw new Error(`lock-stage-failure:${stage.failures[0]}`);
    const state = await readProbe();
    if (state.visibilityState !== 'visible') {
      throw new Error(`lock-stage-visibility:${state.visibilityState}`);
    }
    if (state.sessionStatus !== 'ready') {
      throw new Error(`lock-stage-session:${state.sessionStatus}`);
    }
    if (state.heartbeat.connectionError === true) {
      throw new Error('lock-stage-heartbeat-connection-error');
    }
    if (state.lockPressed !== (locked ? 'true' : 'false')) {
      throw new Error(`lock-stage-lock:${state.lockPressed}`);
    }
    if (locked ? state.surfaceEditable !== false : state.surfaceEditable !== true) {
      throw new Error(locked ? 'lock-stage-unexpected-editable' : 'lock-stage-unexpected-readonly');
    }
    return state;
  };
  const waitForCycle = async (label, locked) => {
    const start = await guard({ locked });
    const interval = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(interval > 0)) throw new Error(`lock-stage-uncovered:${label}-interval`);
    const baselineSendOrdinal = start.send.at(-1)?.ordinal ?? 0;
    const baselineTickOrdinal = start.tick.at(-1)?.ordinal ?? 0;
    const timeout = boundedTimeout(interval * 1000 * 2 + 20_000);
    await stageProbe.beginQuiet(`${label}-heartbeat`);
    const covered = await waitUntil(async () => {
      await guard({ locked });
      const current = await readProbe();
      return current.tick.some((entry) => entry.ordinal > baselineTickOrdinal
        && entry.durationMs !== null
        && entry.sendOrdinal !== null
        && entry.sendOrdinal > baselineSendOrdinal
        && entry.sendVisibility === 'visible');
    }, { message: `${label} natural heartbeat`, timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error(`lock-stage-uncovered:${label}-heartbeat`);
  };
  const waitForAutosave = async (dirtyAt) => {
    const start = await guard();
    const autosaveSeconds = Number(start.intervals.autosave);
    const heartbeatSeconds = Math.max(Number(start.heartbeat.interval) || 0,
      Number(start.heartbeat.minimalInterval) || 0);
    if (!(autosaveSeconds > 0) || !(heartbeatSeconds > 0)) {
      throw new Error('lock-stage-uncovered:pre-lock-autosave-interval');
    }
    const timeout = boundedTimeout(
      (Math.max(autosaveSeconds, heartbeatSeconds) + heartbeatSeconds) * 1000 + 20_000);
    await stageProbe.beginQuiet('pre-lock-autosave');
    const covered = await waitUntil(async () => {
      await guard();
      const current = await readProbe();
      return current.autosave.some((entry) => {
        if (entry.success !== true || entry.attemptOrdinal === null) return false;
        const attempt = current.autosaveAttempts.find(
          (candidate) => candidate.ordinal === entry.attemptOrdinal);
        return attempt?.postChanged === true
          && (attempt.contentMatchesCurrent === true || attempt.at >= dirtyAt);
      });
    }, { message: 'pre-lock natural autosave', timeout });
    await stageProbe.endQuiet();
    if (!covered) throw new Error('lock-stage-uncovered:pre-lock-autosave');
  };
  try {
    await page.bringToFront();
    stage = await openShortStage(page, 'full', initial, async (context) => {
      previewRead.beforeFixture(context);
      await installBackgroundProbe(page);
    });
    frames = await startShortStageFrames(page, stage.surface, { retainStages: true });
    stageProbe = await startShortStageProbe(page, stage, [initial, typed, resumed],
      { backgroundObservation: true, allowLocked: true, frames });
    await guard();
    await sink.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type('V');
    await guard();
    await expectSource(stage.source, typed);
    const dirtyAt = await page.evaluate(() => performance.now());
    await waitForAutosave(dirtyAt);
    await waitForCycle('pre-lock', false);
    await expectSource(stage.source, typed);
    const beforeLock = await readPublicEditorState(page);
    await guard();
    await stageProbe.beginQuiet('user-lock-toggle');
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const lockedSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(lockedSink.effectiveEditable, 'locked sink must be effectively read-only').toBe(false);
    expect(lockedSink.contenteditable).not.toBe('true');
    await guard({ locked: true });
    await sink.locator('p').last().click();
    await guard({ locked: true });
    await stageProbe.endQuiet();
    await waitForCycle('locked', true);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    const afterCycleSink = await sink.evaluate((surface) => ({
      effectiveEditable: surface.isContentEditable,
      contenteditable: surface.getAttribute('contenteditable')
    }));
    expect(afterCycleSink.effectiveEditable, 'lock must survive a natural cycle').toBe(false);
    const afterCycle = await readPublicEditorState(page);
    expect(afterCycle.source === typed, 'natural cycle must not change the exact source while locked').toBe(true);
    expect({
      sourceInputConnected: afterCycle.sourceInputConnected,
      sourceEditable: afterCycle.sourceEditable,
      visualEditable: afterCycle.visualEditable,
      nativeConnected: afterCycle.nativeConnected
    }, 'natural cycle must retain a connected editable source owner').toMatchObject({
      sourceInputConnected: true, sourceEditable: true, visualEditable: false, nativeConnected: true
    });
    await expectSource(stage.source, typed);
    await stageProbe.beginQuiet('locked-negative-inputs');
    for (const key of ['Q', 'Backspace', 'Enter']) {
      await guard({ locked: true });
      if (key === 'Q') await page.keyboard.type('Q');
      else await page.keyboard.press(key);
      await expectSource(stage.source, typed);
      const lockedOwner = await readPublicEditorState(page);
      expect(lockedOwner.source === typed, `${key}: locked source must not change`).toBe(true);
      expect(lockedOwner.nativeConnected, `${key}: locked keys must not strand the native Selection`).toBe(true);
      await guard({ locked: true });
    }
    await stageProbe.endQuiet();
    expect(stage.failures).toEqual([]);
    await guard({ locked: true });
    await stageProbe.beginQuiet('user-unlock-toggle');
    await lock.click();
    await expect(sink).toHaveAttribute('contenteditable', 'true');
    await guard();
    await stageProbe.endQuiet();
    frames.stage('resumed-native-editing');
    await stageProbe.resumeEditing();
    await page.keyboard.type('X');
    await expectSource(stage.source, resumed);
    await guard();
    await page.keyboard.press('Control+z');
    await guard();
    await expectSource(stage.source, typed);
    await guard();
    await page.keyboard.press('Control+Shift+z');
    await guard();
    await expectSource(stage.source, resumed);
    await guard();
    expect(stage.failures).toEqual([]);
    await previewRead.prove({ visual: stage.visual });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    try { await stageProbe?.stop(); } catch { cleanupFailures.push('stage-probe-stop'); }
    try { await frames?.stop('lock-complete-observation'); } catch { cleanupFailures.push('compositor-stop'); }
    try { await page.evaluate(() => window.__easymdeBackgroundProbe?.cleanup()); }
    catch { cleanupFailures.push('background-probe-cleanup'); }
    if (cleanupFailures.length) {
      console.log(JSON.stringify({
        phase: 'short-stage-lock-cleanup-failure',
        failures: cleanupFailures
      }));
      if (!primaryError) {
        throw new Error(`lock-cleanup-failed:${cleanupFailures.join(',')}`);
      }
    }
  }
});
