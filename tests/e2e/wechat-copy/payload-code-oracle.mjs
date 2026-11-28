// Code payload oracle owner.
import { expect } from '@playwright/test';

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
