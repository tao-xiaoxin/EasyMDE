import { expect } from '@playwright/test';
import { bloomArticleThemeIds } from "./environment.mjs";

export function bloomThemesForE2E() {
  const configured = process.env.EASYMDE_E2E_BLOOM_THEME_IDS?.trim();
  if (!configured) return ['bloom-petal'];
  const values = 'all' === configured.toLowerCase()
    ? bloomArticleThemeIds
    : configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length || values.some((value) => !bloomArticleThemeIds.includes(value))) {
    throw new Error('wechat-bloom-theme-ids-invalid');
  }
  return [...new Set(values)];
}

export function bloomDprsForE2E() {
  const configured = process.env.EASYMDE_E2E_BLOOM_DPRS?.trim();
  const values = (configured ? configured.split(',') : ['1', '2'])
    .map((value) => Number(value.trim()));
  if (!values.length || values.some((value) => ![1, 2].includes(value))) {
    throw new Error('wechat-bloom-dprs-invalid');
  }
  return [...new Set(values)];
}

export async function setBloomViewport(page, cdp, width, dpr) {
  const height = 900;
  await page.setViewportSize({ height, width });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: dpr,
    height,
    mobile: false,
    width
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
}

export async function readBloomIntrinsicMermaidLiveEvidence(
  preview,
  role,
  { allowMissingCtm = false } = {}
) {
  return preview.evaluate((root, { expectedRole, allowMissingCtm }) => {
    const owner = [...root.querySelectorAll('.easymde-mermaid')].find((candidate) => (
      candidate.querySelector(':scope > svg')?.getAttribute('aria-roledescription')
        ?.trim()
        === expectedRole
    ));
    const svg = owner?.querySelector(':scope > svg');
    if (!(owner instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      throw new Error(`wechat-bloom-${expectedRole}-live-evidence-unavailable`);
    }
    const ownerStyle = getComputedStyle(owner);
    const svgStyle = getComputedStyle(svg);
    const sourceRootStyleProperties = [
      'box-sizing',
      'border-bottom-style',
      'border-bottom-width',
      'border-left-style',
      'border-left-width',
      'border-right-style',
      'border-right-width',
      'border-top-style',
      'border-top-width',
      'display',
      'height',
      'margin-bottom',
      'margin-left',
      'margin-right',
      'margin-top',
      'max-height',
      'max-width',
      'min-height',
      'min-width',
      'direction',
      'overflow',
      'overflow-x',
      'overflow-y',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
      'text-align',
      'width'
    ];
    const sourceRootStyles = Object.fromEntries(
      sourceRootStyleProperties.map((property) => [property, ownerStyle.getPropertyValue(property).trim()])
    );
    const typedOwnerStyle = (property) => {
      if ('function' !== typeof owner.computedStyleMap) return null;
      try {
        const value = owner.computedStyleMap().get(property);
        return value && 'function' === typeof value.toString
          ? value.toString().replace(/\s+/gu, ' ').trim().toLowerCase()
          : null;
      } catch {
        return null;
      }
    };
    const typedSvgStyle = (property) => {
      if ('function' !== typeof svg.computedStyleMap) return null;
      try {
        const value = svg.computedStyleMap().get(property);
        if (!value || 'object' !== typeof value) return null;
        if ('string' === typeof value.value) return value.value.trim().toLowerCase();
        const unit = 'string' === typeof value.unit
          ? value.unit.toLowerCase()
          : value.unit?.toString?.().toLowerCase() ?? '';
        return 'number' === typeof value.value && Number.isFinite(value.value) && unit
          ? `${value.value}${'percent' === unit ? '%' : unit}`
          : null;
      } catch {
        return null;
      }
    };
    const authoredOwnerProperties = [
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'float',
      'clear',
      'direction',
      'text-align',
      'unicode-bidi',
      'writing-mode'
    ];
    const authoredOwnerStyles = Object.fromEntries(
      authoredOwnerProperties.flatMap((property) => {
        const value = owner.style.getPropertyValue(property).trim();
        return value ? [[property, value]] : [];
      })
    );
    const svgRect = svg.getBoundingClientRect();
    const ownerRect = owner.getBoundingClientRect();
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (
      4 !== viewBox.length
      || viewBox.some((value) => !Number.isFinite(value))
      || viewBox[2] <= 0
      || viewBox[3] <= 0
    ) {
      throw new Error(`wechat-bloom-${expectedRole}-live-viewbox-invalid`);
    }
    const screenCtm = svg.getScreenCTM?.() ?? null;
    const ctm = screenCtm && [
      screenCtm.a,
      screenCtm.b,
      screenCtm.c,
      screenCtm.d,
      screenCtm.e,
      screenCtm.f
    ].every(Number.isFinite)
      ? screenCtm
      : null;
    if (!ctm && !allowMissingCtm) {
      throw new Error(`wechat-bloom-${expectedRole}-live-ctm-unavailable`);
    }
    return {
      backgroundColor: ownerStyle.backgroundColor,
      borderRadius: ownerStyle.borderRadius,
      clientWidth: owner.clientWidth,
      authoredOwnerStyles,
      height: ownerRect.height,
      layout: owner.getAttribute('data-easymde-mermaid-layout')?.trim() || null,
      ownerLayout: {
        display: ownerStyle.display,
        float: ownerStyle.float,
        opacity: ownerStyle.opacity,
        position: ownerStyle.position,
        transform: ownerStyle.transform
      },
      formattingOwnerDisplay: owner.parentElement
        ? getComputedStyle(owner.parentElement).display
        : '',
      overflowX: ownerStyle.overflowX,
      overflowY: ownerStyle.overflowY,
      padding: ownerStyle.padding,
      sourceRootStyles,
      sourceRootTypedDimensions: {
        height: typedOwnerStyle('height'),
        maxWidth: typedOwnerStyle('max-width'),
        width: typedOwnerStyle('width')
      },
      scrollWidth: owner.scrollWidth,
      svg: {
        ctm: {
          a: ctm?.a ?? null,
          b: ctm?.b ?? null,
          c: ctm?.c ?? null,
          d: ctm?.d ?? null,
          e: ctm?.e ?? null,
          f: ctm?.f ?? null
        },
        height: svgRect.height,
        style: {
          height: svgStyle.height,
          marginLeft: svgStyle.marginLeft,
          marginRight: svgStyle.marginRight,
          maxWidth: svgStyle.maxWidth,
          width: svgStyle.width
        },
        semanticStyle: {
          height: typedSvgStyle('height'),
          marginLeft: typedSvgStyle('margin-left'),
          marginRight: typedSvgStyle('margin-right'),
          maxHeight: typedSvgStyle('max-height'),
          maxWidth: typedSvgStyle('max-width'),
          width: typedSvgStyle('width')
        },
        preserveAspectRatio: svg.getAttribute('preserveAspectRatio')?.trim() || null,
        transform: svg.getAttribute('transform'),
        viewBox: {
          height: viewBox[3],
          width: viewBox[2],
          x: viewBox[0],
          y: viewBox[1]
        },
        width: svgRect.width
      },
      width: ownerRect.width,
      role: expectedRole
    };
  }, { expectedRole: role, allowMissingCtm });
}
