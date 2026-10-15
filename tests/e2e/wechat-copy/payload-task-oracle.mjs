// Task-marker semantic and geometry oracle owner.
import { expect } from '@playwright/test';
import { fullCapabilityTaskStates } from "./markdown-fixtures.mjs";
import { intrinsicGeometryTolerance } from "./environment.mjs";
import { assertTaskMarkerPixelParityNegativeCases } from "./payload-pixel-oracle.mjs";

export function assertTaskMarkerSurface(sourceEvidence, targetEvidence, label, themeId) {
  const closeGeometry = (actual, expected, message) => {
    expect(
      Math.abs(actual - expected),
      `${label} ${message}`
    ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
  };
  const cssNumber = (value, message) => {
    const parsed = Number.parseFloat(value);
    expect(Number.isFinite(parsed), `${label} ${message} must be finite`).toBe(true);
    return parsed;
  };
  const boxModelDimensions = (style, axis, message) => {
    const horizontal = axis === 'width';
    const declared = cssNumber(style[axis], `${message} declared ${axis}`);
    const padding = (horizontal
      ? [style.paddingLeft, style.paddingRight]
      : [style.paddingTop, style.paddingBottom])
      .reduce((total, value) => total + (value ?? 0), 0);
    const border = (horizontal
      ? [style.borderLeftWidth, style.borderRightWidth]
      : [style.borderTopWidth, style.borderBottomWidth])
      .reduce((total, value) => total + (value ?? 0), 0);
    const edge = padding + border;
    const borderBox = style.boxSizing === 'border-box' ? declared : declared + edge;
    const contentBox = style.boxSizing === 'border-box' ? declared - edge : declared;
    expect(contentBox, `${label} ${message} content ${axis}`).toBeGreaterThanOrEqual(0);
    return { borderBox, contentBox };
  };
  const transformedPaintDimension = (dimensions, transform, axis, message) => {
    const normalized = transform.trim();
    if (!normalized || normalized === 'none') return dimensions[axis];
    const matrixMatch = normalized.match(/^matrix\(([^)]+)\)$/u);
    const matrix3dMatch = normalized.match(/^matrix3d\(([^)]+)\)$/u);
    let a;
    let b;
    let c;
    let d;
    if (matrixMatch) {
      const values = matrixMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
      [a, b, c, d] = values;
    } else if (matrix3dMatch) {
      const values = matrix3dMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
      [a, b, c, d] = [values[0], values[1], values[4], values[5]];
    } else {
      throw new Error(`${label} ${message} transform unavailable`);
    }
    expect([a, b, c, d].every(Number.isFinite), `${label} ${message} transform finite`).toBe(true);
    return axis === 'width'
      ? Math.abs(a) * dimensions.width + Math.abs(c) * dimensions.height
      : Math.abs(b) * dimensions.width + Math.abs(d) * dimensions.height;
  };
  const compareRelativeBox = (actual, expected, message) => {
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      closeGeometry(actual[edge], expected[edge], `${message} ${edge}`);
    }
  };
  expect(sourceEvidence.markerType, `${label} source marker type`).toBe('source-input');
  expect(sourceEvidence.inputCount, `${label} source input count`).toBe(19);
  expect(sourceEvidence.ownerCount, `${label} source static owner count`).toBe(0);
  expect(sourceEvidence.checkedStates, `${label} source checkbox states`)
    .toEqual(fullCapabilityTaskStates);
  expect(targetEvidence.markerType, `${label} payload marker type`).toBe('static-owner');
  expect(targetEvidence.inputCount, `${label} payload input count`).toBe(0);
  expect(targetEvidence.ownerCount, `${label} payload static owner count`).toBe(19);
  expect(targetEvidence.checkedStates, `${label} payload checkbox states`)
    .toEqual(fullCapabilityTaskStates);
  expect(sourceEvidence.items, `${label} source task count`).toHaveLength(19);
  expect(targetEvidence.items, `${label} payload task count`).toHaveLength(19);
  // Immersive source roots can retain a half CSS pixel from their pane
  // border/padding while the isolated payload uses the integer destination
  // width. Keep the strict tolerance for marker geometry and allow that
  // bounded width-only rounding difference.
  expect(
    Math.abs(targetEvidence.rootContentBox.width - sourceEvidence.rootContentBox.width),
    `${label} root content width`
  ).toBeLessThanOrEqual(0.5);

  for (const sourceItem of sourceEvidence.items) {
    const targetItem = targetEvidence.items[sourceItem.index];
    expect(targetItem, `${label} payload task ${sourceItem.index}`).toBeDefined();
    if (!targetItem) throw new Error(`wechat-native-${label}-task-target-unavailable`);
    expect(sourceItem.connected, `${label} source task ${sourceItem.index} connected`).toBe(true);
    expect(targetItem.connected, `${label} payload task ${sourceItem.index} connected`).toBe(true);
    expect(sourceItem.li.connected, `${label} source li ${sourceItem.index} connected`).toBe(true);
    expect(targetItem.li.connected, `${label} payload li ${sourceItem.index} connected`).toBe(true);
    expect(sourceItem.marker.connected, `${label} source marker ${sourceItem.index} connected`).toBe(true);
    expect(targetItem.marker.connected, `${label} payload marker ${sourceItem.index} connected`).toBe(true);
    expect(targetItem.marker.ariaChecked, `${label} payload aria-checked ${sourceItem.index}`)
      .toBe(sourceItem.checked ? 'true' : 'false');
    expect(targetItem.marker.ariaDisabled, `${label} payload aria-disabled ${sourceItem.index}`)
      .toBe('true');
    expect(targetItem.text.text, `${label} text anchor ${sourceItem.index}`)
      .toBe(sourceItem.text.text);
    closeGeometry(
      targetItem.flowAdvance,
      sourceItem.flowAdvance,
      `task flow advance ${sourceItem.index}`
    );
    closeGeometry(
      targetItem.li.box.height,
      sourceItem.li.box.height,
      `li height ${sourceItem.index}`
    );
    closeGeometry(
      targetItem.li.lineHeight,
      sourceItem.li.lineHeight,
      `li line-height ${sourceItem.index}`
    );
    compareRelativeBox(
      targetItem.text.relativeToLi,
      sourceItem.text.relativeToLi,
      `text anchor ${sourceItem.index}`
    );
    compareRelativeBox(
      {
        bottom: targetItem.marker.box.bottom - targetItem.li.box.top,
        left: targetItem.marker.box.left - targetItem.li.box.left,
        right: targetItem.marker.box.right - targetItem.li.box.left,
        top: targetItem.marker.box.top - targetItem.li.box.top
      },
      {
        bottom: sourceItem.marker.box.bottom - sourceItem.li.box.top,
        left: sourceItem.marker.box.left - sourceItem.li.box.left,
        right: sourceItem.marker.box.right - sourceItem.li.box.left,
        top: sourceItem.marker.box.top - sourceItem.li.box.top
      },
      `marker ${sourceItem.index}`
    );
    closeGeometry(
      targetItem.marker.contentBox.width,
      sourceItem.marker.contentBox.width,
      `marker content width ${sourceItem.index}`
    );
    closeGeometry(
      targetItem.marker.contentBox.height,
      sourceItem.marker.contentBox.height,
      `marker content height ${sourceItem.index}`
    );
    expect(targetItem.marker.style.boxSizing, `${label} marker box sizing ${sourceItem.index}`)
      .toBe(sourceItem.marker.style.boxSizing);
    expect(targetItem.marker.pseudoMarkers, `${label} pseudo marker count ${sourceItem.index}`)
      .toHaveLength(sourceItem.marker.pseudoMarkers.length);
    for (const [pseudoIndex, sourcePseudo] of sourceItem.marker.pseudoMarkers.entries()) {
      const targetPseudo = targetItem.marker.pseudoMarkers[pseudoIndex];
      expect(targetPseudo, `${label} pseudo marker ${sourceItem.index}/${pseudoIndex}`)
        .toBeDefined();
      if (!targetPseudo) throw new Error(`wechat-native-${label}-pseudo-target-unavailable`);
      expect(targetPseudo.style.backgroundColor, `${label} pseudo background ${sourceItem.index}/${pseudoIndex}`)
        .toBe(sourcePseudo.style.backgroundColor);
      expect(targetPseudo.style.transform, `${label} pseudo transform ${sourceItem.index}/${pseudoIndex}`)
        .toBe(sourcePseudo.style.transform);
      expect(targetPseudo.style.opacity, `${label} pseudo opacity ${sourceItem.index}/${pseudoIndex}`)
        .toBe(sourcePseudo.style.opacity);
      for (const property of [
        'borderBottomWidth',
        'borderLeftWidth',
        'borderRightWidth',
        'borderTopWidth'
      ]) {
        if (sourcePseudo.style[property] === null) continue;
        expect(
          targetPseudo.style[property],
          `${label} pseudo ${property} ${sourceItem.index}/${pseudoIndex}`
        ).toBe(sourcePseudo.style[property]);
      }
      const sourceWidth = sourcePseudo.style.width !== 'auto' && sourcePseudo.style.width !== 'none'
        ? boxModelDimensions(
          sourcePseudo.style,
          'width',
          `source pseudo ${sourceItem.index}/${pseudoIndex}`
        )
        : null;
      const targetWidth = sourceWidth
        ? boxModelDimensions(
          targetPseudo.style,
          'width',
          `payload pseudo ${sourceItem.index}/${pseudoIndex}`
        )
        : null;
      const sourceHeight = sourcePseudo.style.height !== 'auto' && sourcePseudo.style.height !== 'none'
        ? boxModelDimensions(
          sourcePseudo.style,
          'height',
          `source pseudo ${sourceItem.index}/${pseudoIndex}`
        )
        : null;
      const targetHeight = sourceHeight
        ? boxModelDimensions(
          targetPseudo.style,
          'height',
          `payload pseudo ${sourceItem.index}/${pseudoIndex}`
        )
        : null;
      const sourcePaint = sourceWidth && sourceHeight
        ? {
          height: transformedPaintDimension(
            { height: sourceHeight.borderBox, width: sourceWidth.borderBox },
            sourcePseudo.style.transform,
            'height',
            `source pseudo ${sourceItem.index}/${pseudoIndex}`
          ),
          width: transformedPaintDimension(
            { height: sourceHeight.borderBox, width: sourceWidth.borderBox },
            sourcePseudo.style.transform,
            'width',
            `source pseudo ${sourceItem.index}/${pseudoIndex}`
          )
        }
        : null;
      if (sourceWidth && targetWidth) {
        closeGeometry(
          targetWidth.contentBox,
          sourceWidth.contentBox,
          `pseudo content width ${sourceItem.index}/${pseudoIndex}`
        );
        closeGeometry(
          targetWidth.borderBox,
          sourceWidth.borderBox,
          `pseudo layout border-box width ${sourceItem.index}/${pseudoIndex}`
        );
        if (sourcePaint) {
          closeGeometry(targetPseudo.box.width, sourcePaint.width,
            `pseudo painted width ${sourceItem.index}/${pseudoIndex}`);
        }
      }
      if (sourceHeight && targetHeight) {
        closeGeometry(
          targetHeight.contentBox,
          sourceHeight.contentBox,
          `pseudo content height ${sourceItem.index}/${pseudoIndex}`
        );
        closeGeometry(
          targetHeight.borderBox,
          sourceHeight.borderBox,
          `pseudo layout border-box height ${sourceItem.index}/${pseudoIndex}`
        );
        if (sourcePaint) {
          closeGeometry(targetPseudo.box.height, sourcePaint.height,
            `pseudo painted height ${sourceItem.index}/${pseudoIndex}`);
        }
      }
    }
  }

  if (themeId === 'default') {
    const first = sourceEvidence.items[0];
    if (!first) throw new Error(`wechat-native-${label}-default-task-unavailable`);
    expect(first.marker.box.width, `${label} Default source marker width`).toBe(16);
    expect(first.marker.marginRight, `${label} Default source marker margin-end`).toBe(4);
    expect(first.flowAdvance, `${label} Default source flow advance`).toBe(20);
  }

  if (themeId === 'phycat-sky') {
    const sourceChecked = sourceEvidence.items.find(({ checked }) => checked);
    const targetChecked = targetEvidence.items.find(({ checked }) => checked);
    if (!sourceChecked || !targetChecked) {
      throw new Error(`wechat-native-${label}-checked-sky-task-unavailable`);
    }
    const sourceAfter = sourceChecked.marker.pseudoMarkers.find(({ pseudo }) => pseudo === '::after');
    const targetAfter = targetChecked.marker.pseudoMarkers[1];
    if (!sourceAfter || !targetAfter) {
      throw new Error(`wechat-native-${label}-sky-check-paint-unavailable`);
    }
    const sourceWidth = boxModelDimensions(sourceAfter.style, 'width', `${label} sky source check`);
    const targetWidth = boxModelDimensions(targetAfter.style, 'width', `${label} sky payload check`);
    expect(sourceAfter.style.boxSizing, `${label} sky source check box sizing`)
      .toBe('content-box');
    expect(targetAfter.style.boxSizing, `${label} sky payload check box sizing`)
      .toBe('border-box');
    expect(targetAfter.style.width, `${label} sky payload converted width`)
      .not.toBe(sourceAfter.style.width);
    const sourceHeight = boxModelDimensions(sourceAfter.style, 'height', `${label} sky source check`);
    closeGeometry(
      targetWidth.borderBox,
      sourceWidth.borderBox,
      `${label} sky check content-box to border-box conversion`
    );
    closeGeometry(
      targetAfter.box.width,
      transformedPaintDimension(
        { height: sourceHeight.borderBox, width: sourceWidth.borderBox },
        sourceAfter.style.transform,
        'width',
        `${label} sky source check`
      ),
      `${label} sky check actual border-box paint`
    );
  }
}

export function assertTaskMarkerPositionStripped(normalEvidence, strippedEvidence, label) {
  expect(strippedEvidence.inputCount, `${label} stripped input count`).toBe(0);
  expect(strippedEvidence.ownerCount, `${label} stripped owner count`).toBe(19);
  expect(strippedEvidence.checkedStates, `${label} stripped checkbox states`)
    .toEqual(fullCapabilityTaskStates);
  for (const normalItem of normalEvidence.items) {
    const strippedItem = strippedEvidence.items[normalItem.index];
    expect(strippedItem, `${label} stripped task ${normalItem.index}`).toBeDefined();
    if (!strippedItem) throw new Error(`wechat-native-${label}-stripped-task-unavailable`);
    expect(strippedItem.marker.style.position, `${label} stripped marker position ${normalItem.index}`)
      .toBe('static');
    expect(strippedItem.marker.pseudoMarkers.every(({ style }) => style.position === 'static'))
      .toBe(true);
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      expect(
        Math.abs(strippedItem.marker.box[edge] - normalItem.marker.box[edge]),
        `${label} stripped marker ${edge} ${normalItem.index}`
      ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
    }
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      expect(
        Math.abs(strippedItem.text.relativeToLi[edge] - normalItem.text.relativeToLi[edge]),
        `${label} stripped text ${edge} ${normalItem.index}`
      ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
    }
    expect(
      Math.abs(strippedItem.li.box.height - normalItem.li.box.height),
      `${label} stripped li height ${normalItem.index}`
    ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
    expect(strippedItem.marker.pseudoMarkers, `${label} stripped pseudo count ${normalItem.index}`)
      .toHaveLength(normalItem.marker.pseudoMarkers.length);
    for (const [pseudoIndex, normalPseudo] of normalItem.marker.pseudoMarkers.entries()) {
      const strippedPseudo = strippedItem.marker.pseudoMarkers[pseudoIndex];
      expect(strippedPseudo, `${label} stripped pseudo ${normalItem.index}/${pseudoIndex}`)
        .toBeDefined();
      if (!strippedPseudo) throw new Error(`wechat-native-${label}-stripped-pseudo-unavailable`);
      for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
        expect(
          Math.abs(strippedPseudo.box[edge] - normalPseudo.box[edge]),
          `${label} stripped pseudo ${edge} ${normalItem.index}/${pseudoIndex}`
        ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
      }
    }
  }
}

export function assertTaskMarkerGeometryProjection(sourceEvidence, targetEvidence, label, themeId) {
  const closeGeometry = (actual, expected, errorCode) => {
    if (
      !Number.isFinite(actual)
      || !Number.isFinite(expected)
      || Math.abs(actual - expected) > intrinsicGeometryTolerance
    ) {
      throw new Error(errorCode);
    }
  };
  const cssNumber = (value, errorCode) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(errorCode);
    return parsed;
  };
  const boxModel = (style, axis) => {
    const horizontal = axis === 'width';
    const declared = cssNumber(style[axis], 'wechat-task-marker-pseudo-dimension-invalid');
    const padding = (horizontal
      ? [style.paddingLeft, style.paddingRight]
      : [style.paddingTop, style.paddingBottom])
      .reduce((total, value) => total + (value ?? 0), 0);
    const border = (horizontal
      ? [style.borderLeftWidth, style.borderRightWidth]
      : [style.borderTopWidth, style.borderBottomWidth])
      .reduce((total, value) => total + (value ?? 0), 0);
    const edge = padding + border;
    const borderBox = style.boxSizing === 'border-box' ? declared : declared + edge;
    const contentBox = style.boxSizing === 'border-box' ? declared - edge : declared;
    if (contentBox < 0) throw new Error('wechat-task-marker-pseudo-content-box-invalid');
    return { borderBox, contentBox };
  };
  const paintDimension = (dimensions, transform, axis) => {
    if (!transform || transform === 'none') return dimensions[axis];
    const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/u);
    const values = matrixMatch
      ? matrixMatch[1].split(',').map((value) => Number.parseFloat(value.trim()))
      : null;
    if (!values || values.length < 4 || !values.slice(0, 4).every(Number.isFinite)) {
      throw new Error('wechat-task-marker-transform-unavailable');
    }
    const [a, b, c, d] = values;
    return axis === 'width'
      ? Math.abs(a) * dimensions.width + Math.abs(c) * dimensions.height
      : Math.abs(b) * dimensions.width + Math.abs(d) * dimensions.height;
  };
  closeGeometry(
    targetEvidence.rootContentBox.width,
    sourceEvidence.rootContentBox.width,
    'wechat-task-marker-root-content-width-mismatch'
  );
  if (!Array.isArray(sourceEvidence.items) || sourceEvidence.items.length !== 19) {
    throw new Error('wechat-task-marker-source-item-count-mismatch');
  }
  if (!Array.isArray(targetEvidence.items) || targetEvidence.items.length !== 19) {
    throw new Error('wechat-task-marker-target-item-count-mismatch');
  }
  for (const sourceItem of sourceEvidence.items) {
    const targetItem = targetEvidence.items[sourceItem.index];
    if (!targetItem) throw new Error('wechat-task-marker-target-item-unavailable');
    closeGeometry(
      targetItem.flowAdvance,
      sourceItem.flowAdvance,
      'wechat-task-marker-flow-advance-mismatch'
    );
  }
  if (themeId !== 'phycat-sky') return;
  const sourceChecked = sourceEvidence.items.find(({ checked }) => checked);
  const targetChecked = targetEvidence.items.find(({ checked }) => checked);
  if (!sourceChecked || !targetChecked) {
    throw new Error('wechat-task-marker-checked-item-unavailable');
  }
  const sourceAfter = sourceChecked.marker.pseudoMarkers.find(({ pseudo }) => pseudo === '::after');
  const targetAfter = targetChecked.marker.pseudoMarkers[1];
  if (!sourceAfter || !targetAfter?.box) {
    throw new Error('wechat-task-marker-pseudo-paint-unavailable');
  }
  const sourceWidth = boxModel(sourceAfter.style, 'width');
  const sourceHeight = boxModel(sourceAfter.style, 'height');
  const targetWidth = boxModel(targetAfter.style, 'width');
  const targetHeight = boxModel(targetAfter.style, 'height');
  closeGeometry(
    targetWidth.contentBox,
    sourceWidth.contentBox,
    'wechat-task-marker-pseudo-content-width-mismatch'
  );
  closeGeometry(
    targetHeight.contentBox,
    sourceHeight.contentBox,
    'wechat-task-marker-pseudo-content-height-mismatch'
  );
  closeGeometry(
    targetWidth.borderBox,
    sourceWidth.borderBox,
    'wechat-task-marker-pseudo-border-width-mismatch'
  );
  closeGeometry(
    targetHeight.borderBox,
    sourceHeight.borderBox,
    'wechat-task-marker-pseudo-border-height-mismatch'
  );
  closeGeometry(
    targetAfter.box.width,
    paintDimension({ height: sourceHeight.borderBox, width: sourceWidth.borderBox }, sourceAfter.style.transform, 'width'),
    'wechat-task-marker-pseudo-paint-width-mismatch'
  );
  closeGeometry(
    targetAfter.box.height,
    paintDimension({ height: sourceHeight.borderBox, width: sourceWidth.borderBox }, sourceAfter.style.transform, 'height'),
    'wechat-task-marker-pseudo-paint-height-mismatch'
  );
}

export function assertTaskMarkerOracleNegativeCases(sourceEvidence, targetEvidence, label, themeId) {
  assertTaskMarkerPixelParityNegativeCases(`${label}/pixel`);
  assertTaskMarkerGeometryProjection(sourceEvidence, targetEvidence, `${label}/baseline`, themeId);
  const expectRejected = (mutation, suffix, expectedError) => {
    const invalidTarget = structuredClone(targetEvidence);
    mutation(invalidTarget);
    let actualError = null;
    try {
      assertTaskMarkerGeometryProjection(sourceEvidence, invalidTarget, `${label}/${suffix}`, themeId);
    } catch (error) {
      actualError = error;
    }
    if (actualError?.message !== expectedError) {
      throw new Error('wechat-task-marker-negative-error-mismatch');
    }
  };

  expectRejected((invalidTarget) => {
    invalidTarget.items[0].flowAdvance += 24;
  }, 'badadvance-shift24', 'wechat-task-marker-flow-advance-mismatch');

  if (themeId !== 'phycat-sky') return;
  const checked = targetEvidence.items.find(({ checked }) => checked);
  if (!checked) throw new Error(`wechat-native-${label}-negative-checked-task-unavailable`);
  const after = checked.marker.pseudoMarkers[1];
  if (!after?.box) throw new Error(`wechat-native-${label}-negative-border-box-unavailable`);
  expectRejected((invalidTarget) => {
    const invalidChecked = invalidTarget.items[checked.index];
    const invalidAfter = invalidChecked?.marker.pseudoMarkers[1];
    if (!invalidAfter?.box) throw new Error(`wechat-native-${label}-negative-border-box-unavailable`);
    invalidAfter.box.width -= 2.5;
    invalidAfter.box.right -= 2.5;
  }, 'badborderbox-minus2_5', 'wechat-task-marker-pseudo-paint-width-mismatch');
}

export function createTaskMarkerLegalProjection(sourceEvidence) {
  const dimension = (style, axis) => {
    const declared = Number.parseFloat(style[axis]);
    if (!Number.isFinite(declared)) return null;
    const horizontal = axis === 'width';
    const padding = (horizontal
      ? [style.paddingLeft, style.paddingRight]
      : [style.paddingTop, style.paddingBottom])
      .reduce((total, value) => total + (value ?? 0), 0);
    const border = (horizontal
      ? [style.borderLeftWidth, style.borderRightWidth]
      : [style.borderTopWidth, style.borderBottomWidth])
      .reduce((total, value) => total + (value ?? 0), 0);
    const borderBox = style.boxSizing === 'border-box' ? declared : declared + padding + border;
    return { borderBox };
  };
  const paint = (width, height, transform) => {
    if (!transform || transform === 'none') return { height, width };
    const match = transform.match(/^matrix\(([^)]+)\)$/u);
    const values = match
      ? match[1].split(',').map((value) => Number.parseFloat(value.trim()))
      : null;
    if (!values || values.length < 4 || !values.slice(0, 4).every(Number.isFinite)) {
      throw new Error('wechat-task-marker-transform-unavailable');
    }
    const [a, b, c, d] = values;
    return {
      height: Math.abs(b) * width + Math.abs(d) * height,
      width: Math.abs(a) * width + Math.abs(c) * height
    };
  };
  const target = structuredClone(sourceEvidence);
  target.items = sourceEvidence.items.map((sourceItem) => ({
    ...sourceItem,
    marker: {
      ...sourceItem.marker,
      pseudoMarkers: sourceItem.marker.pseudoMarkers.map((sourcePseudo) => {
        const width = dimension(sourcePseudo.style, 'width');
        const height = dimension(sourcePseudo.style, 'height');
        const style = {
          ...sourcePseudo.style,
          boxSizing: 'border-box',
          ...(width ? { width: `${width.borderBox}px` } : {}),
          ...(height ? { height: `${height.borderBox}px` } : {})
        };
        const painted = width && height
          ? paint(width.borderBox, height.borderBox, sourcePseudo.style.transform)
          : { height: 0, width: 0 };
        return {
          ...sourcePseudo,
          box: {
            bottom: painted.height,
            height: painted.height,
            left: 0,
            right: painted.width,
            top: 0,
            width: painted.width
          },
          style
        };
      })
    }
  }));
  return target;
}
