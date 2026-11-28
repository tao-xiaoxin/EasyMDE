import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES } from "./hidden-context.mjs";
import { armStageBReadyGeometryProbe } from "./stage-b-geometry.mjs";
import { awaitStageBPrepareWithinBound } from "./source-only-case.mjs";
import { cancelAndAwaitStageBPrepare } from "./source-only-case.mjs";
import { collectSourceOnlyNodeGraph } from "./stage-b-geometry.mjs";
import { collectSourceOnlyPotentialBox } from "./stage-b-geometry.mjs";
import { completeSourceOnlyCdpEvidence } from "./stage-b-geometry.mjs";
import { createHiddenContextComparator } from "./hidden-context.mjs";
import { freezeSourceOnlyCleanup } from "./stage-b-geometry.mjs";
import { freezeSourceOnlyPrimary } from "./stage-b-geometry.mjs";
import { geometryQuantum } from "./environment.mjs";
import { previewSelector } from "./environment.mjs";
import { runSourceOnlyCdpCleanup } from "./stage-b-geometry.mjs";
import { runSourceOnlyCleanupContract } from "./stage-b-geometry.mjs";
import { runSourceOnlyImageReadinessContract } from "./image-readiness.mjs";
import { settleAcceptedPreviewReadiness } from "./image-readiness.mjs";
import { stageBCompareInventory } from "./stage-b-geometry.mjs";
import { stageBExactBeforeTranslation } from "./stage-b-geometry.mjs";
import { stageBInputWidthDelta } from "./stage-b-geometry.mjs";
import { stageBResolveOutcome } from "./stage-b-case.mjs";
import { stageBSourceGuardSummary } from "./stage-b-case.mjs";
import { stageBSurfaceUnchangedExcept } from "./stage-b-geometry.mjs";
import { validateLocalDiagnosticPrerequisites } from "./local-diagnostics.mjs";

test.describe('Source-only CDP CPU contracts', () => {
  test('accepts a container WordPress path through the configured CLI wrapper', () => {
    const calls = [];
    validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '/var/www/html',
      wpCliValue: 'easymde-wpcli-wrapper',
      spawnSyncRef: (command, args) => {
        calls.push({ args, command });
        return { error: null, status: 0 };
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('easymde-wpcli-wrapper');
    expect(calls[0].args).toEqual([
      'core',
      'is-installed',
      '--path=/var/www/html',
      '--allow-root'
    ]);
  });

  test('rejects a missing WordPress path before invoking the configured CLI', () => {
    let invocationCount = 0;
    expect(() => validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '',
      wpCliValue: 'easymde-wpcli-wrapper',
      spawnSyncRef: () => {
        invocationCount += 1;
        return { error: null, status: 0 };
      }
    })).toThrow('wechat-task-context-wp-path-missing');
    expect(invocationCount).toBe(0);
  });

  test('rejects a missing WordPress CLI before invoking the configured owner', () => {
    let invocationCount = 0;
    expect(() => validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '/var/www/html',
      wpCliValue: ' ',
      spawnSyncRef: () => {
        invocationCount += 1;
        return { error: null, status: 0 };
      }
    })).toThrow('wechat-task-context-wp-cli-missing');
    expect(invocationCount).toBe(0);
  });

  test('scopes hidden layout representations while retaining visible style and geometry negatives', () => {
    const entry = (propertyName, raw, category = 'other') => ({
      category,
      enumValue: null,
      numeric: null,
      propertyName,
      raw
    });
    const surface = ({
      contentWidth = 335.5,
      inputStyle = [],
      liStyle = [],
      beforeStyle = [],
      afterStyle = []
    } = {}) => ({
      inputs: [{
        index: 0,
        li: { bottom: 36, height: 36, left: 0, right: 306.5, top: 0, width: 306.5 },
        liStyle,
        pseudo: { after: afterStyle, before: beforeStyle },
        rect: { bottom: 20.8, height: 20.8, left: 0, right: 20.8, top: 0, width: 20.8 },
        style: inputStyle,
        textAnchor: null
      }],
      root: { contentWidth, style: [] }
    });
    const originEntry = (raw) => entry('transform-origin', raw, 'transform-origin');
    const transformEntry = (raw) => entry('transform', raw, 'transform');
    const comparatorSource = createHiddenContextComparator.toString();
    const comparatorFactory = vm.runInNewContext(`(${comparatorSource})`);
    const comparator = comparatorFactory(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    const hiddenPercent = {
      measurement: surface({
        inputStyle: [originEntry('10.3984px 10.3984px')],
        liStyle: [entry('width', '306.5px', 'px')],
        beforeStyle: [originEntry('10.3984px 10.3984px')]
      }),
      source: surface({
        inputStyle: [originEntry('50% 50%')],
        liStyle: [entry('width', '100%', '%')],
        beforeStyle: [originEntry('50% 50%')]
      })
    };
    const hiddenUsedPixels = {
      measurement: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] }),
      source: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] })
    };
    const visibleOriginChange = {
      measurement: surface({ inputStyle: [originEntry('10.5px 10.5px')] }),
      source: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] })
    };
    const visibleTransformChange = {
      measurement: surface({ inputStyle: [transformEntry('matrix(1, 0, 0, 1, 1, 0)')] }),
      source: surface({ inputStyle: [transformEntry('none')] })
    };
    const visibleGeometryChange = {
      measurement: surface({ contentWidth: 335.5 + (geometryQuantum * 2) }),
      source: surface()
    };
    const assertComparatorContract = (candidate) => {
      expect(candidate.firstStyleDifferenceForSurfaces(
        hiddenPercent.source,
        hiddenPercent.measurement,
        true
      )).toBeNull();
      expect(candidate.firstStyleDifferenceForSurfaces(
        hiddenUsedPixels.source,
        hiddenUsedPixels.measurement,
        true
      )).toBeNull();
      expect(candidate.firstStyleDifferenceForSurfaces(
        visibleOriginChange.source,
        visibleOriginChange.measurement
      )).toMatchObject({ ownerKind: 'input', propertyName: 'transform-origin' });
      expect(candidate.firstStyleDifferenceForSurfaces(
        visibleTransformChange.source,
        visibleTransformChange.measurement
      )).toMatchObject({ ownerKind: 'input', propertyName: 'transform' });
      expect(candidate.firstGeometryDifferenceForSurfaces(
        visibleGeometryChange.source,
        visibleGeometryChange.measurement
      )).toMatchObject({ ownerKind: 'root', propertyName: 'contentWidth.width' });
    };
    assertComparatorContract(comparator);

    const styleMutationSource = comparatorSource.replace(
      /const styleEntryEqual = \(sourceEntry, measurementEntry\) => \(?\s*Boolean\(measurementEntry\) && valuesEqual\(sourceEntry, measurementEntry\)\s*\)?;/u,
      'const styleEntryEqual = () => true;'
    );
    expect(styleMutationSource).not.toBe(comparatorSource);
    const styleMutation = vm.runInNewContext(`(${styleMutationSource})`)(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    expect(styleMutation.firstStyleDifferenceForSurfaces(
      visibleOriginChange.source,
      visibleOriginChange.measurement
    )).toBeNull();
    expect(() => assertComparatorContract(styleMutation)).toThrow();

    const geometryMutationSource = comparatorSource.replace(
      'if (!Number.isFinite(delta) || delta > geometryQuantum) {',
      'if (false) {'
    );
    expect(geometryMutationSource).not.toBe(comparatorSource);
    const geometryMutation = vm.runInNewContext(`(${geometryMutationSource})`)(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    expect(geometryMutation.firstGeometryDifferenceForSurfaces(
      visibleGeometryChange.source,
      visibleGeometryChange.measurement
    )).toBeNull();
    expect(() => assertComparatorContract(geometryMutation)).toThrow();
  });

  const image = (options = {}) => {
    const listeners = new Map([['error', new Set()], ['load', new Set()]]);
    const value = {
      complete: options.complete === true,
      decode: options.decode,
      naturalHeight: options.naturalHeight ?? 0,
      naturalWidth: options.naturalWidth ?? 0,
      addEventListener(type, listener) {
        listeners.get(type)?.add(listener);
      },
      dispatch(type) {
        [...(listeners.get(type) ?? [])].forEach((listener) => listener());
      },
      listenerCount(type) {
        return listeners.get(type)?.size ?? 0;
      },
      removeEventListener(type, listener) {
        options.removeAttempts?.push(type);
        if (options.throwOnRemove?.includes(type)) throw new Error('synthetic');
        listeners.get(type)?.delete(listener);
      }
    };
    return value;
  };

  const readinessOptions = (imageValue, overrides = {}) => {
    const root = {};
    let currentRoot = root;
    let currentImages = [imageValue];
    return {
      getCurrentImages: () => currentImages,
      getCurrentRoot: () => currentRoot,
      images: [imageValue],
      expectedRoot: root,
      observeTarget: {},
      setCurrentImages: (value) => { currentImages = value; },
      setCurrentRoot: (value) => { currentRoot = value; },
      ...overrides
    };
  };
  const expectReadinessFailure = (pending, primaryCode, cleanupCode = null) => (
    expect(pending).rejects.toEqual({ cleanupCode, primaryCode, status: 'failed' })
  );

  const stageBGeometry = (left = 0, top = 0, width = 2, height = 1) => ({
    border: [left, top, left + width, top, left + width, top + height, left, top + height],
    content: [left, top, left + width, top, left + width, top + height, left, top + height],
    quads: [[left, top, left + width, top, left + width, top + height, left, top + height]]
  });
  const stageBInventory = (beforeLeft = 0, inputWidth = 2) => ({
    beforeCount: 1,
    checkedCount: 1,
    checkedVector: [true],
    graph: [{
      backendNodeId: 1,
      controlIndex: 0,
      edgeKind: 'root',
      localIndex: 0,
      nodeName: 'INPUT',
      nodeType: 1,
      parentIndex: null,
      pseudoType: null
    }],
    inputCount: 1,
    inputs: [{
      before: { geometry: stageBGeometry(beforeLeft, 0, 1, 1), status: 'ready' },
      checked: true,
      fragments: [{ bottom: 1, height: 1, left: 0, right: 10, top: 0, width: 10 }],
      index: 0,
      inputGeometry: stageBGeometry(0, 0, inputWidth, 1),
      liGeometry: stageBGeometry(0, 0, 20, 10),
      parentFragments: [{ bottom: 10, height: 10, left: 0, right: 20, top: 0, width: 20 }],
      parentListGeometry: stageBGeometry(0, 0, 20, 10)
    }],
    rootWidth: 20,
    status: 'ready'
  });

  test('image readiness removes listeners after a successful load', async () => {
    const sourceImage = image();
    const options = readinessOptions(sourceImage);
    const pending = runSourceOnlyImageReadinessContract(options);
    expect(sourceImage.listenerCount('load')).toBe(1);
    expect(sourceImage.listenerCount('error')).toBe(1);
    sourceImage.complete = true;
    sourceImage.naturalWidth = 2;
    sourceImage.naturalHeight = 1;
    sourceImage.dispatch('load');
    await expect(pending).resolves.toBeUndefined();
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rejects complete images without intrinsic dimensions and cleans listeners', async () => {
    const sourceImage = image({ complete: true });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable'
    );
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness preserves primary and independent cleanup failures', async () => {
    const removeAttempts = [];
    const sourceImage = image({
      complete: true,
      naturalHeight: 0,
      naturalWidth: 0,
      removeAttempts,
      throwOnRemove: ['load']
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
      'wechat-task-context-source-only-image-readiness-cleanup-failed'
    );
    expect(removeAttempts).toEqual(['load', 'error']);
    expect(sourceImage.listenerCount('load')).toBe(1);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness preserves the first load/error outcome and cleans listeners', async () => {
    let releaseDecode;
    const sourceImage = image({
      decode: () => new Promise((resolve) => { releaseDecode = resolve; })
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    sourceImage.complete = true;
    sourceImage.naturalWidth = 2;
    sourceImage.naturalHeight = 1;
    sourceImage.dispatch('load');
    sourceImage.dispatch('error');
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-error'
    );
    releaseDecode?.();
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness maps decode rejection and removes listeners', async () => {
    const sourceImage = image({
      complete: true,
      decode: () => Promise.reject(new Error('synthetic')),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-decode-failed'
    );
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rechecks every image before resolving', async () => {
    let releaseFirst;
    let releaseSecond;
    const firstImage = image({
      complete: true,
      decode: () => new Promise((resolve) => { releaseFirst = resolve; }),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const secondImage = image({
      complete: true,
      decode: () => new Promise((resolve) => { releaseSecond = resolve; }),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const options = readinessOptions(firstImage, {
      getCurrentImages: () => [firstImage, secondImage],
      images: [firstImage, secondImage]
    });
    const pending = runSourceOnlyImageReadinessContract(options);
    await Promise.resolve();
    expect(releaseFirst).toEqual(expect.any(Function));
    expect(releaseSecond).toEqual(expect.any(Function));
    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    firstImage.complete = false;
    firstImage.naturalWidth = 0;
    firstImage.naturalHeight = 0;
    releaseSecond();
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable'
    );
    expect(firstImage.listenerCount('load')).toBe(0);
    expect(firstImage.listenerCount('error')).toBe(0);
    expect(secondImage.listenerCount('load')).toBe(0);
    expect(secondImage.listenerCount('error')).toBe(0);
  });

  test('image readiness has a bounded timeout and removes listeners', async () => {
    const sourceImage = image();
    let timerCallback;
    let clearCount = 0;
    const pending = runSourceOnlyImageReadinessContract({
      ...readinessOptions(sourceImage),
      clearTimeoutRef: () => { clearCount += 1; },
      setTimeoutRef: (callback) => {
        timerCallback = callback;
        return 1;
      }
    });
    timerCallback();
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-timeout'
    );
    expect(clearCount).toBe(1);
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rejects root and image-set replacement and disconnects observers', async () => {
    let trigger;
    let disconnectCount = 0;
    class MutationObserverFake {
      constructor(callback) {
        trigger = callback;
      }

      disconnect() {
        disconnectCount += 1;
      }

      observe() {}
    }
    const sourceImage = image();
    const rootOptions = readinessOptions(sourceImage);
    const rootPending = runSourceOnlyImageReadinessContract({
      ...rootOptions,
      MutationObserverRef: MutationObserverFake
    });
    rootOptions.setCurrentRoot({});
    trigger();
    await expectReadinessFailure(
      rootPending,
      'wechat-task-context-source-only-image-readiness-root-changed'
    );

    const replacementImage = image();
    const imageOptions = readinessOptions(replacementImage);
    const imagePending = runSourceOnlyImageReadinessContract({
      ...imageOptions,
      MutationObserverRef: MutationObserverFake
    });
    imageOptions.setCurrentImages([image()]);
    trigger();
    await expectReadinessFailure(
      imagePending,
      'wechat-task-context-source-only-image-readiness-image-set-changed'
    );
    expect(disconnectCount).toBe(2);
  });

  test('StageB comparator reports valid M-only before mismatch without fallback', () => {
    const source = stageBInventory();
    const perturbed = stageBInventory(2.5);
    const comparison = stageBCompareInventory(source, perturbed);
    expect(comparison.status).toBe('failed');
    expect(stageBSurfaceUnchangedExcept(source, perturbed, new Set(['before']))).toBe(true);
    expect(stageBExactBeforeTranslation(source, perturbed)).toBe(true);
  });

  test('StageB comparator reports missing geometry as unavailable', () => {
    const source = stageBInventory();
    const missing = { ...stageBInventory(), status: 'unavailable' };
    expect(stageBCompareInventory(source, missing)).toEqual({
      code: 'wechat-task-context-stage-b-inventory-unavailable',
      status: 'unavailable'
    });
    expect(stageBInputWidthDelta(source, stageBInventory(0, 26))).toBe(24);
  });

  test('StageB comparator uses only the actual mapped subset', () => {
    const source = stageBInventory();
    const measurement = stageBInventory();
    source.inputs[0].backendNodeId = 11;
    measurement.inputs[0].backendNodeId = 22;
    measurement.rootWidth = 99;
    measurement.graph = [
      ...measurement.graph,
      {
        backendNodeId: 23,
        controlIndex: null,
        edgeKind: 'children',
        localIndex: 0,
        nodeName: 'DIV',
        nodeType: 1,
        parentIndex: 0,
        pseudoType: null
      }
    ];
    const comparison = stageBCompareInventory(source, measurement, {
      mappedSourceIndexes: [0],
      mappings: [{
        measurementBackendNodeId: 22,
        sourceBackendNodeId: 11,
        sourceIndex: 0
      }],
      status: 'ready',
      unmappedSourceIndexes: []
    });
    expect(comparison.status).toBe('ready');
    expect(comparison.graphSame).toBeNull();
    expect(comparison.rootWidthSame).toBeNull();
    expect(comparison.mappedCount).toBe(1);
    expect(stageBCompareInventory(source, measurement, {
      mappings: [],
      status: 'ready'
    }).status).toBe('unavailable');
  });

  test('StageB outcome fails an observed source contradiction beside capability unavailability', () => {
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-stage-b-mapping-unavailable'
    );
    const sourceEvidence = {
      actualCssSame: false,
      checkedVectorSame: true,
      final: {
        accepted: '1',
        inputCount: 19,
        rendered: { actualCss: { root: { height: 101 } } }
      },
      initial: {
        accepted: '1',
        inputCount: 19,
        rendered: { actualCss: { root: { height: 100 } } }
      },
      mutations: { records: 0 },
      renderedSame: true,
      resourceReadinessSame: true,
      rootSame: true,
      signatureSame: true,
      source0Mutations: { records: 0 },
      source0Same: true
    };
    const sourceSummary = stageBSourceGuardSummary(sourceEvidence);
    expect(sourceSummary.sourceGuardStatus).toBe('failed');
    const sourceGuard = freezeSourceOnlyPrimary(
      'failed',
      'wechat-task-context-stage-b-source-guard-mismatch'
    );
    const outcome = stageBResolveOutcome(primary, sourceGuard, {
      cleanupCodes: [],
      status: 'success'
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe(sourceGuard.code);
    expect(outcome.sourceGuard).toBe(sourceGuard);
    expect(primary).toEqual({
      code: 'wechat-task-context-stage-b-mapping-unavailable',
      status: 'unavailable'
    });
  });

  test('StageB probe retains and reports a late pause after timeout', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 5);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 20, pauseTimeoutMs: 1 }
    );
    const observation = await probe.observe({});
    expect(observation.result.code).toBe('wechat-task-context-cdp-guard-frame-unavailable');
    expect(probe.latePauseObserved()).toBe(true);
    expect(calls.filter((method) => method === 'Debugger.removeBreakpoint')).toHaveLength(1);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    probe.dispose();
  });

  test('StageB probe preserves a resume failure after an actual pause', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 0);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        if (method === 'Debugger.resume' || method === 'Debugger.disable') throw new Error('synthetic');
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 20, pauseTimeoutMs: 20 }
    );
    await probe.observe({});
    expect(probe.resumeSucceeded()).toBe(false);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    expect(calls.filter((method) => method === 'Debugger.disable')).toHaveLength(1);
    expect(await probe.resumeOnce()).toBe(false);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    probe.dispose();
  });

  test('StageB probe records safe debugger termination after a grace-external pause', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 20);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 1, pauseTimeoutMs: 1 }
    );
    const observation = await probe.observe({});
    expect(observation.result.code).toBe('wechat-task-context-stage-b-pause-timeout');
    expect(probe.latePauseObserved()).toBe(false);
    expect(probe.resumeSucceeded()).toBe(true);
    expect(probe.termination()).toEqual({
      attempted: true,
      kind: 'disable',
      succeeded: true
    });
    expect(calls.filter((method) => method === 'Debugger.disable')).toHaveLength(1);
    probe.dispose();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  test('StageB prepare timeout remains unsettled and reports its bounded code', async () => {
    const wait = await awaitStageBPrepareWithinBound(
      new Promise(() => {}),
      'wechat-task-context-stage-b-default-prepare-timeout',
      1
    );
    expect(wait).toEqual({
      outcome: {
        code: 'wechat-task-context-stage-b-default-prepare-timeout',
        status: 'unavailable'
      },
      settled: false
    });
  });

  test('StageB cancellation consumer awaits the real prepare terminal result', async () => {
    let settlePrepare;
    let cancelCalls = 0;
    const operation = new Promise((resolve) => { settlePrepare = resolve; });
    const cancellation = await cancelAndAwaitStageBPrepare(
      operation,
      async () => {
        cancelCalls += 1;
        settlePrepare({
          code: 'wechat-task-context-stage-b-prepare-cancelled',
          status: 'failed'
        });
        return true;
      },
      'wechat-task-context-stage-b-default-prepare-terminal-timeout',
      20
    );
    expect(cancelCalls).toBe(1);
    expect(cancellation).toEqual({
      cancelRequested: true,
      terminal: {
        outcome: {
          code: 'wechat-task-context-stage-b-prepare-cancelled',
          status: 'failed'
        },
        settled: true
      }
    });
  });

  test('StageB cancellation preserves an unresolved prepare timeout', async () => {
    const cancellation = await cancelAndAwaitStageBPrepare(
      new Promise(() => {}),
      async () => true,
      'wechat-task-context-stage-b-default-prepare-terminal-timeout',
      1
    );
    expect(cancellation).toEqual({
      cancelRequested: true,
      terminal: {
        outcome: {
          code: 'wechat-task-context-stage-b-default-prepare-terminal-timeout',
          status: 'unavailable'
        },
        settled: false
      }
    });
  });

  test('settle transports structured image readiness failures without error decoration', async () => {
    const page = {
      evaluate: async () => ({
        cleanupCode: 'wechat-task-context-source-only-image-readiness-cleanup-failed',
        primaryCode: 'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
        status: 'failed'
      })
    };
    await expect(
      settleAcceptedPreviewReadiness(page, previewSelector, true)
    ).rejects.toThrow(
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable;cleanup=wechat-task-context-source-only-image-readiness-cleanup-failed'
    );
  });

  test('preserves reference failure and release failure independently', async () => {
    const primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-source-only-reference-failed');
    const result = await runSourceOnlyCleanupContract(primary, {
      release: async () => {
        throw new Error('wechat-task-context-source-only-release-failed');
      }
    });
    expect(result.primary).toBe(primary);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanup.release.code).toBe('wechat-task-context-source-only-release-failed');
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.attempts).toEqual({ restore: 0, release: 1, resume: 0, detach: 0 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.resume).toBeUndefined();
    expect(result.cleanup.detach).toBeUndefined();
    expect(Object.isFrozen(primary)).toBe(true);
  });

  test('collector cleanup preserves inventory when release resolves false', async () => {
    const primaryResult = {
      code: null,
      inputCount: 19,
      nodes: [{ nodeName: 'INPUT', nodeType: 1 }],
      runtime: { product: 'synthetic', protocolVersion: '1.0' },
      status: 'ready'
    };
    const primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-source-only-ready');
    const events = [];
    const cdp = {
      detach: async () => {
        events.push('detach');
      }
    };
    const contract = await runSourceOnlyCdpCleanup(
      primary,
      cdp,
      'synthetic-root',
      async () => {
        events.push('release-start');
        await Promise.resolve();
        events.push('release-settled');
        return false;
      }
    );
    const result = completeSourceOnlyCdpEvidence(primaryResult, contract, primaryResult.runtime);
    expect(events).toEqual(['release-start', 'release-settled', 'detach']);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.primary).toBe(primary);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.cleanup.release.status).toBe('failed');
    expect(result.inputCount).toBe(19);
    expect(result.nodes).toBe(primaryResult.nodes);
  });

  test('collector cleanup preserves inventory when release rejects', async () => {
    const primaryResult = {
      code: 'wechat-task-context-source-only-collector-incomplete',
      inputCount: 19,
      nodes: [{ nodeName: 'INPUT', nodeType: 1 }],
      runtime: { product: 'synthetic', protocolVersion: '1.0' },
      status: 'unavailable'
    };
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-source-only-collector-incomplete'
    );
    const cdp = { detach: async () => undefined };
    const contract = await runSourceOnlyCdpCleanup(
      primary,
      cdp,
      'synthetic-root',
      async () => Promise.reject(new Error('wechat-task-context-source-only-release-failed'))
    );
    const result = completeSourceOnlyCdpEvidence(primaryResult, contract, primaryResult.runtime);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.primary).toBe(primary);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.cleanup.release.status).toBe('failed');
    expect(result.inputCount).toBe(19);
    expect(result.nodes).toBe(primaryResult.nodes);
  });

  test('preserves comparator failure and resume failure independently', async () => {
    const primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-source-only-comparator-failed');
    const result = await runSourceOnlyCleanupContract(primary, {
      resume: async () => Promise.reject(
        new Error('wechat-task-context-source-only-resume-failed')
      )
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('wechat-task-context-source-only-comparator-failed');
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-resume-failed']);
    expect(result.cleanup.resume.status).toBe('failed');
    expect(result.attempts).toEqual({ restore: 0, release: 0, resume: 1, detach: 0 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.release).toBeUndefined();
    expect(result.cleanup.detach).toBeUndefined();
  });

  test('cleanup failure fails an unavailable primary and preserves both codes', async () => {
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-source-only-capability-unavailable'
    );
    const result = await runSourceOnlyCleanupContract(primary, {
      detach: async () => Promise.reject(
        new Error('wechat-task-context-source-only-detach-failed')
      )
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-detach-failed']);
    expect(result.cleanup.detach.status).toBe('failed');
    expect(result.attempts).toEqual({ restore: 0, release: 0, resume: 0, detach: 1 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.release).toBeUndefined();
    expect(result.cleanup.resume).toBeUndefined();
  });

  test('restore failure still attempts every cleanup step exactly once', async () => {
    const primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-source-only-ready');
    const order = [];
    const result = await runSourceOnlyCleanupContract(primary, {
      restore: async () => {
        order.push('restore');
        throw new Error('wechat-task-context-source-only-restore-failed');
      },
      release: async () => {
        order.push('release');
        return freezeSourceOnlyCleanup('success', null);
      },
      resume: async () => {
        order.push('resume');
        return freezeSourceOnlyCleanup('success', null);
      },
      detach: async () => {
        order.push('detach');
        return freezeSourceOnlyCleanup('success', null);
      }
    });
    expect(order).toEqual(['restore', 'release', 'resume', 'detach']);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-restore-failed']);
    expect(result.attempts).toEqual({ restore: 1, release: 1, resume: 1, detach: 1 });
    expect(result.primary).toBe(primary);
  });

  test('collects direct, shadow, and multiple pseudo graph edges without selecting a pseudo', async () => {
    const graph = collectSourceOnlyNodeGraph({
      children: [{
        children: [{ nodeName: 'INPUT', nodeType: 1, pseudoElements: [
          { nodeName: '::before', nodeType: 1, pseudoType: 'before' },
          { nodeName: '::after', nodeType: 1, pseudoType: 'after' }
        ] }],
        nodeName: 'DIV',
        nodeType: 1,
        shadowRoots: [{
          children: [{ nodeName: 'INPUT', nodeType: 1 }],
          nodeName: '#shadow-root',
          nodeType: 11
        }]
      }],
      nodeName: 'ARTICLE',
      nodeType: 1,
      pseudoElements: [{ nodeName: '::before', nodeType: 1, pseudoType: 'before' }]
    });
    const inputs = graph.filter(({ nodeName }) => nodeName === 'INPUT');
    const pseudos = graph.filter(({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::'));
    const shadowRootIndex = graph.findIndex(({ nodeName }) => nodeName === '#shadow-root');
    expect(inputs).toHaveLength(2);
    expect(inputs.map(({ controlIndex }) => controlIndex)).toEqual([0, 1]);
    expect(shadowRootIndex).toBeGreaterThanOrEqual(0);
    expect(inputs.some(({ parentIndex }) => parentIndex === shadowRootIndex)).toBe(true);
    expect(pseudos.filter(({ edgeKind }) => edgeKind === 'pseudoElements')).toHaveLength(3);
    expect(pseudos.every(({ controlIndex }) => controlIndex === null)).toBe(true);
    expect(graph.every(({ nodeValue, attributes, outerHTML }) => (
      nodeValue === undefined && attributes === undefined && outerHTML === undefined
    ))).toBe(true);
  });

  test('classifies finite, empty, and rejected potential boxes without platform fallback', async () => {
    const finite = await collectSourceOnlyPotentialBox({
      send: async (method) => method === 'DOM.getBoxModel'
        ? { model: { border: [0, 0, 1, 0, 1, 1, 0, 1], content: [0, 0, 1, 0, 1, 1, 0, 1] } }
        : { quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }
    }, { backendNodeId: 1 });
    const missing = await collectSourceOnlyPotentialBox({
      send: async (method) => {
        if (method === 'DOM.getBoxModel') throw new Error('synthetic');
        return { quads: [] };
      }
    }, { backendNodeId: 2 });
    expect(finite.boxModelStatus).toBe('finite');
    expect(finite.contentQuadsStatus).toBe('finite');
    expect(finite.contentQuads).toEqual([[0, 0, 1, 0, 1, 1, 0, 1]]);
    expect(missing.boxModelStatus).toBe('rejected');
    expect(missing.contentQuadsStatus).toBe('empty');
    expect(missing.contentQuads).toBeNull();
  });
});
