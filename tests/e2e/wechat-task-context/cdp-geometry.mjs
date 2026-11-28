import { chmod, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CDP_BLOOM_INPUT_MATRIX } from "./geometry-measures.mjs";
import { CDP_GEOMETRY_OFFSET_PX } from "./geometry-measures.mjs";
import { CDP_GEOMETRY_PAUSE_TIMEOUT_MS } from "./geometry-measures.mjs";
import { finite2dMatrix } from "./geometry-measures.mjs";
import { finiteQuad } from "./geometry-measures.mjs";
import { finiteRect } from "./geometry-measures.mjs";
import { fragmentDelta } from "./geometry-measures.mjs";
import { geometryGuardLineNumber } from "./geometry-measures.mjs";
import { geometryQuantum } from "./environment.mjs";
import { normalizedFragmentDelta } from "./geometry-measures.mjs";
import { normalizedGeometry } from "./geometry-measures.mjs";
import { numericDelta } from "./geometry-measures.mjs";
import { stableCdpCode } from "./geometry-measures.mjs";

export async function cdpRuntimeEvaluation(cdp, expression, options = {}) {
  try {
    const response = await cdp.send('Runtime.evaluate', {
      awaitPromise: false,
      expression,
      returnByValue: options.returnByValue ?? true
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (options.returnByValue === false) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

export async function cdpFrameEvaluation(cdp, callFrameId, expression, returnByValue = true) {
  try {
    const response = await cdp.send('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression,
      returnByValue,
      silent: true
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (!returnByValue) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

export async function cdpCallFunction(cdp, objectId, functionDeclaration, args = [], returnByValue = true) {
  try {
    const response = await cdp.send('Runtime.callFunctionOn', {
      arguments: args.map((value) => ({ value })),
      awaitPromise: false,
      functionDeclaration,
      objectId,
      returnByValue
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (!returnByValue) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

export async function releaseCdpObject(cdp, objectId) {
  if (!objectId) return true;
  try {
    await cdp.send('Runtime.releaseObject', { objectId });
    return true;
  } catch {
    return false;
  }
}

export async function describeCdpNode(cdp, objectId) {
  if (!objectId) return null;
  try {
    const response = await cdp.send('DOM.describeNode', {
      depth: -1,
      objectId,
      pierce: true
    });
    return response.node ?? null;
  } catch {
    return null;
  }
}

export function traverseCdpNode(root) {
  const nodes = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    nodes.push(node);
    stack.push(
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
      ...(node.pseudoElements ?? [])
    );
  }
  return nodes;
}

export function cdpBeforePseudo(node) {
  const stack = node ? [node] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (current.nodeName === 'INPUT') {
      const pseudo = (current.pseudoElements ?? []).find((candidate) => (
        candidate.pseudoType === 'before' || candidate.nodeName === '::before'
      ));
      if (pseudo) return pseudo;
    }
    stack.push(
      ...(current.children ?? []),
      ...(current.shadowRoots ?? []),
      ...(current.pseudoElements ?? [])
    );
  }
  return null;
}

export async function cdpNodeGeometry(cdp, node) {
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return null;
  try {
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId });
    const quads = await cdp.send('DOM.getContentQuads', { backendNodeId });
    if (
      !box.model
      || !finiteQuad(box.model.border)
      || !finiteQuad(box.model.content)
      || !Array.isArray(quads.quads)
      || !quads.quads.length
      || !quads.quads.every(finiteQuad)
    ) return null;
    return { border: box.model.border, content: box.model.content, quads: quads.quads };
  } catch {
    return null;
  }
}

export async function cdpAllTextFragments(cdp, objectId) {
  const result = await cdpCallFunction(cdp, objectId, `function() {
    const walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT);
    const fragments = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      fragments.push(...[...range.getClientRects()].map((rect) => ({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      })));
      textNode = walker.nextNode();
    }
    return fragments;
  }`);
  return result.ok
    && Array.isArray(result.value)
    && result.value.length > 0
    && result.value.every(finiteRect)
    ? result.value
    : null;
}

export async function captureCdpSourceReference(page, selector) {
  let cdp = null;
  const objectIds = [];
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    const root = await cdpRuntimeEvaluation(
      cdp,
      `document.querySelector(${JSON.stringify(selector)})`,
      { returnByValue: false }
    );
    if (!root.ok) return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
    objectIds.push(root.objectId);
    const input = await cdpCallFunction(
      cdp,
      root.objectId,
      `function() { return this.querySelector('input[type="checkbox"]'); }`,
      [],
      false
    );
    if (!input.ok) return { code: 'wechat-task-context-cdp-source-input-unavailable', status: 'unavailable' };
    objectIds.push(input.objectId);
    const li = await cdpCallFunction(
      cdp,
      input.objectId,
      `function() { return this.closest('li.task-list-item, li'); }`,
      [],
      false
    );
    if (!li.ok) return { code: 'wechat-task-context-cdp-source-li-unavailable', status: 'unavailable' };
    objectIds.push(li.objectId);
    const rootNode = await describeCdpNode(cdp, root.objectId);
    const inputNode = await describeCdpNode(cdp, input.objectId);
    const liNode = await describeCdpNode(cdp, li.objectId);
    const inputPseudo = cdpBeforePseudo(inputNode);
    const inputGeometry = await cdpNodeGeometry(cdp, inputNode);
    const inputPseudoGeometry = await cdpNodeGeometry(cdp, inputPseudo);
    const liGeometry = await cdpNodeGeometry(cdp, liNode);
    const fragments = await cdpAllTextFragments(cdp, li.objectId);
    if (
      !rootNode
      || !inputNode
      || !inputPseudo
      || !liNode
      || !inputGeometry
      || !inputPseudoGeometry
      || !liGeometry
      || !fragments
      || traverseCdpNode(rootNode).filter(({ nodeName }) => nodeName === 'INPUT').length !== 19
    ) return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
    return {
      fragments,
      inputIndex: 0,
      input: inputGeometry,
      li: liGeometry,
      pseudo: inputPseudoGeometry,
      status: 'ready',
      tree: {
        inputCount: 19,
        nodeCount: traverseCdpNode(rootNode).length,
        pseudoCount: traverseCdpNode(rootNode).filter(
          ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
        ).length
      }
    };
  } catch {
    return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
  } finally {
    if (cdp) {
      let cleanupCode = null;
      try {
        const released = await Promise.all(objectIds.map((objectId) => releaseCdpObject(cdp, objectId)));
        if (released.some((success) => !success)) {
          cleanupCode = 'wechat-task-context-cdp-source-reference-release-failed';
        }
      } catch {
        cleanupCode = 'wechat-task-context-cdp-source-reference-release-failed';
      }
      try {
        await cdp.detach();
      } catch {
        cleanupCode ??= 'wechat-task-context-cdp-source-reference-detach-failed';
      }
      if (cleanupCode) throw new Error(cleanupCode);
    }
  }
}

export async function exactGeometryClosure(cdp, pause, selector, expectedReference) {
  for (const frame of pause?.callFrames ?? []) {
    const names = new Set();
    for (const scope of frame.scopeChain ?? []) {
      if (!scope.object?.objectId) continue;
      try {
        const properties = await cdp.send('Runtime.getProperties', {
          accessorProperties: false,
          objectId: scope.object.objectId,
          ownProperties: true
        });
        for (const property of properties.result ?? []) names.add(property.name);
      } catch {
        return { code: 'wechat-task-context-cdp-scope-unavailable', status: 'unavailable' };
      }
    }
    if (!names.has('lease') || !names.has('sourceElement')) continue;
    const summary = await cdpFrameEvaluation(cdp, frame.callFrameId, `(() => {
      const leaseReady = lease.isReady() === true;
      const measurement = leaseReady ? lease.measurementFor(sourceElement) : null;
      const sourceRoot = lease.sourceRoot;
      const expectedSourceRoot = document.querySelector(${JSON.stringify(selector)});
      return {
        exactSourceIdentity: sourceElement instanceof HTMLInputElement
          && sourceElement.matches('input[type="checkbox"]')
          && sourceElement.isConnected
          && sourceRoot instanceof HTMLElement
          && sourceRoot.contains(sourceElement),
        leaseReady,
        measurementConnected: Boolean(measurement?.isConnected),
        measurementForSource: Boolean(measurement),
        reference: lease.sourceGeometryReference,
        referenceMatchesExpected: lease.sourceGeometryReference === ${JSON.stringify(expectedReference)},
        rootConnected: Boolean(lease.root?.isConnected),
        sourceMarkupPresent: typeof lease.sourceMarkup === 'string',
        sourceRootMatchesExpected: sourceRoot === expectedSourceRoot,
        sourceRootConnected: Boolean(sourceRoot?.isConnected),
        sourceIndex: sourceRoot instanceof HTMLElement
          ? [...sourceRoot.querySelectorAll('input[type="checkbox"]')].indexOf(sourceElement)
          : -1
      };
    })()`);
    if (!summary.ok || !summary.value) continue;
    const value = summary.value;
    if (
      value.leaseReady !== true
      || value.rootConnected !== true
      || value.sourceRootConnected !== true
      || value.measurementForSource !== true
      || value.measurementConnected !== true
      || value.sourceMarkupPresent !== true
    ) {
      return { code: 'wechat-task-context-cdp-closure-not-ready', status: 'unavailable' };
    }
    if (
      value.exactSourceIdentity !== true
      || value.referenceMatchesExpected !== true
      || value.sourceRootMatchesExpected !== true
      || value.sourceIndex < 0
    ) {
      return {
        code: 'wechat-task-context-cdp-source-identity-mismatch',
        status: 'failed',
        value
      };
    }
    const handles = {};
    for (const [name, expression] of Object.entries({
      measurement: 'lease.measurementFor(sourceElement)',
      measurementRoot: 'lease.root',
      source: 'sourceElement',
      sourceRoot: 'lease.sourceRoot'
    })) {
      const handle = await cdpFrameEvaluation(cdp, frame.callFrameId, expression, false);
      if (!handle.ok) return { code: 'wechat-task-context-cdp-closure-handles-unavailable', status: 'unavailable' };
      handles[name] = handle.objectId;
    }
    return {
      callFrameId: frame.callFrameId,
      handles,
      reference: value.reference,
      status: 'ready',
      value
    };
  }
  return { code: 'wechat-task-context-cdp-guard-frame-unavailable', status: 'unavailable' };
}

export async function middleLineInventory(cdp, sourceLiObjectId) {
  const result = await cdpCallFunction(cdp, sourceLiObjectId, `function() {
    const owner = [...this.children].find((child) => (
      child !== this.querySelector('input[type="checkbox"]')
      && !child.querySelector('input[type="checkbox"]')
      && child instanceof HTMLElement
      && ['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(getComputedStyle(child).display)
      && Boolean(child.textContent?.trim())
    ));
    if (!owner) return { status: 'unavailable' };
    const range = document.createRange();
    range.selectNodeContents(owner);
    const rects = [...range.getClientRects()];
    const middle = rects[Math.floor(rects.length / 2)];
    if (rects.length < 3 || !middle) return { status: 'unavailable' };
    return { lineCount: rects.length, status: 'ready' };
  }`);
  if (!result.ok || !result.value || result.value.status !== 'ready') {
    return { code: 'wechat-task-context-cdp-middle-line-unavailable', status: 'unavailable' };
  }
  return { lineCount: result.value.lineCount, status: 'ready' };
}

export async function exactGeometrySnapshot(cdp, closure, reference) {
  const handles = closure.handles;
  const nodes = {};
  for (const [name, objectId] of Object.entries(handles)) {
    nodes[name] = await describeCdpNode(cdp, objectId);
    if (!nodes[name]) return null;
  }
  const measurementPseudo = cdpBeforePseudo(nodes.measurement);
  if (!measurementPseudo || !reference.pseudo) return null;
  const geometry = {};
  for (const [name, node] of Object.entries({
    measurement: nodes.measurement,
    measurementPseudo
  })) {
    geometry[name] = await cdpNodeGeometry(cdp, node);
    if (!geometry[name]) return null;
  }
  const sourceLi = await cdpCallFunction(
    cdp,
    handles.source,
    `function() { return this.closest('li.task-list-item, li'); }`,
    [],
    false
  );
  const measurementLi = await cdpCallFunction(
    cdp,
    handles.measurement,
    `function() { return this.closest('li.task-list-item, li'); }`,
    [],
    false
  );
  if (!sourceLi.ok || !measurementLi.ok) return null;
  const sourceLiNode = await describeCdpNode(cdp, sourceLi.objectId);
  const measurementLiNode = await describeCdpNode(cdp, measurementLi.objectId);
  const measurementLiGeometry = await cdpNodeGeometry(cdp, measurementLiNode);
  const fragments = {
    measurement: await cdpAllTextFragments(cdp, measurementLi.objectId),
    source: reference.fragments
  };
  const sourceTree = nodes.sourceRoot;
  const measurementTree = nodes.measurementRoot;
  const sourceInputs = traverseCdpNode(sourceTree).filter(({ nodeName }) => nodeName === 'INPUT').length;
  const measurementInputs = traverseCdpNode(measurementTree).filter(({ nodeName }) => nodeName === 'INPUT').length;
  if (
    !sourceLiNode
    || !measurementLiGeometry
    || !fragments.source
    || !fragments.measurement
    || sourceInputs !== 19
    || measurementInputs !== 19
  ) return null;
  geometry.measurementLi = measurementLiGeometry;
  const measurementNormalized = normalizedGeometry(geometry.measurement, geometry.measurementLi);
  const referenceNormalized = normalizedGeometry(reference.input, reference.li);
  const measurementLiNormalized = normalizedGeometry(geometry.measurementLi, geometry.measurementLi);
  const referenceLiNormalized = normalizedGeometry(reference.li, reference.li);
  const referenceReady = Boolean(
    measurementNormalized
    && referenceNormalized
    && measurementLiNormalized
    && referenceLiNormalized
    && numericDelta(measurementNormalized.border, referenceNormalized.border) <= geometryQuantum
    && numericDelta(measurementNormalized.quads, referenceNormalized.quads) <= geometryQuantum
    && numericDelta(measurementLiNormalized.border, referenceLiNormalized.border) <= geometryQuantum
    && normalizedFragmentDelta(
      fragments.measurement,
      geometry.measurementLi,
      reference.fragments,
      reference.li
    ) <= geometryQuantum
  );
  return {
    fragments,
    geometry,
    referenceReady,
    tree: {
      measurementInputCount: measurementInputs,
      measurementNodeCount: traverseCdpNode(measurementTree).length,
      measurementPseudoCount: traverseCdpNode(measurementTree).filter(
        ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
      ).length,
      sourceInputCount: sourceInputs,
      sourceNodeCount: traverseCdpNode(sourceTree).length,
      sourcePseudoCount: traverseCdpNode(sourceTree).filter(
        ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
      ).length
    },
    sourceLiObjectId: sourceLi.objectId,
    measurementLiObjectId: measurementLi.objectId,
    measurementLiGeometry
  };
}

export async function releaseSnapshotHandles(cdp, snapshot) {
  if (!snapshot) return true;
  const released = await Promise.all([
    releaseCdpObject(cdp, snapshot.sourceLiObjectId),
    releaseCdpObject(cdp, snapshot.measurementLiObjectId)
  ]);
  return released.every(Boolean);
}

export async function installInputPerturbation(cdp, closure) {
  const measurementTransform = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function() { return getComputedStyle(this, '::before').transform; }`
  );
  if (!measurementTransform.ok || typeof measurementTransform.value !== 'string') return false;
  const installed = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function(measurementTransform) {
      const transform = measurementTransform === 'none'
        ? 'translateX(2.5px)'
        : 'translateX(2.5px) ' + measurementTransform;
      const style = this.ownerDocument.createElement('style');
      style.setAttribute('data-easymde-wechat-qa-geometry-style', '1');
      style.textContent = '.easymde-wechat-task-checkbox-measurement [data-easymde-wechat-qa-input-probe="1"]::before,'
        + '.easymde-wechat-preview-measurement [data-easymde-wechat-qa-input-probe="1"]::before'
        + '{transform:var(--easymde-wechat-qa-input-transform)!important;}';
      this.setAttribute('data-easymde-wechat-qa-input-probe', '1');
      this.style.setProperty('--easymde-wechat-qa-input-transform', transform);
      this.ownerDocument.head.appendChild(style);
      globalThis.__wechatTaskContextGeometryQaCleanup = () => {
        style.remove();
        this.style.removeProperty('--easymde-wechat-qa-input-transform');
        this.removeAttribute('data-easymde-wechat-qa-input-probe');
        delete globalThis.__wechatTaskContextGeometryQaCleanup;
      };
      return true;
    }`,
    [measurementTransform.value]
  );
  return installed.ok && installed.value === true;
}

export async function restoreInputPerturbation(cdp) {
  const result = await cdpRuntimeEvaluation(
    cdp,
    '(() => { const cleanup = globalThis.__wechatTaskContextGeometryQaCleanup; if (typeof cleanup !== "function") return false; cleanup(); return true; })()'
  );
  return result.ok && result.value === true;
}

export async function exactInputStyle(cdp, closure, scenario) {
  if (scenario.themeId === 'default') {
    const sourceResult = await cdpCallFunction(
      cdp,
      closure.handles.source,
      `function() {
        const pseudo = getComputedStyle(this, '::before');
        return {
          pseudoFloat: pseudo.float,
          pseudoPosition: pseudo.position,
          pseudoContentKind: /svg/i.test(pseudo.content) ? 'svg' : pseudo.content === 'none' ? 'none' : 'other'
        };
      }`
    );
    return sourceResult.ok && sourceResult.value ? sourceResult.value : null;
  }
  const measurementResult = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function() {
      const value = getComputedStyle(this).transform;
      const matrix = new DOMMatrixReadOnly(value === 'none'
        ? 'matrix(1, 0, 0, 1, 0, 0)'
        : value);
      return {
        is2D: matrix.is2D === true,
        values: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
      };
    }`
  );
  return measurementResult.ok && measurementResult.value
    ? { measurementTransform: measurementResult.value }
    : null;
}

export function geometryComparator(baseline, perturbed, restoredGeometry, sourceReference) {
  const pseudoBaseline = normalizedGeometry(baseline.geometry.measurementPseudo, baseline.measurementLiGeometry);
  const pseudoPerturbed = normalizedGeometry(perturbed.geometry.measurementPseudo, perturbed.measurementLiGeometry);
  const pseudoRestored = normalizedGeometry(restoredGeometry.geometry.measurementPseudo, restoredGeometry.measurementLiGeometry);
  const sourcePseudoReference = normalizedGeometry(sourceReference.pseudo, sourceReference.li);
  const inputBaseline = normalizedGeometry(baseline.geometry.measurement, baseline.measurementLiGeometry);
  const inputPerturbed = normalizedGeometry(perturbed.geometry.measurement, perturbed.measurementLiGeometry);
  const inputRestored = normalizedGeometry(restoredGeometry.geometry.measurement, restoredGeometry.measurementLiGeometry);
  if (!pseudoBaseline || !pseudoPerturbed || !pseudoRestored || !sourcePseudoReference || !inputBaseline || !inputPerturbed || !inputRestored) {
    return { red: false, status: 'unavailable' };
  }
  if (
    pseudoBaseline.quads.length !== pseudoPerturbed.quads.length
    || pseudoBaseline.quads.length !== pseudoRestored.quads.length
    || pseudoBaseline.quads.length !== sourcePseudoReference.quads.length
  ) return { red: false, status: 'contradiction' };
  const pseudoDelta = pseudoBaseline.quads.map((quad, index) => (
    quad.map((value, pointIndex) => pseudoPerturbed.quads[index][pointIndex] - value)
  ));
  const exactTranslation = pseudoDelta.length > 0 && pseudoDelta.every((quad) => (
    quad.every((value, index) => Math.abs(value - (index % 2 ? 0 : CDP_GEOMETRY_OFFSET_PX)) <= geometryQuantum)
  ));
  const sourceReferenceBaseline = numericDelta(
    pseudoBaseline.quads,
    sourcePseudoReference.quads
  ) <= geometryQuantum;
  const sourceReferencePerturbed = numericDelta(
    pseudoPerturbed.quads,
    sourcePseudoReference.quads
  ) > geometryQuantum;
  const sourceReferenceRestored = numericDelta(
    pseudoRestored.quads,
    sourcePseudoReference.quads
  ) <= geometryQuantum;
  const inputUnchanged = numericDelta(inputBaseline.border, inputPerturbed.border) <= geometryQuantum
    && numericDelta(inputBaseline.quads, inputPerturbed.quads) <= geometryQuantum;
  const liUnchanged = numericDelta(
    baseline.measurementLiGeometry.border,
    perturbed.measurementLiGeometry.border
  ) <= geometryQuantum;
  const fragmentsUnchanged = fragmentDelta(baseline.fragments.measurement, perturbed.fragments.measurement) <= geometryQuantum;
  const restoredOk = numericDelta(inputBaseline.border, inputRestored.border) <= geometryQuantum
    && numericDelta(inputBaseline.quads, inputRestored.quads) <= geometryQuantum
    && numericDelta(
      baseline.measurementLiGeometry.border,
      restoredGeometry.measurementLiGeometry.border
    ) <= geometryQuantum
    && numericDelta(pseudoBaseline.quads, pseudoRestored.quads) <= geometryQuantum
    && fragmentDelta(baseline.fragments.measurement, restoredGeometry.fragments.measurement) <= geometryQuantum;
  return {
    inputUnchanged,
    liUnchanged,
    fragmentsUnchanged,
    pseudoTranslation: exactTranslation,
    red: exactTranslation
      && inputUnchanged
      && liUnchanged
      && fragmentsUnchanged
      && sourceReferenceBaseline
      && sourceReferencePerturbed
      && sourceReferenceRestored,
    restored: restoredOk,
    sourceReferenceBaseline,
    sourceReferencePerturbed,
    sourceReferenceRestored,
    sourceUnchanged: sourceReferenceBaseline && sourceReferenceRestored,
    status: exactTranslation
      && inputUnchanged
      && liUnchanged
      && fragmentsUnchanged
      && sourceReferenceBaseline
      && sourceReferencePerturbed
      && sourceReferenceRestored
      && restoredOk
      ? 'ready'
      : 'contradiction'
  };
}

export async function armCdpGeometryProbe(page, moduleUrl, privateCode, sourceReference, scenario) {
  const lineNumber = geometryGuardLineNumber(privateCode);
  if (!Number.isInteger(lineNumber)) {
    return { code: 'wechat-task-context-cdp-geometry-guard-unavailable', status: 'unavailable' };
  }
  if (sourceReference?.status !== 'ready') {
    return {
      code: stableCdpCode(sourceReference?.code, 'wechat-task-context-cdp-source-reference-unavailable'),
      status: 'unavailable'
    };
  }
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Debugger.enable');
    const browser = page.context().browser();
    const browserVersion = typeof browser?.version === 'function' ? browser.version() : '';
    const protocol = await cdp.send('Browser.getVersion');
    if (!browserVersion || typeof protocol?.product !== 'string' || !protocol.product) {
      await cdp.detach();
      return { code: 'wechat-task-context-cdp-runtime-version-unavailable', status: 'unavailable' };
    }
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      columnNumber: 0,
      lineNumber,
      url: moduleUrl
    });
    const breakpointId = breakpoint.breakpointId;
    if (typeof breakpointId !== 'string' || !breakpointId) {
      await cdp.detach();
      return { code: 'wechat-task-context-cdp-breakpoint-unavailable', status: 'unavailable' };
    }
    let pauseResolve;
    let pauseTimer;
    let pauseReceived = false;
    let paused = false;
    let breakpointRemovalAttempted = false;
    let breakpointRemoved = false;
    let resumeAttempted = false;
    let resumeSucceeded = false;
    const pausePromise = new Promise((resolve) => { pauseResolve = resolve; });
    const onPaused = (event) => {
      if (pauseReceived) return;
      pauseReceived = true;
      paused = true;
      clearTimeout(pauseTimer);
      cdp.off('Debugger.paused', onPaused);
      pauseResolve({ event, paused: true, received: true });
    };
    cdp.on('Debugger.paused', onPaused);
    pauseTimer = setTimeout(() => {
      if (pauseReceived) return;
      pauseReceived = true;
      cdp.off('Debugger.paused', onPaused);
      pauseResolve({ event: null, paused: false, received: false });
    }, CDP_GEOMETRY_PAUSE_TIMEOUT_MS);
    const removeBreakpoint = async () => {
      if (breakpointRemovalAttempted) return breakpointRemoved;
      breakpointRemovalAttempted = true;
      try {
        await cdp.send('Debugger.removeBreakpoint', { breakpointId });
        breakpointRemoved = true;
        return true;
      } catch {
        return false;
      }
    };
    const resumeOnce = async () => {
      if (resumeAttempted) return resumeSucceeded;
      resumeAttempted = true;
      try {
        await cdp.send('Debugger.resume');
        resumeSucceeded = true;
        return true;
      } catch {
        return false;
      }
    };
    const runtime = { browserVersion, protocolProduct: protocol.product };
    return {
      async observe(selector) {
        const receipt = await pausePromise;
        if (!receipt.received || !receipt.event) {
          await removeBreakpoint();
          return { code: 'wechat-task-context-cdp-pause-timeout', runtime, status: 'unavailable' };
        }
        paused = receipt.paused === true;
        const hit = Array.isArray(receipt.event.hitBreakpoints)
          && receipt.event.hitBreakpoints.includes(breakpointId);
        let mutationInstalled = false;
        let restorationSucceeded = true;
        let baseline = null;
        let perturbed = null;
        let restored = null;
        let closure = null;
        let middleLine = null;
        let result = {
          code: hit ? 'wechat-task-context-cdp-unavailable' : 'wechat-task-context-cdp-unexpected-pause',
          runtime,
          status: 'unavailable'
        };
        try {
          if (!hit || !await removeBreakpoint()) {
            result.code = hit
              ? 'wechat-task-context-cdp-breakpoint-remove-failed'
              : 'wechat-task-context-cdp-unexpected-pause';
          } else {
            const expectedReference = scenario.surface === 'immersive-hidden' ? 'measurement' : 'source';
            closure = await exactGeometryClosure(cdp, receipt.event, selector, expectedReference);
            if (closure.status !== 'ready') {
              result.status = closure.status === 'failed' ? 'failed' : 'unavailable';
              result.code = stableCdpCode(closure.code);
            } else {
              const inputStyle = await exactInputStyle(cdp, closure, scenario);
              const sourceIdentityMatches = closure.value.sourceIndex === sourceReference.inputIndex;
              const inputStyleAvailable = Boolean(inputStyle);
              const inputStyleMatches = scenario.themeId === 'default'
                ? inputStyle?.pseudoFloat === 'left'
                  && inputStyle.pseudoPosition === 'static'
                  && inputStyle.pseudoContentKind === 'svg'
                : finite2dMatrix(inputStyle?.measurementTransform)
                  && inputStyle.measurementTransform.values.every(
                    (value, index) => Math.abs(value - CDP_BLOOM_INPUT_MATRIX[index]) <= geometryQuantum
                  );
              if (!sourceIdentityMatches) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-source-identity-mismatch';
              } else if (!inputStyleAvailable) {
                result.code = 'wechat-task-context-cdp-input-style-unavailable';
              } else if (!inputStyleMatches) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-input-style-mismatch';
              }
              baseline = sourceIdentityMatches && inputStyleMatches
                ? await exactGeometrySnapshot(cdp, closure, sourceReference)
                : null;
              if (!baseline) {
                result.code ||= 'wechat-task-context-cdp-reference-unavailable';
              } else if (!baseline.referenceReady) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-reference-mismatch';
              } else {
                middleLine = await middleLineInventory(cdp, baseline.sourceLiObjectId);
                mutationInstalled = await installInputPerturbation(cdp, closure);
                if (!mutationInstalled) {
                  result.code = 'wechat-task-context-cdp-input-perturbation-unavailable';
                } else {
                  perturbed = await exactGeometrySnapshot(cdp, closure, sourceReference);
                  if (!perturbed) {
                    result.code = 'wechat-task-context-cdp-perturbed-geometry-unavailable';
                  } else if (!perturbed.referenceReady) {
                    result.status = 'failed';
                    result.code = 'wechat-task-context-cdp-perturbed-reference-mismatch';
                  } else {
                    result = {
                      candidate: {
                        inputStyle,
                        middleLine,
                        sourceReference: sourceReference.status
                      },
                      closure: closure.value,
                      comparator: null,
                      runtime,
                      status: 'ready'
                    };
                  }
                }
              }
            }
          }
        } finally {
          let restorationFailed = false;
          try {
            if (mutationInstalled) restorationSucceeded = await restoreInputPerturbation(cdp);
            if (baseline && mutationInstalled && restorationSucceeded) {
              restored = await exactGeometrySnapshot(cdp, closure, sourceReference);
            }
          } catch {
            restorationFailed = true;
          }
          try {
            if (result.status === 'ready' && (restorationFailed || !restorationSucceeded || !restored)) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-rebaseline-unavailable';
            } else if (result.status === 'ready') {
              if (!restored.referenceReady) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-rebaseline-mismatch';
              } else {
                try {
                  result.comparator = geometryComparator(baseline, perturbed, restored, sourceReference);
                } catch {
                  result.status = 'unavailable';
                  result.code = 'wechat-task-context-cdp-comparator-unavailable';
                }
              }
              if (result.status === 'ready' && result.comparator?.status === 'contradiction') {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-comparator-mismatch';
              } else if (
                result.status === 'ready'
                && (result.comparator?.status !== 'ready' || !result.comparator.red || !result.comparator.restored)
              ) {
                result.status = 'unavailable';
                result.code = 'wechat-task-context-cdp-comparator-unavailable';
              }
            }
            const snapshotsReleased = await Promise.all([
              releaseSnapshotHandles(cdp, baseline),
              releaseSnapshotHandles(cdp, perturbed),
              releaseSnapshotHandles(cdp, restored)
            ]);
            if (snapshotsReleased.some((success) => !success)) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-release-failed';
            }
          } catch {
            result.status = 'unavailable';
            result.code = 'wechat-task-context-cdp-release-failed';
          } finally {
            if (paused && !await resumeOnce()) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-resume-failed';
            }
          }
        }
        result.closure ??= closure?.value ?? null;
        result.reference = {
          fragments: sourceReference.fragments,
          input: sourceReference.input,
          li: sourceReference.li,
          pseudo: sourceReference.pseudo,
          tree: sourceReference.tree
        };
        result.runtime = runtime;
        return result;
      },
      async finish() {
        clearTimeout(pauseTimer);
        cdp.off('Debugger.paused', onPaused);
        const removed = await removeBreakpoint();
        const resumed = paused ? await resumeOnce() : true;
        if (!removed) throw new Error('wechat-task-context-cdp-breakpoint-remove-failed');
        if (!resumed) throw new Error('wechat-task-context-cdp-resume-failed');
      },
      cdp,
      runtime,
      status: 'ready'
    };
  } catch {
    if (cdp) {
      try {
        await cdp.detach();
      } catch {
        return { code: 'wechat-task-context-cdp-detach-failed', status: 'unavailable' };
      }
    }
    return { code: 'wechat-task-context-cdp-unavailable', status: 'unavailable' };
  }
}

export async function writePrivateCdpEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-cdp-evidence.json');
  const payload = {
    candidate: evidence.candidate ?? null,
    closure: evidence.closure ?? null,
    comparator: evidence.comparator ?? null,
    reference: evidence.reference ?? null,
    runtime: evidence.runtime ?? null,
    status: evidence.status === 'ready'
      ? 'unverified'
      : evidence.status === 'failed'
        ? 'failed'
        : 'unavailable',
    unavailableCode: evidence.status === 'ready'
      ? null
      : stableCdpCode(evidence.code, 'wechat-task-context-cdp-none')
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}
