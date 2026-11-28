// Stage B measurement-side perturbations: actual input style read, before and
// width probe installation/restoration, and held CDP object release.

import { CDP_BLOOM_INPUT_MATRIX } from "./geometry-measures.mjs";
import { cdpCallFunction } from "./cdp-geometry.mjs";
import { cdpRuntimeEvaluation } from "./cdp-geometry.mjs";
import { geometryQuantum } from "./environment.mjs";
import { releaseCdpObject } from "./cdp-geometry.mjs";

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
