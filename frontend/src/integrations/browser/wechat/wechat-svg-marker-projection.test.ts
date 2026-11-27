import { describe, expect, it } from 'vitest';

import { declaration, declaredStyleValue } from './wechat-clipboard-test-fixtures';
import {
  applySvgMarkerProjection,
  planSvgMarkerProjection,
  projectSvgMarkerReferences,
  type WechatSvgCloneIdentity,
  type WechatSvgMarkerProjectionOptions
} from './wechat-svg-marker-projection';

function fixtureSvg(markup: string): SVGSVGElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const svg = holder.querySelector('svg');
  if (!(svg instanceof SVGSVGElement)) throw new Error('wechat-test-svg-fixture-missing');
  return svg;
}

/**
 * Test-only registration: real object pairs are recorded while cloning. The
 * production walk registers the same state (present/omitted) per element.
 */
function identityFor(sourceRoot: Element, cloneRoot: Element): (source: Element) => WechatSvgCloneIdentity | null {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const clones = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  const identity = new Map<Element, Element>();
  sources.forEach((element, index) => {
    const clone = clones[index];
    if (clone) identity.set(element, clone);
  });
  return (element) => {
    const clone = identity.get(element);
    return clone ? { state: 'present', clone } : null;
  };
}

function registrationMap(
  sourceRoot: Element,
  cloneRoot: Element
): Map<Element, Element> {
  const sources = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const clones = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  const identity = new Map<Element, Element>();
  sources.forEach((element, index) => {
    const clone = clones[index];
    if (clone) identity.set(element, clone);
  });
  return identity;
}

function identityFromMap(identity: Map<Element, Element>): (source: Element) => WechatSvgCloneIdentity | null {
  return (source) => {
    const clone = identity.get(source);
    return clone ? { state: 'present', clone } : null;
  };
}

function projectionOptions(
  sourceSvg: SVGSVGElement,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): WechatSvgMarkerProjectionOptions {
  const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
  return { sourceSvg, cloneSvg, cloneIdentityFor: identityFor(sourceSvg, cloneSvg), getComputedStyle };
}

const BASE_COMPUTED_STYLE: Readonly<Record<string, string>> = {
  'clip-path': 'none',
  filter: 'none',
  mask: 'none',
  'mix-blend-mode': 'normal',
  display: 'inline',
  visibility: 'visible',
  overflow: 'hidden',
  'transform-origin': '0px 0px',
  'transform-box': 'view-box'
};

/** `marker-*` are inherited properties, so this double resolves them down the ancestor chain. */
const INHERITED_MARKER_PROPERTIES = ['marker-start', 'marker-mid', 'marker-end'] as const;

function styleResolverFor(
  entries: ReadonlyArray<readonly [Element, Record<string, string>]>
): (element: Element) => CSSStyleDeclaration {
  const styles = new Map(entries);
  return (element) => declaration({ ...BASE_COMPUTED_STYLE, ...(styles.get(element) ?? {}) });
}

/**
 * Test double for real computed-style inheritance: a `marker-*` declaration on
 * an ancestor is the effective value on every descendant that does not declare
 * its own, which is what Chromium reports for SVG marker content.
 */
function inheritingMarkerStyleResolver(
  entries: ReadonlyArray<readonly [Element, Record<string, string>]>
): (element: Element) => CSSStyleDeclaration {
  const styles = new Map(entries);
  return (element) => {
    const inherited: Record<string, string> = {};
    const ancestors: Element[] = [];
    for (let node = element.parentElement; node; node = node.parentElement) ancestors.push(node);
    for (const ancestor of ancestors.reverse()) {
      const declared = styles.get(ancestor);
      if (!declared) continue;
      for (const property of INHERITED_MARKER_PROPERTIES) {
        const value = declared[property];
        if (value) inherited[property] = value;
      }
    }
    return declaration({ ...BASE_COMPUTED_STYLE, ...inherited, ...(styles.get(element) ?? {}) });
  };
}

function projectionSvgAfter(element: Element | null): SVGSVGElement | null {
  const sibling = element?.nextElementSibling ?? null;
  if (sibling instanceof SVGSVGElement) return sibling;
  const nested = sibling?.querySelector('svg') ?? null;
  return nested instanceof SVGSVGElement ? nested : null;
}

const FLOW_MARKER_FIXTURE = `
  <svg viewBox="0 0 120 120">
    <defs>
      <marker id="flow-edge-end" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
        <path d="M 0,0 V 4 L6,2 Z"></path>
      </marker>
    </defs>
    <line id="edge" x1="10" y1="10" x2="90" y2="50" marker-end="url(#flow-edge-end)" style="stroke:rgb(132, 142, 56);marker-end:url('#flow-edge-end')"></line>
  </svg>`;

function flowMarkerOptions(): WechatSvgMarkerProjectionOptions {
  const sourceSvg = fixtureSvg(FLOW_MARKER_FIXTURE);
  const edge = sourceSvg.querySelector('#edge');
  const markerPath = sourceSvg.querySelector('marker path');
  if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
  return projectionOptions(
    sourceSvg,
    styleResolverFor([
      [edge, { 'stroke-width': '1.5px', stroke: 'rgb(132, 142, 56)', 'marker-end': 'url("#flow-edge-end")' }],
      [markerPath, { fill: 'rgb(132, 142, 56)', stroke: 'none', 'stroke-width': '1px' }]
    ])
  );
}

describe('planSvgMarkerProjection', () => {
  it('reads the Source only and plans a marker-end instance from real geometry', () => {
    const options = flowMarkerOptions();
    const before = options.cloneSvg.outerHTML;
    const plan = planSvgMarkerProjection(options);
    expect(options.cloneSvg.outerHTML).toBe(before);
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    if (!item) throw new Error('wechat-test-plan-item-missing');
    expect(item.slot).toBe('marker-end');
    expect(item.markerId).toBe('flow-edge-end');
    // Line end (90,50) with a 26.565051 degree travel direction and default
    // strokeWidth marker units scaled by the 1.5px stroke width.
    expect(item.anchor).toEqual({ x: 90, y: 50 });
    expect(item.viewport).toMatchObject({
      x: 82.5,
      y: 47,
      width: 9,
      height: 6,
      viewBox: { minX: 0, minY: 0, width: 6, height: 4 }
    });
    expect(item.viewport.rotationDegrees).toBeCloseTo(26.56505117707799, 6);
    expect(item.markerOpacity).toBeNull();
    expect(item.content).toEqual([
      {
        localName: 'path',
        attributes: {
          fill: 'rgb(132, 142, 56)',
          'fill-opacity': '1',
          stroke: 'none',
          'stroke-opacity': '1',
          'stroke-width': '1px',
          'stroke-linecap': 'butt',
          'stroke-linejoin': 'miter',
          'stroke-miterlimit': '4',
          'stroke-dasharray': 'none',
          'stroke-dashoffset': '0',
          'fill-rule': 'nonzero',
          'paint-order': 'normal',
          'shape-rendering': 'auto',
          visibility: 'visible',
          d: 'M 0,0 V 4 L6,2 Z'
        },
        children: []
      }
    ]);
    expect(options.cloneSvg.querySelector('marker')).not.toBeNull();
  });

  it('scales marker content with the units when the marker has no viewBox', () => {
    const options = flowMarkerOptions();
    const plan = planSvgMarkerProjection(options);
    const viewport = plan.items[0]?.viewport;
    if (!viewport) throw new Error('wechat-test-plan-item-missing');
    // 7 of the 8 real markers have no viewBox: the equivalent viewBox must keep
    // the content scaling equal to the marker-units scale.
    expect(viewport.viewBox).toEqual({ minX: 0, minY: 0, width: 6, height: 4 });
    expect(viewport.width / viewport.viewBox.width).toBeCloseTo(1.5, 6);
    expect(viewport.height / viewport.viewBox.height).toBeCloseTo(1.5, 6);
  });

  it('skips an excluded root completely, including an excluded ancestor', () => {
    const options = flowMarkerOptions();
    const before = options.cloneSvg.outerHTML;
    const rootPlan = planSvgMarkerProjection({ ...options, excludedRoots: new Set<Element>([options.cloneSvg]) });
    expect(rootPlan.items).toEqual([]);
    expect(rootPlan.consumedMarkerDefinitions).toEqual([]);
    expect(options.cloneSvg.outerHTML).toBe(before);

    const sourceHolder = document.createElement('div');
    sourceHolder.innerHTML = FLOW_MARKER_FIXTURE;
    const cloneHolder = sourceHolder.cloneNode(true) as HTMLDivElement;
    const sourceSvg = sourceHolder.querySelector('svg');
    const cloneSvg = cloneHolder.querySelector('svg');
    if (!sourceSvg || !cloneSvg) throw new Error('wechat-test-svg-fixture-missing');
    let styleReads = 0;
    const ancestorPlan = planSvgMarkerProjection({
      sourceSvg,
      cloneSvg,
      cloneIdentityFor: identityFor(sourceHolder, cloneHolder),
      getComputedStyle: (_element) => {
        styleReads += 1;
        throw new Error('wechat-test-style-read-for-excluded-subtree');
      },
      excludedRoots: new Set<Element>([sourceHolder, cloneHolder])
    });
    expect(ancestorPlan.items).toEqual([]);
    expect(styleReads).toBe(0);
  });

  it('fails explicitly when a visible edge was never registered', () => {
    const options = flowMarkerOptions();
    const line = options.sourceSvg.querySelector('#edge');
    if (!line) throw new Error('wechat-test-svg-fixture-missing');
    const registered = options.cloneIdentityFor;
    const before = options.cloneSvg.outerHTML;
    expect(() =>
      planSvgMarkerProjection({
        ...options,
        cloneIdentityFor: (source) => (source === line ? null : registered(source))
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-unregistered');
    // A missing registration must not leave a silently unprojected payload.
    expect(options.cloneSvg.outerHTML).toBe(before);
    expect(options.cloneSvg.querySelector('#edge')?.getAttribute('marker-end')).toBe('url(#flow-edge-end)');
  });

  it('rejects an identity that points at a different element or tree', () => {
    const options = flowMarkerOptions();
    const line = options.sourceSvg.querySelector('#edge');
    const markerPath = options.cloneSvg.querySelector('marker path');
    if (!line || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const registered = options.cloneIdentityFor;
    expect(() =>
      planSvgMarkerProjection({
        ...options,
        cloneIdentityFor: (source) =>
          source === line ? { state: 'present', clone: markerPath } : registered(source)
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');

    const otherSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const otherLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    otherSvg.appendChild(otherLine);
    expect(() =>
      planSvgMarkerProjection({
        ...options,
        cloneIdentityFor: (source) =>
          source === line ? { state: 'present', clone: otherLine } : registered(source)
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');
  });

  it('rejects a same-tag path mapped across the SVG-to-defs parent boundary', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
            <path d="M 0 0 L 1 1"></path>
          </marker>
        </defs>
        <path id="edge" d="M 0 0 L 10 0" marker-end="url(#arrow)"></path>
      </svg>`);
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const sourceEdge = sourceSvg.querySelector('#edge');
    const cloneMarkerPath = cloneSvg.querySelector('marker path');
    if (!sourceEdge || !cloneMarkerPath) throw new Error('wechat-test-svg-fixture-missing');
    const registrations = registrationMap(sourceSvg, cloneSvg);
    registrations.set(sourceEdge, cloneMarkerPath);
    expect(() =>
      planSvgMarkerProjection({
        sourceSvg,
        cloneSvg,
        cloneIdentityFor: identityFromMap(registrations),
        getComputedStyle: () => {
          throw new Error('wechat-test-style-read-before-identity-validation');
        }
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');
  });

  it('rejects same-tag sibling mappings that swap their registered order', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <g>
          <path id="first" d="M 0 0 L 10 0" marker-end="url(#arrow)"></path>
          <path id="second" d="M 0 10 L 10 10" marker-end="url(#arrow)"></path>
        </g>
      </svg>`);
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const sourceFirst = sourceSvg.querySelector('#first');
    const sourceSecond = sourceSvg.querySelector('#second');
    const cloneFirst = cloneSvg.querySelector('#first');
    const cloneSecond = cloneSvg.querySelector('#second');
    if (!sourceFirst || !sourceSecond || !cloneFirst || !cloneSecond) {
      throw new Error('wechat-test-svg-fixture-missing');
    }
    const registrations = registrationMap(sourceSvg, cloneSvg);
    registrations.set(sourceFirst, cloneSecond);
    registrations.set(sourceSecond, cloneFirst);
    expect(() =>
      planSvgMarkerProjection({
        sourceSvg,
        cloneSvg,
        cloneIdentityFor: identityFromMap(registrations),
        getComputedStyle: styleResolverFor([])
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');
  });

  it('rejects duplicate clone ownership for same-tag siblings', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <g>
          <path id="first" d="M 0 0 L 10 0"></path>
          <path id="second" d="M 0 10 L 10 10"></path>
        </g>
      </svg>`);
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const sourceFirst = sourceSvg.querySelector('#first');
    const sourceSecond = sourceSvg.querySelector('#second');
    const cloneFirst = cloneSvg.querySelector('#first');
    if (!sourceFirst || !sourceSecond || !cloneFirst) throw new Error('wechat-test-svg-fixture-missing');
    const registrations = registrationMap(sourceSvg, cloneSvg);
    registrations.set(sourceSecond, cloneFirst);
    expect(() =>
      planSvgMarkerProjection({
        sourceSvg,
        cloneSvg,
        cloneIdentityFor: identityFromMap(registrations),
        getComputedStyle: styleResolverFor([])
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');
  });

  it('does not treat an unregistered marker definition as an explicit omission', () => {
    const options = flowMarkerOptions();
    const marker = options.sourceSvg.querySelector('marker');
    if (!marker) throw new Error('wechat-test-svg-fixture-missing');
    const registered = options.cloneIdentityFor;
    expect(() =>
      planSvgMarkerProjection({
        ...options,
        cloneIdentityFor: (source) => (source === marker ? null : registered(source))
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-unregistered');
  });

  it('fails explicitly when the registered SVG root identity is missing', () => {
    const options = flowMarkerOptions();
    expect(() => planSvgMarkerProjection({ ...options, cloneIdentityFor: () => null })).toThrowError(
      'wechat-svg-marker-projection-clone-identity-missing'
    );
    expect(() =>
      planSvgMarkerProjection({
        ...options,
        cloneIdentityFor: (source) =>
          source === options.sourceSvg ? { state: 'omitted' } : options.cloneIdentityFor(source)
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-missing');
  });

  it('projects the real edge when a dropped source node is explicitly omitted', () => {
    const sourceHolder = document.createElement('div');
    sourceHolder.innerHTML = FLOW_MARKER_FIXTURE.replace('<defs>', '<style data-dropped="1"></style><defs>');
    const cloneHolder = sourceHolder.cloneNode(true) as HTMLDivElement;
    const sourceSvg = sourceHolder.querySelector('svg');
    const cloneSvg = cloneHolder.querySelector('svg');
    if (!sourceSvg || !cloneSvg) throw new Error('wechat-test-svg-fixture-missing');
    // Real pairs are registered first; the serializer then drops <style> from
    // the clone, which the wiring reports as an explicit omission.
    const registered = identityFor(sourceHolder, cloneHolder);
    cloneHolder.querySelector('style')?.remove();
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences({
      sourceSvg,
      cloneSvg,
      cloneIdentityFor: (source) =>
        'style' === source.localName ? { state: 'omitted' } : registered(source),
      getComputedStyle: styleResolverFor([
        [edge, { 'stroke-width': '1.5px', stroke: 'rgb(132, 142, 56)', 'marker-end': 'url("#flow-edge-end")' }],
        [markerPath, { fill: 'rgb(132, 142, 56)' }]
      ])
    });
    expect(plan.items).toHaveLength(1);
    const cloneEdge = cloneSvg.querySelector('#edge');
    // The projection must target the real edge, never a defs node that only
    // happens to sit at the same ordinal position.
    expect(plan.items[0]?.cloneElement).toBe(cloneEdge);
    const projected = projectionSvgAfter(cloneEdge);
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('x')).toBe('82.5');
    expect(projected.getAttribute('y')).toBe('47');
    expect(cloneEdge?.getAttribute('marker')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-start')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-mid')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-end')).toBe('none');
    expect(declaredStyleValue(cloneEdge as Element, 'marker-end')).toBe('');
    expect(cloneSvg.querySelector('marker')).toBeNull();
    expect(cloneSvg.outerHTML).not.toContain('url(');
  });

  it('uses a computed transform none instead of a stale transform attribute', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0,0 V 4 L6,2 Z"></path>
          </marker>
        </defs>
        <line id="edge" x1="10" y1="0" x2="20" y2="0" transform="scale(2)" marker-end="url(#arrow)"></line>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [edge, { transform: 'none', 'stroke-width': '1px', 'marker-end': 'url(#arrow)' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    const item = plan.items[0];
    if (!item) throw new Error('wechat-test-plan-item-missing');
    expect(item.anchor).toEqual({ x: 20, y: 0 });
    expect(item.viewport.width).toBe(6);
    expect(item.viewport.rotationDegrees).toBe(0);
  });
});

describe('applySvgMarkerProjection', () => {
  it('replaces the marker reference with a geometry-only nested SVG viewport', () => {
    const options = flowMarkerOptions();
    const plan = planSvgMarkerProjection(options);
    applySvgMarkerProjection(plan);
    expect(plan.items).toHaveLength(1);
    const cloneEdge = options.cloneSvg.querySelector('#edge');
    const rotation = cloneEdge?.nextElementSibling;
    if (!(rotation instanceof SVGGElement)) throw new Error('wechat-test-projection-missing');
    expect(rotation.getAttribute('transform')).toBe('rotate(26.565051 90 50)');
    const projected = projectionSvgAfter(cloneEdge);
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('x')).toBe('82.5');
    expect(projected.getAttribute('y')).toBe('47');
    expect(projected.getAttribute('width')).toBe('9');
    expect(projected.getAttribute('height')).toBe('6');
    expect(projected.getAttribute('viewBox')).toBe('0 0 6 4');
    expect(projected.getAttribute('overflow')).toBe('hidden');
    expect(projected.getAttribute('visibility')).toBe('visible');
    expect(projected.getAttribute('fill')).toBe('none');
    expect(projected.getAttribute('stroke')).toBe('none');
    expect(projected.getAttribute('clip-path')).toBe('none');
    expect(projected.getAttribute('mask')).toBe('none');
    expect(projected.getAttribute('filter')).toBe('none');
    expect(projected.getAttribute('mix-blend-mode')).toBe('normal');
    expect(projected.getAttribute('vector-effect')).toBe('none');
    expect(projected.getAttribute('stroke-miterlimit')).toBe('4');
    expect(projected.getAttribute('stroke-dasharray')).toBe('none');
    expect(projected.getAttribute('stroke-dashoffset')).toBe('0');
    expect(projected.getAttribute('paint-order')).toBe('normal');
    expect(projected.getAttribute('shape-rendering')).toBe('auto');
    expect(projected.getAttribute('id')).toBeNull();
    const projectedPath = projected.querySelector('path');
    expect(projectedPath?.getAttribute('d')).toBe('M 0,0 V 4 L6,2 Z');
    expect(projectedPath).not.toBe(options.sourceSvg.querySelector('marker path'));
    expect(cloneEdge?.getAttribute('marker')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-start')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-mid')).toBe('none');
    expect(cloneEdge?.getAttribute('marker-end')).toBe('none');
    expect(declaredStyleValue(cloneEdge as Element, 'marker-end')).toBe('');
    expect(declaredStyleValue(cloneEdge as Element, 'stroke')).toBe('rgb(132, 142, 56)');
    expect(options.cloneSvg.querySelector('marker')).toBeNull();
    expect(options.sourceSvg.outerHTML).toBe(FLOW_MARKER_FIXTURE.trim());
    const serialized = options.cloneSvg.outerHTML;
    expect(serialized).toContain('marker="none"');
    expect(serialized).toContain('marker-start="none"');
    expect(serialized).toContain('marker-mid="none"');
    expect(serialized).toContain('marker-end="none"');
    expect(serialized).not.toContain('url(');
    const projectedSerialized = projected.outerHTML;
    expect(projected.querySelector('[id]')).toBeNull();
    expect(projectedSerialized).not.toContain('url(');
  });

  it('preserves a visible line that overrides a hidden ancestor at the generated boundary', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <g id="hidden-parent"><line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)" style="visibility:visible"></line></g>
      </svg>`);
    const parent = sourceSvg.querySelector('#hidden-parent');
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!parent || !edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [parent, { visibility: 'hidden' }],
          [edge, { visibility: 'visible', 'marker-end': 'url(#arrow)', 'stroke-width': '1px' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    const projected = projectionSvgAfter(plan.cloneSvg.querySelector('#edge'));
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('visibility')).toBe('visible');
  });

  it('clears inherited marker declarations at the shape and generated boundaries', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <g id="parent" style="marker-end:url(#arrow)"><line id="edge" x1="0" y1="0" x2="10" y2="0"></line></g>
      </svg>`);
    const parent = sourceSvg.querySelector('#parent');
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!parent || !edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [parent, { 'marker-end': 'url("#arrow")' }],
          [edge, { 'marker-end': 'url("#arrow")', 'stroke-width': '1px' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    const cloneEdge = plan.cloneSvg.querySelector('#edge');
    if (!cloneEdge) throw new Error('wechat-test-projection-missing');
    for (const property of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
      expect(cloneEdge.getAttribute(property)).toBe('none');
    }
    const projected = projectionSvgAfter(cloneEdge);
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    for (const property of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
      expect(projected.getAttribute(property)).toBe('none');
    }
    expect(plan.cloneSvg.querySelector('marker')).toBeNull();
    expect(sourceSvg.querySelector('#parent')?.getAttribute('style')).toBe('marker-end:url(#arrow)');
  });

  it('keeps a marker definition when an excluded sibling may inherit its reference', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <g id="parent" style="marker-end:url(#arrow)">
          <line id="line-1" x1="0" y1="0" x2="10" y2="0"></line>
          <line id="line-2" x1="0" y1="10" x2="10" y2="10"></line>
        </g>
      </svg>`);
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const sourceBefore = sourceSvg.outerHTML;
    const line1 = sourceSvg.querySelector('#line-1');
    const line2 = sourceSvg.querySelector('#line-2');
    const cloneLine2 = cloneSvg.querySelector('#line-2');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!line1 || !line2 || !cloneLine2 || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    let excludedStyleReads = 0;
    const plan = projectSvgMarkerReferences({
      sourceSvg,
      cloneSvg,
      cloneIdentityFor: identityFor(sourceSvg, cloneSvg),
      getComputedStyle: (element) => {
        if (element === line2) {
          excludedStyleReads += 1;
          throw new Error('wechat-test-style-read-for-excluded-subtree');
        }
        return styleResolverFor([
          [line1, { 'marker-end': 'url(#arrow)', 'stroke-width': '1px' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])(element);
      },
      excludedRoots: new Set<Element>([line2, cloneLine2])
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.canRemoveConsumedMarkerDefinitions).toBe(false);
    expect(excludedStyleReads).toBe(0);
    expect(cloneSvg.querySelector('marker')).not.toBeNull();
    expect(cloneSvg.querySelector('#parent')?.getAttribute('style')).toBe('marker-end:url(#arrow)');
    expect(cloneSvg.querySelector('#line-2')?.getAttribute('marker-end')).toBeNull();
    expect(sourceSvg.outerHTML).toBe(sourceBefore);
  });

  it('applies element transform, resolved paint, and opacity exactly once', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 200 200">
        <defs>
          <marker id="ctx" markerWidth="4" markerHeight="4" refX="0" refY="0" orient="auto">
            <circle cx="2" cy="2" r="2" fill="currentColor" stroke="context-stroke" stroke-width="1px" opacity="0.25"></circle>
          </marker>
        </defs>
        <path id="edge" d="M 0 0 L 10 0" transform="matrix(2,0,0,2,10,20)" marker-start="url(#ctx)" style="opacity:0.5"></path>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const marker = sourceSvg.querySelector('marker');
    const circle = sourceSvg.querySelector('circle');
    if (!edge || !marker || !circle) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [
            edge,
            {
              transform: 'matrix(2,0,0,2,10,20)',
              opacity: '0.5',
              stroke: 'rgb(132, 142, 56)',
              'marker-start': 'url("#ctx")'
            }
          ],
          [marker, { color: 'rgb(9, 9, 9)' }],
          [circle, { fill: 'currentcolor', stroke: 'context-stroke', color: 'rgb(9, 9, 9)', opacity: '0.25' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    const cloneEdge = plan.cloneSvg.querySelector('#edge');
    const wrapper = cloneEdge?.parentElement;
    if (!(wrapper instanceof SVGGElement)) throw new Error('wechat-test-projection-missing');
    expect(wrapper.getAttribute('opacity')).toBe('0.5');
    expect(wrapper.getAttribute('transform')).toBeNull();
    const projected = projectionSvgAfter(cloneEdge);
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('x')).toBe('10');
    expect(projected.getAttribute('y')).toBe('20');
    expect(projected.getAttribute('width')).toBe('8');
    expect(projected.getAttribute('height')).toBe('8');
    expect(projected.getAttribute('opacity')).toBeNull();
    const projectedCircle = projected.querySelector('circle');
    expect(projectedCircle?.getAttribute('fill')).toBe('rgb(9, 9, 9)');
    expect(projectedCircle?.getAttribute('stroke')).toBe('rgb(132, 142, 56)');
    expect(projectedCircle?.getAttribute('opacity')).toBe('0.25');
    expect(projectedCircle?.getAttribute('stroke-width')).toBe('1px');
    expect(cloneEdge?.getAttribute('transform')).toBe('matrix(2,0,0,2,10,20)');
    expect(cloneEdge?.getAttribute('opacity')).toBeNull();
    expect(declaredStyleValue(cloneEdge as Element, 'opacity')).toBe('');
    expect(declaredStyleValue(cloneEdge as Element, 'marker-start')).toBe('');
  });

  it('uses one shared object-opacity owner for both markers on one shape', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="start" markerWidth="6" markerHeight="4" refX="1" refY="2" orient="auto">
            <path d="M 6 0 L 0 2 L 6 4 Z"></path>
          </marker>
          <marker id="end" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <path id="edge" d="M 10 10 L 90 10" marker-start="url(#start)" marker-end="url(#end)" style="opacity:0.5"></path>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const markerPaths = Array.from(sourceSvg.querySelectorAll('marker path'));
    if (!edge || markerPaths.length !== 2) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [
            edge,
            {
              opacity: '0.5',
              'stroke-width': '1px',
              'marker-start': 'url("#start")',
              'marker-end': 'url("#end")'
            }
          ],
          ...markerPaths.map((path) => [path, { fill: 'rgb(1, 2, 3)' }] as const)
        ])
      )
    );
    expect(plan.items).toHaveLength(2);
    const cloneEdge = plan.cloneSvg.querySelector('#edge');
    const owner = cloneEdge?.parentElement;
    if (!(owner instanceof SVGGElement)) throw new Error('wechat-test-projection-missing');
    expect(owner.getAttribute('opacity')).toBe('0.5');
    expect(owner.children[0]).toBe(cloneEdge);
    expect(cloneEdge?.getAttribute('opacity')).toBeNull();
    expect(declaredStyleValue(cloneEdge as Element, 'opacity')).toBe('');
    expect(declaredStyleValue(cloneEdge as Element, 'marker-start')).toBe('');
    expect(declaredStyleValue(cloneEdge as Element, 'marker-end')).toBe('');
    expect(sourceSvg.querySelector('#edge')?.getAttribute('style')).toBe('opacity:0.5');

    const projected = Array.from(owner.querySelectorAll('svg'));
    expect(projected).toHaveLength(2);
    // The owner carries object opacity once. Marker placement layers may carry
    // their own rotation, but never a second copy of object opacity.
    expect(owner.querySelectorAll('g[opacity]')).toHaveLength(0);
    expect(
      projected.every((svg) => {
        const placementParent = svg.parentElement;
        return placementParent === owner || placementParent?.getAttribute('opacity') === null;
      })
    ).toBe(true);
    expect(projected.every((svg) => owner.contains(svg))).toBe(true);
  });

  it('keeps a non-opaque marker element as its own composite layer', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="faded" markerWidth="6" markerHeight="4" refX="0" refY="0" orient="auto" opacity="0.4">
            <path d="M 0 0 L 6 2 L 0 4 z"></path>
          </marker>
        </defs>
        <line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#faded)" style="opacity:0.5"></line>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const marker = sourceSvg.querySelector('marker');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !marker || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [edge, { 'stroke-width': '1px', opacity: '0.5', 'marker-end': 'url(#faded)' }],
          [marker, { opacity: '0.4' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    const item = plan.items[0];
    if (!item) throw new Error('wechat-test-plan-item-missing');
    expect(item.markerOpacity).toBeCloseTo(0.4, 6);
    const cloneEdge = plan.cloneSvg.querySelector('#edge');
    const sharedOwner = cloneEdge?.parentElement;
    if (!(sharedOwner instanceof SVGGElement)) throw new Error('wechat-test-projection-missing');
    expect(sharedOwner.getAttribute('opacity')).toBe('0.5');
    expect(cloneEdge?.getAttribute('opacity')).toBeNull();
    expect(declaredStyleValue(cloneEdge as Element, 'opacity')).toBe('');
    const projected = projectionSvgAfter(cloneEdge);
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    const opacityLayer = projected.querySelector('g[opacity]');
    expect(opacityLayer?.getAttribute('opacity')).toBe('0.4');
    expect(opacityLayer?.querySelector('path')?.getAttribute('d')).toBe('M 0 0 L 6 2 L 0 4 z');
    expect(projected.querySelectorAll('[opacity]')).toHaveLength(1);
  });

  it('keeps the marker viewBox and clips through the nested viewport', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="wide" markerWidth="6" markerHeight="4" refX="0" refY="0" orient="auto">
            <path d="M 0 0 L 20 0"></path>
          </marker>
        </defs>
        <line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#wide)"></line>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const options = projectionOptions(
      sourceSvg,
      styleResolverFor([
        [edge, { 'stroke-width': '1px', 'marker-end': 'url(#wide)' }],
        [markerPath, { fill: 'rgb(51, 51, 51)' }]
      ])
    );
    projectSvgMarkerReferences(options);
    const projected = projectionSvgAfter(options.cloneSvg.querySelector('line'));
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('viewBox')).toBe('0 0 6 4');
    expect(projected.getAttribute('overflow')).toBe('hidden');
    expect(projected.getAttribute('width')).toBe('6');
    expect(projected.getAttribute('height')).toBe('4');
    // Content beyond the viewport is copied verbatim and clipped by the nested
    // viewport instead of being boolean-clipped by this owner.
    expect(projected.querySelector('path')?.getAttribute('d')).toBe('M 0 0 L 20 0');
  });

  it('keeps an explicit marker viewBox and preserveAspectRatio', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="boxed" markerWidth="12" markerHeight="12" refX="6" refY="5" viewBox="0 0 10 10" preserveAspectRatio="xMinYMin meet" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
        <line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#boxed)"></line>
      </svg>`);
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const options = projectionOptions(
      sourceSvg,
      styleResolverFor([
        [edge, { 'stroke-width': '2px', 'marker-end': 'url(#boxed)' }],
        [markerPath, { fill: 'rgb(132, 142, 56)' }]
      ])
    );
    projectSvgMarkerReferences(options);
    const projected = projectionSvgAfter(options.cloneSvg.querySelector('line'));
    if (!(projected instanceof SVGSVGElement)) throw new Error('wechat-test-projection-missing');
    expect(projected.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(projected.getAttribute('preserveAspectRatio')).toBe('xMinYMin meet');
    expect(projected.getAttribute('width')).toBe('12');
    expect(projected.getAttribute('height')).toBe('12');
    expect(projected.getAttribute('x')).toBe('2.8');
    expect(projected.getAttribute('y')).toBe('-6');
  });
});

describe('svg marker projection failures', () => {
  const base = (marker: string, edge = '<line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)"></line>') =>
    `<svg viewBox="0 0 120 120"><defs>${marker}</defs>${edge}</svg>`;
  const plainMarker =
    '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M 0,0 V 4 L6,2 Z"></path></marker>';
  // A marker content shape whose own reference geometry stays inside the
  // supported domain, so only the content admission decides the outcome.
  const nestedMarker =
    '<marker id="nested" markerWidth="4" markerHeight="4" refX="0" refY="0" orient="auto"><path d="M 0,0 L 4,2"></path></marker>';
  const markerWithLineContent =
    '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><line id="arrow-content" x1="0" y1="0" x2="6" y2="2"></line></marker>';
  // A hidden container with a visible child shape: the container paints no
  // marker itself, so only the child's effective value can reject the content.
  const markerWithContainerContent =
    '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">' +
    '<g id="arrow-container" visibility="hidden"><line id="arrow-content" x1="0" y1="0" x2="6" y2="2" visibility="visible"></line></g>' +
    '</marker>';

  function failureFor(
    markup: string,
    edgeStyle: Record<string, string>,
    markerStyles: (sourceSvg: SVGSVGElement) => ReadonlyArray<readonly [Element, Record<string, string>]>
  ): string {
    const sourceSvg = fixtureSvg(markup);
    const edge = sourceSvg.querySelector('#edge');
    if (!edge) throw new Error('wechat-test-svg-fixture-missing');
    try {
      planSvgMarkerProjection(
        projectionOptions(
          sourceSvg,
          styleResolverFor([[edge, edgeStyle], ...markerStyles(sourceSvg)])
        )
      );
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('wechat-test-expected-failure');
  }

  it('lets a computed none override a presentation attribute URL', () => {
    const sourceSvg = fixtureSvg(base(plainMarker));
    const edge = sourceSvg.querySelector('#edge');
    if (!edge) throw new Error('wechat-test-svg-fixture-missing');
    const options = projectionOptions(sourceSvg, styleResolverFor([[edge, { 'marker-end': 'none' }]]));
    const before = options.cloneSvg.outerHTML;
    const plan = planSvgMarkerProjection(options);
    expect(plan.items).toEqual([]);
    expect(options.cloneSvg.outerHTML).toBe(before);
    expect(options.cloneSvg.querySelector('marker')).not.toBeNull();
  });

  it('rejects a non-identity reference transform with an unproven origin', () => {
    expect(
      failureFor(
        base(
          plainMarker,
          '<line id="edge" x1="0" y1="0" x2="10" y2="0" transform="scale(2)" marker-end="url(#arrow)"></line>'
        ),
        {
          'marker-end': 'url(#arrow)',
          transform: 'matrix(2,0,0,2,0,0)',
          'transform-origin': '10px 10px'
        },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-referencing-element-transform-origin-unsupported');
  });

  it('rejects a non-identity marker-content transform with an unproven transform box', () => {
    const marker =
      '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path transform="scale(2)" d="M 0,0 V 4 L6,2 Z"></path></marker>';
    expect(
      failureFor(
        base(marker),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const path = sourceSvg.querySelector('marker path');
          return path
            ? [[path, { transform: 'matrix(2,0,0,2,0,0)', 'transform-box': 'fill-box' }]]
            : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-content-transform-box-unsupported');
  });

  it('rejects a marker-first paint order before projecting the referencing shape', () => {
    expect(
      failureFor(
        base(
          plainMarker,
          '<path id="edge" d="M 0 0 L 10 0" paint-order="markers fill stroke" marker-end="url(#arrow)"></path>'
        ),
        { 'marker-end': 'url(#arrow)', 'paint-order': 'markers fill stroke' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-paint-order-unsupported');
  });

  it('treats computed paint order as authoritative over a conflicting attribute', () => {
    const sourceSvg = fixtureSvg(
      base(
        plainMarker,
        '<path id="edge" d="M 0 0 L 10 0" paint-order="markers fill stroke" marker-end="url(#arrow)"></path>'
      )
    );
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [edge, { 'marker-end': 'url(#arrow)', 'paint-order': 'fill stroke markers', 'stroke-width': '1px' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
  });

  it('accepts paint-order prefixes that complete to the default order', () => {
    for (const computedPaintOrder of ['fill', 'fill stroke', 'fill stroke markers']) {
      const sourceSvg = fixtureSvg(
        base(
          plainMarker,
          '<path id="edge" d="M 0 0 L 10 0" paint-order="markers fill stroke" marker-end="url(#arrow)"></path>'
        )
      );
      const edge = sourceSvg.querySelector('#edge');
      const markerPath = sourceSvg.querySelector('marker path');
      if (!edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
      const plan = planSvgMarkerProjection(
        projectionOptions(
          sourceSvg,
          styleResolverFor([
            [edge, { 'marker-end': 'url(#arrow)', 'paint-order': computedPaintOrder, 'stroke-width': '1px' }],
            [markerPath, { fill: 'rgb(1, 2, 3)' }]
          ])
        )
      );
      expect(plan.items).toHaveLength(1);
    }
  });

  it('rejects an unknown computed paint order instead of treating it as normal', () => {
    expect(
      failureFor(
        base(plainMarker, '<path id="edge" d="M 0 0 L 10 0" marker-end="url(#arrow)"></path>'),
        { 'marker-end': 'url(#arrow)', 'paint-order': 'markers fill stroke' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-paint-order-unsupported');
  });

  it('rejects direct clip, mask, and filter effects on the referencing shape', () => {
    for (const property of ['clip-path', 'mask', 'filter']) {
      const failure = failureFor(
        base(
          plainMarker,
          `<line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)" ${property}="url(#effect)"></line>`
        ),
        { 'marker-end': 'url(#arrow)', [property]: 'url(#effect)' },
        () => []
      );
      expect(failure).toBe(`wechat-svg-marker-projection-referencing-element-${property}-unsupported`);
    }
  });

  it('keeps ancestor effects outside the direct-shape rejection boundary', () => {
    const sourceSvg = fixtureSvg(`
      <svg viewBox="0 0 120 120">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <path d="M 0 0 L 6 2 L 0 4 Z"></path>
          </marker>
        </defs>
        <g id="ancestor" style="clip-path:url(#ancestor-clip)"><line id="edge" x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)"></line></g>
      </svg>`);
    const ancestor = sourceSvg.querySelector('#ancestor');
    const edge = sourceSvg.querySelector('#edge');
    const markerPath = sourceSvg.querySelector('marker path');
    if (!ancestor || !edge || !markerPath) throw new Error('wechat-test-svg-fixture-missing');
    const plan = projectSvgMarkerReferences(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [ancestor, { 'clip-path': 'url(#ancestor-clip)' }],
          [edge, { 'marker-end': 'url(#arrow)', 'stroke-width': '1px' }],
          [markerPath, { fill: 'rgb(1, 2, 3)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.cloneSvg.querySelector('#ancestor')?.getAttribute('style')).toBe('clip-path:url(#ancestor-clip)');
  });

  it('rejects non-local marker URLs, missing definitions, and unsupported slots', () => {
    expect(failureFor(base(plainMarker), { 'marker-end': 'url(https://example.test/a.svg#arrow)' }, () => [])).toBe(
      'wechat-svg-marker-projection-marker-reference-url-unsupported'
    );
    expect(failureFor(base(plainMarker), { 'marker-end': 'url(data:image/svg+xml;base64,AAAA)' }, () => [])).toBe(
      'wechat-svg-marker-projection-marker-reference-url-unsupported'
    );
    expect(failureFor(base(plainMarker), { 'marker-end': 'url(#missing)' }, () => [])).toBe(
      'wechat-svg-marker-projection-marker-end-definition-missing'
    );
    expect(failureFor(base(plainMarker), { 'marker-end': 'inherit' }, () => [])).toBe(
      'wechat-svg-marker-projection-marker-end-value-invalid'
    );
    expect(failureFor(base(plainMarker), { 'marker-end': 'none', 'marker-mid': 'url(#arrow)' }, () => [])).toBe(
      'wechat-svg-marker-projection-referencing-element-marker-mid-unsupported'
    );
    expect(
      failureFor(
        base(plainMarker, '<polyline id="edge" points="0,0 10,0" marker-end="url(#arrow)"></polyline>'),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-referencing-element-marker-end-unsupported');
  });

  it('rejects a zero marker viewport instead of leaving the URL reference', () => {
    expect(
      failureFor(
        base(plainMarker.replace('markerWidth="6"', 'markerWidth="0"')),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-marker-viewport-unsupported');
  });

  it('scales sibling identity validation linearly across thousands of children', () => {
    for (const count of [400, 800, 1600]) {
      const lines: string[] = [];
      for (let i = 0; i < count; i += 1) {
        lines.push(`<line id="line-${i}" x1="${i}" y1="0" x2="${i + 1}" y2="0"></line>`);
      }
      const markup = `<svg viewBox="0 0 2000 100"><defs>${plainMarker}</defs>${lines.join('')}</svg>`;
      const sourceSvg = fixtureSvg(markup);
      let identityLookups = 0;
      const baseOpt = projectionOptions(sourceSvg, styleResolverFor([]));
      const plan = planSvgMarkerProjection({
        ...baseOpt,
        cloneIdentityFor: (source) => {
          identityLookups += 1;
          return baseOpt.cloneIdentityFor(source);
        }
      });
      expect(plan.items).toEqual([]);
      // Exactly 1 lookup per registered tree element: O(n) scaling, not O(n^2) or O(n^3)
      // Tree: svg (1) + defs (1) + marker (1) + path (1) + lines (count) = count + 4
      expect(identityLookups).toBe(count + 4);
    }

    // Out-of-order siblings reject immediately
    const sourceSvg = fixtureSvg('<svg><line id="l0"></line><line id="l1"></line></svg>');
    const cloneSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    const cloneIdentityFor = identityFor(sourceSvg, cloneSvg);
    const cloneLines = Array.from(cloneSvg.querySelectorAll('line'));
    const first = cloneLines[0];
    const second = cloneLines[1];
    if (first && second) {
      second.after(first);
    }
    expect(() =>
      planSvgMarkerProjection({
        sourceSvg,
        cloneSvg,
        cloneIdentityFor,
        getComputedStyle: styleResolverFor([])
      })
    ).toThrowError('wechat-svg-marker-projection-clone-identity-mismatch');
  });

  it('checks cancellation budget and aborts projection when signal fires', () => {
    let checks = 0;
    const sourceSvg = fixtureSvg(base(plainMarker));
    expect(() =>
      planSvgMarkerProjection({
        ...projectionOptions(sourceSvg, styleResolverFor([])),
        isCancelled: () => {
          checks += 1;
          return checks >= 2;
        }
      })
    ).toThrowError('wechat-svg-marker-projection-cancelled');
  });

  it('projects visible children inside a visibility:hidden container and prunes display:none', () => {
    const hiddenGWithVisiblePath =
      '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">' +
      '<g visibility="hidden" transform="scale(2)"><path visibility="visible" d="M 0,0 V 4 L6,2 Z"></path></g>' +
      '</marker>';
    const sourceSvgG = fixtureSvg(base(hiddenGWithVisiblePath));
    const gEl = sourceSvgG.querySelector('marker g');
    if (!gEl) throw new Error('g missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvgG,
        styleResolverFor([[gEl, { visibility: 'hidden' }]])
      )
    );
    expect(plan.items).toHaveLength(1);
    const gNode = plan.items[0]?.content[0];
    expect(gNode?.localName).toBe('g');
    expect(gNode?.attributes.visibility).toBe('hidden');
    expect(gNode?.attributes.transform).toBe('scale(2)');
    expect(gNode?.children).toHaveLength(1);
    expect(gNode?.children[0]?.localName).toBe('path');
    expect(gNode?.children[0]?.attributes.visibility).toBe('visible');

    const displayNoneG =
      '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">' +
      '<g display="none"><path visibility="visible" d="M 0,0 V 4 L6,2 Z"></path></g>' +
      '</marker>';
    const sourceSvgDisplay = fixtureSvg(base(displayNoneG));
    const gDisplayEl = sourceSvgDisplay.querySelector('marker g');
    if (!gDisplayEl) throw new Error('g missing');
    expect(
      failureFor(
        base(displayNoneG),
        { 'marker-end': 'url(#arrow)' },
        (svg) => {
          const targetG = svg.querySelector('marker g');
          return targetG ? [[targetG, { display: 'none' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-content-empty');
  });

  it('defaults omitted line coordinates to 0 and rejects invalid or unit-bearing coordinates', () => {
    // Missing x1, y1, y2 default to 0 per SVG specification
    const omittedLine = '<line id="edge" x2="10" marker-end="url(#arrow)"></line>';
    const plan = planSvgMarkerProjection(projectionOptions(fixtureSvg(base(plainMarker, omittedLine)), styleResolverFor([])));
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.anchor).toEqual({ x: 10, y: 0 });

    expect(
      failureFor(
        base(plainMarker, '<line id="edge" x1="10px" x2="20" marker-end="url(#arrow)"></line>'),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-line-coordinate-invalid');

    expect(
      failureFor(
        base(plainMarker, '<line id="edge" x1="invalid" x2="20" marker-end="url(#arrow)"></line>'),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-line-coordinate-invalid');
  });

  it('projects markers with default orient 0 and linear H, V, Z path segments', () => {
    const unorientedMarker = '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2"><path d="M 0,0 V 4 L6,2 Z"></path></marker>';
    const linearPath = '<path id="edge" d="M 0 0 H 20 V 10 Z" marker-end="url(#arrow)"></path>';
    const sourceSvg = fixtureSvg(base(unorientedMarker, linearPath));
    const plan = planSvgMarkerProjection(projectionOptions(sourceSvg, styleResolverFor([])));
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item?.viewport.rotationDegrees).toBe(0);
    expect(item?.anchor).toEqual({ x: 0, y: 0 });
    const zeroOrientMarker = '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="0"><path d="M 0,0 V 4 L6,2 Z"></path></marker>';
    const sourceZeroSvg = fixtureSvg(base(zeroOrientMarker, linearPath));
    const planZero = planSvgMarkerProjection(projectionOptions(sourceZeroSvg, styleResolverFor([])));
    expect(planZero.items[0]?.viewport.rotationDegrees).toBe(0);
  });

  it('rejects non-auto orientation and out-of-domain reference geometry', () => {
    expect(
      failureFor(
        base(plainMarker.replace('orient="auto"', 'orient="auto-start-reverse"')),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-geometry-marker-orientation-unsupported');
    expect(
      failureFor(
        base(plainMarker.replace('orient="auto"', 'orient="45"')),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-geometry-marker-orientation-unsupported');
    expect(
      failureFor(
        base(plainMarker, '<path id="edge" d="M 0 0 L 10 0 M 20 0 L 30 0" marker-end="url(#arrow)"></path>'),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-geometry-path-subpath-unsupported');
    expect(
      failureFor(
        base(plainMarker, '<path id="edge" d="M 0 0 Q 5 5 10 0" marker-end="url(#arrow)"></path>'),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-geometry-path-command-unsupported');
    expect(
      failureFor(
        base(plainMarker, '<line id="edge" x1="0" y1="0" x2="10" y2="0" transform="matrix(2,0,0,1,0,0)" marker-end="url(#arrow)"></line>'),
        { 'marker-end': 'url(#arrow)', transform: 'matrix(2, 0, 0, 1, 0, 0)' },
        () => []
      )
    ).toBe('wechat-svg-marker-geometry-transform-unsupported');
    expect(
      failureFor(base(plainMarker), { 'marker-end': 'url(#arrow)', transform: 'translate(10px, 0px)' }, () => [])
    ).toBe('wechat-svg-marker-projection-referencing-element-transform-unsupported');
    expect(
      failureFor(
        base(
          plainMarker,
          '<line id="edge" x1="0" y1="0" x2="10" y2="0" transform="matrix(1,0,0,1,1000,0)" marker-end="url(#arrow)"></line>'
        ),
        {
          'marker-end': 'url(#arrow)',
          transform: 'matrix(1,0,0,1,1001,0)'
        },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-referencing-element-transform-unsupported');
  });

  it('rejects marker content whose dropped CSS would change the rendering', () => {
    expect(
      failureFor(
        base(
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M 0,0 V 4 L6,2 Z"></path></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const path = sourceSvg.querySelector('marker path');
          return path ? [[path, { 'clip-path': 'url(#clip)' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-content-clip-path-unsupported');
    expect(
      failureFor(
        base(
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M 0,0 V 4 L6,2 Z" style="transform:translate(1px, 2px)"></path></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const path = sourceSvg.querySelector('marker path');
          return path ? [[path, { transform: 'translate(1px, 2px)' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-content-transform-unsupported');
    expect(
      failureFor(
        base(
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M 0,0 V 4 L6,2 Z" filter="url(#blur)"></path></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const path = sourceSvg.querySelector('marker path');
          return path ? [[path, { filter: 'url(#blur)' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-content-filter-unsupported');
  });

  it('rejects an effective marker reference that CSS or inheritance supplies inside marker content', () => {
    // A CSS declaration creates the nested reference without any presentation attribute.
    expect(
      failureFor(base(nestedMarker + markerWithLineContent), { 'marker-end': 'url(#arrow)' }, (sourceSvg) => {
        const content = sourceSvg.querySelector('marker#arrow line');
        return content ? [[content, { fill: 'rgb(1, 2, 3)', 'marker-end': 'url("#nested")' }]] : [];
      })
    ).toBe('wechat-svg-marker-projection-content-marker-reference-unsupported');

    // `marker-*` inherit, so a declaration on the <marker> element is the
    // effective value on the shape that would render the nested reference.
    const sourceSvg = fixtureSvg(base(nestedMarker + markerWithLineContent));
    const marker = sourceSvg.querySelector('marker#arrow');
    const edge = sourceSvg.querySelector('#edge');
    if (!marker || !edge) throw new Error('wechat-test-svg-fixture-missing');
    expect(() =>
      planSvgMarkerProjection(
        projectionOptions(
          sourceSvg,
          inheritingMarkerStyleResolver([
            [marker, { 'marker-end': 'url("#nested")' }],
            [edge, { 'marker-end': 'url(#arrow)' }]
          ])
        )
      )
    ).toThrowError('wechat-svg-marker-projection-content-marker-reference-unsupported');

    // A presentation attribute stays the effective reference where the
    // computed surface cannot report the property at all.
    expect(
      failureFor(
        base(
          nestedMarker +
            '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><line id="arrow-content" x1="0" y1="0" x2="6" y2="2" marker-end="url(#nested)"></line></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-content-marker-reference-unsupported');
  });

  it('lets a computed none override a raw marker URL on marker content', () => {
    const sourceSvg = fixtureSvg(
      base(
        nestedMarker +
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><line id="arrow-content" x1="0" y1="0" x2="6" y2="2" marker-end="url(#nested)"></line></marker>'
      )
    );
    const content = sourceSvg.querySelector('marker#arrow line');
    const edge = sourceSvg.querySelector('#edge');
    if (!content || !edge) throw new Error('wechat-test-svg-fixture-missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [content, { fill: 'rgb(1, 2, 3)', 'marker-end': 'none' }],
          [edge, { 'marker-end': 'url(#arrow)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    const node = plan.items[0]?.content[0];
    expect(node?.attributes).not.toHaveProperty('marker-end');
    expect(node?.attributes).toMatchObject({ x1: '0', y1: '0', x2: '6', y2: '2' });
  });

  it('keeps a marker container whose own reference is inert for its shape', () => {
    const sourceSvg = fixtureSvg(base(nestedMarker + markerWithContainerContent));
    const container = sourceSvg.querySelector('marker#arrow g');
    const content = sourceSvg.querySelector('marker#arrow line');
    const edge = sourceSvg.querySelector('#edge');
    if (!container || !content || !edge) throw new Error('wechat-test-svg-fixture-missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [container, { 'marker-end': 'url("#nested")', visibility: 'hidden' }],
          [
            content,
            {
              fill: 'rgb(1, 2, 3)',
              visibility: 'visible',
              'marker-start': 'none',
              'marker-mid': 'none',
              'marker-end': 'none'
            }
          ],
          [edge, { 'marker-end': 'url(#arrow)' }]
        ])
      )
    );
    expect(plan.items).toHaveLength(1);
    const node = plan.items[0]?.content[0];
    expect(node?.localName).toBe('g');
    expect(node?.attributes).not.toHaveProperty('marker-end');
    expect(node?.attributes.visibility).toBe('hidden');
    expect(node?.children[0]?.localName).toBe('line');
    expect(node?.children[0]?.attributes.visibility).toBe('visible');
  });

  it('rejects a container whose shape descendant inherits the nested reference', () => {
    const sourceSvg = fixtureSvg(base(nestedMarker + markerWithContainerContent));
    const container = sourceSvg.querySelector('marker#arrow g');
    const edge = sourceSvg.querySelector('#edge');
    if (!container || !edge) throw new Error('wechat-test-svg-fixture-missing');
    expect(() =>
      planSvgMarkerProjection(
        projectionOptions(
          sourceSvg,
          inheritingMarkerStyleResolver([
            [container, { 'marker-start': 'url("#nested")', visibility: 'hidden' }],
            [edge, { 'marker-end': 'url(#arrow)' }]
          ])
        )
      )
    ).toThrowError('wechat-svg-marker-projection-content-marker-reference-unsupported');
  });

  it('rejects an unsupported effect on the marker element itself', () => {
    expect(
      failureFor(
        base(plainMarker),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const marker = sourceSvg.querySelector('marker');
          return marker ? [[marker, { filter: 'url(#blur)' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-marker-filter-unsupported');
  });

  it('accepts quadratic and multi-subpath marker content geometry', () => {
    const sourceSvg = fixtureSvg(
      base(
        '<marker id="arrow" markerWidth="57" markerHeight="36" refX="39" refY="18" orient="auto"><circle cx="9" cy="18" r="6" fill="white" stroke="gray"></circle><path stroke="gray" fill="none" d="M21,18 Q39,0 57,18 Q39,36 21,18"></path><path stroke="gray" fill="none" d="M9,0 L9,18 M15,0 L15,18"></path></marker>'
      )
    );
    const edge = sourceSvg.querySelector('#edge');
    const contents = Array.from(sourceSvg.querySelectorAll('marker *'));
    if (!edge) throw new Error('wechat-test-svg-fixture-missing');
    const plan = planSvgMarkerProjection(
      projectionOptions(
        sourceSvg,
        styleResolverFor([
          [edge, { 'stroke-width': '1px', 'marker-end': 'url(#arrow)' }],
          ...contents.map(
            (element) =>
              [element, { fill: 'rgb(132, 142, 56)', stroke: 'rgb(128, 128, 128)', 'stroke-width': '1px' }] as const
          )
        ])
      )
    );
    const content = plan.items[0]?.content ?? [];
    expect(content.map((node) => node.localName)).toEqual(['circle', 'path', 'path']);
    expect(content[1]?.attributes.d).toBe('M21,18 Q39,0 57,18 Q39,36 21,18');
    expect(content[2]?.attributes.d).toBe('M9,0 L9,18 M15,0 L15,18');
  });

  it('rejects out-of-domain marker content elements and paint', () => {
    expect(
      failureFor(
        base(
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M 0,0 V 4 L6,2 Z" fill="url(#gradient)"></path><linearGradient id="gradient"><stop offset="0"></stop></linearGradient></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const path = sourceSvg.querySelector('marker path');
          return path ? [[path, { fill: 'url(#gradient)' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-fill-paint-server-unsupported');
    expect(
      failureFor(
        base(
          '<marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><use href="#shape"></use></marker>'
        ),
        { 'marker-end': 'url(#arrow)' },
        () => []
      )
    ).toBe('wechat-svg-marker-projection-content-element-unsupported');
    expect(
      failureFor(
        base(plainMarker.replace('orient="auto"', 'orient="auto" overflow="visible"')),
        { 'marker-end': 'url(#arrow)' },
        (sourceSvg) => {
          const marker = sourceSvg.querySelector('marker');
          return marker ? [[marker, { overflow: 'visible' }]] : [];
        }
      )
    ).toBe('wechat-svg-marker-projection-marker-overflow-unsupported');
  });
});
