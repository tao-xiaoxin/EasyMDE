// Article and decoration oracle owner.
import { expect } from '@playwright/test';
import { assertNativeCodeSurface } from "./payload-code-oracle.mjs";

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
