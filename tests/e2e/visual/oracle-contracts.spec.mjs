import { expect, test } from '@playwright/test';
import {
  PREVIEW_LEDGER_POST_ID,
  PREVIEW_LEDGER_RENDER_PARAMS,
  createPreviewLedgerHarness,
  observePreviewLedgerSuccess,
  previewLedgerRequest,
  registerVisualEditingHooks
} from '../helpers/visual-editing-helpers.mjs';
import {
  createRichDeletionModel,
  createRichFixtureBuilder,
  expectedRichDeletionStep,
  richCaretContractObservation,
  richDeletionObservationMatches,
  richWindowedFixture
} from '../helpers/visual-rich-fixture-helpers.mjs';
import {
  createShortStageCodeCertifier,
  shortStageBlocks,
  shortStageBuildCodeDescriptors,
  shortStageDeclaredCodeDescriptors,
  shortStageHistoryExit,
  shortStageNextHistoryCursor,
  shortStageObservedStateChanged,
  shortStagePhaseModel,
  shortStageReplayHistory,
  shortStageStateMatches,
  shortStageUniqueCodeDeclarations
} from '../helpers/visual-short-stage-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

registerVisualEditingHooks();

test('[oracle-contract] rich fixture construction keeps inline and reference ranges declared', () => {
  for (const imageKind of ['inline', 'reference']) {
    const fixture = richWindowedFixture(imageKind);
    const contiguous = fixture.parts.every((part, index) => part.sourceStart === (fixture.parts[index - 1]?.sourceEnd ?? 0)
      && part.sourceEnd === part.sourceStart + part.text.length
      && fixture.initial.slice(part.sourceStart, part.sourceEnd) === part.text);
    expect(contiguous, `fixture parts must be contiguous for ${imageKind}`).toBe(true);
    if (imageKind === 'reference') {
      const definition = fixture.parts.find((part) => part.kind === 'definition');
      expect(definition?.contentStart === definition?.sourceStart
        && definition?.contentEnd === definition?.sourceEnd).toBe(true);
    }
  }
});

test('[oracle-contract] rich ASCII tail fixes the final byte and rejects a same-glyph wrong occurrence', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  fixtureBuilder.block('paragraph', 'aba', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build();
  const model = createRichDeletionModel(fixture);
  const step = expectedRichDeletionStep(model);
  expect(step.afterSource === 'ab').toBe(true);
  expect(step.afterCaret?.textOffset === 2).toBe(true);
  const correct = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(fixture.parts[0], 2) }, 'after');
  expect(correct).toEqual({ sourceExact: true, caretExact: true });
  const wrongOccurrence = richDeletionObservationMatches(step,
    { source: 'ba', caret: richCaretContractObservation(fixture.parts[0], 2) }, 'after');
  expect(wrongOccurrence).toEqual({ sourceExact: false, caretExact: true });
});

test('[oracle-contract] rich native proof rejects a wrong block, tag, length, or offset', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  fixtureBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build(), part = fixture.parts[0];
  const step = expectedRichDeletionStep(createRichDeletionModel(fixture));
  const correct = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1) }, 'after');
  expect(correct).toEqual({ sourceExact: true, caretExact: true });
  const wrongBlock = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 1, { blockId: 'b-other' }) }, 'after');
  const wrongOffset = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 0, 1) }, 'after');
  const wrongTag = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 1, { blockTag: 'DIV' }) }, 'after');
  const wrongLength = richDeletionObservationMatches(step,
    { source: step.afterSource, caret: richCaretContractObservation(part, 1, 2) }, 'after');
  expect({ wrongBlock, wrongOffset, wrongTag, wrongLength }).toEqual({
    wrongBlock: { sourceExact: true, caretExact: false },
    wrongOffset: { sourceExact: true, caretExact: false },
    wrongTag: { sourceExact: true, caretExact: false },
    wrongLength: { sourceExact: true, caretExact: false }
  });
});

test('[oracle-contract] rich undeclared remote atom, earlier punctuation, and missing proof are rejected', () => {
  const fixtureBuilder = createRichFixtureBuilder();
  const remoteAtom = fixtureBuilder.block('atom', '![dot](/remote.png)', 'P', { deletion: 'held-policy', atom: 'image' });
  const remoteMermaid = fixtureBuilder.block('atom', '```mermaid\ngraph TD\nA --> B\n```', 'DIV', {
    deletion: 'held-policy', atom: 'mermaid'
  });
  const earlierBlank = fixtureBuilder.separator('\n');
  const earlierPunctuation = fixtureBuilder.separator('!!');
  fixtureBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const fixture = fixtureBuilder.build(), tail = fixture.parts.at(-1);
  const step = expectedRichDeletionStep(createRichDeletionModel(fixture));
  const selectedTailRange = step.removeStart === tail.contentStart + 1 && step.removeEnd === tail.contentEnd;
  const remoteRangeRejected = remoteAtom.sourceEnd <= step.removeStart
    && remoteMermaid.sourceEnd <= step.removeStart
    && earlierBlank.sourceEnd <= step.removeStart
    && earlierPunctuation.sourceEnd <= step.removeStart
    && !(step.removeStart === remoteAtom.sourceStart && step.removeEnd === remoteAtom.sourceEnd);
  const correctCaret = richCaretContractObservation(tail, 1);
  const sourceWithoutRange = (range) => fixture.initial.slice(0, range.sourceStart) + fixture.initial.slice(range.sourceEnd);
  const wrongSourceResults = [earlierBlank, earlierPunctuation, remoteAtom, remoteMermaid].map((range) =>
    richDeletionObservationMatches(step, { source: sourceWithoutRange(range), caret: correctCaret }, 'after').sourceExact);
  const missingCaret = richDeletionObservationMatches(step, { source: step.afterSource, caret: null }, 'after');
  expect({ selectedTailRange, remoteRangeRejected,
    wrongSourcesRejected: wrongSourceResults.every((value) => value === false),
    missingCaretRejected: missingCaret.sourceExact === true && missingCaret.caretExact === false }).toEqual({
    selectedTailRange: true, remoteRangeRejected: true, wrongSourcesRejected: true, missingCaretRejected: true });

  const missingBuilder = createRichFixtureBuilder();
  missingBuilder.block('paragraph', 'ab', 'P', { plainText: true });
  let missingCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(missingBuilder.build())); }
  catch (error) { missingCode = error.message; }
  expect(missingCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);

  const missingRangeBuilder = createRichFixtureBuilder();
  missingRangeBuilder.block('paragraph', 'ab', 'P', { deletion: 'ascii-grapheme', plainText: true });
  const missingRangeFixture = missingRangeBuilder.build();
  missingRangeFixture.parts[0].sourceStart = undefined;
  let missingRangeCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(missingRangeFixture)); }
  catch (error) { missingRangeCode = error.message; }
  expect(missingRangeCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);

  const atomBuilder = createRichFixtureBuilder();
  atomBuilder.block('atom', '![dot](/remote.png)', 'P', { deletion: 'held-policy', atom: 'image' });
  let atomCode = null;
  try { expectedRichDeletionStep(createRichDeletionModel(atomBuilder.build())); }
  catch (error) { atomCode = error.message; }
  expect(atomCode?.startsWith('rich-deletion-oracle-uncovered:') === true).toBe(true);
});

test('[oracle-contract] history cursor and exit predicate handle duplicate grouping without inventing depth', async () => {
  const witnessA = { collapsed: true, direction: 'none', anchor: { column: 1 }, focus: { column: 1 } };
  const witnessB = { collapsed: true, direction: 'none', anchor: { column: 2 }, focus: { column: 2 } };
  const witnessC = { collapsed: true, direction: 'none', anchor: { column: 3 }, focus: { column: 3 } };
  const states = [{ value: 'A', witness: witnessA }, { value: 'B', witness: witnessB },
    { value: 'A', witness: witnessA }, { value: 'C', witness: witnessC }];
  const first = shortStageNextHistoryCursor(states, new Set([3]), states[2], 'undo');
  const second = shortStageNextHistoryCursor(states, first, states[1], 'undo');
  const redoToDuplicate = shortStageNextHistoryCursor(states, new Set([1]), states[2], 'redo');
  const redoFinal = shortStageNextHistoryCursor(states, redoToDuplicate, states[3], 'redo');
  const unknownSource = shortStageNextHistoryCursor(states, new Set([3]), { value: 'X', witness: witnessA }, 'undo');
  const wrongWitness = shortStageNextHistoryCursor(states, new Set([3]), { value: 'A', witness: witnessC }, 'undo');
  const wrongDirection = shortStageNextHistoryCursor(states, new Set([3]), states[3], 'redo');
  const duplicateUndoCursor = new Set([0, 2]);
  const duplicateUndoCursorBefore = [...duplicateUndoCursor];
  const duplicateInitialExit = shortStageHistoryExit(states, duplicateUndoCursor, states[0], 'undo', true);
  const groupedIntermediateExit = shortStageHistoryExit(states, first, states[0], 'undo', false);
  const finalRedoExit = shortStageHistoryExit(states, redoFinal, states[3], 'redo', true);
  const redoAfterDuplicateUndo = shortStageNextHistoryCursor(states, duplicateUndoCursor, states[1], 'redo');
  const redoAfterDuplicateUndoFinal = shortStageNextHistoryCursor(states, redoAfterDuplicateUndo, states[3], 'redo');
  const redoDuplicateStates = [
    { value: 'A', witness: witnessA }, { value: 'B', witness: witnessB },
    { value: 'C', witness: witnessC }, { value: 'B', witness: witnessB }
  ];
  const redoDuplicateCursor = shortStageNextHistoryCursor(redoDuplicateStates, new Set([0]), redoDuplicateStates[3], 'redo');
  const redoDuplicateExit = shortStageHistoryExit(
    redoDuplicateStates, redoDuplicateCursor, redoDuplicateStates[3], 'redo', true
  );
  const missingBoundaryExit = shortStageHistoryExit(states, new Set([2]), states[0], 'undo', true);
  const mixedCursorExit = shortStageHistoryExit(states, new Set([0, 1]), states[0], 'undo', true);
  const wrongWitnessBoundaryExit = shortStageHistoryExit(
    states, new Set([0, 2]), { value: 'A', witness: witnessB }, 'undo', true
  );
  const unknownTargetExit = shortStageHistoryExit(
    states, duplicateUndoCursor, { value: 'X', witness: witnessA }, 'undo', true
  );
  const emptyCursorExit = shortStageHistoryExit(states, new Set(), states[0], 'undo', true);
  const outOfBoundsCursorExit = shortStageHistoryExit(states, new Set([4]), states[0], 'undo', true);
  const wrongDirectionExit = shortStageHistoryExit(states, new Set([3]), states[3], 'undo', true);
  const missingBoundaryWitnessExit = shortStageHistoryExit(
    states, new Set([0]), { value: 'A', witness: null }, 'undo', true
  );
  const phaseModel = shortStagePhaseModel('ordinary');
  const phaseSamples = new Map([[phaseModel.phaseIds.fixture, [phaseModel.initial]]]);
  phaseModel.positions.forEach((position, index) => phaseSamples.set(
    phaseModel.phaseIds.positions[index],
    [phaseModel.initial, position.insertedSource, phaseModel.initial]
  ));
  phaseSamples.set(phaseModel.phaseIds.deletion, [phaseModel.initial]);
  phaseSamples.set(phaseModel.phaseIds.emptyExtraBackspace, ['']);
  phaseSamples.set(phaseModel.phaseIds.reentry, [
    phaseModel.branchBase, phaseModel.entered, phaseModel.shortened,
    phaseModel.continued, phaseModel.shortened
  ]);
  phaseSamples.set(phaseModel.phaseIds.fullUndo, [phaseModel.initial, phaseModel.positions[0].insertedSource]);
  phaseSamples.set(phaseModel.phaseIds.fullRedo, [phaseModel.positions[0].insertedSource, phaseModel.initial]);
  phaseSamples.set(phaseModel.phaseIds.branchToZ, [phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.branchInput, [phaseModel.branchBase, phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.invalidRedo, [phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.undoBranch, [phaseModel.branch, phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.redoBranch, [phaseModel.branchBase, phaseModel.branch]);
  phaseSamples.set(phaseModel.phaseIds.undoBranchAgain, [phaseModel.branch, phaseModel.branchBase]);
  phaseSamples.set(phaseModel.phaseIds.restoreInitial, [
    phaseModel.branchBase, phaseModel.positions[0].insertedSource, phaseModel.initial
  ]);
  phaseSamples.set(phaseModel.phaseIds.middleQ, [phaseModel.initial, phaseModel.middleQSource]);
  phaseSamples.set(phaseModel.phaseIds.middleQUndo, [phaseModel.middleQSource, phaseModel.initial]);
  const runPhasedModel = (overrides = {}) => {
    const harness = createPreviewLedgerHarness();
    const operationId = harness.ledger.beginPhased({
      postId: PREVIEW_LEDGER_POST_ID,
      renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
      phases: phaseModel.phases
    });
    phaseModel.phases.forEach((phase, index) => {
      if (index > 0) harness.ledger.enterPhase(operationId, phase.id);
      for (const source of overrides[phase.id] ?? phaseSamples.get(phase.id)) {
        observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({
          source,
          renderParams: PREVIEW_LEDGER_RENDER_PARAMS
        }));
      }
    });
    return { harness, proof: harness.ledger.prove(operationId, { finalUiVerified: true }) };
  };
  const phasedValid = runPhasedModel();
  const phasedUndoToEmpty = runPhasedModel({ [phaseModel.phaseIds.fullUndo]: [phaseModel.initial, ''] });
  const phasedForeignPosition = runPhasedModel({
    [phaseModel.phaseIds.middleQ]: [phaseModel.positions[0].insertedSource]
  });
  const phasedBackwardRestore = runPhasedModel({
    [phaseModel.phaseIds.restoreInitial]: [
      phaseModel.branchBase,
      phaseModel.positions[0].insertedSource,
      phaseModel.positions[1].insertedSource
    ]
  });
  const replayWitness = (column) => ({
    collapsed: true,
    direction: 'none',
    anchor: { kind: 'visual', connected: true, blockOrdinal: 0, column, blockLength: 1 },
    focus: { kind: 'visual', connected: true, blockOrdinal: 0, column, blockLength: 1 }
  });
  const replayA = { value: 'history A', witness: replayWitness(1) };
  const replayB = { value: 'history B', witness: replayWitness(2) };
  const replayC = { value: 'history C', witness: replayWitness(3) };
  const replayState = (model, {
    accepted = '1', busy = 'false', editable = true, failureAbsent = true, lock = 'false',
    nativeConnected = true, phase = 'ready', repairCount = 0, session = 'ready', stickyFailure = false,
    codeCertificate = model.codeCertificate ?? null, previewCommitPending = false, stable = true
  } = {}) => ({
    source: model.value,
    witness: model.witness,
    codeCertificate,
    accepted,
    busy,
    editable,
    failureAbsent,
    lock,
    nativeConnected,
    phase,
    repairCount,
    session,
    stickyFailure,
    previewCommitPending,
    stable
  });
  const pendingReplayState = replayState({
    value: replayA.value,
    witness: replayWitness(0)
  }, { accepted: null, busy: 'true', phase: 'loading' });
  const pendingSafeEntryState = replayState(replayB, {
    accepted: null, busy: 'true', phase: 'loading'
  });
  const cancelledReplayState = replayState(replayA, {
    accepted: null, failureAbsent: false, phase: 'error', stickyFailure: true
  });
  const corruptReplayState = replayState({ value: 'history corrupt', witness: replayWitness(8) });
  const stickyFailureReplayState = replayState(replayA, { stickyFailure: true });
  const runReplayContract = async ({
    completionStates,
    cursor = { undo: new Set([1]), redo: null },
    direction = 'undo',
    historyStates = [replayA, replayB],
    unexpectedSettledError = null,
    entryState = null,
    trace = null
  }) => {
    const history = {
      states: historyStates.map((state) => ({ ...state })),
      initial: historyStates[0].value,
      latest: historyStates.at(-1),
      cursor: { undo: new Set(cursor.undo), redo: cursor.redo === null ? null : new Set(cursor.redo) }
    };
    const initialIndex = direction === 'undo' ? [...history.cursor.undo][0] : [...history.cursor.redo][0];
    let current = { value: historyStates[initialIndex].value, witness: historyStates[initialIndex].witness,
      codeCertificate: historyStates[initialIndex].codeCertificate ?? null };
    let pressCount = 0;
    let entryReads = 0;
    let postKeyReads = 0;
    let sourceReads = 0;
    let witnessReads = 0;
    let settledIndex = 0;
    const updateTrace = () => {
      if (trace) Object.assign(trace, { pressCount, entryReads, postKeyReads, sourceReads, witnessReads });
    };
    const stage = { mode: 'full', source: { inputValue: async () => {
      sourceReads += 1; updateTrace(); return current.value;
    } } };
    const probe = {
      guard: () => {},
      press: async () => {
        pressCount += 1;
        updateTrace();
        current = { value: completionStates[0].source, witness: completionStates[0].witness,
          codeCertificate: completionStates[0].codeCertificate ?? null };
      },
      settledState: async () => {
        if (pressCount === 0) {
          entryReads += 1;
          updateTrace();
          return entryState ?? replayState(current);
        }
        postKeyReads += 1;
        updateTrace();
        if (unexpectedSettledError) throw unexpectedSettledError;
        const state = completionStates[Math.min(settledIndex, completionStates.length - 1)];
        settledIndex += 1;
        current = { value: state.source, witness: state.witness,
          codeCertificate: state.codeCertificate ?? null };
        return state;
      },
      witness: async () => { witnessReads += 1; updateTrace(); return current.witness; }
    };
    try {
      const next = await shortStageReplayHistory({}, stage, probe, history, direction);
      return { cursor: [...next], resolved: true, pressCount, entryReads, postKeyReads, sourceReads, witnessReads };
    } catch (error) {
      if (typeof error?.message !== 'string' || !/^short-stage-[a-z-]+$/u.test(error.message)) throw error;
      return { code: error.message, resolved: false, pressCount, entryReads, postKeyReads, sourceReads, witnessReads };
    }
  };
  const replayPendingCorrect = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState]
  });
  const replayPendingSafeEntry = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState],
    entryState: pendingSafeEntryState
  });
  const replayCancelled = await runReplayContract({
    completionStates: [pendingReplayState, cancelledReplayState]
  });
  const replayPendingNeverCompletes = await runReplayContract({
    completionStates: [pendingReplayState]
  });
  const replayStaleReady = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayB), replayState(replayB)]
  });
  const replayWrongSource = await runReplayContract({
    completionStates: [
      pendingReplayState,
      replayState({ value: 'history X', witness: replayWitness(1) }),
      corruptReplayState
    ]
  });
  const replayWrongWitness = await runReplayContract({
    completionStates: [
      pendingReplayState,
      replayState({ value: replayA.value, witness: replayWitness(9) }),
      corruptReplayState
    ]
  });
  const replayWrongDirection = await runReplayContract({
    completionStates: [pendingReplayState, replayState(replayA), corruptReplayState],
    cursor: { undo: new Set([2]), redo: new Set([1]) },
    direction: 'redo',
    historyStates: [replayA, replayB, replayC]
  });
  const replayFailureRecovery = await runReplayContract({
    completionStates: [
      replayState(replayA, { accepted: null, failureAbsent: false, phase: 'error', stickyFailure: true }),
      replayState(replayA),
      replayState(replayA)
    ]
  });
  const replayStickyFailure = await runReplayContract({
    completionStates: [stickyFailureReplayState, replayState(replayA)]
  });
  // A ready-looking read taken before the formal Preview commit (or while the
  // surface is still moving between frames) is pending, never a history step.
  const replayPreviewCommitPending = await runReplayContract({
    completionStates: [replayState(replayA, { previewCommitPending: true }), replayState(replayA), corruptReplayState]
  });
  const replayUnstableRead = await runReplayContract({
    completionStates: [replayState(replayA, { stable: false }), replayState(replayA), corruptReplayState]
  });
  const replayPreviewCommitNeverCompletes = await runReplayContract({
    completionStates: [replayState(replayA, { previewCommitPending: true })]
  });
  const unexpectedSettledError = new TypeError('synthetic replay fixture error');
  const unexpectedTrace = {};
  let unexpectedRethrown = false;
  let unexpectedIdentityPreserved = false;
  try {
    await runReplayContract({
      completionStates: [replayState(replayA), replayState(replayA)],
      unexpectedSettledError,
      trace: unexpectedTrace
    });
  } catch (error) {
    unexpectedRethrown = error instanceof TypeError;
    unexpectedIdentityPreserved = error === unexpectedSettledError;
  }
  const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
  expect({
    firstExact: sameSet(first, new Set([0, 2])),
    secondExact: sameSet(second, new Set([1])),
    redoDuplicateExact: sameSet(redoToDuplicate, new Set([2])),
    redoFinalExact: sameSet(redoFinal, new Set([3])),
    unknownSourceEmpty: unknownSource.size === 0,
    wrongWitnessEmpty: wrongWitness.size === 0,
    wrongDirectionEmpty: wrongDirection.size === 0,
    duplicateInitialAccepted: duplicateInitialExit.exit === true && duplicateInitialExit.uncovered === false,
    duplicateCursorPreserved: sameSet(duplicateUndoCursor, new Set([0, 2]))
      && JSON.stringify([...duplicateUndoCursor]) === JSON.stringify(duplicateUndoCursorBefore),
    redoAfterDuplicateUndoExact: sameSet(redoAfterDuplicateUndo, new Set([1])),
    redoAfterDuplicateUndoFinalExact: sameSet(redoAfterDuplicateUndoFinal, new Set([3])),
    redoDuplicateCursorExact: sameSet(redoDuplicateCursor, new Set([1, 3])),
    redoDuplicateAccepted: redoDuplicateExit.exit === true && redoDuplicateExit.uncovered === false,
    missingBoundaryUncovered: missingBoundaryExit.exit === false && missingBoundaryExit.uncovered === true,
    mixedCursorRejected: mixedCursorExit.exit === false,
    wrongWitnessBoundaryRejected: wrongWitnessBoundaryExit.exit === false,
    unknownTargetRejected: unknownTargetExit.exit === false,
    emptyCursorRejected: emptyCursorExit.exit === false,
    outOfBoundsCursorRejected: outOfBoundsCursorExit.exit === false,
    wrongDirectionUncovered: wrongDirectionExit.exit === false && wrongDirectionExit.uncovered === true,
    missingBoundaryWitnessRejected: missingBoundaryWitnessExit.exit === false,
    groupedIntermediateAccepted: groupedIntermediateExit.exit === true && groupedIntermediateExit.uncovered === false,
    finalRedoAccepted: finalRedoExit.exit === true && finalRedoExit.uncovered === false,
    phasedValidApproved: phasedValid.proof.approved,
    phasedValidCount: phasedValid.proof.approvedAbortCount,
    phasedValidIssues: phasedValid.harness.issues,
    positionSelectorIndexPairs: phaseModel.positions.map((position) => [position.selector, position.index]),
    positionPhaseIndexes: phaseModel.positions.map((position) => position.phaseIndex),
    phaseIdsUnique: new Set(phaseModel.phases.map((phase) => phase.id)).size === phaseModel.phases.length,
    phasedUndoToEmptyRejected: phasedUndoToEmpty.proof.approved === false
      && phasedUndoToEmpty.proof.code === 'preview-read-operation-group-order-invalid',
    phasedForeignPositionRejected: phasedForeignPosition.proof.approved === false
      && phasedForeignPosition.proof.code === 'preview-read-operation-other-source',
    phasedBackwardRestoreRejected: phasedBackwardRestore.proof.approved === false
      && phasedBackwardRestore.proof.code === 'preview-read-operation-group-order-invalid',
    replayPendingCorrectResolved: replayPendingCorrect.resolved,
    replayPendingCorrectCursor: replayPendingCorrect.cursor,
    replayPendingCorrectPresses: replayPendingCorrect.pressCount,
    replayPendingCorrectEntryReads: replayPendingCorrect.entryReads,
    replayPendingCorrectPostKeyReads: replayPendingCorrect.postKeyReads,
    replayPendingCorrectAtomicEntry: replayPendingCorrect.sourceReads === 0 && replayPendingCorrect.witnessReads === 0,
    replayPendingSafeEntry: replayPendingSafeEntry.resolved === true
      && JSON.stringify(replayPendingSafeEntry.cursor) === JSON.stringify([0])
      && replayPendingSafeEntry.pressCount === 1 && replayPendingSafeEntry.entryReads === 1
      && replayPendingSafeEntry.postKeyReads === 2,
    replayCancelledUnsafe: replayCancelled.resolved === false
      && replayCancelled.code === 'short-stage-history-full-operation-unsafe' && replayCancelled.pressCount === 1,
    replayPendingNeverCompletesPending: replayPendingNeverCompletes.resolved === false
      && replayPendingNeverCompletes.code === 'short-stage-history-full-operation-pending'
      && replayPendingNeverCompletes.pressCount === 1,
    replayStaleReadyNoChange: replayStaleReady.resolved === false
      && replayStaleReady.code === 'short-stage-history-full-operation-nochange'
      && replayStaleReady.pressCount === 1,
    replayWrongSourceUnobserved: replayWrongSource.resolved === false
      && replayWrongSource.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongSource.pressCount === 1
      && replayWrongSource.postKeyReads === 2,
    replayWrongWitnessUnobserved: replayWrongWitness.resolved === false
      && replayWrongWitness.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongWitness.pressCount === 1
      && replayWrongWitness.postKeyReads === 2,
    replayWrongDirectionUnobserved: replayWrongDirection.resolved === false
      && replayWrongDirection.code === 'short-stage-history-next-state-unobserved-under-cursor'
      && replayWrongDirection.pressCount === 1
      && replayWrongDirection.postKeyReads === 2,
    replayFailureRecoveryUnsafe: replayFailureRecovery.resolved === false
      && replayFailureRecovery.code === 'short-stage-history-full-operation-unsafe'
      && replayFailureRecovery.pressCount === 1,
    replayStickyFailureUnsafe: replayStickyFailure.resolved === false
      && replayStickyFailure.code === 'short-stage-history-full-operation-unsafe'
      && replayStickyFailure.pressCount === 1 && replayStickyFailure.postKeyReads === 1,
    replayPreviewCommitPendingWaits: replayPreviewCommitPending.resolved === true
      && JSON.stringify(replayPreviewCommitPending.cursor) === JSON.stringify([0])
      && replayPreviewCommitPending.pressCount === 1 && replayPreviewCommitPending.postKeyReads === 2,
    replayUnstableReadWaits: replayUnstableRead.resolved === true
      && JSON.stringify(replayUnstableRead.cursor) === JSON.stringify([0])
      && replayUnstableRead.pressCount === 1 && replayUnstableRead.postKeyReads === 2,
    replayPreviewCommitNeverCompletesPending: replayPreviewCommitNeverCompletes.resolved === false
      && replayPreviewCommitNeverCompletes.code === 'short-stage-history-full-operation-pending'
      && replayPreviewCommitNeverCompletes.pressCount === 1,
    replayUnexpectedRethrown: unexpectedRethrown,
    replayUnexpectedIdentityPreserved: unexpectedIdentityPreserved,
    replayUnexpectedSingleRead: unexpectedTrace.pressCount === 1 && unexpectedTrace.entryReads === 1
      && unexpectedTrace.postKeyReads === 1 && unexpectedTrace.sourceReads === 0 && unexpectedTrace.witnessReads === 0
  }).toEqual({
    firstExact: true, secondExact: true, redoDuplicateExact: true, redoFinalExact: true,
    unknownSourceEmpty: true, wrongWitnessEmpty: true, wrongDirectionEmpty: true,
    duplicateInitialAccepted: true, duplicateCursorPreserved: true,
    redoAfterDuplicateUndoExact: true, redoAfterDuplicateUndoFinalExact: true,
    redoDuplicateCursorExact: true, redoDuplicateAccepted: true,
    missingBoundaryUncovered: true, mixedCursorRejected: true, wrongWitnessBoundaryRejected: true,
    unknownTargetRejected: true, emptyCursorRejected: true, outOfBoundsCursorRejected: true,
    wrongDirectionUncovered: true, missingBoundaryWitnessRejected: true,
    groupedIntermediateAccepted: true, finalRedoAccepted: true,
    phasedValidApproved: true, phasedValidCount: 0, phasedValidIssues: [],
    positionSelectorIndexPairs: [['p', 0], ['h1', 0], ['p', 1], ['pre code', 0], ['p', 2]],
    positionPhaseIndexes: [0, 1, 2, 3, 4], phaseIdsUnique: true,
    phasedUndoToEmptyRejected: true, phasedForeignPositionRejected: true,
    phasedBackwardRestoreRejected: true,
    replayPendingCorrectResolved: true, replayPendingCorrectCursor: [0], replayPendingCorrectPresses: 1,
    replayPendingCorrectEntryReads: 1, replayPendingCorrectPostKeyReads: 2,
    replayPendingCorrectAtomicEntry: true, replayPendingSafeEntry: true, replayCancelledUnsafe: true,
    replayPendingNeverCompletesPending: true, replayStaleReadyNoChange: true,
    replayWrongSourceUnobserved: true, replayWrongWitnessUnobserved: true,
    replayWrongDirectionUnobserved: true, replayFailureRecoveryUnsafe: true,
    replayStickyFailureUnsafe: true, replayPreviewCommitPendingWaits: true, replayUnstableReadWaits: true,
    replayPreviewCommitNeverCompletesPending: true, replayUnexpectedRethrown: true,
    replayUnexpectedIdentityPreserved: true, replayUnexpectedSingleRead: true
  });
});

test('[oracle-contract] certified code history treats only the closing renderer LF as representation-only', () => {
  const codeBlockOrdinal = shortStageBlocks.findIndex((block) => block.kind === 'code');
  expect(codeBlockOrdinal, 'the declared fixture owns one code block').toBeGreaterThanOrEqual(0);
  const codeBlock = shortStageBlocks[codeBlockOrdinal];
  const body = codeBlock.body.join('');
  const prefix = shortStageBlocks.slice(0, codeBlockOrdinal)
    .map((block) => block.source).join('\n\n') + '\n\n';
  const source = `${prefix}${codeBlock.source}\n`;
  const descriptor = shortStageDeclaredCodeDescriptors.get(source);
  expect(descriptor?.body, 'the exact source has one declared code body').toBe(body);
  const point = (blockLength, column = body.length) => ({
    kind: 'visual', connected: true, inside: true, lineIndex: null,
    blockOrdinal: codeBlockOrdinal, column,
    blockLength, surfaceOffset: null
  });
  const witness = (blockLength, {
    collapsed = true, direction = 'none', anchorColumn = body.length, focusColumn = body.length
  } = {}) => ({
    collapsed, direction, anchor: point(blockLength, anchorColumn), focus: point(blockLength, focusColumn)
  });
  const certifyCode = createShortStageCodeCertifier();
  const certificate = (domText, overrides = {}) => certifyCode({
    source, descriptor, sourceDeclared: true, codeCandidate: true, domText,
    prePresent: true, preOrdinal: 0,
    observedBlockOrdinal: descriptor.blockOrdinal, observedCodeOrdinal: descriptor.codeOrdinal,
    preChildCount: 1, preDirectCode: true, codeInsidePre: true,
    blockConnected: true, preConnected: true, codeConnected: true,
    blockOwnsPre: true, preInsideSurface: true,
    nativeCollapsed: true, nativeDirection: 'none',
    anchorLocal: body.length, focusLocal: body.length,
    anchorPrefix: body, focusPrefix: body,
    ...overrides
  });
  const literalState = { value: source, witness: witness(body.length),
    codeCertificate: certificate(body) };
  const closingLfState = { value: source, witness: witness(body.length + 1),
    codeCertificate: certificate(`${body}\n`) };
  expect(literalState.codeCertificate?.valid, 'literal code representation is certified').toBe(true);
  expect(closingLfState.codeCertificate?.valid, 'literal plus the declared closing LF is certified').toBe(true);
  expect(JSON.stringify(literalState.witness) === JSON.stringify(closingLfState.witness)).toBe(false);
  expect(shortStageStateMatches(literalState, closingLfState)).toBe(true);
  expect(shortStageObservedStateChanged(literalState, {
    source: closingLfState.value, witness: closingLfState.witness,
    codeCertificate: closingLfState.codeCertificate
  }), 'representation-only LF is not source progress').toBe(false);
  const backwardOverrides = {
    nativeCollapsed: false, nativeDirection: 'backward',
    anchorLocal: body.length, focusLocal: 0,
    anchorPrefix: body, focusPrefix: ''
  };
  const backwardLiteralState = {
    value: source,
    witness: witness(body.length, { collapsed: false, direction: 'backward', anchorColumn: body.length, focusColumn: 0 }),
    codeCertificate: certificate(body, backwardOverrides)
  };
  const backwardClosingLfState = {
    value: source,
    witness: witness(body.length + 1, { collapsed: false, direction: 'backward', anchorColumn: body.length, focusColumn: 0 }),
    codeCertificate: certificate(`${body}\n`, backwardOverrides)
  };
  expect(backwardLiteralState.codeCertificate?.valid, 'backward range in literal code is certified').toBe(true);
  expect(backwardClosingLfState.codeCertificate?.valid, 'backward range in closing-LF code is certified').toBe(true);
  expect(shortStageStateMatches(backwardLiteralState, backwardClosingLfState),
    'identical backward range matches across literal and closing-LF representations').toBe(true);
  expect(shortStageObservedStateChanged(backwardLiteralState, {
    source: backwardClosingLfState.value, witness: backwardClosingLfState.witness,
    codeCertificate: backwardClosingLfState.codeCertificate
  }), 'representation-only LF under a backward range is not source progress').toBe(false);
  const forwardOverrides = {
    nativeCollapsed: false, nativeDirection: 'forward',
    anchorLocal: 0, focusLocal: body.length,
    anchorPrefix: '', focusPrefix: body
  };
  const forwardLiteralState = {
    value: source,
    witness: witness(body.length, { collapsed: false, direction: 'forward', anchorColumn: 0, focusColumn: body.length }),
    codeCertificate: certificate(body, forwardOverrides)
  };
  const forwardClosingLfState = {
    value: source,
    witness: witness(body.length + 1, { collapsed: false, direction: 'forward', anchorColumn: 0, focusColumn: body.length }),
    codeCertificate: certificate(`${body}\n`, forwardOverrides)
  };
  expect(forwardLiteralState.codeCertificate?.valid, 'forward range in literal code is certified').toBe(true);
  expect(forwardClosingLfState.codeCertificate?.valid, 'forward range in closing-LF code is certified').toBe(true);
  expect(shortStageStateMatches(forwardLiteralState, forwardClosingLfState),
    'identical forward range matches across literal and closing-LF representations').toBe(true);
  expect(shortStageStateMatches(backwardLiteralState, forwardClosingLfState),
    'backward and forward ranges cannot match').toBe(false);
  expect(shortStageStateMatches(backwardLiteralState, literalState),
    'ranged selection cannot match collapsed caret').toBe(false);
});

test('[oracle-contract] certified code observer rejects forged body, caret, structure, and provenance', () => {
  const certifyCode = createShortStageCodeCertifier();
  const descriptorFixture = (blocks) => {
    const blockOrdinal = blocks.findIndex((block) => block.kind === 'code');
    expect(blockOrdinal, 'declared model owns a code block').toBeGreaterThanOrEqual(0);
    const codeBlock = blocks[blockOrdinal];
    const prefix = blocks.slice(0, blockOrdinal).map((block) => block.source).join('\n\n')
      + (blockOrdinal ? '\n\n' : '');
    const source = `${prefix}${codeBlock.source}\n`;
    return { source, descriptor: shortStageBuildCodeDescriptors(blocks).get(source) };
  };
  const fixture = descriptorFixture(shortStageBlocks);
  const body = fixture.descriptor?.body;
  expect(typeof body, 'fixture code body is declared').toBe('string');
  const evidence = (overrides = {}) => ({
    source: fixture.source, descriptor: fixture.descriptor, sourceDeclared: true,
    codeCandidate: true, domText: body,
    prePresent: true, preOrdinal: 0,
    observedBlockOrdinal: fixture.descriptor.blockOrdinal,
    observedCodeOrdinal: fixture.descriptor.codeOrdinal,
    preChildCount: 1, preDirectCode: true, codeInsidePre: true,
    blockConnected: true, preConnected: true, codeConnected: true,
    blockOwnsPre: true, preInsideSurface: true,
    nativeCollapsed: true, nativeDirection: 'none',
    anchorLocal: body.length, focusLocal: body.length,
    anchorPrefix: body, focusPrefix: body,
    ...overrides
  });
  const validCertificate = certifyCode(evidence());
  expect(validCertificate?.valid, 'declared closed-code observation is certified').toBe(true);
  const replacement = `${body.slice(0, -1)}${body.at(-1) === 'x' ? 'y' : 'x'}`;
  const rawPoint = (blockLength = body.length) => ({
    kind: 'visual', connected: true, inside: true, lineIndex: null,
    blockOrdinal: fixture.descriptor.blockOrdinal, column: body.length,
    blockLength, surfaceOffset: null
  });
  const rawWitness = (blockLength = body.length) => ({
    collapsed: true, direction: 'none', anchor: rawPoint(blockLength), focus: rawPoint(blockLength)
  });
  const forgedReplacement = certifyCode(evidence({ domText: replacement, anchorPrefix: replacement,
    focusPrefix: replacement }));
  expect(forgedReplacement?.valid, 'same-length replacement is rejected').toBe(false);
  expect(shortStageStateMatches(
    { value: fixture.source, witness: rawWitness(), codeCertificate: validCertificate },
    { value: fixture.source, witness: rawWitness(), codeCertificate: forgedReplacement }
  ), 'invalid same-length code evidence cannot pass through equal raw lengths').toBe(false);
  const missingBody = certifyCode(evidence({ domText: body.slice(0, -1),
    anchorPrefix: body.slice(0, -1), focusPrefix: body.slice(0, -1) }));
  expect(missingBody?.valid, 'missing body byte is rejected').toBe(false);
  const twoLfs = certifyCode(evidence({ domText: `${body}\n\n` }));
  expect(twoLfs?.valid, 'two renderer LFs are rejected').toBe(false);
  const trailingSpace = certifyCode(evidence({ domText: `${body} ` }));
  expect(trailingSpace?.valid, 'arbitrary trailing whitespace is rejected').toBe(false);
  const afterRendererLf = certifyCode(evidence({ domText: `${body}\n`,
    anchorPrefix: `${body}\n`, focusPrefix: `${body}\n`, anchorLocal: body.length + 1,
    focusLocal: body.length + 1 }));
  expect(afterRendererLf?.valid, 'caret after the closing renderer LF is rejected').toBe(false);
  const reverse = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'backward',
    anchorPrefix: body.slice(0, -1), focusPrefix: body }));
  expect(reverse?.valid, 'contradictory backward range order is rejected').toBe(false);
  const contradictoryForward = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'forward',
    anchorPrefix: body, focusPrefix: body.slice(0, -1) }));
  expect(contradictoryForward?.valid, 'contradictory forward range order is rejected').toBe(false);
  const emptyUncollapsed = certifyCode(evidence({ nativeCollapsed: false, nativeDirection: 'forward',
    anchorPrefix: body, focusPrefix: body }));
  expect(emptyUncollapsed?.valid, 'non-collapsed empty range is rejected').toBe(false);
  const collapsedWrongDirection = certifyCode(evidence({ nativeCollapsed: true, nativeDirection: 'backward',
    anchorPrefix: body, focusPrefix: body }));
  expect(collapsedWrongDirection?.valid, 'collapsed selection with non-none direction is rejected').toBe(false);
  const rangeAfterRendererLf = certifyCode(evidence({ domText: `${body}\n`,
    nativeCollapsed: false, nativeDirection: 'backward',
    anchorPrefix: `${body}\n`, focusPrefix: '', anchorLocal: body.length + 1, focusLocal: 0 }));
  expect(rangeAfterRendererLf?.valid, 'ranged endpoint after the closing renderer LF is rejected').toBe(false);
  const crossBlock = certifyCode(evidence({ prePresent: false, preChildCount: 0,
    preDirectCode: false, codeInsidePre: false, observedBlockOrdinal: null,
    observedCodeOrdinal: null, anchorPrefix: null, focusPrefix: null }));
  expect(crossBlock?.valid, 'cross-block or missing PRE evidence is rejected').toBe(false);
  const wrongBlock = certifyCode(evidence({
    observedBlockOrdinal: fixture.descriptor.blockOrdinal + 1
  }));
  expect(wrongBlock?.valid, 'same-text wrong block is rejected').toBe(false);
  const extraPreText = certifyCode(evidence({ preChildCount: 2, preDirectCode: false }));
  expect(extraPreText?.valid, 'extra PRE text or wrong tag is rejected').toBe(false);
  const differentSource = certifyCode(evidence({
    source: `${fixture.source.slice(0, -1)}${fixture.source.at(-1) === 'x' ? 'y' : 'x'}`,
    sourceDeclared: false
  }));
  expect(differentSource?.valid, 'non-declared source is rejected').toBe(false);
  const missingProof = certifyCode(evidence({ descriptor: null, sourceDeclared: false }));
  expect(missingProof?.valid, 'missing descriptor proof is rejected').toBe(false);
  const internalBlocks = [{
    kind: 'code', source: '~~~\nab\ncd\n~~~', body: [...'ab', '\n', ...'cd']
  }];
  const internalFixture = descriptorFixture(internalBlocks);
  const internalBody = internalFixture.descriptor?.body;
  expect(typeof internalBody, 'internal-LF fixture body is declared').toBe('string');
  const internalLoss = certifyCode({
    ...evidence({
      source: internalFixture.source, descriptor: internalFixture.descriptor,
      observedBlockOrdinal: internalFixture.descriptor.blockOrdinal,
      observedCodeOrdinal: internalFixture.descriptor.codeOrdinal
    }),
    domText: internalBody.replace('\n', ''), anchorPrefix: internalBody.replace('\n', ''),
    focusPrefix: internalBody.replace('\n', '')
  });
  expect(internalLoss?.valid, 'internal body LF loss is rejected').toBe(false);
  const terminalBodyLfBlocks = [{
    kind: 'code', source: '~~~\nline\n\n~~~', body: [...'line', '\n']
  }];
  const terminalBodyLfFixture = descriptorFixture(terminalBodyLfBlocks);
  expect(typeof terminalBodyLfFixture.descriptor?.body, 'terminal-LF fixture body is declared').toBe('string');
  const terminalBodyLfLoss = certifyCode({
    ...evidence({
      source: terminalBodyLfFixture.source, descriptor: terminalBodyLfFixture.descriptor,
      observedBlockOrdinal: terminalBodyLfFixture.descriptor.blockOrdinal,
      observedCodeOrdinal: terminalBodyLfFixture.descriptor.codeOrdinal
    }),
    domText: terminalBodyLfFixture.descriptor.body.slice(0, -1),
    anchorPrefix: terminalBodyLfFixture.descriptor.body.slice(0, -1),
    focusPrefix: terminalBodyLfFixture.descriptor.body.slice(0, -1)
  });
  expect(terminalBodyLfLoss?.valid, 'real terminal body LF loss is rejected').toBe(false);
  const ambiguous = shortStageUniqueCodeDeclarations([
    { source: 'ambiguous-source', descriptor: { body: 'one' } },
    { source: 'ambiguous-source', descriptor: { body: 'two' } }
  ]);
  expect(ambiguous.has('ambiguous-source'), 'ambiguous source declaration is not certifiable').toBe(false);
});
