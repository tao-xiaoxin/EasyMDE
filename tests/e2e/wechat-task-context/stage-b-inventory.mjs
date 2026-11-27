// Stage B CDP surface inventory: DOM node graph walking, per-input geometry
// and text-fragment capture, and source-to-measurement lease mapping.

import { STAGE_B_CODE } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_BEFORE_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_CHECKED_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_INPUT_COUNT } from "./geometry-measures.mjs";
import { STAGE_B_EXPECTED_UNCHECKED_COUNT } from "./geometry-measures.mjs";
import { cdpAllTextFragments } from "./cdp-geometry.mjs";
import { cdpCallFunction } from "./cdp-geometry.mjs";
import { cdpFrameEvaluation } from "./cdp-geometry.mjs";
import { cdpNodeGeometry } from "./cdp-geometry.mjs";
import { cdpRuntimeEvaluation } from "./cdp-geometry.mjs";
import { collectSourceOnlyNodeGraph } from "./source-only-collector.mjs";
import { describeCdpNode } from "./cdp-geometry.mjs";
import { finiteQuad } from "./geometry-measures.mjs";

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
