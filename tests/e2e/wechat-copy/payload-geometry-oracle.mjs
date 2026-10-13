import { expect } from '@playwright/test';
import { fullCapabilityTaskStates } from "./markdown-fixtures.mjs";
import { intrinsicGeometryTolerance } from "./environment.mjs";

export function assertNativeCodeSurface(sourceEvidence, targetEvidence, label, { requireLongLine = true } = {}) {
  const consumeOneTerminalBreak = (value) => value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n') || value.endsWith('\r')
      ? value.slice(0, -1)
      : value;
  const cssPixels = (value, property) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`wechat-native-${property}-not-finite`);
    return parsed;
  };
  const closeTo = (actual, expected, message) => {
    expect(
      Math.abs(actual - expected),
      message
    ).toBeLessThanOrEqual(0.5);
  };
  expect(targetEvidence.markers, `${label} payload ownership markers`).toEqual([]);
  expect(targetEvidence.blocks, `${label} code block count`)
    .toHaveLength(sourceEvidence.blocks.length);
  for (const sourceBlock of sourceEvidence.blocks) {
    const targetBlock = targetEvidence.blocks[sourceBlock.index];
    expect(targetBlock, `${label} code block ${sourceBlock.index}`).toBeDefined();
    expect(targetBlock.text, `${label} code text ${sourceBlock.index}`)
      .toBe(consumeOneTerminalBreak(sourceBlock.text));
    expect(sourceBlock.tokenClassCount, `${label} source token classes ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(targetBlock.characters, `${label} token style vectors ${sourceBlock.index}`)
      .toEqual(sourceBlock.characters);
    expect(targetBlock.frame.style.backgroundColor, `${label} frame background ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.backgroundColor);
    expect(targetBlock.frame.style.borderRadius, `${label} frame radius ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.borderRadius);
    expect(targetBlock.frame.style.boxShadow, `${label} frame shadow ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.boxShadow);
    expect(targetBlock.frame.style.paddingTop, `${label} frame top padding ${sourceBlock.index}`)
      .toBe('0px');
    for (const side of ['paddingRight', 'paddingBottom', 'paddingLeft']) {
      expect(targetBlock.frame.style[side], `${label} frame ${side} ${sourceBlock.index}`)
        .toBe(sourceBlock.frame.style[side]);
    }
    expect(targetBlock.frame.style.opacity, `${label} frame opacity ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.style.opacity);
    expect(
      Math.abs(targetBlock.frame.box.height - sourceBlock.frame.box.height),
      `${label} frame paint height ${sourceBlock.index}`
    ).toBeLessThanOrEqual(0.5);
    expect(targetBlock.code.style.fontFamily, `${label} code font family ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.fontFamily);
    expect(targetBlock.code.style.fontSize, `${label} code font size ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.fontSize);
    expect(targetBlock.code.style.lineHeight, `${label} code line height ${sourceBlock.index}`)
      .toBe(sourceBlock.code.style.lineHeight);
    expect(targetBlock.rows, `${label} intrinsic code rows ${sourceBlock.index}`)
      .toBeDefined();
    const rows = targetBlock.rows;
    if (!rows) throw new Error(`wechat-native-${label}-code-rows-unavailable`);
    expect(rows.style, `${label} code rows style ${sourceBlock.index}`).toMatchObject({
      display: 'block',
      maxWidth: 'none',
      minWidth: '100%',
      overflow: '',
      overflowWrap: 'normal',
      overflowX: '',
      overflowY: '',
      whiteSpace: 'pre',
      width: 'max-content',
      wordBreak: 'normal'
    });
    expect(rows.lineCount, `${label} logical code rows ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(rows.breakCount, `${label} logical row separators ${sourceBlock.index}`)
      .toBe(rows.lineCount - 1);
    expect(rows.box.width, `${label} intrinsic rows width ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.code.contentWidth - 0.5);
    expect(targetBlock.markers, `${label} frame markers ${sourceBlock.index}`)
      .toHaveLength(1);
    const marker = targetBlock.markers[0];
    expect(marker.style.backgroundColor, `${label} marker color ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.backgroundColor);
    expect(marker.style.borderRadius, `${label} marker radius ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.borderRadius);
    expect(marker.style.boxShadow, `${label} marker shadow ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.boxShadow);
    expect(marker.style.opacity, `${label} marker opacity ${sourceBlock.index}`)
      .toBe(sourceBlock.frame.pseudo.opacity);
    expect(marker.box.width, `${label} marker width ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(marker.box.height, `${label} marker height ${sourceBlock.index}`)
      .toBeGreaterThan(0);
    expect(marker.paint.shadowCount, `${label} marker dot shadows ${sourceBlock.index}`)
      .toBe(2);
    expect(marker.paint.left, `${label} marker paint left ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.frame.box.left - 1);
    expect(marker.paint.right, `${label} marker paint right ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.right + 1);
    expect(marker.paint.top, `${label} marker paint top ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.frame.box.top - 1);
    expect(marker.paint.bottom, `${label} marker paint bottom ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.bottom + 1);
    expect(targetBlock.frame.header, `${label} normal-flow frame header ${sourceBlock.index}`)
      .not.toBeNull();
    const header = targetBlock.frame.header;
    if (!header) throw new Error(`wechat-native-${label}-frame-header-unavailable`);
    closeTo(
      header.box.height,
      cssPixels(sourceBlock.frame.style.paddingTop, 'source-frame-padding-top'),
      `${label} header height ${sourceBlock.index}`
    );
    closeTo(
      targetBlock.code.box.top - targetBlock.frame.box.top,
      sourceBlock.code.box.top - sourceBlock.frame.box.top,
      `${label} code offset ${sourceBlock.index}`
    );
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const frameAnchor = edge === 'left' || edge === 'right' ? 'left' : 'top';
      closeTo(
        targetBlock.markers[0].paint[edge] - targetBlock.frame.box[frameAnchor],
        sourceBlock.frame.pseudo.paint[edge] - sourceBlock.frame.box[frameAnchor],
        `${label} marker paint ${edge} ${sourceBlock.index}`
      );
    }
    expect(targetBlock.lastLine.text, `${label} last line text ${sourceBlock.index}`)
      .toBe(sourceBlock.lastLine.text);
    expect(targetBlock.lastLine.lineCount, `${label} line count ${sourceBlock.index}`)
      .toBe(sourceBlock.lastLine.lineCount);
    expect(targetBlock.lastLine.rect.bottom, `${label} last line bottom ${sourceBlock.index}`)
      .toBeLessThanOrEqual(targetBlock.frame.box.bottom + 1);
    expect(targetBlock.lastLine.rect.top, `${label} last line top ${sourceBlock.index}`)
      .toBeGreaterThanOrEqual(targetBlock.code.box.top - 1);
    const sourceLastGlyphGap = sourceBlock.frame.box.bottom - sourceBlock.lastLine.rect.bottom;
    const targetLastGlyphGap = targetBlock.frame.box.bottom - targetBlock.lastLine.rect.bottom;
    expect(
      Math.abs(targetLastGlyphGap - sourceLastGlyphGap),
      `${label} last glyph frame gap ${sourceBlock.index}`
    ).toBeLessThanOrEqual(0.5);
    expect(targetBlock.overflow.root, `${label} article overflow ${sourceBlock.index}`)
      .toBeLessThanOrEqual(1);
    if (requireLongLine && sourceBlock.index === 0) {
      expect(targetBlock.overflow.owner, `${label} long-line overflow owner`)
        .toMatch(/^(?:pre|code)$/u);
    }
  }
}

export function assertNativeCodePayloadMatches(referenceEvidence, targetEvidence, label) {
  const closeTo = (actual, expected, message) => {
    expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(1);
  };
  const compareBox = (reference, target, boxLabel) => {
    expect(reference, `${label} reference ${boxLabel}`).not.toBeNull();
    expect(target, `${label} target ${boxLabel}`).not.toBeNull();
    if (!reference || !target) throw new Error(`wechat-native-${label}-${boxLabel}-unavailable`);
    closeTo(target.width, reference.width, `${label} ${boxLabel} width`);
    closeTo(target.height, reference.height, `${label} ${boxLabel} height`);
  };
  expect(targetEvidence.markers, `${label} payload ownership markers`)
    .toEqual(referenceEvidence.markers);
  expect(targetEvidence.blocks, `${label} code block count`)
    .toHaveLength(referenceEvidence.blocks.length);
  expect(
    targetEvidence.root.overflow.scrollWidth - targetEvidence.root.overflow.clientWidth,
    `${label} root horizontal overflow`
  ).toBeLessThanOrEqual(1);
  closeTo(targetEvidence.root.box.width, referenceEvidence.root.box.width, `${label} root width`);
  for (const referenceBlock of referenceEvidence.blocks) {
    const targetBlock = targetEvidence.blocks[referenceBlock.index];
    expect(targetBlock, `${label} code block ${referenceBlock.index}`).toBeDefined();
    if (!targetBlock) throw new Error(`wechat-native-${label}-code-block-unavailable`);
    expect(targetBlock.text, `${label} code text ${referenceBlock.index}`)
      .toBe(referenceBlock.text);
    expect(targetBlock.characters, `${label} token styles ${referenceBlock.index}`)
      .toEqual(referenceBlock.characters);
    expect(targetBlock.frame.style, `${label} frame style ${referenceBlock.index}`)
      .toEqual(referenceBlock.frame.style);
    expect(targetBlock.code.style, `${label} code style ${referenceBlock.index}`)
      .toEqual(referenceBlock.code.style);
    compareBox(referenceBlock.frame.box, targetBlock.frame.box, `frame-${referenceBlock.index}`);
    compareBox(referenceBlock.code.box, targetBlock.code.box, `code-${referenceBlock.index}`);
    closeTo(
      targetBlock.code.box.top - targetBlock.frame.box.top,
      referenceBlock.code.box.top - referenceBlock.frame.box.top,
      `${label} code top offset ${referenceBlock.index}`
    );
    expect(targetBlock.frame.header?.style ?? null, `${label} header style ${referenceBlock.index}`)
      .toEqual(referenceBlock.frame.header?.style ?? null);
    compareBox(
      referenceBlock.frame.header?.box ?? null,
      targetBlock.frame.header?.box ?? null,
      `header-${referenceBlock.index}`
    );
    expect(targetBlock.markers, `${label} marker count ${referenceBlock.index}`)
      .toHaveLength(referenceBlock.markers.length);
    for (const [markerIndex, referenceMarker] of referenceBlock.markers.entries()) {
      const targetMarker = targetBlock.markers[markerIndex];
      expect(targetMarker, `${label} marker ${referenceBlock.index}/${markerIndex}`).toBeDefined();
      if (!targetMarker) throw new Error(`wechat-native-${label}-marker-unavailable`);
      expect(targetMarker.style, `${label} marker style ${referenceBlock.index}/${markerIndex}`)
        .toEqual(referenceMarker.style);
      compareBox(
        referenceMarker.box,
        targetMarker.box,
        `marker-${referenceBlock.index}-${markerIndex}`
      );
      for (const edge of ['left', 'right', 'top', 'bottom']) {
        const frameAnchor = 'left' === edge || 'right' === edge ? 'left' : 'top';
        closeTo(
          targetMarker.paint[edge] - targetBlock.frame.box[frameAnchor],
          referenceMarker.paint[edge] - referenceBlock.frame.box[frameAnchor],
          `${label} marker paint ${edge} ${referenceBlock.index}/${markerIndex}`
        );
      }
    }
    expect(targetBlock.lastLine.text, `${label} last line text ${referenceBlock.index}`)
      .toBe(referenceBlock.lastLine.text);
    expect(targetBlock.lastLine.lineCount, `${label} line count ${referenceBlock.index}`)
      .toBe(referenceBlock.lastLine.lineCount);
    expect(targetBlock.overflow.owner, `${label} scroll owner ${referenceBlock.index}`)
      .toBe(referenceBlock.overflow.owner);
    expect(targetBlock.overflow.root, `${label} block root overflow ${referenceBlock.index}`)
      .toBeLessThanOrEqual(1);
    if (0 === referenceBlock.index) {
      expect(targetBlock.overflow.owner, `${label} long-line overflow owner`)
        .toMatch(/^(?:pre|code)$/u);
    }
  }
}

export function assertNativeArticleSurface(sourceEvidence, targetEvidence, label) {
  for (const property of [
    'anchors',
    'codeBlocks',
    'headingLevels',
    'headings',
    'inlineCode',
    'links',
    'orderedLists',
    'svg',
    'tables',
    'tableColumnCounts',
    'taskCheckboxes',
    'unorderedLists'
  ]) {
    expect(targetEvidence.elements[property], `${label} ${property}`)
      .toEqual(sourceEvidence.elements[property]);
  }
  expect(sourceEvidence.elements.quoteTextPresent, `${label} source quote sentinel`)
    .toBe(true);
  expect(targetEvidence.elements.quoteTextPresent, `${label} payload quote sentinel`)
    .toBe(true);
  expect(targetEvidence.root.overflow.scrollWidth - targetEvidence.root.overflow.clientWidth,
    `${label} root horizontal overflow`).toBeLessThanOrEqual(1);
  expect(targetEvidence.root.box.width, `${label} root width`).toBeGreaterThan(0);
  assertNativeCodeSurface(sourceEvidence, targetEvidence, label, { requireLongLine: false });
}

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
  closeGeometry(
    targetEvidence.rootContentBox.width,
    sourceEvidence.rootContentBox.width,
    'root content width'
  );

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

export function assertTaskMarkerPixelPaint(pixels, label) {
  expect(pixels.results, `${label} marker pixel results`).toHaveLength(19);
  for (const result of pixels.results) {
    expect(result.inkPixels, `${label} marker ${result.markerIndex} painted pixels`)
      .toBeGreaterThan(0);
    expect(result.inkBounds, `${label} marker ${result.markerIndex} paint bounds`).not.toBeNull();
  }
}

export function assertTaskMarkerPixelParity(sourcePixels, payloadPixels, strippedPixels, label) {
  expect(sourcePixels.results, `${label} source marker pixel results`).toHaveLength(19);
  expect(payloadPixels.results, `${label} payload marker pixel results`).toHaveLength(19);
  expect(strippedPixels.results, `${label} stripped marker pixel results`).toHaveLength(19);
  for (const source of sourcePixels.results) {
    const payload = payloadPixels.results[source.markerIndex];
    const stripped = strippedPixels.results[source.markerIndex];
    expect(payload, `${label} payload marker ${source.markerIndex}`).toBeDefined();
    expect(stripped, `${label} stripped marker ${source.markerIndex}`).toBeDefined();
    if (!payload || !stripped) throw new Error(`wechat-task-marker-${label}-pixel-result-unavailable`);
    expect(source.inkPixels, `${label} source/payload ink ${source.markerIndex}`)
      .toBe(payload.inkPixels);
    expect({
      height: payload.inkBounds?.height,
      width: payload.inkBounds?.width
    }, `${label} payload bounds ${source.markerIndex}`).toEqual({
      height: source.inkBounds?.height,
      width: source.inkBounds?.width
    });
    expect(stripped.inkBounds, `${label} stripped bounds ${source.markerIndex}`)
      .toEqual(payload.inkBounds);
    expect(stripped.inkPixels, `${label} stripped ink ${source.markerIndex}`)
      .toBe(payload.inkPixels);
    expect(stripped.pixelHash, `${label} stripped pixels ${source.markerIndex}`)
      .toBe(payload.pixelHash);
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

export function assertMdmdtLinkDecorationEvidence(decorations, label) {
  expect(decorations, `${label} STYLE-LINK decoration count`).toHaveLength(1);
  const decoration = decorations[0];
  expect(decoration.markerCount, `${label} marker count`).toBe(1);
  expect(decoration.markerImageCount, `${label} marker image count`).toBe(1);
  expect(decoration.srcPrefix, `${label} image MIME`).toBe('data:image/png;base64,');
  expect(decoration.imageNaturalWidth, `${label} image natural width`).toBe(200);
  expect(decoration.imageNaturalHeight, `${label} image natural height`).toBe(200);
  expect(decoration.text, `${label} visible link text`).toBe('STYLE-LINK');
  expect(decoration.rootOverflow, `${label} root overflow`).toBeLessThanOrEqual(1);
  for (const [name, box] of [
    ['marker', decoration.markerBox],
    ['image', decoration.imageBox]
  ]) {
    expect(box, `${label} ${name} box`).not.toBeNull();
    if (!box) throw new Error(`wechat-mdmdt-${label}-${name}-box-unavailable`);
    expect(Math.abs(box.width - 14), `${label} ${name} width`).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 14), `${label} ${name} height`).toBeLessThanOrEqual(1);
  }
  if (!decoration.markerBox || !decoration.imageBox) {
    throw new Error(`wechat-mdmdt-${label}-image-geometry-unavailable`);
  }
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    expect(
      Math.abs(decoration.imageBox[edge] - decoration.markerBox[edge]),
      `${label} image ${edge} alignment`
    ).toBeLessThanOrEqual(1);
  }
}

export function assertNativeVisualSignatures(sourceEvidence, targetEvidence, label) {
  const sourceSignatures = sourceEvidence.visualSignatures ?? [];
  const targetById = new Map(
    (targetEvidence.visualSignatures ?? []).map((signature) => [signature.id, signature])
  );
  expect(targetById.size, `${label} visual signature count`).toBe(sourceSignatures.length);
  for (const sourceSignature of sourceSignatures) {
    const targetSignature = targetById.get(sourceSignature.id);
    expect(targetSignature, `${label} visual signature ${sourceSignature.id}`).toBeDefined();
    if (!targetSignature) throw new Error(`wechat-native-${label}-visual-signature-unavailable`);
    expect(targetSignature.kind, `${label} visual kind ${sourceSignature.id}`)
      .toBe(sourceSignature.kind);
    expect(targetSignature.ownerHasAnchor, `${label} visual anchor owner ${sourceSignature.id}`)
      .toBe(sourceSignature.ownerHasAnchor);
    if (sourceSignature.ownerHasAnchor) {
      expect(targetSignature.ownerTag, `${label} visual owner tag ${sourceSignature.id}`)
        .toBe(sourceSignature.ownerTag);
    }
    expect(targetSignature.textLength, `${label} visual text length ${sourceSignature.id}`)
      .toBe(sourceSignature.textLength);
    expect(targetSignature.style, `${label} visual style ${sourceSignature.id}`)
      .toEqual(sourceSignature.style);
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      expect(
        Number.isFinite(targetSignature.paint[edge]),
        `${label} visual paint ${sourceSignature.id}/${edge}`
      ).toBe(true);
    }
  }
}

export function assertPositionStrippedCodeSurface(normalEvidence, strippedEvidence, label) {
  expect(strippedEvidence.markers, `${label} stripped payload ownership markers`).toEqual([]);
  expect(strippedEvidence.blocks, `${label} stripped code block count`)
    .toHaveLength(normalEvidence.blocks.length);
  for (const normalBlock of normalEvidence.blocks) {
    const strippedBlock = strippedEvidence.blocks[normalBlock.index];
    expect(strippedBlock, `${label} stripped code block ${normalBlock.index}`).toBeDefined();
    if (!strippedBlock) throw new Error(`wechat-native-${label}-stripped-code-block-unavailable`);
    expect(strippedBlock.text, `${label} stripped code text ${normalBlock.index}`)
      .toBe(normalBlock.text);
    expect(strippedBlock.characters, `${label} stripped token style vectors ${normalBlock.index}`)
      .toEqual(normalBlock.characters);
    for (const part of ['frame', 'code']) {
      for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
        expect(
          Math.abs(strippedBlock[part].box[edge] - normalBlock[part].box[edge]),
          `${label} stripped ${part} ${edge} ${normalBlock.index}`
        ).toBeLessThanOrEqual(0.5);
      }
    }
    expect(strippedBlock.frame.header, `${label} stripped normal-flow header ${normalBlock.index}`)
      .not.toBeNull();
    expect(normalBlock.frame.header, `${label} normal-flow header ${normalBlock.index}`)
      .not.toBeNull();
    const normalHeader = normalBlock.frame.header;
    const strippedHeader = strippedBlock.frame.header;
    if (!normalHeader || !strippedHeader) {
      throw new Error(`wechat-native-${label}-stripped-frame-header-unavailable`);
    }
    for (const edge of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      expect(
        Math.abs(strippedHeader.box[edge] - normalHeader.box[edge]),
        `${label} stripped header ${edge} ${normalBlock.index}`
      ).toBeLessThanOrEqual(0.5);
    }
    const normalMarker = normalBlock.markers[0];
    const strippedMarker = strippedBlock.markers[0];
    expect(strippedBlock.markers, `${label} stripped frame markers ${normalBlock.index}`)
      .toHaveLength(1);
    if (!normalMarker || !strippedMarker) {
      throw new Error(`wechat-native-${label}-stripped-marker-unavailable`);
    }
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      expect(
        Math.abs(
          (strippedMarker.paint[edge] - strippedBlock.frame.box[edge])
          - (normalMarker.paint[edge] - normalBlock.frame.box[edge])
        ),
        `${label} stripped marker paint ${edge} ${normalBlock.index}`
      ).toBeLessThanOrEqual(0.5);
    }
    expect(strippedBlock.frame.style.paddingTop, `${label} stripped frame top padding ${normalBlock.index}`)
      .toBe(normalBlock.frame.style.paddingTop);
  }
}
