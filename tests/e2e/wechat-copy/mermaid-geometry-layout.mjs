// Mermaid layout and responsive measurement reader.
import { expect } from '@playwright/test';
import { intrinsicGeometryTolerance } from "./environment.mjs";

export async function readGanttLayoutProbe(preview) {
  return preview.evaluate((root) => {
    const mermaids = [...root.querySelectorAll('.easymde-mermaid')];
    const element = mermaids.find((candidate) => (
      candidate.querySelector('svg')?.getAttribute('aria-roledescription')
        ?.trim()
        === 'gantt'
    ));
    const svg = element?.querySelector('svg');
    if (!(element instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      throw new Error('wechat-gantt-layout-probe-unavailable');
    }
    const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
      throw new Error('wechat-gantt-layout-probe-viewbox-invalid');
    }
    const authoredGeometry = (candidate) => ({
      height: candidate.getAttribute('height'),
      parentTransform: candidate.parentElement?.getAttribute('transform') ?? null,
      points: candidate.getAttribute('points'),
      rx: candidate.getAttribute('rx'),
      ry: candidate.getAttribute('ry'),
      transform: candidate.getAttribute('transform'),
      width: candidate.getAttribute('width'),
      x: candidate.getAttribute('x'),
      y: candidate.getAttribute('y')
    });
    const clientBox = (candidate) => {
      const value = candidate.getBoundingClientRect();
      return {
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        top: value.top
      };
    };
    const dateElements = [...svg.querySelectorAll('.grid .tick text')];
    const dateClientBoxes = dateElements.map(clientBox);
    let dateIntersections = 0;
    for (let leftIndex = 0; leftIndex < dateClientBoxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < dateClientBoxes.length; rightIndex += 1) {
        const left = dateClientBoxes[leftIndex];
        const right = dateClientBoxes[rightIndex];
        if (
          left.right > right.left + 0.01
          && right.right > left.left + 0.01
          && left.bottom > right.top + 0.01
          && right.bottom > left.top + 0.01
        ) dateIntersections += 1;
      }
    }
    const computed = getComputedStyle(element);
    const svgRect = svg.getBoundingClientRect();
    const screenCtm = svg.getScreenCTM?.() ?? null;
    return {
      dateClientBoxes,
      dateIntersections,
      dates: dateElements.map(authoredGeometry),
      layout: element.getAttribute('data-easymde-mermaid-layout'),
      milestones: [...svg.querySelectorAll('rect.milestone')].map(authoredGeometry),
      owner: {
        clientWidth: element.clientWidth,
        overflowX: computed.overflowX,
        overflowY: computed.overflowY,
        scrollRange: Math.max(0, element.scrollWidth - element.clientWidth),
        scrollWidth: element.scrollWidth
      },
      svg: {
        ctm: screenCtm && [
          screenCtm.a,
          screenCtm.b,
          screenCtm.c,
          screenCtm.d,
          screenCtm.e,
          screenCtm.f
        ].every((value) => Number.isFinite(value))
          ? {
              a: screenCtm.a,
              b: screenCtm.b,
              c: screenCtm.c,
              d: screenCtm.d,
              e: screenCtm.e,
              f: screenCtm.f
            }
          : null,
        height: svgRect.height,
        width: svgRect.width
      },
      tasks: [...svg.querySelectorAll('rect.task')].map(authoredGeometry),
      viewBox: {
        height: viewBoxValues[3],
        width: viewBoxValues[2],
        x: viewBoxValues[0],
        y: viewBoxValues[1]
      }
    };
  });
}

export async function readIntrinsicMermaidSourceOwnerEvidence(preview, role) {
  return preview.evaluate((root, expectedRole) => {
    const owner = root.querySelector(
      '.easymde-mermaid[data-easymde-mermaid-layout="' + expectedRole + '"]'
    );
    const svg = owner?.querySelector(':scope > svg');
    if (!(owner instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      throw new Error(`wechat-wide-${expectedRole}-source-owner-unavailable`);
    }
    const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
      throw new Error(`wechat-wide-${expectedRole}-source-viewbox-invalid`);
    }
    const finite = (value, name) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-wide-gantt-source-${name}-invalid`);
      return value;
    };
    const pixel = (value) => {
      const normalized = value.trim().toLowerCase();
      if ('auto' === normalized) return { keyword: 'auto', px: null };
      const parsed = Number.parseFloat(normalized);
      return { keyword: null, px: Number.isFinite(parsed) ? parsed : null };
    };
    const typed = (value) => {
      if (!value) return null;
      const primitive = value.value;
      return {
        typeName: value.constructor?.name ?? null,
        value: 'number' === typeof primitive || 'string' === typeof primitive
          ? primitive
          : null,
        toString: 'function' === typeof value.toString ? value.toString() : null
      };
    };
    const rectSnapshot = (rect, label) => ({
      bottom: finite(rect.bottom, `${label}-bottom`),
      height: finite(rect.height, `${label}-height`),
      left: finite(rect.left, `${label}-left`),
      right: finite(rect.right, `${label}-right`),
      top: finite(rect.top, `${label}-top`),
      width: finite(rect.width, `${label}-width`)
    });
    const styleSnapshot = (computed) => ({
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderRadius: computed.borderRadius,
      boxSizing: computed.boxSizing,
      direction: computed.direction,
      fill: computed.fill,
      height: computed.height,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      padding: computed.padding,
      stroke: computed.stroke,
      strokeWidth: computed.strokeWidth,
      width: computed.width
    });
    const ownerRect = owner.getBoundingClientRect();
    const ownerStyle = getComputedStyle(owner);
    const svgRect = svg.getBoundingClientRect();
    const svgStyle = getComputedStyle(svg);
    const contentWidth = ownerRect.width
      - Number.parseFloat(ownerStyle.borderLeftWidth)
      - Number.parseFloat(ownerStyle.borderRightWidth)
      - Number.parseFloat(ownerStyle.paddingLeft)
      - Number.parseFloat(ownerStyle.paddingRight);
    const styleMap = 'function' === typeof svg.computedStyleMap
      ? svg.computedStyleMap()
      : null;
    const screenCtm = svg.getScreenCTM?.() ?? null;
    return {
      margins: {
        typed: styleMap ? {
          left: typed(styleMap.get('margin-left')),
          right: typed(styleMap.get('margin-right'))
        } : null,
        used: {
          left: pixel(svgStyle.marginLeft),
          right: pixel(svgStyle.marginRight)
        }
      },
      root: {
        rect: rectSnapshot(ownerRect, 'owner'),
        style: styleSnapshot(ownerStyle)
      },
      owner: {
        clientWidth: finite(owner.clientWidth, 'owner-client-width'),
        contentWidth: finite(contentWidth, 'owner-content-width'),
        overflowX: ownerStyle.overflowX,
        scrollRange: Math.max(0, owner.scrollWidth - owner.clientWidth),
        scrollWidth: finite(owner.scrollWidth, 'owner-scroll-width'),
        rect: rectSnapshot(ownerRect, 'owner'),
        style: styleSnapshot(ownerStyle)
      },
      svg: {
        ctm: screenCtm && [
          screenCtm.a,
          screenCtm.b,
          screenCtm.c,
          screenCtm.d
        ].every((value) => Number.isFinite(value))
          ? {
              a: screenCtm.a,
              b: screenCtm.b,
              c: screenCtm.c,
              d: screenCtm.d
            }
          : null,
        height: finite(svgRect.height, 'svg-height'),
        left: finite(svgRect.left - ownerRect.left, 'svg-left'),
        right: finite(svgRect.right - ownerRect.left, 'svg-right'),
        rect: rectSnapshot(svgRect, 'svg'),
        style: styleSnapshot(svgStyle),
        viewBox: {
          height: viewBoxValues[3],
          width: viewBoxValues[2],
          x: viewBoxValues[0],
          y: viewBoxValues[1]
        },
        width: finite(svgRect.width, 'svg-width')
      }
    };
  }, role);
}

export async function readGanttSourceOwnerEvidence(preview) {
  return readIntrinsicMermaidSourceOwnerEvidence(preview, 'gantt');
}

export function assertIntrinsicMermaidCtm(label, geometry) {
  const { ctm, height, viewBox, width } = geometry;
  expect(Number.isFinite(width), `${label} rect width finite`).toBe(true);
  expect(Number.isFinite(height), `${label} rect height finite`).toBe(true);
  expect(width, `${label} rect width positive`).toBeGreaterThan(0);
  expect(height, `${label} rect height positive`).toBeGreaterThan(0);
  expect(Number.isFinite(viewBox.width), `${label} viewBox width finite`).toBe(true);
  expect(Number.isFinite(viewBox.height), `${label} viewBox height finite`).toBe(true);
  expect(viewBox.width, `${label} viewBox width positive`).toBeGreaterThan(0);
  expect(viewBox.height, `${label} viewBox height positive`).toBeGreaterThan(0);
  expect(ctm, `${label} CTM available`).not.toBeNull();
  if (!ctm) throw new Error(`wechat-${label}-ctm-unavailable`);
  for (const [axis, value] of Object.entries(ctm)) {
    expect(Number.isFinite(value), `${label} CTM ${axis} finite`).toBe(true);
  }
  expect(ctm.a, `${label} CTM a positive`).toBeGreaterThan(0);
  expect(ctm.d, `${label} CTM d positive`).toBeGreaterThan(0);
  expect(Math.abs(ctm.b), `${label} CTM b`).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(ctm.c), `${label} CTM c`).toBeLessThanOrEqual(1e-6);
  const expectedScale = Math.min(
    width / viewBox.width,
    height / viewBox.height
  );
  expect(Number.isFinite(expectedScale), `${label} expected scale finite`).toBe(true);
  expect(expectedScale, `${label} expected scale positive`).toBeGreaterThan(0);
  const projectedDiagResidual = {
    a: Math.abs(ctm.a - expectedScale) * viewBox.width,
    d: Math.abs(ctm.d - expectedScale) * viewBox.height
  };
  expect(projectedDiagResidual.a, `${label} projected a residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(projectedDiagResidual.d, `${label} projected d residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(width - viewBox.width), `${label} width/viewBox residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(height - viewBox.height), `${label} height/viewBox residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  return { expectedScale, projectedDiagResidual };
}

export function responsiveImageMaxWidth(imageStyle) {
  const match = /(?:^|;)max-width:([0-9]+(?:\.[0-9]+)?)px!important(?:;|$)/u.exec(imageStyle);
  return match ? Number(match[1]) : null;
}

export function assertResponsiveMermaidEvidence({ dpr, live, placement, pngEvidence, role }) {
  const imageStyle = placement.imageStyle ?? '';
  const imageMaxWidth = responsiveImageMaxWidth(imageStyle);
  const responsive = Boolean(
    imageMaxWidth !== null
    && /(?:^|;)width:100%!important(?:;|$)/u.test(imageStyle)
    && /(?:^|;)height:auto!important(?:;|$)/u.test(imageStyle)
  );
  if (!responsive) return null;

  expect(live.role).toBe(role);
  expect(Number.isFinite(live.svg.width), `${role} responsive SVG width finite`).toBe(true);
  expect(Number.isFinite(live.svg.height), `${role} responsive SVG height finite`).toBe(true);
  expect(live.svg.width, `${role} responsive SVG width positive`).toBeGreaterThan(0);
  expect(live.svg.height, `${role} responsive SVG height positive`).toBeGreaterThan(0);
  expect(live.svg.viewBox.width, `${role} responsive viewBox width positive`).toBeGreaterThan(0);
  expect(live.svg.viewBox.height, `${role} responsive viewBox height positive`).toBeGreaterThan(0);
  const expectedSvgHeight = live.svg.width
    * live.svg.viewBox.height
    / live.svg.viewBox.width;
  expect(Math.abs(live.svg.height - expectedSvgHeight), `${role} live SVG aspect`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  const sourceMaxWidth = Number.parseFloat(live.svg.semanticStyle.maxWidth ?? '');
  expect(live.svg.semanticStyle.maxWidth, `${role} responsive source cap CSS unit`)
    .toMatch(/^\d+(?:\.\d+)?px$/u);
  expect(Number.isFinite(sourceMaxWidth), `${role} responsive source cap finite`).toBe(true);
  expect(sourceMaxWidth, `${role} responsive source cap positive`).toBeGreaterThan(0);
  expect(Math.abs(sourceMaxWidth - live.svg.width), `${role} responsive cap reached`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(imageMaxWidth - sourceMaxWidth), `${role} responsive cap retained`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);

  const expectedPixelWidth = Math.ceil(live.svg.width * dpr);
  const expectedPixelHeight = Math.round(
    expectedPixelWidth * live.svg.height / live.svg.width
  );
  expect(pngEvidence.width, `${role} responsive PNG width`).toBe(expectedPixelWidth);
  expect(pngEvidence.height, `${role} responsive PNG height`).toBe(expectedPixelHeight);
  expect(pngEvidence.inkPixels, `${role} responsive PNG ink`).toBeGreaterThan(0);
  expect(pngEvidence.inkBounds, `${role} responsive PNG ink bounds`).not.toBeNull();
  const pixelAspectResidual = Math.abs(
    pngEvidence.height / pngEvidence.width - live.svg.height / live.svg.width
  );
  expect(pixelAspectResidual, `${role} responsive PNG aspect`)
    .toBeLessThanOrEqual(0.5 / expectedPixelWidth + Number.EPSILON);

  expect(placement.ownerDataIgnoreWidth, `${role} responsive root width owner`).toBeNull();
  expect(placement.ownerChildCount, `${role} responsive root child count`).toBe(1);
  expect(placement.ownerDirectImageCount, `${role} responsive direct image count`).toBe(1);
  expect(placement.display, `${role} responsive image display`).toBe('block');
  expect(placement.position, `${role} responsive image position`).toBe('static');
  expect(placement.float, `${role} responsive image float`).toBe('none');
  expect(placement.imageDeclarations['display']?.value, `${role} responsive image display declaration`)
    .toBe('block');
  expect(placement.imageDeclarations['width']?.value, `${role} responsive image width declaration`)
    .toBe('100%');
  expect(placement.imageDeclarations['height']?.value, `${role} responsive image height declaration`)
    .toBe('auto');
  expect(placement.imageDeclarations['margin-left']?.value, `${role} responsive image left margin declaration`)
    .toBe('auto');
  expect(placement.imageDeclarations['margin-right']?.value, `${role} responsive image right margin declaration`)
    .toBe('auto');
  for (const property of ['display', 'height', 'margin-left', 'margin-right', 'max-width', 'width']) {
    expect(placement.imageDeclarations[property]?.priority, `${role} responsive image ${property} priority`)
      .toBe('important');
  }
  expect(placement.ownerDisplay, `${role} responsive root display`)
    .toBe(live.sourceRootStyles.display);
  expect(placement.ownerBoxSizing, `${role} responsive root box sizing`)
    .toBe(live.sourceRootStyles['box-sizing']);
  expect(placement.ownerMaxWidth, `${role} responsive root max width`)
    .toBe(live.sourceRootStyles['max-width']);
  expect(placement.ownerMinWidth, `${role} responsive root min width`)
    .toBe(live.sourceRootStyles['min-width']);
  expect(placement.ownerOverflowX, `${role} responsive root effective overflow-x`)
    .toBe(live.sourceRootStyles['overflow-x']);
  expect(placement.ownerOverflowY, `${role} responsive root effective overflow-y`)
    .toBe(live.sourceRootStyles['overflow-y']);
  expect(placement.ownerTextAlign, `${role} responsive root alignment`)
    .toBe(live.sourceRootStyles['text-align']);
  expect(placement.ownerDirection, `${role} responsive root direction`)
    .toBe(live.sourceRootStyles.direction);
  expect(placement.ownerMarginTop, `${role} responsive root margin-top`)
    .toBe(live.sourceRootStyles['margin-top']);
  expect(placement.ownerMarginRight, `${role} responsive root margin-right`)
    .toBe(live.sourceRootStyles['margin-right']);
  expect(placement.ownerMarginBottom, `${role} responsive root margin-bottom`)
    .toBe(live.sourceRootStyles['margin-bottom']);
  expect(placement.ownerMarginLeft, `${role} responsive root margin-left`)
    .toBe(live.sourceRootStyles['margin-left']);
  expect(placement.ownerPaddingTop, `${role} responsive root padding-top`)
    .toBe(live.sourceRootStyles['padding-top']);
  expect(placement.ownerPaddingRight, `${role} responsive root padding-right`)
    .toBe(live.sourceRootStyles['padding-right']);
  expect(placement.ownerPaddingBottom, `${role} responsive root padding-bottom`)
    .toBe(live.sourceRootStyles['padding-bottom']);
  expect(placement.ownerPaddingLeft, `${role} responsive root padding-left`)
    .toBe(live.sourceRootStyles['padding-left']);
  expect(placement.ownerBorderTopWidth, `${role} responsive root top border width`)
    .toBe(live.sourceRootStyles['border-top-width']);
  expect(placement.ownerBorderRightWidth, `${role} responsive root right border width`)
    .toBe(live.sourceRootStyles['border-right-width']);
  expect(placement.ownerBorderBottomWidth, `${role} responsive root bottom border width`)
    .toBe(live.sourceRootStyles['border-bottom-width']);
  expect(placement.ownerBorderLeftWidth, `${role} responsive root left border width`)
    .toBe(live.sourceRootStyles['border-left-width']);
  expect(placement.ownerBorderTopStyle, `${role} responsive root top border style`)
    .toBe(live.sourceRootStyles['border-top-style']);
  expect(placement.ownerBorderRightStyle, `${role} responsive root right border style`)
    .toBe(live.sourceRootStyles['border-right-style']);
  expect(placement.ownerBorderBottomStyle, `${role} responsive root bottom border style`)
    .toBe(live.sourceRootStyles['border-bottom-style']);
  expect(placement.ownerBorderLeftStyle, `${role} responsive root left border style`)
    .toBe(live.sourceRootStyles['border-left-style']);
  expect(placement.ownerPadding, `${role} responsive root neutral padding`).toBe('0px');
  expect(placement.ownerBorderRadius, `${role} responsive root neutral radius`).toBe('0px');
  expect(placement.ownerBackgroundColor, `${role} responsive root neutral background`)
    .toMatch(/^(?:rgba\(0, ?0, ?0, ?0\)|transparent)$/u);
  const ownerDeclarations = placement.ownerDeclarations ?? {};
  const ownerTypedDimensions = placement.ownerTypedDimensions ?? {};
  const sourceTypedDimensions = live.sourceRootTypedDimensions ?? {};
  for (const property of ['height', 'max-width', 'width']) {
    const sourceProperty = property === 'max-width' ? 'maxWidth' : property;
    expect(ownerTypedDimensions[property], `${role} responsive root ${property} effective TypedOM`)
      .toBe(sourceTypedDimensions[sourceProperty]);
    expect(ownerDeclarations[property]?.value, `${role} responsive root ${property} declaration`)
      .toBe(sourceTypedDimensions[sourceProperty]);
    expect(ownerDeclarations[property]?.priority, `${role} responsive root ${property} priority`)
      .toBe('');
  }
  const expectedDisplayWidth = Math.min(placement.ownerClientWidth, sourceMaxWidth);
  expect(Math.abs(placement.width - expectedDisplayWidth), `${role} responsive display width`)
    .toBeLessThanOrEqual(1.5);
  expect(Math.abs(placement.height - placement.width * live.svg.height / live.svg.width),
    `${role} responsive display aspect`).toBeLessThanOrEqual(1.5);
  expect(Math.abs(
    placement.left - (placement.ownerClientWidth - placement.width) / 2
  ), `${role} responsive centering`).toBeLessThanOrEqual(1.5);
  return {
    capture: 'responsive-viewport',
    expectedPixelHeight,
    expectedPixelWidth,
    imageMaxWidth,
    pixelAspectResidual,
    sourceMaxWidth
  };
}

export async function readMermaidGeometryDiagnostics(preview) {
  return preview.evaluate((root) => [...root.querySelectorAll('.easymde-mermaid')]
    .map((element, ordinal) => {
      const svg = element.querySelector('svg');
      const rect = element.getBoundingClientRect();
      const matrix = svg?.getScreenCTM?.() ?? null;
      const values = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
      const computed = getComputedStyle(element);
      const authored = element.style;
      return {
        ctm: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
          .every((value) => Number.isFinite(value))
          ? {
              a: matrix.a,
              b: matrix.b,
              c: matrix.c,
              d: matrix.d,
              e: matrix.e,
              f: matrix.f
            }
          : null,
        kind: 'mermaid',
        ordinal,
        overflow: {
          authored: {
            all: authored.getPropertyValue('overflow'),
            x: authored.getPropertyValue('overflow-x'),
            y: authored.getPropertyValue('overflow-y')
          },
          computed: {
            all: computed.overflow,
            height: computed.height,
            x: computed.overflowX,
            y: computed.overflowY
          }
        },
        sourceConnected: element.isConnected,
        sourceHeightAttribute: element.getAttribute('height'),
        sourceInlineStyle: element.getAttribute('style'),
        sourceRect: {
          height: rect.height,
          width: rect.width
        },
        viewBox: 4 === values.length && values.every((value) => Number.isFinite(value))
          ? values
          : null
      };
    }));
}
