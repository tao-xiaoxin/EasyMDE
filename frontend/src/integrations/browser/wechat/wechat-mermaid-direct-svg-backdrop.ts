import {
  type WechatVisualMermaidBackground,
  type WechatVisualRasterizationMermaidCapture,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  hasVisibleBackgroundColor,
  isOpaqueBackgroundColor,
  parseCssOpacity,
  parseCssSolidColor,
} from './wechat-css-color';
import {
  type MermaidComputedStyleReader,
  applyMermaidBackground,
  hasBackgroundImage,
  hasNonZeroBorderRadius,
  inlineConnectedMermaidRootPaint,
  isSafeBackgroundImage,
  resolveMermaidBorderRadii,
  resolveMermaidInheritedBackground,
  stripMermaidBorderRadius,
} from './wechat-mermaid-background';
import {
  type MermaidCornerRadii,
  type MermaidViewBox,
  mermaidViewBox,
} from './wechat-mermaid-policy';
import { normalizeResponsiveMermaidCaptureSvg } from './wechat-rasterizer-mermaid';

const SVG_NAMESPACE = ['http:', '', 'www.w3.org', '2000/svg'].join('/');

const NON_RENDERED_SVG_DIRECT_CHILDREN = new Set([
  'defs',
  'desc',
  'metadata',
  'title',
]);

export type OwnDirectSvgPaint = Readonly<{
  color: string;
  hasImage: boolean;
  safeImage: string;
  visibleColor: string;
}>;

export type DirectSvgCaptureInspection = Readonly<{
  directSvgOpacity: number;
  hoistOpacity: boolean;
  isolateRoundedTranslucentFill: boolean;
  needsForeignObject: boolean;
  ownDirectSvgPaint: OwnDirectSvgPaint;
  ownDirectSvgRadii: MermaidCornerRadii | null;
  ownHasNonZeroRadius: boolean;
}>;

type ParsedPreserveAspectRatio =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      alignXFactor: number;
      alignYFactor: number;
      kind: 'uniform';
      meetOrSlice: 'meet' | 'slice';
    }>;

export type DirectSvgViewportMapping = Readonly<{
  sx: number;
  sy: number;
  vpH: number;
  vpW: number;
  vpX: number;
  vpY: number;
}>;

const DEFAULT_PRESERVE_ASPECT_RATIO: ParsedPreserveAspectRatio = {
  alignXFactor: 0.5,
  alignYFactor: 0.5,
  kind: 'uniform',
  meetOrSlice: 'meet',
};

function alignmentFactor(token: string): number {
  if ('Min' === token) return 0;
  if ('Max' === token) return 1;
  return 0.5;
}

export function parseSvgPreserveAspectRatio(rawValue: string | null): ParsedPreserveAspectRatio {
  const trimmed = rawValue?.trim() ?? '';
  if (!trimmed) return DEFAULT_PRESERVE_ASPECT_RATIO;
  const tokens = trimmed.split(/\s+/u).filter(Boolean);
  if ('defer' === tokens[0]) {
    tokens.shift();
  }
  const align = tokens[0];
  if (!align) return DEFAULT_PRESERVE_ASPECT_RATIO;
  if ('none' === align && 1 === tokens.length) {
    return { kind: 'none' };
  }
  const alignMatch = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/u.exec(align);
  if (!alignMatch || tokens.length > 2) {
    return DEFAULT_PRESERVE_ASPECT_RATIO;
  }
  const meetOrSliceToken = tokens[1];
  if (
    undefined !== meetOrSliceToken
    && 'meet' !== meetOrSliceToken
    && 'slice' !== meetOrSliceToken
  ) {
    return DEFAULT_PRESERVE_ASPECT_RATIO;
  }
  return {
    alignXFactor: alignmentFactor(alignMatch[1] ?? 'Mid'),
    alignYFactor: alignmentFactor(alignMatch[2] ?? 'Mid'),
    kind: 'uniform',
    meetOrSlice: 'slice' === meetOrSliceToken ? 'slice' : 'meet',
  };
}

/**
 * Projects the CSS box `[0..cssWidth, 0..cssHeight]` back into SVG `viewBox`
 * user coordinates according to the `<svg>`'s `preserveAspectRatio` attribute.
 */
export function resolveDirectSvgViewportMapping(
  svg: SVGSVGElement,
  viewBox: MermaidViewBox,
  cssWidth: number,
  cssHeight: number,
): DirectSvgViewportMapping {
  const parsed = parseSvgPreserveAspectRatio(svg.getAttribute('preserveAspectRatio'));
  if ('none' === parsed.kind) {
    return {
      sx: viewBox.width / cssWidth,
      sy: viewBox.height / cssHeight,
      vpH: viewBox.height,
      vpW: viewBox.width,
      vpX: viewBox.minX,
      vpY: viewBox.minY,
    };
  }
  const u = 'slice' === parsed.meetOrSlice
    ? Math.max(cssWidth / viewBox.width, cssHeight / viewBox.height)
    : Math.min(cssWidth / viewBox.width, cssHeight / viewBox.height);
  const vpW = cssWidth / u;
  const vpH = cssHeight / u;
  return {
    sx: 1 / u,
    sy: 1 / u,
    vpH,
    vpW,
    vpX: viewBox.minX - (vpW - viewBox.width) * parsed.alignXFactor,
    vpY: viewBox.minY - (vpH - viewBox.height) * parsed.alignYFactor,
  };
}

export function resolveAppliedMermaidBackground(
  source: Element,
  readComputedStyle: MermaidComputedStyleReader,
  inheritedBackground?: WechatVisualMermaidBackground | null,
): WechatVisualMermaidBackground | null {
  if (undefined !== inheritedBackground) {
    return inheritedBackground;
  }
  return resolveMermaidInheritedBackground(source, readComputedStyle);
}

function readDirectSvgEffectiveStyle(
  source: SVGSVGElement,
  readComputedStyle: MermaidComputedStyleReader,
): CSSStyleDeclaration {
  return source.isConnected ? readComputedStyle(source) : source.style;
}

export function readOwnDirectSvgPaint(
  source: SVGSVGElement,
  readComputedStyle: MermaidComputedStyleReader,
): OwnDirectSvgPaint {
  let rawColor = '';
  let rawImage = '';
  if (source.isConnected) {
    const style = readComputedStyle(source);
    rawColor = style.getPropertyValue('background-color').trim() || style.backgroundColor?.trim() || '';
    rawImage = style.getPropertyValue('background-image').trim() || style.backgroundImage?.trim() || '';
  } else {
    rawColor = source.style.getPropertyValue('background-color').trim();
    rawImage = source.style.getPropertyValue('background-image').trim();
  }
  return {
    color: rawColor,
    hasImage: hasBackgroundImage(rawImage),
    safeImage: isSafeBackgroundImage(rawImage) ? rawImage : '',
    visibleColor: hasVisibleBackgroundColor(rawColor) ? rawColor : '',
  };
}

export function readDirectSvgEffectiveOpacity(
  source: SVGSVGElement,
  readComputedStyle: MermaidComputedStyleReader,
): number {
  const style = readDirectSvgEffectiveStyle(source, readComputedStyle);
  const cssOpacity = parseCssOpacity(
    style.getPropertyValue('opacity').trim() || style.opacity?.trim() || '',
  );
  if (cssOpacity !== null) return cssOpacity;
  const attributeOpacity = parseCssOpacity(source.getAttribute('opacity') ?? '');
  if (attributeOpacity !== null) return attributeOpacity;
  return 1;
}

export function inspectDirectSvgCapture(
  source: SVGSVGElement,
  readComputedStyle: MermaidComputedStyleReader,
  cssWidth: number,
  cssHeight: number,
): DirectSvgCaptureInspection {
  const ownDirectSvgPaint = readOwnDirectSvgPaint(source, readComputedStyle);
  const ownDirectSvgStyle = readDirectSvgEffectiveStyle(source, readComputedStyle);
  const ownHasNonZeroRadius = hasNonZeroBorderRadius(ownDirectSvgStyle, source);
  const ownDirectSvgRadii = ownHasNonZeroRadius
    ? resolveMermaidBorderRadii(ownDirectSvgStyle, source, cssWidth, cssHeight)
    : null;
  const directSvgOpacity = readDirectSvgEffectiveOpacity(source, readComputedStyle);
  const hoistOpacity = directSvgOpacity < 1;
  const ownVisibleTranslucentColor =
    Boolean(ownDirectSvgPaint.visibleColor)
    && !isOpaqueBackgroundColor(ownDirectSvgPaint.color);
  const isolateRoundedTranslucentFill =
    !hoistOpacity
    && ownHasNonZeroRadius
    && ownVisibleTranslucentColor
    && !ownDirectSvgPaint.safeImage;
  const isolateRoundedSafeImage =
    !hoistOpacity
    && ownHasNonZeroRadius
    && Boolean(ownDirectSvgPaint.safeImage)
    && !isOpaqueBackgroundColor(ownDirectSvgPaint.color);
  // Unparseable non-zero border-radius (such as calc(...) or 1rem on detached
  // clones) combined with reduced opacity or a translucent own fill cannot be
  // approximated by a square <rect>; likewise, a direct <svg> with a safe own
  // background-image (such as a CSS gradient) at opacity < 1 or with a non-zero
  // border-radius and non-opaque background-color cannot be expressed as a
  // solid SVG fill while resolveMermaidInheritedBackground omits source. Route
  // these cases through <foreignObject> so the browser CSS engine renders the
  // inner <svg>'s own paint, border-radius, and opacity over the unattenuated
  // square ancestor backdrop.
  const needsForeignObject =
    (ownHasNonZeroRadius && !ownDirectSvgRadii && (hoistOpacity || isolateRoundedTranslucentFill))
    || isolateRoundedSafeImage
    || (hoistOpacity && directSvgOpacity > 0 && Boolean(ownDirectSvgPaint.safeImage));
  return {
    directSvgOpacity,
    hoistOpacity,
    isolateRoundedTranslucentFill,
    needsForeignObject,
    ownDirectSvgPaint,
    ownDirectSvgRadii,
    ownHasNonZeroRadius,
  };
}

function formatSvgCoord(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function createDirectSvgBackgroundShape(
  document: Document,
  svg: SVGSVGElement,
  viewBox: MermaidViewBox,
  fill: string,
  radii: MermaidCornerRadii | null,
  cssWidth: number,
  cssHeight: number,
): Element {
  const { sx, sy, vpH, vpW, vpX, vpY } = resolveDirectSvgViewportMapping(
    svg,
    viewBox,
    cssWidth,
    cssHeight,
  );
  const n = formatSvgCoord;
  let shape: Element;
  if (radii) {
    const scaled = radii.map(([rx, ry]) => [rx * sx, ry * sy] as const) as unknown as MermaidCornerRadii;
    const lim = (side: number, sum: number): number => (sum > 0 ? side / sum : Number.POSITIVE_INFINITY);
    const f = Math.min(
      1,
      lim(vpW, scaled[0][0] + scaled[1][0]),
      lim(vpW, scaled[3][0] + scaled[2][0]),
      lim(vpH, scaled[0][1] + scaled[3][1]),
      lim(vpH, scaled[1][1] + scaled[2][1]),
    );
    const [[tlX, tlY], [trX, trY], [brX, brY], [blX, blY]] = scaled.map(
      ([rx, ry]) => [rx * f, ry * f] as const,
    ) as unknown as MermaidCornerRadii;
    const x0 = vpX;
    const y0 = vpY;
    const x1 = x0 + vpW;
    const y1 = y0 + vpH;
    const arc = (rx: number, ry: number, x: number, y: number): string =>
      rx > 0 && ry > 0 ? ` A ${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y)}` : '';
    const d = `M ${n(x0 + tlX)} ${n(y0)} H ${n(x1 - trX)}${arc(trX, trY, x1, y0 + trY)}`
      + ` V ${n(y1 - brY)}${arc(brX, brY, x1 - brX, y1)}`
      + ` H ${n(x0 + blX)}${arc(blX, blY, x0, y1 - blY)}`
      + ` V ${n(y0 + tlY)}${arc(tlX, tlY, x0 + tlX, y0)} Z`;
    shape = document.createElementNS(SVG_NAMESPACE, 'path');
    shape.setAttribute('d', d);
  } else {
    shape = document.createElementNS(SVG_NAMESPACE, 'rect');
    shape.setAttribute('x', n(vpX));
    shape.setAttribute('y', n(vpY));
    shape.setAttribute('width', n(vpW));
    shape.setAttribute('height', n(vpH));
  }
  shape.setAttribute('fill', fill);
  shape.setAttribute('fill-opacity', '1');
  shape.setAttribute('stroke', 'none');
  return shape;
}

function directSvgBackgroundMatchesOwnOpaquePaint(
  ownPaint: OwnDirectSvgPaint,
  applied: WechatVisualMermaidBackground | null | undefined,
): boolean {
  if (!applied || !isOpaqueBackgroundColor(ownPaint.color)) return false;
  const appliedSafeImage =
    'string' === typeof applied.image && isSafeBackgroundImage(applied.image)
      ? applied.image.trim()
      : '';
  if (appliedSafeImage !== ownPaint.safeImage) return false;
  const appliedColor = applied.color?.trim() ?? '';
  if (!appliedColor) return false;
  const parsedOwn = parseCssSolidColor(ownPaint.color);
  const parsedApplied = parseCssSolidColor(appliedColor);
  if (parsedOwn && parsedApplied) {
    return (
      Math.round(parsedOwn.r) === Math.round(parsedApplied.r)
      && Math.round(parsedOwn.g) === Math.round(parsedApplied.g)
      && Math.round(parsedOwn.b) === Math.round(parsedApplied.b)
      && parsedOwn.a >= 1 - 1e-6
      && parsedApplied.a >= 1 - 1e-6
    );
  }
  return ownPaint.color.trim().toLowerCase() === appliedColor.toLowerCase();
}

export type BuildDirectSvgWithBackdropParams = Readonly<{
  cssHeight: number;
  cssWidth: number;
  document: Document;
  inheritedBackground?: WechatVisualMermaidBackground | null | undefined;
  inlineSvgStyles: (source: SVGSVGElement, clone: SVGSVGElement) => void;
  inspection: DirectSvgCaptureInspection;
  layoutMagnification: number;
  mermaidCapture?: WechatVisualRasterizationMermaidCapture | undefined;
  outputHeight: number;
  outputWidth: number;
  readComputedStyle: MermaidComputedStyleReader;
  source: SVGSVGElement;
}>;

export function buildDirectSvgWithBackdrop(
  params: BuildDirectSvgWithBackdropParams,
): SVGSVGElement {
  const {
    cssHeight,
    cssWidth,
    document,
    inheritedBackground,
    inlineSvgStyles,
    inspection,
    layoutMagnification,
    mermaidCapture,
    outputHeight,
    outputWidth,
    readComputedStyle,
    source,
  } = params;
  const {
    directSvgOpacity,
    hoistOpacity,
    isolateRoundedTranslucentFill,
    ownDirectSvgPaint,
    ownDirectSvgRadii,
  } = inspection;
  const svg = source.cloneNode(true) as SVGSVGElement;
  inlineSvgStyles(source, svg);
  inlineConnectedMermaidRootPaint(
    source,
    svg,
    readComputedStyle,
    { includeBackground: false },
  );
  const resolvedBackground = resolveAppliedMermaidBackground(
    source,
    readComputedStyle,
    inheritedBackground,
  );
  const hasAppliedBackground = applyMermaidBackground(svg, resolvedBackground);
  const emitOwnBackgroundShape =
    (hoistOpacity && directSvgOpacity > 0 && Boolean(ownDirectSvgPaint.visibleColor))
    || isolateRoundedTranslucentFill;
  if (
    emitOwnBackgroundShape
    || (
      hasAppliedBackground
      && (
        hoistOpacity
        || !directSvgBackgroundMatchesOwnOpaquePaint(ownDirectSvgPaint, resolvedBackground)
      )
    )
  ) {
    stripMermaidBorderRadius(svg);
  }
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NAMESPACE);
  svg.setAttribute('width', String(outputWidth));
  svg.setAttribute('height', String(outputHeight));
  if ('responsive-viewport' === mermaidCapture) {
    normalizeResponsiveMermaidCaptureSvg(svg);
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  if (hoistOpacity) {
    svg.style.removeProperty('opacity');
    svg.removeAttribute('opacity');
    if (svg.hasAttribute('style') && !svg.getAttribute('style')?.trim()) {
      svg.removeAttribute('style');
    }
  }
  const ownBackgroundShape = emitOwnBackgroundShape
    ? createDirectSvgBackgroundShape(
        document,
        svg,
        viewBox,
        ownDirectSvgPaint.visibleColor,
        ownDirectSvgRadii,
        cssWidth,
        cssHeight,
      )
    : null;
  if (layoutMagnification !== 1 || hoistOpacity) {
    const scene = document.createElementNS(SVG_NAMESPACE, 'g');
    if (layoutMagnification !== 1) {
      const translateX = viewBox.minX * (1 - layoutMagnification);
      const translateY = viewBox.minY * (1 - layoutMagnification);
      scene.setAttribute(
        'transform',
        `translate(${translateX} ${translateY}) scale(${layoutMagnification})`,
      );
      svg.setAttribute(
        'viewBox',
        `${viewBox.minX} ${viewBox.minY} ${viewBox.width * layoutMagnification} ${viewBox.height * layoutMagnification}`,
      );
    }
    if (hoistOpacity) {
      scene.setAttribute('opacity', String(directSvgOpacity));
    }
    if (ownBackgroundShape) {
      scene.appendChild(ownBackgroundShape);
    }
    for (const child of Array.from(svg.childNodes)) {
      if (
        child.nodeType === Node.ELEMENT_NODE
        && NON_RENDERED_SVG_DIRECT_CHILDREN.has((child as Element).localName.toLowerCase())
      ) {
        continue;
      }
      scene.appendChild(child);
    }
    svg.appendChild(scene);
  } else if (ownBackgroundShape) {
    const firstRenderedChild = Array.from(svg.childNodes).find((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        return !NON_RENDERED_SVG_DIRECT_CHILDREN.has((child as Element).localName.toLowerCase());
      }
      return child.nodeType === Node.TEXT_NODE && Boolean(child.textContent?.trim());
    });
    svg.insertBefore(ownBackgroundShape, firstRenderedChild ?? null);
  }
  return svg;
}

export function normalizeDirectSvgForeignObjectClone(
  source: Element,
  rootClone: Element,
  mermaidCapture?: WechatVisualRasterizationMermaidCapture,
): void {
  if (!(rootClone instanceof SVGElement) || !rootClone.matches('svg')) return;
  if (!rootClone.getAttribute('xmlns')) {
    rootClone.setAttribute('xmlns', SVG_NAMESPACE);
  }
  if (!source.isConnected) {
    const rawImage = rootClone.style.getPropertyValue('background-image').trim();
    if (hasBackgroundImage(rawImage) && !isSafeBackgroundImage(rawImage)) {
      rootClone.style.removeProperty('background-image');
    }
  }
  if ('responsive-viewport' === mermaidCapture) {
    normalizeResponsiveMermaidCaptureSvg(rootClone);
  }
  const display = rootClone.style.getPropertyValue('display').trim().toLowerCase();
  if (!display || 'inline' === display) {
    rootClone.style.setProperty('display', 'block');
  }
}
