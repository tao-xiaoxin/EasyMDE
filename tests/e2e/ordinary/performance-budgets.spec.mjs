import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  fillMarkdownAndWaitForPreview,
  fullCapabilityImage,
  login,
  openEasyMdeNewPost,
  placeVisualCaretAfterText,
  registerEditorWorkflowHooks,
  syntheticDenseCodeBlockCount,
  syntheticDenseGeneratedCodeBlockCount,
  syntheticDenseParagraphCount,
  syntheticDensePasteSettledLimitMs,
  syntheticDensePreviewRootCount,
  syntheticLargeCodeBlockCount,
  syntheticLargeEditSettledLimitMs,
  syntheticLargeGeneratedCodeBlockCount,
  syntheticLargeHeadingCount,
  syntheticLargeMarkdown,
  syntheticLargePasteActivationTaskCountLimit,
  syntheticLargePasteActivationTotalBlockingTimeLimitMs,
  syntheticLargePasteSettledLimitMs,
  syntheticLargePasteTotalBlockingTimeLimitMs,
  syntheticLargePreviewLayoutTaskCountLimit,
  syntheticLargePreviewLayoutTaskLimitMs,
  syntheticLargePreviewRootCount,
  syntheticLargePreviewTotalBlockingTimeLimitMs
} from '../helpers/editor-e2e-helpers.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  const editPhaseLongTaskBudgetLimits = {
    blockingThresholdMs: 50,
    maxBlockingMs: 25,
    maxCount: 1,
    maxDurationMs: 75
  };

  const classifyLongTasksByEditPhase = (tasks, phaseWindows, interactionWindow) => (
    tasks.map(({ attribution = [], start, duration }) => {
      const overlappingPhases = phaseWindows
        .filter(({ start: phaseStart, end }) => (
          start < end && start + duration > phaseStart
        ))
        .map(({ inputIndex, phase }) => Number.isInteger(inputIndex)
          ? { inputIndex, phase }
          : { phase });
      const overlapsInteraction = start < interactionWindow.end
        && start + duration > interactionWindow.start;
      return {
        attribution,
        classification: overlappingPhases.length
          ? 'editPhase'
          : overlapsInteraction ? 'betweenPhase' : 'outsideInteraction',
        durationMs: duration,
        overlappingPhases,
        startTimeMs: start
      };
    }).sort((first, second) => first.startTimeMs - second.startTimeMs)
  );

  const summarizeEditPhaseLongTaskBudget = (tasks) => {
    const editTasks = tasks.filter(({ classification }) => 'editPhase' === classification);
    const blockingTimeMs = editTasks.reduce((total, { durationMs }) => (
      total + Math.max(durationMs - editPhaseLongTaskBudgetLimits.blockingThresholdMs, 0)
    ), 0);
    let violationCode = null;
    if (editTasks.some(({ overlappingPhases }) => overlappingPhases.length > 1)) {
      violationCode = 'nonwindowed-edit-long-task-crosses-multiple-phases';
    } else if (editTasks.length > editPhaseLongTaskBudgetLimits.maxCount) {
      violationCode = 'nonwindowed-edit-long-task-count-exceeded';
    } else if (editTasks.some(({ durationMs }) => (
      durationMs > editPhaseLongTaskBudgetLimits.maxDurationMs
    ))) {
      violationCode = 'nonwindowed-edit-long-task-duration-exceeded';
    } else if (blockingTimeMs > editPhaseLongTaskBudgetLimits.maxBlockingMs) {
      violationCode = 'nonwindowed-edit-long-task-blocking-exceeded';
    }
    return { blockingTimeMs, count: editTasks.length, violationCode };
  };

  test('enforces the non-windowed edit-phase Long Task budget', () => {
    const phaseWindows = [{ end: 160, phase: 'burst', start: 100 }];
    const interactionWindow = { end: 250, start: 90 };
    const [editTask, overLimitTask, betweenTask, outsideTask] = classifyLongTasksByEditPhase([
      { duration: 69, start: 100 },
      { duration: 76, start: 100 },
      { duration: 76, start: 161 },
      { duration: 84, start: 251 }
    ], phaseWindows, interactionWindow);

    expect(editTask?.classification).toBe('editPhase');
    expect(editTask?.overlappingPhases).toEqual([{ phase: 'burst' }]);
    expect(summarizeEditPhaseLongTaskBudget([editTask])).toEqual({
      blockingTimeMs: 19,
      count: 1,
      violationCode: null
    });
    expect(summarizeEditPhaseLongTaskBudget([overLimitTask]).violationCode)
      .toBe('nonwindowed-edit-long-task-duration-exceeded');
    expect(betweenTask?.classification).toBe('betweenPhase');
    expect(betweenTask?.overlappingPhases).toEqual([]);
    expect(outsideTask?.classification).toBe('outsideInteraction');
    expect(summarizeEditPhaseLongTaskBudget([
      editTask,
      { ...editTask, startTimeMs: editTask.startTimeMs + 1 }
    ]).violationCode).toBe('nonwindowed-edit-long-task-count-exceeded');
    const crossingPhases = classifyLongTasksByEditPhase(
      [{ duration: 60, start: 130 }],
      [
        { end: 160, phase: 'first', start: 100 },
        { end: 180, inputIndex: 1, phase: 'second', start: 120 }
      ],
      interactionWindow
    );
    expect(summarizeEditPhaseLongTaskBudget(crossingPhases).violationCode)
      .toBe('nonwindowed-edit-long-task-crosses-multiple-phases');
    expect(summarizeEditPhaseLongTaskBudget([betweenTask, outsideTask])).toEqual({
      blockingTimeMs: 0,
      count: 0,
      violationCode: null
    });
    expect(summarizeEditPhaseLongTaskBudget(
      classifyLongTasksByEditPhase(
        [{ duration: 75, start: 100 }],
        phaseWindows,
        interactionWindow
      )
    )).toEqual({ blockingTimeMs: 25, count: 1, violationCode: null });
  });

  test('@performance keeps near-threshold non-windowed immersive code editing responsive', async ({ page }, testInfo) => {
    testInfo.setTimeout(Math.max(testInfo.timeout, 180_000));
    const codeBlocks = Array.from({ length: 158 }, (_, index) => (
      `~~~js\nconst block${index + 1} = '${'x'.repeat(560)}';\n~~~`
    ));
    const emptyCodeFence = '~~~js\n\n~~~';
    const markdown = [...codeBlocks, emptyCodeFence].join('\n\n');
    const burst = 'abcdefghijklmnopqrst';
    const spaced = 'UVWXY';
    const afterBurst = markdown.replace(emptyCodeFence, `~~~js\n${burst}\n~~~`);
    const expectedMarkdown = markdown.replace(
      emptyCodeFence,
      `~~~js\n${burst}${spaced}\n~~~`
    );
    const expectedVisibleCodeBody = `${burst}${spaced}\n`;
    const afterBurstVisibleCodeBody = `${burst}\n`;
    const spacedTargetValues = Array.from(
      { length: spaced.length },
      (_, index) => markdown.replace(
        emptyCodeFence,
        `~~~js\n${burst}${spaced.slice(0, index + 1)}\n~~~`
      )
    );
    const spacedTargetVisibleCodeBodies = Array.from(
      { length: spaced.length },
      (_, index) => `${burst}${spaced.slice(0, index + 1)}\n`
    );
    const performanceKey = '__easymdeNonwindowedCodePerformance';
    const markdownBytes = Buffer.byteLength(markdown, 'utf8');
    const browserFailures = [];

    expect(codeBlocks).toHaveLength(158);
    expect(markdownBytes).toBeGreaterThanOrEqual(90_000);
    expect(markdownBytes).toBeLessThan(100_000);
    expect(markdown.endsWith(emptyCodeFence)).toBe(true);
    page.on('pageerror', (error) => browserFailures.push({
      type: 'pageerror',
      name: error.name || 'Error'
    }));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push({ type: 'console-error' });
    });
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, null);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const editor = page.getByRole('textbox', {
      name: immersiveLabels.previewEditorLabel
    });
    const source = page.locator('#easymde-source');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveAttribute('aria-busy', 'false');
    await expect(editor).not.toHaveAttribute('data-easymde-preview-error', '1');
    const fixtureShape = await editor.evaluate((surface) => {
      const code = surface.querySelectorAll('pre > code');
      return {
        preCount: surface.querySelectorAll('pre').length,
        spacerCount: surface.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ).length,
        lastCodeTextLength: code.item(code.length - 1)?.textContent?.length ?? -1,
        lastCodeIsBlank: 0 === (code.item(code.length - 1)?.textContent ?? '').trim().length
      };
    });
    expect(fixtureShape).toMatchObject({
      preCount: 159,
      spacerCount: 0,
      lastCodeIsBlank: true
    });

    const lastCode = editor.locator('pre > code').last();
    await lastCode.scrollIntoViewIfNeeded();
    await lastCode.click({ position: { x: 24, y: 18 } });
    await editor.evaluate((surface, {
      key,
      afterBurstValue,
      afterBurstVisibleCodeBody,
      spacedTargetValues,
      spacedTargetVisibleCodeBodies
    }) => {
      const source = document.querySelector('#easymde-source');
      const code = surface.querySelectorAll('pre > code').item(
        surface.querySelectorAll('pre > code').length - 1
      );
      if (!(source instanceof HTMLTextAreaElement)
        || !(code instanceof HTMLElement)
        || !(surface instanceof HTMLElement)) {
        throw new Error('nonwindowed-performance-owner-unavailable');
      }
      const initialCodeTextLength = code.textContent?.length ?? -1;
      if ((code.textContent ?? '').trim().length > 0) {
        throw new Error('nonwindowed-performance-target-code-is-not-blank');
      }
      if (!Array.isArray(PerformanceObserver.supportedEntryTypes)
        || !PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        throw new Error('nonwindowed-performance-longtask-observer-unavailable');
      }

      const state = {
        phase: 'burst',
        initialCodeTextLength,
        burstBeforeInputAt: [],
        burstInputDomLengths: [],
        burstLastInputAt: null,
        burstSettledAt: null,
        burstStableAt: null,
        firstFrameAt: null,
        firstInputAt: null,
        spacedStartAt: [],
        spacedSettledAt: [],
        spacedStableAt: [],
        longTasks: []
      };
      const attributionCategories = new Set([
        'embed',
        'fencedframe',
        'iframe',
        'object',
        'portal',
        'unknown',
        'window'
      ]);
      const readLongTask = (entry) => ({
        attribution: Array.from(entry.attribution ?? [], ({ containerType, name }) => ({
          containerType: 'string' === typeof containerType
            && attributionCategories.has(containerType.toLowerCase())
            ? containerType.toLowerCase()
            : '[redacted]',
          name: 'string' === typeof name
            && attributionCategories.has(name.toLowerCase())
            ? name.toLowerCase()
            : '[redacted]'
        })),
        duration: entry.duration,
        start: entry.startTime
      });
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push(readLongTask(entry));
        }
      });
      observer.observe({ type: 'longtask', buffered: false });

      const beforeInput = (event) => {
        if (event.inputType !== 'insertText' || event.isComposing) return;
        const at = performance.now();
        if (state.phase === 'burst') state.burstBeforeInputAt.push(at);
        if (state.phase === 'spaced') state.spacedStartAt.push(at);
      };
      const input = (event) => {
        if (event.inputType !== 'insertText' || event.isComposing) return;
        const at = performance.now();
        if (state.phase === 'burst') {
          state.burstLastInputAt = at;
          state.burstInputDomLengths.push(code.textContent?.length ?? -1);
          if (state.firstInputAt === null) {
            state.firstInputAt = at;
            requestAnimationFrame(() => { state.firstFrameAt = performance.now(); });
          }
        }
      };
      surface.addEventListener('beforeinput', beforeInput, true);
      surface.addEventListener('input', input, true);

      const lastVisibleCodeBody = () => {
        const codeElements = surface.querySelectorAll('pre > code');
        return codeElements.item(codeElements.length - 1)?.textContent ?? null;
      };
      const observeStableVisibleFrame = (expectedValue, expectedCodeBody, record) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (
            source.value === expectedValue
            && lastVisibleCodeBody() === expectedCodeBody
          ) {
            record(performance.now());
          }
        }));
      };
      const sampleCanonicalState = () => {
        if (state.phase === 'burst'
          && state.burstSettledAt === null
          && source.value === afterBurstValue) {
          state.burstSettledAt = performance.now();
          observeStableVisibleFrame(
            afterBurstValue,
            afterBurstVisibleCodeBody,
            (at) => { state.burstStableAt = at; }
          );
        }
        if (state.phase === 'spaced') {
          for (let index = 0; index < spacedTargetValues.length; index += 1) {
            if (state.spacedStartAt[index] !== undefined
              && state.spacedSettledAt[index] === undefined
              && source.value === spacedTargetValues[index]) {
              state.spacedSettledAt[index] = performance.now();
              observeStableVisibleFrame(
                spacedTargetValues[index],
                spacedTargetVisibleCodeBodies[index],
                (at) => { state.spacedStableAt[index] = at; }
              );
            }
          }
        }
        if (state.spacedSettledAt.length < spacedTargetValues.length) {
          requestAnimationFrame(sampleCanonicalState);
        }
      };
      requestAnimationFrame(sampleCanonicalState);

      const dispose = () => {
        surface.removeEventListener('beforeinput', beforeInput, true);
        surface.removeEventListener('input', input, true);
        observer.disconnect();
      };
      window[key] = { state, observer, dispose, readLongTask };
    }, {
      key: performanceKey,
      afterBurstValue: afterBurst,
      afterBurstVisibleCodeBody,
      spacedTargetValues,
      spacedTargetVisibleCodeBodies
    });

    await page.keyboard.type(burst, { delay: 0 });
    await page.waitForFunction((value) => (
      document.querySelector('#easymde-source')?.value === value
    ), afterBurst, { timeout: 30_000 });
    await expect.poll(
      () => editor.evaluate((surface, key) => (
        window[key]?.state?.burstStableAt ?? null
      ), performanceKey),
      { timeout: 5_000, message: 'burst canonical DOM should reach two stable frames' }
    ).not.toBeNull();
    await editor.evaluate((surface, key) => {
      const holder = window[key];
      if (!holder) throw new Error('nonwindowed-performance-state-unavailable');
      holder.state.phase = 'spaced';
    }, performanceKey);

    for (let index = 0; index < spaced.length; index += 1) {
      await page.keyboard.type(spaced[index], { delay: 0 });
      await page.waitForFunction((length) => (
        document.querySelector('#easymde-source')?.value.length === length
      ), afterBurst.length + index + 1, { timeout: 30_000 });
      try {
        await expect.poll(
          () => editor.evaluate((surface, { key, index: targetIndex }) => (
            window[key]?.state?.spacedStableAt?.[targetIndex] ?? null
          ), { key: performanceKey, index }),
          {
            timeout: 5_000,
            message: `spaced input ${index + 1} should reach two stable visible frames`
          }
        ).not.toBeNull();
      } catch {
        const phaseDiagnostic = await editor.evaluate((surface, {
          key,
          index: targetIndex,
          expectedBody,
          sourceTargetLength
        }) => {
          const state = window[key]?.state;
          const codeElements = surface.querySelectorAll('pre > code');
          const visibleCodeBody = codeElements.item(codeElements.length - 1)?.textContent ?? null;
          return {
            phase: state?.phase ?? null,
            inputStartedAt: state?.spacedStartAt?.[targetIndex] ?? null,
            canonicalSettledAt: state?.spacedSettledAt?.[targetIndex] ?? null,
            stableFrameAt: state?.spacedStableAt?.[targetIndex] ?? null,
            sourceLength: document.querySelector('#easymde-source')?.value.length ?? -1,
            sourceTargetLength,
            visibleCodeBodyLength: visibleCodeBody?.length ?? -1,
            expectedCodeBodyLength: expectedBody.length,
            visibleCodeBodyMatchesExpected: visibleCodeBody === expectedBody
          };
        }, {
          key: performanceKey,
          index,
          expectedBody: `${burst}${spaced.slice(0, index + 1)}\n`,
          sourceTargetLength: afterBurst.length + index + 1
        });
        throw new Error(
          `nonwindowed-performance-visible-frame-endpoint-missing-${JSON.stringify(phaseDiagnostic)}`
        );
      }
      await page.waitForTimeout(120);
    }
    await page.waitForFunction((value) => (
      document.querySelector('#easymde-source')?.value === value
    ), expectedMarkdown, { timeout: 30_000 });

    const rawPerformanceEvidence = await editor.evaluate((surface, {
      key,
      expectedCodeBody,
      spacedCount
    }) => {
      const holder = window[key];
      if (!holder) throw new Error('nonwindowed-performance-state-unavailable');
      const { state, observer, readLongTask } = holder;
      const codeElements = surface.querySelectorAll('pre > code');
      const finalCode = codeElements.item(codeElements.length - 1);
      for (const entry of observer.takeRecords()) {
        state.longTasks.push(readLongTask(entry));
      }
      const interactionStart = state.burstBeforeInputAt[0] ?? Number.NaN;
      const interactionEnd = state.spacedStableAt.at(-1) ?? Number.NaN;
      const phaseWindows = [
        ...(Number.isFinite(interactionStart) && Number.isFinite(state.burstStableAt)
          ? [{ end: state.burstStableAt, phase: 'burst', start: interactionStart }]
          : []),
        ...state.spacedStartAt.flatMap((start, inputIndex) => {
          const end = state.spacedStableAt[inputIndex];
          return Number.isFinite(end)
            ? [{ end, inputIndex, phase: 'spaced', start }]
            : [];
        })
      ];
      const phaseWindowsComplete = Number.isFinite(interactionStart)
        && Number.isFinite(interactionEnd)
        && Number.isFinite(state.burstSettledAt)
        && Number.isFinite(state.burstStableAt)
        && state.spacedStartAt.length === spacedCount
        && state.spacedSettledAt.length === spacedCount
        && state.spacedStableAt.length === spacedCount
        && Array.from({ length: spacedCount }, (_, index) => (
          Number.isFinite(state.spacedStartAt[index])
            && Number.isFinite(state.spacedSettledAt[index])
            && Number.isFinite(state.spacedStableAt[index])
        )).every(Boolean);
      const completePhaseWindows = phaseWindowsComplete
        && phaseWindows.length === spacedCount + 1;
      const evidence = {
        burstEventCount: state.burstBeforeInputAt.length,
        initialCodeTextLength: state.initialCodeTextLength,
        burstInputDomLengths: state.burstInputDomLengths,
        firstInputToFrameMs: null === state.firstFrameAt || null === state.firstInputAt
          ? null
          : state.firstFrameAt - state.firstInputAt,
        lastBurstInputToCanonicalMs: null === state.burstSettledAt
          || null === state.burstLastInputAt
          ? null
          : state.burstSettledAt - state.burstLastInputAt,
        spacedInputToCanonicalMs: state.spacedStartAt.map((startedAt, index) => (
          undefined === state.spacedSettledAt[index]
            ? null
            : state.spacedSettledAt[index] - startedAt
        )),
        spacedKeyGapsMs: state.spacedStartAt.slice(1).map((startedAt, index) => (
          startedAt - state.spacedStartAt[index]
        )),
        visibleCodeBodyMatchesExpected: finalCode?.textContent === expectedCodeBody,
        visibleCodeBodyLength: finalCode?.textContent?.length ?? -1,
        observedLongTaskCount: state.longTasks.length,
        phaseWindows,
        phaseWindowsComplete: completePhaseWindows,
        interactionWindow: { end: interactionEnd, start: interactionStart },
        longTasks: state.longTasks
      };
      holder.dispose();
      delete window[key];
      return evidence;
    }, {
      key: performanceKey,
      expectedCodeBody: expectedVisibleCodeBody,
      spacedCount: spaced.length
    });
    const classifiedLongTasks = classifyLongTasksByEditPhase(
      rawPerformanceEvidence.longTasks,
      rawPerformanceEvidence.phaseWindows,
      rawPerformanceEvidence.interactionWindow
    );
    const broadInteractionLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'outsideInteraction' !== classification
    ));
    const editPhaseLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'editPhase' === classification
    ));
    const betweenPhaseLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'betweenPhase' === classification
    ));
    const outsideInteractionLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'outsideInteraction' === classification
    ));
    const editPhaseLongTaskBudgetResult = summarizeEditPhaseLongTaskBudget(
      classifiedLongTasks
    );
    const performanceEvidence = {
      ...rawPerformanceEvidence,
      broadInteractionLongTaskCount: broadInteractionLongTasks.length,
      betweenPhaseLongTaskCount: betweenPhaseLongTasks.length,
      betweenPhaseLongTasks,
      editPhaseLongTaskCount: editPhaseLongTasks.length,
      editPhaseLongTaskDurationsMs: editPhaseLongTasks.map(({ durationMs }) => durationMs),
      editPhaseLongTaskBlockingMs: editPhaseLongTaskBudgetResult.blockingTimeMs,
      editPhaseLongTaskViolationCode: editPhaseLongTaskBudgetResult.violationCode,
      editPhaseLongTasks,
      outsideInteractionLongTaskCount: outsideInteractionLongTasks.length,
      outsideInteractionLongTasks,
      longTasks: classifiedLongTasks
    };
    const spacedSorted = [...performanceEvidence.spacedInputToCanonicalMs]
      .sort((left, right) => left - right);
    const spacedP95Ms = spacedSorted.length === 5
      ? spacedSorted[Math.ceil(spacedSorted.length * 0.95) - 1]
      : null;
    const spacedMaxMs = spacedSorted.at(-1) ?? null;
    const domLengthsAreMonotonic = performanceEvidence.burstInputDomLengths.length === burst.length
      && performanceEvidence.burstInputDomLengths.every((length, index, lengths) => (
        index === 0 || length > lengths[index - 1]
      ));
    const evidence = {
      markdownBytes,
      previewPreCount: fixtureShape.preCount,
      windowSpacerCount: fixtureShape.spacerCount,
      lastCodeTextLengthBeforeEdit: fixtureShape.lastCodeTextLength,
      initialCodeTextLength: performanceEvidence.initialCodeTextLength,
      burstCharacters: burst.length,
      burstInputCount: performanceEvidence.burstEventCount,
      burstDomLengths: performanceEvidence.burstInputDomLengths,
      domLengthsAreMonotonic,
      firstInputToFrameMs: performanceEvidence.firstInputToFrameMs,
      firstInputToFrameLimitMs: 100,
      lastBurstInputToCanonicalMs: performanceEvidence.lastBurstInputToCanonicalMs,
      lastBurstInputToCanonicalLimitMs: 150,
      spacedInputToCanonicalMs: performanceEvidence.spacedInputToCanonicalMs,
      spacedKeyGapsMs: performanceEvidence.spacedKeyGapsMs,
      spacedKeyMinimumGapMs: 80,
      spacedP95Ms,
      spacedP95LimitMs: 150,
      spacedMaxMs,
      spacedMaxLimitMs: 200,
      visibleCodeBodyMatchesExpected: performanceEvidence.visibleCodeBodyMatchesExpected,
      visibleCodeBodyLength: performanceEvidence.visibleCodeBodyLength,
      expectedVisibleCodeBodyLength: expectedVisibleCodeBody.length,
      phaseWindowsComplete: performanceEvidence.phaseWindowsComplete,
      phaseWindows: performanceEvidence.phaseWindows,
      interactionWindow: performanceEvidence.interactionWindow,
      observedLongTaskCount: performanceEvidence.observedLongTaskCount,
      broadInteractionLongTaskCount: performanceEvidence.broadInteractionLongTaskCount,
      editPhaseLongTaskCount: performanceEvidence.editPhaseLongTaskCount,
      editPhaseLongTaskBlockingMs: performanceEvidence.editPhaseLongTaskBlockingMs,
      editPhaseLongTaskViolationCode: performanceEvidence.editPhaseLongTaskViolationCode,
      editPhaseLongTaskBudget: editPhaseLongTaskBudgetLimits,
      betweenPhaseLongTaskCount: performanceEvidence.betweenPhaseLongTaskCount,
      outsideInteractionLongTaskCount: performanceEvidence.outsideInteractionLongTaskCount,
      editPhaseLongTaskDurationsMs: performanceEvidence.editPhaseLongTaskDurationsMs,
      longTasks: performanceEvidence.longTasks,
      editPhaseLongTasks: performanceEvidence.editPhaseLongTasks,
      betweenPhaseLongTasks: performanceEvidence.betweenPhaseLongTasks,
      outsideInteractionLongTasks: performanceEvidence.outsideInteractionLongTasks,
      browserFailureCount: browserFailures.length
    };
    const evidenceJson = `${JSON.stringify(evidence)}\n`;
    const evidencePath = testInfo.outputPath(
      'immersive-nonwindowed-code-edit-performance.json'
    );
    await writeFile(evidencePath, evidenceJson, 'utf8');
    await testInfo.attach('immersive-nonwindowed-code-edit-performance.json', {
      path: evidencePath,
      contentType: 'application/json'
    });
    process.stdout.write(`[EasyMDEPerf] ${evidenceJson}`);

    expect(performanceEvidence.editPhaseLongTaskViolationCode).toBeNull();
    expect(await source.inputValue()).toBe(expectedMarkdown);
    expect(performanceEvidence.burstEventCount).toBe(burst.length);
    expect(domLengthsAreMonotonic).toBe(true);
    expect(performanceEvidence.visibleCodeBodyMatchesExpected).toBe(true);
    expect(performanceEvidence.firstInputToFrameMs).not.toBeNull();
    expect(performanceEvidence.firstInputToFrameMs).toBeLessThanOrEqual(100);
    expect(performanceEvidence.lastBurstInputToCanonicalMs).not.toBeNull();
    expect(performanceEvidence.lastBurstInputToCanonicalMs).toBeLessThanOrEqual(150);
    expect(performanceEvidence.spacedInputToCanonicalMs).toHaveLength(spaced.length);
    expect(performanceEvidence.spacedInputToCanonicalMs.every(Number.isFinite)).toBe(true);
    expect(performanceEvidence.spacedKeyGapsMs).toHaveLength(spaced.length - 1);
    expect(performanceEvidence.spacedKeyGapsMs.every((gap) => gap > 80)).toBe(true);
    expect(spacedP95Ms).not.toBeNull();
    expect(spacedP95Ms).toBeLessThanOrEqual(150);
    expect(spacedMaxMs).not.toBeNull();
    expect(spacedMaxMs).toBeLessThanOrEqual(200);
    expect(performanceEvidence.phaseWindowsComplete).toBe(true);
    expect(performanceEvidence.phaseWindows).toHaveLength(spaced.length + 1);
    expect(performanceEvidence.observedLongTaskCount)
      .toBe(performanceEvidence.longTasks.length);
    expect(performanceEvidence.broadInteractionLongTaskCount).toBe(
      performanceEvidence.editPhaseLongTaskCount
        + performanceEvidence.betweenPhaseLongTaskCount
    );
    expect(performanceEvidence.editPhaseLongTaskCount).toBeLessThanOrEqual(
      editPhaseLongTaskBudgetLimits.maxCount
    );
    expect(performanceEvidence.editPhaseLongTasks.every(({ durationMs, overlappingPhases }) => (
      durationMs <= editPhaseLongTaskBudgetLimits.maxDurationMs
        && overlappingPhases.length === 1
    ))).toBe(true);
    expect(performanceEvidence.editPhaseLongTaskBlockingMs).toBeLessThanOrEqual(
      editPhaseLongTaskBudgetLimits.maxBlockingMs
    );
    expect(performanceEvidence.longTasks.every(({ attribution }) => (
      Array.isArray(attribution)
        && attribution.every((entry) => (
          Object.keys(entry).sort().join(',') === 'containerType,name'
          && ['[redacted]', 'embed', 'fencedframe', 'iframe', 'object', 'portal', 'unknown', 'window']
            .includes(entry.containerType)
          && ['[redacted]', 'embed', 'fencedframe', 'iframe', 'object', 'portal', 'unknown', 'window']
            .includes(entry.name)
        ))
    ))).toBe(true);
    expect(browserFailures).toEqual([]);
  });

  test('@performance keeps a synthetic large Markdown paste and windowed visual editing responsive', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const syntheticPaste = syntheticLargeMarkdown();
    const expectedMarkdown = `Before${syntheticPaste}`;
    const marker = 'Synthetic performance paragraph 1.';
    const performanceKey = '__easymdeSyntheticLongPerformance';
    expect(syntheticPaste.match(/^### /gm) ?? []).toHaveLength(syntheticLargeHeadingCount);
    expect(syntheticPaste.match(/^```javascript$/gm) ?? []).toHaveLength(
      syntheticLargeGeneratedCodeBlockCount + 1
    );
    expect(syntheticLargePreviewRootCount).toBe(2038);
    expect(syntheticLargeCodeBlockCount).toBe(3);
    expect(syntheticPaste).toContain('```\nSynthetic language-free code block.\n```');
    expect(syntheticPaste).toContain('```javascript\nconst syntheticWindowedValue = 1;\n```');
    expect(syntheticPaste).toContain('~~~bash\nprintf "synthetic windowed code block"\n~~~');
    const markdownEvidence = (markdown) => ({
      bytes: Buffer.byteLength(markdown, 'utf8'),
      characters: markdown.length,
      sha256: createHash('sha256').update(markdown, 'utf8').digest('hex')
    });
    const expectedMarkdownEvidence = markdownEvidence(expectedMarkdown);
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        let markdown = null;
        try {
          markdown = request.postDataJSON()?.markdown ?? null;
        } catch {
          markdown = null;
        }
        previewRequests.push(
          'string' === typeof markdown ? markdownEvidence(markdown) : null
        );
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-request');
        }, performanceKey).catch(() => undefined);
      }
    });
    page.on('response', (response) => {
      if (
        'POST' === response.request().method()
        && new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-response');
        }, performanceKey).catch(() => undefined);
      }
    });

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const baselinePreviewRequestCount = previewRequests.length;
    await visualEditor.evaluate((surface, key) => {
      const editInputTypes = new Set([
        'insertText',
        'deleteContentBackward',
        'deleteContentForward'
      ]);
      const state = {
        cls: 0,
        editWindows: [],
        editStartedAt: null,
        handlerDurations: [],
        inputEvents: 0,
        longTasks: [],
        longTaskObservationStartedAt: null,
        measurementStartedAt: null,
        mutationSerial: 0,
        phase: 'idle',
        pasteHandlerDurations: [],
        pasteFirstDoubleRaf: null,
        pasteSettlementPending: false,
        pasteSettledAt: null,
        pasteStartedAt: null,
        stableFrameDurations: [],
        transitions: [{ at: performance.now(), phase: 'idle' }],
        baselineSignature: surface.easymdePreviewSignature ?? ''
      };
      state.setPhase = (phase) => {
        state.phase = phase;
        state.transitions.push({ at: performance.now(), phase });
      };
      const isSurfaceSettled = () => surface.isConnected
        && surface.getAttribute('aria-busy') === 'false'
        && !surface.hasAttribute('data-easymde-preview-error')
        && 'string' === typeof surface.easymdePreviewSignature
        && surface.easymdePreviewSignature.length > 0;
      const isPasteSettled = () => Number.isFinite(state.pasteStartedAt)
        && isSurfaceSettled()
        && surface.easymdePreviewSignature !== state.baselineSignature
        && surface.querySelector('[data-easymde-preview-window-spacer]')
        && surface.querySelector('[data-easymde-visual-block-id]');
      const schedulePasteSettlement = () => {
        if (
          state.pasteSettledAt !== null
          || state.pasteSettlementPending
          || !isPasteSettled()
        ) return;
        state.pasteSettlementPending = true;
        const mutationSerial = state.mutationSerial;
        requestAnimationFrame(() => {
          if (state.pasteSettledAt !== null) {
            state.pasteSettlementPending = false;
            return;
          }
          if (!isPasteSettled() || state.mutationSerial !== mutationSerial) {
            state.pasteSettlementPending = false;
            schedulePasteSettlement();
            return;
          }
          state.pasteSettlementPending = false;
          state.pasteSettledAt = performance.now();
          state.setPhase('paste-settled');
        });
      };
      const eventStarts = new WeakMap();
      const isTrackedInput = (event) => editInputTypes.has(event.inputType)
        && !event.isComposing;
      const recordLongTasks = (entries) => {
        for (const entry of entries) {
          if (
            state.longTaskObservationStartedAt !== null
            && entry.startTime >= state.longTaskObservationStartedAt
            && entry.duration > 50
          ) {
            state.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime
            });
          }
        }
      };
      const recordLayoutShifts = (entries) => {
        if (null === state.measurementStartedAt) return;
        for (const entry of entries) {
          if (entry.startTime >= state.measurementStartedAt) {
            state.cls += entry.value;
          }
        }
      };
      if (!Array.isArray(PerformanceObserver.supportedEntryTypes)
        || !PerformanceObserver.supportedEntryTypes.includes('longtask')
        || !PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        throw new Error('immersive-performance-observer-unavailable');
      }
      const longTaskObserver = new PerformanceObserver((list) => {
        recordLongTasks(list.getEntries());
      });
      state.longTaskObservationStartedAt = performance.now();
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      const layoutShiftObserver = new PerformanceObserver((list) => {
        recordLayoutShifts(list.getEntries());
      });
      layoutShiftObserver.observe({ type: 'layout-shift', buffered: true });
      state.longTaskObserver = longTaskObserver;
      state.layoutShiftObserver = layoutShiftObserver;
      const captureEventStart = (event) => {
        if (isTrackedInput(event)) eventStarts.set(event, performance.now());
      };
      const recordEventEnd = (event) => {
        if (!isTrackedInput(event)) return;
        const startedAt = eventStarts.get(event);
        if (undefined !== startedAt
          && null !== state.editStartedAt
          && startedAt >= state.editStartedAt) {
          state.handlerDurations.push(performance.now() - startedAt);
        }
      };
      const recordInput = (event) => {
        if (!isTrackedInput(event)) return;
        const startedAt = eventStarts.get(event) ?? performance.now();
        if (null === state.editStartedAt || startedAt < state.editStartedAt) return;
        state.inputEvents += 1;
        let settledMutationSerial = state.mutationSerial;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (startedAt >= state.editStartedAt) {
            const settledAt = performance.now();
            state.stableFrameDurations.push(settledAt - startedAt);
            const settleInput = () => {
              if (startedAt < state.editStartedAt) return;
              if (!isSurfaceSettled()) {
                requestAnimationFrame(settleInput);
                return;
              }
              if (state.mutationSerial !== settledMutationSerial) {
                settledMutationSerial = state.mutationSerial;
                requestAnimationFrame(settleInput);
                return;
              }
              state.editWindows.push({
                end: performance.now(),
                inputType: event.inputType,
                ordinal: state.editWindows.length + 1,
                start: startedAt
              });
            };
            requestAnimationFrame(settleInput);
          }
        }));
      };
      const recordPaste = (event) => {
        if (Array.from(event.clipboardData?.types ?? []).includes('text/plain')) {
          const startedAt = performance.now();
          state.pasteStartedAt = startedAt;
          state.measurementStartedAt = startedAt;
          state.setPhase('paste');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (state.pasteStartedAt === startedAt) {
              state.pasteFirstDoubleRaf = performance.now() - startedAt;
            }
          }));
        }
      };
      const finishPaste = (event) => {
        if (!Array.from(event.clipboardData?.types ?? []).includes('text/plain')) return;
        if (!Number.isFinite(state.pasteStartedAt)) return;
        state.pasteHandlerDurations.push(performance.now() - state.pasteStartedAt);
        state.setPhase('paste-deferred');
        schedulePasteSettlement();
      };
      const mutationObserver = new MutationObserver(() => {
        state.mutationSerial += 1;
        schedulePasteSettlement();
      });
      mutationObserver.observe(surface, {
        attributes: true,
        attributeFilter: ['aria-busy', 'data-easymde-preview-error'],
        characterData: true,
        childList: true,
        subtree: true
      });
      surface.addEventListener('beforeinput', captureEventStart, true);
      surface.addEventListener('beforeinput', recordEventEnd);
      surface.addEventListener('input', captureEventStart, true);
      surface.addEventListener('input', recordEventEnd);
      surface.addEventListener('input', recordInput);
      surface.addEventListener('paste', recordPaste, true);
      surface.addEventListener('paste', finishPaste);
      state.dispose = () => {
        surface.removeEventListener('beforeinput', captureEventStart, true);
        surface.removeEventListener('beforeinput', recordEventEnd);
        surface.removeEventListener('input', captureEventStart, true);
        surface.removeEventListener('input', recordEventEnd);
        surface.removeEventListener('input', recordInput);
        surface.removeEventListener('paste', recordPaste, true);
        surface.removeEventListener('paste', finishPaste);
        mutationObserver.disconnect();
        longTaskObserver.disconnect();
        layoutShiftObserver.disconnect();
      };
      window[key] = state;
    }, performanceKey);

    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await visualEditor.focus();
    await visualEditor.press('ControlOrMeta+End');
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, syntheticPaste);
    await page.keyboard.press('ControlOrMeta+V');
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteFirstDoubleRaf, performanceKey),
      { timeout: 30_000, message: 'large paste should reach its first double-rAF' }
    ).not.toBeNull();

    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteSettledAt, performanceKey),
      { timeout: 30_000, message: 'large paste should reach semantic Preview settled readiness' }
    ).not.toBeNull();
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
      timeout: 30_000
    });
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
      timeout: 30_000
    });
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(
      () => previewRequests.length,
      { timeout: 30_000, message: 'large paste should issue one Preview request' }
    ).toBe(baselinePreviewRequestCount + 1);
    expect(previewRequests.at(-1)).toEqual(expectedMarkdownEvidence);
    expect(expectedMarkdownEvidence.bytes).toBeGreaterThan(190_000);
    expect(expectedMarkdownEvidence.bytes).toBeLessThan(200_000);

    const pasteToSettled = await page.evaluate((key) => {
      const state = window[key];
      if (
        !state
        || !Number.isFinite(state.pasteStartedAt)
        || !Number.isFinite(state.pasteSettledAt)
      ) {
        throw new Error('immersive-paste-performance-state-missing');
      }
      return state.pasteSettledAt - state.pasteStartedAt;
    }, performanceKey);
    expect(Number.isFinite(pasteToSettled)).toBe(true);
    expect(pasteToSettled).toBeGreaterThanOrEqual(0);
    expect(pasteToSettled).toBeLessThanOrEqual(syntheticLargePasteSettledLimitMs);

    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    const mountedBlocks = visualEditor.locator('[data-easymde-visual-block-id]');
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('immersive-preview-canvas-unavailable');
      }
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    const firstBlock = visualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).filter({ hasText: marker }).first();
    await expect(firstBlock).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => mountedBlocks.count(),
      { timeout: 30_000, message: 'scroll should settle the bounded visual window' }
    ).toBeLessThanOrEqual(160);
    const mountedBlockCount = await mountedBlocks.count();
    expect(mountedBlockCount).toBeGreaterThan(0);
    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    await placeVisualCaretAfterText(visualEditor, marker);
    await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-edit-performance-state-missing');
      state.editStartedAt = performance.now();
      state.setPhase('edit');
    }, performanceKey);

    let expectedInputEvents = 0;
    for (let index = 0; index < 30; index += 1) {
      await expect(visualEditor).toBeFocused();
      await page.keyboard.type('x');
      expectedInputEvents += 1;
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.inputEvents ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.stableFrameDurations.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.editWindows.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect(firstBlock).toContainText(`${marker}x`);

      await page.keyboard.press('Backspace');
      expectedInputEvents += 1;
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.inputEvents ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.stableFrameDurations.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.editWindows.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect(firstBlock).toContainText(marker);
    }

    const performanceEvidence = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-edit-performance-state-missing');
      for (const entry of state.longTaskObserver?.takeRecords?.() ?? []) {
        if (state.longTaskObservationStartedAt !== null
          && entry.startTime >= state.longTaskObservationStartedAt
          && entry.duration > 50) {
          state.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
      for (const entry of state.layoutShiftObserver?.takeRecords?.() ?? []) {
        if (state.measurementStartedAt !== null
          && entry.startTime >= state.measurementStartedAt) {
          state.cls += entry.value;
        }
      }
      const interactionWindows = [
        ...(Number.isFinite(state.pasteStartedAt)
          && Number.isFinite(state.pasteSettledAt)
          ? [{ end: state.pasteSettledAt, start: state.pasteStartedAt }]
          : []),
        ...state.editWindows
      ];
      const interactionLongTasks = state.longTasks
        .filter((task) => interactionWindows.some((window) =>
          task.startTime < window.end
          && task.startTime + task.duration > window.start
        ))
        .map((task) => {
          const transition = [...state.transitions]
            .reverse()
            .find(({ at }) => at <= task.startTime);
          const overlapsPasteStart = task.startTime < state.pasteStartedAt
            && task.startTime + task.duration > state.pasteStartedAt;
          const editWindows = state.editWindows.flatMap((window) => (
            task.startTime < window.end
            && task.startTime + task.duration > window.start
              ? [{ inputType: window.inputType, ordinal: window.ordinal }]
              : []
          ));
          return {
            duration: task.duration,
            editWindows,
            offset: Math.round(task.startTime - state.pasteStartedAt),
            phase: overlapsPasteStart
              ? 'paste-activation'
              : transition?.phase ?? state.phase
          };
        });
      const result = {
        cls: state.cls,
        editWindows: [...state.editWindows],
        handlerDurations: [...state.handlerDurations],
        inputEvents: state.inputEvents,
        longTasks: interactionLongTasks,
        pasteFirstDoubleRaf: state.pasteFirstDoubleRaf,
        pasteStartedAt: state.pasteStartedAt,
        pasteSettledAt: state.pasteSettledAt,
        pasteHandlerDurations: [...state.pasteHandlerDurations],
        stableFrameDurations: [...state.stableFrameDurations]
      };
      state.dispose();
      delete window[key];
      return result;
    }, performanceKey);
    const p95 = (values, label) => {
      expect(values.length, `${label} should contain measurements`).toBeGreaterThan(0);
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.ceil(sorted.length * 0.95) - 1];
    };
    const p95HandlerDuration = p95(
      performanceEvidence.handlerDurations,
      'edit handler durations'
    );
    const pasteHandlerDuration = p95(
      performanceEvidence.pasteHandlerDurations,
      'paste handler durations'
    );
    const p95StableFrameDuration = p95(
      performanceEvidence.stableFrameDurations,
      'stable frame durations'
    );
    const settledEditDurations = performanceEvidence.editWindows.map(({ end, start }) => {
      const duration = end - start;
      expect(Number.isFinite(duration), 'settled edit duration should be finite').toBe(true);
      expect(duration, 'settled edit duration should not be negative').toBeGreaterThanOrEqual(0);
      return duration;
    });
    const p95SettledEditDuration = p95(
      settledEditDurations,
      'mutation-settled edit durations'
    );
    const maxDuration = (values) => Math.max(...values);
    const activationTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'paste-activation'
    );
    const editLongTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'edit'
    );
    const previewResponseTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'preview-response'
    );
    const unexpectedLongTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => ![
        'paste-activation',
        'preview-response',
        'edit'
      ].includes(phase)
    );
    const totalBlockingTime = (tasks) => tasks.reduce(
      (total, { duration }) => total + Math.max(0, duration - 50),
      0
    );
    const activationBlockingTimeMs = totalBlockingTime(activationTasks);
    const previewResponseBlockingTimeMs = totalBlockingTime(previewResponseTasks);
    const combinedPasteBlockingTimeMs = activationBlockingTimeMs
      + previewResponseBlockingTimeMs;
    await testInfo.attach('immersive-synthetic-long-performance', {
      body: JSON.stringify({
        document: expectedMarkdownEvidence,
        editCycles: 30,
        inputEvents: performanceEvidence.inputEvents,
        longTasks: performanceEvidence.longTasks,
        cls: performanceEvidence.cls,
        pasteHandlerDuration,
        pasteFirstDoubleRaf: performanceEvidence.pasteFirstDoubleRaf,
        pasteToSettled,
        pasteSettledLimit: syntheticLargePasteSettledLimitMs,
        activationTaskCount: activationTasks.length,
        activationTaskCountLimit: syntheticLargePasteActivationTaskCountLimit,
        activationTasks,
        activationBlockingTimeMs,
        activationBlockingTimeLimitMs: syntheticLargePasteActivationTotalBlockingTimeLimitMs,
        previewResponseTaskCount: previewResponseTasks.length,
        previewResponseTaskCountLimit: syntheticLargePreviewLayoutTaskCountLimit,
        previewResponseTasks,
        previewResponseBlockingTimeMs,
        previewResponseBlockingTimeLimitMs: syntheticLargePreviewTotalBlockingTimeLimitMs,
        combinedPasteBlockingTimeMs,
        combinedPasteBlockingTimeLimitMs: syntheticLargePasteTotalBlockingTimeLimitMs,
        unexpectedLongTasks,
        p95HandlerDuration,
        maxHandlerDuration: maxDuration(performanceEvidence.handlerDurations),
        p95SettledEditDuration,
        maxSettledEditDuration: maxDuration(settledEditDurations),
        p95StableFrameDuration,
        maxStableFrameDuration: maxDuration(performanceEvidence.stableFrameDurations),
        editLongTasks,
        previewRequests: previewRequests.length - baselinePreviewRequestCount,
        settledEditCount: settledEditDurations.length,
        settledEditLimit: syntheticLargeEditSettledLimitMs,
        windowedMountedBlocks: mountedBlockCount,
        headings: syntheticLargeHeadingCount
      }),
      contentType: 'application/json'
    });
    expect(performanceEvidence.inputEvents).toBe(60);
    expect(performanceEvidence.editWindows).toHaveLength(60);
    expect(performanceEvidence.handlerDurations).toHaveLength(120);
    expect(performanceEvidence.stableFrameDurations).toHaveLength(60);
    expect(settledEditDurations).toHaveLength(60);
    expect(pasteHandlerDuration).toBeLessThan(50);
    expect(Number.isFinite(performanceEvidence.pasteFirstDoubleRaf)).toBe(true);
    expect(performanceEvidence.pasteFirstDoubleRaf).toBeLessThanOrEqual(100);
    expect(Number.isFinite(performanceEvidence.pasteSettledAt)).toBe(true);
    expect(performanceEvidence.pasteSettledAt - performanceEvidence.pasteStartedAt)
      .toBe(pasteToSettled);
    expect(p95HandlerDuration).toBeLessThanOrEqual(16);
    expect(p95SettledEditDuration).toBeLessThanOrEqual(syntheticLargeEditSettledLimitMs);
    expect(p95StableFrameDuration).toBeLessThanOrEqual(100);
    expect(editLongTasks).toEqual([]);
    expect(
      unexpectedLongTasks,
      `unexpected paste-window long tasks: ${JSON.stringify(unexpectedLongTasks)}`
    ).toEqual([]);
    expect(activationTasks.length).toBeLessThanOrEqual(
      syntheticLargePasteActivationTaskCountLimit
    );
    expect(
      activationBlockingTimeMs,
      `paste activation blocking time: ${JSON.stringify(activationTasks)}`
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTotalBlockingTimeLimitMs);
    expect(previewResponseTasks.length).toBeLessThanOrEqual(
      syntheticLargePreviewLayoutTaskCountLimit
    );
    expect(
      previewResponseBlockingTimeMs,
      `preview response blocking time: ${JSON.stringify(previewResponseTasks)}`
    ).toBeLessThanOrEqual(syntheticLargePreviewTotalBlockingTimeLimitMs);
    expect(
      combinedPasteBlockingTimeMs,
      `combined paste blocking time: ${JSON.stringify({
        activationTasks,
        previewResponseTasks
      })}`
    ).toBeLessThanOrEqual(syntheticLargePasteTotalBlockingTimeLimitMs);
    for (const task of [...activationTasks, ...previewResponseTasks]) {
      expect(task.duration)
        .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskLimitMs);
    }
    expect(performanceEvidence.cls).toBeLessThanOrEqual(0.01);
    expect(previewRequests.length).toBe(baselinePreviewRequestCount + 1);
    await page.getByRole('button', {
      name: immersiveLabels.previewLockReadOnly
    }).click();
    await expect(page.getByRole('textbox', {
      name: immersiveLabels.previewEditorLabel
    })).toHaveCount(0);
    await expect(source).toHaveValue(expectedMarkdown);
    expect(browserFailures).toEqual([]);
  });

  test('@performance renders a dense 2300-block Preview with 150 code fences before enabling visual edits', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const previewResponses = [];
    const syntheticPaste = syntheticLargeMarkdown({
      paragraphCount: syntheticDenseParagraphCount,
      generatedCodeBlockCount: syntheticDenseGeneratedCodeBlockCount,
      paragraphSuffix: 'Generated windowed markdown remains readable.'
    });
    const expectedMarkdown = `Before${syntheticPaste}`;
    const expectedMarkdownEvidence = {
      bytes: Buffer.byteLength(expectedMarkdown, 'utf8'),
      characters: expectedMarkdown.length,
      sha256: createHash('sha256').update(expectedMarkdown, 'utf8').digest('hex')
    };
    const performanceKey = '__easymdeDensePreviewPerformance';
    expect(syntheticPaste.match(/^### /gm) ?? []).toHaveLength(
      syntheticLargeHeadingCount
    );
    expect(syntheticPaste.match(/^```javascript$/gm) ?? []).toHaveLength(
      syntheticDenseGeneratedCodeBlockCount + 1
    );
    expect(syntheticDensePreviewRootCount).toBe(2300);
    expect(syntheticDenseCodeBlockCount).toBe(150);
    expect(expectedMarkdownEvidence.bytes).toBeGreaterThan(190_000);
    expect(expectedMarkdownEvidence.bytes).toBeLessThan(200_000);

    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        const markdown = request.postDataJSON()?.markdown ?? null;
        previewRequests.push(
          'string' === typeof markdown
            ? {
                bytes: Buffer.byteLength(markdown, 'utf8'),
                characters: markdown.length,
                sha256: createHash('sha256').update(markdown, 'utf8').digest('hex')
              }
            : null
        );
      }
    });
    page.on('response', (response) => {
      if (
        'POST' === response.request().method()
        && new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        previewResponses.push(response);
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-response');
        }, performanceKey).catch((error) => {
          browserFailures.push(`preview-phase:${error.message}`);
        });
      }
    });

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const baselinePreviewRequestCount = previewRequests.length;
    const baselinePreviewResponseCount = previewResponses.length;
    await visualEditor.evaluate((surface, key) => {
      const state = {
        baselineSignature: surface.easymdePreviewSignature ?? '',
        longTasks: [],
        longTaskObservationStartedAt: null,
        pasteHandlerDuration: null,
        pasteFirstDoubleRaf: null,
        pasteSettledAt: null,
        pasteStartedAt: null,
        phase: 'idle',
        settlementPending: false,
        transitions: [{ at: performance.now(), phase: 'idle' }]
      };
      state.setPhase = (phase) => {
        state.phase = phase;
        state.transitions.push({ at: performance.now(), phase });
      };
      const isSettled = () => surface.isConnected
        && surface.getAttribute('aria-busy') === 'false'
        && !surface.hasAttribute('data-easymde-preview-error')
        && surface.easymdePreviewSignature
        && surface.easymdePreviewSignature !== state.baselineSignature
        && surface.querySelector('[data-easymde-preview-window-spacer]')
        && surface.querySelector('[data-easymde-visual-block-id]');
      const scheduleSettlement = () => {
        if (
          state.pasteSettledAt !== null
          || state.settlementPending
          || !isSettled()
        ) return;
        state.settlementPending = true;
        requestAnimationFrame(() => {
          state.settlementPending = false;
          if (!isSettled() || state.pasteSettledAt !== null) return;
          state.pasteSettledAt = performance.now();
          state.setPhase('paste-settled');
        });
      };
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (
            state.longTaskObservationStartedAt !== null
            && entry.startTime >= state.longTaskObservationStartedAt
            && entry.duration > 50
          ) {
            state.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime
            });
          }
        }
      });
      if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        throw new Error('immersive-performance-observer-unavailable');
      }
      state.longTaskObservationStartedAt = performance.now();
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      state.longTaskObserver = longTaskObserver;
      const mutationObserver = new MutationObserver(scheduleSettlement);
      mutationObserver.observe(surface, {
        attributes: true,
        attributeFilter: ['aria-busy', 'data-easymde-preview-error'],
        characterData: true,
        childList: true,
        subtree: true
      });
      const hasPlainText = (event) => Array.from(event.clipboardData?.types ?? [])
        .includes('text/plain');
      const onPaste = (event) => {
        if (!hasPlainText(event)) return;
        state.pasteStartedAt = performance.now();
        state.setPhase('paste');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          state.pasteFirstDoubleRaf = performance.now() - state.pasteStartedAt;
        }));
      };
      const onPasteEnd = (event) => {
        if (!hasPlainText(event) || state.pasteStartedAt === null) return;
        state.pasteHandlerDuration = performance.now() - state.pasteStartedAt;
        state.setPhase('paste-deferred');
        scheduleSettlement();
      };
      surface.addEventListener('paste', onPaste, true);
      surface.addEventListener('paste', onPasteEnd);
      state.dispose = () => {
        surface.removeEventListener('paste', onPaste, true);
        surface.removeEventListener('paste', onPasteEnd);
        mutationObserver.disconnect();
        longTaskObserver.disconnect();
      };
      window[key] = state;
    }, performanceKey);

    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await visualEditor.focus();
    await visualEditor.press('ControlOrMeta+End');
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, syntheticPaste);
    await page.keyboard.press('ControlOrMeta+V');
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteFirstDoubleRaf, performanceKey),
      { timeout: 30_000, message: 'dense paste should reach its first double-rAF' }
    ).not.toBeNull();
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteSettledAt, performanceKey),
      { timeout: 30_000, message: 'dense Preview should reach editable readiness' }
    ).not.toBeNull();
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
      timeout: 30_000
    });
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
      timeout: 30_000
    });
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(
      () => previewRequests.length,
      { timeout: 30_000, message: 'dense paste should issue one Preview request' }
    ).toBe(baselinePreviewRequestCount + 1);
    await expect.poll(
      () => previewResponses.length,
      { timeout: 30_000, message: 'dense Preview response should be received' }
    ).toBe(baselinePreviewResponseCount + 1);
    expect(previewRequests.at(-1)).toEqual(expectedMarkdownEvidence);
    await expect(source).toHaveValue(expectedMarkdown);

    const response = await previewResponses.at(-1).json();
    expect(response.editMap?.blocks).toHaveLength(syntheticDensePreviewRootCount + 1);
    expect(typeof response.html).toBe('string');
    expect((response.html.match(/<pre\b/g) ?? []).length)
      .toBeGreaterThanOrEqual(syntheticDenseCodeBlockCount);

    const pasteToSettled = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state || state.pasteStartedAt === null || state.pasteSettledAt === null) {
        throw new Error('immersive-dense-paste-performance-state-missing');
      }
      return state.pasteSettledAt - state.pasteStartedAt;
    }, performanceKey);
    expect(pasteToSettled).toBeLessThanOrEqual(syntheticDensePasteSettledLimitMs);

    const performanceEvidence = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-dense-paste-performance-state-missing');
      for (const entry of state.longTaskObserver?.takeRecords?.() ?? []) {
        if (
          state.longTaskObservationStartedAt !== null
          && entry.startTime >= state.longTaskObservationStartedAt
          && entry.duration > 50
        ) {
          state.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
      const tasks = state.longTasks
        .filter(({ startTime, duration }) => (
          startTime < state.pasteSettledAt
          && startTime + duration > state.pasteStartedAt
        ))
        .map(({ startTime, duration }) => {
          const transition = [...state.transitions]
            .reverse()
            .find(({ at }) => at <= startTime);
          const overlapsPasteStart = startTime < state.pasteStartedAt
            && startTime + duration > state.pasteStartedAt;
          return {
            duration,
            offset: Math.round(startTime - state.pasteStartedAt),
            phase: overlapsPasteStart
              ? 'paste-activation'
              : transition?.phase ?? state.phase
          };
        });
      const evidence = {
        longTasks: tasks,
        pasteFirstDoubleRaf: state.pasteFirstDoubleRaf,
        pasteHandlerDuration: state.pasteHandlerDuration,
        pasteSettledAt: state.pasteSettledAt,
        pasteStartedAt: state.pasteStartedAt
      };
      state.dispose();
      delete window[key];
      return evidence;
    }, performanceKey);
    expect(performanceEvidence.pasteHandlerDuration).toBeLessThan(50);
    expect(performanceEvidence.pasteFirstDoubleRaf).toBeLessThanOrEqual(100);
    const activationTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'paste-activation'
    );
    const previewTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'preview-response'
    );
    const unexpectedTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => ![
        'paste-activation',
        'preview-response'
      ].includes(phase)
    );
    const totalBlockingTime = (tasks) => tasks.reduce(
      (total, { duration }) => total + Math.max(0, duration - 50),
      0
    );
    const activationBlockingTimeMs = totalBlockingTime(activationTasks);
    const previewBlockingTimeMs = totalBlockingTime(previewTasks);
    const combinedBlockingTimeMs = activationBlockingTimeMs + previewBlockingTimeMs;
    await testInfo.attach('immersive-synthetic-dense-preview-performance', {
      body: JSON.stringify({
        document: expectedMarkdownEvidence,
        longTasks: performanceEvidence.longTasks,
        activationTaskCount: activationTasks.length,
        activationTaskCountLimit: syntheticLargePasteActivationTaskCountLimit,
        activationTasks,
        activationBlockingTimeMs,
        activationBlockingTimeLimitMs: syntheticLargePasteActivationTotalBlockingTimeLimitMs,
        previewTaskCount: previewTasks.length,
        previewTaskCountLimit: syntheticLargePreviewLayoutTaskCountLimit,
        previewTasks,
        previewBlockingTimeMs,
        previewBlockingTimeLimitMs: syntheticLargePreviewTotalBlockingTimeLimitMs,
        combinedBlockingTimeMs,
        combinedBlockingTimeLimitMs: syntheticLargePasteTotalBlockingTimeLimitMs,
        unexpectedTasks,
        pasteFirstDoubleRaf: performanceEvidence.pasteFirstDoubleRaf,
        pasteHandlerDuration: performanceEvidence.pasteHandlerDuration,
        pasteToSettled,
        pasteSettledLimit: syntheticDensePasteSettledLimitMs,
        previewRootBlocks: response.editMap.blocks.length,
        previewCodeBlocks: (response.html.match(/<pre\b/g) ?? []).length,
        previewTaskDurationLimit: syntheticLargePreviewLayoutTaskLimitMs
      }),
      contentType: 'application/json'
    });
    expect(unexpectedTasks, JSON.stringify(unexpectedTasks)).toEqual([]);
    expect(
      activationTasks.length,
      JSON.stringify(activationTasks)
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTaskCountLimit);
    expect(
      activationBlockingTimeMs,
      JSON.stringify(activationTasks)
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTotalBlockingTimeLimitMs);
    expect(previewTasks.length, JSON.stringify(previewTasks))
      .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskCountLimit);
    expect(previewBlockingTimeMs, JSON.stringify(previewTasks))
      .toBeLessThanOrEqual(syntheticLargePreviewTotalBlockingTimeLimitMs);
    expect(combinedBlockingTimeMs, JSON.stringify({
      activationTasks,
      previewTasks
    })).toBeLessThanOrEqual(syntheticLargePasteTotalBlockingTimeLimitMs);
    for (const task of [...activationTasks, ...previewTasks]) {
      expect(task.duration, JSON.stringify(task))
        .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskLimitMs);
    }
    expect(browserFailures).toEqual([]);
  });
});
