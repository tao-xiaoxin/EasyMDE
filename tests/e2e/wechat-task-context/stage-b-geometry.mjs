import { resolve } from 'node:path';
import { CDP_BLOOM_INPUT_MATRIX } from "./geometry-measures.mjs";
import { CDP_GEOMETRY_OFFSET_PX } from "./geometry-measures.mjs";
import { STAGE_B_CODE } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_BEFORE_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_CHECKED_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_INPUT_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_UNCHECKED_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_LATE_PAUSE_GRACE_MS } from "./geometry-measures.mjs";
import { STAGE_B_READY_TIMEOUT_MS } from "./geometry-measures.mjs";
import { cdpAllTextFragments } from "./cdp-geometry.mjs";
import { cdpCallFunction } from "./cdp-geometry.mjs";
import { cdpFrameEvaluation } from "./cdp-geometry.mjs";
import { cdpNodeGeometry } from "./cdp-geometry.mjs";
import { cdpRuntimeEvaluation } from "./cdp-geometry.mjs";
import { describeCdpNode } from "./cdp-geometry.mjs";
import { exactGeometryClosure } from "./cdp-geometry.mjs";
import { finiteQuad } from "./geometry-measures.mjs";
import { finiteRect } from "./geometry-measures.mjs";
import { fragmentDelta } from "./geometry-measures.mjs";
import { geometryGuardLineNumber } from "./geometry-measures.mjs";
import { geometryQuantum } from "./environment.mjs";
import { normalizeRect } from "./geometry-measures.mjs";
import { normalizedGeometry } from "./geometry-measures.mjs";
import { numericDelta } from "./geometry-measures.mjs";
import { releaseCdpObject } from "./cdp-geometry.mjs";
import { stableCdpCode } from "./geometry-measures.mjs";

export function collectSourceOnlyNodeGraph(root) {
  const entries = [];
  const stack = root
    ? [{ edgeKind: 'root', localIndex: 0, node: root, parentIndex: null }]
    : [];
  let controlIndex = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current?.node) continue;
    const { node } = current;
    const index = entries.length;
    const nodeName = typeof node.nodeName === 'string' ? node.nodeName : null;
    const isInput = nodeName === 'INPUT';
    entries.push({
      backendNodeId: node.backendNodeId,
      controlIndex: isInput ? controlIndex++ : null,
      edgeKind: current.edgeKind,
      localIndex: current.localIndex,
      nodeName,
      nodeType: Number.isInteger(node.nodeType) ? node.nodeType : null,
      parentIndex: current.parentIndex,
      pseudoType: typeof node.pseudoType === 'string' ? node.pseudoType : null
    });
    const groups = [
      ['children', node.children ?? []],
      ['shadowRoots', node.shadowRoots ?? []],
      ['pseudoElements', node.pseudoElements ?? []]
    ];
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const [edgeKind, children] = groups[groupIndex];
      for (let localIndex = children.length - 1; localIndex >= 0; localIndex -= 1) {
        stack.push({
          edgeKind,
          localIndex,
          node: children[localIndex],
          parentIndex: index
        });
      }
    }
  }
  return entries;
}

export async function collectSourceOnlyPotentialBox(cdp, node) {
  const result = {
    boxModelStatus: 'empty',
    contentQuads: null,
    contentQuadsStatus: 'empty'
  };
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return result;
  try {
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId });
    result.boxModelStatus = box.model
      && finiteQuad(box.model.border)
      && finiteQuad(box.model.content)
      ? 'finite'
      : 'empty';
  } catch {
    result.boxModelStatus = 'rejected';
  }
  try {
    const quads = await cdp.send('DOM.getContentQuads', { backendNodeId });
    if (!Array.isArray(quads.quads) || !quads.quads.length) {
      result.contentQuadsStatus = 'empty';
    } else if (quads.quads.every(finiteQuad)) {
      result.contentQuadsStatus = 'finite';
      result.contentQuads = quads.quads;
    } else {
      result.contentQuadsStatus = 'empty';
    }
  } catch {
    result.contentQuadsStatus = 'rejected';
  }
  return result;
}

export function stableStageBCode(value, fallback = 'wechat-task-context-stage-b-unavailable') {
  return typeof value === 'string' && STAGE_B_CODE.test(value) ? value : fallback;
}

export async function resolveStageBCdpObject(cdp, node) {
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return null;
  try {
    const response = await cdp.send('DOM.resolveNode', { backendNodeId });
    return response.object?.objectId ?? null;
  } catch {
    return null;
  }
}

export function stageBPublicGraph(graph) {
  return graph.map((entry) => ({
    controlIndex: entry.controlIndex,
    edgeKind: entry.edgeKind,
    localIndex: entry.localIndex,
    nodeName: entry.nodeName,
    nodeType: entry.nodeType,
    parentIndex: entry.parentIndex,
    pseudoType: entry.pseudoType
  }));
}

export function stageBNormalizedFragments(fragments, originGeometry) {
  if (!Array.isArray(fragments) || !originGeometry) return null;
  const normalized = fragments.map((fragment) => normalizeRect(fragment, originGeometry));
  return normalized.every(Boolean) ? normalized : null;
}

export function stageBNormalizedRecord(record) {
  return {
    before: record.before.status === 'ready'
      ? normalizedGeometry(record.before.geometry, record.liGeometry)
      : record.before.status,
    fragments: stageBNormalizedFragments(record.fragments, record.liGeometry),
    input: normalizedGeometry(record.inputGeometry, record.liGeometry),
    li: normalizedGeometry(record.liGeometry, record.parentListGeometry),
    parentFragments: stageBNormalizedFragments(record.parentFragments, record.parentListGeometry)
  };
}

export function stageBGeometryEqual(left, right) {
  return Boolean(left && right) && numericDelta(
    [left.border, left.content, left.quads],
    [right.border, right.content, right.quads]
  ) <= geometryQuantum;
}

export function stageBFragmentsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (left.every(finiteRect) && right.every(finiteRect)) {
    return fragmentDelta(left, right) <= geometryQuantum;
  }
  return numericDelta(left, right) <= geometryQuantum;
}

export function stageBGraphEqual(left, right) {
  return JSON.stringify(stageBPublicGraph(left ?? [])) === JSON.stringify(stageBPublicGraph(right ?? []));
}

export function stageBCompareExcept(normalizedSource, normalizedMeasurement, excluded) {
  if (!normalizedSource || !normalizedMeasurement) return false;
  return Object.entries(normalizedSource).every(([key, sourceValue]) => {
    if (excluded.has(key)) return true;
    const measurementValue = normalizedMeasurement[key];
    if (key === 'before') {
      if (sourceValue === 'absent' || measurementValue === 'absent') return sourceValue === measurementValue;
      return stageBGeometryEqual(sourceValue, measurementValue);
    }
    if (key === 'fragments' || key === 'parentFragments') {
      return stageBFragmentsEqual(sourceValue, measurementValue);
    }
    return stageBGeometryEqual(sourceValue, measurementValue);
  });
}

export function stageBCompareInventory(sourceInventory, measurementInventory, mapping = null) {
  if (mapping?.status === 'ready' && (!Array.isArray(mapping.mappings) || !mapping.mappings.length)) {
    return { code: 'wechat-task-context-stage-b-mapping-empty', status: 'unavailable' };
  }
  if (mapping?.status === 'unavailable') {
    return {
      code: mapping.code ?? 'wechat-task-context-stage-b-mapping-unavailable',
      status: 'unavailable'
    };
  }
  if (sourceInventory?.status === 'unavailable' || measurementInventory?.status === 'unavailable') {
    return { code: 'wechat-task-context-stage-b-inventory-unavailable', status: 'unavailable' };
  }
  if (sourceInventory?.status !== 'ready' || measurementInventory?.status !== 'ready') {
    return { code: 'wechat-task-context-stage-b-inventory-mismatch', status: 'failed' };
  }
  const mappedRecords = mapping?.status === 'ready'
    ? mapping.mappings.map((entry) => ({
        measurement: measurementInventory.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        )) ?? null,
        source: sourceInventory.inputs.find((record) => (
          record.backendNodeId === entry.sourceBackendNodeId
        )) ?? null
      }))
    : sourceInventory.inputs.map((sourceRecord, index) => ({
        measurement: measurementInventory.inputs[index] ?? null,
        source: sourceRecord
      }));
  if (mappedRecords.some(({ measurement, source }) => !measurement || !source)) {
    return { code: 'wechat-task-context-stage-b-mapping-node-missing', status: 'unavailable' };
  }
  const graphSame = mapping?.status === 'ready'
    ? null
    : stageBGraphEqual(sourceInventory.graph, measurementInventory.graph);
  const inputCountSame = mapping?.status === 'ready'
    ? null
    : sourceInventory.inputCount === measurementInventory.inputCount;
  const checkedSame = mapping?.status === 'ready'
    ? mappedRecords.every(({ measurement, source }) => measurement.checked === source.checked)
    : JSON.stringify(sourceInventory.checkedVector) === JSON.stringify(measurementInventory.checkedVector);
  const beforeCountSame = mapping?.status === 'ready'
    ? null
    : sourceInventory.beforeCount === measurementInventory.beforeCount;
  const records = mappedRecords.map(({ measurement, source }) => ({
    measurement: stageBNormalizedRecord(measurement),
    source: stageBNormalizedRecord(source)
  }));
  const normalized = records.map(({ measurement, source }) => ({
    measurement,
    source
  }));
  const inputUnchanged = normalized.every(({ measurement, source }) => (
    stageBCompareExcept(source, measurement, new Set(['before']))
  ));
  const beforeUnchanged = normalized.every(({ measurement, source }) => (
    stageBCompareExcept(source, measurement, new Set(['input', 'li', 'fragments', 'parentFragments']))
  ));
  const liUnchanged = normalized.every(({ measurement, source }) => (
    stageBGeometryEqual(source.li, measurement?.li)
  ));
  const fragmentsUnchanged = normalized.every(({ measurement, source }) => (
    stageBFragmentsEqual(source.fragments, measurement?.fragments)
      && stageBFragmentsEqual(source.parentFragments, measurement?.parentFragments)
  ));
  const rootWidthSame = mapping?.status === 'ready'
    ? null
    : Number.isFinite(sourceInventory.rootWidth)
    && Number.isFinite(measurementInventory.rootWidth)
    && Math.abs(sourceInventory.rootWidth - measurementInventory.rootWidth) <= geometryQuantum;
  const mismatch = (graphSame !== null && !graphSame)
    || (inputCountSame !== null && !inputCountSame)
    || !checkedSame
    || (beforeCountSame !== null && !beforeCountSame)
    || !inputUnchanged
    || !beforeUnchanged
    || !liUnchanged
    || !fragmentsUnchanged
    || (rootWidthSame !== null && !rootWidthSame);
  return {
    beforeUnchanged,
    code: mismatch ? 'wechat-task-context-stage-b-geometry-mismatch' : null,
    fragmentsUnchanged,
    graphSame,
    inputUnchanged,
    liUnchanged,
    mappedCount: mappedRecords.length,
    mappedSourceIndexes: mapping?.mappedSourceIndexes ?? null,
    rootHeightCompared: false,
    rootWidthSame,
    status: mismatch ? 'failed' : 'ready'
  };
}

export function stageBExactBeforeTranslation(baseline, perturbed, mapping = null) {
  if (mapping?.status === 'ready' && !mapping.mappings?.length) return false;
  const targetBackendNodeId = mapping?.mappings?.[0]?.measurementBackendNodeId;
  const baselineRecord = targetBackendNodeId
    ? baseline.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : baseline.inputs[0];
  const perturbedRecord = targetBackendNodeId
    ? perturbed.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : perturbed.inputs[0];
  if (!baselineRecord || !perturbedRecord) return false;
  const beforeBaseline = stageBNormalizedRecord(baselineRecord).before;
  const beforePerturbed = stageBNormalizedRecord(perturbedRecord).before;
  if (!beforeBaseline || !beforePerturbed || beforeBaseline === 'absent' || beforePerturbed === 'absent') {
    return false;
  }
  if (beforeBaseline.quads.length !== beforePerturbed.quads.length) return false;
  return beforeBaseline.quads.every((quad, quadIndex) => (
    quad.every((value, valueIndex) => (
      Math.abs(
        beforePerturbed.quads[quadIndex][valueIndex]
        - value
        - (valueIndex % 2 ? 0 : CDP_GEOMETRY_OFFSET_PX)
      ) <= geometryQuantum
    )
  )));
}

export function stageBInputWidthDelta(baseline, perturbed, mapping = null) {
  if (mapping?.status === 'ready' && !mapping.mappings?.length) return null;
  const targetBackendNodeId = mapping?.mappings?.[0]?.measurementBackendNodeId;
  const baselineRecord = targetBackendNodeId
    ? baseline.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : baseline.inputs[0];
  const perturbedRecord = targetBackendNodeId
    ? perturbed.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : perturbed.inputs[0];
  const source = baselineRecord?.inputGeometry?.border;
  const value = perturbedRecord?.inputGeometry?.border;
  if (!finiteQuad(source) || !finiteQuad(value)) return null;
  return (value[2] - value[0]) - (source[2] - source[0]);
}

export async function collectStageBSurfaceInventory(
  cdp,
  rootNode,
  rootObjectId,
  heldObjectIds,
  { enforceCanonicalCounts = true } = {}
) {
  if (!rootNode || !rootObjectId) {
    return { code: 'wechat-task-context-stage-b-root-unavailable', status: 'unavailable' };
  }
  const graph = collectSourceOnlyNodeGraph(rootNode);
  const inputEntries = graph
    .map((entry, index) => ({ ...entry, graphIndex: index }))
    .filter(({ nodeName }) => nodeName === 'INPUT')
    .sort((left, right) => left.controlIndex - right.controlIndex);
  const checkedResult = await cdpCallFunction(
    cdp,
    rootObjectId,
    `function() {
      return [...this.querySelectorAll('input[type="checkbox"]')]
        .map((input) => input instanceof HTMLInputElement && input.checked === true);
    }`
  );
  const checkedVector = checkedResult.ok && Array.isArray(checkedResult.value)
    && checkedResult.value.every((value) => typeof value === 'boolean')
    ? checkedResult.value
    : null;
  const inputs = [];
  for (const inputEntry of inputEntries) {
    const beforeEntry = graph.find((entry) => (
      entry.parentIndex === inputEntry.graphIndex
      && (entry.pseudoType === 'before' || entry.nodeName === '::before')
    ));
    const checked = checkedVector?.[inputEntry.controlIndex] ?? null;
    const inputObjectId = await resolveStageBCdpObject(cdp, inputEntry);
    if (inputObjectId) heldObjectIds.add(inputObjectId);
    let liObjectId = null;
    let parentListObjectId = null;
    let liNode = null;
    let parentListNode = null;
    if (inputObjectId) {
      const liResult = await cdpCallFunction(
        cdp,
        inputObjectId,
        `function() { return this.closest('li.task-list-item, li'); }`,
        [],
        false
      );
      liObjectId = liResult.ok ? liResult.objectId : null;
      if (liObjectId) heldObjectIds.add(liObjectId);
      if (liObjectId) {
        const parentListResult = await cdpCallFunction(
          cdp,
          liObjectId,
          `function() { return this.parentElement; }`,
          [],
          false
        );
        parentListObjectId = parentListResult.ok ? parentListResult.objectId : null;
        if (parentListObjectId) heldObjectIds.add(parentListObjectId);
      }
      liNode = await describeCdpNode(cdp, liObjectId);
      parentListNode = await describeCdpNode(cdp, parentListObjectId);
    }
    const inputGeometry = await cdpNodeGeometry(cdp, inputEntry);
    const beforeGeometry = beforeEntry
      ? await cdpNodeGeometry(cdp, beforeEntry)
      : null;
    const liGeometry = await cdpNodeGeometry(cdp, liNode);
    const parentListGeometry = await cdpNodeGeometry(cdp, parentListNode);
    const fragments = liObjectId ? await cdpAllTextFragments(cdp, liObjectId) : null;
    const parentFragments = parentListObjectId
      ? await cdpAllTextFragments(cdp, parentListObjectId)
      : null;
    const beforeStatus = beforeEntry
      ? beforeGeometry ? 'ready' : 'unavailable'
      : checked === false ? 'absent' : 'unavailable';
    inputs.push({
      before: { geometry: beforeGeometry, status: beforeStatus },
      backendNodeId: inputEntry.backendNodeId,
      checked,
      fragments,
      graphIndex: inputEntry.graphIndex,
      inputGeometry,
      liGeometry,
      parentFragments,
      parentListGeometry
    });
  }
  const rootGeometry = await cdpNodeGeometry(cdp, rootNode);
  const beforeCount = inputEntries.filter((inputEntry) => graph.some((entry) => (
    entry.parentIndex === inputEntry.graphIndex
      && (entry.pseudoType === 'before' || entry.nodeName === '::before')
  ))).length;
  const uncheckedAbsenceCount = inputs.filter(({ before, checked }) => (
    checked === false && before.status === 'absent'
  )).length;
  const checkedUnavailable = checkedVector === null;
  const checkedShapeUnavailable = !checkedUnavailable && checkedVector.length !== inputEntries.length;
  const countMismatch = !checkedUnavailable && (
    !checkedShapeUnavailable
      && enforceCanonicalCounts && (
        inputEntries.length !== STAGE_B_EXPECTED_INPUT_COUNT
        || checkedVector.length !== STAGE_B_EXPECTED_INPUT_COUNT
        || checkedVector.filter(Boolean).length !== STAGE_B_EXPECTED_CHECKED_COUNT
        || checkedVector.filter((value) => !value).length !== STAGE_B_EXPECTED_UNCHECKED_COUNT
        || beforeCount !== STAGE_B_EXPECTED_BEFORE_COUNT
        || uncheckedAbsenceCount !== STAGE_B_EXPECTED_UNCHECKED_COUNT
      )
  );
  const geometryUnavailable = !rootGeometry
    || checkedUnavailable
    || checkedShapeUnavailable
    || inputs.length === 0
    || inputs.some(({ before, fragments, inputGeometry, liGeometry, parentFragments, parentListGeometry }) => (
      !inputGeometry
      || !liGeometry
      || !parentListGeometry
      || !fragments
      || !parentFragments
      || before.status === 'unavailable'
    ));
  const rootWidth = rootGeometry && finiteQuad(rootGeometry.border)
    ? rootGeometry.border[2] - rootGeometry.border[0]
    : null;
  return {
    beforeCount,
    checkedCount: checkedVector?.filter(Boolean).length ?? null,
    checkedVector,
    code: geometryUnavailable
      ? 'wechat-task-context-stage-b-inventory-unavailable'
      : countMismatch
        ? 'wechat-task-context-stage-b-inventory-mismatch'
        : null,
    graph,
    inputCount: inputEntries.length,
    inputs: inputs.map(({ graphIndex, ...record }) => ({
      ...record,
      index: graph[graphIndex]?.controlIndex ?? null
    })),
    rootGeometry,
    rootHeight: finiteQuad(rootGeometry?.border)
      ? rootGeometry.border[5] - rootGeometry.border[1]
      : null,
    rootWidth,
    status: geometryUnavailable ? 'unavailable' : countMismatch ? 'failed' : 'ready',
    uncheckedAbsenceCount
  };
}

export async function captureStageBSourceInventory(cdp, selector, heldObjectIds) {
  const root = await cdpRuntimeEvaluation(
    cdp,
    `document.querySelector(${JSON.stringify(selector)})`,
    { returnByValue: false }
  );
  if (!root.ok) {
    return { code: 'wechat-task-context-stage-b-source-root-unavailable', status: 'unavailable' };
  }
  heldObjectIds.add(root.objectId);
  const node = await describeCdpNode(cdp, root.objectId);
  return collectStageBSurfaceInventory(cdp, node, root.objectId, heldObjectIds);
}

export async function captureStageBLeaseMappings(cdp, closure, sourceInventory, heldObjectIds) {
  if (closure?.status !== 'ready' || !closure.callFrameId) {
    return { code: 'wechat-task-context-stage-b-mapping-unavailable', status: 'unavailable' };
  }
  const summary = await cdpFrameEvaluation(cdp, closure.callFrameId, `(() => {
    const sourceInputs = [...lease.sourceRoot.querySelectorAll('input[type="checkbox"]')];
    return sourceInputs.map((source, sourceIndex) => {
      const measurement = lease.measurementFor(source);
      return {
        measurementConnected: Boolean(measurement?.isConnected),
        mapped: Boolean(measurement),
        sourceIndex
      };
    });
  })()`);
  if (!summary.ok || !Array.isArray(summary.value)) {
    return { code: 'wechat-task-context-stage-b-mapping-unavailable', status: 'unavailable' };
  }
  const mappings = [];
  const unmappedSourceIndexes = [];
  for (const entry of summary.value) {
    if (entry?.mapped !== true || entry.measurementConnected !== true) {
      unmappedSourceIndexes.push(entry?.sourceIndex ?? null);
      continue;
    }
    const sourceHandle = await cdpFrameEvaluation(
      cdp,
      closure.callFrameId,
      `lease.sourceRoot.querySelectorAll('input[type="checkbox"]')[${entry.sourceIndex}]`,
      false
    );
    if (!sourceHandle.ok || !sourceHandle.objectId) {
      return { code: 'wechat-task-context-stage-b-mapping-source-handle-unavailable', status: 'unavailable' };
    }
    heldObjectIds.add(sourceHandle.objectId);
    const sourceNode = await describeCdpNode(cdp, sourceHandle.objectId);
    const sourceRecord = sourceInventory.inputs.find(({ backendNodeId }) => (
      backendNodeId === sourceNode?.backendNodeId
    ));
    if (!sourceRecord) {
      return { code: 'wechat-task-context-stage-b-mapping-source-missing', status: 'unavailable' };
    }
    const handle = await cdpFrameEvaluation(
      cdp,
      closure.callFrameId,
      `lease.measurementFor(lease.sourceRoot.querySelectorAll('input[type="checkbox"]')[${entry.sourceIndex}])`,
      false
    );
    if (!handle.ok || !handle.objectId) {
      return { code: 'wechat-task-context-stage-b-mapping-handle-unavailable', status: 'unavailable' };
    }
    heldObjectIds.add(handle.objectId);
    const measurementNode = await describeCdpNode(cdp, handle.objectId);
    if (!measurementNode?.backendNodeId) {
      return { code: 'wechat-task-context-stage-b-mapping-node-unavailable', status: 'unavailable' };
    }
    mappings.push({
      measurementBackendNodeId: measurementNode.backendNodeId,
      sourceBackendNodeId: sourceRecord.backendNodeId,
      sourceIndex: sourceRecord.index
    });
  }
  if (!mappings.length) {
    return {
      code: 'wechat-task-context-stage-b-mapping-empty',
      mappedSourceIndexes: [],
      status: 'unavailable',
      unmappedSourceIndexes
    };
  }
  return {
    mappedSourceIndexes: mappings.map(({ sourceIndex }) => sourceIndex),
    mappings,
    status: 'ready',
    unmappedSourceIndexes
  };
}

export async function stageBActualInputStyle(cdp, measurementObjectId, themeId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    themeId === 'default'
      ? `function() {
          const pseudo = getComputedStyle(this, '::before');
          return {
            contentSvg: /svg/i.test(pseudo.content),
            floatLeft: pseudo.float === 'left',
            positionStatic: pseudo.position === 'static'
          };
        }`
      : `function() {
          const value = getComputedStyle(this).transform;
          const matrix = new DOMMatrixReadOnly(value === 'none'
            ? 'matrix(1, 0, 0, 1, 0, 0)'
            : value);
          const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
          return {
            matrixFinite2d: matrix.is2D === true && values.every(Number.isFinite),
            transformValues: values
          };
        }`
  );
  if (!result.ok || !result.value) {
    return { status: 'unavailable' };
  }
  const matches = themeId === 'default'
    ? result.value.floatLeft === true
      && result.value.positionStatic === true
      && result.value.contentSvg === true
    : result.value.matrixFinite2d === true
      && Array.isArray(result.value.transformValues)
      && result.value.transformValues.length === CDP_BLOOM_INPUT_MATRIX.length
      && result.value.transformValues.every((value, index) => (
        Math.abs(value - CDP_BLOOM_INPUT_MATRIX[index]) <= geometryQuantum
      ));
  return { ...result.value, matches, status: 'ready' };
}

export async function installStageBBeforePerturbation(cdp, measurementObjectId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    `function() {
      const current = getComputedStyle(this, '::before').transform;
      const transform = current === 'none'
        ? 'translateX(2.5px)'
        : 'translateX(2.5px) ' + current;
      const style = this.ownerDocument.createElement('style');
      style.setAttribute('data-easymde-stage-b-before-probe', '1');
      style.textContent = '[data-easymde-stage-b-before-probe="1"]::before'
        + '{transform:' + transform + '!important;}';
      this.setAttribute('data-easymde-stage-b-before-probe', '1');
      this.ownerDocument.head.appendChild(style);
      globalThis.__easymdeStageBBeforeCleanup = () => {
        style.remove();
        this.removeAttribute('data-easymde-stage-b-before-probe');
        delete globalThis.__easymdeStageBBeforeCleanup;
      };
      return true;
    }`
  );
  return result.ok && result.value === true;
}

export async function installStageBWidthPerturbation(cdp, measurementObjectId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    `function() {
      const width = this.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) return false;
      const oldValue = this.style.getPropertyValue('width');
      const oldPriority = this.style.getPropertyPriority('width');
      this.style.setProperty('width', String(width + 24) + 'px', 'important');
      globalThis.__easymdeStageBWidthCleanup = () => {
        if (oldValue) this.style.setProperty('width', oldValue, oldPriority);
        else this.style.removeProperty('width');
        delete globalThis.__easymdeStageBWidthCleanup;
      };
      return true;
    }`
  );
  return result.ok && result.value === true;
}

export async function restoreStageBPerturbation(cdp, kind) {
  const name = kind === 'before'
    ? '__easymdeStageBBeforeCleanup'
    : '__easymdeStageBWidthCleanup';
  const result = await cdpRuntimeEvaluation(
    cdp,
    `(() => {
      const cleanup = globalThis[${JSON.stringify(name)}];
      if (typeof cleanup !== 'function') return false;
      cleanup();
      return true;
    })()`
  );
  return result.ok && result.value === true;
}

export async function releaseStageBObjects(cdp, heldObjectIds, releasedObjectIds) {
  let success = true;
  for (const objectId of heldObjectIds) {
    if (releasedObjectIds.has(objectId)) continue;
    releasedObjectIds.add(objectId);
    if (!await releaseCdpObject(cdp, objectId)) success = false;
  }
  return success;
}

export function stageBSurfaceUnchangedExcept(baseline, candidate, excluded, mapping = null) {
  if (
    baseline?.status !== 'ready'
    || candidate?.status !== 'ready'
    || (mapping?.status === 'ready' && !mapping.mappings?.length)
    || (mapping?.status !== 'ready' && baseline.inputCount !== candidate.inputCount)
    || (mapping?.status !== 'ready'
      && JSON.stringify(baseline.checkedVector) !== JSON.stringify(candidate.checkedVector))
    || (mapping?.status !== 'ready' && !stageBGraphEqual(baseline.graph, candidate.graph))
    || (mapping?.status !== 'ready'
      && Math.abs(baseline.rootWidth - candidate.rootWidth) > geometryQuantum)
  ) return false;
  const records = mapping?.status === 'ready'
    ? mapping.mappings.map((entry) => ({
        candidate: candidate.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        )),
        baseline: baseline.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        ))
      }))
    : baseline.inputs.map((record, index) => ({
        baseline: record,
        candidate: candidate.inputs[index]
      }));
  return records.every(({ baseline: record, candidate: candidateRecord }) => {
    if (!record || !candidateRecord) return false;
    return stageBCompareExcept(
      stageBNormalizedRecord(record),
      stageBNormalizedRecord(candidateRecord),
      excluded
    );
  });
}

export async function armStageBReadyGeometryProbe(
  cdp,
  moduleUrl,
  privateCode,
  selector,
  scenario,
  heldObjectIds,
  {
    latePauseGraceMs = STAGE_B_LATE_PAUSE_GRACE_MS,
    pauseTimeoutMs = STAGE_B_READY_TIMEOUT_MS
  } = {}
) {
  const lineNumber = geometryGuardLineNumber(privateCode);
  if (!Number.isInteger(lineNumber)) {
    return { code: 'wechat-task-context-stage-b-geometry-guard-unavailable', status: 'unavailable' };
  }
  let breakpointId = null;
  try {
    await cdp.send('Debugger.enable');
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      columnNumber: 0,
      lineNumber,
      url: moduleUrl
    });
    breakpointId = breakpoint.breakpointId;
    if (typeof breakpointId !== 'string' || !breakpointId) {
      return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
    }
  } catch {
    return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
  }
  let pauseResolve;
  let latePauseResolve;
  let pauseTimer = null;
  let latePauseTimer = null;
  let pauseReceipt = null;
  let pauseReceived = false;
  let pauseTimedOut = false;
  let pauseSettled = false;
  let paused = false;
  let breakpointRemovalAttempted = false;
  let breakpointRemoved = false;
  let resumeAttempted = false;
  let resumeSucceeded = null;
  let terminationAttempted = false;
  let terminationSucceeded = null;
  let terminationKind = null;
  const pausePromise = new Promise((resolve) => { pauseResolve = resolve; });
  const latePausePromise = new Promise((resolve) => { latePauseResolve = resolve; });
  const onPaused = (event) => {
    if (pauseReceived) return;
    pauseReceived = true;
    paused = true;
    clearTimeout(pauseTimer);
    pauseReceipt = {
      event,
      late: pauseTimedOut,
      paused: true,
      received: true,
      timedOut: pauseTimedOut
    };
    if (!pauseSettled) {
      pauseSettled = true;
      pauseResolve(pauseReceipt);
    } else if (pauseTimedOut) {
      latePauseResolve(pauseReceipt);
    }
  };
  cdp.on('Debugger.paused', onPaused);
  pauseTimer = setTimeout(() => {
    if (pauseReceived) return;
    pauseTimedOut = true;
    pauseSettled = true;
    pauseReceipt = { event: null, late: false, paused: false, received: false, timedOut: true };
    pauseResolve(pauseReceipt);
  }, pauseTimeoutMs);
  const removeBreakpointOnce = async () => {
    if (breakpointRemovalAttempted) return breakpointRemoved;
    breakpointRemovalAttempted = true;
    try {
      await cdp.send('Debugger.removeBreakpoint', { breakpointId });
      breakpointRemoved = true;
    } catch {
      breakpointRemoved = false;
    }
    return breakpointRemoved;
  };
  const resumeOnce = async () => {
    if (resumeAttempted) return resumeSucceeded === true;
    resumeAttempted = true;
    if (paused) {
      try {
        await cdp.send('Debugger.resume');
        resumeSucceeded = true;
        terminationKind = 'resume';
        return true;
      } catch {
        // A paused target may still be terminated safely if resume is rejected.
      }
    }
    terminationAttempted = true;
    try {
      await cdp.send('Debugger.disable');
      terminationSucceeded = true;
      resumeSucceeded = true;
      terminationKind = 'disable';
    } catch {
      terminationSucceeded = false;
      resumeSucceeded = false;
    }
    return resumeSucceeded === true;
  };
  const dispose = () => {
    clearTimeout(pauseTimer);
    clearTimeout(latePauseTimer);
    cdp.off('Debugger.paused', onPaused);
  };
  const observe = async (sourceInventory) => {
    const initialReceipt = await pausePromise;
    const receipt = initialReceipt.timedOut
      ? await Promise.race([
          latePausePromise,
          new Promise((resolve) => {
            latePauseTimer = setTimeout(() => resolve(initialReceipt), latePauseGraceMs);
          })
        ])
      : initialReceipt;
    clearTimeout(latePauseTimer);
    let result = {
      code: receipt.received
        ? 'wechat-task-context-stage-b-pause-unavailable'
        : 'wechat-task-context-stage-b-pause-timeout',
      status: 'unavailable'
    };
    let closure = null;
    let baseline = null;
    let mapping = null;
    let baselineComparison = null;
    let beforeNegative = null;
    let widthNegative = null;
    let inputStyle = null;
    let restoreOutcome = freezeSourceOnlyCleanup('success', null);
    const restoreFailures = [];
    const recordRestoreFailure = (code) => {
      if (!restoreFailures.includes(code)) restoreFailures.push(code);
    };
    try {
      if (!receipt.received || !receipt.event) return {
        baseline,
        baselineComparison,
        beforeNegative,
        closure,
        mapping,
        result,
        restoreOutcome,
        widthNegative
      };
      const hit = Array.isArray(receipt.event.hitBreakpoints)
        && receipt.event.hitBreakpoints.includes(breakpointId);
      if (!hit) {
        result = { code: 'wechat-task-context-stage-b-unexpected-pause', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (!await removeBreakpointOnce()) {
        result = { code: 'wechat-task-context-stage-b-breakpoint-remove-failed', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      closure = await exactGeometryClosure(
        cdp,
        receipt.event,
        selector,
        scenario.expectedReference
      );
      if (closure.status !== 'ready') {
        result = {
          code: stableCdpCode(closure.code, 'wechat-task-context-stage-b-closure-unavailable'),
          status: closure.status === 'failed' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (closure.value.sourceIndex !== 0) {
        result = { code: 'wechat-task-context-stage-b-source-identity-mismatch', status: 'failed' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      Object.values(closure.handles).forEach((objectId) => heldObjectIds.add(objectId));
      inputStyle = await stageBActualInputStyle(cdp, closure.handles.measurement, scenario.themeId);
      if (inputStyle.status !== 'ready' || inputStyle.matches !== true) {
        result = {
          code: inputStyle.status === 'ready'
            ? 'wechat-task-context-stage-b-input-style-mismatch'
            : 'wechat-task-context-stage-b-input-style-unavailable',
          status: inputStyle.status === 'ready' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          inputStyle,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      const measurementRootNode = await describeCdpNode(cdp, closure.handles.measurementRoot);
      baseline = await collectStageBSurfaceInventory(
        cdp,
        measurementRootNode,
        closure.handles.measurementRoot,
        heldObjectIds,
        { enforceCanonicalCounts: false }
      );
      mapping = await captureStageBLeaseMappings(cdp, closure, sourceInventory, heldObjectIds);
      baselineComparison = stageBCompareInventory(sourceInventory, baseline, mapping);
      if (baselineComparison.status !== 'ready') {
        result = {
          code: baselineComparison.code ?? 'wechat-task-context-stage-b-baseline-unavailable',
          status: baselineComparison.status
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      let beforeInstalled = false;
      let beforeRestored = false;
      try {
        beforeInstalled = await installStageBBeforePerturbation(cdp, closure.handles.measurement);
        if (!beforeInstalled) {
          beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputLiTextUnchanged = stageBSurfaceUnchangedExcept(
            baseline,
            perturbed,
            new Set(['before']),
            mapping
          );
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) {
            recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
          }
          const restored = beforeRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-before-restore-unavailable', status: 'unavailable' };
          beforeNegative = {
            comparatorStatus: perturbedComparison.status,
            exactTranslation: perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping),
            inputLiTextUnchanged,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping)
              && inputLiTextUnchanged
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
      } catch {
        beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        if (beforeInstalled && !beforeRestored) {
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
        }
      }
      let widthInstalled = false;
      let widthRestored = false;
      if (beforeNegative?.status !== 'ready') {
        widthNegative = {
          code: 'wechat-task-context-stage-b-width-perturbation-unavailable',
          status: 'unavailable'
        };
      } else {
        try {
        widthInstalled = await installStageBWidthPerturbation(cdp, closure.handles.measurement);
        if (!widthInstalled) {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputWidthDelta = perturbed.status === 'ready'
            ? stageBInputWidthDelta(baseline, perturbed, mapping)
            : null;
          widthRestored = await restoreStageBPerturbation(cdp, 'width');
          if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          const restored = widthRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-width-restore-unavailable', status: 'unavailable' };
          widthNegative = {
            comparatorStatus: perturbedComparison.status,
            inputWidthDelta,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && Number.isFinite(inputWidthDelta)
              && Math.abs(inputWidthDelta - 24) <= geometryQuantum
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
        } catch {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
          if (widthInstalled && !widthRestored) {
            widthRestored = await restoreStageBPerturbation(cdp, 'width');
            if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          }
        }
      }
      if (restoreFailures.length) {
        restoreOutcome = freezeSourceOnlyCleanup('failed', restoreFailures[0]);
      }
      const negativeUnavailable = beforeNegative?.status === 'unavailable'
        || widthNegative?.status === 'unavailable';
      const negativeMismatch = beforeNegative?.status === 'failed'
        || widthNegative?.status === 'failed';
      result = {
        candidate: {
          closure: closure.value,
          measurementInputCount: baseline.inputCount,
          measurementNodeCount: baseline.graph.length,
          measurementPseudoCount: baseline.graph.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          mapping: {
            mappedCount: mapping?.mappedSourceIndexes?.length ?? 0,
            mappedSourceIndexes: mapping?.mappedSourceIndexes ?? [],
            status: mapping?.status ?? 'unavailable',
            unmappedSourceIndexes: mapping?.unmappedSourceIndexes ?? []
          },
          inputStyle,
          sourceGeometryReference: closure.reference
        },
        code: negativeMismatch
            ? 'wechat-task-context-stage-b-negative-mismatch'
            : negativeUnavailable
              ? 'wechat-task-context-stage-b-negative-unavailable'
              : null,
        status: negativeMismatch ? 'failed' : negativeUnavailable ? 'unavailable' : 'ready'
      };
    } catch {
      result = { code: 'wechat-task-context-stage-b-geometry-unavailable', status: 'unavailable' };
    } finally {
      await removeBreakpointOnce();
      await resumeOnce();
    }
    return {
      baseline,
      baselineComparison,
      beforeNegative,
      closure,
      inputStyle,
      mapping,
      result,
      restoreOutcome,
      widthNegative
    };
  };
  return {
    breakpointId,
    breakpointRemoved: () => breakpointRemoved,
    dispose,
    observe,
    latePauseObserved: () => pauseTimedOut && pauseReceived,
    removeBreakpointOnce,
    resumeOnce,
    resumeSucceeded: () => resumeSucceeded === true,
    termination: () => ({
      attempted: terminationAttempted,
      kind: terminationKind,
      succeeded: terminationSucceeded
    }),
    status: 'ready'
  };
}

export async function runSourceOnlyCdpCleanup(primary, cdp, rootObjectId, release = releaseCdpObject) {
  return runSourceOnlyCleanupContract(primary, {
    ...(cdp && rootObjectId ? {
      release: async () => {
        const released = await release(cdp, rootObjectId);
        return released === true
          ? freezeSourceOnlyCleanup('success', null)
          : freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-release-failed');
      }
    } : {}),
    ...(cdp ? {
      detach: async () => {
        try {
          await cdp.detach();
          return freezeSourceOnlyCleanup('success', null);
        } catch {
          return freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-detach-failed');
        }
      }
    } : {})
  });
}

export function completeSourceOnlyCdpEvidence(primaryResult, contract, runtime) {
  return {
    ...primaryResult,
    cleanup: contract.cleanup,
    cleanupAttempts: contract.attempts,
    cleanupCodes: contract.cleanupCodes,
    code: contract.primary.code,
    primary: contract.primary,
    runtime,
    status: contract.status === 'failed'
      ? 'failed'
      : primaryResult.status
  };
}

export async function collectSourceOnlyCdpEvidence(page, selector) {
  let cdp = null;
  let rootObjectId = null;
  let result = null;
  let runtime = { product: null, protocolVersion: null };
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    try {
      const version = await cdp.send('Browser.getVersion');
      runtime = {
        product: typeof version?.product === 'string' ? version.product : null,
        protocolVersion: typeof version?.protocolVersion === 'string'
          ? version.protocolVersion
          : null
      };
    } catch {
      result = {
        code: 'wechat-task-context-source-only-runtime-version-unavailable',
        runtime,
        status: 'unavailable'
      };
    }
    if (!result) {
      const root = await cdpRuntimeEvaluation(
        cdp,
        `document.querySelector(${JSON.stringify(selector)})`,
        { returnByValue: false }
      );
      if (!root.ok) {
        result = {
          code: 'wechat-task-context-source-only-root-missing',
          runtime,
          status: 'unavailable'
        };
      } else {
        rootObjectId = root.objectId;
        const described = await cdp.send('DOM.describeNode', {
          depth: -1,
          objectId: root.objectId,
          pierce: true
        });
        const graph = collectSourceOnlyNodeGraph(described.node);
        const nodes = await Promise.all(graph.map(async (entry) => ({
          controlIndex: entry.controlIndex,
          edgeKind: entry.edgeKind,
          localIndex: entry.localIndex,
          nodeName: entry.nodeName,
          nodeType: entry.nodeType,
          parentIndex: entry.parentIndex,
          potentialBox: await collectSourceOnlyPotentialBox(cdp, entry),
          pseudoType: entry.pseudoType
        })));
        const inputs = nodes.filter(({ nodeName }) => nodeName === 'INPUT');
        const complete = inputs.length === 19
          && inputs.every(({ potentialBox }) => (
            potentialBox.boxModelStatus === 'finite'
            && potentialBox.contentQuadsStatus === 'finite'
          ));
        result = {
          code: complete ? null : 'wechat-task-context-source-only-collector-incomplete',
          inputCount: inputs.length,
          nodeCount: nodes.length,
          nodes,
          pseudoCount: nodes.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          runtime,
          status: complete ? 'ready' : 'unavailable'
        };
      }
    }
  } catch {
    result = {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
  } finally {
    const primaryResult = result ?? {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
    const primary = freezeSourceOnlyPrimary(
      primaryResult.status === 'ready'
        ? 'available'
        : primaryResult.status === 'failed'
          ? 'failed'
          : 'unavailable',
      primaryResult.code ?? 'wechat-task-context-source-only-ready'
    );
    const contract = await runSourceOnlyCdpCleanup(primary, cdp, rootObjectId);
    result = completeSourceOnlyCdpEvidence(primaryResult, contract, runtime);
  }
  return result ?? {
    code: 'wechat-task-context-source-only-collector-incomplete',
    runtime,
    status: 'unavailable'
  };
}

export function freezeSourceOnlyPrimary(status, code) {
  if (!['available', 'failed', 'unavailable'].includes(status) || typeof code !== 'string') {
    throw new Error('wechat-task-context-source-only-contract-primary-invalid');
  }
  return Object.freeze({ code, status });
}

export function freezeSourceOnlyCleanup(status, code) {
  if (!['failed', 'success'].includes(status) || (status === 'failed' && typeof code !== 'string')) {
    throw new Error('wechat-task-context-source-only-contract-cleanup-invalid');
  }
  return Object.freeze({ code: code ?? null, status });
}

export async function runSourceOnlyCleanupContract(primary, operations = {}) {
  const cleanup = {};
  const attempts = {};
  const cleanupOrder = ['restore', 'release', 'resume', 'detach'];
  for (const name of cleanupOrder) {
    attempts[name] = 0;
    const operation = operations[name];
    if (typeof operation !== 'function') continue;
    attempts[name] = 1;
    try {
      const outcome = await operation();
      if (!outcome || !['failed', 'success'].includes(outcome.status)) {
        throw new Error('wechat-task-context-source-only-contract-cleanup-failed');
      }
      cleanup[name] = freezeSourceOnlyCleanup(outcome.status, outcome.code);
    } catch (error) {
      const code = error instanceof Error && /^wechat-task-context-source-only-[a-z0-9-]+$/u.test(error.message)
        ? error.message
        : 'wechat-task-context-source-only-contract-cleanup-failed';
      cleanup[name] = freezeSourceOnlyCleanup('failed', code);
    }
  }
  const cleanupCodes = cleanupOrder
    .map((name) => cleanup[name])
    .filter(Boolean)
    .filter(({ status }) => status === 'failed')
    .map(({ code }) => code);
  return Object.freeze({
    attempts: Object.freeze(attempts),
    cleanup: Object.freeze(cleanup),
    cleanupCodes: Object.freeze(cleanupCodes),
    code: primary.code,
    primary,
    status: primary.status === 'failed' || cleanupCodes.length ? 'failed' : primary.status
  });
}
