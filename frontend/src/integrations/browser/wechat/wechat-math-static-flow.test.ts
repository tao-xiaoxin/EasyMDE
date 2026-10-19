import { describe, expect, it, vi } from 'vitest';

import { declaration } from './wechat-clipboard-test-fixtures';
import {
  applyWechatMathStaticFlow,
  captureWechatMathStaticFlowSnapshot,
  evaluateWechatMathSourceAdmission,
  planWechatMathStaticFlow,
  type WechatMathStaticFlowGate,
  type WechatMathStaticFlowRuntime,
  type WechatMathStaticFlowSnapshot
} from './wechat-math-static-flow';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

type TypedValue = Readonly<Record<string, unknown>>;
type Rect = Readonly<{ bottom: number; height: number; left: number; right: number; top: number; width: number }>;
type TypedStyleMap = Readonly<{ get: (property: string) => TypedValue }>;

const SAFE_STYLE: Readonly<Record<string, string>> = {
  'animation-name': 'none',
  'backdrop-filter': 'none',
  'background-image': 'none',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-right-width': '0px',
  'border-top-width': '0px',
  'box-shadow': 'none',
  'box-sizing': 'content-box',
  clear: 'none',
  clip: 'auto',
  'clip-path': 'none',
  contain: 'none',
  'container-type': 'normal',
  'content-visibility': 'visible',
  display: 'block',
  filter: 'none',
  float: 'none',
  'inset-block-end': 'auto',
  'inset-block-start': 'auto',
  'inset-inline-end': 'auto',
  'inset-inline-start': 'auto',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'margin-right': '0px',
  'margin-top': '0px',
  mask: 'none',
  'mix-blend-mode': 'normal',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'padding-right': '0px',
  'padding-top': '0px',
  perspective: 'none',
  position: 'static',
  rotate: 'none',
  scale: 'none',
  transform: 'none',
  'transition-duration': '0s',
  translate: 'none',
  'will-change': 'auto',
  'writing-mode': 'horizontal-tb',
  'z-index': 'auto'
};

function px(value: number, text?: string): TypedValue {
  return { unit: 'px', value, ...(text ? { text } : {}) };
}

function keyword(value: string): TypedValue {
  return { value };
}

function zeroRect(): Rect {
  return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 };
}

type MathFixtureRow = Readonly<{
  clone: HTMLElement;
  mord: HTMLElement;
  pstrut: HTMLElement;
  source: HTMLElement;
}>;

type MathFixture = Readonly<{
  animations: Animation[];
  cloneHolder: HTMLElement | null;
  cloneRoot: HTMLElement;
  cloneSvg: SVGSVGElement | null;
  gate: { isCancelled: boolean; isCurrent: boolean };
  group: HTMLElement;
  identities: Map<Element, Element>;
  rows: readonly MathFixtureRow[];
  runtime: WechatMathStaticFlowRuntime;
  setIlluminatingPseudo: (element: Element, pseudo: '::before' | '::after', content: string, position?: string) => void;
  setRect: (element: Element, rect: Rect) => void;
  setStyle: (element: Element, values: Readonly<Record<string, string>>) => void;
  setTyped: (element: Element, values: Readonly<Record<string, TypedValue>>) => void;
  sourceHolder: HTMLElement | null;
  sourceRoot: HTMLElement;
  sourceSvg: SVGSVGElement | null;
}>;

function pairTrees(source: Element, clone: Element, identities: Map<Element, Element>): void {
  identities.set(source, clone);
  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  if (sourceChildren.length !== cloneChildren.length) throw new Error('test-pair-count');
  sourceChildren.forEach((sourceChild, index) => {
    const cloneChild = cloneChildren[index];
    if (!cloneChild) throw new Error('test-pair-missing');
    pairTrees(sourceChild, cloneChild, identities);
  });
}

function mathFixture(rowTops: readonly (number | string)[] = [-7], withSvg = false): MathFixture {
  const sourceRoot = document.createElement('div');
  sourceRoot.className = 'katex-html';
  const table = document.createElement('span');
  table.className = 'vlist-t';
  const tableRow = document.createElement('span');
  tableRow.className = 'vlist-r';
  const group = document.createElement('span');
  group.className = 'vlist';
  sourceRoot.append(table);
  table.append(tableRow);
  tableRow.append(group);

  const sourceRows = rowTops.map((top) => {
    const row = document.createElement('span');
    row.className = 'base';
    const topStr = typeof top === 'number' ? `${top}px` : top;
    row.dataset.top = topStr;
    const pstrut = document.createElement('span');
    pstrut.className = 'pstrut';
    const mord = document.createElement('span');
    mord.className = 'mord';
    mord.textContent = 'x';
    row.append(pstrut, mord);
    group.append(row);
    return { mord, pstrut, row, top: topStr };
  });

  let sourceHolder: HTMLElement | null = null;
  let sourceSvg: SVGSVGElement | null = null;
  if (withSvg) {
    const row = sourceRows[0];
    if (!row) throw new Error('test-row-missing');
    sourceHolder = document.createElement('span');
    sourceHolder.className = 'svg-align';
    sourceSvg = document.createElementNS(SVG_NAMESPACE, 'svg') as SVGSVGElement;
    sourceHolder.append(sourceSvg);
    row.row.append(sourceHolder);
  }

  const cloneRoot = sourceRoot.cloneNode(true) as HTMLElement;
  const identities = new Map<Element, Element>();
  pairTrees(sourceRoot, cloneRoot, identities);
  const cloneRows = Array.from(cloneRoot.querySelectorAll('.base')).map((clone, index) => {
    const source = sourceRows[index];
    if (!source || !(clone instanceof HTMLElement)) throw new Error('test-clone-row-missing');
    const pstrut = clone.querySelector(':scope > .pstrut');
    const mord = clone.querySelector(':scope > .mord');
    if (!(pstrut instanceof HTMLElement) || !(mord instanceof HTMLElement)) throw new Error('test-clone-child-missing');
    return { clone, mord, pstrut, source: source.row };
  });
  const cloneGroup = cloneRoot.querySelector('.vlist');
  const cloneHolder = cloneRoot.querySelector('.svg-align');
  const cloneSvg = cloneRoot.querySelector('svg');
  if (!(cloneGroup instanceof HTMLElement)) throw new Error('test-clone-group-missing');

  const styles = new Map<Element, CSSStyleDeclaration>();
  const typed = new Map<Element, TypedStyleMap>();
  const rects = new Map<Element, Rect>();
  const pseudoStyles = new Map<Element, Map<string, { content: string; position?: string }>>();
  const animations: Animation[] = [];

  const setStyle = (element: Element, values: Readonly<Record<string, string>>): void => {
    styles.set(element, declaration({ ...SAFE_STYLE, ...values }));
  };
  const setTyped = (element: Element, values: Readonly<Record<string, TypedValue>>): void => {
    typed.set(element, {
      get: (property) => values[property] ?? keyword('auto')
    });
  };
  const setRect = (element: Element, rect: Rect): void => {
    rects.set(element, rect);
  };

  [sourceRoot, table, tableRow, group].forEach((element) => {
    setStyle(element, {});
  });
  sourceRows.forEach(({ mord, pstrut, row, top }) => {
    const numericTop = Number.parseFloat(top);
    setStyle(row, {
      bottom: 'auto',
      display: 'block',
      height: '0px',
      left: 'auto',
      position: 'relative',
      right: 'auto',
      top
    });
    setStyle(pstrut, {
      display: 'inline-block',
      height: '5px',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      width: '0px'
    });
    setStyle(mord, { display: 'inline' });
    setTyped(row, {
      blockSize: px(0),
      bottom: keyword('auto'),
      height: px(0),
      inlineSize: px(0),
      left: keyword('auto'),
      right: keyword('auto'),
      top: px(numericTop, top),
      width: px(0)
    });
    setTyped(pstrut, { blockSize: px(5), height: px(5), inlineSize: px(0), width: px(0) });
    setTyped(mord, {});
    setRect(pstrut, { bottom: 5, height: 5, left: 0, right: 0, top: 0, width: 0 });
  });
  setStyle(group, {
    display: 'table-cell',
    position: 'relative',
    'vertical-align': 'bottom'
  });
  setTyped(group, {});
  setRect(group, { bottom: 20, height: 20, left: 0, right: 10, top: 0, width: 10 });

  if (sourceHolder && sourceSvg) {
    setStyle(sourceHolder, {
      display: 'inline-block',
      height: '20px',
      position: 'static',
      'vertical-align': 'baseline',
      width: '10px'
    });
    setStyle(sourceSvg, {
      bottom: 'auto',
      display: 'block',
      height: '20px',
      left: 'auto',
      position: 'absolute',
      right: 'auto',
      top: 'auto',
      width: '10px'
    });
    setTyped(sourceHolder, { blockSize: px(20), height: px(20), inlineSize: px(10), width: px(10) });
    setTyped(sourceSvg, {
      blockSize: px(20),
      bottom: keyword('auto'),
      height: px(20),
      inlineSize: px(10),
      left: keyword('auto'),
      right: keyword('auto'),
      top: keyword('auto'),
      width: px(10)
    });
    const rect = { bottom: 20, height: 20, left: 0, right: 10, top: 0, width: 10 };
    setRect(sourceHolder, rect);
    setRect(sourceSvg, rect);
  }

  const runtime: WechatMathStaticFlowRuntime = {
    getAnimations: () => animations,
    getComputedStyle: (element, pseudoElement) => {
      if (pseudoElement) {
        const stored = pseudoStyles.get(element)?.get(pseudoElement);
        return declaration({
          content: stored?.content ?? 'none',
          position: stored?.position ?? 'static'
        });
      }
      return styles.get(element) ?? declaration(SAFE_STYLE);
    },
    getRect: (element) => rects.get(element) ?? zeroRect(),
    getTypedStyleMap: (element) => typed.get(element) ?? { get: () => keyword('auto') }
  };

  document.body.append(sourceRoot, cloneRoot);
  return {
    animations,
    cloneHolder: cloneHolder instanceof HTMLElement ? cloneHolder : null,
    cloneRoot,
    cloneSvg: cloneSvg instanceof SVGSVGElement ? cloneSvg : null,
    gate: { isCancelled: false, isCurrent: true },
    group,
    identities,
    rows: cloneRows,
    runtime,
    setIlluminatingPseudo: (element, pseudo, content, position) => {
      let map = pseudoStyles.get(element);
      if (!map) {
        map = new Map();
        pseudoStyles.set(element, map);
      }
      map.set(pseudo, { content, ...(position !== undefined ? { position } : {}) });
    },
    setRect,
    setStyle,
    setTyped,
    sourceHolder,
    sourceRoot,
    sourceSvg
  };
}

function gateOf(fixture: MathFixture): WechatMathStaticFlowGate {
  return {
    isCancelled: () => fixture.gate.isCancelled,
    isCurrent: () => fixture.gate.isCurrent
  };
}

function snapshotOf(fixture: MathFixture, sourceSignature = 'live-r2', rawSignature = 'raw-context'): WechatMathStaticFlowSnapshot {
  return captureWechatMathStaticFlowSnapshot({
    cloneIdentityFor: (source) => fixture.identities.get(source) ?? null,
    cloneRoot: fixture.cloneRoot,
    gate: gateOf(fixture),
    liveSourceAdmissionSignature: sourceSignature,
    rawDimensionGeometrySignature: rawSignature,
    runtime: fixture.runtime,
    sourceRoot: fixture.sourceRoot
  });
}

describe('wechat math static-flow group admission', () => {
  it('admits a negative-top zero-height row and applies paired row margins in the clone only', () => {
    const fixture = mathFixture([-7]);
    const sourceBefore = fixture.sourceRoot.outerHTML;
    const cloneBefore = fixture.cloneRoot.outerHTML;
    const snapshot = snapshotOf(fixture);
    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.svgTransitions).toEqual([]);
    expect(plan.rowTransitions).toHaveLength(1);
    expect(fixture.sourceRoot.outerHTML).toBe(sourceBefore);
    expect(fixture.cloneRoot.outerHTML).toBe(cloneBefore);

    applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) });

    const row = fixture.rows[0]?.clone;
    expect(fixture.sourceRoot.outerHTML).toBe(sourceBefore);
    expect(row?.getAttribute('style')).toContain('position:static!important');
    expect(row?.getAttribute('style')).toContain('top:auto!important');
    expect(row?.getAttribute('style')).toContain('margin-top:-7px!important');
    expect(row?.getAttribute('style')).toContain('margin-bottom:7px!important');
  });

  it('admits real-world fractional KaTeX CSSOM and TypedOM values without float-parsing precision loss', () => {
    // Exact values from Ego raw evidence row 0: top = -48.181px, TypedOM float = -48.18098831176758
    const fixture = mathFixture(['-48.181px']);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    fixture.setTyped(row.source, {
      blockSize: px(0),
      height: px(0),
      inlineSize: px(0),
      top: px(-48.18098831176758, '-48.181px'),
      width: px(0)
    });
    const snapshot = snapshotOf(fixture);
    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.rowTransitions).toHaveLength(1);

    applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) });

    expect(row.clone.getAttribute('style')).toContain('margin-top:-48.181px!important');
    expect(row.clone.getAttribute('style')).toContain('margin-bottom:48.181px!important');
  });

  it('rejects a mixed-sign matrix group completely before any SVG transition applies', () => {
    const fixture = mathFixture([-12, 12], true);
    const sourceBefore = fixture.sourceRoot.outerHTML;
    const cloneBefore = fixture.cloneRoot.outerHTML;
    const snapshot = snapshotOf(fixture);
    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });

    expect(plan.rowTransitions).toEqual([]);
    expect(plan.svgTransitions).toEqual([]);
    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'row-top' })]);

    applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) });

    expect(fixture.sourceRoot.outerHTML).toBe(sourceBefore);
    expect(fixture.cloneRoot.outerHTML).toBe(cloneBefore);
  });

  it('rejects a direct absolute containing-block child that is not the proven row-owned SVG', () => {
    const fixture = mathFixture([-7]);
    const absolute = document.createElement('span');
    absolute.className = 'absolute-output';
    fixture.rows[0]?.source.append(absolute);
    const cloneAbsolute = absolute.cloneNode(true) as Element;
    fixture.rows[0]?.clone.append(cloneAbsolute);
    fixture.identities.set(absolute, cloneAbsolute);
    fixture.setStyle(absolute, { position: 'absolute' });
    fixture.setTyped(absolute, {});
    fixture.setRect(absolute, zeroRect());

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rowTransitions).toEqual([]);
    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'absolute-containing-block' })]);
  });

  it('rejects a zero or positive row top instead of rewriting expanded matrix spacing', () => {
    for (const top of [0, 12]) {
      const fixture = mathFixture([top]);
      const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
      expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'row-top' })]);
    }
  });

  it('rejects a row with a non-finite Typed OM top', () => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    fixture.setTyped(row.source, {
      blockSize: px(0),
      height: px(0),
      top: px(Number.POSITIVE_INFINITY)
    });

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'row-top' })]);
  });

  it.each([
    ['undefined typed top', undefined as unknown as TypedValue],
    ['empty object typed top', {}],
    ['garbage keyword typed top', { value: 'garbage' }],
    ['negative numeric without unit', { value: -7 }],
    ['non-px unit typed top', { unit: 'em', value: -7 }],
    ['divergent typed top exceeding quantum', px(-50)]
  ] as const)('rejects a row with %s', (_label, invalidTypedTop) => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    fixture.setTyped(row.source, {
      blockSize: px(0),
      height: px(0),
      inlineSize: px(0),
      top: invalidTypedTop,
      width: px(0)
    });

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'row-top' })]);
  });

  it('fails explicitly when exact source-to-clone identity is missing', () => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    fixture.identities.delete(row.source);

    expect(() => snapshotOf(fixture)).toThrowError('wechat-math-static-flow-identity-missing');
  });

  it('rejects same-tag sibling identity swaps instead of pairing rows by ordinals', () => {
    const fixture = mathFixture([-9, -3]);
    const first = fixture.rows[0];
    const second = fixture.rows[1];
    if (!first || !second) throw new Error('rows missing');
    fixture.identities.set(first.source, second.clone);
    fixture.identities.set(second.source, first.clone);

    expect(() => snapshotOf(fixture)).toThrowError('wechat-math-static-flow-identity-mismatch');
  });

  it('rejects a group whose direct table-cell relationship is not the production grammar', () => {
    const fixture = mathFixture([-7]);
    fixture.setStyle(fixture.group, { display: 'block' });

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'group-layout' })]);
  });

  it('rejects a non-positive pstrut before considering rows static', () => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    const sourcePstrut = row.source.querySelector('.pstrut');
    if (!sourcePstrut) throw new Error('source pstrut missing');
    fixture.setRect(sourcePstrut, zeroRect());

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'pstrut' })]);
  });
});

describe('wechat math static-flow SVG staging and holder restrictions', () => {
  it('proves the row-owned absolute SVG holder contract and applies SVG static flow before rows', () => {
    const fixture = mathFixture([-9, -3], true);
    const snapshot = snapshotOf(fixture);
    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });
    const sourceBefore = fixture.sourceRoot.outerHTML;

    expect(plan.rejectedGroups).toEqual([]);
    expect(plan.svgTransitions).toHaveLength(1);
    expect(plan.rowTransitions).toHaveLength(2);

    const order: Element[] = [];
    const original = Element.prototype.setAttribute;
    const plannedTargets: Element[] = [
      ...(fixture.cloneSvg ? [fixture.cloneSvg] : []),
      ...(fixture.cloneHolder ? [fixture.cloneHolder] : []),
      ...fixture.rows.map(({ clone }) => clone)
    ];
    const spy = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name, value) {
      if ('style' === name && plannedTargets.includes(this)) {
        order.push(this);
      }
      return original.call(this, name, value);
    });

    applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) });
    spy.mockRestore();

    expect(fixture.sourceRoot.outerHTML).toBe(sourceBefore);
    expect(order[0]).toBe(fixture.cloneSvg);
    expect(order.indexOf(fixture.cloneSvg as Element)).toBeLessThan(order.indexOf(fixture.rows[0]?.clone as Element));
    expect(fixture.cloneSvg?.parentElement).toBe(fixture.cloneHolder);
    expect(fixture.cloneSvg?.getAttribute('style')).toContain('position:static!important');
    expect(fixture.cloneSvg?.getAttribute('style')).toContain('inset-inline-start:auto!important');
  });

  it('rejects an SVG holder with trailing non-empty text nodes', () => {
    const fixture = mathFixture([-7], true);
    if (!fixture.sourceHolder) throw new Error('holder missing');
    fixture.sourceHolder.append('trailing text');

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'svg-holder' })]);
    expect(plan.svgTransitions).toEqual([]);
  });

  it('rejects an SVG holder with extra sibling child elements', () => {
    const fixture = mathFixture([-7], true);
    if (!fixture.sourceHolder || !fixture.cloneHolder) throw new Error('holder missing');
    const extra = document.createElement('span');
    fixture.sourceHolder.append(extra);
    const cloneExtra = extra.cloneNode(true) as Element;
    fixture.cloneHolder.append(cloneExtra);
    fixture.identities.set(extra, cloneExtra);

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'svg-holder' })]);
    expect(plan.svgTransitions).toEqual([]);
  });

  it('rejects an SVG whose inline-block holder does not carry explicit finite width and height', () => {
    const fixture = mathFixture([-7], true);
    if (!fixture.sourceHolder) throw new Error('holder missing');
    fixture.setStyle(fixture.sourceHolder, { width: 'auto' });
    fixture.setTyped(fixture.sourceHolder, { width: keyword('auto') });

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'svg-holder' })]);
    expect(plan.svgTransitions).toEqual([]);
  });

  it('rejects an SVG whose source geometry no longer matches its holder', () => {
    const fixture = mathFixture([-7], true);
    if (!fixture.sourceSvg) throw new Error('svg missing');
    fixture.setRect(fixture.sourceSvg, { bottom: 20, height: 20, left: 0, right: 11, top: 0, width: 11 });

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'svg-geometry' })]);
  });

  it.each([
    ['fixed-before-invalid-svg', true, 'absolute-containing-block'],
    ['fixed-after-invalid-svg', false, 'svg-geometry']
  ] as const)('preserves preorder rejection for %s', (_label, fixedBefore, expectedReason) => {
    const fixture = mathFixture([-7], true);
    if (!fixture.sourceHolder || !fixture.cloneHolder || !fixture.sourceSvg) throw new Error('svg fixture incomplete');
    const sourceFixed = document.createElement('span');
    sourceFixed.className = 'mord';
    const cloneFixed = sourceFixed.cloneNode(true) as HTMLElement;
    fixture.identities.set(sourceFixed, cloneFixed);
    fixture.setStyle(sourceFixed, { display: 'inline', position: 'fixed' });
    fixture.setTyped(sourceFixed, {});
    if (fixedBefore) {
      fixture.rows[0]?.source.insertBefore(sourceFixed, fixture.sourceHolder);
      fixture.rows[0]?.clone.insertBefore(cloneFixed, fixture.cloneHolder);
    } else {
      fixture.rows[0]?.source.append(sourceFixed);
      fixture.rows[0]?.clone.append(cloneFixed);
    }
    fixture.setRect(fixture.sourceSvg, { bottom: 20, height: 20, left: 0, right: 11, top: 0, width: 11 });

    const admission = evaluateWechatMathSourceAdmission(fixture.sourceRoot, fixture.runtime, []);
    expect(admission.groups[0]?.reason).toBe(expectedReason);
    expect(admission.witness.groups[0]?.reason).toBe(expectedReason);
    expect(admission.witness.svg).toHaveLength(0);
  });

  it.each([
    ['containment', { contain: 'layout' }, 'row-safety'],
    ['paint effect', { filter: 'blur(1px)' }, 'row-safety'],
    ['layout effect', { transform: 'translateY(1px)' }, 'row-safety']
  ] as const)('rejects an unsafe %s input on the row', (_label, override, reason) => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    fixture.setStyle(row.source, override);

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason })]);
  });

  it('rejects generated pseudo paint instead of guessing its static behavior', () => {
    const fixture = mathFixture([-7]);
    fixture.setIlluminatingPseudo(fixture.group, '::before', '"generated"');

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'group-pseudo' })]);
  });

  it.each([
    ['string literal none', '"none"'],
    ['url image', 'url(https://example.com/marker.png)'],
    ['empty quoted string', '""']
  ] as const)('does not conflate %s with absence', (_label, content) => {
    const fixture = mathFixture([-7]);
    fixture.setIlluminatingPseudo(fixture.group, '::before', content);

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'group-pseudo' })]);
  });

  it('rejects an absolute descendant pseudo-element whose containing block was the row', () => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    const sourceMord = row.source.querySelector('.mord');
    if (!sourceMord) throw new Error('source mord missing');
    fixture.setIlluminatingPseudo(sourceMord, '::after', '"*"', 'absolute');

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'absolute-containing-block' })]);
  });

  it('rejects an animation owned by an admitted group subtree', () => {
    const fixture = mathFixture([-7]);
    const row = fixture.rows[0];
    if (!row) throw new Error('row missing');
    const sourceMord = row.source.querySelector('.mord');
    if (!sourceMord) throw new Error('source mord missing');
    fixture.animations.push({ effect: { target: sourceMord } } as unknown as Animation);

    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    expect(plan.rejectedGroups).toEqual([expect.objectContaining({ reason: 'group-animation' })]);
  });
});

describe('wechat math static-flow gates, detached/classless apply, and identity invariants', () => {
  it('applies cleanly on a completely detached and classless clone tree', () => {
    const fixture = mathFixture([-9, -3], true);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });

    // Detach cloneRoot from the document
    fixture.cloneRoot.remove();
    expect(fixture.cloneRoot.isConnected).toBe(false);

    // Strip every class attribute from the entire clone tree (matching serializer class removal)
    fixture.cloneRoot.removeAttribute('class');
    fixture.cloneRoot.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('class');
    });

    applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) });

    expect(fixture.cloneSvg?.getAttribute('style')).toContain('position:static!important');
    expect(fixture.rows[0]?.clone.getAttribute('style')).toContain('margin-top:-9px!important');
    expect(fixture.rows[1]?.clone.getAttribute('style')).toContain('margin-top:-3px!important');
  });

  it('fails before mutation when pstrutClone is removed from the clone row (clone-only removal)', () => {
    const fixture = mathFixture([-7]);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
    const rowTransition = plan.rowTransitions[0];
    if (!rowTransition) throw new Error('row transition missing');

    expect(rowTransition.pstrutClone).toBeDefined();
    rowTransition.pstrutClone.remove();

    expect(() => applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) })).toThrowError(
      'wechat-math-static-flow-apply-detached'
    );
  });

  it('fails before mutation when pstrutClone is moved to an invalid parent', () => {
    const fixture = mathFixture([-7]);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
    const rowTransition = plan.rowTransitions[0];
    if (!rowTransition) throw new Error('row transition missing');

    fixture.cloneRoot.append(rowTransition.pstrutClone);

    expect(() => applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) })).toThrowError(
      'wechat-math-static-flow-apply-parent-mismatch'
    );
  });

  it('rejects a stale plan before any clone mutation', () => {
    const fixture = mathFixture([-7]);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
    fixture.gate.isCurrent = false;

    expect(() => applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) })).toThrowError('wechat-math-static-flow-stale');
    expect(fixture.cloneRoot.outerHTML).toBe(fixture.sourceRoot.outerHTML);
  });

  it('rolls back SVG-only work when cancellation arrives before the row stage', () => {
    const fixture = mathFixture([-9, -3], true);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
    const cloneBefore = fixture.cloneRoot.outerHTML;
    let cancellations = 0;
    const gate: WechatMathStaticFlowGate = {
      isCancelled: () => {
        cancellations += 1;
        return cancellations >= 3;
      },
      isCurrent: () => true
    };

    expect(() => applyWechatMathStaticFlow(plan, { gate })).toThrowError('wechat-math-static-flow-cancelled');
    expect(fixture.cloneRoot.outerHTML).toBe(cloneBefore);
  });

  it('fails before mutation when a planned clone target is detached from cloneRoot', () => {
    const fixture = mathFixture([-9], true);
    const plan = planWechatMathStaticFlow(snapshotOf(fixture), { gate: gateOf(fixture) });
    fixture.cloneSvg?.remove();

    expect(() => applyWechatMathStaticFlow(plan, { gate: gateOf(fixture) })).toThrowError(
      'wechat-math-static-flow-apply-detached'
    );
  });

  it('freezes the live-source and raw-dimension owner signatures into one snapshot signature', () => {
    const fixture = mathFixture([-7]);
    const first = snapshotOf(fixture, 'live-a', 'raw-a');
    const changedRaw = snapshotOf(fixture, 'live-a', 'raw-b');
    const changedLive = snapshotOf(fixture, 'live-b', 'raw-a');

    expect(changedRaw.signature).not.toBe(first.signature);
    expect(changedLive.signature).not.toBe(first.signature);
    expect(first.signature).toContain('live-a');
    expect(first.signature).toContain('raw-a');
  });

  it('evaluates source admission independently from clone binding and produces an exact witness', () => {
    const fixture = mathFixture([-7], true);
    const result = evaluateWechatMathSourceAdmission(fixture.sourceRoot, fixture.runtime, []);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reason).toBeNull();
    expect(result.groups[0]?.rows).toHaveLength(1);
    expect(result.groups[0]?.svgTransitions).toHaveLength(1);
    expect(result.witness.version).toBe(1);
    expect(result.witness.groups).toEqual([{ reason: null, source: expect.stringContaining('vlist') }]);
    expect(result.witness.rows).toEqual([
      { rawTop: '-7px', source: expect.stringContaining('span'), top: -7 }
    ]);
    expect(result.witness.svg).toHaveLength(1);

    // Bind with sourceAdmission to clone tree
    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => fixture.identities.get(s) ?? null,
      cloneRoot: fixture.cloneRoot,
      gate: gateOf(fixture),
      liveSourceAdmissionSignature: 'live',
      rawDimensionGeometrySignature: 'raw',
      runtime: fixture.runtime,
      sourceAdmission: result,
      sourceRoot: fixture.sourceRoot
    });

    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });
    expect(plan.rejectedGroups).toHaveLength(0);
    expect(plan.svgTransitions).toHaveLength(1);
    expect(plan.rowTransitions).toHaveLength(1);
  });

  it('supports section cloneRoot replacement for div sourceRoot during snapshot and apply', () => {
    const fixture = mathFixture([-7], true);
    const sectionCloneRoot = document.createElement('section');
    for (const child of Array.from(fixture.cloneRoot.children)) {
      sectionCloneRoot.append(child);
    }
    const sectionIdentities = new Map(fixture.identities);
    sectionIdentities.set(fixture.sourceRoot, sectionCloneRoot);

    const snapshot = captureWechatMathStaticFlowSnapshot({
      cloneIdentityFor: (s) => sectionIdentities.get(s) ?? null,
      cloneRoot: sectionCloneRoot,
      gate: gateOf(fixture),
      liveSourceAdmissionSignature: 'live',
      rawDimensionGeometrySignature: 'raw',
      runtime: fixture.runtime,
      sourceRoot: fixture.sourceRoot
    });

    expect(snapshot.cloneRoot).toBe(sectionCloneRoot);
    const plan = planWechatMathStaticFlow(snapshot, { gate: gateOf(fixture) });

    applyWechatMathStaticFlow(plan, { cloneRoot: sectionCloneRoot, gate: gateOf(fixture) });
    const cloneRow = sectionIdentities.get(fixture.rows[0]?.source as Element);
    expect(cloneRow?.getAttribute('style')).toContain('margin-top:-7px!important');
  });

  // #4: Deepfreeze every plain admission/group/row/SVG/witness record + nested arrays; DOM refs not frozen
  it('deepfreezes every plain admission, group, row, SVG, and witness record and nested arrays without freezing DOM elements', () => {
    const fixture = mathFixture([-7], true);
    const result = evaluateWechatMathSourceAdmission(fixture.sourceRoot, fixture.runtime, []);

    // 1. Plain admission result record and groups array
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.groups)).toBe(true);

    const group = result.groups[0];
    if (!group) throw new Error('group missing');
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.rows)).toBe(true);
    expect(Object.isFrozen(group.svgTransitions)).toBe(true);

    // 2. Row records
    const row = group.rows[0];
    if (!row) throw new Error('row missing');
    expect(Object.isFrozen(row)).toBe(true);

    // 3. SVG transition records and sourceChain array
    const svgTransition = group.svgTransitions[0];
    if (!svgTransition) throw new Error('svgTransition missing');
    expect(Object.isFrozen(svgTransition)).toBe(true);
    expect(Object.isFrozen(svgTransition.sourceChain)).toBe(true);

    // 4. Witness record and nested witness arrays/records
    const witness = result.witness;
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness.groups)).toBe(true);
    expect(Object.isFrozen(witness.groups[0])).toBe(true);
    expect(Object.isFrozen(witness.orderedObserved)).toBe(true);
    expect(Object.isFrozen(witness.rows)).toBe(true);
    expect(Object.isFrozen(witness.rows[0])).toBe(true);
    expect(Object.isFrozen(witness.svg)).toBe(true);
    expect(Object.isFrozen(witness.svg[0])).toBe(true);

    // 5. DOM references must NOT be frozen
    expect(Object.isFrozen(result.sourceRoot)).toBe(false);
    expect(Object.isFrozen(group.source)).toBe(false);
    expect(Object.isFrozen(row.source)).toBe(false);
    expect(Object.isFrozen(row.pstrutSource)).toBe(false);
    expect(Object.isFrozen(svgTransition.sourceHolder)).toBe(false);
    expect(Object.isFrozen(svgTransition.sourceRow)).toBe(false);
    expect(Object.isFrozen(svgTransition.sourceSvg)).toBe(false);
    expect(Object.isFrozen(svgTransition.sourceChain[0])).toBe(false);
  });

  // #5: check sourceAdmission.sourceRoot === options.sourceRoot before any binding including empty result
  it('checks sourceAdmission.sourceRoot === options.sourceRoot before any binding including empty result and throws root-mismatch', () => {
    const fixture1 = mathFixture([-7], true);
    const fixture2 = mathFixture([-7], true);

    const result1 = evaluateWechatMathSourceAdmission(fixture1.sourceRoot, fixture1.runtime, []);

    // Passing sourceAdmission from fixture1 to capture snapshot of fixture2 must throw root-mismatch
    expect(() =>
      captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture2.identities.get(s) ?? null,
        cloneRoot: fixture2.cloneRoot,
        gate: gateOf(fixture2),
        liveSourceAdmissionSignature: 'live',
        rawDimensionGeometrySignature: 'raw',
        runtime: fixture2.runtime,
        sourceAdmission: result1,
        sourceRoot: fixture2.sourceRoot
      })
    ).toThrowError('wechat-math-static-flow-root-mismatch');

    // Also test with empty admission result (groups: []) - check must run BEFORE any binding
    const emptyResult = evaluateWechatMathSourceAdmission(document.createElement('div'), fixture1.runtime, []);
    expect(emptyResult.groups).toHaveLength(0);

    expect(() =>
      captureWechatMathStaticFlowSnapshot({
        cloneIdentityFor: (s) => fixture2.identities.get(s) ?? null,
        cloneRoot: fixture2.cloneRoot,
        gate: gateOf(fixture2),
        liveSourceAdmissionSignature: 'live',
        rawDimensionGeometrySignature: 'raw',
        runtime: fixture2.runtime,
        sourceAdmission: emptyResult,
        sourceRoot: fixture2.sourceRoot
      })
    ).toThrowError('wechat-math-static-flow-root-mismatch');
  });
});
