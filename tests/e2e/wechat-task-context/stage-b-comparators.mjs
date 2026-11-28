// Stage B geometry comparators: public projection, normalization, and the
// delta-based equality used by the ready geometry probe and its contracts.

import { CDP_GEOMETRY_OFFSET_PX } from "./geometry-measures.mjs";
import { finiteRect } from "./geometry-measures.mjs";
import { fragmentDelta } from "./geometry-measures.mjs";
import { finiteQuad } from "./geometry-measures.mjs";
import { geometryQuantum } from "./environment.mjs";
import { normalizeRect } from "./geometry-measures.mjs";
import { normalizedGeometry } from "./geometry-measures.mjs";
import { numericDelta } from "./geometry-measures.mjs";

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
