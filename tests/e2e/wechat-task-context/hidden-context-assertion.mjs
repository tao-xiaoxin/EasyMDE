// Node-side assertions for hidden WeChat task-context evidence.

import { expect } from '@playwright/test';
import { geometryQuantum } from "./environment.mjs";
import { taskStates } from "./environment.mjs";

export function assertHiddenContextEvidence(evidence, calibratedContentWidth) {
  const compatibility = evidence.referenceCompatibility;
  if (
    !compatibility
    || !compatibility.acceptedSame
    || !compatibility.editorPresentationSame
    || !compatibility.signatureSame
    || !compatibility.sameSink
  ) {
    throw new Error('wechat-task-context-hidden-reference-incompatible');
  }
  expect(evidence.readinessStatus).toBe('unverified');
  expect(evidence.serializerCloneMapping).toBe('unobservable-detached');
  expect(evidence.sourceVisibleReference.inputs).toHaveLength(19);
  expect(evidence.sourceAfterHide.inputs).toHaveLength(19);
  expect(evidence.sourceFinal.inputs).toHaveLength(19);
  expect(evidence.sourceVisibleReference.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceAfterHide.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceFinal.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => checked)).toHaveLength(16);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => !checked)).toHaveLength(3);
  expect(evidence.sourceVisibleReference.inputs.every(({ identity }) => identity.localName === 'input')).toBe(true);
  expect(evidence.sourceAfterHide.root.rect.width).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceAfterHide.root.rect.height).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceFinalZeroRect).toBe(true);
  expect(evidence.visibilityFinalRootZeroRect).toBe(true);
  for (const phase of ['connection', 'styleRead', 'final']) {
    const phaseRect = evidence.sourceRectPhases[phase];
    if (
      !phaseRect
      || ['bottom', 'height', 'left', 'right', 'top', 'width']
        .some((property) => Math.abs(phaseRect[property]) > geometryQuantum)
    ) {
      throw new Error('wechat-task-context-hidden-source-rect-not-zero');
    }
  }
  expect(evidence.sourceFinalSemanticMatches).toBe(true);
  expect(evidence.sourceMutations.attributes).toBe(0);
  expect(evidence.sourceMutations.characterData).toBe(0);
  expect(evidence.sourceMutations.childList).toBe(0);
  expect(evidence.sourceMutations.records).toBe(0);
  expect(evidence.sourceMutations.attributeNames).toEqual([]);
  expect(evidence.preHideVisibilityMutations.records).toBeGreaterThan(0);
  expect(evidence.preHideVisibilityMutations.attributeNames).toContain('class');
  expect(evidence.visibilityMutations.records).toBe(0);
  expect(evidence.visibilityMutations.attributes).toBe(0);
  expect(evidence.visibilityMutations.attributeNames).toEqual([]);
  expect(evidence.hosts.length).toBeGreaterThan(0);
  expect(evidence.hosts.every(({ connectedFinal }) => connectedFinal === false)).toBe(true);
  expect(evidence.styleReadCount).toBeGreaterThan(0);
  expect(evidence.phaseEvidence.connectionObserved).toBe(true);
  expect(evidence.phaseEvidence.styleReadObserved).toBe(true);
  expect(evidence.phaseEvidence.terminalStage).toBe('captured-connected-style-read');
  expect(evidence.terminalMeasurementStage).toBe('captured-connected-style-read');
  expect(evidence.measurementSamples.length).toBeGreaterThan(0);
  expect(evidence.measurementSamples.some(({ stage, inputCount }) => (
    stage === 'first-connected-style-read' && inputCount === 19
  ))).toBe(true);
  expect(evidence.factoryReadCount).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.length).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.every((index) => (
    Number.isInteger(index) && index >= 0 && index < 19
  ))).toBe(true);
  expect(evidence.preparedLayoutSignature.measurementInputCount).toBe(19);
  expect(evidence.preparedLayoutSignature.allInputsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.allElementsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.readElementCount).toBeGreaterThan(0);
  expect(Math.abs(evidence.sourceVisibleReference.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  const firstMeasurement = evidence.measurementSamples.find(({ stage }) => (
    stage === 'first-connected-style-read'
  ));
  expect(firstMeasurement).toBeDefined();
  expect(Math.abs(firstMeasurement.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  if (
    evidence.firstDiff
    || evidence.geometryFirstDiff
    || evidence.currentGuardStyleFirstDiff
    || evidence.visiblePaintFirstDiff
  ) {
    throw new Error('wechat-task-context-hidden-geometry-style-mismatch');
  }
}
